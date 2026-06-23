# Rollback note: v0.77.11 - Banquet Sheet Official Design

Production impact: yes.

This note is a rollback plan only. Do not run the rollback without separate explicit confirmation for the production environment.

## Release being rolled back

- Release commit: `55c8ef9ca8c60643392f1d1a3da6f7da47cc24da`
- Short commit: `55c8ef9ca`
- Commit subject: `Redesign banquet sheet official layout`
- Release version: `0.77.11`
- Release label: `Banquet Sheet Official Design`
- Deploy branch: `codex/timeline-leads-hardening`

## Rollback target

- Previous commit before `55c8ef9ca`: `56f9bf91e94de5e09b1e2229826eb9208603b7c8`
- Previous short commit: `56f9bf91e`
- Previous commit subject: `Release banquet deposit verification`
- Previous version: `0.77.10`
- Previous release label: `Banquet Deposit Verification`

## Safe rollback flow

Run only after explicit confirmation that production must be rolled back.

```powershell
git status --short --branch
git fetch origin
git checkout codex/timeline-leads-hardening
git pull --ff-only origin codex/timeline-leads-hardening
git revert --no-commit 55c8ef9ca8c60643392f1d1a3da6f7da47cc24da
npm run version:sync
npm run check:version
npm test
git status --short
git commit -m "Rollback banquet sheet official design"
git push origin codex/timeline-leads-hardening
```

Notes:
- `--no-commit` is intentional so version sync and tests can run before the rollback commit is created.
- If later commits depend on `55c8ef9ca`, resolve conflicts carefully or revert the dependent banquet-sheet commits in the same rollback branch before testing.
- Do not edit Railway/Vercel/infra config for this rollback unless the deploy target was changed separately and explicitly confirmed.

## Required checks before push

```powershell
npm run check:runtime
npm run version:current
npm run version:sync
npm run check:version
npm test
```

Expected rollback state after checks:
- Version references are consistent with the rollback result.
- Banquet sheet routes still load.
- Deposit verification changes from `0.77.10` remain intact.
- No database migration or data rollback is required for this UI/design rollback.

## Live verification after deploy

Run after the rollback commit is pushed and the deploy finishes:

```powershell
npm run smoke:live -- https://<live-crm-host>
npm run version:smoke -- https://<live-crm-host>
```

Expected live state:
- `/api/version` reports the rollback version state.
- Login release badge matches `/api/version`.
- Banquet sheet opens without the broken `v0.77.11` design behavior.
