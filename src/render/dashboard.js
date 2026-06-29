/**
 * M9: Self-contained HTML dashboard renderer (D-011).
 *
 * Pure: (payload) => a complete static HTML document string. No client JS, no
 * network, no CDN — it renders offline forever and is a rebuildable artifact.
 * Every user-supplied string (labels, tags) is HTML-escaped, so a hand-edited
 * label can never inject markup (XSS-safe by construction).
 *
 * The shared theme, escape helper, and document shell live in html-shell.js so
 * this dashboard and the Pomodoro guide cannot drift apart visually.
 */

import { escapeHtml, htmlDocument } from './html-shell.js';
import { formatFocusMin as fmtFocus } from '../derive.js';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Epoch seconds as a local "12 Jun 09:00". */
const fmtWhen = (epochSec) => {
  const d = new Date(epochSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${hh}:${mm}`;
};

const STATUS_WORD = {
  completed: 'done',
  skipped: 'skipped',
  aborted: 'stopped',
  partial: 'partial',
};

// Tomato-branded intensity ramp for the heatmap (level 0..4); 0 is the empty track.
const HEAT = ['#f1efed', '#f9d2c4', '#f3a183', '#e4572e', '#b8341a'];

const kpiCard = (label, value, sub = '') => `
      <div class="kpi">
        <div class="kpi-value">${escapeHtml(value)}</div>
        <div class="kpi-label">${escapeHtml(label)}</div>
        ${sub ? `<div class="kpi-sub">${escapeHtml(sub)}</div>` : ''}
      </div>`;

const heatmapCells = (weeks) =>
  weeks
    .flatMap((week) =>
      week.map((cell) => {
        if (cell.pad) return `<span class="cell pad"></span>`;
        const title = `${cell.date}: ${cell.pomodoros} done, ${fmtFocus(cell.focusMin)}`;
        return `<span class="cell" style="background:${HEAT[cell.level]}" title="${escapeHtml(title)}"></span>`;
      }),
    )
    .join('');

const tagRows = (tags) => {
  if (tags.length === 0) return `<p class="empty">No tags yet.</p>`;
  const max = Math.max(...tags.map((t) => t.focusMin), 1);
  return tags
    .map(
      (t) => `
      <div class="bar-row">
        <span class="bar-label">${escapeHtml(t.tag)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(t.focusMin / max) * 100}%"></span></span>
        <span class="bar-value">${escapeHtml(fmtFocus(t.focusMin))}</span>
      </div>`,
    )
    .join('');
};

const recentRows = (recent) => {
  if (recent.length === 0) return `<p class="empty">No sessions yet.</p>`;
  const body = recent
    .map(
      (r) => `
        <tr>
          <td class="when">${escapeHtml(fmtWhen(r.started))}</td>
          <td class="dur">${escapeHtml(fmtFocus(r.actualMin))}${r.abandoned ? ` <span class="aband">abandoned</span>` : ''}</td>
          <td class="st st-${escapeHtml(r.status)}">${escapeHtml(STATUS_WORD[r.status] ?? r.status)}</td>
          <td class="lbl">${escapeHtml(r.label ?? '')}</td>
        </tr>`,
    )
    .join('');
  return `<table class="recent"><tbody>${body}</tbody></table>`;
};

const hourBars = (byHour) => {
  const max = Math.max(...byHour, 1);
  return byHour
    .map((min, h) => {
      const pct = (min / max) * 100;
      const title = `${String(h).padStart(2, '0')}:00 · ${fmtFocus(min)}`;
      return `<span class="hbar" style="height:${Math.max(2, pct)}%" title="${escapeHtml(title)}"></span>`;
    })
    .join('');
};

// Widgets unique to the dashboard; the shared theme lives in html-shell.js.
const DASHBOARD_CSS = `
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:1rem; }
  .kpi { padding:.25rem 0; }
  .kpi-value { font-size:1.9rem; font-weight:650; line-height:1.1; }
  .kpi-label { color:var(--muted); font-size:.82rem; margin-top:.15rem; }
  .kpi-sub { color:var(--muted); font-size:.75rem; }
  .heatmap { display:grid; grid-template-rows:repeat(7,14px); grid-auto-flow:column; gap:3px; overflow-x:auto; padding-bottom:.25rem; }
  .cell { width:14px; height:14px; border-radius:3px; }
  .cell.pad { background:transparent; }
  .legend { display:flex; align-items:center; gap:.4rem; color:var(--muted); font-size:.75rem; margin-top:.75rem; }
  .legend .cell { width:12px; height:12px; }
  .bar-row { display:grid; grid-template-columns:120px 1fr 64px; align-items:center; gap:.6rem; margin:.35rem 0; }
  .bar-label { font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .bar-track { background:var(--line); border-radius:5px; height:10px; }
  .bar-fill { display:block; height:100%; background:var(--tomato); border-radius:5px; }
  .bar-value { color:var(--muted); font-size:.82rem; text-align:right; }
  .hours { display:flex; align-items:flex-end; gap:2px; height:90px; }
  .hbar { flex:1; background:var(--tomato); border-radius:2px 2px 0 0; opacity:.85; min-height:2px; }
  .hours-axis { display:flex; justify-content:space-between; color:var(--muted); font-size:.7rem; margin-top:.35rem; }
  .outcomes { display:flex; gap:1.5rem; flex-wrap:wrap; }
  .outcomes b { font-weight:650; }
  table.recent { width:100%; border-collapse:collapse; font-size:.88rem; }
  table.recent td { padding:.4rem .5rem; border-bottom:1px solid var(--line); }
  table.recent tr:last-child td { border-bottom:none; }
  td.when { color:var(--muted); white-space:nowrap; }
  td.dur { font-variant-numeric:tabular-nums; white-space:nowrap; }
  td.st { font-size:.78rem; }
  td.st-completed { color:#2f8f4e; }
  td.st-skipped { color:#b8860b; }
  td.st-aborted { color:#b8341a; }
  td.lbl { width:100%; }
  .aband { color:var(--muted); font-size:.72rem; border:1px solid var(--line); border-radius:4px; padding:0 .3rem; }`;

/**
 * Render the dashboard.
 * @param {import('../types.js').StatsPayload} p
 * @param {{ generatedAt?: string }} [opts]
 * @returns {string} a complete HTML document
 */
export const renderStatsHtml = (p, opts = {}) => {
  const { totals, today, week, streak, outcomes } = p;

  const body = `
    <section>
      <h2>Overview</h2>
      <div class="kpis">
${kpiCard('Total focus', fmtFocus(totals.focusMin))}
${kpiCard('Pomodoros', String(totals.pomodoros))}
${kpiCard('Active days', String(totals.daysActive))}
${kpiCard('Current streak', `${streak.current} day${streak.current === 1 ? '' : 's'}`, `best ${streak.best}`)}
${kpiCard('Today', `${today.pomodoros} done`, fmtFocus(today.focusMin))}
${kpiCard('This week', `${week.pomodoros} done`, fmtFocus(week.focusMin))}
      </div>
    </section>

    <section>
      <h2>Focus heatmap &middot; last 12 weeks</h2>
      <div class="heatmap">${heatmapCells(p.heatmap.weeks)}</div>
      <div class="legend">less
        <span class="cell" style="background:${HEAT[0]}"></span>
        <span class="cell" style="background:${HEAT[1]}"></span>
        <span class="cell" style="background:${HEAT[2]}"></span>
        <span class="cell" style="background:${HEAT[3]}"></span>
        <span class="cell" style="background:${HEAT[4]}"></span>more
      </div>
    </section>

    <section>
      <h2>Top tags</h2>
      ${tagRows(p.tags)}
    </section>

    <section>
      <h2>Focus by hour of day</h2>
      <div class="hours">${hourBars(p.byHour)}</div>
      <div class="hours-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
    </section>

    <section>
      <h2>Outcomes</h2>
      <div class="outcomes">
        <span><b>${outcomes.completed}</b> completed</span>
        <span><b>${outcomes.skipped}</b> skipped</span>
        <span><b>${outcomes.aborted}</b> stopped</span>
        ${outcomes.partial ? `<span><b>${outcomes.partial}</b> partial</span>` : ''}
      </div>
    </section>

    <section>
      <h2>Recent sessions</h2>
      ${recentRows(p.recent ?? [])}
    </section>`;

  return htmlDocument({
    title: 'Claudoro stats',
    headline: 'focus stats',
    css: DASHBOARD_CSS,
    body,
    generatedAt: opts.generatedAt,
  });
};
