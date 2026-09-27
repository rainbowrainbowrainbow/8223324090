# SYS-MB-CLOSE-03 — exact read-only telemetry access request

Status: `APPROVED_AND_APPLIED_2026-09-22`

The owner approved this exact block. The 15-column SELECT grant was applied and verified through the dedicated read-only collector. See [TELEMETRY_READ_GRANT_REPORT.md](TELEMETRY_READ_GRANT_REPORT.md). The copyable authorization below is retained as the reviewed scope, not a request to repeat GRANT.

The completed asset block did not authorize privilege changes on telemetry tables. The existing read-only production role returns PostgreSQL `42501` for both durable collector tables. Observation cannot receive an evidenced `startUtc` until this is fixed and required live QA is complete.

## Target and scope

- Railway PostgreSQL target hash: `6fb86cf6959f026d7c55b6c65edffc3499e5bb581d51840a730f915fef0e9cfd`.
- Dedicated read-only role SHA-256: `940efc5d4989b4cdd1d23b40678c2fec953499bd4b3d6ecb2856374d8719d857`; its name and connection string remain private.
- `public.business_compatibility_telemetry_v2_hourly`: SELECT only `observed_hour`, `business_context`, `entry_family`, `decision_stage`, `authority_source`, `outcome`, `deployment_sha`, `eligible_count`, `collected_count`, `gap_count`.
- `public.business_compatibility_telemetry_runtime`: SELECT only `deployment_sha`, `last_seen_at`, `eligible_count`, `persisted_count`, `failed_count`.
- No INSERT/UPDATE/DELETE, no membership/auth/schema change, no customer or person-level table access. Use the trusted operator connection only for the exact column grants and eventual revoke; all collector reads must use the dedicated read-only connection.
- Before grant: verify target/role hashes, no inherited/writable privileges and unchanged ACL fingerprints. After grant: run the actual `scripts/sys-mb-compatibility-telemetry-report.cjs` via the read-only role, verify both permissions and a fresh collector result. Persist a private grant receipt. Revoke on completion of the exit gate or at a separately agreed expiry; do not claim automatic expiry from PostgreSQL GRANT.

## Other acceptance work after access

Confirm the actual longest enabled job/retry cycle, denominators, deployment reconciliation and real coverage. Use the existing owner/creator and Park-only smoke accounts for safe read-only checks. Separate manager/admin/worker sessions and same-JWT revoke need approved existing credentials or a separately authorized registered fixture lifecycle; do not manufacture them under a read-only block. CRM booking 403s are correct server denials because CRM has no timeline module; the sidebar's redundant request is a P2 follow-up outside the catalog asset block.

## Copyable authorization

```text
Дозволяю блок SYS-MB-CLOSE-03-TELEMETRY-READ-20260922: у production PostgreSQL target hash 6fb86cf6959f026d7c55b6c65edffc3499e5bb581d51840a730f915fef0e9cfd надати наявній dedicated read-only ролі з SHA-256 940efc5d4989b4cdd1d23b40678c2fec953499bd4b3d6ecb2856374d8719d857 лише column-level SELECT на перелічені в NEXT_OBSERVATION_BLOCK.md поля business_compatibility_telemetry_v2_hourly і business_compatibility_telemetry_runtime. Дозволяю exact GRANT, read-only collector/ACL verification і подальший exact REVOKE після завершення exit gate; ніяких інших privilege/schema/data mutations. Використовуй чинні локальні credentials без розкриття секретів. Якщо ACL, роль, target або колонки дрейфують — зупинись. Це не дозвіл створювати QA користувачів, змінювати membership, робити deploy або починати observation до повного live QA PASS.
```

The role-specific live QA/fixture decision is separate from this access block. `startUtc` remains null until both gates pass.
