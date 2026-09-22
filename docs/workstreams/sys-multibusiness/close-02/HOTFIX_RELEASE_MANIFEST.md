# SYS-MB-CLOSE-02 — hotfix release manifest

Status: `RELEASED_EXACT_SHA`

## Identity

- Previous live/base SHA: `a34ee622402776ba23efda393d37d11868640120`
- Authorized candidate SHA: `677c74277dbfde756aef8908d1fbf9cc6b4f8db6`
- Final release SHA: `9822db02e748b451ec0a937071057a8aac802cac`
- Production branch: `codex/eventgenix-production`
- Railway: `fortunate-appreciation / production / service 8223324090`
- Version/label: `v0.82.10 — SYS-MB: каталог і timeline після cutover`
- Migrations: none.
- CI: https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/35759994560
- Deployment: `d1bbbb30-2d12-43b2-ba18-57866deb1100`
- Production block: `EG-20260922T162051Z-677c7427` / `534d96fbaf89`.

## Released functional files

- `services/catalogOwnershipCutover.js`
- `js/timeline-context.js`
- `tests/catalog-ownership-cutover.test.js`
- `tests/timeline-context.test.js`

The remaining authorized changed paths are the CLOSE-02 evidence files. Canonical version/cache/changelog artifacts were produced by `npm run version:bump` and committed separately by the release controller.

## Protected apply evidence

- Catalog mapping hash: `0ce0adbf5b372c443a716eabab1869f910d5af3025fb5f2a88ff175d9d310fb0`.
- Prepare fingerprint: `c53dfe688540407f5670b392c19ba29b856a5bcf2e2202b68b455015d013a262`.
- Catalog receipt: `d2fb93fc3cdc7521e8544b3db288441af8f8aa77f5b45c6be40556ad9f20ffd6`.
- Roots/public links: 9/3; token rotation: 0.
- Owner repair and Maysternya receipts remain unchanged; CRM was not replayed.

## Acceptance boundary

Code, ownership, viewer identity, Maysternya navigation, role isolation available to the approved accounts, responsive layout, keyboard, history and cross-tab checks passed. Final acceptance is held by four existing 404 page assets in `122112` and `Торти`. Observation did not start.

## Rollback

- Code rollback reference: `a34ee622402776ba23efda393d37d11868640120`, deployed through the Railway helper only.
- No migration rollback is required.
- Owner/Maysternya/catalog durable state is not automatically reverted.
- Catalog repair must be receipt-bound; do not use broad SQL, token rotation or automatic republication.
