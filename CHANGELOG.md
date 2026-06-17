# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial scaffold: project structure, platform layer (paths, lock, notify), M1 store + derive
  foundation, M2 timer engine, M3 renderer, M4 alarm, M5 history, M6 output, M7 setup, M8 plugin.
- `store.applyTransition` — runs a pure timer transition under the lock and reports
  `{ changed, state, prev, record }` so callers drive side effects explicitly.
- `derive.cuesDue` — pure, dependency-free alarm-due check for the hot path.
- JSDoc domain types in `src/types.js`, checked by `tsc --checkJs` (`npm run typecheck`).
- OSS hygiene: `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, Dependabot, a
  provenance-signed release workflow, and CI across Node 22/24 on macOS/Linux/Windows.

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

### Changed
- Minimum Node bumped to 22 (Node 20 reached end of life).
