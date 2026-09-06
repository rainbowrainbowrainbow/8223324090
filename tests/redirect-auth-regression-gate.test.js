'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const API_CODE = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');

function response(status, body = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; }
    };
}

function createApiRealm({ store, timers = null, fetchImpl }) {
    const context = {
        console: { warn() {}, error() {}, log() {} },
        URL,
        URLSearchParams,
        CONFIG: { STORAGE: { CURRENT_USER: 'pzp_current_user', SESSION: 'pzp_session' } },
        localStorage: {
            getItem: key => store.get(key) || null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key)
        },
        window: {
            location: { search: '', href: 'http://localhost/', origin: 'http://localhost' },
            history: { replaceState() {} },
            self: null,
            top: null
        },
        document: { documentElement: { classList: { contains() { return false; } } } },
        fetch: fetchImpl,
        setTimeout: timers
            ? (callback, ms) => {
                timers.push({ callback, ms });
                return timers.length;
            }
            : setTimeout,
        clearTimeout() {}
    };
    context.window.self = context.window;
    context.window.top = context.window;
    vm.createContext(context);
    vm.runInContext(API_CODE, context, { filename: path.join(ROOT, 'js', 'api.js') });
    return context;
}

async function takeTimer(timers) {
    for (let step = 0; step < 100; step += 1) {
        if (timers.length) return timers.shift();
        await Promise.resolve();
    }
    throw new Error('Expected refresh settlement timer was not scheduled');
}

async function flushMicrotasks(count = 6) {
    for (let index = 0; index < count; index += 1) await Promise.resolve();
}

test('R2 gate: delayed cross-tab refresh coordination timeout does not replay a stale token', async () => {
    const user = { id: 14, username: 'synthetic.qa', role: 'animator' };
    const store = new Map(Object.entries({
        pzp_token: 'synthetic-expired',
        pzp_access_token: 'synthetic-expired',
        pzp_refresh_token: 'synthetic-old',
        pzp_auth_session_generation: 'synthetic-generation',
        pzp_auth_session_token_id: '40',
        pzp_current_user: JSON.stringify(user)
    }));
    const timers = [];
    let deliverWinner;
    let losingCalls = 0;

    const winner = createApiRealm({
        store,
        timers,
        fetchImpl: () => new Promise(resolve => {
            deliverWinner = () => resolve(response(200, {
                accessToken: 'synthetic-new',
                refreshToken: 'synthetic-rotated',
                sessionTokenId: 41,
                user
            }));
        })
    });
    const loser = createApiRealm({
        store,
        timers,
        fetchImpl: async () => {
            losingCalls += 1;
            return response(401, { code: 'refresh_token_reuse' });
        }
    });

    const winningRefresh = winner.apiRefreshAuthSession();
    const losingRefresh = loser.apiRefreshAuthSession();
    const coordinationWait = await takeTimer(timers);
    coordinationWait.callback();
    await flushMicrotasks();
    deliverWinner();

    const [winningResult, losingResult] = await Promise.all([winningRefresh, losingRefresh]);
    assert.equal(losingCalls, 0, 'coordination timeout must not send a stale refresh token after duplicate grace');
    assert.equal(losingResult.outcome, 'retry-later');
    assert.equal(losingResult.retryable, true);
    assert.equal(losingResult.reason, 'refresh-coordination-timeout');
    assert.equal(winningResult.outcome, 'success');
    assert.equal(store.get('pzp_token'), 'synthetic-new');
    assert.equal(store.get('pzp_access_token'), 'synthetic-new');
    assert.equal(store.get('pzp_refresh_token'), 'synthetic-rotated');
    assert.equal(loser.getApiAuthSessionFailure()?.kind, 'transient');
});

test('R2 gate: recovered response delivered after an old success must replace the revoked refresh token', async () => {
    const user = { id: 14, username: 'synthetic.qa', role: 'animator' };
    const store = new Map(Object.entries({
        pzp_token: 'synthetic-expired',
        pzp_access_token: 'synthetic-expired',
        pzp_refresh_token: 'synthetic-old',
        pzp_auth_session_generation: 'synthetic-generation',
        pzp_auth_session_token_id: '40',
        pzp_current_user: JSON.stringify(user)
    }));
    const timers = [];
    let deliverOriginal;
    let deliverRecovered;
    let recoveryCalls = 0;

    const originalTab = createApiRealm({
        store,
        timers,
        fetchImpl: () => new Promise(resolve => {
            deliverOriginal = () => resolve(response(200, {
                accessToken: 'synthetic-t1-access',
                refreshToken: 'synthetic-t1-revoked-by-recovery',
                sessionTokenId: 41,
                user
            }));
        })
    });
    const recoveryTab = createApiRealm({
        store,
        timers,
        fetchImpl: async () => {
            recoveryCalls += 1;
            if (recoveryCalls === 1) return response(409, { code: 'refresh_already_rotated', retryable: true });
            return new Promise(resolve => {
                deliverRecovered = () => resolve(response(200, {
                    accessToken: 'synthetic-t2-access',
                    refreshToken: 'synthetic-t2-active',
                    sessionTokenId: 42,
                    recovered: true,
                    user
                }));
            });
        }
    });

    const originalRefresh = originalTab.apiRefreshAuthSession();
    store.delete('pzp_auth_refresh_coordination');
    const recoveredRefresh = recoveryTab.apiRefreshAuthSession();
    const settlement = await takeTimer(timers);
    settlement.callback();
    const confirmation = await takeTimer(timers);
    confirmation.callback();
    await flushMicrotasks();

    deliverOriginal();
    const originalResult = await originalRefresh;
    assert.equal(originalResult.outcome, 'success');
    assert.equal(store.get('pzp_refresh_token'), 'synthetic-t1-revoked-by-recovery');

    deliverRecovered();
    const recoveredResult = await recoveredRefresh;
    assert.equal(recoveredResult.outcome, 'success');
    assert.equal(recoveryCalls, 2);
    assert.equal(store.get('pzp_token'), 'synthetic-t2-access');
    assert.equal(store.get('pzp_access_token'), 'synthetic-t2-access');
    assert.equal(store.get('pzp_refresh_token'), 'synthetic-t2-active');
    assert.equal(recoveryTab.getApiAuthSessionFailure(), null);
});


test('R2 gate: later server recovery applies even when its client operation started earlier', async () => {
    const user = { id: 14, username: 'synthetic.qa', role: 'animator' };
    const store = new Map(Object.entries({
        pzp_token: 'synthetic-expired',
        pzp_access_token: 'synthetic-expired',
        pzp_refresh_token: 'synthetic-old',
        pzp_auth_session_generation: 'synthetic-generation',
        pzp_auth_session_token_id: '40',
        pzp_current_user: JSON.stringify(user)
    }));
    const timers = [];
    let deliverEarlyStartedLateServer;
    let deliverLaterStartedFirstServer;

    const earlyStartedTab = createApiRealm({
        store,
        timers,
        fetchImpl: () => new Promise(resolve => {
            deliverEarlyStartedLateServer = () => resolve(response(200, {
                accessToken: 'synthetic-t2-access',
                refreshToken: 'synthetic-t2-active',
                sessionTokenId: 42,
                recovered: true,
                user
            }));
        })
    });
    const laterStartedTab = createApiRealm({
        store,
        timers,
        fetchImpl: () => new Promise(resolve => {
            deliverLaterStartedFirstServer = () => resolve(response(200, {
                accessToken: 'synthetic-t1-access',
                refreshToken: 'synthetic-t1-revoked-by-recovery',
                sessionTokenId: 41,
                user
            }));
        })
    });

    const earlyStartedRefresh = earlyStartedTab.apiRefreshAuthSession();
    await flushMicrotasks();
    store.delete('pzp_auth_refresh_coordination');
    const laterStartedRefresh = laterStartedTab.apiRefreshAuthSession();
    await flushMicrotasks();

    deliverLaterStartedFirstServer();
    const laterResult = await laterStartedRefresh;
    assert.equal(laterResult.outcome, 'success');
    assert.equal(store.get('pzp_refresh_token'), 'synthetic-t1-revoked-by-recovery');
    assert.equal(store.get('pzp_auth_session_token_id'), '41');

    deliverEarlyStartedLateServer();
    const earlyResult = await earlyStartedRefresh;
    assert.equal(earlyResult.outcome, 'success');
    assert.equal(store.get('pzp_token'), 'synthetic-t2-access');
    assert.equal(store.get('pzp_access_token'), 'synthetic-t2-access');
    assert.equal(store.get('pzp_refresh_token'), 'synthetic-t2-active');
    assert.equal(store.get('pzp_auth_session_token_id'), '42');
});

test('R2 gate: older server rotation cannot overwrite newer storage when client timestamps tie', async () => {
    const user = { id: 14, username: 'synthetic.qa', role: 'animator' };
    const store = new Map(Object.entries({
        pzp_token: 'synthetic-expired',
        pzp_access_token: 'synthetic-expired',
        pzp_refresh_token: 'synthetic-old',
        pzp_auth_session_generation: 'synthetic-generation',
        pzp_auth_session_token_id: '40',
        pzp_current_user: JSON.stringify(user)
    }));
    const timers = [];
    let deliverOlder;
    let deliverNewer;

    const olderServerTab = createApiRealm({
        store,
        timers,
        fetchImpl: () => new Promise(resolve => {
            deliverOlder = () => resolve(response(200, {
                accessToken: 'synthetic-t1-access',
                refreshToken: 'synthetic-t1-revoked-by-recovery',
                sessionTokenId: 41,
                user
            }));
        })
    });
    const newerServerTab = createApiRealm({
        store,
        timers,
        fetchImpl: () => new Promise(resolve => {
            deliverNewer = () => resolve(response(200, {
                accessToken: 'synthetic-t2-access',
                refreshToken: 'synthetic-t2-active',
                sessionTokenId: 42,
                recovered: true,
                user
            }));
        })
    });

    const older = olderServerTab.apiRefreshAuthSession();
    store.delete('pzp_auth_refresh_coordination');
    const newer = newerServerTab.apiRefreshAuthSession();
    await flushMicrotasks();

    deliverNewer();
    const newerResult = await newer;
    assert.equal(newerResult.outcome, 'success');
    assert.equal(store.get('pzp_refresh_token'), 'synthetic-t2-active');
    assert.equal(store.get('pzp_auth_session_token_id'), '42');

    deliverOlder();
    const olderResult = await older;
    assert.equal(olderResult.outcome, 'superseded');
    assert.equal(store.get('pzp_token'), 'synthetic-t2-access');
    assert.equal(store.get('pzp_access_token'), 'synthetic-t2-access');
    assert.equal(store.get('pzp_refresh_token'), 'synthetic-t2-active');
    assert.equal(store.get('pzp_auth_session_token_id'), '42');
});

test('R2 gate: same-user metadata merge must not supersede and revoke a valid refresh response', async () => {
    const user = { id: 14, username: 'synthetic.qa', role: 'animator' };
    const store = new Map(Object.entries({
        pzp_token: 'synthetic-expired',
        pzp_access_token: 'synthetic-expired',
        pzp_refresh_token: 'synthetic-old',
        pzp_auth_session_generation: 'synthetic-generation',
        pzp_auth_session_token_id: '40',
        pzp_current_user: JSON.stringify(user)
    }));
    let deliverRefresh;
    let returnedRefreshRevoked = false;
    const refreshingTab = createApiRealm({
        store,
        fetchImpl: url => {
            if (url === '/api/auth/logout') {
                returnedRefreshRevoked = true;
                return Promise.resolve(response(200, {}));
            }
            return new Promise(resolve => {
                deliverRefresh = () => resolve(response(200, {
                    accessToken: 'synthetic-new',
                    refreshToken: 'synthetic-rotated',
                    sessionTokenId: 41,
                    user
                }));
            });
        }
    });
    const mergingTab = createApiRealm({
        store,
        fetchImpl: async () => response(500, {})
    });

    const pendingRefresh = refreshingTab.apiRefreshAuthSession();
    const merged = mergingTab.mergeApiCurrentUser({ ...user, name: 'Synthetic QA' });
    deliverRefresh();
    const result = await pendingRefresh;

    assert.equal(result.outcome, 'success');
    assert.equal(merged.name, 'Synthetic QA');
    assert.equal(store.get('pzp_auth_transition'), undefined);
    assert.equal(returnedRefreshRevoked, false);
    assert.equal(store.get('pzp_token'), 'synthetic-new');
    assert.equal(store.get('pzp_access_token'), 'synthetic-new');
    assert.equal(store.get('pzp_refresh_token'), 'synthetic-rotated');
    const storedUser = JSON.parse(store.get('pzp_current_user'));
    assert.equal(storedUser.id, user.id);
    assert.equal(storedUser.username, user.username);
    assert.equal(storedUser.role, user.role);
    assert.equal(storedUser.name, 'Synthetic QA');
});
