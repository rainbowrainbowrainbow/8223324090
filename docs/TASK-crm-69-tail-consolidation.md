# CRM 69 — системне підтягування хвостів

- **Status:** ready for Codex
- **Task type:** phased production implementation
- **Execution mode:** discovery -> implementation -> verification -> deploy
- **Target repo:** Event Genix CRM
- **Date:** 2026-05-31
- **Release train:** `0.69.x`

## Executive Summary

CRM 69 має закрити не один косметичний баг, а системно добити хвости після швидкої серії `0.68.x`.
Основний фокус: зробити критичні робочі контури правдивими, перевіреними і зручними в production, без fake success і без паралельних джерел правди.

Перший великий пріоритет: **timeline + booking truth / multi-cabinet**.
Саме тут зараз найбільший production-ризик: користувач бачить успішний toast, але запис може не зʼявитися в поточному timeline, або лінія/ресурс не збігаються з тим, що реально збережено.

## Why This Exists

За останні релізи були швидко підтягнуті:

- multi-cabinet timeline booking recovery;
- smart booking drawer;
- kitchen toggle / pinata / encoding fixes;
- business switcher і business context;
- HR structure canvas;
- tasks/profile working surfaces;
- Omni/Telegram bridge;
- AI program icons.

Ці блоки вже мають базову реалізацію, але видно кілька системних хвостів:

- legacy fallback-и ще живуть поруч із новими canonical моделями;
- частина UI довіряє optimistic success замість перевіреного API/DOM результату;
- booking drawer, timeline resources і business scope мають кілька compatibility-шарів;
- live smoke часто ручний, а не зафіксований як повторювана UAT-матриця;
- provider-и Omni/AI мають код, але потребують operational truth: status, secrets, send-capable/live generation.

## Product Goal

Після CRM 69 менеджер має мати стабільну систему, де:

1. бронювання, створене в drawer, реально зʼявляється в timeline без ручного refresh;
2. лінія/ресурс/кабінет у UI збігається з тим, що збережено в API;
3. business context не дрейфує між route, localStorage, header/sidebar і API;
4. smart booking drawer не показує зайвого, але не приховує потрібну валідацію;
5. HR canvas можна редагувати інтуїтивно, без випадкових spaghetti-ліній;
6. Omni/Telegram і AI icons мають чесний статус: працює, налаштовано, не налаштовано, помилка;
7. release QA ловить основні regression-и до деплою.

## Non-Goals

- Не переписувати auth з нуля.
- Не робити destructive DB cleanup без окремого підтвердження.
- Не ламати існуючі legacy-поля payload, якщо backend ще їх читає.
- Не робити нову дизайн-систему замість точкової стабілізації існуючої.
- Не ховати production-ризики під UI-label-и без реальної data-flow правди.

## Phase 0 — Repo Truth And Impact Map

Mandatory startup:

```bash
git rev-parse --show-toplevel
git status --short --branch
git branch --show-current
git log --oneline -12
npm run version:current
```

Read:

- `AGENTS.md`
- relevant `CHANGELOG.md` entries from `v0.68.40` onward;
- touched tests around timeline, booking, business context, HR canvas, Omni, products, tasks.

Produce a compact impact map before editing:

- timeline booking render/data flow;
- booking drawer submit and refresh flow;
- business context source-of-truth;
- resource/line model and legacy fallback paths;
- HR canvas node/link model;
- Omni provider status model;
- AI icon provider/settings model;
- task owner/profile data model.

## Phase 1 — Timeline + Booking Truth

This is the first implementation block.

Required outcomes:

- no green success toast unless the server confirmed the booking and the current timeline state was refreshed or reconciled;
- if server created a record but the current timeline cannot show it, the UI must explain exactly why: wrong business, date, line/resource, filter, status, or stale DOM;
- booking drawer must keep enough context to re-query the exact saved booking after submit;
- timeline cache/store must update from canonical response, not from guessed local shape;
- day/week views must agree on newly created events;
- previous/confirmed filters must not hide a newly confirmed booking by accident;
- schedule-generated lines and manually created lines must resolve to one canonical timeline resource model.

Audit specifically:

- `js/app.js`
- timeline resource helpers;
- booking drawer/component files;
- booking API routes and services;
- tests around `booking-confirmation`, `booking-linked-atomic`, `timeline-resources`, `timeline-regression-matrix`.

Acceptance:

- create booking on schedule-backed line -> visible without manual refresh;
- create booking on manually added line -> visible without manual refresh;
- create event with program and room -> visible in correct row/time;
- create simple booking without program -> visible if allowed;
- invalid line/resource -> red actionable error, no fake success;
- filtered-out result -> yellow explanation with exact filter reason.

## Phase 2 — Multi-Cabinet Resource Model

Goal: stop treating rooms/cabinets/animator lines as accidental aliases.

Required outcomes:

- define one code-facing resource contract for timeline lines:
  - `resourceId`
  - `resourceType`
  - `displayName`
  - `businessContext`
  - `date`
  - `source: schedule | manual | room | cabinet | specialist`
- keep legacy `lineId` / `lineName` compatibility only at API edges;
- ensure educational/cabinet mode displays cabinets as rows and occupancy as first-class data;
- ensure park mode still supports animator/program lines without regressing current flow;
- add guard tests for schedule-generated vs manual resources.

Acceptance:

- booking can be created against each supported resource source;
- resource mismatch is impossible to silently save;
- UI labels match actual resource semantics for park/specialist/education modes.

## Phase 3 — Smart Booking Drawer Completion

Goal: make booking drawer an operator tool, not a long fragile form.

Required outcomes:

- sticky summary stays inside drawer, never floats across center screen;
- submit button remains usable, but on invalid data shows a clear missing-fields list;
- kitchen/menu appears only when explicitly enabled;
- kitchen count inputs do not block submit when kitchen is disabled;
- pinata/program option popovers use the same dark CRM theme;
- client search -> existing client -> new client flow is clear;
- payload maps to current backend without schema changes;
- no mojibake in categories, select options, buttons, validation text, or generated menu description.

Acceptance:

- no invalid HTML number validation blocks hidden kitchen fields;
- no broken encoding in any booking drawer option;
- event/program, kitchen, lead details can be toggled independently;
- creating booking with and without kitchen works;
- creating booking with pinata works and stays visually consistent.

## Phase 4 — Business Context Reliability

Goal: one active business truth for shell, timeline, API and storage.

Required outcomes:

- one canonical client helper answers current business;
- sidebar selector is the only visible business switcher;
- route compatibility exists only as fallback, not as competing state;
- localStorage/sessionStorage legacy keys do not override explicit active business;
- business switch invalidates stale timeline/task/customer data;
- API context is attached consistently.

Acceptance:

- refresh preserves selected business;
- switching business reloads relevant data and clears stale DOM;
- no header duplicate switcher returns;
- wrong-business booking cannot silently appear or disappear.

## Phase 5 — HR Canvas Usability

Goal: HR structure canvas should feel editable, not dangerous.

Required outcomes:

- default canvas opens without spaghetti lines;
- clicking one port starts a visible pending link;
- clicking second port creates the relation;
- Escape/click empty canvas cancels pending link;
- selected node explains available actions;
- auto-layout does not overlap cards;
- role cards have readable category, title and hierarchy at zoomed-out distance;
- line deletion/editing is discoverable from selected relation, not from a confusing global toolbar.

Acceptance:

- new user can create one link without reading documentation;
- auto-layout produces a readable structure for the current demo/company roles;
- saved structure reloads exactly.

## Phase 6 — Omni / Telegram Bridge Operational Truth

Goal: Omni should show whether Telegram bridge is actually connected and send-capable.

Required outcomes:

- provider status clearly distinguishes:
  - not configured;
  - webhook mirror configured;
  - send bridge configured;
  - connected/send-capable;
  - failing with last error;
- inbound mirror from bot creates or updates Omni conversation;
- outbound reply calls bot bridge endpoint;
- business context `maysternya_doli` is attached consistently;
- secrets are never printed in UI/log output.

Acceptance:

- `node --test tests/omni-send-truth.test.js` passes;
- `node --test tests/omni-provider-lifecycle.test.js` passes;
- live smoke documents inbound Telegram message and outbound CRM reply, or explicitly marks env as missing.

## Phase 7 — AI Program Icons Provider Flow

Goal: AI icon generation must be understandable and cheap-safe.

Required outcomes:

- OpenRouter/Kie settings page clearly shows configured/missing provider keys without exposing secrets;
- cheap default model/provider is documented in UI text;
- generation has pending/success/error/retry states;
- generated icon URL persists on the program;
- failed generation stores a useful debug trail without leaking keys;
- cost and rate-limit guardrails are visible.

Acceptance:

- missing key state is actionable;
- one real generation can be run in production only after explicit operator confirmation;
- UI does not pretend generated icon exists if provider failed.

## Phase 8 — Tasks, Profile, Role And Work Queue Truth

Goal: remove remaining drift between profile, tasks, work queue and role-aware shell surfaces.

Required outcomes:

- typed task owner is canonical;
- legacy owner strings are displayed as compatibility warnings only where needed;
- profile `Мій день`, tasks page and dashboard widgets read one task truth;
- role switch/working role popover remains visible within viewport;
- assigning/handoff notifications dedupe correctly and do not spam.

Acceptance:

- adding task for role/user updates relevant widgets;
- completing parent/subtask updates metrics consistently;
- role popover works in snapped desktop and mobile widths.

## Phase 9 — Release QA Harness

Goal: stop relying on manual screenshots as the only protection for critical CRM flows.

Minimum checks:

```bash
npm run check:runtime
npm run check:version
npm run test:ui
npm test
node --test tests/booking-confirmation.test.js
node --test tests/booking-drawer-encoding.test.js
node --test tests/booking-linked-atomic.test.js
node --test tests/timeline-lifecycle.test.js
node --test tests/timeline-resources.test.js
node --test tests/timeline-regression-matrix.test.js
node --test tests/business-context.test.js
node --test tests/operational-business-context.test.js
node --test tests/omni-send-truth.test.js
node --test tests/omni-provider-lifecycle.test.js
node --test tests/product-program-icon-generation.test.js
node --test tests/profile-hr-professions-foundation.test.js
node --test tests/work-queue.test.js
```

Live UAT matrix:

- login screen shows current version;
- dashboard loads for Park Zakrevskogo;
- timeline opens with expected business context;
- create booking on existing schedule line;
- create booking on manual line;
- event with program appears in timeline;
- booking drawer invalid submit lists missing fields;
- business switch refreshes data;
- HR canvas creates and removes one link;
- Omni status page reflects Telegram bridge state;
- Products AI icon UI shows configured/missing provider truth.

## Definition Of Done

- Critical timeline booking flow no longer has fake success.
- Multi-cabinet resource model has one canonical contract and tests.
- Smart booking drawer validates and submits predictably.
- Business switcher/context no longer has visible or hidden competing truth.
- HR canvas direct-link and auto-layout are usable.
- Omni/Telegram bridge status is operationally truthful.
- AI icon generation settings/status are operator-safe.
- Tasks/profile/role surfaces do not drift on owner/role truth.
- Changelog/version/service worker/cache tags are synchronized.
- Commit, push, deploy and live smoke are completed.

## Final Report Format

1. Executive summary
2. Impact map from repo evidence
3. What was fixed by category
4. Files changed
5. Data contracts changed or stabilized
6. Tests/checks run
7. Browser/live UAT results
8. Version/changelog evidence
9. Commit hash
10. Push evidence
11. Deploy evidence
12. Residual risks and next release slice

