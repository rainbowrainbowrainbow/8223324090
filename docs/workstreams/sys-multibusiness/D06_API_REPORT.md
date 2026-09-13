# SYS-MB-D06 — Actual-app API acceptance

Date: 2026-09-12. Status: **CORE_API_PASS / EXTRA_MODULES_PASS / WAREHOUSE_RESIDUAL_FAIL / HOLD**.

Final API checkpoint: **`d06_1789240691369_eeb5a9`**. This is completed local
acceptance evidence; the remaining 14 isolation failures prevent release approval.

This is the API portion of independent D06 local acceptance. The application must
run from the cumulative worktree at base
`a5180def01a1e47f8f4fc75e2f7a43092f205828`, branch
`codex/sys-mb-auth-p0-20260912`. Prior D01–D05 fixture results are context, not
acceptance evidence for this run. This report is not live QA or release approval.

## Executable contract

`tests/acceptance/sys-mb-domain-scenarios.cjs` exports:

- `seed({db, fixture})`: one transaction inserts identified synthetic operational
  records after the harness runs the real migrations. It requires a disposable
  database name, uses no fallback database URL and supplies explicit business
  context for every owned row. Future active bookings receive an owned durable
  room resource as required by migration 332.
- `run({baseUrl, fixture, request, db, record})`: checks loopback, uses the
  harness's actual HTTP/login wrapper, catches each scenario failure to continue,
  and records redacted method/path/context/status/code evidence. It never injects
  `req.user`, replaces routes or mocks SQL/auth results.

The harness owns the actual `server.js` process, schema/bootstrap, local accounts,
network confinement, logs and database cleanup. The module owns only its domain
rows and scoped synthetic HTTP operations. Each fixture's IDs and browser markers
are returned in `fixture.records[context]` and `fixture.markers[context]`.

## API matrix and assertions

| Domain | Actual entrypoints | Assertions |
| --- | --- | --- |
| Bookings | `/api/bookings/:date`, `/api/bookings/detail/:id`, foreign `PUT /api/bookings/:id` | Own date/detail record; foreign business and organization ID denied; denied update preserves stored target. |
| Timeline | `/api/timeline/resources`, `/resources/availability` | Owned resources only, real availability query, repeated GET does not insert defaults. |
| Customers | List, detail, create and denied foreign update | Owned customer/booking projection, foreign ID denial, active owner on actual create. |
| Leads | List, `/:id/booking-context`, `PATCH /:id` | Own retained product/booking accepted; foreign references reject and roll back simultaneous notes. |
| Tasks | List, detail, priority update and denied foreign update | Context and visibility filters, own priority update, foreign rows unchanged. |
| Finance | Transactions/accounts, expense create, foreign update | Actual expense with owned account/category/booking; foreign references reject before ledger insert. No income or payment dispatch. |
| Warehouse | Stock list/detail/create, locations through references | Own stock and location; foreign location rejected before stock insert. |
| Products | List/detail/create and denied foreign update | Explicit stored owner, independent product-price read, no image generation/provider action. |
| Graduation | Package list/slug, quote detail/update references | Park/Dar packages and services stay scoped; foreign customer/package/service rejects. Custom constructor has explicit denial, with or without context. |
| Aggregate | Customers/leads/tasks/products and write guard | Same organization with equal permissions can aggregate; differing roles or organizations deny. POST/PUT/PATCH/DELETE reject aggregate writes. |
| Membership | Business profile, finance, lifecycle API | Same account has different Park/Dar roles; fresh same-JWT role reduction/revoke/restoration; explicit foreign organization denies. |
| Lifecycle | Organization members/business configuration/resource initialization | Non-platform last-owner guard; member/admin/foreign-owner denial; owner creates/configures/deactivates a custom business; disabled modules and absent custom defaults remain explicit. |
| Existing containment | Catalogs, booking templates, recurring, intake status/list, chat channels, Kleshnya sessions, finance salary | Explicit existing NOT_MIGRATED response under each fixture business. |
| Dashboard primary widgets | `/api/dashboard/widgets/tasks`, `/widgets/leads_new` | Own nonempty sentinel, foreign-business/organization exclusion, inaccessible explicit context403. Other widget domains are not implied by these reads. |
| Business settings reads | `/api/business/cabinet`, `/api/settings/timeline-display` | Correct selected context and registry module matrix; scoped persisted setting fingerprints unchanged by GET; inaccessible context403. |
| Omni CRM reads | `/api/omni/conversations`, `/:id/context`, `/:id/messages` | Owned synthetic conversation/message and customer/lead/booking context; foreign context404 or empty message list with total0; inaccessible business403. No send/provider action. |
| Additional warehouse residuals | Contractor/procurement lists and contractor `/:id/order-context` | Separately numbered `warehouse_residual.*` probes require unassigned legacy rows to be unavailable and explicitly owned foreign stocks to remain unreadable, directly and through procurement items. |

Park and Dar share organization 1; a third custom business belongs to organization
2. The ordinary owner is a director account, not the technical platform creator,
so platform bypass cannot conceal organization-isolation failures. A dedicated
revocable actor keeps the same real login token throughout role reduction,
deactivation and restoration. Its membership is restored through the lifecycle
API. The separately created lifecycle cabinet is deactivated in `finally` and
retained in the disposable fixture registry for cleanup evidence.

## Boundaries and interpretation

- Read-only HR/payroll/certificates/Art sentinel probes and ownership/compatibility
  collectors belong to the separate D06 readiness module. They are not silently
  certified by the operational API results above.
- `linkedTo`, legacy historical ownership, external ingress/jobs and global
  integrations retain their previous protected scope and HOLD decisions. This
  module does not reinterpret a NOT_MIGRATED module label as server denial.
- The supported aggregate subset is explicit. Single-context finance, warehouse,
  booking and graduation APIs are not claimed to implement combined reads.
- No real records, credentials, provider calls, payroll/payment records, schema
  modifications, product runtime changes, commit, push or deploy occur here.
- Passing a list/detail scenario certifies those actual entrypoints, not every
  background or indirect adapter in the domain. Source inventory and readiness
  findings remain part of the final release decision.

## Verification

Current completed API evidence is final run **`d06_1789240691369_eeb5a9`** on Node
`v22.22.2`. The actual counts below were calculated from each matching record's
`evidence.requests` in
`.codex-temp/sys-mb-d06/runs/d06_1789240691369_eeb5a9/result.json`, not carried
forward from planned totals:

| Current API set | PASS | FAIL | Actual HTTP requests |
| --- | ---: | ---: | ---: |
| Core `domain` / `aggregate` / `auth` / `lifecycle` / `containment` | 123 | 0 | 280 |
| Remaining enabled primary reads `enabled_extra` | 24 | 0 | 45 |
| Known warehouse residuals `warehouse_residual` | 0 | 14 | 14 |
| Current API module total | 147 | 14 | 339 |

All **161 scenarios** executed against the actual application. Cleanup is
confirmed by `lifecycle.cleanupVerified: true`; `acceptance-source-stability`
is PASS with `changed: []`. The 14 expected red reproductions remain real FAILs,
not successful isolation tests. This table covers only this API module, not the
separate browser/readiness results. The same harness command below was used.
Historical completed runs remain below for comparison.

The final run also records the frozen source inventory in `source-state.json` in
the same directory. The API scenario module's SHA256 is
`8d199a47f112225e1cb5b46a0eabe59ca0e4ce7fe2fe3b0ac6df8eef504de73b`.
No acceptance-source change occurred during this run. The selected membership,
primary reads, foreign-ID and residual scopes remain exactly those in the matrix;
global settings, protected indirect widgets and provider actions retain their
explicit NOT_TESTABLE status. **PARK_DAR_RELEASE_READY = HOLD** and
**GLOBAL_MODEL_COMPLETE = false**.

Historical run **`d06_1789239219113_74dc2d`** first completed all 161 API
scenarios with 147 PASS / 14 FAIL and 339 requests. Its final `result.json` remains
available with cleanup/source-stability PASS; it is superseded only as the current
checkpoint, not deleted or reclassified.

Historical repeat **`d06_1789240335521_4b0509`** also completed this API module:
161 scenarios, 147 PASS / 14 FAIL, 339 HTTP requests, Node `v22.22.2`.
Its `result.json` confirms cleanup and unchanged-source PASS. This repeat is
retained as API evidence; it is not designated the final whole-harness acceptance
because the separate browser portion required a further frozen-source repeat.

The first complete actual-app run was
`d06_1789237804071_f534c5`, using Node `v22.22.2`, full application startup and
353 real migrations. Command:

```powershell
wsl -d Ubuntu -u postgres -- env SYS_MB_D06_LOCAL=true node '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912/tests/acceptance/run-sys-mb-local.cjs'
```

Evidence directory:
`.codex-temp/sys-mb-d06/runs/d06_1789237804071_f534c5/`.
`result.json` and `records-in-progress.json` contain **123 core API PASS, 0 FAIL**,
covering **280 actual HTTP requests**. The harness confirmed database cleanup and
source stability. These counts exclude the separate readiness and browser modules;
their failures prevent an overall acceptance claim. They also exclude the 14
additional warehouse residual probes added after source review.

The preceding run `d06_1789237617237_b811eb` failed during synthetic fixture setup
because the fixture referenced nonexistent `leads.customer_id`. The fixture was
corrected to insert the real `lead_customer_links` relation. No runtime column or
schema was fabricated. The failed run and cleanup evidence are retained.

After adding the residual fixture, its **21 INSERT statements / 153 column
references** were checked against the completed application's `schema.json`:
zero missing columns. Node 22 `--check` passed.

The next actual-app run **`d06_1789238394299_b3209e`** used the same command above.
Its final `.codex-temp/sys-mb-d06/runs/d06_1789238394299_b3209e/result.json`
and `records-in-progress.json` record:

| Set | PASS | FAIL | HTTP requests |
| --- | ---: | ---: | ---: |
| Core IDs `domain`, `aggregate`, `auth`, `lifecycle`, `containment` | 123 | 0 | 280 |
| Additional `warehouse_residual` IDs | 0 | 14 | 14 |
| API module at this run | 123 | 14 | 294 |

The final result confirms `cleanupVerified: true` and the
`acceptance-source-stability` record is PASS with `changed: []`. No prior fixture
PASS was added to these totals. Browser/readiness results are separate and remain
the parent acceptance report's responsibility. **PARK_DAR_RELEASE_READY = HOLD;
GLOBAL_MODEL_COMPLETE = false** because the enabled adapter exposes foreign stock.

## Remaining enabled-module coverage increment

An enabled-module audit found `dashboard`, `settings` and `omni` in the actual
fixture business registry alongside the core domains. The module adds
**24 `enabled_extra.*` scenarios**, all **PASS in actual run
`d06_1789239219113_74dc2d`**: six dashboard
widget reads, six business-settings reads, nine Omni list/context/message reads
and three groups of inaccessible-organization checks. Each positive collection
must contain its owned sentinel; an empty response alone cannot pass. Context
details require the exact seeded customer, lead and booking relationships.

The seed adds one explicitly owned conversation and one inbound text message per
business, using the real `conversations` and `conversation_messages` tables. The
channel value is synthetic fixture metadata, not a provider connection. Required
columns and enum/check values were verified against full startup `schema.json`
and migrations 052/356. All **23 INSERT statements / 166 column references** map
to real schema columns, with zero missing columns; Node 22 parser check passes.
No settings row is inserted or changed for the settings-read probes.

The positive-read coverage is deliberately explicit:

| Surface outside the 24 primary read probes | Status | Reason and remaining scope |
| --- | --- | --- |
| Dashboard global `staff_today`, `hr_overview`, `content_pipeline`, `operations` widgets | NOT_TESTABLE in this increment; source-known residual scope | They include HR/Art/global procurement adapters and are not certified by task/lead widget PASS. Existing actual readiness/warehouse exposures already keep release HOLD. No new protected fixture or widget expansion was authorized for this increment. |
| Global settings key API, chat/AI/provider settings, Telegram/HR settings panels | NOT_TESTABLE | The generic `/api/settings/:key` read uses a global key and management policy. Scoped cabinet/timeline reads do not prove per-business ownership of global settings. No secret/config/provider endpoints are called or response values collected. |
| Omni provider account connection, attachment retrieval, message send, AI analysis, webhooks and delivery jobs | NOT_TESTABLE | The module only reads locally stored synthetic inbox data. No provider credentials, channel connection, send, attachment download, AI call or webhook request is used; these require their separate protected integration scope. |

These additional 24 scenarios issued **45 actual HTTP requests**, including the
foreign-ID and inaccessible-organization checks inside each scenario. The current
module total is **161 scenarios / 339 requests**: core123 PASS, enabled-extra24
PASS and warehouse-residual14 FAIL. No fixture/schema-only result is promoted to
PASS, and the excluded surfaces above remain NOT_TESTABLE.

## Warehouse residual: source finding and controlled reproducer

The warehouse page calls `loadWarehouseContractors()` during initialization.
`routes/contractors.js` and `routes/procurement.js` authenticate and check management
roles but do not scope their list/detail SQL by business or organization. Both
files are unchanged from the base HEAD (`git diff --exit-code HEAD --` for these
two paths passed), so this is an existing unclosed surface, not a D06 runtime
regression. The ordinary core stock endpoints' PASS does not cover this adapter.

The actual schema has no owner column on `contractors`, `procurement_lists` or
`procurement_items`. The fixture creates two explicitly **UNASSIGNED_GLOBAL_ROW**
sets, one associated with a known Park stock/location and one with a known Dar
stock/location. Names, target locations and `created_by` are not evidence that the
legacy row belongs to either business. Contacts and tokens are left NULL. No
message, order creation API, export or provider action is invoked.

Read-only reproducer, executed in the second complete run:

1. Sign in as the non-platform organization-1 owner and request Park/Dar, then as
   the organization-2-only director and request its custom context. The harness
   sends `X-Business-Context` and a real login JWT for the selected synthetic actor.
2. GET `/api/contractors` and `/api/procurement`; inspect only the synthetic IDs.
   Expected: explicit unavailable response or exclusion of unassigned rows.
3. GET `/api/contractors/:unassignedContractorId/order-context?stockItemId=:foreignStockId`.
   Verify the stock's stored `business_context` independently in PostgreSQL.
   Expected: 403/404 or no foreign stock. The other organization must never receive
   the Park/Dar record.
4. Repeat using `?procurementItemId=:syntheticItemId`; the linked stock must obey
   the same rule. This exercises an indirect reference read, not a mutation.

The probes record HTTP status, requested context, returned synthetic IDs, and the
known stored stock owner, without retaining message drafts or arbitrary response
rows. All 14 returned **HTTP 200** and failed their isolation assertion. Exact paths
below are relative to the disposable harness's ephemeral loopback base URL, not a
production URL; those fixture IDs no longer exist after cleanup.
All 14 were reproduced again in final run `d06_1789240691369_eeb5a9` with the same
synthetic IDs and paths listed below. Its final `result.json` contains the matching
`warehouse_residual.*` records and stored-versus-returned ownership evidence.

| Defect / severity | URL path and requested context | Expected / actual | Evidence IDs and candidate |
| --- | --- | --- | --- |
| D06-WH-01 / P1 | `/api/contractors`, under `event_genix`, `dar`, `d06_other` | Unassigned rows unavailable / synthetic contractor IDs `2,3` returned in all three contexts | `warehouse_residual.<context>.contractors.unassigned_list`; `routes/contractors.js:29` |
| D06-WH-02 / P1 | `/api/procurement`, under the same three contexts | Unassigned rows unavailable / synthetic list IDs `1,2` returned in all three contexts | `warehouse_residual.<context>.procurement.unassigned_list`; `routes/procurement.js:214` |
| D06-WH-03 / P1 | `/api/contractors/2/order-context?stockItemId=3`, under `dar` and `d06_other` | Foreign owned stock denied / stock `3`, stored and returned `business_context=event_genix`, exposed | `warehouse_residual.<context>.event_genix.direct_stock`; `routes/contractors.js:136` |
| D06-WH-03 / P1 | `/api/contractors/3/order-context?stockItemId=4`, under `event_genix` and `d06_other` | Foreign owned stock denied / stock `4`, stored and returned `business_context=dar`, exposed | `warehouse_residual.<context>.dar.direct_stock`; same source |
| D06-WH-04 / P1 | `/api/contractors/2/order-context?procurementItemId=1`, under `dar` and `d06_other` | Indirect foreign stock denied / item `1` resolves and returns Park stock `3` | `warehouse_residual.<context>.event_genix.procurement_stock`; `routes/contractors.js:147` |
| D06-WH-04 / P1 | `/api/contractors/3/order-context?procurementItemId=2`, under `event_genix` and `d06_other` | Indirect foreign stock denied / item `2` resolves and returns Dar stock `4` | `warehouse_residual.<context>.dar.procurement_stock`; same source |

The known-owner evidence applies to `warehouse_stock`, not the global contractor
or procurement row. Thus WH-01/02 demonstrate missing quarantine; WH-03/04 prove
actual cross-business and cross-organization data exposure. Both are release
blockers under the D06 enabled-domain criterion. No unauthorized write has been
claimed or attempted. Their entire route sources match base HEAD, so these are
existing gaps uncovered by independent acceptance, not regressions introduced by
the D06 fixture or runtime changes.

## Precise next containment scope

The smallest defensible follow-up is a separate contractor/procurement
containment patch, not a stock-price or ownership backfill patch:

1. Add explicit legacy surface descriptors for these two currently unowned
   domains to `services/legacyBusinessSurface.js`, then apply the established
   fail-closed guard at each router's entry after fresh authentication and before
   its first domain query/action. Membership Park/Dar/custom and unknown context
   must receive a stable 403 unavailable code; registry dependency failures must
   remain 503. Do not guard the entire working warehouse router.
2. Cover the whole router boundary, including detail/overview, indirect
   `order-context`, procurement suggestions and mutation entrypoints. Blocking
   only the observed list or direct-stock query would leave unowned contractor
   metadata and other adapters open. Preserve the existing explicitly supported
   pre-cutover legacy policy; do not infer an owner from `created_by`, locations,
   names, default context or contacts.
3. Retain the 14 red actual-app probes as regression tests and add focused denied
   mutation tests that verify zero row/provider effects using local sentinels.
   Verify registry failure, pre-cutover compatibility and fresh post-cutover
   denial. Adapt warehouse contractor/procurement loading to an explicit
   unavailable state without changing shared theme/navigation.
4. Inventory `procurement_items`/`procurement_lists`/`contractor_stock_links` and
   contractor tasks/ratings/escalations separately before any complete migration.
   An approved historical owner mapping and sharing policy are still required;
   this acceptance does not assign those owners or approve a new schema.

Expected files: `routes/contractors.js`, `routes/procurement.js`,
`services/legacyBusinessSurface.js`, focused acceptance/route tests and, if needed,
only the page-local warehouse unavailable state. External message handlers exist
inside the contractor router, so a router-wide ingress denial needs the exact
bounded authorization for that protected boundary before editing; it must not
change Telegram payloads, contacts, provider configuration or send real messages.
HR references, schema migration and full contractor/procurement lifecycle
ownership remain separate scope. No runtime containment patch is included here.
The report does not authorize changes to authentication, authorization rules,
roles, sessions, protected manifests, HR, payroll/payments or provider contracts.
Fresh authentication is exercised through the existing real APIs; a future guard
must be reviewed within its exact approved boundary, without weakening existing
role or membership checks. No historical row owner may be inferred to make a red
probe pass.

## Final source-bound parent checkpoint

The authoritative final acceptance run is **`d06_1789241525527_7d4a50`**: [result.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789241525527_7d4a50/result.json), [source-state.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789241525527_7d4a50/source-state.json). Full actual-app acceptance records: **173 PASS / 23 FAIL / 1 NOT_TESTABLE**. Cleanup verified; source stability PASS with no changes. See [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md) and [D06_VERIFICATION.json](D06_VERIFICATION.json) for final decisions and hashes. Earlier run references above are retained measured history, not substitutes for this final run.

The unchanged API module executed161cases: **147 PASS / 14 FAIL / 0 NOT_TESTABLE**, 339 actual requests. All14 warehouse residual failures remain; exact known-owner and unassigned-row evidence is in this run's matching records.
