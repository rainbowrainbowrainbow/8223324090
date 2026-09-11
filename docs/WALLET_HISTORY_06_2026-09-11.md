# WALLET-HISTORY-06 — pagination hardening

Status: implemented and verified locally. No production action in this block.

## Baseline and bug report

Clean isolated branch `codex/hr-checklists-residuals-20260911`, starting SHA `9249a3179e8ea603d308c2df0a6343d9ce69fd1c`. A read-only remote check returned the same production SHA. Shared checkout changes were not touched.

The actual implementation is GET `/api/wallet/history` in `routes/wallet.js`. It used `parseInt(...) || default`, calculated OFFSET without a safe-integer check, and ordered only by `created_at DESC`. Existing Wallet API tests checked the response shape but did not cover page boundaries or malformed parameters. No direct Wallet history frontend consumer was found in the searched `js/` files; API clients remain the compatibility boundary.

Expected: bounded positive pagination, the existing JSON response, owner-scoped rows, and a deterministic order within equal timestamps. Actual baseline: negative page/limit and a 400-digit page caused 500 responses; unsafe page/offset arithmetic was accepted; tied timestamps did not follow a stable secondary key across pages. The initial test draft also expected repeated query parameters to fall back to defaults. That expectation was revised to preserve the existing first-value behavior, not counted as a product defect.

Reproduction uses the existing isolated runner, actual HTTP/auth/Express/PostgreSQL, synthetic accounts, 61 owner ledger rows with tied timestamps, and a separate account's rows. Both migrated and deployed-shaped schemas reproduced the issues before the route edit. Evidence: `output/hr-checklists-residuals/wallet-history-before.log`.

## Implementation and compatibility

- A local parser preserves numeric-prefix/decimal `parseInt` behavior and the first repeated query value. Query objects are not coerced, including objects that shadow `toString`.
- Nonpositive/unparseable limit uses the existing default 20; positive limits retain the cap of 50.
- Nonpositive, unparseable, unsafe page, or a page producing an unsafe OFFSET uses the existing default page 1. A very large but exactly representable page with limit 1 remains valid and returns an empty page when past the end.
- Ordering is now `created_at DESC, id DESC`. Existing primary date order and null ordering are unchanged; ID defines only the order among ties.
- Response keys and item fields, count semantics, ownership filter, parameterized SQL, and history read-only behavior are unchanged. No new status codes or public fields.
- No schema, indexes, migrations, dependency, auth, global query parser, frontend, or business-rule changes. The package and release version are unchanged.

The existing OFFSET contract is retained. Cursor pagination may help deep histories but is a separate API decision, not part of this compatibility fix.

## Verification

Runtime: Node 22.23.1 / npm 10.9.8; disposable loopback PostgreSQL 16.15. All started clusters stopped successfully. Production rows and credentials were not copied into fixtures.

| Target | Result |
| --- | --- |
| Migrated schema, UTC | 65/65 Node tests PASS |
| Deployed-shaped schema, UTC | 66/66 Node tests PASS |
| Migrated schema, America/Los_Angeles | 65/65 Node tests PASS |
| Deployed-shaped schema, America/Los_Angeles | 66/66 Node tests PASS |
| Existing Wallet connection-handler regression | 8/8 PASS |
| Runtime, API surface, version consistency | PASS |
| Parser checks for both changed JavaScript files, `git diff --check` | PASS |

The 262 PostgreSQL Node tests comprise 258 scenario subtests and four parents. Each variant includes 22 new history scenarios: defaults, ordinary pages, negatives, zero, invalid strings, huge page/limit, unsafe arithmetic, maximum safe offset boundary, clamped limits, legacy parsing, structured/repeated parameters, shadowed coercion, last/empty pages, owner override rejection, tied timestamps across two complete passes, and no wallet/starter-bonus creation on reads. All previous starter, daily, transfer, rollback, date and inventory tests remain enabled. No skips.

Commands: `node tests/integration/wallet-ledger.integration.test.js --isolated` with `PGOPTIONS='-c timezone=UTC'` and `PGOPTIONS='-c timezone=America/Los_Angeles'`, through the existing disposable cluster launcher; `node tests/wallet-resilience.test.js`; `npm run check:runtime`; `npm run check:api-surface`; `npm run check:version`; `node --check` on changed files; `git diff --check`.

Logs: `output/hr-checklists-residuals/wallet-history-{utc,la,handler-regression,api-guard,version}.log`. Per-variant JSON: `output/wallet-ledger/results-{migrated,deployed}-{UTC,America_Los_Angeles}.json`. The existing CI Wallet step already executes this expanded test file; no workflow change is needed.

Full `npm test`, CI, deployment and live browser QA were not rerun for this local block. No screenshots were created because there is no UI change. The earlier v0.81.113 release remains separate evidence, not deployment proof for this diff.

## Remaining risks and delivery

- OFFSET pages may shift when another request inserts/removes transactions between page reads. The two parallel data/count SELECTs also do not share a snapshot. This change guarantees tie ordering for a stable dataset, not a frozen history across requests. A stronger snapshot/cursor contract requires a separate design and authorization.
- Deep OFFSET and count queries still scan data; this fixture is not a production-scale benchmark. Review actual query plans and volume before proposing an index or API migration. No arbitrary new maximum page is introduced.
- Historical timezone provenance remains BLOCKED under WALLET-TIMEZONE-05. This fix does not reinterpret timestamps.
- Prior native Safari/iOS/accessibility QA and scheduler timing-test follow-ups remain outside this block.
- Before release, revalidate current production SHA, review any concurrent changes, prepare separate version/cache notes, require exact-SHA CI, deploy through the authorized helper, and read history with a test account without creating Wallet records or making claims/transfers.

Recommended next action: deliver this bounded history fix through the release workflow after a production-release authorization. Do not treat completion of the prior v0.81.113 envelope as a fresh authorization for this diff.
