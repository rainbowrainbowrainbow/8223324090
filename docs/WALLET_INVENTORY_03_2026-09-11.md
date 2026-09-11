# WALLET-INVENTORY-03 — release compatibility

This supersedes the day-seven blocker in `WALLET_HARDEN_02_2026-09-11.md` after successful verification of both supported schemas. Production impact: yes when released. No production data, schema, settings, auth or reward amounts were changed during implementation.

## Root cause and confirmed contracts

A read-only production catalog inspection found that migration-only tests did not represent the live Wallet schema:

| Contract | Fresh migrations | Verified live schema |
|---|---|---|
| Ledger owner | `user_id` and required `username` | `user_id`; no `username` column |
| Inventory owner | `username` | `user_id`, optional `username` |
| Inventory item FK | `character_items.id` | `shop_items.id` |
| Repeated item | Unique `(username,item_id)` | Increment `quantity` for `(user_id,item_id)` |
| Acquisition source | `acquired_via` | `obtained_from` |
| Catalog availability | `is_active` | `is_available` |

The previous four unconditional ledger `username` INSERTs would fail on production. The previous day-seven query failed on a fresh migrated database. Both failures were reproduced with real HTTP/auth/Express/PostgreSQL using synthetic accounts, before changing the writer. The first test draft also exposed a parameter-type conflict in its UTC fixture SQL; that fixture was explicitly cast and is not counted as a product defect.

## Implementation

- `routes/wallet.js` follows the nearby shop route's cached schema-column detection pattern. Catalog queries are read-only, identifiers are fixed, and user values remain parameterized.
- All four Wallet ledger writes share one transaction-local writer. It includes canonical username only when the column exists.
- Production inventory retains its shop ID, quantity and availability behavior. Where supported, username is populated from the authoritative user ID.
- Migration inventory uses the explicit `shop_items.item_id` mapping and the existing achievement writer's unique ownership rule. An already-owned item does not create a second inventory row or claim a newly awarded item in the response.
- Day-seven coins and inventory remain in one short transaction. Reward amounts and the UTC calendar remain unchanged.
- No migrations, dependencies, API fields, global parsers, auth or shared navigation were changed.

## Verification

`node tests/integration/wallet-ledger.integration.test.js --isolated` now runs both `migrated` and `deployed` schema variants. The latter reconstructs only the verified live column/FK contracts inside the runner-owned disposable database; it never copies production rows. Every variant starts a fresh app and database schema.

Both variants pass **34 Node tests (33 subtests plus parent), zero failures/skips** locally under Europe/Kiev. The existing CI command runs both variants under UTC and America/Los_Angeles. Exact release-SHA results belong in the release evidence, not this historical implementation report.

New successful scenarios cover concurrent day-seven claims, correct distinct shop/character IDs, day 6→7→8, repeated items according to each inventory model, unavailable/non-equippable catalog, and full rollback on inventory INSERT failure. All previous ledger ownership, first-wallet concurrency, input, transfer, date and rollback cases remain enabled. The old expected-500 day-seven characterization was replaced by successful product assertions.

Evidence: `output/hr-checklists-residuals/wallet-live-schema.json` (catalog metadata only), `wallet-inventory-baseline.log`, `wallet-inventory-fixed.log`, and `output/wallet-ledger/results-{migrated,deployed}-Europe_Kiev.json`.

## Release boundaries and remaining work

The live preflight initially reported v0.81.108 / `c59c4b18ad5418ff36396aeba7e0105defabca83`. The remote production branch already contained five later commits, including cashier/payment changes and HR payroll tab polish. Revalidate live SHA and ownership of those pending changes before promoting an integrated candidate; this Wallet task does not authorize unrelated Red changes.

The shared main checkout is dirty and remains untouched. Merge conflicts must preserve current upstream changes. Runtime/version/cache consistency, exact-SHA CI, Railway identity and read-only live QA remain release gates. There are no task-owned migrations to apply.

Remaining review items from WALLET-RESILIENCE-04 and native HR QA still apply. No claim is made that all CRM technical debt has been removed. Recommended follow-up to the test strategy: any schema-sensitive route release should compare read-only deployed catalog metadata with its disposable fixture contracts before treating migration-only integration tests as production evidence.
