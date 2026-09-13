# Design Board isolation production release runbook

Generated: 2026-09-13 Europe/Kyiv

## Release state

This runbook is a concrete production plan for the Design Board storage/isolation PR. It is not a production execution record.

Current implementation status:

- Design Board UI polish and Style Guide navigation from PR #53 are already merged into `codex/eventgenix-production`.
- New uploads can store Design Board bytes in `design_file_blobs`.
- This PR adds server-side `business_context` ownership for Design Board metadata and collections.
- This PR closes unauthenticated direct `/uploads/designs/*` reads and keeps material bytes behind authenticated API download.
- Legacy metadata rows without a confirmed `business_context` remain hidden from scoped API results until an operator-approved mapping/backfill exists.

Production release is not authorized by TASK 3. Do not run production migrations, backfill, import, merge, or deploy from this task.

## Preconditions before a future production release

Required:

1. PR CI is green for the exact commit SHA to release.
2. Operator approves the PR merge into `codex/eventgenix-production`.
3. Operator provides or approves a legacy ownership mapping:

   ```text
   design_id -> business_context
   collection_id -> business_context
   optional created_by username -> user_id
   ```

4. Operator provides a source root or backup for old missing bytes if legacy files must be restored.
5. A disposable PostgreSQL environment is available for rehearsal.
6. Production DB connection is used only by the authorized release operator, not during this PR task.

Blocked until those are true:

- legacy material visibility after isolation;
- legacy file recovery;
- production migration/backfill/import;
- external reference-image use that requires a publicly readable Design Board asset URL.

## Verified local commands for this PR

These commands were run locally during TASK 2/TASK 3. They are safe validation commands, not production data mutations:

```bash
npm run check:runtime
npm run check:migrations
npm run check:auth-boundary
npm run check:api-surface
npm run check:storage-surface
npm run check:static-surface
npm run check:css-surface
npm run check:syntax
node --test --experimental-test-isolation=none tests/designs-page-ui.test.js tests/design-board-isolation.test.js tests/design-storage.test.js tests/design-material-storage-audit.test.js
node --test --experimental-test-isolation=none tests/route-smoke.test.js
npm run test:unit
```

`npm run check:syntax` and `npm run test:unit` may need to run outside the local Codex sandbox on Windows if the sandbox blocks Node child-process spawning with `EPERM`.

## Disposable PostgreSQL rehearsal

Do this before production. This repository did not have `TEST_DATABASE_URL` or `TEST_DB_URL` configured during TASK 2/TASK 3, so this step was not executed here.

Rehearsal checklist:

1. Create or select a disposable PostgreSQL database.
2. Set a process-local disposable DB URL only for the terminal running the rehearsal.
3. Apply normal migrations to the disposable DB.
4. Seed only synthetic Design Board rows for at least two business contexts and one legacy `NULL` owner row.
5. Verify:
   - company A cannot list/read/download/update/delete/send company B material;
   - company A cannot attach company B collection during upload/update;
   - `business_context IS NULL` legacy rows are hidden;
   - missing bytes return a clean unavailable/404 state;
   - direct `/uploads/designs/*` returns 404.

Do not reuse a production `DATABASE_URL` for rehearsal. The existing `scripts/backfill-legacy-upload-blobs.js` currently accepts `DATABASE_PUBLIC_URL`, `DATABASE_URL`, or `TEST_DATABASE_URL`; because of that, set only the disposable URL in a clean process when rehearsing imports.

## Production sequence for a future authorized release

This is the intended order. It is not authorized for TASK 3.

1. Merge the PR after CI is green.
2. Deploy the application code only after the release branch and SHA are confirmed.
3. Apply the schema migration.
4. Keep legacy rows with `business_context IS NULL` hidden until mapping is approved.
5. Run a read-only storage audit and export an opaque status report.
6. Review and approve the exact ownership mapping.
7. Backfill ownership in a transaction with an operator-approved script or migration.
8. If backup/source files exist, run a dry-run file recovery/import first, then an explicit apply only after counts and checksums match.
9. Run live read-only QA first, then safe test-account QA for new uploads and scoped reads.

## File recovery/import plan

Current known storage state from TASK 1:

- 3 metadata records scanned.
- 0 accessible bytes.
- 0 recoverable local files.
- all old records were `SOURCE_MISSING`.

If a backup/source root is provided, use the existing legacy upload blob backfill script only after reading its current CLI behavior and confirming the source root contains the expected `uploads/designs` tree.

Dry-run template, not executed in TASK 3:

```bash
node scripts/backfill-legacy-upload-blobs.js --segment designs --source-root <DISPOSABLE_OR_BACKUP_SOURCE_ROOT> --dry-run --json
```

Apply template, not ready until dry-run counts, checksums, and operator confirmation exist:

```bash
node scripts/backfill-legacy-upload-blobs.js --segment designs --source-root <DISPOSABLE_OR_BACKUP_SOURCE_ROOT> --apply --confirm BACKFILL_LEGACY_UPLOAD_BLOBS --expected-count <COUNT> --manifest-hash <HASH> --json
```

Do not run this with production credentials from a shell that also has a real `DATABASE_URL` unless the release operator explicitly confirms the target and expected manifest.

## Backfill plan for ownership

No ownership backfill command exists in this PR. Build one only after the operator approves the exact mapping.

Minimum accepted behavior for a future ownership backfill:

- dry-run by default;
- transaction for apply;
- exact expected row counts;
- no arbitrary defaulting of all rows to one business context;
- no `created_by` username trust unless it maps to exactly one approved user;
- output only ids/status/checksums, never file bytes or secrets.

## Live-site QA after future deploy

Use test accounts only.

Read-only first:

- login as a role that can open Design Board;
- confirm Design Board loads in light and dark mode;
- confirm Style Guide remains internal to Design Board and `/designer#styleguide` still opens;
- confirm existing legacy rows without ownership are either hidden or explicitly mapped.

Safe mutation QA after operator approval:

- upload one small test image in company A;
- verify company A preview/download/copy works;
- verify direct `/uploads/designs/<filename>` does not expose the file;
- verify company B cannot list/read/download/update/delete/send that material;
- delete only the safe test material.

## Rollback

Code rollback:

- Revert the PR commit if the scoped API breaks authorized same-company Design Board access.
- Keep direct `/uploads/designs/*` closed unless the product explicitly accepts unauthenticated Design Board file URLs again.

Database rollback after a future schema apply:

- The migration is additive and nullable.
- If no ownership backfill has happened, dropping the added columns and indexes is low risk.
- If ownership data was backfilled, export/confirm it before dropping columns.
- Do not roll back to cross-company-open API behavior as a long-term fix.

Data rollback:

- Do not delete legacy metadata or blobs as rollback.
- If an import writes incorrect blobs, remove only the exact imported blob rows by verified storage keys/checksums in an operator-approved transaction.

