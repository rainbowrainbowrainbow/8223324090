# Trusted QA attribution safety audit

Date: 2026-08-16

Production impact: no runtime change in this audit pass.

## Baseline

- Live URL: `https://8223324090-production.up.railway.app`
- Live `/api/version` at audit start: `0.80.161` / `Task 12 Machine Auth Hardening`
- Live commit at audit start: `11e7b0a4359f6e168ea6ae1b2ba6e6e6bbac84e2`
- Live source branch: `codex/checkbox-hardening-release-v080103`
- Audited source branch tip: `0.80.162` / `My Day Overdue Action Hotfix`

The user-supplied `0c62a4fd64b85a2044fd003aca32292689109c61` reference is historical evidence for the original Trusted QA attribution release, not the current live `/api/version` authority.

## Trusted QA flow matrix

| Flow | Initiator | Temporary authority | Allowed side effects | Attribution record | Cleanup/revoke path | Expiry path | Visible response fields |
| --- | --- | --- | --- | --- | --- | --- | --- |
| QA creator lease | Permanent `creator` with `manage_accounts` | `creator` role overlay on a marked QA/test account only | Account lease columns and security event | `qa_creator_lease_id`, `qa_creator_lease_expires_at`, account security event | `DELETE /api/users/:id/qa-creator-lease`; live QA runner verifies restoration in `finally` | Auth middleware resolves only unexpired lease; expired/replaced lease fails closed to stored role | `success`, `leaseId`, `role`, `expiresAt` |
| Read-only authenticated QA | Dedicated QA account after temporary lease | Browser read-only guard plus explicit request allowlist | `businessMutations = 0`; only login/refresh POST allowed in browser context | JSON report only | Lease revoke in `finally`; failure is reported | Lease expiry remains server-side fallback | Release metadata, route status, permission lifecycle, console state |
| Trusted QA booking create | Authenticated operator with server-issued QA run token | Token scoped to operator/user, endpoint, context, customer/product/room/line/date/time | Exact QA booking/product/banquet writes inside the approved run | `trusted_qa_runs`, `trusted_qa_run_token_uses`, `trusted_qa_run_entities`, booking `extra_data.disposableQa` | Entity manifest drives cleanup | Token expiry checked before token use | Stable public QA error code/details only |
| Side-effect attribution | Server-side booking/integration writers | No extra user authority | Side-effect rows may carry durable `trusted_qa_run_public_id` | Supported side-effect tables include nullable Trusted QA attribution columns | Cleanup inventory checks active leftovers before marking clean | N/A | Table names, counts, attribution method; no secrets |
| Cleanup watchdog | Scheduler / operator cleanup command | Exact manifest and row locks | Cancels only registered QA bookings/groups/products after side-effect visibility passes | Run state, entity cleanup state, history entry | Failures keep run `cleanup_pending` or `blocked` with visible error | Bounded retry attempts | `processed`, run status, error code |

## Audit conclusions

- A QA creator lease does not permanently change `users.role`; it is an auth-time overlay with bounded expiry.
- Client-supplied disposable QA markers are rejected without a server-issued QA token, including markers that try to use `source: trusted_qa`.
- Trusted QA token use requires a request id and is replay-protected.
- Entity registration is exact-manifest based and idempotent for duplicate registration.
- Cleanup fails closed when side-effect visibility is incomplete or active business side effects remain.
- Failed cleanup is reported as retry/blocked; it is not masked as a successful cleanup.
- The read-only live QA runner keeps browser business mutations blocked and reports `businessMutations = 0`.

## Residual risks

- The manual Trusted QA booking workflow can intentionally create disposable QA business records. This is accepted only for an approved QA run and remains outside read-only live QA.
- Side-effect inventory still checks both durable Trusted QA attribution columns and legacy entity references such as booking ids. This is intentional: it prevents ordinary active business side effects attached to QA records from being hidden as zero.
- No runtime gap was found in this pass, so no patch release or Railway deploy is required for this audit alone.
