# SYS-MB-D03 — Business cabinet management

Date: 2026-09-12. Status: **READY_LOCAL_BUSINESS_CABINET_REVIEW**.
Production cutover remains **HOLD_REMAINING_DOMAIN_GAPS**.

## Checkpoint and isolation

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
- Branch: `codex/sys-mb-auth-p0-20260912`.
- HEAD/base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
- All 111 source SHA256 entries from `LEGACY_CONTAINMENT_VERIFICATION.json` matched before this increment. Its report, manifest and evidence remain historical checkpoints.
- Changes remain cumulative and uncommitted. There is no D03 implementation commit to cherry-pick. Local version `0.81.132` is an unreleased marker, not a live-site claim.
- No schema, protected booking identities/field priorities/renderer ownership, formulas, shared menu/router/theme design, HR implementation, dependencies, secrets or provider configuration were changed in this increment. Existing earlier changes in those files were preserved.
- The current task authorizes local D03 lifecycle/module access changes. No production authorization was exercised: no commit, push, CI, deployment, production preflight/data changes or credentials loading.

## Implemented behavior

### One registry, explicit module configuration

`services/businessModuleRegistry.js` separates module availability from employee capabilities. A configured module never grants a role, page override or action permission.

| Input / state | Meaning |
|---|---|
| Business creation omits `modules` | Store an explicit empty array; no operational modules are enabled |
| Stored `modules=[]`, missing or invalid membership projection | No module access; no fallback to Park defaults |
| Configuration PATCH omits `modules` | Keep the existing configuration |
| PATCH supplies supported identifiers | Replace the configuration with the validated, deduplicated array |
| Unknown or unsupported new identifier | HTTP 400; no partial update |
| Existing unsupported identifier | May be retained during editing, but remains unavailable at runtime |
| Historical compatibility account | Retains the built-in compatibility behavior; unknown keys have no built-in defaults |

Configurable core modules are dashboard, timeline, tasks, customers, leads, finance, programs, warehouse and settings. Omni is explicitly limited to its existing scoped workspace; enabling it does not certify provider ingress or grant integration actions. Graduation is limited to the existing Park/Dar implementation, with booking conversion supported only for Park. Custom graduation and the remaining legacy/global modules are unavailable for new enablement.

These descriptors define configuration eligibility, **not complete security certification of every endpoint in a domain**. D01/D02 containment and the remaining D04/D05 inventory still apply.

Fresh membership modules gate the managed operational API routers for bookings/lines/history, tasks, customers, leads, finance, products, warehouse, dashboard and Omni. All selected aggregate businesses must allow the requested module. Dedicated timeline/graduation guards apply the same registry; role checks remain independent. Dedicated legacy containment retains its specific errors. Actorless/provider and unmigrated domain entrypoints remain separate D05 work, not newly certified by this middleware.

The old cabinet Settings screen now reads the same registry map. Module controls are read-only there and link to profile management. A changed `modules`, `businessModules` or `moduleMap` payload receives `400 business_modules_managed_by_organization` before writes; an unchanged echo permits the existing timeline/type editing workflow. Dashboard/settings are not silently forced on for an empty membership configuration.

### Owner/admin lifecycle and UI

- `GET /api/organizations/management` lists only organizations the current actor can manage, their businesses, module descriptors and separate management capabilities.
- `PATCH /api/organizations/businesses/:businessId/configuration` changes labels and modules under current owner authority, the existing ownership transaction lock and strict audit. Organization/context identity is immutable.
- `POST /api/organizations/businesses/:businessId/initialize-resources` explicitly initializes resources for an active, timeline-enabled business, under owner authority and audit.
- Existing create/status/member/default/organization-role routes and the last-owner rules are retained. Admin can manage ordinary workers within the existing policy, but business creation/configuration/status/initialization is owner-only. Existing platform creator technical authority is unchanged.
- The profile integrates `BusinessCabinetManager` with the existing `BusinessMembershipManager` and `AccountAccessEditor`. It supports organization selection, create/configure/deactivate/reactivate, modules and explicit resource initialization. An existing account can be selected by exact ID for membership assignment; there is no global account search, account creation or invitation sending.
- Membership activation, different business roles, default business and organization roles continue through the existing editor. Creating a business does **not** automatically grant its owner an operational business membership.
- Server and client recovery exceptions cover the exact management/configuration/initialization routes even when the owner has no operational business. Operational writes remain denied.
- Dirty drafts, save errors, late responses, changed account/context, keyboard focus and disabled controls are handled. Unsupported modules appear in a closed native disclosure rather than a long initial form.

### Custom context and branding

Membership labels and module settings come from fresh business records. Business profile and cabinet aliases agree on module state and timeline availability. An empty cabinet opens profile recovery rather than a disabled operational start page.

Custom timeline keys retain their own API/storage namespace and use a simple timeline default. The timeline client now gives a fresh, ready membership profile precedence over the historical root Park pin. The compatibility root behavior is retained. Membership Park branding also follows the registry while keeping its existing page capability and storage namespace.

Explicit custom graduation and an omitted context with the same active custom business both deny access. Injecting `graduation` into its fixture DB configuration does not enable the unsupported module. The Products catalog projection omits unavailable graduation and performs no graduation count query. The Products catalog container still requires `programs`; enabling `graduation` alone does not grant access to Products.

### Explicit resource initialization

Timeline resource list, availability and mode-line reads no longer create default resources. `initializeTimelineResources(transactionClient, context, {types})` uses a per-context/type advisory lock and `ON CONFLICT DO NOTHING`. It preserves existing edited/inactive resources, serializes repeated initializations and participates in the caller's rollback/audit transaction.

Known preset resources are initialized only for an empty resource type. Existing rows are not filled in or overwritten. A custom business returns `no_defaults`; it does not inherit Park names or capacities. Its resources can then be entered through the existing scoped resource editor by an employee with the required business role.

**Read-only acceptance here applies to resource GETs.** Pre-existing graduation diploma template/children/preview/export GET handlers can still create packs/templates or export audit/status records. They were not redesigned in this task and must not be used as read-only live QA probes. Provider/export workflows remain outside this increment.

## Verification

Local runtime: Node 22.23.1 / npm 10.9.8. Isolated PostgreSQL tests use WSL Node 22.22.2/PostgreSQL 16, uniquely owned disposable databases, and verified cleanup. No production `DATABASE_URL` fallback was used.

Final machine-readable results and source/evidence SHA256: `BUSINESS_CABINET_VERIFICATION.json`.

| Final check | Result |
|---|---|
| `npm test` | PASS, exit 0; runtime/version/access/surface/migration/protected-booking guards included |
| Parser | 1,199 JavaScript files, PASS |
| Core unit stage | 2,916 PASS, 0 FAIL/SKIP |
| Existing legacy containment stage | 67 PASS |
| New business cabinets stage | 27 PASS |
| My Day regression stage | 337 PASS |
| UI/static smoke | 1,312 assertions and 4 Node tests, PASS |
| D03 actual HTTP/PostgreSQL | Lifecycle/Settings 8; resources/module/catalog boundaries 12; all PASS |
| Existing PostgreSQL regressions | Timeline 16, finance 13, customers/leads 7, containment 11, profile 13, warehouse/products 8; all PASS |
| PostgreSQL total | 88 tests including parent tests; 0 skips, reruns not counted twice |
| Chromium synthetic UI | 9/9 PASS; six safe light/dark screenshots |
| Whitespace diff check | PASS with repository CRLF handling retained |

The new checkpoint covers 126 cumulative source files: 24 changed prior sources and 15 newly touched sources in D03; 87 of the previous 111 source hashes are unchanged. All final source/artifact hashes were re-read after the baseline finished. The incremental source list is recorded in the manifest.

- Targeted registry, lifecycle, resource, frontend, Settings parity and timeline-client tests are part of the baseline through the dedicated `test:unit:business-cabinets` stage. A separate stage avoids the existing Windows command-length limit.
- Actual HTTP/PostgreSQL covers two organizations, differing roles, fresh membership/module changes with the same JWT, empty configs, denied writes before domain SQL, owner recovery, strict audit rollback and concurrent/idempotent initialization.
- Existing D01/D02 finance, customers/leads, warehouse/product, profile and containment PostgreSQL regressions were repeated. Fixtures that formerly omitted modules now explicitly enable only the domain being tested; existing denial assertions were retained.
- Chromium synthetic UI: 9 scenarios, including the real shared access editor, owner/admin, two organizations, exact account assignment/default, retry/stale responses, keyboard and 390/768/1440 light/dark. Six safe screenshots are in `output/playwright/business-cabinet-<width>-<theme>.png`.
- Initial failures and rerun logs are retained in `.codex-temp/sys-mb-d03/`. They included obsolete fallback assertions and test fixtures without explicit module configuration. The final manifest distinguishes final successful runs from historical attempts.
- Fixtures are local evidence. **Live QA, CI and production deployment: NOT_RUN.**

## Deferred live QA scenario for continuation task 7

1. After a separately authorized release, verify the exact live SHA/branch/version before signing in with approved synthetic owner/worker accounts.
2. As owner, open profile management, select the approved test organization, create a uniquely named test business with no modules. Confirm it appears without implicit employee membership or operating access.
3. Enable timeline/tasks (and programs only if testing Products); rename the business. Reload and verify labels/module availability. Attempt unsupported module enablement and confirm rejection without writes.
4. Initialize resources twice. Known presets must not duplicate or reset resources; custom business must report no preset. Create any necessary resource only within the separately approved synthetic-data envelope.
5. Assign the already provisioned synthetic worker by exact ID through the existing access editor. Give different roles in two businesses and choose a default. Verify navigation, direct API denial, root refresh/back/forward and data partitioning.
6. Change module configuration or deactivate membership while the worker keeps the same session. The next API request must reflect the change. Verify owner recovery without an operational membership and rejection of operational writes.
7. Check light/dark, 390/768/1440, keyboard, empty/error/retry and stale-context behavior. Do not run diploma export/preview, messaging, payment or production customer operations under a read-only QA authorization.

This scenario is preparation, not permission to create live accounts/businesses/resources or change live memberships.

## Remaining work and handoff

- **READY_LOCAL_REVIEW:** D03 cabinet lifecycle, registry/UI parity, custom context and explicit resource initialization.
- **READY:** continuation task 2 / D04 service-level related-record ownership. The protected generic booking linkage part still needs its own exact authorization if a protected change is required.
- **READY_ANALYSIS:** continuation task 3 / historical ownership and public/background policy decisions.
- **BLOCKED_DEPENDENCIES:** ownership migrations, unclassified HR/payment/provider/chat domains, remaining MD/CRM cutovers and compatibility removal. No ownership was inferred or backfilled here.
- **NOT_RUN:** release, production preflight and live QA. This cumulative worktree still needs the later exact-candidate release process and an authorized production envelope.

Next executor: verify `BUSINESS_CABINET_VERIFICATION.json` against this same cumulative worktree, retain its uncommitted files, then execute task 2 from `CONTINUATION_TASKS.md`. Do not reset to HEAD or repeat completed D01–D03 work.
