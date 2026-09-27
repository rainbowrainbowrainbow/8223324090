# SYS-MB-ASSET-CLOSE-02 — proposed production repair manifest

Status: `APPLIED_AND_VERIFIED / OBSERVATION_HOLD`

The owner approved `SYS-MB-ASSET-CLOSE-02-20260922`. The four exact API updates and history/version verification passed on 2026-09-22. See [ASSET_CLOSE_02_REPORT.md](ASSET_CLOSE_02_REPORT.md) for live proof, the retired receipt lease and remaining observation gates. The following operations table is retained as the reviewed pre-apply manifest.

## Source and target

- Preparation branch: `codex/sys-mb-asset-close-01-20260922`
- Preparation base: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`
- Live application: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79 / 0.82.11`
- Target: `fortunate-appreciation / production / 8223324090`
- Mapping SHA-256: `4040295a1fdc2cc7067ce8f9299c7b6cd6270c38d1633d19d8ddbe7de927844b`
- Source fingerprint SHA-256: `eb8d1cf62ed2af95a35b8c9025d0604352016b0ba5b46b511fb8e8d1c2085f1d`
- Private mapping: `C:\Users\Plotva\.eventgenix\sys-mb-asset-close-01-20260922\ASSET_REPAIR_MAPPING_PRIVATE.json`
- Catalog ownership receipt: `d2fb93fc3cdc7521e8544b3db288441af8f8aa77f5b45c6be40556ad9f20ffd6`

No code deploy, migration, Git push or Railway upload is required for the recommended data repair. The local controller calls the already deployed catalog page lifecycle API.

The dedicated read-only role verifies roots, token hashes and page predicates but lacks SELECT on `catalog_ownership_cutover_journal`. The block additionally permits a bounded lease for SELECT of the journal receipt/state/mapping/fingerprint/count fields only. The lease must be revoked within 30 minutes and before task completion. It does not authorize ownership replay or any other SQL.

## Exact operations

| API path | Field | Required current SHA-256 | Required version | Proposed value |
|---|---|---|---:|---|
| `PUT /api/catalogs/122112/pages/0` | `image_url` | `ee0a9bb1090ead02003d8da95b56cdf77ab6ef1317a6fd3b92a88e39c8f15c75` | 4 | `null` |
| `PUT /api/catalogs/122112/pages/1` | `image_url` | `9d01f68ae8e82d1c9c92889de496c44de89a83fe649b909f42142ec34b02f8c5` | 2 | `null` |
| `PUT /api/catalogs/122112/pages/2` | `image_url` | `acf98269eaa9af16ca588faaaecc401b34862cbbb68a27c31e9e99b2992a6c00` | 2 | `null` |
| `PUT /api/catalogs/cake/pages/0` | `image_url` | `9603b813b7a0d4eca008effc6a1faa0b7fb9f79fc7a11f2d10e72184a6517a49` | 5 | `null` |

SHA-256 of the proposed scalar `null`: `74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b`.

Only these four fields are authorized by the proposed block. The apply must preserve:

- all titles, text, details, prices and formulas;
- catalog status and active/inactive flags;
- `business_context`, ownership markers and receipt;
- all three current public tokens and publication visibility;
- all unrelated pages, catalogs, assets and consumers.

## Runnable commands

Run from the isolated worktree with Node 22/npm 10. The secrets file is loaded only into process memory and values must not be printed.

Read-only prepare:

```powershell
. 'C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1'
$env:SYS_MB_ASSET_REPAIR_MAPPING='C:\Users\Plotva\.eventgenix\sys-mb-asset-close-01-20260922\ASSET_REPAIR_MAPPING_PRIVATE.json'
node docs\workstreams\sys-multibusiness\asset-close-01\tools\catalog-asset-repair-controller.cjs prepare
```

After the exact block is approved, record its ID in the private mapping approval metadata and set the exact guard:

```powershell
$env:ALLOW_SYS_MB_ASSET_REPAIR_BLOCK='<approved-block-id>:4040295a1fdc2cc7067ce8f9299c7b6cd6270c38d1633d19d8ddbe7de927844b'
node docs\workstreams\sys-multibusiness\asset-close-01\tools\catalog-asset-repair-controller.cjs apply
```

Read-only verification:

```powershell
node docs\workstreams\sys-multibusiness\asset-close-01\tools\catalog-asset-repair-controller.cjs verify
node .codex-temp\sys-mb-asset-close-01\public-viewer-check.cjs
```

The private helper must be run with `SYS_MB_ASSET_PRIVATE_ROOT` set to `C:\Users\Plotva\.eventgenix\sys-mb-asset-close-01-20260922`. Do not copy its private results into Git.

## Acceptance

- prepare revalidates all four current hashes, page IDs, owner and versions;
- apply changes only four `image_url` fields to `null`;
- each page version advances and history contains the resulting value;
- the three public viewers remain HTTP 200 with page counts 3/1/8;
- browser network contains no request to the four old URLs;
- no new token, catalog, page, asset, fixture, job, send, payment or generation exists;
- `122112` remains inactive draft; Cakes remains active draft; Graduation remains active ready;
- responsive/private viewer QA passes without leaking tokens.

## Exact requested block

```text
УВАГА · SYS-MB-ASSET-CLOSE-02-20260922

Дія: створити bounded SELECT lease для exact catalog receipt preflight, відкликати його протягом 30 хвилин, після чого через чинний catalog page lifecycle API встановити null лише у чотирьох підтверджених битих image_url за mapping SHA-256 4040295a1fdc2cc7067ce8f9299c7b6cd6270c38d1633d19d8ddbe7de927844b і source fingerprint eb8d1cf62ed2af95a35b8c9025d0604352016b0ba5b46b511fb8e8d1c2085f1d.

Наслідки:
1. 122112 сторінки 0/1/2 і Торти сторінка 0 використовуватимуть штатний no-image fallback замість HTTP 404.
2. Titles, text, prices, status, active/inactive, ownership і три чинні public tokens не змінюються.
3. Page history/version мають зафіксувати кожну з чотирьох змін.
4. При drift зупиняється відповідне поле; при partial failure controller відновлює точні попередні значення.
5. Після PASS виконується private public-viewer/browser/network QA, zero-fixture proof і запускається measured observation.

Межі: fortunate-appreciation / production / service 8223324090; bounded SELECT lease лише для catalog_ownership_cutover_journal з revoke протягом 30 хвилин; тільки PUT /api/catalogs/122112/pages/0, /1, /2 та PUT /api/catalogs/cake/pages/0; тільки field image_url; 2 години; максимум 2 apply/rollback attempts; без upload, token rotation, publish, status/active changes, broad SQL, Git push, deploy, secrets/settings, sends/payments/generation або інших production records.
Відкат: ті самі чотири API paths відновлюють точні попередні значення з приватного mapping лише якщо current value все ще null; далі повторна history/version і viewer перевірка.
Потрібний дозвіл: «Дозволяю блок SYS-MB-ASSET-CLOSE-02-20260922».
```
