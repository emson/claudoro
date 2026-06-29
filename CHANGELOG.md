# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `pomo version` (also `--version` / `-v`): print the installed package version.

### Fixed
- Cycle dots now reset each day. The cadence is derived over today's records only (scoped to your
  local midnight), so a fresh day starts at ○○○○ instead of carrying a saturated count across days.
  A within-day long break still resets the set as before; blocks are bucketed by start time
  (consistent with the rest of the day-bucketing), so one straddling midnight counts toward the day
  it began. Derived, not stored, so it self-corrects with no migration.
- `pomo log open` no longer crashes on a missing or multi-word `$EDITOR` (e.g. `code -w`); it
  degrades to printing the file path, matching the no-`$EDITOR` branch.
- `dateOf` is now a total function: a hand-edited or partial record with a missing/garbage
  `started` buckets to the epoch instead of throwing `Invalid time value`, so one bad record can no
  longer crash `pomo status` or an undo.
- `readState` merges a valid-but-partial state over the idle defaults, so an older-schema or
  hand-edited file cannot feed `undefined` into the time math (no more `NaN` on the render path).
- `pomo uninstall` now stops a running timer first (idle + bumped `alarm_seq`), so the detached
  alarm worker self-exits and the headless timer cannot survive teardown or `--purge`.
- `setup` no longer captures its own status line as `previous` when re-run after a lost manifest,
  and reports honestly (no false success) when `settings.json` is unparseable; both made uninstall
  unable to cleanly remove the wiring before.
- Help/log/restore columns now align on a color TTY (column width measures visible glyphs, not the
  invisible ANSI bytes).
- `statusline` handles an exported-but-empty `COLUMNS=''` (was `NaN`, which dropped the bar/dots).
- OS notifications strip control characters from the label, so a label with a newline no longer
  silently loses the notification on macOS.
- `pomo kill-all` tightens the worker `pkill` pattern (anchored on `node ... _alarm-worker.js`, so
  it cannot match an editor/grep open on the file) and reports honestly on Windows (workers
  self-exit via the `alarm_seq` bump, which is the actual cross-platform mechanism).

### Changed
- One shared focus-duration formatter (`derive.formatFocusMin`) feeds both the terminal stats panel
  and the HTML dashboard, so the two surfaces cannot drift; `foldRecords` no longer derives a
  divergent (and unused) cycle position, leaving `deriveCadence` the single source for the dots.
- Documentation consistency sweep: README marks the package as published, documents the
  `note`/`tag`/`label`/`version` verbs and the `CLAUDORO_EMOJI`/`CLAUDORO_LINKS` env vars (and drops
  the unimplemented `CLAUDORO_MOTION`); the `pomo help` index lists `note`/`tag`/`guide`; the
  decisions range is D-001..D-012; `plugin.json` tracks the package version; the release workflow
  pins the same `actions/checkout` as CI; and the changelog headings use hyphens (house rule).

## [0.1.3] - 2026-06-29

### Added
- README screenshots of the web guide and the web stats dashboard, shown in the "Learn the
  technique" and "Stats and dashboard" sections. The images live in `docs/images/` (versioned with
  the docs, kept out of the npm tarball); npm rewrites the relative paths to GitHub for the package
  page, so they render in both places without bloating the published package.
- Author and project links (website, X/@emson, GitHub repo): a README "Author" section, an enriched
  npm `author` field, and a shared footer on the web guide and stats dashboard pages (added once in
  `render/html-shell.js`, so both pages stay consistent). The footer uses inert anchors, so the
  pages remain self-contained and offline.

### Fixed
- `pomo guide` linked to a Pomodoro Technique reference URL that 404'd; pointed it at the official
  site (`https://www.pomodorotechnique.com/`).

## [0.1.2] - 2026-06-29

### Added
- `pomo uninstall --purge` (M7): optionally delete the data dir (history, stats, backups, timer
  state) as part of uninstall. Irreversible and gated behind `--yes`; without it, prints a dry run
  of exactly what would be removed, mirroring `pomo undo`.

### Changed
- `pomo uninstall` is now plugin-aware: it reads Claude Code's plugin registry and warns when a
  Claudoro plugin is installed, because the plugin's SessionStart hook would otherwise re-wire on
  the next session unless the plugin is also removed via `/plugin`. The README "Uninstall" section
  now documents the full layered, ordered teardown (plugin, then wiring, then binary, then data).

## [0.1.1] - 2026-06-29

### Added
- `pomo guide` (M10): a standalone Pomodoro Technique guide tailored to Claudoro, rendered three
  ways from one static content model — a terminal panel (default), a self-contained HTML page
  (`--web`) styled like the stats dashboard, and stable JSON (`--json`). Covers the method, the
  rules that make it work, handling interruptions, edge cases mapped to Claudoro features, cadence
  tuning, and references.
- Maintainer docs: `RELEASING.md` (the release runbook, including the provenance publish flow),
  `ROADMAP.md`, and a "Maintaining & releasing" section in `CLAUDE.md`. `CONTRIBUTING.md` gains the
  M9/M10 module map and a docs-update checklist; `SECURITY.md` notes provenance-signed releases.

### Changed
- Extracted the shared HTML theme and document shell into `render/html-shell.js`, now used by both
  the stats dashboard and the guide, so the two pages cannot drift visually.

### Fixed
- Release workflow pinned a non-existent `actions/checkout@v7`, which would have failed every tag
  publish; corrected to `@v4` (matching the earlier CI workflow fix).

## [0.1.0] - 2026-06-29

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

[Unreleased]: https://github.com/emson/claudoro/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/emson/claudoro/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/emson/claudoro/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/emson/claudoro/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/emson/claudoro/releases/tag/v0.1.0
