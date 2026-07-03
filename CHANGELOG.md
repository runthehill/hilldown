# Changelog

All notable changes to HillDown will be documented in this file.

## 0.4.0 - 2026-07-03

### Added

- Open multiple documents at once in in-window tabs, with a per-tab unsaved indicator and close via ✕ or middle-click. Closing a tab with unsaved changes now shows a Save / Don't Save / Cancel dialog. Opening a file that is already open activates its tab instead of duplicating it, and opening a file no longer replaces the current document.
- A native application menu bar (File, Edit, Format, View, Window) with standard accelerators for New, Open, Save, Save As, Print, Close Tab, the formatting commands, the view modes, and tab navigation. Undo and Redo drive HillDown's own history.
- Export the current document as a self-contained, styled HTML file.
- Native printing (⌘/Ctrl+P) through the operating system print panel, including "Save as PDF" for PDF output.

### Fixed

- A newly opened document now starts scrolled to the top instead of jumping to the end, and each tab remembers its own scroll position.

### Changed

- Bump app version from `0.3.1` to `0.4.0`.

## 0.3.1 - 2026-06-03

### Fixed

- Opt the app out of the operating system's smart-punctuation substitution so it no longer rewrites the Markdown source — typing `---`, `--`, straight quotes, or `...` now stays literal instead of being replaced with em dashes, curly quotes, or an ellipsis. On macOS this is disabled at the application level (the desktop shell overrides the relevant `NSAutomatic…SubstitutionEnabled` defaults); the editor also sets `autocorrect`/`autocapitalize` off as a cross-platform fallback. Pasting typographic characters and spellcheck corrections are unaffected.
- Bump app version from `0.3.0` to `0.3.1`.

## 0.3.0 - 2026-06-03

### Added

- Add self-hosted `@fontsource` typefaces — Hanken Grotesk, Newsreader, and IBM Plex Mono — bundled so the desktop app renders them offline.

### Changed

- Redesign the interface around a calm "paper & petrol ink" theme: warm paper surfaces, hairline structure, and a single restrained petrol accent in place of the previous gradient and card styling.
- Give the app a typographic voice — Hanken Grotesk for chrome, Newsreader for the rendered preview, and IBM Plex Mono for raw source and code.
- Replace card-style panes with seamless, measure-constrained writing and reading columns, and refine the toolbar, slash menu, tables, code blocks, blockquotes, and status bar.
- Refresh the sample document into a short welcome that showcases the formatting.
- Respect `prefers-reduced-motion` and keep motion to subtle load and menu transitions.
- Bump app version from `0.2.1` to `0.3.0`.

### Accessibility

- Restore a visible keyboard focus indicator on the editor and add one to the now keyboard-scrollable preview (WCAG 2.4.7).
- Meet WCAG AA contrast (4.5:1) for muted, success, and warning text on both paper and chrome surfaces.
- Add landmark structure (banner, main, contentinfo) and a `toolbar` role, accessible names and pressed state for icon-only buttons, a polite live region for status messages, and screen-reader wiring (`aria-controls`/`aria-activedescendant`) for the slash command menu.
- Keep focus and stateful controls distinguishable under Windows High Contrast / forced-colors.

## 0.2.1 - 2026-05-29

### Changed

- Document the pre-push release checklist for version and changelog updates.
- Bump app version from `0.2.0` to `0.2.1`.

## 0.2.0 - 2026-05-29

### Added

- Add macOS app bundle packaging and README build guidance for app, DMG, and platform-specific bundle targets.
- Add a generated HillDown app icon and wire it into macOS and Windows bundle metadata.
- Declare Markdown file associations for `.md`, `.markdown`, `.mdown`, and `.mkd` files.
- Open Markdown files passed by the operating system through file association launches and startup arguments.

### Changed

- Bump app version from `0.1.0` to `0.2.0`.
