'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contribution = require('../services/myDayContribution');

const root = path.resolve(__dirname, '..');

test('contribution range is Kyiv inclusive and capped at 92 days', () => {
    const range = contribution.normalizeRange({ from: '2026-08-01', to: '2026-08-03' });
    assert.deepEqual(range, { from: '2026-08-01', to: '2026-08-03', dayCount: 3, timezone: 'Europe/Kyiv' });
    assert.equal(contribution.normalizeRange({}, new Date('2026-08-03T08:00:00Z')).dayCount, 7);
    assert.throws(() => contribution.normalizeRange({ from: '2026-08-03', to: '2026-08-01' }), { code: 'MY_DAY_CONTRIBUTION_VALIDATION' });
    assert.throws(() => contribution.normalizeRange({ from: '2026-01-01', to: '2026-04-03' }), { code: 'MY_DAY_CONTRIBUTION_RANGE_TOO_LARGE' });
});

test('contribution summary keeps directions mutually exclusive and impacts overlapping', () => {
    const result = contribution.summarizeContribution({
        range: { from: '2026-08-01', to: '2026-08-03', dayCount: 3, timezone: 'Europe/Kyiv' },
        completedTasks: [
            {
                task_id: 1,
                local_date: '2026-08-01',
                direction_id: 10,
                direction_name: 'Work',
                direction_color: '#6366F1',
                direction_icon: 'W',
                direction_is_active: true,
                impacts: [{ id: 20, name: 'Money', color: '#0EA5E9', icon: 'M', isActive: true }]
            },
            {
                task_id: 2,
                local_date: '2026-08-02',
                impacts: [
                    { id: 20, name: 'Money', color: '#0EA5E9', icon: 'M', isActive: true },
                    { id: 21, name: 'Health', color: '#22C55E', icon: 'H', isActive: false }
                ]
            }
        ],
        taskTimeRows: [
            {
                task_id: 1,
                local_date: '2026-08-01',
                seconds: 3600,
                direction_id: 10,
                direction_name: 'Work',
                direction_color: '#6366F1',
                direction_icon: 'W',
                direction_is_active: true,
                impacts: [{ id: 20, name: 'Money', color: '#0EA5E9', icon: 'M', isActive: true }]
            },
            { task_id: 2, local_date: '2026-08-02', seconds: 1800, impacts: [] }
        ],
        habitRows: [
            {
                habit_id: 5,
                metric: 'minutes',
                target_value: 20,
                local_date: '2026-08-03',
                state: 'done',
                value: 25,
                direction_id: 10,
                direction_name: 'Work',
                direction_color: '#6366F1',
                direction_icon: 'W',
                direction_is_active: true,
                impacts: [{ id: 21, name: 'Health', color: '#22C55E', icon: 'H', isActive: false }]
            },
            { habit_id: 6, metric: 'count', target_value: 10, local_date: '2026-08-03', state: 'done', value: 3, impacts: [] },
            { habit_id: 7, metric: 'boolean', target_value: 1, local_date: '2026-08-03', state: 'skipped', value: 1, impacts: [] }
        ]
    });
    assert.deepEqual(result.totals, { taskCount: 2, taskMinutes: 90, habitCompletions: 1, habitMinutes: 25 });
    assert.equal(result.directions.find(row => row.taxonomy?.id === 10).taskCount, 1);
    assert.equal(result.directions.find(row => row.taxonomy?.id === 10).habitMinutes, 25);
    assert.equal(result.unclassified.taskCount, 1);
    assert.equal(result.unclassified.taskMinutes, 30);
    assert.equal(result.directions.reduce((sum, row) => sum + row.taskCount, result.unclassified.taskCount), result.totals.taskCount);
    assert.equal(result.impacts.find(row => row.taxonomy?.id === 20).taskCount, 2);
    assert.equal(result.impacts.find(row => row.taxonomy?.id === 21).taskCount, 1);
    assert.equal(result.impacts.find(row => row.taxonomy?.id === 21).habitCompletions, 1);
    assert.equal(result.days.find(day => day.date === '2026-08-01').taskMinutes, 60);
    assert.equal(result.days.find(day => day.date === '2026-08-03').habitMinutes, 25);
});

test('contribution service queries current user, business scope, active timers, and archived labels', async () => {
    const calls = [];
    const queryable = {
        async query(sql, params) {
            calls.push({ sql, params });
            return { rows: [] };
        }
    };
    await contribution.buildMyDayContribution({
        queryable,
        user: { id: 42, username: 'owner' },
        businessScope: { mode: 'single', activeContext: 'eventgenix', selectedContexts: ['eventgenix'] },
        query: { from: '2026-08-01', to: '2026-08-03' }
    });
    assert.equal(calls.length, 3);
    assert.match(calls[0].sql, /COALESCE\(t\.status, 'todo'\) = 'done'/);
    assert.match(calls[0].sql, /t\.completed_at AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(calls[0].sql, /m\.user_id = \$\d+/);
    assert.match(calls[1].sql, /generate_series/);
    assert.match(calls[1].sql, /COALESCE\(e\.ended_at, NOW\(\)\)/);
    assert.match(calls[1].sql, /my_day_time_entries/);
    assert.match(calls[2].sql, /my_day_habit_checkins/);
    assert.match(calls[2].sql, /my_day_habits/);
    assert.deepEqual(calls[2].params, [42, '2026-08-01', '2026-08-03']);
});

test('contribution route and UI expose only the canonical read endpoint and no scoring', () => {
    const route = fs.readFileSync(path.join(root, 'routes', 'my-day.js'), 'utf8');
    const service = fs.readFileSync(path.join(root, 'services', 'myDayContribution.js'), 'utf8');
    const profile = fs.readFileSync(path.join(root, 'js', 'profile-page.js'), 'utf8');
    const habitsUi = fs.readFileSync(path.join(root, 'js', 'my-day-habits.js'), 'utf8');
    const contributionUi = fs.readFileSync(path.join(root, 'js', 'my-day-contribution.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'profile.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'css', 'pages-profile.css'), 'utf8');
    assert.match(route, /router\.get\('\/contribution'/);
    assert.match(route, /ensureTaskBusinessScope/);
    assert.match(service, /buildTaskOwnerMatch/);
    assert.match(service, /appendTaskBusinessScopeSql/);
    assert.match(profile, /MyDayContribution\?\.renderPanel/);
    assert.match(habitsUi, /data-my-day-life-mode="contribution"/);
    assert.match(contributionUi, /\/api\/my-day\/contribution/);
    assert.match(contributionUi, /role="tabpanel"/);
    assert.match(contributionUi, /aria-busy/);
    assert.match(contributionUi, /Максимум 92/);
    assert.match(html, /js\/my-day-contribution\.js/);
    assert.match(css, /my-day-contribution-table-wrap/);
    assert.doesNotMatch(service + contributionUi, /productivityScore|streak|penalt|gamification|recurring/i);
});
