# SYS-MB-CLOSE-02 — live QA report

## 2026-09-22 role lifecycle addendum

The later exact block `SYS-MB-CLOSE-03-LIVE-ROLE-QA-20260922` passed six Maysternya/CRM manager/admin/animator role transitions and two same-JWT revocations using the existing smoke account. Fresh read-back shows no active QA membership in either target and unchanged Park default. See [ROLE_QA_REPORT.md](../asset-close-01/ROLE_QA_REPORT.md). The earlier role/revoke `NOT_TESTABLE` rows below are historical. The broad browser diagnostic returned a formal FAIL from expected containment 403s and navigational aborts; required Maysternya page shells and Park-only denial passed, while cross-tab route convergence remains inconclusive. Full SYS-MB acceptance remains HOLD.

Status: `ASSET_PASS / SYS_MB_ACCEPTANCE_HOLD`

## 2026-09-22 asset repair addendum

The four prior image 404 references were set to `null` through the approved catalog lifecycle API. Their deployed no-image fallback now renders without requesting the old URLs. Existing public viewers returned HTTP 200 with exact counts: `122112` 3, `Торти` 1, `Випускний` 8. Headless Chrome passed 18/18 combinations across light/dark and 390/768/1440, including reload, back/forward, horizontal overflow, broken images, old requests, image HTTP failures and catalog console errors. Safe screenshots and sanitized machine results are in ignored `.codex-temp/sys-mb-asset-close-01/`.

Maysternya timeline switching and the Park-only smoke denial still passed. All tested creator page shells rendered. The broad-navigation booking 403s were classified as requests with `businessContext=crm`, which has no timeline module; the server denied them correctly. The shared sidebar still emits those unnecessary requests after a CRM cross-tab switch, a separate P2 UI/network-noise candidate in `js/components/sidebar.js`. Repeated `GET /api/chat/unread` 403 remains expected Hermes containment. Separate manager/admin/worker sessions and live same-JWT revoke remain NOT_TESTABLE with the currently approved accounts. See [ASSET_CLOSE_02_REPORT.md](../asset-close-01/ASSET_CLOSE_02_REPORT.md).

The `FAIL / required HOLD` section below is the pre-repair finding retained for audit history; its four 404s are resolved by this addendum. The current HOLD concerns full SYS-MB acceptance and telemetry access, not catalog images.

Target: https://8223324090-production.up.railway.app

Published release at acceptance: `9822db02e748b451ec0a937071057a8aac802cac`, `codex/eventgenix-production`, `v0.82.10 — SYS-MB: каталог і timeline після cutover`.

## PASS

| Scenario | Evidence |
|---|---|
| Exact live identity | `/api/version`, helper smoke and standalone version smoke agree on SHA, branch, version and label. |
| Owner and business profile | One active owner organization; Park, Dar, Maysternya and CRM are visible and switchable for the reviewed creator/owner account. |
| Smoke-account isolation | One organization, Park only; direct Maysternya navigation is denied. |
| Maysternya hotfix | Sidebar link `/maysternya-doli?timelineView=animators` opens `/maysternya-doli`, retains `maysternya_doli`, and keeps the app visible. |
| Required page shells | Maysternya timeline, programs, tasks, customers, leads, finance and Omni routes render at 390/768/1440. |
| Responsive/theme/keyboard | Light and dark at 390/768/1440 have no horizontal overflow, retain keyboard focus and expose all tested controls. |
| Cross-tab/history | A second CRM-context tab opens with all four business options; back/reload retain the Maysternya route and context. |
| Required-domain network | No required Maysternya domain API returned 4xx/5xx in the focused network pass. `/api/chat/unread` returns 403 as the approved Hermes containment. |
| Catalog ownership | Guarded atomic apply assigned all 9 reviewed roots and declared children to `event_genix`; receipt `d2fb93fc3cdc7521e8544b3db288441af8f8aa77f5b45c6be40556ad9f20ffd6`. |
| Catalog status/filter | 5 catalogs are active and returned by the active definitions API; 4 remain inactive drafts. Absence from that API is the expected `is_active=true` filter, not a missing root. |
| Public viewer identity | Existing links return the correct catalogs and page counts: `122112` 3, `Торти` 1, `Випускний` 8. No token was printed, rotated or republished. |
| Side effects | Browser guards executed no business mutation. The optional wallet daily-login POST was blocked in diagnostic sessions. No sends, payments or generation ran. |

## FAIL / required HOLD

### PARK-CATALOG-ASSET-01 — four existing public catalog images return 404

- URLs: the three existing public catalog viewers; private tokens are intentionally omitted.
- Steps: open the existing public viewer, enumerate its authenticated catalog pages, and request each configured page image/background asset read-only.
- Expected: every configured asset returns a successful HTTP response.
- Actual:
  - `122112`, inactive draft: page images 0, 1 and 2 return HTTP 404 from the existing temporary external asset host;
  - `Торти`, active draft: page 0 image returns HTTP 404 from the live asset path;
  - `Випускний`: 8/8 pages render and no configured asset check fails.
- Evidence: sanitized read-only HTTP/DB verification at `2026-09-22T17:44:45Z`; public viewers themselves returned 200 with exact page counts.
- Severity: `P1` for final catalog acceptance; it does not invalidate ownership or the existing token identity.
- Candidate areas: catalog page asset data and the approved asset upload/storage workflow. No code file is proven defective by this check.
- Repair boundary: upload or select reviewed durable assets, then perform a receipt-bound update of only the four affected page asset fields. Shared assets require consumer verification. Current authorization does not permit this production content mutation.

## PASS with expected containment

- Focused Maysternya browser emitted three 403 resource messages, all mapped to repeated `GET /api/chat/unread` calls during navigation.
- Hermes was explicitly denied new MD/CRM rights, so this is expected containment rather than a required-domain failure.

## NOT_TESTABLE / residual HOLD

- Fresh direct SELECT of CRM/Maysternya journal receipts remains `PERMISSION_DENIED` for the read-only role. CRM was not replayed, and writable credentials were not used as a hidden read-only fallback.
- Separate manager/admin/worker browser sessions remain `NOT_TESTABLE`: no approved existing credentials were available and no users or grants were created to manufacture a PASS.
- same-JWT revoke remains `NOT_TESTABLE` live because no pre-transition session was retained and the QA block prohibited a new membership mutation.
- Late-response behavior retains local/CI evidence; a production race was not manufactured with data mutation.
- Observation remains `NOT_STARTED` while `PARK-CATALOG-ASSET-01` is open.

No credentials, public tokens, private mapping payloads, person-level data or production record IDs are included in this report.
