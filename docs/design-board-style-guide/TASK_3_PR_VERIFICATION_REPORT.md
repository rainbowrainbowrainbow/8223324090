# TASK 3 — Design Board final PR verification report

Generated: 2026-09-13 Europe/Kyiv
Target base: `codex/eventgenix-production`

## Base and previous work

The local worktree is on `codex/design-board-storage-isolation-unblock`.

`origin/codex/eventgenix-production` is at `f06cfe5391b715ea6cbae567d4ced824726ada67` and already includes PR #53 through merge commit `f90299c11`. This PR therefore contains only the follow-up Design Board storage/isolation work and docs, not a duplicate of the Style Guide/sidebar merge from PR #53.

Shared sidebar/search/permission files were inspected and left unchanged because the Style Guide integration from PR #53 is already present:

- `js/components/sidebar.js`
- `config/permissionRegistry.js`
- `js/search.js`
- `tests/ui-check.js`

## Implemented PR scope

- Add nullable Design Board ownership columns and scoped indexes.
- Scope Design Board materials, collections, tags, calendar, upload, detail, download, update, delete, and Telegram routes by server-resolved business context.
- Reject foreign collections during upload/update.
- Add a scoped material detail route.
- Close unauthenticated direct `/uploads/designs/*` reads.
- Keep preview/download/copy behind authenticated `/api/designs/:id/download`.
- Hydrate Design Board image thumbnails through authenticated blob fetches into local `blob:` URLs.
- Preserve Style Guide internal navigation and `/designer#styleguide` route continuity from PR #53.
- Add release runbook and task reports.

## Scenario verification

Covered by focused automated tests:

- Design Board list returns only active business-context materials.
- Tags and collections are scoped to the active business context.
- Material detail and download return `404` for another business context.
- Update/delete/Telegram routes return `404` for another business context and do not mutate.
- Upload/update reject a collection from another business context.
- Upload stamps the server-resolved `business_context`.
- Missing files keep an honest unavailable/error state.
- Direct `/uploads/designs/*` can be disabled and does not serve private blobs.
- Design Board card markup does not use `/uploads/designs/*`.
- Style Guide is reachable as an internal Design Board entry.
- `/designer` and `/designer#styleguide` still work.
- Light/dark Design Board and Style Guide CSS contracts still pass.

Manual/browser test-env verification was not performed because no `TEST_URL`, `TEST_DATABASE_URL`, or `TEST_DB_URL` was present in the environment. Current production was checked read-only through public health/version endpoints only.

## Verification commands and results

Passed:

```bash
npm run check:runtime
npm run check:migrations
node --test --experimental-test-isolation=none tests/designer-navigation.test.js tests/designs-page-ui.test.js tests/design-board-isolation.test.js tests/design-storage.test.js tests/design-material-storage-audit.test.js
npm run check:auth-boundary
npm run check:api-surface
npm run check:storage-surface
npm run check:static-surface
npm run check:css-surface
npm run test:ui
npm run check:syntax
npm test
```

Read-only production public smoke passed:

```bash
LIVE_SMOKE_PUBLIC_ONLY=true npm run smoke:live -- https://8223324090-production.up.railway.app
```

Result:

- `/api/version v0.81.147`
- `/api/health ok`
- `/api/ready schema ok`
- `/api/health/deep schema ok`

Notes:

- The local Codex sandbox blocked Node child-process spawning for `check:syntax`/`npm test` with `EPERM`; those commands were rerun outside the sandbox and passed.
- Disposable PostgreSQL migration rehearsal was not executed because no safe disposable DB URL was configured.

## READY/BLOCKED

- Design Board UI/Style Guide navigation inherited from PR #53: `READY`
- Server-side API isolation implementation: `READY_FOR_REVIEW`
- Direct Design Board file URL closure: `READY_FOR_REVIEW`
- Authenticated preview/download/copy path: `READY_FOR_REVIEW`
- Legacy saved material bytes: `BLOCKED_BY_DATA`
- Legacy ownership mapping/backfill: `BLOCKED_PENDING_OPERATOR_MAPPING`
- Disposable PostgreSQL migration rehearsal: `BLOCKED_BY_ENV`
- Production migration/backfill/import/deploy: `BLOCKED_BY_TASK_SCOPE`

## Release note

This PR is not a production release. A future release must follow `docs/design-board-style-guide/PRODUCTION_RELEASE_RUNBOOK.md` and requires explicit approval for merge, production migration, ownership backfill, file import, and deploy.

