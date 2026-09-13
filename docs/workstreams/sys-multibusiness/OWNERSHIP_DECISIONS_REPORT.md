# SYS-MB-OWNERSHIP-DECISIONS — Analysis and verification report

Date: 2026-09-12. Status: **READY_OWNERSHIP_DECISIONS_REVIEW**.
Task 3 analysis is complete. Historical owner assignment and task 4 application
remain **BLOCKED_ON_REVIEWED_SOURCE_MAPPING_AND_POLICIES**.

## Checkpoint and scope

Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
Branch: `codex/sys-mb-auth-p0-20260912`.
HEAD/base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.

All 136 source hashes and 30 artifact hashes from the D04
`RELATED_RECORDS_VERIFICATION.json` matched before this task. **All 136 existing
source files remain byte-identical.** The two updated documentation indexes have
historical copies whose hashes exactly match D04, under
`.codex-temp/sys-mb-ownership-decisions/prior-artifacts/`; all previous evidence is
preserved. The worktree still contains earlier cumulative uncommitted changes.

This task adds analysis documents, a schema/example and an offline JSON review
validator with tests. It changes no application runtime, existing collector/tests,
schema/migration, auth, dependency, pricing/formula, provider behavior, protected
booking contract or menu/router/theme. No owner was inferred or assigned.

No commit, push, CI, deploy, real-source database read, production mutation, live
QA, asset download, public-link retirement, scheduler execution/pause, message or
provider call occurred. No secrets file or application DB URL was loaded.

## Result and rationale

`DECISIONS.md` separates already approved architectural/scope constraints from
**eight PENDING decisions (OWN-01–08)**. Each decision names the missing answer,
recommendation, alternatives/consequences, current code evidence and implementation
dependency. The recommendations are not treated as approvals.

The recommended first migration keeps operational catalogs/templates/series owned
by one reviewed business per root. An optional organization library creates
independent operational copies rather than silently changing another business's
prices/resources. Mixed or unknown roots require explicit resolution; existing
bookings are not reassigned with a recurring template.

Public viewer, shared image URLs and registered actorless refresh are independent
of private C1 containment. Their current exposure and writer behavior remain
unfixed, with explicit transition options and tests in
`PUBLIC_ASSET_JOB_POLICY.md`. It distinguishes a proposed publication revision,
asset ownership/visibility, origin/cache limitations and durable provider-job
identity from what exists today. No tables or real job owners are invented.

## Files and their purpose

| File | Purpose |
| --- | --- |
| `DECISIONS.md` | Owner-facing decision register, approved constraints, source graph, recommendations and READY/BLOCKED handoff |
| `PUBLIC_ASSET_JOB_POLICY.md` | Verified public/private/asset/job surfaces, OWN-04–06 choices and future scoped HTTP/PG/provider-stub acceptance cases |
| `OWNERSHIP_PREFLIGHT_REPORT.md` | Selected synthetic source, actual executed tests, aggregate coverage and unavailable real-source evidence |
| `OWNERSHIP_PREFLIGHT.synthetic.json` | Captured safe aggregate collector results; `productionData:false`, actual counts `null`, no owner assignment |
| `OWNER_MAPPING_FORMAT.md` | Restricted mapping workflow, schema/CLI semantics, exact-key preservation, attestations and trust limits |
| `OWNER_MAPPING.schema.json` | Versioned structural schema for 12 actual legacy tables and contextual references |
| `OWNER_MAPPING.synthetic.json` | Illustrative synthetic graph; no production IDs, assignments or approvals |
| `tools/validate-owner-mapping.cjs` | Offline structural/graph/binding validation; no SQL, connection, apply mode or authority verification |
| `tools/validate-owner-mapping.test.cjs` | Negative and positive format/graph/redaction/stale-review regression cases |
| `OWNERSHIP_DECISIONS_VERIFICATION.json` | Exact unchanged-source, analysis-tool, audited-source and artifact SHA256 checkpoint |
| `CONTINUATION_TASKS.md`, `DOMAIN_ISOLATION_INVENTORY.md` | Current progress and dependent-task blockers; original task scopes remain |

The actual local restricted working artifact is
`.codex-temp/sys-mb-ownership-decisions/restricted/owner-mapping.json`:
`dataKind:unpopulated`, `source:null`, no entities/owners and all eight decisions
PENDING. This means **NOT_COLLECTED**, not an empty production database. Its ignored
location prevents accidental staging but is not access control. Real mappings
must use approved restricted storage; do not place raw PII, tokens or URLs in the
public reports.

## Verification actually performed

| Check | Result / evidence |
| --- | --- |
| Canonical runtime | PASS: Windows Node 22.23.1 / npm 10.9.8; local WSL Node 22 / PostgreSQL 16 fixtures |
| Existing preflight unit/CLI | **10/10 PASS**, zero skipped; `unit.log` |
| Existing preflight PostgreSQL | **8/8 PASS** (7 scenarios plus parent), zero skipped; `postgres.log` |
| Additional actual PG permission denial | **PASS**: SQLSTATE 42501, safe `AUDIT_DATABASE_FAILED`, verified rollback/unchanged data/exact cleanup; `permission-negative.json` |
| Collector snapshots | Empty/partial/complete/repeat/RLS results captured. Complete bounded coverage is 21 tables / 25 metrics; RLS result retains unknown counts |
| Mapping validator | **27/27 PASS**, zero skipped; `mapping-validator.log`. Synthetic and ignored unpopulated CLI inputs both format-valid, with `safeToApply:false` and their respective non-applicable/not-collected statuses |
| Source and artifact hashes | Existing 136 sources unchanged; historical D04 evidence and final analysis artifacts verified by SHA256 |
| Parser and whitespace | `node --check` for the new offline tools; `git -c core.safecrlf=false diff --check` |
| Full npm / CI / deploy / live | NOT_RUN this task. D04's full green baseline is historical evidence, not claimed as a new run |

Logs above are under `.codex-temp/sys-mb-ownership-decisions/`. Targeted checks
match an analysis task with unchanged runtime and an offline validator; they do
not substitute for future migration/HTTP/live acceptance.

The first parent mapping-test invocation was blocked before test execution by the
Windows sandbox (`spawn EPERM`); `mapping-validator-sandbox.log` preserves it. The
same command then passed outside that child-process restriction. This was a local
test-runner restriction, not a failed mapping assertion.

The collector uses a verified repeatable-read, read-only transaction and ends in
ROLLBACK. Setup/cleanup writes occur only in disposable local fixtures; the
collector does not mutate source rows. Real `MULTIBUSINESS_AUDIT_DATABASE_URL` was
not configured, so operator/production preflight remains
**NOT_RUN_SOURCE_UNAVAILABLE**, with actual counts/owners unknown.

The mapping validator preserves exact Unicode identifiers, rejects unknown/raw
payload fields, checks organization/business/parent consistency and explicitly
accounts for unresolved relations. Review bindings detect changed row/owner,
registry/evidence/target identities and linked decision revisions. Missing or
mixed records remain quarantined. CLI errors contain schema paths/codes, not
record values or parser excerpts; no input file is rewritten.

These checks do **not** verify a real snapshot, reviewer identity, owner decision
or release authorization. `safeToApply`, `authorizationVerified` and
`sourceSnapshotVerified` remain false even for a format-valid reviewed document.
A checksum detects changed review input; it is not an approval signature.

## Remaining work and next action

- **READY:** review the eight choices and format; continue independent domain/source inventory.
- **BLOCKED_SOURCE:** supply an explicitly selected read-only operator source and collect a bounded exact-ID inventory in restricted storage. Synthetic figures cannot fill it.
- **BLOCKED_MAPPING/POLICY:** approve actual per-record ownership, shared-library handling, mixed records, existing publication/asset treatment and job transition semantics.
- **BLOCKED_IMPLEMENTATION:** task 4 migrations/public/job changes need those decisions plus their exact protected/migration scope. Existing containment stays in place.
- **STILL OPEN:** D04 generic linkedTo guard and remaining HR/finance/integration/domain acceptance; see existing reports. Analysis does not close those runtime gaps.

Recommended next action: the owner reviews **OWN-01–08** in `DECISIONS.md`; the
operator then obtains a named read-only source for the restricted inventory.
Do not start automatic backfill, revoke public URLs, run generation or reopen
legacy modules from this analysis checkpoint.
