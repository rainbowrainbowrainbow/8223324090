# Rollback v0.81.18 — Hermes Transactional Idempotency

Production impact: yes for release/rollback workflow.

## Scope

This release changes the shared Hermes idempotency response timing only.
It does not add migrations, secrets, Railway settings, or public response
fields.

## Rollback trigger

Rollback only if v0.81.18 causes Hermes mutation regressions such as:

- successful mutations no longer returning the stored response;
- idempotency replay or request hash mismatch contract breaks;
- Hermes audit receipt timing regresses after successful commits;
- broad Hermes mutation 5xx errors appear after deploy.

## Rollback action

Re-deploy the previous green production release, v0.81.17
`Checkbox Test Receipt Contract`, from the confirmed
`codex/eventgenix-production` rollback SHA.

No database rollback is required for this release.

## Post-rollback verification

Run read-only live checks:

- `/api/version` reports v0.81.17 and the rollback SHA;
- `/api/health/deep` remains `status=ok`;
- `/api/hermes/capabilities` is readable with Hermes auth.

Do not run production Hermes mutation smoke unless a separate exact test packet
approval exists.
