#!/usr/bin/env node
'use strict';

/**
 * Controlled live My Day AI mutation smoke.
 *
 * Safety contract:
 * - Requires --confirm-live-write for any production write or cleanup.
 * - Requires an exact expected test account id or username/email.
 * - Requires a known business context allowlist.
 * - Tracks exact task IDs created by this run and archives only those exact IDs.
 * - Writes a redacted artifact with IDs/status/counts/timings/version only.
 * - Never prints secrets, prompts, descriptions, titles, proposal tokens, or provider responses.
 *
 * Usage:
 *   node scripts/live-my-day-ai-mutation-smoke.js https://crm.example \
 *     --confirm-live-write \
 *     --test-user eventgenix.codex.qa@example.com \
 *     --business-context event_genix
 *
 * Cleanup-only after an interrupted run:
 *   node scripts/live-my-day-ai-mutation-smoke.js https://crm.example \
 *     --confirm-live-write --cleanup-only --marker EGX_MY_DAY_AI_QA_... --ids 123,124
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SECRETS_FILE = 'C:\\Users\\Plotva\\.eventgenix\\codex-crm-secrets.ps1';
const DEFAULT_ALLOWED_BUSINESS_CONTEXTS = Object.freeze(['event_genix']);
const DEFAULT_TIMEOUT_MS = 45_000;
const SMOKE_SURFACE = 'live_my_day_ai_mutation_smoke';
const REDACTED_OUTPUT_ROOT = path.join(ROOT, 'output', 'live-my-day-ai-mutation-smoke');
const BUNDLE_ACCEPTED_FIELDS = Object.freeze(['title', 'description', 'impactIds', 'subtasks', 'owner', 'dueDate', 'priority']);

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

function parseIds(value) {
    return [...new Set(parseCsv(value)
        .map(item => Number.parseInt(item, 10))
        .filter(id => Number.isInteger(id) && id > 0))];
}

function uniqueMarker(now = new Date(), random = crypto.randomBytes(4).toString('hex')) {
    return `EGX_MY_DAY_AI_QA_${now.toISOString().replace(/[:.]/g, '-')}_${random}`;
}

function sanitizeFileToken(value) {
    return String(value || 'artifact').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
}

function parsePowerShellEnvAssignments(text) {
    const result = {};
    const lines = String(text || '').split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^\s*\$env:([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(['"])([\s\S]*?)\2\s*;?\s*$/);
        if (!match) continue;
        result[match[1]] = match[3];
    }
    return result;
}

function hydrateEnvFromSecretsFile(env = process.env, filePath = DEFAULT_SECRETS_FILE) {
    const target = String(filePath || '').trim();
    if (!target || !fs.existsSync(target)) return [];
    const assignments = parsePowerShellEnvAssignments(fs.readFileSync(target, 'utf8'));
    const allowed = [
        'LIVE_MY_DAY_AI_MUTATION_URL',
        'LIVE_MY_DAY_AI_MUTATION_TOKEN',
        'LIVE_MY_DAY_AI_MUTATION_USER',
        'LIVE_MY_DAY_AI_MUTATION_PASS',
        'LIVE_MY_DAY_AI_TEST_USER',
        'LIVE_MY_DAY_AI_TEST_USER_ID',
        'LIVE_MY_DAY_URL',
        'LIVE_MY_DAY_USER',
        'LIVE_MY_DAY_PASS',
        'LIVE_SMOKE_URL',
        'LIVE_SMOKE_TOKEN',
        'LIVE_SMOKE_USER',
        'LIVE_SMOKE_PASS',
        'TEST_URL',
        'TEST_USER',
        'TEST_PASS'
    ];
    const loaded = [];
    for (const key of allowed) {
        if (env[key] || assignments[key] === undefined) continue;
        env[key] = assignments[key];
        loaded.push(key);
    }
    return loaded;
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
    const httpUrl = argv.find(arg => /^https?:\/\//i.test(arg));
    const marker = parseKeyValueArg(argv, '--marker') || readEnv(env, 'LIVE_MY_DAY_AI_QA_MARKER') || uniqueMarker();
    const allowedBusinessContexts = parseCsv(
        parseKeyValueArg(argv, '--allowed-business-contexts')
        || readEnv(env, 'LIVE_MY_DAY_AI_ALLOWED_BUSINESS_CONTEXTS')
    );
    return {
        baseUrl: parseKeyValueArg(argv, '--url')
            || httpUrl
            || readEnv(env, 'LIVE_MY_DAY_AI_MUTATION_URL', 'LIVE_MY_DAY_URL', 'LIVE_SMOKE_URL', 'TEST_URL'),
        businessContext: parseKeyValueArg(argv, '--business-context')
            || readEnv(env, 'LIVE_MY_DAY_AI_BUSINESS_CONTEXT', 'LIVE_MY_DAY_BUSINESS_CONTEXT', 'LIVE_SMOKE_BUSINESS_CONTEXT')
            || 'event_genix',
        allowedBusinessContexts: allowedBusinessContexts.length ? allowedBusinessContexts : [...DEFAULT_ALLOWED_BUSINESS_CONTEXTS],
        confirmLiveWrite: argv.includes('--confirm-live-write'),
        cleanupOnly: argv.includes('--cleanup-only'),
        ids: parseIds(parseKeyValueArg(argv, '--ids') || readEnv(env, 'LIVE_MY_DAY_AI_CLEANUP_IDS')),
        marker,
        testUserId: Number.parseInt(parseKeyValueArg(argv, '--test-user-id') || readEnv(env, 'LIVE_MY_DAY_AI_TEST_USER_ID'), 10) || 0,
        testUser: parseKeyValueArg(argv, '--test-user') || readEnv(env, 'LIVE_MY_DAY_AI_TEST_USER'),
        timeoutMs: Number.parseInt(parseKeyValueArg(argv, '--timeout-ms') || readEnv(env, 'LIVE_MY_DAY_AI_TIMEOUT_MS') || String(DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS,
        outputDir: parseKeyValueArg(argv, '--output-dir') || readEnv(env, 'LIVE_MY_DAY_AI_OUTPUT_DIR') || REDACTED_OUTPUT_ROOT,
        secretsFile: parseKeyValueArg(argv, '--secrets-file') || readEnv(env, 'EVENTGENIX_SECRETS_FILE') || DEFAULT_SECRETS_FILE,
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
    if (!options.confirmLiveWrite) throw new Error('Refusing live mutation smoke without --confirm-live-write.');
    if (options.ci || options.nodeEnv.toLowerCase() === 'test') {
        throw new Error('Live mutation smoke is forbidden in CI/test runtime.');
    }
    if (!String(options.baseUrl || '').trim()) throw new Error('Target URL is required.');
    normalizeBaseUrl(options.baseUrl);
    if (!String(options.marker || '').startsWith('EGX_MY_DAY_AI_QA_')) {
        throw new Error('QA marker must start with EGX_MY_DAY_AI_QA_.');
    }
    if (!options.testUserId && !String(options.testUser || '').trim()) {
        throw new Error('Expected test account is required: set --test-user-id or --test-user.');
    }
    if (!options.allowedBusinessContexts.includes(options.businessContext)) {
        throw new Error(`Business context "${options.businessContext}" is not in the allowed live-write list.`);
    }
    if (options.cleanupOnly && !options.ids.length) {
        throw new Error('Cleanup-only mode requires exact --ids.');
    }
    return true;
}

async function readBody(response) {
    const text = await response.text();
    try { return text ? JSON.parse(text) : null; } catch { return text; }
}

function withBusinessContext(routePath, businessContext) {
    const url = new URL(routePath, 'https://eventgenix.invalid');
    if (businessContext) url.searchParams.set('businessContext', businessContext);
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

async function login(base, options = {}, env = process.env) {
    const token = readEnv(env, 'LIVE_MY_DAY_AI_MUTATION_TOKEN', 'LIVE_MY_DAY_TOKEN', 'LIVE_SMOKE_TOKEN', 'LIVE_SMOKE_BEARER_TOKEN');
    if (token) {
        const verified = await fetchJson(base, '/api/auth/verify', { token, timeoutMs: options.timeoutMs });
        const user = verified.user || verified.data?.user || verified;
        assertKnownTestAccount(user, options);
        return { token, user, source: 'token' };
    }

    const username = readEnv(env, 'LIVE_MY_DAY_AI_MUTATION_USER', 'LIVE_MY_DAY_USER', 'LIVE_SMOKE_USER', 'LIVE_SMOKE_USERNAME', 'TEST_USER');
    const password = readEnv(env, 'LIVE_MY_DAY_AI_MUTATION_PASS', 'LIVE_MY_DAY_AI_MUTATION_PASSWORD', 'LIVE_MY_DAY_PASS', 'LIVE_MY_DAY_PASSWORD', 'LIVE_SMOKE_PASS', 'LIVE_SMOKE_PASSWORD', 'TEST_PASS', 'TEST_PASSWORD');
    if (!username || !password) throw new Error('Provide live QA token or username/password through env/secrets file.');
    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password },
        timeoutMs: options.timeoutMs
    });
    const accessToken = extractToken(body);
    if (!accessToken) throw new Error('/api/auth/login did not return an access token.');
    const user = body.user || body.data?.user || null;
    assertKnownTestAccount(user || { username }, options);
    return {
        token: accessToken,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user,
        source: 'login'
    };
}

function kyivDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function apiContext(base, session, options, state) {
    return {
        base,
        token: session.token,
        businessContext: options.businessContext,
        timeoutMs: options.timeoutMs,
        state
    };
}

async function apiRequest(ctx, routePath, options = {}) {
    const scopedPath = options.scope === false
        ? routePath
        : withBusinessContext(routePath, ctx.businessContext);
    return fetchJson(ctx.base, scopedPath, {
        ...options,
        token: ctx.token,
        businessContext: ctx.businessContext,
        timeoutMs: ctx.timeoutMs
    });
}

function ensureSuccess(body, label) {
    if (!body?.success) throw new Error(`${label} did not return success.`);
    return body;
}

function requireProposal(preview, label, decisions = []) {
    ensureSuccess(preview, label);
    if (!preview.proposalToken || !preview.proposalHash || !preview.draftFingerprint || !preview.proposal) {
        throw new Error(`${label} did not return signed proposal data.`);
    }
    if (decisions.length && !decisions.includes(preview.proposal.decision)) {
        throw new Error(`${label} returned unexpected decision.`);
    }
    return preview.proposal;
}

function safeImpactIds(proposal = {}) {
    return Array.isArray(proposal.impactIds) ? proposal.impactIds.map(Number).filter(Number.isInteger).slice(0, 3) : [];
}

function taskIdsFromCommit(body = {}) {
    const ids = [];
    if (body.task?.id) ids.push(Number(body.task.id));
    for (const task of Array.isArray(body.tasks) ? body.tasks : []) {
        if (task?.id) ids.push(Number(task.id));
    }
    for (const id of Array.isArray(body.bundle?.taskIds) ? body.bundle.taskIds : []) {
        ids.push(Number(id));
    }
    return [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))];
}

function rememberTaskIds(state, ids = [], kind = 'task') {
    for (const id of ids) {
        state.createdTaskIds.add(Number(id));
        state.records.push({ type: 'task', id: Number(id), kind, status: 'created' });
    }
}

function redactedError(error) {
    return {
        message: String(error?.message || error || '').replace(/EGX_MY_DAY_AI_QA_[A-Za-z0-9_.-]+/g, 'EGX_MY_DAY_AI_QA_REDACTED'),
        status: error?.status || null,
        code: error?.body?.code || null
    };
}

function recordStep(state, name, startedAt, extra = {}) {
    state.steps.push({
        name,
        status: extra.status || 'ok',
        durationMs: Date.now() - startedAt,
        ...extra
    });
}

async function previewDraft(ctx, draft, state, label) {
    const startedAt = Date.now();
    const body = await apiRequest(ctx, '/api/tasks/ai-draft/preview', {
        method: 'POST',
        body: {
            currentDraft: draft,
            sourceSurface: SMOKE_SURFACE
        }
    });
    recordStep(state, `${label}:preview`, startedAt, {
        decision: body?.proposal?.decision || null,
        impactCount: Array.isArray(body?.proposal?.impactIds) ? body.proposal.impactIds.length : 0,
        taskCount: Array.isArray(body?.proposal?.tasks) ? body.proposal.tasks.length : 0
    });
    return body;
}

async function commitSingle(ctx, preview, finalDraft, acceptedFieldMask, idempotencyKey, state, label, options = {}) {
    const body = {
        proposalToken: preview.proposalToken,
        proposalHash: preview.proposalHash,
        draftFingerprint: preview.draftFingerprint,
        proposal: preview.proposal,
        acceptedFieldMask,
        finalDraft,
        idempotencyKey,
        sourceSurface: SMOKE_SURFACE
    };
    const startedAt = Date.now();
    const first = await apiRequest(ctx, '/api/tasks/ai-draft/commit', {
        method: 'POST',
        idempotencyKey,
        body
    });
    ensureSuccess(first, `${label} commit`);
    const firstIds = taskIdsFromCommit(first);
    rememberTaskIds(state, firstIds, label);
    recordStep(state, `${label}:commit`, startedAt, {
        replayed: first.replayed === true,
        taskCount: firstIds.length,
        subtaskCount: Array.isArray(first.subtasks) ? first.subtasks.length : 0,
        impactCount: Array.isArray(first.classification?.impacts) ? first.classification.impacts.length : safeImpactIds(preview.proposal).length
    });
    if (options.replay) {
        const replayStarted = Date.now();
        const replay = await apiRequest(ctx, '/api/tasks/ai-draft/commit', {
            method: 'POST',
            idempotencyKey,
            body
        });
        ensureSuccess(replay, `${label} idempotent replay`);
        const replayIds = taskIdsFromCommit(replay);
        if (replayIds[0] !== firstIds[0] || replay.replayed !== true) {
            throw new Error(`${label} idempotent replay did not return the original task.`);
        }
        recordStep(state, `${label}:idempotent-replay`, replayStarted, {
            replayed: true,
            taskCount: replayIds.length
        });
    }
    return first;
}

async function commitBundle(ctx, preview, finalTasks, acceptedTaskMask, rejectedTaskMask, idempotencyKey, state) {
    const acceptedFieldMasks = acceptedTaskMask.map(index => ({
        proposalIndex: index,
        fields: [...BUNDLE_ACCEPTED_FIELDS]
    }));
    const body = {
        proposalToken: preview.proposalToken,
        proposalHash: preview.proposalHash,
        draftFingerprint: preview.draftFingerprint,
        proposal: preview.proposal,
        bundleTitle: preview.proposal.bundleTitle,
        tasks: finalTasks,
        acceptedTaskMask,
        rejectedTaskMask,
        acceptedFieldMasks,
        editedFieldMasks: finalTasks
            .map((task, index) => ({ proposalIndex: acceptedTaskMask[index], fields: task?.userEdited ? ['title'] : [] }))
            .filter(entry => entry.fields.length),
        idempotencyKey,
        sourceSurface: SMOKE_SURFACE
    };
    const startedAt = Date.now();
    const [first, second] = await Promise.all([
        apiRequest(ctx, '/api/tasks/ai-draft/bundle/commit', { method: 'POST', idempotencyKey, body }),
        apiRequest(ctx, '/api/tasks/ai-draft/bundle/commit', { method: 'POST', idempotencyKey, body })
    ]);
    ensureSuccess(first, 'bundle commit first');
    ensureSuccess(second, 'bundle commit replay');
    const winner = first.replayed ? second : first;
    const replay = first.replayed ? first : second;
    if (replay.replayed !== true) throw new Error('Bundle rapid double click did not return an idempotent replay.');
    const ids = taskIdsFromCommit(winner);
    if (ids.length !== finalTasks.length) throw new Error('Bundle commit did not return the expected task count.');
    rememberTaskIds(state, ids, 'bundle');
    if (winner.bundle?.id) {
        state.bundleIds.push(String(winner.bundle.id));
        state.records.push({ type: 'bundle', id: String(winner.bundle.id), kind: 'bundle', status: 'created' });
    }
    recordStep(state, 'bundle:rapid-idempotent-commit', startedAt, {
        replayed: true,
        taskCount: ids.length,
        rejectedTaskCount: rejectedTaskMask.length,
        bundleIdPresent: Boolean(winner.bundle?.id)
    });
    return winner;
}

function containsTaskId(value, taskId) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.some(item => containsTaskId(item, taskId));
    if (typeof value === 'object') {
        if (Number(value.id) === Number(taskId) || Number(value.taskId || value.task_id) === Number(taskId)) return true;
        return Object.values(value).some(item => containsTaskId(item, taskId));
    }
    return false;
}

async function assertTaskInMyDay(ctx, taskId, focusDate, state) {
    const startedAt = Date.now();
    const projection = await apiRequest(ctx, `/api/tasks/my-cabinet?focusDate=${encodeURIComponent(focusDate)}`, { method: 'GET' });
    if (!containsTaskId(projection, taskId)) {
        throw new Error('Scheduled task is not visible in My Day projection.');
    }
    recordStep(state, 'schedule:my-day-projection', startedAt, { taskFound: true });
}

async function runGlobalTimerCheck(ctx, taskId, state) {
    const startedAt = Date.now();
    let started = false;
    try {
        await apiRequest(ctx, '/api/my-day/timer/start', {
            method: 'POST',
            body: { taskId, sourceSurface: SMOKE_SURFACE }
        });
        started = true;
        const timer = await apiRequest(ctx, '/api/my-day/timer', { method: 'GET' });
        if (!timer?.success || !timer.timer?.isActive) throw new Error('Global timer did not become active.');
        if (Number(timer.timer.task?.id || timer.timer.taskId || 0) !== Number(taskId) && timer.timer.taskUnavailable !== true) {
            throw new Error('Global timer is active on an unexpected task.');
        }
        await apiRequest(ctx, '/api/my-day/timer/stop', {
            method: 'POST',
            body: { sourceSurface: SMOKE_SURFACE }
        });
        started = false;
        recordStep(state, 'global-timer:start-hydrate-stop', startedAt, { activeObserved: true, stopped: true });
    } finally {
        if (started) {
            try {
                await apiRequest(ctx, '/api/my-day/timer/stop', {
                    method: 'POST',
                    body: { sourceSurface: SMOKE_SURFACE, cleanup: true }
                });
            } catch {}
        }
    }
}

async function loadTaskForCleanup(ctx, id) {
    return apiRequest(ctx, `/api/tasks/${encodeURIComponent(id)}`, { method: 'GET' });
}

async function cleanupExactQaTasks(ctx, ids = [], marker, options = {}) {
    const cleaned = [];
    const exactIds = [...new Set(ids.map(Number).filter(id => Number.isInteger(id) && id > 0))];
    if (!exactIds.length) return cleaned;
    const markerText = String(marker || '');
    if (!markerText.startsWith('EGX_MY_DAY_AI_QA_')) throw new Error('Cleanup marker is required.');
    const guardTokens = [
        markerText,
        ...(Array.isArray(options.allowedSearchTokens) ? options.allowedSearchTokens : [])
    ].map(token => String(token || '').trim()).filter(token => token.length >= 8);
    for (const id of exactIds) {
        const row = { id, status: 'pending' };
        try {
            const task = await loadTaskForCleanup(ctx, id);
            const searchable = JSON.stringify(task || {});
            if (!guardTokens.some(token => searchable.includes(token))) {
                throw new Error('Exact QA marker or bundle guard was not found on task; refusing to archive.');
            }
            if (!options.dryRun) {
                await apiRequest(ctx, '/api/tasks/bulk', {
                    method: 'POST',
                    idempotencyKey: `${markerText}:archive:${id}`,
                    body: {
                        ids: [id],
                        action: 'archive',
                        sourceSurface: SMOKE_SURFACE,
                        archiveReason: 'live_my_day_ai_mutation_smoke_cleanup',
                        businessContext: ctx.businessContext
                    }
                });
            }
            row.status = options.dryRun ? 'verified' : 'archived';
        } catch (error) {
            row.status = 'failed';
            row.error = redactedError(error);
        }
        cleaned.push(row);
    }
    return cleaned;
}

function redactedArtifact(state = {}, options = {}) {
    return {
        marker: state.marker,
        generatedAt: new Date().toISOString(),
        target: {
            baseUrl: options.baseUrl ? normalizeBaseUrl(options.baseUrl) : null,
            businessContext: options.businessContext || null
        },
        version: state.version || null,
        session: {
            source: state.sessionSource || null,
            userVerified: state.userVerified === true
        },
        created: {
            taskIds: [...state.createdTaskIds].sort((a, b) => a - b),
            bundleIds: state.bundleIds.slice()
        },
        cleanup: state.cleanup || [],
        steps: state.steps || [],
        counts: {
            records: state.records?.length || 0,
            tasksCreated: state.createdTaskIds?.size || 0,
            bundlesCreated: state.bundleIds?.length || 0,
            cleanupArchived: (state.cleanup || []).filter(item => item.status === 'archived').length,
            cleanupFailed: (state.cleanup || []).filter(item => item.status === 'failed').length
        },
        status: state.status || 'unknown',
        error: state.error || null,
        redaction: {
            taskTextStored: false,
            promptStored: false,
            providerResponseStored: false,
            secretsStored: false,
            signedProposalStored: false
        }
    };
}

function writeArtifact(state, options) {
    const artifact = redactedArtifact(state, options);
    fs.mkdirSync(options.outputDir, { recursive: true });
    const filePath = path.join(options.outputDir, `${sanitizeFileToken(state.marker)}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`);
    return filePath;
}

function scenarioDrafts(marker, today) {
    return {
        simple: {
            title: `${marker} simple call`,
            description: `${marker} One safe QA-only action: record that the reports check was requested.`,
            mode: 'simple',
            scheduleDate: today,
            impactIds: []
        },
        checklist: {
            title: `${marker} checklist reports verification`,
            description: `${marker} Prepare one checklist task with exactly four internal steps for checking CRM reports, validating numbers, noting issues, and confirming the result today.`,
            mode: 'checklist',
            scheduleDate: today,
            impactIds: []
        },
        bundle: {
            title: `${marker} explicit separate task bundle`,
            description: `${marker} Create four separate independent QA tasks: CRM report check, Hermes sync check, Park operations check, and analytics summary. These are separate full tasks, not dependencies and not one checklist.`,
            mode: 'simple',
            scheduleDate: today,
            impactIds: []
        }
    };
}

async function runMutationSmoke(options = {}, env = process.env) {
    validateOptions(options);
    const base = normalizeBaseUrl(options.baseUrl);
    const state = {
        marker: options.marker,
        records: [],
        steps: [],
        createdTaskIds: new Set(options.cleanupOnly ? options.ids : []),
        bundleIds: [],
        cleanup: [],
        status: 'running'
    };
    let ctx = null;
    try {
        const versionStarted = Date.now();
        state.version = await fetchJson(base, '/api/version', { timeoutMs: options.timeoutMs });
        recordStep(state, 'version', versionStarted, {
            version: state.version?.version || null,
            sha: state.version?.commit || state.version?.commitSha || null
        });

        const session = await login(base, options, env);
        state.sessionSource = session.source;
        state.userVerified = true;
        ctx = apiContext(base, session, options, state);

        if (options.cleanupOnly) {
            state.cleanup = await cleanupExactQaTasks(ctx, options.ids, options.marker);
            state.status = state.cleanup.some(row => row.status === 'failed') ? 'cleanup_failed' : 'cleanup_complete';
            return { state, artifactPath: writeArtifact(state, options) };
        }

        const statusStarted = Date.now();
        const featureStatus = await apiRequest(ctx, '/api/tasks/ai-draft/status', { method: 'GET' });
        ensureSuccess(featureStatus, 'AI draft status');
        recordStep(state, 'ai-status', statusStarted, {
            enabled: featureStatus.feature?.enabled !== false,
            provider: featureStatus.diagnostics?.provider || featureStatus.provider || 'openai'
        });

        const today = kyivDate();
        const drafts = scenarioDrafts(options.marker, today);

        const simplePreview = await previewDraft(ctx, drafts.simple, state, 'simple');
        const simpleProposal = requireProposal(simplePreview, 'simple preview', ['single_task']);
        const simpleCommit = await commitSingle(ctx, simplePreview, {
            title: `${options.marker} simple committed`,
            description: `${options.marker} simple committed description`,
            mode: simpleProposal.mode || 'simple',
            taskMode: 'work',
            impactIds: safeImpactIds(simpleProposal),
            subtasks: [],
            scheduleDate: today,
            scheduleConfirmed: true,
            priority: 'normal'
        }, ['title', 'description', 'mode', 'impactIds', 'scheduleDate', 'priority'], `live-my-day-ai-simple-${options.marker}`, state, 'simple', { replay: true });
        const simpleTaskId = Number(simpleCommit.task?.id || 0);
        if (!simpleTaskId) throw new Error('Simple commit did not return a task id.');
        await assertTaskInMyDay(ctx, simpleTaskId, today, state);

        const checklistPreview = await previewDraft(ctx, drafts.checklist, state, 'checklist');
        const checklistProposal = requireProposal(checklistPreview, 'checklist preview', ['checklist']);
        const proposalSubtasks = Array.isArray(checklistProposal.subtasks) ? checklistProposal.subtasks : [];
        if (proposalSubtasks.length < 4) throw new Error('Checklist preview returned fewer than four subtasks.');
        const finalSubtasks = proposalSubtasks.slice(0, 4).map((item, index) => ({
            title: index === 0 ? `${options.marker} edited checklist step` : item.title
        }));
        await commitSingle(ctx, checklistPreview, {
            title: `${options.marker} checklist committed`,
            description: '',
            mode: 'checklist',
            taskMode: 'work',
            impactIds: safeImpactIds(checklistProposal),
            subtasks: finalSubtasks,
            scheduleDate: today,
            scheduleConfirmed: true,
            priority: 'normal'
        }, ['title', 'mode', 'impactIds', 'subtasks', 'scheduleDate'], `live-my-day-ai-checklist-${options.marker}`, state, 'checklist');

        const bundlePreview = await previewDraft(ctx, drafts.bundle, state, 'bundle');
        const bundleProposal = requireProposal(bundlePreview, 'bundle preview', ['task_bundle']);
        const proposalTasks = Array.isArray(bundleProposal.tasks) ? bundleProposal.tasks : [];
        if (proposalTasks.length < 4) throw new Error('Bundle preview must propose at least four tasks to exercise reject/edit.');
        const acceptedTaskMask = [0, 1, 2];
        const rejectedTaskMask = proposalTasks.map((_, index) => index).filter(index => !acceptedTaskMask.includes(index));
        const finalTasks = acceptedTaskMask.map((proposalIndex, index) => {
            const task = proposalTasks[proposalIndex];
            return {
                title: index === 0 ? `${options.marker} edited bundle task` : task.title,
                description: task.description || null,
                impactIds: Array.isArray(task.impactIds) ? task.impactIds.slice(0, 3) : [],
                priority: task.priority || 'normal',
                subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
                scheduleDate: task.scheduleDate || task.dueDate || task.date || null,
                ownerSuggestion: task.ownerSuggestion || { userId: null, name: null, reason: null },
                userEdited: index === 0
            };
        });
        await commitBundle(ctx, bundlePreview, finalTasks, acceptedTaskMask, rejectedTaskMask, `live-my-day-ai-bundle-${options.marker}`, state);

        await runGlobalTimerCheck(ctx, simpleTaskId, state);
        state.cleanup = await cleanupExactQaTasks(ctx, [...state.createdTaskIds], options.marker, {
            allowedSearchTokens: state.bundleIds
        });
        if (state.cleanup.some(row => row.status === 'failed')) {
            state.status = 'cleanup_failed';
            throw new Error('Live smoke passed but cleanup failed for one or more exact QA task IDs.');
        }
        state.status = 'passed';
        return { state, artifactPath: writeArtifact(state, options) };
    } catch (error) {
        state.status = state.status === 'cleanup_failed' ? state.status : 'failed';
        state.error = redactedError(error);
        if (ctx && state.createdTaskIds.size && !state.cleanup.length) {
            state.cleanup = await cleanupExactQaTasks(ctx, [...state.createdTaskIds], options.marker, {
                allowedSearchTokens: state.bundleIds
            }).catch(cleanupError => ([{
                id: null,
                status: 'failed',
                error: redactedError(cleanupError)
            }]));
        }
        const artifactPath = writeArtifact(state, options);
        error.artifactPath = artifactPath;
        throw error;
    }
}

async function main() {
    const env = process.env;
    const preOptions = parseArgs(process.argv.slice(2), env);
    hydrateEnvFromSecretsFile(env, preOptions.secretsFile);
    const options = parseArgs(process.argv.slice(2), env);
    try {
        const { state, artifactPath } = await runMutationSmoke(options, env);
        console.log(JSON.stringify({
            success: state.status === 'passed' || state.status === 'cleanup_complete',
            status: state.status,
            artifactPath,
            taskIds: [...state.createdTaskIds].sort((a, b) => a - b),
            bundleIds: state.bundleIds,
            cleanupArchived: state.cleanup.filter(item => item.status === 'archived').length
        }, null, 2));
        process.exit(state.status === 'passed' || state.status === 'cleanup_complete' ? 0 : 1);
    } catch (error) {
        console.error(`Live My Day AI mutation smoke failed: ${error.message}`);
        if (error.artifactPath) console.error(`Redacted artifact: ${error.artifactPath}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    DEFAULT_ALLOWED_BUSINESS_CONTEXTS,
    SMOKE_SURFACE,
    parseArgs,
    parseIds,
    parsePowerShellEnvAssignments,
    hydrateEnvFromSecretsFile,
    validateOptions,
    assertKnownTestAccount,
    kyivDate,
    scenarioDrafts,
    containsTaskId,
    redactedArtifact,
    cleanupExactQaTasks,
    runMutationSmoke
};
