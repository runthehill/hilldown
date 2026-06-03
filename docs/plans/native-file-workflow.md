# Native File Workflow Plan

## Goal

Add native desktop open/save workflows and a first pass of richer editor ergonomics.

## Non-goals

- Full document tabs, autosync, or file watching.
- A custom editor engine or WYSIWYG surface.
- Distribution packaging changes beyond keeping the Tauri app buildable.

## Constraints

- Keep browser-compatible import/export fallbacks for the Vite web app.
- Use Tauri v2 plugins for native dialogs and filesystem writes.
- Preserve the existing lightweight single-screen interface.

## Acceptance Criteria

- Desktop users can open `.md`, `.markdown`, and `.txt` files through native dialogs.
- Desktop users can save to the current file or choose Save As through native dialogs.
- Browser users still have import/download fallback behavior.
- The UI shows file path, dirty/saved state, and save feedback.
- Editor keyboard handling supports indentation and common save/open shortcuts.

## Approach

- Add `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs`, and matching Rust plugins.
- Add a small `fileService` module that chooses native APIs when running inside Tauri and browser fallbacks otherwise.
- Track `documentPath`, dirty state, and last saved content in the app.
- Add editor helper functions for indentation and line/column reporting.

## Files / Areas Affected

- `src/App.tsx`
- `src/editorCommands.ts`
- `src/fileService.ts`
- `src-tauri/`
- `README.md`, `AGENTS.md`

## Verification Plan

- Unit-test file-name/path helpers and editor indentation behavior.
- Run frontend tests and build.
- Run `cargo check` and a non-bundled Tauri build.

## Test Plan

- Happy path: save new content via Save As and update current path/state.
- Existing file path: Save writes to the active path without prompting.
- Browser fallback: import and download still work without Tauri internals.
- Editor path: Tab and Shift+Tab update selected lines predictably.

## Monitoring Plan

No runtime monitoring is needed.

## Risks / Open Questions

- Tauri filesystem permissions must remain scoped to user-selected files rather than broad filesystem access.
- Interactive dialog behavior may need manual desktop validation after build checks pass.

## Status

Completed. Unit tests, frontend build, `cargo check`, audit, and non-bundled Tauri build pass. Interactive native dialog validation still needs a manual desktop pass.
