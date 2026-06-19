/**
 * M9: Stats fold — pure analytics derivation (D-011).
 *
 * `foldStats` turns the immutable record list into one payload that the terminal
 * panel, the HTML dashboard, and `--json` all render from, so the surfaces can
 * never disagree (derive, do not store — D-007).
 *
 * Presentation is LOCAL time while storage stays UTC (D-011): this module buckets
 * by local calendar day and hour (`localDay`/local hour), whereas the log and its
 * file names bucket in UTC (`derive.dateOf`). Kept out of derive.js so the
 * per-tick hot path never loads this heavier cold-path fold.
 *
 * Every function is pure: the clock is read once at the CLI boundary and passed
 * in as `nowSec`. No `Date.now()`, no I/O.
 */
import { shiftDate, creditedMin, wasAbandoned } from './derive.js';
import { parseTags } from './label.js';

export const STATS_SCHEMA = 1;

const HEATMAP_WEEKS = 12; // trailing window shown in the focus heatmap
const TOP_TAGS = 8;
const RECENT = 20; // most-recent focus blocks listed in the dashboard table
const pad2 = (n) => String(n).padStart(2, '0');

/** Local calendar day 'YYYY-MM-DD' for an epoch-seconds timestamp (D-011). */
export const localDay = (epochSec) => {
  const d = new Date(epochSec * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Local hour 0..23 for an epoch-seconds timestamp. */
const localHour = (epochSec) => new Date(epochSec * 1000).getHours();

/** Weekday of a local 'YYYY-MM-DD', Monday = 0 .. Sunday = 6. */
const weekdayMon = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7; // getDay: 0=Sun -> shift to Mon=0
};

const isCompletedFocus = (r) => r.phase === 'focus' && r.status === 'completed';
// Credited focus, capped so a forgotten timer never poisons the stats (D-012).
const focusMinOf = creditedMin;

/**
 * Index completed-focus minutes and counts by local day.
 * @param {object[]} records
 * @returns {Map<string, {focusMin:number, pomodoros:number}>}
 */
const indexByDay = (records) => {
  const byDay = new Map();
  for (const r of records) {
    if (!isCompletedFocus(r)) continue;
    const day = localDay(r.started);
    const acc = byDay.get(day) ?? { focusMin: 0, pomodoros: 0 };
    acc.focusMin += focusMinOf(r);
    acc.pomodoros += 1;
    byDay.set(day, acc);
  }
  return byDay;
};

/** Current streak (consecutive active days ending today/yesterday) and best ever. */
const deriveStreak = (byDay, todayStr) => {
  const active = (day) => byDay.has(day);

  // Current: anchor on today, else yesterday (a one-day grace), then walk back.
  let current = 0;
  const yesterday = shiftDate(todayStr, -1);
  let cursor = active(todayStr) ? todayStr : active(yesterday) ? yesterday : null;
  while (cursor && active(cursor)) {
    current += 1;
    cursor = shiftDate(cursor, -1);
  }

  // Best: longest consecutive run across all active days.
  const days = [...byDay.keys()].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of days) {
    run = prev && shiftDate(prev, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    prev = day;
  }

  return { current, best };
};

/** Build the Monday-aligned heatmap grid for the trailing HEATMAP_WEEKS weeks. */
const buildHeatmap = (byDay, todayStr) => {
  const thisMonday = shiftDate(todayStr, -weekdayMon(todayStr));
  const startMonday = shiftDate(thisMonday, -7 * (HEATMAP_WEEKS - 1));

  let maxFocusMin = 0;
  const grid = [];
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const date = shiftDate(startMonday, w * 7 + d);
      const hit = byDay.get(date);
      const focusMin = hit?.focusMin ?? 0;
      if (date <= todayStr && focusMin > maxFocusMin) maxFocusMin = focusMin;
      week.push({
        date,
        focusMin,
        pomodoros: hit?.pomodoros ?? 0,
        level: 0, // assigned below once the window max is known
        pad: date > todayStr,
      });
    }
    grid.push(week);
  }

  // Assign 1..4 intensity relative to the window max (0 stays 0).
  for (const week of grid) {
    for (const cell of week) {
      cell.level =
        cell.focusMin > 0 && maxFocusMin > 0
          ? Math.min(4, Math.ceil((cell.focusMin / maxFocusMin) * 4))
          : 0;
    }
  }

  return { weeks: grid, maxFocusMin };
};

/** Top tags by focus minutes, parsed from completed-focus labels. */
const deriveTags = (records) => {
  const byTag = new Map();
  for (const r of records) {
    if (!isCompletedFocus(r)) continue;
    for (const tag of parseTags(r.label)) {
      const acc = byTag.get(tag) ?? { tag, focusMin: 0, pomodoros: 0 };
      acc.focusMin += focusMinOf(r);
      acc.pomodoros += 1;
      byTag.set(tag, acc);
    }
  }
  return [...byTag.values()]
    .sort((a, b) => b.focusMin - a.focusMin || b.pomodoros - a.pomodoros)
    .slice(0, TOP_TAGS);
};

/**
 * Fold the records into the stats payload. Pure: same records + now → same output.
 * @param {object[]} records - All PhaseRecords (chronological)
 * @param {number} nowSec - Current epoch seconds (read once at the CLI boundary)
 * @returns {import('./types.js').StatsPayload}
 */
export const foldStats = (records = [], nowSec) => {
  const byDay = indexByDay(records);
  const todayStr = localDay(nowSec);

  let focusMin = 0;
  let pomodoros = 0;
  for (const acc of byDay.values()) {
    focusMin += acc.focusMin;
    pomodoros += acc.pomodoros;
  }

  const week = { pomodoros: 0, focusMin: 0 };
  for (let i = 0; i < 7; i++) {
    const hit = byDay.get(shiftDate(todayStr, -i));
    if (hit) {
      week.pomodoros += hit.pomodoros;
      week.focusMin += hit.focusMin;
    }
  }

  const byHour = Array(24).fill(0);
  const outcomes = { completed: 0, skipped: 0, aborted: 0, partial: 0 };
  for (const r of records) {
    if (r.phase !== 'focus') continue;
    if (r.status in outcomes) outcomes[r.status] += 1;
    if (r.status === 'completed') byHour[localHour(r.started)] += focusMinOf(r);
  }

  const todayHit = byDay.get(todayStr) ?? { focusMin: 0, pomodoros: 0 };

  const recent = records
    .filter((r) => r.phase === 'focus')
    .slice(-RECENT)
    .reverse()
    .map((r) => ({
      started: r.started,
      label: r.label ?? null,
      phase: r.phase,
      status: r.status,
      actualMin: focusMinOf(r),
      abandoned: wasAbandoned(r),
    }));

  return {
    schema: STATS_SCHEMA,
    totals: { focusMin, pomodoros, daysActive: byDay.size },
    today: { pomodoros: todayHit.pomodoros, focusMin: todayHit.focusMin },
    week,
    streak: deriveStreak(byDay, todayStr),
    heatmap: buildHeatmap(byDay, todayStr),
    tags: deriveTags(records),
    byHour,
    outcomes,
    recent,
  };
};
