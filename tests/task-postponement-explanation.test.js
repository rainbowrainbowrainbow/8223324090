'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildPostponementExplanation,
    isPenaltyPostponementEvent
} = require('../services/taskPostponementPolicy');
const {
    listLatestTaskPostponementEvents
} = require('../services/taskActionHistory');
const {
    buildTaskCabinetProjection,
    normalizeTaskPayload
} = require('../services/taskCabinetProjection');

function penaltyEvent(overrides = {}) {
    return {
        id: 41,
        taskId: 7,
        actionType: 'task_rescheduled',
        actor: {
            userId: 4,
            name: 'Серг?й'
        },
        sourceSurface: 'profile_my_cabinet_overdue_to_today_button',
        oldValue: {
            deadline: '2026-07-28T20:59:59.999Z',
            date: '2026-07-28'
        },
        newValue: {
            deadline: '2026-07-29T20:59:59.999Z',
            date: '2026-07-29'
        },
        meta: {
            actorType: 'manual',
            countsAsPostponement: true,
            mutationKind: 'reschedule',
            reason: 'overdue_to_today',
            oldDue: {
                value: '2026-07-28',
                source: 'date',
                instant: '2026-07-28T20:59:59.999Z'
            },
            newDue: {
                value: '2026-07-29',
                source: 'date',
                instant: '2026-07-29T20:59:59.999Z'
            },
            priorityBefore: 'normal',
            priorityAfter: 'high',
            priorityEscalated: true
        },
        createdAt: '2026-07-29T08:30:00.000Z',
        ...overrides
    };
}

test('count zero omits postponement explanation from normalized task payload', () => {
    const payload = normalizeTaskPayload({
        id: 1,
        status: 'todo',
        postponement_count: 0
    });

    assert.equal(payload.postponementCount, 0);
    assert.equal(payload.attentionLevel, 0);
    assert.equal(Object.hasOwn(payload, 'postponementExplanation'), false);
    assert.equal(buildPostponementExplanation({ postponement_count: 0 }, penaltyEvent()), null);
});

test('postponement explanation derives attention level from canonical count', () => {
    const expected = new Map([
        [1, 1],
        [2, 2],
        [3, 3],
        [7, 3]
    ]);

    for (const [count, attentionLevel] of expected) {
        const explanation = buildPostponementExplanation({
            postponement_count: count,
            last_postponed_at: '2026-07-29T08:30:00.000Z'
        }, penaltyEvent());

        assert.equal(explanation.count, count);
        assert.equal(explanation.attentionLevel, attentionLevel);
        assert.equal(explanation.lastPostponedAt, '2026-07-29T08:30:00.000Z');
    }
});

test('postponement explanation normalizes actor, source, due and priority facts', () => {
    const manual = buildPostponementExplanation({
        postponement_count: 1,
        last_postponed_at: '2026-07-29T08:30:00.000Z'
    }, penaltyEvent());

    assert.deepEqual(manual, {
        count: 1,
        attentionLevel: 1,
        lastPostponedAt: '2026-07-29T08:30:00.000Z',
        actorType: 'manual',
        actorName: 'Серг?й',
        sourceSurface: 'my_day',
        reason: 'overdue_to_today',
        oldDue: '2026-07-28T20:59:59.999Z',
        newDue: '2026-07-29T20:59:59.999Z',
        priorityBefore: 'normal',
        priorityAfter: 'high',
        priorityEscalated: true
    });

    const bot = buildPostponementExplanation({
        postponement_count: 2
    }, penaltyEvent({
        actor: { userId: 88, name: 'Hermes Integration Bot' },
        sourceSurface: 'hermes',
        meta: {
            ...penaltyEvent().meta,
            actorType: 'bot',
            priorityBefore: 'high',
            priorityAfter: 'urgent'
        }
    }));
    assert.equal(bot.actorType, 'bot');
    assert.equal(bot.actorName, 'Hermes');
    assert.equal(bot.sourceSurface, 'hermes');

    const system = buildPostponementExplanation({
        postponement_count: 3
    }, penaltyEvent({
        actor: { userId: null, name: 'Internal scheduler service' },
        sourceSurface: 'services.scheduler',
        meta: {
            ...penaltyEvent().meta,
            actorType: 'system'
        }
    }));
    assert.equal(system.actorType, 'system');
    assert.equal(system.actorName, '\u0421\u0438\u0441\u0442\u0435\u043c\u0430');
    assert.equal(system.sourceSurface, 'scheduler');
    assert.equal(Object.hasOwn(system, 'actorUserId'), false);

    const explicitNoEscalation = buildPostponementExplanation({
        postponement_count: 3
    }, penaltyEvent({
        meta: {
            ...penaltyEvent().meta,
            priorityBefore: 'high',
            priorityAfter: 'urgent',
            priorityEscalated: false
        }
    }));
    assert.equal(explicitNoEscalation.priorityEscalated, false);
});

test('snooze and technical correction never become penalty explanations', () => {
    for (const mutationKind of ['snooze', 'technical_correction']) {
        const event = penaltyEvent({
            meta: {
                ...penaltyEvent().meta,
                mutationKind
            }
        });
        assert.equal(isPenaltyPostponementEvent(event), false);

        const explanation = buildPostponementExplanation({
            postponement_count: 2,
            last_postponed_at: '2026-07-29T08:30:00.000Z'
        }, event);
        assert.equal(explanation.count, 2);
        assert.equal(explanation.actorType, null);
        assert.equal(explanation.oldDue, null);
        assert.equal(explanation.priorityEscalated, null);
    }

    const uncounted = penaltyEvent({
        meta: {
            ...penaltyEvent().meta,
            countsAsPostponement: false
        }
    });
    assert.equal(isPenaltyPostponementEvent(uncounted), false);
});

test('latest penalty events are loaded in one ordered batch query', async () => {
    const calls = [];
    const pool = {
        async query(text, params) {
            calls.push({ text, params });
            return {
                rows: [{
                    id: 99,
                    task_id: 5,
                    action_type: 'task_rescheduled',
                    actor_user_id: 4,
                    actor_name_snapshot: 'Серг?й',
                    source_surface: 'profile_my_cabinet',
                    old_value_json: { date: '2026-07-28' },
                    new_value_json: { date: '2026-07-29' },
                    meta_json: {
                        countsAsPostponement: true,
                        mutationKind: 'reschedule'
                    },
                    summary: 'Task rescheduled',
                    created_at: '2026-07-29T08:30:00.000Z'
                }]
            };
        }
    };

    const events = await listLatestTaskPostponementEvents([5, 3, 5, 0, 'bad'], { pool });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, [[5, 3], 'task_rescheduled']);
    assert.match(calls[0].text, /SELECT DISTINCT ON \(task_id\)/);
    assert.match(calls[0].text, /task_id = ANY\(\$1::int\[\]\)/);
    assert.match(calls[0].text, /countsAsPostponement/);
    assert.match(calls[0].text, /NOT IN \('snooze', 'technical_correction'\)/);
    assert.match(calls[0].text, /ORDER BY task_id, created_at DESC, id DESC/);
    assert.equal(events.size, 1);
    assert.equal(events.get(5).id, 99);
});

test('My Day projection adds explanations with one history query and no N+1', async () => {
    const calls = [];
    const tasks = [0, 1, 2, 3].map(count => ({
        id: 100 + count,
        title: 'Task ' + count,
        status: 'todo',
        date: '2026-07-29',
        postponement_count: count,
        last_postponed_at: count ? '2026-07-29T08:3' + count + ':00.000Z' : null
    }));
    const historyRows = tasks
        .filter(task => task.postponement_count > 0)
        .map(task => ({
            id: 500 + task.id,
            task_id: task.id,
            action_type: 'task_rescheduled',
            actor_user_id: 4,
            actor_name_snapshot: 'Серг?й',
            source_surface: 'profile_my_cabinet_overdue_to_today_button',
            old_value_json: { date: '2026-07-28' },
            new_value_json: { date: '2026-07-29' },
            meta_json: {
                actorType: 'manual',
                countsAsPostponement: true,
                mutationKind: 'reschedule',
                oldDue: { value: '2026-07-28' },
                newDue: { value: '2026-07-29' },
                priorityBefore: task.postponement_count === 1 ? 'normal' : 'high',
                priorityAfter: task.postponement_count === 1 ? 'high' : 'urgent',
                priorityEscalated: task.postponement_count <= 2
            },
            created_at: task.last_postponed_at
        }));
    const pool = {
        async query(text, params = []) {
            calls.push({ text, params });
            if (/FROM task_action_history/.test(text)) return { rows: historyRows };
            if (/SELECT COUNT\(\*\)::int AS open_count/.test(text)) {
                return { rows: [{ open_count: tasks.length }] };
            }
            if (/done_total/.test(text)) {
                return {
                    rows: [{
                        done_total: 0,
                        done_today: 0,
                        parent_done_today: 0,
                        subtask_done_today: 0,
                        subtask_done_total: 0,
                        remaining_today: tasks.length,
                        overdue_carryover: 0,
                        active_my_day: tasks.length
                    }]
                };
            }
            if (/FROM task_user_preferences/.test(text)) return { rows: [] };
            if (/SELECT t\.\*/.test(text) && /BETWEEN/.test(text)) return { rows: tasks };
            if (/SELECT t\.\*/.test(text) && /COALESCE\(t\.status, 'todo'\) = 'done'/.test(text)) {
                return { rows: [] };
            }
            if (/SELECT t\.\*/.test(text) && /LIMIT 160/.test(text)) return { rows: tasks };
            return { rows: [] };
        }
    };

    const projection = await buildTaskCabinetProjection({
        pool,
        user: {
            id: 4,
            username: 'serhiy',
            name: 'Серг?й',
            role: 'creator'
        },
        businessScope: {
            mode: 'single',
            activeContext: 'event_genix',
            selectedContexts: ['event_genix']
        },
        ensurePreferences: false,
        now: new Date('2026-07-29T10:00:00.000Z')
    });

    assert.equal(calls.filter(call => /FROM task_action_history/.test(call.text)).length, 1);
    assert.deepEqual(
        calls.find(call => /FROM task_action_history/.test(call.text)).params[0],
        [101, 102, 103]
    );
    assert.equal(Object.hasOwn(projection.all[0], 'postponementExplanation'), false);
    assert.deepEqual(
        projection.all.slice(1).map(task => task.postponementExplanation.attentionLevel),
        [1, 2, 3]
    );
    assert.equal(projection.all[1].postponementExplanation.sourceSurface, 'my_day');
    assert.equal(projection.all[1].postponementExplanation.oldDue, '2026-07-28');
    assert.equal(projection.all[1].postponementExplanation.newDue, '2026-07-29');
    assert.equal(projection.meta.postponementExplanationContract, 'postponement_explanation_v1');
});
