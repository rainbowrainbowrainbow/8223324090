'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { BASE_URL, request } = require('../helpers');

test('profile endpoints return only the linked employee’s payroll and results', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true'
}, async t => {
    const { url } = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    const db = new Pool({ connectionString: url.toString() });
    t.after(() => db.end());
    const password = randomBytes(18).toString('hex');
    const hash = await bcrypt.hash(password, 10);
    const suffix = randomBytes(5).toString('hex');
    const month = '2024-02';
    async function createEmployee(key, gross, linked = true) {
        const username = `profile_${key}_${suffix}`;
        const name = 'Test Employee ' + suffix;
        const user = (await db.query(
            `INSERT INTO users (username, password_hash, name, role, is_active)
             VALUES ($1, $2, $3, 'animator', true) RETURNING id`,
            [username, hash, name]
        )).rows[0];
        const staff = (await db.query(
            `INSERT INTO staff (name, department, position, role_type, is_active)
             VALUES ($1, 'Test', 'Test', 'animator', true) RETURNING id`, [name]
        )).rows[0];
        if (linked) {
            await db.query(
                `INSERT INTO employee_profiles (user_id, staff_id, full_name, role, is_active)
                 VALUES ($1, $2, $3, 'animator', true)`, [user.id, staff.id, name]
            );
        }
        await db.query(
            `INSERT INTO payroll_reports (period_month, staff_id, gross_amount, deductions_amount, net_amount, status, breakdown_json)
             VALUES ($1, $2, $3, 100, $3::numeric - 100, 'approved', $4::jsonb)`,
            [month, staff.id, gross, JSON.stringify({ professionRateSummary: [
                { profession_key: 'animator', rate: 120, amount: gross, rate_unit: 'hour', actual_minutes: 600 }
            ] })]
        );
        const session = await request('POST', '/api/auth/login', { username, password });
        assert.equal(session.status, 200, JSON.stringify(session.data));
        return { userId: user.id, staffId: staff.id, token: session.data.token };
    }

    const own = await createEmployee('own', 2000);
    const foreign = await createEmployee('foreign', 9000);
    const unlinked = await createEmployee('unlinked', 8000, false);
    await db.query(
        `INSERT INTO hr_time_records (staff_id, record_date, planned_start, clock_in, late_minutes, status, business_context)
         VALUES ($1, '2024-02-03', '10:00', '2024-02-03T08:12:00Z', 12, 'late', 'event_genix')`,
        [own.staffId]
    );
    await db.query(
        `INSERT INTO hr_audit_log (staff_id, action, details, created_at)
         VALUES ($1, 'rating_add', '{"score":4,"comment":"Fixture review"}', '2024-02-03T12:00:00Z')`,
        [own.staffId]
    );
    const salaryPath = `/api/auth/profile/me/salary?month=${month}`;
    const forged = await fetch(BASE_URL + salaryPath + `&staffId=${foreign.staffId}&userId=${foreign.userId}`, {
        headers: { Authorization: 'Bearer ' + own.token }
    });
    assert.equal(forged.status, 200);
    assert.match(forged.headers.get('cache-control'), /no-store/);
    const salary = await forged.json();
    assert.equal(salary.gross, 2000);
    assert.equal(salary.detail.rates[0].rate, 120);
    assert.equal(salary.late[0].minutes, 12);
    assert.equal(salary.paid, null);
    assert.equal((await request('GET', salaryPath, null, foreign.token)).data.gross, 9000);
    assert.equal((await request('GET', salaryPath, null, unlinked.token)).data.state, 'unavailable');
    assert.ok([401, 403].includes((await request('GET', salaryPath)).status));
    const otherBusiness = await request('GET', salaryPath + '&business_context=dar', null, own.token);
    assert.ok(otherBusiness.status === 403 || otherBusiness.data?.state === 'unavailable');
    const currentMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date()).slice(0, 7);
    const currentSalary = await request('GET', `/api/auth/profile/me/salary?month=${currentMonth}`, null, own.token);
    assert.equal(currentSalary.status, 200, JSON.stringify(currentSalary.data));
    assert.equal(currentSalary.data.state, 'empty');
    assert.equal(currentSalary.data.gross, null);

    const agreement = async (business, worker, original, day, state) => (await db.query(
        `INSERT INTO staff_substitutions (business_context, staff_id, original_staff_id, work_date,
                 source_type, source_id, slot_key, state, version, input_json, quote_json,
                 source_snapshot, created_by)
         VALUES ($1,$2,$3,$4,'standalone',$5,'main',$6,1,
                 '{"professionKey":"animator","reason":"Private fixture reason"}',
                 '{"estimateMinor":99999}','{}','synthetic')
         RETURNING id::text`,
        [business, worker, original, day, randomBytes(8).toString('hex'), state]
    )).rows[0].id;
    const cover = await agreement('event_genix', own.staffId, foreign.staffId, '2024-02-29', 'active');
    const handedOff = await agreement('event_genix', foreign.staffId, own.staffId, '2024-02-03', 'cancelled');
    const unrelated = await agreement('event_genix', foreign.staffId, unlinked.staffId, '2024-02-11', 'active');
    await agreement('event_genix', own.staffId, foreign.staffId, '2024-03-01', 'active');
    await agreement('dar', own.staffId, foreign.staffId, '2024-02-15', 'active');

    const resultsPath = `/api/auth/profile/me/results?month=${month}`;
    const results = await request('GET', resultsPath + `&staffId=${foreign.staffId}`, null, own.token);
    assert.equal(results.status, 200, JSON.stringify(results.data));
    assert.equal(results.data.current.attendance.late, 1);
    assert.equal(results.data.current.ratings[0].explanation, 'Fixture review');
    assert.equal(results.data.previous.month, '2024-01');
    assert.deepEqual(results.data.substitutions, [
        { id:cover, date:'2024-02-29', state:'active', role:'replacement', partial:false, professionKey:'animator' },
        { id:handedOff, date:'2024-02-03', state:'cancelled', role:'original', partial:false, professionKey:'animator' }
    ]);
    const foreignResults = await request('GET', resultsPath, null, foreign.token);
    assert.equal(foreignResults.status, 200, JSON.stringify(foreignResults.data));
    assert.deepEqual(foreignResults.data.substitutions.map(item => item.id), [cover, unrelated, handedOff]);
    assert.doesNotMatch(JSON.stringify(results.data.substitutions), /Private fixture reason|99999/);
    const otherProfile = await request('GET', `/api/auth/profile/${own.userId}`, null, foreign.token);
    assert.doesNotMatch(JSON.stringify(otherProfile.data), /gross|deductions|Fixture review/);
});
