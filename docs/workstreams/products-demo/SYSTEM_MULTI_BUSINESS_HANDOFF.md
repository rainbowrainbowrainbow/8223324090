# Graduation multi-business system handoff

Release base commit: `14e58dd19609f3d6cc4a52029882659219e6eeab`
Release branch: `codex/products-sys-release-20260911`
Production destination: `codex/eventgenix-production`
Previous live commit before this release block: `28b5bf02438f216f1eaafa0d5a403bdb34d4ffff`

## Implemented locally

- Graduation data isolation is now modeled with `business_context` across settings, services, packages, package items, quotes, child packs, children, diploma templates, diploma exports, and automation state.
- Graduation routes require a single writable business scope for mutations and fail closed for aggregate scopes.
- Graduation module access remains gated by `services/businessContext.js`; `dar` is still not enabled for `graduation`.
- Quote/package/service/customer/booking lookups are scoped by the active graduation business context.
- Booking conversion remains available only for the explicitly supported context list, currently `event_genix`, until resource mapping is configured for another business.
- Graduation ops automation carries `businessContext` into controlled tasks, automation state, source IDs, and artifact URLs.
- Graduation frontend API calls append the active CRM business context and clear/reload local graduation state on business-context changes.
- Proposal, catalog export, and catalog share text use the active business label instead of hard-coding Park presentation text for future contexts. Event Genix keeps the existing Park text and contacts.
- The graduation page now fails closed with a clear unsupported-business state when the active business does not expose the graduation module.
- A read-only readiness audit was added for graduation seed reuse:
  - service: `services/graduationBusinessReadiness.js`
  - CLI: `node scripts/audit-graduation-business-readiness.js --business-context dar --format markdown`
  - SQL preview: `node scripts/audit-graduation-business-readiness.js --business-context dar --format sql`

## Current readiness finding

The real seed package is structurally connected but not ready for blind reuse by another business:

- `data/graduation-services.json`: 25 services
- `data/graduation-packages.json`: 7 packages
- package-to-service references: no missing references found
- formula-priced services: 9
- business-specific service fields: 15
- seed source drift findings: 1
- `dar`: graduation module disabled, readiness status `BLOCKED / seed_source_drift`

The blocking drift is `Вхід.price_per_child`: `data/graduation-services.json` has `5`, while `db/migrations/088_fix_entry_price.sql` raises the current DB seed to at least `10`. SQL preview refuses to print an applicable seed until this source-of-truth mismatch is resolved. The next owner must review business copy and pricing source assumptions before enabling graduation for Dar or another company.

## Still blocked by business/owner decisions

- Which businesses should expose the graduation module.
- Whether Park seed prices and formulas may be reused, adapted, or replaced for each business.
- Which source should become canonical for graduation seed after the JSON vs migration-088 drift is resolved.
- Which contact details should appear in catalog/proposal exports for every business.
- Which booking room/resource mapping each business should use for graduation conversion.
- Whether non-Park graduation exports should keep the current visual package theme or receive business-specific templates.

## Boundaries preserved

- No HR changes.
- No global menu/router/theme changes.
- No auth/role model changes.
- No dependencies.
- No pricing/formula changes.
- No production data operations.
- No Dar module enablement.
- No booking resource mapping for non-Park businesses.

## Verification performed

- `node --check routes/graduation.js`
- `node --check js/graduation.js`
- `node --check services/graduationBusinessReadiness.js`
- `node --check scripts/audit-graduation-business-readiness.js`
- `node --test tests/graduation-ops-automation.test.js`
- `node --test tests/business-context.test.js`
- `node --test tests/finance-permission-contract.test.js`
- `node --test tests/graduation-business-readiness.test.js`
- `node scripts/audit-graduation-business-readiness.js --business-context dar --format json`
- `node scripts/audit-graduation-business-readiness.js --business-context dar --format markdown`
- `node scripts/audit-graduation-business-readiness.js --business-context dar --format sql` exits with code 1 as expected while seed-source drift is present.
- `npm run check:migrations`
- `npm run check:auth-boundary`
- `npm run check:api-surface`
- `npm run check:runtime`
- `npm run check:version`
- `npm run check:syntax`
- `npm run test:ui`

The direct `node --test ...` runner may be blocked by the local sandbox worker spawn policy, so these focused test files were executed outside the sandbox on the same Node 22 runtime.
