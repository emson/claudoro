/**
 * M3: Status-line segment composition.
 * Pure function: (state, prefs, nowSec, columns) => string.
 * No I/O, no side effects — trivially testable.
 *
 * View modes (D-004):
 *   minimal  — icon + MM:SS + bar
 *   classic  — + cycle dots (default)
 *   full     — + the session label (when set and width allows)
 */
import {
  remaining,
  formatMMSS,
  isOvertime,
  overtimeSec,
  progressFraction,
} from '../derive.js';
import { ICONS, seg, segmentColorMode } from '../output.js';

// ---------------------------------------------------------------------------
// Phase color selection
// ---------------------------------------------------------------------------

const phaseColor = (phase) => {
  if (phase === 'focus') return seg.tomato;
  if (phase === 'long_break') return seg.teal;
  return seg.amber; // short_break
};

/**
 * Progress-bar fill color, keyed to run STATE rather than phase alone: red while
 * focusing, yellow while paused (paused takes precedence over the phase), green
 * while resting in either break. Paired with a dim track per D-006 (fill carries
 * the color, the track recedes).
 */
export const barColor = (state) => {
  if (state.run_state === 'paused') return seg.amber;
  if (state.phase === 'focus') return seg.tomato;
  return seg.grass; // short_break or long_break: resting
};

// ---------------------------------------------------------------------------
// Sub-cell progress bar (D-006)
// Advances visibly only every ~15s to stay serene. Never animates per-tick.
// ---------------------------------------------------------------------------

const EIGHTHS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
const TRACK = '░';
const FRAME_L = '▕';
const FRAME_R = '▏';
const BAR_WIDTH = 10;

/**
 * Render the sub-cell bar. `fillColor` tints the filled portion (the leading
 * edge included); the frame and empty track stay dim (D-006). Defaults to no
 * color so unit tests can assert on the raw glyphs/width.
 *
 * @param {number} fraction - 0..1 elapsed
 * @param {(s: string) => string} [fillColor]
 */
export const renderBar = (fraction, fillColor = (s) => s) => {
  const quantized = Math.round(fraction * BAR_WIDTH * 8) / 8;
  const full = Math.floor(quantized);
  const eighth = Math.round((quantized - full) * 8);

  const filled = EIGHTHS[7].repeat(full);
  const partial = eighth > 0 ? EIGHTHS[eighth - 1] : '';
  const fill = filled + partial;
  const empty = TRACK.repeat(Math.max(0, BAR_WIDTH - full - (partial ? 1 : 0)));

  return (
    seg.dim(FRAME_L) +
    (fill ? fillColor(fill) : '') +
    (empty ? seg.dim(empty) : '') +
    seg.dim(FRAME_R)
  );
};

// ---------------------------------------------------------------------------
// Cycle dots: e.g. ●●○○ for 2 of 4 done
// ---------------------------------------------------------------------------

export const renderDots = (setIndex, frequency) => {
  const done = Math.min(setIndex, frequency);
  const total = Math.max(frequency, 1);
  return '●'.repeat(done) + '○'.repeat(total - done);
};

// ---------------------------------------------------------------------------
// Segment assembly
// ---------------------------------------------------------------------------

/**
 * Compose the Claudoro status-line segment.
 *
 * @param {object} state - Current live state
 * @param {object} prefs - User prefs (view, motion, etc.)
 * @param {number} nowSec - Current epoch seconds (inject for testability)
 * @param {number} columns - Terminal width
 * @returns {string} The rendered segment (may be empty string when idle)
 */
export const renderSegment = (state, prefs = {}, nowSec, columns = 80) => {
  if (state.run_state === 'idle') return '';

  const view = prefs.view ?? 'classic';
  const overtime = isOvertime(state, nowSec);

  const icon =
    state.run_state === 'paused'
      ? ICONS.paused()
      : (ICONS[state.phase]?.() ?? ICONS.focus());

  const remSec = overtime ? -overtimeSec(state, nowSec) : (remaining(state, nowSec) ?? 0);
  const timeStr = (overtime ? '+' : '') + formatMMSS(Math.abs(remSec));

  // Paused takes precedence over the phase: the icon goes amber (yellow) to
  // match the paused bar fill (barColor), so a paused focus block never shows
  // the focus red. Pause recedes (D-006).
  const colorFn = state.run_state === 'paused' ? seg.amber : phaseColor(state.phase);
  const colonChar = ':'; // solid separator; motion shows only in the countdown numbers

  const timeParts = timeStr.split(':');
  const time =
    timeParts.length === 2 ? `${timeParts[0]}${colonChar}${timeParts[1]}` : timeStr;

  const fraction = progressFraction(state, nowSec);

  // Build the segment progressively, dropping fields as width decreases (D-006)
  const parts = [colorFn(icon), segmentColorMode() ? seg.bold(time) : time];

  if (columns >= 40) parts.push(renderBar(fraction, barColor(state)));

  // Text elements render at normal intensity (not dim), to match the prompt
  // line's brightness; color is reserved as an accent on the icon and bar fill.
  if (view === 'classic' || view === 'full') {
    if (columns >= 52) {
      parts.push(renderDots(state.set_index, state.config?.frequency ?? 4));
    }
  }

  if (view === 'full' && state.label && columns >= 70) {
    const maxLabel = Math.min(20, columns - 60);
    const label =
      state.label.length > maxLabel
        ? state.label.slice(0, maxLabel - 1) + '…'
        : state.label;
    parts.push(label);
  }

  return parts.join(' ');
};
