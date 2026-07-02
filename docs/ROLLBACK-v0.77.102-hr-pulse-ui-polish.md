# Rollback note: v0.77.102 - HR Pulse UI Polish

Production impact: yes.

This is a rollback plan only. Do not run it without separate explicit confirmation for the production environment.

## Release Being Rolled Back

- Release commit: `103ba260249f018f37dcff1bfebd4c46fea3baf4`
- Short commit: `103ba2602`
- Commit subject: `Polish HR pulse headers and navigation`
- Release version: `0.77.102`
- Release label: `HR Pulse UI Polish`
- Deploy branch: `codex/timeline-leads-hardening`

## Previous Production-Safe Candidate

- Candidate commit: `9aa09ba269d361dcfc9a3435d49c8a45b1f169c6`
- Short commit: `9aa09ba26`
- Commit subject: `fix: ignore legacy menu image fallbacks`

## What Needs Rollback

- HR Pulse UI changes on `/hr#today`, `/staff`, and `/hr#reports`.
- Static HTML/CSS/JS changes and generated release/cache tags from `0.77.102`.
- Changelog and visible release marker state tied to `0.77.102`.

## What Does Not Need Rollback

- No database rollback is required.
- No migrations were introduced for this release.
- No production data changes were introduced for this release.
- No environment variables, secrets, Railway settings, hosting config, or CI/CD config were changed.
- No auth, roles, payment, billing, external API, or webhook configuration rollback is required.

## Rollback Option A - Redeploy Previous Commit

Use this when Railway already has a known-good deployment for `9aa09ba269d361dcfc9a3435d49c8a45b1f169c6`.

1. In Railway production, redeploy or roll back to the deployment built from:

```text
9aa09ba269d361dcfc9a3435d49c8a45b1f169c6
```

2. Do not change Railway variables, secrets, build settings, or deployment branch.
3. After deploy finishes, run live verification:

```powershell
npm run smoke:live -- https://<live-crm-host>
npm run version:smoke -- https://<live-crm-host>
```

Expected live state:
- `/api/version` no longer reports `0.77.102`.
- Login release badge matches `/api/version`.
- `/hr#today`, `/staff`, and `/hr#reports` open without the broken `0.77.102` behavior.

## Rollback Option B - Revert The HR Pulse Release Commit

Use this when production should stay on the current deploy branch history and receive a normal rollback commit. This avoids force-pushing the deploy branch.

```powershell
git status --short --branch
git fetch origin
git checkout codex/timeline-leads-hardening
git pull --ff-only origin codex/timeline-leads-hardening
git revert --no-commit 103ba260249f018f37dcff1bfebd4c46fea3baf4
npm run version:sync
npm run check:version
npm test
git status --short
git commit -m "Rollback HR Pulse UI polish"
git push origin codex/timeline-leads-hardening
```

Notes:
- `--no-commit` is intentional so version sync and tests can run before the rollback commit is created.
- If later commits depend on `103ba260249f018f37dcff1bfebd4c46fea3baf4`, revert those dependent HR Pulse commits in the same rollback branch or resolve conflicts carefully.
- Do not change Railway config, env vars, secrets, DB schema, or migrations for this rollback.

## Required Checks Before Push

```powershell
npm run check:runtime
npm run check:version
npm run test:ui
npm test
```

Expected rollback state after checks:
- Version references are consistent with the rollback result.
- HR Pulse pages still route correctly.
- No DB migration or data rollback is required.
- No protected production config changes are present in the rollback diff.

## Live Verification After Deploy

Run after the rollback commit is pushed and Railway deploy finishes:

```powershell
npm run smoke:live -- https://<live-crm-host>
npm run version:smoke -- https://<live-crm-host>
```

Manual smoke:
- Open `/hr#today`.
- Open `/staff`.
- Open `/hr#reports`.
- Confirm there are no critical console/runtime errors.
