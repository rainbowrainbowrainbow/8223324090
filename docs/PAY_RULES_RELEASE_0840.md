# Configurable compensation release 0.84.0

Status: reviewed local integration; no production push, deploy or migration yet.
The owner explicitly requested deployment after clearing the queue and pinned
the next minor version to **0.84.0**. Exact authorization is still required for
the schema migration, production payroll/access rollout and controller change.

## Fixed destination and source

- Production branch: `codex/eventgenix-production`.
- Verified live and remote base: `571a57acb80118cc6cc0e5a923c5a5bba9c09d86`,
  version `0.83.120`, label `Задачі у «Моєму дні»`.
- Railway project `fortunate-appreciation` /
  `bc28b46c-d4bc-491c-893a-d8401c633668`, environment `production` /
  `d9f9b984-d54d-4620-a8bf-c48882ad5158`, service `8223324090` /
  `3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`.
- Verified deployment `9e45d6c2-f877-4962-a6b0-3ac8a116bf13`: SUCCESS;
  no staged service changes. Public version metadata is complete and verified.
- Integrated functional checkpoint: `dcd4a559e1c37702f7243fce5c817a84e15e69fd`,
  branch `codex/pay-rules-release-0840-20261118`.
- Only cherry-pick conflicts: HR asset blocks and the unit-test list. Preserve
  current shared staff-account assets, all 0.83.120 markers and the My Day
  task-link test; add the three compensation assets and three new unit files.
  Current shared-account, freelance and My Day changes remain in the base.

## Exact pending approval scope: PAY-RULES-0840

One bounded release of the existing configurable compensation implementation:
fixed/proportional monthly salaries, daily rules, recurring components, manual
commission bases, dated qualification levels and reviewed vacancy templates.
Publish the five Ukrainian notes in `release-notes-configurable-pay-rules.json`.

Apply only `db/migrations/423_configurable_pay_rules.sql` at startup. It is
additive/idempotent schema only, with nullable configuration columns and empty
scoped tables. No rates, assignments, staff data, payroll reports, company
defaults or history are seeded or rewritten. Canonical LF SHA-256:
`ab2f6d3035478a6499ae503a4337220fbc1500c2ec910ef9cca187353830cebd`.

Deploy exactly the ten already locally approved PAY-RULES-ACCESS operations in
`CONFIGURABLE_PAY_RULES_ACCESS_PROPOSAL.md`. Reuse existing VIEW/RULES capability
sets and every membership, ownership, business-scope and period-lock check.
No grants, roles, sessions, identity workflows or other-company ownership changes.

The current ordinary controller always bumps a patch. The review-only proposal
`output/minor-release-proposal.patch` changes only:

1. `scripts/production-block-policy.js`;
2. `scripts/production-block-controller.js`;
3. `tests/production-block-controller.test.js`.

Proposal canonical LF SHA-256:
`07a8289e9237b6a83042eb4095a1cd022978922b7ae77192b509bee4216f1b68`.
It adds `prepare --release-bump minor`, signs the exact
`{type: minor, from: 0.83.120, to: 0.84.0}` transition, checks the package before
and after canonical version synchronization, and rejects override of prepared
protected workflows. Default patch behavior is unchanged. No CI, expiry,
attempt, identity, migration, protected-path, QA, settings or secret guard is
removed. Operational controller files remain unchanged until exact approval.
The proposal was compiled and tested from ignored review copies in memory.

Allowed descendants of the integrated candidate contain only that reviewed
three-file controller patch, this release's evidence/notes, generated 0.84.0
version/cache artifacts and scoped fixes needed for this same approved release.
Keep the SQL hash, target service, access mapping and exact 0.84.0 version fixed.
Any production/live drift or additional Red scope stops execution.

## Validation and release execution

- Focused integration regression: 175 tests pass, no failures/skips; includes
  payroll math, operation allow/deny cases, isolated-suite contracts and current
  shared staff-account behavior (`output/pay084-focused.log`).
- Review-only controller proposal: all 104 controller tests pass, including five
  new minor-version/hash/override regressions (`output/pay084-minor-proposal-tests.log`).
- The first cold local PostgreSQL app startup exceeded the unchanged 180-second
  readiness limit before any test ran. The repeat with the same default timeout
  passes all 10 SQL/API cases (`output/pay084-configurable-sql-retry.log`). No
  startup timeout, application dependency or production setting was changed.
- Fresh actual-app browser journey passes in membership mode (exit 0), including
  reviewed hire, vacancy/company templates, promotion, manual bases and monthly
  profile editing. All seven desktop/390px mobile screenshots were reviewed;
  no horizontal overflow or obscured primary action, no page JavaScript errors.
  Evidence: `output/pay084-browser.log` and
  `output/playwright/payroll-configurable-rules/`. Native select values truncate
  normally on mobile; explanatory text remains readable.
- Modern Web Guidance `forms` and `validate-input-after-interaction` were
  retrieved in full before integration. Checked native browser compatibility,
  keyboard focus ("Never disable focus outlines"), text errors ("show visible
  error text") and mobile behavior. No new platform API or application fallback.
- Earlier complete baseline evidence belongs to the earlier base;
  see `PAY_RULES_RELEASE_READINESS_2026-11-18.md` for that distinction.

Prepared signed review block: `EG-20261118T031843Z-045a4225`, initial SHA
`045a4225a6fe2486d5d6ddc7643cc43161a7d1d1`; expires
`2026-11-18T08:49:43.307Z` (10:49 Europe/Kyiv), attempts used 0 of 3. Its signed
minor transition targets exactly 0.84.0. Review-copy dry-run passes; the review
driver only supports prepare/status/dry-run and cannot execute a deployment.
After approval, the operational controller receives exactly the reviewed patch
and runs the existing canonical production sequence with that signed block.

After exact approval, apply only the reviewed controller proposal, commit it,
verify the final delta, and execute the canonical signed block. The controller
runs one full local `npm test` per attempt, generates the separate 0.84.0 release
commit, pushes the exact production SHA, requires successful main CI and Runtime
artifact smoke for that SHA, then invokes `release:railway-up`. Verify exact
live version/label/SHA/branch and public asset proof before publishing notes.

Use at most three attempts under one six-hour envelope. Account the ordinary
release window conservatively from 2026-11-18 02:50 UTC; never execute after
08:50 UTC (10:50 Europe/Kyiv) without a new authorization. Bind manifest validity
to the earlier of that deadline and six hours after exact scope approval.
Preparation and dry-run cannot spend an upload attempt or authorize execution.

Production QA scope: read only; no disposable or real business record writes.
The canonical local credential file is absent, so authenticated live QA remains
blocked. Public version/asset proof and sanitized deployment logs are available.
Never obtain credentials from another path or print secret values.

## Rollback and data boundary

No spreadsheet import, real employee pay entry, commission input, promotion,
payroll approval/payment, report rewrite, production fixture or cleanup is in
scope. No production variables, hosting settings or GitHub workflow changes.

Retain the additive schema and every stored rule/history record. The previous
production SHA above is a binary rollback candidate only before configured
terms are used and under a separately valid release decision. Once data uses
the new rules, require a compatible forward fix or separately reviewed compatible
binary; never silently deploy a calculator that ignores the new terms. Do not
drop schema or repair real data under this block. The read-only postcheck SQL
is `PAY_RULES_RELEASE_POSTCHECKS.sql`, already rehearsed in disposable PostgreSQL.
