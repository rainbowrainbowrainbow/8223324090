# Customer duplicate reference preview

Customer merging remains disabled. This change adds an explicit, read-only inspection of a candidate pair, not a merge executor.

## Why merge remains disabled

The customer graph includes more than bookings and children. It contains lead links, conversations, reviews, tags, support/banquet records, certificates, discounts, deposits, graduation quotes, retention logs, typed task/Hermes references, and trusted QA identifiers. Some references have no foreign key, and some contain protected financial history.

Checking a snapshot and then deleting a duplicate does not protect a concurrent writer that stores a text customer ID. Consequently a successful preview must never authorize a merge. The existing POST merge guard still returns CUSTOMER_MERGE_DISABLED before acquiring a DB client.

## Read contract

GET /api/customers/:primaryId/merge-preview?duplicateId=<id>&businessContext=<context>

The endpoint uses the existing manager minimum-role policy and requires a single authorized business. It does not change permissions. Both customers must exist in that business. Invalid pairs return 400, missing/cross-business pairs return 404, incompatible relation schemas return 409, and unexpected database failures return 500. Responses use Cache-Control: no-store.

The service owns one short REPEATABLE READ READ ONLY transaction, with a 10-second statement timeout and a 2-second lock timeout. It releases the connection after success or rollback. PostgreSQL rejects writes in this transaction. No customer, tag, child, task, review, communication journal, or financial record is changed.

The public preview always includes canMerge=false and changesPerformed=false. reviewPassed only describes conflicts found in this snapshot. It is not a safety guarantee or a future merge token. Counts describe stored records belonging to the second card, including historical/superseded child records. Protected financial/QA references produce generic reasons without exposing amounts, private profile fields, or table identifiers.

## Conflict detection

- Different primary contacts, incompatible social identities, unsupported nonempty customer fields.
- Financial or trusted QA history on the second customer.
- Retention/task/Hermes links without a verified customer foreign key.
- Unknown customer foreign keys, stored customer_id references, or typed source_entity references.
- Direct references in another business or linked leads/bookings that are missing or in another business.
- Overlapping lead links, child identities/source uniqueness, repeated tags, legacy-only child fields, or a combined child record count above 50.

An unknown stored relation is conservatively reported even if no row for the pair was counted. Arbitrary historical JSON, URLs, or custom column conventions are not exhaustively understood. Therefore the tool does not claim that its graph inventory is complete.

The UI fetches this inspection only after an explicit click, never once per result row. It preserves disabled merge, card navigation, keyboard focus, and explicit retry/error states. Reloading the duplicate list aborts pending inspections; a changed business cannot display a stale successful result. All server labels/reasons are escaped.

## Verification

- Unit and HTTP/UI regression: node --test tests/customer-duplicate-guard.test.js tests/customer-merge-preview.test.js
- Disposable PostgreSQL regression is included in the existing omni-links isolated runner/CI job.
- The PostgreSQL test requires CUSTOMER_MERGE_TEST_DATABASE_URL and the repository disposable-target confirmation. It creates a randomly named fixture database, verifies every stored row remains unchanged, and drops only that exact database in teardown. There is no production DATABASE_URL fallback.
- Browser evidence is recorded separately using synthetic fixtures and actual duplicate UI/CSS at desktop/mobile widths. It is not live production QA.

## Follow-up before a merge executor

1. Agree on a durable canonical customer/retired-ID policy that preserves text references and old links without hard-deleting an ID that can still be written concurrently.
2. Inventory and update each in-scope writer/reader to follow that policy; schema changes require their own authorization.
3. Specify child/tag/lead overlap resolution and immutable provenance before changing records. Do not silently discard conflicting data.
4. Keep financial/history-bearing pairs blocked until those protected rules are separately approved.
5. Prove transfer, concurrent writes, stale previews, rollback, business isolation, and audit behavior on disposable PostgreSQL before unlocking UI/API.

This follow-up is not required to launch sales: duplicate lookup, opening both cards, and the original safety guard remain usable.

## Customer page permission bootstrap

The customer page waits for the existing hydrateActionPermissions helper before deciding RFM and revenue visibility. The server permission catalog stays authoritative, including explicit denies. A permission fetch failure stops customer data initialization and uses the existing recovery overlay with a full-page retry. No roles, overrides, sessions, or permission policy are changed.

This fixes the reproduced case where the live permission API allowed view_revenue but the customer page never loaded its catalog, leaving RFM hidden. Customer section navigation tests cover deferred allow, deny, and failed bootstrap.
