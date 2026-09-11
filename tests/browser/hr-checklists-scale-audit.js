'use strict';

// Called only by the disposable PostgreSQL checklist audit; never run against live data.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

module.exports = async function auditChecklistScale({ api, db, evidence, page, base }) {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.equal(target.isLocal, true, 'Scale fixtures require loopback PostgreSQL');
    const connection = await db.connect();
    try {
        // A container's server address differs from the loopback endpoint used by the runner.
        assert.equal(connection.connectionParameters.host, target.hostname, 'Use the verified loopback database endpoint');
        assert.equal(Number(connection.connectionParameters.port), Number(target.url.port || 5432), 'Use the runner-owned database port');
        const connected = (await connection.query('SELECT current_database() AS database_name')).rows[0];
        assert.equal(connected.database_name, target.databaseName, 'Use the runner-owned database');
    } finally { connection.release(); }
    assert.ok(Array.isArray(evidence.findings));

    const suffix = randomBytes(4).toString('hex');
    const professionKey = `chk_scale_${suffix}`;
    const department = `QA-North-${suffix}`;
    const endpoint = `/api/hr/professions/${professionKey}/checklist`;
    await api('/api/hr/professions', {
        key: professionKey, title: `QA Scale Profession ${suffix}`, department
    });
    const item = (await api(`${endpoint}/items`, { title: 'QA Scale Canonical Item' })).data.item;

    // The isolated runner disposes this whole database. One CTE makes fixture insertion atomic.
    const staff = await db.query(`
        WITH new_staff AS (
            INSERT INTO staff
                (name, department, position, role_type, is_active, hr_pool_status, is_freelance)
            SELECT 'QA Scale Person ' || LPAD(sequence::text, 3, '0') || ' ' || $3,
                   $2, 'QA Checklist Scale', $1, true, 'core', false
            FROM generate_series(1, 201) AS sequence
            RETURNING id
        )
        INSERT INTO staff_role_assignments (staff_id, profession_key, is_primary, status)
        SELECT id, $1, true, 'active' FROM new_staff
        RETURNING staff_id`, [professionKey, department, suffix]);
    assert.equal(staff.rowCount, 201);

    const dashboard = async params => (
        await api('/api/hr/checklists/dashboard?' + new URLSearchParams(params))
    ).data;
    const first = await dashboard({ professionKey });
    const second = await dashboard({ professionKey, offset: '200' });
    const end = await dashboard({ professionKey, offset: '201' });
    assert.equal(first.assignments.length, 200);
    assert.equal(first.pagination.semantics, 'independent_feeds');
    assert.equal(first.pagination.assignments.total, 201);
    assert.equal(first.pagination.assignments.limit, 200);
    assert.equal(first.summary.not_started, 201);
    assert.equal(second.assignments.length, 1);
    assert.equal(second.pagination.assignments.total, 201);
    assert.equal(end.assignments.length, 0);
    assert.equal(end.pagination.assignments.total, 201);
    const uniqueAssignments = new Set([...first.assignments, ...second.assignments].map(row => row.assignmentId));
    assert.equal(uniqueAssignments.size, 201, 'Pagination makes every fixture assignment reachable once');
    evidence.scale = {
        scope: '201 synthetic staff and active assignments in the runner-owned disposable database',
        defaultReturned: first.assignments.length,
        defaultTotal: first.pagination.assignments.total,
        secondPageReturned: second.assignments.length,
        endPageReturned: end.assignments.length,
        uniqueAssignments: uniqueAssignments.size,
        serverPagination: 'PASS',
        browserPaginationExercised: true
    };
    await page.goto(`${base}/hr.html#checklists`, { waitUntil: 'domcontentloaded' });
    await page.locator('#mainApp:not(.hidden)').waitFor();
    await page.locator('#tab-checklists').getByRole('button', { name: 'Оновити', exact: true }).click();
    await page.locator(`#professionChecklistDashboardProfession option[value="${professionKey}"]`).waitFor({ state: 'attached' });
    await page.locator('#professionChecklistDashboardProfession').selectOption(professionKey);
    await page.locator(`[data-checklist-open-profession="${professionKey}"]`).first().waitFor();
    for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => applyCrmThemeMode(theme === 'dark', true), theme);
        assert.equal(await page.locator('[data-checklist-feed="assignments"] .hr-checklist-dashboard-row').count(), 200);
        await page.locator('[data-checklist-page-feed="assignments"][data-checklist-page-offset="200"]').click();
        await page.waitForFunction(() => professionChecklistDashboardState.data?.pagination?.assignments?.offset === 200);
        assert.equal(await page.locator('[data-checklist-feed="assignments"] .hr-checklist-dashboard-row').count(), 1);
        await page.screenshot({ path: path.resolve(__dirname, `../../output/playwright/hr-checklists/postgres/page-201-${theme}.png`), animations: 'disabled' });
        await page.locator('#professionChecklistDashboardSearch').fill('QA Scale Person 001');
        await page.waitForFunction(() => professionChecklistDashboardState.loadState === 'ready' && professionChecklistDashboardState.data?.pagination?.assignments?.total === 1);
        assert.equal(await page.evaluate(() => professionChecklistDashboardState.data.pagination.assignments.offset), 0);
        await page.locator('#professionChecklistDashboardSearch').fill('');
        await page.waitForFunction(() => professionChecklistDashboardState.loadState === 'ready' && professionChecklistDashboardState.data?.pagination?.assignments?.total === 201);
    }
    evidence.scale.browserPagination = 'PASS';
    await api('/api/hr/checklists/dashboard?staffId=2147483648', undefined, 'GET', 400);
    evidence.invalidStaffId = 'PASS';

    // A unique department occurs only in department fields, not names or item/profession titles.
    const firstStaffId = Number(staff.rows[0].staff_id);
    await api(`/api/hr/staff/${firstStaffId}/profession-checklist`, {
        profession_key: professionKey, checklist_key: item.itemKey, completed: true,
        notes: 'QA historical scale proof'
    }, 'PUT');
    await api(`${endpoint}/items/${item.itemKey}/archive`, {}, 'PUT');
    const byDepartment = await dashboard({ professionKey, department, status: 'archived' });
    const bySearch = await dashboard({ professionKey, search: department, status: 'archived' });
    assert.equal(byDepartment.archived.length, 1, 'The archived history matches its department');
    assert.equal(byDepartment.summary.archived, 1);
    assert.equal(bySearch.archived.length, 1, 'Archived search includes department');
    const historical = (await db.query(`
        SELECT completed_at, notes FROM hr_staff_profession_checklist_progress
        WHERE staff_id = $1 AND checklist_item_id = $2`, [firstStaffId, item.id])).rows[0];
    assert.ok(historical.completed_at, 'Archiving retains the completion timestamp');
    assert.equal(historical.notes, 'QA historical scale proof', 'Archiving retains the saved note');
    evidence.departmentHistorySearch = {
        departmentFilterRows: byDepartment.archived.length,
        departmentTextSearchRows: bySearch.archived.length,
        archivePreservesCompletionAndNote: 'PASS'
    };
    await db.query(`INSERT INTO hr_staff_profession_checklist_progress
        (staff_id, profession_key, checklist_key, title, notes)
        VALUES ($1, $2, $3, 'QA Orphan History', 'QA orphan note')`, [firstStaffId, professionKey, `qa_orphan_${suffix}`]);
    const orphanFilter = await dashboard({ professionKey, department, status: 'orphaned' });
    const orphanSearch = await dashboard({ professionKey, search: department, status: 'orphaned' });
    assert.equal(orphanFilter.orphaned.length, 1);
    assert.equal(orphanSearch.orphaned.length, 1);
    assert.equal(orphanSearch.orphaned[0].progress.notes, 'QA orphan note');
    evidence.departmentHistorySearch.orphaned = 'PASS';
};
