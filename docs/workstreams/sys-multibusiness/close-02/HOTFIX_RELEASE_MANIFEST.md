# SYS-MB-CLOSE-02 — hotfix release manifest

Status: `READY_FOR_CONTROLLER_PREPARE`

## Identity

- Live/base SHA: `a34ee622402776ba23efda393d37d11868640120`
- Functional hotfix SHA: `40377c62939690b3eb613abd62624274ff7271da`
- Production branch: `codex/eventgenix-production`
- Railway: `fortunate-appreciation / production / service 8223324090`
- Planned release label: `SYS-MB: каталог і timeline після cutover`
- Migrations: none.

The production-block controller manifest created from the clean committed candidate is the authority for the exact initial candidate SHA, full changed-path list, validity window and authorization token.

## Functional files

- `services/catalogOwnershipCutover.js`
- `js/timeline-context.js`
- `tests/catalog-ownership-cutover.test.js`
- `tests/timeline-context.test.js`

## Evidence files

- `docs/workstreams/sys-multibusiness/close-02/PRODUCTION_DELIVERY_REPORT.md`
- `docs/workstreams/sys-multibusiness/close-02/LIVE_QA_REPORT.md`
- `docs/workstreams/sys-multibusiness/close-02/CLEANUP_EVIDENCE.md`
- `docs/workstreams/sys-multibusiness/close-02/OBSERVATION_START.md`
- `docs/workstreams/sys-multibusiness/close-02/CONTEXT_HANDOFF.md`
- `docs/workstreams/sys-multibusiness/close-02/VERIFICATION_MANIFEST.json`
- this manifest.

## Release sequence

1. Prepare one clean controller block from the exact committed candidate.
2. With the exact token: `npm test`, canonical patch version/cache/changelog update, push exact final SHA, exact-SHA green CI, `npm run release:railway-up`, version and timeline proof.
3. Re-run Maysternya route QA on the published candidate.
4. Under the existing Red data block, re-run catalog prepare/apply with unchanged approved mapping hash and fresh predicates/fingerprint.
5. Verify nine roots/children, three existing public links and assets without token rotation or republication.
6. Reconcile zero new fixtures and start measured observation only after all required gates pass.

## Rollback

- Code rollback reference: `a34ee622402776ba23efda393d37d11868640120` via the Railway helper.
- No migration rollback is required.
- Catalog apply failure before commit leaves catalog ownership unchanged.
- A successful catalog apply may only receive a receipt-bound forward repair; no broad SQL or token rotation.
