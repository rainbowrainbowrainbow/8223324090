# Banquet cancellation incident — final production audit

Date: 2026-08-15  
Production impact: yes, read-only audit.  
Status: BLOCKED for final trusted production QA mutation; core release and legacy readable postconditions are verified.

## Production baseline

- Live URL: `https://8223324090-production.up.railway.app`
- Live version: `0.80.148`
- Release label: `My Day Compact Pulse`
- Live commit: `cede1f8c0cab181828d753520b0d01ae3cffc8ca`
- Source branch: `codex/checkbox-hardening-release-v080103`
- Railway status: production environment, service `8223324090`, active deployment `SUCCESS`, instance `RUNNING`
- Deployment message: `Release v0.80.148 My Day Compact Pulse (cede1f8c; codex/checkbox-hardening-release-v080103)`

Task 3 was executed from documentation/tooling branch:

- Branch: `codex/task1-trusted-qa-manifest`
- HEAD: `583236459bf8a1a117eacb2bec3fe2af45224035`

## Read-only evidence collected

### Production inventory

Generated artifact directory:

- `output/task3-final-audit-20260815`

Hashes:

- Bundle hash: `a8a389d844c58a7bfbd8971cda83248bace45cae284ff220778e98ab0788fda9`
- Booking cleanup manifest: `fb43febac6e47b027db2455c221f14885ec34d3be6cfb5e121a39f7d2637a905`
- Rooms manifest: `eb4df2efa5f0282e7034a3b5dd0ccea651410f48b0554f4527f85d7510430a00`
- Constraints manifest: `fa756f2bdc4c3b0dbe6e807deae6b346b07cb43546f99d1b42a3ae0216ee1d06`
- Trusted QA manifest: `d18c942b4506ba4e782fb1b64c7d11d11cdff25d1c58a87c52c6aa13c3c6d4d3`
- Zero-mutation proof: `0a4e33afa02ffd6e2cfe4515ecaf149179eaff7232b398e098b32881396232c7`

Read-only inventory result:

- Audit did not mutate production state.
- Approved cleanup set `BK-2026-0663` to `BK-2026-0668` remains closed on the intended active timeline surfaces.
- `BK-2026-0662`, deposit `21`, and group `BQ-MROUEOJA-35896807` remain explicitly excluded and were not changed.
- The legacy excluded set still explains the remaining cleanup inventory counters: 1 active booking, 1 active group, 1 deposit, 1 machine-owned unfinished task, and 11 side-effect rows. These are not newly approved cleanup targets.

### Previous trusted QA artifacts

Generated artifact directory:

- `output/task3-trusted-qa-legacy-audit-20260815`

Trusted QA manifest:

- Manifest hash: `77b9da99350afe9e85fbe1240706e97b4e37ffc6d85f78f16ce36092edf7093f`
- Bundle hash: `5328c05df2939e0a038efed1f68be6ab5d65108038eb61812b3e3b1c2dfea88b`
- Planned run ID: `qa-banquet-cancellation-20260819-05`
- QA product ID: `qa-banquet-cancel-20260819-05`

Readable legacy QA surfaces are clean for:

- Bookings `BK-2026-1095` to `BK-2026-1100`
- Groups `BQ-MSU8882M-7AFA8523`, `BQ-MSU888AG-22351CC8`
- QA products `qa-banquet-cancel-20260819-02`, `qa-banquet-cancel-20260819-03`, `qa-banquet-cancel-20260819-04`

Readable leftover counts:

- active bookings: 0
- active banquet groups: 0
- active products: 0
- open tasks: 0
- finance transactions: 0
- receipts: 0
- certificates: 0
- outbox events: 0
- event queue: 0
- rule execution log: 0
- notification outbox: 0
- warehouse stock movements: 0
- chat channels: 0
- announcements: 0
- print jobs: 0

Tables or privileges not available to the readonly credential were not treated as clean evidence.

## Room and constraint integrity

Read-only inventory result:

- Active bookings missing `room_resource_id`: 0
- Active bookings with corrupt room text: 0
- Active banquet groups missing `room_resource_id`: 0
- Active banquet groups with corrupt room text: 0
- Group/primary mismatch: 0
- Primary membership issues: 0
- Invalid active room constraint count: 0
- Unvalidated room constraints: 0

Constraints checked:

- `chk_banquet_groups_active_room_identity_v332`
- `chk_bookings_active_room_identity_v332`

Classification: CLOSED.

## Cancellation code surface

Current source contains the expected canonical cancellation surface:

- `GET /api/bookings/:id/cancellation-readiness`
- `DELETE /api/banquets/:groupId/activities/:bookingId`
- `POST /api/banquets/:groupId/cancel`
- Generic booking delete returns structured `BANQUET_ROUTE_REQUIRED` for active banquet members.
- Frontend cancellation path uses `requestBookingCancellation`.
- Readiness failure is fail-closed.
- The cancellation path does not recreate soft-cancelled bookings through generic undo.
- Client WebSocket handler processes `banquet:booking-set-updated`.

Classification: CLOSED for source-surface verification.

## Task 2 result

Task 2 did not run production mutation QA.

Blocker:

- `PRODUCTION_READONLY_DATABASE_URL` cannot inspect or operate `trusted_qa_runs` and `trusted_qa_run_entities`.
- Canonical preflight failed with `42501 permission denied for table trusted_qa_runs`.
- Railway-side execution attempt could not reach the internal database host from the local command path: `ENOTFOUND postgres.railway.internal`.
- Alternate credential probing was intentionally not used.

Because the trusted QA registry could not be inspected or used through the approved path, the following remain unproven in live production:

- creating a new server-authorized trusted QA run;
- atomic registration of new QA entities;
- exact production mutation QA scenarios;
- repeated trusted cleanup no-op for a newly created run;
- trusted QA registry `cleanup_pending` / `blocked` state absence after a new run.

Classification: BLOCKING for final trusted production QA mutation.

## No-go confirmations

During Task 3:

- No production cleanup was executed.
- No production backfill was executed.
- No production constraint validation was executed.
- No new trusted QA run was created.
- No real customer data was mutated.
- `BK-2026-0662` and deposit `21` were not changed.
- Railway settings, secrets, environment variables, and deployment state were not changed.
- No deploy or rollback was executed.

## Remaining risks and tech debt

| Item | Classification | Required action |
| --- | --- | --- |
| Trusted QA registry access for production QA | BLOCKING | Provide an approved operator DB/API path with scoped access to `trusted_qa_runs` and `trusted_qa_run_entities`, then rerun Task 2. |
| New live trusted QA mutation scenarios | BLOCKING | Run only after registry access is fixed and a fresh exact manifest approval is issued. |
| `BK-2026-0662`, deposit `21`, `BQ-MROUEOJA-35896807` | OWNER_DECISION_REQUIRED | Keep excluded, or approve a separate exact cleanup manifest. |
| Readonly audit visibility for optional side-effect tables/privileges | FOLLOW_UP_REQUIRED | Either grant readonly inspection for the missing surfaces or document that they are intentionally unavailable to the audit credential. |
| Legacy excluded cleanup counters | ACCEPTED_EXCLUDED | Do not treat as stale cleanup unless owner approves exact IDs. |

## Incident status

The banquet cancellation code path, room identity hardening, constraints, and readable legacy QA cleanup postconditions are verified.

The incident cannot be marked fully CLOSED because the final trusted production QA mutation was not executed. Current status is:

`BLOCKED_ON_TRUSTED_QA_REGISTRY_ACCESS`

## Exact next action

Provide one approved production operator credential/path that can perform the trusted QA lifecycle without exposing secrets:

- inspect `trusted_qa_runs`;
- inspect `trusted_qa_run_entities`;
- create one exact approved run;
- register exact entities atomically;
- run exact cleanup;
- verify no `cleanup_pending` or `blocked` leftovers.

After that, rerun Task 2 with a fresh manifest and owner approval. Do not use unrelated audit credentials or infer permission from client-supplied QA markers.
