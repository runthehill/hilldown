# Open Recent — Design

**Status:** Approved design (brainstorming complete)
**Date:** 2026-07-03
**Branch:** `feat/tabs-menus-export` (increment on the v0.4.0 tabs/menus work; same open PR)

## 1. Goal

Add a `File ▸ Open Recent` menu that lets the user reopen recently opened/saved Markdown files. Desktop (Tauri) only — the browser fallback has no persistent file paths.

## 2. Decisions (from brainstorming)

- **Persistence:** frontend-owned list in the Tauri webview's `localStorage` — zero new dependencies, survives restarts. (Rejected `tauri-plugin-store`: adds a crate + Rust wiring for no real gain here.)
- **Cap:** 10 entries, most-recent-first, deduped by path.
- **Recorded on:** a successful native **open** and a successful **save/Save As** (any time we obtain a native path), moving that path to the front.
- **Menu-only** for v1 (no in-window recent panel, no pinning).

## 3. Architecture

Reuses the frontend-owns-state + native-menu-sync pattern built for tabs (`build_menu` + `sync_*` command + a debounced frontend effect that rebuilds the native menu via `set_menu` on the main thread).

### 3.1 Pure list logic — `src/recentFiles.ts` (unit-tested)

```ts
export interface RecentFile { path: string; name: string; }
export const MAX_RECENT = 10;
export function addRecent(list: RecentFile[], entry: RecentFile, cap?: number): RecentFile[];
   // remove any existing entry with the same path, prepend entry, cap length
export function removeRecent(list: RecentFile[], path: string): RecentFile[];
```

Pure, no I/O — mirrors `documentSession.ts`.

### 3.2 Persistence helpers — `src/recentFiles.ts` (thin, localStorage)

```ts
export function loadRecentFiles(): RecentFile[];   // JSON.parse localStorage["hilldown.recent"]; [] on any error
export function saveRecentFiles(list: RecentFile[]): void; // JSON.stringify; swallow quota/serialization errors
```

Both are defensive (try/catch → sensible default) so a corrupt/absent value never breaks startup.

### 3.3 App wiring — `src/App.tsx`

- `const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => loadRecentFiles());`
- `rememberRecent(path, name)`: `setRecentFiles((list) => addRecent(list, { path, name }))` — called from the open path (`loadDocument`/`openNativePath` when `path` is non-null) and from `saveDocument` on native success. Only runs under `nativeFiles`.
- An effect persists on change: `useEffect(() => saveRecentFiles(recentFiles), [recentFiles])`.
- Menu sync (see 3.4) includes the recent list, keyed on a stable string so it rides the existing debounced sync.
- `openRecentByIndex(i)`: opens `recentFiles[i].path` via the existing `openNativePath` (which dedupes → already-open file just activates its tab). On failure `openNativePath` already shows an "Open failed" status; additionally remove the dead entry: `setRecentFiles((list) => removeRecent(list, path))`.
- `clearRecentFiles()`: `setRecentFiles([])`.

### 3.4 Native menu — `src-tauri/src/lib.rs`

Extend the existing dynamic-menu machinery to carry recents alongside tabs (both are rebuilt into the whole menu via `set_menu`, so a single rebuild must know both):

- `build_menu(app, titles: &[String], recent: &[String])` — `recent` is the list of display names.
- Add a `File ▸ Open Recent` **submenu** (placed right after `Open…`): one item per recent file (id `openRecent{index}`, 0-based, label = the file name), then a separator and `Clear Recent` (id `clearRecent`). When `recent` is empty, show a single disabled `No Recent Files` item so the submenu is never empty/confusing.
- Rename/extend the existing `sync_tab_menu(titles)` command to `sync_menu(titles, recent)` (or add the second arg); it still rebuilds + `set_menu` on `run_on_main_thread`. Update the startup `build_menu` call and `generate_handler!`.

Index-based ids (`openRecent{i}`) mirror `goToTab{i}`: the frontend maps the index back to a path from its own `recentFiles` list, so no path strings ride through menu ids.

### 3.5 Frontend menu sync — `src/fileService.ts` + effect

- `syncMenu(titles: string[], recent: string[])` invoke wrapper (native-only), replacing/extending `syncTabMenu`.
- The existing debounced sync effect keys on `tabMenuKey` + a `recentKey` (`recentFiles.map(f => f.name).join("\n")`), and calls `syncMenu(tabTitles, recentNames)`.

### 3.6 Dispatch — `handleMenuAction`

- `id === "clearRecent"` → `clearRecentFiles()`.
- `id.startsWith("openRecent")` → `openRecentByIndex(Number(id.slice("openRecent".length)))`.
- (`goToTab` branch unchanged.) The `pendingCloseId` early-return still guards these while the unsaved-changes dialog is open.

## 4. Testing

- `src/recentFiles.test.ts`: `addRecent` (prepend, dedupe-by-path move-to-front, cap at 10), `removeRecent`, and `loadRecentFiles` returning `[]` on malformed/absent storage.
- `src/App.test.tsx`: opening a native file records it (asserts `syncMenu` called with the recent name, and localStorage updated); an `openRecent0` menu event reopens via the native open path; `clearRecent` empties the list.

## 5. Non-goals

In-window recent-files panel / empty-state, pinning/favorites, recents in browser mode, cross-device sync.

## 6. Release

Increment on the unreleased 0.4.0 branch (same PR #3); no separate version bump. Add a bullet to the existing 0.4.0 CHANGELOG "Added" section noting `File ▸ Open Recent`.
