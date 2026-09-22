# SYS-MB-CLOSE-02 — live QA report

Status: `PARTIAL_PASS_HOTFIX_REQUIRED`

Target: https://8223324090-production.up.railway.app

Published release: `a34ee622402776ba23efda393d37d11868640120`, `codex/eventgenix-production`, `v0.82.9`.

## PASS

| Scenario | Evidence |
|---|---|
| Exact live SHA/branch/version/label | `/api/version` and Railway helper proof agree. |
| Owner repair | Reviewed predicates matched; owner now has one active organization ownership. |
| Maysternya atomic apply | Receipt `0f3f673a59d63d1f161003dee8e24a01eccd12e0c227a887183a0d9a9bba755f`, replay=false, three memberships. |
| Four-business owner profile | Park, Dar, Maysternya and CRM are visible and switchable. |
| Smoke-account isolation | One organization, Park only; foreign Maysternya access denied. |
| Maysternya server profile | Membership mode, timeline module enabled, start page timeline, scoped page permission allowed. |
| Responsive shell | Root and tested domain pages usable at 390/768/1440; keyboard focus present. |
| Side effects | Zero business mutations during browser QA; zero new fixtures, sends, payments, generation or token changes. |

## FAIL requiring the local hotfix

### MD-TIMELINE-01 — membership member is redirected from the Maysternya timeline

- URL: `/maysternya-doli?timelineView=animators`
- Steps: sign in with the reviewed owner account, switch to Maysternya, follow the sidebar timeline link.
- Expected: Maysternya timeline opens.
- Actual: browser lands on `/dashboard` while Maysternya stays selected.
- Evidence: server business profile reports active membership, timeline enabled and page allowed; the browser private-surface guard checks only the legacy `creator` role.
- Severity: P0 for Maysternya live acceptance.
- Candidate file: `js/timeline-context.js`.
- Local status: fixed and covered by focused tests; production deploy pending.

### PARK-CATALOG-01 — exact reviewed catalog mapping cannot pass validation

- Surface: owner-only catalog cutover prepare/apply.
- Expected: all nine reviewed existing catalog IDs pass hash-bound validation.
- Actual: prepare rejects the printable Unicode/space stable ID before any catalog mutation.
- Severity: P0 for catalog cutover completion.
- Candidate file: `services/catalogOwnershipCutover.js`.
- Local status: fixed with printable Unicode support and control-character rejection; production deploy pending.

## HOLD / NOT_TESTABLE

- Fresh direct verification of the CRM journal receipt is HOLD on a safe read-only journal path. CRM was not replayed.
- Catalog ownership, children and the three current public links remain pending the hotfix deploy and guarded apply.
- Separate manager/admin/worker browser sessions are NOT_TESTABLE with the locally available credential set; no accounts or grants were created to manufacture a PASS.
- same-JWT revoke is NOT_TESTABLE after the completed mapping transition because no pre-transition session was retained and no extra production membership mutation is allowed for the test.
- Full cross-tab/late-response acceptance and final observation start remain pending successful hotfix QA and catalog acceptance.

No credentials, tokens, private mapping payloads or production rows are included in this report.
