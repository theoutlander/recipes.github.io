# MiseFlow Static Recipe Publisher

This project is now a **local publishing pipeline + static public site**:

- Backend runs ephemerally (locally or inside GitHub Actions) for extraction/build steps
- Public output is static HTML/JSON for GitHub Pages
- No public login, no admin UI required

## Architecture

- Local backend: `server.js`
  - URL extraction (`/api/extract`)
  - Static publish/rebuild (`/api/admin/publish`, `/api/admin/rebuild`)
- Local batch tool: `scripts/publish-from-urls.js`
- Static public site:
  - `index.html`, `site.css`, `site.js`
  - `recipes/*.html`, `recipes/index.json`
  - `sitemap.xml`, `robots.txt`

## Workflow (Recommended)

1. Add URLs to `content/source-urls.txt` (one per line)
2. Start local backend:

```bash
npm run dev
```

3. In another terminal, publish from URLs:

```bash
ADMIN_KEY=dev-admin-key npm run publish:urls -- --file content/source-urls.txt
```

4. Commit generated static files and push to GitHub Pages.

## Fully Automatic URL Inbox (No Manual Runs)

If you want “add URL and it appears on the site”:

1. Create a Google Sheet with one URL per row.
2. Publish the sheet as CSV (or use an accessible CSV export URL).
3. Set GitHub repository secrets:
   - `URL_INBOX_CSV_URL` (sheet CSV URL)
   - `ADMIN_KEY` (same key used by publish endpoints)
4. Optional repo variable:
   - `SITE_URL` (your GitHub Pages URL)
5. Enable workflow:
   - `.github/workflows/publish-from-sheet.yml`

The workflow runs every 5 minutes (and can run manually), starts backend in CI, pulls URLs, publishes new recipes, rebuilds static pages, and commits output to the repo.

## Commands

- `npm run dev`: run local backend
- `npm run build:static`: rebuild static pages from `content/recipes/*.json`
- `npm run publish:urls`: extract + normalize + publish from URL list
- `npm run fetch:sheet`: pull URL list from sheet CSV into `content/source-urls.txt`

Optional args for batch publish:

- `--file <path>` URL list file
- `--api <baseUrl>` API base (default `http://localhost:3030`)
- `--key <adminKey>` admin key
- `--servings <n>` default servings for imported recipes
- `--limit <n>` max URLs per run (default `50`)
- `--republish` force republish even if source URL already exists

## Environment

Set locally when publishing:

```bash
export ADMIN_KEY="your-local-publish-key"
export SITE_URL="https://<your-github-pages-domain>"
export URL_INBOX_CSV_URL="https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=<gid>"
```

`SITE_URL` is used for canonical URLs and sitemap output.

## Public Deployment

Only publish static assets to GitHub Pages:

- `index.html`
- `site.css`
- `site.js`
- `recipe.css`
- `recipes/`
- `sitemap.xml`
- `robots.txt`

Backend is not deployed.

## Parsing Method

Extraction is deterministic (non-LLM):

- JSON-LD recipe schema parsing
- HTML heading/list heuristics
- YouTube description/link/transcript heuristics
