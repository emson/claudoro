# Claudoro

A Pomodoro timer that lives inside the Claude Code terminal: a live, ticking countdown in
the status line, plus a reliable end-of-session alarm. Open source, installable as a Claude
Code plugin.

## Problem

Developers who work in long Claude Code sessions lose track of time. Deep-work and
context-switching cost is real: without a timekeeping cue you either burn out grinding past
your limit, or you break the flow by alt-tabbing to a separate timer app, which pulls you out
of the terminal you're living in.

Existing pomodoro tools (menu-bar apps, browser tabs, phone timers) all sit *outside* Claude
Code, so they compete for attention with the very tool you're trying to focus in. Nothing
shows the countdown *where your eyes already are*, the Claude Code session.

If we don't solve it: people keep using out-of-band timers (good enough but distracting), or
go without (worse). The status line is an unused, always-visible surface that's a natural home
for this.

## Users

- **Primary:** Solo developers / power users who run long Claude Code sessions (the kind of
  person who already customizes their status line, uses plugins, and practices pomodoro or
  wants to). They're comfortable editing `settings.json` and running a CLI.
- **Secondary:** Teammates who discover it as an open-source plugin and want a one-command
  install with sane defaults and zero config.
- **Explicitly not targeting (v1):** Non-terminal users; people who want a full time-tracking
  / analytics product; Windows-native (non-WSL/Git-Bash) users as a first-class target.

## Success Looks Like

<!-- Each becomes an acceptance test later -->
- A new user can install the plugin and start a pomodoro in **under 2 minutes** following only
  the README (clone/marketplace add → `/pomo start` → countdown visible).
- The status line shows a **second-by-second countdown that keeps ticking while the session is
  idle** (no typing required), via `refreshInterval`.
- When a focus block ends, the user gets an **alarm that fires within ~1s of the true end
  time**, even if the status line is hidden or Claude Code is idle (alarm is decoupled from the
  render loop).
- Installing Claudoro **does not destroy or hide** the user's existing status line info
  (model, context %, git), it composes with it.
- Running two Claude Code sessions at once gives **two independent timers** that don't interfere.
- Uninstalling leaves **no orphaned background processes** and cleanly restores the prior
  status line.

## Scope (v1)

**In:**
- Status line countdown (phase icon + MM:SS + smooth progress bar + cycle dots + color by
  phase), ticking via `refreshInterval: 1`. Default "Classic" look; three switchable view
  modes (`minimal` / `classic` / `full`) via `pomo view`, plus an on-demand `/pomo status`
  detail dump. Responsive to terminal width; prepends to a configurable passthrough of the
  normal CC info (model · context% · git) *(D-004)*.
- Control surface: `/pomo` slash command (`start [mins]`, `pause`, `resume`, `stop`, `skip`,
  `status`), shipped as a top-level command file so it's the *bare* `/pomo` and not a
  namespaced `/claudoro:pomo` *(D-002)*. It wraps the `pomo` CLI via `` !`pomo $ARGUMENTS` ``
  injection; the CLI is the single source of truth and is also runnable directly as `!pomo ...`
  for a zero model-turn path *(D-001)*.
- Classic pomodoro cadence: focus → short break → long break every 4th focus. All durations
  configurable via flags on `pomo start`: `-w/--work` (default 25), `-s/--short` (default 5),
  `-l/--long` (default 15), `-f/--frequency` (default 4) *(D-003)*.
- Optional session label: `/pomo start 25 "write tests"`: label shows in the status line
  and is written to the session log on completion.
- Decoupled end-of-block alarm via a detached background `sleep` process (precise,
  render-independent). A pre-end warning fires N minutes before the end (`--notify N`,
  default 1); both alarms scheduled at start time from the same daemon pattern.
- Cross-platform notify helper (macOS `afplay` / Linux `notify-send`/`paplay` / terminal bell
  fallback), with `--mute` flag and `/pomo mute` toggle.
- `/pomo reset`: restart the current phase without advancing the cycle count (for when you
  get interrupted mid-focus).
- Session logging: `pomo` CLI appends a timestamped line to
  `~/.claude/claudoro/log/YYYY-MM-DD.log` on each *completed* focus block. `/pomo log` prints
  today's log; `pomo log reset [--force]` clears it; `pomo log open` opens in `$EDITOR`.
- Per-session state keyed by `session_id`; graceful handling of stale state and orphaned alarms.
- Composes with an existing status line (passes through model/context/git on a second line).
- Packaged for distribution as **Claudoro** with a README. Note: because the bare `/pomo`
  command and the on-PATH `pomo` binary live outside the plugin sandbox, the install story
  needs a setup step (not a pure marketplace install), exact packaging is an open decision
  *(D-002 → D-005 TBD)*.

**Out (v2+ / non-goals):**
- Time-tracking history, stats, reporting, or analytics.
- A separate TUI / tmux pane / GUI window (defeats the "inside Claude Code" premise).
- Team sync, cloud state, or accounts.
- Native Windows PowerShell parity (WSL/Git Bash is the v1 path; PS variant is a stretch goal).
- Deep Claude-awareness features (e.g. Claude actively nudging you to break via context
  injection), interesting, but a token-costing opt-in extra, not core.
- Auto-pausing the timer based on detected (in)activity.

## Constraints

- **Display surface:** Claude Code owns the TUI; the only sanctioned display surfaces are the
  status line (stdout) and the terminal title (OSC via a hook's `terminalSequence`). Timer
  must live in the status line.
- **One status line slot:** there is a single `statusLine` setting, Claudoro must compose, not
  clobber.
- **Status line refresh:** event-driven (debounced 300ms) + optional `refreshInterval` (min 1s,
  ticks while idle). `refreshInterval` requires a recent Claude Code version; must degrade
  gracefully on older versions.
- **Per-tick cost:** the status line script runs every second, must be cheap (pure bash, no
  `jq`/subprocess per tick); in-flight runs are auto-cancelled by Claude Code.
- **No API tokens:** status line and CLI run locally; core feature must not consume model tokens.
- **Dependencies:** keep minimal and POSIX-ish (`bash`, `date`); avoid hard `jq` requirement.
  Target macOS + Linux (incl. WSL/Git Bash) for v1.
- **Open source:** MIT-style license, clean install/uninstall, good README, this is a public
  artifact, not just a personal script.
