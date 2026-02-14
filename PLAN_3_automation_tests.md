# Feature #3: Automation Tests

## Automation Engine Analysis

### Architecture Overview

The booking automation engine (`services/bookingAutomation.js`) implements an **Observer pattern** — when a booking is created or confirmed, the engine evaluates all active rules from the `automation_rules` table and executes matching actions. The design principle is "don't hardcode business logic": rules live in the database, and the engine only knows HOW to execute actions, not WHAT to execute.

### How Rules Work

1. **Storage**: Rules are stored in the `automation_rules` table with columns:
   - `id` (SERIAL PK)
   - `name` (VARCHAR 200) — human-readable rule name
   - `trigger_type` (VARCHAR 30) — `'booking_create'` or `'booking_confirm'`
   - `trigger_condition` (JSONB) — object with `product_ids` (array) and/or `categories` (array)
   - `actions` (JSONB) — array of action objects
   - `days_before` (INTEGER) — offset for task date calculation (0 = same day as booking)
   - `is_active` (BOOLEAN) — enables/disables the rule

2. **Trigger Flow** (called from `routes/bookings.js`):
   - `POST /api/bookings` — calls `processBookingAutomation(b)` with `_event = 'create'` (default) for non-linked bookings
   - `POST /api/bookings/full` — calls `processBookingAutomation(main)` for the main booking
   - `PUT /api/bookings/:id` — when status changes from `'preliminary'` to `'confirmed'`, fetches fresh DB row and calls `processBookingAutomation({...mappedRow, _event: 'confirm'})`
   - All calls are **fire-and-forget** (`.catch()` — non-blocking)

3. **Matching** (`matchesCondition` function):
   - Checks `condition.product_ids` array — if booking's `programId` is in the array, matches
   - Checks `condition.categories` array — if booking's `category` is in the array, matches
   - Returns `false` if condition is null/undefined or no arrays match
   - Both checks are OR-based: if either matches, the rule fires

4. **Trigger Type Filtering**:
   - `processBookingAutomation` reads `booking._event` (defaults to `'create'`)
   - Rules with `trigger_type = 'booking_create'` only fire on `_event === 'create'`
   - Rules with `trigger_type = 'booking_confirm'` only fire on `_event === 'confirm'`

### Action Types

1. **`create_task`** — inserts a row into the `tasks` table:
   - `title`: interpolated from `action.title`
   - `date`: calculated via `calculateTaskDate(bookingDate, rule.days_before)`
   - `status`: always `'todo'`
   - `priority`: from `action.priority` (default `'normal'`)
   - `category`: from `action.category` (default `'purchase'`)
   - `created_by`: from booking's `createdBy` field (fallback `'system'`)
   - `type`: always `'auto_complete'`

2. **`telegram_group`** — sends a message to configured Telegram group:
   - `template`: interpolated via `action.template`
   - Uses `getConfiguredChatId()` to get chat ID from settings
   - Sends with `parse_mode: 'HTML'`
   - Silently skips if no chat is configured

### Placeholder Interpolation

The `interpolate(template, booking)` function replaces these placeholders:

| Placeholder | Source Field | Fallback |
|---|---|---|
| `{date}` | `booking.date` | `''` |
| `{time}` | `booking.time` | `''` |
| `{programName}` | `booking.programName` or `booking.program_name` | `''` |
| `{pinataFiller}` | `booking.pinataFiller` or `booking.pinata_filler` | `''` |
| `{kidsCount}` | `booking.kidsCount` or `booking.kids_count` | `'?'` |
| `{room}` | `booking.room` | `''` |
| `{groupName}` | `booking.groupName` or `booking.group_name` | `''` |
| `{createdBy}` | `booking.createdBy` or `booking.created_by` | `''` |
| `{label}` | `booking.label` | `''` |
| `{notes}` | `booking.notes` | `''` |
| `{tshirtSizes}` | Built from `extra_data.tshirt_sizes` object | `'не вказано'` |

T-shirt sizes are built by filtering entries where value > 0, formatting as `S×2, M×3`, joined with commas. Falls back to `'не вказано'` if empty or missing.

### CRUD API for Rules

Rules are managed via `routes/settings.js`:

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/automation-rules` | Yes | List all rules (ordered by created_at DESC) |
| `POST` | `/api/automation-rules` | Yes | Create rule (requires name, trigger_condition, actions) |
| `PUT` | `/api/automation-rules/:id` | Yes | Update rule (all fields including is_active) |
| `DELETE` | `/api/automation-rules/:id` | Yes | Delete rule |

### Seeded Default Rules (3 rules)

1. **"Замовлення друку піньяти"** — trigger: `booking_create`, products: `['pinata', 'pinata_custom']`, days_before: 3
   - Action 1: `create_task` with pinata order title
   - Action 2: `telegram_group` with pinata order message
2. **"МК Футболки — уточнити розміри"** — trigger: `booking_create`, products: `['mk_tshirt']`, days_before: 5
   - Action 1: `create_task` with size clarification title
   - Action 2: `telegram_group` with t-shirt booking message
3. **"МК Футболки — замовити у підрядника"** — trigger: `booking_confirm`, products: `['mk_tshirt']`, days_before: 5
   - Action 1: `create_task` with order title using `{tshirtSizes}`
   - Action 2: `telegram_group` with order details

---

## Test Cases

### Test File Convention

- File: `tests/api.test.js` (append to existing test suite)
- Pattern: `describe()` / `it()` blocks using Node.js built-in test runner
- Helpers: `request()`, `authRequest()`, `testDate()` from `tests/helpers.js`
- Date convention: Use `2099-*` dates for test isolation
- Cleanup: Use `after()` hooks with `DELETE ?permanent=true` for bookings, `DELETE` for rules/tasks

---

### 1. Automation Rules CRUD

```
describe('Automation Rules CRUD (v8.3)')
```

#### 1.1 List Rules

```
it('GET /api/automation-rules — should return array')
```
- `GET /api/automation-rules`
- Assert: status 200
- Assert: response is array
- Assert: seeded rules exist (length >= 3 after DB init)

#### 1.2 Create Rule — Success

```
it('POST /api/automation-rules — create rule')
```
- `POST /api/automation-rules` with body:
  ```json
  {
    "name": "Test Rule Smoke",
    "trigger_type": "booking_create",
    "trigger_condition": { "product_ids": ["kv1"] },
    "actions": [{ "type": "create_task", "title": "Test task for {date}", "priority": "normal", "category": "admin" }],
    "days_before": 2
  }
  ```
- Assert: status 200
- Assert: `res.data.success === true`
- Assert: `res.data.rule` has `id`, `name`, `is_active === true`
- Store `ruleId` for subsequent tests

#### 1.3 Create Rule — Missing Required Fields

```
it('POST /api/automation-rules — missing name returns 400')
```
- `POST /api/automation-rules` with body `{ "trigger_condition": {...}, "actions": [...] }` (no name)
- Assert: status 400
- Assert: `res.data.error` contains message about required fields

```
it('POST /api/automation-rules — missing trigger_condition returns 400')
```
- `POST /api/automation-rules` with body `{ "name": "No Condition", "actions": [...] }`
- Assert: status 400

```
it('POST /api/automation-rules — missing actions returns 400')
```
- `POST /api/automation-rules` with body `{ "name": "No Actions", "trigger_condition": {...} }`
- Assert: status 400

#### 1.4 Read Rule — Verify Created

```
it('GET /api/automation-rules — should contain created rule')
```
- `GET /api/automation-rules`
- Assert: find rule with `id === ruleId`
- Assert: `trigger_condition.product_ids` includes `'kv1'`
- Assert: `days_before === 2`

#### 1.5 Update Rule

```
it('PUT /api/automation-rules/:id — update rule name and days_before')
```
- `PUT /api/automation-rules/{ruleId}` with body:
  ```json
  {
    "name": "Updated Test Rule",
    "trigger_type": "booking_create",
    "trigger_condition": { "product_ids": ["kv1", "kv4"] },
    "actions": [{ "type": "create_task", "title": "Updated task for {date}", "priority": "high", "category": "purchase" }],
    "days_before": 5,
    "is_active": true
  }
  ```
- Assert: status 200, `success === true`
- Verify via `GET /api/automation-rules`:
  - Rule name is `'Updated Test Rule'`
  - `days_before === 5`
  - `trigger_condition.product_ids` has 2 elements

#### 1.6 Disable Rule (Toggle is_active)

```
it('PUT /api/automation-rules/:id — disable rule (is_active=false)')
```
- `PUT /api/automation-rules/{ruleId}` with `is_active: false` (keep other fields)
- Assert: status 200
- Verify via `GET /api/automation-rules`:
  - Rule `is_active === false`

```
it('PUT /api/automation-rules/:id — re-enable rule (is_active=true)')
```
- `PUT /api/automation-rules/{ruleId}` with `is_active: true`
- Assert: status 200
- Verify: `is_active === true`

#### 1.7 Delete Rule

```
it('DELETE /api/automation-rules/:id — delete rule')
```
- `DELETE /api/automation-rules/{ruleId}`
- Assert: status 200, `success === true`
- Verify via `GET /api/automation-rules`: rule no longer in list

#### 1.8 Delete Non-Existent Rule

```
it('DELETE /api/automation-rules/:id — delete non-existent returns 200 (idempotent)')
```
- `DELETE /api/automation-rules/999999`
- Assert: status 200 (current implementation always returns success)

#### 1.9 Unauthenticated Access

```
it('GET /api/automation-rules — without token returns 401')
```
- `request('GET', '/api/automation-rules')` (no token)
- Assert: status 401

```
it('POST /api/automation-rules — without token returns 401')
```
- `request('POST', '/api/automation-rules', {...})` (no token)
- Assert: status 401

---

### 2. Trigger Conditions (matchesCondition)

These tests are **integration tests** that create a rule, then create a booking to verify the condition matching results in (or doesn't result in) task creation.

Setup for this section:
- Create a test line for date `2099-07-15`
- Create a test automation rule with `product_ids: ['pinata']` and action `create_task`
- After tests, clean up rules, tasks, bookings

#### 2.1 Product ID Matching — Positive

```
it('Booking with matching product_id triggers automation rule')
```
- Create rule: `trigger_condition: { product_ids: ['pinata'] }`, action: `create_task` with title `'Auto: pinata for {date}'`, `days_before: 0`
- Create booking: `programId: 'pinata'`, date `2099-07-15`
- Wait 500ms (fire-and-forget async)
- `GET /api/tasks?type=auto_complete&date=2099-07-15`
- Assert: find task with title containing `'Auto: pinata for 2099-07-15'`

#### 2.2 Product ID Matching — Multiple Product IDs

```
it('Rule with multiple product_ids matches any of them')
```
- Create rule: `trigger_condition: { product_ids: ['kv1', 'kv4', 'bubble'] }`
- Create booking with `programId: 'kv4'`
- Wait, then verify task created

#### 2.3 Category Matching

```
it('Booking with matching category triggers automation rule')
```
- Create rule: `trigger_condition: { categories: ['quest'] }`
- Create booking with `category: 'quest'`, `programId: 'kv1'`
- Wait, then verify task created with interpolated title

#### 2.4 No Matching Products — Rule Does Not Fire

```
it('Booking with non-matching product_id does NOT trigger rule')
```
- Create rule: `trigger_condition: { product_ids: ['pinata'] }`
- Create booking with `programId: 'kv1'` (quest, not pinata)
- Wait 500ms
- `GET /api/tasks?type=auto_complete`
- Assert: NO task found for this booking (filter by unique title marker)

#### 2.5 No Matching Category — Rule Does Not Fire

```
it('Booking with non-matching category does NOT trigger rule')
```
- Create rule: `trigger_condition: { categories: ['pinata'] }`
- Create booking with `category: 'quest'`
- Assert: no auto-task created

#### 2.6 Empty Condition — Rule Does Not Fire

```
it('Rule with empty trigger_condition never fires')
```
- Create rule: `trigger_condition: {}` (no product_ids, no categories)
- Create booking
- Assert: no auto-task created

#### 2.7 Both product_ids and categories — OR Logic

```
it('Rule with both product_ids and categories fires if either matches')
```
- Create rule: `trigger_condition: { product_ids: ['pinata'], categories: ['quest'] }`
- Create booking with `programId: 'kv1'`, `category: 'quest'`
- Assert: task created (category matches even though product_id doesn't)

---

### 3. Actions

#### 3.1 create_task Action — Verify Task Fields

```
it('create_task action inserts task with correct fields')
```
- Create rule: days_before=3, action: `{ type: 'create_task', title: 'Buy {programName} for {date}', priority: 'high', category: 'purchase' }`
- Create booking on `2099-08-20` with `programName: 'Піньята'`
- Wait, then find the auto-created task
- Assert task fields:
  - `title` = `'Buy Піньята for 2099-08-20'`
  - `date` = `'2099-08-17'` (3 days before 2099-08-20)
  - `status` = `'todo'`
  - `priority` = `'high'`
  - `category` = `'purchase'`
  - `type` = `'auto_complete'`

#### 3.2 create_task Action — Default Priority and Category

```
it('create_task action uses default priority (normal) and category (purchase) when omitted')
```
- Create rule with action: `{ type: 'create_task', title: 'Default test' }` (no priority, no category)
- Create matching booking
- Assert: task has `priority: 'normal'`, `category: 'purchase'`

#### 3.3 create_task Action — days_before = 0

```
it('create_task with days_before=0 sets task date same as booking date')
```
- Create rule with `days_before: 0`
- Create booking on `2099-08-20`
- Assert: task date = `'2099-08-20'`

#### 3.4 telegram_group Action — Message Sent (Smoke Test)

```
it('telegram_group action does not crash when no Telegram chat configured')
```
- Create rule with action: `{ type: 'telegram_group', template: 'Test: {date} {programName}' }`
- Create matching booking
- Assert: no 500 error on booking creation (fire-and-forget is non-blocking)
- Assert: booking created successfully (status 200)

Note: Full Telegram verification requires a bot token and chat ID, which may not be available in test environments. The test primarily verifies that the automation does not break booking creation.

#### 3.5 Multiple Actions Per Rule

```
it('Rule with multiple actions executes all of them')
```
- Create rule with 2 actions:
  ```json
  [
    { "type": "create_task", "title": "Task 1: {date}", "priority": "high", "category": "purchase" },
    { "type": "create_task", "title": "Task 2: {date}", "priority": "normal", "category": "admin" }
  ]
  ```
- Create matching booking on `2099-08-25`
- Wait, then query tasks for date `2099-08-25` with `type=auto_complete`
- Assert: at least 2 tasks found (one for each action)
- Assert: one has title containing `'Task 1'` with `priority: 'high'`
- Assert: one has title containing `'Task 2'` with `priority: 'normal'`

#### 3.6 Unknown Action Type — Graceful Skip

```
it('Unknown action type is skipped without error')
```
- Create rule with action: `{ type: 'send_email', template: 'test' }` (unknown type)
- Create matching booking
- Assert: booking creation succeeds (status 200)
- Assert: no tasks created for this action

---

### 4. Placeholder Interpolation

Setup: Create a rule with `create_task` action whose title contains specific placeholders.

#### 4.1 Basic Placeholders — {date}, {time}, {room}

```
it('Interpolation replaces {date}, {time}, {room} correctly')
```
- Rule action title: `'Event on {date} at {time} in {room}'`
- Booking: `date: '2099-09-10'`, `time: '14:30'`, `room: 'Marvel'`
- Assert task title: `'Event on 2099-09-10 at 14:30 in Marvel'`

#### 4.2 Program Placeholders — {programName}, {label}

```
it('Interpolation replaces {programName} and {label}')
```
- Rule action title: `'{label} — {programName}'`
- Booking: `programName: 'Піньята'`, `label: 'Пін(15)'`
- Assert task title: `'Пін(15) — Піньята'`

#### 4.3 People Placeholders — {kidsCount}, {groupName}, {createdBy}

```
it('Interpolation replaces {kidsCount}, {groupName}, {createdBy}')
```
- Rule action title: `'{kidsCount} kids in {groupName} by {createdBy}'`
- Booking: `kidsCount: 12`, `groupName: 'Вовчики'`, `createdBy: 'admin'`
- Assert task title: `'12 kids in Вовчики by admin'`

#### 4.4 {pinataFiller} Placeholder

```
it('Interpolation replaces {pinataFiller}')
```
- Rule action title: `'Pinata filler: {pinataFiller}'`
- Booking: `pinataFiller: '5'`
- Assert task title: `'Pinata filler: 5'`

#### 4.5 {notes} Placeholder

```
it('Interpolation replaces {notes}')
```
- Rule action title: `'Notes: {notes}'`
- Booking: `notes: 'Алергія на горіхи'`
- Assert task title: `'Notes: Алергія на горіхи'`

#### 4.6 {tshirtSizes} Placeholder — With Data

```
it('Interpolation replaces {tshirtSizes} from extra_data')
```
- Rule action title: `'Sizes: {tshirtSizes}'`
- Booking: `extraData: { tshirt_sizes: { S: 2, M: 3, L: 0, XL: 1 } }`
- Assert task title: `'Sizes: S×2, M×3, XL×1'` (L filtered out because value = 0)

#### 4.7 {tshirtSizes} Placeholder — Missing Data

```
it('{tshirtSizes} shows "не вказано" when extra_data is null')
```
- Rule action title: `'Sizes: {tshirtSizes}'`
- Booking: no `extraData` field
- Assert task title: `'Sizes: не вказано'`

#### 4.8 {tshirtSizes} Placeholder — Empty Sizes Object

```
it('{tshirtSizes} shows "не вказано" when all sizes are 0')
```
- Booking: `extraData: { tshirt_sizes: { S: 0, M: 0 } }`
- Assert task title contains `'не вказано'`

#### 4.9 {kidsCount} Fallback to '?'

```
it('{kidsCount} falls back to "?" when not provided')
```
- Rule action title: `'Kids: {kidsCount}'`
- Booking: no `kidsCount` field
- Assert task title: `'Kids: ?'`

#### 4.10 Invalid/Nonexistent Placeholders — Left As-Is

```
it('Non-existent placeholder like {unknownField} is left as literal text')
```
- Rule action title: `'Ref: {unknownField}'`
- Booking: standard fields
- Assert task title: `'Ref: {unknownField}'` (not replaced)

#### 4.11 Multiple Same Placeholders

```
it('Multiple occurrences of same placeholder are all replaced')
```
- Rule action title: `'{date} — {date} — {date}'`
- Booking: `date: '2099-09-10'`
- Assert task title: `'2099-09-10 — 2099-09-10 — 2099-09-10'`

#### 4.12 Empty Template

```
it('Empty template returns empty string')
```
- Rule action title: `''`
- Booking: any
- Assert task title: `''`

#### 4.13 Null Template

```
it('Null template returns empty string')
```
- This is a unit-level assertion: `interpolate(null, booking)` returns `''`
- At integration level: create rule with null title — task title should be empty

---

### 5. Integration Tests (End-to-End)

#### 5.1 Create Booking Triggers Automation and Task Is Created

```
it('E2E: POST /api/bookings with matching product → auto-task appears in GET /api/tasks')
```
- Setup:
  1. Create line for `2099-10-01`
  2. Create automation rule: product_ids `['pinata']`, trigger: `booking_create`, action: `create_task` with title `'E2E-MARKER: order pinata for {date}'`, days_before: 2
- Execute:
  1. `POST /api/bookings` with `programId: 'pinata'`, date `2099-10-01`, time `'11:00'`, room `'Marvel'`
  2. Wait 1000ms (async fire-and-forget)
- Verify:
  1. `GET /api/tasks?type=auto_complete` — find task with title matching `'E2E-MARKER: order pinata for 2099-10-01'`
  2. Assert task `date === '2099-09-29'` (2 days before Oct 1)
  3. Assert task `status === 'todo'`
- Cleanup: delete rule, booking, task

#### 5.2 Create Booking via /full Endpoint Triggers Automation

```
it('E2E: POST /api/bookings/full triggers automation for main booking')
```
- Create rule matching `product_ids: ['mk_tshirt']`, action: `create_task` with title `'Full-E2E: {programName}'`
- `POST /api/bookings/full` with main booking: `programId: 'mk_tshirt'`
- Wait, verify auto-task exists

#### 5.3 Confirm Booking (preliminary -> confirmed) Triggers booking_confirm Rule

```
it('E2E: status change preliminary→confirmed triggers booking_confirm rules')
```
- Setup:
  1. Create rule: `trigger_type: 'booking_confirm'`, product_ids: `['mk_tshirt']`, action: `create_task` with title `'CONFIRM-E2E: order {kidsCount} shirts'`
  2. Create rule: `trigger_type: 'booking_create'`, product_ids: `['mk_tshirt']`, action: `create_task` with title `'CREATE-E2E: clarify sizes'`
- Execute:
  1. `POST /api/bookings` with `programId: 'mk_tshirt'`, `status: 'preliminary'`
  2. Wait 500ms — booking_create rule should fire but NOT booking_confirm
  3. Verify: task with `'CREATE-E2E'` exists, task with `'CONFIRM-E2E'` does NOT exist
  4. `PUT /api/bookings/:id` changing `status: 'confirmed'`
  5. Wait 500ms — now booking_confirm rule should fire
  6. Verify: task with `'CONFIRM-E2E'` now exists

Note: The `PUT` handler only triggers automation when `oldBooking.status === 'preliminary'` AND `newStatus === 'confirmed'`, so other status changes (e.g., confirmed -> preliminary) do NOT trigger automation.

#### 5.4 Disabled Rule Does Not Fire

```
it('E2E: disabled rule (is_active=false) does not create tasks')
```
- Create rule with `is_active: true`, unique title marker
- Disable it: `PUT /api/automation-rules/:id` with `is_active: false`
- Create matching booking
- Wait 500ms
- Assert: no task with the unique title marker exists
- Re-enable rule for cleanup or delete

#### 5.5 Linked Booking Does NOT Trigger Automation

```
it('E2E: linked booking (linkedTo set) does not trigger automation')
```
- Create rule matching the booking's product
- `POST /api/bookings` with `linkedTo: 'BK-2099-0001'` (any parent ID)
- Wait 500ms
- Assert: no auto-task created
- Note: `routes/bookings.js` line 96 explicitly checks `if (!b.linkedTo)` before calling `processBookingAutomation`

#### 5.6 Automation Error Does NOT Break Booking Creation

```
it('E2E: automation error is non-blocking — booking still created')
```
- Create a rule with action that has malformed data (e.g., invalid type)
- Create matching booking
- Assert: booking creation returns status 200 with `success: true`
- Assert: booking appears in `GET /api/bookings/:date`

#### 5.7 History Entry Logged on Automation Trigger

```
it('E2E: automation trigger creates history entry with action=automation_triggered')
```
- Create rule matching a product, create matching booking
- Wait 500ms
- `GET /api/history?action=automation_triggered`
- Assert: find entry with `data.rule_name` matching the rule name and `data.booking_id` matching the booking ID

#### 5.8 Multiple Rules Match Same Booking

```
it('E2E: multiple matching rules all fire independently')
```
- Create Rule A: product_ids `['kv1']`, action: `create_task` title `'RuleA: {date}'`
- Create Rule B: categories `['quest']`, action: `create_task` title `'RuleB: {date}'`
- Create booking: `programId: 'kv1'`, `category: 'quest'`
- Wait 500ms
- Assert: both tasks exist (RuleA matches by product_id, RuleB matches by category)

---

### 6. calculateTaskDate Tests

These can be validated via integration (create rule with various `days_before`, verify task dates).

#### 6.1 days_before > 0

```
it('Task date is booking date minus days_before')
```
- Rule: `days_before: 5`, booking date: `2099-08-20`
- Assert: task date = `2099-08-15`

#### 6.2 days_before = 0

```
it('Task date equals booking date when days_before=0')
```
- Rule: `days_before: 0`, booking date: `2099-08-20`
- Assert: task date = `2099-08-20`

#### 6.3 days_before Crosses Month Boundary

```
it('days_before crossing month boundary calculates correctly')
```
- Rule: `days_before: 5`, booking date: `2099-03-03`
- Assert: task date = `2099-02-26`

#### 6.4 days_before Crosses Year Boundary

```
it('days_before crossing year boundary calculates correctly')
```
- Rule: `days_before: 3`, booking date: `2099-01-02`
- Assert: task date = `2098-12-30`

#### 6.5 Negative or Null days_before

```
it('Null days_before returns booking date as-is')
```
- Rule: `days_before: null` (or 0), booking date: `2099-08-20`
- Assert: task date = `2099-08-20`

---

## Edge Cases & Cross-Dependencies

### Edge Cases

| # | Scenario | Expected Behavior |
|---|---|---|
| E1 | Rule has `actions: []` (empty array) | Rule matches but no actions execute; no error |
| E2 | Rule has `actions: null` (not array) | `Array.isArray(null)` returns false, treated as `[]`; no actions |
| E3 | Booking has no `date` field | `processBookingAutomation` returns early (line 136: `if (!booking || !booking.date) return`) |
| E4 | Booking passed as `null` | Returns early, no error |
| E5 | Database down during automation | Caught by try/catch in `processBookingAutomation`; error logged, booking still committed |
| E6 | `trigger_condition` is `null` | `matchesCondition` returns `false` (line 70: `if (!condition) return false`) |
| E7 | Rule has `trigger_type` not matching event | Skipped by event filter (lines 146-147) |
| E8 | Two rules with same product_id — both fire | Each rule evaluated independently in loop |
| E9 | Concurrent booking creation — race conditions | Each call fetches rules independently; tasks may overlap but no data corruption |
| E10 | Very long template string (>1000 chars) | No explicit limit; task title column is VARCHAR(200), may truncate at DB level |
| E11 | Placeholder inside placeholder: `{da{time}te}` | Not replaced — regex only matches exact `{date}`, `{time}`, etc. |
| E12 | XSS in placeholder values (e.g., `groupName: '<script>alert(1)</script>'`) | Stored as-is in task title; Telegram action uses HTML parse_mode — could be an issue for telegram_group action |
| E13 | Unicode in placeholder values (e.g., emoji in groupName) | Should work correctly, JavaScript strings are UTF-16 |

### Cross-Dependencies

| Dependency | Impact | Test Consideration |
|---|---|---|
| **Tasks API** (`routes/tasks.js`) | Auto-created tasks must be queryable via `GET /api/tasks` with filters `type=auto_complete` | Verify auto tasks appear in standard task listing and filtering |
| **Booking API** (`routes/bookings.js`) | Automation is called after `COMMIT`; booking ID must exist | Verify `booking.id` is available when automation runs |
| **Telegram Service** (`services/telegram.js`) | `telegram_group` action depends on `getConfiguredChatId()` | Test environment may not have Telegram configured; ensure graceful degradation |
| **History API** (`routes/history.js`) | Automation logs `automation_triggered` entries | Verify history entries are created with correct rule/booking references |
| **Settings API** (`routes/settings.js`) | Rules CRUD shares the settings router; auth middleware applies | Verify rules endpoints require auth just like settings |
| **Products Catalog** (`db/index.js` seed) | `product_ids` in rules reference product IDs from the catalog | Test with real product IDs from seed data (`pinata`, `mk_tshirt`, `kv1`, etc.) |
| **mapBookingRow** (`services/booking.js`) | The confirm flow uses `mapBookingRow` then spreads with `_event: 'confirm'` | Verify camelCase field names work in interpolation (engine supports both snake_case and camelCase) |
| **Booking extraData** | T-shirt sizes come from `booking.extraData` or `booking.extra_data` | Test both camelCase (from API body) and snake_case (from DB row) paths |
| **Fire-and-forget timing** | Tests must account for async delay between booking creation and task creation | Use `setTimeout`/`await sleep(500-1000ms)` before asserting auto-created tasks |

### Cleanup Strategy

All test data should be cleaned up in `after()` hooks:
- Automation rules: `DELETE /api/automation-rules/:id`
- Bookings: `DELETE /api/bookings/:id?permanent=true`
- Tasks: `DELETE /api/tasks/:id` (query for `type=auto_complete` tasks with test markers)
- Lines: No explicit cleanup needed (use unique date like `2099-10-*`)

### Test Isolation

- Use unique date ranges per describe block (e.g., `2099-07-*` for trigger tests, `2099-08-*` for action tests, `2099-10-*` for E2E)
- Use unique title markers (e.g., `'SMOKE-AUTO-001'`) to distinguish auto-created tasks from other test artifacts
- Delete test rules BEFORE creating new ones to avoid accumulation across test runs

### Estimated Test Count

| Section | Count |
|---|---|
| Rules CRUD | 11 |
| Trigger Conditions | 7 |
| Actions | 6 |
| Placeholder Interpolation | 13 |
| Integration (E2E) | 8 |
| calculateTaskDate | 5 |
| **Total** | **50** |
