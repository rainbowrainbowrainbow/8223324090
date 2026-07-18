# Disposable live QA: simultaneous profession pay

- Date: 2026-07-18 (Europe/Kyiv)
- Environment: production
- Build: `v0.79.64 — Simultaneous Pay Live QA Reliability`
- Commit: `d3eac37bc7f753a976fda50e1902158061c74aaf`
- Operator authorization: authenticated `creator` role
- Test data: disposable employee, synthetic hourly rates, future date `2026-11-16`
- PII: omitted

## Scenario

The guarded live QA runner saved and reloaded this day plan:

1. `11:00–11:30` — `wardrobe` (Гардеробник).
2. `11:30–20:00` — `wardrobe` plus explicitly paid simultaneous `cleaner`
   (Господарочка залу).

Attendance was recorded through the canonical clock-in/clock-out service. Payroll
was inspected through read-only preview only.

## Result

| Check | Expected | Actual |
| --- | ---: | ---: |
| Physical minutes | 540 | 540 |
| Base `wardrobe` paid minutes | 540 | 540 |
| Additional `cleaner` paid minutes | 510 | 510 |
| Physical hours | 9.0 | 9.0 |
| Base role-hours | 9.0 | 9.0 |
| Additional role-hours | 8.5 | 8.5 |
| Base amount at synthetic 100 UAH/hour | 900 UAH | 900 UAH |
| Additional amount at synthetic 200 UAH/hour | 1,700 UAH | 1,700 UAH |
| Preview net amount | 2,600 UAH | 2,600 UAH |

The attendance compensation snapshot was `final`, required no manual review, and
contained no reconciliation issues. Physical time remained nine hours and was not
inflated to 17 hours 30 minutes.

## Safety and cleanup

- No payroll generate, approve, pay, close, reverse, or payment operation was run.
- No generic API key was used as an authorization bypass.
- Cleanup ran from `finally`.
- Post-cleanup read-only verification returned zero schedule, HR shift, attendance,
  camera check-in, payroll report, and salary adjustment records for the fixture.
- The disposable employee was archived and the cleanup result was
  `confirmedClean: true`.
- The independent staff delete-readiness check returned `can_delete: true` with no
  relevant residual blockers.

## Verification

- Guarded production scenario: passed.
- Schedule save/reload round-trip: passed.
- Payroll preview allocation assertions: passed.
- Planned-hours report assertion: passed.
- Production version smoke: passed.
- GitHub Actions CI run `29637644206`: passed.

Earlier attempts against `v0.79.63` correctly failed closed because the live QA
attendance helper did not create the canonical compensation snapshot. Both failed
fixtures were cleaned. The production fix in `v0.79.64` routes QA attendance
through the canonical attendance services, after which the exact scenario passed.
