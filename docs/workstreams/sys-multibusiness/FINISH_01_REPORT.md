# SYS-MB-FINISH-01 report

Status: **LOCAL_ACCEPTANCE_COMPLETE / RELEASE_AUTHORIZATION_PENDING**.

Candidate branch: `codex/sys-mb-finish-01-r3-20260913`.
Production base: `d2b6a686a4fe4ad21d14d809c053cab68dcfb374` (`codex/eventgenix-production`, v0.81.151) captured after the final rebase. The cumulative SYS-MB change preserves the later Design Board decision and PIN-route release changes.

## Closed P0 scope

- Membership requests cannot enter global contractor/procurement, staff, certificate, Art, or payroll surfaces. The server returns a stable scoped `403` before domain reads; the pre-cutover Park compatibility path remains explicit.
- Warehouse disables contractor/procurement controls after the matching availability decision instead of leaving stale actions.
- Generic booking `linkedTo` now locks and verifies the parent inside the caller transaction. Foreign, missing and self parents return `422` with no write; an owned parent remains valid. Booking identifiers, aliases, row mapping and canonical detail rendering were not changed.
- Wallet initialization is idempotent and transaction-bound. Chat badge sends its selected business context and the browser denial classifier only recognizes the exact scoped legacy-chat denial observed in the fixture.
- Payroll reporting contract tests now model the only permitted compatibility request; no payroll calculation or amount changed.

## QA lifecycle and remaining limits

Production writable fixtures remain intentionally disabled. Existing QA analysis proved that account creation, tasks, product `price_rules`, default chat enrollment and organization membership deactivation do not have a complete, reviewed cleanup lifecycle. This candidate establishes the safe path: after an authorized release, use approved existing test accounts with read-only UI/API checks only and set `window.__eventGenixLiveQaReadOnly = true` before browser login. This does not prove membership create/deactivate/revoke in production; those cases remain `NOT_TESTABLE` until a registry-owned fixture workflow is separately reviewed.

No production preflight connection was supplied. The available collector is therefore not a production schema/membership ledger proof. No bootstrap, owner assignment, migration apply, provider call, production data mutation, push, deploy, or live login occurred in this task.

The final actual-app acceptance run `d06_1789297445570_d09fe4` completed with **196 PASS / 1 NOT_TESTABLE / 0 FAIL**. It ran through the real local Express server and disposable PostgreSQL database, including two organizations, three businesses, role isolation, same-JWT revoke, browser cross-tab/history, late-response behavior, keyboard and 390/768/1440 layouts. The fixture database cleanup was verified.

The full `npm test` baseline passes after aligning two static browser-smoke assertions with the intentional `npm test = verify + SYS-MB` composition. The browser smokes remain outside the baseline; the correction does not change either browser flow.

## Release gate

The candidate modifies `middleware/auth.js`, `routes/auth.js`, finance-adjacent admission, and protected booking write behavior. Repository policy requires a fresh exact Red + Yellow authorization before commit/push/deploy. The release manifest records the source, target, no-new-migration inventory, read-only QA boundary, and forward rollback procedure.

`PARK_DAR_RELEASE_READY` remains false until exact-SHA CI, helper deploy, live version proof and approved read-only live QA pass. `GLOBAL_MODEL_COMPLETE` remains false because Maysternya/CRM cutovers and compatibility zero-usage evidence are outside this task.
