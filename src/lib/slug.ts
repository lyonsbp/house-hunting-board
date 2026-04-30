/**
 * Kebab-case slug from a free-form name. ASCII-folds diacritics
 * (Café → cafe) so URLs stay copy-pasteable. Empty input or pure
 * punctuation falls back to "category" — never returns "" since it
 * would break URL parsing.
 *
 * Slugs are *not* persisted in the DB. Callers compute slugs on the
 * fly from `categories.name` and look up matches in memory. Within a
 * board, `categories.name` is unique (DB constraint) so slugs are
 * generally unique too — the rare diacritic-collision case
 * (Café/Cafe) resolves to the first match by sort_order.
 */
export function slugify(name: string): string {
  const ascii = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "category";
}

/** Returns the first board category whose slugify(name) matches `slug`. */
export function findCategoryBySlug<T extends { name: string }>(
  categories: T[],
  slug: string,
): T | null {
  for (const c of categories) {
    if (slugify(c.name) === slug) return c;
  }
  return null;
}
