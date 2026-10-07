'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { loadParkHrMonthlyReport } = require('../../services/parkHrMonthlyReportRead');
const { taskKpiEligibleSql, taskKpiMachineSignalSql } = require('../../services/taskPerformancePolicy');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

// This query is behind an intentionally closed legacy HTTP lane. Execute its
// exact shipped SQL in the disposable database; never bypass an HTTP guard.
function legacyMonthlyTaskSql() {
    const source = fs.readFileSync(path.resolve(__dirname, '../../routes/hr.js'), 'utf8');
    const monthly = source.slice(source.indexOf("router.get('/report/monthly'"));
    const detail = monthly.match(/const taskDetailSql = `([\s\S]*?)`;/)?.[1];
    const overdue = monthly.match(/const taskOverdueSql = `([\s\S]*?)`;/)?.[1];
    const query = monthly.match(/const taskKpiRows = await pool\.query\(\s*`([\s\S]*?)`,/)?.[1];
    assert.ok(detail && overdue && query, 'Locate the actual monthly task query, not a test copy');
    const scope = { taskKpiEligibleSql, taskKpiMachineSignalSql };
    scope.taskDetailSql = vm.runInNewContext('`' + detail + '`', scope);
    scope.taskOverdueSql = vm.runInNewContext('`' + overdue + '`', scope);
    const sql = vm.runInNewContext('`' + query + '`', scope);
    assert.match(sql.trim(), /^SELECT\b/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    return sql;
}

test('actual PostgreSQL monthly reports classify complete with done/completed and preserve every other rule', { timeout: 360000 }, async () => {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assertSafeIsolatedTestUrl(process.env.TEST_URL);
    const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const output = process.env.HR_MONTHLY_COMPLETE_EVIDENCE;
    const result = { environment: 'LOCAL / SYNTHETIC / REAL POSTGRESQL', baseSha: 'c6fe83a5360c2e981efc7c94f190ffd420b19028',
        period: { dateFrom: '2026-09-01', dateTo: '2026-09-30' }, blocks: [], fixtures: [], http: [], browser: null };
    const actors = {};
    const password = crypto.randomBytes(18).toString('hex');
    const passwordHash = await bcrypt.hash(password, 4);
    const base = process.env.TEST_URL;
    async function request(route, token, body) {
        const response = await fetch(new URL(route, base), { method: body ? 'POST' : 'GET',
            headers: { 'X-Business-Context': 'event_genix', ...(token ? { Authorization: 'Bearer ' + token } : {}),
                ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, body: await response.json() };
    }
    async function login(actor) {
        const auth = await request('/api/auth/login', null, { username: actor.username, password });
        assert.equal(auth.status, 200);
        const token = auth.body.accessToken || auth.body.token;
        const profile = await request('/api/auth/profile', token);
        assert.equal(profile.status, 200);
        return { token, user: profile.body.user || auth.body.user };
    }
    try {
        await db.query('UPDATE staff SET is_active=false');
        const organization = Number((await db.query("INSERT INTO organizations(slug,name) VALUES('qa-monthly-complete','Synthetic report QA') RETURNING id")).rows[0].id);
        const business = Number((await db.query(`INSERT INTO businesses(organization_id,context_key,label,short_label,access_mode,modules)
            VALUES($1,'event_genix','Synthetic QA','QA','membership','[]') ON CONFLICT(context_key)
            DO UPDATE SET organization_id=EXCLUDED.organization_id,access_mode='membership',status='active' RETURNING id`, [organization])).rows[0].id);
        const staffIds = [];
        for (const [label, role] of [['Alpha', 'creator'], ['Beta', 'manager']]) {
            const username = 'qa_monthly_complete_' + role;
            const user = (await db.query(`INSERT INTO users(username,password_hash,name,role,business_contexts,default_business_context,is_active)
                VALUES($1,$2,$3,$4,'{event_genix}','event_genix',true) RETURNING id`, [username, passwordHash, 'Synthetic ' + role, role])).rows[0];
            actors[role] = { id: Number(user.id), username, role };
            await db.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'member')", [organization, user.id]);
            await db.query('INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default) VALUES($1,$2,$3,$4,true)', [business, organization, user.id, role]);
            const staffId = Number((await db.query(`INSERT INTO staff(name,department,position,role_type,secondary_professions,hourly_rate,rate_unit,is_active)
                VALUES($1,'animators','Synthetic QA','animator','[]',100,'hour',true) RETURNING id`, ['Synthetic ' + label])).rows[0].id);
            staffIds.push(staffId);
            await db.query('INSERT INTO employee_profiles(user_id,staff_id,full_name,is_active) VALUES($1,$2,$3,true)', [user.id, staffId, 'Synthetic ' + label]);
            await db.query(`INSERT INTO staff_role_assignments(staff_id,profession_key,is_primary,status,admission_status,internship_status,created_by,updated_by)
                VALUES($1,'animator',true,'active','approved','none','qa-complete','qa-complete')`, [staffId]);
            for (const date of ['2026-09-15', new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date())]) {
                await db.query("INSERT INTO hr_shifts(staff_id,shift_date,planned_start,planned_end,shift_type,profession_key) VALUES($1,$2,'09:00','17:00','working','animator')", [staffId, date]);
            }
        }
        const fixtures = [
            { key: 'done', status: 'done', done: true },
            { key: 'completed', status: 'completed', done: true },
            { key: 'complete', status: 'complete', done: true },
            { key: 'todo', status: 'todo', overdue: true },
            { key: 'in_progress', status: 'in_progress', overdue: true },
            { key: 'null_status', status: null, overdue: true },
            { key: 'future_deadline', deadline: '2099-01-01T12:00:00Z' },
            { key: 'no_deadline', deadline: null },
            { key: 'archived_status', status: 'archived', assigned: false },
            { key: 'archived_row', status: 'complete', archived: '2026-09-10T12:00:00Z', assigned: false },
            { key: 'cancelled', status: 'cancelled', assigned: false },
            { key: 'canceled', status: 'canceled', assigned: false },
            { key: 'private_complete', status: 'complete', visibility: 'private', assigned: false },
            { key: 'machine_unaccepted_complete', status: 'complete', machine: true, assigned: false },
            { key: 'machine_owner_accepted_complete', status: 'complete', machine: true, accepted: true, done: true },
            { key: 'ambiguous', human: false, source: '', creator: '', assigned: false },
            { key: 'foreign_context', context: 'dar', assigned: false },
            { key: 'deadline_only_month', created: '2026-08-01T12:00:00Z', deadline: '2026-09-20T12:00:00Z', assigned: false },
            { key: 'completed_in_month', status: 'complete', created: '2026-08-01T12:00:00Z', done: true },
            { key: 'completed_next_month', status: 'complete', completed: '2026-10-05T12:00:00Z', done: true },
            { key: 'future_snooze', snoozed: '2099-01-01T12:00:00Z', overdue: true },
            { key: 'month_boundary', created: '2026-08-31T21:30:00Z', assigned: false }
        ];
        for (const f of fixtures) {
            const status = Object.hasOwn(f, 'status') ? f.status : 'todo';
            f.expected = { assigned: f.assigned !== false, done: f.done === true, overdue: f.overdue === true };
            f.id = Number((await db.query(`INSERT INTO tasks(title,status,owner_user_id,source_type,type,created_by,created_by_user_id,created_at,completed_at,deadline,business_context,visibility,archived_at,snoozed_until)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`, [
                'Synthetic ' + f.key, status, actors.creator.id, f.source ?? (f.machine ? 'booking' : 'manual'), f.machine ? 'auto' : 'manual',
                f.creator ?? (f.machine ? 'rule_engine' : actors.creator.username), f.machine || f.human === false ? null : actors.creator.id,
                f.created || '2026-09-01T12:00:00Z', f.completed || (['done','completed','complete'].includes(status) ? '2026-09-05T12:00:00Z' : null),
                Object.hasOwn(f,'deadline') ? f.deadline : '2020-09-20T12:00:00Z', f.context || 'event_genix', f.visibility || 'team', f.archived || null, f.snoozed || null
            ])).rows[0].id);
            if (f.accepted) await db.query(`INSERT INTO task_action_history(task_id,action_type,actor_user_id,actor_name_snapshot,source_surface,old_value_json,new_value_json,meta_json,summary)
                VALUES($1,'task_acknowledged',$2,'Synthetic owner','qa-complete','{}','{}','{}','Synthetic owner acceptance')`, [f.id, actors.creator.id]);
        }
        result.fixtures = fixtures;
        const service = (await loadParkHrMonthlyReport(db, result.period)).find(r => Number(r.staff_id) === staffIds[0]).task_kpi;
        const legacy = (await db.query(legacyMonthlyTaskSql(), [result.period.dateFrom, result.period.dateTo])).rows.find(r => Number(r.staff_id) === staffIds[0]);
        const auth = await login(actors.creator);
        const http = await request('/api/hr/report/monthly?month=2026-09', auth.token);
        assert.equal(http.status, 200, 'The actual bounded membership HTTP lane stays authorized');
        assert.equal(http.body.reportAccess.exportAllowed, false);
        result.http.push({ route: '/api/hr/report/monthly?month=2026-09', status: http.status, reportAccess: http.body.reportAccess });
        const expectedTotals = Object.fromEntries(['assigned','done','overdue'].map(k => ['tasks_' + k, fixtures.filter(f => f.expected[k]).length]));
        for (const [label, row] of [['park-service', service], ['legacy-exact-query-not-http', legacy], ['membership-http', http.body.data.find(r => Number(r.staff_id) === staffIds[0]).task_kpi]]) {
            const observed = fixtures.map(f => {
                const actual = Object.fromEntries(['assigned','done','overdue'].map(k => [k, row['tasks_' + k + '_details'].some(t => Number(t.id) === f.id)]));
                return { key: f.key, id: f.id, expected: f.expected, actual, status: JSON.stringify(actual) === JSON.stringify(f.expected) ? 'PASS' : 'FAIL' };
            });
            result.blocks.push({ label, expectedTotals, actualTotals: Object.fromEntries(['assigned','done','overdue'].map(k => ['tasks_'+k, Number(row['tasks_'+k])])), observed });
        }
        for (const route of ['/api/hr/role-assignments/report', '/api/staff/link-status']) {
            const adjunct = await request(route, auth.token);
            result.http.push({ route, status: adjunct.status, code: adjunct.body.code });
            assert.equal(adjunct.status, 403); assert.equal(adjunct.body.code, 'staff_not_migrated');
        }
        assert.deepEqual(result.blocks.map(b => b.actualTotals), result.blocks.map(b => b.expectedTotals));
        assert.equal(result.blocks.flatMap(b => b.observed).filter(r => r.status === 'FAIL').length, 0, 'Counter and every detail-list membership agree for complete and all existing rules');
        if (process.env.HR_MONTHLY_COMPLETE_BROWSER === 'true') {
            assert.ok(output, 'Explicit owned evidence directory required for browser QA');
            const setMode = mode => db.query('UPDATE businesses SET access_mode=$1 WHERE id=$2', [mode, business]);
            result.browser = await require(path.join(output, 'real-ui.cjs')).run({ login, actors, setMode, base, output, expectedTotals });
            assert.equal(result.browser.cases.filter(c => c.status !== 'PASS').length, 0, 'Actual UI gate');
        }
    } finally {
        if (output) { fs.mkdirSync(output,{recursive:true}); fs.writeFileSync(path.join(output,'POSTGRES-RESULT.json'),JSON.stringify(result,null,2)+'\n'); }
        await db.end();
    }
});
