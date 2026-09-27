# LEAD-UI-3 handoff — 2026-09-27

Status: local implementation and verification completed (final baseline finished
2026-09-28 Europe/Kyiv). Production delivery remains in LEAD-UI-4.
Continue the same `codex/lead-unified-card`
worktree at `C:\Users\Plotva\.codex\worktrees\omni-close-1\EventGenix`.
The base is `6f17cd90f3157cba57806d710a9bed607b40ccde`; the dirty worktree
already contains the completed local LEAD-UI-1 and LEAD-UI-2 changes.
Do not restore older files over that work. No commit, push, deploy, production
backfill, provider call, or production business mutation is part of this task.

Read-only checks in this task found the same remote production SHA and live
`/api/version` SHA, version `0.82.30`, branch `codex/eventgenix-production`, with
complete deployment metadata. Recheck before the later release; this is evidence
at inspection time, not authorization to deploy.

## Findings and scope

The unified card retains the existing conversation-context API and resolver:
confirmed links and suggestions are separate; origin and primary are separate;
explicit navigation carries conversation ID and business context. Manual linking
and primary selection keep their existing endpoints. No replacement selection
policy is introduced.

The existing Meta message UI distinguishes saved/pending, provider acceptance,
delivery, read, failure, and unknown outcomes. Provider acceptance is not delivery.
Persisted error details are rendered beside failed messages and escaped as text.
No universal reply-window duration or automatic retry is added.

### Read-only failed-send evidence

Production was inspected through the existing dedicated read-only connection,
with `default_transaction_read_only=on`, `BEGIN READ ONLY`, confirmed
`transaction_read_only=on`, bounded projections, and final `ROLLBACK`. No message
content, contact values, credentials, or raw provider-error text was printed or
saved. No browser read receipts, sends, retries, provider calls, or writes ran.

The live `/api/version` returned HTTP 200, version `0.82.30`, branch
`codex/eventgenix-production`, SHA
`6f17cd90f3157cba57806d710a9bed607b40ccde`, and complete deployment metadata;
the remote production branch matched. Lead `137` and conversation `10` both
belong to `event_genix`; the channel is Instagram and the CRM conversation status
is `open`. Both stored legacy conversation IDs match `10`. Canonical-link SELECT
is unavailable to this read-only role (`42501`); this audit does not claim a fresh
canonical-table verification or change that permission.

The latest outbound row inspected is message `109`, created at
`2026-09-27T16:00:22.199Z`. Its durable status is `failed`, send-truth status is
`provider_failed_immediate`, provider attempted is true, provider accepted is
false, and there is no provider reference. The failed timestamp is
`2026-09-27T16:00:23.394Z`. The persisted error and send-truth error agree. A
bounded in-memory exact phrase check confirms category
`outside_allowed_messaging_window`; the error includes numeric code `10`.
The category comes from the explicit localized phrase, not inference from the
code. The persisted error does not specify a 24-hour duration, so this evidence
does not establish a universal 24-hour rule. CRM status `open` is separate from
the provider's permitted messaging window.

Existing `omni.html` reads the persisted `sendTruth.error` / `deliveryError`,
escapes it, and displays the reason with the failed-message state. The existing
Meta fixture checks show that explanation. No hidden-reason defect was reproduced;
this inspection does not claim a new live send or a screenshot of the real
customer's conversation.

### Short-mobile observation

The unmodified responsive fixture passed, including 390x420. A controlled 800 ms
message-response delay reproduced a failure in the old browser helper: after
returning to the list and reopening a conversation, the composer draft was ready
before the history request finished. The helper tried to set a reading position
in an empty message list and failed its scroll assertion.

The focused fix waits for the newly loaded visible message after reopening,
before measuring scroll. It does not sleep, weaken the layout criterion, or alter
product layout. The same delayed full responsive run passed after the fix,
without page errors, unexpected fixture requests, or real writes. The final
390x420 screenshot was reviewed by both the UI investigator and primary agent.
No mobile product defect has been established by these runs.

### Native browser zoom defect

At 1366x768 with native 125% tab zoom, the compact `More` trigger stayed at the
left of the chat header. Its right-aligned 190px dropdown extended left of the
chat panel and was clipped by that panel's overflow. Button bounds alone looked
valid, but pointer hit-tests reached the conversation list underneath. A settled
diagnostic capture after all finite animations reproduced the same clipping.

The product fix adds only `margin-left: auto` to `.omni-chat-more` within the
existing compact conversation container query. It keeps the panel's overflow and
the expanded action layout. At short zoomed heights the dropdown intentionally
scrolls internally; checks must verify the menu bounds and each action's pointer
reachability after scrolling, rather than require every action to fit at once.
Final zoom verification is recorded in the table below.

### Save availability race found by the full browser run

The expanded run also reproduced a race in the task-2 shared editor. After an
edit was persisted and its form closed, a new create draft could open before the
old list refresh finished. Rendering that list disabled Save while the global
save lock was still held. The old operation then released its lock but skipped
UI restoration because the current editor belonged to a newer session.

A deterministic test holds that list response, opens and fills the new form,
then releases the response. Before the fix it failed with Save still disabled.
The fix synchronizes action availability when opening creation and after an old
save finishes with a newer editor present. It reuses the existing read-only
policy and never resets the newer form's fields. The regression also checks
that the preserved draft can actually create one lead afterward.

## Files added or changed for this task

The aggregate worktree still contains tasks 1 and 2. Task 3 adds these focused
changes on top of them:

| File | Change |
| --- | --- |
| `css/omni-workspace.css` | One compact-menu alignment property |
| `js/leads-page.js` | Restore Save availability for a new draft after an earlier save's refresh |
| `tests/lead-workspace-navigation.test.js` | Deterministic regression for that Save race |
| `tests/browser/omni-layout.checks.cjs` | Wait for loaded history after reopening before scroll assertions |
| `tests/browser/omni-native-zoom.cjs` | Menu containment and per-action reachability with real menu scrolling |
| `tests/browser/omni-workspace-navigation-fixtures.js` | Isolated real-API communication/navigation matrix, with explicit synthetic boundaries |
| `tests/browser/omni-lead-links-actual-app-browser-smoke.js` | Run the new matrix, collect page errors, and diagnose create-submit failures |
| `docs/LEAD_WORKSPACE_UI_CONTRACT.md`, this handoff | Preservation rules, findings, evidence and remaining delivery scope |

## Verification evidence

| Check | Actual status |
| --- | --- |
| Node/npm | Node 22.23.1 / npm 10.9.8 runtime guard passed |
| Workspace/history/resolver tests | 76 passed; `%TEMP%/lead-ui3-baseline-targeted.log` |
| Final workspace/editor/history/resolver tests | 99 passed, no failures or skips; `%TEMP%/lead-ui3-final-behavior.log`. The Save race failed before the fix in `%TEMP%/lead-ui3-save-race-before.log` |
| Existing responsive browser baseline | Passed; `output/playwright/omni-ui3-baseline/omni-browser-report.json`, no page errors or real writes |
| Existing Meta status browser | Six cases passed: Facebook/Instagram at 1366x768, 390x844 and 320x640; `output/playwright/lead-ui3-meta/omni-browser-report.json`, no page errors or real writes |
| Meta screenshot review | Final `instagram-320-errors.png` reviewed: error/unknown explanations visible and composer within viewport |
| Delayed responsive rerun | Passed after the two-line wait fix; `output/playwright/omni-ui3-latency-fixed/omni-browser-report.json`. Before-fix failure retained under `omni-ui3-latency-probe` |
| Expanded actual-API browser | Full runner passed without diagnostic skip hooks; `%TEMP%/lead-ui3-browser-final-verified.log`, `output/playwright/omni-lead-links/ui3-navigation-report.json`. Task-1/2 scenarios plus all four UI3 viewports, delayed response, history error/retry, delivery-state rendering, closed chat and unavailable-primary contract passed; no page errors or backend Omni writes |
| Final responsive browser | Passed after the compact-menu fix; `output/playwright/omni-ui3-responsive-fixed/omni-browser-report.json` |
| Final actual-API screenshot review | Primary agent reviewed `ui3-omni-1366x768.png`, `ui3-omni-320x640.png`, `ui3-omni-390x420.png`: input and last message are visible, keyboard focus is visible, no page-width overflow |
| Native browser zoom | Passed after the alignment fix: 1366x768 and 1024x600 at 100/125/150%, plus the existing telephony 200% case. `output/playwright/omni-ui3-native-zoom-final/` holds report, trace and screenshots; final 125% and short 150% menus visually reviewed |
| Full local baseline | `npm test` exited 0: `verify` and `test:sys-mb` passed, including 3132 main unit tests, 344 My Day checks, UI smoke and subsequent business/legacy/link suites. `%TEMP%/lead-ui3-npm-final.log` |
| Disposable database cleanup | Completed after the full browser pass: zero other clients, owned server stopped, registered cluster and temporary credentials removed, shared portable binaries preserved. `output/playwright/omni-lead-links/ui3-pg-cleanup.json` |
| Production failed-send evidence | Read-only confirmed: latest outbound `109` in Instagram conversation `10` failed with explicit `outside_allowed_messaging_window` reason and embedded code `10`; no universal 24-hour duration inferred. See the sanitized evidence above |

Canonical local checks use the existing commands:

```text
node --test tests/lead-workspace-navigation.test.js tests/omni-workspace-behavior.test.js tests/omni-history-pagination.test.js tests/lead-conversation-resolver.test.js
npm run test:browser:omni
npm run test:browser:omni:zoom
npm run test:browser:omni-links:isolated
npm test
```

For the existing Meta-only fixture, set `OMNI_META_STATUS_ONLY=1` process-locally
before the responsive browser command. The fixture intercepts business requests;
it is not evidence of a working live provider connection. Live reading must not
send messages, reconcile delivery, mark read, or change conversation status.

### Actual-API test boundaries

The complete isolated runner used a disposable PostgreSQL 18.6 cluster on
loopback and the real Express app. Its runtime guard reported Node 22.23.2 /
npm 10.9.8; the primary agent's baseline and focused checks used Node 22.23.1 /
npm 10.9.8. CI was not run in this local-only task; its PostgreSQL version remains
a separate delivery gate.

Conversations, history, lead links, editor saves and retries use real API/DB
fixtures. Only Telegram account capability flags are overridden to exercise an
enabled composer without configuring or contacting a provider. The unavailable
primary scenario redacts an actual workspace response into the resolver's UI
contract; resolver unit tests cover the selection policy. One HTTP 503 is
injected; the recovery fetch uses the real history API. No production credentials
are passed into the isolated app.

The UI3 guard intercepts every browser-originated Omni mutation, including read
receipts, before Express. The final report records zero attempted non-read
mutations and zero backend Omni writes; the closed row's status and update
timestamp are independently unchanged in PostgreSQL. Direct fixture inserts are
confined to the disposable database.

Draft retention is established across modes and reopening within the page;
reload checks the exact conversation, not persistence of an unsent draft across
reload. Independent list/history scrolling is covered, but restoration of a
nonzero conversation-list scroll position is not claimed. On the 390x420 delivery
fixture, the disconnected Instagram account warning consumes history space;
the durable message states are asserted in the DOM, not claimed to be all visible
at once. Provider connectivity and actual message delivery are outside this test.

An initial expanded run exposed another test synchronization race: filling a
multiline composer resized history after the test set its reading position. The
helper now waits for layout before setting and rechecking that position; the
original two-pixel mode-preservation assertion remains intact. Diagnostic runs
are retained as investigation evidence, but the final pass above is the complete
runner with no skipped task-1/2 scenarios.

## Delivery handoff

LEAD-UI-4 owns integration against the freshly checked production SHA, release,
CI, deployment, and post-release QA. Preserve the earlier task handoffs and the
[shared card contract](LEAD_WORKSPACE_UI_CONTRACT.md). The owner's manual tests
**3–8 remain pending** and must be explicitly revisited in task 4; automated
fixtures do not mark them complete. NV lead 137 must not be edited or messaged.

The existing CI workflow runs `npm test` and the synthetic Omni browser job.
It does not currently invoke `test:browser:omni-links:isolated`; this task extended
that existing local runner without changing workflow settings. Task 4 must retain
the real-API verification as a release gate and resolve its CI coverage under the
current repository authorization policy, not assume a green default CI reruns it.
