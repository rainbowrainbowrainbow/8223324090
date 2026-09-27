'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VIEWPORTS = [[1366, 768], [390, 844], [320, 640], [390, 420]];

async function seedNavigationFixtures(pool, runId) {
    const rows = [];
    for (const [suffix, channel, status] of [['closed', 'telegram', 'closed'], ['other', 'telegram', 'open'], ['delivery', 'instagram', 'open']]) {
        const row = (await pool.query(
            `INSERT INTO conversations (channel, external_id, customer_name, status, last_message_at, unread_count, meta, business_context)
             VALUES ($1, $2, $3, $4, NOW(), 0, '{"ai_enabled":false}'::jsonb, 'event_genix') RETURNING id, customer_name, status, updated_at`,
            [channel, `ui3-${suffix}-${runId}`, `UI3 ${suffix} ${runId}`, status]
        )).rows[0];
        rows.push(row);
        if (suffix !== 'delivery') {
            await pool.query(
                `INSERT INTO conversation_messages (conversation_id, direction, sender_name, content, content_type, created_at)
                 SELECT $1, 'inbound', 'Isolated UI fixture', $2 || ' message ' || n::text, 'text', NOW() - ((80-n)::text || ' minutes')::interval
                 FROM generate_series(1,80) n`, [row.id, suffix]
            );
        } else {
            for (const [index, deliveryStatus] of ['saved', 'accepted', 'failed'].entries()) {
                await pool.query(
                    `INSERT INTO conversation_messages (conversation_id, direction, sender_name, content, content_type, delivery_status, delivery_error, created_at)
                     VALUES ($1, 'outbound', 'Isolated UI fixture', $2, 'text', $3, $4, NOW() - ($5::text || ' seconds')::interval)`,
                    [row.id, `UI3 durable ${deliveryStatus}`, deliveryStatus, deliveryStatus === 'failed' ? 'Fixture provider rejection; reason is not a reply-window diagnosis.' : null, 3-index]
                );
            }
        }
    }
    return { closed: rows[0], other: rows[1], delivery: rows[2] };
}

async function settleLayout(page) {
    await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const animations = document.querySelector('.main-content')?.getAnimations({ subtree: false }) || [];
        await Promise.allSettled(animations.filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished));
    });
}

async function waitForConversation(page, row, finalText, timeoutMs) {
    await page.locator('#omniChatName').filter({ hasText: row.customer_name }).waitFor({ state: 'visible', timeout: timeoutMs });
    await page.locator('#omniMessages .omni-msg').filter({ hasText: finalText }).waitFor({ state: 'visible', timeout: timeoutMs });
    await page.waitForFunction(() => !document.getElementById('omniHistoryControls')?.textContent.includes('Завантаження повідомлень'), null, { timeout: timeoutMs });
    await settleLayout(page);
}

async function inspectConversationLayout(page, label) {
    const state = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
        const hit = selector => {
            const target = document.querySelector(selector);
            const bounds = target.getBoundingClientRect();
            const found = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            return target === found || target.contains(found);
        };
        const messages = document.getElementById('omniMessages');
        return {
            width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth,
            shell: rect('.omni-workspace-shell'), header: rect('#omniChatHeader'), messages: rect('#omniMessages'),
            input: rect('#omniInput'), send: rect('#omniSendBtn'), latest: rect('#omniMessages .omni-msg:last-child'),
            scrollHeight: messages.scrollHeight, clientHeight: messages.clientHeight,
            inputHit: hit('#omniInput'), sendHit: hit('#omniSendBtn'), inputDisabled: document.getElementById('omniInput').disabled
        };
    });
    assert.ok(state.pageWidth <= state.width + 1, `${label}: no horizontal page overflow ${JSON.stringify(state)}`);
    for (const field of ['shell', 'header', 'messages', 'input', 'send']) {
        const box = state[field];
        assert.ok(box?.width > 0 && box.height > 0 && box.left >= -1 && box.right <= state.width + 1 && box.top >= -1 && box.bottom <= state.height + 2,
            `${label}: ${field} is contained in viewport ${JSON.stringify(state)}`);
    }
    assert.ok(state.clientHeight >= (state.height <= 420 ? 60 : 120), `${label}: readable message area ${JSON.stringify(state)}`);
    assert.ok(state.scrollHeight > state.clientHeight, `${label}: fixture exercises actual history scroll`);
    assert.ok(state.latest.bottom <= state.messages.bottom + 2 && state.latest.bottom >= state.messages.top, `${label}: last message bottom visible`);
    assert.equal(state.inputDisabled, false, `${label}: synthetic account capability enables composer UI`);
    assert.ok(state.inputHit && state.sendHit, `${label}: input and send button reachable`);
    return state;
}

async function checkOmniWorkspaceNavigation({ page, pool, targetUrl, runId, timeoutMs, outputDir, fixture, expectedApiFailures, waitForWorkspace }) {
    const records = await seedNavigationFixtures(pool, runId);
    const blockedMutations = [];
    const capabilityOverrides = [];
    // Only account capability is synthetic: this tests an enabled composer without
    // configuring a provider. Conversations, messages and links use the real API/DB.
    // No browser-originated Omni write can reach Express, including read receipts.
    const protectOmni = async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
            blockedMutations.push({ method: request.method(), pathname: url.pathname });
            return route.fulfill({ status: 200, json: { success: true, data: { unreadCount: 0 } } });
        }
        if (url.pathname === '/api/omni/accounts') {
            const response = await route.fetch();
            const body = await response.json();
            body.accounts = body.accounts.map(account => account.channel === 'telegram'
                ? { ...account, connected: true, sendCapable: true, receiveCapable: true } : account);
            capabilityOverrides.push('telegram');
            return route.fulfill({ response, json: body });
        }
        return route.continue();
    };
    await page.route('**/api/omni/**', protectOmni);
    const snapshots = [];
    const screenshots = [];
    try {
        for (const [width, height] of VIEWPORTS) {
            await page.setViewportSize({ width, height });
            await page.goto(`${targetUrl}/omni?conversation=${records.closed.id}&businessContext=event_genix`, { waitUntil: 'domcontentloaded' });
            await waitForConversation(page, records.closed, 'closed message 80', timeoutMs);
            await page.waitForFunction(() => !document.getElementById('omniInput').disabled);
            snapshots.push(await inspectConversationLayout(page, `${width}x${height}`));
            assert.equal(await page.locator('#omniCloseConv').getAttribute('title'), 'Відкрити діалог', 'opening closed conversation does not reopen it');
            const draft = `Unsaved fixture draft ${width}x${height}\nSecond line retained across modes`;
            await page.locator('#omniInput').fill(draft);
            // Composer growth changes the history viewport; finish that layout
            // before establishing the user's new reading position.
            await settleLayout(page);
            const scrollBefore = await page.locator('#omniMessages').evaluate(node => { node.scrollTop = Math.floor((node.scrollHeight - node.clientHeight) / 2); return node.scrollTop; });
            await settleLayout(page);
            assert.equal(await page.locator('#omniMessages').evaluate(node => node.scrollTop), scrollBefore, 'reading position is established before changing mode');
            const listBefore = await page.locator('#omniConvList').evaluate(node => node.scrollTop);
            for (const mode of ['channels', 'health']) {
                const modeTab = page.locator(`.omni-mode-btn[data-omni-mode="${mode}"]`);
                if (await modeTab.isVisible()) await modeTab.click();
                else {
                    await page.locator('#omniChatMore > summary').click();
                    await page.locator(`.omni-mobile-mode-action[data-omni-mode="${mode}"]`).click();
                }
                await page.waitForFunction(expected => document.getElementById('omniContainer')?.getAttribute('data-omni-mode') === expected, mode);
                await page.locator('#omniModeBack').click();
                await waitForConversation(page, records.closed, 'closed message 80', timeoutMs);
                assert.equal(await page.locator('#omniInput').inputValue(), draft, `${mode}: draft retained`);
                const scrollAfter = await page.locator('#omniMessages').evaluate(node => node.scrollTop);
                assert.ok(Math.abs(scrollBefore-scrollAfter) <= 2, `${mode}: reading position retained ${scrollBefore}/${scrollAfter}`);
            }
            assert.equal(await page.locator('#omniConvList').evaluate(node => node.scrollTop), listBefore, 'message scroll does not scroll the list');
            if (width < 720) {
                await page.locator('#omniMobileBack').click();
                const row = page.locator(`.omni-conv-item[data-id="${records.closed.id}"]`);
                await row.waitFor({ state: 'visible' });
                await row.focus();
                await page.keyboard.press('Enter');
                await waitForConversation(page, records.closed, 'closed message 80', timeoutMs);
                assert.equal(await page.locator('#omniInput').inputValue(), draft, 'keyboard reopen restores per-conversation draft');
            }
            await page.locator('#omniInput').focus();
            assert.equal(await page.locator('#omniInput').evaluate(node => node === document.activeElement), true);
            await page.locator('#omniMessages').evaluate(node => { node.scrollTop = node.scrollHeight; });
            await settleLayout(page);
            await inspectConversationLayout(page, `${width}x${height} with draft`);
            const screenshot = `ui3-omni-${width}x${height}.png`;
            await page.screenshot({ path: path.join(outputDir, screenshot), fullPage: false });
            screenshots.push(screenshot);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await waitForConversation(page, records.closed, 'closed message 80', timeoutMs);
            assert.equal(new URL(page.url()).searchParams.get('conversation'), String(records.closed.id), 'reload keeps exact selected conversation');
            process.stdout.write(`[omni-ui3] navigation ${width}x${height} passed\n`);
        }

        // Hold the real response, navigate to B, then release A. No mock messages.
        await page.setViewportSize({ width: 390, height: 844 });
        let releaseMessages;
        const gate = new Promise(resolve => { releaseMessages = resolve; });
        let heldResolve;
        let heldReject;
        const held = new Promise((resolve, reject) => { heldResolve = resolve; heldReject = reject; });
        const heldTimeout = setTimeout(() => heldReject(new Error('Expected real message response was not intercepted in time')), timeoutMs);
        held.catch(() => {});
        let delayed = false;
        const delayedPath = `**/api/omni/conversations/${records.closed.id}/messages*`;
        const delayMessages = async route => {
            if (delayed) return route.fallback();
            delayed = true;
            let response;
            try { response = await route.fetch(); }
            catch (error) { heldReject(error); throw error; }
            heldResolve();
            await gate;
            await route.fulfill({ response });
        };
        await page.route(delayedPath, delayMessages);
        try {
            await page.goto(`${targetUrl}/omni?conversation=${records.closed.id}`, { waitUntil: 'domcontentloaded' });
            await held;
            clearTimeout(heldTimeout);
            await page.locator('#omniHistoryControls').filter({ hasText: 'Завантаження повідомлень' }).waitFor({ state: 'visible' });
            await page.locator('#omniMobileBack').click();
            await page.locator(`.omni-conv-item[data-id="${records.other.id}"]`).click();
            await waitForConversation(page, records.other, 'other message 80', timeoutMs);
            const releasedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/omni/conversations/${records.closed.id}/messages`);
            releaseMessages();
            await releasedResponse;
            await settleLayout(page);
            assert.match(await page.locator('#omniMessages').innerText(), /other message 80/);
            assert.doesNotMatch(await page.locator('#omniMessages').innerText(), /closed message/);
            process.stdout.write('[omni-ui3] delayed real history response ignored after selecting another conversation\n');
        } finally {
            clearTimeout(heldTimeout);
            releaseMessages();
            await page.unroute(delayedPath, delayMessages);
        }

        let failOnce = true;
        const failMessages = async route => {
            if (!failOnce) return route.fallback();
            failOnce = false;
            return route.fulfill({ status: 503, json: { success: false, error: 'Isolated history unavailable' } });
        };
        expectedApiFailures.push({ method: 'GET', pathname: `/api/omni/conversations/${records.closed.id}/messages`, status: 503, remaining: 1 });
        await page.route(delayedPath, failMessages);
        try {
            await page.goto(`${targetUrl}/omni?conversation=${records.closed.id}`, { waitUntil: 'domcontentloaded' });
            await page.locator('[data-omni-history="retry"]').waitFor({ state: 'visible', timeout: timeoutMs });
            assert.doesNotMatch(await page.locator('#omniHistoryControls').innerText(), /Завантаження повідомлень/);
            await page.locator('[data-omni-history="retry"]').click();
            await waitForConversation(page, records.closed, 'closed message 80', timeoutMs);
            process.stdout.write('[omni-ui3] explicit history error and real-API retry passed\n');
        } finally { await page.unroute(delayedPath, failMessages); }

        for (const [width, height] of [[1366, 768], [390, 420]]) {
            await page.setViewportSize({ width, height });
            await page.goto(`${targetUrl}/omni?conversation=${records.delivery.id}`, { waitUntil: 'domcontentloaded' });
            await waitForConversation(page, records.delivery, 'UI3 durable failed', timeoutMs);
            for (const [status, expectedLabel] of [['saved', 'Надсилається'], ['accepted', 'Надіслано'], ['failed', 'Не надіслано']]) {
                const message = page.locator('#omniMessages .omni-msg').filter({ hasText: `UI3 durable ${status}` });
                assert.match(await message.innerText(), new RegExp(expectedLabel), `durable ${status} remains distinct`);
                if (status !== 'failed') assert.doesNotMatch(await message.innerText(), /Доставлено/);
            }
            const failed = page.locator('#omniMessages .omni-msg').filter({ hasText: 'UI3 durable failed' });
            assert.match(await failed.innerText(), /Fixture provider rejection/);
            assert.doesNotMatch(await failed.innerText(), /24 год|24.hour|вікно.*закрит/i, 'a rejection without evidence is not diagnosed as an expired reply window');
            await page.screenshot({ path: path.join(outputDir, `ui3-delivery-${width}x${height}.png`), fullPage: false });
        }

        // Selective unavailable permissions cannot be created for the isolated
        // creator without changing access policy. Feed the UI a redacted resolver
        // contract based on a real workspace response; resolver units cover policy.
        const workspacePath = `**/api/leads/${fixture.leadId}/workspace*`;
        const redactPrimary = async route => {
            const response = await route.fetch();
            const body = await response.json();
            const workspace = body.data || body.workspace || body;
            const context = workspace.conversationContext;
            assert.ok(context?.confirmedLinks.some(link => link.isPrimary), 'real workspace supplies primary before redaction');
            context.confirmedLinks = context.confirmedLinks.map(link => link.isPrimary ? {
                ...Object.fromEntries(Object.keys(link).map(key => [key, null])),
                available: false, isPrimary: link.isPrimary, isOrigin: link.isOrigin, source: link.source,
                confidence: 'confirmed', unreadCount: 0, replyExpected: false, waitingReply: false, replySlaState: 'none'
            } : link);
            context.resolution = { action: 'unavailable', reason: 'primary_unavailable', conversationId: null };
            workspace.conversations = context.confirmedLinks;
            return route.fulfill({ response, json: body });
        };
        await page.route(workspacePath, redactPrimary);
        try {
            await page.goto(`${targetUrl}/sales-funnel?lead=${fixture.leadId}&leadTab=communications&businessContext=event_genix`, { waitUntil: 'domcontentloaded' });
            await waitForWorkspace(page, fixture.leadId);
            await page.locator('#leadWorkspacePanel-communications').getByText('Обраний діалог недоступний.', { exact: false }).waitFor({ state: 'visible' });
            assert.equal(new URL(page.url()).pathname, '/sales-funnel');
            assert.equal(await page.locator('.workspace-hero').getByRole('link', { name: /Відкрити Instagram|Відкрити Telegram/ }).count(), 0,
                'unavailable primary must not automatically fall back to the accessible origin');
        } finally { await page.unroute(workspacePath, redactPrimary); }

        const closedAfter = (await pool.query('SELECT status, updated_at FROM conversations WHERE id=$1', [records.closed.id])).rows[0];
        assert.equal(closedAfter.status, 'closed');
        assert.equal(closedAfter.updated_at.toISOString(), records.closed.updated_at.toISOString(), 'browser navigation leaves closed conversation untouched');
        assert.deepEqual(blockedMutations.filter(request => !request.pathname.endsWith('/read')), [], 'no send/status/provider mutation was attempted');
        assert.ok(capabilityOverrides.length > 0, 'enabled-composer capability boundary exercised');
        const report = { success: true, viewports: VIEWPORTS, snapshots, screenshots, closedConversationId: records.closed.id,
            blockedReadReceipts: blockedMutations.filter(request => request.pathname.endsWith('/read')).length,
            backendOmniWrites: 0, browserMutationGuard: 'All Omni mutation methods fulfilled locally before Express; closed-row status and timestamp independently verified unchanged.',
            boundaries: ['Telegram account capability flags are synthetic; no provider connectivity is claimed.', 'Unavailable primary is a redacted real-response UI contract fixture.', 'The single history HTTP 503 is injected; successful history and retry use the real API.', 'Draft persistence is verified across modes and reopen within the page; reload verifies exact conversation only.'] };
        fs.writeFileSync(path.join(outputDir, 'ui3-navigation-report.json'), JSON.stringify(report, null, 2));
        return report;
    } finally {
        await page.unroute('**/api/omni/**', protectOmni);
    }
}

module.exports = { checkOmniWorkspaceNavigation };
