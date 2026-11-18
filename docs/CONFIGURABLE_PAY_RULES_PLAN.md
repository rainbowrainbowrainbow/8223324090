# Configurable compensation implementation

Scope: the owner-approved local goal dated 2026-11-18. No commits, production
writes, deploys, secrets or booking-contract changes. The owner separately
approved the exact local PAY-RULES-ACCESS operation mapping in this task.
Base: e4d666d6c4e3836a53316b468a4e86c844fba4cc (production verified at start).

## Model and precedence

1. Preserve the existing dated exception, temporary assignment, explicit assignment,
   profession default, and legacy fallback order.
2. Add nullable versioned `pay_rules` to payroll profile versions. NULL retains
   existing calculation semantics; new rules are explicit and frozen with terms.
3. A vacancy holds a pay template, including a chosen amount or range, unit, rules
   and optional qualification level. Applying it creates a personal dated profile
   snapshot; later vacancy edits do not change employees.
4. Qualification levels belong to a business context and profession, reference
   profiles, and use append-only dated transition history. Qualification changes
   create dated pay assignments, not authentication roles. Keep personal overrides
   visible and require a deliberate replacement decision.
5. Company/profession defaults and all new level/template/input records are scoped
   by existing business context. Legacy Park ownership guards stay in place; do not
   open another company's legacy payroll namespace by inferring ownership.
6. Recurring components belong to a profile version. Manual percentage bases are
   explicit period inputs with author, explanation and confirmed zero support.
7. Both attendance conditions and period calculations use one pure rule calculator.
   Fixed monthly entitlements must be loaded even without attendance rows. Query
   ranges allocate monthly amounts consistently; settlement subtracts prior advance.

## Work packages and acceptance evidence

- [x] A. Strict rule normalization, pure calculation and behavioral unit tests.
- [x] B. Additive schema; profile CRUD/clone/sync/resolver/frozen terms round trip.
- [x] C. Canonical period/attendance/simulator/advance/final integration, including
      no-attendance fixed monthly pay, date boundaries and manual components.
- [x] D. Scoped default/template and qualification services/routes; vacancy apply,
      promotion and history; manual commission input lifecycle and locks. The
      separate Park membership operation mapping was explicitly approved and
      implemented locally; all existing membership/ownership guards remain.
- [x] E. Employee and vacancy UI, level selection/history, rule explanations,
      components/input forms, responsive and accessible interactions.
- [x] F. Isolated PostgreSQL and browser journeys, required regression checks,
      reviewed mobile/desktop screenshots and migration governance.
- [x] G. Owner-facing setup instructions, all 28 source-row entry mappings,
      remaining questions and exact next release/data-entry scope.

## Decisions

- Monthly modes: fixed, confirmed norm in minutes, confirmed norm in days.
- Daily modes: per exit, proportional by net actual or paid planned minutes.
- Partial employment/rate month: explicit calendar-day policy or review blocker.
  A missing attendance entry is not an absence. Leave policy remains explicit.
- Monthly components accrue once per earning month; manual percentage components
  use separate named own/other bases and never default a missing base to zero.
- Tips are explanatory notes only.
- Existing reference amounts are test/entry-plan inputs, not production seeds.

## Progress log

- 2026-11-18: goal and current production identity verified; isolated feature
  worktree created; migration governance and Modern Web Guidance forms and
  validate-input-after-interaction guides read. Implementation starting.
- 2026-11-18: `services/payrollRules.js` implements explicit monthly/day policies,
  cumulative calendar rounding, recurring monthly and manual-percent components.
  Nullable version rules round trip through actual PostgreSQL profile create,
  clone, append, resolver and capture. Existing NULL semantics are unchanged.
- 2026-11-18: canonical snapshots and simulator use the shared rule calculator.
  Fixed no-attendance entitlements and configured advance calculations have unit
  coverage. Frozen legacy overlaps produce a review blocker, not a rewrite.
- 2026-11-18: scoped defaults, qualification transitions, vacancy snapshot apply
  and append-only manual commission input services and routes implemented.
  HTTP journeys and membership integration remain outstanding.
- 2026-11-18: employee profile change/conversion forms load the new shared
  `js/hr-pay-rules.js` field model and scoped accessibility/mobile CSS. Level,
  vacancy, default settings and input-management UI are still outstanding.

## Current verification

- Node 22.23.4 / npm 10.9.9 runtime guard passed.
- Latest focused unit/form/regression selection: 74 passed, zero failed/skipped.
- Nine configurable-rule isolated PostgreSQL scenarios passed through the
  canonical runner after a fresh full application schema startup. These include
  actual authenticated HTTP hiring, optimistic-lock rollback, no-attendance
  fixed salary/advance/final parity, planned segment aggregation, manual bases,
  simulation and profile-impact parity.
- Migration governance and changed-JavaScript syntax checks passed.
- Partial actual-app membership browser journey passed with the exact access
  barrier asserted as 403: employee navigation, fixed monthly dated save, mobile
  overflow and keyboard focus. Desktop 1440x1000 and mobile 390x844 screenshots
  were visually reviewed. Evidence: output/playwright/payroll-configurable-rules.
- Owner approved PAY-RULES-ACCESS; its ten exact mappings and existing denial
  behavior have 31 passing access/contract tests. The complete membership browser
  journey passed, including company defaults and reviewed vacancy hiring. All
  seven final desktop/mobile screenshots were visually reviewed.
- Full `npm test` passed (explicit unit stage: 4021 passed). Existing isolated
  payroll suites passed 121 assertions; the final broader costing test passed
  separately after local fixture/cleanup diagnosis. No assertion was weakened.
- Final evidence, environment reproduction notes, changed-file inventory and
  remaining release/data-entry boundaries: CONFIGURABLE_PAY_RULES_VERIFICATION.md.
- No commits/push/deploy/production data writes performed.

## Continuation state and next work

Worktree: `D:/Codex/EventGenix/configurable-pay-rules-20261118`, branch
`codex/configurable-pay-rules-20261118`. The original dirty checkout is untouched.
Dependencies are reused by an ignored junction to the original checkout's
node_modules; no dependency or lockfile installation/change was performed.

Owned disposable PostgreSQL: binaries under
`D:/Codex/EventGenix/local-postgres17/runtime/pgsql/bin`, data under this worktree's
`output/pay-rules-postgres/data`, loopback port 59643, database
`eventgenix_pay_rules_disposable_test`. The server is local and task-created.
Inspect pg_ctl status before reusing/restarting; do not touch other local clusters.
The canonical integration runner resets only this disposable schema.

Reproduce the new integration gate using Node 22, NODE_ENV=test, the above exact
loopback TEST_DATABASE_URL and TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE:
`node scripts/run-isolated-postgres-tests.js payroll-configurable-rules`.

Implemented UI: company defaults, vacancy templates and reviewed hiring snapshot,
employee qualification selection/history, manual own/other bases, profile rules
and recurring components. New result notes flag incomplete forecasts/simulations.
The forecast hydrates existing canonical shift segments rather than counting
only a parent shift's envelope; fixed contracts include staff without shifts.
Simulations load the selected employee's confirmed monthly commission inputs.

Temporal tests now cover fixed-rate changes, retained components across personal
profile transitions, component removal and identical-version boundaries. Actual
canonical installments prove 20000 fixed month = 10000 advance + 10000 final.
The owner-facing entry guide and all 28 source-row mappings are stored privately
beside the goal under outputs/eventgenix-pay-rules-entry-guide-2026-11-18.md.
It omits personal names and preserves unresolved source ambiguities.

Local goal work is complete. Next: review the local diff and private source-row
entry plan, then prepare a separately authorized release and real-data envelope.

The separately approved PAY-RULES-ACCESS mapping is documented in
CONFIGURABLE_PAY_RULES_ACCESS_PROPOSAL.md and implemented only in the existing
Park membership operation map. No new capabilities or grants were introduced.
Other companies can store scoped default templates; applying legacy Park staff
or profile IDs to a foreign company is rejected. Do not infer foreign ownership.
