#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');

const TARGET_URL = String(process.env.TEST_URL || '').trim();
const ENABLED = process.env.RUN_MY_DAY_ACTUAL_APP_BROWSER_SMOKE === 'true';
const HEADLESS = process.env.MY_DAY_ACTUAL_APP_BROWSER_HEADLESS !== 'false';
const TIMEOUT_MS = Number(process.env.MY_DAY_ACTUAL_APP_BROWSER_TIMEOUT_MS) || 45_000;
const RUN_ID = `my-day-app-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

function requireIsolatedTarget() {
    assert.equal(ENABLED, true, 'set RUN_MY_DAY_ACTUAL_APP_BROWSER_SMOKE=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(TARGET_URL, 'TEST_URL is required');
    assertSafeIsolatedTestUrl(TARGET_URL);
    assert.ok(process.env.TEST_USER, 'TEST_USER is required');
    assert.ok(process.env.TEST_PASS, 'TEST_PASS is required');
    assert.equal(String(process.env.OPENAI_API_KEY || ''), 'isolated-my-day-openai-mock-key', 'actual-app My Day smoke must not use a real OpenAI key');
    assert.match(String(process.env.OPENAI_API_BASE_URL || ''), /^http:\/\/127\.0\.0\.1:\d+\/v1$/, 'actual-app My Day smoke must use local OpenAI mock');
    assert.ok(Number(process.env.MY_DAY_OPENAI_MOCK_PORT) > 0, 'MY_DAY_OPENAI_MOCK_PORT is required');
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

function jsonResponse(payload, status = 200) {
    return { status, payload };
}

async function readRequestJson(req) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
}

function createOpenAIMockServer(port) {
    const queue = [];
    const calls = [];
    const server = http.createServer(async (req, res) => {
        try {
            if (req.method !== 'POST' || req.url !== '/v1/responses') {
                res.writeHead(404, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: 'not_found' }));
                return;
            }
            const body = await readRequestJson(req);
            calls.push(body);
            const handler = queue.shift() || (() => jsonResponse({
                output_text: JSON.stringify({
                    decision: 'needs_clarification',
                    mode: null,
                    title: null,
                    description: null,
                    impactIds: [],
                    subtasks: [],
                    bundleTitle: null,
                    tasks: [],
                    confidence: confidence(0.2),
                    reason: 'Need more context.'
                })
            }));
            const result = await handler(body);
            res.writeHead(result.status || 200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(result.payload || {}));
        } catch (error) {
            if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    });
    return {
        calls,
        enqueue(handler) {
            queue.push(handler);
        },
        start() {
            return new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, '127.0.0.1', resolve);
            });
        },
        close() {
            return new Promise(resolve => server.close(resolve));
        }
    };
}

function confidence(value = 0.9) {
    return {
        overall: value,
        title: value,
        description: value,
        impacts: value,
        subtasks: value,
        mode: value
    };
}

function openAiDraftOutput(proposal) {
    return jsonResponse({
        output_text: JSON.stringify(proposal),
        usage: { input_tokens: 100, output_tokens: 160, total_tokens: 260 }
    });
}

function checklistProposal(impactIds, today) {
    return {
        decision: 'checklist',
        mode: 'checklist',
        title: `AI checklist actual app ${RUN_ID}`,
        description: 'Prepared through real Profile composer, Express API and disposable PostgreSQL.',
        impactIds,
        subtasks: [
            { title: 'Check CRM report input' },
            { title: 'Verify Hermes notification' },
            { title: 'Review My Day projection' }
        ],
        bundleTitle: null,
        tasks: [],
        confidence: confidence(0.92),
        reason: `Use ${today} schedule from reviewed draft.`
    };
}

function bundleProposal(impactIds, today) {
    return {
        decision: 'task_bundle',
        mode: null,
        title: null,
        description: null,
        impactIds: [],
        subtasks: [],
        bundleTitle: `Actual app AI bundle ${RUN_ID}`,
        tasks: [
            {
                title: `Bundle CRM actual app ${RUN_ID}`,
                description: 'Created as a separate task from the real composer.',
                impactIds: [impactIds[0]],
                priority: 'high',
                scheduleDate: today,
                ownerSuggestion: { userId: null, name: null, reason: 'No auto-assignee in browser smoke.' },
                confidence: confidence(0.91)
            },
            {
                title: `Bundle Hermes actual app ${RUN_ID}`,
                description: 'Second atomic task from the same bundle.',
                impactIds: [impactIds[1] || impactIds[0]],
                priority: 'normal',
                scheduleDate: null,
                ownerSuggestion: { userId: null, name: null, reason: 'No auto-assignee in browser smoke.' },
                confidence: confidence(0.9)
            }
        ],
        confidence: confidence(0.91),
        reason: 'Explicit multi-step plan.'
    };
}

function parseBody(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
}

async function api(base, routePath, options = {}) {
    const response = await fetch(new URL(routePath, base), {
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
        const detail = body?.error || body?.message || body?.code || (typeof body === 'string' ? body : '') || `HTTP ${response.status}`;
        throw new Error(`${options.method || 'GET'} ${routePath} returned ${response.status}: ${detail}`);
    }
    return body;
}

async function login(base) {
    const body = await api(base, '/api/auth/login', {
        method: 'POST',
        body: { username: process.env.TEST_USER, password: process.env.TEST_PASS }
    });
    const token = body.accessToken || body.token;
    assert.ok(token, '/api/auth/login returns token');
    assert.ok(body.user?.id, '/api/auth/login returns user');
    return { token, refreshToken: body.refreshToken || '', refreshExpiresAt: body.refreshExpiresAt || '', user: body.user };
}

function kyivDateOffset(days = 0) {
    const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function extractTitles(value, result = []) {
    if (!value || typeof value !== 'object') return result;
    if (typeof value.title === 'string') result.push(value.title);
    for (const nested of Object.values(value)) {
        if (Array.isArray(nested)) nested.forEach(item => extractTitles(item, result));
        else if (nested && typeof nested === 'object') extractTitles(nested, result);
    }
    return result;
}

async function waitForApiResponse(page, method, pathname) {
    return page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === method && url.pathname === pathname;
    }, { timeout: TIMEOUT_MS });
}

async function responseJson(response, label) {
    const text = await response.text();
    const body = parseBody(text);
    assert.equal(response.ok(), true, `${label}: HTTP ${response.status()} ${body?.error || body?.message || text || ''}`);
    return body;
}

async function installSession(context, session) {
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', refreshExpiresAt);
        localStorage.setItem('pzp_current_user', JSON.stringify(user));
    }, session);
}

async function openMyDayProfile(page) {
    await page.goto(`${TARGET_URL}/profile.html?tab=myday`, { waitUntil: 'domcontentloaded' });
    await page.locator('#cabinetTaskTitle').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
}

async function visibleTaskCard(page, title) {
    const card = page.locator('.cabinet-task-card, [data-cabinet-overdue-triage-row]').filter({ hasText: title }).first();
    await card.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
    return card;
}

async function main() {
    requireIsolatedTarget();
    const { chromium } = requirePlaywright();
    const openAiMock = createOpenAIMockServer(Number(process.env.MY_DAY_OPENAI_MOCK_PORT));
    await openAiMock.start();
    const session = await login(TARGET_URL);
    await api(TARGET_URL, '/api/my-day/starter-kit', { method: 'POST', token: session.token, body: {} });
    const impactsBody = await api(TARGET_URL, '/api/my-day/impacts', { token: session.token });
    const impacts = (impactsBody.impacts || []).filter(impact => impact.active !== false);
    const selectedImpactIds = impacts.slice(0, 3).map(impact => Number(impact.id)).filter(Boolean);
    assert.ok(selectedImpactIds.length >= 2, 'starter kit exposes at least two active impacts');

    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await installSession(context, session);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => consoleErrors.push(error.message));

    try {
        const today = kyivDateOffset(0);
        await openMyDayProfile(page);

        const manualTitle = `Manual actual app My Day ${RUN_ID}`;
        await page.locator('#cabinetTaskTitle').fill(manualTitle);
        const manualCreateResponse = waitForApiResponse(page, 'POST', '/api/tasks');
        await page.locator('#cabinetTaskComposer .cabinet-task-create-submit').click();
        const manualBody = await responseJson(await manualCreateResponse, 'manual profile composer create');
        const manualTaskId = Number(manualBody.task?.id || manualBody.data?.id);
        assert.ok(manualTaskId > 0, 'manual composer returns created task id');
        await visibleTaskCard(page, manualTitle);

        const manualCard = await visibleTaskCard(page, manualTitle);
        await manualCard.locator('[data-cabinet-task-action="time-menu"]').click();
        await page.locator('.my-day-time-popover').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.locator('.my-day-time-popover').getByText(/План|Факт/).first().waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.keyboard.press('Escape');
        await page.locator('.my-day-time-popover').waitFor({ state: 'hidden', timeout: TIMEOUT_MS }).catch(() => {});

        openAiMock.enqueue(body => {
            assert.equal(body.model, 'gpt-5.6-luna');
            assert.equal(body.store, false);
            return openAiDraftOutput(checklistProposal(selectedImpactIds.slice(0, 2), today));
        });
        await page.locator('#cabinetTaskTitle').fill(`AI checklist source ${RUN_ID}`);
        await page.locator('#cabinetTaskDetails').fill('Перевірити CRM звіти і Hermes статуси сьогодні.');
        await page.locator('[data-task-ai-draft-preview]').click();
        await page.locator('[data-task-ai-draft-review]').filter({ hasText: 'AI пропонує одну складну задачу' }).waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.locator('[data-task-ai-draft-accept-all]').click();
        const aiCommitResponse = waitForApiResponse(page, 'POST', '/api/tasks/ai-draft/commit');
        await page.locator('#cabinetTaskComposer .cabinet-task-create-submit').click();
        const aiCommitBody = await responseJson(await aiCommitResponse, 'AI checklist commit from real profile composer');
        const aiTaskId = Number(aiCommitBody.task?.id || aiCommitBody.taskId || aiCommitBody.task_id);
        assert.ok(aiTaskId > 0, 'AI checklist commit returns task id');
        await visibleTaskCard(page, `AI checklist actual app ${RUN_ID}`);

        const cabinetAfterChecklist = await api(TARGET_URL, '/api/tasks/my-cabinet', { token: session.token });
        assert.ok(extractTitles(cabinetAfterChecklist).includes(`AI checklist actual app ${RUN_ID}`), 'AI checklist task is present in My Day/Profile projection');

        openAiMock.enqueue(body => {
            assert.equal(body.model, 'gpt-5.6-luna');
            assert.equal(body.store, false);
            return openAiDraftOutput(bundleProposal(selectedImpactIds.slice(0, 3), today));
        });
        await page.locator('#cabinetTaskTitle').fill(`AI bundle source ${RUN_ID}`);
        await page.locator('#cabinetTaskDetails').fill('Розклади перевірку звітів на CRM і Hermes задачі.');
        await page.locator('[data-task-ai-draft-preview]').click();
        await page.locator('[data-task-ai-draft-review]').filter({ hasText: 'AI пропонує створити' }).waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        const bundleCommitResponse = waitForApiResponse(page, 'POST', '/api/tasks/ai-draft/bundle/commit');
        await page.locator('#cabinetTaskComposer .cabinet-task-create-submit').click();
        const bundleBody = await responseJson(await bundleCommitResponse, 'AI bundle commit from main profile CTA');
        const bundleTaskIds = (bundleBody.bundle?.taskIds || bundleBody.taskIds || []).map(Number).filter(Boolean);
        assert.ok(bundleTaskIds.length >= 2, 'AI bundle commit returns multiple task ids');
        const cabinetAfterBundle = await api(TARGET_URL, '/api/tasks/my-cabinet', { token: session.token });
        const projectedTitles = extractTitles(cabinetAfterBundle);
        assert.ok(projectedTitles.includes(`Bundle CRM actual app ${RUN_ID}`), 'bundle task scheduled for today appears in My Day projection');

        await api(TARGET_URL, '/api/my-day/timer/start', { method: 'POST', token: session.token, body: { taskId: manualTaskId } });
        await page.goto(`${TARGET_URL}/tasks`, { waitUntil: 'domcontentloaded' });
        await page.locator('#taskTitle').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.locator('[data-global-task-timer-elapsed]').first().waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.locator('.global-task-timer__title, .global-task-timer-panel__title, .global-task-timer-chip').first().waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await api(TARGET_URL, '/api/my-day/timer/stop', { method: 'POST', token: session.token, body: {} });
        await page.evaluate(() => {
            window.dispatchEvent(new CustomEvent('crm:timer-updated', { detail: { action: 'stop', emittedAt: Date.now() } }));
            window.GlobalTaskTimer?.hydrate?.({ reason: 'actual-app-smoke-stop' });
        });

        await page.setViewportSize({ width: 390, height: 780 });
        await page.evaluate(() => localStorage.setItem('pzp_dark_mode', 'true'));
        await openMyDayProfile(page);
        const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
        assert.ok(overflow <= 4, `mobile dark My Day should not horizontally overflow, got ${overflow}px`);

        await page.evaluate(() => {
            localStorage.removeItem('pzp_token');
            localStorage.removeItem('pzp_access_token');
            localStorage.removeItem('pzp_refresh_token');
            localStorage.removeItem('pzp_current_user');
            window.dispatchEvent(new CustomEvent('crm:auth-cleared'));
        });
        await page.waitForTimeout(100);
        const timerStillVisible = await page.locator('[data-global-task-timer-elapsed]').count();
        assert.equal(timerStillVisible, 0, 'global timer DOM clears after auth-cleared event');

        assert.ok(openAiMock.calls.length >= 2, 'actual-app smoke used local OpenAI mock for AI previews');
        assert.deepEqual(consoleErrors.filter(line => !/favicon|ResizeObserver/i.test(line)), [], 'browser console has no unexpected errors');
    } finally {
        await browser.close();
        await openAiMock.close();
    }
}

main().catch(error => {
    console.error(`[my-day-actual-app-browser-smoke] ${error.stack || error.message}`);
    process.exitCode = 1;
});
