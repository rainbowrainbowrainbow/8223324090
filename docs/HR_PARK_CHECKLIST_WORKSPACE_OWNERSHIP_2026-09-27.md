# EG-HR-16 — checklist/workspace ownership and feature handoff

Status: **HOLD for all four requested GETs**. Production impact: yes. This feature changes only client failure handling and fail-closed regression coverage; it does not grant access to another HR route.

## Source identity and read-only evidence

- At 2026-09-27, live `GET /api/version` and remote `codex/eventgenix-production` both identified `18be138847f34a0ba935dd52d6dc6bedea9fdcb3`, version `0.82.20`. The clean feature worktree was created from that SHA.
- At 2026-09-27 09:13 UTC, the existing `eventgenix_audit_ro` role was verified in a `REPEATABLE READ READ ONLY` transaction. No grant, lease, schema or business row was changed. SELECT was already available on the nine inspected tables. Only aggregate counts and schema column names were returned; no names, row IDs or contacts were queried.
- Aggregates: 35 `hr_professions`, 93 `hr_profession_checklist_items`, 7 `hr_staff_profession_checklist_progress`, 264 `staff_role_assignments`, 31 profession-linked `training_courses`, 202 `staff_shift_preferences`, 3 `staff_profession_rates`, and one global `settings.hr_company_structure` row. Checked orphan checklist items, progress→staff, progress→profession, assignment→staff and training→profession links were each zero.
- None of the inspected profession, checklist, progress, staff, assignment, training, shift-preference, rate or settings tables exposes a `business_id`, `organization_id`, `business_context`, `context_key` or `owner_business_id` column. Zero orphan counts prove referential consistency, **not** exclusive Park ownership. The recorded Park decision assigns existing staff and schedule history to Park; it does not establish ownership for all profession templates, training courses and the global settings value.

## Route-by-route decision

| Exact GET | Read graph | Decision |
| --- | --- | --- |
| `/api/hr/professions/:professionKey/checklist` | `hr_professions` → `hr_profession_checklist_items` | HOLD. Catalog's existing partial read does not prove ownership of full checklist titles or archived items. |
| `/api/hr/professions/:professionKey/staff/:staffId/checklist` | profession/items → `staff`, `staff_role_assignments`, progress and migration issue links | HOLD. Staff is Park-owned, but checklist/progress ownership is not established. |
| `/api/hr/checklists/dashboard` | profession/items → staff assignments, progress, orphan/archived records and search | HOLD. Global aggregation has no proven business partition. |
| `/api/hr/professions/workspace/:identity` | profession, staff, checklist/progress, shift preferences, rates, training courses and global structure settings | HOLD. This joins independently unproven training/structure sources and reads compensation internally. |

The existing partial `GET /api/hr/professions` remains unchanged. No `/professions/*` prefix exception is introduced. If owners establish exclusive Park provenance for a subset, implement each exact GET separately, require current single-business Park membership with matching business/organization IDs and `hr.staff.view`, and omit conditions unless `hr.schedule.view` is separately checked. Use a minimal response projection, exclude compensation, medical/account fields and unrelated training data, and add actual Express positive/negative tests for that specific route. A fresh aggregate audit must exclude mixed/foreign signals before release.

## Client-side safety in this candidate

- Dashboard 403 is `restricted`, clears prior rows and remains retryable; 500/offline is `error`. Missing summary counts render as `—`. The existing request sequence and context binding continue to discard late dashboard responses.
- Workspace 403 is `restricted`, 500/offline is `error` with a fresh-GET retry. Business/account/scope/permission changes invalidate an in-flight workspace request, clear prior data and hide the content; a late response cannot repaint it.
- Synthetic browser checks cover those states. Actual Express tests assert all four routes remain 403 before SQL for Park, missing capability, foreign business/organization, revoked membership and all/multi scope. Positive route, 404/500 and masking tests remain a gate for any future route implementation; they are not claimed here.

No live QA of new code is possible before a separate release. Production push/deploy and DB lease are outside this feature.
