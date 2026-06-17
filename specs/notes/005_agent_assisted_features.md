# 005: Agent-assisted feature brainstorm

What separates Claudoro from any other Pomodoro timer (pymodoro included) is one structural fact:
**the timer and an agent that can read your work, your repo, and your own structured log all share
the same context.** A dumb timer knows only "25 minutes passed." Claudoro can know *what you did*
in those minutes, *whether you were in flow*, *what to do next*, and can answer questions about all
of it later from ground-truth data.

Every feature here is evaluated against that lens. The data model that makes them possible is the
expanded record shape in **D-007** (groups A timing, B intent, C agent-enriched context, with
`provenance`/`pending` markers). These features mostly *populate* existing fields, not new schema.

**Status:** brainstorm + curation only. Nothing here is committed to v1 scope yet; each Signature
feature would graduate into its own decision when scoped. This note preserves the thinking.

---

## Tier 1: Signature (the "oh, this is different" features)

Each of these is only possible because an agent shares the timer's context.

1. **Auto-worklog: the log writes itself.**
   At focus-end the agent summarises what actually happened (git diff stat, commits, files, key
   conversation outcomes) into `context.summary`. Time-tracking and journaling become a byproduct,
   not a chore.
   - *Populates:* `context.summary`, `context.commits_made`, `context.files_touched`, `diff_stat`.
   - *Edge:* agent is event-driven, not a daemon → capture on next interaction or on demand; mark
     `summary` in `pending` until filled.

2. **Context capture & resume: kill the cost of taking a break.**
   The top reason developers skip breaks is fear of losing their mental stack. At a break/stop the
   agent snapshots `context.next_step` ("about to fix the null check in `auth.ts:42`, failing test
   is X"); on resume it restores it. Directly attacks what makes breaks feel expensive, which is
   what makes the technique actually stick.
   - *Populates:* `context.next_step`.

3. **Flow- and stuck-aware boundaries.**
   At a transition the agent reads cognitive state: tests just went green and momentum is high →
   offer `extend` instead of breaking; stuck on the same error for 20 min → suggest a break early.
   A dumb timer cannot do this.
   - *Interacts with:* D-006a modes (`extend`, `back`, `next`).

4. **Conversational reports from real data.**
   "What did I ship this week?" / "Time on auth vs meetings?" / "Generate my standup." Answered by
   folding the JSONL history (D-007), not from vibes. Standups, weekly reviews, time-per-project,
   completion rates.
   - *Reads:* the whole record set; especially `label`, `tags`, `actual_min`, `status`, `summary`.

---

## Tier 2: Strong (clearly valuable, agent-leveraged)

5. **Productive breaks.** During a break the agent does the chores you'd otherwise context-switch
   into (run the suite, lint, rebase, draft the commit message) so results wait for your return.
   The break stays a real break for *you*.
6. **Plan-to-pomodoros.** "I need to build X" → agent decomposes into N estimated, labelled blocks
   and queues them; the timer walks the plan and re-plans on overrun.
7. **Estimation calibration.** Track estimated vs actual per task type; agent learns your bias
   ("refactors run ~1.8x your estimate") and improves future plans. Pure structured-data payoff.
8. **Intention vs completion tracking.** The `intention` / `intention_met` pair, surfaced over
   time, shows how realistic your blocks are and trains better scoping. Agent asks the two
   questions at the right moments so it isn't friction.
9. **Auto-label from context** (direct extension of the manual `--label`): infer the label from
   branch, recent commits, and the conversation, and propose it instead of making you type it.

---

## Tier 3: Later / optional

10. **Pattern coaching & retros.** Weekly: best focus times of day, draining task types, where
    completion drops ("after 3pm your rate falls, put admin there").
11. **Anti-burnout guardrails.** Detect too many consecutive blocks without a long break; nudge
    toward stopping for the day.
12. **Goal / quota & streaks.** Daily deep-work targets with progress nudges.
13. **Issue / PR linking** as a first-class field (auto-link commits made during a block to the
    tracker via `context.linked_issue`).

---

## Cross-cutting concerns

- **Local-first & privacy.** Group C content capture (diffs, summaries, conversation outcomes) is
  **opt-in**, stays in the local JSON (no network, per D-005), supports redaction, and can be
  enabled per project. Diffs and notes are sensitive; never silently hoover them up.
- **Capture-timing honesty.** The agent acts only when invoked, so enrichment is "on next
  interaction or on demand," never real-time. `pending` / `provenance` make this visible rather
  than pretending the log is live. A Stop/SessionStart hook may opportunistically trigger
  enrichment, but it is never presented as guaranteed.
- **Hot path stays clean.** All enrichment lands in the history record, never in `state.json`, so
  the per-second status-line read (D-007) is untouched.
- **Deterministic core never depends on the agent.** Groups A/B work with zero model involvement
  (D-001); the agent only *enriches*. Claudoro is a fully functional timer with the agent absent.
