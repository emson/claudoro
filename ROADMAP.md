# Roadmap

The authoritative, always-current roadmap lives in GitHub:

- **[Milestones](https://github.com/emson/claudoro/milestones)** group issues into planned releases.
- **[Issues](https://github.com/emson/claudoro/issues)** are the unit of work. Anything labelled
  `enhancement` is a candidate; `good first issue` marks approachable entry points.

This file captures only the durable direction, not a dated plan. The themes below are intent, not
commitments; open or comment on an issue to push something up the list.

## Near term

- Stabilise the `0.1.x` line: rough edges, cross-platform polish, docs.
- Broaden the stats and guide surfaces without adding runtime dependencies (the zero-dep rule holds).

## Out of scope (by design)

These are deliberate non-goals, rooted in [`specs/decisions.md`](specs/decisions.md):

- Network features, accounts, telemetry, or cloud sync. Claudoro is local-first.
- Runtime dependencies. The core stays Node stdlib only.
- A background daemon. Scheduling is wall-clock and daemonless (D-006a).

Proposing something that contradicts a decision? Open a discussion issue first, then a new entry in
the decisions log. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
