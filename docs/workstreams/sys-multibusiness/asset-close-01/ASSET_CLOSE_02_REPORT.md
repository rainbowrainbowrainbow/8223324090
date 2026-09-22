# SYS-MB-ASSET-CLOSE-02 — production repair result

Status: `ASSET_REPAIR_PASS / OBSERVATION_HOLD`

Update: the previously missing telemetry SELECT was separately approved and granted at `2026-09-22T19:32:49Z`. The collector now runs through the read-only role; observation remains HOLD for live role/revoke QA, cycle bounds and entry-family coverage. See [TELEMETRY_READ_GRANT_REPORT.md](TELEMETRY_READ_GRANT_REPORT.md). The access blocker listed below is retained as historical pre-grant evidence.

Date: 2026-09-22 UTC. Approved block: `SYS-MB-ASSET-CLOSE-02-20260922`.

## Exact live target

- Site: https://8223324090-production.up.railway.app
- Live `/api/version`: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`, branch `codex/eventgenix-production`, `v0.82.11 — Tasker + My Day UX`.
- Remote production branch: the same SHA at the final read-only check.
- Railway: `fortunate-appreciation / production / service 8223324090`.
- No code commit, push, migration or deploy was needed or performed for this data repair.

## Protected preflight and mutation

- The existing catalog ownership receipt matched `d2fb93fc3cdc7521e8544b3db288441af8f8aa77f5b45c6be40556ad9f20ffd6` through a dedicated read-only connection.
- A column-scoped SELECT lease on `catalog_ownership_cutover_journal` was granted and revoked within **0.431 seconds**. Read-back confirmed no SELECT privilege remained. The private/local lease receipt is in the ignored `.codex-temp/sys-mb-asset-close-01/` directory.
- The approved private mapping hash is `4040295a1fdc2cc7067ce8f9299c7b6cd6270c38d1633d19d8ddbe7de927844b`; source fingerprint is `eb8d1cf62ed2af95a35b8c9025d0604352016b0ba5b46b511fb8e8d1c2085f1d`.
- One apply attempt used the deployed `PUT /api/catalogs/:catalogId/pages/:pageNumber` API. It set only `image_url=null` for `122112` pages 0/1/2 and `cake` page 0. No replacement asset was assumed or uploaded.
- Verification observed page versions `4→5`, `2→3`, `2→3`, `5→6` and corresponding history entries. Post-apply read-only PostgreSQL inspection confirmed the four exact page identities, `null` image values and unchanged `background_url` fields.
- All nine roots remained `event_genix / approved`; statuses and active flags remained unchanged. The three existing public token hashes and visibility values were unchanged.
- Forward rollback remains the exact four-field lifecycle operation described in `ASSET_REPAIR_ROLLBACK.md`; it was not needed.

## Live catalog QA

- Existing viewers `122112`, `Торти`, `Випускний` returned HTTP 200 with 3/1/8 pages respectively.
- Headless Chrome checked all three viewers at 390/768/1440 in light and dark modes: 18/18 combinations passed. No horizontal overflow, broken image, old asset URL request, image HTTP failure or catalog console error occurred. Reload and back/forward retained the exact page counts.
- The `null` values render the deployed no-image fallback. Three safe 390px screenshots are held only in the ignored `.codex-temp/sys-mb-asset-close-01/` directory, with no browser address bar or token in the image.
- Maysternya timeline remained open in its own context after the sidebar link. Creator had four business options; the existing smoke account remained denied direct Maysternya access. No business mutation was allowed by the browser guard.

## Residual acceptance gates

`OBSERVATION_START.md` remains `NOT_STARTED` because complete SYS-MB live acceptance and durable collector verification are not yet proven:

1. The dedicated production read-only role has no SELECT on `business_compatibility_telemetry_v2_hourly` or `business_compatibility_telemetry_runtime`; the collector returned PostgreSQL `42501`. A separate exact, column/table-scoped read-only access block is required. No writable credential was used as a fallback.
2. A focused network pass classified the booking 403s: every observed `GET /api/bookings/2026-09-22` denial had `businessContext=crm` and `X-Business-Context: crm`. CRM has no `timeline` module, so server denial is correct and no Maysternya booking failure was found. The shared sidebar still sends a timeline summary request after a CRM cross-tab switch; this is a separate P2 UI/network-noise candidate in `js/components/sidebar.js`, outside this exact asset block. Repeated `/api/chat/unread` 403 is expected Hermes containment; `net::ERR_ABORTED` fetches were navigation cancellations.
3. Separate manager/admin/worker live sessions and same-JWT revoke remain NOT_TESTABLE with the currently approved accounts and zero-new-fixture restriction. This does not turn fixture/local evidence into live PASS.
4. The longest enabled scheduler/retry cycle and complete entry-family denominators are not yet measured. `startUtc`, traffic counts and zero-usage remain unknown, not zero.

The sidebar follow-up has a concrete reproducer: on the live site, sign in with the reviewed creator account, open `/omni?businessContext=maysternya_doli`, then switch another tab to CRM. The shared sidebar requests `/api/bookings/<current-date>?businessContext=crm` and receives 403. Expected: when CRM has no timeline module, the sidebar skips its booking summary fetch. Actual: the server correctly denies it, but the browser records repeated 403 resource errors. Evidence: sanitized headless network result in ignored `.codex-temp/sys-mb-asset-close-01/app-network-focused-result.json`, all booking 403 requests carrying both CRM query and CRM header context. Severity: P2 network noise; candidate: `js/components/sidebar.js` around `_sidebarTimelineSummaryModeUrl` / `_fetchSidebarTimelineSummaryMode`. This was not changed under the four-field asset block.

No trusted QA run was created after the block start (read-only count: 0). No new catalog, token, asset, job, message, payment or generation was created by this task. The catalog repair itself is complete; the global compatibility exit gate remains HOLD.

The exact next read-only access request and its separate role-QA boundary are in [NEXT_OBSERVATION_BLOCK.md](NEXT_OBSERVATION_BLOCK.md). The existing `sys-mb-recover-04-exit-gate-monitor` was updated to this worktree and current blockers; no duplicate automation was created.
