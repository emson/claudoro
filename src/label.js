/**
 * M1: label + tag text transforms (pure).
 *
 * A record carries a single free-text `label`. Notes append prose to it; tags
 * are `#kebab` tokens embedded in that same label, parsed back out at read time
 * (derive, do not store, D-007). There is no separate tags field, so undo and
 * restore stay correct by construction and the dashboard groups by parsing
 * `#tags` from the label string.
 *
 * Every function here is total and pure: a missing/empty label is the empty
 * string, never a throw.
 */

/**
 * Append text to an existing label, space-joined, with no leading space when the
 * label was empty. Trims both sides so repeated appends never accumulate gaps.
 * @param {string|null|undefined} existing
 * @param {string|null|undefined} addition
 * @returns {string}
 */
export const appendText = (existing, addition) => {
  const base = (existing ?? '').trim();
  const add = (addition ?? '').trim();
  if (!add) return base;
  return base ? `${base} ${add}` : add;
};

/**
 * Normalise a raw tag to a canonical `#kebab-case` token, or null if it reduces
 * to nothing. Strips any leading `#`, lowercases, collapses runs of
 * non-alphanumeric characters to a single `-`, and trims stray dashes. This is
 * what makes grouping reliable: `Code Review`, `code_review`, and `#code-review`
 * all land on `#code-review`.
 * @param {unknown} raw
 * @returns {string|null}
 */
export const normalizeTag = (raw) => {
  const slug = String(raw ?? '')
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `#${slug}` : null;
};

/**
 * Extract the `#tag` tokens present in a label, lowercased, in order.
 * @param {string|null|undefined} label
 * @returns {string[]}
 */
export const parseTags = (label) => {
  const matches = String(label ?? '').match(/#[a-z0-9-]+/gi) ?? [];
  return matches.map((t) => t.toLowerCase());
};

/**
 * Append normalised tags to a label, skipping any already present (dedupe is
 * case-insensitive via normaliseTag). Returns the new label plus the tags that
 * were actually added, so the caller can report exactly what changed.
 * @param {string|null|undefined} existing
 * @param {string[]} names
 * @returns {{ label: string, added: string[] }}
 */
export const addTags = (existing, names) => {
  const present = new Set(parseTags(existing));
  const added = [];
  let label = (existing ?? '').trim();
  for (const name of names ?? []) {
    const tag = normalizeTag(name);
    if (!tag || present.has(tag)) continue;
    present.add(tag);
    added.push(tag);
    label = label ? `${label} ${tag}` : tag;
  }
  return { label, added };
};
