/*
 * Redfin favorites URL extractor.
 *
 * Paste this whole file into the DevTools Console while logged in at
 *   https://www.redfin.com/myredfin
 * It scans the page for canonical listing URLs (anchors matching
 * `/[STATE]/<city>/.../home/<id>`), dedupes, and copies them to your
 * clipboard newline-separated. Paste into a urls.txt and feed to
 *   pnpm bulk-import urls.txt
 *
 * Idempotent — re-running just re-copies the same list.
 */
(async () => {
  const HOME_RE = /^https?:\/\/(?:www\.)?redfin\.com\/[A-Z]{2}\/[^/]+\/[^?#]*\/home\/\d+/i;

  function collect() {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const seen = new Set();
    for (const a of anchors) {
      let href = a.getAttribute("href") || "";
      if (href.startsWith("/")) href = `https://www.redfin.com${href}`;
      if (!HOME_RE.test(href)) continue;
      // Strip query + fragment so dedupe works across UI states.
      try {
        const u = new URL(href);
        seen.add(`${u.origin}${u.pathname}`);
      } catch {
        // skip malformed
      }
    }
    return Array.from(seen).sort();
  }

  // Redfin's My Home Tour grid lazy-renders as you scroll. Walk down the
  // page until the count stops growing.
  let prev = -1;
  for (let i = 0; i < 30; i++) {
    const now = collect().length;
    if (now === prev) break;
    prev = now;
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
  }

  const urls = collect();
  const text = urls.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    console.log(`Copied ${urls.length} Redfin favorite URL(s) to clipboard.`);
  } catch (e) {
    console.warn("Clipboard write failed; printing URLs instead:", e);
    console.log(text);
  }
  console.log(urls);
})();
