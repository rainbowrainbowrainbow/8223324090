# Test suite cleanup

The base commit is `50dee4768720ab3967c38d63ed2a66ad32a7e578` from
`codex/performance-release-08321-20261107`. The cleanup is isolated in
`codex/test-suite-cleanup-20261114`. The source checkout's CI and customer
performance changes were reviewed separately.

## Execution map

The workflow triggers on push and pull request. The retained jobs below
run for both trigger types regardless of changed paths.

| Job | Test entry points and isolation |
| --- | --- |
| Fast baseline | PDF visual audit, then `npm test`. The npm chain is `verify`, `test:sys-mb`, and `test:timeline-marketing`. `verify` runs the named policy and domain commands, then `test:unit` (expanded by `scripts/run-unit-tests.js` using `test:unit:files`), My Day, CRM automation and UI checks. |
| Omni browser | Omni browser smoke, PostgreSQL lead links, and isolated lead workspace and Park Manager browser checks. |
| HR Team browser | Five filtered account access scenarios, sidebar and booking smoke, Task Center, HR Team, payroll profiles, HR Checklists, HR Today, HR Pulse, onboarding, and staff schedule. |
| My Day browser | Draft, AI composer, interactions, isolated actual app, isolated HR Checklists and two Wallet PostgreSQL invocations with distinct PostgreSQL time zones. |
| Certificate regression | PostgreSQL redemption and app booking, legacy Telegram, certificate browser smoke, and actual-app booking precheck. |
| HR and payroll PostgreSQL | Isolated attendance lock, permissions, onboarding, legacy backfill, payroll profiles and simultaneous payment, admission, banquet recovery, and full-stack HR onboarding in Chromium. |
| My Day PostgreSQL | Its own isolated classification, AI, timer, and atomic commit group. |
| Checkbox PostgreSQL | Thin unit suite, isolated configuration and local mock cashier, and isolated real-browser UI. |
| Education regressions | Five shards in `scripts/run-education-ci-shard.js` with 15 required suite/engine pairs, including Chromium and WebKit. The runner validates isolated, source-bound evidence from each suite. |

`scripts/run-isolated-postgres-tests.js` selects files by suite name, starts
the loopback app and tests disposable PostgreSQL state. The Education paths
also resolve their exact test files and expected evidence through
`tests/helpers/education-close-contracts.json`. The CI job names, matrix,
database guards, evidence policies and protected surfaces retain their checks.

## Historical hosted baseline

[Actions run 42362422689](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/42362422689)
was a successful push run on the exact base SHA. The 13 job durations sum to
4,147 seconds (69.12 runner minutes). The longest job was Education WebKit
responsive at 700 seconds. Elapsed workflow time from run start to the last
job completion was 702 seconds. The original two-file Education step was 74 seconds,
including Chromium setup. Only the series process and its isolated setup are
removed from that step. The five fully removed
steps together occupied one second at the Actions API timestamp resolution.

## Removed work and retained checks

| Removed invocation or assertion | Retained check and regression covered |
| --- | --- |
| [Dedicated Railway collision-guard step in Fast baseline](https://github.com/rainbowrainbowrainbow/8223324090/blob/50dee4768720ab3967c38d63ed2a66ad32a7e578/.github/workflows/ci.yml#L47) | The same `tests/release-railway-up-predeploy.test.js` runs via `npm test -> verify -> test:version-tooling` in the same job. For example, stale versions and same-version SHA collisions still fail before upload. |
| [Scheduler step in certificate regression](https://github.com/rainbowrainbowrainbow/8223324090/blob/50dee4768720ab3967c38d63ed2a66ad32a7e578/.github/workflows/ci.yml#L398) | Both `tests/scheduler-notification-jobs-hardening.test.js` and `tests/scheduler-guard-contract.test.js` remain in `npm test -> verify -> test:unit -> test:unit:files`. They cover job deduplication and scheduler access to unfinished jobs. PostgreSQL, legacy Telegram, and browser certificate checks retain their job. |
| [Direct Education series file in HR/payroll](https://github.com/rainbowrainbowrainbow/8223324090/blob/50dee4768720ab3967c38d63ed2a66ad32a7e578/.github/workflows/ci.yml#L507) | `series/chromium` in `chromium-core` runs the same 18 tests from `tests/integration/education-series.integration.test.js`, including controlled create/create, create/edit and create/series collision checks and full rollback on a later conflict. Both series entry points force UTC and use the same fixed application clock. They initialize and clean up their own disposable database using the shared runner. The retained wrapper also checks the mandatory scenario list, TAP and proof. |
| [Migration governance step in Checkbox](https://github.com/rainbowrainbowrainbow/8223324090/blob/50dee4768720ab3967c38d63ed2a66ad32a7e578/.github/workflows/ci.yml#L615) | `npm run check:migrations` remains in `npm test -> verify`. It catches missing governance headers and unapproved risky schema changes. This is a source scan with no dependency on the Checkbox PostgreSQL service. |
| [Pinned OpenAPI compatibility step in Checkbox](https://github.com/rainbowrainbowrainbow/8223324090/blob/50dee4768720ab3967c38d63ed2a66ad32a7e578/.github/workflows/ci.yml#L618) | `npm run check:checkbox-openapi` remains in `npm test -> verify`. It checks the pinned semantic request and response contract. |
| [Checkbox source safety step](https://github.com/rainbowrainbowrainbow/8223324090/blob/50dee4768720ab3967c38d63ed2a66ad32a7e578/.github/workflows/ci.yml#L621) | `npm run check:checkbox-safety` remains in `npm test -> verify`. It checks source and CI for prohibited integration configuration. |
| [`checkbox-openapi-contract.test.js` in `test:checkbox-thin`](https://github.com/rainbowrainbowrainbow/8223324090/blob/50dee4768720ab3967c38d63ed2a66ad32a7e578/package.json#L230) | `npm run test:checkbox-openapi-contract` remains in `npm test -> verify`. The file constructs its own official-shaped fixture and catches semantic drift, including response codes and required fields. Both original calls were Linux/Node 22 and used no database, browser, or job-specific fixture. The focused thin command continues to run its own remaining twelve files. To run both locally, use these two focused commands. |
| [`buildCustomerSearchQuery` presence assertion inside `tests/booking-package-contract.test.js`](https://github.com/rainbowrainbowrainbow/8223324090/blob/50dee4768720ab3967c38d63ed2a66ad32a7e578/tests/booking-package-contract.test.js#L4732) | The identical source assertion remains in `tests/customer-search-query.test.js`, registered in the same aggregate unit list. It also checks that the route does not inline a second phone condition. A process-local source-read substitution hid the builder identifier and the retained assertion failed at the expected regular expression. The unmodified source passed. The surrounding booking assertions, including the phone digit assertion, retain their coverage. |

For the Education shard commands, use installed Playwright Chromium and the
existing guarded, disposable `eventgenix_education_ready_fixture_test` target.

```text
npm exec --yes --package=playwright -c "node tests/integration/run-education-close-ci.js series chromium"
npm exec --yes --package=playwright -c "node tests/integration/run-education-close-ci.js acceptance chromium"
npm exec --yes --package=playwright -c "node scripts/run-isolated-postgres-tests.js education-series-acceptance"
npm run test:checkbox-openapi-contract
npm run test:checkbox-thin
node --test tests/customer-search-query.test.js tests/booking-package-contract.test.js
```

The first two commands are the individually reproducible cases that the
Education matrix runs. The third command preserves the 11-case HR/payroll
acceptance pass under the fixed UTC application clock. The Education acceptance
wrapper freezes only the report input and otherwise uses the Kyiv process time
zone. The test cases and cleanup are shared, but the clock paths are distinct.
The original standalone `test:integration:education-series:isolated` still runs
both direct files. This is why the proposed full removal of the Education step
was narrowed to removing its extra series process.

## Candidates retained

- HR structure-loading browser smoke is shared by the manual HR structure and
  performance bundles. Neither bundle is called by the workflow at this base.
  Each manual bundle's other cases serve a different purpose.
- Account-access browser invocations use five distinct name filters. Wallet
  PostgreSQL runs exercise UTC and America/Los_Angeles on purpose.
- Customer query behavior checks include SQL construction, normalized inputs
  and real HTTP response assertions in separate suites. The shared builder is
  consumed by both the route and customer audit, so the canonical route wiring
  assertion has an independent architecture purpose. The uncommitted customer
  performance tests add query-specific assertions and belong with those changes.
- The 727 tracked test/spec files had no byte-identical pair. A syntax-tree scan
  of 7,646 literal `test`/`it` callbacks found six cross-file matches. The
  Afisha invalid-date and Telegram empty-notification assertions run in the
  isolated API smoke and in separate manually runnable domain suites. Both
  entry points provide domain-local diagnostics and neither constitutes an extra
  hosted invocation. The four My Day matches call guards from different
  scripts (AI writes and completion writes); their bodies look alike because
  both entry points implement their own safety boundary.
- Other identical titles in broad versus domain API suites use different
  assertions, scenario setup, or fixtures. For example, the sales-funnel
  version test asserts the shape of `testMode`, and the broad API version test
  asserts deploy provenance fields.
- Historical filenames alone did not establish retirement. For example,
  `tests/manual-animator-line.test.js` checks that the retired direct-write
  route stays unavailable and also verifies idempotent writes through the
  supported path. Both behaviors are current contracts.

## Verification

Local output is under the cleanup worktree's ignored `output/cleanup-proof`
and `output/education-ready/cleanup-proof`. The disposable PostgreSQL cluster
was bound to loopback. The validation runtime was Node 22.23.4, npm 10.9.9,
PostgreSQL 17.11 and Playwright Chromium 1.65.1. The hosted baseline ran on
Linux/PostgreSQL 16. A matching hosted run is needed for the timing comparison.

The Checkbox wiring regression now verifies `fast-baseline -> npm test ->
verify` and the four retained commands. It continues to verify the dedicated
Checkbox thin and isolated integration steps. A focused run exposed the old
assertion of direct workflow commands, then passed after the path assertion
was updated.

| Check | Local result |
| --- | --- |
| `npm run check:runtime` | Node 22.23.4 / npm 10.9.9 passed. |
| Education shard contract, isolated database flow, Railway predeploy and Railway static contract | 118 passed, 0 failed or skipped. |
| Scheduler contracts and Checkbox OpenAPI contract | 66 passed, 0 failed. |
| `npm run check:migrations`, `npm run check:checkbox-openapi`, `npm run check:checkbox-safety` | All passed. |
| Booking package, customer query and Checkbox OpenAPI contracts | 142 passed, 0 failed or skipped. |
| `npm run test:checkbox-thin` | 281 passed, 0 failed or skipped, after correcting the gate wiring assertion. |
| Direct Education comparison and final UTC acceptance mode | Baseline direct passed 18 series and 11 acceptance tests. Final acceptance-only runner selected just the 11 acceptance tests, all passed with zero skips. |
| Source-bound Education Chromium matrix cases | Series 18/18 and acceptance 11/11 passed with validated source inventories and zero skips. Their exact scenario titles matched the direct runs. The complete matrix retains all 15 suite/engine pairs. |
| `npm test` | Exit 0, including 3,970/3,970 aggregate unit tests and end-of-command Timeline Marketing 41/41. The final code/test changes were already staged when the run started and committed as `ec4aee00` during execution. |
| `git diff --check 50dee476` | Passed. The original source checkout still reports its pre-existing work on the same base SHA. |

The CI wiring comparison checked 443 explicit test-file paths in `npm test`
and found no duplicate invocation within that graph. It also verified that
the CI job names, triggers and Education matrix were identical and that
the thin npm script lost only the OpenAPI contract file. A process-local
negative control for the retained customer assertion produced the expected
one failure. It left the tracked route source untouched.

The initial local npm command failed because an explicitly selected shell
rejected the npm command line. The subsequent overlapping runs were stopped
after sources changed. They are excluded from comparison. Final hosted
workflow time and runner-minute savings require a hosted run on the
cleanup SHA. There was no hosted execution of this local branch.

## Rollback

Revert the cleanup branch's commits in reverse order. The CI/runner commit
restores the five standalone job steps and the direct two-file Education step.
The npm/test commit restores the second Checkbox module invocation and the
duplicate booking assertion. A report-only revert affects documentation.
