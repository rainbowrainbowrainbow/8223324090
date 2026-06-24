# Timeline Banquet Add-To-Existing Regression Coverage Plan

Production impact: yes.

Date: 2026-06-24
Branch: `codex/timeline-leads-hardening`
Version at audit: `0.77.18 - Booking Detail Polish`

## Goal

Prevent the user path from the screenshot from regressing:

1. A banquet is active on the room timeline.
2. The mini banquet inspector or banquet marker is selected.
3. The manager clicks an empty timeline cell in the same room.
4. The drawer must open in "add to existing banquet" mode.
5. Save must create a banquet group member/activity, not a standalone gray booking.

The tests must prove both UI intent propagation and backend persistence. Backend endpoints already have good coverage; the missing layer is the frontend intent path: active banquet context -> empty cell click -> drawer state -> save path.

## Existing Coverage Inventory

### `tests/booking-banquet-links.test.js`

Already covers backend atomic banquet endpoints:

- `POST banquet member-booking creates kitchen booking, membership, and compatibility link atomically`
- `POST banquet activity-booking allows activity over same-banquet kitchen room slot`
- `POST banquet member-booking allows kitchen over same-banquet activity room slot`
- customer mismatch rejection;
- rollback on membership insert failure;
- `/api/bookings/full` rejects banquet group payloads.

Gap:

- Does not prove timeline empty-cell click uses these endpoints.
- Does not prove the drawer carries active mini inspector context.

### `tests/booking-create-durability.test.js`

Already covers generic booking durability and conflict behavior:

- generic `/api/bookings` can overlap same-banquet operational rows only when banquet group metadata exists;
- strict room conflict stays active without banquet context;
- `/api/bookings/full` overlap behavior for same banquet vs unrelated room booking;
- service transaction ordering for banquet member creation.

Gap:

- Does not prove wrong generic create path is blocked when active banquet intent exists.
- Does not prove an orphan-like standalone booking is not created silently.

### `tests/timeline-resources.test.js`

Already covers room timeline visual grouping:

- room banquet preview and inspector are snapshot-backed;
- activity-first primary animation remains visible beside kitchen marker;
- two activities remain visible beside kitchen marker;
- service markers and activity lanes do not overlap;
- activity blocks keep booking modal click ownership;
- browser smoke runner has two-way source bridge coverage.

Gap:

- Does not test empty-cell click while a banquet inspector is active.
- Does not test passing `_timelineBanquetSummary` / group context into `openBookingPanel`.
- Does not test clearing stale active banquet context on close/date/view change.

### `tests/booking-package-contract.test.js`

Already covers static frontend save path contracts:

- source-only activity -> kitchen bridge uses `/api/banquets/from-source/member-booking`;
- kitchen -> activity bridge uses `/api/banquets/from-source/activity-booking`;
- existing group member uses `apiCreateBanquetMemberBooking(createPath.groupId, ...)`;
- existing group activity uses `apiCreateBanquetActivityBooking(...)`;
- customer mismatch blocks before source bridge API call;
- drawer state lifecycle has centralized reset/generation guards.

Gap:

- Does not require `openBookingPanel(..., { banquetContext })`.
- Does not require explicit active banquet intent to survive reset.
- Does not require standalone override before generic create fallback.

### `tests/ui-check.js`

Already has static guards for:

- no pre-save group creation;
- banquet selector and create path endpoints;
- source bridge endpoints;
- timeline create toolbar path.

Gap:

- No guard for active banquet context helper.
- No guard for banner/chip "add to banquet" UI.
- No guard for `Створити окремо` being the only standalone escape hatch.

## Required Regression Test Cases

### 1. Active inspector context is stored and cleared

File: `tests/timeline-resources.test.js`

Type: static/unit DOM harness.

Test name:

`room timeline stores active banquet context for add-to-existing creation`

Assert:

- `showTimelineBanquetInspector(...)` stores a full active context, not only `dataset.banquetGroupId`.
- context includes `groupId`, `sourceBookingId` or `primaryBookingId`, `customerId`, `date`, `room`, `businessContext`.
- `hideTimelineBanquetInspector()` clears active context.
- date/view re-render also clears active context.

Why:

This catches the first failure point where the UI visually has a banquet selected but no durable context exists for create.

### 2. Empty timeline cell passes banquet context into drawer

File: `tests/timeline-resources.test.js`

Type: static/unit DOM harness.

Test name:

`timeline empty-cell click passes active banquet context to booking drawer`

Fixture:

- active mini inspector summary with `groupId = BQ-SCREENSHOT`, `primaryBooking.id = BK-ROOT`, `customerId = 101`, room `Диван 3`;
- selected empty cell at `15:15`, same room line.

Assert:

- `selectCell(cell)` calls `openBookingPanel(cell.dataset.time, cell.dataset.line, { banquetContext: ... })`;
- passed context has group id and source booking id;
- same-room/same-date context is accepted;
- no context is passed when inspector is closed.

Why:

This is the exact user path from the screenshot.

### 3. Drawer preserves explicit context after reset

File: `tests/booking-package-contract.test.js`

Type: static guard plus optional VM helper test if implementation exposes a pure helper.

Test name:

`booking drawer preserves explicit timeline banquet context through open reset`

Assert:

- `openBookingPanel(time, lineId, options)` reads `options.banquetContext`;
- explicit context is applied after `resetBookingDrawerStateForOpen(...)`;
- `BookingDrawerState.roomSelectionBanquetContext` receives the context;
- `BookingDrawerState.selectedBanquetGroupId` receives `context.groupId`;
- `BookingDrawerState.activeBanquetIntent` or equivalent state is set to `add_to_existing`;
- room heuristic lookup cannot overwrite explicit context unless stale/mismatched.

Why:

The current root cause is context loss between `selectCell` and drawer initialization.

### 4. Add-to-banquet banner/chip is rendered

File: `tests/ui-check.js`

Type: static UI guard.

Test name/check:

`Booking drawer shows active banquet context and explicit standalone escape`

Assert:

- booking drawer has a dedicated active banquet context banner/chip class;
- copy includes `Додається до банкету`;
- there is a `Створити окремо` action;
- there is a change/select banquet action;
- standalone action clears active group/intent before generic create.

Why:

Prevents invisible state. The user must see whether they are adding to banquet or creating separately.

### 5. Save path uses group member endpoint for kitchen/menu member

File: `tests/booking-package-contract.test.js`

Type: static save-path guard, optionally pure resolver test.

Test name:

`active banquet context kitchen save cannot fall back to normal booking`

Fixture:

- selected context: `groupId = BQ-SCREENSHOT`, `sourceBookingId = BK-ROOT`, same customer;
- form state: kitchen/menu enabled, one menu item, room `Диван 3`;
- no standalone override.

Assert:

- `resolveBookingCreatePath(...)` returns `existing_group_member`;
- save branch calls `apiCreateBanquetMemberBooking(createPath.groupId, ...)`;
- payload includes `sourceBookingId`;
- generic `apiCreateBooking(booking)` is not reachable for this state.

Why:

This prevents a new gray standalone kitchen/service booking.

### 6. Save path uses group activity endpoint for activity

File: `tests/booking-package-contract.test.js`

Type: static save-path guard, optionally pure resolver test.

Test name:

`active banquet context activity save cannot fall back to normal booking`

Fixture:

- selected context: `groupId = BQ-SCREENSHOT`, `sourceBookingId = BK-ROOT`, same customer;
- form state: one activity program, no kitchen member intent;
- no standalone override.

Assert:

- `resolveBookingCreatePath(...)` returns `existing_group_activity`;
- save branch calls `apiCreateBanquetActivityBooking(...)`;
- linked animator bookings are preserved if needed;
- generic `apiCreateBooking(booking)` is not reachable for this state.

Why:

This prevents a standalone activity that visually sits beside the banquet but is not summarized.

### 7. Explicit standalone override is required

File: `tests/booking-package-contract.test.js` and `tests/ui-check.js`

Type: static guard.

Test name:

`active banquet context only allows standalone create after explicit override`

Assert:

- active context has an intent flag such as `add_to_existing`;
- normal/generic create fallback is blocked while add-to-existing intent is active;
- clicking `Створити окремо` clears `selectedBanquetGroupId`, context, and intent;
- after override, `resolveBookingCreatePath(...)` may return `normal_booking`;
- confirmation text exists for near-banquet standalone creation.

Why:

Same customer + room + close time should not silently create an orphan. Standalone must be intentional.

### 8. Missing source booking blocks save

File: `tests/booking-package-contract.test.js`

Type: resolver/static guard.

Test name:

`active banquet context with group but missing source booking blocks save`

Fixture:

- `groupId` exists;
- no `sourceBookingId` / primary booking id;
- form is kitchen or activity.

Assert:

- create path is blocked;
- user-facing error says source/primary booking cannot be resolved;
- no group endpoint and no generic endpoint is called.

Why:

Prevents partial group metadata from silently falling into generic create.

### 9. Backend member creation keeps package/menu values grouped

File: `tests/booking-banquet-links.test.js`

Type: API route test.

Existing coverage mostly exists in `POST banquet member-booking creates kitchen booking...`.

Add or extend assert:

- existing group has package/menu snapshot with 10 portions;
- new member booking payload contains menu position/service event;
- created row has `banquet_group_bookings` membership;
- created row has `extraData.banquetGroup.groupId`;
- created row appears in `GET /api/banquets/by-booking/:id` or equivalent group load;
- created row is not absent from group summary.

Why:

Protects the "menu/package quantity copied from existing banquet" acceptance point.

### 10. Backend activity creation keeps grouped summary correct after reload

File: `tests/booking-banquet-links.test.js`

Type: API route test.

Add or extend assert:

- create activity through `/api/banquets/:groupId/activity-booking`;
- reload group snapshot/summary;
- activity appears in members with role `activity`;
- kitchen/service marker remains grouped;
- no extra standalone candidate is created.

Why:

Protects reload behavior after correct save.

### 11. Generic `/api/bookings` cannot be used for active banquet payloads

File: `tests/booking-banquet-links.test.js` or `tests/booking-create-durability.test.js`

Type: API/static hybrid.

Existing coverage:

- `/api/bookings/full` rejects banquet group payloads.

Add coverage:

- if generic `/api/bookings` receives explicit `extraData.banquetGroup` from active add-to-existing intent, either it must reject with a clear error or the frontend must never call it.

Recommended MVP:

- keep backend unchanged if product risk is high;
- add frontend/static guard that active add-to-existing save path cannot call `apiCreateBooking`.

Why:

Backend rejection may be a later hardening task. The immediate hot path is frontend routing.

### 12. Browser smoke covers screenshot path

File: `tests/browser/timeline-browser-smoke.js`

Type: Playwright/browser smoke. Add to `npm run test:browser:timeline`, not necessarily `npm test` if it needs a live app.

Scenario:

1. Create/find banquet with room `Диван 3`, customer, menu position, food service marker, activity.
2. Open room timeline.
3. Open mini banquet inspector.
4. Click empty cell `15:15` or `17:00`.
5. Assert drawer banner says `Додається до банкету`.
6. Add a kitchen/service or activity.
7. Intercept request:
   - must hit `/api/banquets/:groupId/member-booking` or `/api/banquets/:groupId/activity-booking`;
   - must not hit `/api/bookings` for the save.
8. Reload timeline.
9. Assert mini inspector count/list includes the new item.
10. Assert no standalone gray orphan card appears for same customer/time.

Why:

This is the only test level that fully covers the real click path from the screenshot.

## Test Placement Matrix

| Case | File | Type | Must be in fast `npm test`? |
| --- | --- | --- | --- |
| active inspector context stored/cleared | `tests/timeline-resources.test.js` | DOM/static unit | yes |
| empty cell passes context to drawer | `tests/timeline-resources.test.js` | DOM/static unit | yes |
| drawer preserves explicit context through reset | `tests/booking-package-contract.test.js` | static/unit | yes |
| banner/chip and standalone action exist | `tests/ui-check.js` | static UI guard | yes |
| kitchen save uses group member endpoint | `tests/booking-package-contract.test.js` | static/resolver | yes |
| activity save uses group activity endpoint | `tests/booking-package-contract.test.js` | static/resolver | yes |
| explicit standalone override clears context | `tests/booking-package-contract.test.js`, `tests/ui-check.js` | static/resolver | yes |
| missing source booking blocks save | `tests/booking-package-contract.test.js` | static/resolver | yes |
| backend member creation joins group and package | `tests/booking-banquet-links.test.js` | API route unit | yes |
| backend activity creation survives reload | `tests/booking-banquet-links.test.js` | API route unit | yes |
| generic create not used for active context | `tests/booking-package-contract.test.js` | static | yes |
| real click path from screenshot | `tests/browser/timeline-browser-smoke.js` | browser smoke | no, run focused |

## Recommended Implementation Order

1. Add failing static guards for context propagation:
   - `selectCell(...)` passes `options.banquetContext`;
   - `openBookingPanel(...)` accepts and applies explicit context.
2. Add drawer/banner guards.
3. Add create path guards for group member/activity vs standalone override.
4. Extend backend route tests only if the implementation changes payload shape or summary loading.
5. Add Playwright smoke for the full screenshot path after the UI implementation is stable.

## Verification Commands

Focused:

```bash
npm run check:runtime
node --test tests/timeline-resources.test.js
node --test tests/booking-package-contract.test.js
node --test tests/booking-banquet-links.test.js
node --test tests/booking-create-durability.test.js
npm run test:ui
```

Full fast baseline:

```bash
npm test
```

Browser smoke after local app is running:

```bash
npm run test:browser:timeline
```

## Acceptance Mapping

- Timeline click with active banquet context pre-fills modal:
  - covered by cases 1, 2, 3, 4, 12.
- Save creates booking with same `banquet_group_id`:
  - covered by cases 5, 6, 9, 10, 12.
- Menu/package quantity copied from existing banquet:
  - covered by cases 3, 5, 9, 12.
- Kitchen/service marker remains grouped:
  - covered by cases 9, 10, 12 and existing `timeline-resources` marker tests.
- Activity remains grouped:
  - covered by cases 6, 10, 12 and existing activity marker tests.
- Standalone booking only when explicitly chosen:
  - covered by cases 4, 7, 11, 12.
- Reload keeps grouped summary correct:
  - covered by cases 10 and 12.
- Orphan-like booking is not created silently:
  - covered by cases 2, 5, 6, 7, 11, 12.

## Residual Risk

Static tests can prove the contract wiring, but only browser smoke proves the exact interaction sequence with real DOM state, async inspector hydration, and network request routing. The screenshot path must therefore have at least one browser-level smoke before release, even if it is not part of the default `npm test` baseline.
