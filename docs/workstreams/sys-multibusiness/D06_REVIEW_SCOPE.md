# D06 — Patch ownership and remaining boundaries

Base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`, branch `codex/sys-mb-auth-p0-20260912`.
This is local Task 6 acceptance, not a release authorization. The final checkpoint is `D06_VERIFICATION.json`.

## D06 changes

| Area | Files | Reason and boundary |
| --- | --- | --- |
| Product page | `js/programs-page.js` | A real browser selected Dar while the product helper sent `event_genix`. Preserve the selected normalized context for the existing API helper and render the selected registry label. Keep MD-specific copy/CTA only for MD. Existing renderers, prices, API contracts and shared navigation remain unchanged. |
| Regression gate | `tests/d06-products-context.test.js`, `package.json` | Six focused executable regressions; add the new file to the existing unit command. No dependency, lockfile, version or release-marker change. |
| Actual-app acceptance | Six `tests/acceptance/*.cjs` modules | Full `server.js` startup, all SQL migrations, explicit synthetic organization/bootstrap/memberships, real HTTP, real browser login and existing UI. Dedicated PostgreSQL database; only the owning harness drops it after verification. |
| Evidence | D06 reports/matrices, `.codex-temp/sys-mb-d06/`, `output/playwright/sys-mb-d06/` | Keep prior failed attempts and exact source freezes. Credentials remain in process memory/anonymous pipes; reports contain only synthetic aliases, safe IDs, counts and redacted diagnostics. |
| Checkpoint indexes | `CONTINUATION_TASKS.md`, `DOMAIN_ISOLATION_INVENTORY.md` | Point the next task to actual D06 findings. Exact D05 index bytes are preserved in `prior-artifacts/`; exact prior page/package bytes are in `prior-sources/`. |

No D06 runtime edit to auth, memberships, HR, payroll, certificates, Art, booking identity/linkedTo, schemas/migrations, providers, shared menu/router/theme or hosting settings is included. Earlier cumulative modifications to some of these files belong to D01–D05 and are preserved by hash.

## Remaining release blockers

| Scope | Evidence | Next bounded work |
| --- | --- | --- |
| Staff, certificates, Art | Actual local Dar and other-organization reads return HTTP200 plus a deliberately unowned synthetic sentinel. See `D06_READINESS_REPORT.md`. | Review the existing `D05_PROTECTED_PEOPLE_FINANCE_CONTRACT.md` and `D05_PROVIDER_PAYMENT_ART_CONTRACT.md`; authorize the exact protected containment/ownership scope. A disabled module descriptor is not an API guard. Do not infer ownership from user role or membership. |
| Payroll settlement | Actual local Dar and other-organization reads return HTTP200. No payroll amount disclosure is inferred from this empty/synthetic read. | Contain unsupported membership entry before global payroll reads under an exact protected scope. Preserve formulas, salary rules and existing supported legacy behavior. |
| Contractors/procurement | Fourteen actual read probes fail. The routers are unchanged from HEAD; direct and procurement-mediated `order-context` return a stock row whose stored owner is another business. | Use the precise future patch in `D06_API_REPORT.md`: separate legacy descriptors and entry guards, explicit unavailable warehouse UI, no inferred backfill. Router-wide guards also cover external handlers, so the protected boundary must be explicitly authorized. |
| Historical owners/public/assets/jobs | OWN-01–08 remain PENDING and real mapping is UNPOPULATED. | Obtain a designated read-only source, approved mapping and public/private policy before Task 4. Local detector counts never authorize ownership assignment. |
| Generic booking linkedTo | Prior exact D04 reproducer remains blocked; it is not reclassified as a D06 end-to-end PASS. | Follow `LINKEDTO_PROTECTED_SCOPE.md`; authorize only the stated protected hunks, then run the actual full-app reproducer. |
| Compatibility and later businesses | Synthetic compatibility traffic is observed, but complete runtime ingress/job/provider telemetry and a real observation window are absent. | Implement/collect complete telemetry and separately migrate MD/CRM. No event in an unobserved path is not proof of zero usage. |

## Additional bounded debt and evidence limits

- **D06-NET-01, P2, OPEN:** final actual browser sees four `POST /api/wallet/daily-login` HTTP400 responses after normal login (owner/admin/worker/worker-cross-tab). Bodies were not collected, so the exact400 cause is not certified. Inspect `routes/wallet.js` daily-login and `js/auth.js` checkDailyLogin with a bounded response-code reproducer; do not change reward formulas by inference.
- **D06-NET-02, P3, OPEN:** multiOrg `GET /api/chat/unread` without context returned403 with the observed `business_context_required` code. This proves a defensive denial, not a data leak. Trace the shared-shell unread caller/context-ready boundary before deciding a minimal authorized change. It is not silently classified as `chat_not_migrated`. These five responses leave the final B09 diagnostic FAIL; all14 functional browser cases passed.

Post-run read-only source review narrows those candidates: `routes/wallet.js:87` returns400 when the wallet is missing; duplicate reward returns200. `js/auth.js` checkDailyLogin silently ignores a non-ok POST, while wallet GET has its own initialization. This supports an unconfirmed first-login initialization/order hypothesis, not a proven response body. `js/ws.js:807` sends unread fetch without context, while the membership resolver intentionally requires explicit context for multiple organizations. Do not weaken that guard. `routes/wallet.js` and `js/ws.js` match HEAD; their hashes are recorded as post-run audit sources, not retroactively inserted into the original test freeze.

- **D06-UI-01, P2, OPEN_UNCONFIRMED_ROOT_CAUSE:** run `d06_1789240691369_eeb5a9` failed B02 before any access-profile HTTP request, leaving B10 NOT_TESTABLE. Owner on `/profile?tab=settings&businessContext=event_genix` entered synthetic account10 and clicked the existing add-access button; the dialog did not appear within15s. Candidate boundaries are the membership manager mount/open handler, profile readiness/remount, and the test's pointer interaction. The final diagnostic runner records trusted pointer/click/readiness/request evidence without retry or replacing handlers. A later PASS is per-run evidence, not proof that this intermittent failure was fixed. Retain the failure screenshot and exact diagnostics; establish a stable cause before changing runtime.

- `tests/products-demo-flow.test.js` has a pre-existing cached-catalog fixture failure. The affected sweep is 32 PASS / 1 FAIL; the same cached case fails against preserved D05 page bytes (10 PASS / 1 FAIL). Its manually primed cache omits the matching context key. A future test-only repair should provide that key while retaining the existing assertion. This file is outside the current `npm test` baseline; do not describe the broader sweep as all green.
- The local server logs a missing `title_definitions` relation from quest checks. Repository search found reads but no canonical schema initializer for that relation. D06 did not add ad-hoc schema or equate this log with an observed browser HTTP500. Track the existing fresh-database gamification path separately.
- Dashboard PASS covers the scoped task/lead widgets; global HR/Art/procurement widgets are not certified. Settings PASS covers cabinet and timeline display; global key/provider configuration is not certified. Omni PASS covers CRM conversations/context/messages; send, attachments, webhooks and AI/provider behavior are not certified.
- Outbound providers, background schedulers, service-worker/offline behavior and external font delivery were held or blocked. Responsive evidence proves the tested local rendering and controls, not live-site font/cache/provider behavior. The existing horizontally scrollable membership tabs and dark editor component are retained.

Task 7's proposed fixture count, 24-hour operator TTL and exact-ID cleanup boundary are in `D06_READINESS_REPORT.md`. That proposal is not an active permission and excludes real financial, booking, HR, Art and provider mutations.

Recommended next action: review and authorize the smallest protected containment package for the proven global reads before preparing any Park/Dar release candidate. Keep both readiness decisions on HOLD until the stated blockers and required live evidence are resolved.
