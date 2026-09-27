# EG-HR-14/15 — Park structure and pool read preflight

Status: **EG-HR-15 feature candidate; EG-HR-14 HOLD**. Production impact: yes. This document is a code and prior-proof assessment, not a new production data audit or live QA.

## Source and ownership

- On 2026-09-27, live `GET /api/version` and remote `codex/eventgenix-production` both identified `18be138847f34a0ba935dd52d6dc6bedea9fdcb3` (`0.82.20`). This feature worktree started clean at that SHA.
- `docs/PARK_STAFF_SCHEDULE_READ_RECOVERY.md` records the owner's explicit decision that **all existing staff records** belong to Park. The final HR release proof records a read-only aggregate audit of staff created since 2026-09-14: one new Park-provenance record and zero foreign or checked orphan signals. `staff.hr_pool_status` is a field of this same staff namespace. No pool-specific owner column exists. This is the ownership basis for the narrow pool read; a fresh production ownership audit remains a release gate.
- `settings.hr_company_structure` is a global singleton without a row-level business owner. The after-base status report explicitly requires a separate owner decision. Neither the staff decision nor the UI's Park label proves that this settings value belongs exclusively to Park. **HOLD GET /api/hr/company-structure** until an explicit owner decision and read-only provenance check. Its server access remains unchanged.

## Candidate boundary and UI

- Only `GET /api/hr/pool?status=reserve|blacklisted` is added to the Park membership recovery. It requires active single-business Park membership, matching current business and organization IDs, and `hr.staff.view`. Other businesses, revoked/inactive or compatibility membership, aggregate scope, HEAD and writes remain denied.
- The SQL and final response expose only `id`, `name`, `department`, `position`, `is_active` and `hr_pool_status`. Missing/invalid status returns 400; query failure returns 500. Phone, notes, blacklist reason and compensation are omitted.
- HR Team reserve and blacklist categories already use `GET /api/hr/staff`; no frontend call to direct `/api/hr/pool` was found. Do not add a duplicate entrypoint solely to use the new route. The future product owner may remove the unused direct route instead of carrying two list APIs.
- The structure UI now marks 403 as restricted, clears stale nodes and shows retry; offline/500 remains error. A successful empty response alone shows an empty structure. Base staff detail remains independent of structure success.

## Verification and release gates

- Actual Express router tests cover both pool statuses, capability and business/organization negatives, revoked/inactive/compatibility membership, multi/all scope, invalid status, 500, field masking, HEAD/writes, unchanged structure 403 and base-card access. The HR org UI test covers 403, cache clearing and retry; its existing test covers offline error.
- Before any production integration: repeat a fresh aggregate staff ownership audit using an already authorized read-only role; HOLD on foreign or ambiguous signals. Obtain a separate owner decision and read-only provenance proof before considering EG-HR-14. Confirm exact-SHA CI, release version/cache/changelog, and test-account GET QA after a separately authorized release. No new DB lease, production write, production push or deploy belongs to this candidate.
