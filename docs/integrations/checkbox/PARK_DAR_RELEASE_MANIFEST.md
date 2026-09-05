# PARK/DAR catalog_sale release manifest

Status: **LOCAL RELEASE CANDIDATE READY; PRODUCTION ROLLOUT BLOCKED**. Local
migration and loopback-provider gates pass, but the exact protected production
configuration described below is still incomplete. This manifest does not
authorize production writes or Checkbox mutations.

## Scope and topology

- Legal entity: `ФОП ОСАДЧУК ОЛЬГА СЕРГІЇВНА`.
- `park_production`: logical business `event_genix`, physical scope
  `event_genix / park / middle`, display name `Середня каса`, expected
  `is_test=false`.
- `dar_production`: logical business `dar`, physical scope `dar / dar / dar`,
  display name `Студія` / `Каса ДАР`, expected `is_test=false`.
- `park_test` and `dar_test`: two logical routes to exactly one physical
  Checkbox test register, expected `is_test=true`, shared group
  `checkbox_single_test_register`.
- The shared register is sequential-only. A route switch is forbidden while a
  shift is open or any queued/failed/dead/unknown recovery work exists.
- Physical provider register rows must not be duplicated.

## Release migrations

| Migration | Kind | Planned effect |
| --- | --- | --- |
| `346_catalog_sale_foundation.sql` | schema | Products, price/discount rules, immutable catalog-sale item snapshots. |
| `347_dar_catalog_2026_2027.sql` | data-fix | Exactly 21 DAR products, 21 positive price rules and 2 discount rules. |
| `348_fiscal_cashier_admin_metadata.sql` | schema | Non-secret cashier name/login metadata. |
| `349_payment_order_selected_fiscal_cashier_binding.sql` | schema | Durable immutable selected fiscal cashier binding. |
| `350_fiscal_register_route_acceptance.sql` | schema | Fail-closed physical-register acceptance and shift business ownership. |
| `351_fiscal_sale_routes.sql` | schema | Explicit logical routes, route gates, logical mapping ownership and immutable order route. |

Migration `351` is required. Without it, `dar_test` can resolve to the PARK-owned
physical register but cannot durably retain DAR mapping, history and recovery
ownership.

## Exact non-secret production records

The rollout planner must perform a read-only dry-run first and classify every
row below as `insert`, `update` or `no-op`. Any ambiguous match is a blocker.

1. Fiscal topology:
   - one active `event_genix` profile, `park` location and `middle` production register;
   - one active `dar` profile, `dar` location and `dar` production register;
   - one active physical shared test register (not two), with one physical location;
   - three active cashier bindings: PARK production, DAR production and shared test;
   - no authentication, role or permission records are changed.
2. Logical routes: exactly four `fiscal_sale_routes` rows:
   - `park_production`, `event_genix`, `production`, `expected_is_test=false`;
   - `dar_production`, `dar`, `production`, `expected_is_test=false`;
   - `park_test`, `event_genix`, `test`, `expected_is_test=true`;
   - `dar_test`, `dar`, `test`, `expected_is_test=true`.
3. Every route and physical register is `status=active` and
   `feature_enabled=true`, while every `acceptance_enabled` flag starts as
   `false`.
4. Fiscal mappings:
   - 140 PARK `catalog_sale` mappings on the PARK production register;
   - 140 PARK `catalog_sale` mappings on the shared test register;
   - 21 DAR `catalog_sale` mappings on the DAR production register;
   - 21 DAR `catalog_sale` mappings on the shared test register;
   - 6 PARK `admission_ticket` mappings on the PARK production register;
   - 6 PARK `admission_ticket` mappings on the shared test register.
5. All 322 catalog mappings are `active`, `tax_mode=untaxed`, with
   `provider_tax_id`, `tax_code` and `tax_rate_bps` equal to `NULL`. Prices are
   not stored in fiscal mappings.
6. The DAR data-fix owns exactly 21 `products`, 21 positive `price_rules` and these
   two discount rules only: `dar_ubd_20` and
   `dar_second_club_direction_10`.
7. No payment order, operation, receipt, outbox job, shift, return or service
   receipt is created by configuration rollout.

## Required environment variable names

Values must come from the protected secrets source and must never be printed,
committed or pasted into chat.

Global gates (initial values remain `false`):

- `CHECKBOX_INTEGRATION_ENABLED`
- `CHECKBOX_ACCEPT_PAYMENTS_ENABLED`
- `CHECKBOX_WEBHOOK_ENABLED`
- `CHECKBOX_TEST_ALLOW_UNREPORTED_PAYMENT_PERMISSIONS`
- `EVENTGENIX_CASHIER_PRO_ENABLED`

PARK production register:

- `CHECKBOX_PARK_MIDDLE_PROD_BASE_URL`
- `CHECKBOX_PARK_MIDDLE_PROD_LICENSE_KEY`
- `CHECKBOX_PARK_MIDDLE_PROD_ACCESS_KEY`

PARK production cashier:

- `CHECKBOX_PARK_MIDDLE_CASHIER_PROD_AUTH_MODE`
- `CHECKBOX_PARK_MIDDLE_CASHIER_PROD_LOGIN`
- `CHECKBOX_PARK_MIDDLE_CASHIER_PROD_PASSWORD`
- `CHECKBOX_PARK_MIDDLE_CASHIER_PROD_PIN_CODE`
- `CHECKBOX_PARK_MIDDLE_CASHIER_PROD_DEVICE_ID`

DAR production register:

- `CHECKBOX_DAR_DAR_PROD_BASE_URL`
- `CHECKBOX_DAR_DAR_PROD_LICENSE_KEY`
- `CHECKBOX_DAR_DAR_PROD_ACCESS_KEY`

DAR production cashier:

- `CHECKBOX_DAR_DAR_CASHIER_PROD_AUTH_MODE`
- `CHECKBOX_DAR_DAR_CASHIER_PROD_LOGIN`
- `CHECKBOX_DAR_DAR_CASHIER_PROD_PASSWORD`
- `CHECKBOX_DAR_DAR_CASHIER_PROD_PIN_CODE`
- `CHECKBOX_DAR_DAR_CASHIER_PROD_DEVICE_ID`

Shared test register and cashier:

- `CHECKBOX_SHARED_TEST_REGISTER_BASE_URL`
- `CHECKBOX_SHARED_TEST_REGISTER_LICENSE_KEY`
- `CHECKBOX_SHARED_TEST_REGISTER_ACCESS_KEY`
- `CHECKBOX_SHARED_TEST_CASHIER_AUTH_MODE`
- `CHECKBOX_SHARED_TEST_CASHIER_LOGIN`
- `CHECKBOX_SHARED_TEST_CASHIER_PASSWORD`
- `CHECKBOX_SHARED_TEST_CASHIER_PIN_CODE`
- `CHECKBOX_SHARED_TEST_CASHIER_DEVICE_ID`

Exactly one authentication mode is selected per cashier reference. Unused
password/PIN variable names may remain absent. `CHECKBOX_EXPECT_IS_TEST` remains
only a legacy fallback; the new routes must pass explicit per-register mode.

## Current preflight evidence and blockers

1. Disposable PostgreSQL passed migrations `346` through `351` from a clean
   state and on a second idempotency run. The current migration integration
   suite passes `14/14`, including an exact-schema contract, target-scoped
   unknown-refund lifecycle checks and a genuinely read-only planner role. The
   exact-four loopback-provider QA
   passed with four receipts, one submit plus same-UUID lookup recovery, closed
   shifts, empty queues and `acceptance=false`; the disposable schema was then
   cleaned and its PostgreSQL process stopped.
2. The protected production database audit ran through the dedicated
   `PARK_DAR_PRODUCTION_READONLY_DATABASE_URL` in a `REPEATABLE READ READ ONLY`
   transaction. The role has no database/schema create or ledger/migration
   insert privileges. Production is currently at migration `345`; migrations
   `346` through `351` are absent and no PARK/DAR fiscal topology or mappings
   exist yet.
3. Production contains all 140 currently sellable PARK catalog items. The 21
   planned DAR product IDs and price-rule codes have zero conflicts; the DAR
   catalog and discount table are not present before migrations. The production
   inventory currently contains 160 unique PARK products: 140 sellable, 16
   inactive, three non-positive-price products and one product with ambiguous
   price rules. The earlier `162` audit figure counted price-link rows, so the
   ambiguous product appeared three times; it is still one CRM product and is
   excluded from sale.
4. None of the 29 approved Checkbox/runtime variable names is present on the
   production application service. All five global mutation gates therefore
   remain disabled by their fail-closed defaults. Values were not printed.
5. Exact non-secret organization/register/cashier identities, the physical
   shared-test profile/location aliases, binding user IDs and approved
   credential-reference strings are not fixed. Checkbox identity calls are out
   of scope for this preflight, so these records must not be invented.
6. A current production backup/restore point has not been independently proven.
7. The existing catalog mapping configurator intentionally accepts only a
   disposable loopback database and remains unchanged. A separate production
   read-only planner now accepts only a protected external manifest matching
   `PARK_DAR_PRODUCTION_CONFIG.schema.json`, a task-specific read-only database
   URL and an out-of-band SHA-256 pin for the manifest. It generates a fresh
   nonce and fetches the short-lived attestation directly from the fixed TLS
   origin through the already-public `/api/version` boundary with the explicit
   `parkDarProductionAttestation=1` marker; unrelated query parameters keep the
   normal version response, and caller-supplied attestation files are rejected.
   The challenge path is separately rate-limited. The production handler validates the exact
   Railway project, environment, service IDs/names and public domain, and runs
   its database identity query in a `REPEATABLE READ READ ONLY` transaction
   that is always rolled back. The planner verifies the exact production
   target/live SHA, challenge nonce and manifest hash, a hashed database
   fingerprint, the exact
   migration names/digests, a pinned post-migration schema-object contract,
   disabled mutation gates and empty target lifecycle queues. Lifecycle checks
   include unknown refunds resolved independently through their direct register,
   originating order and fiscal operation, plus unscopable and conflicting
   register-reference counters. The HTTPS response binds the manifest hash,
   authorization block and a fresh UUID challenge; the protected manifest must
   be outside the repository. SQL inventory fixes
   `search_path`, rejects every connection-string query override except one
   canonical `sslmode=verify-full`, and constructs the PostgreSQL client from
   validated URL components instead of forwarding the raw connection string. It
   emits hashes, aggregate action counts and blocker codes only, always ends
   with `ROLLBACK`, and has no apply mode. The exact-origin HTTPS challenge is
   the authenticated producer channel; a local JSON file is not production
   evidence. The disabled bootstrap endpoint is now deployed independently;
   the exact protected manifest and a separately Red-authorized apply path are
   still required before configuration writes.
8. Fresh public production refresh on 2026-09-04 reports healthy version
   `0.81.72` at SHA `3f2d11463acbc0ad03142f4348150a567020f022` from
   `codex/eventgenix-production`. The protected namespaced attestation challenge
   is deployed and bound to that exact runtime while all fiscal mutation gates
   remain disabled. The protected read-only inventory for that exact SHA
   completed successfully without emitting values: production remains at
   migration `345`, migrations `346` through `351` are absent, PARK has 140
   sellable products, the planned DAR stable IDs have no conflicts, and no
   PARK/DAR fiscal topology or mapping rows exist yet. This evidence must still
   be refreshed immediately before the separately authorized rollout.

The PARK/DAR manifest is authoritative for this release: `feature_enabled=true`
makes the configured routes visible, while physical-register and logical-route
`acceptance_enabled=false` plus the global kill switch prevent fiscal mutations.
The older admission-ticket pilot contract remains unchanged and must not be used
to infer PARK/DAR route activation policy.

Read-only planner invocation (values remain process-local and are not printed):

```text
npm run audit:checkbox:park-dar-production-config -- --manifest-file=<protected-json> --expected-manifest-sha256=<64-hex>
```

## Rollout and rollback

1. Read-only DB inventory, backup readiness and exact dry-run.
2. Apply migrations `346` through `351` in order.
3. Upsert only the records listed above; all acceptance flags stay false.
4. Deploy the exact candidate SHA and verify `/api/version` and `/api/health`.
5. Load the production sale UI read-only and verify every sale action is blocked.
6. Configure credential references only in a separate Red-authorized block.
7. Run read-only Checkbox identity preflight.
8. A future first real receipt is allowed only for DAR, manually with Natalia
   Vasylivna and under a separate explicit authorization. PARK remains forbidden.

Rollback keeps every acceptance gate false, restores the previous application
SHA, and retains additive schema/ledger records. No destructive DB rollback is
part of the normal path.
