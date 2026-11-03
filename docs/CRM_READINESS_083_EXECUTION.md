# CRM readiness execution, 0.83.x

Owner request: execute the five-block plan agreed in this chat. Production base at start: `0.83.0`, `90b3efdab790807b24ab693321fd68a918e08f48`.

## Completion requirements

1. Dependency security: triage all ten reported nodes and three high-severity nodes; install compatible fixes; validate runtime uploads, parsing and spreadsheet/archive behavior; rerun full and production-only audit; publish a reviewed dependency patch with exact-SHA CI and production proof.
2. Timeline states: distinguish loading, a successful empty result, filtered results and source failures; resource/API failures must never publish `ready` with a misleading empty schedule; retry must recover. Cover day/week and animator/room modes, including stale response navigation.
3. Omni layout: reproduce the 320x640 shell overflow, fix the layout cause, retain visible history/composer and draft/navigation behavior. Run the focused viewport regression repeatedly, without weakening assertions.
4. Release tooling: centralize or correctly default the canonical production branch, retain environment overrides and mismatch rejection, and pass the live proof without a manual branch override.
5. Mobile manager journey: use only synthetic fixtures for date/mode/filter/available-slot/create/detail/return at 320 and 390px. Verify date, mode, reading position and canonical booking detail behavior. Add focused UI corrections only where evidence requires them.

Each implemented block is committed and versioned independently, with the production ref revalidated before publishing. Protected booking identity/render paths, auth, real operational records, secrets and provider settings remain outside the authorized change scope. Any newly necessary protected change must be presented with exact evidence first.

## Initial dependency evidence

`npm audit --json` against the production lockfile reports 10 vulnerable package nodes: 3 high and 7 moderate. This includes inherited advisories (for example, ExcelJS -> archiver -> readdir-glob -> minimatch), not ten independent application flaws.

| Node | Initial version | Runtime assessment | Fix direction |
| --- | --- | --- | --- |
| body-parser | 1.20.6 | Express JSON parsers accept compressed bodies, including before route handlers. The trailing-bytes process-crash advisory applies to this dependency path. | Compatible 1.20.9+ update |
| multer | 2.4.0 | Server upload dependency. All current application fileFilter callbacks are synchronous, so the pending asynchronous filter scenario is not exposed by those callbacks. Patch the library nevertheless and retain a real late-filter regression. | 2.5.0 |
| undici | 7.29.1 | Lockfile marks this as dev-only through jsdom. It is not the Node runtime's bundled fetch implementation. | Compatible 7.30.1+ update |
| qs | 6.16.0 | Express parses query strings; no application comma-format stringify path has been found. Existing override pins the vulnerable package and must move. | Override 6.16.1 |
| minimatch / readdir-glob / archiver / exceljs | 10.2.6 / 3.0.0 / 8.0.0 / 4.4.0 | Runtime export/archive chain. The pre-existing Archiver 8 override also breaks the callable API used by ExcelJS streaming exports. Restore Archiver 5.3.2, within ExcelJS's declared major, with patched matching/traversal dependencies. | Archiver 5.3.2, minimatch 11.0.1, glob 14.0.2; retain ExcelJS 4.4.0 |
| ip-address | 10.7.3 | Production dependency of express-rate-limit 8.7.0. No direct application Address6 use found; the advisory's long newline-bearing zone input is not a normal HTTP address header. Patch the transitive package regardless. | Compatible 10.7.5 update |

The tenth reported node, Express, inherits the qs advisory; no Express major update is necessary. The four archive-chain nodes inherit one minimatch advisory, rather than representing four independent application vulnerabilities. Undici's eight advisory entries share the 7.30.1 fix and occur only in jsdom's development dependency tree; this change does not replace Node's bundled fetch runtime.

### Dependency implementation and compatibility evidence

- Final installed fixes: body-parser 1.20.9, multer 2.5.0, qs 6.16.1, ip-address 10.7.5, undici 7.30.1, minimatch 11.0.1, glob 14.0.2.
- Archiver 8 is an ESM namespace rather than the callable factory expected by ExcelJS 4.4.0. A real streaming writer test failed before resolving that compatibility issue. The final override restores the declared Archiver 5 major instead of downgrading ExcelJS or modifying vendor files.
- Archiver 7 was also unsuitable for ExcelJS's custom stream implementation and introduced an affected glob chain. The final Archiver 5 path passes both streaming workbook roundtrip and archive matching checks. Global glob/minimatch overrides cover only the ExcelJS archive dependency tree; npm 10's nested override resolution produced inconsistent lock entries, so a clean `npm ci` and `npm ls` are explicit acceptance checks.
- glob 14.0.2 prevents the cancellation-bypass advisory introduced by older glob versions. Application archive expansion uses synchronous matching, with no exposed asynchronous traversal budget path found; the patched version is nevertheless installed and its actual `glob.sync` consumer is exercised.
- `tests/dependency-runtime-regression.test.js` is registered in the normal unit test list. Its isolated child processes reproduce trailing gzip bytes and a delayed upload filter after teardown. Both scenarios crash with the original body-parser 1.20.6 / multer 2.4.0 modules and pass with the updated modules, followed by a successful health request. No uncaught-exception handler masks a failure.
- Targeted upload, archive, streaming workbook and staff-workbook tests passed (10/10); the four new regressions also pass with the explicit archive utility expansion assertion. Full `npm test` subsequently exited 0, including 3872/3872 primary unit tests and the repository's UI/static/SYS-MB/marketing gates. Exact-SHA CI remains required before release.
- Both full and production-only audits report zero vulnerabilities after a clean install. Evidence is retained with the local release artifacts; no dependency mutation was performed in the shared checkout.

Primary advisories checked on 2026-11-03:

- https://github.com/advisories/GHSA-27r3-jxmh-p828
- https://github.com/advisories/GHSA-q7qp-rjg7-q26m
- https://github.com/advisories/GHSA-xjj6-f33q-929c
- https://github.com/advisories/GHSA-6pq8-jhm2-2vcw
- https://github.com/advisories/GHSA-g3hv-75wg-m249
- https://github.com/advisories/GHSA-rxp7-6hxx-x8q5
- https://github.com/advisories/GHSA-3g3m-2fjr-6pw4
- https://github.com/archiverjs/node-archiver/releases/tag/8.0.0

Status: dependency implementation and local baseline complete; not released. A parallel PDF candidate (0.83.1, a0d6072d) has reached the remote production branch while live remains 0.83.0. Do not push over that work or assume a stale origin tracking ref is current: this checkout fetches only main by default, so production must be fetched with an explicit destination ref or checked with ls-remote. Revalidate remote/live convergence before preparing this plan's release.

## Integrated acceptance and release packaging

The five blocks have separate functional commits. Their production acceptance is
coupled: the unchanged Omni responsive gate also exposed the mobile sidebar
backdrop defect, so the mobile correction must accompany the Omni fix. Prepare
one combined next-free 0.83.x patch after the complete gate set instead of
publishing intermediate candidates with a known failing responsive gate.

- Timeline loading/source failures/retry: 273 focused regressions and eight
  mobile day/week, animator/room browser cases passed. See
  `CRM_TIMELINE_LOAD_STATES.md`.
- Omni: three deterministic overshoot cycles pass, two complete real-app
  PostgreSQL runs exited zero, and the full responsive suite passes with the
  mobile sidebar correction. Reviewed 320px/390px chat screenshots retain input,
  send and history. See `CRM_OMNI_VIEWPORT_RECONCILIATION.md`.
- Release proof: canonical branch default and mismatch/override tests passed;
  live 0.83.0 proof ran without a manual branch override. Repeat for the final
  deployed candidate.
- Manager journey: all four real-API, disposable PostgreSQL mobile journeys
  passed, including room ticket quotes, explicit warnings, canonical details,
  and exact return context. Long promotion titles/add-event buttons passed real
  clicks and no-overlap checks. Reviewed phone form/detail screenshots. See
  `CRM_MOBILE_MANAGER_JOURNEY.md`.
- Combined primary units: 3894 passed. The first full baseline stopped at a
  stale UI source assertion requiring the defective 100vw mobile sidebar. Its
  expected width is updated to the corrected 92vw; the real-click assertion is
  retained. A complete final candidate baseline remains required.
- Both full and production-only dependency audits again report zero findings
  (299 installed package nodes).

Before release, retain the parallel PDF production commits and review its tested
HR checklist response-context correction (`d13dc4cd`), which repairs the failed
PDF candidate's CI gate. The unrelated in-progress Hermes branch is excluded.
No production push or deployment has occurred for this plan at this checkpoint.
