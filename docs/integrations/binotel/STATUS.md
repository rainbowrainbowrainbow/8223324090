# Binotel integration status

## BNT-01

- `taskStatus`: `PARTIAL_CAPABILITY_GAP`
- `candidateReadiness`: `NOT_REVIEWED`
- Base SHA: `d328eebee940dd5985917fa79a172b6e9ab65738`
- Worktree: `C:\\Users\\Plotva\\.codex\\worktrees\\binotel-crm-integration\\EventGenix`
- Branch: `codex/binotel-crm-integration`
- Base source: fetched `origin/codex/eventgenix-production` on 2026-09-20; the dirty main checkout remained unchanged.
- File manifest: `docs/integrations/binotel/CONTRACT.md`, `docs/integrations/binotel/STATUS.md`.
- Diff fingerprint: refresh before every next card with `git diff -- docs/integrations/binotel`.

### Decision

Підтверджено лише можливість Binotel API працювати зі статистикою/історією на рівні продукту. Актуальний точний REST/Webhook/WebSocket контракт для цього акаунта публічно недоступний: сайт Binotel спрямовує за документацією до технічної підтримки. Тому зафіксований один fail-closed DTO і CRM API-контракт без вигаданих provider endpoint, enum, підпису чи queue API.

### Commands and results

| Command / source | Result |
| --- | --- |
| `git status --short --branch` in main checkout | Dirty, behind local remote history; no files changed. |
| `git fetch origin codex/eventgenix-production` | Success; selected SHA `d328eebee940dd5985917fa79a172b6e9ab65738`. |
| `npm run check:runtime` | Passed: Node `22.23.1`, npm `10.9.8`. |
| Read local Omni/account/business context, migrations and focused tests | Existing Binotel is inbound-only/history-only; business scope and webhook guard identified. |
| Public Binotel sources, retrieved 2026-09-20 | Product capabilities confirmed; exact account API contract unavailable. |

### Unresolved provider facts

- REST origin/path/auth/signature, request format, pagination, response envelope, rate limits and retry headers.
- Field/enums for call direction/status, timestamp timezone and duration units.
- Webhook verification method and payload lifecycle fields.
- Recording host/TTL/access permissions and queue/operator/live API availability.
- Exact account grants and whether staff-wide recordings are permitted.

### Required exact approvals

- No approval is needed for the currently documented local, fail-closed implementation scope.
- Separate approval is required to change schema/migrations, auth/roles/access, production secrets/settings/webhook configuration, activate Binotel, send a live request with credentials, or commit/push/PR/deploy.

### Next task

`BNT-02` is ready only for fixture-backed DTO mapping and typed `not_configured`/`unsupported_capability` behavior. It must not send a provider request until official account documentation is supplied.

## BNT-02

- `taskStatus`: `PARTIAL_CAPABILITY_GAP`
- `candidateReadiness`: `NOT_REVIEWED`
- Files: `services/binotel-client.js`, `services/binotel-call-mapper.js`, `tests/binotel-client.test.js`, this status file.
- Verification level: fixtures-only. No Binotel endpoint, account, credentials or live request was used.

### Decision

Реалізовано один server-only scoped клієнт без HTTP transport: він вимагає явний business context, використовує наявний `resolveOmniRuntimeConfig('binotel', { businessContext })`, не має fallback на default account і повертає типізовані `BINOTEL_NOT_CONFIGURED` або `BINOTEL_PROVIDER_CONTRACT_UNAVAILABLE`. Це навмисний fail-closed результат, доки Binotel не надасть account-specific контракт. Canonical mapper зберігає `0`, не приймає небезпечні numeric call ID і не додає raw payload/URL/secret до DTO.

### Commands and results

| Command | Result |
| --- | --- |
| `node --test tests/binotel-client.test.js` | Passed: 5 tests. |
| `node --check services/binotel-client.js` and `node --check services/binotel-call-mapper.js` | Passed. |
| `npm run check:syntax` | Completed successfully after execution outside sandbox; sandbox itself blocks child Node processes with `EPERM`. |
| `git diff --check` | Passed before the status update. |

### Capability gap and prerequisite

Provider request/response contracts, fixed origin and signing are still unknown, so no transport, cache, retry or live/recording request was implemented. The next tasks may consume only the typed unavailable state or canonical fixture DTO; real history/live/recording behavior requires official Binotel account documentation and a separate authorization for a read-only test account.

### Next task

Proceed with BNT-03 only for a fixture-backed canonical lifecycle projection. Do not alter the public webhook authentication guard or infer provider lifecycle fields.

## BNT-03

- `taskStatus`: `PARTIAL_CAPABILITY_GAP`
- `candidateReadiness`: `NOT_REVIEWED`
- Files: `services/binotel-call-lifecycle.js`, `tests/binotel-call-lifecycle.test.js`, `docs/integrations/binotel/BNT-03-BUG-REPORT.md`, this status file.
- Persistence strategy: pure canonical reducer only; no DB schema, migration, raw SQL, webhook route or generic Omni de-duplication was changed.

### Decision

Додано детермінований lifecycle reducer для однієї canonical identity `(provider, businessContext, accountId, callId)`. Він зберігає нулі, захищає від змішування business/account і не дозволяє запізнілій активній події відкотити завершений дзвінок. Точний bug report з reproduction і schema gate збережено поруч. Підключення до webhook/persistence заблоковане: наявні Binotel поля та lifecycle enum непідтверджені, а зміна public webhook guard не авторизована.

### Commands and results

| Command | Result |
| --- | --- |
| `node --test tests/binotel-client.test.js tests/binotel-call-lifecycle.test.js` | Passed: 9 tests. |
| `node --check services/binotel-call-lifecycle.js` | Passed. |
| `git diff --check` | Passed before this status update. |

### Capability gap and prerequisite

Atomic persistence/upsert still needs approved design against an existing durable row plus confirmed provider payload mapping. No schema change is proposed because no durable storage need is demonstrated. The webhook retains its existing secret verification and `503` failure behavior unchanged.

### Next task

Proceed with BNT-04 for authenticated CRM API routes that expose the typed unavailable capability state only. Do not portray provider history as an empty successful list.

## BNT-04

- `taskStatus`: `PARTIAL_CAPABILITY_GAP`
- `candidateReadiness`: `NOT_REVIEWED`
- Files: `services/binotel-journal.js`, `routes/omnichannel.js`, `tests/binotel-journal.test.js`, this status file.
- API ownership: authenticated child routes of the existing Omni router: `/telephony/calls`, `/telephony/summary`, `/telephony/live`, `/telephony/queues`. No public route or access policy changed.

### Decision

Додано bounded journal service з distinct company/customer number filters, UTC half-open date boundaries from `Europe/Kyiv`, DST coverage, strict filters/limit and complete-vs-partial summary semantics. Routes повторно використовують чинні `auth` і `requestBusinessContext`. За відсутності provider контракту вони повертають керований capability error (`503`), а не порожній `200`; черги так само явно unsupported. Customer linking і provider-backed paging лишаються заблокованими, бо зараз немає жодного підтвердженого provider result shape.

### Commands and results

| Command | Result |
| --- | --- |
| `node --test tests/binotel-client.test.js tests/binotel-call-lifecycle.test.js tests/binotel-journal.test.js` | Passed: 15 tests. |
| `node --check services/binotel-journal.js` and `node --check routes/omnichannel.js` | Passed. |
| `npm run check:api-surface` | Passed: 91 route files, 92 direct mounts, 1 nested mount, 2 server-level routes. |
| `npm run check:auth-boundary` | Passed: 43 public exceptions, 14 integration contracts, 2 query-token exceptions. |
| `git diff --check` | Passed before this status update. |

### Capability gap and prerequisite

Provider result parsing, stable provider paging/dedup, customer lookup and full journal aggregates cannot be activated until exact response/pagination fields are documented. The endpoint contract is intentionally ready for the UI's unavailable state but does not claim that history is available.

### Next task

Proceed with BNT-05 to add the Omni telephony UI and explicitly render loading, unconfigured, unsupported, error and empty states without changing global sidebar/access.

## BNT-05

- `taskStatus`: `PARTIAL_CAPABILITY_GAP`
- `candidateReadiness`: `NOT_REVIEWED`
- Files: `omni.html`, `js/omni-telephony-workspace.js`, `css/omni-workspace.css`, `tests/omni-telephony-ui.test.js`, browser fixture/checks, this status file.
- UI scope: one lazy internal Omni mode; no global sidebar item, PAGE_ACCESS, role, secret or provider configuration change.

### Decision

Додано «Телефонія» як окремий Omni mode з namespaced controller, cancellation of stale fetches, context reset, distinct filters для company/customer number, Kyiv date inputs, tabs, semantic table, cursor pagination і окремі loading/empty/error/unsupported states. Рядки створюються через DOM/textContent, не через HTML з provider/customer data. Стан URL ізольовано через `tel*`, тому він не стирає параметри Inbox; `popstate`, клавіатурна навігація вкладками та перехід між Inbox/Телефонією перевіряються браузером. UI використовує чинні `getAuthHeaders` та `apiFetchWithAuthRetry`; за відсутності provider contract бачить чесну 503-capability відповідь BNT-04.

### Commands and results

| Command | Result |
| --- | --- |
| `node --test tests/omni-telephony-ui.test.js tests/binotel-call-lifecycle.test.js` | Passed: 8 tests. |
| `node --check js/omni-telephony-workspace.js` | Passed as part of syntax check. |
| `npm run check:css-surface` | Passed: 94 CSS files and references. |
| `npm run check:static-surface` | Passed: 45 root HTML files, 3 landing files, 8 redirects. |
| `npm run check:theme-surface` | Blocked by pre-existing `omni.html` inline-style budget: 61,113 bytes > 60,000; this task adds styles only to `css/omni-workspace.css`, and `git diff --numstat` shows no inline style edit. |
| `git diff --check` | Passed before this status update. |

### Screenshots / visual QA

Після `npm ci --ignore-scripts` у ізольованому worktree виконано реальну браузерну перевірку Playwright на локальній Omni fixture, без CRM/production DB, Binotel credentials або зовнішніх запитів. Перевірено фільтр, очищення, cursor pagination, Back, клавіатурні вкладки, scoped customer deep link, disabled recording/live/queue controls і збереження draft у Inbox. Артефакти з тестовими (не production) даними: `output/binotel/binotel-telephony-desktop-dark.png`, `binotel-telephony-mobile-light.png`, `binotel-telephony-native-zoom-200.png`.

### Next task

Proceed with BNT-06 with scoped customer navigation only where the canonical server DTO already supplies a customer ID; keep recording unavailable until its server-side contract is confirmed.

## BNT-06

- `taskStatus`: `PARTIAL_CAPABILITY_GAP`
- `candidateReadiness`: `LOCAL_UI_VERIFIED`
- File: `docs/integrations/binotel/BNT-06-RECORDINGS-BLOCKER.md`.
- Exact recording blocker: no confirmed recording method, host/redirect/TTL, identity mapping or access policy. Playback endpoint, proxy, URL and cache were not added; the control is visibly disabled even for a fixture record marked available.
- Implemented safe scope: a customer deep link is rendered only when the canonical, already scoped server DTO supplies `customer.id`; no number-based customer search or inferred link is performed.

## BNT-07

- `taskStatus`: `PARTIAL_CAPABILITY_GAP`
- `candidateReadiness`: `LOCAL_UI_VERIFIED`
- File: `docs/integrations/binotel/BNT-07-LIVE-BLOCKER.md`.
- Exact blocker: no documented live/queue endpoint, schema, rate limits or account licence/capability. The UI keeps both tabs disabled with an explanation; no polling and no fabricated zero/available state were added.

### Next task

Proceed with BNT-08 finalization: full local baseline attempt, file-manifest/diff evidence and activation handoff. Do not claim recordings, live calls or queues are implemented.

## BNT-08

- `taskStatus`: `DONE_LOCAL_WITH_BASELINE_BLOCKER`
- `candidateReadiness`: `LOCAL_BROWSER_VERIFIED_BASELINE_BLOCKED`
- Base SHA: `d328eebee940dd5985917fa79a172b6e9ab65738`
- Branch/worktree: `codex/binotel-crm-integration` / `C:\\Users\\Plotva\\.codex\\worktrees\\binotel-crm-integration\\EventGenix`
- Candidate state: uncommitted, local only, not pushed, reviewed or deployed.
- Candidate state: uncommitted, local only, not pushed, reviewed or deployed.

### Final implementation decision

Реалізовано reviewable fail-closed MVP surface: scoped DTO/client, lifecycle reducer, authenticated journal endpoints і повний Omni UI. Це не live Binotel integration: endpoint/auth/enum/pagination, recordings, live calls, queues і webhook lifecycle persistence не підтверджені й не імітуються. Scoped customer navigation реалізовано лише за вже наявним canonical customer ID. BNT-06/07 мають контрольовані capability gaps, а не прихований локальний дефект.

### Final verification

| Command | Result |
| --- | --- |
| `node --test tests/binotel-client.test.js tests/binotel-call-lifecycle.test.js tests/binotel-journal.test.js tests/omni-telephony-ui.test.js` | Passed: 19/19. |
| `npm run check:syntax` | Passed: 1,279 JavaScript files. |
| `npm run check:api-surface`, `check:auth-boundary`, `check:css-surface`, `check:static-surface`, `check:service-worker-policy` | All passed. |
| Telephony-only browser fixture (`OMNI_LAYOUT_ONLY=1`, `OMNI_TELEPHONY_ONLY=1`) | Passed: real clicks, filters, pagination, Back, keyboard tabs, safe unavailable controls and Inbox draft preservation; no page errors, unexpected fixture requests or writes. |
| Native browser zoom fixture | Passed at 200%: visible controls and `scrollWidth === innerWidth` (512 px). |
| `npm test` full baseline | Reached `check:theme-surface` and failed only on existing `omni.html` inline-style budget: 61,113 > 60,000. This package has no diff inside a `<style>` block; `git show HEAD:omni.html` has the same pre-existing inline-style debt. The command did not continue to later baseline stages. |
| `git diff --check` | Passed. |

### UI evidence

Local browser screenshots were produced from the repository's synthetic Omni fixture: `output/binotel/binotel-telephony-desktop-dark.png`, `output/binotel/binotel-telephony-mobile-light.png` and `output/binotel/binotel-telephony-native-zoom-200.png`. No production DB, credentials, PII, recording or real Binotel request was used. A broad existing Omni layout fixture currently stops at its Inbox breakpoint assertion before its Telephony segment; the isolated Telephony browser check independently passed, including Inbox draft preservation. This must remain visible in the final report rather than being treated as a passing whole-suite result.

### File manifest

`README.md`; `omni.html`; `css/omni-workspace.css`; `routes/omnichannel.js`; `js/omni-telephony-workspace.js`; `services/binotel-client.js`; `services/binotel-call-mapper.js`; `services/binotel-call-lifecycle.js`; `services/binotel-journal.js`; four focused test files; browser fixture/checks; `CONTRACT.md`; this status; BNT-03/06/07 evidence and `HANDOFF.md`.

### One next action

Obtain Binotel's account-specific REST/Webhook/WebSocket documentation and authorize one read-only test account; then implement and verify the real provider transport before requesting a separate commit/release stage.
