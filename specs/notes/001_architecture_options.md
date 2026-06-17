# 001: Architecture options & research

Raw exploration of how to show a Pomodoro timer inside Claude Code. Scratch space; the
locked-in choices move to decisions.md and spec.md.

## Key research findings (Claude Code internals)

From the official docs (statusline, hooks, plugins):

- **Status line** = a shell script in `settings.json`. Claude Code pipes session JSON on
  **stdin**, renders stdout to a persistent bottom bar. Supports **multi-line**, **ANSI
  colors**, **OSC 8 links**. Runs **locally, no API tokens**. Hidden during autocomplete /
  help / permission prompts.
- **Refresh**: event-driven (each assistant message, `/compact`, permission-mode change, vim
  toggle), **debounced 300ms**, these "go quiet" when idle. **`refreshInterval: N`** (min 1)
  ADDITIONALLY re-runs on a fixed timer *including while idle*, explicitly meant for
  "time-based data such as a clock." → **This is the linchpin that makes a live countdown work.**
  Requires a recent CC version; degrade gracefully on older ones.
- stdin gives us **`session_id`** (per-session state key), `model.display_name`,
  `context_window.used_percentage`, `cost.*`, `workspace.*`, `version`, etc.
  `COLUMNS`/`LINES` env vars give terminal width (v2.1.153+).
- **Hooks**: run commands on events (`Stop`, `Notification`, `PostToolUse`, `SessionEnd`…),
  support `async`, can emit `terminalSequence` (OSC escape codes → terminal title).
  `Notification` hook = standard place to fire a sound.
- **Plugins** bundle it all: `.claude-plugin/plugin.json` + `commands/` + `hooks/hooks.json`
  + status line script. `${CLAUDE_PLUGIN_ROOT}` resolves the plugin path in config.
- **Hard constraint:** Claude Code owns the TUI. Only sanctioned display surfaces are the
  status line (stdout) and the terminal title (OSC). No arbitrary screen drawing.

Doc sources:
- https://code.claude.com/docs/en/statusline
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/plugins

## The core insight: two problems, two tools

1. **Glanceable live countdown** → status line + `refreshInterval: 1`.
2. **Reliable "time's up" alarm** → a **detached background `sleep` process** that fires on
   time regardless of render state.

Decoupling these is what makes it robust. Status line = purely visual; alarm = purely timing.
They share one small state file.

## Options considered

| Approach | Verdict |
|---|---|
| Status line countdown (`refreshInterval`) | ✅ Primary display. Native, persistent, no tokens, ticks when idle. |
| Detached `sleep` daemon for the alarm | ✅ Pairs with display. Precise, render-independent, survives old CC versions. |
| Separate tmux pane / 2nd terminal TUI | ❌ Not "inside" Claude Code; defeats the premise. |
| Terminal **title bar** via OSC | ⚠️ Optional bonus only, CC may overwrite the title; updates only on hook events. |
| Hook injecting "take a break" into Claude's **context** | ⚠️ Optional extra (Claude can nudge you); burns context, not a live display. → v2. |
| MCP server with start/stop tools | ❌ Heavyweight; displays nothing itself; still needs the status line. |

## Proposed architecture (to be ratified as decisions)

Plugin `claudoro/`:
```
claudoro/
├── .claude-plugin/plugin.json
├── commands/pomo.md         # /pomo start|pause|resume|stop|skip|status → calls CLI
├── bin/pomo                 # control CLI: writes state, manages alarm daemon
├── statusline.sh            # reads state, renders countdown, composes w/ normal info
└── hooks/hooks.json         # optional: SessionEnd cleanup; Notification sound
```

**State**, per-session file `~/.claude/claudoro/<session_id>.state`, plain `key=value`
(pure-bash parse, no jq per tick):
```
phase=focus            # focus | short_break | long_break | idle
end_epoch=1750170000
total_secs=1500
paused=0
paused_remaining=
cycle=2                # focus count toward the 4→long-break cadence
```
Alarm PID tracked alongside: `<session_id>.alarm.pid`.

**statusline.sh**, read stdin `session_id`, read state, `remaining = end_epoch - now`,
render `🍅 focus  12:34  ▰▰▰▱▱` colored by phase; second line passes through model/context.

**bin/pomo start**, write state + launch detached alarm:
`( sleep $secs; notify "Focus done"; ) & echo $! > <sid>.alarm.pid`
pause/stop/skip update state and kill/reschedule the alarm.

## Edge cases → mitigations (candidates for simulation)

- Only one status line slot → **compose** (pass through model/context/git).
- Old CC without `refreshInterval` → countdown stops ticking when idle, but **alarm still
  fires**; bar updates on next keystroke. Detect via stdin `version`.
- Status line hidden during permission/autocomplete → momentary only; alarm unaffected.
- Multiple sessions → per-`session_id` state + per-session alarm PID.
- Stale state after crash/quit → store absolute `end_epoch`; if `now ≫ end_epoch` → `idle`.
  Kill orphaned alarms on next `start` and on `SessionEnd` hook.
- Pause drift → on pause store `paused_remaining`; on resume `end_epoch = now + paused_remaining`
  and relaunch alarm.
- Per-second CPU → keep statusline.sh pure bash, no subprocess per tick.
- Headless/SSH (no sound) → notify helper tries `afplay` → `notify-send`/`paplay` → terminal
  bell → OSC title, in order.

## Open questions for charter/decide phase

- ~~How does `/pomo` invoke the CLI cleanly?~~ **RESOLVED → D-001/D-002.** `pomo` CLI is the
  source of truth; `/pomo` ships as a top-level command file (bare `/pomo`, since plugin
  components are forced into the `plugin:command` namespace) using `` !`pomo $ARGUMENTS` ``
  injection; `!pomo` is the zero-turn power path. Brand stays Claudoro via `displayName`.
  Spun off a new open item: **D-005 packaging** (marketplace plugin + setup hook vs. `git clone`
  + `install.sh`), since the bare command + on-PATH binary live outside the plugin sandbox.
- State dir location & cleanup policy (TTL for abandoned `.state` files).
- ~~Config mechanism for durations~~ **RESOLVED → D-003** (flags on `pomo start`).
- Windows story (WSL/Git Bash only for v1?).
