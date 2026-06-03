# HillDown Polish Plan

## Goal

Rename the app to HillDown and improve the first-run visual quality without changing the core editor architecture.

## Non-goals

- Replace the textarea editor with CodeMirror or ProseMirror.
- Add tabbed documents, autosave, or packaging/notarization.
- Change Markdown parsing behavior.

## Constraints

- Keep the app lightweight and keyboard-friendly.
- Preserve native file workflow, slash commands, and browser fallback behavior.
- Keep UI dense and editor-first.

## Acceptance Criteria

- Product name appears as HillDown in UI, docs, package metadata, Tauri metadata, and app titles.
- Editor and preview panes read as a polished desktop tool.
- Initial content feels like a real Markdown note rather than a feature explainer.
- Existing tests, frontend build, audit, Rust check, and non-bundled Tauri build pass.

## Approach

- Rename JavaScript and Rust package metadata.
- Update Tauri config, app title, document title, default download name, docs, and sample document.
- Add pane headers, brand mark, refined status badges, focus states, and minor spacing/color polish.

## Verification Plan

- Search for old product names after edits.
- Run the frontend and Tauri verification commands.
- Attempt browser inspection if the in-app browser is available.

## Test Plan

- Existing unit tests cover editor/file helpers.
- Build checks prove renamed imports and package metadata still compile.
- Tauri build proves renamed Rust library wiring is correct.

## Monitoring Plan

No runtime monitoring is needed.

## Risks / Open Questions

- Cargo package rename must be kept in sync with the Rust library crate name.
- Visual verification may be limited if browser automation is unavailable.

## Status

Completed. Unit tests, frontend build, npm audit, Rust check, Tauri info, and non-bundled Tauri build pass. The configured in-app browser was unavailable, so visual inspection could not be completed from this session.
