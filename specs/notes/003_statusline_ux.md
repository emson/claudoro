# 003: Status-line UX design

The status line is Claudoro's primary surface. It is **peripheral, glanceable, and shares one
slot** with the user's normal Claude Code info. Every decision flows from that. Locked choices
in D-004.

## Design principles

1. **Pre-attentive first, reading second.** State should be readable from color + shape before
   a single character is read. Color = phase; bar length = how-much-longer; numbers are the
   third layer.
2. **Stillness is a feature.** We re-render every second (`refreshInterval: 1`) but mostly
   shouldn't animate, peripheral motion kills focus. Only the count ticks and the bar creeps.
3. **No vertical layout shift.** Default to one line; the pomodoro is a prefix segment that
   appears/disappears horizontally, never changing the status line's height.
4. **Never rely on color alone.** Double-encode with icon + color + shape (colorblind + NO_COLOR).
5. **Respect the terminal.** Honor `NO_COLOR`; adapt to `COLUMNS`; baseline 16-color (inherits
   theme); enhance with 256/truecolor; ASCII fallback for no-emoji.
6. **Minimal by default, depth on demand.** Status line shows almost nothing; `/pomo status`
   shows everything.

## Information hierarchy (what earns a pixel)

| Priority | Info | Encoding | Drops at narrow width |
|---|---|---|---|
| 1 | Phase | icon + color | never |
| 2 | Time remaining | `MM:SS` | never |
| 3 | Progress in block | filled bar | 1st to drop |
| 4 | Position in 4-set | cycle dots `●●○○` | 2nd to drop |
| 5 | Task label | dim text | 3rd to drop |
| 6 | Paused / muted | `⏸` / dim `🔇` | inline when relevant |

Secondary data (cost, elapsed, today's count, next long break) is **detail-mode only**.

> Note: `Opus 24% ⎇ main` in the mockups is NOT pomodoro data, it's the **passthrough** of the
> normal CC status line: model display name, `context_window.used_percentage`, git branch. We
> render it ourselves ("replace mode") and prepend the pomodoro segment. Configurable via
> `CLAUDORO_PASSTHROUGH`. Wrapping a user's *existing* custom status line = v2.

## Pixel system

- **Icons:** 🍅 focus · ☕ short break · 🌴 long break · ⏸ paused · (idle → hidden).
  ASCII mode: `[focus] [break] [long] [paused]`.
- **Progress bar: smooth sub-cell fill:** eighth-blocks `█▉▊▋▌▍▎▏` for the leading edge so it
  advances at sub-character resolution each second; dim `░` track; `▕ … ▏` half-block frame.
  Fill = **elapsed** (fills toward the break); time = **remaining** (counts down). e.g.
  `▕██████▊░░░░░▏`.
- **Cycle dots:** `●●○○` = focus blocks done / blocks-before-long-break. Two granularities at
  once (bar = this block, dots = the set). Filled dots in phase color, hollow dim.
- **Colors** (16 baseline → 256 enhancement):

  | Phase | ANSI16 | 256 |
  |---|---|---|
  | Focus | `31`/`91` | tomato `38;5;203` |
  | Short break | `32` | `38;5;114` |
  | Long break | `34` | sky `38;5;75` |
  | Paused | `33` | amber `38;5;215` |
  | Track / secondary | dim `2` | gray `38;5;238` |

  Phase color tints icon + bar fill + filled dots; everything else dim/neutral.

## View modes (D-004)

Switchable via `pomo view <mode>` (persisted in config). Default = `classic`.

**`minimal`** (Pip): icon + time + bar only.
```
🍅 12:34 ▕██████▊░░░░░▏  ·  Opus 24% ⎇ main
```

**`classic`** (DEFAULT): + cycle dots.
```
🍅 12:34 ▕██████▊░░░░░▏ ●●○○  ·  Opus 24% ⎇ main
```

**`full`** (two lines): + phase word, task label, fuller bar, cost.
```
🍅 focus  12:34  ▕████████▊░░░░░░░▏  ●●○○   🏷 write tests
 Opus  ·  24% ctx  ·  ⎇ main ✓  ·  $0.42
```

**`/pomo status`** (on-demand, printed into the conversation, NOT a status-line mode):
```
🍅 Claudoro, focus · pomodoro 2 of 4
   ▕████████▊░░░░░░░░░░░░▏  11:58 left of 25:00  (52%)
   label:  write tests        sound: on
   today:  ●●●●● ●●○  7 done · 2h55m focus     next long break: in 2 blocks
```

## Responsive behavior (driven by `COLUMNS`)

Drop order: bar → cycle dots → label. Always keep icon + time.
```
≥100:  🍅 12:34 ▕██████▊░░░░░▏ ●●○○  write tests   ·   Opus 24% ⎇ main ✓
≥70:   🍅 12:34 ▕██████▊░░░▏ ●●○○   ·   Opus 24% ⎇ main
≥40:   🍅 12:34 ▕████▊░░▏   ·   Opus 24%
<40:   🍅 12:34   ·   24%
idle:  Opus 24% ⎇ main ✓        (pomodoro segment absent; no height change)
```

## Delight, on a leash

- **Blinking colon = running heartbeat:** `12:34` ↔ `12 34` per second *while running*; solid
  when paused. Encodes running/paused with motion that reads "alive," not "distracting." Free
  (we render every second anyway).
- **Transition flourish (~4s):** at phase change the bar briefly becomes a message:
  `🍅✨ nice, break time` / `☕→🍅 back to it`, then settles into the new phase.
- **Final-minute emphasis:** under 60s the time goes bold/bright. No shake, no flash.
- **Earned long break:** dots fill `●●●●` → icon becomes 🌴.
- All motion should be opt-out-able if users find it distracting (see D-004 revisit).

## Robustness checklist

- `NO_COLOR` honored → icon + shape + text only.
- `CLAUDORO_ASCII=1` (or auto when emoji unavailable) → `[focus] 12:34 [######--] 2/4`.
- Emoji are width-2 and break naive `${#str}` math → budget fixed column widths + safety margin,
  don't measure emoji.
- Pure-bash render, no subshell/`jq` per tick (read state via `read`/`source`); target <1ms.
- Single-line default = zero vertical layout shift; horizontal shift only ~every 25 min.
- Truecolor only if `COLORTERM=truecolor`; else 256; else 16.

## Open / deferred

- Wrap-an-existing-custom-status-line (vs. replace mode) → v2.
- Per-element passthrough config syntax → spec later.
- Alternative bar concepts considered but deferred: draining bar (full→empty), time-text-as-bar
  (highlight elapsed portion of `12:34`), braille micro-bar. Eighth-block fill chosen for clarity
  + width-robustness.
