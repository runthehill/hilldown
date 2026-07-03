# HillDown 0.4.0 — Tabs, Native Menus, Export & Print

**Status:** Approved design (brainstorming complete)
**Date:** 2026-07-03
**Branch:** `feat/tabs-menus-export`
**Target version:** 0.3.1 → 0.4.0

## 1. Goals

Three user-requested improvements to the HillDown desktop Markdown editor:

1. **Proper application menus** — a native menu bar with the File/Edit/Format/View/Window/Help
   commands expected of an editor: New, Open, Save, Save As, Export, Print, plus formatting and
   view commands, all with standard accelerators.
2. **Open multiple documents as in-window tabs** — opening a second file must no longer replace the
   current document. Files open in a tab strip within one window (decision confirmed during
   brainstorming: tabs, not separate windows).
3. **Fix the scroll-to-end bug** — a freshly opened document must show its start, not scroll to the
   bottom.

Plus the export capability the menus imply: **Export as HTML**, **Export as PDF**, and native
**Print**.

## 2. Non-goals (deferred beyond v1)

- Session restore / reopen-tabs-on-relaunch.
- An "Open Recent" list.
- Drag-to-reorder tabs.
- Bundling web-font binaries into the exported HTML (v1 uses a portable system font stack).
- Fully silent one-click PDF-to-file with no dialog (needs per-platform native rendering; the native
  print panel's "Save as PDF" covers the need for v1).
- Separate-window multi-document mode, and a tabs-vs-windows preference.

## 3. Decisions (from brainstorming)

- **Multi-document model:** in-window tabs.
- **Export formats:** Styled standalone HTML file + PDF via the native print panel. Raw/unstyled HTML
  deferred.
- **Print:** genuinely native — the OS print panel — reachable both as `File ▸ Print…` and as the
  destination for `Export ▸ As PDF…`.

## 4. Architecture principles preserved

- **Pure functions, thin shell.** New document-collection logic goes in a testable module
  (`src/documentSession.ts`), mirroring `src/editorCommands.ts`. `App.tsx` stays a wiring layer.
- **Dual runtime.** `canUseNativeFileSystem()` remains the single native/browser switch. Tabs, and
  every command, must work in both the Tauri desktop app and the plain-web fallback.
- **Event-driven Rust↔TS.** The menu reuses the exact pattern already used for
  `hilldown://open-files`: Rust owns the native surface and emits an event; the frontend listens and
  dispatches to the action functions it already has.
- **DOMPurify stays.** All rendered HTML (preview, HTML export, print container) flows through the
  existing `marked → DOMPurify` sanitize step. No new rendering path bypasses it.
- **No permission widening.** Menus and events are Rust-side (no new JS capability). Export reuses the
  already-granted `dialog:allow-save` + `fs:allow-write-text-file`. `window.print()` is a web API.
  `src-tauri/capabilities/default.json` is unchanged.

---

## 5. Feature: Scroll-to-start fix

**Cause.** `loadDocument`/`resetDocument` reposition the caret with `focusSelection(0, 0)` but never
reset the textarea's `scrollTop`/`scrollLeft`, and the preview scroll container keeps its previous
offset. When a large document replaces a small one while the textarea is focused, the view is left
scrolled.

**Fix.** When a document becomes active (opened, created, or switched to), set the editor textarea's
`scrollTop`/`scrollLeft` to that document's remembered `scrollTop` (0 for a freshly opened/created
doc) and reset the preview scroll container to top on open/create. This is folded into the tab work
below, because the load path is being rewritten anyway.

- Per-tab scroll memory: the active document's `scrollTop` is captured on the textarea `onScroll`
  handler (throttled via the existing scroll handler) and restored when the tab is re-activated.
- The reported bug (fresh open scrolls to end) is fixed by the "0 for a freshly opened doc" rule.

---

## 6. Feature: Tabs (document session model)

### 6.1 Types

```ts
// src/documentSession.ts
export type DocumentId = string;

export interface EditorDocument {
  id: DocumentId;
  markdown: string;
  title: string;             // display title (no extension)
  path: string | null;       // native file path; null = unsaved or browser mode
  lastSavedMarkdown: string; // baseline for dirty detection
  history: string[];         // per-document undo stack, capped at 80
  historyIndex: number;
  selection: TextSelection;  // reused from editorCommands.ts
  scrollTop: number;         // remembered editor scroll offset
}

export interface EditorSession {
  documents: EditorDocument[]; // never empty
  activeId: DocumentId;
}
```

Invariant: `documents` is never empty. Closing the last tab replaces it with a fresh untitled
document (matching today's "always one document" behaviour).

### 6.2 Pure API (all unit-tested)

- `createEmptyDocument(id): EditorDocument` — untitled, empty, single-entry history.
- `documentFromFile(id, contents, name, path): EditorDocument` — titled from the filename, history
  seeded, `lastSavedMarkdown === contents`, `scrollTop: 0`.
- `createSession(doc): EditorSession` — initial session with one active document.
- `getActive(session): EditorDocument`.
- `replaceActive(session, updater: (doc) => EditorDocument): EditorSession` — immutable update of the
  active document; the funnel for every edit (typing, commit, history, title, scroll).
- `addDocument(session, doc): EditorSession` — append and activate.
- `openDocumentInSession(session, doc): EditorSession` — **dedupe:** if a document with the same
  non-null `path` is already open, activate it instead of adding a duplicate; otherwise `addDocument`.
- `setActive(session, id): EditorSession`.
- `closeDocument(session, id): EditorSession` — remove; activate the nearest neighbour (prefer the
  right tab, else the left); if it was the only tab, return a session with one fresh untitled doc.
- `isDocumentDirty(doc): boolean` — `markdown !== lastSavedMarkdown`.

Id generation lives in `App.tsx` (`crypto.randomUUID()`), not in the pure module, so the module stays
deterministic and easily testable.

### 6.3 App.tsx integration

Replace the per-document `useState` hooks (`markdown`, `title`, `documentPath`, `lastSavedMarkdown`,
`history`, `historyIndex`, `selection`) with a single `session` state plus derived `activeDoc =
getActive(session)`. App-global UI state stays top-level and is **not** per-document: `mode`
(edit/split/preview), `status`, slash-menu state (`slashIndex`, `slashMenuPosition`).

- All mutators (`onTextChange`, `commit`, `pushHistory`, `undo`, `redo`, `setTitle`, `runTool`,
  `chooseSlashCommand`) route through `replaceActive`.
- `loadDocument` becomes "open in session" (`openDocumentInSession`) — it no longer clobbers state; it
  adds/activates a tab and resets scroll to top.
- `openNativePath` (OS "open with") and `openDocument` (menu/button) both add tabs. **The
  discard-unsaved-changes `window.confirm` on open is removed** — opening never destroys work now.
- `resetDocument` ("New") adds a fresh untitled tab instead of replacing.
- New: `closeTab(id)` — if the doc is dirty, confirm ("Close <title> without saving?"); then
  `closeDocument`.
- `saveDocument` / `saveNativeMarkdownDocument` operate on `activeDoc`; on success update that
  document's `path`, `title`, `lastSavedMarkdown` via `replaceActive`.

### 6.4 Tab bar UI

A horizontal strip rendered between the topbar and the toolbar. Dense and app-like, using the
existing "paper & petrol ink" tokens in `styles.css`. New kebab-case classes: `.tab-strip`, `.tab`,
`.tab.active`, `.tab-title`, `.tab-dirty`, `.tab-close`, `.tab-new`.

Per tab: title, a `●` dirty indicator when `isDocumentDirty`, and a `×` close button (revealed on
hover/focus; always present on the active tab). A trailing `+` button adds an empty tab. The strip
scrolls horizontally on overflow; the active tab is scrolled into view on change. Middle-click closes
a tab. All controls are keyboard-focusable with `aria-label`s; the strip has `role="tablist"` and
tabs `role="tab"` with `aria-selected`.

The topbar "New"/"Open" buttons stay. The document title `<input>` and dirty/path line in the topbar
now reflect the **active** document.

### 6.5 Browser fallback

Tabs are purely in-memory, so they work unchanged in the browser. "Open" there uses the existing
hidden `<input type="file">`, and now adds a tab rather than replacing. "Save" downloads a Blob and
marks the active doc's `lastSavedMarkdown`.

### 6.6 Tests (`src/documentSession.test.ts`)

Cover: create empty/from-file; add + activate; open dedupe by path (activates existing, no
duplicate); open distinct paths (adds); close middle (activates right neighbour); close active-last
(activates left); close the only tab (leaves one fresh untitled); dirty detection; `replaceActive`
immutability (returns new objects, other docs untouched).

---

## 7. Feature: Native menus

### 7.1 Approach

Build the menu programmatically in Rust at `setup` (native menu bar; a real macOS app menu), attach
accelerators, and register `app.on_menu_event`. Custom items emit a single event
`hilldown://menu` carrying the action id string; the frontend listens and dispatches. OS-native
behaviours use Tauri `PredefinedMenuItem`s so the platform handles them correctly.

New constant, defined identically in both places (like `OPENED_FILES_EVENT` /`openedFilesEvent`
today):
- `lib.rs`: `const MENU_EVENT: &str = "hilldown://menu";`
- `fileService.ts`: `export const menuEvent = "hilldown://menu";`

### 7.2 Predefined vs. custom

- **Predefined** (`PredefinedMenuItem`): About, Services, Hide/Hide Others/Show All, Quit (macOS app
  menu); Cut, Copy, Paste, Select All (Edit); Minimize, Zoom, Fullscreen (Window/View); separators.
- **Custom** (emit `hilldown://menu`): New, Open, Save, Save As, Export HTML, Export PDF, Print, Close
  Tab; Undo, Redo, Copy as Markdown, Copy as HTML; all Format items; the three View modes; Next/Prev
  Tab and Go-to-Tab N.
- **Undo/Redo are deliberately custom**, not `PredefinedMenuItem::undo/redo`: HillDown has its own
  in-component history model, so these must drive `undo()`/`redo()`, not the webview's native undo.

### 7.3 Menu structure

```
HillDown (macOS app menu)   File                  Edit                 Format
  About HillDown              New          ⌘N       Undo          ⌘Z     Bold           ⌘B
  ──                          Open…        ⌘O       Redo         ⇧⌘Z     Italic         ⌘I
  Hide / Hide Others          ──                    ──                   Link           ⌘K
  ──                          Save         ⌘S       Cut / Copy / Paste   ──
  Quit HillDown        ⌘Q     Save As…    ⇧⌘S       Select All           Heading 1
                              ──                    ──                   Heading 2
                              Export ▸ As HTML…      Copy as Markdown     Bulleted List
                              Export ▸ As PDF…       Copy as HTML         Numbered List
                              Print…       ⌘P                            Task List
                              ──                                         Quote
                              Close Tab    ⌘W                            Code Block
                                                                         Table
View                Window                                              Divider
  Editor Only  ⌃⌘1   Minimize    ⌘M
  Split        ⌃⌘2   Zoom
  Preview      ⌃⌘3   ──
  ──                 Next Tab        ⌃⇥ / ⌘⇧]
  Enter Full Screen  Previous Tab   ⌃⇧⇥ / ⌘⇧[
                     ──
                     Go to Tab 1…9   ⌘1…⌘9
```

Platform notes:
- **Windows/Linux:** no app menu. Quit becomes `File ▸ Exit` (`Ctrl+Q`); About and Fullscreen move to
  `Help`/`View` respectively. Accelerators use `Ctrl` via Tauri's `CmdOrCtrl`.
- Accelerator strings use Tauri's `CmdOrCtrl+…` syntax so one definition serves both platforms.

### 7.4 Frontend dispatch

A `handleMenuAction(id: string)` switch in `App.tsx` maps ids to existing actions: `open` →
`openDocument()`, `save` → `saveDocument(false)`, `saveAs` → `saveDocument(true)`, `new` →
`resetDocument()` (new tab), `closeTab` → `closeTab(activeId)`, `exportHtml` → `exportHtml()`,
`exportPdf`/`print` → `printDocument()`, `undo`/`redo`, `copyMarkdown`/`copyHtml`, `format:<tool>` →
`runTool(tool)`, `view:<mode>` → `setMode(mode)`, `nextTab`/`prevTab`/`goToTab:<n>` → session
navigation.

Because these closures capture current state and change identity each render, the `listen` callback
must call the **latest** dispatcher without re-subscribing every render: store it in a ref
(`menuHandlerRef.current = handleMenuAction` on each render) and have the one-time listener call
`menuHandlerRef.current(id)`. Same idiom already used implicitly by the open-files listener; make it
explicit here.

### 7.5 Shortcut ownership (avoid double-fire)

In native mode the menu accelerators are the single source of truth for global shortcuts, so the
duplicate handling in `onEditorKeyDown` for `Cmd+S/O/N/B/I/K` is gated behind `!nativeFiles`. Browser
mode keeps those keydown shortcuts (there is no native menu there). The editor-internal keys —
`Tab`/`Shift+Tab` indent and the slash-menu navigation — stay in `onEditorKeyDown` in both modes.
`Cmd+W`, tab-switch, and go-to-tab shortcuts are menu-owned in native mode; browser mode may add a
minimal keydown fallback for `Cmd+W`/tab-switch if desired (optional).

### 7.6 Rust wiring sketch

```rust
// build_menu(app) -> Menu, using MenuBuilder / SubmenuBuilder / MenuItemBuilder / PredefinedMenuItem
// with .accelerator("CmdOrCtrl+S") and stable .id("save") strings.
// setup: let menu = build_menu(app)?; app.set_menu(menu)?;
// app.on_menu_event(move |app, event| {
//     let id = event.id().0.as_str();
//     // Predefined ids handle themselves; forward custom ids:
//     let _ = app.emit(MENU_EVENT, id);
// });
```

Unit-test the id/accelerator table where practical (a small pure `menu_items()` list returning
`(id, label, accelerator)` tuples can be asserted); the live menu is verified in `tauri dev`.

---

## 8. Feature: Export & Print

### 8.1 HTML export (`src/htmlExport.ts`, tested)

`buildStandaloneHtml(title, sanitizedBodyHtml): string` returns a complete, self-contained document:

```
<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{reading theme — portable system serif/mono stack, spacing, code/table/blockquote rules}</style>
</head><body><article class="markdown-preview">{sanitizedBodyHtml}</article></body></html>
```

- Input is the already-`DOMPurify`-sanitized `renderedHtml`; the `<title>` is escaped.
- The inlined stylesheet is a compact constant that mirrors the preview's reading styles using a
  portable font stack (e.g. Newsreader → Georgia/serif fallback, IBM Plex Mono → ui-monospace), so the
  file renders well anywhere without bundled fonts (deferred, see non-goals).
- Save: native mode uses `save()` (default name `<title>.html`) + `writeTextFile`; browser mode
  downloads a Blob. Add `exportHtmlDocument(html, suggestedName)` to `fileService.ts` reusing the
  existing dialog/fs and Blob paths.
- Tests: `buildStandaloneHtml` includes doctype, escaped title, the body html, and one style marker;
  title escaping handles `<`/`&`/quotes.

### 8.2 Print & PDF (native)

- A **hidden print container** is always in the DOM: `<article class="markdown-preview print-only"
  dangerouslySetInnerHTML={{ __html: renderedHtml }} />`, holding the active document's rendered HTML
  regardless of the current view mode (so Print works from Editor-only mode too).
- A `@media print` block in `styles.css` hides all app chrome (`.topbar`, `.tab-strip`, `.toolbar`,
  `.editor-pane`, `.preview-pane`, `.statusbar`) and shows only `.print-only`, laid out for paper
  (readable measure, page margins, no fixed positioning).
- `printDocument()` sets `document.title` to the active doc name (so the print panel's default
  filename is sensible) and calls `window.print()`, which raises the **native OS print panel** — send
  to a printer, or "Save as PDF". Both `File ▸ Print… (⌘P)` and `Export ▸ As PDF…` invoke this.

**Risk / contingency (verify early).** `window.print()` has historically been unreliable in macOS
WKWebView. Implementation must verify it in `npm run tauri dev` on the target macOS before relying on
it. If it does not raise the panel, fall back to a native Rust print command invoked via `objc2`
(`-[WKWebView printOperationWithPrintInfo:]` run modally) — the project already depends on
`objc2`/`objc2-foundation`, so the pattern is established. The event id `print`/`exportPdf` would then
`invoke` that Rust command instead of calling `window.print()`. The frontend contract is unchanged
either way.

---

## 9. Capabilities & dependencies

- **No capability changes.** Menu + event emission are Rust-side; `listen` uses `core:event` already
  in `core:default`; export reuses granted dialog/fs permissions; `window.print()` needs none.
- **Cargo:** menus are part of the `tauri` v2 crate; no new dependency expected. Add a feature flag
  only if the build demands it (verify with `cargo check`). The `objc2` print contingency needs the
  WKWebView-related `objc2-app-kit`/`objc2-web-kit` crate **only if** that fallback is taken; not
  added pre-emptively.

---

## 10. Testing

- **Frontend unit (Vitest):** `documentSession.test.ts` (§6.6) and `htmlExport.test.ts` (§8.1).
  `editorCommands.ts` and its tests are untouched.
- **Rust:** existing `lib.rs` tests stay green; add a small assertion over the menu id/accelerator
  table if it is expressed as pure data. `cargo check` + `cargo test` from `src-tauri/`.
- **Manual (required before push):** `npm run tauri dev` — verify tabs (open several files, dedupe,
  close/dirty-confirm, switch, scroll-resets-to-top on open, per-tab scroll memory), every menu item
  and accelerator, HTML export output, and Print raising the native panel + Save-as-PDF.
- `npm test` and `npm run build` must pass.

## 11. Release checklist (0.4.0)

Per the repo release rule, in the implementing commit(s) bump `0.3.1 → 0.4.0` in all five files —
`package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
`src-tauri/tauri.conf.json` — and add a dated `CHANGELOG.md` entry (Added: tabs, native menus, HTML
export, native Print / PDF; Fixed: open-scrolls-to-end).

## 12. Build sequence

1. **Document session + tabs** (`documentSession.ts` + tests → `App.tsx` refactor → tab bar UI +
   styles). Folds in the scroll-to-start fix.
2. **Native menus** (`lib.rs` menu + event → `fileService.ts` `menuEvent` → `App.tsx` dispatcher +
   ref pattern → gate duplicate keydown shortcuts).
3. **Export & Print** (`htmlExport.ts` + tests → `fileService.ts` export save → `App.tsx`
   export/print wiring → print stylesheet + hidden container). Verify `window.print()` early; apply
   the objc2 contingency only if needed.
4. **Release chores** (version bump ×5 + CHANGELOG; run `npm test`, `npm run build`, `cargo check`).

## 13. File change map

**New**
- `src/documentSession.ts`, `src/documentSession.test.ts`
- `src/htmlExport.ts`, `src/htmlExport.test.ts`

**Modified**
- `src/App.tsx` — session model, tab bar, menu listener/dispatch, export/print, scroll reset, gated
  shortcuts.
- `src/fileService.ts` — `menuEvent` constant, `exportHtmlDocument` save helper.
- `src/styles.css` — tab strip styles, `@media print` rules, `.print-only` container.
- `src-tauri/src/lib.rs` — `MENU_EVENT`, `build_menu`, `set_menu`, `on_menu_event`.
- `src-tauri/Cargo.toml` / `Cargo.lock` — only if a menu feature or the objc2 web-kit contingency is
  required.
- `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json` — version bump.
- `CHANGELOG.md` — 0.4.0 entry.

## 14. Open risks

1. **`window.print()` in WKWebView** — primary risk; mitigated by early verification + documented
   objc2 contingency (§8.2).
2. **Menu accelerator double-fire** — mitigated by gating keydown shortcuts behind `!nativeFiles`
   (§7.5); verify no action fires twice in native mode.
3. **Per-keystroke session update cost** — `replaceActive` maps over the documents array on each edit;
   negligible for realistic tab counts, but keep the array small (documents hold capped 80-entry
   histories).
