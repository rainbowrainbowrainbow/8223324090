# Configurable compensation: local review receipt

Owner goal: 2026-11-18. Worktree: `D:/Codex/EventGenix/configurable-pay-rules-20261118`.
Branch: `codex/configurable-pay-rules-20261118`.
Base: `e4d666d6c4e3836a53316b468a4e86c844fba4cc`, package version 0.83.114.
No release/version bump, commit, push, deployment or real business-data write.

## Result

Nullable versioned rules preserve legacy profiles. Configured profiles support
fixed monthly contracts, confirmed monthly time/day norms, daily exits or short-day
proration, recurring monthly components and separate manual commission bases.
Canonical snapshots, profile simulations, forecasts and installment previews share
the same rule calculation. Fixed entitlements include dates without attendance;
missing attendance is not treated as an unpaid absence.

The existing precedence remains: dated exception, temporary assignment, explicit
assignment, profession default, legacy fallback. Vacancy/company templates affect
new applications only after explicit review; applying them creates a personal
dated snapshot with origin. Qualification events are dated, audited and preserve
personal terms unless explicitly replaced. Existing frozen history and period
locks reject retrospective writes. Tips are non-monetary notes.

The owner separately approved `PAY-RULES-ACCESS`. Its exact ten operations reuse
the existing Park VIEW/RULES capability sets, active membership, single writable
scope and ownership verification. No new grant, role or booking contract change.

## Verification actually performed

Runtime: Node 22.23.4 / npm 10.9.9. Application dependencies and lockfile unchanged.
PostgreSQL 17: task-created loopback cluster, port 59643, disposable database
`eventgenix_pay_rules_disposable_test`; all migrations through 423 applied there.
The task-created cluster was stopped after verification; no test server remains
required for reviewing the diff or saved evidence.

| Check | Final evidence |
| --- | --- |
| `npm test` | Exit 0, including verify, unit, My Day, CRM automation, UI, SYS-MB, timeline marketing and Telegram CRM. Explicit unit stage: 4021 passed, zero failed/skipped. |
| Focused rule/UI/regression selection | 74 passed before the additional authorization test; access/capability/server selection after approval: 31 passed. |
| `payroll-configurable-rules` isolated mode | 9 passed, zero failed/skipped, including real HTTP hiring and atomic stale-template rollback. |
| Existing isolated payroll regression | First 12 suites: 121 passed, zero failed/skipped. The last costing suite was verified separately after correcting its local fixture prerequisites; 1 passed, unchanged assertions and original 120-second deadline. |
| Actual-app membership browser | PASS: real employee navigation, scoped company default, separate own/other manual bases, level creation/promotion, dated fixed-month save, keyboard/mobile, vacancy template update, reviewed vacancy hire and personal snapshot. Zero page errors. |
| Migration governance / protected surface / syntax | Passed in `npm test`; `git diff --check` also passed. |

Concrete calculation evidence:

- No-attendance fixed salary: 20000/month = 10000 advance + 10000 final.
- Five planned hours across two segments of a 600-minute full day: 300 base;
  advertising 3500 once; own 10000 x 4% plus other 20000 x 1% = 600; total 4400.
  Actual no-attendance entitlements in the same fixture: 4100. Missing next-month
  commission bases produce explicit blockers, not zero.
- Profile simulation agrees with the 4400 forecast. A 600 -> 1200 daily-rate
  impact changes that forecast by 300; unchanged components remain once/month.
- Dated fixed-rate/profile changes, retained cloned components, component removal
  and identical-version boundaries preserve period coverage and frozen snapshots.
- Qualification changes preserve dated history, support a deliberate personal-pay
  decision, reject stale updates and reject retrospective frozen history changes.

Local environment failures were diagnosed rather than suppressed. The first full
baseline had three WebKit bootstrap failures because bundled GNU Bash is named
`sh.exe`. A task-local executable copy named `bash.exe`, plus process-only PATH
and GIT_BASH_PATH settings, allowed the unchanged tests and full baseline to pass.
No application dependency was added. The broader costing test initially required
a nonempty synthetic local connection password despite the owned trust fixture;
its first separate run then exceeded the deadline during PostgreSQL database-drop
cleanup. A read-only diagnostic trace identified `CheckpointDone`, and the final
unchanged test passed in 101.9 seconds, including cleanup. No test timeout or
financial assertion was weakened. Original and final logs remain in ignored output.

Evidence logs: `output/pay-rules-npm-test.log`,
`output/pay-rules-targeted-tests.log`, `output/pay-rules-access-check.log`,
`output/pay-rules-payroll-regression.log`, `output/pay-rules-costing-trace.log`.
Browser receipt: `output/playwright/payroll-configurable-rules/result.json`.

## Visual and guidance review

All seven final synthetic-only screenshots were visually inspected under
`output/playwright/payroll-configurable-rules/`:
`company-default-desktop.png`, `commission-base-desktop.png`,
`level-transition-desktop.png`, `fixed-month-desktop.png`,
`fixed-month-mobile.png`, `vacancy-month-desktop.png`, `reviewed-hire-desktop.png`.
Desktop viewport: 1440x1000; small viewport: 390x844; actual browser: installed
Microsoft Edge. Screenshots wait for natural toast expiry; no toast DOM is hidden
or deleted by the test. Native controls remain readable and the modal fits the
small viewport. Tab navigation and actual saves were exercised. This is viewport
testing, not a claim of native iOS or every-browser testing.

Modern Web Guidance `forms` and `validate-input-after-interaction` informed the
form controls and submit validation. Scoped overrides restore visible focus where
the shared form has inline outline:none, retain native controls, use 16px minimum
control text and 48px targets, and reuse field-linked custom errors/focus routing.
The `js` guide was also retrieved; its APIs did not require a different approach
for the scoped event-propagation repair. The vacancy card's legacy action group
stops bubbling, so its new owned button uses scoped capture delegation. No new
browser-only experimental API or dependency was introduced.

## Changed files

| Area | Files |
| --- | --- |
| Rule model and canonical calculation | `services/payrollRules.js`, `services/payrollConditionCalculation.js`, `services/payroll.js`, `services/hrPayrollConditions.js`, `services/hrPayrollProfiles.js` |
| Templates, levels, manual inputs and access | `services/hrCompensationRules.js`, `routes/hr.js`, `services/parkHrPayrollAccess.js` |
| Additive schema | `db/migrations/423_configurable_pay_rules.sql` |
| UI | `hr.html`, `js/hr-page.js`, `js/hr-pay-rules.js`, `js/hr-compensation-ui.js`, `css/hr-pay-rules.css` |
| Tests and commands | `tests/payroll-configurable-rules.test.js`, `tests/payroll-configured-journey.test.js`, `tests/hr-pay-rules-form.test.js`, `tests/park-hr-payroll-access.test.js`, `tests/integration/payroll-profiles-configurable-rules.integration.test.js`, `tests/browser/payroll-profiles-configurable-rules-actual-browser.js`, `scripts/run-isolated-postgres-tests.js`, `package.json` |
| UI manifest and documentation | `config/cssSurface.js`, `docs/CSS_SURFACE.md`, `docs/CONFIGURABLE_PAY_RULES_PLAN.md`, `docs/CONFIGURABLE_PAY_RULES_ACCESS_PROPOSAL.md`, this receipt |

## Remaining boundaries and next action

Commission v1 deliberately uses separately confirmed manual own/other bases.
Automatic attribution, refunds/cancellations and the economic revenue basis still
need an agreed policy. New/changed commission terms for a partial month require
review; unagreed leave and partial-month salary cases also remain explicit blockers.
Confirmed monthly norms must match the earning month.

Other companies have scoped default templates. Applying the existing legacy
staff/profile IDs outside Park remains blocked until their ownership model is
separately established. No global ownership recovery is implied.

The private owner guide beside the launched goal contains Ukrainian setup steps
and all 28 source-row mappings, without personal names. It preserves the October
filename / April worksheet-heading conflict, unclear pay units, security-team
budget ambiguity, accountant 2000 interpretation and the unconfirmed manager +1.

Recommended next action: review this local diff and private entry guide. Before a
separately authorized release, refresh production refs/version, revalidate whether
migration number 423 is still free, run exact-SHA CI and prepare the normal release
manifest. Real rate entry needs its own approved employee/profile/date mapping;
none is authorized by completion of this local goal.
