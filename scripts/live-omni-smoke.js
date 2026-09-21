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
const LIVE_VIEWPORTS = Object.freeze({
    laptop: Object.freeze({ width: 1024, height: 600 }),
    desktop: Object.freeze({ width: 1366, height: 768 }),
    mobile: Object.freeze({ width: 390, height: 844 }),
    smallMobile: Object.freeze({ width: 320, height: 640 }),
    shortMobile: Object.freeze({ width: 390, height: 420 })
});
const SCREENSHOT_REDACTION_SELECTOR = [
    '#currentUser',
    '#sidebarUserName',
    '.sidebar-identity-name',
    '.sidebar-identity-role',
    '.omni-conv-avatar',
    '.omni-conv-name',
    '.omni-conv-preview',
    '#omniChatAvatar',
    '#omniChatName',
    '.omni-msg-sender',
    '.omni-msg-content',
    '[data-omni-attachment]',
    '.omni-file-error'
].join(', ');
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
    const allowed = [
        'LIVE_SMOKE_URL',
        'LIVE_SMOKE_USER',
        'LIVE_SMOKE_PASS',
        'LIVE_OMNI_QA_CONVERSATION_IDS',
        'LIVE_OMNI_QA_BUSINESS_CONTEXT'
    ].join('|');
    const pattern = new RegExp(`^\\s*\\$env:(${allowed})\\s*=\\s*(['"])(.*?)\\2\\s*$`, 'gm');
    for (const match of String(source || '').matchAll(pattern)) values[match[1]] = match[3];
    return values;
}

function parseConversationIds(value) {
    const ids = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
    assert.ok(ids.every(id => /^\d+$/.test(id) && Number(id) > 0),
        'blocked: LIVE_OMNI_QA_CONVERSATION_IDS must contain comma-separated positive integer IDs');
    return [...new Set(ids)];
}

function loadLocalConfig(secretFile = SECRET_FILE) {
    const secretsFilePresent = fs.existsSync(secretFile);
    const fileValues = secretsFilePresent
        ? parseSecretAssignments(fs.readFileSync(secretFile, 'utf8'))
        : Object.create(null);
    return {
        secretsFilePresent,
        url: readEnv('LIVE_OMNI_SMOKE_URL', 'LIVE_SMOKE_URL') || fileValues.LIVE_SMOKE_URL || '',
        username: readEnv('LIVE_OMNI_SMOKE_USER', 'LIVE_SMOKE_USER') || fileValues.LIVE_SMOKE_USER || '',
        password: readEnv('LIVE_OMNI_SMOKE_PASS', 'LIVE_SMOKE_PASS') || fileValues.LIVE_SMOKE_PASS || '',
        token: readEnv('LIVE_OMNI_SMOKE_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN'),
        conversationIds: parseConversationIds(
            readEnv('LIVE_OMNI_QA_CONVERSATION_IDS', 'LIVE_OMNI_QA_CONVERSATION_ID')
            || fileValues.LIVE_OMNI_QA_CONVERSATION_IDS
        ),
        businessContext: readEnv('LIVE_OMNI_QA_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT')
            || fileValues.LIVE_OMNI_QA_BUSINESS_CONTEXT
            || 'event_genix'
    };
}

function assertLiveSmokePreflight(config) {
    assert.ok(config?.secretsFilePresent,
        'blocked: local EventGenix secrets file is unavailable');
    assert.ok(config?.conversationIds?.length,
        'blocked: set LIVE_OMNI_QA_CONVERSATION_IDS to explicitly allowed QA conversation IDs');
    assert.ok(config.token || (config.username && config.password),
        'blocked: local EventGenix secrets do not contain usable live QA credentials');
    try {
        return normalizeProductionBase(config.url);
    } catch (error) {
        throw new Error(`blocked: ${error.message}`);
    }
}

function selectAllowedConversationId(allowedIds, availableIds) {
    const available = new Set((availableIds || []).map(String));
    return (allowedIds || []).map(String).find(id => available.has(id)) || null;
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

function summarizeRequests(requests) {
    const counts = new Map();
    for (const request of requests || []) {
        const key = `${request.decision}|${request.method}|${sanitizedPath(request.path)}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].map(([key, count]) => {
        const [decision, method, requestPath] = key.split('|');
        return { decision, method, path: requestPath, count };
    }).sort((left, right) => `${left.method} ${left.path}`.localeCompare(`${right.method} ${right.path}`));
}

function writeJson(filename, value) {
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), `${JSON.stringify(value, null, 2)}\n`);
}

async function captureSanitizedScreenshot(page, filename) {
    await page.screenshot({
        path: path.join(OUTPUT_DIR, filename),
        fullPage: false,
        mask: [page.locator(SCREENSHOT_REDACTION_SELECTOR)],
        maskColor: '#111827'
    });
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

async function assertConversationViewport(page, label, options = {}) {
    await waitForStableUi(page);
    await page.locator('#omniMessages').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await waitForStableUi(page);
    const layout = await layoutSnapshot(page);
    const viewport = { left: 0, top: 0, right: layout.viewport.width, bottom: layout.viewport.height };
    assert.ok(layout.pageWidth <= layout.viewport.width + 1, `${label}: page has horizontal overflow`);
    assert.ok(layout.name?.width >= (options.minNameWidth || 80), `${label}: conversation name is crushed`);
    assert.ok(layout.messages?.height >= 60,
        `${label}: message history has no usable area: ${JSON.stringify({
            chatHeight: layout.chat?.height || 0,
            messagesTop: layout.messages?.top || 0,
            messagesHeight: layout.messages?.height || 0,
            composerTop: layout.composer?.top || 0,
            composerHeight: layout.composer?.height || 0
        })}`);
    assert.ok(inside(layout.composer, viewport) && inside(layout.send, viewport), `${label}: composer is outside the viewport`);
    assert.ok(layout.inputHit && layout.sendHit, `${label}: composer controls are covered`);
    assert.ok(layout.latest && layout.messages
        && layout.latest.bottom <= layout.messages.bottom + 3
        && layout.latest.bottom >= layout.messages.top,
    `${label}: latest message is not reachable`);
    return layout;
}

async function runLiveSmoke(config) {
    const base = assertLiveSmokePreflight(config);
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
    const context = await browser.newContext({ viewport: LIVE_VIEWPORTS.laptop, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(Number(readEnv('LIVE_OMNI_SMOKE_TIMEOUT_MS', 'LIVE_SMOKE_TIMEOUT_MS') || 45_000));
    const seenRequests = [];
    const actionTrace = [];
    const traceStep = name => actionTrace.push({ name, at: new Date().toISOString() });
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
        traceStep('production Omni list loaded');

        const availableConversationIds = await page.locator('.omni-conv-item[data-id]').evaluateAll(nodes =>
            nodes.map(node => node.dataset.id).filter(Boolean));
        selectedId = selectAllowedConversationId(config.conversationIds, availableConversationIds);
        assert.ok(selectedId, 'blocked: none of the explicitly allowed QA conversations is present in the loaded list');
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
        traceStep('allowlisted conversation located and channel filter applied');
        await captureSanitizedScreenshot(page, 'live-laptop-list-1024x600.png');
        report.screenshots.push('live-laptop-list-1024x600.png');

        await page.setViewportSize(LIVE_VIEWPORTS.shortMobile);
        await page.waitForFunction(() => {
            const navigation = document.getElementById('sidebarNav');
            if (!navigation) return false;
            return !navigation.classList.contains('open')
                && navigation.getBoundingClientRect().right <= 1;
        });
        await waitForStableUi(page);
        const listBefore = await page.locator('#omniConvList').evaluate((node, id) => {
            const row = node.querySelector(`[data-id="${id}"]`);
            const navigation = document.getElementById('sidebarNav');
            const navigationRect = navigation?.getBoundingClientRect();
            node.scrollTop = Math.max(1, node.scrollHeight - node.clientHeight);
            if (row) row.scrollIntoView({ block: 'nearest' });
            return {
                viewportWidth: window.innerWidth,
                scrollTop: node.scrollTop,
                scrollHeight: node.scrollHeight,
                clientHeight: node.clientHeight,
                selectedRowHeight: row?.getBoundingClientRect().height || 0,
                navigationOpen: navigation?.classList.contains('open') || false,
                navigationRight: navigationRect?.right || 0,
                navigationTransform: navigation ? getComputedStyle(navigation).transform : ''
            };
        }, selectedId);
        await captureSanitizedScreenshot(page, 'live-short-mobile-list-390x420.png');
        report.screenshots.push('live-short-mobile-list-390x420.png');
        assert.ok(listBefore.clientHeight >= listBefore.selectedRowHeight && listBefore.selectedRowHeight >= 48,
            `short-mobile conversation list has no complete usable row: ${JSON.stringify(listBefore)}`);
        assert.ok(listBefore.scrollHeight > listBefore.clientHeight,
            'conversation list did not provide an independently scrollable live surface');
        const expectedListTop = listBefore.scrollTop;
        await page.locator(`.omni-conv-item[data-id="${selectedId}"]`).click();
        await page.locator('#omniInput').waitFor({ state: 'visible' });
        await page.locator('#omniMessages .omni-msg').first().waitFor();
        report.checks.qaConversationOpened = true;
        traceStep('allowlisted conversation opened');
        const status = await page.locator('#omniConversationStatus').inputValue();

        await page.locator('#omniInput').fill(DRAFT);
        await page.locator('#omniMessages').evaluate(node => { node.scrollTop = Math.max(1, node.scrollHeight / 2); });
        const readingTop = await page.locator('#omniMessages').evaluate(node => node.scrollTop);
        assert.ok(readingTop > 0, 'message history did not provide an independently scrollable live surface');
        assert.equal(await page.locator('.omni-workspace-topbar').isVisible(), false,
            'short-mobile conversation did not enter the compact keyboard-safe layout');
        await page.locator('#omniChatMore > summary').click();
        const mobileChannelsAction = page.locator('#omniChatMore .omni-mobile-mode-action[data-omni-mode="channels"]');
        assert.ok(await mobileChannelsAction.isVisible(),
            'channels action is inaccessible while the short-mobile topbar is hidden');
        await mobileChannelsAction.click();
        await page.locator('#omniChannelsWorkspace').waitFor({ state: 'visible' });
        await page.getByRole('tab', { name: 'Стан', exact: true }).click();
        await page.locator('#omniHealthWorkspace').waitFor({ state: 'visible' });
        await page.locator('#omniModeBack').click();
        await page.locator('#omniInput').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#omniInput').inputValue(), DRAFT, 'mode switch lost the draft');
        assert.ok(Math.abs(await page.locator('#omniMessages').evaluate(node => node.scrollTop) - readingTop) < 4,
            'mode switch lost the reading position');
        report.checks.modeRoundTrip = true;
        traceStep('channels and health round trip preserved draft and reading position');

        await page.locator('#omniMobileBack').click();
        await page.locator('.omni-sidebar').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#omniChannelSelect').inputValue(), channel || 'all', 'mobile back lost the channel filter');
        const restoredListState = await page.locator('#omniConvList').evaluate(node => ({
            scrollTop: node.scrollTop,
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight
        }));
        assert.ok(Math.abs(restoredListState.scrollTop - expectedListTop) < 4,
            `mobile back lost the list position (before ${JSON.stringify(listBefore)}, after ${JSON.stringify(restoredListState)})`);
        assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), selectedId,
            'mobile back did not restore focus to the QA conversation');
        await page.locator(`.omni-conv-item[data-id="${selectedId}"]`).click();
        assert.equal(await page.locator('#omniInput').inputValue(), DRAFT, 'reopening the conversation lost the draft');
        assert.equal(await page.locator('#omniConversationStatus').inputValue(), status, 'conversation status changed during read-only QA');
        traceStep('mobile back and reopen preserved list state, focus, draft, and status');

        report.checks.viewportMatrix = Object.create(null);
        for (const [name, viewportSize] of [
            ['shortMobile', LIVE_VIEWPORTS.shortMobile],
            ['mobile', LIVE_VIEWPORTS.mobile],
            ['smallMobile', LIVE_VIEWPORTS.smallMobile],
            ['laptop', LIVE_VIEWPORTS.laptop],
            ['desktop', LIVE_VIEWPORTS.desktop]
        ]) {
            await page.setViewportSize(viewportSize);
            const filename = `live-${name}-${viewportSize.width}x${viewportSize.height}.png`;
            await captureSanitizedScreenshot(page, filename);
            report.screenshots.push(filename);
            report.checks.viewportMatrix[name] = await assertConversationViewport(page, name, {
                minNameWidth: name === 'smallMobile' ? 72 : 80
            });
            traceStep(`${name} viewport checked`);
        }

        await page.setViewportSize(LIVE_VIEWPORTS.mobile);
        const sidebarToggle = page.locator('#sidebarToggle');
        await sidebarToggle.click();
        await page.waitForFunction(() => document.getElementById('sidebarNav')?.classList.contains('open')
            && document.body.classList.contains('sidebar-mobile-open'));
        report.checks.mobileNavigationOpen = true;
        await captureSanitizedScreenshot(page, 'live-mobile-navigation-open-390x844.png');
        report.screenshots.push('live-mobile-navigation-open-390x844.png');
        await page.locator('#sidebarOverlay').click();
        await page.waitForFunction(() => !document.getElementById('sidebarNav')?.classList.contains('open')
            && !document.body.classList.contains('sidebar-mobile-open'));
        assert.equal(await page.locator('#omniInput').inputValue(), DRAFT, 'mobile navigation round trip lost the draft');
        report.checks.mobileNavigationClosed = true;
        traceStep('mobile CRM navigation opened and closed without losing the draft');

        assert.equal(report.browserWrites.blockedBusiness.some(request => request.path.endsWith('/send')), false,
            'the smoke attempted to send a message');
        report.checks.readReceiptBlocked = report.browserWrites.blockedBusiness
            .some(request => request.method === 'POST' && request.path.endsWith('/read'));
        report.checks.requestCount = seenRequests.length;
        report.artifacts = ['report.json', 'trace.json', 'network-summary.json', ...report.screenshots];
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
        writeJson('network-summary.json', {
            schemaVersion: 1,
            targetOrigin: base,
            requests: summarizeRequests(seenRequests),
            businessWritesAllowed: false
        });
        writeJson('trace.json', {
            schemaVersion: 1,
            kind: 'sanitized-action-trace',
            note: 'Playwright DOM/network tracing is intentionally disabled because production payloads may contain customer data.',
            steps: actionTrace
        });
        writeJson('report.json', report);
        await context.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

async function main() {
    try {
        const config = loadLocalConfig();
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

module.exports = {
    LIVE_VIEWPORTS,
    assertLiveSmokePreflight,
    classifyBrowserRequest,
    loadLocalConfig,
    normalizeProductionBase,
    parseConversationIds,
    parseSecretAssignments,
    sanitizedPath,
    selectAllowedConversationId,
    summarizeRequests
};

if (require.main === module) main();
