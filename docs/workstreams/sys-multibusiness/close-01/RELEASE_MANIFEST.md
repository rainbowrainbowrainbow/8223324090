# SYS-MB-CLOSE-01 — exact production manifest

Manifest scope hash: `0f90b6f0f0ba42836e87ead9dcb24afaa67f5341be4571cee32410f299361ca7`

Base/live at final read: `b3ea57bef3c6694fcc19be86011552ca2e97ed7c`

Target: `codex/eventgenix-production` → `fortunate-appreciation / production / 8223324090`

This is a pre-commit manifest. The protected controller must be prepared after the functional and version commits exist, and must bind the resulting exact final SHA before push. Any path/hash/base drift invalidates this manifest.

## Files

Runtime/config/UI:

- `config/businessCompatibilityTelemetry.js`
- `middleware/auth.js`
- `middleware/hermesAuth.js`
- `profile.html`
- `routes/catalogs.js`
- `routes/leads.js`
- `routes/organizations.js`
- `scripts/sys-mb-compatibility-telemetry-report.cjs`
- `server.js`
- `services/businessCutover.js`
- `services/catalogOwnershipCutover.js`
- `services/eventBus.js`
- `services/legacyBusinessSurface.js`
- `services/timelineContext.js`
- `services/websocketEventAccess.js`

Verification:

- `tests/acceptance/run-sys-mb-local.cjs`
- `tests/acceptance/sys-mb-browser-scenarios.cjs`
- `tests/acceptance/sys-mb-domain-scenarios.cjs`
- `tests/acceptance/sys-mb-readiness-scenarios.cjs`
- `tests/business-cutover.test.js`
- `tests/catalog-ownership-cutover.test.js`
- `tests/sys-mb-compatibility-telemetry-report.test.js`
- `tests/timeline-context.test.js`
- `tests/websocket-event-access.test.js`

Evidence is limited to `docs/workstreams/sys-multibusiness/close-01/`. Exact SHA-256 values for every functional/test file are in `VERIFICATION_MANIFEST.json`.

## Additive migrations

| Migration | SHA-256 | Purpose |
|---|---|---|
| `368_catalog_ownership_cutover_journal.sql` | `f12f38c5ec2c5b3c1f52f5c79e8013975dc485000774e652aed7a659d66c7188` | Hash-bound catalog prepare/apply journal and durable root/child ownership. |
| `369_multibusiness_compatibility_telemetry_v2.sql` | `9b0062613cb8212e15e2054a693c6f037f4c4d4d9d57cda2bb28eea2a4360095` | Durable hourly decision counters and runtime persistence reconciliation. |

Both migrations are additive. They must not be rolled back destructively during an application rollback.

## Protected data inputs and predicates

### CRM

- Existing applied receipt must equal `29436fa0daf1ae01bdfaf7bfaf48680cf92dd77e899b4adc4646555903a07223`.
- Do not run the CRM mapping from zero.
- Owner repair canonical payload hash: `d20cdf51fbf60377993f442cbeac8222b51b87a0748981e9511545c743b8b242`.
- Apply only when all private stable IDs match the reviewed payload, the organization/business are active and co-owned, the agreed owner account is active, the CRM receipt is unchanged, and current `activeOrganizationOwners=0`.
- If an active agreed owner already exists, repair is an idempotent no-op. If any other predicate differs, HOLD; do not infer by username or creator role.

### Park catalogs

- Mapping hash: `0ce0adbf5b372c443a716eabab1869f910d5af3025fb5f2a88ff175d9d310fb0`.
- Exact roots: 9; exact existing public-token roots: 3.
- Prepare must return a fresh source fingerprint. Apply must use that exact fingerprint and journal row under the advisory lock.
- Preserve catalog active/inactive state and token bytes. Assign roots and declared children to `event_genix`; leave shared blobs unassigned.
- Any root/name/public-token/child-owner drift is HOLD.

### Maysternya

- Mapping hash: `7efec32812aa093d5cfb5ce390e4faa68cf36342d13c90aa40d462d8fed6a162`.
- Source snapshot hash/deployment SHA and DB fingerprint must be freshly recomputed and must match the private approved payload at prepare/apply time.
- Organization and owner must be active; target context must be unclaimed or already claimed by the same organization; every mapped user must be active.
- Preserve Park/Dar/default access and all rows outside `maysternya_doli`.
- director/manager/admin access comes only from active MD membership. Hermes receives no MD/CRM membership.

## QA inventory and TTL

Production QA creates **zero** fixture records:

| Entity | Count |
|---|---:|
| trusted QA runs/entities | 0 |
| organizations/businesses/users | 0 |
| temporary memberships | 0 |
| customer/lead/task/product/booking/finance/warehouse rows | 0 |
| public tokens/assets/jobs | 0 |

`TTL = N/A` because live QA is read-only and uses only approved existing test accounts. Same-JWT evidence comes from observing the authorized Maysternya mapping transition in an already-authenticated test session. Cleanup proof is a read-only before/after registry query showing zero new CLOSE-01 runs/entities. Any unexpected registered or operational fixture is a release HOLD.

Local disposable acceptance used 2 organizations, 5 businesses, 9 accounts, 9 catalog roots, 27 catalog child rows, and 3 public links. Its TTL was the process lifetime; the exact disposable database was dropped in `finally`, and `cleanupVerified=true`.

## Runnable sequence

Before the production block:

```powershell
npm run check:runtime
npm run check:migrations
npm run check:syntax
npm run test:sys-mb
npm run test:ui
```

After creating the functional commit and separate version/cache/changelog commit, use the protected controller:

```powershell
npm run codex:production-block -- prepare --validity-minutes 360 --max-release-attempts 3 --protected-workflow sys-mb-auth-cutover --qa-scope none --release-label "SYS-MB: Майстерня, каталоги та telemetry"
```

Execute only with the exact confirmation emitted by `prepare`. The controller owns push, exact-SHA CI, and the Railway helper deploy. Do not run raw `railway up`.

Post-schema apply uses the existing protected owner-only endpoints with private JSON payloads held outside Git:

1. `POST /api/organizations/catalog-cutovers/prepare`
2. `POST /api/organizations/catalog-cutovers/apply`
3. `POST /api/organizations/cutovers/prepare` for `maysternya_doli`
4. `POST /api/organizations/cutovers/apply` for `maysternya_doli`

The operator must keep credentials, payloads, IDs, tokens, and raw responses in the private run directory. The response must record the fingerprint, replay flag, counts, and receipt hash without copying person-level mapping data into Git.

## Rollback

- Before apply commit: transaction rollback means no data change.
- Catalog or MD conflict/fingerprint drift: stop that apply; keep the other read-only checks running.
- After a successful apply: use a separately authorized, receipt-bound forward correction through the lifecycle API. Do not delete memberships, journals, tokens, or schema by broad SQL.
- Code rollback: redeploy the recorded prior live SHA through the helper; migrations 368/369 remain in place because they are additive and compatible.
- Owner repair is the agreed durable owner state and is not automatically reverted.
