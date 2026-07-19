# Payroll scheme matrix release evidence - 2026-07-18

Production impact: yes.

This evidence is aggregate-only. It intentionally excludes credentials, tokens, staff
identifiers, attendance identifiers, Railway project/service/deployment identifiers,
PII, real rates, and real payroll amounts.

## Release

| Field | Evidence |
| --- | --- |
| Version | `0.79.81` |
| Release label | `Payroll Scheme Matrix QA` |
| Product/test commit | `0fda0ac39` - `Harden payroll simultaneous QA gates` |
| Release commit | `de043e0e0` - `chore: release v0.79.81 payroll scheme matrix QA` |
| Deploy source branch | `codex/performance-hardening` |
| CI run | `29657470752`, conclusion `success` |
| Railway app deployment | `SUCCESS`, created at `2026-07-18T19:16:17.360Z` |
| Runtime evidence | Railway resolved Node.js `22.23.1` |
| Production version smoke | `v0.79.81 - Payroll Scheme Matrix QA` |

## Guarded live QA matrix

Run timestamp: `2026-07-18T22:30:08+03:00`.

The live QA runner used normal creator/director login credentials loaded locally,
created one disposable employee per scheme, used a unique run ID per scheme, used
future dates only, and did not call generate, commit, approve, reverse, pay, or
close payroll actions.

| Scheme | Expected contract | Result |
| --- | --- | --- |
| `hourly` | Supported; physical `540`, base `540`, additional `510`; no blocker | Passed |
| `per_shift` | Supported; base scheme unchanged, additional immutable hourly top-up `510`; no blocker | Passed |
| `monthly_fixed` | Supported; base scheme unchanged, additional immutable hourly top-up `510`; no blocker | Passed |
| `hybrid` | Unsupported; unresolved additional `510`; blocker `PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED` | Passed |
| `percent` | Unsupported; unresolved additional `510`; blocker `PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED` | Passed |
| `manual` | Unsupported; unresolved additional `510`; blocker `PAYROLL_SIMULTANEOUS_ADDITIONAL_SCHEME_UNSUPPORTED` | Passed |

Cleanup was confirmed after every scenario:

| Counter group | Result |
| --- | --- |
| `schedules`, `shifts`, `attendance`, `checkins`, `shiftPreferences`, `timelineLines` | `0` after cleanup |
| `payrollReports`, `payrollEntries`, `salaryAdjustments`, `disciplineActions` | `0` after cleanup |
| `financeTransactions`, `salaryTransactions`, `salaryReversalTransactions`, `payrollMutationAuditRows` | `0` after cleanup |
| `activePayrollSchemes`, `activePayrollProfileAssignments` | `0` after cleanup |
| `archived`, `financiallyClean`, `confirmedClean` | `true` for every scenario |

Retained inactive QA configuration history remained intentionally archived:
`retainedPayrollSchemes=1`, `retainedRoleAssignments=2`, and
`retainedProfessionRates=2` per disposable scenario.

## Post-deploy attendance snapshot delta audit

The release-gate audit was run against production through
`REPEATABLE READ READ ONLY` and ended with `ROLLBACK`.

| Field | Result |
| --- | --- |
| Policy effective date | `2026-07-18` |
| Deployment cutoff | `2026-07-18T19:16:17.360Z` |
| Query complete | `true` |
| Classification incomplete | `false` |
| Post-fix records | `0` |
| Post-fix missing snapshots | `0` |
| Post-fix invalid/manual-review snapshots | `0` |
| Post-fix paid allocation without valid final snapshot | `0` |
| Post-fix unknown writers | `0` |
| Release gate | `passed` |

Historical/pre-cutoff data was reported separately and was not modified by this
release evidence task.


