# Approved local Red extension: shared-session task context

Status: owner approved MYDAY-SHARED-SESSION-LOCAL on 2026-11-18. Implementation is included in js/api.js; no js/auth.js or backend policy change was needed. Final check outcomes are recorded in the external combined-candidate evidence report.

## Reproduction

The original failing diagnostic kept a Park task page active while opening/reloading a Dar task in another tab. Shared state could converge back to Park. This is now the default regression, using `TASK_ENTRY_ONLY=1 TASK_ENTRY_CONTEXT_ONLY=1 TASK_ENTRY_BROWSER_ENGINES=chromium,webkit`; both runtimes remain active. It also asserts stable generation across reload and denial for a foreign-business actor.

Evidence: `my-day-followup-context-diagnostic.log` and `my-day-followup-browser-diagnostic.log` in the external goal-briefs directory. Logs are isolated-fixture evidence, not production credentials. This issue was reproduced before the added profile invalidation/dirty guards; its release of introduction is not yet bisected.

## Trace findings and implemented correction

Request traces confirmed that checking access/refresh token strings alone admitted a response from an obsolete generation. They also showed a fresh verify response returning the account's default Park context despite a Dar header, followed by authoritative Dar business-profile hydration. Publishing that temporary default rotated the shared generation and caused cross-tab context churn. The canonical verify query resolves the requested business on the server.

The client now binds every verify attempt to its request-start session generation and business header, rechecking before terminal handling, after JSON decoding and before merge. Its own accepted token refresh advances that snapshot. Stale attempts use the existing one-retry/transient recovery path. The merge receives the captured snapshot too. Verify sends the explicit canonical business query; if the response still describes a different default business, the existing server business-profile endpoint resolves it before publication. No cached role or permissions substitute for that response. The existing single shared active-business model is retained.

The only additional implementation file was js/api.js. Tests are in tests/auth-frontend-session.test.js, tests/task-links.test.js and tests/browser/task-entry-checks.js. Optional test traces omit token values, session generation values and PII. WebKit sometimes reports an access-control page error during navigation without emitting requestfailed. The harness permits only the exact timer/Telegram background messages within 100ms of same-page navigation, followed by successful native browser readback of the same endpoint in the same page. An independently recorded non-cancellation failure, missing/failed/wrong-page readback, ordinary active-document error or unrelated JavaScript error remains fatal. The expanded exception is documented and unit-tested; it is not proof that the browser emitted a request cancellation. tests/ui-check.js was updated for the snapshot-bound verify merge signature.

## Explicit exclusions

- No membership, role, permission, action-mask, organization or business eligibility changes.
- No token format, cookie, token TTL, session revocation, login bypass or server authentication policy changes.
- No migration, backfill, real-user/session data fix, secret/environment/settings mutation, production push or deployment.
- No disabling cross-tab synchronization, snapshot guards, authorization checks or regression gates to make the scenario pass.

## Acceptance

The actual-app concurrent Park/Dar diagnostic must pass with the latest explicit authorized task entry retained and the existing shared-context model respected. Initial entry and reload must settle without repeated reload loops, duplicate task mutations or stale context publication. An actor without Dar membership must remain denied. Existing cross-tab login/logout, refresh ownership, transient recovery, account-switch and revocation tests must still pass. Re-run affected Chromium/WebKit scenarios, repository checks, and current-base evidence as one combined candidate.

## Authorization record

Repository AGENTS.md classifies authentication/authorization/sessions as Red. The owner explicitly approved the named local extension after the reviewable proposal and warning. Its record is `D:/Codex/EventGenix/goal-briefs/MYDAY_SHARED_SESSION_LOCAL_AUTHORIZATION.json`. This does not authorize production release.
