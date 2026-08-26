# PostgreSQL audit role privilege evidence

Last refreshed: 2026-08-26

## Scope

Task 29 reviewed the dedicated production audit role used for aggregate-only rollout and
legacy-data evidence collection.

The goal was to close the residual `TEMPORARY` privilege inherited through the database-level
`PUBLIC` grant without changing application passwords, connection URLs, Railway variables,
table data, or schema.

## Live baseline

- Live version: `0.81.27`
- Live source branch: `codex/eventgenix-production`
- Live runtime commit from `/api/version`: `88138e98fa31411923e6ec387af7aa155d25b711`
- Local/origin source branch at audit time: `e30cd37fdf3a176e2cc757158e39add9c2b258fa`

The live runtime commit can legitimately differ from the source branch when the latest branch
changes are documentation/tooling-only and were not deployed.

## TEMP dependency classification

Static repository scan found historical migrations that use temporary tables:

- `db/migrations/201_kitchen_cakes_catalog.sql`
- `db/migrations/220_kitchen_menu_2026_catalog.sql`
- `db/migrations/224_products_zagadky_shi_duplicate_cleanup.sql`
- `db/migrations/283_kitchen_cake_decorations_catalog.sql`
- `db/migrations/285_banquet_guest_arrival_backfill.sql`

Verdict: the application/operator DB role needs `TEMPORARY` for migration/operator compatibility.
The dedicated read-only audit role does not need `TEMPORARY`.

## Redacted privilege matrix

Before the grant change:

- audit role had `CONNECT=true`, schema `USAGE=true`, table `SELECT=384`;
- audit role had `INSERT=0`, `UPDATE=0`, `DELETE=0`, `TRUNCATE=0`, sequence `UPDATE=0`;
- audit role had `TEMPORARY=true`;
- source of `TEMPORARY`: `PUBLIC_DATABASE_TEMPORARY`;
- direct audit-role `TEMPORARY` grant: `false`.

Database grant change applied:

- `REVOKE TEMPORARY ON DATABASE ... FROM PUBLIC`;
- `GRANT TEMPORARY ON DATABASE ... TO <application/operator role>`;
- rollback SQL was written locally before commit.

After the grant change:

- audit role has `CONNECT=true`, schema `USAGE=true`, table `SELECT=384`;
- audit role has `INSERT=0`, `UPDATE=0`, `DELETE=0`, `TRUNCATE=0`, sequence `UPDATE=0`;
- audit role has `TEMPORARY=false`;
- source of `TEMPORARY`: `NONE`;
- `CREATE TEMP TABLE` under audit role is denied with SQLSTATE class `42`;
- persistent public DDL under audit role is denied with SQLSTATE class `42`;
- application/operator role keeps direct `TEMPORARY=true`;
- live `/api/health` and `/api/health/deep` are `ok`.

## Evidence artifacts

Redacted evidence and exact rollback SQL are stored locally under:

`.codex-temp/_preserved-artifacts/task29-postgres-temp-privileges/`

Do not commit rollback SQL artifacts because they contain exact local database identifiers.
They do not contain passwords or connection URLs.

## Operational rule

The audit role must remain read-only:

- `default_transaction_read_only=on`;
- no persistent table write grants;
- no schema `CREATE`;
- no database `CREATE`;
- no database `TEMPORARY`.

If future tooling requires temp objects, use the application/operator DB role or create a separate
least-privilege operator role. Do not re-grant `TEMPORARY` to `PUBLIC`.
