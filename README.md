<div align="center">

# 🍅 Claudoro

**A Pomodoro timer that lives inside the Claude Code terminal.**

A live, ticking countdown in the status line (right where your eyes already are), plus a
reliable alarm that fires even when the status line is hidden or every session is closed.

[![CI](https://github.com/emson/claudoro/actions/workflows/ci.yml/badge.svg)](https://github.com/emson/claudoro/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/claudoro.svg)](https://www.npmjs.com/package/claudoro)
[![node](https://img.shields.io/node/v/claudoro.svg)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```text
🍅 22:47 ▕████████░░▏ ●●○○   Opus · 34% · main
```

</div>

> [!NOTE]
> _Demo placeholder._ Add an asciinema cast or GIF here: a terminal timer sells itself in
> motion. Record with `asciinema rec`, or capture a short GIF of the countdown ticking and the
> alarm firing, and drop it in `docs/`.

No separate app. No alt-tab. No broken focus. The countdown is in the one place you're already
looking, and it keeps ticking while you and Claude work.

## Why

Long Claude Code sessions blur time. Every existing Pomodoro tool (menu-bar app, browser tab,
phone) sits _outside_ the terminal and competes for the attention you're trying to protect.
Claudoro renders in the status line, the unused always-visible surface you already watch, so the
timer costs you no extra glance and no context switch.

## Install

**Prerequisite:** Node ≥ 22 (already present if you installed Claude Code via npm).

```bash
npm install -g claudoro
pomo setup
```

`pomo setup` wires Claudoro into Claude Code: it writes the `/pomo` command file, merges the
`statusLine` block into your `settings.json` (backing it up first), and records everything it
touched in a manifest so uninstall is clean. It is idempotent, safe to re-run.

Open a new Claude Code session and run `/pomo start`. The countdown appears in your status line
within about a second. **That's the under-2-minute path.**

## Usage

```text
/pomo start [mins] [-w 25 -s 5 -l 15 -f 4] [-t "my task"]
/pomo pause | resume | stop
/pomo skip          finish this phase early, advance to the next
/pomo reset         restart this phase without moving the cycle count
/pomo next          advance a waiting boundary (manual/balanced mode)
/pomo back          undo the last phase transition (short window)
/pomo extend [N]    add N minutes to the current phase

/pomo status        rich detail: elapsed, label, today's count, next long break
/pomo mode [auto|balanced|manual]
/pomo view [minimal|classic|full]
/pomo mute | unmute

/pomo log           today's completed blocks
/pomo stats         analytics: streak, focus heatmap, top tags (--web for the dashboard)
/pomo undo [N]      remove the last N records (backup written first)
/pomo restore       restore from a backup

/pomo help [command]
```

Prefer zero model round-trips? Run the CLI directly from the prompt with `!`:

```bash
!pomo start 50 "architecture spike"
!pomo status --json
```

## Status line

Three view modes, switchable any time with `/pomo view <mode>`:

| Mode                  | Output                                  |
| --------------------- | --------------------------------------- |
| `minimal`             | `🍅 22:47 ▕████████░░▏`                 |
| `classic` _(default)_ | `🍅 22:47 ▕████████░░▏ ●●○○`            |
| `full`                | `🍅 22:47 ▕████████░░▏ ●●○○ write tests` (adds the label) |

The segment is **absent when idle**, so starting and stopping never shifts your layout. Your
existing status-line info (model · context% · git) is preserved alongside it, never clobbered.

## Durations and cadence

All four durations are overridable per run. Flags, not a config file:

| Flag | Default | Controls |
| ---- | ------- | -------- |
| `-w, --work N` | 25 min | Focus block length |
| `-s, --short N` | 5 min | Short break length |
| `-l, --long N` | 15 min | Long break length |
| `-f, --frequency N` | 4 | Focus blocks before a long break |

```bash
pomo start                         # defaults: 25/5/15, long break every 4
pomo start 50                      # 50min focus, short/long/frequency unchanged
pomo start -s 10 -l 30             # change break lengths only, keep 25min focus
pomo start 50 -s 10 -l 30 -f 3    # full custom: 50/10/30, long break after every 3
```

Durations are fixed for the life of a session. To change them, `pomo stop` and start again with new flags.

## Transition modes

How much Claudoro advances on its own at a phase boundary (D-006a):

| Mode                | Focus → break | Break → focus | Best for                    |
| ------------------- | ------------- | ------------- | --------------------------- |
| `auto` _(default)_  | auto          | auto          | hands-free classic cadence  |
| `balanced`          | auto          | wait          | never waste focus while away |
| `manual`            | wait          | wait          | deep-flow work              |

```bash
pomo mode balanced
```

At a waiting boundary the status line shows `+M:SS` overtime and the next step; `/pomo next`
advances it, `/pomo back` undoes the last transition within a short window.

## History, undo, and privacy

Every completed focus block is appended as an immutable record to a daily JSONL log. Aggregates
(today's count, cycle position) are **derived** from those records, never stored as counters, so
`undo` can never desync the data.

```bash
pomo log                  # today
pomo log --date 2026-06-10
pomo undo 2               # dry-run + confirm, then removes the last 2 (backup first)
pomo restore <backup-id>  # reverse it
```

Everything is **local-first**: no network, no accounts, no telemetry. State lives under your XDG
state dir and never leaves the machine. See [SECURITY.md](SECURITY.md).

## Stats and dashboard

`pomo stats` answers "how am I doing over time?" without leaving the terminal: current streak,
a focus heatmap, top tags, your focus-by-hour, and the outcome mix, all derived from the log on
read (no stored counters).

```text
🍅 Claudoro focus stats

  128 pomodoros  53h 20m focus  31 active days
  Streak  6 days  (best 11)

  Focus · last 12 weeks
  Mon ▒▓░·▓██▒▓░▒▓
  ...

  Top tags   #project-x ████████ 8h   #review ███ 3h
```

Want the visual version? `pomo stats --web` writes a **self-contained HTML dashboard** (one file,
no dependencies, no network, renders offline) and opens it in your browser. Times are shown in your
**local** timezone while the log itself stays UTC, so the data is portable and the view is friendly.

```bash
pomo stats          # the terminal panel
pomo stats --web    # the visual dashboard in your browser
pomo stats --json   # stable JSON for an agent or a script
```

The dashboard lives at `~/.local/state/claudoro/dashboard.html`. It contains your session labels,
so treat it as private (it is never uploaded anywhere). Delete it any time; the next run rebuilds it.

## Multiple sessions

One global timer, shown in every open Claude Code session; control works from any of them, and
**exactly one alarm fires** no matter how many sessions are watching. Suppress the segment in a
specific pane with:

```bash
export CLAUDORO_HIDE=1
```

## Environment variables

| Variable               | Default              | Effect                                       |
| ---------------------- | -------------------- | -------------------------------------------- |
| `CLAUDORO_HIDE`        | unset                | Suppress the segment in this shell           |
| `CLAUDORO_MOTION`      | `full`               | `full` \| `reduced` \| `off` (blink, flourish) |
| `CLAUDORO_COLOR`       | `auto`               | `auto` \| `always` \| `never`                |
| `CLAUDORO_PASSTHROUGH` | `model,context,git`  | Which fields to show alongside               |
| `NO_COLOR`             | unset                | Standard no-color flag (honoured)            |
| `XDG_STATE_HOME`       | `~/.local/state`     | Override state directory                     |
| `XDG_CONFIG_HOME`      | `~/.config`          | Override config directory                    |

## Troubleshooting

<details>
<summary><strong>The countdown shows but doesn't tick while I'm idle</strong></summary>

Idle ticking needs `refreshInterval` inside the `statusLine` block of `settings.json`, which
`pomo setup` adds. Older Claude Code versions don't support it — the timer still updates on every
interaction, just not second-by-second while idle. Update Claude Code to get live ticking.

</details>

<details>
<summary><strong>No sound when a block ends</strong></summary>

Sound degrades gracefully: platform player → terminal bell → silent. On Linux install
`libnotify`/`notify-send` and a player (`paplay`/`aplay`/`ffplay`). Over SSH or with no audio
device you'll get the OS notification or bell only. Check you're not muted: `pomo unmute`.

</details>

<details>
<summary><strong>My existing status line disappeared</strong></summary>

It shouldn't — Claudoro composes with it. If something looks off, `pomo uninstall` restores your
previous `statusLine` from the timestamped backup `pomo setup` made next to `settings.json`.

</details>

<details>
<summary><strong>It auto-ran pomodoros while I was away</strong></summary>

That's `auto` mode (the default). Switch with `pomo mode balanced` (waits before starting focus),
or unwind the unattended blocks with `pomo undo N` (a backup is written first).

</details>

<details>
<summary><strong>I forgot to stop the timer and a block recorded a huge time</strong></summary>

Claudoro guards against this: when you finally `pomo stop` (or `pomo next`) a block that ran long
unattended, it credits focus only up to `planned + max_overtime` (30 min by default) and flags the
record `abandoned`. The true span is kept, and `pomo log` shows it as `25m focus (ran 11h 32m,
abandoned)`. Your stats are never inflated, even for records logged before this guard existed.

If the long run really was deliberate work, `pomo stop --full` records the full elapsed time. Raise
the threshold for a session with `pomo start --max-overtime N`.

</details>

## Uninstall

```bash
pomo uninstall          # remove the /pomo command file, restore your prior statusLine
npm uninstall -g claudoro
```

No orphaned background processes are left behind.

## How it works

A single Node package. The `pomo` CLI is the **single source of truth**; the status line, the
`/pomo` command, and the alarm are thin surfaces over it. The CLI runs with zero model
involvement, so the core feature never costs API tokens.

```text
Claude Code ──~1s, JSON on stdin──▶ pomo statusline ──read──▶ state.json
     │ /pomo → !`pomo $ARGUMENTS`                                ▲ atomic write (lock)
     ▼                                                           │
 user input ───────────────────────────────▶ pomo <verb> ───────┘
                                                  │ spawn detached
                                                  ▼
                                           alarm one-shot ──▶ sound / notification
```

- **State:** `~/.local/state/claudoro/state.json` (the one running timer)
- **History:** `~/.local/state/claudoro/logs/YYYY-MM-DD.jsonl` (immutable records, UTC)
- **Dashboard:** `~/.local/state/claudoro/dashboard.html` (rebuilt by `pomo stats --web`)

Full design: [`specs/spec.md`](specs/spec.md) (modules, data model, acceptance tests) and
[`specs/decisions.md`](specs/decisions.md) (the D-001…D-009 rationale).

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and [CLAUDE.md](CLAUDE.md) for the
architecture and coding principles. Run `npm run check` (lint, format, typecheck, tests) before
opening a PR.

## Acknowledgements

The flag interface and classic cadence follow [pymodoro](https://github.com/rogeralmeida/pymodoro),
so anyone migrating gets zero relearning.

## License

[MIT](LICENSE) © Ben Emson
