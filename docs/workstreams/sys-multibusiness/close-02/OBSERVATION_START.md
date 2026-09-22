# SYS-MB-CLOSE-03 — observation start

## Role QA update — 2026-09-22 19:57 UTC

The approved manager/admin/animator membership lifecycle and same-JWT revoke passed for the registered smoke QA account in Maysternya and CRM; cleanup left zero active temporary grants. This supersedes the role/revoke `NOT_TESTABLE` note below. Browser role sessions in two organizations, independent worker sessions, the longest enabled cycle and full measured entry-family/real-traffic coverage remain unproven; the broad browser check also needs scoped interpretation of expected containment and cross-tab route convergence. `startUtc` is still **null** and role QA traffic must not count toward real operations. See [ROLE_QA_REPORT.md](../asset-close-01/ROLE_QA_REPORT.md).

The dedicated read-only collector was rerun at `2026-09-22T20:07:30.739Z`: `HOLD`, 10 required context/family pairs unobserved, only one UTC traffic day, no allowed service-domain event established, runtime reconciled with zero known gap. Admission counts include synthetic QA and do not satisfy real-traffic thresholds. Private report SHA-256: `bc564b7659af73815d7cd5dc02c22375bc2bdd4e1d3a4547a8d23095d80a0940`.

Status: `NOT_STARTED_LIVE_QA_CYCLE_COVERAGE_HOLD`

## Telemetry access update — 2026-09-22 19:32 UTC

The exact column-level telemetry SELECT block was approved and applied. The dedicated read-only role now runs the durable collector; exact current-SHA runtime counts reconciled without known loss. This supersedes the earlier `42501` blocker below. Observation `startUtc` remains null: separate manager/admin/worker and same-JWT revoke live QA are unproven, the longest enabled cycle is not bounded, and ten required context/entry-family pairs are not observed in the initial one-day lookback. That lookback includes controlled QA and cannot be counted as the required real traffic. See [TELEMETRY_READ_GRANT_REPORT.md](../asset-close-01/TELEMETRY_READ_GRANT_REPORT.md). `PASS_MEASURED=false`; `GLOBAL_MODEL_COMPLETE=false`.

## Pre-grant state after the 2026-09-22 asset block (historical)

The four public catalog image 404 references are repaired and browser-verified. `startUtc` remains unset because the dedicated read-only role cannot read `business_compatibility_telemetry_v2_hourly` or `business_compatibility_telemetry_runtime` (PostgreSQL `42501`). Complete eligible/collected/excluded reconciliation, enabled-cycle duration and real traffic coverage cannot be measured from the present access. Broad-navigation booking 403s were classified as correct CRM timeline denials; the sidebar makes unnecessary CRM requests, but no Maysternya required-domain failure was proven. Separate manager/admin/worker and same-JWT revoke live QA remain NOT_TESTABLE without approved existing sessions/fixtures. The task's rule forbids starting observation with any required HOLD.

The current live SHA is `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79 / v0.82.11`. The existing monitor must read the current [ASSET_CLOSE_02_REPORT.md](../asset-close-01/ASSET_CLOSE_02_REPORT.md) and must not count time from this repair or from the monitor heartbeat. `PASS_MEASURED=false`; `GLOBAL_MODEL_COMPLETE=false`.

The historical pre-repair note below records why observation was previously blocked.

`startUtc` remains unset.

The functional hotfix is live at `9822db02e748b451ec0a937071057a8aac802cac`, owner repair and both business cutovers are durable, the exact nine-catalog ownership apply has receipt `d2fb93fc3cdc7521e8544b3db288441af8f8aa77f5b45c6be40556ad9f20ffd6`, and zero new QA fixtures were found.

The measured compatibility window must not start yet because required live asset acceptance is not complete:

- three configured page images in public catalog `122112` return HTTP 404;
- one configured page image in public catalog `Торти` returns HTTP 404.

The three viewers and tokens remain valid and were not rotated. Observation may start only after a separately authorized, reviewed asset repair passes public-viewer QA and the durable telemetry collector is shown to receive and reconcile real production traffic.

`PASS_MEASURED=false`

`GLOBAL_MODEL_COMPLETE=false`

The existing `sys-mb-recover-04-exit-gate-monitor` automation was updated to this worktree and blocker. No duplicate monitor was created.
