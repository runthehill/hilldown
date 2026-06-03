# HillDown

HillDown is a lightweight Tauri desktop Markdown editor and viewer. It includes a focused editing surface, native file open/save, live preview, toolbar formatting, GitHub-flavored table support, and slash commands for common blocks.

## Development

Install dependencies:

```bash
npm install
```

Run the web app locally:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Build the frontend:

```bash
npm run build
```

Run the Tauri desktop app:

```bash
npm run tauri dev
```

Build the Tauri desktop app:

```bash
npm run tauri build
```

The configured bundle target is controlled by `src-tauri/tauri.conf.json`.
With `bundle.active` enabled and `bundle.targets` set to `app`, the macOS
build creates an app bundle at:

```text
src-tauri/target/release/bundle/macos/HillDown.app
```

On macOS, open the `.app` bundle. Do not double-click the raw executable at
`src-tauri/target/release/hilldown`; Finder launches raw Unix executables
through Terminal, which makes a terminal window appear before the app starts.

To build a different bundle format for a one-off release, pass Tauri's
`--bundles` option after npm's `--` separator:

```bash
# macOS app bundle
npm run tauri build -- --bundles app

# macOS DMG installer
npm run tauri build -- --bundles dmg

# macOS app bundle and DMG
npm run tauri build -- --bundles app,dmg

# Windows NSIS installer, when building on Windows
npm run tauri build -- --bundles nsis

# Windows MSI installer, when building on Windows
npm run tauri build -- --bundles msi

# Linux packages, when building on Linux
npm run tauri build -- --bundles deb
npm run tauri build -- --bundles rpm
npm run tauri build -- --bundles appimage
```

Use `--target` for CPU or Rust platform targets, not installer formats. For
example, a universal macOS app build is:

```bash
npm run tauri build -- --target universal-apple-darwin --bundles app,dmg
```

Tauri desktop builds are easiest when run on the destination OS: build macOS
bundles on macOS, Windows installers on Windows, and Linux packages on Linux.
Cross-compiling is possible for some targets, but it requires additional Rust
targets, platform toolchains, and signing setup.

If a console window appears for a Windows release build, make sure the first
line of `src-tauri/src/main.rs` is:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
```

## Editing Features

- Edit, split, and preview modes.
- Native Open, Save, and Save As in the Tauri desktop app.
- Browser-compatible Markdown import and `.md` download fallback in the web app.
- Toolbar actions for headings, emphasis, lists, tasks, quotes, links, images, code blocks, dividers, and tables.
- Slash commands on a new line, such as `/table`, `/task`, `/code`, and `/quote`.
- Keyboard shortcuts for New, Open, Save, Save As, bold, italic, links, and line indentation.
- File path, dirty/saved state, line/column, word count, and copy Markdown/HTML actions.
