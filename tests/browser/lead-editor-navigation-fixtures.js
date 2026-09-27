'use strict';

const assert = require('node:assert/strict');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

async function checkLeadEditorNavigation({ page, pool, targetUrl, runId, timeoutMs = 45_000, waitForWorkspace, fixture }) {
    assert.equal(process.env.RUN_OMNI_LEAD_LINKS_BROWSER, 'true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(targetUrl);
    assert.match(String(runId), /^[a-zA-Z0-9_-]+$/);
    assert.ok(Number.isSafeInteger(Number(fixture.leadId)) && Number(fixture.leadId) > 0);
    const secondName = `Editor navigation ${runId}`;
    const second = (await pool.query(
        `INSERT INTO leads (client_name, status, pipeline_stage, lead_type, notes, business_context)
         VALUES ($1, 'new', 'new', 'quality', 'Unchanged navigation fixture', 'event_genix') RETURNING id`, [secondName]
    )).rows[0];
    const snapshot = async () => (await pool.query(
        `SELECT id, client_name, phone, notes, updated_at::text FROM leads
          WHERE id = ANY($1::int[]) AND business_context = 'event_genix' ORDER BY id`, [[fixture.leadId, second.id]]
    )).rows;
    const before = await snapshot();
    const mutations = [];
    const trackMutation = request => {
        const pathname = new URL(request.url()).pathname;
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && /^\/api\/(leads|customers|omni)(\/|$)/.test(pathname)) {
            mutations.push(`${request.method()} ${pathname}`);
        }
    };
    page.on('request', trackMutation);
    const listUrl = new URL('/sales-funnel', targetUrl);
    listUrl.search = new URLSearchParams({ lead_queue: 'all', view: 'table', businessContext: 'event_genix' }).toString();
    const detailsTab = page.locator('#leadWorkspaceTabs [data-workspace-tab="details"]');
    const communicationsTab = page.locator('#leadWorkspaceTabs [data-workspace-tab="communications"]');
    const editor = page.locator('#leadWorkspaceEditorHost #leadEditorForm');
    const openFromTable = async (id, name) => {
        const row = page.locator(`#leadsTableBody [data-lead-id="${id}"]`);
        await row.waitFor({ state: 'visible', timeout: timeoutMs });
        await row.getByRole('button', { name: 'Відкрити лід', exact: true }).click();
        await waitForWorkspace(page, id, name);
    };
    const expectTab = tab => page.waitForFunction(expected => {
        const params = new URL(location.href).searchParams;
        return params.get('leadTab') === expected
            && document.querySelector(`#leadWorkspaceTabs [data-workspace-tab="${expected}"]`)?.getAttribute('aria-selected') === 'true';
    }, tab, { timeout: timeoutMs });
    let releaseResponse;
    const responseGate = new Promise(resolve => { releaseResponse = resolve; });
    const workspacePath = `/api/leads/${fixture.leadId}/workspace`;
    const workspaceMatcher = url => new URL(url).pathname === workspacePath;
    const holdActualResponse = async route => {
        const response = await route.fetch();
        await responseGate;
        await route.fulfill({ response });
    };
    let routeInstalled = false;
    try {
        await page.goto(listUrl.toString(), { waitUntil: 'domcontentloaded' });
        await openFromTable(fixture.leadId, `Legacy lead ${runId}`);
        await detailsTab.click();
        await page.route(workspaceMatcher, holdActualResponse);
        routeInstalled = true;
        await page.locator('#leadWorkspacePanel-details').getByRole('button', { name: 'Редагувати', exact: true }).click();
        await page.locator('#leadWorkspaceEditorHost [role="status"]').waitFor({ state: 'visible', timeout: timeoutMs });
        await page.locator('#leadWorkspaceClose').click();
        await page.locator('#leadWorkspace').waitFor({ state: 'hidden', timeout: timeoutMs });
        await openFromTable(second.id, secondName);
        const lateResponse = page.waitForResponse(response => response.request().method() === 'GET'
            && new URL(response.url()).pathname === workspacePath, { timeout: timeoutMs });
        releaseResponse();
        assert.equal((await lateResponse).ok(), true, 'delayed hydration uses a successful response from the real API');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await waitForWorkspace(page, second.id, secondName);
        assert.equal(await editor.count(), 0, 'late hydration cannot mount the previous lead editor');
        assert.equal(await page.locator('#leadWorkspaceEditorHost').isVisible(), false);
        await page.unroute(workspaceMatcher, holdActualResponse);
        routeInstalled = false;

        // Build actual browser history through visible openers: list -> overview
        // -> details -> communications -> details. Same-lead Back keeps the draft.
        await page.goto(listUrl.toString(), { waitUntil: 'domcontentloaded' });
        await openFromTable(second.id, secondName);
        await detailsTab.click();
        await page.locator('#leadWorkspacePanel-details').getByRole('button', { name: 'Редагувати', exact: true }).click();
        await editor.waitFor({ state: 'visible', timeout: timeoutMs });
        const draftName = `${secondName} unsaved`;
        await page.locator('#leadName').fill(draftName);
        await communicationsTab.click();
        await detailsTab.click();
        assert.equal(await page.locator('#leadName').inputValue(), draftName);
        for (const tab of ['communications', 'details', 'overview']) {
            await page.goBack();
            await expectTab(tab);
            assert.equal(await page.locator('#leadName').inputValue(), draftName, 'Back across tabs retains the same draft');
            assert.equal(await page.locator('.confirm-overlay').count(), 0, 'same-lead tab history does not discard the draft');
        }
        await page.goBack();
        await page.locator('.confirm-overlay').waitFor({ state: 'visible', timeout: timeoutMs });
        await page.locator('.confirm-overlay').getByRole('button', { name: 'Повернутись', exact: true }).click();
        await expectTab('overview');
        assert.equal(new URL(page.url()).searchParams.get('lead'), String(second.id), 'declining history dismissal restores the current lead URL');
        await detailsTab.click();
        assert.equal(await page.locator('#leadName').inputValue(), draftName);

        await page.locator('#leadName').focus();
        await page.keyboard.press('Escape');
        await page.locator('.confirm-overlay').waitFor({ state: 'visible', timeout: timeoutMs });
        await page.locator('.confirm-overlay').getByRole('button', { name: 'Повернутись', exact: true }).click();
        await editor.waitFor({ state: 'visible', timeout: timeoutMs });
        assert.equal(await page.locator('#leadName').inputValue(), draftName, 'declining Esc retains the draft');
        assert.equal(new URL(page.url()).searchParams.get('lead'), String(second.id));
        await page.locator('#leadModalCancel').click();
        await page.locator('.confirm-overlay').waitFor({ state: 'visible', timeout: timeoutMs });
        await page.locator('.confirm-overlay').getByRole('button', { name: 'Закрити без збереження', exact: true }).click();
        await editor.waitFor({ state: 'detached', timeout: timeoutMs });
        assert.deepEqual(mutations, [], 'hydration, history, guard cancellation and draft discard perform no writes');
        assert.deepEqual(await snapshot(), before, 'both fixture leads retain their original stored values');

        const restoreUrl = new URL('/sales-funnel', targetUrl);
        restoreUrl.search = new URLSearchParams({ lead: String(fixture.leadId), leadTab: 'communications', businessContext: 'event_genix' }).toString();
        await page.goto(restoreUrl.toString(), { waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, fixture.leadId, `Legacy lead ${runId}`);
        return { navigationLeadId: second.id };
    } finally {
        releaseResponse();
        if (routeInstalled) await page.unroute(workspaceMatcher, holdActualResponse);
        page.off('request', trackMutation);
    }
}

module.exports = { checkLeadEditorNavigation };
