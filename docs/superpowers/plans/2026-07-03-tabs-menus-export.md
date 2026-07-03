# Tabs, Native Menus, Export & Print — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-window document tabs, a native application menu bar, HTML/PDF export with native Print, and fix the "newly opened document scrolls to the end" bug in the HillDown Tauri Markdown editor.

**Architecture:** Extract all multi-document collection logic into a pure, unit-tested module (`src/documentSession.ts`) mirroring the existing `src/editorCommands.ts` "pure functions, thin shell" pattern; `App.tsx` derives the active document from a single `session` state so existing render code changes minimally. The native menu is built in Rust and reuses the existing `hilldown://…` event pattern: menu clicks emit `hilldown://menu` with an action id that the frontend dispatches to functions it already has. Export/print reuse the already-sanitized preview HTML and the granted dialog/fs permissions.

**Tech Stack:** Tauri v2 (Rust shell + `tauri::menu`), Vite + React 19 + TypeScript, Vitest (jsdom), `marked` + `DOMPurify`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs`.

## Global Constraints

- **Node/TS:** strict TypeScript, 2-space indent. `PascalCase` components, `camelCase` functions/hooks, `kebab-case` CSS classes.
- **Dual runtime:** every feature works both under Tauri (`canUseNativeFileSystem()` true) and in the plain-web browser fallback. Never break either path.
- **Security boundary:** all rendered HTML flows through `marked.parse()` → `DOMPurify.sanitize()`. No new path may bypass DOMPurify.
- **No permission widening:** do not edit `src-tauri/capabilities/default.json`. Menus/events are Rust-side; export reuses `dialog:allow-save` + `fs:allow-write-text-file`.
- **Event-name duplication rule:** `hilldown://menu` must be defined identically in `src-tauri/src/lib.rs` and `src/fileService.ts` (same as the existing `hilldown://open-files`).
- **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `docs:`, `style:`, `chore:`).
- **Release rule (final task only):** bump `0.3.1 → 0.4.0` in all five files (`package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`) and add a dated `CHANGELOG.md` entry, in the same commit.
- **Verification commands:** `npm test`, `npm run build` (tsc + vite), and from `src-tauri/`: `cargo check`, `cargo test`.

---

## Phase 1 — Document session model + tabs

### Task 1: Pure document-session module

**Files:**
- Create: `src/documentSession.ts`
- Test: `src/documentSession.test.ts`

**Interfaces:**
- Consumes: `TextSelection` from `./editorCommands`.
- Produces (relied on by Tasks 2–3):
  - `interface EditorDocument { id: string; markdown: string; title: string; path: string | null; lastSavedMarkdown: string; history: string[]; historyIndex: number; selection: TextSelection; }`
  - `interface EditorSession { documents: EditorDocument[]; activeId: string; }`
  - `createEmptyDocument(id: string, contents?: string): EditorDocument`
  - `documentFromFile(id: string, contents: string, title: string, path: string | null): EditorDocument`
  - `createSession(document: EditorDocument): EditorSession`
  - `getActive(session: EditorSession): EditorDocument`
  - `replaceActive(session, updater: (doc: EditorDocument) => EditorDocument): EditorSession`
  - `addDocument(session, document): EditorSession`
  - `openDocumentInSession(session, document): EditorSession`
  - `setActive(session, id: string): EditorSession`
  - `closeDocument(session, id: string, fallback: () => EditorDocument): EditorSession`
  - `pushDocumentHistory(doc: EditorDocument, next: string): EditorDocument`
  - `undoDocument(doc): EditorDocument`, `redoDocument(doc): EditorDocument`
  - `isDocumentDirty(doc): boolean`

> **Design note:** per-tab scroll position is intentionally **not** in `EditorDocument` — Task 2 keeps it in a `useRef` map to avoid a re-render on every scroll event. The model stays free of hot-path churn.

- [ ] **Step 1: Write the failing tests**

Create `src/documentSession.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addDocument,
  closeDocument,
  createEmptyDocument,
  createSession,
  documentFromFile,
  getActive,
  isDocumentDirty,
  openDocumentInSession,
  pushDocumentHistory,
  redoDocument,
  replaceActive,
  setActive,
  undoDocument,
  type EditorDocument,
} from "./documentSession";

const fresh = (id: string): EditorDocument => createEmptyDocument(id);

describe("documentSession", () => {
  it("creates an empty untitled document", () => {
    const doc = createEmptyDocument("a");
    expect(doc).toMatchObject({ id: "a", markdown: "", title: "Untitled document", path: null });
    expect(doc.history).toEqual([""]);
    expect(doc.historyIndex).toBe(0);
    expect(isDocumentDirty(doc)).toBe(false);
  });

  it("builds a document from file contents seeded as saved", () => {
    const doc = documentFromFile("b", "# Hi", "notes", "/tmp/notes.md");
    expect(doc).toMatchObject({ markdown: "# Hi", title: "notes", path: "/tmp/notes.md", lastSavedMarkdown: "# Hi" });
    expect(isDocumentDirty(doc)).toBe(false);
  });

  it("adds and activates a document", () => {
    const session = addDocument(createSession(fresh("a")), fresh("b"));
    expect(session.documents.map((d) => d.id)).toEqual(["a", "b"]);
    expect(session.activeId).toBe("b");
  });

  it("activates the existing tab when opening an already-open path (no duplicate)", () => {
    const first = documentFromFile("a", "one", "one", "/p/one.md");
    const again = documentFromFile("b", "one", "one", "/p/one.md");
    const session = openDocumentInSession(createSession(first), again);
    expect(session.documents).toHaveLength(1);
    expect(session.activeId).toBe("a");
  });

  it("adds a tab when opening a distinct path", () => {
    const first = documentFromFile("a", "one", "one", "/p/one.md");
    const other = documentFromFile("b", "two", "two", "/p/two.md");
    const session = openDocumentInSession(createSession(first), other);
    expect(session.documents.map((d) => d.id)).toEqual(["a", "b"]);
    expect(session.activeId).toBe("b");
  });

  it("closing the active middle tab activates the right neighbour", () => {
    let session = createSession(fresh("a"));
    session = addDocument(session, fresh("b"));
    session = addDocument(session, fresh("c"));
    session = setActive(session, "b");
    session = closeDocument(session, "b", () => fresh("z"));
    expect(session.documents.map((d) => d.id)).toEqual(["a", "c"]);
    expect(session.activeId).toBe("c");
  });

  it("closing the active last tab activates the left neighbour", () => {
    let session = createSession(fresh("a"));
    session = addDocument(session, fresh("b"));
    session = closeDocument(session, "b", () => fresh("z"));
    expect(session.documents.map((d) => d.id)).toEqual(["a"]);
    expect(session.activeId).toBe("a");
  });

  it("closing the only tab leaves one fresh untitled document", () => {
    const session = closeDocument(createSession(fresh("a")), "a", () => fresh("z"));
    expect(session.documents.map((d) => d.id)).toEqual(["z"]);
    expect(session.activeId).toBe("z");
    expect(getActive(session).markdown).toBe("");
  });

  it("replaceActive updates only the active document immutably", () => {
    const before = addDocument(createSession(fresh("a")), fresh("b")); // active b
    const after = replaceActive(before, (doc) => ({ ...doc, markdown: "x" }));
    expect(getActive(after).markdown).toBe("x");
    expect(after.documents[0]).toBe(before.documents[0]); // untouched by reference
    expect(after).not.toBe(before);
  });

  it("pushDocumentHistory sets markdown, appends history, and caps at 80", () => {
    let doc = createEmptyDocument("a");
    for (let i = 1; i <= 85; i += 1) doc = pushDocumentHistory(doc, `v${i}`);
    expect(doc.markdown).toBe("v85");
    expect(doc.history).toHaveLength(80);
    expect(doc.history[doc.history.length - 1]).toBe("v85");
    expect(doc.historyIndex).toBe(79);
  });

  it("pushDocumentHistory truncates redo tail before appending", () => {
    let doc = pushDocumentHistory(createEmptyDocument("a"), "one");
    doc = pushDocumentHistory(doc, "two");
    doc = undoDocument(doc); // back to "one"
    doc = pushDocumentHistory(doc, "three");
    expect(doc.history).toEqual(["", "one", "three"]);
    expect(doc.markdown).toBe("three");
  });

  it("undo/redo walk the history without falling off the ends", () => {
    let doc = pushDocumentHistory(createEmptyDocument("a"), "one");
    doc = pushDocumentHistory(doc, "two");
    doc = undoDocument(doc);
    expect(doc.markdown).toBe("one");
    doc = undoDocument(doc);
    expect(doc.markdown).toBe("");
    doc = undoDocument(doc); // clamp
    expect(doc.markdown).toBe("");
    doc = redoDocument(doc);
    expect(doc.markdown).toBe("one");
  });

  it("detects dirty state", () => {
    const doc = pushDocumentHistory(documentFromFile("a", "saved", "t", "/p"), "edited");
    expect(isDocumentDirty(doc)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/documentSession.test.ts`
Expected: FAIL — `Cannot find module './documentSession'`.

- [ ] **Step 3: Write the implementation**

Create `src/documentSession.ts`:

```ts
import type { TextSelection } from "./editorCommands";

export type DocumentId = string;

export interface EditorDocument {
  id: DocumentId;
  markdown: string;
  title: string;
  path: string | null;
  lastSavedMarkdown: string;
  history: string[];
  historyIndex: number;
  selection: TextSelection;
}

export interface EditorSession {
  documents: EditorDocument[];
  activeId: DocumentId;
}

const HISTORY_LIMIT = 80;
const UNTITLED_TITLE = "Untitled document";

export function createEmptyDocument(id: DocumentId, contents = ""): EditorDocument {
  return {
    id,
    markdown: contents,
    title: UNTITLED_TITLE,
    path: null,
    lastSavedMarkdown: contents,
    history: [contents],
    historyIndex: 0,
    selection: { start: 0, end: 0 },
  };
}

export function documentFromFile(
  id: DocumentId,
  contents: string,
  title: string,
  path: string | null,
): EditorDocument {
  return {
    id,
    markdown: contents,
    title,
    path,
    lastSavedMarkdown: contents,
    history: [contents],
    historyIndex: 0,
    selection: { start: 0, end: 0 },
  };
}

export function createSession(document: EditorDocument): EditorSession {
  return { documents: [document], activeId: document.id };
}

export function getActive(session: EditorSession): EditorDocument {
  return session.documents.find((doc) => doc.id === session.activeId) ?? session.documents[0];
}

export function replaceActive(
  session: EditorSession,
  updater: (doc: EditorDocument) => EditorDocument,
): EditorSession {
  return {
    ...session,
    documents: session.documents.map((doc) =>
      doc.id === session.activeId ? updater(doc) : doc,
    ),
  };
}

export function addDocument(session: EditorSession, document: EditorDocument): EditorSession {
  return { documents: [...session.documents, document], activeId: document.id };
}

export function openDocumentInSession(
  session: EditorSession,
  document: EditorDocument,
): EditorSession {
  if (document.path) {
    const existing = session.documents.find((doc) => doc.path === document.path);
    if (existing) {
      return { ...session, activeId: existing.id };
    }
  }
  return addDocument(session, document);
}

export function setActive(session: EditorSession, id: DocumentId): EditorSession {
  if (!session.documents.some((doc) => doc.id === id)) {
    return session;
  }
  return { ...session, activeId: id };
}

export function closeDocument(
  session: EditorSession,
  id: DocumentId,
  fallback: () => EditorDocument,
): EditorSession {
  const index = session.documents.findIndex((doc) => doc.id === id);
  if (index === -1) {
    return session;
  }

  const remaining = session.documents.filter((doc) => doc.id !== id);
  if (remaining.length === 0) {
    return createSession(fallback());
  }

  if (session.activeId !== id) {
    return { documents: remaining, activeId: session.activeId };
  }

  const neighbour = remaining[index] ?? remaining[index - 1] ?? remaining[0];
  return { documents: remaining, activeId: neighbour.id };
}

export function pushDocumentHistory(doc: EditorDocument, next: string): EditorDocument {
  const history = [...doc.history.slice(0, doc.historyIndex + 1), next].slice(-HISTORY_LIMIT);
  return { ...doc, markdown: next, history, historyIndex: history.length - 1 };
}

export function undoDocument(doc: EditorDocument): EditorDocument {
  if (doc.historyIndex <= 0) {
    return doc;
  }
  const historyIndex = doc.historyIndex - 1;
  return { ...doc, historyIndex, markdown: doc.history[historyIndex] };
}

export function redoDocument(doc: EditorDocument): EditorDocument {
  if (doc.historyIndex >= doc.history.length - 1) {
    return doc;
  }
  const historyIndex = doc.historyIndex + 1;
  return { ...doc, historyIndex, markdown: doc.history[historyIndex] };
}

export function isDocumentDirty(doc: EditorDocument): boolean {
  return doc.markdown !== doc.lastSavedMarkdown;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/documentSession.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/documentSession.ts src/documentSession.test.ts
git commit -m "feat: add pure document-session model for multi-tab editing"
```

---

### Task 2: Wire the session model into App.tsx (single active tab, no tab bar yet)

Refactor `App.tsx` to hold one `session` state and derive the active document, keeping behaviour identical to today (one visible document). This de-risks the big refactor before the tab bar lands. Includes the **scroll-to-start fix**.

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: everything from Task 1; `titleFromFileName` from `./fileService`.
- Produces: `session`, `setSession`, `activeDoc`, and helpers `updateActiveSelection`, `renameActive`, `scrollPositionsRef` used by Task 3.

- [ ] **Step 1: Replace the per-document state with a session**

In `src/App.tsx`, add to the imports from `./documentSession`:

```ts
import {
  addDocument,
  createEmptyDocument,
  createSession,
  documentFromFile,
  getActive,
  isDocumentDirty,
  openDocumentInSession,
  pushDocumentHistory,
  redoDocument,
  replaceActive,
  setActive,
  closeDocument,
  undoDocument,
  type EditorSession,
} from "./documentSession";
```

Delete these seven `useState` lines:

```ts
const [markdown, setMarkdown] = useState(sampleDocument);
const [title, setTitle] = useState(untitledTitle);
const [documentPath, setDocumentPath] = useState<string | null>(null);
const [lastSavedMarkdown, setLastSavedMarkdown] = useState(sampleDocument);
const [history, setHistory] = useState<string[]>([sampleDocument]);
const [historyIndex, setHistoryIndex] = useState(0);
const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });
```

Replace them with a session plus derived read-only locals (keeps the rest of the component referencing the same names):

```ts
const [session, setSession] = useState<EditorSession>(() =>
  createSession(documentFromFile(crypto.randomUUID(), sampleDocument, untitledTitle, null)),
);
const scrollPositionsRef = useRef<Map<string, number>>(new Map());

const activeDoc = getActive(session);
const markdown = activeDoc.markdown;
const title = activeDoc.title;
const documentPath = activeDoc.path;
const history = activeDoc.history;
const historyIndex = activeDoc.historyIndex;
const selection = activeDoc.selection;
```

Also delete the now-unused `isDirtyRef` declaration and its effect (Task 2 Step 5 removes its last reader):

```ts
const isDirtyRef = useRef(false);
// ...
useEffect(() => {
  isDirtyRef.current = isDirty;
}, [isDirty]);
```

And change the dirty flag:

```ts
const isDirty = isDocumentDirty(activeDoc);
```

- [ ] **Step 2: Rewrite the mutators to funnel through the session**

Replace `pushHistory`, `getSelection`, `syncSelection`, `focusSelection`, `commit`, `undo`, `redo`, and `onTextChange` with:

```ts
function pushHistory(next: string) {
  setSession((current) => replaceActive(current, (doc) => pushDocumentHistory(doc, next)));
}

function getSelection(): TextSelection {
  const textarea = textareaRef.current;
  return {
    start: textarea?.selectionStart ?? selection.start,
    end: textarea?.selectionEnd ?? selection.end,
  };
}

function updateActiveSelection(next: TextSelection) {
  setSession((current) => replaceActive(current, (doc) => ({ ...doc, selection: next })));
}

function syncSelection(target = textareaRef.current) {
  if (!target) {
    return;
  }
  updateActiveSelection({ start: target.selectionStart, end: target.selectionEnd });
}

function focusSelection(selectionStart: number, selectionEnd = selectionStart) {
  updateActiveSelection({ start: selectionStart, end: selectionEnd });
  window.requestAnimationFrame(() => {
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(selectionStart, selectionEnd);
  });
}

function commit(next: string, selectionStart?: number, selectionEnd = selectionStart) {
  setSession((current) => replaceActive(current, (doc) => pushDocumentHistory(doc, next)));
  if (selectionStart !== undefined) {
    focusSelection(selectionStart, selectionEnd);
  }
}

function renameActive(nextTitle: string) {
  setSession((current) => replaceActive(current, (doc) => ({ ...doc, title: nextTitle })));
}

function undo() {
  setSession((current) => replaceActive(current, undoDocument));
}

function redo() {
  setSession((current) => replaceActive(current, redoDocument));
}

function onTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
  const next = event.target.value;
  const nextSelection = { start: event.target.selectionStart, end: event.target.selectionEnd };
  setSession((current) =>
    replaceActive(current, (doc) => ({ ...pushDocumentHistory(doc, next), selection: nextSelection })),
  );
}
```

Then update the two title-input handlers in the JSX: change `onChange={(event) => setTitle(event.target.value)}` to `onChange={(event) => renameActive(event.target.value)}`.

- [ ] **Step 3: Rewrite document load / new / open / save to use the session**

Replace `loadDocument` and `resetDocument`:

```ts
function loadDocument(contents: string, name: string, path: string | null) {
  setSession((current) =>
    openDocumentInSession(
      current,
      documentFromFile(crypto.randomUUID(), contents, titleFromFileName(name), path),
    ),
  );
  setStatus({ message: `Opened ${name}`, tone: "success" });
}

function resetDocument() {
  setSession((current) => addDocument(current, createEmptyDocument(crypto.randomUUID())));
  setStatus({ message: "New document", tone: "neutral" });
}
```

Remove the discard-changes `window.confirm` guards from `openNativePath` and `openDocument` (opening now adds a tab and never destroys work):

```ts
async function openNativePath(path: string) {
  try {
    const opened = await openNativeMarkdownPath(path);
    if (!opened) {
      return;
    }
    loadDocument(opened.contents, opened.name, opened.path);
  } catch (error) {
    setStatus({
      message: `Open failed: ${error instanceof Error ? error.message : String(error)}`,
      tone: "error",
    });
  }
}

async function openDocument() {
  if (!nativeFiles) {
    fileInputRef.current?.click();
    return;
  }
  try {
    const opened = await openNativeMarkdownDocument();
    if (!opened) {
      setStatus({ message: "Open canceled", tone: "neutral" });
      return;
    }
    loadDocument(opened.contents, opened.name, opened.path);
  } catch (error) {
    setStatus({
      message: `Open failed: ${error instanceof Error ? error.message : String(error)}`,
      tone: "error",
    });
  }
}
```

Rewrite `saveDocument` to update the active document on success:

```ts
async function saveDocument(forceSaveAs = false) {
  if (!nativeFiles) {
    downloadMarkdown();
    setSession((current) => replaceActive(current, (doc) => ({ ...doc, lastSavedMarkdown: doc.markdown })));
    setStatus({ message: "Downloaded Markdown", tone: "success" });
    return;
  }

  try {
    const saved = await saveNativeMarkdownDocument(
      markdown,
      documentPath,
      ensureMarkdownExtension(title),
      forceSaveAs,
    );

    if (!saved) {
      setStatus({ message: "Save canceled", tone: "neutral" });
      return;
    }

    setSession((current) =>
      replaceActive(current, (doc) => ({
        ...doc,
        path: saved.path,
        title: titleFromFileName(saved.name),
        lastSavedMarkdown: doc.markdown,
      })),
    );
    setStatus({ message: `Saved ${saved.name}`, tone: "success" });
  } catch (error) {
    setStatus({
      message: `Save failed: ${error instanceof Error ? error.message : String(error)}`,
      tone: "error",
    });
  }
}
```

- [ ] **Step 4: Restore scroll/selection on tab change and fix scroll-to-start on open**

Add a `useLayoutEffect` keyed on the active id (place it near the other effects, after `activeDoc` is defined). This is the **scroll-to-start fix**: a freshly opened/created document has no stored scroll position, so it resets to the top; an existing tab restores where you were.

```ts
useLayoutEffect(() => {
  const textarea = textareaRef.current;
  if (!textarea) {
    return;
  }
  const remembered = scrollPositionsRef.current.get(session.activeId) ?? 0;
  textarea.scrollTop = remembered;
  textarea.scrollLeft = 0;
  textarea.setSelectionRange(activeDoc.selection.start, activeDoc.selection.end);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [session.activeId]);
```

Replace the textarea `onScroll={updateSlashMenuPosition}` handler with one that also records scroll (via the ref map — no re-render):

```ts
function onEditorScroll() {
  updateSlashMenuPosition();
  const textarea = textareaRef.current;
  if (textarea) {
    scrollPositionsRef.current.set(session.activeId, textarea.scrollTop);
  }
}
```

and in the JSX: `onScroll={onEditorScroll}`.

- [ ] **Step 5: Update the document-title effect and remove dead references**

The title effect already reads `isDirty` and `title` — both still exist as derived values, so it is unchanged. Verify no remaining references to `setMarkdown`, `setTitle`, `setSelection`, `setHistory`, `setHistoryIndex`, `setLastSavedMarkdown`, `setDocumentPath`, or `isDirtyRef` exist:

Run: `grep -nE "setMarkdown|setTitle|setSelection|setHistory|setHistoryIndex|setLastSavedMarkdown|setDocumentPath|isDirtyRef" src/App.tsx`
Expected: no output.

- [ ] **Step 6: Type-check, test, and manually verify**

Run: `npm run build`
Expected: PASS (no TypeScript errors).

Run: `npm test`
Expected: PASS (existing + Task 1 tests).

Run: `npm run tauri dev` and confirm the app still behaves as before with a single document: type, undo/redo, open a file (now the caret and scroll start at the top), save, Save As, slash menu, formatting. Nothing visibly changed except the open-scrolls-to-end bug is gone.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "refactor: drive App from a single document session (fixes open-scrolls-to-end)"
```

---

### Task 3: Tab bar UI, close/dirty confirm, and tab commands

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `session`, `setSession`, `activeDoc`, `scrollPositionsRef`, `setActive`, `closeDocument`, `isDocumentDirty`, `createEmptyDocument` from Tasks 1–2.
- Produces: `closeTab(id)`, `selectTab(id)`, `nextTab()`, `previousTab()`, `goToTab(index)` used by Phase 2's menu dispatch.

- [ ] **Step 1: Add tab command helpers to App.tsx**

Add near the other document functions:

```ts
function selectTab(id: string) {
  setSession((current) => setActive(current, id));
}

function closeTab(id: string) {
  const target = session.documents.find((doc) => doc.id === id);
  if (target && isDocumentDirty(target) && !window.confirm(`Close “${target.title}” without saving?`)) {
    return;
  }
  scrollPositionsRef.current.delete(id);
  setSession((current) => closeDocument(current, id, () => createEmptyDocument(crypto.randomUUID())));
}

function goToTab(index: number) {
  const target = session.documents[index];
  if (target) {
    selectTab(target.id);
  }
}

function shiftTab(delta: number) {
  const index = session.documents.findIndex((doc) => doc.id === session.activeId);
  const count = session.documents.length;
  const next = session.documents[(index + delta + count) % count];
  if (next) {
    selectTab(next.id);
  }
}

function nextTab() {
  shiftTab(1);
}

function previousTab() {
  shiftTab(-1);
}
```

- [ ] **Step 2: Render the tab strip**

Add `X` to the `lucide-react` import at the top (it is the close glyph):

```ts
import { /* …existing… */ Plus, X } from "lucide-react";
```

Insert the tab strip JSX **between** the closing `</header>` and the `<section className="toolbar" …>` element:

```tsx
<nav className="tab-strip" role="tablist" aria-label="Open documents">
  {session.documents.map((doc) => {
    const dirty = isDocumentDirty(doc);
    const active = doc.id === session.activeId;
    return (
      <div
        key={doc.id}
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        className={`tab ${active ? "active" : ""}`}
        title={doc.path ?? doc.title}
        onClick={() => selectTab(doc.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectTab(doc.id);
          }
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            closeTab(doc.id);
          }
        }}
      >
        <span className="tab-title">{doc.title || "Untitled document"}</span>
        {dirty && <span className="tab-dirty" aria-label="Unsaved changes">●</span>}
        <button
          type="button"
          className="tab-close"
          aria-label={`Close ${doc.title}`}
          onClick={(event) => {
            event.stopPropagation();
            closeTab(doc.id);
          }}
        >
          <X size={13} />
        </button>
      </div>
    );
  })}
  <button type="button" className="tab-new" aria-label="New tab" title="New tab" onClick={resetDocument}>
    <Plus size={15} />
  </button>
</nav>
```

- [ ] **Step 3: Add tab-strip styles**

In `src/styles.css`, change the shell grid to add a row for the tab strip. Replace:

```css
.app-shell {
  position: relative;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
```

with:

```css
.app-shell {
  position: relative;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
```

Then add, after the Topbar section (before `/* ---- Buttons & controls ---- */`):

```css
/* ---- Tab strip --------------------------------------------------------- */

.tab-strip {
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 6px 10px 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--hairline);
  background: var(--app-bg);
  scrollbar-width: thin;
  scrollbar-color: var(--hairline-2) transparent;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  max-width: 220px;
  padding: 7px 8px 7px 13px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  color: var(--ink-3);
  cursor: pointer;
  transition: background-color 130ms ease, color 130ms ease;
}

.tab:hover {
  background: var(--inset);
  color: var(--ink-2);
}

.tab.active {
  background: var(--page);
  border-color: var(--hairline);
  color: var(--ink);
}

.tab-title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tab-dirty {
  flex: 0 0 auto;
  color: var(--warn);
  font-size: 10px;
  line-height: 1;
}

.tab-close {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  opacity: 0;
  transition: background-color 120ms ease, opacity 120ms ease;
}

.tab:hover .tab-close,
.tab.active .tab-close,
.tab-close:focus-visible {
  opacity: 1;
}

.tab-close:hover {
  background: var(--hairline-2);
  color: var(--ink);
}

.tab-new {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 30px;
  margin: 2px 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  transition: background-color 130ms ease, color 130ms ease;
}

.tab-new:hover {
  background: var(--inset);
  color: var(--ink);
}
```

- [ ] **Step 4: Type-check, test, and manually verify**

Run: `npm run build`
Expected: PASS.

Run: `npm run tauri dev` and verify:
- Opening two different files shows two tabs; the current document is not replaced.
- Opening the same file twice activates the existing tab (no duplicate).
- Clicking tabs switches documents; each remembers its scroll and caret; a freshly opened doc starts at the top.
- The `●` dirty dot appears when a tab has unsaved edits.
- `×` (and middle-click) closes a tab; closing a dirty tab prompts first; closing the last tab leaves one empty untitled tab.
- `+` opens a new empty tab.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/styles.css
git commit -m "feat: add document tabs with dirty indicator and close confirmation"
```

---

## Phase 2 — Native application menu

### Task 4: Build the native menu in Rust and emit menu events

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: a native menu whose custom items emit the `hilldown://menu` event with a string id. Ids consumed by Task 5: `new`, `open`, `save`, `saveAs`, `exportHtml`, `exportPdf`, `print`, `closeTab`, `undo`, `redo`, `copyMarkdown`, `copyHtml`, `bold`, `italic`, `link`, `heading1`, `heading2`, `unordered`, `ordered`, `task`, `quote`, `code`, `table`, `divider`, `viewEdit`, `viewSplit`, `viewPreview`, `nextTab`, `prevTab`, `goToTab1`…`goToTab9`.

- [ ] **Step 1: Add the event constant and menu imports**

At the top of `src-tauri/src/lib.rs`, below the existing `OPENED_FILES_EVENT`:

```rust
const MENU_EVENT: &str = "hilldown://menu";
```

Extend the `tauri` import to bring in the menu builders:

```rust
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};
```

- [ ] **Step 2: Add the `build_menu` function**

Add this function (above `run()`). The macOS-only first submenu becomes the application menu; predefined items give native Cut/Copy/Paste/Undo-target/Quit/Minimize/Fullscreen behaviour, while custom items carry stable ids.

```rust
fn build_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    let file = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("new", "New").accelerator("CmdOrCtrl+N").build(app)?)
        .item(&MenuItemBuilder::with_id("open", "Open…").accelerator("CmdOrCtrl+O").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("save", "Save").accelerator("CmdOrCtrl+S").build(app)?)
        .item(&MenuItemBuilder::with_id("saveAs", "Save As…").accelerator("CmdOrCtrl+Shift+S").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("exportHtml", "Export as HTML…").build(app)?)
        .item(&MenuItemBuilder::with_id("exportPdf", "Export as PDF…").build(app)?)
        .item(&MenuItemBuilder::with_id("print", "Print…").accelerator("CmdOrCtrl+P").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("closeTab", "Close Tab").accelerator("CmdOrCtrl+W").build(app)?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&MenuItemBuilder::with_id("undo", "Undo").accelerator("CmdOrCtrl+Z").build(app)?)
        .item(&MenuItemBuilder::with_id("redo", "Redo").accelerator("CmdOrCtrl+Shift+Z").build(app)?)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&MenuItemBuilder::with_id("copyMarkdown", "Copy as Markdown").build(app)?)
        .item(&MenuItemBuilder::with_id("copyHtml", "Copy as HTML").build(app)?)
        .build()?;

    let format = SubmenuBuilder::new(app, "Format")
        .item(&MenuItemBuilder::with_id("bold", "Bold").accelerator("CmdOrCtrl+B").build(app)?)
        .item(&MenuItemBuilder::with_id("italic", "Italic").accelerator("CmdOrCtrl+I").build(app)?)
        .item(&MenuItemBuilder::with_id("link", "Link").accelerator("CmdOrCtrl+K").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("heading1", "Heading 1").build(app)?)
        .item(&MenuItemBuilder::with_id("heading2", "Heading 2").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("unordered", "Bulleted List").build(app)?)
        .item(&MenuItemBuilder::with_id("ordered", "Numbered List").build(app)?)
        .item(&MenuItemBuilder::with_id("task", "Task List").build(app)?)
        .item(&MenuItemBuilder::with_id("quote", "Quote").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("code", "Code Block").build(app)?)
        .item(&MenuItemBuilder::with_id("table", "Table").build(app)?)
        .item(&MenuItemBuilder::with_id("divider", "Divider").build(app)?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("viewEdit", "Editor Only").accelerator("CmdOrCtrl+Alt+1").build(app)?)
        .item(&MenuItemBuilder::with_id("viewSplit", "Split").accelerator("CmdOrCtrl+Alt+2").build(app)?)
        .item(&MenuItemBuilder::with_id("viewPreview", "Preview").accelerator("CmdOrCtrl+Alt+3").build(app)?)
        .separator()
        .fullscreen()
        .build()?;

    let mut window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .separator()
        .item(&MenuItemBuilder::with_id("nextTab", "Next Tab").accelerator("CmdOrCtrl+Alt+Right").build(app)?)
        .item(&MenuItemBuilder::with_id("prevTab", "Previous Tab").accelerator("CmdOrCtrl+Alt+Left").build(app)?)
        .separator();
    for n in 1..=9 {
        window = window.item(
            &MenuItemBuilder::with_id(format!("goToTab{n}"), format!("Go to Tab {n}"))
                .accelerator(format!("CmdOrCtrl+{n}"))
                .build(app)?,
        );
    }
    let window = window.build()?;

    let mut menu = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "HillDown")
            .about(None)
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        menu = menu.item(&app_menu);
    }

    menu = menu.item(&file).item(&edit).item(&format).item(&view).item(&window);

    #[cfg(not(target_os = "macos"))]
    {
        let help = SubmenuBuilder::new(app, "Help").about(None).build()?;
        menu = menu.item(&help);
    }

    menu.build()
}
```

- [ ] **Step 3: Register the menu and the menu-event handler**

In `run()`, add `.on_menu_event(...)` to the `tauri::Builder` chain (before `.build(...)`), and set the menu inside `.setup(...)`.

Add the handler to the builder chain, right after the `.invoke_handler(...)` call:

```rust
.on_menu_event(|app, event| {
    let id = event.id().0.clone();
    if let Err(error) = app.emit(MENU_EVENT, id) {
        eprintln!("failed to emit menu event: {error}");
    }
})
```

Inside the existing `.setup(|app| { … })` closure, before `Ok(())`, add:

```rust
let menu = build_menu(app.handle())?;
app.set_menu(menu)?;
```

- [ ] **Step 4: Verify the crate compiles and existing tests pass**

Run from `src-tauri/`: `cargo check`
Expected: compiles with no errors. (If the toolchain reports a missing menu feature, add `features = ["macos-private-api"]`? — no: menus are core. Fix any actual name mismatch reported, e.g. a predefined helper, against the compiler message.)

Run from `src-tauri/`: `cargo test`
Expected: existing two tests still PASS.

- [ ] **Step 5: Manually verify the menu renders**

Run: `npm run tauri dev`. Confirm the native menu bar shows HillDown/File/Edit/Format/View/Window (macOS). Items are clickable (they do nothing yet — wired in Task 5) and predefined Cut/Copy/Paste/Undo-target/Minimize/Quit behave natively.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add native application menu that emits hilldown://menu events"
```

---

### Task 5: Dispatch menu events in the frontend and de-duplicate shortcuts

**Files:**
- Modify: `src/fileService.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `MENU_EVENT` id contract from Task 4; all App action functions from Tasks 2–3.
- Produces: `menuEvent` constant; a `handleMenuAction(id)` dispatcher.

- [ ] **Step 1: Export the menu event name from fileService**

In `src/fileService.ts`, below `export const openedFilesEvent = "hilldown://open-files";` add:

```ts
export const menuEvent = "hilldown://menu";
```

- [ ] **Step 2: Add the dispatcher and a stable listener in App.tsx**

Import the constant:

```ts
import {
  canUseNativeFileSystem,
  ensureMarkdownExtension,
  menuEvent,
  openedFilesEvent,
  // …existing…
} from "./fileService";
```

Add the dispatcher inside the component (after the action functions it references, e.g. below `saveDocument`). `format:`/tool ids map straight onto the existing `ToolAction` union:

```ts
function handleMenuAction(id: string) {
  switch (id) {
    case "new": return resetDocument();
    case "open": return void openDocument();
    case "save": return void saveDocument(false);
    case "saveAs": return void saveDocument(true);
    case "closeTab": return closeTab(session.activeId);
    case "exportHtml": return void exportHtml();
    case "exportPdf":
    case "print": return printDocument();
    case "undo": return undo();
    case "redo": return redo();
    case "copyMarkdown": return void copyMarkdown();
    case "copyHtml": return void copyHtml();
    case "viewEdit": return setMode("edit");
    case "viewSplit": return setMode("split");
    case "viewPreview": return setMode("preview");
    case "nextTab": return nextTab();
    case "prevTab": return previousTab();
    case "bold":
    case "italic":
    case "heading1":
    case "heading2":
    case "quote":
    case "unordered":
    case "ordered":
    case "task":
    case "code":
    case "link":
    case "table":
    case "divider":
      return runTool(id as ToolAction);
    default:
      if (id.startsWith("goToTab")) {
        const index = Number(id.slice("goToTab".length)) - 1;
        if (Number.isInteger(index)) {
          goToTab(index);
        }
      }
  }
}
```

> Note: the Format menu omits `image`, so `image` is intentionally not in the dispatch list, but it is a valid `ToolAction`; leaving it out is correct — the cast only ever receives the ids listed above.

Keep the dispatcher fresh via a ref, and subscribe once. Add near the other refs:

```ts
const menuHandlerRef = useRef(handleMenuAction);
menuHandlerRef.current = handleMenuAction;
```

Add the listener effect (alongside the open-files effect):

```ts
useEffect(() => {
  if (!nativeFiles) {
    return;
  }
  let disposed = false;
  let unlisten: (() => void) | undefined;

  listen<string>(menuEvent, (event) => {
    menuHandlerRef.current(event.payload);
  })
    .then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
    })
    .catch(() => {
      /* menu is a native nicety; ignore listen failures */
    });

  return () => {
    disposed = true;
    unlisten?.();
  };
}, [nativeFiles]);
```

- [ ] **Step 3: Gate duplicate keyboard shortcuts behind browser mode**

In `onEditorKeyDown`, the global shortcuts for Save/Open/New/Bold/Italic/Link are now owned by the native menu accelerators. Wrap that block so it only runs in the browser fallback (native menu owns them under Tauri, preventing double-fire). Change the start of the shortcut section: the five `if (isMod && …)` blocks for `s`, `o`, `n`, `b`, `i`, `k` should execute only when `!nativeFiles`. Wrap them:

```ts
function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  const isMod = event.metaKey || event.ctrlKey;

  if (!nativeFiles && isMod) {
    const key = event.key.toLowerCase();
    if (key === "s") { event.preventDefault(); void saveDocument(event.shiftKey); return; }
    if (key === "o") { event.preventDefault(); void openDocument(); return; }
    if (key === "n") { event.preventDefault(); resetDocument(); return; }
    if (key === "b") { event.preventDefault(); runTool("bold"); return; }
    if (key === "i") { event.preventDefault(); runTool("italic"); return; }
    if (key === "k") { event.preventDefault(); runTool("link"); return; }
  }

  // …unchanged: slash-menu ArrowDown/ArrowUp/Enter/Tab handling and Tab indent…
}
```

Leave the slash-menu navigation and the `Tab`/`Shift+Tab` indent handling exactly as they are (they must work in both runtimes).

- [ ] **Step 4: Type-check and manually verify no double-fire**

Run: `npm run build`
Expected: PASS. (This will error until Task 6 adds `exportHtml`/`printDocument`; if executing strictly in order, temporarily stub `function exportHtml() {}` and `function printDocument() {}` and remove the stubs in Task 6. Prefer executing Task 6 before this build, or add the stubs now.)

Run: `npm run tauri dev` and verify: every File/Edit/Format/View/Window menu item performs its action; accelerators (⌘S, ⌘O, ⌘N, ⌘B/I/K, ⌘W, ⌘1…9) work and fire exactly once; Undo/Redo drive HillDown's own history (not the webview's).

- [ ] **Step 5: Commit**

```bash
git add src/fileService.ts src/App.tsx
git commit -m "feat: dispatch native menu events and let menu own global shortcuts"
```

---

## Phase 3 — Export & Print

### Task 6: HTML builder, export/print wiring, and print stylesheet

**Files:**
- Create: `src/htmlExport.ts`
- Test: `src/htmlExport.test.ts`
- Modify: `src/fileService.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `renderedHtml` (already DOMPurify-sanitized) and `title` from App; `save`/`writeTextFile` via fileService.
- Produces: `buildStandaloneHtml(title, bodyHtml): string`, `escapeHtml(value): string`; `exportHtmlDocument(html, suggestedName): Promise<SavedDocument | null>`, `ensureHtmlExtension(name): string`; App functions `exportHtml()` and `printDocument()`.

- [ ] **Step 1: Write the failing tests for the HTML builder**

Create `src/htmlExport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildStandaloneHtml, escapeHtml } from "./htmlExport";

describe("htmlExport", () => {
  it("escapes markup-significant characters in text", () => {
    expect(escapeHtml(`a & b < c > "d"`)).toBe("a &amp; b &lt; c &gt; &quot;d&quot;");
  });

  it("wraps sanitized body html in a self-contained document", () => {
    const html = buildStandaloneHtml("My <Notes>", "<h1>Notes</h1><p>Hi</p>");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>My &lt;Notes&gt;</title>");
    expect(html).toContain('<article class="markdown-preview">');
    expect(html).toContain("<h1>Notes</h1><p>Hi</p>"); // body is NOT re-escaped
    expect(html).toContain("<style>"); // reading theme inlined
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/htmlExport.test.ts`
Expected: FAIL — `Cannot find module './htmlExport'`.

- [ ] **Step 3: Implement the HTML builder**

Create `src/htmlExport.ts`. The inlined stylesheet mirrors the preview's reading styles with a portable font stack (no bundled fonts):

```ts
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const exportStyles = `
  :root { color-scheme: light; }
  body {
    margin: 0;
    background: #fcfaf5;
    color: #221e16;
    font-family: Newsreader, Georgia, "Times New Roman", serif;
  }
  .markdown-preview {
    max-width: 42rem;
    margin: 0 auto;
    padding: 3rem 1.5rem 4rem;
    font-size: 1.125rem;
    line-height: 1.72;
    text-wrap: pretty;
  }
  .markdown-preview > :first-child { margin-top: 0; }
  .markdown-preview h1, .markdown-preview h2, .markdown-preview h3, .markdown-preview h4 {
    margin: 1.5em 0 0.5em; line-height: 1.18; font-weight: 600;
  }
  .markdown-preview h1 { font-size: 2.1rem; }
  .markdown-preview h2 { font-size: 1.5rem; }
  .markdown-preview p, .markdown-preview ul, .markdown-preview ol,
  .markdown-preview blockquote, .markdown-preview table, .markdown-preview pre { margin: 0 0 1.15em; }
  .markdown-preview a { color: #1e6e6a; }
  .markdown-preview blockquote {
    padding: 0.1em 0 0.1em 1.1em; border-left: 2px solid rgba(30,110,106,0.32);
    color: #524a3c; font-style: italic;
  }
  .markdown-preview code {
    padding: 0.08em 0.38em; border: 1px solid #e6dfd0; border-radius: 5px;
    background: #f3efe5; font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.84em;
  }
  .markdown-preview pre {
    overflow: auto; padding: 15px 18px; border: 1px solid #e6dfd0; border-radius: 10px; background: #f3efe5;
  }
  .markdown-preview pre code { padding: 0; border: 0; background: transparent; }
  .markdown-preview table { width: 100%; border-collapse: collapse; font-family: system-ui, sans-serif; font-size: 0.92rem; }
  .markdown-preview th, .markdown-preview td { padding: 9px 14px; border: 1px solid #e6dfd0; text-align: left; }
  .markdown-preview th { background: #f3efe5; }
  .markdown-preview hr { margin: 2.2em auto; border: 0; height: 1px; background: #d8cfbc; }
  .markdown-preview img { max-width: 100%; }
`;

export function buildStandaloneHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${exportStyles}</style>
</head>
<body>
<article class="markdown-preview">
${bodyHtml}
</article>
</body>
</html>
`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/htmlExport.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the HTML export save helper to fileService**

In `src/fileService.ts`, add an HTML filter constant near `markdownFilters`:

```ts
const htmlFilters = [
  {
    name: "HTML",
    extensions: ["html", "htm"],
  },
];
```

Add the extension helper near `ensureMarkdownExtension`:

```ts
export function ensureHtmlExtension(name: string): string {
  const trimmed = name.trim() || "Untitled";
  return /\.html?$/i.test(trimmed) ? trimmed : `${trimmed}.html`;
}
```

Add the save helper (native only; browser handled in App):

```ts
export async function exportHtmlDocument(
  html: string,
  suggestedName: string,
): Promise<SavedDocument | null> {
  if (!canUseNativeFileSystem()) {
    return null;
  }

  const targetPath = await save({
    title: "Export as HTML",
    defaultPath: ensureHtmlExtension(suggestedName),
    filters: htmlFilters,
    canCreateDirectories: true,
  });

  if (!targetPath) {
    return null;
  }

  await writeTextFile(targetPath, html);

  return {
    name: basenameFromPath(targetPath),
    path: targetPath,
  };
}
```

- [ ] **Step 6: Wire `exportHtml` and `printDocument` into App.tsx**

Add imports:

```ts
import { buildStandaloneHtml } from "./htmlExport";
import {
  // …existing…
  ensureHtmlExtension,
  exportHtmlDocument,
} from "./fileService";
```

Add the two functions (near `downloadMarkdown`). `printDocument` sets the document title so the print panel's default PDF filename is sensible, then invokes the **native OS print panel**:

```ts
async function exportHtml() {
  const html = buildStandaloneHtml(title, renderedHtml);
  const suggested = ensureHtmlExtension(title === untitledTitle ? "hilldown" : title);

  if (!nativeFiles) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = suggested;
    link.click();
    URL.revokeObjectURL(url);
    setStatus({ message: "Exported HTML", tone: "success" });
    return;
  }

  try {
    const saved = await exportHtmlDocument(html, suggested);
    if (!saved) {
      setStatus({ message: "Export canceled", tone: "neutral" });
      return;
    }
    setStatus({ message: `Exported ${saved.name}`, tone: "success" });
  } catch (error) {
    setStatus({
      message: `Export failed: ${error instanceof Error ? error.message : String(error)}`,
      tone: "error",
    });
  }
}

function printDocument() {
  const previous = document.title;
  document.title = title === untitledTitle ? appName : title;
  window.print();
  window.requestAnimationFrame(() => {
    document.title = previous;
  });
}
```

If Task 5 was executed first with stubs, delete the `function exportHtml() {}` / `function printDocument() {}` stubs now.

- [ ] **Step 7: Add the hidden print container and print stylesheet**

In the JSX, add a hidden print-only article as the **last child inside** `<main className={...}>` (so it holds the active document's rendered HTML regardless of view mode):

```tsx
<article
  className="markdown-preview print-only"
  aria-hidden="true"
  dangerouslySetInnerHTML={{ __html: renderedHtml }}
/>
```

In `src/styles.css`, add a print block at the end of the file (before or after the reduced-motion block):

```css
/* ---- Print / PDF ------------------------------------------------------- */

.print-only {
  display: none;
}

@media print {
  .topbar,
  .tab-strip,
  .toolbar,
  .editor-pane,
  .preview-pane,
  .statusbar,
  .slash-menu {
    display: none !important;
  }

  .app-shell {
    display: block;
    background: #fff;
  }

  .app-shell::after {
    display: none;
  }

  .workspace {
    display: block;
    background: #fff;
  }

  .print-only {
    display: block;
    max-width: 100%;
    margin: 0;
    padding: 0;
    color: #000;
  }
}
```

- [ ] **Step 8: Type-check, test, and manually verify**

Run: `npm run build`
Expected: PASS.

Run: `npm test`
Expected: PASS (all suites).

Run: `npm run tauri dev` and verify:
- `File ▸ Export as HTML…` writes a standalone `.html` that opens and renders correctly in a browser.
- `File ▸ Print…` (⌘P) and `File ▸ Export as PDF…` raise the **native OS print panel**; "Save as PDF" produces a clean document with no app chrome; printing works from Editor-only mode too.

> **Verification gate — the one real risk.** If `window.print()` does **not** raise the native panel in the macOS WKWebView build, stop and apply the contingency from the spec (§8.2): add a Rust command `print_active_window` that runs `-[WKWebView printOperationWithPrintInfo:]` via `objc2`/`objc2-app-kit`, expose it through `invoke`, and change `printDocument()` to call it under `nativeFiles`. Re-run this verification before committing.

- [ ] **Step 9: Commit**

```bash
git add src/htmlExport.ts src/htmlExport.test.ts src/fileService.ts src/App.tsx src/styles.css
git commit -m "feat: add HTML export and native Print/PDF"
```

---

## Phase 4 — Release

### Task 7: Version bump to 0.4.0 and changelog

**Files:**
- Modify: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `CHANGELOG.md`

**Interfaces:** none (release chore).

- [ ] **Step 1: Bump the version in all five files**

- `package.json`: `"version": "0.3.1"` → `"0.4.0"`.
- `package-lock.json`: both the top-level `"version"` and the root package entry `packages[""]. version` → `"0.4.0"`.
- `src-tauri/Cargo.toml`: `version = "0.3.1"` → `"0.4.0"`.
- `src-tauri/Cargo.lock`: the `[[package]] name = "hilldown"` entry's `version = "0.3.1"` → `"0.4.0"`.
- `src-tauri/tauri.conf.json`: `"version": "0.3.1"` → `"0.4.0"`.

Verify none remain:

Run: `grep -RnE "0\.3\.1" package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json`
Expected: no output.

- [ ] **Step 2: Add the changelog entry**

Insert at the top of `CHANGELOG.md` (below the intro lines, above `## 0.3.1`):

```markdown
## 0.4.0 - 2026-07-03

### Added

- Open multiple documents at once in in-window tabs, with a per-tab unsaved indicator, close-on-middle-click, and a close confirmation for tabs with unsaved changes. Opening a file that is already open activates its tab instead of duplicating it, and opening a file no longer replaces the current document.
- A native application menu bar (File, Edit, Format, View, Window) with standard accelerators for New, Open, Save, Save As, Print, Close Tab, formatting commands, view modes, and tab navigation. Undo/Redo drive HillDown's own history.
- Export the current document as a self-contained styled HTML file.
- Native Print (⌘/Ctrl+P) via the operating system print panel, including "Save as PDF" as the PDF output.

### Fixed

- A newly opened document now starts scrolled to the top instead of jumping to the end; each tab remembers its own scroll position.

### Changed

- Bump app version from `0.3.1` to `0.4.0`.
```

- [ ] **Step 3: Full verification**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

Run from `src-tauri/`: `cargo check && cargo test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: release 0.4.0 (tabs, native menus, export, print)"
```

---

## Self-Review (author checklist — completed)

**1. Spec coverage:**
- Scroll fix → Task 2 Step 4. ✓
- Tabs / document model → Task 1 (pure) + Task 2 (wire) + Task 3 (UI). ✓
- Dedupe-on-open, non-destructive open, close/dirty-confirm, last-tab-fresh → Task 1 tests + Task 2 Step 3 + Task 3 Step 1. ✓
- Native menus, event pattern, predefined vs custom, Undo/Redo custom → Task 4. ✓
- Frontend dispatch, ref-to-latest listener, shortcut de-dup → Task 5. ✓
- HTML export (sanitized body, escaped title, portable styles) → Task 6 Steps 1–6. ✓
- Native Print + PDF via panel, hidden print container, print CSS, objc2 contingency → Task 6 Steps 6–8. ✓
- No permission widening (capabilities untouched) → confirmed; no task edits `capabilities/default.json`. ✓
- Release 0.4.0 across five files + CHANGELOG → Task 7. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". The one conditional path (objc2 print fallback) is written as a concrete, bounded contingency gated on a manual verification result, not a placeholder. ✓

**3. Type consistency:** `EditorDocument`/`EditorSession` shapes and every helper signature match between Task 1's definitions, its tests, and their consumers in Tasks 2–3. Menu ids emitted in Task 4 exactly match the `switch` cases in Task 5. `buildStandaloneHtml`/`escapeHtml`/`exportHtmlDocument`/`ensureHtmlExtension` names match between Task 6's definition, tests, and App wiring. ✓

**Note on ordering:** Task 5 Step 4 and Task 6 both compile `App.tsx`; if executing strictly sequentially, either execute Task 6 before Task 5's final `npm run build`, or add the two one-line stubs noted in Task 5 Step 4 and remove them in Task 6 Step 6.
