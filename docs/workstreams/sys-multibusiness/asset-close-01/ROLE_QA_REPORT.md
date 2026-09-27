# SYS-MB-CLOSE-03 — live role and same-JWT revoke QA

Status: `ROLE_LIFECYCLE_PASS / FULL_ACCEPTANCE_HOLD`.

- Authorized block: `SYS-MB-CLOSE-03-LIVE-ROLE-QA-20260922`; exact scope is [ROLE_QA_MANIFEST.md](ROLE_QA_MANIFEST.md).
- Production identity before and after: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`, `codex/eventgenix-production`, `v0.82.11 — Tasker + My Day UX`. No code commit, push, migration or deploy was performed.
- Private preflight SHA-256: `82a25cb86f7f72a2d9843768138195946766567ce511c088b08c5a859e96977f`.
- Dry run: `DRY_RUN_PASS`, zero membership writes, Park allowed and both target businesses denied with the existing smoke account.
- Approved run: `2026-09-22T19:56:58.111Z`–`19:57:04.532Z`; 6 `PUT` role transitions and 2 `DELETE` deactivations through the normal organization lifecycle API. The private receipt SHA-256 is `1e693969d29426e033a98ac392cfcfb8cff6366ed04644fbba715617edeabf49` and remains outside Git.
- Role checks: manager, admin and animator in Maysternya, then the same sequence in CRM. Each update was read back from the owner access profile and the smoke account's `GET /api/auth/business-profile` using **one retained smoke JWT**. Fourteen foreign/no-membership profile requests were denied. Park access and its `senior_manager` default were checked ten times.
- Immediate revoke: after each `DELETE`, the same retained smoke JWT received denial for the revoked business. Neither business was active while the other was tested. Zero failed lifecycle assertions; no recovery delete was needed.
- Independent fresh-login read-back after the run: Park `senior_manager`, active and default; Maysternya and CRM rows exist but are **inactive**. No active QA grant remains. Those two inactive rows and security audit events are the documented durable residual; they were not hard-deleted.
- The runner invoked no booking, customer, job, send, payment, generation, export or deploy endpoint. Browser QA blocked all API mutations. This does not prove no independent production background job ran during the interval.

## Browser and network check after cleanup

Read-only Chrome checks covered creator and smoke accounts at 390/768/1440. The creator's tested Maysternya page shells rendered without horizontal overflow; keyboard focus remained reachable. Smoke direct Maysternya navigation was denied after cleanup. The broad diagnostic returned `FAIL_READ_ONLY_BROWSER` because it treats all console resource errors and navigational aborts as failures. Focused network classification at 1440 found six `GET /api/bookings/<date>` 403 responses with `businessContext=crm` (correct CRM timeline containment), three `GET /api/chat/unread` 403 responses (approved Hermes containment), and four `net::ERR_ABORTED` requests during page navigation. It found no required Maysternya domain 4xx/5xx. The CRM-context second tab showed all four business options; its final route varied between the root/dashboard in two runs, so route convergence is **INCONCLUSIVE**, not a live PASS. No membership write occurred in either browser run.

Private sanitized browser evidence hashes: broad result `38ecf827e93d67765ce05ed970611aa3a4cf86d77c6bdc139c02da4b0e1b0bd6`; focused result `0c281cb18405ab8c12cf4ab0dda315e6a892c55c7d77a313d9ac3e8fb3b4ece1`.

## Residual gate

This block proves the lifecycle and same-JWT revoke for one registered account. It does not prove independent simultaneous worker sessions, two-organization isolation, late-response race behavior, complete entry-family coverage, the longest enabled cycle, or five days of real traffic. The role QA requests are synthetic and must be excluded from real-operation denominators. `observation.startUtc` remains `null`, `PASS_MEASURED=false`, and `GLOBAL_MODEL_COMPLETE=false`. The narrow telemetry SELECT grant remains active and still requires exact revoke after the gate or abandonment.

A fresh dedicated-role read-only collection at `2026-09-22T20:07:30.739Z` returned `HOLD`: 10 required context/family pairs remained unobserved; current lookback covered one UTC day; no allowed service-domain event was established for either target; runtime counts reconciled and known gap count was zero. Admission counts of 91 CRM and 2732 Maysternya include controlled QA and are **not** certified real-traffic denominators. The private aggregate report SHA-256 is `bc564b7659af73815d7cd5dc02c22375bc2bdd4e1d3a4547a8d23095d80a0940`.
