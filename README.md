# Advanced Search Sort

A Joplin desktop plugin that adds a searchable, sortable note list panel — similar to Joplin’s built-in note list, with column sorting, notebook scoping, and layout persistence.

**Plugin ID:** `com.danielvreeman.searchsort`  
**Current version:** 0.1.3

## Features

- Search notes with Joplin’s search engine
- Sort by Relevance, Updated, Created, Title, or Notebook
- Drag to reorder columns; resize columns (saved between sessions)
- Notebook scope chip: clicking a notebook in the sidebar scopes results with `notebook:…`
- **All notebooks** control to search everywhere
- Inbox-style workflow: moving the current note out of a scoped notebook removes it from the list and continues on the next note
- Optional “Preserve last query and sort”

## Requirements

- Joplin desktop **3.0+**
- Node.js 18+ (for building)

## Install from file (`.jpl`)

1. Build or download `publish/com.danielvreeman.searchsort.jpl`
2. Joplin → **Settings → Plugins** → gear → **Install from file**
3. Restart Joplin
4. Open **Tools → Open Advanced Search Sort**

## Development install

```bash
npm install
npm run build
```

In Joplin: **Settings → Plugins → Development plugins**, set the path to this project folder (the folder that contains `dist/`), then restart Joplin.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile webpack bundle into `dist/` |
| `npm run package` | Build + create `publish/*.jpl` and plugin info JSON |
| `npm test` | Run unit tests |
| `npm run updateVersion` | Bump patch version in `package.json` and `manifest.json` |

## Project layout

```
src/           Plugin source (TypeScript + panel UI)
dist/          Build output loaded by Joplin
publish/       Packaged .jpl / .json for distribution
scripts/       Build, package, version helpers
```

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
