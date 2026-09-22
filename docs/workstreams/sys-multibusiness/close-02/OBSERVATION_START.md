# SYS-MB-CLOSE-03 — observation start

Status: `NOT_STARTED`

`startUtc` remains unset.

Owner repair and the Maysternya mapping are applied, but the measured window cannot start until:

1. the catalog validator hotfix is deployed;
2. the exact nine-catalog guarded apply and public-link checks pass;
3. the Maysternya timeline route passes on the published hotfix;
4. remaining required live QA and zero-new-fixture reconciliation are accepted;
5. the durable telemetry collector is shown to receive and reconcile real production traffic.

The existing monitor remains the only monitor and must be updated to the final handoff when observation actually starts. Until then `PASS_MEASURED=false` and `GLOBAL_MODEL_COMPLETE=false`.
