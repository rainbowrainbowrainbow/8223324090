# SYS-MB RECOVER-02 domain matrix

| Domain / surface | Status | Evidence | Remaining release condition |
| --- | --- | --- | --- |
| Organization/business registry | SUPPORTED_LOCAL | Existing SYS-MB registry plus guarded `applyReservedCutover`; local unit and PostgreSQL tests pass. | Rebase/candidate from current production and apply only with exact protected block. |
| MD/CRM reserved business creation | SUPPORTED_LOCAL / PRODUCTION_HOLD | Private approved payloads exist for `maysternya_doli` and `crm`; apply is hash-bound, fingerprint-aware and idempotent. | Refresh DB fingerprint from current production before apply. |
| MD delegated access | SUPPORTED_LOCAL | `/maysternya-doli` permits `director`, `manager`, `admin` only under active MD membership; Park/global roles denied. | Live QA after cutover for director/manager/admin/worker. |
| CRM access | SUPPORTED_LOCAL | CRM payload grants approved directors/admin; no platform creator business role. | Live QA after CRM cutover. |
| Park/Dar existing access/defaults | PRESERVED | No mapping or code path changes defaults for Park/Dar. | Release QA must compare before/after access matrix. |
| Catalog roots/children/assets | SUPPORTED_SCHEMA / APPLY_HOLD | Migration 364 adds ownership/status/public visibility fields across catalog root/child tables without assigning data. Private decision keeps all nine roots Park-owned. | Data marking/apply only through approved mapping/release block; verify public tokens before preserving live use. |
| Public links | SUPPORTED_POLICY / VERIFY_HOLD | Package preserves existing tokens by default and adds visibility marker columns; no new tokens are generated. | Verify `122112`, `Торти`, `Випускний` content on live before claiming safe public PASS. |
| Templates/recurring | BLOCKED_FOR_FULL_CUTOVER | Current D05 reports still mark historical template ownership as requiring explicit mapping and rollback proof. | Separate runnable mapping/apply for templates if production preflight shows MD/CRM-owned rows. |
| Jobs/retries/Hermes | SUPPORTED_FOR_PARK_JOBS / MD_CRM_NOT_MIGRATED | User decision keeps Hermes bot without new MD/CRM rights and five Hermes jobs under Park. No new sends are added. | Provider/job live QA must verify no MD/CRM automatic sends after cutover. |
| HTTP/profile telemetry | SUPPORTED_LOCAL | `middleware/auth.js` records bounded profile/http authority outcomes. | Needs migration 363 live, then measured window. |
| WebSocket telemetry | SUPPORTED_LOCAL | `services/websocketEventAccess.js` records bounded recipient outcomes without IDs/payloads. | Needs migration 363 live, then measured window. |
| Internal service telemetry | SUPPORTED_LOCAL | `services/legacyBusinessSurface.js` records bounded service outcomes for internal legacy surface checks. | Needs migration 363 live, then measured window. |
| Provider/job/operator/public telemetry | REPORT_READY / INSTRUMENTATION_PARTIAL | Collector requires these families in the matrix; not all producer call sites are instrumented in this patch. | Add/verify concrete callsite instrumentation before compatibility removal. |
| HR/payroll/payment/Art | NOT_MIGRATED / PROTECTED | No automatic owner/admin expansion; existing containment remains. | Separate protected domain releases only. |
| Production compatibility removal | HOLD | Current live lacks telemetry table; zero-usage cannot be measured yet. | Start measured exit window after telemetry release and require PASS_MEASURED. |
