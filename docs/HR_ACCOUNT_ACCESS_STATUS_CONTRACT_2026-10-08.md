# Account onboarding business access status

## Contract

`POST /api/users/onboarding` keeps `loginReady` as the existing password and active-account check. A separate read after COMMIT reports `businessAccessReady` and `accessState` at the response root and in `receipt.access` for the explicitly selected default business.

- `active`: current authoritative registry and business/organization memberships permit access under the existing membership policy, including its business-role validity checks.
- `pending_membership`: the active membership-mode target exists but a required business or organization membership is missing or inactive.
- `unknown`: the user, registry, organization relationship or membership policy cannot establish access, the target is inactive/compatibility-mode, or the lookup fails.

Legacy profile business contexts and the operator's currently selected business are not membership evidence. A Dar result is never labelled as Park access. This is a point-in-time status, not a promise that later requests will retain access; all existing request guards remain authoritative.

The lookup performs no membership writes. It runs after the account transaction commits. A failed lookup adds a safe warning and keeps the successful result and one-time credential available. It never logs credentials or appends them to audit events. Existing post-commit chat handling remains unchanged.

## UI

The receipt separates profile role, password readiness, selected business, and business access. Missing or inconsistent access fields display an unknown state. The one-time credential and existing warnings remain accessible. The wizard preserves keyboard navigation, focus return, ARIA and the current visual design.

## Scope and provenance

The implementation adapts the unpublished local candidate `307b274263ce137cda35faf37d67aec23989175b` onto production base `c74832b847c2cb6a8fdf680e62cc63c3b3dababb` (v0.82.71). Later HR reporting, payroll, credential-management and offboarding changes are preserved.

No login/session guard, permission, membership-management endpoint, schema, registry data, payroll logic or existing account is changed. No new dependency is required.

## Verification boundary

Focused service tests cover registry/membership failures, canonical role-policy parity, post-COMMIT failure and rollback. Disposable PostgreSQL tests verify the actual SQL and unchanged membership inventory. The HR Team browser job covers the three receipt states using synthetic fixtures, selected-business labels, preserved credential, keyboard/focus and desktop/mobile rendering.

Production verification is read only after authentication. It checks exact live version/commit, deployed assets, existing allowed HR reads and receipt rendering with synthetic browser-only data. It does not create a production account or claim a live onboarding POST. No temporary access is required. Exact release SHA, CI results and sanitized QA artifacts are recorded in the release handoff.
