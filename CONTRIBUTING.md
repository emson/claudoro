# Contributing to Claudoro

Thank you for your interest in contributing.

## Before you start

Read `specs/spec.md` and `specs/decisions.md`. The spec defines the modules (M1-M8) and
acceptance tests. The decisions log explains *why* the design is the way it is. A PR that
contradicts a decision without opening a new decision entry will not be merged.

## Development setup

```bash
node --version   # must be >= 22 (Node 20 is EOL)
npm install
npm run check    # lint + format:check + typecheck + test (the full CI gate)
```

No build step. ESM throughout, Node stdlib only (zero runtime dependencies). Types are JSDoc,
checked by `tsc --checkJs` via `npm run typecheck`.

## How the code is structured

Each `src/` file maps to a spec module:

| File | Module | Role |
|---|---|---|
| `src/platform/paths.js` | M1 | XDG/Windows path resolution (pure) |
| `src/platform/lock.js` | M1 | Atomic file locking |
| `src/platform/notify.js` | M4 | Cross-platform sound/notification |
| `src/store.js` | M1 | Atomic state read/write; `applyTransition` |
| `src/derive.js` | M1 | Aggregate derivation + time math (pure) |
| `src/types.js` | — | JSDoc domain types (LiveState, PhaseRecord, Config, Prefs) |
| `src/cli.js` | M1 | Arg parsing and verb dispatch |
| `src/timer.js` | M2 | Phase state machine and cadence |
| `src/statusline.js` | M3 | Per-tick status-line renderer |
| `src/alarm.js` | M4 | Detached one-shot alarm |
| `src/history.js` | M5 | JSONL records, undo, restore, backups |
| `src/output.js` | M6 | TTY-aware help and output rendering |
| `src/setup.js` | M7 | Claude Code wiring and uninstall |
| `src/render/segment.js` | M3 | Status-line segment composition |
| `src/render/passthrough.js` | M3 | Model/context/git passthrough |

## Code style

- Functional-first: small pure functions composed into behaviour.
- Pure core, impure edges: side effects (I/O, spawning, clock) stay at the boundary.
- Data in, data out: functions take plain values and return plain values.
- Immutable updates: `{...state, field: value}`, never in-place mutation.
- Comments only for the non-obvious *why*.

## Adding a new verb

1. Add a handler function in `src/cli.js`.
2. Register it in the `VERBS` map.
3. Add the state-machine logic to `src/timer.js` (if it mutates phase state).
4. Write a test in `test/m2-timer.test.js` (or the appropriate module test).

## Submitting a PR

- One logical change per PR.
- Include a test for any new behaviour path or error condition.
- If your change affects the spec or a prior decision, update the relevant file and note it in the PR description.
- Run `npm test && npm run lint` before opening.

## Decisions

Architecture decisions live in `specs/decisions.md`. If you are proposing something that
contradicts or extends a decision, open a discussion issue first.
