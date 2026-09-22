# SYS-MB-CLOSE-01 — domain matrix

Statuses:

- `SUPPORTED`: verified in the current implementation and acceptance run.
- `READY_FOR_RELEASE`: runnable locally; production apply/live proof is pending an authorized block.
- `SUPPORTED_WITH_CONTAINMENT`: verified while shared or protected data remains deliberately unassigned/closed.
- `NOT_MIGRATED`: explicitly outside this cutover.
- `HOLD_MEASURED`: implementation exists but the production time/traffic gate is not complete.

| Surface | event_genix | dar | maysternya_doli | crm | Evidence / boundary |
|---|---|---|---|---|---|
| Organization/business resolver | SUPPORTED | SUPPORTED | READY_FOR_RELEASE | SUPPORTED | Fresh DB membership on each request; two organizations and custom business accepted locally. |
| Organization owner invariant | SUPPORTED | SUPPORTED | READY_FOR_RELEASE | READY_FOR_RELEASE | Cutover preserves an active owner and rolls back on zero active owners. CRM has an exact hash-bound owner repair pending production authorization. |
| Business roles and action overrides | SUPPORTED | SUPPORTED | READY_FOR_RELEASE | SUPPORTED | director/manager/admin/worker isolation, explicit denies, and same-JWT revoke pass. Platform creator is not an operational MD/CRM role. |
| Cabinet lifecycle and default business | SUPPORTED | SUPPORTED | READY_FOR_RELEASE | SUPPORTED | Browser cabinet creation/deactivation, membership editor, last-owner guard, defaults, cross-tab, and history pass. |
| Bookings and timeline | SUPPORTED | SUPPORTED | READY_FOR_RELEASE | N/A | Scoped reads/writes, foreign IDs, no-write GET, role actions, and MD membership timeline pass. Protected booking detail ownership was not changed. |
| Customers and leads | SUPPORTED | SUPPORTED | READY_FOR_RELEASE | SUPPORTED | Scoped list/direct-ID/write/reference tests pass; provider admission is separate from domain success. |
| Tasks | SUPPORTED | SUPPORTED | READY_FOR_RELEASE | SUPPORTED | Scoped reads/writes and role isolation pass. |
| Finance operations | SUPPORTED | SUPPORTED | READY_FOR_RELEASE | SUPPORTED | Scoped operational finance reads/references pass; salary/payroll remains closed. Prices and formulas unchanged. |
| Warehouse | SUPPORTED_WITH_CONTAINMENT | SUPPORTED_WITH_CONTAINMENT | NOT_MIGRATED | NOT_MIGRATED | Scoped stock/reference checks pass for enabled businesses; photo intake and residual legacy surfaces remain explicit containment. |
| Products and graduation | SUPPORTED | SUPPORTED | READY_FOR_RELEASE | NOT_MIGRATED | Product/graduation reads and foreign denials pass where enabled. No generator/bot/export behavior added. |
| Catalog roots and durable children | READY_FOR_RELEASE | N/A | N/A | N/A | Exact nine Park roots; atomic root/child assignment, fingerprint, lock, replay, receipt, and rollback pass locally. |
| Catalog public links | READY_FOR_RELEASE | N/A | N/A | N/A | Exact three existing tokens are preserved; no rotation/republication. Disposable local 200/404 behavior passes; production private-token QA pending. |
| Catalog image blobs/assets | SUPPORTED_WITH_CONTAINMENT | SUPPORTED_WITH_CONTAINMENT | SUPPORTED_WITH_CONTAINMENT | SUPPORTED_WITH_CONTAINMENT | Shared blobs remain unassigned after cross-consumer review; filename is never treated as ownership evidence. |
| Branding/module registry | SUPPORTED | SUPPORTED | READY_FOR_RELEASE | SUPPORTED | Server registry remains authoritative; required modules are not hidden for green status. |
| MD external program IDs/provider dryRun | N/A | N/A | READY_FOR_RELEASE | N/A | Existing guarded mapping/admission and no-write dryRun paths are covered by synthetic acceptance; no production provider call. |
| Jobs/outbox/retries/recipients | SUPPORTED_WITH_CONTAINMENT | SUPPORTED_WITH_CONTAINMENT | READY_FOR_RELEASE | READY_FOR_RELEASE | Execution telemetry added. Five Hermes jobs remain event_genix; Hermes gains no MD/CRM membership. No real send used for QA. |
| HTTP/profile/service telemetry | READY_FOR_RELEASE | READY_FOR_RELEASE | READY_FOR_RELEASE | READY_FOR_RELEASE | Admission and domain outcome are separate; durable hourly v2 counters and runtime reconciliation pass in PostgreSQL. |
| WebSocket and alternate-auth telemetry | READY_FOR_RELEASE | READY_FOR_RELEASE | READY_FOR_RELEASE | READY_FOR_RELEASE | Fresh membership, revocation, serialization, and alternate-auth entry families covered. |
| Public/provider/operator telemetry | READY_FOR_RELEASE | READY_FOR_RELEASE | READY_FOR_RELEASE | READY_FOR_RELEASE | Bounded labels, no actor payloads, and entry-family registry coverage pass. |
| HR/staff/payroll | NOT_MIGRATED | NOT_MIGRATED | NOT_MIGRATED | NOT_MIGRATED | Owner/admin does not open protected HR or salary data. Existing Park read-only schedule containment is preserved. |
| Payments/billing | NOT_MIGRATED | NOT_MIGRATED | NOT_MIGRATED | NOT_MIGRATED | No payment behavior, formula, setting, or data change. |
| Art/certificates | NOT_MIGRATED | NOT_MIGRATED | NOT_MIGRATED | NOT_MIGRATED | Explicitly denied outside its separate migration. |
| Compatibility exit gate | HOLD_MEASURED | HOLD_MEASURED | HOLD_MEASURED | HOLD_MEASURED | Requires production cutover proof plus complete UTC duration, traffic, full family coverage, and zero telemetry loss/legacy authority. |

## Release conclusions

- `MAYSTERNYA_RELEASE_READY=true` for an authorized production block.
- `CRM_CUTOVER_REPLAY_REQUIRED=false`; verify the existing receipt and apply only the exact owner repair if predicates match.
- `PARK_CATALOG_OWNERSHIP_READY=true`; production public-link proof remains pending.
- `GLOBAL_MODEL_COMPLETE=false` until `PASS_MEASURED` and the final legacy-authorization release.
