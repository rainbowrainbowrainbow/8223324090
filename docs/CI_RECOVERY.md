# CI recovery: storage and settings-test initialization — 2026-11-02

Historical preparation record. For the integrated candidate and current CI gate,
see [CI_COST_INTEGRATION.md](CI_COST_INTEGRATION.md).

Worktree: `D:\Codex\EventGenix\ci-recovery`, branch `codex/ci-recovery`.
Base: b8e842cf4053713c0006f9e96c56ab55cef317b6 (0.82.118).
Evidence and final result: `D:\Codex\EventGenix\ci-recovery-evidence`.
Local preparation only; no commit, push, deployment or remote configuration change.

## Storage finding supersedes the earlier blocker

The October 25 run 40193642237 failed to upload artifacts because of account
storage quota. The owner reports having paid for the plan. Read-only authenticated
GitHub Billing Overview now shows GitHub Pro, Actions storage displayed as
0.1 GB of 2 GB (6%, rounded figures), and Actions billable usage of USD 0 for the
selected current month. Included compute shows USD 0 of USD 18. No payment,
budget, retention setting or subscription was changed by this task.

The complete artifact inventory of 17 accessible owner repositories contains
22 nonexpired artifacts, all in this CRM repository, totaling 214,024,769 bytes.
Artifact archive bytes and the billing page's rounded storage measure are not
identical metrics. The consolidated usage endpoint returned HTTP 404, so current
billing figures came from the visible account UI. The current capacity does not
justify deleting artifacts. No artifact or cache was deleted, and no extra spend
was enabled. A new hosted upload was not probed; the historical failure is not
presented as proof that uploads are still blocked.

The prior explicit-14-day retention proposal remains a separate optional review
item in `D:\Codex\EventGenix\test-ci-evidence`; it was not applied or used to
suppress a required evidence-upload error.

## Exact browser failure and minimal correction

The same source run's education acceptance job 123341528085 executed 11 cases:
10 passed, while `Creator can stage settings while a reader cannot save via UI
or API` timed out waiting for `[data-timeline-settings-display="mode"]` to be
visible. The locator found the select, but its system tab stayed inactive.

`js/timeline-settings-page.js` initializes asynchronously: session readiness,
business-profile hydration, event binding, settings loading, rendering. The
authenticated shell can be visible before the settings-specific tab handler is
bound. Clicking the static System tab during that gap loses the intended action;
the later rendered select remains in the inactive hidden panel.

The change is confined to `tests/integration/education-series.integration-acceptance.test.js`:
wait for the rendered mode control to be attached, click the System tab, then
retain the original visibility, staging, save-affordance, unchanged-profile and
reader API-denial assertions. No production auth, capability, route, product UI,
booking/timeline contract or protected manifest is changed. No assertion, case,
required evidence or error is removed. The existing per-check 20-second timeout
values remain; an explicit readiness phase is added instead of forced clicking,
unhiding controls or retrying the test.

## Reproduction and local limits

The external local Playwright adapter reuses Playwright 1.64.1 and existing Chrome
156.0.8078.74. It points headless Chromium to the installed executable; no new
browser or dependency was installed. Native fixture, HTTP app, database locking,
schema cleanup, TAP and proof/source validation remain in use.

A second external adapter deliberately delays the second business-profile read
on the timeline-settings page by 1,500 ms. This is network fault injection, not a
sleep used to synchronize the corrected test. The unchanged test reproduces the
exact hidden-select failure (10/11, no skips); the corrected source is verified
with the same injected delay. Read final JSON results and REPORT.md for the
actual final outcome rather than assuming it from this description.

The local-only PostgreSQL 16.15 cluster runs at 127.0.0.1:55432. This task created
and registered one separate disposable database:
`eventgenix_education_ready_fixture_test`, owned by restricted `eventgenix_test`.
The earlier automation database is preserved and its migration ledger compared.
No production credentials or business records are used. Providers/outbound
traffic remain held by the existing native harness and loopback/browser guards.

The initial unmodified acceptance run executed all 11 cases but failed its final
cleanup because the local 40-connection cluster's default lock table could not
drop the full fixture schema. That overall run is FAILED, not acceptance proof.
The local cluster was restarted with temporary command-line
`max_locks_per_transaction=512`; persistent configuration and production are
unchanged. One diagnostic attempt during the pending restart executed zero tests
and is retained as infrastructure-blocked, not a test result. Cleanup must pass
and leave zero public tables before the corrected run can be considered green.
The local cluster is stopped at handoff; see the final probe/lifecycle evidence.

## Handoff and rollback

This task does not integrate prior pending Hermes, PDFKit or test/CI worktrees.
Their dirty-file identities and hashes are checked against the starting snapshot.
Do not overwrite a whole package manifest while combining their edits later.

Next: integrate the reviewed readiness fix with the existing local CI proposals
in an explicitly scoped candidate, then obtain exact-SHA hosted CI under the
repository's applicable delivery authorization. Verify all required jobs and
artifact uploads; a local Chromium/PostgreSQL run is not Linux hosted CI evidence.
Do not rerun the old failed SHA merely to seek a lucky pass.

Rollback is the exact inverse of the small test-only diff. Preserve unrelated
changes and evidence; no database/data or production rollback is required.
Stopping the local cluster removes the temporary lock-table override from the
running state. Native local database cleanup targets only the registered fixture;
no broad or remote cleanup is authorized by this task.

Sources: [failed job](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/40193642237/job/123341528085),
[account Billing Overview](https://github.com/settings/billing),
[Actions billing metrics](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[Playwright locator states](https://playwright.dev/docs/api/class-locator#locator-wait-for),
[PostgreSQL 16 lock-table setting](https://www.postgresql.org/docs/16/runtime-config-locks.html).
