# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-06-29

### Added
- Abandoned-time handling (D-012): a forgotten timer (slept / walked away) finalized by `stop` or
  `next` long past its end now credits focus only up to `planned + max_overtime` (default 30 min)
  and flags the record `abandoned`, keeping the true span in `started`/`ended`. Aggregates apply the
  same cap at read time (`derive.creditedMin`), so stats are robust to existing and hand-edited
  records with no migration. `pomo stop --full` records the true elapsed for a genuine marathon;
  `pomo start --max-overtime N` tunes the threshold. `pomo log` shows abandoned blocks honestly.
  A waiting boundary (manual/balanced) left in overtime past the same threshold now auto-closes to
  idle (keeping full planned credit) instead of showing `+overtime` indefinitely.
- `pomo stats` (M9, D-011): derived analytics folded from the immutable log on read — current and
  best day-streak, a 12-week focus heatmap, top tags, focus-by-hour, and the outcome mix. Renders
  three ways from one pure `foldStats` payload: a terminal panel (default), a self-contained,
  dependency-free HTML dashboard (`--web`, opened in the browser), and stable JSON (`--json`).
  Times are presented in local time while the log stays UTC.
- Initial scaffold: project structure, platform layer (paths, lock, notify), M1 store + derive
  foundation, M2 timer engine, M3 renderer, M4 alarm, M5 history, M6 output, M7 setup, M8 plugin.
- `store.applyTransition` runs a pure timer transition under the lock and reports
  `{ changed, state, prev, record }` so callers drive side effects explicitly.
- `derive.cuesDue` is a pure, dependency-free alarm-due check for the hot path.
- JSDoc domain types in `src/types.js`, checked by `tsc --checkJs` (`npm run typecheck`).
- OSS hygiene: `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, Dependabot, a
  provenance-signed release workflow, and CI across Node 22/24 on macOS/Linux/Windows.
- `pomo back` verb: within a configurable window (default 2 min), undoes the last phase
  transition by restoring a `back_checkpoint` snapshot captured at every auto-advance.
- `pomo log` with full subcommand support: `--today` (default), `--date YYYY-MM-DD`,
  `log open` (open today's JSONL in `$EDITOR`), and `log backups` (list available backups).
  Pretty table on a TTY; clean plain text when captured.
- `pomo undo [N]` with `--dry-run`, `--yes`, and `--json` flags. Unconditional backup written
  before any record is removed; aggregates are re-derived from the trimmed log automatically.
- `pomo restore [backup-id]` lists backups when no id is given, then restores the chosen one
  after a safety backup of the current log.
- `renderStatus` in `output.js` now renders a rich multi-line TTY block showing phase, time
  remaining, progress bar, today's stats, label, mode, view, and mute state. Plain text when
  not on a TTY.
- `cmdStatus` now folds real aggregates from the daily JSONL via `derive.foldRecords` instead
  of hard-coding zeroes.
- Per-verb help pages in `output.js` (`renderCommandHelp`) with USAGE, FLAGS, EXAMPLES, and
  NOTES sections for every CLI verb. Tested for em-dash absence and ANSI stripping.
- Linux audio in `platform/notify.js`: tries `paplay` then `aplay` then `ffplay` before
  falling back to terminal bell.
- Windows audio in `platform/notify.js`: PowerShell `[console]::beep` with per-cue frequency
  and duration mappings, falling back to terminal bell.

### Fixed
- `statusLine` is now written as the correct object form with `refreshInterval` nested inside it
  (idle ticking previously could not engage).
- Status-line passthrough reads `context_window.used_percentage` (the real stdin field), with
  fallbacks for older shapes.
- Transition modes (`auto`/`balanced`/`manual`) now read `state.mode` instead of a non-existent
  `config.mode`, so they actually take effect.
- `start` correctly reports an already-running block instead of re-scheduling and double-starting.
- `extend` reschedules the alarm so it fires at the new end time.
- Single shared atomic `claimCue` dedupes the detached worker against the render-claim (no
  double alarm across sessions).
- Backups are pruned to the last K; read-only/absent HOME degrades to `TMPDIR`.
- OS notifications now escape the label safely, so a session label containing a quote or
  apostrophe no longer breaks the macOS (`osascript`) or Windows (PowerShell) notification.

### Changed
- Minimum Node bumped to 22 (Node 20 reached end of life).

[Unreleased]: https://github.com/emson/claudoro/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/emson/claudoro/releases/tag/v0.1.0
