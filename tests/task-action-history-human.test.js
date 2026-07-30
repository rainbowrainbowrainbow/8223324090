'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadActionHistoryView() {
    const source = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
    const start = source.indexOf('if (!window.ActionHistoryView)');
    const end = source.indexOf('// MODAL LAYER GUARD');
    assert.ok(start >= 0 && end > start, 'shared ActionHistoryView block must exist');
    const sandbox = { window: null, console };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source.slice(start, end), sandbox);
    return sandbox.ActionHistoryView;
}

function penaltyEvent(overrides = {}) {
    return {
        actionType: 'task_rescheduled',
        actor: { userId: 7, name: 'Hermes worker' },
        sourceSurface: 'profile_my_cabinet_overdue_to_today_button',
        oldValue: { deadline: '2026-07-28T20:59:59.999Z', priority: 'normal' },
        newValue: { deadline: '2026-07-29T20:59:59.999Z', priority: 'high' },
        meta: {
            countsAsPostponement: true,
            mutationKind: 'reschedule',
            postponementCountAfter: 3,
            actorType: 'bot',
            oldDue: { value: '2026-07-28' },
            newDue: { value: '2026-07-29' },
            priorityBefore: 'normal',
            priorityAfter: 'high',
            priorityEscalated: true,
            internalRoute: 'routes/tasks.reschedule'
        },
        createdAt: '2026-07-29T09:30:00.000Z',
        ...overrides
    };
}

test('penalty task reschedule renders human title, count, actor and surface', () => {
    const view = loadActionHistoryView();
    const normalized = view.normalizeEvent(penaltyEvent(), { kind: 'task' });
    assert.equal(normalized.title, 'Перенесено після прострочення');
    assert.equal(normalized.actor, 'Hermes');
    assert.equal(normalized.surface, 'Мій день');
    assert.match(normalized.details, /Перенесення №3/);
    assert.match(normalized.details, /28\.07\.2026 → 29\.07\.2026/);
    assert.match(normalized.details, /Пріоритет: Звичайний → Високий/);
    assert.equal(normalized.tone, 'danger');

    const html = view.renderRow(penaltyEvent(), { kind: 'task' });
    assert.match(html, /Перенесено після прострочення/);
    assert.match(html, /Hermes · Мій день/);
    assert.doesNotMatch(html, /profile_my_cabinet|countsAsPostponement|mutationKind|internalRoute|routes\/tasks/);
});

test('ordinary, snooze and technical reschedules remain ordinary history events', () => {
    const view = loadActionHistoryView();
    const ordinary = view.normalizeEvent(penaltyEvent({ meta: { countsAsPostponement: false } }), { kind: 'task' });
    const snooze = view.normalizeEvent(penaltyEvent({ meta: { countsAsPostponement: true, mutationKind: 'snooze' } }), { kind: 'task' });
    const correction = view.normalizeEvent(penaltyEvent({ meta: { countsAsPostponement: true, mutationKind: 'technical_correction' } }), { kind: 'task' });
    assert.equal(ordinary.title, 'Дедлайн перенесено');
    assert.equal(snooze.title, 'Дедлайн перенесено');
    assert.equal(correction.title, 'Дедлайн перенесено');
    assert.doesNotMatch(ordinary.details, /Перенесення №/);
});

test('penalty task history normalizes system actor and known surfaces without raw fallback', () => {
    const view = loadActionHistoryView();
    const system = view.normalizeEvent(penaltyEvent({
        actor: { name: 'system' },
        sourceSurface: 'task_watchdog_auto_reschedule',
        meta: { countsAsPostponement: true, mutationKind: 'reschedule', postponementCountAfter: 4, actorType: 'system' }
    }), { kind: 'task' });
    assert.equal(system.actor, 'Система');
    assert.equal(system.surface, 'Система');

    const unknown = view.renderRow(penaltyEvent({ sourceSurface: 'internal_private_route' }), { kind: 'task' });
    assert.doesNotMatch(unknown, /internal_private_route/);
});
