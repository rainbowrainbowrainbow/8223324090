# D06 local readiness collection and live-fixture proposal

Date: 2026-09-12. Worktree: `EventGenix/.worktrees/sys-mb-auth-p0-20260912`.
Branch: `codex/sys-mb-auth-p0-20260912`; unchanged base `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
Starting checkpoint: `D05_IMPLEMENTATION_REPORT.md` and `D05_VERIFICATION.json`.

This package owns only `tests/acceptance/sys-mb-readiness-scenarios.cjs` and this report. The parent acceptance harness owns actual `server.js` startup, migrations, synthetic accounts/organization bootstrap, operational fixtures, transport isolation and exact disposable database cleanup. The other D06 modules own normal domain API and browser scenarios. No auth/HR/payment/Art/booking runtime change, release, production dataset, secret or external provider is part of this package.

**Readiness remains HOLD.** Collector correctness is separate from clean data, domain isolation and release readiness. OWN-01–08 and the protected enabled-domain gaps described in D05 are not cleared by a successful synthetic run.

## Collection contract

The exported interface is `seed({ db, fixture })` and `run({ baseUrl, fixture, request, db, record })`. `request` uses the same running application and actual login tokens as the rest of D06. No route handler, authenticated principal or SQL result is mocked by this module. The database must exactly equal the parent-supplied `eventgenix_d06_test_<32 hex>` name; HTTP probes stay on loopback.

| Matrix | Actual source / measurement | Acceptance meaning and limits |
| --- | --- | --- |
| Access/module inventory | `GET /api/auth/business-profile` for owner in Park/Dar, multi-organization account in each organization, other organization owner, and MD compatibility account | Preserve the returned active context, membership mode, module source, descriptors and enabled IDs. Profile success proves that measured profile case, not every API assigned to a module. |
| Normal domain access/denial | `sys-mb-domain-scenarios.cjs` against the same app/DB | Its recorded API cases are the source of normal booking/timeline/client/lead/task/finance/stock/product/graduation acceptance. This report does not replace those observations with source-only PASS. |
| Protected direct-read matrix | Actual authenticated staff list, certificate list, Art brand and payroll settlement requests from Dar and the separate organization | A returned controlled global sentinel is an actual local exposure failure. An unrelated role403 does not prove business containment. A menu/registry `not_migrated` descriptor alone is never PASS. No protected mutation or provider endpoint is called. |
| Owner/orphan/conflict matrix | One PostgreSQL `REPEATABLE READ READ ONLY` transaction; 24 explicit owner tables, 20 explicit relationship metrics and two membership consistency metrics | Counts of missing/unregistered/inactive context, linked/missing parents, cross-context links, duplicate membership keys and active membership lacking active organization membership. NULL is observed, never assigned to Park. Missing schema/RLS/permission failure is NOT_TESTABLE, not zero. |
| Legacy ownership preflight | Existing unchanged `runOwnershipPreflight` collector on the same fixture database | Its own read-only snapshot, 21-table/25-metric coverage and missing-coverage statuses remain intact. Count completeness does not establish historical owner approval or permit backfill. |
| Compatibility usage | Number of successful actual profile probes returning membership or compatibility mode; request failures counted separately | This is measured fixture traffic only. No complete runtime mode/ingress counter or real observation window is available. `zeroUsageEstablished=false`, authoritative runtime count/window remain null. |

The selected relationship list covers booking→customer/product/linked parent, customer→lead, lead→booking/product, lead-customer link parents, finance→booking/account/category, stock→location/history/movement, and graduation package/item/quote/child/export links. It does not certify embedded JSON, every operational FK, storage, jobs, provider sessions or external destinations. Missing MD product IDs can represent accepted compatibility external codes; a raw orphan count alone cannot classify those as application defects.

The runtime registry supports configurable dashboard/timeline/tasks/customers/leads/finance/programs/warehouse/settings, with limited Omni and Park/Dar graduation. It also lists unsupported staff/HR/payroll/certificates/Art and other modules. `OPERATIONAL_API_MODULES` covers only some API prefixes. The actual protected-read matrix is necessary because several unsupported prefixes remain mounted. The output records measured enabled IDs instead of assuming all configurable modules were enabled in the fixture.

## Deliberate collector sensitivity fixtures

These records are inserted only after full app startup into the exact disposable database. They are independent of the normal API fixture IDs and remain stable during the domain checks:

- One synthetic global staff row, certificate and Art brand guideline for read-only exposure probes. No employment/profile/rate, payroll report, payment, redemption or provider action is created.
- One product with explicitly unregistered `d06_unregistered` context. This is intentional collector input, not a newly discovered production orphan.
- One dedicated Park lead, one dedicated Dar customer and one link joining them, if existing constraints permit the insert. It characterizes raw-storage conflict detection, not an HTTP authorization bypass.
- A NULL-owner product attempt and missing-lead-parent link attempt use savepoints. An existing NOT NULL/FK rejection is recorded with its SQLSTATE and `NOT_TESTABLE` for the impossible injected state. Constraints are never disabled/dropped to manufacture a PASS. If the schema permits an attempted sentinel, the exact owned row is included in the collector evidence.

All generated IDs are held in `fixture.readiness`; artifact outputs contain synthetic aliases, aggregate counts, safe codes and sentinel-presence booleans. Tokens, passwords, connection strings, real staff/customer names and raw protected responses are not written by this module. Cleanup is the parent's exact database drop after stopping the app; production cleanup commands are not generated or run here.

## Compatibility and runtime completeness

`middleware/apiAudit.js` records selected mutations asynchronously, skips reads and ordinary authorization403, and does not provide complete business-resolution mode telemetry. Existing profile mode fields are useful per request but are not a durable usage counter across all HTTP/WebSocket/service/job/provider ingress. Therefore empty audit/event tables or a quiet scheduler cannot establish zero compatibility use.

The parent harness uses outbound hold to stop startup background work and blocks non-loopback transports. Actual HTTP/login/profile and domain handlers can run; scheduled jobs, delivery retries, provider destination resolution and external effects are intentionally unmeasured. A denied transport records a local attempted side effect, not successful delivery or production behavior. Public links/assets, secret bridge, payment ingress and Art/HR jobs remain governed by their D05 contracts and unavailable owner decisions.

## Execution evidence

The module passed `node --check tests/acceptance/sys-mb-readiness-scenarios.cjs`. The first full completed observation is run `d06_1789237804071_f534c5`, in `.codex-temp/sys-mb-d06/runs/d06_1789237804071_f534c5/`. It used actual `server.js`, all 353 startup migrations and actual API login/bootstrap. `result.json` records `databaseCreated`, `appStarted`, `bootstrap` and `cleanupVerified` as true; the parent confirmed source stability. These readings were captured **before the ordinary domain/browser mutation scenarios**.

| Observed readiness case | Result in this run | Evidence and precise interpretation |
| --- | --- | --- |
| Six actual profile requests | PASS 6/6 | `records-in-progress.json` and `readiness.json`: owner Park/Dar, multi-organization Park/other, other-organization owner, and MD compatibility. Five membership-mode requests and one compatibility-mode request succeeded. |
| Staff/certificates/Art direct reads | FAIL 6/6 | Dar and separate-organization requests returned HTTP200 and the independent synthetic global sentinel. This establishes local data exposure across these contexts. No protected mutation was performed. |
| Payroll settlement direct reads | FAIL 2/2 | Dar and separate-organization requests returned HTTP200. This is a missing containment proof; no payroll amount or cross-organization financial disclosure is claimed because this probe did not seed payroll amounts. |
| Ownership metric collection | COMPLETE | All 24 table metrics, 20 edge metrics and two membership metrics were observed; read-only transaction verified. No schema/permission/RLS hole was reported for this database. |
| Collector sensitivity acceptance | NOT_TESTABLE in this historical run | The dedicated cross-context link was detected with exact delta1, but the dedicated unregistered product INSERT failed23502 because the test omitted required `products.timeline_code`. The baseline already contained two startup products with unregistered contexts, so aggregate positivity was correctly insufficient to pass sensitivity. |
| Existing legacy ownership collector | PASS collection only | `collectionStatus=COMPLETE`, read-only true; its decision remains `HOLD_OWNERSHIP_DECISIONS`, `ownershipEstablished=false`, `safeToAutoBackfill=false`. |
| Complete runtime compatibility usage | NOT_TESTABLE | Observed profile traffic is 5 membership + 1 compatibility; full HTTP/WebSocket/service/job/provider mode usage and a real observation window remain unavailable. |

The next run `d06_1789238394299_b3209e` completed with cleanup and source stability, but both product sensitivity INSERTs still failed22001: the first correction reused a 13-character product code as `timeline_code`, whose actual migration341 type is `VARCHAR(6)` with a trimmed length2–6 CHECK. Other collection remained COMPLETE; the deliberate cross-context link was detected. Neither that error nor the earlier23502 is credited as proof of the NULL-owner constraint.

The fixture now supplies reviewed three-character `timeline_code` literals `Q6U`/`Q6N` in the unregistered-context/NULL-owner attempts and records a sanitized PostgreSQL column identifier on seed failure. All other mandatory product fields were checked against the actual base schema. These are test fixture corrections only; schema and runtime are unchanged. The corrected actual-app evidence follows.

The complete first-run metrics also observe startup rows whose contexts are not in this fixture's three-record business registry: products2, timeline resources1, finance accounts8 and finance categories24. These are local startup/compatibility observations, **not production counts or proof that historical owners can be assigned**. The one deliberately inconsistent lead/customer link is test data inserted directly for collector sensitivity; it is not an HTTP authorization bypass. No non-fixture database was queried.

### Corrected actual-app verification

Run `d06_1789238649086_b05104` completed on the unchanged corrected readiness source, SHA256 `ef0e614c336bcd98391b0ac1dd93847db0c8db5b5eb8c6ad7dc93325fa198b5a`. Artifacts are under `.codex-temp/sys-mb-d06/runs/d06_1789238649086_b05104/`; the parent may add a later full run for independently expanded browser/API scenarios without invalidating these measured cases.

| Check | Actual result | Evidence |
| --- | --- | --- |
| Collector sensitivity | PASS | `readiness.json` and `result.json` / `D06-READINESS-COUNTS`: read-only COMPLETE collection, dedicated unregistered-product delta exactly1 and dedicated cross-context-link delta exactly1. Baselines were2 and0 respectively. |
| NULL-owner rejection | Observed DB constraint; impossible injected state remains NOT_TESTABLE | `sentinelSetup.rows.nullOwnerProduct`: SQLSTATE23502 with `column="business_context"`. All other mandatory fields are now valid. This proves this actual schema rejects a NULL product owner; it does not test reading an impossible NULL-owner fixture or claim all legacy tables have equivalent constraints. |
| Missing-parent rejection | Observed FK rejection; impossible injected state remains NOT_TESTABLE | `sentinelSetup.rows.orphanLeadLink`: SQLSTATE23503. The missing lead ID was first confirmed absent; constraints stayed enabled. |
| Post-scenario ownership | PASS within declared edges | `ownership-after-scenarios.json` is read-only COMPLETE; `result.json` / `D06-OWNERSHIP-AFTER-SCENARIOS` reports `regressions=[]`. No new orphan/cross-context count appeared after API/browser scenarios; intentional baseline sentinels remain included. This does not certify unlisted relationships. |
| Profile inventory | PASS6/6 | Exact active contexts and expected membership/compatibility modes persisted. Membership profiles use `business_registry`; MD compatibility uses `business_operating_profile`. |
| Protected direct reads | FAIL8/8 retained | Same six actual staff/certificate/Art sentinel exposures plus two payroll200 containment failures. There is no claim of payroll amount disclosure. |
| Legacy preflight | PASS collection, ownership HOLD | COMPLETE read-only collection; `ownershipEstablished=false`, `safeToAutoBackfill=false`. |
| Runtime compatibility completeness | NOT_TESTABLE | Five measured membership profile requests, one compatibility request, zero request failures. Authoritative runtime usage and observation window remain null; `zeroUsageEstablished=false`. |
| Lifecycle and source stability | PASS | `result.json`: database/app/bootstrap/cleanup flags true; `acceptance-source-stability` PASS with `changed=[]`. |

The 17 readiness records therefore contain **8 PASS, 8 FAIL and 1 NOT_TESTABLE**. The separate post-scenario ownership record is PASS. Constraint attempts retain their explicit NOT_TESTABLE sentinel-state classifications in `readiness.json`; they are not silently counted as additional live/domain PASS. All results are local actual-app/PostgreSQL evidence, with synthetic rows and blocked provider transports. They do not constitute production or live-site QA.

### Sequential checkpoint with effective profile roles

The latest completed sequential run reviewed here is `d06_1789240691369_eeb5a9`. Exact evidence: [result.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789240691369_eeb5a9/result.json), [readiness.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789240691369_eeb5a9/readiness.json), [post-scenario ownership](../../../.codex-temp/sys-mb-d06/runs/d06_1789240691369_eeb5a9/ownership-after-scenarios.json) and [browser result](../../../.codex-temp/sys-mb-d06/runs/d06_1789240691369_eeb5a9/browser.json). The [source-state snapshot](../../../.codex-temp/sys-mb-d06/runs/d06_1789240691369_eeb5a9/source-state.json) includes readiness source SHA256 `7b05c69ea81084506f5ab1d8fe2abc10a1bfda679b1cbd3c59ea55e80c70322c`; the profile rows now preserve actual response `user.role` and `user.roles`, without deriving privileges from actor labels.

| Actor alias | Active context | Actual role / roles | Mode / profile result |
| --- | --- | --- | --- |
| owner | event_genix | director / [director] | membership / PASS |
| owner | dar | director / [director] | membership / PASS |
| multiOrg | event_genix | director / [director] | membership / PASS |
| multiOrg | d06_other | manager / [manager] | membership / PASS |
| otherOrg | d06_other | director / [director] | membership / PASS |
| compatibility | maysternya_doli | director / [director] | compatibility / PASS |

Readiness results remain **8 PASS / 8 FAIL / 1 NOT_TESTABLE** across 17 records. All 24 owner tables, 20 relationship metrics and two membership metrics are observed in a read-only COMPLETE collection. Both dedicated sentinel deltas remain exactly1. The NULL-owner attempt is rejected with23502 on `business_context`; the absent-parent attempt is rejected with23503, retaining the explicit impossible-state NOT_TESTABLE classification. Post-scenario collection is COMPLETE with `regressions=[]`. Exact database cleanup and source stability both PASS. The profile snapshot precedes acceptance mutations; the post-scenario report follows them.

The complete parent run contains **197 recorded cases: 172 PASS / 23 FAIL / 2 NOT_TESTABLE**. Browser cases are included in this total, not added to it: **13 PASS / 1 FAIL / 1 NOT_TESTABLE**. `D06-B02-membership-editor` timed out waiting for the dialog; dependent `D06-B10-ui-change-same-jwt` is NOT_TESTABLE because successful fixture assignment is required. This run therefore does not independently close the membership editor and same-JWT UI path. The eight protected-read failures and fourteen warehouse contractor/procurement failures remain actual local residuals; no source-only or prior fixture PASS overrides them.

The separate [npm baseline log](../../../.codex-temp/sys-mb-d06/npm-test-final2.log) and [exit evidence](../../../.codex-temp/sys-mb-d06/npm-test-final2.exit) report exit0, 34 TAP invocations with4297 pass/0 fail/0 skipped. These totals are not unique acceptance scenarios. All215 entries in [baseline-source-freeze-final2.json](../../../.codex-temp/sys-mb-d06/baseline-source-freeze-final2.json) matched current bytes when reviewed, including the two declared runtime files and the focused product-context regression test. The verification generator accepts this freeze format; it has not been invoked by this report's author.

| Business / scope | Readiness | Measured basis and remaining limit |
| --- | --- | --- |
| event_genix / Park | HOLD | Actual membership/domain scenarios exist, but contractor/procurement ownership probes expose uncontained reads involving Park data; global ownership decisions and production exact-SHA/live evidence remain unresolved. |
| dar / Dar | HOLD | Actual membership/domain scenarios exist; staff/certificate/Art sentinels are returned from direct reads, payroll returns200 without domain containment, and warehouse residuals remain. Hidden unsupported modules do not establish isolation. |
| d06_other / separate synthetic organization | HOLD; fixture only | Actual profile returns the correct organization-specific role, but direct protected reads and foreign stock/procurement access fail containment. This is not a deployed customer business or a production cutover. |
| maysternya_doli | NOT_MIGRATED / HOLD | One compatibility profile succeeds. Full domain migration, real usage telemetry and an observation window are unavailable; this does not certify operational ownership. |
| crm | NOT_MIGRATED / NOT_TESTABLE | No CRM actor/profile/domain fixture was exercised in this run. No counts or readiness are inferred from MD or from an inactive worker. |

`PARK_DAR_RELEASE_READY=false` and `GLOBAL_MODEL_COMPLETE=false` remain the required decisions. Complete compatibility-usage telemetry is still an unmet Task6 evidence requirement, explicitly NOT_TESTABLE; absence of an event never establishes zero usage. Historical observations above remain preserved and do not replace the exact final-run reference chosen by the parent manifest.

## Proposed Task 7 live fixture envelope

This is a concrete **proposal**, not an active authorization. Resolve the exact existing test-owner account and primary organization IDs from the release manifest before use; do not select a real owner by username/role inference. The proposal intentionally does not add a second production organization or create unsupported HR/certificate/Art/payment objects.

Use one existing approved test owner and create exactly:

| Fixture | Maximum explicit count | Purpose |
| --- | ---: | --- |
| New custom QA businesses in the approved primary organization | 2 | Distinct `qa_mb_<run>_a` and `qa_mb_<run>_b`; only already supported modules; graduation remains unavailable for custom contexts. |
| Synthetic user accounts | 2 | One account with different roles in A/B; a second account assigned only to A. No invitations, Telegram links or real staff attachment. |
| New organization memberships | 2 | Member-level organization memberships for these two synthetic users. Existing test-owner membership is not changed. |
| New business memberships | 5 | Existing test owner in A/B; first synthetic user in A/B with different roles; second synthetic user only in A. Last-owner protection must remain intact. |
| Customers | 2 | One clearly synthetic customer per QA business; no phone/email/Telegram contact destination. |
| Leads | 2 | One per QA business using only its own synthetic customer/product IDs. No messages or booking conversion. |
| Products | 2 | One per QA business, fixed reviewed fixture values; no image generation, publishing or provider job. |
| Tasks | 2 | One per business, no external notification destination or AI execution; side-effect review must confirm this before activation. |
| Warehouse locations and stock | 2 + 2 | One location and stock row per business; no procurement, photo intake, movement, payment or receipt. |
| New bookings, finance/ledger/payroll rows, certificates, Art objects, public tokens, provider jobs | 0 | Protected or external behaviors are outside this minimal lifecycle/isolation envelope. |

This is **11 access/lifecycle entities plus 12 operational fixture records**. Auth/security audit/session records produced by normal lifecycle are separate immutable evidence, not records to delete by a broad cleanup. Capture their actual scoped receipts after creation; do not invent their exact count in advance. Do not initialize additional default resources for this minimal envelope.

Scenario order: verify exact deployed SHA/branch/version; owner creates A/B and scoped memberships; first synthetic user switches A/B and observes different permissions; second user cannot list or directly address B's exact fixture IDs; same JWT loses A access after its membership is deactivated; repeat refresh/back/forward/cross-tab and safe light/dark/390/768/1440 checks; confirm unsupported module/foreign-ID denials; read the existing Park/Dar product/graduation pages under the approved test account without mutating real data.

TTL proposal: a 24-hour maximum lifetime recorded in the run registry, with cleanup immediately after QA and before the authorized block expires where possible. This is an operator deadline, not a claim that automatic TTL deletion already exists. Cleanup targets only returned IDs with the exact run marker, resolves fixture lead/customer references first, archives/deactivates operational rows through reviewed existing endpoints, then deactivates the two synthetic users/memberships and two QA businesses. Stop if an unexpected real link, unowned row or provider side effect appears; preserve audit evidence. Never cascade-delete an organization, reuse real employee records or issue broad SQL cleanup.

This minimal envelope does **not** certify live creation/editing of Park/Dar bookings, graduation quotes, finance records or a second production organization. Those require a separately concrete fixture manifest with reviewed side-effect paths and exact approval; a missing edge case stays NOT_TESTABLE. Local deliberate corrupt owner/link sentinels must never be copied to production. Complete local D06, resolve the enabled protected gaps and obtain current release/auth/migration/fixture scope before any Task 7 writes.

## Readiness decisions

- `PARK_DAR_RELEASE_READY = HOLD`: protected enabled paths, owner/policy decisions and live exact-SHA evidence remain unresolved; per-case local PASS does not remove those dependencies.
- `GLOBAL_MODEL_COMPLETE = HOLD`: Task 4 owner migration, protected D05 domains, complete compatibility observation and subsequent MD/CRM cutover are not complete.

Recommended next action: review the actual local matrices with the parent acceptance report, fix only independently authorized regressions, and assign/approve the smallest protected domain containment scope before requesting a production envelope.

## Final source-bound parent checkpoint

The authoritative final acceptance run is **`d06_1789241525527_7d4a50`**: [result.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789241525527_7d4a50/result.json), [source-state.json](../../../.codex-temp/sys-mb-d06/runs/d06_1789241525527_7d4a50/source-state.json). Full actual-app acceptance records: **173 PASS / 23 FAIL / 1 NOT_TESTABLE**. Cleanup verified; source stability PASS with no changes. See [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md) and [D06_VERIFICATION.json](D06_VERIFICATION.json) for final decisions and hashes. Earlier run references above are retained measured history, not substitutes for this final run.

The six effective-role profiles,24 table metrics/20 relationship metrics/2 membership metrics, exact sensitivity deltas and read-only post-scenario collection were repeated in this run. The readiness subset remains8PASS/8FAIL/1NOT_TESTABLE; no new bad link appeared in declared edges. Final browser subset: **14 PASS / 1 FAIL / 0 NOT_TESTABLE**. Historical D06-UI-01/P2 remains OPEN_UNCONFIRMED_ROOT_CAUSE; a later B02/B10 PASS does not prove its cause or a runtime fix. The per-business HOLD/NOT_MIGRATED table above remains in force. PARK_DAR_RELEASE_READY=false (HOLD); GLOBAL_MODEL_COMPLETE=false (HOLD).
