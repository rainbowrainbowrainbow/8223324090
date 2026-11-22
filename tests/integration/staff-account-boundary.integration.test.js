'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

test('staff account operations enforce Park ownership and payroll/operation permissions', async t => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const database = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(database.isLocal, true);
    assertSafeIsolatedTestUrl(process.env.TEST_URL);
    const pool = new Pool({ connectionString: database.url.toString(), ssl: false });
    t.after(() => pool.end());
    const { rows: bootstrapStaff } = await pool.query('SELECT id FROM staff WHERE is_active IS TRUE');
    const marker = 'qa-staff-' + randomUUID().slice(0, 8);
    const password = randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    async function api(path, { actor, method = 'GET', body, headers = {}, context = actor?.context || 'event_genix' } = {}) {
        const response = await fetch(new URL(path, process.env.TEST_URL), {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Business-Context': context,
                ...headers,
                ...(actor ? { Authorization: 'Bearer ' + actor.token } : {})
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, data: await response.json() };
    }
    async function business(context, organizationId = null) {
        const { rows: [org] } = organizationId ? { rows: [{ id: organizationId }] } : await pool.query(
            "INSERT INTO organizations (slug, name, status) VALUES ($1, $1, 'active') RETURNING id", [marker + '-' + context]
        );
        const { rows: [row] } = await pool.query(
            `INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode, modules, status)
             VALUES ($1, $2, $2, $2, 'membership', '[]', 'active')
             ON CONFLICT (context_key) DO UPDATE SET organization_id = EXCLUDED.organization_id,
                 access_mode = 'membership', status = 'active' RETURNING id`, [org.id, context]
        );
        return { id: row.id, organizationId: org.id, context };
    }
    async function actor(suffix, role, business, deny = [], allow = []) {
        const username = marker + '-' + suffix;
        const { rows: [user] } = await pool.query(
            'INSERT INTO users (username, password_hash, name, role) VALUES ($1, $2, $1, $3) RETURNING id',
            [username, passwordHash, role]
        );
        await pool.query(
            "INSERT INTO organization_memberships (organization_id, user_id, role, is_active) VALUES ($1, $2, $3, true)",
            [business.organizationId, user.id, role === 'creator' ? 'owner' : 'member']
        );
        await pool.query(
            `INSERT INTO business_memberships (business_id, organization_id, user_id, role, action_denylist, action_allowlist, is_default, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, true, true)`, [business.id, business.organizationId, user.id, role, deny, allow]
        );
        const login = await api('/api/auth/login', { method: 'POST', context: business.context, body: { username, password } });
        assert.equal(login.status, 200);
        return { id: user.id, username, context: business.context, token: login.data.accessToken || login.data.token };
    }
    const park = await business('event_genix');
    const owner = await actor('owner', 'creator', park);
    const viewer = await actor('viewer', 'animator', park);
    const restricted = await actor('restricted', 'director', park, ['hr.payroll.view', 'hr.payroll.manage']);
    const denied = await actor('denied', 'director', park, ['hr.staff.create', 'hr.staff.profile.edit']);
    const otherOrg = await business('dar');
    const foreign = await actor('foreign', 'director', otherOrg);
    const foreignViewer = await actor('foreign-viewer', 'animator', otherOrg);
    const { rows: [staff] } = await pool.query(
        `INSERT INTO staff (name, department, position, role_type, phone, hourly_rate)
         VALUES ($1, 'animators', 'QA Animator', 'animator', 'original', 123) RETURNING id`, [marker]
    );
    const payload = (suffix, target = { mode: 'existing', id: staff.id }, extra = {}) => ({
        personal: { username: marker + '-' + suffix, name: marker, phone: 'changed' },
        staff: target,
        professions: [{ key: 'animator', isPrimary: true }],
        access: { role: 'animator', businessContexts: ['event_genix'], defaultBusinessContext: 'event_genix' },
        ...extra
    });
    const onboard = (actor, body) => api('/api/users/onboarding', { actor, method: 'POST', body });
    const readStaff = async () => (await pool.query('SELECT phone, hourly_rate FROM staff WHERE id = $1', [staff.id])).rows[0];

    await t.test('attendance authorizes the linked active team at write time', async () => {
        const lead = await actor('attendance-team', 'manager', park);
        const unlinked = await actor('attendance-no-profile', 'manager', park);
        const deniedSchedule = await actor('attendance-denied', 'manager', park, ['hr.schedule.manage']);
        const group = marker + '-attendance-team';
        let sequence = 0;
        async function person(node, active = true) {
            return (await pool.query(
                "INSERT INTO staff (name, department, position, role_type, company_structure_node_id, is_active) VALUES ($1, 'animators', 'QA', 'animator', $2, $3) RETURNING id",
                [marker + '-attendance-' + ++sequence, node, active])).rows[0].id;
        }
        const linked = await person(group);
        const teammate = await person(group);
        const otherTeam = await person(marker + '-other-attendance');
        const concurrent = await person(group);
        const inactive = await person(group, false);
        await pool.query('INSERT INTO employee_profiles (user_id, staff_id, full_name) VALUES ($1, $2, $3)',
            [lead.id, linked, marker]);
        const mark = (principal, staffId, settings = {}) => api('/api/hr/mark-absent', {
            actor: principal, method: 'POST', body: { staff_id: staffId, status: 'day_off', notes: marker }, ...settings
        });
        assert.equal((await mark(lead, teammate)).status, 200);
        for (const [principal, staffId, settings] of [
            [lead, otherTeam], [lead, inactive], [unlinked, teammate], [deniedSchedule, teammate],
            [lead, teammate, { context: 'dar' }], [lead, teammate, { headers: { 'X-Business-Scope': 'all' } }]
        ]) {
            assert.equal((await mark(principal, staffId, settings)).status, 403);
        }

        const ownArrival = await person(group);
        const outsideArrival = await person(marker + '-outside-arrival');
        const attendance = (principal, path, body, method = 'POST') => api('/api/hr/' + path, {
            actor: principal, method, body
        });
        assert.equal((await attendance(lead, 'clock-in', { staff_id: outsideArrival })).status, 403);
        assert.equal((await attendance(lead, 'clock-in', { staff_id: ownArrival })).status, 200);
        assert.equal((await attendance(owner, 'clock-in', { staff_id: outsideArrival })).status, 200);
        const { rows: [outsideRecord] } = await pool.query(
            'SELECT id, clock_in, clock_out, updated_at FROM hr_time_records WHERE staff_id=$1', [outsideArrival]);
        const target = { staff_id: outsideArrival, record_id: outsideRecord.id, clock_in: outsideRecord.clock_in.toISOString() };
        assert.equal((await attendance(lead, 'clock-out', target)).status, 403);
        assert.equal((await attendance(lead, 'clock-in/cancel', target)).status, 403);
        const correction = `records/${outsideRecord.id}/correct`;
        assert.equal((await attendance(lead, correction, { staff_id: outsideArrival, notes: marker }, 'PUT')).status, 403);
        assert.equal((await attendance(lead, correction, { staff_id: ownArrival, notes: marker }, 'PUT')).status, 400);
        assert.deepEqual((await pool.query('SELECT id, clock_in, clock_out, updated_at FROM hr_time_records WHERE id=$1',
            [outsideRecord.id])).rows, [outsideRecord]);
        const closed = await attendance(owner, 'clock-out', target);
        assert.equal(closed.status, 200);
        assert.equal(closed.data.data.can_cancel_departure, true);
        const undo = { ...target, action: 'cancel', record_version: closed.data.data.record_version };
        const deniedUndo = await attendance(lead, 'clock-out', undo);
        assert.equal(deniedUndo.status, 403);
        assert.equal(deniedUndo.data.code, 'ATTENDANCE_STAFF_SCOPE_DENIED');
        const reopened = await attendance(owner, 'clock-out', undo);
        assert.equal(reopened.status, 200);
        assert.equal(reopened.data.data.id, outsideRecord.id);
        assert.equal(reopened.data.data.clock_in, target.clock_in);
        assert.equal(reopened.data.data.clock_out, null);
        await pool.query('UPDATE staff SET is_active=false WHERE id = ANY($1::int[])', [[ownArrival, outsideArrival]]);

        const transfer = await pool.connect();
        let pending;
        try {
            await transfer.query('BEGIN');
            const transferPid = (await transfer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            await transfer.query('UPDATE staff SET company_structure_node_id=$2 WHERE id=$1', [concurrent, marker + '-moved']);
            pending = mark(lead, concurrent);
            let blocked = false;
            for (let attempt = 0; attempt < 80 && !blocked; attempt += 1) {
                const result = await pool.query('SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked', [transferPid]);
                blocked = result.rows[0].blocked;
                if (!blocked) await new Promise(resolve => setTimeout(resolve, 25));
            }
            assert.equal(blocked, true, 'request must reach the structural lock before the transfer is committed');
            await transfer.query('COMMIT');
            const result = await pending;
            assert.equal(result.status, 403);
            assert.equal(result.data.code, 'ATTENDANCE_STAFF_SCOPE_DENIED');
        } finally {
            await transfer.query('ROLLBACK').catch(() => {});
            transfer.release();
            await pending?.catch(() => {});
        }

        await pool.query('UPDATE employee_profiles SET is_active=false WHERE user_id=$1', [lead.id]);
        assert.equal((await mark(lead, teammate)).status, 403);
        await pool.query('UPDATE employee_profiles SET is_active=true WHERE user_id=$1', [lead.id]);
        await pool.query('UPDATE business_memberships SET is_active=false WHERE user_id=$1 AND business_id=$2', [lead.id, park.id]);
        assert.equal((await mark(lead, teammate)).status, 403);
        const record = await pool.query('SELECT staff_id, status FROM hr_time_records WHERE staff_id=ANY($1::int[])', [
            [teammate, otherTeam, concurrent, inactive]
        ]);
        assert.deepEqual(record.rows, [{ staff_id: teammate, status: 'day_off' }]);
        const logged = await pool.query("SELECT staff_id FROM hr_audit_log WHERE staff_id=ANY($1::int[]) AND action='mark_absent'", [
            [teammate, otherTeam, concurrent, inactive]
        ]);
        assert.deepEqual(logged.rows, [{ staff_id: teammate }]);
    });

    await t.test('copy week checks resolved raw categories and revalidates the explicit team at apply', async () => {
        const lead = await actor('copy-team', 'manager', park);
        const group = marker + '-copy-team';
        const fromMonday = '2099-01-12';
        const toMonday = '2099-01-19';
        const categories = [['animators', 'animator'], ['trampoline', 'instructor'], ['cafe', 'cook'], ['cleaning', 'cleaner']];
        const staffIds = [];
        for (const [department, role] of categories) {
            const { rows: [member] } = await pool.query(
                "INSERT INTO staff (name, department, position, role_type, company_structure_node_id) VALUES ($1, $2, 'QA', $3, $4) RETURNING id",
                [marker + '-copy-' + department, department, role, group]);
            staffIds.push(member.id);
            await pool.query("INSERT INTO staff_schedule (staff_id, date, status, shift_start, shift_end, profession_key) VALUES ($1, $2, 'working', '09:00', '13:00', $3)",
                [member.id, fromMonday, role]);
        }
        await pool.query('INSERT INTO employee_profiles (user_id, staff_id, full_name) VALUES ($1, $2, $3)',
            [lead.id, staffIds[0], marker]);
        const copy = (payload, dryRun = false) => api('/api/staff/schedule/copy-week', {
            actor: lead, method: 'POST', body: { fromMonday, toMonday, ...payload, dryRun, rejectConflicts: true }
        });

        for (const [department] of categories) {
            const preview = await copy({ department }, true);
            assert.equal(preview.status, 200, JSON.stringify({ department, code: preview.data.code, error: preview.data.error }));
            assert.equal(preview.data.count, 1);
        }
        const [animator, trampoline, cook] = staffIds;
        const copyResult = await copy({ department: 'animators' });
        assert.equal(copyResult.status, 200, JSON.stringify({ code: copyResult.data.code, error: copyResult.data.error }));
        assert.equal(copyResult.data.count, 1);
        assert.equal((await copy({ staffIds: [animator] })).status, 409);
        assert.equal((await copy({ staffIds: [] }, true)).status, 403);
        assert.equal((await copy({ displayGroup: 'all' }, true)).status, 403);
        assert.equal((await copy({ staffIds: [cook], department: 'trampoline' }, true)).status, 400);

        const payload = { staffIds: [trampoline, cook], displayGroup: 'trampoline' };
        assert.equal((await copy(payload, true)).data.count, 2);
        await pool.query('UPDATE staff SET company_structure_node_id=$2 WHERE id=$1', [cook, marker + '-copy-foreign']);
        assert.equal((await copy(payload)).status, 403);
        assert.equal((await copy({ department: 'cafe', displayGroup: 'trampoline' }, true)).status, 403);
        const targets = await pool.query('SELECT staff_id FROM staff_schedule WHERE staff_id=ANY($1::int[]) AND date=$2 ORDER BY staff_id',
            [staffIds, toMonday]);
        assert.deepEqual(targets.rows, [{ staff_id: animator }]);
    });

    await t.test('explicit existing-card conditions validate locked professions without replacing assignments', async () => {
        const { rows: [person] } = await pool.query(
            `INSERT INTO staff (name, department, position, role_type, hourly_rate)
             VALUES ($1, 'QA', 'QA', 'animator', 321) RETURNING id`, [marker + '-conditions']
        );
        await pool.query(`INSERT INTO staff_role_assignments
            (staff_id, profession_key, is_primary, status, admission_status)
            VALUES ($1, 'animator', true, 'active', 'approved')`, [person.id]);
        const body = { personal: { name: marker + '-conditions', username: marker + '-conditions' },
            staff: { mode: 'existing', id: person.id }, access: { role: 'animator' },
            conditions: { professionKey: 'waiter', rateMode: 'explicit', hourlyRate: 456,
                shiftPreferences: [{ dayType: 'weekday', startTime: null, endTime: null }, { dayType: 'weekend', startTime: null, endTime: null }] } };
        const invalid = await onboard(owner, body);
        assert.equal(invalid.status, 400);
        assert.equal(invalid.data.code, 'ACCOUNT_ONBOARDING_CONDITION_PROFESSION_MISMATCH');
        assert.equal((await pool.query('SELECT id FROM users WHERE username=$1', [body.personal.username])).rowCount, 0);
        body.conditions.professionKey = 'animator';
        assert.equal((await onboard(restricted, body)).status, 403);
        const before = (await pool.query('SELECT id, profession_key, is_primary, status, admission_status FROM staff_role_assignments WHERE staff_id=$1', [person.id])).rows;
        const result = await onboard(owner, body);
        assert.equal(result.status, 200, result.data.code);
        assert.equal(result.data.receipt.staff.id, person.id);
        assert.deepEqual((await pool.query('SELECT id, profession_key, is_primary, status, admission_status FROM staff_role_assignments WHERE staff_id=$1', [person.id])).rows, before);
        assert.equal((await pool.query('SELECT hourly_rate FROM staff WHERE id=$1', [person.id])).rows[0].hourly_rate, '321.00');
        assert.equal(Number((await pool.query('SELECT hourly_rate FROM staff_profession_rates WHERE staff_id=$1 AND profession_key=$2', [person.id, 'animator'])).rows[0].hourly_rate), 456);
    });

    await t.test('account-only onboarding preserves existing and legacy staff setup, assignments and pay', async () => {
        for (const legacy of [false, true]) {
            const { rows: [person] } = await pool.query(
                `INSERT INTO staff (name, department, position, role_type, phone, hourly_rate, secondary_professions)
                 VALUES ($1, 'QA', 'QA', $2, 'unchanged-phone', 321, $3::jsonb) RETURNING id`,
                [marker + '-preserve-' + legacy, legacy ? null : 'animator', JSON.stringify(legacy ? [] : ['waiter'])]
            );
            if (!legacy) await pool.query(
                `INSERT INTO staff_role_assignments (staff_id, profession_key, is_primary, status)
                 VALUES ($1, 'animator', true, 'active')`, [person.id]
            );
            const snapshot = async () => ({
                person: (await pool.query('SELECT name, role_type, secondary_professions, phone, hourly_rate, rate_unit, company_structure_node_id FROM staff WHERE id=$1', [person.id])).rows,
                assignments: (await pool.query('SELECT * FROM staff_role_assignments WHERE staff_id=$1 ORDER BY id', [person.id])).rows
            });
            const before = await snapshot();
            const body = { personal: { name: marker + '-preserve-' + legacy, username: marker + '-preserve-' + legacy },
                staff: { mode: 'existing', id: person.id }, access: { role: 'animator', defaultBusinessContext: 'event_genix' } };
            const key = randomUUID();
            const result = await api('/api/users/onboarding', { actor: owner, method: 'POST', body, headers: { 'Idempotency-Key': key } });
            assert.equal(result.status, 200, JSON.stringify(result.data.code));
            assert.equal(result.data.receipt.staff.id, person.id);
            assert.deepEqual(result.data.receipt.professions.map(item => item.key).sort(), legacy ? [] : ['animator', 'waiter']);
            assert.equal(result.data.receipt.staff.created, false);
            assert.deepEqual(await snapshot(), before);
            const retry = await api('/api/users/onboarding', { actor: owner, method: 'POST', body, headers: { 'Idempotency-Key': key } });
            assert.equal(retry.status, 200);
            assert.equal(retry.data.receipt.staff.id, person.id);
            assert.equal(retry.data.receipt.account.id, result.data.receipt.account.id);
            assert.deepEqual(await snapshot(), before);
        }
    });

    await t.test('two operators cannot create two accounts for the same saved person', async () => {
        const { rows: [person] } = await pool.query(`INSERT INTO staff (name, department, position, role_type, hourly_rate)
            VALUES ($1, 'QA', 'QA', 'animator', 123) RETURNING id`, [marker + '-two-operators']);
        const bodies = [0, 1].map(index => ({ personal: { name: marker + '-two-operators', username: marker + '-race-' + index },
            staff: { mode: 'existing', id: person.id }, access: { role: 'animator' } }));
        const results = await Promise.all([owner, restricted].map((principal, index) => onboard(principal, bodies[index])));
        assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
        assert.equal(results.find(result => result.status === 409).data.code, 'ACCOUNT_ONBOARDING_STAFF_OCCUPIED');
        assert.equal((await pool.query('SELECT id FROM users WHERE username=ANY($1::text[])', [bodies.map(body => body.personal.username)])).rowCount, 1);
        assert.equal((await pool.query('SELECT user_id FROM employee_profiles WHERE staff_id=$1 AND user_id IS NOT NULL', [person.id])).rowCount, 1);
        assert.equal((await pool.query('SELECT hourly_rate FROM staff WHERE id=$1', [person.id])).rows[0].hourly_rate, '123.00');
    });

    await t.test('an already authenticated operator cannot onboard after membership revocation', async () => {
        const principal = await actor('revoked-onboarding', 'director', park);
        assert.equal((await api('/api/users/onboarding/options', { actor: principal })).status, 200);
        await pool.query('UPDATE business_memberships SET is_active=false WHERE user_id=$1 AND business_id=$2', [principal.id, park.id]);
        const body = payload('revoked-attempt', { mode: 'new', department: 'QA', position: 'QA' }, {
            personal: { name: marker + '-revoked-attempt', username: marker + '-revoked-attempt' }
        });
        assert.equal((await onboard(principal, body)).status, 403);
        assert.equal((await pool.query('SELECT id FROM users WHERE username=$1', [body.personal.username])).rowCount, 0);
        assert.equal((await pool.query('SELECT id FROM staff WHERE name=$1', [body.personal.name])).rowCount, 0);
    });

    await t.test('foreign account management cannot reach Park staff or links', async () => {
        for (const path of ['/api/users/onboarding/options', '/api/users/staff-options', '/api/users/link-conflicts', '/api/employees']) {
            assert.equal((await api(path, { actor: foreign })).status, 403, path);
        }
        assert.equal((await onboard(foreign, payload('foreign-link'))).status, 403);
        assert.equal((await api('/api/users/' + viewer.id + '/profile', {
            actor: foreign, method: 'PATCH', body: { name: 'changed', staffId: staff.id }
        })).status, 403);
        assert.equal((await readStaff()).phone, 'original');
    });

    await t.test('explicit denies apply to onboarding create and existing setup', async () => {
        assert.equal((await onboard(denied, payload('denied-new', {
            mode: 'new', department: 'animators', position: 'QA Animator'
        }))).status, 403);
        assert.equal((await onboard(denied, payload('denied-edit'))).status, 403);
        assert.equal((await readStaff()).phone, 'original');
    });

    await t.test('Park admin onboards a worker using the role preset and activates only Park membership', async () => {
        const admin = await actor('park-admin', 'admin', park);
        const foreignAdmin = await actor('foreign-admin', 'admin', otherOrg);
        const deniedAdmin = await actor('denied-admin', 'admin', park, ['hr.staff.accounts.onboard']);
        for (const principal of [viewer, foreignAdmin, deniedAdmin]) {
            assert.equal((await api('/api/users/onboarding/options', { actor: principal })).status, 403);
        }
        const options = await api('/api/users/onboarding/options', { actor: admin });
        assert.equal(options.status, 200);
        assert.equal(options.data.parkWorkerOnboarding, true);
        assert.ok(options.data.allowedAccountRoles.includes('animator'));
        assert.ok(!options.data.allowedAccountRoles.includes('admin'));
        assert.equal(options.data.canManagePayrollRules, false);
        assert.equal(Object.hasOwn(options.data.staff.find(item => item.id === staff.id), 'hourly_rate'), false);
        assert.equal((await api('/api/users', { actor: admin })).status, 403);
        const target = { mode: 'new', department: 'animators', position: 'QA Animator' };
        const body = payload('park-worker', target, {
            personal: { name: marker + '-park-worker', username: marker + '-park-worker' }
        });
        for (const access of [{ role: 'admin' }, { role: 'animator', extraRoles: ['admin'] }, { role: 'animator', pageAllowlist: ['/hr'] }]) {
            assert.equal((await onboard(admin, { ...body, access })).status, 403);
        }
        assert.equal((await onboard(admin, { ...body, staff: { ...target, hourlyRate: 321 } })).status, 403);
        assert.equal((await pool.query('SELECT id FROM users WHERE username=$1', [body.personal.username])).rowCount, 0);
        const key = randomUUID();
        const submit = () => api('/api/users/onboarding', { actor: admin, method: 'POST', body, headers: { 'Idempotency-Key': key } });
        const created = await submit();
        assert.equal(created.status, 200, JSON.stringify(created.data.code));
        assert.equal(created.data.accessState, 'active');
        const userId = created.data.receipt.account.id;
        const staffId = created.data.receipt.staff.id;
        const replayed = await submit();
        assert.equal(replayed.status, 200);
        assert.equal(replayed.data.receipt.account.id, userId);
        assert.equal(replayed.data.receipt.staff.id, staffId);
        assert.equal(replayed.data.credential, null);
        const { rows } = await pool.query(`SELECT bm.business_id, bm.role, om.role AS organization_role, ep.staff_id
            FROM business_memberships bm JOIN organization_memberships om USING (organization_id,user_id)
            JOIN employee_profiles ep ON ep.user_id=bm.user_id AND ep.is_active
            WHERE bm.user_id=$1 AND bm.is_active AND om.is_active`, [userId]);
        assert.deepEqual(rows, [{ business_id: park.id, role: 'animator', organization_role: 'member', staff_id: staffId }]);
        assert.equal((await pool.query('SELECT 1 FROM chat_channel_members WHERE user_id=$1', [userId])).rowCount, 0);
    });

    await t.test('payroll-denied account manager gets no rates and cannot write aliases or nested rates', async () => {
        const options = await api('/api/users/onboarding/options', { actor: restricted });
        assert.equal(options.status, 200);
        const row = options.data.staff.find(item => item.id === staff.id);
        assert.ok(row);
        assert.equal(Object.hasOwn(row, 'hourly_rate'), false);
        assert.equal(Object.hasOwn(row, 'rate_unit'), false);
        assert.deepEqual(row.profession_conditions, []);
        for (const [index, fields] of [{ hourlyRate: 321 }, { hourly_rate: 321 }, { rateUnit: 'month' }, { rate_unit: 'month' }].entries()) {
            assert.equal((await onboard(restricted, payload('rate-' + index, { mode: 'existing', id: staff.id, ...fields }))).status, 403);
        }
        assert.equal((await onboard(restricted, payload('nested-rate', undefined, {
            conditions: [{ professionKey: 'animator', rate: { mode: 'explicit', amount: 321 }, shiftPreferences: [{ dayType: 'weekday' }, { dayType: 'weekend' }] }]
        }))).status, 403);
        assert.deepEqual(await readStaff(), { phone: 'original', hourly_rate: '123.00' });
    });

    await t.test('both creation paths reject invalid staff data without storing a record', async () => {
        const staffDraft = { name: marker + '-invalid', department: 'animators', position: 'QA Animator' };
        for (const fields of [{ name: '   ' }, { hireDate: '2026-02-30' }, { department: 'x'.repeat(51) }, { role_type: 'unknown_test_profession' }]) {
            assert.equal((await api('/api/staff', { actor: owner, method: 'POST', body: { ...staffDraft, ...fields } })).status, 400);
        }
        const badDate = { mode: 'new', department: staffDraft.department, position: staffDraft.position, hireDate: '2026-02-30' };
        assert.equal((await onboard(owner, payload('invalid-date', badDate))).status, 400);
        assert.equal((await pool.query('SELECT id FROM staff WHERE name = $1', [staffDraft.name])).rowCount, 0);
    });

    await t.test('isolates each delegated action and preserves full manager fields with an extra narrow grant', async () => {
        const view = 'hr.staff.view';
        const create = 'hr.staff.create';
        const edit = 'hr.staff.profile.edit';
        const manage = 'hr.staff.manage';
        const viewOnly = await actor('view-only', 'animator', park, [manage], [view]);
        const createOnly = await actor('create-only', 'animator', park, [manage], [view, create]);
        const editOnly = await actor('edit-only', 'animator', park, [manage], [view, edit]);
        const fullWithExtra = await actor('manager-extra', 'creator', park, [], [edit]);
        const draft = { name: marker + '-narrow', department: 'animators', position: 'QA Animator', role_type: 'animator' };
        const newCard = (principal, name = draft.name) => api('/api/staff', {
            actor: principal, method: 'POST', body: { ...draft, name }
        });
        assert.equal((await newCard(viewOnly)).status, 403);
        assert.equal((await newCard(editOnly)).status, 403);
        const created = await newCard(createOnly);
        assert.ok([200, 201].includes(created.status), JSON.stringify(created.data));
        const path = '/api/hr/staff/' + created.data.data.id;
        const detail = await api(path, { actor: viewOnly });
        assert.equal(detail.status, 200);
        const headers = { 'X-Staff-Profile-Revision': detail.data.data.profile_revision };
        const update = (principal, body) => api(path, { actor: principal, method: 'PUT', headers, body });
        assert.equal((await update(viewOnly, { phone: '5550001' })).status, 403);
        assert.equal((await update(createOnly, { phone: '5550001' })).status, 403);
        for (const extra of [{ role_type: 'waiter' }, { is_active: false }, { hourly_rate: 500 }]) {
            assert.equal((await update(editOnly, { phone: '5550001', ...extra })).status, 400);
        }
        const read = async () => (await pool.query('SELECT phone, is_active, role_type, hourly_rate FROM staff WHERE id = $1', [created.data.data.id])).rows[0];
        assert.deepEqual(await read(), { phone: null, is_active: true, role_type: 'animator', hourly_rate: '0.00' });
        assert.equal((await update(editOnly, { phone: '5550002' })).status, 200);
        assert.equal((await read()).phone, '5550002');
        for (const principal of [owner, fullWithExtra]) {
            const full = await api(path, { actor: principal });
            assert.equal(full.status, 200);
            assert.equal(full.data.staffCardAccess.editableFields, null);
        }
    });

    await t.test('Park owner links the existing account to the exact card', async () => {
        const response = await api('/api/staff/' + staff.id + '/link', {
            actor: owner, method: 'POST', body: { userId: viewer.id }
        });
        assert.equal(response.status, 200);
        const { rows } = await pool.query('SELECT user_id FROM employee_profiles WHERE staff_id = $1 AND user_id IS NOT NULL', [staff.id]);
        assert.deepEqual(rows, [{ user_id: viewer.id }]);
        const newCard = await api('/api/staff', { actor: owner, method: 'POST', body: {
            name: marker + '-link-conflict', department: 'animators', position: 'QA Animator'
        } });
        const otherLink = '/api/staff/' + newCard.data.data.id + '/link';
        assert.equal((await api(otherLink, { actor: owner, method: 'POST', body: { userId: viewer.id } })).status, 409);
        assert.equal((await api(otherLink, { actor: owner, method: 'POST', body: { userId: foreignViewer.id } })).status, 403);
        const foreignUsers = await api('/api/users', { actor: foreign });
        assert.equal(foreignUsers.status, 200);
        assert.equal(foreignUsers.data.find(row => row.id === viewer.id).staff_id, null);
    });

    await t.test('staff creation is durable across ten concurrent repeats, and distinct actors see a duplicate candidate', async () => {
        const name = marker + '-retry';
        const draft = { name, department: 'animators', position: 'QA Animator', role_type: 'animator' };
        const key = randomUUID();
        const headers = { 'Idempotency-Key': key };
        const requests = await Promise.all(Array.from({ length: 10 }, () =>
            api('/api/staff', { actor: owner, method: 'POST', headers, body: draft })));
        assert.ok(requests.every(result => result.status === 200), JSON.stringify(requests.map(result => result.status)));
        const ids = new Set(requests.map(result => result.data.data.id));
        assert.equal(ids.size, 1);
        const [id] = ids;
        assert.equal((await pool.query('SELECT id FROM staff WHERE name = $1', [name])).rowCount, 1);
        const lookup = '/api/staff/creation-operations/' + key;
        assert.equal((await api(lookup, { actor: owner })).data.data.id, id);
        assert.equal((await api(lookup, { actor: restricted })).status, 404);
        assert.equal((await api('/api/staff', { actor: owner, method: 'POST', headers, body: { ...draft, position: 'Changed' } })).status, 409);
        const duplicate = await api('/api/staff', { actor: restricted, method: 'POST', body: draft });
        assert.equal(duplicate.status, 409);
        assert.equal(duplicate.data.code, 'STAFF_POSSIBLE_DUPLICATE');
        assert.deepEqual(duplicate.data.candidates.map(row => row.id), [id]);
        const distinct = await api('/api/staff', { actor: restricted, method: 'POST', body: { ...draft, distinctStaffIds: [id] } });
        assert.equal(distinct.status, 200);
        assert.notEqual(distinct.data.data.id, id);
    });

    await t.test('onboarding repeats retain the staff and account IDs without replaying credentials', async () => {
        const body = payload('onboarding-retry', { mode: 'new', department: 'animators', position: 'QA Animator' }, {
            personal: { name: marker + '-onboarding-retry', username: marker + '-onboarding-retry' }
        });
        const key = randomUUID();
        const headers = { 'Idempotency-Key': key };
        const results = await Promise.all(Array.from({ length: 10 }, () =>
            api('/api/users/onboarding', { actor: owner, method: 'POST', headers, body })));
        assert.ok(results.every(result => result.status === 200), JSON.stringify(results.map(result => result.status)));
        assert.equal(results.filter(result => result.data.credential?.password).length, 1);
        const [staffId] = new Set(results.map(result => result.data.receipt.staff.id));
        const [accountId] = new Set(results.map(result => result.data.receipt.account.id));
        assert.ok(results.every(result => result.data.receipt.staff.id === staffId && result.data.receipt.account.id === accountId));
        const recovered = await api('/api/users/onboarding/operations/' + key, { actor: owner });
        assert.equal(recovered.status, 200);
        assert.equal(recovered.data.credential, null);
        assert.equal(recovered.data.receipt.staff.id, staffId);
        assert.equal(recovered.data.receipt.account.id, accountId);
        assert.equal(recovered.data.accessState, 'pending_membership');
        assert.equal((await pool.query('SELECT id FROM staff WHERE name = $1', [body.personal.name])).rowCount, 1);
        assert.equal((await pool.query('SELECT 1 FROM business_memberships WHERE user_id = $1', [accountId])).rowCount, 0);
        const activation = await api(`/api/organizations/${park.organizationId}/members/${accountId}`, {
            actor: owner, method: 'PUT', body: { businessId: park.id, role: 'animator', isDefault: true }
        });
        assert.equal(activation.status, 200);
        const activeReceipt = await api('/api/users/onboarding/operations/' + key, { actor: owner });
        assert.equal(activeReceipt.data.accessState, 'active');
        assert.equal(activeReceipt.data.receipt.staff.id, staffId);
        const credential = results.find(result => result.data.credential?.password).data.credential;
        const login = await api('/api/auth/login', { method: 'POST', body: { username: credential.username, password: credential.password } });
        assert.equal(login.status, 200);
        const newActor = { context: 'event_genix', token: login.data.accessToken || login.data.token };
        assert.equal((await api('/api/users/onboarding/options', { actor: newActor })).status, 403);
    });

    await t.test('stale profile saves conflict and an old tab cannot write without a revision', async () => {
        const path = '/api/hr/staff/' + staff.id;
        const detail = await api(path, { actor: owner });
        const revision = detail.data.data.profile_revision;
        assert.match(revision, /^\d+$/);
        assert.equal((await api(path, { actor: owner, method: 'PUT', body: { phone: 'stale' } })).status, 428);
        const headers = { 'X-Staff-Profile-Revision': revision };
        const updates = await Promise.all([
            api(path, { actor: owner, method: 'PUT', headers, body: { phone: 'operator A' } }),
            api(path, { actor: restricted, method: 'PUT', headers, body: { phone: 'operator B' } })
        ]);
        assert.deepEqual(updates.map(result => result.status).sort(), [200, 409]);
        assert.equal(updates.find(result => result.status === 409).data.code, 'STAFF_PROFILE_CONFLICT');
        assert.equal((await readStaff()).phone, updates.find(result => result.status === 200).data.data.phone);
    });

    await t.test('aggregate scope and revoked membership cannot write or recover staff operations', async () => {
        const second = await business('crm', park.organizationId);
        await pool.query(
            `INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default, is_active)
             VALUES ($1, $2, $3, 'creator', false, true)`, [second.id, park.organizationId, owner.id]
        );
        const headers = { 'X-Business-Scope': 'all' };
        assert.equal((await api('/api/users/onboarding/options', { actor: owner, headers })).status, 403);
        await pool.query('UPDATE business_memberships SET is_active = false WHERE user_id = $1 AND business_id = $2', [restricted.id, park.id]);
        assert.equal((await onboard(restricted, payload('revoked-member'))).status, 403);
        assert.equal((await api('/api/staff/' + staff.id + '/link', { actor: restricted, method: 'POST', body: { userId: viewer.id } })).status, 403);
    });
    await t.test('HR and manual schedule issuance serialize on the same staff card', async () => {
        const name = marker + '-cross-entry';
        const usernames = [name + '-hr', name + '-schedule'];
        const { rows: [person] } = await pool.query(
            "INSERT INTO staff (name, department, position, role_type, hourly_rate) VALUES ($1, 'QA', 'QA', 'animator', 321) RETURNING id",
            [name]
        );
        const results = await Promise.all([
            api('/api/users/onboarding', {
                actor: owner, method: 'POST', headers: { 'Idempotency-Key': randomUUID() },
                body: {
                    deriveRoleFromStaff: true, expectedRole: 'animator', personal: { name, username: usernames[0] },
                    staff: { mode: 'existing', id: person.id }, access: { activateMembership: true },
                    issueOneTime: true, initialPassword: password
                }
            }),
            api('/api/users', {
                actor: owner, method: 'POST', headers: { 'Idempotency-Key': randomUUID() },
                body: {
                    name, username: usernames[1], role: 'waiter', password, staffId: person.id,
                    defaultBusinessContext: 'event_genix', activateMembership: true
                }
            })
        ]);
        assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
        const { rows } = await pool.query(
            'SELECT u.username, ep.staff_id FROM users u LEFT JOIN employee_profiles ep ON ep.user_id=u.id WHERE u.username=ANY($1)',
            [usernames]
        );
        assert.deepEqual(rows, [{ username: usernames[results.findIndex(result => result.status === 200)], staff_id: person.id }]);
        assert.equal((await pool.query('SELECT hourly_rate FROM staff WHERE id=$1', [person.id])).rows[0].hourly_rate, '321.00');
    });

    await t.test('manual and bulk creation report the same Park access readiness', async bulkTest => {
        // The bulk endpoint scans the entire active roster. Keep its workload
        // tied to this disposable suite's fixtures instead of the bootstrap roster.
        const bootstrapIds = bootstrapStaff.map(row => row.id);
        await pool.query('UPDATE staff SET is_active = false WHERE id = ANY($1::int[])', [bootstrapIds]);
        bulkTest.after(() => pool.query('UPDATE staff SET is_active = true WHERE id = ANY($1::int[])', [bootstrapIds]));

        const config = await api('/api/users/creation-access', { actor: owner });
        assert.equal(config.status, 200);
        assert.equal(config.data.activateMembership, true);
        assert.equal(config.data.businessContext, 'event_genix');
        const options = await api('/api/users/onboarding/options', { actor: owner });
        assert.deepEqual(options.data.membershipBusinesses.map(item => item.key), ['event_genix']);
        const outsidePark = payload('outside-park-grant');
        outsidePark.access = { role: 'animator', activateMembership: true, defaultBusinessContext: 'dar' };
        assert.equal((await onboard(owner, outsidePark)).status, 403);
        const pendingManager = await actor('pending-manager', 'director', park);
        const restrictedConfig = await api('/api/users/creation-access', { actor: pendingManager });
        assert.equal(restrictedConfig.status, 200);
        assert.equal(restrictedConfig.data.pendingMembership, true);

        const manualKey = randomUUID();
        const manualRequest = {
            username: marker + '-manual-ready', name: marker + '-manual-ready', role: 'animator', password,
            defaultBusinessContext: 'event_genix', activateMembership: true
        };
        const manualCreate = body => api('/api/users', {
            actor: owner, method: 'POST', body, headers: { 'Idempotency-Key': manualKey }
        });
        const manual = await manualCreate(manualRequest);
        assert.equal(manual.status, 200, manual.data.code);
        assert.equal(manual.data.accessState, 'active');
        const manualReplay = await manualCreate(manualRequest);
        assert.equal(manualReplay.data.user.id, manual.data.user.id);
        assert.equal(manualReplay.data.replayed, true);
        assert.equal(manualReplay.data.credential, null);
        assert.equal((await manualCreate({ ...manualRequest, name: 'Changed request' })).status, 409);
        const pending = await api('/api/users', { actor: pendingManager, method: 'POST', body: {
            username: marker + '-manual-pending', name: marker + '-manual-pending', role: 'animator', password
        } });
        assert.equal(pending.status, 200, pending.data.code);
        assert.equal(pending.data.accessState, 'pending_membership');
        const deniedGrant = await api('/api/users', { actor: pendingManager, method: 'POST', body: {
            username: marker + '-manual-denied', name: marker + '-manual-denied', role: 'animator', password,
            defaultBusinessContext: 'event_genix', activateMembership: true
        } });
        assert.equal(deniedGrant.status, 403);
        const foreignBulk = await api('/api/staff/bulk-create-accounts', { actor: foreign, method: 'POST', body: { activateMembership: true } });
        assert.equal(foreignBulk.status, 403);

        const { rows: [person] } = await pool.query(`INSERT INTO staff (name, department, position, role_type)
            VALUES ($1, 'animators', 'QA Animator', 'animator') RETURNING id`, [marker + '-bulk-ready']);
        const bulkKey = randomUUID();
        const bulkCreate = () => api('/api/staff/bulk-create-accounts', { actor: owner, method: 'POST',
            body: { activateMembership: true }, headers: { 'Idempotency-Key': bulkKey } });
        const bulk = await bulkCreate();
        assert.equal(bulk.status, 200, bulk.data.code);
        const created = bulk.data.created.find(row => row.staffId === person.id);
        assert.ok(created?.credential?.password, 'the active account has a credential');
        assert.equal(created.accessState, 'active');
        const bulkReplay = await bulkCreate();
        assert.equal(bulkReplay.data.replayed, true);
        const recovered = bulkReplay.data.created.find(row => row.staffId === person.id);
        assert.equal(recovered.username, created.username);
        assert.equal(recovered.accessState, 'active');
        assert.equal(recovered.credential, null);
        const login = await api('/api/auth/login', { method: 'POST', body: {
            username: created.username, password: created.credential.password
        } });
        assert.equal(login.status, 200);
        assert.equal(login.data.user.activeBusinessContext, 'event_genix');
        assert.equal(login.data.user.role, 'animator');
        const retry = await api('/api/staff/bulk-create-accounts', { actor: owner, method: 'POST', body: { activateMembership: true } });
        assert.equal(retry.status, 200);
        assert.ok(!retry.data.created.some(row => row.staffId === person.id));
    });
    await t.test('a membership revoked while account creation waits prevents the grant and user write', async () => {
        const creator = await actor('revoked-during-grant', 'creator', park);
        const username = marker + '-revoked-request';
        const lock = await pool.connect();
        let result;
        try {
            await lock.query('BEGIN');
            await lock.query("SELECT pg_advisory_xact_lock(hashtext('eventgenix:organization-ownership'))");
            result = api('/api/users', { actor: creator, method: 'POST', body: {
                username, name: username, role: 'animator', password,
                defaultBusinessContext: 'event_genix', activateMembership: true
            } });
            let waiting = false;
            for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
                const { rows } = await pool.query(
                    `SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock'
                     AND query LIKE '%eventgenix:organization-ownership%'`
                );
                waiting = rows.length > 0;
                if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
            }
            assert.ok(waiting, 'the account operation entered the transaction and waited for authorization');
            await lock.query('UPDATE business_memberships SET is_active = false WHERE user_id = $1 AND business_id = $2',
                [creator.id, park.id]);
            await lock.query('COMMIT');
        } finally {
            await lock.query('ROLLBACK');
            lock.release();
        }
        assert.equal((await result).status, 403);
        assert.equal((await pool.query('SELECT id FROM users WHERE username = $1', [username])).rowCount, 0);
    });

    await t.test('account issuance and deactivation serialize on the same staff card in either order', async () => {
        async function waitForBlockedStatement(blockingPid, pattern) {
            for (let attempt = 0; attempt < 150; attempt++) {
                const { rows } = await pool.query(
                    `SELECT pid FROM pg_stat_activity
                     WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid)) AND query ILIKE $2`,
                    [blockingPid, pattern]
                );
                if (rows.length) return rows[0].pid;
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            assert.fail('Expected a PostgreSQL wait for ' + pattern);
        }

        for (const issueFirst of [true, false]) {
            const username = marker + (issueFirst ? '-issue-first' : '-deactivate-first');
            const { rows: [person] } = await pool.query(
                "INSERT INTO staff (name, department, position, role_type) VALUES ($1, 'QA', 'QA', 'animator') RETURNING id",
                [username]
            );
            const idempotencyKey = randomUUID();
            const issue = () => api('/api/users/onboarding', {
                actor: owner, method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
                body: {
                    deriveRoleFromStaff: true, expectedRole: 'animator',
                    personal: { name: username, username },
                    staff: { mode: 'existing', id: person.id },
                    access: { activateMembership: true },
                    issueOneTime: true, initialPassword: password
                }
            });
            const deactivate = () => api('/api/hr/staff/' + person.id + '/status', {
                actor: owner, method: 'PUT', body: { is_active: false }
            });

            const barrier = await pool.connect();
            let scheduled = [];
            try {
                await barrier.query('BEGIN');
                const { rows: [{ pid }] } = await barrier.query('SELECT pg_backend_pid() AS pid');
                await barrier.query('SELECT id FROM staff WHERE id = $1 FOR UPDATE', [person.id]);
                scheduled.push((issueFirst ? issue : deactivate)());
                const firstPid = await waitForBlockedStatement(pid, '%FROM staff%FOR UPDATE%');
                scheduled.push((issueFirst ? deactivate : issue)());
                await waitForBlockedStatement(firstPid, '%eventgenix:organization-ownership%');
            } finally {
                await barrier.query('ROLLBACK');
                barrier.release();
                await Promise.allSettled(scheduled);
            }
            const [first, second] = await Promise.all(scheduled);
            const [issued, deactivated] = issueFirst ? [first, second] : [second, first];
            assert.equal(deactivated.status, 200, JSON.stringify(deactivated.data));
            assert.equal((await pool.query('SELECT is_active FROM staff WHERE id = $1', [person.id])).rows[0].is_active, false);
            const { rows: accounts } = await pool.query(
                `SELECT u.is_active AS user_active, ep.is_active AS profile_active, ep.staff_id,
                        bm.business_id, bm.role, u.session_revoked_at IS NOT NULL AS revoked
                 FROM users u JOIN employee_profiles ep ON ep.user_id = u.id
                 JOIN business_memberships bm ON bm.user_id = u.id
                 WHERE u.username = $1`, [username]
            );
            if (issueFirst) {
                assert.equal(issued.status, 200);
                assert.deepEqual(accounts, [{ user_active: false, profile_active: false, staff_id: person.id,
                    business_id: park.id, role: 'animator', revoked: true }]);
                const replay = await issue();
                assert.equal(replay.status, 200);
                assert.equal(replay.data.replayed, true);
                assert.equal(replay.data.credential, null);
            } else {
                assert.equal(issued.status, 409);
                assert.equal(issued.data.code, 'ACCOUNT_ONBOARDING_STAFF_INACTIVE');
                assert.deepEqual(accounts, []);
                assert.equal((await pool.query('SELECT 1 FROM users WHERE username = $1', [username])).rowCount, 0);
            }
        }
    });

    await t.test('a changed staff profession requires reviewing the derived CRM role again', async () => {
        const name = marker + '-stale-role';
        const { rows: [person] } = await pool.query(
            "INSERT INTO staff (name, department, position, role_type) VALUES ($1, 'QA', 'QA', 'cook') RETURNING id", [name]
        );
        const result = await onboard(owner, {
            deriveRoleFromStaff: true, expectedRole: 'animator',
            personal: { name, username: name }, staff: { mode: 'existing', id: person.id },
            access: { activateMembership: true }
        });
        assert.equal(result.status, 409);
        assert.equal(result.data.code, 'ACCOUNT_ONBOARDING_ROLE_CHANGED');
        assert.equal((await pool.query('SELECT 1 FROM users WHERE username = $1', [name])).rowCount, 0);
    });

    await t.test('offboarding distinguishes work cycles and reports the exact schedule row selection', async () => {
        const { rows: [person] } = await pool.query(
            "INSERT INTO staff (name, department, position, role_type) VALUES ($1, 'QA', 'QA', 'animator') RETURNING id",
            [marker + '-dismissal']
        );
        const path = '/api/hr/staff/' + person.id;
        const status = isActive => api(path + '/status', { actor: owner, method: 'PUT', body: { is_active: isActive } });
        const completed = async () => (await api(path + '/offboarding', { actor: owner })).data.completed;
        const dismiss = effectiveDate => api(path + '/offboarding', {
            actor: owner, method: 'POST', body: { effective_date: effectiveDate, reason: 'QA dismissal' }
        });
        const preview = async effectiveDate => {
            const result = await api(path + '/offboarding-readiness?effective_date=' + effectiveDate, { actor: owner });
            assert.equal(result.status, 200, JSON.stringify(result.data));
            return result.data.data.schedule_cleanup;
        };
        const { rows: [dates] } = await pool.query(
            `SELECT to_char(now() AT TIME ZONE 'Europe/Kyiv' - INTERVAL '1 day', 'YYYY-MM-DD') AS yesterday,
                    to_char(now() AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM-DD') AS today,
                    to_char(now() AT TIME ZONE 'Europe/Kyiv' + INTERVAL '1 day', 'YYYY-MM-DD') AS tomorrow,
                    to_char(now() AT TIME ZONE 'Europe/Kyiv' + INTERVAL '2 days', 'YYYY-MM-DD') AS attended,
                    to_char(now() AT TIME ZONE 'Europe/Kyiv' + INTERVAL '3 days', 'YYYY-MM-DD') AS absent`
        );
        assert.equal((await status(false)).status, 200);
        assert.equal(await completed(), false);
        const first = await Promise.all([dismiss(dates.today), dismiss(dates.today)]);
        assert.deepEqual(first.map(row => row.status).sort(), [200, 409]);
        assert.equal(first.find(row => row.status === 409).data.code, 'staff_already_dismissed');
        assert.equal(await completed(), true);
        assert.equal((await status(true)).status, 200);
        assert.equal((await status(false)).status, 200);
        assert.equal(await completed(), false);

        assert.equal((await api(path + '/offboarding-readiness?effective_date=2026-02-30', { actor: owner })).status, 400);
        assert.equal((await api(path + '/offboarding-readiness?effective_date=' + dates.today, { actor: viewer })).status, 403);
        assert.deepEqual(await preview(dates.today), {
            from_date: dates.today, hr_shifts: 0, staff_schedule: 0, preserved_hr_shifts: 0, preserved_staff_schedule: 0
        });
        const scheduled = [dates.today, dates.attended, dates.absent];
        await pool.query(
            `INSERT INTO hr_shifts(staff_id, shift_date, planned_start, planned_end, shift_type, profession_key)
             SELECT $1, day, '09:00', '17:00', 'working', 'animator' FROM unnest($2::date[]) AS day`, [person.id, scheduled]
        );
        await pool.query(
            `INSERT INTO staff_schedule(staff_id, date, status)
             SELECT $1, day, 'working' FROM unnest($2::date[]) AS day`, [person.id, scheduled]
        );
        await pool.query(
            "INSERT INTO hr_time_records(staff_id, record_date, clock_in, status) VALUES ($1, $2, $2::date + TIME '09:00', 'present')",
            [person.id, dates.attended]
        );
        const todayPreview = await preview(dates.today);
        assert.deepEqual(await preview(dates.yesterday), todayPreview);
        assert.equal(todayPreview.hr_shifts, 2);
        assert.equal(todayPreview.staff_schedule, 2);
        const future = await preview(dates.tomorrow);
        assert.deepEqual(future, {
            from_date: dates.tomorrow, hr_shifts: 1, staff_schedule: 1, preserved_hr_shifts: 1, preserved_staff_schedule: 1
        });
        const second = await dismiss(dates.tomorrow);
        assert.equal(second.status, 200, JSON.stringify(second.data));
        assert.equal(second.data.schedule_cleanup.hr_shifts, future.hr_shifts);
        assert.equal(second.data.schedule_cleanup.staff_schedule, future.staff_schedule);
        for (const sql of [
            'SELECT shift_date::text AS day FROM hr_shifts WHERE staff_id = $1 ORDER BY shift_date',
            'SELECT date::text AS day FROM staff_schedule WHERE staff_id = $1 ORDER BY date'
        ]) {
            assert.deepEqual((await pool.query(sql, [person.id])).rows.map(row => row.day), [dates.today, dates.attended]);
        }
        assert.equal((await pool.query('SELECT 1 FROM hr_time_records WHERE staff_id = $1', [person.id])).rowCount, 1);
        assert.equal((await pool.query('SELECT 1 FROM staff_offboarding_events WHERE staff_id = $1', [person.id])).rowCount, 2);
        assert.equal(await completed(), true);
    });

    await t.test('bulk account issuance bounds each request and resumes an exact roster without reissuing credentials', async () => {
        const { rows: fixtures } = await pool.query(`
            INSERT INTO staff (name, department, position, role_type, unique_person_key)
            SELECT $1 || '-' || lpad(n::text, 2, '0'), 'animators', 'QA Animator', 'animator',
                CASE WHEN n = 1 THEN $1 || '.park'
                     WHEN n = 26 THEN $1 || '.second' ELSE NULL END
            FROM generate_series(1, 26) n ORDER BY n
            RETURNING id`, [marker + '-bulk-page']);
        const path = '/api/staff/bulk-create-accounts';
        const create = (batch, key = randomUUID()) => api(path, {
            actor: owner, method: 'POST', headers: { 'Idempotency-Key': key },
            body: { activateMembership: true, ...(batch !== undefined ? { batch } : {}) }
        });
        const legacy = await create(undefined);
        assert.equal(legacy.status, 409);
        assert.equal(legacy.data.code, 'BULK_ACCOUNT_BATCH_REQUIRED');
        assert.equal((await pool.query('SELECT 1 FROM employee_profiles WHERE staff_id=ANY($1::int[]) AND user_id IS NOT NULL',
            [fixtures.map(row => row.id)])).rowCount, 0);

        const key = randomUUID();
        const first = await create(null, key);
        assert.equal(first.status, 200, first.data.code);
        assert.ok(first.data.nextBatch);
        const replay = await create(null, key);
        assert.equal(replay.status, 200);
        assert.equal(replay.data.replayed, true);
        assert.deepEqual(replay.data.nextBatch, first.data.nextBatch);
        assert.ok(replay.data.created.every(row => row.credential === null));
        assert.deepEqual(replay.data.created.map(row => row.staffId).sort(), first.data.created.map(row => row.staffId).sort());

        const { rows: [late] } = await pool.query(
            "INSERT INTO staff (name, department, position, role_type) VALUES ($1, 'animators', 'QA Animator', 'animator') RETURNING id",
            [marker + '-after-bulk-snapshot']
        );
        const pages = [first.data];
        let batch = first.data.nextBatch;
        while (batch) {
            const page = await create(batch);
            assert.equal(page.status, 200, page.data.code);
            pages.push(page.data);
            if (page.data.nextBatch) {
                assert.ok(page.data.nextBatch.afterStaffId > batch.afterStaffId);
                assert.equal(page.data.nextBatch.throughStaffId, batch.throughStaffId);
            }
            batch = page.data.nextBatch;
        }
        assert.ok(pages.length >= 3);
        assert.ok(pages.every(page => page.created.length + page.skipped.length <= 12));
        const created = pages.flatMap(page => page.created);
        const skipped = pages.flatMap(page => page.skipped);
        assert.equal(new Set(created.map(row => row.staffId)).size, created.length);
        assert.ok(created.every(row => row.businessAccessReady && row.credential?.password));
        const [duplicate] = fixtures.slice(-1);
        assert.ok(skipped.some(row => row.staffId === duplicate.id && row.reason === 'duplicate_person_key'));
        const testedIds = new Set(fixtures.slice(0, -1).map(row => row.id));
        assert.equal(created.filter(row => testedIds.has(row.staffId)).length, testedIds.size);
        const deferred = await pool.query('SELECT 1 FROM employee_profiles WHERE staff_id=ANY($1::int[]) AND user_id IS NOT NULL', [[late.id, duplicate.id]]);
        assert.equal(deferred.rowCount, 0);
    });
});
