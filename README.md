# MiseFlow Recipe Normalizer

MiseFlow is a recipe-tracking web app that standardizes recipes from:

- Any web recipe URL
- YouTube videos
- Your own raw recipe notes

It converts everything into a cooking-first format with:

- Structured ingredients + steps
- Mise en place checklist
- Bowl consolidation plan (reduce unnecessary bowls)
- Cooking step checklist
- Shopping list grouped by category
- Account-backed recipe storage (register/login)
- Retailer cart-link packs (Instacart, Walmart, Amazon)
- Citation and credit block for original sources
- Markdown/JSON export plus local fallback library

## How Source Import Works

1. Paste a source URL.
2. Click `Import from URL`.
3. The backend tries, in order:
   - JSON-LD recipe schema extraction (best quality)
   - HTML section heuristics (`Ingredients`, `Instructions`, etc.)
   - For YouTube: recipe links in description
   - For YouTube: transcript-based fallback heuristics
4. It auto-fills the form, then normalizes into the MiseFlow format.

## Local Development

```bash
npm install
npm run dev
```

Then open:

`http://localhost:3030`

## Account-Backed Storage

- Create an account from the `Account` panel.
- Login stores an auth token in browser local storage.
- Saved recipes are persisted server-side in `data/store.json` under your account.
- If logged out, the app falls back to browser-only storage.

## Retailer Integrations

- `Build Retailer Cart Links` generates cart-search packs for:
  - Instacart
  - Walmart
  - Amazon
- Per-ingredient quick links are available in the shopping list.
- This version uses deep links. Direct one-click checkout requires partner API credentials.

## Is AI Involved In Parsing?

Current parsing is deterministic and rule-based, not LLM-driven:

- JSON-LD recipe schema extraction
- HTML heading/list heuristics
- YouTube description link discovery
- YouTube transcript heuristics

This keeps extraction transparent and predictable. You can add an optional AI cleanup step later for instruction rewriting and ingredient normalization.

## Project Files

- `/Users/nickkarnik/gh/recipes/server.js`: extractor API + static host
- `/Users/nickkarnik/gh/recipes/store.js`: account/session/recipe persistence
- `/Users/nickkarnik/gh/recipes/index.html`: app structure
- `/Users/nickkarnik/gh/recipes/styles.css`: visual system
- `/Users/nickkarnik/gh/recipes/app.js`: normalization logic + rendering + library

## Notes and Limits

- Some sites block scraping or hide content behind scripts/paywalls.
- Some YouTube videos do not expose transcripts.
- YouTube parsing is heuristic unless linked recipe pages are available.
- Retailer deep links are not true transactional carts yet; production checkout needs retailer partner APIs.
