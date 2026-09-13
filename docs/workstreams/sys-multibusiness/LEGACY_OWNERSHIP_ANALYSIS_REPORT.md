# SYS-MB-05 / D-02 — Legacy ownership preflight and containment analysis

Historical analysis checkpoint. Accepted C1/C2 containment is now implemented locally in [LEGACY_CONTAINMENT_IMPLEMENTATION_REPORT.md](LEGACY_CONTAINMENT_IMPLEMENTATION_REPORT.md); its manifest supersedes current source hashes/status. The original analysis evidence below remains historical. Public/background and historical ownership decisions are still unresolved.

Date: 2026-09-12. Base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
Branch: `codex/sys-mb-auth-p0-20260912`.
Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.

Status: **READY_LOCAL_ANALYSIS_REVIEW**. D-02 preflight tooling and the concrete containment proposal are complete. Runtime containment and ownership migration are **NOT_IMPLEMENTED / PENDING_POLICY**. Global cutover remains **HOLD_REMAINING_DOMAIN_GAPS**.

This is the next analysis/preflight task specified by the D-01 handoff. It does not silently narrow current CRM/MD access, assign existing records to Park, or claim to have fixed the audited runtime gaps.

## Baseline and changed files

All **84** D-01 source hashes and the exact branch/base were verified before work. After this increment, **83** remain byte-identical; only `package.json` changed to wire the operator command and its unit suite. Application runtime, auth, financial behavior, providers, HR, protected booking identity, navigation/theme and schema remain unchanged.

New files:

- `scripts/audit-multibusiness-ownership.js`: inert-on-import, operator-only, aggregate read-only preflight.
- `tests/multibusiness-ownership-preflight.test.js`: CLI, connection boundary, redaction, cleanup, missing-schema and RLS behavior.
- `tests/integration/multibusiness-ownership-preflight-postgres.test.js`: real PostgreSQL observations on synthetic isolated schemas and records.

`package.json` adds `audit:multibusiness-ownership` and includes the unit suite in the existing `test:unit` command. No dependency, lockfile, version/cache marker or migration change. The cumulative worktree has **87** changed source/test files; this increment has **4**, including package wiring. Exact hashes are in `LEGACY_OWNERSHIP_VERIFICATION.json`.

No commit, push, CI, deployment, production connection, live-site QA or production-record mutation was performed. `0.81.132` remains the unreleased local marker, not a live version claim.

## Findings that determine the implementation

1. **Catalogs are a global namespace.** Nine catalog tables have no declared business/organization owner. The private router is only one entrypoint: Products, two Dashboard branches, Omni sales materials and script simulation also read them. Public token links and image URLs are separate exposure paths. A gate on `/api/catalogs` alone cannot establish containment.
2. **Booking and recurring templates are global.** Recurring series reads follow template IDs across business contexts; cancellation also follows linked child IDs. The generator creates Park bookings. Product references, creator names and existing occurrences are evidence to review, not authority to assign ownership.
3. **Membership-only denial is bypassable through compatibility.** A caller can legitimately switch to CRM/MD, regain its legacy role and reach the same global SQL. Closing this path changes current compatibility behavior. The proposed strict boundary and its visible impact must be explicit; see the plan's policy matrix.
4. **Frontend caches matter.** A template already loaded into `js/booking-form.js` can remain available after a failed context reload, and applying it precedes the usage request. Backend denial alone does not clear those local values. Catalog helper failures also collapse to an empty array, masking the difference between empty and unavailable.
5. **Read endpoints and background paths have side effects.** Catalog settings GET creates a missing settings row; provider polling and balance GETs are external calls. `checkStaleCatalogImages` is registered and performs global provider/storage work. The recurring-booking scheduler helper is exported but has no registration in this checkout; eager/manual generation is proven. The generic startup “recurring” log is not proof of that helper running.
6. **Salary and notifications are separate gaps.** `/api/finance/report/salary` calls the global salary service without business scope. Staff/certificate ownership and the global `finance.income` rule/channel routing remain NOT_MIGRATED. A proposed salary endpoint gate does not migrate HR/payroll or fix notifications.

Source evidence, exact paths and candidate line locations:

- [LEGACY_CATALOG_SURFACE_AUDIT.md](LEGACY_CATALOG_SURFACE_AUDIT.md)
- [LEGACY_TEMPLATE_RECURRING_AUDIT.md](LEGACY_TEMPLATE_RECURRING_AUDIT.md)
- [LEGACY_CONTAINMENT_SECURITY_REVIEW.md](LEGACY_CONTAINMENT_SECURITY_REVIEW.md)

These are source audits, not live exploit/production-schema attestations. Their alternative policy recommendations are reconciled by [LEGACY_CONTAINMENT_PLAN.md](LEGACY_CONTAINMENT_PLAN.md).

## Operator preflight

Use Node 22/npm 10. Set `MULTIBUSINESS_AUDIT_DATABASE_URL` process-locally through the approved credential mechanism to an explicitly selected read-only database connection. This task did not load a production connection or create a database role. Never place the value in a command history, document or report.

```powershell
node scripts/audit-multibusiness-ownership.js --help
node scripts/audit-multibusiness-ownership.js > .codex-temp/sys-mb-legacy-ownership/operator-preflight.json
```

The second command requires that dedicated variable to be present. `npm run audit:multibusiness-ownership` also starts collection; direct Node produces pure JSON while npm includes its normal script banner. Use direct Node for help: this Windows npm launcher intercepted `-- --help` as npm's own help. This report is aggregate evidence, not an export of records.

Safeguards and meaning:

- No `DATABASE_URL` fallback or application startup import. Importing the module opens no connection. No apply mode, bootstrap, migration, publish, generation or owner assignment exists.
- One client uses a verified `REPEATABLE READ READ ONLY` transaction. Statement/idle timeouts are 15 seconds; lock timeout is 1 second; connection timeout is 5 seconds. Reads are sequential on the same snapshot. Success ends with ROLLBACK; failure also rolls back, and a failed rollback destroys the client.
- It probes 21 allowlisted tables and required columns before each metric. It reads counts, never row content, tokens, names, IDs, finance amounts, salaries, binary blobs, source URLs or provider settings.
- Missing tables/columns produce `NOT_CHECKED_MISSING_TABLE` / `NOT_CHECKED_MISSING_SCHEMA` with unknown counts (`null`). RLS-enabled tables and dependent metrics produce `NOT_CHECKED_ROW_SECURITY`, even under a privileged connection; the audit never treats a filtered result as a complete count.
- `collectionIssues` preserves both missing schema and visibility gaps. `COMPLETE` means the bounded set of observations was collected; it never proves ownership. Status always remains `HOLD_OWNERSHIP_DECISIONS`, `ownershipEstablished:false`, `safeToAutoBackfill:false`.
- Exit 0 means collection completed, including explicitly unavailable metrics. Exit 1 is an execution/configuration failure with a fixed sanitized code. Do not use exit 0 alone as a migration/release gate.
- A permission error or statement timeout aborts instead of converting an unknown count to zero. The per-query timeout is not a total-runtime guarantee: multiple count scans can take longer on large tables. Schedule an operator collection with the database owner; do not raise timeouts or change DB settings as a silent retry.

Metrics include table totals/observed ownership-column blanks, catalog parent orphans, token presence, catalog automation flags, template product/room ambiguity, recurring mixed/unknown contexts, missing template parents, poisoned linked children, uninstantiated templates, unregistered context keys and finance staff/certificate reference orphans. A public token is counted independently of workflow status: the existing viewer checks the token, not a fictional `published` state.

The tool does not inspect embedded catalog JSON references, full object-storage contents, issued public URLs, provider jobs or application route reachability. Those remain in the source/consumer inventory. A single-business product/room/occurrence match never chooses the template's owner. Future ownership columns, if present, are observed but not certified for constraints or authorization.

## Verification performed

| Check | Result |
|---|---|
| Unit/CLI `node --test tests/multibusiness-ownership-preflight.test.js` | **10 PASS**, no failures/skips. |
| Actual local PostgreSQL suite | **8 PASS** (7 scenarios + parent), no failures/skips. |
| Runtime | Node **22.23.1** / npm **10.9.8**, PASS. PostgreSQL test runtime: WSL Node 22 / PostgreSQL 16. |
| Version consistency | PASS; no version/cache changes. |
| Parser check | `node --check` for all three new JS files, PASS. |
| Independent preflight review | Public-token status assumption corrected; RLS omission made explicit. No remaining blocking finding in the final reviewed script. |
| Temporary database cleanup | **0 owned test databases / 0 connections**. |
| `git diff --check` | PASS. |
| Full `npm test` / CI / deploy / live QA this increment | **NOT_RUN**. |

The focused verification is proportional to an operator-only script with unchanged application runtime. D-01's full npm baseline remains historical evidence; it is not recounted as a new run here. Actual PostgreSQL verifies read-only/isolation settings, exact counts on empty/partial/complete synthetic schemas, unchanged hashes of all fixture rows after repeated collection, RLS omission and absence of private sentinels in output. No production-like migration or actual HTTP application scenario is claimed for this audit suite.

Ignored evidence is under `.codex-temp/sys-mb-legacy-ownership/`: unit/PG raw logs, `preflight-postgres-results.json` and `fixture-preflight.json`. The fixture report is synthetic and must not be used as production counts. Hashes and commands are recorded in the verification manifest.

## Handoff

The next step is the **D02-C1 containment policy decision** in the concrete plan, followed by its private-API and UI patch together. The existing user direction preserves CRM/MD compatibility; silently narrowing those features during an analysis task would contradict that boundary. The analysis itself is complete. Owner assignment, compatibility restrictions, public-link treatment and background maintenance remain explicitly undecided; independent D-03 registry/module analysis can continue while these decisions are pending.
