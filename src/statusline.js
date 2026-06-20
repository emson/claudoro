/**
 * M3: Per-tick status-line renderer.
 * Called by Claude Code every ~1s via the `statusLine` setting.
 *
 * PERFORMANCE CONTRACT (D-005):
 *   - Read only state.json (no history fold, no lock).
 *   - No subprocess per tick.
 *   - Minimal imports — this module has the tightest cold-start budget.
 *   - Never throw: degrade to passthrough on any error.
 *
 * Input:  Claude Code session JSON on stdin.
 * Output: one line to stdout (the segment plus the passthrough).
 */
import { readState, readPrefs } from './store-read.js';
import { renderSegment } from './render/segment.js';
import { renderPassthrough } from './render/passthrough.js';
import { nowEpoch, cuesDue, overtimeExceeded } from './derive.js';
import { segmentColorMode } from './output.js';

// Hard reset bracketing the whole line. The segment opens with a bare colour
// (e.g. the tomato focus icon's `\x1b[38;5;203m`); without a leading reset that
// foreground can bleed across the statusline→prompt boundary and tint Claude
// Code's input cursor. A trailing reset alone is not enough — the leak is at the
// leading edge. Only inject when colouring, so captured output stays clean (D-008).
const RESET = '\x1b[0m';
const emit = (line) => console.log(segmentColorMode() ? `${RESET}${line}${RESET}` : line);

/**
 * Main entry point — called by `bin/pomo.js` on the statusline fast path.
 */
export const render = async () => {
  const ccJson = await readStdin();
  const columns = parseInt(process.env.COLUMNS ?? '80', 10);

  // Per-pane opt-out: export CLAUDORO_HIDE=1 in a shell to suppress the segment (D-009)
  if (process.env.CLAUDORO_HIDE) {
    const passthrough = renderPassthroughSafe(ccJson);
    if (passthrough) emit(passthrough);
    return;
  }

  try {
    const state = readState();
    const prefs = readPrefs();
    const nowSec = nowEpoch();

    // Opportunistic alarm claim + boundary reconcile (D-009 belt-and-suspenders).
    // Only pay the cost of loading the alarm module on the rare tick where a cue
    // is actually due, or when a held boundary has been forgotten past the
    // abandon threshold and needs auto-closing (D-012), so the common hot path
    // stays cheap (D-005). This backs up the detached one-shot: if it died, the
    // next render fires the cue AND advances (or auto-closes) the phase. A due
    // cue only ever fires once (atomic claim), so this does not spawn per-tick.
    const due = cuesDue(state, nowSec);
    if (due.length > 0 || overtimeExceeded(state, nowSec)) {
      const { claimAlarmIfDue, reconcileAndReschedule } = await import('./alarm.js');
      if (due.length > 0) await claimAlarmIfDue(state).catch(() => {});
      await reconcileAndReschedule().catch(() => {});
    }

    const segment = renderSegment(state, prefs, nowSec, columns);
    const passthrough = renderPassthroughSafe(ccJson, prefs.passthrough);

    if (segment && passthrough) {
      emit(`${segment}  ${passthrough}`);
    } else if (segment) {
      emit(segment);
    } else if (passthrough) {
      emit(passthrough);
    }
  } catch {
    // Never crash the user's status line
    const passthrough = renderPassthroughSafe(ccJson);
    if (passthrough) emit(passthrough);
  }
};

const renderPassthroughSafe = (ccJson, passthrough) => {
  try {
    return renderPassthrough(ccJson, passthrough);
  } catch {
    return '';
  }
};

const readStdin = () =>
  new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (raw += chunk));
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    // Claude Code may close stdin immediately on some platforms
    process.stdin.resume();
    setTimeout(() => resolve({}), 200);
  });
