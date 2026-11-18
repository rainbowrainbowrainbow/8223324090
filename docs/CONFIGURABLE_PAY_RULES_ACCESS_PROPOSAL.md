# Proposed Park compensation operation mapping

Status: owner approved `PAY-RULES-ACCESS` in this task. Implemented locally only;
no production mutation, commit, push or deployment is included.

Target: `services/parkHrPayrollAccess.js`, `parkHrPayrollCapabilities`, router `hr`.
Add only these exact operations to the existing membership lane:

| Method | Path | Existing capability set |
| --- | --- | --- |
| GET | `/payroll-rules/defaults` | VIEW |
| GET | `/payroll-rules/levels` | VIEW |
| GET | `/staff/:positiveId/payroll-rules` | VIEW |
| GET | `/vacancies/:positiveId/payroll-template` | VIEW |
| POST | `/payroll-rules/defaults` | RULES |
| POST | `/payroll-rules/levels` | RULES |
| POST | `/staff/:positiveId/payroll-rules/qualification` | RULES |
| POST | `/staff/:positiveId/payroll-rules/vacancy` | RULES |
| PUT | `/staff/:positiveId/payroll-rules/component-input` | RULES |
| PUT | `/vacancies/:positiveId/payroll-template` | RULES |

VIEW remains `hr.payroll.view`. RULES remains VIEW + `hr.payroll.manage` +
`manage_payroll_rules`. No new grants, roles, sessions, identity operations or
changes to capability resolution. No wildcard route prefix.

Existing guard behavior remains mandatory: current active Park membership,
single business scope, writable scope for mutations, verified ownership of the
legacy namespace, route-level capability guards, service-level business and
staff/profile ownership, period locks and audit records. Other companies retain
their current legacy-data boundary. Hiring retains its existing separate lane.

Proposed verification after approval: exact map allow/deny tests; read-only and
missing-capability denial; foreign context, revoked membership, aggregate scope
and ownership conflict denial; synthetic actual-app browser journey on the
disposable local database. No real account or production mutation.

Rollback: remove only the added exact operation mappings. The additive rule
data and existing guards remain intact. No commit, push or deployment included.

The existing `/staff` card intentionally requires membership even while the
legacy compensation routes can run in compatibility mode. The browser fixture
must therefore use the same real synthetic membership setup as the existing
`hr-pay-actual-app-browser-smoke.js` gate; a compatibility creator is insufficient
for an end-to-end employee-card journey.
