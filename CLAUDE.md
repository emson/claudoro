# Claudoro

A Pomodoro timer that lives inside the Claude Code terminal: a live, ticking countdown in the
status line plus a render-decoupled end-of-block alarm. Open source, distributed as
`npm install -g claudoro` with a thin Claude Code plugin wrapper.

**Read first:** `specs/spec.md` (architecture, modules, data model, acceptance tests) and
`specs/decisions.md` (D-001..D-009, the authoritative rationale). The spec supersedes
`specs/charter.md` where they disagree. When in doubt, the decisions log wins.

## Core principle

> The code must always be **robust, flexible, and elegant.**

One architectural truth underpins everything (D-001): **the `pomo` CLI is the single source of
truth.** It owns all state, scheduling, and history. The status line, the `/pomo` command, and the
alarm are thin surfaces over it. The CLI runs with zero model involvement, so the core feature never
costs API tokens.

A second truth makes mutation safe (D-007): **derive, do not store, aggregates.** Counts, cycle
position, focus minutes, and streaks are folded from immutable records on read. There are no mutable
counters, so `undo`/`restore` are correct by construction.

## How we write code

Functional-first, composition over cleverness. Favour small, pure, well-named functions composed
into larger behaviour. Avoid complex code; if a function is hard to name or test, split it.

- **Pure core, impure edges.** Keep logic (timer math, derivation, rendering, formatting) as pure
  functions of their inputs. Push side effects (file I/O, `flock`, `spawn`, clock, stdout) to a thin
  boundary layer. A function reads the clock once and passes `now` down; it does not call
  `Date.now()` deep in a fold.
- **Compose, don't branch-pile.** Build a verb from discrete subfunctions
  (`resolvePaths → readState → mutate → writeAtomic`), not one long procedure. Prefer
  `map`/`filter`/`reduce` and data transformation over imperative mutation.
- **Data in, data out.** Functions take plain values and return plain values. Immutable updates
  (`{...state, run_state: 'paused'}`), no in-place mutation of shared objects.
- **Total functions.** Handle the empty/missing/corrupt case in the function, not at the call site.
  Missing state → `idle`; corrupt JSON → quarantine + reinit; never throw on the render path.
- **Explicit over implicit.** No hidden globals, no ambient singletons. Dependencies (paths, clock,
  fs) are passed in, which also makes them trivially mockable in tests.
- **Small modules with one job**, mirroring the spec's M1..M8. A file should fit in your head.

## Project conventions

- **Runtime:** Node ≥ 22 (20 is EOL), ES modules, no transpiler. Cross-platform via Node stdlib
  (`path`, `os`, `fs`, `child_process`) — identical code on macOS, Linux, Windows (D-005).
- **Dependencies:** zero runtime dependencies. Node stdlib only for core. Justify any new dev
  dependency in a PR; a tiny helper we can write ourselves beats a transitive tree. No `jq`, no
  shelling out for what Node can do in-process.
- **Types:** plain JS, typed via JSDoc and checked with `tsc --checkJs` (no build step). Domain
  shapes live in one place, `src/types.js`; reference them with `@typedef {import('./types.js')...}`.
- **No em-dashes in any content output** (use commas, colons, parentheses, or restructure).
- **Style:** match surrounding code. Descriptive names, early returns over nesting, comments only
  for the non-obvious *why*. Run the formatter/linter before committing.
- **Errors:** fail loud at the CLI boundary (clear message, non-zero exit); fail safe on the render
  path (degrade to passthrough or last-known, never crash the user's status line).

## Architecture map (see spec for detail)

```
Claude Code ──~1s, JSON on stdin──▶ pomo statusline ──read──▶ state.json
     │ /pomo → !`pomo $ARGUMENTS`          │ opportunistic        ▲ atomic
     ▼                                     ▼ alarm-claim          │ write (flock)
 user input ───────────────────────▶ pomo <verb> ──mutate──▶ state.json
                                            │ spawn detached      │ finalize phase
                                            ▼                     ▼
                                     alarm one-shot        logs/YYYY-MM-DD.jsonl
                                     (sleep→sound)         (immutable records)
```

| Module | Responsibility |
|---|---|
| **M1 CLI core & store** | argv dispatch; locked (`flock`) atomic read-modify-write of `state.json`; path resolution; derive-aggregates helper |
| **M2 Timer engine** | phase state + cadence (focus → short → long every `frequency`); transition modes `auto`/`balanced`/`manual` (D-006a) |
| **M3 Status-line renderer** | per-tick render from `state.json` (read-only, no lock); view modes; passthrough; opportunistic alarm-claim |
| **M4 Alarm & notify** | detached one-shot warning + end cues; single-fire via atomic claim; cross-platform sound, degrade to bell |
| **M5 History/undo/restore** | JSONL records; fold for queries; mandatory backup before any destructive op |
| **M6 Help & output** | one TTY-aware renderer: pretty on a TTY, clean plain text when captured, `--json` when asked (D-008) |
| **M7 Setup/uninstall** | wire/unwire Claude Code (command file, `statusLine` merge, hooks, manifest); idempotent; clean reversal (D-005) |
| **M8 Command file & plugin** | bare `/pomo` command file + thin marketplace plugin (D-001/D-002) |
| **M9 Stats & dashboard** | pure `foldStats` over the log → terminal panel / self-contained HTML / JSON; local-time presentation over UTC storage (D-011) |

## Non-negotiable invariants

These map directly to acceptance criteria (`specs/spec.md`). Do not regress them.

- **Cheap hot path.** `pomo statusline` runs every second: minimal Node entry point, zero heavy
  `require`s, read only `state.json` + a cheap `.git/HEAD` read. No subprocess per tick, no history
  fold, no lock. Cold start is the only accepted cost.
- **Atomic, serialized writes.** Every mutating verb takes `flock` and writes via temp-file +
  `rename`. Reads never lock. Concurrent `start`s never corrupt or duplicate state.
- **Decoupled alarm.** End cue fires within ~1s of true end even if the status line is hidden or all
  sessions are closed (detached one-shot); render-claim is the backup. Exactly one fire across N
  sessions via atomic `alarms_fired` claim.
- **Composes, never clobbers.** Installing preserves the user's existing status line (model ·
  context · git passthrough); uninstall restores it from backup and leaves no orphaned processes.
- **One global timer (D-009).** One logical timer rendered in every session; control works from any
  session; ownership self-heals. Per-pane opt-out via `CLAUDORO_HIDE`.
- **Wall-clock only.** Store `end_epoch`; derive `remaining = end_epoch - now` by integer
  arithmetic. No `date` string parsing. Clamp so displayed remaining never increases mid-block.
- **Safe mutation.** Timestamped backup written *unconditionally* before `undo`/`log clear`/edit.
  `undo` re-derives aggregates; `restore` reverses. CLI verbs are the API; Claude orchestrates
  confirmation (`--dry-run` → confirm in chat → `--yes`).
- **Graceful degradation.** No-emoji → ASCII icons; `NO_COLOR`/non-TTY → no ANSI; no audio → notify
  → bell → silent. Never a hard failure.

## Testing

- `npm run check` runs the full gate: `lint` → `format:check` → `typecheck` (tsc) → `test`. CI
  runs it on Node 22 + 24 across macOS/Linux/Windows. **Run it before every PR and before pushing.**
- A `pre-push` git hook enforces this automatically. It is wired up via `npm install` (the
  `prepare` script runs `git config core.hooksPath .githooks`). The hook lives in `.githooks/pre-push`
  and is committed to the repo so every contributor gets it. Skip with `git push --no-verify` only
  when you have a specific reason (e.g. pushing a WIP branch for CI to catch).
- Pure functions get fast unit tests (timer math, derivation, rendering, formatting).
- Side-effecting behaviour (locking, atomic writes, alarm claim, setup/uninstall) gets integration
  tests against a temp state dir via `makeTempEnv()`; never touch the developer's real `~/.claude`
  or state dir. Every store/history/setup helper takes an `env` arg for exactly this reason.
- Every behaviour path and error condition in the spec has a `TEST-Mx-NNN` baseline. Keep the
  coverage matrix (`specs/spec.md`) honest as you build.
- Build in the spec's sequence (M1 foundation → M2 engine → M3 renderer / M4 alarm → ...), checking
  the stated checkpoint before moving on.

## Layout

`bin/pomo.js` (entry, with a lazy fast-path for `statusline`), `src/` modules per M1..M9
(`platform/` for OS edges, `render/` for the segment and the HTML dashboard, `stats.js` for the
analytics fold), `src/types.js` (domain typedefs),
`test/` mirroring the modules. Pure timer transitions return `{state, record?}` or `null`;
`store.applyTransition` runs them under the lock and reports `{changed, state, prev, record}`, so
callers drive side effects off `changed` rather than re-inspecting state.
