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

test('contribution summary keeps impacts overlapping and ignores legacy directions', () => {
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
    assert.equal(Object.hasOwn(result, 'directions'), false);
    assert.equal(Object.hasOwn(result, 'unclassified'), false);
    assert.equal(result.meta.impactFacetContract, 'overlapping_facets_do_not_sum_to_global_total');
    assert.deepEqual(result.groups.map(group => group.key), ['custom']);
    assert.equal(result.impacts.find(row => row.taxonomy?.id === 20).taskCount, 2);
    assert.equal(result.impacts.find(row => row.taxonomy?.id === 21).taskCount, 1);
    assert.equal(result.impacts.find(row => row.taxonomy?.id === 21).habitCompletions, 1);
    assert.equal(result.days.find(day => day.date === '2026-08-01').taskMinutes, 60);
    assert.equal(result.days.find(day => day.date === '2026-08-03').habitMinutes, 25);
});

test('contribution global task minutes count once while impact rows remain overlapping facets', () => {
    const result = contribution.summarizeContribution({
        range: { from: '2026-08-01', to: '2026-08-01', dayCount: 1, timezone: 'Europe/Kyiv' },
        taskTimeRows: [{
            task_id: 77,
            local_date: '2026-08-01',
            seconds: 3600,
            impacts: [
                { id: 20, name: 'Робота: Парк', color: '#0EA5E9', icon: 'P', isActive: true },
                { id: 21, name: 'Робота: CRM', color: '#22C55E', icon: 'C', isActive: true },
                { id: 22, name: 'Робота: Hermes', color: '#F59E0B', icon: 'H', isActive: true }
            ]
        }]
    });
    assert.equal(result.totals.taskMinutes, 60);
    assert.deepEqual(result.impacts.map(row => row.taskMinutes).sort((a, b) => a - b), [60, 60, 60]);
    assert.equal(result.impacts.reduce((sum, row) => sum + row.taskMinutes, 0), 180);
    assert.deepEqual(result.groups.map(group => group.key), ['context']);
    assert.equal(result.groups[0].impacts.length, 3);
    assert.equal(result.days[0].taskMinutes, 60);
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
    assert.doesNotMatch(calls[0].sql, /my_day_directions|direction_id|direction_name/);
    assert.doesNotMatch(calls[0].sql, /tags/);
    assert.match(calls[1].sql, /generate_series/);
    assert.match(calls[1].sql, /task_day_time AS/);
    assert.match(calls[1].sql, /GROUP BY e\.task_id, days\.local_date/);
    assert.ok(calls[1].sql.indexOf('task_day_time AS') < calls[1].sql.indexOf('LEFT JOIN my_day_task_impacts'));
    assert.match(calls[1].sql, /COALESCE\(e\.ended_at, NOW\(\)\)/);
    assert.match(calls[1].sql, new RegExp("::timestamp AT TIME ZONE 'Europe/Kyiv'"));
    assert.match(calls[1].sql, /my_day_time_entries/);
    assert.match(calls[1].sql, /WHERE e\.user_id = \$\d+/);
    assert.doesNotMatch(calls[1].sql, /owner_user_id IS NULL|owner_user_id =/);
    assert.match(calls[2].sql, /my_day_habit_checkins/);
    assert.match(calls[2].sql, /my_day_habits/);
    assert.doesNotMatch(calls[2].sql, /my_day_directions|direction_id|direction_name/);
    assert.doesNotMatch(calls[2].sql, /tags/);
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
    assert.match(contributionUi, /renderImpactGroups/);
    assert.match(contributionUi, /перехресними зрізами/);
    assert.match(contributionUi, /92/);
    assert.match(html, /js\/my-day-contribution\.js/);
    assert.match(css, /my-day-contribution-table-wrap/);
    assert.doesNotMatch(service + contributionUi, /productivityScore|streak|penalt|gamification|recurring/i);
});
