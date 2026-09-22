# SYS-MB-CLOSE-01 — context handoff

## Exact checkpoint

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-close-01-final-20260922`
- Branch: `codex/sys-mb-close-01-final-20260922`
- Clean production base: `b3ea57bef3c6694fcc19be86011552ca2e97ed7c`
- Upstream: `origin/codex/eventgenix-production`
- Live at final read-only check: `b3ea57bef3c6694fcc19be86011552ca2e97ed7c`, `v0.82.6`, label `Omni: зрозумілий Facebook fallback`, correct branch and complete deployment metadata.
- Local state: verified uncommitted functional diff plus CLOSE-01 evidence. No commit, push, migration, mapping apply, deploy, or production fixture was performed.
- Acceptance artifact: `.codex-temp/sys-mb-d06/runs/d06_1790079382156_b96074/result.json`.
- Browser artifacts: `output/playwright/sys-mb-d06/d06_1790079382156_b96074/`.

## Private artifacts — do not copy to Git

- Owner repair payload: `C:\Users\Plotva\.eventgenix\sys-mb-recover-01-20260913\close-01-owner-repair-payload.json`; canonical payload hash `d20cdf51fbf60377993f442cbeac8222b51b87a0748981e9511545c743b8b242`.
- Catalog ownership payload: `C:\Users\Plotva\.eventgenix\sys-mb-recover-01-20260913\close-01-catalog-ownership-payload.json`; mapping hash `0ce0adbf5b372c443a716eabab1869f910d5af3025fb5f2a88ff175d9d310fb0`.
- Approved Maysternya payload remains in the reviewed private recovery directory; mapping hash `7efec32812aa093d5cfb5ce390e4faa68cf36342d13c90aa40d462d8fed6a162`.
- Existing CRM applied receipt: `29436fa0daf1ae01bdfaf7bfaf48680cf92dd77e899b4adc4646555903a07223`; do not replay CRM from zero.

## Required production order

1. Re-fetch `codex/eventgenix-production`, re-read live `/api/version`, and stop on any drift from the authorized base/scope.
2. Create a functional commit from this exact manifest, then a separate canonical version/cache/changelog commit.
3. Push the exact final SHA, wait for all required CI on that SHA, and deploy only through `npm run release:railway-up` with the confirmed branch/project/environment/service.
4. Apply additive migrations `368` and `369` in the verified schema-before-code/apply order used by the release helper.
5. Obtain a bounded read-only post-schema snapshot. Verify the CRM receipt and current owner count; do not replay CRM cutover.
6. Apply the owner repair only when the exact user/org predicates and payload hash match and `activeOrganizationOwners=0`; otherwise stop that operation without guessing.
7. Prepare and apply the exact nine-catalog mapping with a fresh fingerprint. Preserve active flags and the three existing public tokens. Do not assign shared blobs.
8. Prepare and apply Maysternya with the reviewed mapping hash, fresh fingerprint, advisory locks, conflict checks, transaction receipt, replay proof, and unchanged-outside-target proof.
9. Run owner/director/manager/admin/worker read-only QA with the existing approved test accounts, public-link checks without exposing tokens, same-JWT mapping-transition proof, business switching, required domains, a zero-new-fixture registry proof, and exact `/api/version` proof.
10. Start compatibility observation only after successful CRM/MD receipts, live QA, and cleanup.

Failure before a transaction commit leaves data unchanged. An applied data change is rolled forward through the audited lifecycle/receipt path; no destructive migration rollback, token rotation, membership guessing, or deletion is permitted. Code rollback redeploys the recorded prior live SHA while additive schema remains in place.

## Copyable production authorization request

```text
Дозволяю блок SYS-MB-CLOSE-01-RELEASE / ALLOW_PRODUCTION_BLOCK:SYS-MB-CLOSE-01:0f90b6f0f0ba42836e87ead9dcb24afaa67f5341be4571cee32410f299361ca7.

Джерело: C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-close-01-final-20260922
База: b3ea57bef3c6694fcc19be86011552ca2e97ed7c
Production branch: codex/eventgenix-production
Railway: fortunate-appreciation / production / service 8223324090.

Дозволяю: створити functional commit із точного VERIFY manifest, окремий canonical version/cache/changelog commit; перед push зафіксувати exact final SHA і повторно перевірити відсутність drift; push exact SHA; exact-SHA CI; Railway deploy лише через npm run release:railway-up; additive migrations 368/369 з SHA-256 із manifest; bounded post-schema read-only preflight; перевірку без replay чинного CRM receipt 29436fa0daf1ae01bdfaf7bfaf48680cf92dd77e899b4adc4646555903a07223; exact owner repair за payload hash d20cdf51fbf60377993f442cbeac8222b51b87a0748981e9511545c743b8b242 лише коли всі predicates збігаються; atomic catalog apply за mapping hash 0ce0adbf5b372c443a716eabab1869f910d5af3025fb5f2a88ff175d9d310fb0; atomic maysternya_doli apply за mapping hash 7efec32812aa093d5cfb5ce390e4faa68cf36342d13c90aa40d462d8fed6a162; safe read-only live-version/public-link/role/domain QA на чинних погоджених test accounts, same-JWT proof через сам mapping transition, zero-new-fixture registry proof і observation start. Production QA створює 0 organization/business/user/membership/operational/token fixtures; TTL не застосовується; cleanup postcondition — 0 нових registered entities.

Межі: до 6 годин, максимум 3 release attempts. Без force-push/reset/raw railway up, secrets/settings/dependencies, payment/payroll/Art changes, price/formula changes, token rotation/republication, shared-blob reassignment, реальних sends/payments/generation або production QA fixtures. Будь-який SHA/hash/fingerprint/predicate drift зупиняє відповідну apply-операцію; незалежні read-only докази можна продовжити.
```

## Acceptance state

- `MAYSTERNYA_RELEASE_READY=true`
- `CRM_OWNER_REPAIR_READY=true`
- `PARK_CATALOG_OWNERSHIP_READY=true`
- `COMPATIBILITY_EXIT_GATE=HOLD_MEASURED`
- `GLOBAL_MODEL_COMPLETE=false`
