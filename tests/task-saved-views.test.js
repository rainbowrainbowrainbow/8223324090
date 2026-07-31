'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeSavedTaskViews,
    savedViewsPatchFromBody,
    taskSavedViewsFromPreferences
} = require('../services/taskSavedViews');

const VIEW_ID = '79b67551-e68b-4a63-9e13-8062480aa847';

test('saved task view accepts canonical URL state and drops unknown fields', () => {
    const [view] = normalizeSavedTaskViews([{
        id: VIEW_ID,
        name: 'Urgent bookings',
        state: {
            mode: 'overview',
            queue: 'inbox',
            ownerUserId: 42,
            dateFrom: '2026-07-01',
            dateTo: '2026-07-31',
            status: ['todo', 'todo', 'invalid'],
            priority: ['urgent', 'invalid'],
            category: 'orders',
            source: 'booking',
            search: 'wedding',
            ignored: 'must not persist'
        }
    }]);

    assert.deepEqual(view.state, {
        mode: 'overview',
        queue: 'inbox',
        ownerUserId: 42,
        dateFrom: '2026-07-01',
        dateTo: '2026-07-31',
        status: ['todo'],
        priority: ['urgent'],
        category: 'orders',
        source: 'booking',
        search: 'wedding'
    });
});

test('saved task views reject invalid user state and require optimistic revision', () => {
    assert.throws(() => normalizeSavedTaskViews([{
        id: VIEW_ID,
        name: 'Bad range',
        state: { dateFrom: '2026-08-02', dateTo: '2026-08-01' }
    }]), /date range/);
    assert.throws(() => savedViewsPatchFromBody({ savedTaskViews: [] }), /Revision/);
});

test('saved task views map DB snake case to the public preferences contract', () => {
    assert.deepEqual(taskSavedViewsFromPreferences({
        saved_task_views: [{ id: VIEW_ID }],
        saved_task_views_revision: 3
    }), {
        savedTaskViews: [{ id: VIEW_ID }],
        savedTaskViewsRevision: 3
    });
});
