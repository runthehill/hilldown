# Tauri Markdown Editor Plan

## Goal

Create a lightweight Tauri desktop Markdown editor/viewer with a usable first screen, formatting controls, GitHub-flavored Markdown preview, slash commands, and table insertion.

## Non-goals

- Native file-system permissions and dialogs beyond browser-compatible open/export in the first pass.
- Collaborative editing, plugin marketplace, or cloud sync.
- A custom Markdown parser.

## Constraints

- Keep the app small and dependency-light.
- Use established platform pieces: Tauri, Vite, React, TypeScript, and a Markdown renderer with sanitization.
- Keep UI controls dense and work-focused rather than landing-page styled.

## Acceptance Criteria

- App opens to an editor, preview, and formatting toolbar.
- Markdown preview supports tables, task lists, code blocks, links, and standard formatting.
- Slash commands can insert headings, lists, quotes, code blocks, and tables.
- Build and tests pass locally.

## Approach

- Scaffold Vite React with Tauri v2.
- Implement text-editing commands as pure TypeScript helpers with unit coverage.
- Build a single-screen editor with edit, split, and preview modes.
- Render Markdown with `marked` and sanitize generated HTML with `dompurify`.

## Files / Areas Affected

- `src/` frontend app and editor helpers.
- `src-tauri/` Tauri shell.
- Root project metadata and documentation.

## Verification Plan

- Run unit tests for formatting and slash command behavior.
- Run the web build to prove TypeScript and Vite compile the changed paths.
- Start the local dev server and inspect the app in a browser.

## Test Plan

- Happy path: insert a table via slash command and verify the preview renders a table.
- Sad path: render potentially unsafe Markdown/HTML and verify preview sanitization is applied.
- Keyboard path: verify formatting helpers preserve selected text and cursor placement.

## Monitoring Plan

No runtime monitoring is needed for the initial local desktop app.

## Risks / Open Questions

- Native open/save dialogs require additional Tauri plugins and permissions; browser-compatible import/export is used first.
- Tauri bundling may need platform-specific icons before distribution packaging.

## Status

Completed. Frontend tests, frontend build, `cargo check`, and non-bundled `tauri build` pass. Browser automation was unavailable in this session, so runtime verification used the Vite HTTP response instead of an interactive browser pass.
