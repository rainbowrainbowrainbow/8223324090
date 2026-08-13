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
    const interceptors = [];
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
            const interceptorIndex = interceptors.findIndex(item => item.predicate(body));
            const handler = interceptorIndex >= 0
                ? interceptors.splice(interceptorIndex, 1)[0].handler
                : queue.shift() || (() => jsonResponse({
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
        intercept(predicate, handler) {
            interceptors.push({ predicate, handler });
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

function isSameTargetOrigin(responseUrl) {
    try {
        return new URL(responseUrl).origin === new URL(TARGET_URL).origin;
    } catch {
        return false;
    }
}

function isCriticalApiPath(pathname = '') {
    return pathname === '/api/auth/login'
        || pathname === '/api/auth/verify'
        || pathname === '/api/auth/profile'
        || pathname === '/api/tasks'
        || pathname === '/api/tasks/my-cabinet'
        || pathname.startsWith('/api/tasks/')
        || pathname === '/api/my-day/timer'
        || pathname.startsWith('/api/my-day/')
        || pathname.includes('/ai-draft')
        || pathname.includes('/classification');
}

function isOptionalProfileApiPath(pathname = '') {
    return pathname === '/api/achievements'
        || pathname === '/api/quests/daily'
        || pathname === '/api/quests/titles'
        || pathname === '/api/streaks'
        || pathname === '/api/wallet'
        || pathname === '/api/inventory'
        || pathname === '/api/auth/security'
        || pathname === '/api/business/live-counters'
        || pathname.startsWith('/api/dashboard/')
        || pathname === '/api/hr/today'
        || pathname === '/api/hr/availability'
        || /^\/api\/bookings\/\d{4}-\d{2}-\d{2}$/.test(pathname)
        || pathname === '/api/bookings/occupancy'
        || pathname === '/api/training/knowledge-base'
        || pathname === '/api/training/materials'
        || pathname.startsWith('/api/gamification/');
}

function isAllowedOptionalConsoleFailure(line = '') {
    if (/^Widget\s+\S+\s+load error:/i.test(line)) return true;
    return false;
}

function consoleEventText(event) {
    return typeof event === 'string' ? event : String(event?.text || '');
}

function consoleEventLocationUrl(event) {
    const url = typeof event === 'string' ? '' : String(event?.location?.url || '');
    if (url) return url;
    const text = consoleEventText(event);
    const match = text.match(/https?:\/\/\S+/i);
    return match ? match[0] : '';
}

function isOptionalConsoleResourceFailure(event) {
    const text = consoleEventText(event);
    const match = text.match(/Failed to load resource: the server responded with a status of (\d{3})\b/i);
    if (!match) return false;
    const locationUrl = consoleEventLocationUrl(event);
    if (!locationUrl || !isSameTargetOrigin(locationUrl)) return false;
    return isOptionalProfileApiPath(new URL(locationUrl).pathname);
}

function consumeExpectedConsoleResourceFailure(event, expected = []) {
    const match = consoleEventText(event).match(/Failed to load resource: the server responded with a status of (\d{3})\b/i);
    if (!match) return false;
    const status = Number(match[1]);
    const index = expected.findIndex(item => Number(item.status) === status);
    if (index < 0) return false;
    expected.splice(index, 1);
    return true;
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

function extractTodayTitles(projection) {
    return extractTitles(Array.isArray(projection?.today) ? projection.today : []);
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

async function browserLogin(page, session) {
    assert.ok(session?.token, 'browser session seed requires access token');
    assert.ok(session?.user?.id, 'browser session seed requires user');
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(
        localStorage.getItem('pzp_token')
        && localStorage.getItem('pzp_current_user')
    ), null, { timeout: TIMEOUT_MS });
    const verify = await page.evaluate(async () => {
        const token = localStorage.getItem('pzp_token') || localStorage.getItem('pzp_access_token') || '';
        const response = await fetch('/api/auth/verify', {
            headers: { Authorization: `Bearer ${token}` }
        });
        return { ok: response.ok, status: response.status };
    });
    assert.equal(verify.ok, true, `browser auth verify succeeds: ${JSON.stringify(verify)}`);
}

async function openMyDayProfile(page) {
    const projectionLoad = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'GET'
            && url.pathname === '/api/tasks/my-day';
    }, { timeout: TIMEOUT_MS }).catch(() => null);
    await page.goto(`${TARGET_URL}/profile?tab=myday`, { waitUntil: 'domcontentloaded' });
    assert.notEqual(new URL(page.url()).pathname, '/', 'authenticated profile navigation should not redirect to the root fallback');
    try {
        await page.locator('#cabinetTaskTitle').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
    } catch (error) {
        const diagnostics = await page.evaluate(() => ({
            url: location.href,
            readyState: document.readyState,
            mainAppHidden: Boolean(document.getElementById('mainApp')?.classList.contains('hidden')),
            hasComposer: Boolean(document.getElementById('cabinetTaskComposer')),
            authStorage: {
                hasLegacyToken: Boolean(localStorage.getItem('pzp_token')),
                hasAccessToken: Boolean(localStorage.getItem('pzp_access_token')),
                hasCurrentUser: Boolean(localStorage.getItem('pzp_current_user')),
                currentUserId: (() => {
                    try { return JSON.parse(localStorage.getItem('pzp_current_user') || '{}')?.id || null; }
                    catch { return null; }
                })()
            },
            activeProfileTab: document.querySelector('.profile-tab.active, [data-profile-tab].active')?.textContent?.trim() || null,
            visibleHeading: Array.from(document.querySelectorAll('h1,h2,h3')).map(node => node.textContent?.trim()).filter(Boolean).slice(0, 8)
        })).catch(() => null);
        throw new Error(`${error.message}; profile My Day composer diagnostics: ${JSON.stringify(diagnostics)}`);
    }
    try {
        await waitForMyDayProfileRuntime(page);
    } catch (error) {
        const diagnostics = await page.evaluate(() => {
            const form = document.getElementById('cabinetTaskComposer');
            return {
                url: location.href,
                readyState: document.readyState,
                hasForm: Boolean(form),
                formRequestSubmit: typeof form?.requestSubmit,
                hasCreateCabinetTask: typeof window.createCabinetTask === 'function',
                hasTaskCreate: Boolean(window.TaskCreate),
                hasCreateTask: typeof window.TaskCreate?.createTask === 'function',
                hasTaskAiDraft: Boolean(window.TaskAiDraft),
                hasAiPreviewButton: Boolean(document.querySelector('[data-task-ai-draft-preview]')),
                mainAppHidden: Boolean(document.getElementById('mainApp')?.classList.contains('hidden'))
            };
        }).catch(() => null);
        throw new Error(`${error.message}; profile runtime diagnostics: ${JSON.stringify(diagnostics)}`);
    }
    await projectionLoad;
    await page.locator('#cabinetMyDaySegmentPanel').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
    await page.waitForFunction(() => {
        const form = document.getElementById('cabinetTaskComposer');
        return Boolean(
            form
            && document.body.contains(form)
            && form.querySelector('#cabinetTaskTitle')
            && form.querySelector('.cabinet-task-create-submit')
        );
    }, null, { timeout: TIMEOUT_MS });
}

async function waitForMyDayProfileRuntime(page) {
    await page.waitForFunction(() => {
        const form = document.getElementById('cabinetTaskComposer');
        return Boolean(
            form
            && typeof form.requestSubmit === 'function'
            && document.querySelector('[data-task-ai-draft-preview]')
        );
    }, null, { timeout: TIMEOUT_MS });
}

async function openTasksPage(page) {
    const permissionsLoad = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'GET'
            && url.pathname === '/api/tasks/permissions';
    }, { timeout: TIMEOUT_MS });
    await page.goto(`${TARGET_URL}/tasks`, { waitUntil: 'domcontentloaded' });
    assert.notEqual(new URL(page.url()).pathname, '/', 'authenticated tasks navigation should not redirect to the root fallback');
    try {
        await page.locator('#taskTitle').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.waitForFunction(() => Boolean(
            window.TaskCreate?.createTask
            && window.TaskAiDraft
            && !document.getElementById('mainApp')?.classList.contains('hidden')
        ), null, { timeout: TIMEOUT_MS });
        const permissionsResponse = await permissionsLoad;
        assert.equal(permissionsResponse.ok(), true, `Tasks permissions bootstrap succeeds: HTTP ${permissionsResponse.status()}`);
    } catch (error) {
        const diagnostics = await page.evaluate(() => ({
            url: location.href,
            readyState: document.readyState,
            hasTaskTitle: Boolean(document.getElementById('taskTitle')),
            hasTaskCreate: Boolean(window.TaskCreate),
            hasCreateTask: typeof window.TaskCreate?.createTask === 'function',
            hasTaskAiDraft: Boolean(window.TaskAiDraft),
            mainAppHidden: Boolean(document.getElementById('mainApp')?.classList.contains('hidden')),
            currentUser: Boolean(window.AppState?.currentUser),
            authPermissions: Boolean(window.AppState?.authPermissions)
        })).catch(() => null);
        throw new Error(`${error.message}; tasks runtime diagnostics: ${JSON.stringify(diagnostics)}`);
    }
}

async function submitCabinetComposer(page) {
    const submit = page.locator('#cabinetTaskComposer .cabinet-task-create-submit');
    await submit.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
    await page.locator('#cabinetTaskComposer').evaluate(form => {
        const button = form.querySelector('.cabinet-task-create-submit');
        if (typeof form.requestSubmit === 'function') form.requestSubmit(button);
        else button?.click();
    });
}

async function requestSubmitCabinetComposer(page) {
    await page.locator('#cabinetTaskComposer').evaluate(form => {
        const button = form.querySelector('.cabinet-task-create-submit');
        if (typeof form.requestSubmit !== 'function') throw new Error('cabinetTaskComposer.requestSubmit is not available');
        form.requestSubmit(button);
    });
}

async function captureTaskCreateMethod(page, methodName) {
    await page.evaluate(method => {
        if (!window.TaskCreate || typeof window.TaskCreate[method] !== 'function') {
            throw new Error(`TaskCreate.${method} is not available`);
        }
        window.__myDayActualAppTaskCreateCapture = null;
        const current = window.TaskCreate[method];
        if (current.__myDayActualAppCaptureWrapped) return;
        const wrapped = async function wrappedTaskCreateMethod(...args) {
            try {
                const result = await current.apply(this, args);
                window.__myDayActualAppTaskCreateCapture = { method, result };
                return result;
            } catch (error) {
                window.__myDayActualAppTaskCreateCapture = {
                    method,
                    error: error?.message || String(error)
                };
                throw error;
            }
        };
        wrapped.__myDayActualAppCaptureWrapped = true;
        wrapped.__myDayActualAppOriginal = current;
        window.TaskCreate[method] = wrapped;
    }, methodName);
}

async function readTaskCreateCapture(page, methodName) {
    return page.evaluate(method => {
        const capture = window.__myDayActualAppTaskCreateCapture || null;
        if (!capture || capture.method !== method) return null;
        return capture;
    }, methodName);
}

async function waitForTaskCreateResult(page, methodName, timeout = TIMEOUT_MS) {
    await page.waitForFunction(method => {
        const capture = window.__myDayActualAppTaskCreateCapture;
        return Boolean(capture && capture.method === method);
    }, methodName, { timeout });
    const capture = await readTaskCreateCapture(page, methodName);
    if (capture?.error) throw new Error(`TaskCreate.${methodName} failed: ${capture.error}`);
    return capture?.result || null;
}

async function cabinetComposerDiagnostics(page) {
    return page.evaluate(() => {
        const form = document.getElementById('cabinetTaskComposer');
        const title = document.getElementById('cabinetTaskTitle');
        const details = document.getElementById('cabinetTaskDetails');
        return {
            hasForm: Boolean(form),
            hasTitle: Boolean(title),
            titleValueLength: String(title?.value || '').trim().length,
            detailsValueLength: String(details?.value || '').trim().length,
            submitDisabled: Boolean(form?.querySelector('.cabinet-task-create-submit')?.disabled),
            hasCreateCabinetTask: typeof window.createCabinetTask === 'function',
            hasTaskCreate: Boolean(window.TaskCreate),
            hasCreateTask: typeof window.TaskCreate?.createTask === 'function',
            hasCommitAiDraft: typeof window.TaskCreate?.commitAiDraft === 'function',
            hasCommitAiDraftBundle: typeof window.TaskCreate?.commitAiDraftBundle === 'function',
            aiCommitType: window.TaskAiDraft?.commitPayloadFor?.(form)?.commitType || null,
            lastCapture: window.__myDayActualAppTaskCreateCapture || null
        };
    });
}

async function snapshotCabinetComposerDraft(page) {
    return page.evaluate(() => {
        const valueFor = fieldId => {
            const form = document.getElementById('cabinetTaskComposer');
            const field = form?.querySelector(`#${CSS.escape(fieldId)}`) || document.getElementById(fieldId);
            return field?.value || '';
        };
        return {
            title: valueFor('cabinetTaskTitle'),
            details: valueFor('cabinetTaskDetails')
        };
    });
}

async function restoreCabinetComposerDraft(page, draft = {}) {
    await page.evaluate(snapshot => {
        for (const [fieldId, fieldValue] of Object.entries({
            cabinetTaskTitle: snapshot.title || '',
            cabinetTaskDetails: snapshot.details || ''
        })) {
            const form = document.getElementById('cabinetTaskComposer');
            const field = form?.querySelector(`#${CSS.escape(fieldId)}`) || document.getElementById(fieldId);
            if (!field) continue;
            field.value = fieldValue;
            field.setAttribute('value', fieldValue);
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, draft);
    if (draft.title) await waitForCabinetFieldValue(page, 'cabinetTaskTitle', draft.title);
    if (draft.details) await waitForCabinetFieldValue(page, 'cabinetTaskDetails', draft.details);
}

async function submitCabinetComposerForTaskCreate(page, methodName) {
    await captureTaskCreateMethod(page, methodName);
    const draftSnapshot = await snapshotCabinetComposerDraft(page);
    await submitCabinetComposer(page);
    const quickResult = await Promise.race([
        waitForTaskCreateResult(page, methodName, 5_000).catch(() => null),
        page.waitForTimeout(5_000).then(() => null)
    ]);
    if (quickResult) return quickResult;
    await restoreCabinetComposerDraft(page, draftSnapshot);
    await requestSubmitCabinetComposer(page);
    try {
        return await waitForTaskCreateResult(page, methodName);
    } catch (error) {
        const diagnostics = await cabinetComposerDiagnostics(page).catch(() => null);
        throw new Error(`${error.message}; composer diagnostics: ${JSON.stringify(diagnostics)}`);
    }
}

async function fillCabinetField(page, id, value) {
    await page.evaluate(({ fieldId, fieldValue }) => {
        const form = document.getElementById('cabinetTaskComposer');
        const field = form?.querySelector(`#${CSS.escape(fieldId)}`) || document.getElementById(fieldId);
        if (!field) throw new Error(`${fieldId} not found`);
        field.value = fieldValue;
        field.setAttribute('value', fieldValue);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
    }, { fieldId: id, fieldValue: value });
    await waitForCabinetFieldValue(page, id, value);
}

async function waitForCabinetFieldValue(page, id, value) {
    await page.waitForFunction(({ fieldId, fieldValue }) => {
        const form = document.getElementById('cabinetTaskComposer');
        const formField = form?.querySelector(`#${CSS.escape(fieldId)}`);
        return Boolean(formField) && String(formField.value || '') === String(fieldValue);
    }, { fieldId: id, fieldValue: value }, { timeout: TIMEOUT_MS });
}

async function submitTasksComposer(page) {
    await page.locator('#addTaskBtn').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
    await page.locator('#addTaskBtn').click();
}

async function evaluateAfterNavigationSettles(page, callback, arg) {
    await page.waitForLoadState('domcontentloaded', { timeout: TIMEOUT_MS }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    try {
        return await page.evaluate(callback, arg);
    } catch (error) {
        if (!/Execution context was destroyed/i.test(String(error?.message || error))) {
            throw error;
        }
        await page.waitForLoadState('domcontentloaded', { timeout: TIMEOUT_MS }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        return page.evaluate(callback, arg);
    }
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
    const targetOrigin = new URL(TARGET_URL).origin;
    const sessionStorageState = {
        cookies: [],
        origins: [{
            origin: targetOrigin,
            localStorage: [
                { name: 'pzp_token', value: session.token },
                { name: 'pzp_access_token', value: session.token },
                ...(session.refreshToken ? [{ name: 'pzp_refresh_token', value: session.refreshToken }] : []),
                ...(session.refreshExpiresAt ? [{ name: 'pzp_refresh_expires_at', value: String(session.refreshExpiresAt) }] : []),
                { name: 'pzp_current_user', value: JSON.stringify(session.user) },
                { name: 'pzp_crm_business_context', value: 'event_genix' },
                { name: 'pzp_dark_mode', value: 'false' }
            ]
        }]
    };
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block', storageState: sessionStorageState });
    await context.route('https://www.clarity.ms/**', route => route.fulfill({
        status: 204,
        contentType: 'application/javascript',
        body: ''
    }));
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user }) => {
        if (token && !localStorage.getItem('pzp_token') && !localStorage.getItem('pzp_access_token')) {
            localStorage.setItem('pzp_token', token);
            localStorage.setItem('pzp_access_token', token);
        }
        if (refreshToken && !localStorage.getItem('pzp_refresh_token')) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt && !localStorage.getItem('pzp_refresh_expires_at')) localStorage.setItem('pzp_refresh_expires_at', String(refreshExpiresAt));
        if (user && !localStorage.getItem('pzp_current_user')) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        if (!localStorage.getItem('pzp_crm_business_context')) localStorage.setItem('pzp_crm_business_context', 'event_genix');
        if (!localStorage.getItem('pzp_dark_mode')) localStorage.setItem('pzp_dark_mode', 'false');
        window.__eventGenixLiveQaReadOnly = true;
    }, session);
    const page = await context.newPage();
    const consoleErrors = [];
    const apiFailures = [];
    const requestFailures = [];
    const expectedApiFailures = [];
    const expectedConsoleFailures = [];
    const optionalConsoleFailures = [];
    page.on('console', message => {
        if (message.type() !== 'error') return;
        consoleErrors.push({ text: message.text(), location: message.location() });
    });
    page.on('pageerror', error => consoleErrors.push({ text: error.message, location: null }));
    page.on('response', response => {
        if (!isSameTargetOrigin(response.url()) || response.status() < 400) return;
        const url = new URL(response.url());
        if (isOptionalProfileApiPath(url.pathname)) {
            optionalConsoleFailures.push({ status: response.status(), pathname: url.pathname });
            return;
        }
        const failureLabel = `${response.request().method()} ${url.pathname} returned ${response.status()}`;
        const expectedIndex = expectedApiFailures.findIndex(item => (
            item.method === response.request().method()
            && item.pathname === url.pathname
            && item.status === response.status()
        ));
        if (expectedIndex >= 0) {
            expectedApiFailures.splice(expectedIndex, 1);
            return;
        }
        if (isCriticalApiPath(url.pathname)) {
            console.error(`[my-day-actual-app-browser-smoke] unexpected critical API failure: ${failureLabel}`);
            apiFailures.push(failureLabel);
            return;
        }
        console.error(`[my-day-actual-app-browser-smoke] unexpected API failure: ${failureLabel}`);
        apiFailures.push(failureLabel);
    });
    page.on('requestfailed', request => {
        if (!isSameTargetOrigin(request.url())) return;
        const url = new URL(request.url());
        if (isOptionalProfileApiPath(url.pathname)) return;
        if (isCriticalApiPath(url.pathname)) {
            const failureLabel = `${request.method()} ${url.pathname}: ${request.failure()?.errorText || 'failed'}`;
            console.error(`[my-day-actual-app-browser-smoke] unexpected critical request failure: ${failureLabel}`);
            requestFailures.push(failureLabel);
        }
    });

    try {
        const today = kyivDateOffset(0);
        await browserLogin(page, session);
        await openMyDayProfile(page);

        const manualTitle = `Manual actual app My Day ${RUN_ID}`;
        await fillCabinetField(page, 'cabinetTaskTitle', manualTitle);
        const manualBody = await submitCabinetComposerForTaskCreate(page, 'createTask');
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
        await fillCabinetField(page, 'cabinetTaskTitle', `AI checklist source ${RUN_ID}`);
        await fillCabinetField(page, 'cabinetTaskDetails', 'Перевірити CRM звіти і Hermes статуси сьогодні.');
        await page.locator('[data-task-ai-draft-preview]').click();
        await page.locator('[data-task-ai-draft-review]').filter({ hasText: 'AI пропонує одну складну задачу' }).waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.locator('[data-task-ai-draft-accept-all]').click();
        await page.waitForFunction(() => {
            const composer = document.getElementById('cabinetTaskComposer');
            const payload = window.TaskAiDraft?.commitPayloadFor?.(composer);
            return ['single', 'checklist'].includes(payload?.commitType);
        }, null, { timeout: TIMEOUT_MS });
        const aiCommitResponse = waitForApiResponse(page, 'POST', '/api/tasks/ai-draft/commit');
        await submitCabinetComposer(page);
        const aiCommitBody = await responseJson(await aiCommitResponse, 'Profile AI checklist commit');
        const aiTaskId = Number(aiCommitBody.task?.id || aiCommitBody.taskId || aiCommitBody.task_id);
        assert.ok(aiTaskId > 0, 'AI checklist commit returns task id');
        await visibleTaskCard(page, `AI checklist actual app ${RUN_ID}`);

        const cabinetAfterChecklist = await api(TARGET_URL, '/api/tasks/my-cabinet', { token: session.token });
        assert.ok(extractTodayTitles(cabinetAfterChecklist).includes(`AI checklist actual app ${RUN_ID}`), 'AI checklist task is present in My Day/Profile today projection');

        openAiMock.enqueue(body => {
            assert.equal(body.model, 'gpt-5.6-luna');
            assert.equal(body.store, false);
            return openAiDraftOutput(bundleProposal(selectedImpactIds.slice(0, 3), today));
        });
        await fillCabinetField(page, 'cabinetTaskTitle', `AI bundle source ${RUN_ID}`);
        await fillCabinetField(page, 'cabinetTaskDetails', 'Розклади перевірку звітів на CRM і Hermes задачі.');
        await page.locator('[data-task-ai-draft-preview]').click();
        await page.locator('[data-task-ai-draft-review]').filter({ hasText: 'AI пропонує створити' }).waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        const bundleAcceptButtons = page.locator('[data-task-ai-bundle-accept]');
        const bundleAcceptCount = await bundleAcceptButtons.count();
        assert.ok(bundleAcceptCount >= 2, 'bundle preview renders explicit per-task accept controls');
        for (let index = 0; index < bundleAcceptCount; index += 1) {
            await bundleAcceptButtons.nth(index).click();
        }
        await page.waitForFunction(() => {
            const composer = document.getElementById('cabinetTaskComposer');
            const payload = window.TaskAiDraft?.commitPayloadFor?.(composer);
            return payload?.commitType === 'bundle' && Array.isArray(payload.tasks) && payload.tasks.length >= 2;
        }, null, { timeout: TIMEOUT_MS });
        const bundleCommitResponse = waitForApiResponse(page, 'POST', '/api/tasks/ai-draft/bundle/commit');
        await submitCabinetComposer(page);
        const bundleBody = await responseJson(await bundleCommitResponse, 'Profile AI bundle commit');
        const bundleTaskIds = (bundleBody.bundle?.taskIds || bundleBody.taskIds || []).map(Number).filter(Boolean);
        assert.ok(bundleTaskIds.length >= 2, 'AI bundle commit returns multiple task ids');
        const cabinetAfterBundle = await api(TARGET_URL, '/api/tasks/my-cabinet', { token: session.token });
        const projectedTitles = extractTodayTitles(cabinetAfterBundle);
        assert.ok(projectedTitles.includes(`Bundle CRM actual app ${RUN_ID}`), 'bundle task scheduled for today appears in My Day projection');
        assert.ok(projectedTitles.includes(`Bundle Hermes actual app ${RUN_ID}`), 'bundle task with null AI date inherits the human-confirmed Today date');
        await visibleTaskCard(page, `Bundle CRM actual app ${RUN_ID}`);
        await visibleTaskCard(page, `Bundle Hermes actual app ${RUN_ID}`);

        await openTasksPage(page);
        await page.locator('[data-due-preset="tomorrow"]').click();
        const tasksManualTomorrowTitle = `Tasks manual tomorrow ${RUN_ID}`;
        await page.locator('#taskTitle').fill(tasksManualTomorrowTitle);
        const tasksManualTomorrowResponse = waitForApiResponse(page, 'POST', '/api/tasks');
        await submitTasksComposer(page);
        const tasksManualTomorrowBody = await responseJson(await tasksManualTomorrowResponse, 'manual Tasks composer tomorrow create');
        assert.ok(Number(tasksManualTomorrowBody.task?.id || tasksManualTomorrowBody.data?.id) > 0, 'Tasks composer returns tomorrow task id');
        const cabinetAfterTomorrow = await api(TARGET_URL, '/api/tasks/my-cabinet', { token: session.token });
        assert.equal(extractTodayTitles(cabinetAfterTomorrow).includes(tasksManualTomorrowTitle), false, 'tomorrow task is not projected into Today');

        await page.locator('[data-due-preset="no_date"]').click();
        const tasksManualNoDateTitle = `Tasks manual no date ${RUN_ID}`;
        await page.locator('#taskTitle').fill(tasksManualNoDateTitle);
        const tasksManualNoDateResponse = waitForApiResponse(page, 'POST', '/api/tasks');
        await submitTasksComposer(page);
        const tasksManualNoDateBody = await responseJson(await tasksManualNoDateResponse, 'manual Tasks composer no-date create');
        assert.ok(Number(tasksManualNoDateBody.task?.id || tasksManualNoDateBody.data?.id) > 0, 'Tasks composer returns no-date task id');
        const cabinetAfterNoDate = await api(TARGET_URL, '/api/tasks/my-cabinet', { token: session.token });
        assert.equal(extractTodayTitles(cabinetAfterNoDate).includes(tasksManualNoDateTitle), true, 'no-date task remains visible in the current My Day today bucket contract');

        await page.locator('[data-due-preset="custom"]').click();
        const customDate = kyivDateOffset(5);
        await page.locator('#taskScheduleDate').fill(customDate);
        const tasksManualCustomTitle = `Tasks manual custom date ${RUN_ID}`;
        await page.locator('#taskTitle').fill(tasksManualCustomTitle);
        const tasksManualCustomResponse = waitForApiResponse(page, 'POST', '/api/tasks');
        await submitTasksComposer(page);
        const tasksManualCustomBody = await responseJson(await tasksManualCustomResponse, 'manual Tasks composer custom-date create');
        assert.ok(Number(tasksManualCustomBody.task?.id || tasksManualCustomBody.data?.id) > 0, 'Tasks composer returns custom-date task id');
        const cabinetAfterCustom = await api(TARGET_URL, '/api/tasks/my-cabinet', { token: session.token });
        assert.equal(extractTodayTitles(cabinetAfterCustom).includes(tasksManualCustomTitle), false, 'custom-date task is not projected into Today');

        const providerUnavailableSource = `Provider unavailable source ${RUN_ID}`;
        openAiMock.intercept(
            () => true,
            () => jsonResponse({ error: { message: 'mock provider unavailable' } }, 503)
        );
        openAiMock.intercept(
            () => true,
            () => jsonResponse({ error: { message: 'mock provider unavailable retry' } }, 503)
        );
        expectedApiFailures.push({ method: 'POST', pathname: '/api/tasks/ai-draft/preview', status: 503 });
        expectedConsoleFailures.push({ status: 503 });
        await page.locator('#taskTitle').fill(providerUnavailableSource);
        await page.locator('#taskDescription').fill('Provider unavailable should not block manual create.');
        const providerUnavailablePreview = waitForApiResponse(page, 'POST', '/api/tasks/ai-draft/preview');
        await page.locator('[data-task-ai-draft-preview]').click();
        assert.equal((await providerUnavailablePreview).status(), 503, 'provider unavailable preview returns controlled 503');
        await page.locator('[data-task-ai-draft-status]').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        const providerFallbackTitle = `Manual fallback after provider ${RUN_ID}`;
        await page.locator('#taskTitle').fill(providerFallbackTitle);
        const providerFallbackResponse = waitForApiResponse(page, 'POST', '/api/tasks');
        await submitTasksComposer(page);
        const providerFallbackBody = await responseJson(await providerFallbackResponse, 'manual Tasks composer after provider unavailable');
        assert.ok(Number(providerFallbackBody.task?.id || providerFallbackBody.data?.id) > 0, 'manual composer still creates after provider unavailable');

        openAiMock.enqueue(() => openAiDraftOutput({
            decision: 'needs_clarification',
            mode: null,
            title: null,
            description: null,
            impactIds: [],
            subtasks: [],
            bundleTitle: null,
            tasks: [],
            confidence: confidence(0.35),
            reason: 'Please specify what report and expected result.'
        }));
        await page.locator('#taskTitle').fill(`Clarification source ${RUN_ID}`);
        await page.locator('[data-task-ai-draft-preview]').click();
        await page.locator('[data-task-ai-draft-review] .is-clarification').waitFor({ state: 'visible', timeout: TIMEOUT_MS });

        openAiMock.enqueue(body => {
            assert.equal(body.model, 'gpt-5.6-luna');
            assert.equal(body.store, false);
            return openAiDraftOutput(checklistProposal(selectedImpactIds.slice(0, 2), today));
        });
        await page.locator('#taskTitle').fill(`Tasks AI checklist source ${RUN_ID}`);
        await page.locator('#taskDescription').fill('Prepare a checklist from the Tasks composer.');
        await page.locator('[data-task-ai-draft-preview]').click();
        await page.locator('[data-task-ai-draft-review]').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.locator('[data-task-ai-draft-accept-all]').click();
        const tasksAiCommitResponse = waitForApiResponse(page, 'POST', '/api/tasks/ai-draft/commit');
        await submitTasksComposer(page);
        const tasksAiCommitBody = await responseJson(await tasksAiCommitResponse, 'AI checklist commit from real Tasks composer');
        assert.ok(Number(tasksAiCommitBody.task?.id || tasksAiCommitBody.taskId || tasksAiCommitBody.task_id) > 0, 'Tasks AI checklist commit returns task id');

        await api(TARGET_URL, '/api/my-day/timer/start', { method: 'POST', token: session.token, body: { taskId: manualTaskId } });
        await page.goto(`${TARGET_URL}/tasks`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-global-task-timer-elapsed]').first().waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.locator('.global-task-timer__title, .global-task-timer-panel__title, .global-task-timer-chip').first().waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        const decisionSeed = await api(TARGET_URL, '/api/decisions', {
            method: 'POST',
            token: session.token,
            body: {
                title: `My Day navigation decision ${RUN_ID}`,
                description: 'Disposable browser fixture for the Decision Center navigation regression.',
                priority: 'important',
                source: 'manual'
            }
        });
        assert.ok(Number(decisionSeed.id) > 0, 'browser smoke creates one disposable pending decision');
        await page.goto(`${TARGET_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-global-task-timer-elapsed]').first().waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        const decisionOverlay = page.locator('#decisionScreen');
        await decisionOverlay.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await decisionOverlay.locator('[data-decision-screen-dismiss]').first().click();
        await decisionOverlay.waitFor({ state: 'hidden', timeout: TIMEOUT_MS });
        const productivitySection = page.locator('#sidebarProductivityQuick');
        await productivitySection.waitFor({ state: 'attached', timeout: TIMEOUT_MS });
        const productivityToggle = productivitySection.locator('[data-sidebar-productivity-toggle-section]');
        if (await productivityToggle.getAttribute('aria-expanded') === 'false') await productivityToggle.click();
        const myDaySidebarLink = productivitySection.locator('a[href="/profile?tab=myday"], a[href="/profile.html?tab=myday"]').first();
        await myDaySidebarLink.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await myDaySidebarLink.click();
        await page.waitForURL(url => url.pathname === '/profile' && url.searchParams.get('tab') === 'myday', { timeout: TIMEOUT_MS });
        await page.locator('#cabinetMyDaySegmentPanel').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.locator('[data-global-task-timer-elapsed]').first().waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await api(TARGET_URL, '/api/my-day/timer/stop', { method: 'POST', token: session.token, body: {} });
        await evaluateAfterNavigationSettles(page, () => {
            window.dispatchEvent(new CustomEvent('crm:timer-updated', { detail: { action: 'stop', emittedAt: Date.now() } }));
            window.GlobalTaskTimer?.hydrate?.({ reason: 'actual-app-smoke-stop' });
        });

        await page.setViewportSize({ width: 390, height: 780 });
        await evaluateAfterNavigationSettles(page, () => localStorage.setItem('pzp_dark_mode', 'true'));
        await openMyDayProfile(page);
        const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
        assert.ok(overflow <= 4, `mobile dark My Day should not horizontally overflow, got ${overflow}px`);

        await evaluateAfterNavigationSettles(page, () => {
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
        const unexpectedConsoleErrors = consoleErrors.filter(line => {
            const text = consoleEventText(line);
            if (/favicon|ResizeObserver/i.test(text)) return false;
            if (consumeExpectedConsoleResourceFailure(line, expectedConsoleFailures)) return false;
            if (consumeExpectedConsoleResourceFailure(line, optionalConsoleFailures)) return false;
            if (isOptionalConsoleResourceFailure(line)) return false;
            if (isAllowedOptionalConsoleFailure(text)) return false;
            return true;
        });
        if (unexpectedConsoleErrors.length || apiFailures.length || requestFailures.length || expectedApiFailures.length) {
            console.error('[my-day-actual-app-browser-smoke] failure summary', JSON.stringify({
                unexpectedConsoleErrors,
                apiFailures,
                requestFailures,
                expectedApiFailures,
                expectedConsoleFailures,
                optionalConsoleFailures
            }, null, 2));
        }
        assert.deepEqual(unexpectedConsoleErrors, [], 'browser console has no unexpected errors');
        assert.deepEqual(apiFailures, [], 'actual-app smoke has no unexpected API 4xx/5xx responses');
        assert.deepEqual(requestFailures, [], 'actual-app smoke has no unexpected critical request failures');
        assert.deepEqual(expectedApiFailures, [], 'all expected API failures were observed');
        assert.deepEqual(expectedConsoleFailures, [], 'all expected browser resource failures were observed');
    } finally {
        await browser.close();
        await openAiMock.close();
    }
}

main().catch(error => {
    console.error(`[my-day-actual-app-browser-smoke] ${error.stack || error.message}`);
    process.exitCode = 1;
});
