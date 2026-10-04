# EDU-READY-09 — software acceptance and release preparation, 2026-10-04

Production impact: yes.

Conclusion: GO_WITH_OWNER_DEVICE_DEFERRAL. All mandatory software suites pass freshly on the integrated release source. Physical iPhone/iPad/Android and VoiceOver/TalkBack checks remain BLOCKED_DEVICE / 42 NOT RUN / 0 PASS. The owner's latest request authorizes commit, push, versioning and deployment, followed by owner testing in production. This is a recorded release decision, not hardware acceptance.

## Candidate and boundaries

- Release worktree: C:/Users/Plotva/.codex/worktrees/education-ready-release-20261004/EventGenix
- Branch: codex/education-ready-release-20261004
- Fresh production base/rollback: 44a7d498c8bf4aabc2fac9eba05218473518696a (v0.82.61).
- Product commit: 4890e2b9aebe208e1637ddacb3af89153368091a.
- Version/cache/changelog commit: 0fbe975ee5acbf1dff9ee983839c912e1a7bd759.
- Candidate version: 0.82.62, «Заняття: повний цикл і довідник викладачів».
- Runtime: Node22.23.1 / npm10.9.8. No new dependencies; lockfile changes are only the two release version markers.
- Latest suite source maps: 1077 files, fingerprint 2b23f79e96869df6222f20dd9633d0aec6dfc4fba6c5ec4f6888ddb47912259d.
- Latest harness maps: 924 files, fingerprint a1fe722995e7966a1a9fe7bd5011099993c8dcbb47c44de5457e31ca916ffbec.
- Exact files/hashes, log hashes and latest command positions: output/education-ready/release-acceptance/release-acceptance.json and its referenced commands manifests.
- API/SQL provide prerequisites and independent assertions. Failed visible actions are never repaired by API writes in the continuous journeys.
- Every local write uses actual-app → Express → disposable PostgreSQL at loopback port55469. Fixed anchor2026-10-03, Europe/Kyiv; retained manual and device databases have39 bookings each and ten table fingerprints unchanged before/after each suite.

## Fresh coverage matrix

| Area | Status | Evidence level |
| --- | --- | --- |
| Continuous Chromium journey | PASS,14 checks | Visible teacher → group → child/member → lesson → reload/card → topic/duration/date edits → attendance/correction/report → cancel; plus year-boundary series create/cancel, SQL no partial/other-field changes |
| Continuous WebKit journey | PASS,14 checks | Same actual-app journey; exactly one create POST, trusted native activation, same pressed node, zero page errors |
| Teacher08A / business isolation | PASS,16 checks | First assignment, reassignment, inactive handling, two businesses, foreign ID refusal, scoped access, additive migration replay |
| Groups F01/F02 | PASS,15 checks | Selection/load races, loader failure retains teacher, save/archive/member isolation, capacity, double-submit, retry |
| Duration F05 / lifecycle | PASS,12 checks | Eight visible scenarios plus independent contracts;30/45/60/90 and invalid duration, separate edits, canonical Today/day/week and Park |
| Visible date08B | PASS,13 checks | Date-only visible save/reload/card/SQL preserves other fields; conflict atomicity, adjacent slots, month/year/Kyiv, series selected item, mobile/Park |
| Today/journal/reports F03/F04/F06 | PASS,17 checks | Fifteen visible scenarios, second operator, draft/error/retry/navigation races, independent report oracle |
| Attendance PostgreSQL | PASS,3 tests | Frozen roster, statuses/idempotency/history/concurrency; HTTP/SQL tests, not three full journeys |
| Series PostgreSQL | PASS,17 tests | DST/year/month boundaries, atomic conflicts and concurrent creates/edits/series, teachers/businesses |
| Mixed acceptance | PASS,11 tests | PostgreSQL, HTTP and browser contracts; not11 education journeys |
| Navigation / submit / context | PASS | Mixed/internal/mocked tests explicitly distinguished; actual-app submit barriers and negative retry probes |
| Mobile Chromium / WebKit | PASS,753 checks per engine | Six emulated profiles per engine,117 frames each; keyboard/focus/reflow, light/dark, forms/series/settings |
| Visual review / contrast | PASS | 60 audits,4529 measured text samples, minimum normal4.55:1 / large3.48:1, no contrast failures or unstyled buttons; Park comparator unchanged |
| Editor control activation | PASS | Six browser/viewport profiles;54 edge hits,36 trusted clicks;18 save requests deliberately blocked, not successful writes |
| npm test | PASS,exit0 | Runtime, ownership/protected/migration/parser guards, unit and UI baseline. General thousands of assertions are not education journeys |
| Old production read-only reference | COMPLETE,exit0 | v0.82.61 identity, Dar report/group observations; not proof of deployed candidate |
| Physical devices / native pickers / screen readers | BLOCKED_DEVICE,42 NOT RUN | Owner deferred after deployment; no fabricated PASS |
| Candidate CI / deploy / live smoke | NOT RUN at preparation | Must complete for exact final release SHA; final record output/education-ready/release-acceptance/RELEASE_PROOF.md |

The aggregate gate was first exercised with missing npm evidence: NO-GO/exit1. The completed latest gate is GO_WITH_OWNER_DEVICE_DEFERRAL/exit0. All19 required suites are fresh, exit0 and hash-bound; incomplete, stale or failing evidence is rejected.

## Preserved failures and limits

Historical NO-GO remains preserved below the updated root acceptance and in the original package worktree. The two editor/WebKit product blockers were fixed within the previously authorized education scope before integration; fresh tests above repeat them on the release source.

Initial new series journey attempts failed because the test incorrectly expected cancelled lessons in active Today and then through the active-only detail endpoint. The corrected independent oracle checks Today absence and the existing includeCancelled series endpoint plus complete SQL row equality. No product fallback or API repair was added.

One batch WebKit attempt completed13 functional checks and failed zero-page-errors because navigation cancelled an outgoing bootstrap timeline-visibility read. The strict same-source/same-harness retry passed14/14 with zero page errors. Both attempts remain in command manifests; the batch exit1 is retained, never rewritten. This is a known navigation harness flake, not proof of a production CORS failure.

All425 fresh screenshots were personally viewed in23 contact sheets; three critical controls also at full resolution. Original pixels and their hashes were preserved: personal-review.json. Local reconnect banners result from outbound holds and are neither production failure nor live synchronization evidence.

Background diagnostics:125 recorded failure/negative events, zero unclassified after specific source review. Controlled403/409/500/503 test faults prove draft/retry/atomicity; AbortController cancellations are checked against settled current SQL-backed state. Existing non-education bootstrap requests to education groups/teachers correctly receive403; they are unnecessary noncritical reads, not a reason to broaden permissions. The old live legacy /api/staff staff_not_migrated failures are v0.82.61 observations of the teacher defect, not new-release proof. Pre-login401 is correct. Editor blocked PUTs are not successful saves.

Whole release diff reviewed: only scoped education product/test/docs and generated release markers; no output, secrets, synthetic execution, auth/permissions/infrastructure changes. git diff --check reports only five inherited extra blank lines at EOF in QA runner files; no functional defect. These were left unchanged to preserve the exact verified harness hashes.

## Migration and release controls

Fresh production already owns migration375 and later375–379. The package's additive teacher membership SQL was renumbered unchanged to380_education_teacher_memberships.sql; focused tests reference380. Historical report375 labels remain historical. Governance, replay and first assignment pass. No inferred ownership, automatic backfill, synthetic seed, destructive SQL or production data fix is included.

Rollback: manually promote base44a7d498 through the same release helper and exact green-CI identity controls, retaining the additive membership table/data. No down migration, DROP or force push. Historic rollback branch codex/checkbox-hardening-release-v080103 is preserved.

Railway source preflight: project fortunate-appreciation / production / service8223324090. It is a manual upload service with source repo=null/image=null and no repo trigger; there is no configured Git branch field to pretend was confirmed. Live manifest and remote both identify codex/eventgenix-production at44a7d498. Release uses that explicit branch and project; no settings changed.

Next: commit this acceptance documentation, fast-forward push only to confirmed production branch, await all required exact-SHA CI jobs, manual release:railway-up with explicit project/branch, exact /api/version validation and request-layer read-only Dar/Park smoke. Preserve dirty original checkouts, all1542 prior evidence files and retained manual dataset. Final deployment/CI/rollback proof is filled locally after deployment to keep live and remote SHA identical.
