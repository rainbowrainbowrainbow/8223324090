# Task 8 — compatibility exit gate

Status: **HOLD — NOT_INSTRUMENTED / NOT_MEASURED**.
Both Maysternya and CRM cutovers are pending; Park/Dar Task 7 remains HOLD.
This document fixes the proposed engineering observation policy before collection. It contains no claimed zero-usage period and does not change runtime telemetry, infrastructure, secrets or auth.

## What must reach zero

Operational authorization must stop using legacy user context arrays or global operational roles, and operational data selection must not fall back implicitly to Park. Removing compatibility is separate from removing response fields needed by older clients and separate from removing platform creator authority for technical bootstrap/account functions.

A legacy field mirrored for response compatibility is not an authorization grant. Count its use independently. An actorless integration can be supported by a verified stored business principal; a machine principal is not a human membership and must have its own ownership/deactivation contract.

## Required complete entrypoint inventory

| Entry family | Current evidence / instrumentation target | Required observation |
| --- | --- | --- |
| HTTP session/profile/context admission | `middleware/auth.js`, `routes/auth.js`, `services/businessMembership.js`, `services/businessContext.js` | Every operational decision: explicit requested context or absent, resolved business/organization class, membership versus legacy authority, allow/deny and missing-context fallback. Exclude only documented account-recovery/profile operations from operational denominators. |
| Profile/modules/cabinet/defaults | `services/businessProfile.js`, `services/businessModuleRegistry.js`, `services/businessCabinet.js` | Registry versus built-in module/branding fallback, default selection and compatibility serialization distinguished from access grants. |
| Direct service/foreign-ID admission | Scoped domain services, `services/businessUserAccess.js:18`, `services/omni-inbox.js:8`, `services/legacyBusinessSurface.js:54` and `services/leadReferenceIntegrity.js:32` | Machine/internal entrypoints that bypass HTTP; unscoped/global directory use and MD external-product compatibility fallback. |
| Alternate actor authentication | `middleware/hermesAuth.js:124`, `:207` loads a raw actor and assigns request user independently | Inventory every actual consumer and whether it reaches fresh membership admission; record authority/context outcomes. This source selector finding is not a demonstrated live disclosure. |
| WebSocket and recipients | Socket admission, `services/websocketEventAccess.js:44`, legacy stored default at `:53`, recipient selection and `services/leadNotifier.js` | Connection/message/recipient authority, revoke handling and reconnect across cutover. Existing connections cannot disappear from the denominator. |
| Providers/custom-secret/public paths | `routes/leads.js`, MD webhook/availability, `routes/omnichannel.js`, public token/asset routes | Stored owner/principal/context resolution, absent-context fallback and deny/replay outcomes. Never log token, destination, payload or contact data. |
| Scheduler/event rules/retries | `services/scheduler.js`, `services/eventBus.js`, recurring/outbox/worker owners | Job admission/execution/retry/dead-letter authority and all configured schedule cycles, including work accepted before cutover. |
| Operator/admin/import paths | Explicit operator tools and bootstrap/registration workflows | Whether any real operational access still depends on legacy fields or implicit context; document each disabled/dormant surface. |

This is an inventory baseline, not a claim that adding one HTTP counter covers all rows. Every concrete entrypoint discovered in domain preflight must have an owner, event/counter, denominator and test. Existing `middleware/apiAudit.js` mutation audit omits ordinary reads and lacks complete authority-source coverage. It cannot prove this gate. Prior D06 synthetic probes cannot prove live usage.

Telemetry implementation remains a separate reviewed code change across the exact auth/service/job surfaces. Use bounded event labels (business context from the approved registry or an unknown bucket, surface family, authority source, result, deployment SHA); no user identifiers, arbitrary URLs or unbounded request keys. Persist or aggregate durably across deploys/restarts with documented loss detection. Storage/schema/hosting changes require their exact scope; do not assume a new metrics provider or secret.

## Observation policy set before the first measured day

The following is a conservative engineering acceptance threshold, not a business permission decision:

1. Start after **both** independent cutovers have exact live SHA proof, passed live QA and clean fixture cleanup. Restart the affected observation window after an auth/ownership/entrypoint policy change or a collection gap.
2. Observe at least **14 consecutive complete UTC days**, extended to cover the longest enabled scheduler/retry/retention cycle plus 24 hours. If that cycle is unknown or unbounded, remain HOLD until bounded or separately accepted with complete evidence; do not assume a monthly job was covered by two weeks.
3. For **each migrated business**, collect at least **30 real authorized operational requests on at least 5 distinct days**, with positive coverage for every enabled domain's read and write families. Preserve the user's data boundaries: do not manufacture real records just to meet a quota.
4. Also cover each enabled WebSocket, provider, public-link, operator and job family with real eligible traffic. When no safe real occurrence exists, a separately authorized controlled fixture can verify the path, but it must be labeled controlled QA, not real usage. An uncovered enabled family stays HOLD or must be explicitly deactivated and proven unreachable.
5. Exercise different ordinary business roles, owner visibility, two organizations, same-JWT revoke, account/cabinet switching, concurrent tabs and stale responses with approved safe QA. Denial checks supplement traffic and must never disclose foreign records.
6. Require **zero legacy operational grants**, **zero implicit Park fallback selections**, **zero legacy shared-recipient/job authority**, **zero unregistered/unowned accepted operations**, **zero unexplained gaps**, and **zero open enabled-domain ownership failures** across the complete window. Retain counts of denied legacy attempts; any such client still requires a supported migration/deprecation decision before compatibility code can be deleted.
7. Reconcile counters with independent ingress/job totals: collected decisions plus explicit documented exclusions must account for the complete eligible denominator. Sampled logs without a completeness bound, a single quiet login or absent error logs do not qualify.

Counts are per business and per entry family; one busy Park endpoint cannot mask an unused CRM provider path. The 30-request threshold is only a floor, never a substitute for coverage or schedule duration.

## Evidence format and result rules

Store a sanitized report with:
- exact start/end UTC, deployments and configuration/mapping hashes;
- business/organization inventory and actual enabled modules;
- per entrypoint eligible/collected/excluded/legacy/membership/principal/deny/fallback counts;
- traffic days, longest job/retry cycle and measured coverage;
- instrumentation gaps, process/deploy intervals and reconciliation;
- real versus controlled QA provenance;
- all remaining ownership/public/job decisions and corresponding domain status.

Statuses: `NOT_INSTRUMENTED`, `NOT_COLLECTED`, `PARTIAL`, `HOLD_NO_TRAFFIC`, `HOLD_LEGACY_USAGE`, `HOLD_DOMAIN`, or `PASS_MEASURED`. Missing count/window is null, never zero. Current result is NOT_INSTRUMENTED with null authoritative counts/window.

## Removal and rollback are separate from observation

Only after PASS_MEASURED prepare a minimal auth removal patch and new exact manifest, retaining compatible response serialization and platform technical authority as needed. Prove no legacy grants with the fallback disabled in actual PostgreSQL/browser scenarios for every business, plus internal/provider/job paths. Preserve deliberate context errors rather than silently choosing Park.

Use a fresh exact production authorization for the auth removal, candidate-specific CI and the repository Railway helper. Verify exact live metadata and repeat safe live role/access QA. Retain forward rollback evidence; do not reactivate legacy authority or deploy an old SHA blindly.

Deprecated database columns require a **separate approved cleanup migration**, after demonstrated zero read/write dependency by all supported clients/jobs. No table/column drop, ledger edit or historical-owner reassignment is part of compatibility code removal.
