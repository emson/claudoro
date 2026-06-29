# Releasing Claudoro

The canonical release runbook. Releases are cut by pushing a version tag; CI does the rest.

## Versioning

[Semantic Versioning](https://semver.org). While the project is `0.x`, the API is not yet stable:
breaking changes bump the minor (`0.1` to `0.2`), everything else bumps the patch.

## How publishing works

Publishing is automated, not manual. The [`release.yml`](.github/workflows/release.yml) workflow
triggers on any `v*` tag push and, after `npm run check` passes on CI, runs
`npm publish --provenance --access public` and creates the GitHub release. Two consequences:

- **Maintainers never run `npm publish` by hand.** A pushed tag is the release action.
- Packages are published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements):
  a signed, verifiable link from the published tarball back to this repo and the CI run that built
  it. Provenance requires CI OIDC, so a local publish could never produce it anyway.

Auth is the `NPM_TOKEN` repository secret: a granular/automation npm token scoped to this package
with publish rights. Automation tokens bypass 2FA, which is why CI can publish unattended. (A 2FA
**passkey** cannot generate the CLI one-time codes a manual publish would need; an automation token
is the only workable path. The npm account's email must also be verified or publish returns a
confusing 404.)

## Cutting a release

1. **Land everything on `main`** and confirm CI is green across all OS/Node combinations.
2. **Update the changelog.** In [`CHANGELOG.md`](CHANGELOG.md): rename the `[Unreleased]` heading to
   `[X.Y.Z] - YYYY-MM-DD`, add a fresh empty `[Unreleased]` above it, and update the compare links
   at the bottom.
3. **Bump the version:** `npm version X.Y.Z --no-git-tag-version` (edits `package.json` only).
4. **Commit:** `git commit -am "chore(release): vX.Y.Z"` and push `main`. The pre-push hook runs
   `npm run check`; let CI confirm green before tagging.
5. **Tag and push the tag:**
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
   This fires `release.yml`, which publishes to npm with provenance and opens the GitHub release.
6. **Verify:** `npm view claudoro version` shows `X.Y.Z`, the GitHub release exists, and the README
   npm badge is green.

## If CI publishing is unavailable

Only as a fallback (a broken runner, an expired token), and never the default, a maintainer with
local publish rights can run `npm publish --access public`. The result will lack provenance; prefer
fixing CI and re-tagging. A version cannot be republished, so a bad publish needs a new patch
version, not a re-push of the same tag.

## After publishing

You cannot unpublish a version after 72 hours. To discourage a broken release, use
`npm deprecate claudoro@X.Y.Z "reason"` and ship a fixed patch.
