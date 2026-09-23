# SYS-MB organization creation — local implementation

Status: `RELEASE_CANDIDATE / NOT_RELEASED`. The local protected scope `SYS-MB-ORG-CREATION-LOCAL-20260923` authorized implementation, not production auth release or production fixtures.

## Implementation

The existing schema supports multiple organizations, while the one-time bootstrap endpoint cannot create another. An active organization owner can now call `POST /api/organizations` with `sourceOrganizationId`, `name`, and a stable slug. The service checks current owner membership and account activity inside a locked transaction, creates the organization and the actor's owner membership, and writes a strict security audit before commit. A creator identity without the source owner membership is denied. No business, operational role, default context, historical owner, or data is assigned automatically.

The existing business-cabinet screen exposes this action only when the server reports `canCreateOrganization`, then refreshes the profile and selects the new organization. Existing explicit business and membership lifecycle remains responsible for its first business and worker access.

## Candidate and verification

- Isolated worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-org-release-20260923`, branch `codex/sys-mb-org-release-20260923`.
- Production branch and live baseline at final read-only inspection: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`, `codex/eventgenix-production`, `v0.82.11 — Tasker + My Day UX`.
- Brought forward the already reviewed SYS-MB evidence checkpoint as `51fc69ac34467a50e90655bef2aaf383cc6d2ea2`; functional commit `466a7219fee6cdcd9263aad629a1a38565511785`; separate version/cache/changelog commit `eecfd316cef8e7ec1d979e445372c53610ab4321` for `v0.82.12 — Організації: створення власником`.
- Node 22.23.1 / npm 10.9.8. `npm run test:unit:business-cabinets` passed 90/90; the full candidate `npm test` passed with exit 0, including runtime, version, migration, syntax, auth/static surface, unit and UI checks. `git diff --check` passed.
- The new Express→PostgreSQL lifecycle test is checked in, but its PostgreSQL case was **SKIPPED** locally: no owned disposable PostgreSQL URL is configured and the local Docker daemon is unavailable. This is not an integration PASS. CI's unrelated disposable PostgreSQL jobs do not replace this exact case.
- No production push, deploy, data mutation, or live fixture was performed under the local block.

The verified runtime scope is nine code/test files; no SQL migration, dependency, pricing, formula, shared menu/router/theme, or production setting change. The separate canonical version commit changes generated asset cache markers and release notes only. [RELEASE_CANDIDATE_MANIFEST.md](RELEASE_CANDIDATE_MANIFEST.md) records the exact release and QA gates.
