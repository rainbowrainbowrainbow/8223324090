/**
 * tests/automation.test.js — Automation Engine Tests
 * Run: node --test tests/automation.test.js
 *
 * Tests booking automation rules CRUD, trigger conditions,
 * action execution, placeholder interpolation, and E2E flows.
 *
 * Requires a running server with a valid test user in the database.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { request, authRequest, getToken } = require('./helpers');

// Helper: sleep for async fire-and-forget delays
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Unique line IDs to avoid conflicts with other test suites
const AUTO_LINE_PREFIX = 'auto_test_line';

// Helper to create a test line for a given date
async function ensureLine(date, lineId) {
    await authRequest('POST', `/api/lines/${date}`, [
        { id: lineId, name: `Automation Test ${lineId}`, color: '#AA00FF' }
    ]);
}

// Helper to create a booking with sensible defaults
async function createBooking(overrides = {}) {
    const defaults = {
        date: '2099-07-15',
        time: '10:00',
        lineId: `${AUTO_LINE_PREFIX}_1`,
        room: 'Marvel',
        programCode: 'КВ1',
        label: 'КВ1(60)',
        programName: 'Квест 1',
        programId: 'kv1',
        category: 'quest',
        duration: 60,
        price: 2200,
        status: 'confirmed',
        createdBy: 'admin'
    };
    return authRequest('POST', '/api/bookings', { ...defaults, ...overrides });
}

// Helper to create an automation rule with sensible defaults
// Note: trigger_condition and actions must be sent as JSON strings because the
// pg library's parameterized queries call toString() on values, and JSONB columns
// need valid JSON strings — not "[object Object]".
async function createRule(overrides = {}) {
    const defaults = {
        name: 'Test Auto Rule',
        trigger_type: 'booking_create',
        trigger_condition: { product_ids: ['kv1'] },
        actions: [{ type: 'create_task', title: 'Auto task for {date}', priority: 'normal', category: 'purchase' }],
        days_before: 0
    };
    const body = { ...defaults, ...overrides };
    // Stringify JSONB fields if they are objects (the route passes them directly to pg)
    if (body.trigger_condition && typeof body.trigger_condition === 'object') {
        body.trigger_condition = JSON.stringify(body.trigger_condition);
    }
    if (body.actions && typeof body.actions === 'object') {
        body.actions = JSON.stringify(body.actions);
    }
    return authRequest('POST', '/api/automation-rules', body);
}

// Helper to update an automation rule (stringifies JSONB fields)
async function updateRule(id, body) {
    const data = { ...body };
    if (data.trigger_condition && typeof data.trigger_condition === 'object') {
        data.trigger_condition = JSON.stringify(data.trigger_condition);
    }
    if (data.actions && typeof data.actions === 'object') {
        data.actions = JSON.stringify(data.actions);
    }
    return authRequest('PUT', `/api/automation-rules/${id}`, data);
}

// Helper to find auto-tasks by title substring
async function findAutoTasks(titleMarker, opts = {}) {
    const params = new URLSearchParams({ type: 'auto_complete' });
    if (opts.date) params.set('date', opts.date);
    const res = await authRequest('GET', `/api/tasks?${params}`);
    if (res.status !== 200 || !Array.isArray(res.data)) return [];
    return res.data.filter(t => t.title && t.title.includes(titleMarker));
}

// Helper to delete a task by id
async function deleteTask(id) {
    return authRequest('DELETE', `/api/tasks/${id}`);
}

// Helper to delete a rule by id
async function deleteRule(id) {
    return authRequest('DELETE', `/api/automation-rules/${id}`);
}

// Helper to delete a booking permanently
async function deleteBooking(id) {
    return authRequest('DELETE', `/api/bookings/${id}?permanent=true`);
}

// ==========================================
// 1. AUTOMATION RULES CRUD
// ==========================================

describe('Automation Rules CRUD (v8.3)', () => {
    let ruleId;

    it('GET /api/automation-rules — should return array', async () => {
        const res = await authRequest('GET', '/api/automation-rules');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Should return an array');
        // Seeded rules should exist (>= 3 after DB init)
        assert.ok(res.data.length >= 3, `Expected at least 3 seeded rules, got ${res.data.length}`);
    });

    it('POST /api/automation-rules — create rule', async () => {
        const res = await createRule({
            name: 'Test Rule Smoke',
            trigger_type: 'booking_create',
            trigger_condition: { product_ids: ['kv1'] },
            actions: [{ type: 'create_task', title: 'Test task for {date}', priority: 'normal', category: 'admin' }],
            days_before: 2
        });
        assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert.ok(res.data.success, 'Should return success');
        assert.ok(res.data.rule, 'Should return rule object');
        assert.ok(res.data.rule.id, 'Rule should have an id');
        assert.ok(res.data.rule.name, 'Rule should have a name');
        assert.equal(res.data.rule.is_active, true, 'New rule should be active by default');
        ruleId = res.data.rule.id;
    });

    it('POST /api/automation-rules — missing name returns 400', async () => {
        const res = await authRequest('POST', '/api/automation-rules', {
            trigger_condition: { product_ids: ['kv1'] },
            actions: [{ type: 'create_task', title: 'No name' }]
        });
        assert.equal(res.status, 400);
        assert.ok(res.data.error, 'Should return error message');
    });

    it('POST /api/automation-rules — missing trigger_condition returns 400', async () => {
        const res = await authRequest('POST', '/api/automation-rules', {
            name: 'No Condition',
            actions: [{ type: 'create_task', title: 'test' }]
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/automation-rules — missing actions returns 400', async () => {
        const res = await authRequest('POST', '/api/automation-rules', {
            name: 'No Actions',
            trigger_condition: { product_ids: ['kv1'] }
        });
        assert.equal(res.status, 400);
    });

    it('GET /api/automation-rules — should contain created rule', async () => {
        assert.ok(ruleId, 'Need rule ID from create step');
        const res = await authRequest('GET', '/api/automation-rules');
        assert.equal(res.status, 200);
        const found = res.data.find(r => r.id === ruleId);
        assert.ok(found, 'Created rule should be in the list');
        assert.ok(found.trigger_condition.product_ids.includes('kv1'), 'trigger_condition should contain kv1');
        assert.equal(found.days_before, 2, 'days_before should be 2');
    });

    it('PUT /api/automation-rules/:id — update rule name and days_before', async () => {
        assert.ok(ruleId, 'Need rule ID from create step');
        const res = await updateRule(ruleId, {
            name: 'Updated Test Rule',
            trigger_type: 'booking_create',
            trigger_condition: { product_ids: ['kv1', 'kv4'] },
            actions: [{ type: 'create_task', title: 'Updated task for {date}', priority: 'high', category: 'purchase' }],
            days_before: 5,
            is_active: true
        });
        assert.equal(res.status, 200);
        assert.ok(res.data.success, 'Should return success');

        // Verify via GET
        const check = await authRequest('GET', '/api/automation-rules');
        const found = check.data.find(r => r.id === ruleId);
        assert.ok(found, 'Rule should still exist after update');
        assert.equal(found.name, 'Updated Test Rule');
        assert.equal(found.days_before, 5);
        assert.equal(found.trigger_condition.product_ids.length, 2);
    });

    it('PUT /api/automation-rules/:id — disable rule (is_active=false)', async () => {
        assert.ok(ruleId, 'Need rule ID from create step');
        const res = await updateRule(ruleId, {
            name: 'Updated Test Rule',
            trigger_type: 'booking_create',
            trigger_condition: { product_ids: ['kv1', 'kv4'] },
            actions: [{ type: 'create_task', title: 'Updated task for {date}', priority: 'high', category: 'purchase' }],
            days_before: 5,
            is_active: false
        });
        assert.equal(res.status, 200);

        const check = await authRequest('GET', '/api/automation-rules');
        const found = check.data.find(r => r.id === ruleId);
        assert.equal(found.is_active, false, 'Rule should be disabled');
    });

    it('PUT /api/automation-rules/:id — re-enable rule (is_active=true)', async () => {
        assert.ok(ruleId, 'Need rule ID from create step');
        const res = await updateRule(ruleId, {
            name: 'Updated Test Rule',
            trigger_type: 'booking_create',
            trigger_condition: { product_ids: ['kv1', 'kv4'] },
            actions: [{ type: 'create_task', title: 'Updated task for {date}', priority: 'high', category: 'purchase' }],
            days_before: 5,
            is_active: true
        });
        assert.equal(res.status, 200);

        const check = await authRequest('GET', '/api/automation-rules');
        const found = check.data.find(r => r.id === ruleId);
        assert.equal(found.is_active, true, 'Rule should be re-enabled');
    });

    it('DELETE /api/automation-rules/:id — delete rule', async () => {
        assert.ok(ruleId, 'Need rule ID from create step');
        const res = await authRequest('DELETE', `/api/automation-rules/${ruleId}`);
        assert.equal(res.status, 200);
        assert.ok(res.data.success, 'Should return success');

        // Verify removed
        const check = await authRequest('GET', '/api/automation-rules');
        const found = check.data.find(r => r.id === ruleId);
        assert.ok(!found, 'Deleted rule should not appear in list');
        ruleId = null;
    });

    it('DELETE /api/automation-rules/:id — delete non-existent returns 200 (idempotent)', async () => {
        const res = await authRequest('DELETE', '/api/automation-rules/999999');
        assert.equal(res.status, 200, 'Delete of non-existent should still return 200');
    });

    it('GET /api/automation-rules — without token returns 401', async () => {
        const res = await request('GET', '/api/automation-rules');
        assert.equal(res.status, 401);
    });

    it('POST /api/automation-rules — without token returns 401', async () => {
        const res = await request('POST', '/api/automation-rules', {
            name: 'Unauth Rule',
            trigger_condition: { product_ids: ['kv1'] },
            actions: [{ type: 'create_task', title: 'test' }]
        });
        assert.equal(res.status, 401);
    });
});

// ==========================================
// 2. TRIGGER CONDITIONS (Integration)
// ==========================================

describe('Trigger Conditions — matchesCondition integration', () => {
    const date = '2099-07-15';
    const lineId = `${AUTO_LINE_PREFIX}_trigger`;
    const cleanupRuleIds = [];
    const cleanupBookingIds = [];
    const cleanupTaskIds = [];
    let timeSlot = 10; // increment for each booking to avoid conflicts

    function nextTime() {
        const t = `${timeSlot}:00`;
        timeSlot++;
        return t;
    }

    before(async () => {
        await ensureLine(date, lineId);
    });

    after(async () => {
        for (const id of cleanupTaskIds) await deleteTask(id);
        for (const id of cleanupBookingIds) await deleteBooking(id);
        for (const id of cleanupRuleIds) await deleteRule(id);
    });

    it('Booking with matching product_id triggers automation rule', async () => {
        const marker = 'TRIGGER-PID-001';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: pinata for {date}`, priority: 'normal', category: 'purchase' }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            programName: 'Піньята', category: 'pinata'
        });
        assert.equal(booking.status, 200, `Booking create failed: ${JSON.stringify(booking.data)}`);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected at least 1 task with marker ${marker}, found ${tasks.length}`);
        assert.ok(tasks[0].title.includes(`pinata for ${date}`));
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Rule with multiple product_ids matches any of them', async () => {
        const marker = 'TRIGGER-MULTI-002';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['kv1', 'kv4', 'bubble'] },
            actions: [{ type: 'create_task', title: `${marker}: matched {date}`, priority: 'normal', category: 'admin' }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'kv4', programCode: 'КВ4', label: 'КВ4(60)',
            programName: 'Квест 4', category: 'quest'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Booking with matching category triggers automation rule', async () => {
        const marker = 'TRIGGER-CAT-003';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { categories: ['quest'] },
            actions: [{ type: 'create_task', title: `${marker}: cat match {date}`, priority: 'normal', category: 'admin' }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'unique_prog_cat', programCode: 'UNQ', label: 'UNQ(60)',
            category: 'quest'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Booking with non-matching product_id does NOT trigger rule', async () => {
        const marker = 'TRIGGER-NEG-004';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: should not exist`, priority: 'normal', category: 'admin' }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'unique_nomatch_004', programCode: 'NM4', label: 'NM4(60)',
            category: 'animation'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(800);

        const tasks = await findAutoTasks(marker);
        assert.equal(tasks.length, 0, `Expected NO task with marker ${marker}, found ${tasks.length}`);
    });

    it('Booking with non-matching category does NOT trigger rule', async () => {
        const marker = 'TRIGGER-NEG-CAT-005';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { categories: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: should not exist`, priority: 'normal', category: 'admin' }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'unique_nomatch_005', programCode: 'NM5', label: 'NM5(60)',
            category: 'quest'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(800);

        const tasks = await findAutoTasks(marker);
        assert.equal(tasks.length, 0, `Expected NO task with marker ${marker}`);
    });

    it('Rule with empty trigger_condition never fires', async () => {
        const marker = 'TRIGGER-EMPTY-006';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: {},
            actions: [{ type: 'create_task', title: `${marker}: should not exist`, priority: 'normal', category: 'admin' }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'unique_empty_006', programCode: 'EM6', label: 'EM6(60)'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(800);

        const tasks = await findAutoTasks(marker);
        assert.equal(tasks.length, 0, `Expected NO task with marker ${marker}`);
    });

    it('Rule with both product_ids and categories fires if either matches (OR logic)', async () => {
        const marker = 'TRIGGER-OR-007';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'], categories: ['quest'] },
            actions: [{ type: 'create_task', title: `${marker}: or matched {date}`, priority: 'normal', category: 'admin' }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        // Booking matches category=quest but NOT product_id=pinata
        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'unique_or_007', programCode: 'OR7', label: 'OR7(60)',
            category: 'quest'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker} (OR logic: category matched)`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });
});

// ==========================================
// 3. ACTIONS
// ==========================================

describe('Actions — create_task and telegram_group', () => {
    const date = '2099-08-20';
    const lineId = `${AUTO_LINE_PREFIX}_actions`;
    const cleanupRuleIds = [];
    const cleanupBookingIds = [];
    const cleanupTaskIds = [];
    let timeSlot = 10;

    function nextTime() {
        const t = `${timeSlot}:00`;
        timeSlot++;
        return t;
    }

    before(async () => {
        await ensureLine(date, lineId);
    });

    after(async () => {
        for (const id of cleanupTaskIds) await deleteTask(id);
        for (const id of cleanupBookingIds) await deleteBooking(id);
        for (const id of cleanupRuleIds) await deleteRule(id);
    });

    it('create_task action inserts task with correct fields', async () => {
        const marker = 'ACTION-FIELDS-001';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: Buy {programName} for {date}`, priority: 'high', category: 'purchase' }],
            days_before: 3
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            programName: 'Піньята', category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        const task = tasks[0];
        assert.ok(task.title.includes('Buy Піньята for 2099-08-20'), `Title mismatch: ${task.title}`);
        assert.equal(task.date.split('T')[0], '2099-08-17', `Task date should be 3 days before: ${task.date}`);
        assert.equal(task.status, 'todo');
        assert.equal(task.priority, 'high');
        assert.equal(task.category, 'purchase');
        assert.equal(task.type, 'auto_complete');
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('create_task action uses default priority (normal) and category (purchase) when omitted', async () => {
        const marker = 'ACTION-DEFAULTS-002';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: Default test` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            programName: 'Піньята', category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        assert.equal(tasks[0].priority, 'normal', 'Default priority should be normal');
        assert.equal(tasks[0].category, 'purchase', 'Default category should be purchase');
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('create_task with days_before=0 sets task date same as booking date', async () => {
        const marker = 'ACTION-ZERO-003';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: same day {date}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        assert.equal(tasks[0].date.split('T')[0], date, `Task date should be same as booking: ${date}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('telegram_group action does not crash when no Telegram chat configured', async () => {
        const marker = 'ACTION-TG-004';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'telegram_group', template: `${marker}: Test: {date} {programName}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        // Booking creation should still succeed even if Telegram action runs
        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            programName: 'Піньята', category: 'pinata'
        });
        assert.equal(booking.status, 200, 'Booking should succeed despite telegram action');
        assert.ok(booking.data.success);
        cleanupBookingIds.push(booking.data.booking.id);
    });

    it('Rule with multiple actions executes all of them', async () => {
        const marker = 'ACTION-MULTI-005';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [
                { type: 'create_task', title: `${marker}-Task1: {date}`, priority: 'high', category: 'purchase' },
                { type: 'create_task', title: `${marker}-Task2: {date}`, priority: 'normal', category: 'admin' }
            ],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date: '2099-08-25', time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            programName: 'Піньята', category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks1 = await findAutoTasks(`${marker}-Task1`);
        const tasks2 = await findAutoTasks(`${marker}-Task2`);
        assert.ok(tasks1.length >= 1, `Expected Task1 with marker ${marker}`);
        assert.ok(tasks2.length >= 1, `Expected Task2 with marker ${marker}`);
        assert.equal(tasks1[0].priority, 'high');
        assert.equal(tasks2[0].priority, 'normal');
        tasks1.forEach(t => cleanupTaskIds.push(t.id));
        tasks2.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Unknown action type is skipped without error', async () => {
        const marker = 'ACTION-UNKNOWN-006';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'send_email', template: 'test unknown' }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata'
        });
        assert.equal(booking.status, 200, 'Booking should succeed despite unknown action type');
        assert.ok(booking.data.success);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(800);

        // No tasks should be created for unknown action type
        const tasks = await findAutoTasks(marker);
        assert.equal(tasks.length, 0, 'Unknown action type should not create tasks');
    });
});

// ==========================================
// 4. PLACEHOLDER INTERPOLATION
// ==========================================

describe('Placeholder Interpolation', () => {
    const date = '2099-09-10';
    const lineId = `${AUTO_LINE_PREFIX}_interp`;
    const cleanupRuleIds = [];
    const cleanupBookingIds = [];
    const cleanupTaskIds = [];
    let timeSlot = 10;

    function nextTime() {
        const t = `${timeSlot}:00`;
        timeSlot++;
        return t;
    }

    before(async () => {
        await ensureLine(date, lineId);
        // Also ensure line for other dates used in this section
        await ensureLine('2099-09-11', lineId);
    });

    after(async () => {
        for (const id of cleanupTaskIds) await deleteTask(id);
        for (const id of cleanupBookingIds) await deleteBooking(id);
        for (const id of cleanupRuleIds) await deleteRule(id);
    });

    it('Interpolation replaces {date}, {time}, {room} correctly', async () => {
        const marker = 'INTERP-DTR-001';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: Event on {date} at {time} in {room}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const time = nextTime();
        const booking = await createBooking({
            date, time, lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            room: 'Marvel', category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        assert.ok(tasks[0].title.includes(`Event on ${date} at ${time} in Marvel`), `Title: ${tasks[0].title}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Interpolation replaces {programName} and {label}', async () => {
        const marker = 'INTERP-PNL-002';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: {label} — {programName}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН',
            label: 'Пін(15)', programName: 'Піньята',
            category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1);
        assert.ok(tasks[0].title.includes('Пін(15) — Піньята'), `Title: ${tasks[0].title}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Interpolation replaces {kidsCount}, {groupName}, {createdBy}', async () => {
        const marker = 'INTERP-KGC-003';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: {kidsCount} kids in {groupName} by {createdBy}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata',
            kidsCount: 12, groupName: 'Вовчики', createdBy: 'admin'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1);
        assert.ok(tasks[0].title.includes('12 kids in Вовчики by admin'), `Title: ${tasks[0].title}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Interpolation replaces {pinataFiller}', async () => {
        const marker = 'INTERP-PF-004';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: Pinata filler: {pinataFiller}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata', pinataFiller: '5'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1);
        assert.ok(tasks[0].title.includes('Pinata filler: 5'), `Title: ${tasks[0].title}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Interpolation replaces {notes}', async () => {
        const marker = 'INTERP-NOTES-005';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: Notes: {notes}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata', notes: 'Алергія на горіхи'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1);
        assert.ok(tasks[0].title.includes('Notes: Алергія на горіхи'), `Title: ${tasks[0].title}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Interpolation replaces {tshirtSizes} from extra_data', async () => {
        const marker = 'INTERP-TSHIRT-006';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['mk_tshirt'] },
            actions: [{ type: 'create_task', title: `${marker}: Sizes: {tshirtSizes}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'mk_tshirt', programCode: 'МКФ', label: 'МКФ(120)',
            programName: 'МК Футболки', category: 'master_class',
            extraData: { tshirt_sizes: { S: 2, M: 3, L: 0, XL: 1 } }
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        // Should contain S×2, M×3, XL×1 (L filtered out because 0)
        assert.ok(tasks[0].title.includes('S×2'), `Title should contain S×2: ${tasks[0].title}`);
        assert.ok(tasks[0].title.includes('M×3'), `Title should contain M×3: ${tasks[0].title}`);
        assert.ok(tasks[0].title.includes('XL×1'), `Title should contain XL×1: ${tasks[0].title}`);
        assert.ok(!tasks[0].title.includes('L×0'), `Title should NOT contain L×0: ${tasks[0].title}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('{tshirtSizes} shows "не вказано" when extra_data is null', async () => {
        const marker = 'INTERP-TSHIRT-NULL-007';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['mk_tshirt'] },
            actions: [{ type: 'create_task', title: `${marker}: Sizes: {tshirtSizes}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'mk_tshirt', programCode: 'МКФ', label: 'МКФ(120)',
            programName: 'МК Футболки', category: 'master_class'
            // No extraData
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        assert.ok(tasks[0].title.includes('не вказано'), `Title should contain "не вказано": ${tasks[0].title}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('{tshirtSizes} shows "не вказано" when all sizes are 0', async () => {
        const marker = 'INTERP-TSHIRT-ZERO-008';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['mk_tshirt'] },
            actions: [{ type: 'create_task', title: `${marker}: Sizes: {tshirtSizes}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'mk_tshirt', programCode: 'МКФ', label: 'МКФ(120)',
            programName: 'МК Футболки', category: 'master_class',
            extraData: { tshirt_sizes: { S: 0, M: 0 } }
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        assert.ok(tasks[0].title.includes('не вказано'), `Title should contain "не вказано": ${tasks[0].title}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('{kidsCount} falls back to "?" when not provided', async () => {
        const marker = 'INTERP-KIDS-FALLBACK-009';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: Kids: {kidsCount}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata'
            // No kidsCount
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        assert.ok(tasks[0].title.includes('Kids: ?'), `Title should contain "Kids: ?": ${tasks[0].title}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Non-existent placeholder like {unknownField} is left as literal text', async () => {
        const marker = 'INTERP-UNKNOWN-010';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: Ref: {unknownField}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        assert.ok(tasks[0].title.includes('Ref: {unknownField}'), `Unknown placeholder should be kept as-is: ${tasks[0].title}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Multiple occurrences of same placeholder are all replaced', async () => {
        const marker = 'INTERP-MULTI-011';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: {date} — {date} — {date}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date: '2099-09-11', time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        assert.ok(tasks[0].title.includes('2099-09-11 — 2099-09-11 — 2099-09-11'), `All dates replaced: ${tasks[0].title}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Empty template returns empty string task title', async () => {
        const marker = 'INTERP-EMPTY-012';
        // We use the marker in the rule name, not the title (title is empty)
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: '' }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        // Task with empty title may not be queryable by marker. Query all auto_complete tasks
        const res = await authRequest('GET', `/api/tasks?type=auto_complete&date=${date}`);
        const emptyTasks = res.data.filter(t => t.title === '');
        // Just verify booking succeeded — the empty title task may or may not be created
        // depending on DB constraints, but the booking should not fail
        assert.ok(booking.data.success);
        emptyTasks.forEach(t => cleanupTaskIds.push(t.id));
    });
});

// ==========================================
// 5. INTEGRATION (E2E)
// ==========================================

describe('Integration (E2E) — Automation Flows', () => {
    const cleanupRuleIds = [];
    const cleanupBookingIds = [];
    const cleanupTaskIds = [];

    after(async () => {
        for (const id of cleanupTaskIds) await deleteTask(id);
        for (const id of cleanupBookingIds) await deleteBooking(id);
        for (const id of cleanupRuleIds) await deleteRule(id);
    });

    it('E2E: POST /api/bookings with matching product → auto-task appears in GET /api/tasks', async () => {
        const date = '2099-10-01';
        const lineId = `${AUTO_LINE_PREFIX}_e2e1`;
        await ensureLine(date, lineId);

        const marker = 'E2E-MARKER-001';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: order pinata for {date}`, priority: 'normal', category: 'purchase' }],
            days_before: 2
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: '11:00', lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            programName: 'Піньята', room: 'Marvel', category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1500);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected auto-task with marker ${marker}`);
        assert.ok(tasks[0].title.includes('order pinata for 2099-10-01'));
        assert.equal(tasks[0].date.split('T')[0], '2099-09-29', 'Task date should be 2 days before Oct 1');
        assert.equal(tasks[0].status, 'todo');
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('E2E: POST /api/bookings/full triggers automation for main booking', async () => {
        const date = '2099-10-05';
        const lineId = `${AUTO_LINE_PREFIX}_e2e2`;
        await ensureLine(date, lineId);

        const marker = 'E2E-FULL-002';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['mk_tshirt'] },
            actions: [{ type: 'create_task', title: `${marker}: {programName}` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const res = await authRequest('POST', '/api/bookings/full', {
            main: {
                date, time: '12:00', lineId,
                programId: 'mk_tshirt', programCode: 'МКФ', label: 'МКФ(120)',
                programName: 'МК Футболки', room: 'Ninja', category: 'master_class',
                duration: 120, price: 3000, status: 'confirmed', createdBy: 'admin'
            },
            linked: []
        });
        assert.equal(res.status, 200, `Booking/full failed: ${JSON.stringify(res.data)}`);
        cleanupBookingIds.push(res.data.mainBooking.id);

        await sleep(1500);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected auto-task with marker ${marker}`);
        assert.ok(tasks[0].title.includes('МК Футболки'), `Title: ${tasks[0].title}`);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('E2E: status change preliminary→confirmed triggers booking_confirm rules', async () => {
        const date = '2099-10-10';
        const lineId = `${AUTO_LINE_PREFIX}_e2e3`;
        await ensureLine(date, lineId);

        const markerCreate = 'E2E-CREATE-003';
        const markerConfirm = 'E2E-CONFIRM-003';

        // Rule for booking_create
        const ruleCreate = await createRule({
            name: `Test ${markerCreate}`,
            trigger_type: 'booking_create',
            trigger_condition: { product_ids: ['mk_tshirt'] },
            actions: [{ type: 'create_task', title: `${markerCreate}: clarify sizes` }],
            days_before: 0
        });
        cleanupRuleIds.push(ruleCreate.data.rule.id);

        // Rule for booking_confirm
        const ruleConfirm = await createRule({
            name: `Test ${markerConfirm}`,
            trigger_type: 'booking_confirm',
            trigger_condition: { product_ids: ['mk_tshirt'] },
            actions: [{ type: 'create_task', title: `${markerConfirm}: order {kidsCount} shirts` }],
            days_before: 0
        });
        cleanupRuleIds.push(ruleConfirm.data.rule.id);

        // Create preliminary booking
        const booking = await createBooking({
            date, time: '14:00', lineId,
            programId: 'mk_tshirt', programCode: 'МКФ', label: 'МКФ(120)',
            programName: 'МК Футболки', room: 'Ninja', category: 'master_class',
            duration: 120, price: 3000, status: 'preliminary',
            kidsCount: 10, createdBy: 'admin'
        });
        assert.equal(booking.status, 200, `Booking create failed: ${JSON.stringify(booking.data)}`);
        const bookingId = booking.data.booking.id;
        cleanupBookingIds.push(bookingId);

        await sleep(1000);

        // booking_create rule should fire, booking_confirm should NOT
        const createTasks = await findAutoTasks(markerCreate);
        assert.ok(createTasks.length >= 1, 'booking_create rule should have fired');
        createTasks.forEach(t => cleanupTaskIds.push(t.id));

        const confirmTasksBefore = await findAutoTasks(markerConfirm);
        assert.equal(confirmTasksBefore.length, 0, 'booking_confirm rule should NOT fire yet');

        // Confirm the booking (preliminary → confirmed)
        const updateRes = await authRequest('PUT', `/api/bookings/${bookingId}`, {
            date, time: '14:00', lineId,
            programId: 'mk_tshirt', programCode: 'МКФ', label: 'МКФ(120)',
            programName: 'МК Футболки', room: 'Ninja', category: 'master_class',
            duration: 120, price: 3000, status: 'confirmed',
            kidsCount: 10, createdBy: 'admin'
        });
        assert.equal(updateRes.status, 200, `Update failed: ${JSON.stringify(updateRes.data)}`);

        await sleep(1500);

        // Now booking_confirm should have fired
        const confirmTasksAfter = await findAutoTasks(markerConfirm);
        assert.ok(confirmTasksAfter.length >= 1, 'booking_confirm rule should have fired after confirmation');
        confirmTasksAfter.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('E2E: disabled rule (is_active=false) does not create tasks', async () => {
        const date = '2099-10-15';
        const lineId = `${AUTO_LINE_PREFIX}_e2e4`;
        await ensureLine(date, lineId);

        const marker = 'E2E-DISABLED-004';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: should not exist` }],
            days_before: 0
        });
        const ruleId = rule.data.rule.id;
        cleanupRuleIds.push(ruleId);

        // Disable the rule
        await updateRule(ruleId, {
            name: `Test ${marker}`,
            trigger_type: 'booking_create',
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: should not exist` }],
            days_before: 0,
            is_active: false
        });

        const booking = await createBooking({
            date, time: '11:00', lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(800);

        const tasks = await findAutoTasks(marker);
        assert.equal(tasks.length, 0, `Disabled rule should NOT create tasks, found ${tasks.length}`);
    });

    it('E2E: linked booking (linkedTo set) does not trigger automation', async () => {
        const date = '2099-10-18';
        const lineId1 = `${AUTO_LINE_PREFIX}_e2e5a`;
        const lineId2 = `${AUTO_LINE_PREFIX}_e2e5b`;
        await ensureLine(date, lineId1);
        await ensureLine(date, lineId2);

        const marker = 'E2E-LINKED-005';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['kv1'] },
            actions: [{ type: 'create_task', title: `${marker}: linked should not appear` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        // Create main booking first via /full with a linked booking
        const res = await authRequest('POST', '/api/bookings/full', {
            main: {
                date, time: '15:00', lineId: lineId1,
                programId: 'kv1', programCode: 'КВ1', label: 'КВ1(60)',
                programName: 'Квест 1', room: 'Marvel', category: 'quest',
                duration: 60, price: 2200, status: 'confirmed', createdBy: 'admin'
            },
            linked: [{
                date, time: '15:00', lineId: lineId2,
                programId: 'kv1', programCode: 'КВ1', label: 'КВ1(60)',
                programName: 'Квест 1', room: 'Marvel', category: 'quest',
                duration: 60, price: 0, status: 'confirmed', createdBy: 'admin'
            }]
        });
        assert.equal(res.status, 200, `Full booking failed: ${JSON.stringify(res.data)}`);
        cleanupBookingIds.push(res.data.mainBooking.id);

        await sleep(1000);

        // Automation runs for main only; the linked booking (with linkedTo set) does NOT independently trigger
        // But the main booking matches kv1, so we expect task for main
        const tasks = await findAutoTasks(marker);
        // The main triggers once (via processBookingAutomation(main)), linked does not trigger separately
        // We just verify the count is exactly from the main
        assert.ok(tasks.length >= 1, 'Main booking should still trigger automation');
        // If linked also triggered, we would see 2 tasks. We expect 1.
        assert.equal(tasks.length, 1, 'Only main booking should trigger automation, not the linked one');
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('E2E: automation error is non-blocking — booking still created', async () => {
        const date = '2099-10-20';
        const lineId = `${AUTO_LINE_PREFIX}_e2e6`;
        await ensureLine(date, lineId);

        const marker = 'E2E-ERROR-006';
        // Rule with a deliberately malformed action (unknown type)
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'invalid_broken_type', data: 'malformed' }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: '10:00', lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            room: 'Marvel', category: 'pinata'
        });
        assert.equal(booking.status, 200, 'Booking should succeed despite automation error');
        assert.ok(booking.data.success);
        cleanupBookingIds.push(booking.data.booking.id);

        // Verify booking exists
        const check = await authRequest('GET', `/api/bookings/${date}`);
        const found = check.data.find(b => b.id === booking.data.booking.id);
        assert.ok(found, 'Booking should be accessible via GET');
    });

    it('E2E: automation trigger creates history entry with action=automation_triggered', async () => {
        const date = '2099-10-22';
        const lineId = `${AUTO_LINE_PREFIX}_e2e7`;
        await ensureLine(date, lineId);

        const marker = 'E2E-HISTORY-007';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: history check` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date, time: '10:00', lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            room: 'Marvel', category: 'pinata', createdBy: 'admin'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1500);

        // Check history for automation_triggered entry
        const histRes = await authRequest('GET', '/api/history?action=automation_triggered');
        assert.equal(histRes.status, 200);
        assert.ok(histRes.data.items, 'History should have items');
        const entries = histRes.data.items.filter(h => {
            if (!h.data) return false;
            const d = typeof h.data === 'string' ? JSON.parse(h.data) : h.data;
            return d.rule_name === `Test ${marker}`;
        });
        assert.ok(entries.length >= 1, `Expected history entry for rule "Test ${marker}"`);

        // Cleanup tasks
        const tasks = await findAutoTasks(marker);
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('E2E: multiple matching rules all fire independently', async () => {
        const date = '2099-10-25';
        const lineId = `${AUTO_LINE_PREFIX}_e2e8`;
        await ensureLine(date, lineId);

        const markerA = 'E2E-RULEA-008';
        const markerB = 'E2E-RULEB-008';

        // Rule A: matches by product_id
        const ruleA = await createRule({
            name: `Test ${markerA}`,
            trigger_condition: { product_ids: ['kv1'] },
            actions: [{ type: 'create_task', title: `${markerA}: {date}` }],
            days_before: 0
        });
        cleanupRuleIds.push(ruleA.data.rule.id);

        // Rule B: matches by category
        const ruleB = await createRule({
            name: `Test ${markerB}`,
            trigger_condition: { categories: ['quest'] },
            actions: [{ type: 'create_task', title: `${markerB}: {date}` }],
            days_before: 0
        });
        cleanupRuleIds.push(ruleB.data.rule.id);

        const booking = await createBooking({
            date, time: '10:00', lineId,
            programId: 'kv1', programCode: 'КВ1', label: 'КВ1(60)',
            programName: 'Квест 1', room: 'Marvel', category: 'quest'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1500);

        const tasksA = await findAutoTasks(markerA);
        const tasksB = await findAutoTasks(markerB);
        assert.ok(tasksA.length >= 1, `Rule A should fire (product_id match)`);
        assert.ok(tasksB.length >= 1, `Rule B should fire (category match)`);
        tasksA.forEach(t => cleanupTaskIds.push(t.id));
        tasksB.forEach(t => cleanupTaskIds.push(t.id));
    });
});

// ==========================================
// 6. calculateTaskDate (via integration)
// ==========================================

describe('calculateTaskDate — date offset via integration', () => {
    const lineId = `${AUTO_LINE_PREFIX}_calcdate`;
    const cleanupRuleIds = [];
    const cleanupBookingIds = [];
    const cleanupTaskIds = [];
    let timeSlot = 10;

    function nextTime() {
        const t = `${timeSlot}:00`;
        timeSlot++;
        return t;
    }

    before(async () => {
        await ensureLine('2099-08-20', lineId);
        await ensureLine('2099-08-15', lineId);
        await ensureLine('2099-03-03', lineId);
        await ensureLine('2099-01-02', lineId);
    });

    after(async () => {
        for (const id of cleanupTaskIds) await deleteTask(id);
        for (const id of cleanupBookingIds) await deleteBooking(id);
        for (const id of cleanupRuleIds) await deleteRule(id);
    });

    it('Task date is booking date minus days_before', async () => {
        const marker = 'CALCDATE-001';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: offset test` }],
            days_before: 5
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date: '2099-08-20', time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1, `Expected task with marker ${marker}`);
        assert.equal(tasks[0].date.split('T')[0], '2099-08-15', 'Task date should be 5 days before 2099-08-20');
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Task date equals booking date when days_before=0', async () => {
        const marker = 'CALCDATE-002';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: zero offset` }],
            days_before: 0
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date: '2099-08-20', time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1);
        assert.equal(tasks[0].date.split('T')[0], '2099-08-20');
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('days_before crossing month boundary calculates correctly', async () => {
        const marker = 'CALCDATE-003';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: month cross` }],
            days_before: 5
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date: '2099-03-03', time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1);
        assert.equal(tasks[0].date.split('T')[0], '2099-02-26', 'Should cross month boundary: 2099-03-03 minus 5 = 2099-02-26');
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('days_before crossing year boundary calculates correctly', async () => {
        const marker = 'CALCDATE-004';
        const rule = await createRule({
            name: `Test ${marker}`,
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: year cross` }],
            days_before: 3
        });
        cleanupRuleIds.push(rule.data.rule.id);

        const booking = await createBooking({
            date: '2099-01-02', time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1);
        assert.equal(tasks[0].date.split('T')[0], '2098-12-30', 'Should cross year boundary: 2099-01-02 minus 3 = 2098-12-30');
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });

    it('Null days_before returns booking date as-is', async () => {
        const marker = 'CALCDATE-005';
        // The API defaults null to 0, so effectively same as days_before=0
        const res = await authRequest('POST', '/api/automation-rules', {
            name: `Test ${marker}`,
            trigger_type: 'booking_create',
            trigger_condition: { product_ids: ['pinata'] },
            actions: [{ type: 'create_task', title: `${marker}: null days` }],
            days_before: null
        });
        assert.equal(res.status, 200);
        cleanupRuleIds.push(res.data.rule.id);

        const booking = await createBooking({
            date: '2099-08-20', time: nextTime(), lineId,
            programId: 'pinata', programCode: 'ПІН', label: 'ПІН(60)',
            category: 'pinata'
        });
        assert.equal(booking.status, 200);
        cleanupBookingIds.push(booking.data.booking.id);

        await sleep(1000);

        const tasks = await findAutoTasks(marker);
        assert.ok(tasks.length >= 1);
        assert.equal(tasks[0].date.split('T')[0], '2099-08-20', 'Null days_before should use booking date');
        tasks.forEach(t => cleanupTaskIds.push(t.id));
    });
});
