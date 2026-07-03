# Open Recent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `File ▸ Open Recent` menu (desktop only) that reopens recently opened/saved Markdown files, persisted in `localStorage`.

**Architecture:** A pure, unit-tested recent-files list module (`src/recentFiles.ts`) plus localStorage persistence; the list is frontend-owned and rides the existing native-menu-sync channel (extend `build_menu` + the sync command to carry recents alongside tabs). Recorded on native open/save; opened via the existing `openNativePath`.

**Tech Stack:** Tauri v2 (2.11.2) Rust menu API, Vite + React 19 + TypeScript, Vitest (jsdom).

## Global Constraints

- Strict TypeScript, 2-space indent; `camelCase` functions, `PascalCase` types.
- **Desktop only:** all recent behavior is gated on `canUseNativeFileSystem()`; the browser fallback shows no recents and must keep working.
- **Zero new dependencies** (no Cargo or npm additions); no `capabilities/default.json` change.
- Persistence key: `localStorage["hilldown.recent"]`; cap **10**; most-recent-first; dedupe by `path`.
- Native menu rebuilds run on the UI main thread via `app.run_on_main_thread(...)` (Tauri commands run off-main).
- The frontend menu-sync effect depends on STABLE joined-string keys, never on `session.documents`/`recentFiles` array identity.
- Menu-item id conventions: `openRecent{index}` is **0-based** (mirrors the 0-based array); `goToTab{n}` stays **1-based** (unchanged).
- Conventional Commits. This is an increment on the unreleased 0.4.0 branch `feat/tabs-menus-export` (open PR #3) — no version bump.

---

## Task 1: Pure recent-files module + persistence

**Files:**
- Create: `src/recentFiles.ts`
- Test: `src/recentFiles.test.ts`

**Interfaces:**
- Produces (relied on by Task 2):
  - `interface RecentFile { path: string; name: string }`
  - `const MAX_RECENT = 10`
  - `addRecent(list: RecentFile[], entry: RecentFile, cap?: number): RecentFile[]`
  - `removeRecent(list: RecentFile[], path: string): RecentFile[]`
  - `loadRecentFiles(): RecentFile[]`
  - `saveRecentFiles(list: RecentFile[]): void`

- [ ] **Step 1: Write the failing tests**

Create `src/recentFiles.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  addRecent,
  loadRecentFiles,
  MAX_RECENT,
  removeRecent,
  saveRecentFiles,
  type RecentFile,
} from "./recentFiles";

const f = (path: string): RecentFile => ({ path, name: path });

describe("recentFiles", () => {
  beforeEach(() => window.localStorage.clear());

  it("prepends a new entry", () => {
    expect(addRecent([f("/a")], f("/b"))).toEqual([f("/b"), f("/a")]);
  });

  it("moves an existing path to the front, deduped by path", () => {
    const list = [f("/a"), f("/b"), f("/c")];
    expect(addRecent(list, { path: "/b", name: "renamed" })).toEqual([
      { path: "/b", name: "renamed" },
      f("/a"),
      f("/c"),
    ]);
  });

  it("caps the list at MAX_RECENT, most-recent-first", () => {
    let list: RecentFile[] = [];
    for (let i = 0; i < MAX_RECENT + 5; i += 1) {
      list = addRecent(list, f(`/f${i}`));
    }
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toEqual(f(`/f${MAX_RECENT + 4}`));
  });

  it("removes an entry by path", () => {
    expect(removeRecent([f("/a"), f("/b")], "/a")).toEqual([f("/b")]);
  });

  it("round-trips through localStorage", () => {
    saveRecentFiles([f("/a"), f("/b")]);
    expect(loadRecentFiles()).toEqual([f("/a"), f("/b")]);
  });

  it("returns [] for absent, malformed, or wrongly-shaped storage", () => {
    expect(loadRecentFiles()).toEqual([]);
    window.localStorage.setItem("hilldown.recent", "{ not json");
    expect(loadRecentFiles()).toEqual([]);
    window.localStorage.setItem(
      "hilldown.recent",
      JSON.stringify([{ path: 1 }, "x", { path: "/ok", name: "ok" }]),
    );
    expect(loadRecentFiles()).toEqual([{ path: "/ok", name: "ok" }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/recentFiles.test.ts`
Expected: FAIL — `Cannot find module './recentFiles'`.

- [ ] **Step 3: Write the implementation**

Create `src/recentFiles.ts`:

```ts
export interface RecentFile {
  path: string;
  name: string;
}

export const MAX_RECENT = 10;
const STORAGE_KEY = "hilldown.recent";

export function addRecent(list: RecentFile[], entry: RecentFile, cap = MAX_RECENT): RecentFile[] {
  const withoutDuplicate = list.filter((item) => item.path !== entry.path);
  return [entry, ...withoutDuplicate].slice(0, cap);
}

export function removeRecent(list: RecentFile[], path: string): RecentFile[] {
  return list.filter((item) => item.path !== path);
}

export function loadRecentFiles(): RecentFile[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is RecentFile =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as RecentFile).path === "string" &&
        typeof (item as RecentFile).name === "string",
    );
  } catch {
    return [];
  }
}

export function saveRecentFiles(list: RecentFile[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota / serialization errors — recents are a nicety */
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/recentFiles.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/recentFiles.ts src/recentFiles.test.ts
git commit -m "feat: add pure recent-files list + localStorage persistence"
```

---

## Task 2: Wire recents into the native menu (Rust + frontend, one coupled interface change)

The Rust command signature and the frontend invoke must change together (the command gains a `recent` argument), so they are one task.

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/fileService.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `RecentFile`, `addRecent`, `removeRecent`, `loadRecentFiles`, `saveRecentFiles` from Task 1.
- Produces: menu ids `openRecent{index}` (0-based), `clearRecent`, `noRecent` (disabled placeholder); frontend `syncMenu(titles, recent)`.

### Rust — `src-tauri/src/lib.rs`

- [ ] **Step 1: `build_menu` takes the recent names and adds an Open Recent submenu**

Change the signature (currently `fn build_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>, titles: &[String]) -> tauri::Result<tauri::menu::Menu<R>>`) to:

```rust
fn build_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    titles: &[String],
    recent: &[String],
) -> tauri::Result<tauri::menu::Menu<R>> {
```

Immediately inside the function, BEFORE the `let mut file = SubmenuBuilder::new(app, "File")` block, build the Open Recent submenu:

```rust
    let mut recent_menu = SubmenuBuilder::new(app, "Open Recent");
    if recent.is_empty() {
        recent_menu = recent_menu.item(
            &MenuItemBuilder::with_id("noRecent", "No Recent Files")
                .enabled(false)
                .build(app)?,
        );
    } else {
        for (index, name) in recent.iter().enumerate() {
            let label = if name.trim().is_empty() {
                "Untitled document"
            } else {
                name.as_str()
            };
            recent_menu = recent_menu
                .item(&MenuItemBuilder::with_id(format!("openRecent{index}"), label).build(app)?);
        }
        recent_menu = recent_menu
            .separator()
            .item(&MenuItemBuilder::with_id("clearRecent", "Clear Recent").build(app)?);
    }
    let recent_menu = recent_menu.build()?;
```

Then, in the existing `File` submenu chain, add the Open Recent submenu right after the `open` item — insert `.item(&recent_menu)` between the `open` line and the `.separator()`:

```rust
        .item(&MenuItemBuilder::with_id("open", "Open…").accelerator("CmdOrCtrl+O").build(app)?)
        .item(&recent_menu)
        .separator()
```

(If `MenuItemBuilder::enabled(false)` or nesting a submenu via `.item(&recent_menu)` does not compile against tauri 2.11.2, fix to the correct API from the compiler error — the menu structure/ids must stay as specified — and note it in your report.)

- [ ] **Step 2: Rename/extend the sync command to carry recents**

Rename `sync_tab_menu` to `sync_menu` and add the `recent` argument:

```rust
#[tauri::command]
fn sync_menu(app: tauri::AppHandle, titles: Vec<String>, recent: Vec<String>) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        match build_menu(&handle, &titles, &recent) {
            Ok(menu) => {
                if let Err(error) = handle.set_menu(menu) {
                    eprintln!("failed to set menu: {error}");
                }
            }
            Err(error) => eprintln!("failed to rebuild menu: {error}"),
        }
    })
    .map_err(|error| error.to_string())
}
```

- [ ] **Step 3: Update the handler registration and the startup call**

In `generate_handler!`, replace `sync_tab_menu` with `sync_menu`:

```rust
        .invoke_handler(tauri::generate_handler![
            read_markdown_document,
            take_pending_opened_file_paths,
            print_document,
            sync_menu
        ])
```

In `.setup(...)`, update the initial `build_menu` call to pass an empty recent list:

```rust
            let menu = build_menu(app.handle(), &["Untitled document".to_string()], &[])?;
            app.set_menu(menu)?;
```

- [ ] **Step 4: Verify the crate compiles**

Run from `src-tauri/`: `cargo check`
Expected: clean. Then `cargo test` → existing 2 tests pass.

### Frontend — `src/fileService.ts`

- [ ] **Step 5: Rename `syncTabMenu` → `syncMenu` with the recent arg**

Replace the existing `syncTabMenu` export with:

```ts
export async function syncMenu(titles: string[], recent: string[]): Promise<void> {
  if (!canUseNativeFileSystem()) {
    return; // browser fallback has no native menu
  }
  await invoke("sync_menu", { titles, recent });
}
```

### Frontend — `src/App.tsx`

- [ ] **Step 6: Imports, recent state, and derived keys**

- Add after the `./htmlExport` import:
```ts
import { addRecent, loadRecentFiles, removeRecent, saveRecentFiles, type RecentFile } from "./recentFiles";
```
- In the `from "./fileService"` import block, replace `syncTabMenu,` with `syncMenu,`.
- Add state next to the other `useState` hooks:
```ts
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => loadRecentFiles());
```
- Add derived values next to `tabTitles`/`tabMenuKey`:
```ts
  const recentNames = useMemo(() => recentFiles.map((file) => file.name), [recentFiles]);
  const recentKey = recentNames.join("\n");
```

- [ ] **Step 7: Record recents, persist, and extend the sync effect**

- Add a recorder + persist effect near the other document functions/effects:
```ts
  function rememberRecent(path: string, name: string) {
    setRecentFiles((list) => addRecent(list, { path, name }));
  }

  useEffect(() => {
    saveRecentFiles(recentFiles);
  }, [recentFiles]);
```
- Record on open — in `loadDocument`, after the `setStatus({ message: \`Opened ${name}\`, ... })` line, add:
```ts
    if (path) {
      rememberRecent(path, name);
    }
```
- Record on save — in `saveDocument`, inside the native success branch (right after the `setSession(... replaceDocumentById ...)` that sets `path`/`title`/`lastSavedMarkdown`, before `setStatus({ message: \`Saved ${saved.name}\` ... })`), add:
```ts
      rememberRecent(saved.path, saved.name);
```
- Extend the menu-sync effect to include recents and call `syncMenu`. Replace the current effect:
```ts
  useEffect(() => {
    if (!nativeFiles) {
      return;
    }
    const timer = window.setTimeout(() => {
      void syncMenu(tabTitles, recentNames).catch(() => {
        /* the native menu is a nicety; ignore sync failures */
      });
    }, 150);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeFiles, tabMenuKey, recentKey]);
```

- [ ] **Step 8: `openNativePath` returns success; add open-recent / clear handlers**

- Change `openNativePath` to report success so a dead recent entry can be pruned:
```ts
  async function openNativePath(path: string): Promise<boolean> {
    try {
      const opened = await openNativeMarkdownPath(path);
      if (!opened) {
        return false;
      }
      loadDocument(opened.contents, opened.name, opened.path);
      return true;
    } catch (error) {
      setStatus({
        message: `Open failed: ${error instanceof Error ? error.message : String(error)}`,
        tone: "error",
      });
      return false;
    }
  }
```
(The existing `flushPendingOpenedFiles` loop `await openNativePath(path)` ignores the boolean — no change needed there.)

- Add the recent handlers near `goToTab`:
```ts
  async function openRecentByIndex(index: number) {
    const entry = recentFiles[index];
    if (!entry) {
      return;
    }
    const opened = await openNativePath(entry.path);
    if (!opened) {
      setRecentFiles((list) => removeRecent(list, entry.path));
    }
  }

  function clearRecentFiles() {
    setRecentFiles([]);
  }
```

- [ ] **Step 9: Dispatch the new menu ids**

In `handleMenuAction`, add a `clearRecent` case and extend the `default` branch to handle `openRecent`:

```ts
      case "clearRecent": return clearRecentFiles();
```
and replace the `default:` block with:
```ts
      default:
        if (id.startsWith("openRecent")) {
          const index = Number(id.slice("openRecent".length));
          if (Number.isInteger(index)) {
            void openRecentByIndex(index);
          }
        } else if (id.startsWith("goToTab")) {
          const index = Number(id.slice("goToTab".length)) - 1;
          if (Number.isInteger(index)) {
            goToTab(index);
          }
        }
```

### Tests — `src/App.test.tsx`

- [ ] **Step 10: Update the mock + existing sync test, add recent tests**

- In the hoisted `fileMocks`, replace `syncTabMenu: vi.fn(() => Promise.resolve()),` with:
```ts
  syncMenu: vi.fn(() => Promise.resolve()),
```
- In `beforeEach`, add (so recents don't leak across tests via jsdom's shared localStorage):
```ts
  window.localStorage.clear();
```
- Update the existing test titled `"syncs the native Window menu to the open tabs"`: it now asserts `syncMenu` with a recent list (the opened file becomes recent). Change its final assertion to:
```ts
    await waitFor(() =>
      expect(fileMocks.syncMenu).toHaveBeenCalledWith(["Untitled document", "two"], ["two.md"]),
    );
```
- Add these tests inside the top-level `describe("App", …)`:
```tsx
  it("records an opened file in Open Recent and syncs it to the menu", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.openNativeMarkdownDocument.mockResolvedValue({
      contents: "# R",
      name: "recent.md",
      path: "/tmp/recent.md",
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    await waitFor(() => expect(sourceEditor()).toHaveValue("# R"));

    await waitFor(() =>
      expect(fileMocks.syncMenu).toHaveBeenCalledWith(["Untitled document", "recent"], ["recent.md"]),
    );
  });

  it("reopens a file from an openRecent menu event", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.openNativeMarkdownDocument.mockResolvedValue({
      contents: "# First",
      name: "first.md",
      path: "/tmp/first.md",
    });
    fileMocks.openNativeMarkdownPath.mockResolvedValue({
      contents: "# First",
      name: "first.md",
      path: "/tmp/first.md",
    });

    render(<App />);
    await waitFor(() => expect(menuHandler).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    await waitFor(() => expect(sourceEditor()).toHaveValue("# First"));

    await act(async () => {
      menuHandler?.({ payload: "openRecent0" });
    });

    await waitFor(() =>
      expect(fileMocks.openNativeMarkdownPath).toHaveBeenCalledWith("/tmp/first.md"),
    );
  });

  it("clears Open Recent on the clearRecent menu event", async () => {
    fileMocks.canUseNativeFileSystem.mockReturnValue(true);
    fileMocks.openNativeMarkdownDocument.mockResolvedValue({
      contents: "# X",
      name: "x.md",
      path: "/tmp/x.md",
    });

    render(<App />);
    await waitFor(() => expect(menuHandler).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    await waitFor(() =>
      expect(fileMocks.syncMenu).toHaveBeenCalledWith(expect.anything(), ["x.md"]),
    );

    fileMocks.syncMenu.mockClear();
    await act(async () => {
      menuHandler?.({ payload: "clearRecent" });
    });

    await waitFor(() => expect(fileMocks.syncMenu).toHaveBeenCalledWith(expect.anything(), []));
  });
```

- [ ] **Step 11: Verify and commit**

Run: `npm test` → fully green, pristine.
Run: `npm run build` → passes.
Run from `src-tauri/`: `cargo check` clean, `cargo test` green.
Do NOT run `npm run tauri dev` (GUI; the human verifies the live menu).

```bash
git add src-tauri/src/lib.rs src/fileService.ts src/App.tsx src/App.test.tsx
git commit -m "feat: add File > Open Recent menu backed by localStorage"
```

---

## Task 3: Changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a bullet to the 0.4.0 Added section**

Under the existing `## 0.4.0 - 2026-07-03` → `### Added` list, add a bullet (e.g. after the export/print bullet):

```markdown
- Reopen recently opened or saved files from `File ▸ Open Recent` (desktop; remembers the last 10, with "Clear Recent").
```

- [ ] **Step 2: Verify and commit**

Run: `npm test` → green (unchanged). (No code change; changelog only.)

```bash
git add CHANGELOG.md
git commit -m "docs: note Open Recent in the 0.4.0 changelog"
```

---

## Self-Review (author checklist — completed)

**1. Spec coverage:**
- localStorage persistence, cap 10, dedupe-by-path → Task 1 (`addRecent`/`load`/`save`). ✓
- Record on open + save → Task 2 Step 7 (`loadDocument` + `saveDocument`). ✓
- `File ▸ Open Recent` submenu with items + Clear Recent + empty placeholder → Task 2 Step 1. ✓
- Menu carried on the existing sync channel, main-thread rebuild → Task 2 Steps 1–3, 7. ✓
- Open a recent (dedupe via `openNativePath`/`openDocumentInSession`) + prune dead entries → Task 2 Step 8. ✓
- Dispatch `openRecent{i}` (0-based) / `clearRecent` → Task 2 Step 9. ✓
- Desktop-only gating → `syncMenu`/`rememberRecent` guarded by `nativeFiles`/`canUseNativeFileSystem`. ✓
- Tests for list logic + app integration → Tasks 1 & 2. ✓
- Changelog → Task 3. ✓

**2. Placeholder scan:** No "TBD"/"handle errors"/"similar to". The one conditional (fix `enabled()`/nesting API if it doesn't compile) is a bounded, explicit contingency, not a placeholder.

**3. Type consistency:** `RecentFile { path, name }`, `syncMenu(titles, recent)`, `sync_menu(titles, recent)`, `build_menu(app, titles, recent)`, `openRecent{index}` (0-based) / `goToTab{n}` (1-based) are consistent across Task 1, the Rust in Task 2, the frontend in Task 2, and the tests. The existing "syncs the native Window menu" test is updated for the new 2-arg `syncMenu` signature.
