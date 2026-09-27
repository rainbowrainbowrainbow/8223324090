# SYS-MB-CLOSE-03 — telemetry read access and initial collector

Status: `ACCESS_PASS / OBSERVATION_HOLD`

Owner approval: `SYS-MB-CLOSE-03-TELEMETRY-READ-20260922`, referring to the exact scope in [NEXT_OBSERVATION_BLOCK.md](NEXT_OBSERVATION_BLOCK.md).

## Privilege operation

- Production PostgreSQL target hash: `6fb86cf6959f026d7c55b6c65edffc3499e5bb581d51840a730f915fef0e9cfd`.
- Dedicated read-only role hash: `940efc5d4989b4cdd1d23b40678c2fec953499bd4b3d6ecb2856374d8719d857`.
- Pre-grant ACL fingerprint: `2643bd724c681e603cd523892b20188fca014456c89693d7059091fbc655925c`.
- Grant committed at `2026-09-22T19:32:49.318Z` for exactly 15 SELECT columns in `business_compatibility_telemetry_v2_hourly` and `business_compatibility_telemetry_runtime`.
- Fresh read-only verification confirmed the exact column set, no additional readable columns, no table-level SELECT and no write privileges. The full grant receipt and initial collector report remain outside Git in `C:\Users\Plotva\.eventgenix\sys-mb-asset-close-01-20260922`.
- The grant remains active solely for the measured exit-gate reads. It does **not** expire automatically. The already approved exact forward revoke is `node .codex-temp/sys-mb-asset-close-01/telemetry-read-grant.cjs retire` with the block guard and private receipt; it fails closed on ACL drift. Review/revoke when the gate is completed or the observation is abandoned.

## Actual read-only collector

The actual `scripts/sys-mb-compatibility-telemetry-report.cjs` collection function ran through the dedicated read-only role at `2026-09-22T19:32:50.320Z`. It returned `HOLD`, as expected before a valid observation start:

- current live SHA `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79` has durable hourly HTTP/admission rows for CRM and Maysternya;
- current-SHA runtime reconciliation: eligible `1336`, persisted `1336`, failed `0`, last seen `2026-09-22T19:29:19.059Z`;
- the initial lookback reconciled eligible/collected counts for observed families and reported zero known gap rows; no legacy/missing/unknown allowed authority appeared in that limited slice;
- the slice covers only one UTC traffic day, includes controlled QA traffic and is **not** an observation-window count of real operations;
- ten required context/entry-family pairs have no observed activity in the slice; `service` domain allowance is not established for either business;
- `startUtc` and longest enabled cycle remain unknown. Therefore no duration, 5-day traffic, full coverage or zero-usage claim is made.

The collector's complete initial aggregate report is private. No person-level data, credentials, tokens, mapping payload or raw operational record was copied into Git.

## Remaining gate

`OBSERVATION_START.md` stays unset until safe live QA is complete for the required roles and same-JWT revoke, the longest enabled cycle is bounded, and the collector's entry-family coverage and denominators are understood. The exact SELECT approval did not authorize user/membership mutations, new QA fixtures, deploy or removal of legacy operational authorization.
