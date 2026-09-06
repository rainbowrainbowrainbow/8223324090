'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'r9-local-refresh-risk-secret-with-more-than-64-bytes-for-repro-only';
process.env.NODE_ENV = 'test';

const ROOT = path.resolve(__dirname, '..');
const RELEASE_SHA = 'd7aed2573d876c7051e96897a835343ed33573d5';
const PRE_RELEASE_SHA = '9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5';
const CURRENT_API_CODE = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
const CURRENT_SW_CODE = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const MODELED_OLD_API_CODE = `
function getStoredAuthToken() {
    return localStorage.getItem('pzp_token') || localStorage.getItem('pzp_access_token');
}
function clearApiAuthSessionStorage() {
    localStorage.removeItem('pzp_token');
    localStorage.removeItem('pzp_access_token');
    localStorage.removeItem('pzp_refresh_token');
    localStorage.removeItem('pzp_refresh_expires_at');
    localStorage.removeItem('pzp_current_user');
}
async function apiRefreshAuthSession() {
    const refreshToken = localStorage.getItem('pzp_refresh_token');
    if (!refreshToken) return { accessToken: null, outcome: 'missing' };
    const accessToken = getStoredAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers,
        body: JSON.stringify({ refreshToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.accessToken) {
        clearApiAuthSessionStorage();
        return { accessToken: null, outcome: 'terminal' };
    }
    localStorage.setItem('pzp_token', data.accessToken);
    localStorage.setItem('pzp_access_token', data.accessToken);
    localStorage.setItem('pzp_refresh_token', data.refreshToken);
    if (data.refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', data.refreshExpiresAt);
    if (data.user) localStorage.setItem('pzp_current_user', JSON.stringify(data.user));
    return { accessToken: data.accessToken, outcome: 'success' };
}
function getApiAuthSessionFailure() { return null; }
`;
function loadHistoricalBlobOrFallback(blobPath, fallback) {
    try {
        return {
            source: 'git-blob',
            code: childProcess.execFileSync('git', ['show', `${PRE_RELEASE_SHA}:${blobPath}`], { cwd: ROOT, encoding: 'utf8' })
        };
    } catch (error) {
        return {
            source: 'modeled-fallback',
            error: String(error?.message || error).slice(0, 240),
            code: fallback
        };
    }
}
const OLD_API_BLOB = loadHistoricalBlobOrFallback('js/api.js', MODELED_OLD_API_CODE);
const OLD_STATUS_BLOB = loadHistoricalBlobOrFallback('status.html', '<!doctype html><meta charset="utf-8"><title>old status v=0.81.75</title>');
const OLD_API_CODE = OLD_API_BLOB.code;
const OLD_STATUS_HTML = OLD_STATUS_BLOB.code;
const OUT_DIR = path.join(ROOT, 'output', 'r9-redirect-risk');
const REPORT_JSON = path.join(OUT_DIR, 'r9-redirect-risk-results.json');

const report = {
    releaseSha: RELEASE_SHA,
    preReleaseFrontendSha: PRE_RELEASE_SHA,
    generatedAt: new Date().toISOString(),
    scenarios: []
};

function record(scenario) {
    report.scenarios.push(scenario);
}

function response(status, body = {}, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: key => headers[String(key).toLowerCase()] || null },
        async json() { return body; },
        clone() { return response(status, body, headers); }
    };
}

function createApiRealm({ apiCode = CURRENT_API_CODE, store = new Map(), fetchImpl, timers = null, windowTimers = null, locationPath = '/sales-funnel' } = {}) {
    const timerList = timers || [];
    const context = {
        console: { warn() {}, error() {}, log() {} },
        URL,
        URLSearchParams,
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } },
        API_BASE: '/api',
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        sessionStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        },
        window: {
            location: { search: '', href: `http://localhost${locationPath}`, origin: 'http://localhost', pathname: locationPath },
            history: { replaceState() {} },
            addEventListener() {},
            removeEventListener() {},
            self: null,
            top: null,
            ...(windowTimers ? { setTimeout: windowTimers.setTimeout, clearTimeout: windowTimers.clearTimeout } : {})
        },
        document: { documentElement: { classList: { contains() { return false; } } } },
        fetch: fetchImpl,
        setTimeout: (callback, ms) => {
            if (timers) {
                timerList.push({ callback, ms });
                return timerList.length;
            }
            return setTimeout(callback, ms);
        },
        clearTimeout() {}
    };
    context.window.self = context.window;
    context.window.top = context.window;
    vm.createContext(context);
    vm.runInContext(apiCode, context, { filename: 'js/api.js' });
    return context;
}


function createControlledWindowClock() {
    let now = 0;
    let nextId = 1;
    const timers = [];
    return {
        setTimeout(callback, ms = 0) {
            const id = nextId++;
            timers.push({ id, callback, at: now + Number(ms || 0), ms: Number(ms || 0), cleared: false });
            return id;
        },
        clearTimeout(id) {
            const timer = timers.find(item => item.id === id);
            if (timer) timer.cleared = true;
        },
        pending() {
            return timers.filter(timer => !timer.cleared).map(timer => ({ id: timer.id, ms: timer.ms, at: timer.at }));
        },
        async advance(ms) {
            now += Number(ms || 0);
            let ran = true;
            while (ran) {
                ran = false;
                timers.sort((left, right) => left.at - right.at || left.id - right.id);
                const index = timers.findIndex(timer => !timer.cleared && timer.at <= now);
                if (index >= 0) {
                    const [timer] = timers.splice(index, 1);
                    timer.cleared = true;
                    timer.callback();
                    ran = true;
                    await Promise.resolve();
                }
            }
            await Promise.resolve();
        }
    };
}

async function promiseState(promise) {
    const marker = {};
    return Promise.race([promise, Promise.resolve(marker)]).then(value => (value === marker ? 'pending' : 'settled'));
}

async function flushMicrotasks(count = 6) {
    for (let index = 0; index < count; index += 1) await Promise.resolve();
}

function refreshHash(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function buildFakeAuthDb() {
    const users = new Map([[14, {
        id: 14,
        username: 'r9.qa',
        role: 'animator',
        extra_roles: [],
        page_allowlist: [],
        page_denylist: [],
        action_allowlist: [],
        action_denylist: [],
        business_contexts: [],
        default_business_context: null,
        name: 'R9 QA',
        telegram_chat_id: null,
        is_active: true,
        session_revoked_at: null
    }], [15, {
        id: 15,
        username: 'r9.other',
        role: 'animator',
        extra_roles: [],
        page_allowlist: [],
        page_denylist: [],
        action_allowlist: [],
        action_denylist: [],
        business_contexts: [],
        default_business_context: null,
        name: 'R9 Other',
        telegram_chat_id: null,
        is_active: true,
        session_revoked_at: null
    }]]);
    const tokens = [];
    let nextTokenId = 1;
    const now = () => new Date();

    function tokenByHash(hash) {
        return tokens.find(token => token.token_hash === hash) || null;
    }

    function tokenById(id) {
        return tokens.find(token => Number(token.id) === Number(id)) || null;
    }

    async function query(sql, params = []) {
        const normalized = String(sql).replace(/\s+/g, ' ').trim();
        if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(normalized)) return { rows: [] };
        if (normalized.includes('INSERT INTO refresh_tokens')) {
            const row = {
                id: nextTokenId++,
                user_id: Number(params[0]),
                token_hash: params[1],
                device_info: params[2] || '',
                ip_address: params[3] || null,
                expires_at: params[4],
                created_at: now(),
                revoked_at: null,
                replaced_by: null
            };
            tokens.push(row);
            return { rows: [{ id: row.id, created_at: row.created_at }] };
        }
        if (normalized.startsWith('SELECT user_id FROM refresh_tokens WHERE token_hash = $1')) {
            const token = tokenByHash(params[0]);
            return { rows: token ? [{ user_id: token.user_id }] : [] };
        }
        if (normalized.includes('FROM users') && normalized.includes('FOR UPDATE')) {
            const user = users.get(Number(params[0]));
            return { rows: user ? [{ ...user }] : [] };
        }
        if (normalized.includes('SELECT qa_creator_lease_id::text')) return { rows: [] };
        if (normalized.includes('FROM refresh_tokens') && normalized.includes('WHERE token_hash = $1') && normalized.includes('FOR UPDATE')) {
            const token = tokenByHash(params[0]);
            return { rows: token ? [{ ...token, rotation_age_ms: token.revoked_at ? now().getTime() - new Date(token.revoked_at).getTime() : null }] : [] };
        }
        if (normalized.includes('FROM refresh_tokens') && normalized.includes('WHERE id = $1 AND user_id = $2')) {
            const token = tokenById(params[0]);
            return { rows: token && Number(token.user_id) === Number(params[1]) ? [{ ...token }] : [] };
        }
        if (normalized.startsWith('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1')) {
            const token = tokenById(params[0]);
            if (token) token.revoked_at = now();
            return { rows: [] };
        }
        if (normalized.includes('UPDATE refresh_tokens SET revoked_at = clock_timestamp(), replaced_by = $1 WHERE id = $2')) {
            const token = tokenById(params[1]);
            if (token) {
                token.revoked_at = now();
                token.replaced_by = Number(params[0]);
            }
            return { rows: [] };
        }
        if (normalized.includes('UPDATE refresh_tokens SET revoked_at = clock_timestamp() WHERE id = ANY($1::int[]) AND id <> $2')) {
            for (const id of params[0] || []) {
                const token = tokenById(id);
                if (token && Number(token.id) !== Number(params[1]) && !token.revoked_at) token.revoked_at = now();
            }
            return { rows: [] };
        }
        if (normalized.includes('UPDATE refresh_tokens SET revoked_at = clock_timestamp() WHERE id = ANY($1::int[]) AND revoked_at IS NULL')) {
            for (const id of params[0] || []) {
                const token = tokenById(id);
                if (token && !token.revoked_at) token.revoked_at = now();
            }
            return { rows: [] };
        }
        if (normalized.includes('UPDATE refresh_tokens SET replaced_by = $1 WHERE id = $2')) {
            const token = tokenById(params[1]);
            if (token) token.replaced_by = Number(params[0]);
            return { rows: [] };
        }
        throw new Error(`Unhandled fake SQL: ${normalized}`);
    }

    const pool = {
        async query(sql, params) { return query(sql, params); },
        async connect() { return { query, release() {} }; }
    };
    return {
        pool,
        users,
        tokens,
        tokenByRaw(raw) { return tokenByHash(refreshHash(raw)); },
        setRotationAge(raw, seconds) {
            const token = this.tokenByRaw(raw);
            assert.ok(token, `token not found for age ${seconds}`);
            token.revoked_at = new Date(Date.now() - seconds * 1000);
        },
        activeTokens(userId = 14) { return tokens.filter(token => Number(token.user_id) === Number(userId) && !token.revoked_at); },
        chain(raw) {
            const first = this.tokenByRaw(raw);
            const out = [];
            const visited = new Set();
            let token = first;
            while (token && !visited.has(token.id)) {
                visited.add(token.id);
                out.push({ id: token.id, userId: token.user_id, revoked: Boolean(token.revoked_at), replacedBy: token.replaced_by || null });
                token = token.replaced_by ? tokenById(token.replaced_by) : null;
            }
            return out;
        }
    };
}

function loadAuthWithFakePool(fake) {
    const db = require('../db');
    db.pool.connect = fake.pool.connect;
    db.pool.query = fake.pool.query;
    delete require.cache[require.resolve('../middleware/auth')];
    return require('../middleware/auth');
}

async function setupRotatedSession(ageSeconds, { userId = 14 } = {}) {
    const fake = buildFakeAuthDb();
    const auth = loadAuthWithFakePool(fake);
    const user = fake.users.get(userId);
    const pair = await auth.createTokenPair(user, { deviceInfo: 'r9', ipAddress: '127.0.0.1' }, fake.pool);
    const first = await auth.rotateRefreshToken(pair.refreshToken, { deviceInfo: 'r9', ipAddress: '127.0.0.1' });
    fake.setRotationAge(pair.refreshToken, ageSeconds);
    return { fake, auth, user, original: pair, first };
}

test('R9 reproduction: lost committed refresh response at 6/31/60/120 seconds', async () => {
    const outcomes = [];
    for (const seconds of [6, 31, 60, 120]) {
        const { fake, auth, original, first } = await setupRotatedSession(seconds);
        const retry = await auth.rotateRefreshToken(original.refreshToken, {
            deviceInfo: 'r9',
            ipAddress: '127.0.0.1',
            recoveryAccessToken: original.accessToken
        });
        outcomes.push({
            delaySeconds: seconds,
            status: retry.status || 200,
            code: retry.code || null,
            recovered: retry.recovered === true,
            activeRefreshTokens: fake.activeTokens(14).length,
            chain: fake.chain(original.refreshToken),
            classification: seconds <= 30 ? 'expected_safe_recovery' : 'product_failure_session_loss_after_lost_committed_response'
        });
        assert.ok(first.refreshToken, 'first committed response must create replacement token');
        if (seconds <= 30) {
            assert.equal(retry.recovered, true);
            assert.equal(fake.activeTokens(14).length, 1);
        } else {
            assert.equal(retry.status, 401);
            assert.equal(retry.code, 'refresh_token_reuse');
            assert.equal(fake.activeTokens(14).length, 0);
        }
    }
    const duplicateGraceControls = [];
    for (const seconds of [4, 31]) {
        const { fake, auth, original } = await setupRotatedSession(seconds);
        const retry = await auth.rotateRefreshToken(original.refreshToken, { deviceInfo: 'r9', ipAddress: '127.0.0.1' });
        duplicateGraceControls.push({
            delaySeconds: seconds,
            status: retry.status || 200,
            code: retry.code || null,
            activeRefreshTokens: fake.activeTokens(14).length,
            chain: fake.chain(original.refreshToken),
            classification: seconds <= 5 ? 'duplicate_grace_without_proof' : 'post_grace_terminal_reuse_without_proof'
        });
        if (seconds <= 5) {
            assert.equal(retry.status, 409);
            assert.equal(retry.code, 'refresh_already_rotated');
            assert.equal(fake.activeTokens(14).length, 1);
        } else {
            assert.equal(retry.status, 401);
            assert.equal(retry.code, 'refresh_token_reuse');
            assert.equal(fake.activeTokens(14).length, 0);
        }
    }
    record({ name: 'lost_committed_refresh_response_delayed_retry', type: 'backend_contract', outcomes, duplicateGraceControls });
});

test('R10A regression: stalled refresh fetch has a controlled deadline and safe late response handling', async () => {
    let refreshCalls = 0;
    let releaseLate;
    const clock = createControlledWindowClock();
    const user = { id: 14, username: 'r9.qa', role: 'animator' };
    const store = new Map(Object.entries({
        pzp_token: 'expired-access',
        pzp_access_token: 'expired-access',
        pzp_refresh_token: 'stalled-refresh',
        pzp_auth_session_generation: 'r9-generation',
        pzp_auth_session_token_id: '1',
        pzp_current_user: JSON.stringify(user)
    }));
    const context = createApiRealm({
        store,
        windowTimers: clock,
        fetchImpl: async url => {
            assert.equal(url, '/api/auth/refresh');
            refreshCalls += 1;
            return new Promise(resolve => { releaseLate = resolve; });
        }
    });
    const first = context.apiRefreshAuthSession();
    const second = context.apiRefreshAuthSession();
    assert.equal(first, second, 'same tab repeated action joins the stalled inflight transport');
    assert.equal(refreshCalls, 1);
    assert.equal(clock.pending().some(timer => timer.ms === 12000), true);
    await clock.advance(11999);
    const beforeDeadline = await promiseState(first);
    await clock.advance(1);
    const atDeadline = await first;
    const retryDuringTransport = await context.apiRefreshAuthSession();
    assert.equal(beforeDeadline, 'pending');
    assert.equal(atDeadline.outcome, 'retry-later');
    assert.equal(retryDuringTransport.outcome, 'retry-later');
    assert.equal(refreshCalls, 1);
    assert.equal(store.get('pzp_refresh_token'), 'stalled-refresh');
    releaseLate(response(200, { accessToken: 'late-access', refreshToken: 'late-refresh', sessionTokenId: 2, user }));
    await flushMicrotasks();
    assert.equal(store.get('pzp_refresh_token'), 'late-refresh');
    record({
        name: 'stalled_refresh_fetch_late_response',
        type: 'frontend_contract',
        classification: 'covered_by_r10a_controlled_retry_later_without_logout',
        actual: {
            beforeDeadline,
            atDeadlineOutcome: atDeadline.outcome,
            retryDuringTransportOutcome: retryDuringTransport.outcome,
            refreshCalls,
            firstAndSecondSharePromise: true,
            lateAppliedRefreshToken: store.get('pzp_refresh_token')
        },
        residualRisk: 'a post-grace backend replay at 31/60/120 seconds remains terminal under the current backend contract'
    });
});

test('R9 negative/security cases remain terminal or isolated', async () => {
    const cases = [];
    {
        const { fake, auth, original } = await setupRotatedSession(6);
        const retry = await auth.rotateRefreshToken(original.refreshToken, { deviceInfo: 'r9', ipAddress: '127.0.0.1' });
        cases.push({ name: 'missing_recovery_proof', status: retry.status, code: retry.code, activeRefreshTokens: fake.activeTokens(14).length });
        assert.equal(retry.status, 401);
        assert.equal(retry.code, 'refresh_token_reuse');
    }
    {
        const { fake, auth, original } = await setupRotatedSession(6);
        const other = await auth.createTokenPair(fake.users.get(15), { deviceInfo: 'r9', ipAddress: '127.0.0.1' }, fake.pool);
        const retry = await auth.rotateRefreshToken(original.refreshToken, { deviceInfo: 'r9', ipAddress: '127.0.0.1', recoveryAccessToken: other.accessToken });
        cases.push({ name: 'other_account_proof', status: retry.status, code: retry.code, user14Active: fake.activeTokens(14).length, user15Active: fake.activeTokens(15).length });
        assert.equal(retry.status, 401);
        assert.equal(retry.code, 'refresh_token_reuse');
        assert.equal(fake.activeTokens(15).length, 1);
    }
    {
        const { fake, auth, original } = await setupRotatedSession(6);
        const otherSession = await auth.createTokenPair(fake.users.get(14), { deviceInfo: 'r9-other-session', ipAddress: '127.0.0.1' }, fake.pool);
        const retry = await auth.rotateRefreshToken(original.refreshToken, { deviceInfo: 'r9', ipAddress: '127.0.0.1', recoveryAccessToken: otherSession.accessToken });
        cases.push({ name: 'same_user_other_session_proof', status: retry.status, code: retry.code, activeRefreshTokens: fake.activeTokens(14).length });
        assert.equal(retry.status, 401);
        assert.equal(retry.code, 'refresh_token_reuse');
        assert.equal(fake.activeTokens(14).length, 1, 'independent same-user session must remain active while replayed chain is revoked');
    }
    {
        const fake = buildFakeAuthDb();
        const auth = loadAuthWithFakePool(fake);
        const pair = await auth.createTokenPair(fake.users.get(14), {}, fake.pool);
        fake.users.get(14).is_active = false;
        const retry = await auth.rotateRefreshToken(pair.refreshToken, { recoveryAccessToken: pair.accessToken });
        cases.push({ name: 'deactivation', status: retry.status, code: retry.code, activeRefreshTokens: fake.activeTokens(14).length });
        assert.equal(retry.status, 401);
        assert.equal(retry.code, 'refresh_user_inactive');
    }
    {
        const fake = buildFakeAuthDb();
        const auth = loadAuthWithFakePool(fake);
        const pair = await auth.createTokenPair(fake.users.get(14), {}, fake.pool);
        fake.users.get(14).session_revoked_at = new Date(Date.now() + 1);
        const retry = await auth.rotateRefreshToken(pair.refreshToken, { recoveryAccessToken: pair.accessToken });
        cases.push({ name: 'session_revocation_logout_boundary', status: retry.status, code: retry.code, activeRefreshTokens: fake.activeTokens(14).length });
        assert.equal(retry.status, 401);
        assert.equal(retry.code, 'refresh_session_revoked');
    }
    record({ name: 'negative_security_cases', type: 'backend_contract', classification: 'expected_security_pass', cases });
});

function findChrome() {
    return [
        process.env.CHROME_PATH,
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe')
    ].filter(Boolean).find(candidate => fs.existsSync(candidate));
}

async function waitForPortFile(dir) {
    const file = path.join(dir, 'DevToolsActivePort');
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (fs.existsSync(file)) {
            try {
                const [port] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
                if (Number(port) > 0) return Number(port);
            } catch {}
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Chrome did not expose DevToolsActivePort');
}

class CdpPage {
    constructor(wsUrl) {
        this.ws = new WebSocket(wsUrl);
        this.next = 1;
        this.pending = new Map();
        this.ready = new Promise((resolve, reject) => {
            this.ws.addEventListener('open', resolve, { once: true });
            this.ws.addEventListener('error', reject, { once: true });
        });
        this.ws.addEventListener('message', event => this.onMessage(event));
    }
    onMessage(event) {
        const message = JSON.parse(String(event.data));
        if (!message.id || !this.pending.has(message.id)) return;
        const { resolve, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result || {});
    }
    async send(method, params = {}, timeout = 10000) {
        await this.ready;
        const id = this.next++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`CDP timeout: ${method}`));
            }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    async eval(expression, timeout = 10000) {
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluation failed');
        return result.result?.value;
    }
    close() { try { this.ws.close(); } catch {} }
}

class UpgradeServerModel {
    constructor() {
        this.refreshSeq = 0;
        this.tokens = new Map();
        this.users = new Map([[14, { id: 14, username: 'r9.qa', role: 'animator' }]]);
        this.requests = [];
        this.failFirstRefreshSocket = true;
    }
    createToken(label) {
        const token = `${label}-${++this.refreshSeq}-${crypto.randomBytes(4).toString('hex')}`;
        this.tokens.set(token, { token, userId: 14, revoked: false, replacedBy: null, revokedAt: null });
        return token;
    }
    createSession() {
        const refreshToken = this.createToken('t0');
        return { accessToken: `access-for-session-${this.refreshSeq}`, refreshToken, user: this.users.get(14) };
    }
    rotate(refreshToken, hasProof, ageSeconds = 31) {
        const token = this.tokens.get(refreshToken);
        if (!token) return { status: 401, body: { code: 'refresh_token_invalid' } };
        if (token.revoked) {
            if (token.replacedBy && hasProof && ageSeconds <= 30) {
                const next = this.createToken('recovered');
                const replacement = this.tokens.get(token.replacedBy);
                if (replacement && !replacement.revoked) {
                    replacement.revoked = true;
                    replacement.revokedAt = Date.now();
                    replacement.replacedBy = next;
                }
                return { status: 200, body: { accessToken: 'recovered-access', refreshToken: next, user: this.users.get(14), recovered: true } };
            }
            if (token.replacedBy) {
                const replacement = this.tokens.get(token.replacedBy);
                if (replacement && !replacement.revoked) replacement.revoked = true;
                return { status: 401, body: { code: 'refresh_token_reuse' } };
            }
            return { status: 401, body: { code: 'refresh_token_revoked' } };
        }
        const next = this.createToken('t1');
        token.revoked = true;
        token.revokedAt = Date.now();
        token.replacedBy = next;
        return { status: 200, body: { accessToken: 'rotated-access', refreshToken: next, user: this.users.get(14) } };
    }
    activeCount() {
        return Array.from(this.tokens.values()).filter(token => !token.revoked).length;
    }
    chain(refreshToken) {
        const chain = [];
        const seen = new Set();
        let current = refreshToken;
        while (current && this.tokens.has(current) && !seen.has(current)) {
            seen.add(current);
            const token = this.tokens.get(current);
            chain.push({ label: token.token.split('-')[0], revoked: token.revoked, replacedByLabel: token.replacedBy ? token.replacedBy.split('-')[0] : null });
            current = token.replacedBy;
        }
        return chain;
    }
}

function startUpgradeServer() {
    const model = new UpgradeServerModel();
    const oldStatusVersionMarker = /v=0\.81\.75/.test(OLD_STATUS_HTML) ? '0.81.75' : 'unknown';
    const html = '<!doctype html><meta charset="utf-8"><title>old status ' + PRE_RELEASE_SHA
        + '</title><body data-pre-release-status-version="' + oldStatusVersionMarker
        + '"><script src="/js/api.js?v=' + oldStatusVersionMarker + '"></script></body>';
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const send = (status, type, body) => {
            res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
            res.end(body);
        };
        if (url.pathname === '/' || url.pathname === '/status.html') return send(200, 'text/html; charset=utf-8', html);
        if (url.pathname === '/new-status.html') return send(200, 'text/html; charset=utf-8', '<!doctype html><script src="/js/current-api.js"></script><body>new status</body>');
        if (url.pathname === '/js/api.js') return send(200, 'application/javascript; charset=utf-8', OLD_API_CODE);
        if (url.pathname === '/js/auth.js') return send(200, 'application/javascript; charset=utf-8', 'window.__oldAuthLoaded=true;');
        if (url.pathname === '/js/current-api.js') return send(200, 'application/javascript; charset=utf-8', CURRENT_API_CODE);
        if (url.pathname === '/sw.js') return send(200, 'application/javascript; charset=utf-8', CURRENT_SW_CODE);
        if (url.pathname === '/api/version') return send(200, 'application/json', JSON.stringify({ version: '0.81.76', commitSha: RELEASE_SHA, sourceBranch: 'codex/eventgenix-production' }));
        if (url.pathname === '/api/auth/login') return send(200, 'application/json', JSON.stringify(model.createSession()));
        if (url.pathname === '/api/auth/verify' || url.pathname === '/api/auth/permissions') return send(200, 'application/json', JSON.stringify({ user: model.users.get(14), capabilities: { 'page:/sales-funnel': { allowed: true }, 'page:/certificates': { allowed: true } } }));
        if (url.pathname === '/api/auth/refresh') {
            let raw = '';
            req.on('data', chunk => { raw += chunk; });
            req.on('end', () => {
                const body = JSON.parse(raw || '{}');
                const hasProof = Boolean(req.headers.authorization);
                model.requests.push({ path: url.pathname, hasProof, refreshTokenLabel: String(body.refreshToken || '').split('-')[0] });
                const result = model.rotate(body.refreshToken, hasProof, 31);
                if (model.failFirstRefreshSocket) {
                    model.failFirstRefreshSocket = false;
                    setTimeout(() => {
                        try { res.destroy(); } catch {}
                    }, 10000);
                    return;
                }
                send(result.status, 'application/json', JSON.stringify(result.body));
            });
            return;
        }
        return send(404, 'text/plain', 'not found');
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ server, model, base: `http://127.0.0.1:${server.address().port}` }));
    });
}

async function createChromePage(port) {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    assert.equal(res.ok, true);
    const target = await res.json();
    const page = new CdpPage(target.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    return page;
}

async function waitForExpression(page, expression, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try { if (await page.eval(`Boolean(${expression})`, 3000)) return; } catch {}
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`timeout waiting for ${expression}`);
}

test('R9 reproduction: old api.js with modeled post-grace terminal401 loses session after lost response', async () => {
    const model = new UpgradeServerModel();
    model.failFirstRefreshSocket = false;
    const sharedStore = new Map();
    const oldStatusVersionMarker = /v=0\.81\.75/.test(OLD_STATUS_HTML) ? '0.81.75' : 'unknown';
    const login = model.createSession();
    for (const [key, value] of Object.entries({
        pzp_token: login.accessToken,
        pzp_access_token: login.accessToken,
        pzp_refresh_token: login.refreshToken,
        pzp_current_user: JSON.stringify(login.user),
        pzp_auth_session_generation: 'old-upgrade-cohort'
    })) sharedStore.set(key, value);

    let firstRefreshLost = true;
    const oldFetch = async (url, options = {}) => {
        assert.equal(url, '/api/auth/refresh');
        const body = JSON.parse(options.body || '{}');
        const hasProof = Boolean(options.headers?.Authorization);
        model.requests.push({ path: url, hasProof, refreshTokenLabel: String(body.refreshToken || '').split('-')[0] });
        if (firstRefreshLost) {
            firstRefreshLost = false;
            model.rotate(body.refreshToken, hasProof, 31);
            return new Promise(() => {});
        }
        const rotated = model.rotate(body.refreshToken, hasProof, 31);
        return response(rotated.status, rotated.body);
    };
    const oldTabA = createApiRealm({ apiCode: OLD_API_CODE, store: sharedStore, fetchImpl: oldFetch });
    const oldTabB = createApiRealm({ apiCode: OLD_API_CODE, store: sharedStore, fetchImpl: oldFetch });
    const newTab = createApiRealm({ apiCode: CURRENT_API_CODE, store: sharedStore, fetchImpl: async url => {
        if (url === '/api/auth/refresh') throw new Error('new tab must not refresh after old cohort cleared storage');
        return response(404, {});
    } });

    const first = oldTabA.apiRefreshAuthSession();
    const firstRace = await Promise.race([
        first.then(result => result),
        new Promise(resolve => setTimeout(() => resolve({ outcome: 'still_pending_after_timeout' }), 75))
    ]);
    assert.equal(firstRace.outcome, 'still_pending_after_timeout');
    assert.equal(sharedStore.get('pzp_refresh_token'), login.refreshToken);
    const chainAfterLostCommit = model.chain(login.refreshToken);
    assert.equal(chainAfterLostCommit.length, 2, 'lost committed response must create a concrete replacement chain');
    assert.equal(chainAfterLostCommit[1].revoked, false, 'replacement is active before post-grace replay');
    assert.equal(model.activeCount(), 1);

    const second = await oldTabB.apiRefreshAuthSession();
    const storageAfterSecond = {
        refresh: sharedStore.get('pzp_refresh_token') || null,
        access: sharedStore.get('pzp_access_token') || null,
        failure: oldTabB.getApiAuthSessionFailure?.() || null
    };
    const newTabResult = await newTab.apiRefreshAuthSession();

    record({
        name: 'old_frontend_new_backend_upgrade_cohort',
        type: 'vm_with_real_pre_release_api_js_and_modeled_post_grace_terminal401_new_backend_contract',
        classification: 'product_failure_old_clients_can_terminal_clear_after_lost_committed_response',
        actual: {
            oldStatusVersionMarker,
            oldApiSource: OLD_API_BLOB.source,
            oldStatusSource: OLD_STATUS_BLOB.source,
            oldTabLostResponseOutcome: firstRace.outcome,
            oldSecondTabReplayOutcome: second.outcome,
            storageAfterSecond,
            newTabRefreshOutcome: newTabResult.outcome,
            backendRequests: model.requests,
            chainAfterLostCommit,
            chainAfterPostGraceReplay: model.chain(login.refreshToken),
            activeBackendRefreshTokens: model.activeCount(),
            servedOldFrontendSha: PRE_RELEASE_SHA,
            servedNewBackendSha: RELEASE_SHA,
            cdpBrowserHangingFetch: 'not_claimed_as_real_browser_upgrade_proof'
        },
        expectedForR10: 'old api.js plus modeled post-grace terminal401 proves compatibility risk; this is not a passed real browser to new backend/SW upgrade proof'
    });
    assert.equal(second.outcome, 'terminal');
    assert.equal(storageAfterSecond.refresh, null);
    assert.equal(newTabResult.outcome, 'missing');
    assert.equal(model.activeCount(), 0, 'post-grace replay revoked the concrete replacement token; no extra seed session is counted');
});
test.after(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
});




