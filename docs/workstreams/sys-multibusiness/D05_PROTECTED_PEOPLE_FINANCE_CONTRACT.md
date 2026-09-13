# D05 protected people, payroll and certificate contract

Date: 2026-09-12. Source branch: `codex/sys-mb-auth-p0-20260912`.
Base: `a5180def01a1e47f8f4fc75e2f7a43092f205828` plus the cumulative local SYS-MB checkpoint and current D05 work. This is a read-only contract/reproducer package, not an implementation approval or release certificate. No protected runtime file, DB schema, HR/payroll record, amount, formula, permission or provider setting was changed for this package.

**Decision: HOLD for full SYS-MB completion.** The registry labels staff/HR/payroll/certificates `not_migrated` and prevents enabling them through cabinet module configuration. Several actual APIs still reach global readers. Narrow finance containment does not make the remaining domain unavailable. OWN-07 in `DECISIONS.md` is still PENDING; no real domain owner, historical staff/certificate mapping or allocation policy has been supplied.

## Status and verified boundary

Status is per entrypoint; it is not inferred from a menu label. `BLOCKED` below means an executable containment guard on the stated path, or an explicitly identified pending implementation. `NOT_MIGRATED` means no complete owner boundary; it does not imply that the API is unreachable.

| Surface | Status | Source of truth / ownership evidence | Current boundary and remaining gap |
| --- | --- | --- | --- |
| Finance account/category/booking reference operations | SUPPORTED, narrow existing boundary | `finance_accounts`, `finance_categories`, `finance_transactions`, `bookings.business_context`; current `routes/finance.js` | Scoped parent/ref reads and transactions. Existing actual-auth HTTP/PG tests pass. This does not certify notification/provider delivery or all finance ingress. |
| Membership finance transaction `staffId` / `certificateId` | BLOCKED, contained | `validateFinanceRelatedReferences` in `routes/finance.js` | Membership requests with nonempty staff/certificate refs return 403 `finance_reference_not_migrated` before insertion. Compatibility retains its existing behavior; ownership has not been backfilled. |
| `/api/finance/report/salary` | BLOCKED, contained for membership | `services/legacyBusinessSurface.js`, `routes/finance.js` | `finance_salary_not_migrated`; only the separately constrained pre-cutover Park compatibility path can call the global salary reader. This is not a guard around the payroll service itself. |
| Staff roster, schedule and HR entrypoints | NOT_MIGRATED, reachable read gap | Global `staff` identity; `staff_schedule`, `hr_shifts`, employee-profile links and HR services | `/api/staff` has authenticated global roster SQL without an organization/business owner predicate. Role/action requirements on other HR routes are not record ownership. No active HR work was edited. |
| Payroll workspace/previews/settlement/report generation | NOT_MIGRATED, reachable read gap; protected writes unverified | `services/payroll.js`, `services/payrollSettlement.js`, `payroll_reports` and profile/scheme sources | Reports retain global `(period_month, staff_id)` identity. Multiple readers take month/staff ID but no tenant/actor scope. Role/action guards do not allocate salary to a business. |
| Payroll installment confirmation/reversal | NOT_MIGRATED for complete domain; existing local safeguards retained | Migrations 302/304, payroll installment business allocation and finance movements | Existing explicit business access, resolved allocation, matching context, balance/period guards, transaction locks and idempotency checks must be preserved. They do not prove staff/report organization ownership. No payment was attempted in this audit. |
| Certificate private API / public-like code lookup behind authentication | NOT_MIGRATED, reachable read gap | Global `certificates.id`, unique `cert_code`, global recipient identity query | List, code and validate readers do not select a tenant owner. Issuer account/name and linked customer are attribution/links, not an approved owner mapping. |
| Certificate use through supported bookings/customers | NOT_MIGRATED, enabled-path gap | `routes/bookings.js`, `routes/customers.js` | Park booking creation still reads/consumes global certificate code; booking deletion restores by certificate ID. Customer detail/count/merge/unlink operations reach certificate rows via customer ID only. Hiding the certificate module does not contain these paths. Runtime mutation reproductions were not run. |
| Certificate expiry/Telegram send and redemption | NOT_MIGRATED; implementation BLOCKED with provider/HR coordination | `services/scheduler.js` expiry; `routes/certificates.js` after-commit sends; `routes/telegram.js` certificate callbacks | Global expiry and unowned delivery destinations remain outside this package. Provider ingress and notification package must share the eventual certificate owner; no real provider call was made. |

## What the current code actually does

### Entry guards and module registry

`server.js` mounts `/api/staff`, `/api/hr`, `/api/payroll`, `/api/certificates` after the API auth boundary and business write guard. `middleware/auth.js` resolves fresh membership and invokes `requireBusinessScope` and `requireRequestBusinessModule`. However, `services/businessModuleRegistry.js` maps only operational routers in `OPERATIONAL_API_MODULES`; staff/HR/payroll/certificates are not mapped. `requestBusinessModule` returns null for these prefixes, so that module guard does not reject the request. Their remaining role/action/authentication guards still apply.

The local characterization loads the actual six selected route registrations, runs the actual business-scope/module/action guards, and injects a principal produced by the current membership resolver. It does not run JWT loading or the full app. All DB/service reads are synthetic stubs, not production records. This proves the selected handler/gate gap with controlled inputs; it is not proof of a live exploit or a production row count.

### Staff and HR ownership

- `db/index.js` creates global staff IDs; `staff_schedule` is unique by `(staff_id, date)`. `db/migrations/007_hr_module.sql` uses staff/day identities for shifts/time records.
- `routes/staff.js` GET `/` queries the shared roster, account-link metadata and descriptor-presence flags without a business predicate. Department, role type, company structure node and active/freelance filters are not a proven organization mapping. No face descriptors, phone data or real roster were fetched for this task.
- Staff creation/update/deactivation, schedule mutations, check-in and account lifecycle have their own permissions, locks and lifecycle protections. Preserve last-owner/account-offboarding guards already implemented in SYS-MB. A business membership is access to software, not employment or pay allocation.
- Relevant direct service callers include `services/staffScheduleMutations.js`, `services/staffLifecycle.js`, `services/hrPayrollProfiles.js`, `services/hrPayrollPeriod.js` and the current `routes/hr.js` payroll adapters. Adding a filter only to one roster endpoint would leave these callers unaddressed.

### Payroll and finance invariants

- `services/payroll.js` `fetchStaffList`, `buildPayrollContext`, `getSalaryReport`, `getPayrollWorkspace`, `getPayrollPreview`, `getPayrollRangePreview` use global staff/report inputs. Staff ID filtering after calculation is not an organization guard.
- `services/payrollSettlement.js` `loadPayrollSettlementReadModels(month, db)` selects reports by month and includes installment/movement metadata. It does not accept a requested organization or permitted report set.
- Besides `/api/payroll/*`, `routes/staff.js` GET `/payroll` and `routes/hr.js` payroll summary/generation paths call the same service. `routes/finance.js` blocks its own salary adapter only.
- Migration `183_payroll_schemes_workspace_v1.sql` establishes report uniqueness `(period_month, staff_id)`. Migration `302_payroll_installments_foundation.sql` distinguishes unresolved allocation from single-business allocation, stores installment `business_context`, and gives payment movements a globally unique idempotency key and unique finance transaction reference. Do not silently change these identities to partition existing salaries.
- Existing payroll code rejects unresolved/mixed business income or allocation instead of simply summing it. Approval compares the calculation context and current source fingerprint; confirmation/reversal validate business access, installment context, finance account/category, period and balance. Idempotent replay compares target, business, amount, date, method, account/category, reason and description. Existing period/row locks and DB movement/finance invariants are meaningful protections, not a complete organization model.
- `assertFinanceTransactionNotPayrollManaged` prevents generic finance edit/delete from bypassing the canonical payroll payment workflow. Keep that denial, ledger history and all formulas unchanged.

### Certificates and indirect ingress

- `db/index.js` defines a globally unique certificate code; later certificate migrations add booking/customer/source metadata without establishing a durable business owner. Do not infer historical issuer ownership from the issuing username, current user membership, linked product or linked customer.
- `routes/certificates.js` handles issuance/batches, status/update/delete and provider sends. Issuance has a transaction and generated certificate/batch identity. A new request-generated batch UUID is not a stable replay key for retries after an ambiguous response. Status checks occur before the status transaction and are not a tenant-bound redemption service. The characterization does not assert that a race was reproduced.
- `routes/bookings.js`: `parkSideEffectsAllowedForContext` tests the Park context, not pre-cutover compatibility. Creation reads `cert_code` with `FOR UPDATE` then marks it used; deletion restores a used certificate by stored ID. Existing booking/customer ownership checks do not prove the certificate belongs to that owner.
- `routes/customers.js` certificate detail/counts and merge/unlink updates use customer IDs. A scoped customer is not permission to expose/mutate an unmapped certificate linked historically to it.
- `services/scheduler.js` expires active certificates globally. `routes/certificates.js` sends to global certificate/director/fallback chat settings after commit. `routes/telegram.js` processes certificate redemption callbacks. These are direct/background ingress paths; all must consume the same future owner contract. Notification/provider work is coordinated with the other D05 packages, not implemented here.

## Required business decisions; recommendations are not approval

These refine OWN-07, without changing its PENDING status or assigning a person as owner.

| Decision required | Recommended direction to review | Why it cannot be implemented by guessing |
| --- | --- | --- |
| Staff identity: organization employer, business employer, or explicitly shared employment? Who may see personal HR fields? | Keep account identity separate from employment. Review an organization-owned staff identity with explicit effective-dated business work assignments and separate permission to read organization HR data. | An employee may work in two businesses without having a CRM login; login membership neither proves employment nor allocates a wage. Existing company nodes and HR identifiers need verified mapping first. |
| Payroll report owner and multi-business work allocation, historic versus future periods | Preserve a single canonical employment/payroll obligation until finance approves explicit business allocations; unresolved/mixed allocations remain unpayable. Decide whether a report is organization-owned with allocations or separately payable per business before changing unique keys. | Splitting a report or filtering its sums could duplicate an obligation, omit hours, change rates or move costs. Existing approved/paid periods and installment links require a frozen mapping and reconciliation. |
| Certificate issuing owner, redemption network and accounting owner | Review issuer-business ownership with no implicit cross-business redemption. Any shared redemption network must be explicit, organization-limited and financially approved. | Existing certificates may have historical promises to customers. Applying a new default could invalidate access or record revenue against the wrong business. Code uniqueness and recipient-uniqueness policy need an explicit decision. |
| Historical unowned/mixed records and compatibility exposure | Restricted inventory/mapping with reviewed quarantine rules; no automatic Park backfill. Keep unresolved data unavailable to newly isolated business APIs. | Task 3 has synthetic evidence only. Actual owner counts/relationships, exception lists and responsible domain maintainer are not available. |
| Jobs, staff/certificate notifications and provider destinations | Persist approved organization/business + source record + recipient/destination binding, then revalidate before delivery/retry. | A global chat, requester role or default business is not a trustworthy destination owner. Provider policy belongs to the integration package. |

## Concrete next implementation scopes

No proposed block below is active authorization. The domain maintainer and owner approver are **UNASSIGNED** pending OWN-07; do not replace this with an invented person. Coordinate with the active HR/payroll stream before file ownership is accepted.

### PEOPLE-CONTAINMENT: close the exposed paths before claiming unavailable

Proposed files: `services/businessModuleRegistry.js` or a dedicated domain containment helper, `routes/staff.js`, `routes/hr.js`, `routes/payroll.js`, `routes/certificates.js`, and selected certificate adapters in `routes/customers.js`. Also list all direct/background callers before enabling any exception.

Minimal behavior: deny unsupported membership-mode domain requests before global reads, exports, writes, calculations, provider preparation or history side effects; give a stable domain-specific unavailable code. Preserve account recovery and last-owner safeguards. Do not let an unmapped route bypass the gate. Any compatibility exception needs an explicitly reviewed domain source/owner policy; do not use current creator role as a global-data bypass.

Dependencies: OWN-07 scope/maintainer and exact auth/HR/payroll/certificate containment approval; source-level route inventory expanded to all actual adapters. A route-level denial is useful temporary containment, but direct services must also fail closed when called without an approved execution scope. The eventual shared organization HR workspace requires its own explicit permission contract rather than weakening business boundaries.

Missing approval: a new explicit **SYS-MB-PEOPLE-CONTAINMENT** scope naming these auth/HR/payroll adapters and their before-read denial behavior; local work only unless a separate release block is authorized. No HR record mutation, rates, payment execution or migration is included.

### PEOPLE-OWNERSHIP: staff identity and payroll allocation

Proposed files: an additive migration with number chosen from the then-current branch; current `services/staffLifecycle.js`, `services/staffScheduleMutations.js`, `services/hrPayrollProfiles.js`, `services/hrPayrollPeriod.js`, `services/payroll.js`, `services/payrollSettlement.js`; their `routes/staff.js`, `routes/hr.js`, `routes/payroll.js` callers and focused tests. Reuse existing lifecycle/calculation services, not a second payroll engine.

Minimal contract after approval: pass a server-resolved organization/business execution scope into service methods; lock/check the staff/report/assignment parents inside the transaction before read/write; retain effective employment and assignment periods; keep organization HR access distinct from an operational business role. Records without an approved owner are denied/quarantined. Bind idempotency/replay checks and background jobs to their immutable owner and source. Preserve existing global payment-key collision checks, salary formulas, ledger constraints, report states, periods, rounding and settled history. A retry under another tenant must fail before reading or acting on a stored movement.

Dependencies: actual restricted historical mapping; approved employment and allocation policy; partial/rerun/rollback reconciliation plan; coordination with HR and finance owners. Existing month/staff/report/installment uniqueness cannot be changed without that policy.

Missing approval: separate **SYS-MB-PEOPLE-OWNERSHIP-MIGRATION** for exact schema/HR/service changes, plus **SYS-MB-PAYROLL-OWNERSHIP** for protected payroll/ledger authorization and allocation changes. Each future production rollout needs its own current manifest and bounded release/migration approval. No proposed formula change is included.

### CERTIFICATE-OWNERSHIP: issuance, redemption and indirect booking/customer adapters

Proposed files: additive certificate owner/redemption migration after approved mapping; `routes/certificates.js`, `services/certificates.js` or a small transactional certificate persistence service; selected `routes/customers.js` adapters; `services/scheduler.js` expiry block; `routes/telegram.js` certificate callbacks; selected `routes/bookings.js` certificate validation/restoration blocks and corresponding tests. Notification destination persistence is coordinated with the D05 provider package.

Minimal contract after approval: immutable issuer owner; explicitly approved redemption scope; all code/ID/customer/booking joins checked in the certificate service's transaction. Bind creation/retry keys, status transitions and public/provider tokens to the owner. Lock certificate and dependent booking/finance rows in a documented consistent order. A retry/rollback must not consume twice, leave a certificate used without its approved redemption record, restore another redemption, or send a notification before commit. Preserve certificate validity and financial calculations. Customer links are validated references, not inferred ownership.

Dependencies: actual certificate owner/redemption policy and restricted mapping; historical promises/exceptions; provider owner/destination contract; decision on old unowned tokens; protected booking scope coordinated with `LINKEDTO_PROTECTED_SCOPE.md` without mixing its unrelated fix.

Missing approval: **SYS-MB-CERTIFICATE-OWNERSHIP-MIGRATION** for durable certificate policy/schema, separate **SYS-MB-CERTIFICATE-BOOKING-INTEGRATION** naming only certificate consume/restore/finance references in the protected booking transaction and any required protected manifest change, and the exact integration authorization for Telegram/provider jobs. Do not alter booking identity, linkedTo, price/formula, modal rendering or global navigation under this scope.

## Required acceptance matrix for those future scopes

| Check | Necessary evidence |
| --- | --- |
| Same account, different organization/business role | Actual auth + HTTP + PostgreSQL: staff/report/certificate foreign IDs denied; same-JWT role/membership revocation observed; supported reads retain approved response shape. |
| Direct/background service entry | Direct service rejects missing/untrusted scope and cross-organization/foreign parent before query mutation or provider preparation. No fallback to Park, creator or current default business. |
| Employment/payroll allocation | Approved single-business examples preserve amounts; multi-business/unassigned data remains explicitly unresolved until approved; existing paid history and finance movement counts unchanged. Membership changes alone never recalculate salary or move liability. |
| Transactions and retries | Concurrent same-key and changed-owner replay; parent update zero; full rollback; lost-response retry; deactivation between prepare and act. No duplicate movement, orphan allocation, cross-business restoration or pre-commit delivery. Preserve period/lock order. |
| Indirect certificate paths | Booking consume/delete/restore, customer detail/count/merge/unlink, expiry and provider callback all apply the same owner. Disabled/unmigrated certificate paths cannot be invoked indirectly through enabled modules. |
| Migration | Empty, production-like, partial, unassigned/mixed, rerun and rollback preflight on disposable PostgreSQL. Reconcile existing global report keys/payment keys and certificate codes before constraints or backfill. |
| Live acceptance | NOT_RUN here. Only separately approved synthetic identities/records with exact registry/TTL/cleanup; no real salary, payments, staff changes, messages or exports. |

## Executed verification and limits

Commands ran on canonical Node 22/npm 10, with external providers not invoked:

1. `node --test tests/finance-business-isolation.test.js tests/legacy-business-surface.test.js` — **14/14 PASS**, zero skip. Log: `.codex-temp/sys-mb-d05/people-unit.log`.
2. `wsl -d Ubuntu -u postgres -- env BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST=1 node --test '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912/tests/integration/finance-business-isolation-postgres.test.js'` — **13/13 PASS** (12 scenarios plus parent), zero skip. Actual membership auth, loopback HTTP and an exact fixture-owned temporary database; existing test cleans its created database in `finally`. Log: `.codex-temp/sys-mb-d05/people-finance-postgres.log`.
3. `node --test .codex-temp/sys-mb-d05/people-exposure-characterization.cjs` — **4/4 reproduction assertions PASS** (three contexts plus parent), documenting **NOT_MIGRATED_REACHABLE_HANDLER**, not a safety PASS. Each of Park, Dar and custom business in another organization reached six selected read handlers: staff roster/payroll, certificate list/code, payroll workspace/preview. Each run performed six stubbed SELECTs and three stubbed payroll reads, zero source writes and zero external calls. Actual guards and source handler registrations; injected membership principal, stubbed persistence/payroll/display helpers; full JWT/app and real protected tables were not exercised. Log: `.codex-temp/sys-mb-d05/people-exposure.log`.

No production/preproduction read-only dataset was available from Task 3. Actual staff/certificate ownership counts, salary allocations, provider destinations and live role exposure are **NOT_TESTABLE** in this package, not zero. No certificate/status/payment mutation, live QA, provider send, migration, production record change, commit, push or deploy was performed. Scratch reproducer and logs are ignored local evidence; the D05 manifest should record their hashes and this contract alongside the parent task's final source checkpoint.

The next safe step is to assign the OWN-07 domain maintainer/approver and review the concrete containment + ownership scopes above. Full SYS-MB closure remains HOLD until the enabled protected gaps are either demonstrably contained or migrated and verified.
