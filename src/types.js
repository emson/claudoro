/**
 * Domain types — the single source of truth for Claudoro's data shapes,
 * mirroring the Data Model in specs/spec.md (D-007). These are JSDoc typedefs:
 * they cost nothing at runtime, are checked by `npm run typecheck` (tsc), and
 * give contributors and agents an accurate map of the entities.
 *
 * Import into other files with a JSDoc import type, e.g.
 *   {import('./types.js').LiveState}
 *
 * @module types
 */

/**
 * @typedef {'running'|'paused'|'idle'} RunState
 * @typedef {'focus'|'short_break'|'long_break'|null} Phase
 * @typedef {'auto'|'balanced'|'manual'} TransitionMode
 * @typedef {'minimal'|'classic'|'full'} ViewMode
 * @typedef {'warning'|'end'} Cue
 * @typedef {'completed'|'skipped'|'aborted'|'partial'} RecordStatus
 */

/**
 * Timer configuration captured at `start` (durations are flag-only, D-003).
 * @typedef {object} Config
 * @property {number} work         Focus minutes (default 25)
 * @property {number} short        Short break minutes (default 5)
 * @property {number} long         Long break minutes (default 15)
 * @property {number} frequency    Focuses before a long break (default 4)
 * @property {number} notify       Pre-end warning, minutes before end (default 1)
 * @property {boolean} mute        Start with sound disabled
 * @property {number} [back_window]  Seconds after a transition during which `back` is allowed (default 120)
 */

/**
 * Snapshot captured the instant BEFORE an auto/explicit phase transition fires,
 * stored on the post-transition state so `back` can restore it within the window.
 * @typedef {object} BackCheckpoint
 * @property {object} state               Full LiveState captured before the transition (its own back_checkpoint is null to prevent nesting)
 * @property {number} transition_epoch    Wall-clock epoch seconds when the transition fired (start of the back-window)
 * @property {string|null} record_id      id of the completed/skipped record appended by the transition, so `back` can remove it
 */

/**
 * The one running timer. The ONLY file the per-second renderer reads.
 * Everything derivable (remaining, progress, counts) is computed, not stored.
 * @typedef {object} LiveState
 * @property {number} schema
 * @property {RunState} run_state
 * @property {Phase} phase
 * @property {number|null} started            Epoch seconds the phase began
 * @property {number|null} end_epoch          Wall-clock deadline; remaining = end_epoch - now
 * @property {number|null} planned_min
 * @property {number|null} paused_at          Epoch when paused, else null
 * @property {number} paused_total_sec        Accumulated paused time this phase
 * @property {TransitionMode} mode
 * @property {string|null} label
 * @property {number} set_number
 * @property {number} set_index               Focus position toward the long break
 * @property {string|null} current_record_id
 * @property {string|null} owner_session
 * @property {Cue[]} alarms_fired             Cues already claimed this phase (atomic claim)
 * @property {number|null} alarm_pid          Detached one-shot PID (may be stale)
 * @property {BackCheckpoint|null} back_checkpoint  Pre-transition snapshot for `back`; null when none available
 * @property {Config} config
 */

/**
 * An immutable finished-phase record (one JSONL line). Provenance groups:
 * (A) timing/identity + (B) intent/reflection are reliable CLI/user data;
 * (C) `context` is agent-enriched, best-effort, opt-in.
 * @typedef {object} PhaseRecord
 * @property {string} id
 * @property {number} schema
 * @property {Phase} phase
 * @property {TransitionMode} mode
 * @property {number} planned_min
 * @property {number} started
 * @property {number} ended
 * @property {number} actual_min
 * @property {number} overtime_min
 * @property {RecordStatus} status
 * @property {{count:number,total_sec:number,intervals:Array<{start:number,end:number}>}} pauses
 * @property {Config} config_snapshot
 * @property {boolean} mute
 * @property {string|null} label
 * @property {number} set_number
 * @property {number} set_index
 * @property {Record<string, unknown>} context
 * @property {Record<string, string>} provenance
 * @property {string[]} pending
 */

/**
 * Persisted UX preferences (distinct from per-run Config).
 * @typedef {object} Prefs
 * @property {ViewMode} view
 * @property {TransitionMode} mode
 * @property {string} passthrough   Comma-separated: "model,context,git"
 * @property {'full'|'reduced'|'off'} motion
 * @property {boolean} mute
 */

/**
 * Result of a locked timer transition (see store.applyTransition).
 * @typedef {object} TransitionResult
 * @property {boolean} changed
 * @property {LiveState} state
 * @property {LiveState} prev
 * @property {PhaseRecord} [record]
 */

export {}; // module marker — types only, no runtime exports
