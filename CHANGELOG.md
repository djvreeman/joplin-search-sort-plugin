# Release notes

All notable changes to **Advanced Search Sort** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Maximum notes to load** setting label clarifies that `0` uses the default 5,000-note cap (not unlimited); status line explains how to raise the limit when capped
- Scoped notebook browsing (no search text) uses your default sort field/direction instead of Relevance, and loads notes in that order from Joplin
- **New note** from All notebooks (or after clearing a search) scopes the panel to the notebook where the note was created and selects it in the list

### Planned

- Publish to the Joplin plugin repository (npm) for in-app **Update**

## [0.2.1] - 2026-08-29

### Fixed

- Restored notebook scope (e.g. @Inbox) is no longer overwritten on startup when Joplin briefly reports a different sidebar folder
- **New note** creates in the panel's scoped notebook, refreshes the list, and selects the new note (title edits update live once it appears)
- Deleted notes (trash or permanent) are removed from the panel listing immediately

## [0.2.0] - 2026-08-27

### Added

- Right-click context menu on panel result rows with the same core actions as Joplin's default note list (tags, move, duplicate, delete, export PDF, etc.)
- **⌘T** / **Ctrl+T** opens Tags and **⌘M** / **Ctrl+M** opens Move to notebook when the panel has focus and a note is selected
- Up/Down arrow keys navigate the selected note in the panel result list (after clicking a result row)

### Changed

- Plugin ID renamed to `com.danielvreeman.searchsort` (uninstall the old `com.danielvreeman.searchsort` install if present)
- Minimum Joplin version raised to **3.4** (context menus use `webviewApi.menuPopupFromTemplate`)
- When a note is moved out of the scoped notebook, the next selected note follows the **panel's current sort order** (title, updated, etc.), not Joplin's default note-list sort

### Fixed

- Auto-advance to the next note only when the current note is moved out of the scoped notebook (or deleted) — not on title, tag, or other in-place edits
- Notebook switching no longer stalls on stale large-folder searches overwriting the newer scope
- Removed per-poll move-reconcile (was slowing the panel and racing folder changes)
- Live panel columns (Title, Updated, Created, Notebook) refresh when note metadata changes, without changing selection

## [0.1.3] - 2026-08-23

### Fixed

- Inbox-processing workflow: when the selected note is moved to another notebook, it is removed from the scoped list immediately and work continues on the next note (aligned with Joplin's core note-list behavior)
- Stale production packaging of `ui/panel.js` (build now force-copies panel assets from `src/ui`)

### Changed

- Selection / note-meta reconciliation via data API instead of relying only on `onNoteChange` (which does not fire for notes after they leave selection)

## [0.1.2] - 2026-08-22

### Added

- Debounced listing refresh on note change and sync complete
- Refresh after creating a new note from the panel

### Fixed

- Attempted live updates when notes change (superseded by 0.1.3 for notebook moves)

## [0.1.1] - 2026-08-22

### Fixed

- Blank column headers and note titles on fresh installs (empty `panelColumns` no longer left columns uninitialized)
- Layout CSS fallbacks and flex sizing for the results pane

## [0.1.0] - 2026-08-22

### Added

- Advanced Search Sort panel with searchable, sortable columns
- Column drag-reorder and resize with persistence
- Notebook scoping via Joplin `notebook:` filter and **All notebooks** control
- Preserve last query and sort setting
- Production `.jpl` packaging

[Unreleased]: https://github.com/djvreeman/joplin-search-sort-plugin/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/djvreeman/joplin-search-sort-plugin/releases/tag/v0.2.1
[0.2.0]: https://github.com/djvreeman/joplin-search-sort-plugin/releases/tag/v0.2.0
[0.1.3]: https://github.com/djvreeman/joplin-search-sort-plugin/releases/tag/v0.1.3
[0.1.2]: https://github.com/djvreeman/joplin-search-sort-plugin/releases/tag/v0.1.2
[0.1.1]: https://github.com/djvreeman/joplin-search-sort-plugin/releases/tag/v0.1.1
[0.1.0]: https://github.com/djvreeman/joplin-search-sort-plugin/releases/tag/v0.1.0
