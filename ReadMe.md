# BCSDA Resources Database Notes

This session updated the static BCSDA resources database and published it to GitHub.

## What changed

- Added new resource rows to `output_llamacpp.csv`, mostly tools and AI tools.
- Regenerated/updated the static site output in `index.html` and `database_html/index.html`.
- Updated `generate_static_directory_html_filtered_link.js` so generated pages support shareable filter URLs.
- Ensured the document type filter includes `Tool` and `AI Tool`.
- Added `.gitignore` rules to keep local secrets and large source document folders out of Git.

## URL filter behavior

The generated HTML now reads filters from the query string on load and updates the URL when filters change.

Supported params:

- `title`
- `theme`
- `type`
- `documentType`
- `year`

Example:

```text
/?theme=Decarbonisation&type=AI+Tool&year=2026
```

Multiple selected values are represented as repeated params:

```text
/?theme=Climate&theme=Energy&type=Tool
```

## Files intentionally not pushed

These remain local-only:

- `.env`
- `*.env`
- `GIT CODEX CODE HAMZA PERSONAL ACCOU.txt`
- `Inputs/`
- `files_repository/`

`Inputs/` and `files_repository/` were excluded because they are very large local source-document stores.

## GitHub publish

Changes were committed and pushed to:

```text
https://github.com/alt-auto-ai/bcsda_resources_database
```

Commit:

```text
9adf21d update database site
```
