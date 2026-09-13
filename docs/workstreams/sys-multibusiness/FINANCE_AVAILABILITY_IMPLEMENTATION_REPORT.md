# SYS-MB-05 / D-01 — Finance and resource availability boundaries

Subsequent D-02 analysis and read-only preflight are recorded in [LEGACY_OWNERSHIP_ANALYSIS_REPORT.md](LEGACY_OWNERSHIP_ANALYSIS_REPORT.md). The implementation/results below remain the D-01 checkpoint; use the newer verification manifest for current cumulative hashes.

Date: 2026-09-12. Base commit: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
Branch: `codex/sys-mb-auth-p0-20260912`.
Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.

This continues D-01 from `DOMAIN_ISOLATION_INVENTORY.md`. The scoped implementation is ready for local review; complete operational business isolation remains on hold. The previous domain report and verification manifest describe a historical checkpoint, not the final hashes of this increment.

## Baseline and isolation

- Verified the branch, base and all 74 prior source hashes before edits. Preserved the cumulative P0, lifecycle, streaming, profile/editor and domain changes.
- This increment changes 12 source/test files; the cumulative worktree contains 84 changed source/test files. Exact paths and hashes belong to `FINANCE_AVAILABILITY_VERIFICATION.json`.
- No new migration, dependency, HR-domain, financial formula, protected booking identity/renderer, global navigation/theme, credential, provider or hosting change. Existing migration **357** is used in disposable fixture databases; no migration is added or deployed.
- No commit, push, CI, deploy, live-site QA or production-data operation. `0.81.132` remains an unreleased local marker, not a claim about the site's current version.

## Reproduced defects and changes

| Defect / reproduction | Expected and actual before patch | Implementation / acceptance evidence |
|---|---|---|
| P1: `POST /api/finance/accounts` in Dar | Ownership must be correct in the initial INSERT. Previously the row used the database default, then a separate UPDATE changed it to Dar; a failure could strand it in another business. | `routes/finance.js` inserts `business_context` directly. A PostgreSQL trigger observes Dar ownership despite a deliberately wrong fixture default; an UPDATE-rejecting trigger is never needed. Injected INSERT failure leaves no account or observation row. |
| P1: `POST /api/finance/transactions` with a foreign booking | Foreign/missing booking references must fail before a write or income event. Previously the route accepted a foreign booking with HTTP 201. | Booking, category and account ownership validation and INSERT now share one transaction. Referenced rows are locked while validated. Income publication follows COMMIT. Foreign/missing booking returns `400 / finance_booking_not_found`; rollback tests verify no durable transaction/event. |
| P1: membership transaction references to global staff/certificates | These tables have no durable business owner. Previously membership users could attach their IDs. | Membership-mode POST and retained references in PUT return `403 / finance_reference_not_migrated`. Existing matching legacy compatibility remains; no business owner is inferred from a global role. |
| P1: metadata PUT on a historical transaction with foreign retained references | Omitted reference fields must not bypass ownership validation. Previously a metadata edit accepted a retained foreign booking/account/category. | Membership PUT validates retained booking, staff, certificate, category and effective account before UPDATE. Existing mutable fields, omission behavior and payroll-managed `409` remain. |
| P1: resource availability exposes hidden bookings | `GET /api/timeline/resources/availability` and `GET /api/settings/rooms/free/:date/:time/:duration` must preserve occupancy without disclosing invisible booking details. Previously both projected customer/booking information using only business scope. | Both routes pass the current actor. `services/timelineResources.js` projects the canonical booking-visibility predicate without filtering collision inputs. Hidden entries contain exactly `{time,duration,unavailable:true}`. No booking/customer/group ID or label is returned for them. |
| P2: non-room availability HTTP 500 | Cabinet availability should execute its parameterized query. PostgreSQL rejected four supplied parameters for a three-parameter statement. | Room aliases are bound only for room queries. Actual cabinet HTTP requests pass for elevated and restricted users. |
| P2: header-only legacy CRM context incorrectly rejected | A valid `X-Business-Context: crm` should retain the existing CRM grant. Spreading Express's request lost inherited headers and manufactured Park, leading to HTTP 403. | `services/businessContext.js` passes explicit `body/query/headers/user` into the request resolver, preserving original precedence and the authoritative user. Both a prototype-header regression and real HTTP/PG compatibility pass. |

The finance PUT transaction uses the same booking-before-finance lock order as the canonical booking writer. It first reads the reference, locks that booking, then locks and rereads the finance row. If the booking reference changed while waiting, it returns `409 / finance_transaction_changed` before following a new reference. Independent review found an inversion in the intermediate implementation; it was fixed and covered by two real PostgreSQL lock-concurrency scenarios before final verification. The competing writer models the canonical SQL order; this is not a claim that the entire booking HTTP handler was executed.

Visible booking metadata, linked-child treatment, interval overlap and capacity formulas are preserved. Missing/invalid/mismatched actors receive opaque entries only. The existing UI consumer renders a generic busy booking and cannot attach it as a banquet source without an ID; independent actual-source VM review checked this, not a live browser.

## Files in this increment

- Runtime: `routes/finance.js`, `services/businessContext.js`, `services/timelineResources.js`, `routes/timeline-resources.js`, `routes/settings.js`.
- New tests: `tests/finance-business-isolation.test.js`, `tests/timeline-availability-privacy.test.js`, `tests/integration/finance-business-isolation-postgres.test.js`, `tests/integration/timeline-availability-postgres.test.js`.
- Existing test wiring: `package.json` adds both self-contained suites to `test:unit`; `tests/payroll-finance-workflow-contract.test.js` expects the transaction client for the existing PUT payroll guard; `tests/timeline-resources.test.js` supplies explicit visible actors in affected fixtures. No assertion was removed.

## Verification and limits

- Full final `npm test`: **PASS, exit 0**, Node **22.23.1** / npm **10.9.8**. Runtime/version and configured ownership/governance gates passed, parser **1177** files, unit **2902**, My Day **337**, UI/static **1312**, loader **4**; zero failures. No source edits followed this run.
- Finance unit reproduction before the patch: three of five scenarios failed. Actual PostgreSQL reproduction: four scenario failures plus the failed parent test; Dar ownership, foreign booking, global staff reference and retained foreign reference were reproduced.
- Availability privacy reproduction before the patch: four of four scenarios failed.
- Final finance focused route/permission/payroll regression: **131 PASS**. The subsequent prototype-header addition and shared resolver regression: **69 PASS**. These runs overlap and must not be summed as unique cases.
- Final timeline availability/resource focused regression: **128 PASS**. Protected source guard: all **six blocks PASS**.
- Final actual HTTP, fresh membership authentication and disposable PostgreSQL: finance **13 PASS** (12 scenarios + parent), availability **9 PASS** (8 scenarios + parent), zero failures/skips. These are local synthetic fixtures, not production or live QA.
- Existing membership PostgreSQL regression after the header fix: **14 PASS**. Across these three suites: **36 PASS**, zero failures/skips. Independent final cleanup confirms **0 owned test databases / 0 test connections**. Timeline tests were replayed solely to retain complete raw logs; the replay is labeled in evidence and not counted as additional unique coverage.
- Final `git diff --check`: **PASS**. Base commit unchanged. Source and artifact hashes verified when writing the final manifest.
- Independent final code review: no remaining actionable defect in the reviewed lock order, reference validation or Express header fix.

Exact commands, final baseline results, cleanup and raw-log hashes are recorded in `FINANCE_AVAILABILITY_VERIFICATION.json`. Logs are under ignored `.codex-temp/sys-mb-finance-availability/`. PostgreSQL uses local WSL Node 22/PostgreSQL 16 and uniquely named disposable databases. No production URL or secrets are loaded. EventBus is an in-memory spy; payroll reporting and external fetch are blocked in finance fixtures. Consequently no global notification, payroll formula, provider, live browser or production-isolation PASS is implied.

## Review scenario

Run only in an isolated fixture environment:

1. Give one account different Park/Dar memberships. Create a Dar finance account and observe the initial row's business context; inject an INSERT failure and verify no residual account.
2. Submit a valid same-business booking reference, then a foreign/missing one. Verify success versus rejection with no ledger/event side effects. Try global staff/certificate IDs under membership and legacy CRM; verify explicit containment and retained compatibility.
3. Seed historical transactions with foreign references in the disposable DB. Attempt description-only edits and omitted/null account inputs; verify no ownership bypass. Verify payroll-managed records still return 409.
4. Hold a booking row lock in a second transaction, then request finance PUT and update finance from the booking writer. Confirm completion without deadlock. Change the booking link while waiting and expect reload/retry 409.
5. Request both availability routes as an elevated user and as a restricted worker. Invisible bookings must occupy the same intervals but disclose only time/duration/unavailability. Check cancellation, touching intervals, linked children, room and cabinet queries.
6. Downgrade/revoke membership and reuse the same JWT. Verify access changes immediately. Check default Dar, Dar-only membership and header-only legacy CRM.

## Remaining work and next action

1. **D-02: ownership and containment of legacy shared surfaces.** Global catalogs, templates, recurring records and salary/HR ownership remain NOT_MIGRATED. Begin with read-only ownership/conflict preflight and an explicit containment proposal. Do not assign existing records to Park or an organization without a business decision.
2. **Staff/certificate financial references remain NOT_MIGRATED.** The new denial is containment, not a completed ownership migration. Existing related records are not cleaned up by this patch. Existing type-only category mismatch and null-account clearing semantics are preserved as separate finance behavior debt.
3. **Finance income notification routing remains NOT_MIGRATED.** Existing global EventBus rules can route amount/description to a global channel; this patch preserves the event contract and does not certify notification isolation. Route/channel ownership must be resolved before claiming isolated production finance.
4. **Availability GET initialization remains a side effect.** `ensureDefault:true` can insert default resource rows when the catalog is empty. Explicit lifecycle provisioning is needed before making these reads side-effect-free; read-only production QA must not assume an empty catalog is safe.
5. **Protected related identity analysis remains.** Already-visible booking projections can retain raw poisoned `customer_id`/banquet source IDs even though scoped joins suppress foreign labels. Hidden entries redact them. Changing canonical source identity requires the separate protected-contract task; no renderer or protected manifest was changed here.
6. **D-03–D-06 remain:** registry modules/custom-business initialization, internal link contracts, integration ownership, then exact-candidate CI/release and controlled live acceptance. MD/CRM membership cutover and compatibility removal remain separate.

Status: **READY_LOCAL_FINANCE_AVAILABILITY_REVIEW**. Global cutover: **HOLD_REMAINING_DOMAIN_GAPS**. Recommended next task: **D-02 read-only ownership preflight and legacy-surface containment analysis**.
