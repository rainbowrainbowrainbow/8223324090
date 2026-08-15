#!/usr/bin/env node
'use strict';

/**
 * Controlled live My Day completion pulse mutation smoke.
 *
 * Safety contract:
 * - Requires --confirm-live-write before any task mutation.
 * - Requires an exact expected test account id or username/email.
 * - Allows only explicitly allowlisted business contexts.
 * - Creates one clearly marked QA task, completes it, and verifies completedTodayTasks.
 * - Archives only that exact QA task after verification unless --keep-task is passed.
 * - Optional --browser verifies the completed row in the My Day completion pulse.
 * - Writes only redacted artifacts: IDs, counts, version metadata and timings.
 * - Never prints credentials, task description text, tokens or full user records.
 *
 * Usage:
 *   node scripts/live-my-day-completion-mutation-smoke.js https://crm.example \
 *     --confirm-live-write \
 *     --test-user eventgenix.codex.qa@example.com \
 *     --business-context event_genix
 *
 * Optional browser UI verification:
 *   npx --yes --package playwright node scripts/live-my-day-completion-mutation-smoke.js https://crm.example \
 *     --confirm-live-write --browser --test-user eventgenix.codex.qa@example.com
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ALLOWED_BUSINESS_CONTEXTS = Object.freeze(['event_genix']);
const DEFAULT_TIMEOUT_MS = 45_000;
const SMOKE_SURFACE = 'live_my_day_completion_mutation_smoke';
const REDACTED_OUTPUT_ROOT = path.join(ROOT, 'output', 'live-my-day-completion-mutation-smoke');

function readEnv(env, ...names) {
    for (const name of names) {
        const value = env?.[name];
        if (String(value || '').trim()) return String(value).trim();
    }
    return '';
}

function parseKeyValueArg(argv, name) {
    const direct = argv.find(arg => arg.startsWith(`${name}=`));
    if (direct) return direct.slice(name.length + 1).trim();
    const index = argv.indexOf(name);
    if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1].trim();
    return '';
}

function parseCsv(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function uniqueMarker(now = new Date(), random = crypto.randomBytes(4).toString('hex')) {
    return `EGX_MY_DAY_COMPLETION_QA_${now.toISOString().replace(/[:.]/g, '-')}_${random}`;
}

function sanitizeFileToken(value) {
    return String(value || 'artifact').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
    const httpUrl = argv.find(arg => /^https?:\/\//i.test(arg));
    const allowedBusinessContexts = parseCsv(
        parseKeyValueArg(argv, '--allowed-business-contexts')
        || readEnv(env, 'LIVE_MY_DAY_COMPLETION_ALLOWED_BUSINESS_CONTEXTS')
    );
    return {
        baseUrl: parseKeyValueArg(argv, '--url')
            || httpUrl
            || readEnv(env, 'LIVE_MY_DAY_COMPLETION_MUTATION_URL', 'LIVE_MY_DAY_URL', 'LIVE_SMOKE_URL', 'TEST_URL'),
        businessContext: parseKeyValueArg(argv, '--business-context')
            || readEnv(env, 'LIVE_MY_DAY_COMPLETION_BUSINESS_CONTEXT', 'LIVE_MY_DAY_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT')
            || 'event_genix',
        allowedBusinessContexts: allowedBusinessContexts.length ? allowedBusinessContexts : [...DEFAULT_ALLOWED_BUSINESS_CONTEXTS],
        confirmLiveWrite: argv.includes('--confirm-live-write'),
        browser: argv.includes('--browser'),
        keepTask: argv.includes('--keep-task'),
        marker: parseKeyValueArg(argv, '--marker') || readEnv(env, 'LIVE_MY_DAY_COMPLETION_QA_MARKER') || uniqueMarker(),
        testUserId: Number.parseInt(parseKeyValueArg(argv, '--test-user-id') || readEnv(env, 'LIVE_MY_DAY_COMPLETION_TEST_USER_ID'), 10) || 0,
        testUser: parseKeyValueArg(argv, '--test-user') || readEnv(env, 'LIVE_MY_DAY_COMPLETION_TEST_USER'),
        timeoutMs: Number.parseInt(parseKeyValueArg(argv, '--timeout-ms') || readEnv(env, 'LIVE_MY_DAY_COMPLETION_TIMEOUT_MS') || String(DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS,
        outputDir: parseKeyValueArg(argv, '--output-dir') || readEnv(env, 'LIVE_MY_DAY_COMPLETION_OUTPUT_DIR') || REDACTED_OUTPUT_ROOT,
        ci: env.CI === 'true',
        nodeEnv: String(env.NODE_ENV || '')
    };
}

function normalizeBaseUrl(value) {
    const url = new URL(String(value || '').trim());
    if (!/^https?:$/i.test(url.protocol)) throw new Error('Target URL must be http(s).');
    return url.origin;
}

function validateOptions(options = {}) {
    if (!options.confirmLiveWrite) throw new Error('Refusing live completion mutation smoke without --confirm-live-write.');
    if (options.ci || options.nodeEnv.toLowerCase() === 'test') {
        throw new Error('Live completion mutation smoke is forbidden in CI/test runtime.');
    }
    if (!String(options.baseUrl || '').trim()) throw new Error('Target URL is required.');
    normalizeBaseUrl(options.baseUrl);
    if (!String(options.marker || '').startsWith('EGX_MY_DAY_COMPLETION_QA_')) {
        throw new Error('QA marker must start with EGX_MY_DAY_COMPLETION_QA_.');
    }
    if (!options.testUserId && !String(options.testUser || '').trim()) {
        throw new Error('Expected test account is required: set --test-user-id or --test-user.');
    }
    if (!options.allowedBusinessContexts.includes(options.businessContext)) {
        throw new Error(`Business context "${options.businessContext}" is not in the allowed live-write list.`);
    }
    return true;
}

function userIdentityValues(user = {}) {
    return [
        user.id,
        user.username,
        user.email,
        user.name,
        user.displayName,
        user.display_name
    ].filter(value => value !== undefined && value !== null && String(value).trim()).map(value => String(value).trim());
}

function assertKnownTestAccount(user = {}, options = {}) {
    const values = userIdentityValues(user);
    if (options.testUserId && Number(user.id || 0) !== Number(options.testUserId)) {
        throw new Error('Authenticated account does not match expected test user id.');
    }
    if (options.testUser) {
        const expected = String(options.testUser).trim().toLowerCase();
        const matches = values.some(value => value.toLowerCase() === expected);
        if (!matches) throw new Error('Authenticated account does not match expected test username/email.');
    }
    if (!options.testUserId && !options.testUser) {
        throw new Error('Expected test account guard is missing.');
    }
    return true;
}

async function readBody(response) {
    const text = await response.text();
    try { return text ? JSON.parse(text) : null; } catch { return text; }
}

function routeWithBusinessContext(routePath, businessContext) {
    const url = new URL(routePath, 'https://eventgenix.invalid');
    if (businessContext && !url.searchParams.has('businessContext')) {
        url.searchParams.set('businessContext', businessContext);
    }
    return `${url.pathname}${url.search}`;
}

async function fetchJson(base, routePath, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
        const hasBody = Object.prototype.hasOwnProperty.call(options, 'body');
        const response = await fetch(`${base}${routePath}`, {
            method: options.method || 'GET',
            headers: {
                Accept: 'application/json',
                ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
                ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
                ...(options.businessContext ? { 'X-Business-Context': options.businessContext } : {}),
                ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {})
            },
            body: hasBody ? JSON.stringify(options.body) : undefined,
            signal: controller.signal
        });
        const body = await readBody(response);
        if (!response.ok) {
            const error = new Error(`${routePath} returned ${response.status}`);
            error.status = response.status;
            error.body = body;
            throw error;
        }
        return body;
    } finally {
        clearTimeout(timer);
    }
}

function extractToken(body = {}) {
    return body.accessToken
        || body.access_token
        || body.token
        || body.jwt
        || body.data?.accessToken
        || body.data?.access_token
        || body.data?.token
        || '';
}

async function login(base, options = {}, env = process.env) {
    const token = readEnv(env, 'LIVE_MY_DAY_COMPLETION_MUTATION_TOKEN', 'LIVE_MY_DAY_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN');
    if (token) {
        const verified = await fetchJson(base, '/api/auth/verify', { token, timeoutMs: options.timeoutMs });
        const user = verified.user || verified.data?.user || verified;
        assertKnownTestAccount(user, options);
        return { token, user, source: 'token' };
    }

    const username = readEnv(env, 'LIVE_MY_DAY_COMPLETION_MUTATION_USER', 'LIVE_MY_DAY_USER', 'LIVE_SMOKE_USER', 'TEST_USER');
    const password = readEnv(env, 'LIVE_MY_DAY_COMPLETION_MUTATION_PASS', 'LIVE_MY_DAY_COMPLETION_MUTATION_PASSWORD', 'LIVE_MY_DAY_PASS', 'LIVE_SMOKE_PASS', 'TEST_PASS');
    if (!username || !password) {
        throw new Error('Provide token or username/password through LIVE_MY_DAY_COMPLETION_MUTATION_* or LIVE_SMOKE_* env vars.');
    }
    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        timeoutMs: options.timeoutMs,
        body: { username, password }
    });
    const accessToken = extractToken(body);
    if (!accessToken) throw new Error('/api/auth/login did not return an access token.');
    const user = body.user || body.data?.user || null;
    assertKnownTestAccount(user, options);
    return {
        token: accessToken,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user,
        source: 'login'
    };
}

async function hydrateSessionPermissions(base, session, options = {}) {
    const payload = await fetchJson(base, '/api/auth/permissions', {
        token: session.token,
        timeoutMs: options.timeoutMs
    });
    return {
        ...session,
        user: {
            ...(session.user || {}),
            permissions: payload?.permissions && !payload?.capabilities ? payload.permissions : payload
        }
    };
}

function kyivDateKey(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function taskIdOf(task = {}) {
    return Number(task.id || task.taskId || task.task_id || 0);
}

function assertCompletedTodayProjection(projection = {}, taskId) {
    const tasks = Array.isArray(projection.completedTodayTasks) ? projection.completedTodayTasks : [];
    const found = tasks.find(task => taskIdOf(task) === Number(taskId));
    if (!found) throw new Error('completedTodayTasks does not include the QA task.');
    const quick = projection.stats?.taskQuick || {};
    const completedUnitsToday = Number(quick.completedUnitsToday ?? quick.completedToday ?? 0);
    if (!(completedUnitsToday >= 1)) throw new Error('completed units today did not update.');
    return {
        found,
        completedUnitsToday,
        completedParentToday: Number(quick.completedParentToday ?? 0),
        completedSubtasksToday: Number(quick.completedSubtasksToday ?? 0)
    };
}

function assertTaskContainsMarker(task = {}, marker = '') {
    const markerText = String(marker || '');
    if (!markerText.startsWith('EGX_MY_DAY_COMPLETION_QA_')) throw new Error('Cleanup marker is required.');
    const searchable = [
        task.title,
        task.description,
        task.task?.title,
        task.task?.description
    ].filter(Boolean).join('\n');
    if (!searchable.includes(markerText)) {
        throw new Error('Exact QA marker was not found on task; refusing to archive.');
    }
    return true;
}

async function createAndCompleteQaTask(base, session, options = {}) {
    const today = kyivDateKey();
    const title = `Codex QA completion pulse ${options.marker}`;
    const created = await fetchJson(base, routeWithBusinessContext('/api/tasks', options.businessContext), {
        method: 'POST',
        token: session.token,
        timeoutMs: options.timeoutMs,
        businessContext: options.businessContext,
        idempotencyKey: `${options.marker}:create`,
        body: {
            title,
            description: `Safe live QA task for completion pulse smoke. Marker: ${options.marker}`,
            date: today,
            priority: 'normal',
            task_mode: 'personal',
            taskMode: 'personal',
            task_kind: 'action',
            taskKind: 'action',
            category: 'admin',
            sourceSurface: SMOKE_SURFACE,
            businessContext: options.businessContext
        }
    });
    const taskId = taskIdOf(created.task || created);
    if (!taskId) throw new Error('/api/tasks did not return a task id.');

    await fetchJson(base, routeWithBusinessContext(`/api/tasks/${taskId}/status`, options.businessContext), {
        method: 'PATCH',
        token: session.token,
        timeoutMs: options.timeoutMs,
        businessContext: options.businessContext,
        idempotencyKey: `${options.marker}:complete:${taskId}`,
        body: {
            status: 'done',
            sourceSurface: SMOKE_SURFACE,
            businessContext: options.businessContext
        }
    });

    const projection = await fetchJson(base, routeWithBusinessContext('/api/tasks/my-cabinet', options.businessContext), {
        token: session.token,
        timeoutMs: options.timeoutMs,
        businessContext: options.businessContext
    });
    return {
        taskId,
        today,
        projection,
        assertion: assertCompletedTodayProjection(projection, taskId)
    };
}

async function archiveExactQaTask(base, session, options = {}, taskId) {
    const id = Number(taskId || 0);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Cleanup requires an exact task id.');
    const task = await fetchJson(base, routeWithBusinessContext(`/api/tasks/${encodeURIComponent(id)}`, options.businessContext), {
        token: session.token,
        timeoutMs: options.timeoutMs,
        businessContext: options.businessContext
    });
    assertTaskContainsMarker(task.task || task, options.marker);
    await fetchJson(base, routeWithBusinessContext('/api/tasks/bulk', options.businessContext), {
        method: 'POST',
        token: session.token,
        timeoutMs: options.timeoutMs,
        businessContext: options.businessContext,
        idempotencyKey: `${options.marker}:archive:${id}`,
        body: {
            ids: [id],
            action: 'archive',
            sourceSurface: SMOKE_SURFACE,
            archiveReason: 'live_my_day_completion_mutation_smoke_cleanup',
            businessContext: options.businessContext
        }
    });
    return { id, status: 'archived' };
}

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (err) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

async function verifyBrowserCompletionPulse(base, session, options = {}, taskId) {
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await context.addInitScript(({ token, user, businessContext }) => {
            localStorage.setItem('pzp_token', token);
            localStorage.setItem('pzp_access_token', token);
            localStorage.setItem('pzp_current_user', JSON.stringify(user || {}));
            localStorage.setItem('pzp_crm_business_context', businessContext);
            localStorage.setItem('pzp_dark_mode', 'true');
        }, {
            token: session.token,
            user: session.user || {},
            businessContext: options.businessContext
        });
        const page = await context.newPage();
        page.setDefaultTimeout(options.timeoutMs || DEFAULT_TIMEOUT_MS);
        await page.route('https://www.clarity.ms/**', route => route.abort());
        await page.route('https://fonts.googleapis.com/**', route => route.abort());
        await page.route('https://fonts.gstatic.com/**', route => route.abort());
        await page.goto(`${base}/profile?tab=myday&businessContext=${encodeURIComponent(options.businessContext)}&qa=${encodeURIComponent(options.marker)}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-cabinet-completion-pulse]', { state: 'visible' });
        assert.equal(await page.locator('[data-cabinet-completion-pulse]').count(), 1, 'browser: expected one completion pulse.');
        assert.equal(await page.locator('.cabinet-completed-strip, [data-cabinet-completed-today-dashboard], [data-cabinet-completed-today-toggle]').count(), 0, 'browser: legacy completion surfaces are absent.');
        const toggle = page.locator('[data-cabinet-completion-toggle]');
        await toggle.click();
        await page.waitForSelector('#cabinetCompletionDetails', { state: 'visible' });
        await page.locator('[data-cabinet-completion-tab="today"]').click();
        const row = page.locator(`#cabinetCompletionDetails [data-task-id="${taskId}"]`);
        await row.waitFor({ state: 'visible' });
        const metrics = await page.locator('[data-cabinet-completion-pulse]').evaluate(node => ({
            overflow: node.scrollWidth - node.clientWidth,
            rawText: (node.innerText || '').replace(/\s+/g, ' ')
        }));
        assert.ok(metrics.overflow <= 1, `browser: completion pulse overflows horizontally: ${metrics.overflow}`);
        assert.doesNotMatch(metrics.rawText, /\b(system|processes|learning|network)\b/i, 'browser: raw impact keys visible.');
        await context.close();
        return { ok: true, viewport: '1440x900', theme: 'dark' };
    } finally {
        await browser.close();
    }
}

function redactedArtifact(result = {}, options = {}) {
    const version = result.version || {};
    return {
        status: result.status || 'unknown',
        marker: options.marker || result.marker || '',
        target: {
            baseUrl: normalizeBaseUrl(options.baseUrl || result.baseUrl || 'https://eventgenix.invalid'),
            businessContext: options.businessContext || result.businessContext || ''
        },
        release: {
            version: version.version || null,
            releaseLabel: version.releaseLabel || null,
            commitSha: version.commitSha || null,
            sourceBranch: version.sourceBranch || null
        },
        task: {
            id: Number(result.taskId || 0) || null,
            completedToday: result.completedToday === true
        },
        cleanup: Array.isArray(result.cleanup) ? result.cleanup.map(item => ({
            id: Number(item.id || 0) || null,
            status: String(item.status || 'unknown')
        })) : [],
        stats: {
            completedUnitsToday: Number(result.completedUnitsToday || 0),
            completedParentToday: Number(result.completedParentToday || 0),
            completedSubtasksToday: Number(result.completedSubtasksToday || 0)
        },
        browser: result.browser || null,
        timings: result.timings || {},
        redaction: {
            taskTextStored: false,
            credentialsStored: false,
            tokensStored: false
        }
    };
}

function writeArtifact(artifact, outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    const filename = `${sanitizeFileToken(artifact.marker)}.json`;
    const fullPath = path.join(outputDir, filename);
    fs.writeFileSync(fullPath, `${JSON.stringify(artifact, null, 2)}\n`);
    return fullPath;
}

async function run(argv = process.argv.slice(2), env = process.env) {
    const options = parseArgs(argv, env);
    validateOptions(options);
    const base = normalizeBaseUrl(options.baseUrl);
    const startedAt = Date.now();
    let version = null;
    let session = null;
    let taskId = 0;
    let cleanup = [];
    let browser = null;
    let assertion = null;
    try {
        version = await fetchJson(base, '/api/version', { timeoutMs: options.timeoutMs });
        session = await hydrateSessionPermissions(base, await login(base, options, env), options);
        const mutation = await createAndCompleteQaTask(base, session, options);
        taskId = mutation.taskId;
        assertion = mutation.assertion;
        browser = options.browser
            ? await verifyBrowserCompletionPulse(base, session, options, taskId)
            : null;
        cleanup = options.keepTask
            ? [{ id: taskId, status: 'kept' }]
            : [await archiveExactQaTask(base, session, options, taskId)];
        const artifact = redactedArtifact({
            status: 'passed',
            version,
            marker: options.marker,
            baseUrl: base,
            businessContext: options.businessContext,
            taskId,
            completedToday: true,
            cleanup,
            completedUnitsToday: assertion.completedUnitsToday,
            completedParentToday: assertion.completedParentToday,
            completedSubtasksToday: assertion.completedSubtasksToday,
            browser,
            timings: { durationMs: Date.now() - startedAt }
        }, options);
        const artifactPath = writeArtifact(artifact, options.outputDir);
        return { artifact, artifactPath };
    } catch (error) {
        if (session && taskId && !options.keepTask && !cleanup.length) {
            try {
                cleanup = [await archiveExactQaTask(base, session, options, taskId)];
            } catch {
                cleanup = [{ id: taskId, status: 'failed' }];
            }
        }
        const artifact = redactedArtifact({
            status: 'failed',
            version,
            marker: options.marker,
            baseUrl: base,
            businessContext: options.businessContext,
            taskId,
            completedToday: false,
            cleanup,
            completedUnitsToday: assertion?.completedUnitsToday || 0,
            completedParentToday: assertion?.completedParentToday || 0,
            completedSubtasksToday: assertion?.completedSubtasksToday || 0,
            browser,
            timings: { durationMs: Date.now() - startedAt }
        }, options);
        error.artifactPath = writeArtifact(artifact, options.outputDir);
        throw error;
    }
}

if (require.main === module) {
    run().then(({ artifact, artifactPath }) => {
        console.log(`Live My Day completion mutation smoke OK: ${artifact.target.baseUrl}`);
        console.log(`  OK version: v${artifact.release.version || 'unknown'} @ ${String(artifact.release.commitSha || '').slice(0, 12)}`);
        console.log(`  OK taskId: ${artifact.task.id}`);
        console.log(`  OK completedUnitsToday: ${artifact.stats.completedUnitsToday}`);
        if (artifact.browser) console.log(`  OK browser: ${artifact.browser.viewport} ${artifact.browser.theme}`);
        console.log(`  OK artifact: ${path.relative(ROOT, artifactPath)}`);
    }).catch(error => {
        console.error(`Live My Day completion mutation smoke failed: ${error.message}`);
        if (error.artifactPath) console.error(`Redacted artifact: ${path.relative(ROOT, error.artifactPath)}`);
        process.exit(1);
    });
}

module.exports = {
    parseArgs,
    validateOptions,
    normalizeBaseUrl,
    assertKnownTestAccount,
    assertCompletedTodayProjection,
    kyivDateKey,
    routeWithBusinessContext,
    redactedArtifact,
    createAndCompleteQaTask,
    archiveExactQaTask,
    assertTaskContainsMarker,
    run
};
