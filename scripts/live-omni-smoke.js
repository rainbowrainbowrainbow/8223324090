#!/usr/bin/env node
'use strict';

/**
 * Read-only production smoke for the Omni workspace.
 *
 * The runner requires an explicit allowlist of QA conversation IDs and blocks
 * every browser-side write except authentication refresh. Opening an unread
 * conversation can therefore attempt a read receipt, but that request is
 * recorded and aborted before it reaches the server.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SECRET_FILE = path.join(os.homedir(), '.eventgenix', 'codex-crm-secrets.ps1');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'omni-live-smoke');
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SAFE_AUTH_POSTS = new Set(['/api/auth/login', '/api/auth/refresh']);
const DRAFT = [
    'QA чернетка Omni — не надсилати.',
    'Другий рядок перевіряє збереження стану та доступність composer.'
].join('\n');

function readEnv(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function parseSecretAssignments(source) {
    const values = Object.create(null);
    const allowed = 'LIVE_SMOKE_URL|LIVE_SMOKE_USER|LIVE_SMOKE_PASS';
    const pattern = new RegExp(`^\\s*\\$env:(${allowed})\\s*=\\s*(['"])(.*?)\\2\\s*$`, 'gm');
    for (const match of String(source || '').matchAll(pattern)) values[match[1]] = match[3];
    return values;
}

function parseConversationIds(value) {
    const ids = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
    assert.ok(ids.every(id => /^\d+$/.test(id) && Number(id) > 0),
        'LIVE_OMNI_QA_CONVERSATION_IDS must contain comma-separated positive integer IDs');
    return [...new Set(ids)];
}

function loadLocalConfig(secretFile = SECRET_FILE) {
    const fileValues = fs.existsSync(secretFile)
        ? parseSecretAssignments(fs.readFileSync(secretFile, 'utf8'))
        : Object.create(null);
    return {
        url: readEnv('LIVE_OMNI_SMOKE_URL', 'LIVE_SMOKE_URL') || fileValues.LIVE_SMOKE_URL || '',
        username: readEnv('LIVE_OMNI_SMOKE_USER', 'LIVE_SMOKE_USER') || fileValues.LIVE_SMOKE_USER || '',
        password: readEnv('LIVE_OMNI_SMOKE_PASS', 'LIVE_SMOKE_PASS') || fileValues.LIVE_SMOKE_PASS || '',
        token: readEnv('LIVE_OMNI_SMOKE_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN'),
        conversationIds: parseConversationIds(readEnv('LIVE_OMNI_QA_CONVERSATION_IDS', 'LIVE_OMNI_QA_CONVERSATION_ID')),
        businessContext: readEnv('LIVE_OMNI_QA_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT') || 'event_genix'
    };
}

function normalizeProductionBase(value) {
    let target;
    try {
        target = new URL(value);
    } catch {
        throw new Error('LIVE_OMNI_SMOKE_URL must be a valid HTTPS URL');
    }
    assert.equal(target.protocol, 'https:', 'LIVE_OMNI_SMOKE_URL must use HTTPS');
    assert.equal(target.username, '', 'LIVE_OMNI_SMOKE_URL must not contain credentials');
    assert.equal(target.password, '', 'LIVE_OMNI_SMOKE_URL must not contain credentials');
    return target.origin;
}

function sanitizedPath(value) {
    let pathname;
    try { pathname = new URL(value).pathname; } catch { pathname = String(value || '').split('?')[0]; }
    return pathname.replace(/\/\d+(?=\/|$)/g, '/:id');
}

function classifyBrowserRequest(method, value, productionOrigin) {
    const normalizedMethod = String(method || '').toUpperCase();
    const url = new URL(value, productionOrigin);
    if (url.origin !== productionOrigin) return { decision: 'external', method: normalizedMethod, path: url.origin };
    const requestPath = url.pathname;
    if (SAFE_METHODS.has(normalizedMethod)) return { decision: 'allow-read', method: normalizedMethod, path: sanitizedPath(url.href) };
    if (normalizedMethod === 'POST' && SAFE_AUTH_POSTS.has(requestPath)) {
        return { decision: 'allow-auth', method: normalizedMethod, path: requestPath };
    }
    return { decision: 'block-write', method: normalizedMethod, path: sanitizedPath(url.href) };
}

function requirePlaywright() {
    try { return require('playwright'); } catch {}
    const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const entry of pathEntries) {
        const normalized = entry.replace(/[\\/]+$/, '');
        if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
        const packageDir = path.join(path.dirname(normalized), 'playwright');
        if (fs.existsSync(packageDir)) return require(packageDir);
    }
    throw new Error('Playwright is unavailable; run through npm run smoke:omni:live');
}

async function fetchJson(base, route, options = {}) {
    const response = await fetch(`${base}${route}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
            ...(options.body ? { 'Content-Type': 'application/json' } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    assert.ok(response.ok, `${options.method || 'GET'} ${route} returned ${response.status}`);
    return response.json();
}

async function resolveToken(base, config) {
    if (config.token) return config.token;
    assert.ok(config.username && config.password,
        'LIVE_SMOKE_USER and LIVE_SMOKE_PASS are required when no token is supplied');
    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST', body: { username: config.username, password: config.password }
    });
    const token = body.accessToken || body.token;
    assert.ok(typeof token === 'string' && token.length > 20, 'login did not return a usable token');
    return token;
}

function inside(inner, outer, tolerance = 1) {
    return Boolean(inner && outer
        && inner.left >= outer.left - tolerance && inner.right <= outer.right + tolerance
        && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance);
}

async function waitForStableUi(page) {
    await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
}

async function layoutSnapshot(page) {
    return page.evaluate(() => {
        const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null;
        const hit = selector => {
            const node = document.querySelector(selector);
            const box = node?.getBoundingClientRect();
            if (!node || !box || box.width < 1 || box.height < 1) return false;
            const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            return Boolean(target && (target === node || node.contains(target)));
        };
        const messages = document.querySelector('#omniMessages');
        const list = document.querySelector('#omniConvList');
        const latest = messages?.querySelector('.omni-msg:last-child');
        return {
            viewport: { width: innerWidth, height: innerHeight },
            pageWidth: document.documentElement.scrollWidth,
            chat: rect('.omni-chat'),
            name: rect('#omniChatName'),
            messages: rect('#omniMessages'),
            composer: rect('#omniInput'),
            send: rect('#omniSendBtn'),
            latest: latest?.getBoundingClientRect().toJSON() || null,
            inputHit: hit('#omniInput'),
            sendHit: hit('#omniSendBtn'),
            history: messages ? { clientHeight: messages.clientHeight, scrollHeight: messages.scrollHeight, scrollTop: messages.scrollTop } : null,
            list: list ? { clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, scrollTop: list.scrollTop, overflowY: getComputedStyle(list).overflowY } : null
        };
    });
}

async function runLiveSmoke(config) {
    const base = normalizeProductionBase(config.url);
    assert.ok(config.conversationIds.length,
        'blocked: set LIVE_OMNI_QA_CONVERSATION_IDS to explicitly allowed QA conversation IDs');
    const token = await resolveToken(base, config);
    const version = await fetchJson(base, '/api/version');
    const { chromium } = requirePlaywright();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const report = {
        schemaVersion: 1,
        status: 'running',
        targetOrigin: base,
        release: { version: version.version || null, commitSha: version.commitSha || null, sourceBranch: version.sourceBranch || null },
        businessContext: config.businessContext,
        qaConversationAllowlistCount: config.conversationIds.length,
        browserWrites: { allowedAuth: [], blockedBusiness: [] },
        backendOperationsConfirmed: ['authentication', 'read-only Omni API requests'],
        backendOperationsNotConfirmed: ['read receipt', 'conversation update', 'message send'],
        screenshots: [],
        checks: Object.create(null)
    };
    const browser = await chromium.launch({ headless: readEnv('LIVE_OMNI_SMOKE_HEADLESS', 'LIVE_SMOKE_HEADLESS') !== 'false' });
    const context = await browser.newContext({ viewport: { width: 1024, height: 600 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(Number(readEnv('LIVE_OMNI_SMOKE_TIMEOUT_MS', 'LIVE_SMOKE_TIMEOUT_MS') || 45_000));
    const seenRequests = [];
    let selectedId = null;
    try {
        await context.addInitScript(({ accessToken, businessContext }) => {
            localStorage.setItem('pzp_token', accessToken);
            localStorage.setItem('pzp_access_token', accessToken);
            localStorage.setItem('eventgenix_business_context', businessContext);
        }, { accessToken: token, businessContext: config.businessContext });
        await context.route('**/*', route => {
            const request = route.request();
            const classification = classifyBrowserRequest(request.method(), request.url(), base);
            if (classification.decision === 'external') {
                const host = new URL(request.url()).hostname;
                if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(host)) return route.continue();
                return route.abort('blockedbyclient');
            }
            seenRequests.push(classification);
            if (classification.decision === 'block-write') {
                report.browserWrites.blockedBusiness.push({ method: classification.method, path: classification.path });
                return route.abort('blockedbyclient');
            }
            if (classification.decision === 'allow-auth') report.browserWrites.allowedAuth.push({ method: classification.method, path: classification.path });
            return route.continue();
        });
        const response = await page.goto(`${base}/omni?businessContext=${encodeURIComponent(config.businessContext)}`, { waitUntil: 'domcontentloaded' });
        assert.ok(response?.ok(), `Omni navigation returned ${response?.status()}`);
        await page.locator('.omni-conv-item').first().waitFor();
        await waitForStableUi(page);
        report.checks.listLoaded = true;

        for (const id of config.conversationIds) {
            if (await page.locator(`.omni-conv-item[data-id="${id}"]`).count()) { selectedId = id; break; }
        }
        assert.ok(selectedId, 'none of the explicitly allowed QA conversations is present in the loaded list');
        const selectedRow = page.locator(`.omni-conv-item[data-id="${selectedId}"]`);
        const channelClass = await selectedRow.locator('.omni-channel-dot').evaluate(node =>
            [...node.classList].find(name => name.startsWith('omni-channel-dot--')) || '');
        const channel = channelClass.replace('omni-channel-dot--', '');
        if (channel && await page.locator(`#omniChannelSelect option[value="${channel}"]`).count()) {
            await Promise.all([
                page.waitForResponse(item => item.request().method() === 'GET'
                    && new URL(item.url()).pathname === '/api/omni/conversations'),
                page.locator('#omniChannelSelect').selectOption(channel)
            ]);
            await page.locator(`.omni-conv-item[data-id="${selectedId}"]`).waitFor();
        }
        report.checks.filterApplied = channel || 'all';
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'live-desktop-list.png'), fullPage: false });
        report.screenshots.push('live-desktop-list.png');

        await page.setViewportSize({ width: 390, height: 420 });
        await waitForStableUi(page);
        const listBefore = await page.locator('#omniConvList').evaluate((node, id) => {
            const row = node.querySelector(`[data-id="${id}"]`);
            if (row) node.scrollTop = Math.max(1, Math.min(row.offsetTop, node.scrollHeight - node.clientHeight));
            else node.scrollTop = Math.max(1, node.scrollHeight - node.clientHeight);
            return { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
        }, selectedId);
        assert.ok(listBefore.scrollHeight > listBefore.clientHeight && listBefore.scrollTop > 0,
            'conversation list did not provide an independently scrollable live surface');
        const expectedListTop = listBefore.scrollTop;
        await page.locator(`.omni-conv-item[data-id="${selectedId}"]`).click();
        await page.locator('#omniInput').waitFor({ state: 'visible' });
        await page.locator('#omniMessages .omni-msg').first().waitFor();
        report.checks.qaConversationOpened = true;
        const status = await page.locator('#omniConversationStatus').inputValue();

        await page.locator('#omniInput').fill(DRAFT);
        await page.locator('#omniMessages').evaluate(node => { node.scrollTop = Math.max(1, node.scrollHeight / 2); });
        const readingTop = await page.locator('#omniMessages').evaluate(node => node.scrollTop);
        assert.ok(readingTop > 0, 'message history did not provide an independently scrollable live surface');
        await page.getByRole('tab', { name: 'Канали', exact: true }).click();
        await page.locator('#omniChannelsWorkspace').waitFor({ state: 'visible' });
        await page.getByRole('tab', { name: 'Стан', exact: true }).click();
        await page.locator('#omniHealthWorkspace').waitFor({ state: 'visible' });
        await page.locator('#omniModeBack').click();
        await page.locator('#omniInput').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#omniInput').inputValue(), DRAFT, 'mode switch lost the draft');
        assert.ok(Math.abs(await page.locator('#omniMessages').evaluate(node => node.scrollTop) - readingTop) < 4,
            'mode switch lost the reading position');
        report.checks.modeRoundTrip = true;

        await page.locator('#omniMobileBack').click();
        await page.locator('.omni-sidebar').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#omniChannelSelect').inputValue(), channel || 'all', 'mobile back lost the channel filter');
        assert.ok(Math.abs(await page.locator('#omniConvList').evaluate(node => node.scrollTop) - expectedListTop) < 4,
            'mobile back lost the list position');
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), selectedId,
            'mobile back did not restore focus to the QA conversation');
        await page.locator(`.omni-conv-item[data-id="${selectedId}"]`).click();
        assert.equal(await page.locator('#omniInput').inputValue(), DRAFT, 'reopening the conversation lost the draft');
        assert.equal(await page.locator('#omniConversationStatus').inputValue(), status, 'conversation status changed during read-only QA');

        await page.locator('#omniMessages').evaluate(node => { node.scrollTop = node.scrollHeight; });
        await waitForStableUi(page);
        const mobile = await layoutSnapshot(page);
        const viewport = { left: 0, top: 0, right: mobile.viewport.width, bottom: mobile.viewport.height };
        assert.ok(mobile.pageWidth <= mobile.viewport.width + 1, 'mobile page has horizontal overflow');
        assert.ok(mobile.name?.width >= 100, 'conversation name is crushed');
        assert.ok(mobile.messages?.height >= 60, 'message history has no usable area');
        assert.ok(inside(mobile.composer, viewport) && inside(mobile.send, viewport), 'composer is outside the mobile viewport');
        assert.ok(mobile.inputHit && mobile.sendHit, 'composer controls are covered');
        assert.ok(mobile.latest && mobile.messages
            && mobile.latest.bottom <= mobile.messages.bottom + 3
            && mobile.latest.bottom >= mobile.messages.top,
        'latest message is not reachable');
        report.checks.mobileLayout = mobile;
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'live-mobile-conversation.png'), fullPage: false });
        report.screenshots.push('live-mobile-conversation.png');

        await page.setViewportSize({ width: 1366, height: 768 });
        await waitForStableUi(page);
        const desktop = await layoutSnapshot(page);
        assert.ok(desktop.pageWidth <= desktop.viewport.width + 1, 'desktop page has horizontal overflow');
        assert.ok(inside(desktop.composer, desktop.chat) && inside(desktop.send, desktop.chat), 'desktop composer escaped the chat');
        report.checks.desktopLayout = desktop;
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'live-desktop-conversation.png'), fullPage: false });
        report.screenshots.push('live-desktop-conversation.png');

        assert.equal(report.browserWrites.blockedBusiness.some(request => request.path.endsWith('/send')), false,
            'the smoke attempted to send a message');
        report.checks.readReceiptBlocked = report.browserWrites.blockedBusiness
            .some(request => request.method === 'POST' && request.path.endsWith('/read'));
        report.checks.requestCount = seenRequests.length;
        report.status = 'passed';
        return report;
    } catch (error) {
        report.status = 'failed';
        report.failure = { message: String(error?.message || error) };
        error.omniLiveReportWritten = true;
        throw error;
    } finally {
        report.finishedAt = new Date().toISOString();
        report.selectedQaConversation = selectedId ? 'allowlisted' : null;
        fs.writeFileSync(path.join(OUTPUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

async function main() {
    const config = loadLocalConfig();
    try {
        const report = await runLiveSmoke(config);
        process.stdout.write(`${JSON.stringify({
            status: report.status,
            release: report.release,
            checks: Object.keys(report.checks),
            blockedBusinessWrites: report.browserWrites.blockedBusiness.length,
            backendOperationsNotConfirmed: report.backendOperationsNotConfirmed,
            artifacts: OUTPUT_DIR
        })}\n`);
    } catch (error) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        const blockedReport = {
            schemaVersion: 1,
            status: /^blocked:/i.test(String(error?.message || '')) ? 'blocked' : 'failed',
            stage: 'preflight-or-live-smoke',
            failure: { message: String(error?.message || error) },
            businessWritesAllowed: false,
            backendOperationsConfirmed: [],
            backendOperationsNotConfirmed: ['read receipt', 'conversation update', 'message send'],
            finishedAt: new Date().toISOString()
        };
        const reportPath = path.join(OUTPUT_DIR, 'report.json');
        if (!error.omniLiveReportWritten) fs.writeFileSync(reportPath, `${JSON.stringify(blockedReport, null, 2)}\n`);
        process.stderr.write(`Omni live smoke blocked or failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

module.exports = { classifyBrowserRequest, loadLocalConfig, normalizeProductionBase, parseConversationIds, parseSecretAssignments, sanitizedPath };

if (require.main === module) main();
