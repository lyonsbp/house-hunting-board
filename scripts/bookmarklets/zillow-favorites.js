/*
 * Zillow favorites URL extractor.
 *
 * Paste this whole file into the DevTools Console while logged in at
 *   https://www.zillow.com/myzillow/Homes.htm
 * (or any /saved-homes/ variant). It scans for canonical home-detail
 * URLs (`/homedetails/.../<zpid>_zpid/`), scrolls to trigger Zillow's
 * lazy-load, dedupes, and copies to your clipboard newline-separated.
 * Paste into a urls.txt and feed to
 *   pnpm bulk-import urls.txt
 *
 * Idempotent — re-running just re-copies the same list.
 */
(async () => {
  const HOME_RE = /^https?:\/\/(?:www\.)?zillow\.com\/homedetails\/[^?#]*\/\d+_zpid\/?/i;

  function collect() {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const seen = new Set();
    for (const a of anchors) {
      let href = a.getAttribute("href") || "";
      if (href.startsWith("/")) href = `https://www.zillow.com${href}`;
      if (!HOME_RE.test(href)) continue;
      try {
        const u = new URL(href);
        // Normalize trailing slash so dedupe works.
        const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
        seen.add(`${u.origin}${path}`);
      } catch {
        // skip malformed
      }
    }
    return Array.from(seen).sort();
  }

  // Zillow saved-homes is virtualized — scroll until count stabilizes.
  let prev = -1;
  for (let i = 0; i < 30; i++) {
    const now = collect().length;
    if (now === prev) break;
    prev = now;
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 500));
  }

  const urls = collect();
  const text = urls.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    console.log(`Copied ${urls.length} Zillow favorite URL(s) to clipboard.`);
  } catch (e) {
    console.warn("Clipboard write failed; printing URLs instead:", e);
    console.log(text);
  }
  console.log(urls);
})();
