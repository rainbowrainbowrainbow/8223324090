'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

async function checkLeadCommunicationSelection({ page, pool, targetUrl, runId, timeoutMs, outputDir, waitForWorkspace }) {
    assert.equal(process.env.RUN_OMNI_LEAD_LINKS_BROWSER, 'true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assertSafeIsolatedTestUrl(targetUrl);
    const names = [`UI4 manual ${runId}`, `UI4 second ${runId}`];
    const phone = '+380000000088';
    const leads = [];
    for (const name of names) {
        leads.push((await pool.query(
            `INSERT INTO leads (client_name, phone, status, pipeline_stage, lead_type, source_channel, business_context)
             VALUES ($1, $2, 'new', 'new', 'quality', 'phone', 'event_genix') RETURNING id`, [name, phone]
        )).rows[0]);
    }
    const linkRequests = [];
    const unexpectedWrites = [];
    const trackLinks = request => {
        const pathname = new URL(request.url()).pathname;
        if (request.method() === 'POST' && leads.some(lead => pathname === `/api/leads/${lead.id}/conversation-links`)) linkRequests.push(pathname);
    };
    const blockOmniMutations = async route => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
            unexpectedWrites.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
            return route.fulfill({ status: 200, json: { success: true, data: { unreadCount: 0 } } });
        }
        return route.continue();
    };
    page.on('request', trackLinks);
    await page.route('**/api/omni/**', blockOmniMutations);
    try {
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.goto(`${targetUrl}/sales-funnel?lead=${leads[0].id}&leadTab=communications&businessContext=event_genix`, { waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, leads[0].id, names[0]);
        const communications = page.locator('#leadWorkspacePanel-communications');
        await communications.getByText('Підтверджених діалогів ще немає.', { exact: false }).waitFor({ state: 'visible' });
        assert.equal(await communications.locator('.workspace-conversation-row').count(), 0, 'manual lead initially has no conversations or suggestions');
        assert.equal(await page.locator('.workspace-hero').getByRole('link', { name: /Відкрити Telegram|Відкрити Instagram/ }).count(), 0);
        assert.deepEqual(linkRequests, [], 'opening an empty manual lead cannot create a link');

        const conversation = (await pool.query(
            `INSERT INTO conversations (channel, external_id, customer_name, customer_phone, status, last_message_at, unread_count, meta, business_context)
             VALUES ('telegram', $1, $2, $3, 'open', NOW(), 0, '{}'::jsonb, 'event_genix') RETURNING id`,
            [`ui4-shared-${runId}`, `UI4 shared conversation ${runId}`, phone]
        )).rows[0];
        await pool.query(
            `INSERT INTO conversation_messages (conversation_id, direction, sender_name, content, content_type)
             VALUES ($1, 'inbound', 'Isolated UI fixture', 'UI4 shared conversation fixture', 'text')`, [conversation.id]
        );

        for (const [index, lead] of leads.entries()) {
            await page.goto(`${targetUrl}/sales-funnel?lead=${lead.id}&leadTab=communications&businessContext=event_genix`, { waitUntil: 'domcontentloaded' });
            await waitForWorkspace(page, lead.id, names[index]);
            const suggestion = communications.locator('.workspace-conversation-row.suggested').filter({ hasText: `UI4 shared conversation ${runId}` });
            await suggestion.waitFor({ state: 'visible', timeout: timeoutMs });
            assert.match(await suggestion.innerText(), /Непідтверджений збіг/);
            assert.equal(await suggestion.getByRole('link').count(), 0, 'a phone match does not expose an automatic chat opener');
            assert.equal(await page.locator('.workspace-hero').getByRole('link', { name: 'Відкрити Telegram', exact: true }).count(), 0);
            assert.equal(new URL(page.url()).pathname, '/sales-funnel');
            assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM lead_conversation_links WHERE lead_id=$1', [lead.id])).rows[0].count, 0,
                'matching a phone does not persist a confirmed link');
            await suggestion.getByRole('button', { name: 'Прив’язати діалог', exact: true }).click();
            await page.locator('#leadConversationLinkModal.active').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#leadConversationSelect').inputValue(), String(conversation.id));
            assert.equal(linkRequests.length, index, 'opening the confirmation dialog has no write side effect');
            const confirmedResponse = page.waitForResponse(response => response.request().method() === 'POST'
                && new URL(response.url()).pathname === `/api/leads/${lead.id}/conversation-links`, { timeout: timeoutMs });
            await page.locator('#leadConversationLinkSubmit').click();
            assert.equal((await confirmedResponse).ok(), true);
            await communications.locator('.workspace-conversation-row:not(.suggested)').filter({ hasText: `UI4 shared conversation ${runId}` }).waitFor({ state: 'visible', timeout: timeoutMs });
            await page.reload({ waitUntil: 'domcontentloaded' });
            await waitForWorkspace(page, lead.id, names[index]);
            assert.equal(await communications.locator('.workspace-conversation-row.suggested').count(), 0, 'confirmed conversation leaves suggestions after reload');
            assert.equal(await communications.locator('.workspace-conversation-row:not(.suggested)').count(), 1);
            const stored = (await pool.query(
                'SELECT conversation_id, is_origin, is_primary, source FROM lead_conversation_links WHERE lead_id=$1', [lead.id]
            )).rows;
            assert.equal(stored.length, 1);
            assert.equal(stored[0].conversation_id, conversation.id);
            assert.equal(stored[0].is_origin, false, 'manual linking does not invent a historical origin');
            assert.equal(stored[0].is_primary, false, 'manual linking alone does not silently select a primary');
            assert.equal(stored[0].source, 'lead_workspace_manual');
        }
        assert.equal(linkRequests.length, 2);

        const chatLink = page.getByRole('link', { name: 'Відкрити Telegram', exact: true }).first();
        assert.equal(new URL(await chatLink.getAttribute('href'), page.url()).searchParams.get('conversation'), String(conversation.id));
        await chatLink.click();
        await page.locator('#omniMessages .omni-msg').filter({ hasText: 'UI4 shared conversation fixture' }).waitFor({ state: 'visible', timeout: timeoutMs });
        for (const [index, lead] of leads.entries()) {
            await page.waitForFunction(() => document.querySelectorAll('#omniCaseContext .omni-case-confirmed-lead').length === 2, null, { timeout: timeoutMs });
            const details = page.locator('#omniCaseContext details');
            if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
            assert.equal(await page.locator('#omniCaseContext .omni-case-confirmed-lead').count(), 2, 'Omni shows both confirmed leads');
            const row = page.locator('#omniCaseContext .omni-case-confirmed-lead').filter({ hasText: names[index] });
            await row.waitFor({ state: 'visible' });
            const leadLink = row.getByRole('link', { name: 'Відкрити звернення', exact: true });
            assert.equal(new URL(await leadLink.getAttribute('href'), page.url()).searchParams.get('lead'), String(lead.id));
            if (index === 0) await page.screenshot({ path: path.join(outputDir, 'lead-ui4-two-leads-one-chat.png'), fullPage: false });
            await leadLink.click();
            await waitForWorkspace(page, lead.id, names[index]);
            assert.equal(new URL(page.url()).searchParams.get('lead'), String(lead.id), 'explicit choice opens the selected lead rather than the latest lead');
            if (index === 0) {
                await page.goBack({ waitUntil: 'domcontentloaded' });
                await page.locator('#omniMessages .omni-msg').filter({ hasText: 'UI4 shared conversation fixture' }).waitFor({ state: 'visible', timeout: timeoutMs });
                assert.equal(new URL(page.url()).searchParams.get('conversation'), String(conversation.id));
            }
        }
        assert.deepEqual(unexpectedWrites, [], 'opening the shared conversation attempts no send/read/status/AI mutation');
        const report = { success: true, manualLeadIds: leads.map(lead => lead.id), conversationId: conversation.id,
            manualLinkRequests: linkRequests.length, omniWriteAttempts: unexpectedWrites.length,
            scenarios: ['Manual lead empty state', 'Phone match remains unconfirmed until explicit submit', 'Manual links survive reload without invented origin or primary', 'Two confirmed leads in one chat and exact UI choice of each'] };
        fs.writeFileSync(path.join(outputDir, 'lead-ui4-communication-selection-report.json'), JSON.stringify(report, null, 2));
        process.stdout.write('[omni-ui4] manual empty/suggestion/explicit-link and two-lead selection passed\n');
        return report;
    } finally {
        page.off('request', trackLinks);
        await page.unroute('**/api/omni/**', blockOmniMutations);
    }
}

module.exports = { checkLeadCommunicationSelection };
