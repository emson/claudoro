# 002: pymodoro feature mapping

Source: https://github.com/emson/pymodoro, user's own Python/Rich CLI pomodoro timer.
Purpose: identify what ports to Claudoro, what doesn't, and what changes the v1 scope.

## What pymodoro is

A full-screen Rich TUI that owns the terminal, reads live single keypresses (keyboard.py),
and renders an animated interface with ASCII tomato art. Modules: `__main__.py` (CLI entry),
`interface.py` (Rich TUI), `timer.py` (logic), `keyboard.py` (input loop), `sound.py` (audio).

Key constraint for the mapping: **Claudoro cannot replicate the TUI or keyboard loop**, Claude
Code owns the screen and stdin. Every pymodoro feature must be re-expressed as status-line
rendering or discrete `pomo` subcommands.

## Feature-by-feature mapping

### ✅ Direct ports (v1)

| pymodoro feature | How it maps to Claudoro |
|---|---|
| Session-aware colors (work=red, short=green, long=blue, paused=yellow) | ANSI colors in status line, same scheme |
| Chunky progress bar | `▰▰▰▱▱` Unicode block bar in status line |
| Pause / Resume (SPACE) | `/pomo pause` / `/pomo resume` |
| Skip to next (N, with confirm) | `/pomo skip` |
| Mute toggle (M key / `-m` flag) | `/pomo mute` toggle + `--mute` flag on start |
| Configurable durations (`-w/-s/-l/-f`) | Same flags on `pomo start` *(→ resolves open durations question, see D-003)* |
| Quit (Q) | `/pomo stop` (no foreground app to quit) |

### ✅ New additions to v1 scope (pulled from pymodoro)

**1. Pre-end warning (`--notify N`, default: 1 min before end)**
- pymodoro: plays a warning sound N minutes before session ends.
- Claudoro: the decoupled alarm daemon already launches a background `sleep` for the end
  signal. A second `sleep` for the warning adds zero complexity: schedule both at `start` time.
  `pomo start --notify 2` (default 1). High value, low cost.

**2. Session logging (daily, timestamped)**
- pymodoro: persistent daily log, `--reset_log` / `--open_log`.
- Claudoro: `pomo` CLI appends a line to `~/.claude/claudoro/log/YYYY-MM-DD.log` on each
  *completed* pomodoro (not on pause/stop, only when the full focus block finishes). Format
  per line: `HH:MM  focus  25m  "label if any"`.
- Zero API tokens, no display needed, fits naturally alongside the state dir.
- `/pomo log` prints today's log; `pomo log reset` clears it; `pomo log open` opens in $EDITOR.

**3. Session reset (`R` key, restart phase, keep cycle count)**
- pymodoro: "Your Pomodoro number stays the same, you're just restarting the current session."
  Requires confirmation.
- Claudoro: `/pomo reset`: resets `end_epoch` to `now + total_secs`, reschedules alarm,
  does NOT increment `cycle`. Useful when interrupted mid-focus.

**4. Session label on `start`**
- pymodoro has no explicit label feature, but logging makes it natural.
- Claudoro: `/pomo start 25 "write tests"`: label stored in state, shown in status line
  alongside the countdown, and written to the log on completion.
- Better fit here than in pymodoro because the label is always visible in the status bar.

### ⚠️ Shrunk (present but adapted)

**ASCII tomato art**
- pymodoro: full multi-line ASCII art rendered in the TUI.
- Claudoro: no room in a 1-2 line status bar. Use 🍅 glyph only. The "art" is the progress bar.

**Smart confirmations (accidental skip/quit prevention)**
- pymodoro: guards destructive live keypresses.
- Claudoro: explicit verb commands can't be "accidental" in the same way. Light version: `stop`
  with an active timer prints a warning and requires `--force` or a second `stop`. `log reset`
  requires `--force`. Skip has no confirmation (it's intentional and reversible by
  manual restart).

### ❌ Does not port (architecture mismatch)

| pymodoro feature | Why not |
|---|---|
| Full Rich TUI (`interface.py`) | Claude Code owns the screen, replaced by the status line |
| Live single-key keyboard loop (`keyboard.py`) | Claude Code owns stdin, replaced by `/pomo` subcommands |
| `H` help screen (TUI overlay) | Replaced by `/pomo help` and argument hints in command frontmatter |

### 🔜 Deferred to v2

| Feature | Reason |
|---|---|
| Log analytics / stats (sessions per day, streaks) | Charter non-goal; basic log file is the foundation |
| Native Windows PowerShell support | Charter constraint; WSL/Git Bash path for v1 |

## Impact on v1 scope

Add to **Scope (v1) In:**
- Pre-end warning alarm (`--notify N`, default 1 min, same alarm-daemon pattern)
- Session logging (daily timestamped log of completed pomodoros, `pomo log` subcommands)
- `/pomo reset` subcommand (restart current phase, preserve cycle count)
- `--mute` flag + `/pomo mute` toggle
- Optional session label: `/pomo start [mins] ["label"]`, shown in status line + log
- Flag-based duration config: `-w/--work`, `-s/--short`, `-l/--long`, `-f/--frequency` on
  `pomo start` *(D-003 resolves the open "durations config" question)*

**Resolved open question:** durations config → flags on `pomo start`, matching pymodoro's
interface (`-w/-s/-l/-f`). Env vars or a config file are a v2 convenience on top. → D-003.

## Full revised command set

```
pomo start [mins] ["label"] [-w N] [-s N] [-l N] [-f N] [--notify N] [--mute]
pomo pause
pomo resume
pomo stop [--force]
pomo skip
pomo reset
pomo mute          # toggle
pomo status        # print current state (for /pomo status injection)
pomo log           # print today's log
pomo log reset [--force]
pomo log open
pomo help
```
