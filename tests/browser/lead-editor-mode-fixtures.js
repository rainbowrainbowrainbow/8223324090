'use strict';

const assert = require('node:assert/strict');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

async function seedEditorModes(pool, runId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const customerName = `Editor customer ${runId}`;
        const customer = (await client.query(
            `INSERT INTO customers (name, phone, source, business_context)
             VALUES ($1, '+380000000005', 'recommendation', 'event_genix') RETURNING id`,
            [customerName]
        )).rows[0];
        const maysternyaName = `Editor Maysternya ${runId}`;
        const maysternyaNotes = 'Maysternya fixture note\nГості на бажану дату: preserve this original line';
        const lead = (await client.query(
            `INSERT INTO leads (
                client_name, phone, status, pipeline_stage, lead_type, source,
                source_channel, external_id, raw_payload, business_context,
                notes, event_date, children_count, celebrants
             ) VALUES ($1, '+380000000006', 'new', 'new', 'quality', 'maysternya_site',
                'web', $2, $3::jsonb, 'maysternya_doli', $4, '2099-07-20', 2, $5::jsonb)
             RETURNING id`,
            [maysternyaName, `editor-maysternya-${runId}`,
                JSON.stringify({ topic: 'Isolated fixture topic', message: 'Isolated fixture message', page: '/fixture' }),
                maysternyaNotes,
                JSON.stringify([{ name: 'Isolated hidden child', birthday: '2091-07-20', age: 8, notes: 'Preserve hidden child note' }])]
        )).rows[0];
        await client.query(
            `INSERT INTO lead_event_preferences (lead_id, business_context, preferred_date, children_count, adults_count, notes)
             VALUES ($1, 'maysternya_doli', '2099-07-20', 2, 5, 'Preserve Maysternya preference note')`,
            [lead.id]
        );
        await client.query('COMMIT');
        return { customerId: customer.id, customerName, maysternyaLeadId: lead.id, maysternyaName, maysternyaNotes };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function readEntityCounts(pool) {
    return (await pool.query(
        `SELECT (SELECT COUNT(*)::int FROM leads) AS leads,
                (SELECT COUNT(*)::int FROM customers) AS customers,
                (SELECT COUNT(*)::int FROM lead_customer_links) AS customer_links`
    )).rows[0];
}

async function readMaysternyaLead(pool, leadId) {
    return (await pool.query(
        `SELECT l.client_name, l.phone, l.notes, l.source, l.source_channel, l.external_id,
                l.raw_payload, l.pipeline_stage, l.lead_type, l.children_count,
                l.event_date::text, l.celebrants, p.preferred_date::text,
                p.children_count AS preference_children, p.adults_count AS preference_adults,
                p.notes AS preference_notes
           FROM leads l JOIN lead_event_preferences p
             ON p.lead_id = l.id AND p.business_context = l.business_context
          WHERE l.id = $1 AND l.business_context = 'maysternya_doli'`, [leadId]
    )).rows[0];
}

// Uses only the disposable DB/app verified by the parent runner. The caller owns
// fixture cleanup and may restore its original business/lead after this check.
async function checkLeadEditorModes({ page, pool, targetUrl, runId, timeoutMs = 45_000, waitForWorkspace }) {
    assert.equal(process.env.RUN_OMNI_LEAD_LINKS_BROWSER, 'true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(targetUrl);
    assert.equal(typeof waitForWorkspace, 'function');
    assert.match(String(runId), /^[a-zA-Z0-9_-]+$/, 'fixture run ID must be a safe identifier');
    const fixture = await seedEditorModes(pool, runId);
    const mutations = [];
    const trackMutation = request => {
        const pathname = new URL(request.url()).pathname;
        if (/^(POST|PUT|PATCH|DELETE)$/.test(request.method()) && /^\/api\/(leads|customers)(\/|$)/.test(pathname)) {
            mutations.push({ method: request.method(), pathname });
        }
    };
    page.on('request', trackMutation);
    try {
        const beforeOpen = await readEntityCounts(pool);
        const createUrl = new URL('/sales-funnel', targetUrl);
        createUrl.search = new URLSearchParams({ action: 'create', customerId: String(fixture.customerId), businessContext: 'event_genix' }).toString();
        await page.goto(createUrl.toString(), { waitUntil: 'domcontentloaded' });
        await page.locator('#leadModal.active #leadEditorForm').waitFor({ state: 'visible', timeout: timeoutMs });
        await page.waitForFunction(name => document.getElementById('leadName')?.value === name, fixture.customerName, { timeout: timeoutMs });
        assert.equal(await page.locator('#leadEditorForm').count(), 1);
        assert.equal(await page.locator('#leadCreateEditorHost #leadEditorForm').count(), 1);
        assert.equal(await page.locator('#leadModal').getAttribute('data-source-customer-id'), String(fixture.customerId));
        assert.equal(await page.locator('#leadPhone').inputValue(), '+380000000005');
        assert.deepEqual(mutations, [], 'opening customer-prefilled creation performs no lead/customer mutation');
        assert.deepEqual(await readEntityCounts(pool), beforeOpen, 'opening creation does not create a lead, customer, or link');

        const createdResponse = page.waitForResponse(response => response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/leads', { timeout: timeoutMs });
        await page.locator('#leadModalSave').click();
        const response = await createdResponse;
        assert.equal(response.ok(), true, 'customer-prefilled create succeeds through the real API');
        const created = await response.json();
        const createdLeadId = Number(created.lead?.id);
        assert.ok(Number.isSafeInteger(createdLeadId) && createdLeadId > 0);
        await page.locator('#leadModal.active').waitFor({ state: 'detached', timeout: timeoutMs });
        const links = (await pool.query(
            `SELECT customer_id FROM lead_customer_links
              WHERE lead_id = $1 AND business_context = 'event_genix' AND link_type = 'operator_link'`, [createdLeadId]
        )).rows;
        assert.deepEqual(links, [{ customer_id: fixture.customerId }], 'the saved lead links to the exact source customer');
        assert.equal(mutations.filter(item => item.method === 'POST' && item.pathname === '/api/leads').length, 1);
        assert.equal((await readEntityCounts(pool)).customers, beforeOpen.customers, 'customer handoff does not create a duplicate customer');

        const maysternyaBefore = await readMaysternyaLead(pool, fixture.maysternyaLeadId);
        const beforeMaysternyaOpen = await readEntityCounts(pool);
        mutations.length = 0;
        const editUrl = new URL('/sales-funnel', targetUrl);
        editUrl.search = new URLSearchParams({ lead: String(fixture.maysternyaLeadId), leadTab: 'details', businessContext: 'maysternya_doli' }).toString();
        await page.goto(editUrl.toString(), { waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, fixture.maysternyaLeadId, fixture.maysternyaName);
        await page.locator('#leadWorkspacePanel-details').getByRole('button', { name: 'Редагувати заявку', exact: true }).click();
        const editor = page.locator('#leadWorkspaceEditorHost #leadEditorForm');
        await editor.waitFor({ state: 'visible', timeout: timeoutMs });
        assert.equal(await page.locator('#leadModal.active').count(), 0);
        assert.equal(await page.locator('#leadNotes').inputValue(), fixture.maysternyaNotes);
        assert.equal(await page.locator('#leadChildrenCount').isVisible(), false);
        assert.equal(await page.locator('#leadAdultsCount').isVisible(), false);
        assert.equal(await page.locator('[data-celebrants-editor="leadCelebrants"]').isVisible(), false);
        assert.deepEqual(mutations, [], 'opening the Maysternya editor performs no mutation');
        assert.deepEqual(await readEntityCounts(pool), beforeMaysternyaOpen);

        const notes = `${fixture.maysternyaNotes}\nUpdated through embedded Maysternya editor`;
        await page.locator('#leadNotes').fill(notes);
        const leadPath = `/api/leads/${fixture.maysternyaLeadId}`;
        const savedResponse = page.waitForResponse(result => result.request().method() === 'PATCH'
            && new URL(result.url()).pathname === leadPath, { timeout: timeoutMs });
        await page.locator('#leadModalSave').click();
        const saved = await savedResponse;
        assert.equal(saved.ok(), true, 'Maysternya notes edit succeeds through the real API');
        const patch = saved.request().postDataJSON();
        assert.equal(patch.notes, notes);
        for (const key of ['eventPreference', 'event_date', 'children_count', 'celebrants', 'source', 'source_channel', 'external_id', 'raw_payload', 'lead_type', 'pipeline_stage']) {
            assert.equal(Object.hasOwn(patch, key), false, `Maysternya notes edit omits unchanged ${key}`);
        }
        await editor.waitFor({ state: 'detached', timeout: timeoutMs });
        assert.deepEqual(await readMaysternyaLead(pool, fixture.maysternyaLeadId), { ...maysternyaBefore, notes }, 'hidden and inbound fields retain their stored values');
        assert.deepEqual(mutations, [{ method: 'PATCH', pathname: leadPath }], 'notes-only edit uses one lead mutation');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, fixture.maysternyaLeadId, fixture.maysternyaName);
        assert.ok((await page.locator('#leadWorkspacePanel-details').innerText()).includes('Updated through embedded Maysternya editor'), 'Maysternya notes survive reload');
        return { customerId: fixture.customerId, customerHandoffLeadId: createdLeadId, maysternyaLeadId: fixture.maysternyaLeadId };
    } finally {
        page.off('request', trackMutation);
    }
}

module.exports = { checkLeadEditorModes };
