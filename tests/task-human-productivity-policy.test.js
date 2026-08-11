const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(...segments) {
    return fs.readFileSync(path.join(ROOT, ...segments), 'utf8');
}

test('profile and dashboard productivity metrics use shared task KPI policy', () => {
    const authRoute = read('routes', 'auth.js');
    const dashboardRoute = read('routes', 'dashboard.js');

    assert.match(authRoute, /taskKpiEligibleSql/);
    assert.match(authRoute, /taskKpiCompletedSql/);
    assert.match(authRoute, /taskKpiActiveWorkSql/);
    assert.match(authRoute, /taskKpiCanonicalOverdueSql/);
    assert.match(authRoute, /function profileTaskWorkloadDateSql[\s\S]*taskKpiWorkloadDateSql/);
    assert.doesNotMatch(authRoute, /FROM tasks WHERE \$\{ownerWhere\} AND status = 'done' AND completed_at IS NOT NULL/);

    assert.match(dashboardRoute, /taskKpiEligibleSql/);
    assert.match(dashboardRoute, /taskKpiCompletedSql/);
    assert.match(dashboardRoute, /taskKpiCanonicalOverdueSql/);
    assert.match(dashboardRoute, /metric_scope/);
    assert.match(dashboardRoute, /automation_hygiene/);
    assert.doesNotMatch(dashboardRoute, /AVG\(t\.health_score\) FILTER \(WHERE t\.status NOT IN \('done','cancelled','archived'\)\)/);
});

test('achievements, quests and gamification task credit exclude unaccepted machine tasks', () => {
    const achievementsRoute = read('routes', 'achievements.js');
    const questsRoute = read('routes', 'quests.js');
    const gamification = read('services', 'gamification.js');

    assert.match(achievementsRoute, /taskKpiEligibleSql/);
    assert.match(achievementsRoute, /taskKpiCompletedSql/);
    assert.doesNotMatch(achievementsRoute, /COUNT\(\*\) FILTER \(WHERE COALESCE\(t\.status, 'todo'\) = 'done'\)/);
    assert.doesNotMatch(achievementsRoute, /t\.status = 'done'/);

    assert.match(questsRoute, /taskKpiEligibleSql/);
    assert.match(questsRoute, /taskKpiCompletedSql/);
    assert.doesNotMatch(questsRoute, /SELECT COUNT\(\*\) FROM tasks WHERE assigned_to = \$1 AND status = 'done'/);

    assert.match(gamification, /function shouldAwardTaskCompletion/);
    assert.match(gamification, /taskKpiEligibleSql/);
    assert.match(gamification, /taskKpiCompletedSql/);
    assert.doesNotMatch(gamification, /WHERE t\.status = 'done' AND t\.updated_at >= \$1/);
    assert.doesNotMatch(gamification, /WHERE \$\{ownerUsername\} = \$1 AND t\.status = 'done'/);
});

test('My Day contribution remains based on actual user completion actions', () => {
    const myDayContribution = read('services', 'myDayContribution.js');

    assert.match(myDayContribution, /COALESCE\(t\.status, 'todo'\) = 'done'/);
    assert.match(myDayContribution, /t\.completed_at IS NOT NULL/);
    assert.doesNotMatch(myDayContribution, /taskKpiEligibleSql/);
});

test('gamification hook skips explicit unaccepted machine task payloads but keeps legacy manual payloads', () => {
    const { shouldAwardTaskCompletion } = require('../services/gamification');

    assert.equal(shouldAwardTaskCompletion({ id: 1, status: 'done' }), true);
    assert.equal(shouldAwardTaskCompletion({
        id: 2,
        status: 'done',
        source_type: 'manual',
        created_by_user_id: 10
    }), true);
    assert.equal(shouldAwardTaskCompletion({
        id: 3,
        status: 'done',
        source_type: 'booking',
        type: 'auto_complete',
        created_by: 'rule_engine',
        created_by_user_id: null
    }), false);
    assert.equal(shouldAwardTaskCompletion({
        id: 4,
        status: 'done',
        source_type: 'booking',
        type: 'auto_complete',
        created_by: 'rule_engine',
        created_by_user_id: null,
        owner_accepted: true
    }), true);
});
