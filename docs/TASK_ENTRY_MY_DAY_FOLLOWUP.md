# My Day task-entry follow-up candidate

## Scope and base

This is one preproduction follow-up candidate for the post-release review of v0.83.120. Its final base is production SHA `7b7a77bf18ae046facf1f88d166332de043482a2` (v0.84.1). The candidate was refreshed from v0.83.120 through v0.84.0 to v0.84.1 as parallel releases advanced. Only Center HTML script/cache blocks conflicted: the current version was retained and task-links added before center-page. Compensation code, migration 423, and the newer Telegram task-view/delivery changes are inherited unchanged.

No version bump, production push/deploy, production record mutation, dependency change, new migration or membership/access-rule change is part of this candidate. The owner separately authorized the local shared-session correction as MYDAY-SHARED-SESSION-LOCAL on 2026-11-18; the combined candidate includes that frontend correction in js/api.js.

## Functional changes

- Operations Center task and task-incident buttons use the shared CRM task URL helper. `task` joins legacy aliases `open`, `highlight`, `taskId` with existing precedence preserved. Redirects remain temporary/no-store, strictly validate positive safe IDs and retain only supported intent fields.
- Editor and reschedule forms keep independent drafts. Saving one preserves the other. Close, Escape, document navigation, history and profile tab changes honor either draft and pending writes. Returning fields to their original values clears dirty state.
- Accepted mutations followed by failed detail reload offer a reload-only recovery action; they cannot accidentally repeat the successful mutation.
- Permission/context display invalidation is distinguished from an explicit user close. A clean dialog reloads detail through the scoped API without consuming its task URL; a dirty or busy dialog protects its draft. Backend authorization and server action masks remain authoritative.
- Search, Operations Center metadata, dashboard alerts, linked-task fallback and Omni/work-queue task destinations preserve available task business context. SQL changes project existing context fields; they do not change visibility predicates or membership policy.
- The deferred Task Center renderer/history contract remains intact. Existing unrelated browser producers are not broadly rewritten.
- Verify responses are bound to their request's session generation and business context, including after JSON decoding and token refresh. The requested business is sent explicitly in the canonical verify query. A mismatching default-business identity is resolved through the existing authoritative server business-profile endpoint before publication; cached privileges never substitute for that response. Shared context synchronization itself is retained.

## Verification and evidence

The initial v0.83.120 and refreshed v0.84.0 candidates passed their recorded checks. Final combined-candidate checks on v0.84.1 are recorded in `D:/Codex/EventGenix/goal-briefs/my-day-shared-session-*.log`; the final evidence report is the authority for actual outcomes. The auth regression suite covers stale 200/401/403 responses, deferred JSON, scoped refresh, genuine revocation, server-profile denial and identity mismatch. Concurrent Park/Dar Chromium/WebKit context checks now keep both runtimes active and verify stable generation after reload plus foreign-business denial.

Tests cover real local login from legacy aliases; strict alias precedence/invalid IDs; actual Operations Center rendered destinations; independent editor/date drafts; save and reschedule failures; pending-write dismissal; accepted-save/reload recovery without duplicate writes; Escape, Close, Back and profile tab switching; permission invalidation; narrow/wide screenshots; Park/Dar source links; and denial for a mismatched task business context. Mutations run only against the isolated disposable database.

## Resolved shared-session conflict and authorization boundary

The original diagnostic found that active Park and Dar pages could rewrite an explicit Dar task URL to event_genix. Trace evidence showed two causes: verify did not reject same-token stale generations, and a default-context verify response was published before business-profile hydration published the requested context. The latter produced generation churn even on otherwise fresh reloads. The approved client fix addresses both without changing server eligibility or token/revocation policy.

The final ordinary browser regression keeps the Park runtime active while opening/reloading Dar. Both tabs converge to the existing single shared active business; this is not independent per-tab business sessions. Focused reproduction/regression uses `TASK_ENTRY_ONLY=1 TASK_ENTRY_CONTEXT_ONLY=1 TASK_ENTRY_BROWSER_ENGINES=chromium,webkit`. Optional `TASK_ENTRY_SESSION_TRACE=1` records only routes, business context and call sites, never token or generation values.

The exact local extension was approved and is documented in `TASK_ENTRY_SHARED_SESSION_PROPOSAL.md`. No js/auth.js, backend authentication or membership-policy edit was needed. Production release remains excluded. Physical iPhone + Telegram WebView testing remains separate. The browser harness explicitly classifies only exact WebKit timer/Telegram navigation-time access-control messages (same page, within 100ms of navigation, followed by successful native readback). This expands the prior unconditional timer exception to Telegram while requiring stronger evidence; it does not hide active-page CORS failures or unrelated JavaScript errors.

## Applied Modern Web Guidance

- [dialog](https://github.com/GoogleChrome/modern-web-guidance-src/blob/main/guides/ui-components/dialog/guide.md): the guide requires dirty-form confirmation and says to keep the guard in a `cancel` handler where `closedby` is missing. The candidate retains Safari's cancel fallback, uses `closedby="none"` only as enhancement, and reserves message/discard space through visibility so confirmation does not shift actions under a pointer.
- [accessibility](https://github.com/GoogleChrome/modern-web-guidance-src/blob/main/guides/accessibility/accessibility/guide.md): native modal semantics, named controls, existing visible labels, announcement/description wiring, and 44px actions remain intact. No manual focus trap or redundant dialog role is introduced.
- [validate-origins](https://github.com/GoogleChrome/modern-web-guidance-src/blob/main/guides/security/validate-origins/guide.md): compatibility parsing retains URL-based origin normalization and rejects opaque null origins; the additional alias does not broaden redirect destinations or supported intent fields.

## One-patch release plan

1. Review the combined task-entry and approved session fix, retaining the original failing diagnostic and passing regression evidence.
2. Recheck live and production-branch refs, parallel release state, and the exact candidate diff. Wait for the selected production base to converge if a parallel release is still in flight.
3. Prepare a functional commit and one separate generated patch-version/cache commit when commit/release stages are authorized. Select the next free patch; do not reserve a stale version here.
4. Use one bounded production controller manifest with Ukrainian notes from `release-notes-my-day-task-entry-followup.json`; require exact-SHA production CI and artifact smoke, then the documented Railway helper and exact live proof.
5. Perform scoped read-only live QA with the approved local test-account source. Production mutation fixtures require their own bounded authorization. Physical-device verification must be reported independently.
