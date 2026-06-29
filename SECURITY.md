# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's
[**Report a vulnerability**](https://github.com/emson/claudoro/security/advisories/new)
flow, rather than opening a public issue.

We aim to acknowledge reports within 5 working days.

## Scope and threat model

Claudoro is a local-first CLI. It has **no network access**, **no runtime dependencies**, and
runs entirely with the privileges of the user who invokes it. Relevant properties:

- **Local only.** No data leaves the machine. History and state live under your XDG state dir.
- **No install-time scripts for consumers.** There is no `postinstall`; the only lifecycle script,
  `prepare`, configures the local git hooks path for contributors and does not run on a registry
  `npm install -g claudoro`. Wiring into Claude Code is an explicit, transparent `pomo setup` step,
  never a hidden install hook (see `specs/decisions.md` D-005).
- **Strict parsing.** State and history are parsed as plain JSON; no `eval`, no code loaded from
  data files.
- **Backups before destructive ops.** `undo` / `log clear` write a timestamped backup first.
- **Settings safety.** `pomo setup` backs up `settings.json` before merging and never clobbers
  an unparseable file.
- **Signed provenance.** Releases are published from CI with [npm provenance](https://docs.npmjs.com/generating-provenance-statements),
  a verifiable link from the published package back to this repo and the build that produced it.

Things that are **not** vulnerabilities: a malicious actor who already has write access to your
home directory or `settings.json` (they can do anything you can); sound/notification behaviour on
exotic terminals (degrades to silent by design).
