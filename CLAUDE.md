# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HillDown is a Tauri v2 desktop Markdown editor (Vite + React 19 + TypeScript frontend, Rust shell). See `AGENTS.md` for the full contributor guide; this file covers the architecture and commands that require reading multiple files to grasp.

## Commands

```bash
npm run dev          # Vite web app at http://127.0.0.1:1420 (strictPort)
npm run tauri dev    # desktop app with the Rust shell
npm run tauri build  # desktop bundle (target set in src-tauri/tauri.conf.json)
npm test             # Vitest unit tests (jsdom)
npm run build        # tsc type-check + vite build into dist/
```

Run a single frontend test: `npx vitest run src/editorCommands.test.ts`, or by name: `npx vitest run -t "indentLines"`.

When touching `src-tauri/`, verify Rust from that directory: `cargo check` and `cargo test` (Rust unit tests live inline in `src-tauri/src/lib.rs`).

## Architecture

### Dual runtime: desktop vs. browser fallback
The same React app runs both as a Tauri desktop app (native file system) and as a plain web app (browser fallback). `canUseNativeFileSystem()` in `src/fileService.ts` (wrapping `isTauri()`) is the single switch that decides behavior everywhere:
- **Native:** Tauri dialog/fs plugins for Open/Save/Save As, plus a custom Rust `read_markdown_document` command.
- **Browser:** hidden `<input type="file">` for import and a Blob `.md` download for "save".

`App.tsx` branches on this flag in `openDocument`/`saveDocument`. Keep both paths working when changing file behavior.

### Pure editor commands, thin React shell
All text-transformation logic is pure functions in `src/editorCommands.ts`, each taking `(value, selection, …)` and returning an `EditResult` (`{ value, selectionStart, selectionEnd }`). `App.tsx` only wires these to the toolbar, keyboard shortcuts, and slash menu, then calls `commit()` to apply the result and reposition the caret. **Put new editing behavior here as a tested pure function, not inline in the component** — this is what makes selection/caret math testable without rendering.

### Slash command system
`getSlashQuery` detects a `/query` typed at the start of a line; `filterSlashCommands` matches against label/description/keywords; `applySlashCommand` replaces the `/query` span with the command's markdown. The menu's screen position is computed in `App.tsx` via `getTextareaCaretPoint`, which mirrors the textarea into a hidden div to measure the caret pixel coordinates. The command list lives in `slashCommands` in `editorCommands.ts`.

### OS file-association open flow
Opening a `.md` from Finder/Explorer is two-phase and spans Rust + TS:
1. **Startup:** `markdown_file_paths_from_args` parses launch args into `PendingOpenedFiles` (a `Mutex<Vec<String>>`).
2. **Already running:** `RunEvent::Opened` (macOS/iOS/Android) enqueues paths and emits the `hilldown://open-files` event.

The frontend listens for that event and also drains the queue on startup via the `take_pending_opened_file_paths` command (`flushPendingOpenedFiles` in `App.tsx`). The event name string `hilldown://open-files` is defined in **both** `lib.rs` (`OPENED_FILES_EVENT`) and `fileService.ts` (`openedFilesEvent`) — they must stay identical. Accepted extensions are also duplicated across `lib.rs` `is_markdown_path`, `tauri.conf.json` `fileAssociations`, and the TS filters/regexes in `fileService.ts`.

### Markdown rendering
Preview = `marked.parse()` (configured GFM, `breaks: false`) → `DOMPurify.sanitize()` → `dangerouslySetInnerHTML`. The DOMPurify step is a security boundary; do not remove it when changing rendering.

### Undo/redo
History is an in-component string array capped at 80 entries (`pushHistory` in `App.tsx`), independent of the textarea's native undo. Every mutation routes through `commit`/`pushHistory`.

## Release checklist (before pushing)
Treat every push as a release. Bump the version consistently in all five files and add a dated `CHANGELOG.md` entry, in the same commit:
`package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`.

## Conventions
- Conventional Commits (`feat:`, `fix:`).
- Strict TypeScript, 2-space indent; `PascalCase` components, `camelCase` functions/hooks, `kebab-case` CSS classes.
- Keep the UI dense and app-like (icon buttons, segmented controls) — no marketing/landing-page styling.
- Native file access is intentionally scoped via `src-tauri/capabilities/default.json`; avoid widening filesystem permissions.
