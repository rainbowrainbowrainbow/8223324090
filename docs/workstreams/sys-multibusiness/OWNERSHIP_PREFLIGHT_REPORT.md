# SYS-MB-OWNERSHIP-DECISIONS — Read-only preflight evidence

Date: 2026-09-12. Status: **PASS_LOCAL_COLLECTOR_VERIFICATION_ONLY**.
Real-data ownership status: **HOLD_OWNERSHIP_DECISIONS / NOT_RUN_SOURCE_UNAVAILABLE**.

Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
Branch: `codex/sys-mb-auth-p0-20260912`; base/HEAD: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
This report continues Task 3 in `CONTINUATION_TASKS.md`. The parent task verified the D04 checkpoint before analysis. No collector, existing test, runtime, schema, provider, auth or production data change was made for this preflight verification.

## Selected source and missing real-data evidence

The parent task checked only process-local presence of `MULTIBUSINESS_AUDIT_DATABASE_URL` and `BUSINESS_MEMBERSHIP_TEST_DATABASE_URL`; both were absent. No credentials file, other environment values or application connection fallback was read. A real operator/preproduction/production database was therefore **not available and not queried**. Actual record counts, owners, mixed records and public exposure remain **unknown**, not zero.

The explicit source used here was a new, random, disposable PostgreSQL database on the local WSL Ubuntu PostgreSQL socket. The unchanged fixture `tests/integration/multibusiness-ownership-preflight-postgres.test.js` created deliberately synthetic empty, partial, complete and RLS-enabled schemas. It is not a production restore. Deliberate orphan/mixed records exercise the collector and cannot establish the ownership of any real record.

Safe aggregate output is in [OWNERSHIP_PREFLIGHT.synthetic.json](OWNERSHIP_PREFLIGHT.synthetic.json). Its top-level `sourceKind` is `SYNTHETIC_DISPOSABLE_LOCAL_POSTGRESQL`, `productionData` is `false`, and `operatorSource.actualCounts` is `null`. The complete collector report is preserved inside the evidence without substituting fixture counts for actual counts. No record IDs, names, token values, financial amounts, blobs or source URLs are exported.

## Verification actually performed

| Check | Result | Evidence |
|---|---|---|
| Unchanged unit/CLI suite | 10 PASS, 0 failures/skips | `.codex-temp/sys-mb-ownership-decisions/unit.log` |
| Unchanged actual PostgreSQL suite | 8 PASS: 7 scenarios plus parent, 0 failures/skips | `.codex-temp/sys-mb-ownership-decisions/postgres.log` |
| Five actual collector snapshots captured | PASS; complete snapshot and repeated result match except collection time | `.codex-temp/sys-mb-ownership-decisions/synthetic-collections.json` |
| Additional real SELECT permission denial | PASS: database SQLSTATE `42501`, sanitized public `AUDIT_DATABASE_FAILED` | `.codex-temp/sys-mb-ownership-decisions/permission-negative.json` and `.log` |
| Collector transaction boundary | `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, verified `SHOW` values, final `ROLLBACK` | Existing PostgreSQL assertions; permission-negative trace assertions |
| No source-row mutation | PASS: hashes of all complete-fixture rows unchanged across collections; additional permission fixture unchanged | Existing PostgreSQL suite; permission-negative fixture |
| Missing schema / RLS visibility | PASS: unknown counts remain `null`; dependent metrics skipped instead of zero-filled | Captured collections and existing assertions |
| No apply mode / no application URL fallback / failure redaction | PASS, including rejected CLI arguments, invalid isolation and simulated failed rollback | Unit/CLI suite |
| Exact local cleanup | PASS: generated database removal asserted; additional permission fixture also asserts no remaining database connections | PostgreSQL suite; permission-negative fixture |
| Runtime | Windows Node 22.23.1 / npm 10.9.8; WSL Node 22 / PostgreSQL 16 fixture | Local runtime check and executed WSL fixture |
| Full `npm test`, exact-SHA CI, deploy, live QA | NOT_RUN in this analysis task | No delivery or runtime change |

The additional permission fixture uses the existing `pg_monitor` role only inside its disposable connection. It creates no roles, changes no grants and restores the session role after verified rollback. The collector's SQL contains no write/DDL/COMMIT statements. Its failed count is not emitted as an empty/complete report.

The existing `MULTIBUSINESS_AUDIT_SAVE_FIXTURE` option was not used because it targets an earlier evidence directory. A scratch preload captured only aggregate return values into this task's new evidence directory; older checkpoint evidence remains intact.

## What the collector observes

The bounded inventory covers **21 allowlisted tables and 25 relationship metrics**. `COMPLETE` means these configured observations ran; it does not certify the entire database, all ownership constraints, public/private behavior or background entrypoints.

| Synthetic collection | Observed tables | Observed relationship metrics | Result |
|---|---:|---:|---|
| Empty schema | 0 / 21 | 0 / 25 | `INCOMPLETE_SCHEMA` |
| Partial schema | 3 / 21 | 0 / 25 | `INCOMPLETE_SCHEMA` |
| Complete synthetic schema | 21 / 21 | 25 / 25 | `COMPLETE`, still `HOLD_OWNERSHIP_DECISIONS` |
| Repeat on unchanged fixture | 21 / 21 | 25 / 25 | Same observations, no writes |
| Catalog root with enabled/forced RLS | 20 / 21 | 18 / 25 | `INCOMPLETE_VISIBILITY`; affected counts unknown |

Representative **synthetic-only** observations demonstrate the kinds of unresolved work the tool can detect:

| Metric | Synthetic observation | What it does not decide |
|---|---|---|
| Catalog roots | 3 rows; 2 blank observed owner fields | Existing nonblank field is not approved ownership proof |
| Booking templates | 6 rows; no owner column; 2 missing product references, 1 orphan product reference | Product context does not choose template ownership |
| Recurring templates / instances | 5 templates; 7 linked instances; 1 mixed-context series; 3 instances without context | The first instance cannot choose the series owner |
| Template rooms | 2 ambiguous-context booking-template references; 1 for recurring templates | Resource name/ID matches do not authorize a business assignment |
| Recurring linked children | 1 orphan parent, 1 cross-context edge, 2 unknown-context edges | This is aggregate detection, not a protected `linkedTo` repair |
| Public token presence | 1 nonblank token | No determination of intended publication, expiry, audience or active exposure |
| Automation flags | 2 active automation rows and 2 auto-enabled settings rows | Flags do not prove executed jobs, approved destinations or provider ownership |
| Finance references | 1 orphan staff and 1 orphan certificate link | No allocation, payroll, amount or financial ownership decision |

Counts in the rows above overlap by design and must not be summed into a unique affected-record total. Empty `ownershipColumns` means the allowlisted owner fields are absent; it does not mean ownership has been established by another field.

## Remaining coverage and decision gaps

1. **Real selected database and visibility:** obtain an explicitly selected, approved read-only connection through the normal operator mechanism. Its absence blocks actual counts/mapping, but not this fixture analysis. Do not use `DATABASE_URL` or retrieve credentials speculatively.
2. **Historical mapping:** the collector deliberately emits no record IDs or proposed owners. A restricted, reviewed mapping is separate. Existing usernames, creator role, product, room and first occurrence are observations, never automatic assignment authority.
3. **Public links/assets:** source and consumer review must classify token links, image blobs, uploaded/static objects, embedded catalog JSON and external cached copies. The collector counts token presence and blob-table rows; it does not fetch public URLs or inventory object storage.
4. **Jobs and providers:** active flags are not a durable job/request/business/destination inventory. Provider job state, retries, storage paths and scheduler reachability require the separate task inventory. No polling, generation, Telegram or provider action ran here.
5. **Constraint and domain completeness:** the collector observes owner-column presence/blanks, selected parent orphans and selected context mismatches. It does not verify every foreign key, ownership lineage or cross-business edge. Generic catalog edges mainly detect missing parents, not authorization of their owner.
6. **HR/finance/integrations:** only the named aggregate finance-reference metrics were inspected. Staff allocation, payroll formulas, amounts, certificates policy, notifications, chat and integration ownership remain under their existing workstream boundaries.
7. **Live proof:** successful local fixtures do not demonstrate live containment, an approved backfill, rollback safety of a future migration, or zero compatibility usage.

The collector keeps `ownershipEstablished:false` and `safeToAutoBackfill:false` even for complete/zero-count observations. RLS-enabled sources are skipped even with a role capable of bypassing RLS; permission failures/timeouts abort instead of silently narrowing the dataset. Per-statement timeouts are not a whole-run duration guarantee.

## Reproduction and operator handoff

Run the unchanged unit fixture from the verified worktree:

```powershell
node --test tests/multibusiness-ownership-preflight.test.js
```

The recorded PostgreSQL run used local WSL user `postgres`, `BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST=1`, Node 22, the new scratch `capture-preflight.cjs` preload and the unchanged integration test. The additional `permission-negative.cjs` uses the same local-only guard and generated-database cleanup. Exact commands and collector/test SHA256 values accompany the task verification evidence.

For a later actual source collection, the operator must first supply the dedicated process-local read-only connection through an approved mechanism. Then run `node scripts/audit-multibusiness-ownership.js` into a new restricted evidence path; do not put the URL in a command, report or repository. `--help` is connection-free. The CLI accepts neither `--apply` nor an owner mapping. Exit 0 alone is insufficient: review `collectionStatus`, every `NOT_CHECKED_*` metric, and the continuing ownership HOLD.

**Next action:** resolve the owner/public/job decisions and restricted mapping described by Task 3, then collect actual-source evidence when its read-only connection is explicitly available. Do not execute historical backfill or reopen contained legacy modules from these synthetic counts.
