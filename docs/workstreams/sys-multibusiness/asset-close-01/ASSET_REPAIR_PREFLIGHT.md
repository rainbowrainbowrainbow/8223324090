# SYS-MB-ASSET-CLOSE-01 — asset repair preflight

Status: `READY_FOR_OWNER_DECISION`

Generated: `2026-09-22T18:36:32Z`

## Fixed identities

- Live site: `https://8223324090-production.up.railway.app`
- Live release: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`
- Live version: `0.82.11`
- Live label: `Tasker + My Day UX`
- Live branch: `codex/eventgenix-production`
- Production branch at worktree creation: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`
- Railway: `fortunate-appreciation / production / 8223324090`
- Railway deployment: `5d8df6f9-6a95-4490-9f66-e9dbc10c6d22`
- Accepted SYS-MB ancestor: `9822db02e748b451ec0a937071057a8aac802cac / 0.82.10`
- Catalog cutover receipt: `d2fb93fc3cdc7521e8544b3db288441af8f8aa77f5b45c6be40556ad9f20ffd6`
- Read-only transaction: `REPEATABLE READ READ ONLY`

The worktree base equals the current live and production-branch SHA. The accepted SYS-MB release remains in its ancestry. No reset, overwrite, push, Railway change or production write was performed.

## Exact broken fields

| Catalog | Catalog ID | Page | Field | Page version | Current value SHA-256 | HTTP | Owner |
|---|---|---:|---|---:|---|---:|---|
| `122112` | `122112` | 0 | `image_url` | 4 | `ee0a9bb1090ead02003d8da95b56cdf77ab6ef1317a6fd3b92a88e39c8f15c75` | 404 | `event_genix` |
| `122112` | `122112` | 1 | `image_url` | 2 | `9d01f68ae8e82d1c9c92889de496c44de89a83fe649b909f42142ec34b02f8c5` | 404 | `event_genix` |
| `122112` | `122112` | 2 | `image_url` | 2 | `acf98269eaa9af16ca588faaaecc401b34862cbbb68a27c31e9e99b2992a6c00` | 404 | `event_genix` |
| `Торти` | `cake` | 0 | `image_url` | 5 | `9603b813b7a0d4eca008effc6a1faa0b7fb9f79fc7a11f2d10e72184a6517a49` | 404 | `event_genix` |

All four pages have no configured `background_url`, so there is no same-page durable fallback to promote.

## Consumer and replacement inventory

Each broken value has exactly one current consumer in `catalog_pages.image_url`. The three `122112` values each also occur once in `catalog_page_history.image_url`; the Cakes value occurs twice in page history. No exact value occurs in:

- `catalog_items.image_url`;
- `catalog_definitions.cover_image_url`;
- `products.icon_url`;
- `catalog_image_blobs.source_url` or blob metadata;
- catalog page/details/history JSON fields.

Application consumers are:

- authenticated catalog preview through `GET /api/catalogs/:catalogId/pages` and `js/designs-page.js`;
- public catalog HTML through `GET /catalog/:slug/:token` in `server.js`;
- browser image fetches emitted by those renderers.

Replacement search results:

- `122112` pages 0/1/2: no historical alternative, no exact CRM blob, no local retained filename under EventGenix uploads or Downloads, and no Git object with the exact filename.
- Cakes page 0: one older same-page URL exists but also returns 404. Nine healthy internal cake-image blobs were found by contextual search, but all are `legacy_unassigned`, lack page identity metadata and already have source or item consumers. They are not valid replacements without a separate asset ownership/content decision.
- No replacement was selected by filename, title, catalog proximity or visual guess.

The attempted external archive lookup was rejected by managed approval review because it would send exact production-derived asset URLs to an unrelated third party. It was not retried or bypassed. The result is not needed for the safe decision below.

## Current public viewers

Private read-only verification passed without exposing tokens:

| Catalog | HTTP | Rendered pages | State |
|---|---:|---:|---|
| `122112` | 200 | 3 | inactive draft, existing public token |
| `Торти` | 200 | 1 | active draft, existing public token |
| `Випускний` | 200 | 8 | active ready, existing public token |

All three remain `event_genix / approved / public_existing_token`. No token was generated, rotated, logged or persisted in Git.

## Final production preflight refresh

At `2026-09-22T18:59:57Z`, the current live deployment and production branch both resolved to `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79 / 0.82.11`. A fresh dedicated read-only query confirmed:

- all nine reviewed roots remain `event_genix / approved`;
- exactly three public tokens remain present and all three hashes match the Task 1 private baseline;
- all four page IDs, versions, owners and current-value hashes match the repair mapping;
- all four pages still have no `background_url` fallback.

Direct receipt refresh is `HOLD_RECEIPT_READ_PERMISSION`: the dedicated read-only role receives PostgreSQL `42501` on `catalog_ownership_cutover_journal`. The failed read was isolated with a savepoint; the remaining checks completed in the same read-only transaction. No writable credential was used as a fallback. The production block must therefore allow a bounded SELECT lease for this one journal table, followed by mandatory revoke within 30 minutes, before any page mutation.

## Decision packet

No content-identical durable asset is proven. The recommended bounded repair for all four fields is:

`image_url: <broken value> -> null`

This uses the existing no-image rendering fallback and removes four failed network requests without borrowing unowned/shared content. Consequences:

1. `122112` keeps all three pages and text but has no page imagery.
2. Cakes keeps its single page and text but has no cover imagery.
3. Catalog status, active/inactive state, public visibility, prices and tokens remain unchanged.
4. A later content-owner upload can replace `null` through a separate reviewed action.
5. Observation can start only after the null repair, private viewer QA, network verification and zero-fixture proof pass.

This recommendation is not yet a production authorization. A replacement upload is an alternative only after four reviewed files have exact content hashes, MIME types, ownership and consumer evidence.

## Mutation path

The deployed route is `PUT /api/catalogs/:catalogId/pages/:pageNumber`, scoped through authenticated Park catalog membership and role/action guards. It records page history and increments page version. The deployed history/version writes are asynchronous, so the operator controller:

- checks exact catalog/page/business/current-value/version predicates immediately before mutation;
- sends only `{ "image_url": null }` for the four listed pages;
- polls page version and verifies page history;
- stops on drift;
- attempts exact forward rollback of already changed targets on partial failure.

The route has no atomic four-page batch or HTTP conditional update. The block therefore prohibits concurrent catalog editing during the bounded apply and treats any predicate/version drift as a stop, not as permission to overwrite.
