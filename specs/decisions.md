# Decisions Log

## D-001: Control surface, `pomo` CLI as source of truth, `/pomo` as the user command
**Date:** 2026-06-17
**Status:** accepted
**Context:** We need a way for the user to control the timer (start/pause/resume/stop/skip/status).
The charter requires it to be ergonomic, cheap (no needless model tokens for a frequent
trivial action), and reliable. The display lives in the status line (see notes/001); this
decision is only about how the user *triggers* state changes.

**Choice:**
1. **A standalone `pomo` CLI is the single source of truth.** All state mutation and alarm
   management lives here (`bin/pomo start|pause|resume|stop|skip|status [args]`). It is a plain
   executable, works with zero model involvement, and is the thing everything else calls.
2. **The user-facing command is `/pomo`,** delivered as a **project/personal-level command
   file** (`.claude/commands/pomo.md`, installable to `~/.claude/commands/pomo.md`). Its body
   uses dynamic-context injection (`` !`pomo $ARGUMENTS` ``) so the CLI does the real work
   locally and its output is inlined; the model only acknowledges. Frontmatter:
   `allowed-tools: Bash(pomo *)`.
3. **Power-user zero-turn path:** typing `!pomo <cmd>` at the prompt (interactive bash mode)
   runs the CLI with **no model turn at all**. Documented as the lightweight alternative for
   people who don't want the round-trip.

**Why not alternatives:**
- **Slash command as a model-routed prompt** (model reads "run the timer", then calls the Bash
  tool): adds a tool round-trip, latency, and a possible permission prompt to fire a `sleep`.
  Wrong default for a frequent, trivial action. Rejected as the *mechanism*, though we keep the
  ergonomic `/pomo` surface by using `!`-injection instead of model-driven tool calls.
- **`!pomo` only, no slash command:** zero-token and clean, but the user explicitly wants the
  discoverable `/pomo`. New users look in the `/` menu; `!pomo` is undiscoverable. So we ship
  both, `/pomo` as primary, `!pomo` as the power alt.
- **CLI-less, logic inside the command markdown:** would trap all logic in a prompt template,
  un-testable and un-reusable, and unusable from `!` bash mode. Rejected.

**Accepted tradeoff:** `/pomo` costs one cheap model turn per use (a slash command always sends
a turn). Acceptable for a ~every-25-min action; `!pomo` exists for those who care.

**Evidence:** notes/001 (research on status line / hooks / control paths); Claude Code docs:
skills/slash-commands ("custom commands merged into skills"; `.claude/commands/x.md → /x`;
`` !`cmd` `` dynamic context injection) and plugins-reference (plugin components are namespaced
`plugin-name:skill-name`).

**Revisit if:** Claude Code adds a true side-effect-only / no-model-turn slash command type
(then `/pomo` could become zero-turn and we drop the `!pomo` framing); or if plugins gain a way
to expose a bare (un-namespaced) command (then we could ship `/pomo` from the plugin directly,
see D-002).

---

## D-002: Brand/command split, plugin "Claudoro", command "/pomo", binary "pomo"
**Date:** 2026-06-17
**Status:** accepted
**Context:** Project brand is **Claudoro**, but the user wants to type the short verb **`/pomo`**.
Claude Code namespaces *all* plugin-shipped commands as `plugin-name:command`, so a plugin
named `claudoro` could only offer `/claudoro:pomo`, never a bare `/pomo`. We must reconcile a
branded distributable with a short bare command.

**Choice:** Split the identity across layers:
- **Brand / repo / marketplace / plugin display name = `Claudoro`** (`displayName: "Claudoro"`
  in plugin.json; manifest `name: claudoro` used for namespacing + install dir).
- **CLI binary = `pomo`** (placed on PATH by the installer).
- **User command = `/pomo`**, shipped as a **top-level command file**, not a namespaced plugin
  component. The installer writes `~/.claude/commands/pomo.md` (or the user drops it in a
  project's `.claude/commands/`). This is the only way to get a bare `/pomo`.
- Anything the plugin *does* expose as a namespaced command (if any) is secondary; `/pomo` is
  the canonical surface.

**Why not alternatives:**
- **Name the plugin `pomo`:** plugin commands are still `plugin:command`, so best case is
  `/pomo:pomo`, uglier than `/pomo`, and it throws away the Claudoro brand. Rejected.
- **Accept `/claudoro:pomo`:** violates the explicit `/pomo` requirement and is clunky to type
  every 25 minutes. Rejected.

**Consequence, packaging:** Because the bare `/pomo` and the on-PATH `pomo` binary both live
*outside* the plugin sandbox, the install story cannot be "pure marketplace plugin + nothing
else." It needs an **install step** (script or plugin setup hook) that: (a) puts `pomo` on
PATH, (b) writes the `/pomo` command file, (c) merges the `statusLine` setting into
settings.json, (d) registers hooks. This makes **packaging its own decision** (now resolved in
D-005): a single Node.js package, `npm install -g claudoro` as the primary install, an explicit
`pomo setup` doing (b)/(c)/(d) with a manifest for clean uninstall, and the plugin hook calling
that same setup.

**Evidence:** notes/001; Claude Code docs, plugins-reference (`name` "used for namespacing
components", `displayName` "Not used for namespacing or lookup"); skills doc (plugin skills use
`plugin-name:skill-name` namespace; `.claude/commands/<file>.md → /<file>` bare).

**Revisit if:** plugins gain bare-command support (collapse back into a single plugin install);
or we decide the on-PATH binary is unacceptable and move all logic into a hook-invoked script.

---

## D-003: Duration configuration, flags on `pomo start`, no config file in v1
**Date:** 2026-06-17
**Status:** accepted
**Context:** The charter requires configurable work/break durations. We needed to pick where
that configuration lives: flags per invocation, a persistent config file, environment variables,
or some combination. The open question was flagged in notes/001 and resolved via comparison with
pymodoro (notes/002).

**Choice:** Flag-based configuration on `pomo start`, matching pymodoro's proven interface:
- `-w / --work N`: focus duration in minutes (default: 25)
- `-s / --short N`: short break duration (default: 5)
- `-l / --long N`: long break duration (default: 15)
- `-f / --frequency N`: focus blocks before a long break (default: 4)
- `--notify N`: warning alarm N minutes before end (default: 1)
- `--mute`: start with sound disabled

Defaults are the canonical Pomodoro Technique values and match pymodoro exactly, so users
migrating from pymodoro get zero re-learning.

**Why not alternatives:**
- **Config file** (`~/.config/claudoro/config`): adds an install artifact, a parser, and a
  "config vs flag" precedence question. Unnecessary for v1, flags are sufficient and explicit.
  A config file is a natural v2 convenience (one-time setup instead of flags every session).
- **Environment variables only:** invisible, non-discoverable, hard to document in a README.
  Worse DX than flags. Rejected as primary; could supplement flags in v2.
- **Hardcoded defaults, no config:** fails the charter success criterion ("durations
  configurable"). Rejected.

**Evidence:** notes/002 (pymodoro feature mapping); pymodoro itself uses this exact flag
interface and it has proven ergonomic.

**Revisit if:** users request persistent per-project config (e.g. a `.claudoro` file in the
repo root), then a layered precedence (flag > project config > user config > defaults) is the
natural extension.

---

## D-004: Status-line UX, "Classic" default, three switchable view modes + on-demand detail
**Date:** 2026-06-17
**Status:** accepted
**Context:** The status line is the product's primary surface. It is peripheral, glanceable, and
shares one slot with the user's normal Claude Code info. We needed to fix the default
representation and the disclosure model. Full design rationale in notes/003.

**Choice:**
- **Default = "Classic" compact line:** phase icon + `MM:SS` (blinking colon while running) +
  smooth sub-cell progress bar + cycle dots, prepended to a passthrough of the normal CC info
  (model · context% · git). Single line, no vertical layout shift; the pomodoro segment
  appears/disappears horizontally and is simply absent when idle.
- **Three switchable status-line view modes** via `pomo view <mode>` (persisted in config):
  - `minimal` (the "Pip" look): icon + time + bar only.
  - `classic` (**default**): + cycle dots.
  - `full`: two lines, adds phase word, task label, fuller bar, and cost on a second line.
- **On-demand detail:** `/pomo status` prints a rich multi-line block *into the conversation*
  (elapsed/remaining, %, label, sound state, today's completed count + focus time, next long
  break). This is where all secondary data lives, it never clutters the status line.
- **Pixel system:** smooth eighth-block bar (`█▉▊▋▌▍▎▏` leading edge, dim `░` track,
  `▕ ▏` frame); fill = elapsed, time = remaining; cycle dots `●●○○`; icons 🍅 focus / ☕ short
  break / 🌴 long break / ⏸ paused; phase color tints icon + fill + filled dots, everything
  else dim. 16-color baseline → 256/truecolor enhancement.
- **Delight, restrained:** blinking colon = running heartbeat (solid when paused); ~4s
  transition flourish at phase change; bold/bright time in the final minute. No spinners, no
  persistent motion.
- **Responsive to `COLUMNS`:** drop order bar → dots → label, always keep icon + time.
- **Passthrough is configurable** (`CLAUDORO_PASSTHROUGH="model,context,git"`); rendering it
  ourselves is "replace mode." Wrapping a user's pre-existing custom status line is a v2 item.

**Why not alternatives:**
- **Always two-line:** wastes a vertical line when idle and causes height shift on start/stop.
  Rejected as default; offered as the `full` mode for those who want it.
- **`minimal`/Pip as default:** the cycle dots are a very cheap, high-value glance upgrade
  (where am I in the set?). Classic wins as default; Pip stays available.
- **`labeled` as default:** only valuable when a label is always set; adds width cost otherwise.
  The label appears in `full` mode and in `/pomo status` instead.
- **Everything on the status line (no detail mode):** clutters the glance and fights for width
  with CC info. Rejected, secondary data goes to `/pomo status`.

**Evidence:** notes/003 (status-line UX design); status line capabilities from notes/001
(ANSI colors, multi-line, `COLUMNS`/`LINES`, `refreshInterval: 1`, hidden during prompts).

**Revisit if:** users report the blinking colon or transition flourish is distracting (make
them opt-out toggles); or terminal width telemetry shows the default breakpoints are wrong; or
demand for "wrap my existing status line" justifies pulling that out of v2.

---

## D-005: Packaging & install, Node.js package, `npm install -g` primary + `pomo setup`
**Date:** 2026-06-17
**Status:** accepted
**Context:** Per D-002, the bare `/pomo` command and the on-PATH `pomo` binary live outside the
plugin sandbox, so distribution needs a setup step that (a) puts `pomo` on PATH, (b) writes the
`/pomo` command file, (c) merges the `statusLine` setting into `settings.json`, (d) registers
hooks, and must satisfy the "uninstall leaves no orphans" success criterion. The governing
requirement set in this round: **work across many systems with as few dependencies as possible,
easy for the author to maintain, painless for the audience to install.** The audience is
**developers already running Claude Code**, i.e. people who already have **Node.js + npm**, the
native ecosystem of Claude Code itself, on Mac, Linux, and Windows alike.

**Choice:**
- **Single Node.js codebase.** `pomo` is a Node program. OS differences that sink other runtimes
  (path handling, date math, spawning a sound player) are absorbed by Node's stdlib (`path`,
  `os`, `fs`, `Date`, `child_process`) with identical code everywhere. One language, no
  cross-compilation, no per-OS artifacts, no shell-dialect matrix.
- **Primary install = `npm install -g claudoro`.** npm places `pomo` on PATH and writes proper
  `.cmd` shims on Windows automatically, so one command works on all three OSes. This makes
  **Windows first-class** (the failure mode that ruled out POSIX `sh`).
- **Claude Code wiring = an explicit `pomo setup`** that does the out-of-sandbox work: writes the
  `/pomo` command file, merges `statusLine` into `settings.json` (timestamped backup first),
  registers hooks, and records an install **manifest**. Deliberately **not** an npm
  `postinstall` script, postinstall is increasingly distrusted / disabled (`--ignore-scripts`),
  and mutating the user's live config there is fragile. `pomo setup` is transparent and
  re-runnable (idempotent via a marker).
- **Plugin path stays thin** (preserving the "plugin primary, script fallback" distribution
  shape): the marketplace plugin's setup hook just calls `pomo setup`. One shared install/setup
  core, so the two distribution paths cannot drift.
- **Uninstall / no-orphans:** `pomo uninstall` reads the manifest and reverses everything
  (command file, hooks, restores any pre-existing `statusLine` from backup); `npm uninstall -g
  claudoro` removes the binary. The manifest is the single source of truth across both paths.

**Robustness (baked in, runtime-independent):**
- **No `date` parsing:** store `end_epoch` and derive `remaining` by integer wall-clock
  arithmetic, sidesteps the BSD-vs-GNU `date` landmine.
- **PATH-independent core:** the `statusLine` command and `/pomo` command file reference the
  **absolute** path to `pomo`, so core function never depends on PATH membership; PATH only
  affects the convenience of typing `!pomo` interactively.
- **No persistent daemon:** state lives in a file; the status-line render derives everything from
  `end_epoch` each tick. End-of-phase sound is a tracked one-shot reaped on pause/stop/next-start,
  reconciled against wall clock to survive suspend.
- **Best-effort sound/notify:** detect-and-adapt per OS, degrade to terminal bell, then silent;
  never a hard dependency.
- **`settings.json` safety:** missing → create; invalid JSON → never clobber, back up + print
  manual snippet; existing custom `statusLine` → back up + record in manifest + log a notice;
  atomic temp-file + rename to survive concurrent writes by Claude Code.

**Why not alternatives:**
- **Static compiled binary (Go/Rust):** best runtime uniformity, but a permanent author
  maintenance tax, cross-compile pipeline, per-arch artifacts, macOS signing/notarization.
  Rejected as too complicated to maintain.
- **POSIX `sh` script:** zero runtime to install and maximally auditable, but pushes the cost onto
  every user's machine (BSD-vs-GNU `date`/`sed`, macOS bash 3.2, divergent sound players) and has
  **no honest native-Windows story**. Rejected: "might work, might have issues" is the wrong bet
  for a painless-install goal.
- **Python:** adds a runtime dependency *and* pays interpreter-boot latency on every ~1s
  status-line tick; Windows Python is more fragmented than Node for this audience. Rejected.
- **npm `postinstall` does the wiring:** fragile (often disabled/distrusted) and opaque about
  mutating live config. Rejected in favor of explicit `pomo setup`.

**Accepted tradeoffs:**
- **One dependency: Node.js.** For this audience it is already present (and if they install via
  npm, definitionally so). Documented as the single prerequisite (Node ≥ current LTS); `pomo`
  prints a friendly message if its runtime is missing rather than failing cryptically.
- **Node cold-start (~40-80ms) on the per-second status line.** Mitigated by a tiny status-line
  entry point with zero external `require`s, pure computation from the state file. Comfortably
  within budget on a developer machine; the seconds display tolerates it.

**Evidence:** notes/001 (control paths / status-line capabilities, `refreshInterval: 1`); D-001
(`!`pomo`` dynamic-context command, `pomo` CLI as source of truth); D-002 (out-of-sandbox
`/pomo` + on-PATH binary needing a setup step); audience common-denominator reasoning (this
round): Claude Code is an npm-ecosystem tool, so its users have Node+npm across Mac/Linux/Windows.

**Revisit if:** Node ceases to be a safe assumption for Claude Code users (e.g. the native-binary
install path dominates and Node is no longer commonly present), then reconsider bundling a
runtime or a single-file packager; or if the per-tick latency proves noticeable in practice
(then move the hot status-line render to a faster path).

---

## D-006: Cross-cutting UX polish, the invisible backbone
**Date:** 2026-06-17
**Status:** accepted
**Context:** Refinements that must hold across ALL view modes (minimal/classic/full) and every
surface, not just one mode. Brainstorm + evaluation in notes/004. These are what make the
product read as authored rather than assembled.

**Choice: adopt the following, consistently everywhere:**
1. **No-reflow monospace stability.** Zero-pad time (`09:59`, not `9:59`); fixed-width cycle
   dots (always render all N); ellipsis-truncate the label to a fixed budget; **hysteresis** at
   `COLUMNS` breakpoints (distinct grow/shrink thresholds) so the layout never flickers. The
   segment is carved in stone, the eye lands on the same pixel every glance.
2. **Calm-by-design bar.** The eighth-block sub-cell fill quantizes so the bar visibly advances
   only ~every 15s; never animate it per-tick. The seconds carry the "live" signal; the bar
   stays serene.
3. **Unified visual language.** The same icons / colors / bar dialect appear in the status
   line, `/pomo status`, OS notifications, the daily log lines, and README screenshots. Coherence
   across surfaces is the cheapest delight.
4. **Pause recedes.** When paused: dim the whole segment (~50%), freeze the bar, solid colon,
   `⏸`. Redundant cues for an instant "not running" read.
5. **Motion budget.** `CLAUDORO_MOTION=full|reduced|off` controls the colon blink + transition
   flourish (default `full`; `reduced` keeps flourish, drops blink; `off` = no motion).
   Inclusive of reduced-motion / focus-sensitive users; supersedes the per-feature toggles
   hinted in D-004.
6. **Overtime indicator.** If a block runs past its time, show `+M:SS` in amber with a gently
   pulsing full bar. (Shown at any boundary where Claudoro waits for acknowledgment, tone-matched
   to the phase, see D-006a.)
7. **Sound palette.** Three distinct, tasteful cues, mute-aware and consistently mapped: soft
   *tick* for the pre-end warning, a warm *chime* at focus-end, a gentle *prompt* at break-end.
   Eyes-free phase awareness.
8. **OSC 8 clickable 🍅.** The phase icon is an OSC 8 hyperlink to today's log (`file://`),
   so a click opens the daily log. Degrades gracefully to plain text on terminals without
   OSC 8 support. Low cost, and it ties the status line to the daily log surface for free.

**Robustness / edge-case mitigations (baked in):**
- Clock jumps (DST/NTP): clamp displayed remaining so it never increases within a running
  block; treat large backward jumps as "render last-known."
- Label width: hard-truncate with `…` to preserve the no-reflow guarantee.
- `COLUMNS` flicker: hysteresis (above).

**Deferred / optional (documented, not in v1 core):**
- Warning-point marker (`╷`) on the bar, risks noise; defer.
- Best-effort terminal **tab title** at phase transitions (covers status-line-hidden moments &
  backgrounded windows). Event-driven (stale when idle) and can clobber the user's title →
  strictly opt-in if shipped.
- First-run one-time hint (`🍅 try /pomo start`), not mode-consistent; defer.

**Why not (rejected):** per-second bar animation (jittery, distracting); always-on motion with
no opt-out (excludes reduced-motion users); mode-specific polish (violates the consistency
requirement); non-padded time (causes horizontal reflow, the single worst micro-irritation).

**Evidence:** notes/004 (UX enhancement brainstorm + evaluation); notes/003 (base UX system).

**Revisit if:** the sound palette annoys (allow per-cue disable); reduced-motion demand wants a
finer-grained control; or the deferred items (tab title) get user pull.

---

## D-006a: Phase transition behavior, three modes with `auto` default
**Date:** 2026-06-17
**Status:** accepted
**Context:** When a focus block ends, does Claudoro auto-advance into the break (and vice versa),
or wait for the user to acknowledge before starting the next phase? Auto-advance is frictionless
but can start a break mid-thought; wait-for-ack respects flow but can silently stall, and is the
only model where the **overtime indicator (D-006 item 6)** is meaningful. pymodoro auto-cycles.
The requirement this round: the behavior must be **flexible**, the user must **easily understand
which mode they're in**, and **easily switch**.

**Two framing insights:**
1. **It is a values split, not a feature toggle.** The flow-state developer wants nothing to
   interrupt them; the casual/disciplined user needs the timer to *make* them stop or the tool
   fails its core job. Both are valid, so the answer is **flexibility + a smart default**, not a
   single global switch.
2. **The two transitions are asymmetric.** Focus→break: auto enforces rest (good) but interrupts
   flow (bad), *contested*. Break→focus: auto-starting focus burns clock whether or not the user
   is back at the desk, *almost nobody wants this; waiting is near-universally better*. Treating
   them as one switch throws this away.

**Simulation evidence (four scenarios × {auto, balanced, manual}):**
- *S1 deep flow at focus-end:* auto worst (yanked out, then corrupted accounting); manual best.
- *S2 casual user needing to be made to break:* auto/balanced best; manual worst (break never
  happens). S1/S2 are exact inverses → confirms the values split and the need for a median default.
- *S3 steps away during break:* auto wastes focus clock; balanced/manual best (full block on a
  deliberate start).
- *S4 fully AFK / ambient rhythm:* auto best (hands-free); balanced/manual annoy.
Conclusion: on the *clock-waste* axis B→F is best waited (S3) and on the *flow* axis F→B is best
waited (S1), but **the audience expects a Pomodoro timer to auto-cycle**, so `auto` is the default
and `balanced`/`manual` exist for those who want the S1/S3 benefits. **All three modes are each
best for a real scenario**, so all three exist. The S3 cost of the `auto` default (focus running
while the user is away) is recovered by `pomo undo` (D-007).

**Choice:**
- **One mental model: "how much does Claudoro advance on its own?"** A single spectrum
  `manual → balanced → auto`. Underneath are two independent bits (auto-into-break,
  auto-into-focus); the three named modes are the sensible presets, and power users may set the
  bits directly.
  - **`manual`:** wait at both boundaries (flow-state work).
  - **`balanced`:** auto into break, wait to start focus. Enforces rest, never wastes focus clock
    while away, deliberate focus start.
  - **`auto` (default):** auto at both boundaries. Matches what the audience expects from a
    Pomodoro timer (pymodoro parity, hands-free cycling).
- **Visibility of system status:** mid-block the status line stays clean (mode is irrelevant while
  a phase runs); *at a waiting boundary* it shows the pending action + the verb to proceed
  (e.g. `⏸ focus done +1:23 · /pomo next → break`). `/pomo status` always states the mode in
  words. Auto transitions are never silent: chime + the ~4s transition flourish (D-006).
- **Easy switching:** `/pomo mode <auto|balanced|manual>` persists; bare `/pomo mode` prints the
  current mode + alternatives; a `pomo start` flag overrides per-session. Precedence:
  flag > persisted > default(`auto`). Switching mid-session resolves a currently-waiting
  boundary immediately.
- **Per-instance overrides (no mode change needed to do the other thing once):** `pomo next`
  (advance a waiting boundary now), `pomo extend [N]` (add minutes to the current phase),
  `pomo back` (undo the last transition within a short window, the flow-interruption escape).
  These compose with existing `pause`/`skip`/`stop` (D-001).
- **Overtime indicator (D-006 #6) becomes coherent:** it appears exactly where we wait,
  tone-matched to the phase, amber "still working past time" at a held focus-end, calm "ready
  when you are" at a break-end. Overtime ⇔ a waiting boundary; the two features explain each other.

**Edge cases / mitigations:**
- *Silent stall (manual):* overtime makes it visible by design; best-effort OS notification at the
  boundary + optional gentle re-chime at intervals (motion-budget aware, D-006 #5). Documented as
  the nature of `manual`.
- *First-run surprise (default yanks a new user into a break):* the boundary message is
  educational at the moment of friction (`☕ break started · /pomo mode manual to start breaks
  yourself`), the worst case becomes onboarding.
- *Auto-advance while AFK:* inherent to `auto`; `pomo back` / restart recovers a late return.
- *Transition race (`/pomo next` as auto fires):* transitions are idempotent, keyed on a
  phase-instance id; first wins, the other no-ops.
- *Clock jumps / suspend:* reconcile against wall-clock `end_epoch` (D-005); never silently lose
  or invent time.

**Why not alternatives:**
- **Single global auto/manual switch:** can't serve the inverse S1/S2 users, ignores the
  transition asymmetry, and is mode-error prone. Rejected.
- **Per-transition 2×2 config as the primary surface:** maximally flexible but hard to answer
  "what mode am I in." Kept as the *underlying* model behind the three presets (progressive
  disclosure), not the primary UI.
- **Default `manual`:** nothing moves on its own, but the technique silently fails for casual
  users (S2). Rejected as default; available as a mode.
- **Default `balanced`:** strongest on the wasted-clock axis (S3) and gentlest on flow, but the
  audience expects a Pomodoro timer to auto-cycle, so defaulting to it would surprise the
  majority. Rejected as default in favour of meeting audience expectation; available as a mode.

**Accepted tradeoffs:**
- **Default `auto` runs while the user is away** (it auto-cycles B→F, burning focus clock on
  blocks the user was not present for: scenario S3). Accepted because it matches audience
  expectation and is the least-surprising default for a Pomodoro tool. Mitigated directly by
  `pomo undo [N]` (D-007): the user, or Claude Code on their behalf, can unwind pomodoros that ran
  unattended, with automatic backup and explicit confirmation.
- **Mode names signal position on the spectrum, not the exact per-transition behaviour.**
  Mitigated by `/pomo status` and `/pomo mode` spelling each mode out in words, and by the
  boundary teaching the behaviour live.

**Evidence:** the four-scenario simulation above; UX heuristics (visibility of system status,
user control & freedom, minimize mode errors, default effect); D-006 #6 (overtime) and #5 (motion
budget); D-001 (command verbs); D-003 (pymodoro parity scope); D-005 (wall-clock `end_epoch`,
no daemon).

**Revisit if:** users dislike focus auto-starting while they are away (flip default to
`balanced`); users find three modes too many (collapse to `manual`/`auto`, lose `balanced`); or
the per-transition bits get enough demand to surface directly in the UI.

---

## D-007: Data model, logging, session label, and safe inspection/mutation by Claude Code
**Date:** 2026-06-17
**Status:** accepted
**Context:** D-001 makes `pomo` the source of truth. New requirements: every session carries a
**title/label** for what is being worked on; everything is **logged to JSON**; **Claude Code must
easily inspect, and on request modify, the data** (e.g. "I stepped away and it auto-ran 2
pomodoros, unwind the last 2"), and any modification must be **confirmed first and backed up**.

**Choice:**
- **Two stores** under the state dir (`~/.local/state/claudoro/`, per D-005):
  - **`state.json`** holds only the live, *non-derivable* state, rewritten atomically
    (temp file + rename) on each mutation. This is the **only** file the per-second status line
    reads, so the hot path stays tiny:
    ```json
    {
      "schema": 1,
      "run_state": "running",        // running | paused | idle
      "phase": "focus",              // focus | short_break | long_break | null (idle)
      "started": 1718600403,
      "end_epoch": 1718601903,       // wall-clock deadline; remaining = end_epoch - now
      "planned_min": 25,
      "paused_at": null,             // epoch when paused, else null (frozen remaining while set)
      "paused_total_sec": 0,         // accumulated paused time this phase
      "mode": "auto",
      "label": "Refactor auth",
      "set_number": 1,
      "set_index": 1,
      "current_record_id": "2026-06-17T09:00:03Z-1",
      "owner_session": "8f3c1a…",    // CC session that started/owns the timer (attribution + status)
      "alarms_fired": [],            // cues already fired this phase: "warning" | "end" (atomic claim)
      "alarm_pid": 48213,            // detached one-shot timer process, for cleanup; may be stale
      "config": { "work": 25, "short": 5, "long": 15, "frequency": 4, "notify": 1, "mute": false }
    }
    ```
    Remaining is derived from `end_epoch` minus now; on pause we stamp `paused_at` (freezing the
    displayed remaining), and on resume we shift `end_epoch` forward by the paused span and add it
    to `paused_total_sec`. `run_state: idle` means no active timer (the status-line segment is
    simply absent, per D-004). When a phase finalises, its values are written as an immutable
    history record (the D-007 record shape) and `current_record_id` advances. All read-modify-write
    goes through a file lock (`flock`) so concurrent `pomo` invocations from multiple Claude Code
    instances cannot corrupt or duplicate state; `owner_session` / `alarms_fired` / `alarm_pid`
    support the multi-instance model (see D-009).
  - **Per-day history** `logs/YYYY-MM-DD.jsonl`: one immutable record per finished phase. Per-day
    files align with the OSC 8 "today's log" link (D-006) and stay small; JSONL gives crash-safe
    single-line appends with no full-file rewrite.
- **Derive, do not store, aggregates.** Cycle position (blocks until long break), today's
  completed count, focus minutes, next long break, streaks: all computed by folding the immutable
  record list, never stored as mutable counters. **This is the backbone that makes mutation safe:**
  with no counters, removing records can never desync state; undo is correct by construction.
- **Record shape** (schema-versioned, stable addressable id). Fields fall into three groups by
  **provenance**: **(A) timing & identity** and **(B) intent & reflection** are captured
  deterministically by the CLI or entered by the user; **(C) work context** is agent-enriched,
  best-effort, and opt-in. Group C lives under `context`; a `provenance` map records any non-default
  source and `pending` lists context fields not yet captured (the agent is event-driven, not a
  daemon, so enrichment lands on next interaction or on demand).
  ```json
  {
    "id": "2026-06-17T09:00:03Z-1",
    "schema": 1,

    "session_id": "2026-06-17T09:00:03Z",
    "set_number": 1,
    "set_index": 1,
    "phase": "focus",
    "mode": "auto",
    "planned_min": 25,
    "started": 1718600403,
    "ended": 1718601903,
    "actual_min": 25.0,
    "overtime_min": 0,
    "status": "completed",
    "pauses": { "count": 1, "total_sec": 95,
                "intervals": [{ "start": 1718600900, "end": 1718600995 }] },
    "rest_record_id": "2026-06-17T09:25:03Z-2",
    "rest_min": 5,
    "config_snapshot": { "work": 25, "short": 5, "long": 15, "frequency": 4 },
    "mute": false,

    "label": "Refactor auth",
    "tags": ["backend", "auth"],
    "intention": "Finish token refresh",
    "intention_met": true,
    "notes": "Edge: clock skew on refresh.",
    "interruptions": [{ "ts": 1718600950, "type": "external", "note": "Slack ping" }],
    "energy": 4,

    "context": {
      "cwd": "/Users/ben/dev/app",
      "git_repo": "app",
      "git_branch": "feat/auth",
      "git_commit_start": "a1b2c3d",
      "git_commit_end": "e4f5a6b",
      "commits_made": ["e4f5a6b"],
      "files_touched": ["src/auth.ts", "src/token.ts"],
      "diff_stat": { "files": 2, "added": 84, "removed": 12 },
      "linked_issue": "https://github.com/org/app/issues/123",
      "summary": "Implemented token refresh with skew tolerance.",
      "next_step": "Add expiry test in token.test.ts"
    },

    "provenance": { "label": "agent", "summary": "agent", "next_step": "agent" },
    "pending": []
  }
  ```
  Field notes:
  - **(A) timing & identity** (CLI, always present): `id`, `schema`, `session_id` (groups a run on
    one task), `set_number` / `set_index` (position toward the long break), `phase`
    (`focus|short_break|long_break`), `mode`, `planned_min`, `started`, `ended`, `actual_min`,
    `overtime_min`, `status` (`completed|skipped|aborted|partial`), `pauses`
    (count + total + intervals, the internal-interruption signal), `rest_record_id` / `rest_min`
    (links a focus to the break that followed, so "rest time" is never orphaned), `config_snapshot`
    (keeps the record self-describing if defaults later change), `mute`.
  - **(B) intent & reflection** (user-entered or agent-prompted): `label`/title, `tags`,
    `intention` + `intention_met` (plan-vs-reality), `notes` (free text, appendable during/after),
    `interruptions` (`internal|external`, the classic Pomodoro metric, agent makes capture
    frictionless), `energy` (optional 1-5).
  - **(C) work context** (agent-enriched, best-effort, opt-in, under `context`): `cwd`, `git_repo`,
    `git_branch`, `git_commit_start`/`git_commit_end`/`commits_made`, `files_touched`, `diff_stat`,
    `linked_issue`, `summary` (auto-worklog), `next_step` (context-restore breadcrumb).
  - **Provenance & privacy:** `provenance` maps a field to its `source` (`cli|user|agent`) where it
    differs from the group default; `pending` lists context fields awaited. Group C is **opt-in**,
    stays **local** (no network, per D-005), and supports redaction; deterministic A/B never depend
    on the agent being present. All enrichment lands in the history record, never in `state.json`,
    so the per-second status-line hot path is untouched.
- **Session label / title:** `pomo start --label "..."` (`-t/--title` alias) sets it;
  `pomo label "..."` changes the current label without restarting. The label in force when a phase
  finalises is stamped onto its record. Optional (records may have null label). A "session" is
  just a run of records sharing a label; changing it mid-run simply stamps later records
  differently. Shown in `full` view (D-004) and `/pomo status`, ellipsis-truncated per D-006.
- **Inspection:** every read command offers `--json` (`pomo status --json`, `pomo log --json
  [--today|--date D]`), stable and schema-versioned; Claude Code prefers `--json`. The raw files
  are plain, documented JSON, so they are also directly readable for ad-hoc queries.
- **Safe mutation = CLI verbs are the API; Claude orchestrates the confirmation:**
  - `pomo undo [N]` removes the last N completed records and re-derives everything. `--dry-run`
    prints exactly what would be removed (also `--json`); without `--yes` it prompts; with `--yes`
    it proceeds. **A timestamped backup is written before every destructive op, unconditionally.**
  - `pomo restore [backup-id]` restores from a backup; `pomo log backups` lists them; backups roll
    (keep last K) to bound disk.
  - Intended Claude Code flow for "unwind the last 2": run `pomo undo 2 --dry-run`, show the user
    the exact records, get explicit confirmation in chat, then run `pomo undo 2 --yes`.
    Confirmation lives in the conversation; the backup is automatic at the CLI layer.
- **Direct-edit escape hatch:** because the files are documented, versioned JSON, Claude Code may
  edit anything the verbs do not cover (e.g. fix a mislabelled past record). Rule: prefer verbs
  (invariant-safe, auto-backup); for a direct edit, copy the file to a `.bak` first, preserve the
  schema, and confirm with the user before writing.

**Edge cases / mitigations:**
- *Undo crossing a day boundary:* operates on the most-recent records in global chronological
  order, touching whichever day files are involved.
- *Undo while a phase is running:* `undo` touches completed records only; the live in-progress
  phase is handled by `stop`/`back` (D-006a). Distinct and composable.
- *Counter desync:* impossible by construction (derive-don't-store).
- *Corrupt/partial trailing JSONL line* (crash mid-append): the parser skips an unparseable last
  line with a warning rather than failing the whole read.
- *Concurrent writes* (status line reading as undo writes): atomic temp+rename; readers tolerate a
  momentarily missing/locked file by rendering last-known.
- *Clock jumps:* epochs are wall-clock; `actual_min` recomputed and clamped (D-005/D-006).
- *No HOME / read-only state dir:* fall back to TMPDIR and degrade (D-005).

**Why not alternatives:**
- **Single monolithic JSON for state + all history:** every append rewrites the whole file (write
  amplification, larger corruption blast radius). Per-day JSONL appends are safer and smaller.
- **Stored mutable counters:** fast to read but desync on undo/edit and need transactional care.
  Derive-don't-store is simpler and robust.
- **Claude hand-edits JSON as the primary path:** easy to break invariants, no backup guarantee.
  Kept only as a documented escape hatch with backup discipline.
- **SQLite:** robust and queryable, but adds a dependency and opacity, and is not trivially
  human/AI-readable or hand-editable. Overkill at this scale.

**Accepted tradeoffs:** JSONL is less pretty to eyeball than one indented file (mitigated by
`pomo log` pretty output and `--json`); deriving aggregates re-reads records each call (negligible
at Pomodoro scale, and the status-line hot path reads only `state.json`).

**Evidence:** D-001 (CLI source of truth), D-005 (state dir, atomic writes, wall-clock,
no daemon), D-006 (OSC 8 today's log, no-reflow truncation), D-004 (full view shows the label),
D-006a (`pomo undo` recovers the `auto` default's S3 cost).

**Revisit if:** history grows large enough that the per-day fold is slow (add a cached rollup,
invalidated on mutation); or cross-device sync is wanted (different store/format).

---

## D-008: CLI help & output rendering, TTY-aware pretty, clean when captured
**Date:** 2026-06-17
**Status:** accepted
**Context:** We want a "pretty" help output (colour, structure). But CLI output is consumed in two
very different contexts: a human at a real terminal, and the **model context** (the `/pomo`
command injects `` !`pomo $ARGUMENTS` `` output, D-001). ANSI colour is delight in the first and
token-wasting noise in the second.

**Choice:**
- **One TTY-aware renderer.** Colour and box-drawing only when stdout is an interactive TTY; emit
  clean plain text when piped or captured (the Claude Code path). Honour `NO_COLOR` and
  `CLAUDORO_COLOR=auto|always|never` (default `auto`). Colour tiers follow D-004 (16-colour
  baseline, 256/truecolor enhancement) and reuse the unified visual language (D-006 #3), so help
  looks like the status line and `/pomo status`.
- **Structured `pomo help`:** tinted title, grouped sections (CONTROL / CONFIG / LOG & DATA),
  aligned command columns with one-line descriptions, dim current-value hints
  (e.g. `mode … (current: auto)`), an examples block, and a footer pointing at the state dir and
  `pomo help <command>`. Width-aware (`COLUMNS`). `pomo help <command>` gives per-command detail.
- **`--json` wherever programmatic** (status, log, `undo --dry-run`); `--help`/`-h` map to
  `pomo help`; `--no-color` forces plain.

**Edge cases / mitigations:**
- *Colour bleeding into the model context:* solved by TTY detection + `NO_COLOR`; the `/pomo`
  command can also pass `--no-color` defensively.
- *Narrow terminals:* wrap/truncate columns gracefully.
- *Non-UTF8 / no-emoji terminals:* ASCII fallbacks for icons (consistent with the D-004 baseline).

**Why not:** always-colour (noise in captured output, ignores `NO_COLOR`); plain-only (misses the
requested delight for terminal users). Both rejected.

**Evidence:** D-001 (`` !`pomo` `` injection into context), D-004 (colour tiers / view modes),
D-006 (#3 unified visual language), the `NO_COLOR` convention.

**Revisit if:** users want themeable help colours or a global `--plain` flag.

---

## D-009: Concurrency & multiple Claude Code instances, one global timer, shown everywhere
**Date:** 2026-06-17
**Status:** accepted
**Context:** `statusLine` is configured once, globally, so **every** open Claude Code instance runs
`pomo statusline` and could display a pomodoro; `/pomo` and the CLI can be invoked from any
instance. The question: is a pomodoro **global** (one per person) or **scoped** (one per terminal),
and how do display, control, alarms, and logging behave with N instances open at once?

**Two facts converge on the answer:**
1. **A human has one attention.** The Pomodoro Technique is single-tasking by definition; N
   simultaneous focus blocks is the anti-pattern it exists to prevent, and it makes the data lie
   (N logged focus-hours per elapsed hour).
2. **`statusLine` is a single global surface.** The platform already renders one shared command in
   every instance. Working with that grain means one logical timer rendered in many places, not N
   timers.

**Platform capabilities leveraged:** the `statusLine` command receives `{session_id, cwd,
workspace, ...}` on **stdin**, so each render is per-instance context-aware for free; hooks fire
per-session with a `session_id`; the `pomo` CLI is the single source of truth over one `state.json`
(D-005/D-007).

**Simulation (models M1 global / M2 per-instance / M3 owner-only-display):**
- *S-A one project, 3 terminals (1 active):* M1 shows the timer in all panes (follows your eye),
  one alarm, one record; only the label in an unrelated pane is cosmetic. M2 hides the timer when
  you switch panes. M1 better.
- *S-B one focus block spanning two repos:* M1 keeps one block (correct), enrichment aggregates
  both repos. M2 forces either a second concurrent timer (double-count) or no timer in the second
  pane (you "left" your pomodoro). **M2 fails.**
- *S-C user wants two truly separate timers:* the multitasking case the technique discourages;
  handled later as a deliberate *named* timer, not the default, so stats stay honest.
- *S-D `start` while a block runs:* resolved by idempotent, forgiving behaviour (report the running
  block, never duplicate or silently restart).

**Choice: single global timer, rendered by every instance ("the timer follows you"), with:**
- **One source of truth, locked.** All read-modify-write on `state.json` goes through `flock`, so
  concurrent `pomo` calls cannot corrupt or duplicate. Per-second renders are read-only and never
  contend.
- **Single-fire alarm via atomic claim (belt-and-suspenders).** End and pre-end cues are claimed by
  an atomic compare-and-set on `state.alarms_fired` (under the lock); the first to fire wins, all
  others stay silent regardless of instance count. Two firing sources for resilience: a **detached
  (`setsid`) one-shot** timer process spawned at phase start (fires even if every terminal is at a
  prompt or closed) and **opportunistic render-claim** (a renderer noticing an overdue, unclaimed
  cue fires it, covering a killed one-shot). Both go through the same claim, so never a cacophony.
- **Display everywhere by default; per-pane opt-out with zero state.** Ambient awareness is the
  point, so the segment shows in all panes. A pane that does not want it exports `CLAUDORO_HIDE=1`;
  the renderer checks its own env. No session tracking, self-cleaning.
- **Ownership that self-heals.** `owner_session` (set on `start`/`restart`) is used only for
  attribution and `/pomo status` disclosure; control (`pause`/`resume`/`stop`/`skip`/`extend`)
  works from any instance. If the owner session is gone, the next control action or `start`
  re-points it. A dead owner blocks nothing.
- **Logging falls out for free.** One timer → one record sequence → no double-count; the owner's
  `session_id` + `cwd` stamped on each record (D-007 group C) lets reports break down time per
  project/terminal. Cross-repo work in one block appends to a `contexts[]` list.

**Why not alternatives:**
- **Per-instance independent timers (M2):** permits simultaneous focus blocks (contradicts
  single-attention), multiplies alarms into cacophony, and double-counts so stats lie. Fails S-B.
  Rejected as default.
- **Owner-only display (M3):** less visual noise, but the timer stops being ambient, you lose
  sight of it when you switch panes, defeating the purpose. Rejected in favour of show-everywhere
  plus the `CLAUDORO_HIDE` env opt-out.

**Accepted tradeoffs:**
- **One mode/config/label globally:** cannot run two differently-configured timers at once. The
  deliberate multi-timer need is a future power feature (`pomo start --timer <name>`), kept out of
  v1 precisely because uncontrolled multi-timer corrupts single-attention stats.
- **Label shows in panes where it is contextually irrelevant:** cosmetic; `CLAUDORO_HIDE=1` opts a
  pane out.

**Edge cases / mitigations:**
- *Owner terminal closes mid-block:* timer is global, so it survives and still renders elsewhere;
  the alarm still fires (detached one-shot or render-claim); ownership self-heals.
- *All instances closed:* the detached one-shot still fires the OS sound/notification; state
  persists; a newly opened instance reconciles (fires an overdue cue via the claim, or shows
  overtime, D-006).
- *Simultaneous `start` race:* `flock` serialises, first starts, second reports the running block.
- *SSH / tmux:* same home → shared state (consistent, correct); different machines → independent
  (expected; no cross-device sync, per D-007).
- *Many panes:* N read-only renders/sec on a tiny file is cheap; only control actions take the lock.
- *Stale `alarm_pid`:* cleanup is best-effort; a dead PID is harmless.

**Evidence:** Claude Code `statusLine` stdin contract (`session_id`, `cwd`, `workspace`); D-001 (CLI
source of truth), D-005 (no daemon, detached one-shot alarm, atomic writes, wall-clock), D-006
(overtime / overdue render), D-007 (`state.json`, history records, derive-don't-store).

**Revisit if:** genuine demand for deliberate concurrent timers (add named timers `--timer <name>`
with per-timer stats kept separate so aggregates stay honest); or cross-device sync is wanted.

---

## D-010: Auto-pause on idle, an opt-in safety net for the forgotten timer
**Date:** 2026-06-18
**Status:** accepted
**Context:** The `auto` default (D-006a) keeps the clock running, and auto-cycles a new focus block,
whether or not the user is at the desk. D-006a accepted this "ran while away" cost (scenario S3) and
deferred recovery to retroactive `pomo undo`. The open question this round: can Claudoro *prevent*
the bogus accounting in the first place by detecting that "nothing is happening" and pausing on its
own, when the programmer has forgotten to stop, and can it do so without lying about focus time,
without daemons, and without touching the per-second hot path? The behaviour was optimised through a
scenario simulation (deep focus, stepped-away, lunch with laptop open/closed, sleep, multi-session,
clock jumps, return-after-pause, backgrounded-but-working, end-of-block-during-gap, flapping, write
races) before this decision.

**Two framing insights (from the simulation):**
1. **A status-line tick is *session* liveness, not *human* liveness.** `refreshInterval` re-runs
   `statusline` even while idle, so a terminal left in the foreground ticks forever while the user
   is at lunch. A presence signal built on ticks therefore *never fires in the exact case the
   feature exists for* (foreground-away). Interaction signals (prompts, tool calls via hooks) do not
   rescue this: deep thinking and being away are observationally identical to Claude Code (both have
   zero interaction). **The only signal that separates "present and thinking" from "away" is OS
   input-idle time**, so it must be the primary signal.
2. **Auto-pause is not a new state, it is a *tagged pause*.** The data model already has
   `paused_at`, `paused_total_sec`, and `pauses.intervals[]`, and `resume` already shifts `end_epoch`
   forward by the paused span. If an idle-pause is just a pause flagged `source:"idle"`, then
   reconciliation (excluding the away time from focus, re-deriving aggregates, `undo`/`restore`) is
   **correct by construction** and needs no new machinery (D-007 derive-don't-store).

**Choice:**
- **Opt-in toggle, default off.** `pomo idle [on|off|<minutes>]` sets/reads it; persisted in
  `prefs.json` (`{"idle": {"enabled": false, "after_min": 10, "resume": "manual"}}`); `pomo start`
  takes `--idle [N]` / `--no-idle` (precedence flag > persisted > default), consistent with D-003 and
  the D-006a mode spectrum. **Default off** because the audience expects a Pomodoro to keep ticking
  (pymodoro parity, D-003), and a timer that pauses itself is more surprising than one that
  auto-advances; opt-in avoids that surprise while making the safety net one command away. Default
  threshold **10 minutes** of input-idle (generous, so ordinary thinking does not trip it); a sane
  floor (≈2 min) prevents flapping configs.
- **Signal: OS input-idle, best-effort, degrading exactly like sound (D-005).** Query OS idle
  (`ioreg`/`HIDIdleTime` on macOS, an `xprintidle`-class query on Linux/X11, `GetLastInputInfo` via
  PowerShell on Windows) only at discrete check points, never per tick. When unavailable (SSH,
  headless, Wayland, tool absent) **degrade to the session-liveness heartbeat** (last tick/hook
  mtime), which honestly catches only terminal-close / sleep / quit, not foreground-away. The active
  signal is surfaced (`/pomo status` shows `os-idle` or `degraded`) so reduced coverage is never a
  silent cap.
- **Where the check runs: the existing detached one-shot, generalised into a per-block watcher;
  the hot path stays pure.** The alarm one-shot already sleeps through the block; it also wakes
  coarsely (≈ every few minutes), queries idle, and, if idle ≥ threshold, applies the auto-pause
  transition under `flock`. It is reaped on pause/stop and dies at block end exactly as today, so it
  is **not a persistent daemon** (honours D-005). Verb-heads and the end-of-block boundary are
  backstops. The renderer never queries idle and never locks (INV: cheap, crash-free hot path).
- **Mechanism: a precise, retroactive, tagged pause.** On trigger, stamp the pause at
  `lastActive = now − measured_idle` (so only attended time is ever credited as focus), tagged
  `source:"idle"`. A paused block has a frozen deadline, so its boundary cannot fire an alarm into an
  empty room or auto-advance a bogus block (this is why no special end-of-block suppression is
  needed: pausing *before* the boundary already handles it; the boundary check is only a backstop for
  idle that begins too close to the end).
- **Reconcile-after-pause (resolved per scenario):**
  - *Returns to continue:* `pomo resume`, the standard resume shifts `end_epoch`; the `idle`
    interval is recorded; focus excludes the gap.
  - *Returns done / abandoning:* `pomo stop` finalizes a `partial` with `actual_min` = attended time.
  - *Returns much later (zombie pause):* a block paused longer than `idle.expire_after` is
    auto-finalized `partial` on the next interaction, so stale paused state never lingers.
  - *Frictionless option:* `idle.resume = auto` resumes on the first interaction after an idle-pause;
    default `manual` keeps resumption explicit so the accounting stays visible and honest.
- **UX/visibility:** while idle-paused the segment uses the D-006 #4 recede treatment plus an "away"
  annotation and the verb to proceed, e.g. `⏸ 17:30 · away 42m · /pomo resume`; `/pomo status`
  states the setting in words (`Auto-pause: on, after 10m inactive (os-idle)`).

**Why not alternatives:**
- **Status-line-tick / interaction presence (the first design):** dominated by session liveness, so
  it fails foreground-away (lunch with the laptop open), the headline case. Rejected as the primary
  signal; the heartbeat survives only as the degraded fallback.
- **OS-level idle as a hard dependency / always-on watcher daemon:** a persistent daemon violates
  D-005, and a hard idle dependency breaks on headless/SSH. Rejected in favour of best-effort idle
  on the existing bounded one-shot, with graceful degradation.
- **A new "idle/auto-paused" state and bespoke retroactive-truncation logic:** redundant with the
  pause machinery and a fresh way to desync aggregates. Rejected: model it as a tagged pause.
- **Default on:** directly neutralises the D-006a S3 cost, but auto-pausing a running block is
  intrusive and surprising for the deep-flow user and contradicts audience expectation. Rejected as
  the default; available with one command.

**Accepted tradeoffs:**
- **The motionless deep-thinker can be falsely paused** (staring while thinking, no input, past the
  threshold). This is irreducible: OS input-idle cannot distinguish "thinking still" from "left the
  room." Mitigated by the generous default threshold, full reversibility (a tagged pause loses
  nothing, `resume` continues), and `pomo idle off` for pure-flow users. This is the same values
  split as D-006a (flow-state vs casual), resolved the same way: smart default plus an easy toggle.
- **Degraded mode loses foreground-away coverage** where OS idle is unavailable; surfaced, not
  silent.
- **"At the machine but off-task"** (browsing) keeps the timer running, OS idle reports presence and
  task-relevance is unknowable. Out of scope.
- **The watcher adds bounded interval wakeups**; coarse intervals keep the battery/CPU cost modest,
  and it self-terminates at block end.

**Edge cases / mitigations:**
- *Clock jump backward (NTP/DST):* idle = `now − lastInput` clamps to ≥ 0, so no spurious pause;
  displayed remaining still clamped per D-006.
- *Clock jump forward vs genuine away:* OS idle is measured against input, not wall clock, so a
  forward jump while actively typing reads as *active* (no pause), while true absence reads as idle
  (pause). More robust than a wall-clock heartbeat.
- *Laptop sleep:* the watcher is suspended too; on wake it detects its overdue wake (scheduled-vs-
  actual gap) and pauses at the pre-sleep `lastActive`; the heartbeat fallback and the boundary check
  are additional backstops. (Note: OS idle resets on wake, so sleep must be caught by the overdue
  wake, not by the post-wake idle reading.)
- *Multi-session (D-009):* OS idle is machine-global and one global watcher serves the one global
  timer, so activity in any pane keeps the timer running; no per-pane bookkeeping.
- *End-of-block during the gap:* prevented, the block is already paused before its boundary, so no
  alarm and no auto-advance; boundary check backstops the too-late-to-pause case.
- *Flapping (repeated short glances):* the generous threshold and the floor mean only genuine ≥
  threshold absences pause; each is a real interval, no churn.
- *Write race (watcher pause + a verb + alarm claim together):* serialised by `flock`; transitions
  are idempotent (auto-pause when already paused, or resume when running, no-op), first wins, per the
  D-006a/D-009 idempotency rule.

**Evidence:** scenario simulation (S1 deep-focus … S12 write-race, optimised over five iterations
against a frozen scenario set); A1 from the spec glossary (`refreshInterval` re-runs even while
idle); D-006a (the `auto` S3 cost this mitigates, and the values-split + smart-default + toggle
pattern reused); D-005 (no daemon, detached one-shot, best-effort-and-degrade, wall-clock); D-007
(derive-don't-store makes a tagged pause reconcile correctly; `undo`/`restore` as the backstop);
D-006 (#4 pause-recedes treatment, clock-jump clamping); D-003/D-004 (flag + persisted-pref +
spectrum config shape).

**Revisit if:** feedback shows users want it on by default (flip the default, keep the generous
threshold); the motionless-thinker false-pause proves common (add a soft two-stage "still there?"
hint before the hard pause, or lengthen the default); robust cross-platform idle detection (esp.
Wayland) becomes cheap enough to make the degraded path rare; or demand appears for an OS-idle-driven
*auto-resume* on return rather than the explicit default.

---

## D-011: Stats and dashboard, one fold rendered to three surfaces
**Date:** 2026-06-19
**Status:** accepted
**Context:** The live status line answers "what now?" and `pomo log` is the ledger of individual
blocks, but neither answers "how am I doing over time?" (streaks, where focus goes, when I focus
best). Users asked for a richer view and for a "user-friendly" rendering of the logs in local time.
The day logs are stored in UTC (D-007) and that stays: UTC is stable, portable across machines, and
never needs reparsing across timezone changes. The open question was the *surface*: a browser
dashboard (as built for the sister project skill_loop) is rich and shareable, but a browser hop is
the exact context switch Claudoro exists to remove. The audience lives in the terminal.

**Two framing insights:**
1. **Local time is a presentation concern, not a storage concern.** Storage and the ledger stay UTC
   (`derive.dateOf`); the human-facing analytics bucket by *local* calendar day and hour
   (`stats.localDay`). This cleanly separates the two layers and is the literal answer to the
   "user-friendly local view" ask, with zero change to the immutable log.
2. **The dashboard is a fold, not a surface.** Streaks, the focus heatmap, tag totals, the
   time-of-day histogram and outcome mix are all derived from the same immutable records (D-007).
   Compute them once in a pure `foldStats(records, now)`, then render that one payload three ways.
   The surfaces can never disagree because they share the fold.

**Choice:**
- **One verb, minimal surface: `pomo stats`** with three renderings of a single payload:
  - **terminal (default)** — an ANSI/Unicode panel (KPIs, streak, focus heatmap, top tags, by-hour,
    outcomes) in the same visual language as the status line (D-006). Terminal-first honours the
    no-context-switch promise; it works over SSH and headless where no browser exists.
  - **`--web`** — a self-contained static HTML file written to the state dir and opened in the
    browser; the opt-in deep-dive / shareable artifact. The browser hop is chosen, never default.
  - **`--json`** — the agent feed, so Claude can narrate trends in chat (the group-C enrichment
    gestured at in notes/005). Stable, schema-versioned, like every other `--json` verb (D-008).
- **`pomo log` stays the ledger** (individual records, browsable by range/filter). `pomo stats` is
  the summary. Two clear nouns, no third verb; `--web` is a rendering of the stats, not a new surface.
- **The HTML is static and dependency-free.** Fully rendered in Node (no client JS, no CDN, no
  network), values baked in, every user string HTML-escaped. It honours the zero-dependency and
  local-first invariants, is XSS-safe against hand-edited labels by construction, and renders
  offline forever. Interactivity (filtering) is deferred; it is not needed for v1 and would add a
  client-JS attack surface for little gain.
- **`foldStats` lives in its own module (`src/stats.js`), never in `derive.js`.** `derive.js` is on
  the per-tick hot path; the heavier analytics fold (streak, heatmap grid, tag and hour
  aggregation) must not inflate that module's load cost (the cheap-hot-path invariant). `stats` is a
  cold-path verb that reads all records, like `undo`/cadence re-derivation already do.

**Consequences:** a new module M9 (pure fold + two pure string renderers + a thin verb and a
cross-platform browser-open edge). The dashboard is a rebuildable artifact: delete `dashboard.html`
and the next `pomo stats --web` recreates it. It contains your labels, so it lives in the state dir
and is not for casual sharing. Local-time analytics are anchored to the machine that owns the data,
which is the right default for a local-first personal tool; opening the file on a far-timezone
device shows the owning machine's local day, which is acceptable and consistent with the terminal.

**Revisit if:** users want a range selector on stats (reuse `pomo log`'s `resolveRange`); demand
appears for interactive filtering (add a guarded client-JS layer, keeping the static page as the
no-JS fallback); or cross-device viewing becomes common enough to justify per-viewer timezone
rebucketing (embed raw epochs and fold in the browser, accepting the logic duplication).

---

## D-012: Abandoned time is credited, not counted; bounded at write and read
**Date:** 2026-06-19
**Status:** accepted
**Context:** A focus block was started, then forgotten (laptop asleep / walked away), and `pomo stop`
was run ~11.5h later. The record landed as one focus block with `actual_min ≈ 692` (`11h 32m`),
poisoning every focus aggregate (totals, heatmap intensity, by-hour peak). The auto-advance path is
already correct: `reconcileStep` finalizes a completed phase at `state.end_epoch`, so the detection
delay is never counted. The pollution comes only from the paths that finalize at the real `now`:
`stop`, `next` at a waiting boundary, and `skip` on an overdue phase. The constraint is that modest
overtime (e.g. 35 min on a 25 min block, ignoring the chime in flow) is REAL and must be kept; only
egregious overflow (hours) is abandonment. Without an OS-idle signal (that is D-010), magnitude is
the only discriminator available at finalize time.

**Two framing insights:**
1. **Abandoned time is a credit problem, not a deletion problem.** The user's instinct ("log the
   session, ignore the rest") is right, but "ignore" should not mean deleting records (destructive;
   `undo` already does that safely under D-007). It means *crediting bounded focus* and discarding
   the overflow. Nothing is lost: `started`/`ended` still record the true span, and a flag marks it.
2. **One cap notion, enforced twice.** The same bound ("credit real elapsed up to planned +
   `max_overtime`") is applied at write time (so new records are honest) and at read time in the
   folds (so legacy and hand-edited records can never poison aggregates either). Read-time defense
   means the existing `11h 32m` record is neutralised the moment this ships, with no migration.

**Choice:**
- **Bounded credit at finalize.** `finalizeRecord` caps `actual_min`/`overtime_min` at
  `planned + max_overtime` and sets `abandoned: true` when the cap bites. `started`/`ended` keep the
  true span. The auto-reconcile path (finalizes at `end_epoch`) is unaffected by construction.
- **Defensive credit at read.** A single `derive.creditedMin(record)` (and `wasAbandoned(record)`)
  is used by `summarize`, `foldRecords`, and `foldStats`, so every aggregate credits at most
  `planned + max_overtime` per record regardless of what the log holds.
- **Honest ledger.** `pomo log` shows an abandoned record as its credited focus plus the true span,
  e.g. `25m focus (ran 11h 32m, abandoned)`. The truth is surfaced, never buried.
- **The override.** `pomo stop --full` / `pomo next --full` record the true elapsed (the rare
  genuine marathon); the threshold is `max_overtime`, captured at start (flag > default, like
  `back_window`), default **30 min**, so real overtime is never clipped.
- **Auto-close a held boundary.** A waiting boundary (manual/balanced) left in overtime past the
  same `max_overtime` threshold is auto-closed to idle by `reconcileStep` (the held phase keeps full
  credit for its planned duration), rather than showing `+overtime` forever. The status line drives
  this via a cheap `overtimeExceeded` gate (no extra hot-path imports); the worker/render reconcile
  path needs no new plumbing. The same threshold serves both the credit cap and the auto-close, so
  there is one knob, not two.
- **Scope boundary.** This fixes the *duration* pollution (the reported bug). The *count* inflation
  from an awake `auto` cascade is prevented by D-010 (idle auto-pause) and recovered by `undo`; it
  is deliberately not re-solved here, because auto-dropping completed records would violate D-007.

**Consequences:** the PhaseRecord gains an optional `abandoned` boolean and `Config` gains
`max_overtime` (additive, schema stays 1; readers default when absent). Stats are robust by
construction, forever, without migration. The change is small and centralised: one cap in
`finalizeRecord`, one helper in `derive`, and the consumers that already read `actual_min` keep
working because the credited value flows through the same field.

**Revisit if:** users report real overtime being clipped (raise the default or make the threshold a
persisted pref); or an OS-idle signal lands (D-010) and can distinguish present-overtime from
absence precisely (then credit by presence, not magnitude, and auto-close on true idle rather than
on elapsed threshold).
