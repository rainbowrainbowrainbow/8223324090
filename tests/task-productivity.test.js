const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildTaskProductivity,
    calculateCompletionStreak,
    taskSourceGroup
} = require('../services/taskProductivity');
const { buildTaskPaginationMetadata } = require('../services/taskPagination');

test('derives productivity summary, streak, charts, and source insights from task rows', () => {
    const data = buildTaskProductivity([
        {
            id: 1,
            status: 'done',
            source_type: 'manual',
            created_by_user_id: 100,
            category: 'personal',
            created_at: '2026-05-20T08:00:00Z',
            completed_at: '2026-05-23T08:00:00Z',
            subtask_count: 3,
            subtask_done_count: 3,
            subtask_ai_count: 3,
            subtask_completed_events: [
                { id: 11, completed_at: '2026-05-23T08:05:00Z' },
                { id: 12, completed_at: '2026-05-23T08:10:00Z' },
                { id: 13, completed_at: '2026-05-23T08:15:00Z' }
            ]
        },
        {
            id: 2,
            status: 'done',
            source_type: 'manual',
            created_by_user_id: 100,
            category: 'event',
            created_at: '2026-05-19T08:00:00Z',
            completed_at: '2026-05-22T08:00:00Z',
            subtask_count: 4,
            subtask_done_count: 4,
            subtask_template_count: 4,
            subtask_completed_events: [
                { id: 21, completed_at: '2026-05-22T08:05:00Z' },
                { id: 22, completed_at: '2026-05-22T08:10:00Z' },
                { id: 23, completed_at: '2026-05-22T08:15:00Z' },
                { id: 24, completed_at: '2026-05-22T08:20:00Z' }
            ]
        },
        {
            id: 3,
            status: 'done',
            source_type: 'manual',
            created_by_user_id: 100,
            category: 'admin',
            created_at: '2026-05-18T08:00:00Z',
            completed_at: '2026-05-21T08:00:00Z',
            subtask_count: 0,
            subtask_done_count: 0
        },
        {
            id: 4,
            status: 'in_progress',
            source_type: 'manual',
            created_by_user_id: 100,
            workflow_state: 'in_progress',
            category: 'personal',
            created_at: '2026-05-23T07:00:00Z',
            deadline: '2026-05-20T10:00:00Z',
            subtask_count: 2,
            subtask_done_count: 1,
            subtask_manual_count: 2,
            subtask_completed_events: [
                { id: 41, completed_at: '2026-05-23T07:30:00Z' }
            ]
        },
        {
            id: 5,
            status: 'cancelled',
            source_type: 'manual',
            created_by_user_id: 100,
            category: 'admin',
            created_at: '2026-05-23T07:00:00Z',
            subtask_count: 10,
            subtask_done_count: 10,
            subtask_manual_count: 10
        }
    ], {
        now: new Date('2026-05-23T09:00:00+03:00')
    });

    assert.equal(data.summary.totalTasks, 4);
    assert.equal(data.summary.totalWorkUnits, 13);
    assert.equal(data.summary.completedTasks, 11);
    assert.equal(data.summary.completedUnits, 11);
    assert.equal(data.summary.completedParentTasks, 3);
    assert.equal(data.summary.completedSubtaskUnits, 8);
    assert.equal(data.summary.completedToday, 5);
    assert.equal(data.summary.completed7Days, 11);
    assert.equal(data.summary.completionRate, 85);
    assert.equal(data.summary.overdueCount, 1);
    assert.equal(data.summary.inProgressCount, 1);
    assert.equal(data.summary.parentTasksCompleted, 2);
    assert.equal(data.summary.decomposedTasksCount, 3);
    assert.equal(data.summary.subtasksCompleted, 8);
    assert.equal(data.decomposition.subtaskCompletionRate, 89);
    assert.equal(data.decomposition.sourceBreakdown.ai, 1);
    assert.equal(data.decomposition.sourceBreakdown.template, 1);
    assert.equal(data.decomposition.sourceBreakdown.manual, 1);
    assert.equal(data.decomposition.sourceBreakdown.none, 1);
    assert.equal(data.streak.current, 3);
    assert.equal(data.streak.longest, 3);
    assert.equal(data.streak.activeToday, true);
    assert.ok(data.charts.completedByDay.some(item => item.date === '2026-05-23' && item.count === 5));
    assert.ok(data.charts.createdVsCompleted.some(item => item.date === '2026-05-23' && item.created === 1 && item.completed === 5));
    assert.ok(data.achievements.some(item => item.id === 'productivity_ai_first_done' && item.unlocked));
    assert.ok(data.achievements.some(item => item.id === 'productivity_template_first_done' && item.unlocked));
});

test('productivity excludes unaccepted machine and ambiguous tasks without breaking manual work', () => {
    const data = buildTaskProductivity([
        {
            id: 10,
            status: 'completed',
            source_type: 'manual',
            created_by_user_id: 100,
            completed_at: '2026-05-23T08:00:00Z',
            subtask_count: 0,
            subtask_done_count: 0
        },
        {
            id: 11,
            status: 'done',
            source_type: 'booking',
            type: 'auto_complete',
            created_by: 'rule_engine',
            created_by_user_id: null,
            completed_at: '2026-05-23T08:10:00Z',
            subtask_count: 3,
            subtask_done_count: 3,
            subtask_completed_events: [
                { id: 111, completed_at: '2026-05-23T08:15:00Z' }
            ]
        },
        {
            id: 12,
            status: 'done',
            source_type: 'booking',
            type: 'auto_complete',
            created_by: 'rule_engine',
            created_by_user_id: null,
            owner_accepted: true,
            completed_at: '2026-05-23T08:20:00Z',
            subtask_count: 0,
            subtask_done_count: 0
        },
        {
            id: 13,
            status: 'todo',
            deadline: '2026-05-22T08:00:00Z',
            subtask_count: 0,
            subtask_done_count: 0
        },
        {
            id: 14,
            status: 'todo',
            source_type: 'manual',
            created_by_user_id: 100,
            snoozed_until: '2026-05-24T08:00:00Z',
            deadline: '2026-05-20T08:00:00Z',
            subtask_count: 0,
            subtask_done_count: 0
        }
    ], {
        now: new Date('2026-05-23T09:00:00+03:00')
    });

    assert.equal(data.summary.totalTasks, 3);
    assert.equal(data.summary.completedParentTasks, 2);
    assert.equal(data.summary.completedUnits, 2);
    assert.equal(data.summary.overdueCount, 0);
    assert.equal(data.summary.completionRate, 67);
    assert.equal(data.charts.completedByDay.find(item => item.date === '2026-05-23')?.count, 2);
});

test('derives template_ai only when persisted child sources contain template and ai', () => {
    assert.equal(taskSourceGroup({ subtask_count: 3, subtask_ai_count: 2, subtask_template_count: 1 }), 'template_ai');
    assert.equal(taskSourceGroup({ subtask_count: 3, subtask_ai_count: 2, subtask_manual_count: 1 }), 'ai');
    assert.equal(taskSourceGroup({ subtask_count: 3, subtask_template_count: 2, subtask_manual_count: 1 }), 'template');
    assert.equal(taskSourceGroup({ subtask_count: 3, subtask_manual_count: 3 }), 'manual');
    assert.equal(taskSourceGroup({ subtask_count: 0 }), 'none');
});

test('keeps current streak alive from yesterday until today has activity', () => {
    const streak = calculateCompletionStreak(
        ['2026-05-20', '2026-05-21', '2026-05-22'],
        '2026-05-23'
    );

    assert.equal(streak.current, 3);
    assert.equal(streak.longest, 3);
    assert.equal(streak.activeToday, false);
    assert.equal(streak.lastActiveDate, '2026-05-22');
});

test('task pagination metadata covers empty, boundary, and overflow datasets', () => {
    const cases = [
        { total: 0, returned: 0, hasMore: false },
        { total: 1, returned: 1, hasMore: false },
        { total: 499, returned: 499, hasMore: false },
        { total: 500, returned: 500, hasMore: false },
        { total: 501, returned: 500, hasMore: true }
    ];
    for (const sample of cases) {
        const pagination = buildTaskPaginationMetadata({ total: sample.total, page: 1, limit: 500, returned: sample.returned });
        assert.equal(pagination.total, sample.total);
        assert.equal(pagination.offset, 0);
        assert.equal(pagination.hasMore, sample.hasMore);
    }
    const secondPage = buildTaskPaginationMetadata({ total: 501, page: 2, limit: 500, returned: 1 });
    assert.deepEqual(secondPage, { total: 501, page: 2, limit: 500, offset: 500, nextPage: 3, hasMore: false });
});
