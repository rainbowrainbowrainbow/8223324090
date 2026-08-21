# Production branch marker migration note — 2026-08-21

## Current verified production

- Live version: `0.81.12`
- Live SHA: `a990b668f60e6376439e80cef0a3ade7672dfe37`
- Current marker/source branch in `/api/version`: `codex/checkbox-hardening-release-v080103`
- Deployment metadata: manifest complete, no invalid sources or warnings
- Latest Railway deployment: `6442dafb-f763-4f4a-a95c-3f6428c685f2`, `SUCCESS`

## Branch state after migration

- Old marker branch: `codex/checkbox-hardening-release-v080103`
- Old marker SHA: `a990b668f60e6376439e80cef0a3ade7672dfe37`
- New stable marker branch: `codex/eventgenix-production`
- New marker SHA after migration: `a990b668f60e6376439e80cef0a3ade7672dfe37`
- Previous stale new marker SHA before migration: `a92dd00de0f7d6b3e581ffe933e057b0b9cfe9fc`

There is no code diff between the old production marker and the new marker after migration. The operation was a branch fast-forward/update only:

```text
a92dd00de..a990b668f  a990b668f60e6376439e80cef0a3ade7672dfe37 -> codex/eventgenix-production
```

## Operator confirmation used

The marker update was performed only after this confirmation:

```text
Підтверджую перемикання production release marker/source process на codex/eventgenix-production від exact live SHA a990b668f60e6376439e80cef0a3ade7672dfe37, без code diff і без видалення старої branch.
```

## Canonical helper command after marker migration

Use the canonical helper only; do not run raw `railway up`.

```powershell
npm run release:railway-up:branch -- codex/eventgenix-production
```

If the helper requires explicit arguments, use the release helper's documented production target and verify:

- project: `fortunate-appreciation`;
- service: `8223324090`;
- environment: `production`;
- live URL: `https://8223324090-production.up.railway.app`.

## Rollback reference

Keep `codex/checkbox-hardening-release-v080103` as rollback/reference branch. Do not delete it during this migration.

## Post-migration verification

Immediate verification after marker migration:

- `origin/codex/eventgenix-production`: `a990b668f60e6376439e80cef0a3ade7672dfe37`
- `origin/codex/checkbox-hardening-release-v080103`: `a990b668f60e6376439e80cef0a3ade7672dfe37`
- Diff between old and new marker: none
- Live `/api/version`: still `v0.81.12`, SHA `a990b668f60e6376439e80cef0a3ade7672dfe37`, manifest complete
- Live `/api/health/deep`: `ok`

On the next canonical deploy, verify:

- `/api/version` version, SHA, branch and deployment manifest;
- `/api/health`;
- `/api/health/deep`;
- My Day;
- Tasks;
- Dashboard;
- AI status;
- global timer.
