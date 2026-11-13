'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { withDeletionRouter } = require('../helpers/park-hr-deletion-router');

test('Park manager can upload, preview, download, archive and restore a private document', async () => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Pool({ connectionString: target.url.toString() });
    try {
        const fixture = await db.query("INSERT INTO staff (name, department, position) VALUES ('Synthetic documents', 'admin', 'QA'), ('Synthetic other staff', 'admin', 'QA') RETURNING id");
        const [staff, other] = fixture.rows;
        await withDeletionRouter(async ({ request, state }) => {
            const path = `/staff/${staff.id}/documents`;
            const payload = new FormData();
            payload.append('document', new Blob(['%PDF-1.4 synthetic'], { type: 'application/pdf' }), 'документ.pdf');
            const uploaded = await request(path, { method: 'POST', body: payload });
            assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
            const id = uploaded.body.data.id;
            const list = await request(path);
            assert.equal(list.body.data[0].id, id);
            assert.equal(list.body.data[0].file_data, undefined);
            for (const action of ['preview', 'download']) {
                const response = await request(`${path}/${id}/${action}`);
                assert.equal(response.status, 200);
                assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8''/);
                assert.match(response.headers.get('cache-control'), /no-store/);
                assert.equal(response.body, '%PDF-1.4 synthetic');
                assert.equal((await request(`/staff/${other.id}/documents/${id}/${action}`)).status, 404);
            }
            assert.equal((await request(`${path}/${id}`, { method: 'DELETE' })).status, 200);
            assert.deepEqual((await request(path)).body.data, []);
            assert.equal((await request(path + '?include_archived=true')).body.data[0].status, 'archived');
            assert.equal((await request(`${path}/${id}/restore`, { method: 'PUT' })).status, 200);
            state.failSql = 'INSERT INTO hr_audit_log';
            assert.equal((await request(`${path}/${id}`, { method: 'DELETE' })).status, 500);
            state.failSql = null;
            assert.equal((await request(path)).body.data[0].status, 'active');

            const medical = `/staff/${staff.id}/medical-book`;
            const medicalPayload = { issued_at: '2026-01-01', expires_at: '2099-01-01', document_id: id };
            assert.equal((await request(medical, { method: 'POST', body: { ...medicalPayload, business_context: 'dar' } })).status, 403);
            const book = await request(medical, { method: 'POST', body: medicalPayload });
            assert.equal(book.status, 200, JSON.stringify(book.body));
            assert.equal((await request(medical)).body.data[0].business_context, 'event_genix');
            assert.equal((await request(`${medical}/${book.body.data.id}`, { method: 'PATCH', body: { status: 'revoked' } })).status, 200);
        }, db, { realServices: ['hrStaffDocuments', 'hrStaffMedicalBook'] });
    } finally { await db.end(); }
});

test('deletion on the fully migrated disposable schema', async () => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Pool({ connectionString: target.url.toString() });
    try {
        const person = await db.query("INSERT INTO staff (name, department, position) VALUES ('Synthetic delete fixture', 'admin', 'QA') RETURNING id");
        const id = person.rows[0].id;
        await withDeletionRouter(async ({ request }) => {
            const path = `/staff/${id}`;
            const remove = () => request(path, { method: 'DELETE', body: { confirmation: 'ТАК' } });
            await db.query("INSERT INTO staff_schedule (staff_id, date) VALUES ($1, '2099-01-01')", [id]);
            const blocked = await request(path + '/delete-readiness');
            assert.equal(blocked.status, 200);
            assert.equal(blocked.body.data.can_delete, false);
            assert.equal((await remove()).status, 409);
            await db.query('DELETE FROM staff_schedule WHERE staff_id = $1', [id]);
            const ready = await request(path + '/delete-readiness');
            assert.equal(ready.status, 200, JSON.stringify(ready.body));
            assert.equal(ready.body.data.can_delete, true, JSON.stringify(ready.body));
            assert.equal((await remove()).status, 200);
            assert.equal((await db.query('SELECT count(*)::int AS count FROM staff WHERE id = $1', [id])).rows[0].count, 0);
            assert.equal((await db.query("SELECT count(*)::int AS count FROM hr_audit_log WHERE action = 'staff_delete_permanent' AND details::text LIKE $1", [`%Synthetic delete fixture%`])).rows[0].count, 1);
        }, db);
    } finally { await db.end(); }
});

test('Park workflow writes enforce profile revision, inventory scope and account scope', async () => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);
    assert.equal(target.isLocal, true);
    const db = new Pool({ connectionString: target.url.toString() });
    try {
        const { rows: [staff] } = await db.query(
            "INSERT INTO staff (name, department, position) VALUES ('Synthetic move', 'admin', 'QA') RETURNING id, xmin::text AS revision"
        );
        const { rows: [stock] } = await db.query(
            "INSERT INTO warehouse_stock (name, category, quantity, unit, is_active, business_context) VALUES ('Synthetic stock', 'qa', 5, 'unit', true, 'event_genix') RETURNING id"
        );
        await withDeletionRouter(async ({ request, state }) => {
            const path = `/staff/${staff.id}`;
            const move = () => request(path, { method: 'PUT', body: { hr_pool_status: 'reserve' },
                headers: { 'X-Staff-Profile-Revision': staff.revision } });
            const moved = await move();
            assert.equal(moved.status, 200, state.lastError || JSON.stringify(moved.body));
            assert.equal(moved.body.data.hr_pool_status, 'reserve');
            assert.equal((await move()).status, 409);

            const issue = () => request(path + '/resources', { method: 'POST',
                body: { resource_kind: 'warehouse_stock', warehouse_stock_id: stock.id, quantity: 2 } });
            const issued = await issue();
            assert.equal(issued.status, 200, JSON.stringify(issued.body));
            const returned = await request(`${path}/resources/${issued.body.data.id}/return`, { method: 'PUT', body: {} });
            assert.equal(returned.status, 200, JSON.stringify(returned.body));
            assert.equal(Number((await db.query('SELECT quantity FROM warehouse_stock WHERE id = $1', [stock.id])).rows[0].quantity), 5);
            await db.query("UPDATE warehouse_stock SET business_context = 'dar' WHERE id = $1", [stock.id]);
            assert.notEqual((await issue()).status, 200);
            assert.deepEqual((await request(path + '/resources?include_returned=true')).body.data, []);

            const { rows: [user] } = await db.query(
                "INSERT INTO users (username, password_hash, name, role, business_contexts) VALUES ('synthetic_hr_shared', 'unused', 'Synthetic shared', 'animator', ARRAY['event_genix','dar']) RETURNING id"
            );
            await db.query("INSERT INTO employee_profiles (user_id, staff_id, full_name) VALUES ($1, $2, 'Synthetic shared')", [user.id, staff.id]);
            const status = await request(path + '/status', { method: 'PUT', body: { is_active: false } });
            assert.equal(status.status, 409, JSON.stringify(status.body));
            assert.equal(status.body.code, 'STAFF_ACCOUNT_SHARED_BUSINESS');
            assert.equal((await db.query('SELECT is_active FROM staff WHERE id = $1', [staff.id])).rows[0].is_active, true);

            const structure = await request('/company-structure');
            assert.equal(structure.body.structureAccess.readOnly, false);
            const body = { ...structure.body.data, baseUpdatedAt: structure.body.data.updatedAt,
                nodes: [{ id: 'synthetic-root', title: 'Synthetic root', parentId: null, description: 'Retain this text' }] };
            const saved = await request('/company-structure', { method: 'PUT', body });
            assert.equal(saved.status, 200, JSON.stringify(saved.body));
            assert.equal((await request('/company-structure')).body.data.nodes[0].description, 'Retain this text');
            assert.equal((await request('/company-structure', { method: 'PUT', body })).status, 409);

            const template = await request('/onboarding/templates', { method: 'POST',
                body: { name: 'Synthetic checklist', items: [{ id: 1, title: 'Synthetic step', done: false }] } });
            assert.equal(template.status, 200, JSON.stringify(template.body));
            const { rows: [progress] } = await db.query(
                'INSERT INTO onboarding_progress (staff_id, template_id, items, total_items) VALUES ($1, $2, $3::jsonb, 1) RETURNING id',
                [staff.id, template.body.data.id, JSON.stringify(template.body.data.items)]
            );
            const checked = await request(`/onboarding/${progress.id}/check`, { method: 'PUT', body: { item_id: 1, done: true } });
            assert.equal(checked.status, 200, JSON.stringify(checked.body));
            assert.equal(checked.body.data.status, 'completed');

            await db.query(`INSERT INTO timeline_resources (business_context, resource_id, type, name)
                VALUES ('event_genix', 'synthetic-hr-room', 'cabinet', 'Synthetic HR room')`);
            await db.query(
                `INSERT INTO bookings (id, date, time, line_id, status, business_context, room, room_resource_id)
                 VALUES ('synthetic-hr-park', '2099-01-02', '12:00', $1, 'confirmed', 'event_genix', 'Synthetic HR room', 'synthetic-hr-room'),
                        ('synthetic-hr-foreign', '2099-01-02', '13:00', $1, 'confirmed', 'dar', NULL, NULL)`,
                [String(staff.id)]
            );
            const shifts = await request(path + '/shifts?month=2099-01');
            assert.equal(shifts.status, 200, JSON.stringify(shifts.body));
            assert.deepEqual(shifts.body.shifts.map(shift => shift.id), ['synthetic-hr-park']);
        }, db, { realServices: ['hrStaffResources', 'staffLifecycle'] });
    } finally { await db.end(); }
});
