/**
 * Shared scaffold for Claudoro's self-contained HTML pages (D-011).
 *
 * The stats dashboard and the Pomodoro guide are both static, offline,
 * single-file documents that share one visual language. This module is the
 * single source of truth for that language: the escape helper, the tomato
 * theme, the base layout, and the document shell (head + branded header).
 * Page-specific CSS is appended; page-specific markup is passed as the body.
 *
 * Pure: every export is a function of its inputs with no I/O. Every
 * user-supplied string must be run through `escapeHtml` by the caller so a
 * hand-edited label or tag can never inject markup (XSS-safe by construction).
 */

/** Escape a string for safe interpolation into HTML text or attributes. */
export const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * The shared theme + base layout. Page renderers append their own CSS for the
 * widgets unique to them (kpi cards, heatmap, prose, example blocks, etc.).
 */
export const BASE_CSS = `
  :root { --tomato:#e4572e; --ink:#23201e; --muted:#8a817c; --line:#ece8e5; --bg:#faf8f6; --card:#fff; }
  * { box-sizing:border-box; }
  body { margin:0; padding:2rem 1.25rem 4rem; background:var(--bg); color:var(--ink);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:920px; margin:0 auto; }
  header { display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:.5rem; margin-bottom:1.5rem; }
  h1 { font-size:1.5rem; margin:0; }
  h1 .t { color:var(--tomato); }
  .gen { color:var(--muted); font-size:.8rem; }
  section { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:1.25rem 1.5rem; margin-bottom:1.25rem; }
  h2 { font-size:.8rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 1rem; }
  .empty { color:var(--muted); }`;

/**
 * Wrap page content in the complete branded document shell.
 * @param {object} opts
 * @param {string} opts.title - the <title> text (e.g. "Claudoro stats")
 * @param {string} opts.headline - text after the brand in the <h1> (e.g. "focus stats")
 * @param {string} opts.body - the page markup placed inside <div class="wrap">
 * @param {string} [opts.css] - page-specific CSS appended after BASE_CSS
 * @param {string} [opts.generatedAt] - optional timestamp shown top-right
 * @returns {string} a complete, self-contained HTML document
 */
export const htmlDocument = ({ title, headline, body, css = '', generatedAt }) => {
  const gen = generatedAt ? `Generated ${escapeHtml(generatedAt)}` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${BASE_CSS}
${css}
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1><span class="t">&#127813; Claudoro</span> ${escapeHtml(headline)}</h1>
      <span class="gen">${gen}</span>
    </header>
${body}
  </div>
</body>
</html>
`;
};
