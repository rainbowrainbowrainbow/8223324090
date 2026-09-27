# SYS-MB-ASSET-CLOSE-02 — forward rollback

Status: `RUNNABLE_WITHIN_APPROVED_BLOCK`

Rollback is a forward lifecycle update. It does not reset Git, delete history or rotate public tokens.

## Preconditions

1. The approved mapping SHA-256 is `4040295a1fdc2cc7067ce8f9299c7b6cd6270c38d1633d19d8ddbe7de927844b`.
2. The page identity, business owner and catalog ownership receipt still match.
3. Each target being rolled back currently has `image_url = null`.
4. The rollback is inside the same exact production block or a new exact block naming these four fields.
5. No concurrent catalog editor is active.

## Command

```powershell
. 'C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1'
$env:SYS_MB_ASSET_REPAIR_MAPPING='C:\Users\Plotva\.eventgenix\sys-mb-asset-close-01-20260922\ASSET_REPAIR_MAPPING_PRIVATE.json'
$env:ALLOW_SYS_MB_ASSET_ROLLBACK_BLOCK='<approved-block-id>:4040295a1fdc2cc7067ce8f9299c7b6cd6270c38d1633d19d8ddbe7de927844b'
node docs\workstreams\sys-multibusiness\asset-close-01\tools\catalog-asset-repair-controller.cjs rollback
```

The controller restores the exact private values whose hashes are:

- `122112 / page 0`: `ee0a9bb1090ead02003d8da95b56cdf77ab6ef1317a6fd3b92a88e39c8f15c75`;
- `122112 / page 1`: `9d01f68ae8e82d1c9c92889de496c44de89a83fe649b909f42142ec34b02f8c5`;
- `122112 / page 2`: `acf98269eaa9af16ca588faaaecc401b34862cbbb68a27c31e9e99b2992a6c00`;
- `cake / page 0`: `9603b813b7a0d4eca008effc6a1faa0b7fb9f79fc7a11f2d10e72184a6517a49`.

## Verification

- all four restored values match their hashes;
- page versions advance again and history records the forward rollback;
- viewer identity/page counts remain 3/1/8;
- the original four 404s return, so rollback removes an unsafe repair but does not resolve the original asset defect;
- no other page, token, state, asset or catalog changes.

Rollback is required when identity/current-value/history verification fails after a partial apply. A browser-only rendering concern should first stop QA and preserve evidence; rollback is not used to hide an unrelated defect.
