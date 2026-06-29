/**
 * M10: Self-contained HTML renderer for the Pomodoro guide (D-011).
 *
 * Pure: (GUIDE) => a complete static HTML document string. It shares the theme
 * and document shell with the stats dashboard (html-shell.js), so the two pages
 * are visually one product. No client JS and no external resources, so it
 * renders offline forever; reference hyperlinks are inert anchors, not loads.
 * Every content string is escaped (house rule, even though the content is ours).
 */
import { escapeHtml, htmlDocument } from './html-shell.js';

// Widgets unique to the guide; the shared theme lives in html-shell.js.
const GUIDE_CSS = `
  .lead { color:var(--muted); font-size:1.02rem; margin:-.5rem 0 1.5rem; }
  section p { margin:.7rem 0; }
  section p:first-of-type { margin-top:0; }
  ol, ul { margin:.6rem 0; padding-left:1.4rem; }
  li { margin:.35rem 0; }
  .ex { margin:.75rem 0; }
  .ex code { display:inline-block; background:#f3efec; border:1px solid var(--line); border-radius:6px;
    padding:.18rem .55rem; font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--ink); }
  .ex .d { color:var(--muted); font-size:.9rem; margin-top:.3rem; }
  .case { margin:.85rem 0; padding-left:.9rem; border-left:3px solid var(--tomato); }
  .case .w { font-weight:600; }
  .case .f { color:var(--muted); margin-top:.25rem; }
  .refs li { margin:.55rem 0; }
  .refs a { color:var(--tomato); text-decoration:none; }
  .refs a:hover { text-decoration:underline; }
  .refs .u { display:block; color:var(--muted); font-size:.8rem; word-break:break-all; }`;

const paras = (arr) => (arr ?? []).map((p) => `      <p>${escapeHtml(p)}</p>`).join('\n');

const steps = (arr) =>
  arr?.length
    ? `      <ol>${arr.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`
    : '';

const bullets = (arr) =>
  arr?.length
    ? `      <ul>${arr.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
    : '';

const examples = (arr) =>
  (arr ?? [])
    .map(
      (ex) => `
      <div class="ex">
        <code>${escapeHtml(ex.cmd)}</code>
        <div class="d">${escapeHtml(ex.desc)}</div>
      </div>`,
    )
    .join('');

const cases = (arr) =>
  (arr ?? [])
    .map(
      (c) => `
      <div class="case">
        <div class="w">${escapeHtml(c.when)}</div>
        <div class="f">${escapeHtml(c.fix)}</div>
      </div>`,
    )
    .join('');

const section = (s) =>
  `
    <section>
      <h2>${escapeHtml(s.heading)}</h2>
${[
  paras(s.body),
  steps(s.steps),
  bullets(s.bullets),
  examples(s.examples),
  cases(s.cases),
  paras(s.body2),
]
  .filter(Boolean)
  .join('\n')}
    </section>`;

const referencesSection = (refs) =>
  `
    <section class="refs">
      <h2>References</h2>
      <ul>
${refs
  .map(
    (r) =>
      `        <li>${escapeHtml(r.text)}<span class="u"><a href="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a></span></li>`,
  )
  .join('\n')}
      </ul>
    </section>`;

/**
 * Render the guide as a complete, self-contained HTML document.
 * @param {import('../guide.js').GUIDE} g
 * @param {{ generatedAt?: string }} [opts]
 * @returns {string}
 */
export const renderGuideHtml = (g, opts = {}) => {
  const body = `
    <p class="lead">${escapeHtml(g.intro)}</p>
${g.sections.map(section).join('\n')}
${referencesSection(g.references)}`;

  return htmlDocument({
    title: 'Claudoro guide',
    headline: 'Pomodoro guide',
    css: GUIDE_CSS,
    body,
    generatedAt: opts.generatedAt,
  });
};
