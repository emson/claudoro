# Claudoro: Specification

## Overview

Claudoro is a Pomodoro timer that lives inside the Claude Code terminal. A live, ticking countdown
renders in the status line (the surface your eyes are already on), and a reliable, render-decoupled
alarm fires at the end of each block. It is open source, distributed primarily as an npm package
(`npm install -g claudoro`) with a thin Claude Code plugin wrapper.

The design rests on one principle: **a plain `pomo` CLI is the single source of truth** (D-001). It
owns all state, scheduling, and history; the status line, the `/pomo` slash command, and the alarm
are all thin surfaces over it. The CLI runs with zero model involvement, so the core feature never
costs API tokens. An agent (Claude Code) sits alongside and can optionally *enrich* the data
(summaries, context, reports), but the timer is fully functional with the agent absent.

**Audience.** Solo developers and power users who run long Claude Code sessions, comfortable with a
CLI and `settings.json`, on macOS, Linux, and Windows. They install once and expect it to "just
work" (D-005).

### Decision alignment (where this spec supersedes the charter)

The charter (the original brief) predates several decisions. This spec follows the decisions:

| Topic | Charter (original) | Decision (authoritative) |
|---|---|---|
| Implementation language | "pure bash / POSIX / no jq" | **Node.js** single package (D-005) |
| Concurrency | "two independent timers" per session (SC#5) | **One global timer shown in every session** (D-009); the "no interference" intent is preserved and strengthened |
| State + log | per-`session_id` plain-text under `~/.claude/claudoro/` | **One global `state.json` + per-day JSONL** under the XDG state dir (D-007) |
| Windows | WSL/Git-Bash only | **First-class via npm** (D-005) |
| Transitions | implicit auto-cycle | **Three modes, `auto` default** (D-006a) |
| History/undo | "log reset" | **`undo`/`restore` with mandatory backup** (D-007) |

## Architecture

Components and data flow:

```
  Claude Code  ──spawns every ~1s, JSON on stdin──▶  pomo statusline  ──reads──▶ state.json
       │                                                    │                       ▲
       │ /pomo (command file)                               │ opportunistic         │ atomic
       │   └─ !`pomo $ARGUMENTS` (dynamic injection)         │ alarm-claim           │ write
       ▼                                                     ▼                    (flock)
   user input ───────────────────────────────────▶  pomo <verb>  ──mutates──▶ state.json
                                                            │                       │
                                                            │ spawn detached        │ finalize phase
                                                            ▼                       ▼
                                                   alarm one-shot          logs/YYYY-MM-DD.jsonl
                                                   (sleep→sound/notify)     (immutable records)
```

- **`pomo` CLI (Node)** is the source of truth and the only writer. Every verb takes a `flock` on
  the state dir, performs an atomic read-modify-write of `state.json`, and (on phase finalize)
  appends an immutable record to the day log (D-007).
- **`pomo statusline`** is the per-tick renderer. Claude Code passes session context as JSON on
  stdin; the renderer reads that plus `state.json` (read-only, no lock) and prints the segment. It
  also performs the opportunistic alarm-claim (D-009).
- **`/pomo` command file** (`~/.claude/commands/pomo.md`) injects `` !`pomo $ARGUMENTS` `` so the
  CLI runs locally and its output is inlined; the model only acknowledges (D-001). `!pomo ...` at
  the prompt is the zero-model-turn alternative.
- **Alarm one-shot** is a detached process spawned at phase start that sleeps to each cue time and
  fires; deduped against the renderer via an atomic claim (D-005, D-009).
- **`pomo setup` / `pomo uninstall`** wire and unwire Claude Code (command file, `statusLine`
  merge, hooks, manifest) outside the npm install step (D-005).
- **Plugin wrapper** is thin: its setup hook calls `pomo setup`.

Decisions referenced: D-001 (control surface), D-004/D-006 (status-line UX), D-005 (packaging,
runtime, alarm), D-006a (transition modes), D-007 (data model, history, undo), D-008 (help/output),
D-009 (concurrency).

## Data Model

All paths resolve cross-platform via Node (`os.homedir()` + platform rules); the table shows the
Unix/XDG defaults.

| Store | Path (default) | Purpose | Format |
|---|---|---|---|
| Live state | `$XDG_STATE_HOME/claudoro/state.json` (`~/.local/state/claudoro/`) | the one running timer | single JSON object, atomic rewrite |
| History | `…/claudoro/logs/YYYY-MM-DD.jsonl` | immutable finished-phase records | JSON Lines (append) |
| Backups | `…/claudoro/backups/` | pre-mutation snapshots (rolling, keep last K) | copies |
| Manifest | `…/claudoro/manifest.json` | what `pomo setup` installed (for clean uninstall) | JSON |
| Dashboard | `…/claudoro/dashboard.html` | rebuildable stats page (`pomo stats --web`); holds labels, not for casual sharing (D-011) | static HTML |
| Prefs | `$XDG_CONFIG_HOME/claudoro/prefs.json` (`~/.config/claudoro/`) | persisted view mode, transition mode, passthrough, motion, color, mute default | JSON |
| Lock | `…/claudoro/lock` | `flock` target serialising all writes | empty file |

Durations are **not** persisted (flag-only per D-003); `prefs.json` holds only persistent UX
preferences (D-004/D-006a), which is distinct from the duration-config file D-003 declined.

**Core principle: derive, do not store, aggregates** (D-007). Cycle position, today's count, focus
minutes, next long break, and streaks are all computed by folding the immutable record list. There
are no mutable counters, so removing or editing records can never desync state; `undo` is correct by
construction.

### Entity: LiveState (`state.json`)

Non-derivable live state, the only thing the per-second renderer reads. See D-007 for the annotated
shape. Fields: `schema`, `run_state` (`running|paused|idle`), `phase`
(`focus|short_break|long_break|null`), `started`, `end_epoch`, `planned_min`, `paused_at`,
`paused_total_sec`, `mode`, `label`, `set_number`, `set_index`, `current_record_id`,
`owner_session`, `alarms_fired[]`, `alarm_pid`, `config` (the active `{work, short, long, frequency,
notify, mute}`). Remaining is derived: `end_epoch - now`; on pause, `paused_at` freezes it; on
resume, `end_epoch` shifts forward by the paused span.

### Entity: PhaseRecord (one JSONL line)

Immutable. Three provenance groups (D-007): **(A) timing & identity** and **(B) intent &
reflection** are CLI/user data, always reliable; **(C) work context** (`context{}`) is
agent-enriched, best-effort, opt-in, marked via `provenance` and `pending`. Full annotated shape in
D-007. Lifecycle: created when a phase finalizes (`status` in `completed|skipped|aborted|partial`),
never updated by the timer (only by explicit `undo`/`restore` or a documented agent edit), removed
only by `undo` (which backs up first).

### Entity: Backup

A timestamped snapshot of `state.json` and the affected day log, written before every destructive
op (`undo`, `log clear`, direct edit). Rolling retention (keep last K). `restore` reverses from one.

## Modules

### M1. CLI core & store

**Does:** parse argv, dispatch to a verb, and provide safe, locked, atomic access to the stores.

**Inputs:** argv; `state.json`, `prefs.json`, day logs; env (`CLAUDORO_*`, `NO_COLOR`, `EDITOR`).

**Outputs:** mutated stores; human or `--json` output; exit code.

**Behaviour:**
1. Resolve paths (XDG/Windows); ensure dirs exist (mode 0700).
2. For any mutating verb: acquire `flock` on `lock`, read state, mutate, write to a temp file, `rename` over `state.json`, release lock. Reads (renderer) take no lock.
3. On phase finalize, append the PhaseRecord to the day log and advance `current_record_id`.

**Edge Cases:**
- Missing/empty state → treat as `idle`.
- Corrupt `state.json` → back up the bad file, log a warning, reinitialize to `idle` (never crash a render).
- Read-only or absent HOME / state dir → fall back to `TMPDIR`, warn once, degrade.
- Concurrent writers → serialized by `flock`; the renderer tolerates a momentarily missing/locked file by rendering last-known or nothing.

**Errors:**
| Condition | Response | Recovery |
|---|---|---|
| Lock cannot be acquired (timeout) | exit non-zero with a clear message | retry; never partial-write |
| Corrupt JSON | quarantine + reinit | `restore` or fresh start |
| Unknown verb | print `pomo help` summary | n/a |

### M2. Timer engine

**Does:** own phase state and the cadence focus → short break, with a long break every `frequency` focuses.

**Inputs:** verbs `start|pause|resume|stop|skip|reset|next|back|extend`; the active `config`.

**Outputs:** updated LiveState; finalized PhaseRecords; alarm (re)scheduling requests to M4.

**Behaviour:**
1. `start [mins] [flags] [label]`: if idle, begin a focus phase, set `owner_session`, schedule alarms. If a block already runs, report it (idempotent, never duplicate); suggest `restart`.
2. `pause`/`resume`: freeze/unfreeze via `paused_at`; kill/reschedule alarms.
3. `stop`: finalize current phase as `aborted`, go idle, kill alarm.
4. `skip`: finalize current as `skipped`, advance to the next phase per cadence.
5. `reset`: restart the current phase (`end_epoch = now + planned`), keep `set_index` (charter).
6. Transition at end per **mode** (D-006a): `auto` (advance both boundaries), `balanced` (auto into break, wait to start focus), `manual` (wait at both). `next` resolves a waiting boundary; `back` undoes the last transition within a short window; `extend [N]` adds minutes.
7. `set_number`/`set_index` are written for convenience but authoritative cadence is re-derivable from records.

**Edge Cases:**
- Clock jump / suspend → reconcile against wall-clock `end_epoch`; never let displayed remaining increase within a running block (D-006).
- `extend` past sensible bounds → allow, but cap absurd values with a warning.
- `back` after the window closed → refuse with guidance (use `start`).
- Long break vs short break selection uses derived focus count, robust to `undo`.
- Forgotten timer (slept / walked away) finalized by `stop`/`next` long past its end → credit focus only up to `planned + max_overtime`, flag the record `abandoned`, keep the true span in `started`/`ended` (D-012). `--full` records the true elapsed for a genuine marathon. The auto-reconcile path finalizes at `end_epoch`, so it is already exempt.
- Waiting boundary (manual/balanced) held in overtime past `max_overtime` → `reconcileStep` auto-closes it to idle (the held phase keeps full planned credit), instead of showing `+overtime` forever; driven from the render path by a cheap `overtimeExceeded` gate (D-012).

**Errors:**
| Condition | Response | Recovery |
|---|---|---|
| `pause` when idle | no-op + note | n/a |
| `next` when not at a boundary | no-op + note | n/a |
| `start` while running | report running block | `restart` for a fresh one |

### M3. Status-line renderer (`pomo statusline`)

**Does:** render the Claudoro segment for one tick, then the configurable passthrough.

**Inputs:** Claude Code status JSON on **stdin** (`session_id`, `cwd`, `model`, `workspace`, …); `state.json` (read-only); `prefs.json`; env (`CLAUDORO_HIDE`, `CLAUDORO_MOTION`, `CLAUDORO_COLOR`, `CLAUDORO_PASSTHROUGH`, `NO_COLOR`, `COLUMNS`).

**Outputs:** one line (or two in `full`) to stdout; possibly an alarm fire (via M4 claim).

**Behaviour:**
1. Minimal entry point: no heavy `require`s, to keep Node cold-start near the floor (D-005 tradeoff).
2. If `CLAUDORO_HIDE` is set in this shell, render passthrough only (D-009 per-pane opt-out).
3. If `run_state` is `idle`, render passthrough only (segment absent, no layout shift, D-004).
4. Else compose the segment per the active view mode (`minimal|classic|full`, D-004): phase icon, `MM:SS` (zero-padded, blinking colon per motion budget), smooth sub-cell bar (quantized ~15s, D-006), cycle dots, optional label; phase color tints icon + fill. Apply no-reflow rules and `COLUMNS` hysteresis (D-006).
5. Build passthrough from the stdin JSON: model display name; git branch read cheaply from `<cwd>/.git/HEAD` (no subprocess per tick); context figure if available. Fields and order from `CLAUDORO_PASSTHROUGH`.
6. Opportunistic alarm-claim: if a cue is overdue and unclaimed, attempt the atomic claim (M4); if won, fire.
7. Wrap the phase icon in an OSC 8 hyperlink to today's log (D-006), degrading to plain text.

**Edge Cases:**
- No-emoji / non-UTF8 terminal → ASCII icon fallbacks (D-004 baseline).
- `NO_COLOR` / non-TTY → no ANSI (the segment is plain; relevant when output is captured).
- Narrow width → drop order bar → dots → label, always keep icon + time.
- Missing stdin fields → omit that passthrough piece.

**Errors:**
| Condition | Response | Recovery |
|---|---|---|
| `state.json` missing/locked | render passthrough only or last-known | next tick recovers |
| Render throws | emit passthrough (or nothing) | never break the user's status line |

### M4. Alarm & notifications

**Does:** fire a pre-end warning and an end cue exactly once, decoupled from rendering.

**Inputs:** schedule requests from M2 (cue times, `notify`, `mute`); `state.json` (`alarms_fired`, `alarm_pid`).

**Outputs:** sound + OS notification; updated `alarms_fired`; `alarm_pid`.

**Behaviour:**
1. On `start`/`resume`/`reset`, spawn a **detached** one-shot (Node `spawn(detached, stdio:'ignore').unref()`; `setsid` semantics) that sleeps to each cue and attempts to fire; store its PID.
2. Firing is gated by an **atomic claim**: under `flock`, add the cue (`"warning"|"end"`) to `alarms_fired`; if already present, do nothing (D-009). This dedupes the one-shot against any render-claim, so exactly one fires regardless of how many sessions are open.
3. Sound palette (D-006): soft tick (warning), warm chime (focus-end), gentle prompt (break-end). Mute-aware.
4. Cross-platform notify: macOS `afplay`/`osascript`; Linux `paplay`/`aplay`/`ffplay` + `notify-send`; Windows PowerShell; degrade to terminal bell, then silent.
5. On `pause`/`stop`/`skip`, kill the tracked PID and reset the relevant claims.

**Edge Cases:**
- Owner terminal closes → detached process survives (or a surviving renderer claims); ownership self-heals (D-009).
- All sessions closed → detached one-shot still fires; a later-opened session reconciles overdue cues.
- Suspend/clock jump → the one-shot recomputes against wall-clock; render-claim catches overdue.
- Stale `alarm_pid` (already dead) → cleanup is best-effort, harmless.
- No audio device / SSH → notify or bell, then silent; never error.

**Errors:**
| Condition | Response | Recovery |
|---|---|---|
| Sound tool absent | fall through the chain to bell/silent | n/a |
| Spawn fails | renderer-claim becomes sole path | fires on next visible tick |

### M5. History, undo & restore

**Does:** record finished phases, answer queries, and mutate history safely.

**Inputs:** verbs `log`, `undo`, `restore`, `label`; the day logs and backups.

**Outputs:** human or `--json` output; mutated logs; backups.

**Behaviour:**
1. `log [--today|--date D] [--json]`: fold and print records; `log open` opens the file in `$EDITOR`; `log backups` lists snapshots.
2. `undo [N] [--dry-run] [--yes]`: identify the last N completed records (global chronological order across day files); `--dry-run` prints exactly what would go; **write a timestamped backup unconditionally**; then remove and re-derive. Without `--yes`, prompt (TTY); the Claude Code flow runs `--dry-run` → user confirms in chat → `--yes`.
3. `restore [backup-id]`: reverse from a backup.
4. `label "..."`: set the current label (also settable at `start`); stamped onto the finalizing record.

**Edge Cases:**
- `undo` crossing a day boundary → operates on most-recent records regardless of file.
- `undo` while a phase runs → touches completed records only; live phase handled by `stop`/`back`.
- Corrupt trailing JSONL line → skip with a warning, do not fail the read.
- Aggregates re-derived after every mutation (no counter to desync).

**Errors:**
| Condition | Response | Recovery |
|---|---|---|
| `undo N` > available | undo what exists + note | n/a |
| `restore` of missing backup | error + list available | pick a valid id |

### M6. Help & output rendering

**Does:** present a TTY-aware "pretty" help and consistent output across surfaces (D-008).

**Inputs:** `help [command]`, `--help/-h`, `--json`, `--no-color`; env (`CLAUDORO_COLOR`, `NO_COLOR`); TTY status; `COLUMNS`.

**Outputs:** colored structured help on a TTY; clean plain text when piped/captured; JSON when `--json`.

**Behaviour:**
1. One renderer; color and box-drawing only when stdout is an interactive TTY; honor `NO_COLOR` and `CLAUDORO_COLOR=auto|always|never` (default `auto`).
2. `pomo help`: tinted title, sections (CONTROL / CONFIG / LOG & DATA), aligned columns, dim current-value hints (`mode … (current: auto)`), examples, footer with the state dir. Width-aware.
3. Reuse the unified visual language (icons/palette) so help matches the status line and `/pomo status` (D-006 #3).

**Edge Cases:** narrow width → wrap; no-emoji → ASCII; captured into model context → plain text (the `/pomo` command may also pass `--no-color`).

### M7. Setup, install & uninstall

**Does:** wire Claude Code outside the npm step and reverse it cleanly (D-005).

**Inputs:** `pomo setup`, `pomo uninstall`; existing `settings.json`.

**Outputs:** `~/.claude/commands/pomo.md`; merged `statusLine`; registered hooks; `manifest.json`; backups.

**Behaviour:**
1. `setup` (idempotent, marker-guarded): write the `/pomo` command file (absolute path to `pomo` so PATH is non-critical); back up `settings.json` (timestamped) then merge the `statusLine` command; register hooks; record every change in the manifest.
2. `uninstall`: read the manifest and reverse exactly, restoring any pre-existing `statusLine` from backup. `npm uninstall -g claudoro` removes the binary.

**Edge Cases:**
- `settings.json` missing → create; invalid JSON → never clobber, back up + print the manual snippet.
- Existing custom `statusLine` → back up, record original in manifest, install ours, log a notice (wrapping is a v2 item, D-004).
- Concurrent write by Claude Code → atomic temp + rename.
- Re-run → idempotent (marker), no duplicate entries.

**Errors:**
| Condition | Response | Recovery |
|---|---|---|
| Cannot write command dir | clear error + manual instructions | fix perms, re-run |
| Manifest missing on uninstall | best-effort + documented manual steps | n/a |

### M8. `/pomo` command file & plugin packaging

**Does:** deliver the bare `/pomo` surface and the marketplace plugin (D-001, D-002, D-005).

**Behaviour:**
1. Command file frontmatter `allowed-tools: Bash(pomo *)`; body injects `` !`pomo $ARGUMENTS` ``.
2. Plugin: `displayName: "Claudoro"`, manifest `name: claudoro`; its setup hook calls `pomo setup`. The bare `/pomo` and on-PATH `pomo` are installed by setup, not as namespaced plugin components.

### M9. Stats & dashboard (D-011)

**Does:** answer "how am I doing over time?" by folding the immutable records into derived
analytics and rendering them three ways from one payload: a terminal panel (default), a
self-contained HTML dashboard (`--web`), and stable JSON (`--json`).

**Inputs:** verb `stats [--web] [--json]`; all day logs (read-only, cold path); the clock (read
once at the boundary, passed in).

**Outputs:** an ANSI/Unicode panel to stdout; or a written `dashboard.html` plus a browser launch;
or a schema-versioned JSON object.

**Behaviour:**
1. `foldStats(records, now)` is pure: it derives totals (all-time focus minutes, pomodoros, active
   days), today and last-7-day rollups, the current and best day-streak, a focus heatmap grid
   (trailing ~12 weeks, Monday-aligned, level 0..4), top tags (parsed from labels via M1's
   `parseTags`), a 24-bucket by-hour histogram, and the outcome mix (completed/skipped/aborted).
2. **Local-time presentation over UTC storage (D-011):** the fold buckets by *local* calendar day
   and hour (`stats.localDay`), while the log and its file names stay UTC (`derive.dateOf`). Storage
   is unchanged; only the human-facing view is localised.
3. The terminal renderer reuses the status line's visual language (icons, palette, shade ramp) and
   degrades to plain text when captured (D-008). The HTML renderer emits a fully static,
   dependency-free page (no client JS, no network, no CDN) with every user string HTML-escaped.
4. `--web` writes the page to the state dir and opens it best-effort (`open`/`xdg-open`/`start`);
   if no opener is available it prints the path. `--json` emits the payload verbatim.

**Edge Cases:**
- No records yet → a friendly empty state, never an error.
- A label containing HTML (hand-edited via `log open`) → escaped in the page (XSS-safe).
- No browser / SSH / headless → `--web` prints the path; the terminal panel always works.
- Very long history → the heatmap is a fixed trailing window; the per-record explorer is capped.

**Errors:**
| Condition | Response | Recovery |
|---|---|---|
| Cannot write `dashboard.html` | clear error, non-zero exit | fix perms, re-run |
| Browser launch fails | print the file path | open it manually |

### M10. Pomodoro guide

**Does:** teach the Pomodoro Technique, tailored to how Claudoro works. One static content model
(`GUIDE`) rendered three ways from the same source, exactly like M9: a terminal panel (default), a
self-contained HTML page (`--web`), and stable JSON (`--json`).

**Inputs:** verb `guide [--web] [--json]`. No log, no clock, no state: the content is static, so the
guide reads the same whether or not a timer is running.

**Outputs:** an ANSI/Unicode panel to stdout; or a written `guide.html` plus a browser launch; or a
schema-versioned JSON object.

**Behaviour:**
1. `GUIDE` (in `src/guide.js`) is a frozen, plain-data content model: an intro, an ordered list of
   sections (each with optional prose, steps, bullets, command examples, and edge-case/mitigation
   pairs), and a references list. Content is data, not markup.
2. `renderGuide` (terminal) and `renderGuideHtml` (`render/guide-html.js`) both fold over `GUIDE`,
   so the surfaces cannot drift. The terminal renderer reuses the M6 palette and degrades to plain
   text when captured (D-008); the HTML renderer shares the M9 theme and document shell via
   `render/html-shell.js`, emitting a fully static, dependency-free page with every string escaped.
3. `--web` writes `guide.html` to the state dir and opens it best-effort; if no opener is available
   it prints the path. `--json` emits `GUIDE` verbatim.

**Edge Cases:**
- No browser / SSH / headless → `--web` prints the path; the terminal panel always works.
- Narrow terminal → prose word-wraps; an unbreakable token (a reference URL) is left intact.
- House rule: no em-dashes anywhere in the content (enforced by a test over the whole model).

**Errors:**
| Condition | Response | Recovery |
|---|---|---|
| Cannot write `guide.html` | clear error, non-zero exit | fix perms, re-run |
| Browser launch fails | print the file path | open it manually |

## API / Interfaces

### `pomo` CLI command surface

| Verb | Args / flags | Effect | `--json` |
|---|---|---|---|
| `start` | `[mins] [-w -s -l -f --notify N] [--mute] [-t/--label TEXT]` | begin a focus block (D-001/D-003/D-007) | n |
| `pause` / `resume` / `stop` | `stop [--full]` | control the running block; `--full` records true elapsed past the abandon cap (D-012) | n |
| `skip` | | finalize current as skipped, advance | n |
| `reset` | | restart current phase, keep cycle (charter) | n |
| `next` | | advance a waiting boundary (D-006a) | n |
| `back` | | undo last transition (short window) | n |
| `extend` | `[N]` | add N minutes to current phase | n |
| `mode` | `[auto\|balanced\|manual]` | get/set transition mode (D-006a) | y |
| `view` | `[minimal\|classic\|full]` | get/set status-line view (D-004) | y |
| `label` | `"TEXT"` | set current session label (D-007) | n |
| `mute` / `unmute` | | toggle sound | n |
| `status` | `[--json]` | rich current status into the conversation (D-004) | y |
| `stats` | `[--web] [--json]` | derived analytics: streak, focus heatmap, tags, by-hour (D-011) | y |
| `log` | `[--today\|--date D] [--json]`, `open`, `backups` | history (D-007) | y |
| `undo` | `[N] [--dry-run] [--yes]` | remove last N records, backup first (D-007) | y |
| `restore` | `[backup-id]` | restore from a backup | y |
| `statusline` | (stdin JSON) | per-tick render (internal, called by CC) | n |
| `setup` / `uninstall` | | wire/unwire Claude Code (D-005) | n |
| `help` | `[command]`, `--help/-h` | help (D-008) | n |

Global: `--no-color`; exit code 0 on success, non-zero on error; `--json` emits a stable,
schema-versioned object.

### Claude Code `statusLine` stdin contract

JSON on stdin per tick, including `session_id`, `cwd`, `model.display_name`, `workspace`
(`current_dir`, `project_dir`), `version`. The renderer uses `session_id` for ownership/hide,
`cwd` for git branch and project attribution, `model.display_name` for passthrough.

### `/pomo` command file

`~/.claude/commands/pomo.md`, frontmatter `allowed-tools: Bash(pomo *)`, body `` !`pomo
$ARGUMENTS` ``.

### Environment variables

`CLAUDORO_HIDE` (suppress segment in this pane), `CLAUDORO_MOTION=full|reduced|off`,
`CLAUDORO_COLOR=auto|always|never`, `CLAUDORO_PASSTHROUGH="model,context,git"`, `NO_COLOR`,
`EDITOR`, `XDG_STATE_HOME`/`XDG_CONFIG_HOME`.

## Non-Functional Requirements

- **Per-tick cost:** the `statusline` path must read only `state.json` (+ a cheap `.git/HEAD`
  read), with a minimal Node entry point; no subprocess per tick, no history fold. Cold start is
  the only cost (D-005 accepted tradeoff).
- **Alarm precision:** end cue fires within ~1s of the true end, decoupled from rendering (charter
  SC#3) via the detached one-shot; render-claim is the backup.
- **Concurrency:** all writes serialized by `flock`; atomic temp+rename; single-fire alarm via
  atomic claim; reads never block (D-009).
- **Portability:** Node ≥ current LTS, macOS + Linux + Windows, no other runtime dependency
  (D-005). Graceful degradation for no-emoji, `NO_COLOR`, no-audio.
- **Privacy / local-first:** no network; group-C enrichment opt-in, redactable; everything stays
  on disk (notes/005).
- **Reliability:** no orphaned background processes after `stop`/`uninstall`; self-healing
  ownership; never crash a status-line render.
- **Security:** strict JSON parsing; no arbitrary code execution; mandatory backup before any
  destructive op.
- **Licensing / OSS:** MIT-style license, clean install/uninstall, README good enough for a
  sub-2-minute first run.

## Build Sequence

(The one item with no prior decision; proposed here.)

1. **Foundation (M1).** Node project; path resolution (XDG/Windows); `flock` + atomic state I/O;
   schema; derive-aggregates helper. *Checkpoint:* concurrent writes never corrupt state.
2. **Timer engine (M2).** start/pause/resume/stop/skip/reset; cadence; set counters.
   *Checkpoint:* a full focus→break→long-break cycle via CLI is correct.
3. **Renderer (M3)** *(parallelizable with 4 once the state shape is frozen).* `classic` view,
   color tiers, no-reflow, passthrough. *Checkpoint:* live ticking in Claude Code via
   `refreshInterval`, composing with existing info (charter SC#2, SC#4).
4. **Alarm (M4).** detached one-shot, warning + end cues, atomic claim, cross-platform sound/notify,
   mute. *Checkpoint:* alarm within ~1s when the status line is hidden; no cacophony with two
   sessions (charter SC#3; D-009).
5. **Transition modes & overrides (M2 cont.).** auto/balanced/manual, next/back/extend, overtime,
   motion budget.
6. **History (M5).** JSONL records, label, log/undo/restore/backups, `--json`. *Checkpoint:* undo +
   restore round-trips with backup.
7. **Help & output (M6); remaining views.** TTY-aware help, `minimal`/`full`, sound palette.
8. **Install (M7) & plugin (M8).** `pomo setup`, settings merge + manifest + backup, command file,
   plugin, uninstall. *Checkpoint:* sub-2-minute install (SC#1); uninstall leaves no orphans and
   restores the prior status line (SC#6).
9. **Polish / agent enrichment (mostly v2).** OSC 8 link, group-C enrichment fields, conversational
   reports (notes/005).

## Acceptance Criteria

Traced to charter Success Criteria (SC#1-6); SC#5 is revised per D-009.

- **AC-1 (SC#1, install):** *Given* a clean machine with Node, *when* the user follows the README
  (`npm install -g claudoro` → `pomo setup` → `/pomo start`), *then* a ticking countdown is visible
  in under 2 minutes.
- **AC-2 (SC#2, idle ticking):** *Given* a running focus block and an idle session (no typing),
  *when* one second passes, *then* the status-line countdown decrements via `refreshInterval`.
- **AC-3 (SC#3, alarm):** *Given* a focus block about to end with the status line hidden, *when* the
  end time passes, *then* the end cue fires within ~1s (decoupled from rendering).
- **AC-4 (SC#4, compose):** *Given* an existing status line (model/context/git), *when* Claudoro is
  installed, *then* that info still renders (passthrough), not clobbered; uninstall restores it.
- **AC-5 (SC#5 revised, multi-session, D-009):** *Given* two Claude Code sessions, *when* a block is
  running, *then* both display the same timer, control from either works, exactly one alarm fires,
  and the log shows one record sequence (no double-count, no corruption, no cacophony).
- **AC-6 (SC#6, uninstall):** *Given* an installed Claudoro, *when* the user uninstalls, *then* no
  background process remains and the prior `statusLine` is restored.
- **AC-7 (D-003, durations):** *Given* `pomo start -w 50 -s 10 -l 30 -f 3`, *then* phases use those
  values and the long break arrives after the 3rd focus.
- **AC-8 (D-006a, modes):** *Given* `mode manual`, *when* a focus block ends, *then* it waits
  (overtime shown) until `next`; *given* `mode auto`, it auto-advances.
- **AC-9 (D-007, undo+backup):** *Given* two completed pomodoros that ran while away, *when* `undo 2
  --yes`, *then* a backup is written first and the two records are removed with aggregates
  re-derived; `restore` reverses it.
- **AC-10 (D-007, label):** *Given* `pomo start 25 "write tests"`, *then* the label shows in the
  status line and is stamped on the completed record.
- **AC-11 (D-008, output):** *Given* `pomo help` on a TTY, *then* output is colored/structured;
  *given* the same captured (non-TTY), *then* output is clean plain text.
- **AC-13 (D-012, abandoned time):** *Given* a focus block forgotten for hours, *when* `pomo stop`,
  *then* the record credits focus only up to `planned + max_overtime`, is flagged `abandoned`, and
  keeps the true span; aggregates are not poisoned (read-time credit clamps any record); `pomo stop
  --full` records the true elapsed instead.
- **AC-12 (D-011, stats):** *Given* several days of completed focus blocks, *when* `pomo stats`,
  *then* the panel shows the correct totals, day-streak, focus heatmap, and top tags in local time;
  *when* `pomo stats --web`, *then* a self-contained HTML file is written (no external resources)
  and opened, or its path printed if no browser is available; *when* `pomo stats --json`, *then* a
  stable schema-versioned payload is emitted.

## Test Specifications

### Coverage Matrix

| Charter Success Criterion | Test IDs | Coverage |
|---|---|---|
| SC#1 install < 2 min | TEST-M7-001, TEST-M8-001 | ✓ Full |
| SC#2 idle ticking | TEST-M3-001 | ✓ Full |
| SC#3 alarm ~1s, decoupled | TEST-M4-001, TEST-M4-002 | ✓ Full |
| SC#4 composes / restores | TEST-M3-002, TEST-M7-002 | ✓ Full |
| SC#5 multi-session (revised) | TEST-M4-003, TEST-M1-002 | ✓ Full |
| SC#6 uninstall no orphans | TEST-M7-003 | ✓ Full |
| (D-003) durations | TEST-M2-002 | ✓ Full |
| (D-006a) modes | TEST-M2-003 | ✓ Full |
| (D-007) undo + backup | TEST-M5-001, TEST-M5-002 | ✓ Full |
| (D-008) output discipline | TEST-M6-001 | ✓ Full |
| (D-011) stats fold + HTML | TEST-M9-001, TEST-M9-002 | ✓ Full |
| (D-012) abandoned-time credit | TEST-M2-004 | ✓ Full |
| (M10) Pomodoro guide, 3 surfaces | test/m10-guide.test.js | ✓ Full |

Test specs are generated progressively (baseline per behaviour path + error condition; more from
simulation). Baseline set:

### TEST-M1-001: Concurrent writes do not corrupt state
**Source:** M1 behaviour 2. **Type:** integration. **Preconditions:** idle.
**Steps:** 1. fire two `pomo start` in parallel. **Expected:** one starts, the other reports a
running block; `state.json` is valid JSON with exactly one running phase. **Derived from:** baseline.

### TEST-M1-002: Control from a non-owner session
**Source:** M1/D-009. **Type:** integration. **Preconditions:** block started in session A.
**Steps:** 1. run `pomo pause` from session B. **Expected:** the global timer pauses; no error;
ownership unaffected or self-heals. **Derived from:** D-009.

### TEST-M2-002: Custom durations and long-break cadence
**Source:** M2/D-003. **Type:** unit. **Steps:** 1. `start -w 50 -f 3`; 2. complete 3 focuses.
**Expected:** focus = 50 min; the 3rd break is the long break. **Derived from:** baseline.

### TEST-M2-003: Mode behaviour at focus-end
**Source:** M2/D-006a. **Type:** unit. **Steps:** 1. `mode manual`; 2. let focus end.
**Expected:** state waits, overtime shown, no auto-advance until `next`. **Derived from:** baseline.

### TEST-M3-001: Idle tick decrements
**Source:** M3/SC#2. **Type:** integration. **Steps:** 1. start; 2. invoke `statusline` twice ~1s
apart with no input. **Expected:** `MM:SS` decreases. **Derived from:** baseline.

### TEST-M3-002: Passthrough preserved, hide honored
**Source:** M3/SC#4/D-009. **Type:** unit. **Steps:** 1. render with passthrough fields on stdin;
2. render with `CLAUDORO_HIDE=1`. **Expected:** (1) model/git present alongside the segment; (2)
segment absent, passthrough intact. **Derived from:** baseline.

### TEST-M4-001: Alarm fires when status line hidden
**Source:** M4/SC#3. **Type:** integration. **Steps:** 1. start a short block; 2. never render.
**Expected:** end cue fires within ~1s via the detached one-shot. **Derived from:** baseline.

### TEST-M4-002: Single-fire under render + one-shot
**Source:** M4. **Type:** integration. **Steps:** 1. let one-shot and a renderer both reach the end.
**Expected:** exactly one fire (atomic claim). **Derived from:** baseline.

### TEST-M4-003: No cacophony across two sessions
**Source:** M4/SC#5/D-009. **Type:** integration. **Steps:** 1. two sessions rendering; 2. block
ends. **Expected:** one cue total. **Derived from:** D-009.

### TEST-M5-001: Undo writes a backup and re-derives
**Source:** M5/D-007. **Type:** integration. **Steps:** 1. complete 2 focuses; 2. `undo 2 --yes`.
**Expected:** a backup exists; 2 records gone; today's count re-derived to 0. **Derived from:** baseline.

### TEST-M5-002: Restore reverses an undo
**Source:** M5/D-007. **Type:** integration. **Steps:** 1. after TEST-M5-001, `restore <id>`.
**Expected:** the 2 records return; aggregates match pre-undo. **Derived from:** baseline.

### TEST-M6-001: TTY vs captured output
**Source:** M6/D-008. **Type:** unit. **Steps:** 1. `pomo help` to a TTY; 2. the same piped.
**Expected:** (1) ANSI present; (2) no ANSI. **Derived from:** baseline.

### TEST-M7-001: Sub-2-minute install
**Source:** M7/SC#1. **Type:** manual review. **Steps:** follow README on a clean machine.
**Expected:** countdown visible < 2 min. **Derived from:** baseline.

### TEST-M7-002: settings.json merge backs up and preserves
**Source:** M7/D-005. **Type:** integration. **Steps:** 1. existing custom `statusLine`; 2. `setup`.
**Expected:** timestamped backup written; manifest records the original; no data lost. **Derived from:** baseline.

### TEST-M7-003: Uninstall leaves no orphans, restores status line
**Source:** M7/SC#6. **Type:** integration. **Steps:** 1. `setup`; 2. start a block; 3. `uninstall`.
**Expected:** no alarm process remains; `statusLine` restored from backup; command file removed. **Derived from:** baseline.

### TEST-M8-001: Bare `/pomo` resolves
**Source:** M8/D-002. **Type:** manual review. **Steps:** type `/pomo start` in Claude Code.
**Expected:** runs the CLI via injection (not `/claudoro:pomo`). **Derived from:** baseline.

### TEST-M2-004: Abandoned time is credited, not counted
**Source:** M2/D-012. **Type:** unit. **Steps:** 1. finalize (via `stop`) a focus block whose
elapsed is far past `planned + max_overtime`. **Expected:** `actual_min` is capped at
`planned + max_overtime`, the record is flagged `abandoned`, and `started`/`ended` keep the true
span; `stop --full` records the true elapsed; `creditedMin` clamps an unflagged legacy record so
aggregates are not poisoned. **Derived from:** baseline.

### TEST-M9-001: Stats fold derives streak and totals from records
**Source:** M9/D-011. **Type:** unit. **Steps:** 1. fold a record set spanning several local days.
**Expected:** all-time focus minutes and pomodoros are correct; the current day-streak counts only
consecutive local days with a completed focus and breaks on a gap; an empty set folds to zeroes
without throwing. **Derived from:** baseline.

### TEST-M9-002: Dashboard HTML is self-contained and escapes labels
**Source:** M9/D-011. **Type:** unit. **Steps:** 1. render the HTML with a label containing
`<script>`. **Expected:** the page references no external host (no `http(s)://`, no `src=`), embeds
no client `<script>` for data, and the malicious label is HTML-escaped, not live. **Derived from:** baseline.

## Glossary

| Term | Definition |
|---|---|
| Focus | A work phase (default 25 min). |
| Short break / Long break | Rest phases (default 5 / 15 min); a long break replaces the short one every `frequency` focuses. |
| Cycle / set | One run of `frequency` focuses ending in a long break. `set_index` is the focus position within it. |
| Phase | The current segment: `focus`, `short_break`, or `long_break`. |
| View mode | Status-line layout: `minimal`, `classic` (default), `full` (D-004). |
| Transition mode | How phases advance: `auto` (default), `balanced`, `manual` (D-006a). |
| Passthrough | The normal Claude Code status info (model · context · git) that Claudoro composes with, not clobbering (D-004). |
| Owner session | The Claude Code `session_id` that started the timer; used for attribution and `/pomo status`, self-healing (D-009). |
| Derive, do not store | Aggregates are folded from immutable records, never stored as mutable counters, so `undo` cannot desync (D-007). |
| Streak | Consecutive local calendar days, ending today or yesterday, each with at least one completed focus block (D-011). |
| Focus heatmap | A trailing ~12-week grid of focus minutes per local day, shaded by intensity (D-011). |
| Dashboard | The self-contained static HTML stats page written by `pomo stats --web`; a rebuildable, local-first artifact (D-011). |
| Abandoned block | A phase finalized far past its end (forgotten timer): focus is credited only up to `planned + max_overtime`, the record is flagged `abandoned`, the true span is kept (D-012). |
| Provenance groups A/B/C | Record fields by source: A timing/identity (CLI), B intent/reflection (user), C work context (agent-enriched, opt-in) (D-007). |
| `end_epoch` | Wall-clock deadline; remaining time is `end_epoch - now` (D-005). |
| Alarm claim | The atomic flag (`alarms_fired`) ensuring a cue fires exactly once across processes/sessions (D-009). |
| OSC 8 | Terminal hyperlink escape; the phase icon links to today's log, degrading to plain text (D-006). |
| `refreshInterval` | Claude Code setting that re-runs the status line on a timer (min 1s) even while idle. |
