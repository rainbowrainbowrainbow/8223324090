const test = require('node:test');
const assert = require('node:assert/strict');

const {
    toHermesPagination,
    toHermesTaskDetail,
    toHermesTaskHistoryEvent,
    toHermesTaskListItem
} = require('../services/hermesTaskMapper');

test('maps CRM task rows to stable Hermes list items', () => {
    const item = toHermesTaskListItem({
        id: 123,
        title: '  Call client  ',
        description: 'Confirm booking details',
        status: 'todo',
        priority: 'urgent',
        owner_user_id: 7,
        owner_name: 'Manager Name',
        scheduled_start_at: '2026-06-30T09:00:00.000Z',
        created_at: '2026-06-27T07:00:00.000Z',
        updated_at: '2026-06-27T07:10:00.000Z',
        completed_at: null,
        category: 'booking',
        subcategory: 'confirmation',
        task_kind: 'followup',
        business_context: 'event_genix',
        version: 3,
        control_meta: { reportRequired: true },
        client_phone: '+380000000000',
        client_email: 'client@example.com'
    }, { baseUrl: 'https://crm.example.com/' });

    assert.equal(item.id, '123');
    assert.equal(item.title, 'Call client');
    assert.equal(item.status, 'open');
    assert.equal(item.priority, 'urgent');
    assert.deepEqual(item.assignee, { id: '7', name: 'Manager Name' });
    assert.equal(item.due_at, '2026-06-30T09:00:00.000Z');
    assert.equal(item.crm_url, 'https://crm.example.com/tasks?open=123');
    assert.deepEqual(item.labels, ['booking', 'confirmation', 'followup', 'urgent']);
    assert.equal(item.metadata.crm_status, 'todo');
    assert.equal(item.metadata.business_context, 'event_genix');
    assert.equal(item.metadata.version, 3);

    const serialized = JSON.stringify(item);
    assert.equal(serialized.includes('control_meta'), false);
    assert.equal(serialized.includes('+380000000000'), false);
    assert.equal(serialized.includes('client@example.com'), false);
});

test('maps CRM statuses to Hermes-friendly statuses and preserves raw status in metadata', () => {
    const cases = [
        ['todo', 'open'],
        ['in_progress', 'in_progress'],
        ['done', 'done'],
        ['archived', 'archived'],
        ['cancelled', 'cancelled'],
        ['custom_waiting', 'open']
    ];

    for (const [crmStatus, hermesStatus] of cases) {
        const item = toHermesTaskListItem({ id: crmStatus, title: crmStatus, status: crmStatus });
        assert.equal(item.status, hermesStatus);
        assert.equal(item.metadata.crm_status, crmStatus);
    }
});

test('maps task detail subtasks, history, creator, and safe client identity', () => {
    const detail = toHermesTaskDetail({
        id: 55,
        title: 'Prepare package',
        status: 'in_progress',
        owner_user_id: 9,
        owner_username: 'manager',
        created_by_user_id: 2,
        created_by_name: 'Creator Name',
        customer_id: 88,
        customer_name: 'Client Name',
        customer_phone: '+380111111111',
        customer_email: 'hidden@example.com',
        subtasks: [
            { id: 1, title: 'Check availability', is_done: true, completed_at: '2026-06-27T08:00:00.000Z' },
            { id: 2, title: 'Send quote', is_done: false }
        ],
        history: [
            {
                id: 10,
                actionType: 'task_completed',
                actor: { userId: 9, name: 'Manager Name' },
                createdAt: '2026-06-27T09:00:00.000Z',
                oldValue: { status: 'in_progress', client_phone: '+380222222222' },
                newValue: { status: 'done', control_meta: { secret: 'nope' } },
                meta: { route: 'internal' },
                summary: 'Task completed'
            }
        ]
    });

    assert.deepEqual(detail.creator, { id: '2', name: 'Creator Name' });
    assert.deepEqual(detail.client, { id: '88', name: 'Client Name' });
    assert.deepEqual(detail.subtasks.map(item => item.status), ['done', 'open']);
    assert.equal(detail.subtasks[0].completed_at, '2026-06-27T08:00:00.000Z');
    assert.equal(detail.history[0].type, 'completed');
    assert.deepEqual(detail.history[0].actor, { id: '9', name: 'Manager Name' });
    assert.deepEqual(detail.history[0].changes.old, { status: 'in_progress' });
    assert.deepEqual(detail.history[0].changes.new, { status: 'done' });
    assert.deepEqual(detail.history[0].metadata, {
        crm_action_type: 'task_completed'
    });

    const serialized = JSON.stringify(detail);
    assert.equal(serialized.includes('+380'), false);
    assert.equal(serialized.includes('hidden@example.com'), false);
    assert.equal(serialized.includes('control_meta'), false);
    assert.equal(serialized.includes('secret'), false);
});

test('maps standalone history events with JSON payload sanitization', () => {
    const event = toHermesTaskHistoryEvent({
        id: 'event-1',
        action_type: 'task_owner_reassigned',
        actor_user_id: 12,
        actor_name_snapshot: 'Dispatcher',
        source_surface: 'task_detail',
        old_value_json: '{"assignedTo":"Old","email":"old@example.com"}',
        new_value_json: '{"assignedTo":"New","token":"hidden"}',
        created_at: new Date('2026-06-27T10:00:00.000Z')
    });

    assert.equal(event.type, 'reassigned');
    assert.deepEqual(event.changes.old, { assignedTo: 'Old' });
    assert.deepEqual(event.changes.new, { assignedTo: 'New' });
    assert.deepEqual(event.metadata, {
        crm_action_type: 'task_owner_reassigned',
        source_surface: 'task_detail'
    });
});

test('builds Hermes cursor pagination with a hard limit cap', () => {
    assert.deepEqual(toHermesPagination({ limit: 500, nextCursor: 'cursor-2' }), {
        next_cursor: 'cursor-2',
        has_more: true,
        limit: 50
    });
    assert.deepEqual(toHermesPagination([], { limit: 20, hasMore: false }), {
        next_cursor: null,
        has_more: false,
        limit: 20
    });
});
