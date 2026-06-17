# 004: UX enhancement brainstorm & evaluation

The base status-line system (notes/003, locked in D-004) covers *what* is shown and *how* it is
disclosed. This note brainstorms the **cross-cutting refinements** that decide whether the product
reads as *authored* or merely *assembled*. These are not features of one view mode; each must hold
across `minimal` / `classic` / `full` and across every surface (status line, `/pomo status`, OS
notifications, daily log, README). Locked verdicts are in D-006.

## Evaluation lens

Every candidate is scored against four constraints, in priority order:

1. **Consistency.** Must work in all three view modes and on every surface. Mode-specific polish is
   disqualified by definition (it makes the product feel assembled).
2. **Calm.** The status line is peripheral. Anything that steals focus from the actual work is a
   net negative, however clever.
3. **Cost.** The renderer runs every second (`refreshInterval: 1`). Per-tick work must be trivial.
4. **Inclusive.** Must degrade for reduced-motion, colourblind, `NO_COLOR`, and no-emoji terminals.

## Candidates and verdicts

| # | Candidate | Value | Cost / risk | Verdict |
|---|---|---|---|---|
| 1 | No-reflow monospace stability (zero-pad time, fixed-width dots, ellipsis label, COLUMNS hysteresis) | High: kills the worst micro-irritation (horizontal jitter) | Low | **Adopt** |
| 2 | Calm bar (quantize sub-cell fill to advance ~every 15s, never per-tick) | High: the bar stays serene, seconds carry "live" | Low | **Adopt** |
| 3 | Unified visual language (same icons/colours/bar dialect on every surface) | High: cheapest coherence/delight | Low | **Adopt** |
| 4 | Pause recedes (dim whole segment ~50%, freeze bar, solid colon, ⏸) | High: instant "not running" read | Low | **Adopt** |
| 5 | Motion budget (`CLAUDORO_MOTION=full\|reduced\|off`) | High: inclusivity + one knob supersedes per-feature toggles | Low | **Adopt** |
| 6 | Overtime indicator (`+M:SS` amber, gently pulsing bar) | High: makes a waiting boundary visible | Low | **Adopt** (meaningful under D-006a waits) |
| 7 | Sound palette (soft tick warn / warm chime focus-end / gentle prompt break-end) | High: eyes-free phase awareness | Low, mute-aware | **Adopt** |
| 8 | OSC 8 clickable 🍅 → today's log (`file://`) | Med: ties status line to the log surface | Low, degrades to plain text | **Adopt** (promoted from deferred) |
| 9 | Warning-point marker (`╷`) on the bar at the notify point | Low: marginal info | Med: visual noise, fights calm | **Defer** |
| 10 | Terminal tab-title at phase transitions | Med: covers hidden/backgrounded moments | High: event-driven (stale when idle), can clobber the user's title | **Defer** (opt-in only if shipped) |
| 11 | First-run one-time hint (`🍅 try /pomo start`) | Low | Med: not mode-consistent (violates constraint 1) | **Defer** |
| 12 | Per-second bar animation | Negative | High: jittery, distracting | **Reject** |
| 13 | Always-on motion, no opt-out | Negative | High: excludes reduced-motion users | **Reject** |
| 14 | Mode-specific polish | Negative | n/a: violates the consistency constraint | **Reject** |
| 15 | Non-padded time (`9:59`) | Negative | High: causes horizontal reflow, the single worst micro-irritation | **Reject** |

## The adopted backbone (why each earns its place)

- **No-reflow stability (1)** is the foundation: the segment is "carved in stone" so the eye lands
  on the same pixel every glance. Hysteresis (distinct grow/shrink thresholds at COLUMNS
  breakpoints) stops layout flicker at the edges.
- **Calm bar (2)** and the **blinking colon** (the running heartbeat) split the work: the seconds
  signal "alive," the bar signals "how much longer" without ever twitching. Stillness is a feature.
- **Unified language (3)** is the highest delight-per-effort item: reuse one dialect everywhere and
  the product feels designed for free.
- **Pause recedes (4)** double-encodes the paused state (dim + frozen + solid colon + ⏸) so it
  reads instantly and never relies on a single cue.
- **Motion budget (5)** is the right abstraction over the various motion toggles: one env var, three
  levels, inclusive by default-respecting.
- **Overtime (6)** and **sound palette (7)** extend awareness past the glance: one visible, one
  eyes-free. Both are mute/motion-aware.
- **OSC 8 (8)** is a low-cost link from the live surface to the historical one; pure text fallback
  means zero downside.

## Robustness edge cases (baked into D-006)

- **Clock jumps (DST/NTP):** clamp displayed remaining so it never increases within a running
  block; treat large backward jumps as "render last-known."
- **Label width:** hard-truncate with `…` to preserve the no-reflow guarantee.
- **COLUMNS flicker:** hysteresis (candidate 1).

## Outcome

Candidates 1-8 became the D-006 adopted set (item 8, OSC 8, was promoted from deferred in a later
pass). Candidates 9-11 are documented as deferred/optional. Candidates 12-15 are the explicit
rejections that keep the surface calm and consistent.
