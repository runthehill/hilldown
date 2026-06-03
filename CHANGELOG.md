# Changelog

All notable changes to HillDown will be documented in this file.

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
