# EG-HR-16-NEXT — Park checklist and profession ownership recheck

Status: **HOLD for all four protected GETs**. No server access change is justified by the available ownership evidence. Production impact: yes for any later route release; this candidate only improves fail-closed client states and tests.

## Source and audit boundary

On 2026-09-28, live `GET /api/version` reported `v0.82.35`, `2eeaca57215220d434ac458b32ee9fbe3b303618`, `codex/eventgenix-production`. The remote production ref was `7a61464776e983165fbac7a5cc3062515596858a`; its only difference from live was a documentation proof commit. This clean feature worktree started from that remote ref.

A fresh PostgreSQL audit used the existing `eventgenix_audit_ro` connection in one `REPEATABLE READ READ ONLY` transaction with a statement timeout. The role was non-privileged, had SELECT and no INSERT/UPDATE/DELETE privileges on the nine inspected tables. No lease, grant, business-data write, or schema change occurred. Queries returned only aggregate counts and column names, without personal records.

| Source | Aggregate rows | Owner evidence |
| --- | ---: | --- |
| `hr_professions` | 35 | No business or organization owner column; global catalog. |
| `hr_profession_checklist_items` | 93 | Linked to a profession, whose business owner is unproven. |
| `hr_staff_profession_checklist_progress` | 7 | Staff link exists; checklist template ownership remains unproven. |
| `staff_role_assignments` | 264 | Staff link exists; profession catalog ownership remains unproven. |
| Profession-linked `training_courses` | 31 | All linked rows use the profession seed source; seed provenance does not establish business ownership. |
| `staff_shift_preferences` | 202 | Staff-linked schedule conditions; any future read needs a separate `hr.schedule.view` check or omission. |
| `staff_profession_rates` | 3 | Compensation source; exclude from ordinary HR reads and SQL. |
| Global `settings.hr_company_structure` | 1 | Structure has a separate Park read decision; 26 professions refer to structure nodes, which does not assign ownership to those professions. |

Checked item→profession, progress→staff/profession, assignment→staff/profession, training→profession, condition→staff, and rate→staff orphan counts were all zero. No checklist items, progress, or assignments were created since the previous 2026-09-27 09:13 UTC audit. Referential consistency and stable counts do **not** prove exclusive Park ownership. The existing Park owner decision covers staff and schedule history, not this global profession/checklist/training catalog. No newer explicit owner decision was found in the current production documentation.

## Exact route decisions

| GET | Read graph | Decision |
| --- | --- | --- |
| `/api/hr/professions/:professionKey/checklist` | Global profession and checklist items | **HOLD**: template owner is unknown. |
| `/api/hr/professions/:professionKey/staff/:staffId/checklist` | Template, Park staff, assignments and progress | **HOLD**: a Park staff link does not establish template/progress owner. |
| `/api/hr/checklists/dashboard` | Global professions/items with staff assignments and progress | **HOLD**: aggregates cannot be partitioned by a proven business owner. |
| `/api/hr/professions/workspace/:identity` | All preceding sources plus training, structure, schedule conditions and compensation | **HOLD**: independently unproven joins; current SQL reads hourly rates before response construction. |

The existing partial `GET /api/hr/professions` remains available. No `/professions/*` prefix exception, payroll read, write route, or Park bypass was added. Future implementation requires an explicit owner decision for each shared source, a fresh aggregate foreign-signal check, exact per-route allowlists, current single Park membership with matching business/organization IDs and `hr.staff.view`, minimal SQL/JSON projections, and route tests for 403/404/500, revoked/foreign/multi/all scope and nested masks. Workspace schedule conditions must be omitted or separately require `hr.schedule.view`.

## Client-only candidate and verification gate

The candidate distinguishes dashboard `403` as restricted, clears old rows and counts, retains retry, shows unknown counts as `—`, and invalidates dashboard/workspace requests when account, business, scope, or rights change. Workspace temporary errors gain a fresh-GET retry. Browser and actual Express tests cover these fail-closed states and assert that the four protected GETs still return `403` before SQL. This does not claim positive Park route coverage or live QA; those remain blocked by ownership HOLD and require a separate release after a proven owner decision.

Local verification on Node 22.23.1 / npm 10.9.8: `node --test tests/park-hr-staff-card-routes.test.js` passed 13/13; `npm exec --offline --yes --package=playwright -c "node tests/browser/hr-checklists-async-browser-smoke.js --verify-local-fixes"` passed 108/108; `npm test` passed. The browser run is synthetic and makes no production writes.
