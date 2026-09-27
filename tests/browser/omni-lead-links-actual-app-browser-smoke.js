#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const {
    assertSafeIsolatedTestUrl,
    assertSafeTestDatabaseUrl
} = require('../../scripts/test-db-safety');

const TARGET_URL = String(process.env.TEST_URL || '').trim();
const DATABASE_URL = String(process.env.OMNI_LINKS_BROWSER_DATABASE_URL || '').trim();
const ENABLED = process.env.RUN_OMNI_LEAD_LINKS_BROWSER === 'true';
const HEADLESS = process.env.OMNI_LEAD_LINKS_BROWSER_HEADLESS !== 'false';
const TIMEOUT_MS = Number(process.env.OMNI_LEAD_LINKS_BROWSER_TIMEOUT_MS) || 45_000;
const RUN_ID = `omni-links-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const OUTPUT_DIR = path.join(__dirname, '../../output/playwright/omni-lead-links');

function requireIsolatedTarget() {
    assert.equal(ENABLED, true, 'set RUN_OMNI_LEAD_LINKS_BROWSER=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(TARGET_URL, 'TEST_URL is required');
    assertSafeIsolatedTestUrl(TARGET_URL);
    assert.ok(DATABASE_URL, 'OMNI_LINKS_BROWSER_DATABASE_URL is required');
    assert.notEqual(DATABASE_URL, String(process.env.DATABASE_URL || '').trim(), 'production-style DATABASE_URL fallback is forbidden');
    assertSafeTestDatabaseUrl(DATABASE_URL, process.env);
    assert.ok(process.env.TEST_USER, 'TEST_USER is required');
    assert.ok(process.env.TEST_PASS, 'TEST_PASS is required');
}

function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

function parseBody(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
}

async function api(routePath, options = {}) {
    const response = await fetch(new URL(routePath, TARGET_URL), {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const body = parseBody(await response.text());
    if (!response.ok) {
        throw new Error(`${options.method || 'GET'} ${routePath} returned ${response.status}: ${body?.error || body?.message || ''}`);
    }
    return body;
}

async function login() {
    const body = await api('/api/auth/login', {
        method: 'POST',
        body: { username: process.env.TEST_USER, password: process.env.TEST_PASS }
    });
    const token = body.accessToken || body.token;
    assert.ok(token, '/api/auth/login returns token');
    assert.ok(body.user?.id, '/api/auth/login returns user');
    return {
        token,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user: body.user
    };
}

function storageState(session) {
    return {
        cookies: [],
        origins: [{
            origin: new URL(TARGET_URL).origin,
            localStorage: [
                { name: 'pzp_token', value: session.token },
                { name: 'pzp_access_token', value: session.token },
                { name: 'pzp_refresh_token', value: session.refreshToken },
                { name: 'pzp_refresh_expires_at', value: String(session.refreshExpiresAt || '') },
                { name: 'pzp_current_user', value: JSON.stringify(session.user) },
                { name: 'pzp_crm_business_context', value: 'event_genix' },
                { name: 'pzp_dark_mode', value: 'false' }
            ]
        }]
    };
}

async function seedFixture(pool) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const origin = (await client.query(
            `INSERT INTO conversations (
                channel, external_id, customer_name, customer_phone, status,
                last_message_at, unread_count, meta, business_context
             ) VALUES ('instagram', $1, $2, $3, 'open', NOW() - INTERVAL '2 hours', 0, '{}'::jsonb, 'event_genix')
             RETURNING id`,
            [`fixture-instagram-${RUN_ID}`, `Legacy Instagram ${RUN_ID}`, '+380000000001']
        )).rows[0];
        const manual = (await client.query(
            `INSERT INTO conversations (
                channel, external_id, customer_name, customer_phone, status,
                last_message_at, unread_count, meta, business_context
             ) VALUES ('telegram', $1, $2, $3, 'open', NOW() - INTERVAL '1 hour', 0, '{}'::jsonb, 'event_genix')
             RETURNING id`,
            [`fixture-telegram-${RUN_ID}`, `Manual Telegram ${RUN_ID}`, '+380000000002']
        )).rows[0];
        const lead = (await client.query(
            `INSERT INTO leads (
                client_name, phone, status, source_channel, external_id, raw_payload, business_context
             ) VALUES ($1, $2, 'new', 'instagram', $3, $4::jsonb, 'event_genix')
             RETURNING id`,
            [`Legacy lead ${RUN_ID}`, '+380999999999', `omni_conv_${origin.id}`, JSON.stringify({ conversationId: origin.id })]
        )).rows[0];
        await client.query(
            `UPDATE conversations
                SET meta = jsonb_build_object('lead_id', $2::int, 'leadIds', jsonb_build_array($2::int))
              WHERE id = $1`,
            [origin.id, lead.id]
        );
        await client.query(
            `INSERT INTO conversation_messages (conversation_id, direction, sender_name, content, content_type, created_at)
             VALUES
                ($1, 'inbound', $3, 'Legacy Instagram fixture message', 'text', NOW() - INTERVAL '2 hours'),
                ($2, 'inbound', $4, 'Manual Telegram fixture message', 'text', NOW() - INTERVAL '1 hour')`,
            [origin.id, manual.id, `Legacy Instagram ${RUN_ID}`, `Manual Telegram ${RUN_ID}`]
        );
        await client.query('COMMIT');
        return { leadId: lead.id, originConversationId: origin.id, manualConversationId: manual.id };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function waitForWorkspace(page, leadId) {
    await page.waitForFunction(({ expectedLeadId, expectedRunId }) => {
        const panel = document.getElementById('leadWorkspace');
        return panel
            && panel.getAttribute('aria-hidden') === 'false'
            && !panel.hidden
            && document.getElementById('leadWorkspaceBody')?.innerText.includes(`Legacy lead ${expectedRunId}`)
            && new URL(location.href).searchParams.get('lead') === String(expectedLeadId);
    }, { expectedLeadId: leadId, expectedRunId: RUN_ID }, { timeout: TIMEOUT_MS });
}

async function rowWithText(page, text) {
    const row = page.locator('#leadWorkspaceBody .workspace-conversation-row').filter({ hasText: text }).first();
    await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
    return row;
}

async function assertLinkState(pool, fixture) {
    const rows = (await pool.query(
        `SELECT conversation_id, is_origin, is_primary, source
           FROM lead_conversation_links
          WHERE business_context = 'event_genix' AND lead_id = $1
          ORDER BY conversation_id`,
        [fixture.leadId]
    )).rows;
    assert.deepEqual(rows, [
        {
            conversation_id: fixture.originConversationId,
            is_origin: true,
            is_primary: false,
            source: 'omni_legacy_transition'
        },
        {
            conversation_id: fixture.manualConversationId,
            is_origin: false,
            is_primary: true,
            source: 'lead_workspace_manual'
        }
    ]);
}

async function main() {
    requireIsolatedTarget();
    const { chromium } = requirePlaywright();
    const pool = new Pool({ connectionString: DATABASE_URL, max: 4, connectionTimeoutMillis: 10_000 });
    const fixture = await seedFixture(pool);
    const session = await login();
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
        serviceWorkers: 'block',
        storageState: storageState(session)
    });
    await context.route('https://www.clarity.ms/**', route => route.fulfill({ status: 204, body: '' }));
    await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 204, body: '' }));
    await context.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 204, body: '' }));
    const page = await context.newPage();
    const criticalFailures = [];
    const linkRequests = [];
    page.on('request', request => {
        const url = new URL(request.url());
        if (request.method() === 'POST' && url.pathname === `/api/leads/${fixture.leadId}/conversation-links`) {
            linkRequests.push(url.pathname);
        }
    });
    page.on('response', response => {
        if (response.status() < 400) return;
        const url = new URL(response.url());
        if (url.origin !== new URL(TARGET_URL).origin) return;
        if (/^\/api\/(leads|omni|auth)\b/.test(url.pathname)) {
            criticalFailures.push(`${response.request().method()} ${url.pathname} returned ${response.status()}`);
        }
    });

    try {
        await page.goto(`${TARGET_URL}/sales-funnel?lead=${fixture.leadId}`, { waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, fixture.leadId);

        const originRow = await rowWithText(page, `Legacy Instagram ${RUN_ID}`);
        assert.match(await originRow.innerText(), /Instagram/);
        assert.match(await originRow.innerText(), /Джерело ліда/);
        assert.match(await originRow.innerText(), /Основний/);
        await page.getByRole('link', { name: 'Відкрити Instagram', exact: true }).first().waitFor({ state: 'visible' });

        await page.getByRole('button', { name: 'Прив’язати діалог', exact: true }).last().click();
        await page.locator('#leadConversationLinkModal.active').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.locator('#leadConversationSearch').fill(`Manual Telegram ${RUN_ID}`);
        await page.waitForResponse(response => new URL(response.url()).pathname === '/api/omni/conversations' && response.ok());
        await page.locator('#leadConversationSelect').selectOption(String(fixture.manualConversationId));
        await page.locator('#leadConversationLinkSubmit').evaluate(button => {
            button.click();
            button.click();
        });
        await page.waitForFunction(expected => document.getElementById('leadWorkspaceBody')?.innerText.includes(expected), `Manual Telegram ${RUN_ID}`, { timeout: TIMEOUT_MS });
        assert.equal(linkRequests.length, 1, 'repeated submit emits one manual-link request');

        const manualRow = await rowWithText(page, `Manual Telegram ${RUN_ID}`);
        assert.doesNotMatch(await manualRow.innerText(), /Основний/);
        const makePrimaryResponse = page.waitForResponse(response => {
            const url = new URL(response.url());
            return response.request().method() === 'POST'
                && url.pathname === `/api/leads/${fixture.leadId}/conversation-links/${fixture.manualConversationId}/make-primary`;
        }, { timeout: TIMEOUT_MS });
        await manualRow.getByRole('button', { name: 'Зробити основним', exact: true }).click();
        assert.equal((await makePrimaryResponse).ok(), true, 'make-primary API succeeds');
        await page.waitForFunction(expected => {
            const rows = Array.from(document.querySelectorAll('#leadWorkspaceBody .workspace-conversation-row'));
            return rows.some(row => row.innerText.includes(expected) && row.innerText.includes('Основний'));
        }, `Manual Telegram ${RUN_ID}`, { timeout: TIMEOUT_MS });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, fixture.leadId);
        assert.match(await (await rowWithText(page, `Legacy Instagram ${RUN_ID}`)).innerText(), /Джерело ліда/);
        assert.doesNotMatch(await (await rowWithText(page, `Legacy Instagram ${RUN_ID}`)).innerText(), /Основний/);
        assert.match(await (await rowWithText(page, `Manual Telegram ${RUN_ID}`)).innerText(), /Основний/);
        await assertLinkState(pool, fixture);

        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'desktop-lead-links.png'), fullPage: true });

        const filteredDirectUrl = `${TARGET_URL}/omni?conversation=${fixture.manualConversationId}&channel=instagram&status=closed&search=no-match-${RUN_ID}`;
        await page.goto(filteredDirectUrl, { waitUntil: 'domcontentloaded' });
        await page.locator('#omniChatName').filter({ hasText: `Manual Telegram ${RUN_ID}` }).waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        assert.equal(await page.locator('#omniChannelSelect').inputValue(), 'instagram');
        assert.equal(await page.locator('#omniStatusSelect').inputValue(), 'closed');
        assert.equal(await page.locator('#omniSearch').inputValue(), `no-match-${RUN_ID}`);
        assert.equal(new URL(page.url()).searchParams.get('conversation'), String(fixture.manualConversationId));

        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('#omniChatName').filter({ hasText: `Manual Telegram ${RUN_ID}` }).waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.locator('#omniMobileBack').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        const mobileLayout = await page.locator('#omniContainer').evaluate(node => ({
            view: node.getAttribute('data-mobile-view'),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        }));
        assert.equal(mobileLayout.view, 'conversation');
        assert.ok(mobileLayout.overflow <= 1, `mobile Omni viewport overflows: ${JSON.stringify(mobileLayout)}`);
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'mobile-direct-open.png'), fullPage: true });
        await page.locator('#omniMobileBack').click();
        await page.waitForFunction(() => document.getElementById('omniContainer')?.getAttribute('data-mobile-view') === 'list');
        await page.locator(`.omni-conv-item[data-id="${fixture.manualConversationId}"]`).waitFor({ state: 'visible', timeout: TIMEOUT_MS });

        assert.deepEqual(criticalFailures, [], `unexpected critical API failures: ${criticalFailures.join('; ')}`);
        process.stdout.write(JSON.stringify({
            success: true,
            leadId: fixture.leadId,
            originConversationId: fixture.originConversationId,
            primaryConversationId: fixture.manualConversationId,
            screenshots: ['desktop-lead-links.png', 'mobile-direct-open.png']
        }) + '\n');
    } finally {
        await browser.close().catch(() => {});
        await pool.end().catch(() => {});
    }
}

main().catch(error => {
    process.stderr.write(`[omni-lead-links-browser] ${error.stack || error.message}\n`);
    process.exitCode = 1;
});
