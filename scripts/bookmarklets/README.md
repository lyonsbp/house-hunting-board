# Favorites URL extractors

Two devtools snippets that scrape your Redfin / Zillow favorites pages
into a newline-separated URL list, ready to feed to
`pnpm bulk-import urls.txt`. Neither site exposes favorites via API and
both require you to be logged in, so this runs in your own browser.

## Redfin

1. Sign in at [redfin.com](https://www.redfin.com/) (or your shared
   partner-account session).
2. Navigate to **My Home Tour** / favorites — usually
   `https://www.redfin.com/myredfin`.
3. Open DevTools → Console.
4. Paste the entire contents of [`redfin-favorites.js`](./redfin-favorites.js)
   and press Enter.
5. The snippet scrolls the page to trigger lazy-loaded rows, dedupes, and
   copies the URLs to your clipboard. The console prints the count and
   the list.
6. Paste into `urls.txt`.

## Zillow

1. Sign in at [zillow.com](https://www.zillow.com/).
2. Navigate to your saved homes — usually
   `https://www.zillow.com/myzillow/Homes.htm` (older URL still works) or
   the `/saved-homes/` page.
3. Open DevTools → Console.
4. Paste the entire contents of [`zillow-favorites.js`](./zillow-favorites.js)
   and press Enter.
5. Same flow: scrolls to load everything, copies URLs to clipboard,
   prints the count.
6. Append to your `urls.txt` (or keep separate files per source).

## Running the import

```
pnpm bulk-import urls.txt              # full run
pnpm bulk-import urls.txt --dry-run    # parse + log, no DB writes
pnpm bulk-import urls.txt --limit 5    # only process the first 5
```

The script processes URLs serially with an 8s ± 4s jittered delay
between each to stay polite. Per-URL errors don't abort the batch.
Re-running with the same `urls.txt` is safe — `properties` upserts on
`(source, source_url)` and the LLM feature extractor replaces its own
prior rows.

## Notes / caveats

- Both sites change their markup periodically; if a snippet returns 0
  URLs, inspect a favorite tile and adjust `HOME_RE` accordingly.
- Some browsers (older Safari) refuse `navigator.clipboard.writeText`
  from a console context; the snippet falls back to printing the joined
  list, which you can copy manually.
- The bulk script never downloads images and never touches Storage or
  any board. It only stocks `properties`, `property_snapshots`, and
  `feature_signals`.
