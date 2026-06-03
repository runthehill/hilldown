# Open Associated Markdown Files

## Goal

Load Markdown files that the OS opens with HillDown, such as Finder "Open With"
or double-clicking a registered Markdown document.

## Non-goals

- Do not make HillDown the default Markdown app.
- Do not add multi-document tabs or multiple windows.
- Do not broaden the frontend fs plugin scope for arbitrary filesystem reads.

## Constraints

- Keep DOMPurify sanitization and existing editor state behavior intact.
- Preserve the dirty-document confirmation before replacing current content.
- Keep native file reads limited to Markdown-like extensions handled by the app.

## Acceptance Criteria

- macOS `RunEvent::Opened` file URLs are captured by the Tauri backend.
- Startup file arguments are captured for platforms that launch with argv paths.
- The frontend listens for opened-file notifications and drains pending paths.
- The opened file loads through the same editor state path as the Open button.
- The app still builds, tests pass, and the generated macOS bundle keeps the
  Markdown file association metadata.

## Approach

Add a small backend queue for OS-opened paths and expose two commands:
`take_pending_opened_file_paths` and `read_markdown_document`. The backend emits
a frontend event whenever new paths arrive. The frontend registers a Tauri event
listener, drains pending paths, confirms before replacing dirty content, and
loads the first Markdown file.

## Files / Areas Affected

- `src-tauri/src/lib.rs`
- `src/fileService.ts`
- `src/fileService.test.ts`
- `src/App.tsx`
- `src/App.test.tsx`

## Verification Plan

- Targeted Vitest tests prove frontend pending/event handling and file service
  command wrappers.
- Rust tests prove URL/argument filtering only returns Markdown-like paths.
- `cargo check` proves Tauri event handling compiles.
- `npm run build` proves frontend type checking and bundling.
- `npm run tauri build -- --bundles app` proves the app bundle builds.

## Test Plan

- Before change: targeted tests should fail because commands/helpers/listener do
  not exist.
- After change: targeted tests should pass.
- Sad path: dirty-document rejection keeps current content and does not read the
  pending file.

## Monitoring Plan

Manual verification after install is Finder "Open With" on a `.md` file. The
status bar should report the opened file name and the document path should match.

## Risks / Open Questions

- Windows/Linux may require a single-instance plugin later to forward files to an
  already running app. This change handles startup arguments but does not add a
  new dependency for single-instance forwarding.

## Status

Complete. Backend opened-file queuing, frontend event handling, tests, build,
and macOS app bundle verification passed locally.
