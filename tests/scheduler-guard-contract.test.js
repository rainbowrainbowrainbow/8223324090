const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let state;
const RealDate = Date;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    ['../db', '../services/schedulerGuard', '../utils/logger'].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function compact(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function installFixedDate(iso) {
    const fixedMs = new RealDate(iso).getTime();
    global.Date = class FixedDate extends RealDate {
        constructor(...args) {
            super(...(args.length ? args : [fixedMs]));
        }

        static now() { return fixedMs; }
        static parse(value) { return RealDate.parse(value); }
        static UTC(...args) { return RealDate.UTC(...args); }
    };
}

function installMutableDate(iso) {
    let currentMs = new RealDate(iso).getTime();
    global.Date = class MutableDate extends RealDate {
        constructor(...args) {
            super(...(args.length ? args : [currentMs]));
        }

        static now() { return currentMs; }
        static parse(value) { return RealDate.parse(value); }
        static UTC(...args) { return RealDate.UTC(...args); }
    };
    return milliseconds => { currentMs += milliseconds; };
}

function restoreDate() {
    global.Date = RealDate;
}

function resetState() {
    state = {
        rows: new Map(), queries: [], claims: [], successWrites: [],
        skippedWrites: [], errorWrites: [], heartbeatWrites: [],
        loggerErrors: [], loggerWarnings: []
    };
}

function normalizeRow(name, row = {}) {
    return {
        scheduler_name: name,
        last_run_date: null,
        last_run_at: null,
        result: null,
        is_paused: false,
        consecutive_failures: 0,
        error_message: null,
        ...row
    };
}

function createFakePool() {
    return {
        async query(sql, params = []) {
            const text = compact(sql);
            state.queries.push({ text, params });

            if (/^SELECT last_run_date, last_run_at, result, is_paused, consecutive_failures/i.test(text)) {
                const row = state.rows.get(params[0]);
                return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
            }

            if (/^WITH claimed AS/i.test(text) && /VALUES \(\$1, NOW\(\), \$2, 'running'/i.test(text)) {
                const [name, currentKey, hasDedup, leaseMs, token] = params;
                const existing = state.rows.get(name);
                const expired = existing?.result === 'running'
                    && Number(existing.last_run_at) <= Date.now() - leaseMs;
                const canClaim = !existing || (
                    !existing.is_paused && (
                        existing.result === 'error'
                        || existing.result === 'skipped'
                        || expired
                        || (hasDedup && existing.result !== 'running' && existing.last_run_date !== currentKey)
                        || (!hasDedup && existing.result !== 'running')
                    )
                );
                if (!canClaim) {
                    return {
                        rows: existing ? [{ ...existing, claim_acquired: false }] : [],
                        rowCount: existing ? 1 : 0
                    };
                }

                const claimed = normalizeRow(name, {
                    ...existing,
                    last_run_at: Date.now(),
                    last_run_date: currentKey,
                    result: 'running',
                    error_message: token
                });
                state.rows.set(name, claimed);
                state.claims.push({ text, params });
                return { rows: [{ ...claimed, claim_acquired: true }], rowCount: 1 };
            }

            if (/^UPDATE scheduler_executions SET last_run_at = NOW\(\) WHERE/i.test(text)) {
                const [name, token] = params;
                const row = state.rows.get(name);
                const owned = row?.result === 'running' && row.error_message === token;
                if (owned) row.last_run_at = Date.now();
                state.heartbeatWrites.push({ text, params });
                return { rows: [], rowCount: owned ? 1 : 0 };
            }

            if (/^UPDATE scheduler_executions SET last_run_at = NOW\(\), last_run_date = \$3, result = 'success'/i.test(text)) {
                const [name, token, dateKey] = params;
                const row = state.rows.get(name);
                const owned = row?.result === 'running' && row.error_message === token;
                if (owned) {
                    Object.assign(row, {
                        last_run_at: Date.now(), last_run_date: dateKey, result: 'success',
                        consecutive_failures: 0, is_paused: false, error_message: null
                    });
                }
                state.successWrites.push({ text, params });
                return { rows: owned ? [{ scheduler_name: name }] : [], rowCount: owned ? 1 : 0 };
            }

            if (/^UPDATE scheduler_executions SET last_run_at = NOW\(\), last_run_date = NULL, result = 'skipped'/i.test(text)) {
                const [name, token] = params;
                const row = state.rows.get(name);
                const owned = row?.result === 'running' && row.error_message === token;
                if (owned) Object.assign(row, { last_run_date: null, result: 'skipped', error_message: null });
                state.skippedWrites.push({ text, params });
                return { rows: [], rowCount: owned ? 1 : 0 };
            }

            if (/^UPDATE scheduler_executions SET last_run_at = NOW\(\), result = 'error'/i.test(text)) {
                const [name, token, message, , autoPause] = params;
                const row = state.rows.get(name);
                const owned = row?.result === 'running' && row.error_message === token;
                if (!owned) return { rows: [], rowCount: 0 };
                const consecutiveFailures = row.consecutive_failures + 1;
                Object.assign(row, {
                    last_run_at: Date.now(), result: 'error',
                    consecutive_failures: consecutiveFailures,
                    is_paused: row.is_paused || (autoPause && consecutiveFailures >= 10),
                    error_message: message
                });
                state.errorWrites.push({ text, params });
                return {
                    rows: [{ consecutive_failures: consecutiveFailures, is_paused: row.is_paused }],
                    rowCount: 1
                };
            }

            if (/^INSERT INTO scheduler_executions/i.test(text) && /VALUES \(\$1, NOW\(\), \$2, 'success'/i.test(text)) {
                const [name, dateKey] = params;
                state.rows.set(name, normalizeRow(name, {
                    last_run_at: Date.now(), last_run_date: dateKey, result: 'success'
                }));
                state.successWrites.push({ text, params });
                return { rows: [], rowCount: 1 };
            }

            if (/^INSERT INTO scheduler_executions/i.test(text) && /VALUES \(\$1, NOW\(\), 'error'/i.test(text)) {
                const [name, message, , autoPause] = params;
                const row = normalizeRow(name, state.rows.get(name));
                row.consecutive_failures += 1;
                row.result = 'error';
                row.error_message = message;
                row.is_paused ||= autoPause && row.consecutive_failures >= 10;
                state.rows.set(name, row);
                state.errorWrites.push({ text, params });
                return {
                    rows: [{ consecutive_failures: row.consecutive_failures, is_paused: row.is_paused }],
                    rowCount: 1
                };
            }

            throw new Error(`Unexpected scheduler guard query: ${text}`);
        }
    };
}

function loadGuard() {
    clearModules();
    installMock('../db', { pool: createFakePool() });
    installMock('../utils/logger', {
        createLogger: () => ({
            error: (...args) => state.loggerErrors.push(args),
            info: () => {},
            warn: (...args) => state.loggerWarnings.push(args)
        })
    });
    return require('../services/schedulerGuard');
}

describe('schedulerGuard atomic claim contract', () => {
    beforeEach(() => {
        resetState();
        installFixedDate('2026-06-28T12:07:30.000Z');
    });

    afterEach(() => {
        restoreDate();
        clearModules();
    });

    it('allows only one side-effect claimant across concurrent wrappers', async () => {
        const { guardScheduler } = loadGuard();
        let calls = 0;
        const job = async () => { calls += 1; };

        await Promise.all([
            guardScheduler('raceJob', job, { dedup: 'daily' })(),
            guardScheduler('raceJob', job, { dedup: 'daily' })()
        ]);

        assert.equal(calls, 1);
        assert.equal(state.claims.length, 1);
        assert.equal(state.successWrites.length, 1);
        assert.equal(state.rows.get('raceJob').result, 'success');
    });

    it('skips successful daily, hourly, and 5min periods', async () => {
        const { guardScheduler } = loadGuard();
        const cases = [
            ['dailyJob', 'daily', '2026-06-28'],
            ['hourlyJob', 'hourly', '2026-06-28T15'],
            ['fiveMinJob', '5min', '2026-06-28T15:05']
        ];
        let calls = 0;
        for (const [name, dedup, key] of cases) {
            state.rows.set(name, normalizeRow(name, { last_run_date: key, result: 'success' }));
            await guardScheduler(name, async () => { calls += 1; }, { dedup })();
        }

        assert.equal(calls, 0);
        assert.equal(state.claims.length, 0);
    });

    it('stores Kyiv period keys for daily, hourly, and 5min executions', async () => {
        const { guardScheduler } = loadGuard();
        const cases = [
            ['dailyJob', 'daily', '2026-06-28'],
            ['hourlyJob', 'hourly', '2026-06-28T15'],
            ['fiveMinJob', '5min', '2026-06-28T15:05']
        ];
        for (const [name, dedup, expected] of cases) {
            await guardScheduler(name, async () => {}, { dedup })();
            assert.equal(state.rows.get(name).last_run_date, expected);
        }
    });

    it('runs null-dedup jobs on every completed call', async () => {
        const { guardScheduler } = loadGuard();
        let calls = 0;
        const guarded = guardScheduler('pollingJob', async () => { calls += 1; }, { dedup: null });

        await guarded();
        await guarded();

        assert.equal(calls, 2);
        assert.equal(state.claims.length, 2);
        assert.equal(state.successWrites.length, 2);
    });

    it('releases polling no-ops without marking success', async () => {
        const { guardScheduler, skipSchedulerTracking } = loadGuard();

        await guardScheduler('pollingJob', async () => skipSchedulerTracking(), { dedup: null })();

        assert.equal(state.successWrites.length, 0);
        assert.equal(state.skippedWrites.length, 1);
        assert.equal(state.rows.get('pollingJob').result, 'skipped');
    });

    it('does not claim paused scheduler rows', async () => {
        state.rows.set('pausedJob', normalizeRow('pausedJob', {
            last_run_date: '2026-06-27', result: 'error', is_paused: true, consecutive_failures: 10
        }));
        const { guardScheduler } = loadGuard();
        let calls = 0;

        await guardScheduler('pausedJob', async () => { calls += 1; }, { dedup: 'daily' })();

        assert.equal(calls, 0);
        assert.equal(state.claims.length, 0);
    });

    it('releases an errored claim for retry and preserves failure count', async () => {
        const { guardScheduler } = loadGuard();
        let calls = 0;
        const guarded = guardScheduler('retryJob', async () => {
            calls += 1;
            if (calls === 1) throw new Error('planned failure');
        }, { dedup: 'daily' });

        await assert.doesNotReject(guarded());
        assert.equal(state.rows.get('retryJob').result, 'error');
        assert.equal(state.rows.get('retryJob').consecutive_failures, 1);

        await guarded();
        assert.equal(calls, 2);
        assert.equal(state.rows.get('retryJob').result, 'success');
        assert.equal(state.rows.get('retryJob').consecutive_failures, 0);
    });

    it('auto-pauses on the tenth failure and respects autoPause false', async () => {
        const { guardScheduler } = loadGuard();
        state.rows.set('pauseJob', normalizeRow('pauseJob', { result: 'error', consecutive_failures: 9 }));
        state.rows.set('noPauseJob', normalizeRow('noPauseJob', { result: 'error', consecutive_failures: 9 }));

        await guardScheduler('pauseJob', async () => { throw new Error('failure'); }, { dedup: null })();
        await guardScheduler('noPauseJob', async () => { throw new Error('failure'); }, { dedup: null, autoPause: false })();

        assert.equal(state.rows.get('pauseJob').is_paused, true);
        assert.equal(state.rows.get('noPauseJob').is_paused, false);
    });

    it('recovers a claim after its lease expires', async () => {
        const { guardScheduler } = loadGuard();
        state.rows.set('crashedJob', normalizeRow('crashedJob', {
            last_run_date: '2026-06-28',
            last_run_at: Date.now() - 101,
            result: 'running',
            error_message: 'claim:dead-process'
        }));
        let calls = 0;

        await guardScheduler('crashedJob', async () => { calls += 1; }, {
            dedup: 'daily', leaseMs: 100, heartbeatMs: 100
        })();

        assert.equal(calls, 1);
        assert.equal(state.rows.get('crashedJob').result, 'success');
    });

    it('leaves active long-running claims to their current owner', async () => {
        const { guardScheduler } = loadGuard();
        state.rows.set('activeJob', normalizeRow('activeJob', {
            last_run_date: '2026-06-28',
            last_run_at: Date.now() - 99,
            result: 'running',
            error_message: 'claim:live-process'
        }));
        let calls = 0;

        await guardScheduler('activeJob', async () => { calls += 1; }, {
            dedup: 'daily', leaseMs: 100, heartbeatMs: 100
        })();

        assert.equal(calls, 0);
        assert.equal(state.rows.get('activeJob').error_message, 'claim:live-process');
    });

    it('keeps owner-managed jobs on their existing concurrency mechanism', async () => {
        state.rows.set('checkScheduledChatMessages', normalizeRow('checkScheduledChatMessages', { result: 'success' }));
        const { guardScheduler } = loadGuard();
        let calls = 0;

        await guardScheduler('checkScheduledChatMessages', async () => { calls += 1; }, { dedup: null })();

        assert.equal(calls, 1);
        assert.equal(state.claims.length, 0);
        assert.equal(state.successWrites.length, 1);
    });

    it('uses a constant daily query budget across repeated minute ticks', async () => {
        const { guardScheduler } = loadGuard();
        let calls = 0;
        const guarded = guardScheduler('dailyBudgetJob', async () => { calls += 1; }, { dedup: 'daily' });

        for (let index = 0; index < 1_440; index += 1) await guarded();

        assert.equal(calls, 1);
        assert.equal(state.queries.length, 2, 'one atomic claim plus one completion write');
    });

    it('checks PostgreSQL once when another instance already completed the period', async () => {
        state.rows.set('completedElsewhereJob', normalizeRow('completedElsewhereJob', {
            last_run_date: '2026-06-28', result: 'success'
        }));
        const { guardScheduler } = loadGuard();
        let calls = 0;
        const guarded = guardScheduler('completedElsewhereJob', async () => { calls += 1; }, { dedup: 'daily' });

        for (let index = 0; index < 1_440; index += 1) await guarded();

        assert.equal(calls, 0);
        assert.equal(state.queries.length, 1);
    });

    it('queries only at hourly and 5min bucket boundaries', async () => {
        const advance = installMutableDate('2026-06-28T12:00:00.000Z');
        const { guardScheduler } = loadGuard();
        let hourlyCalls = 0;
        let fiveMinuteCalls = 0;
        const hourly = guardScheduler('hourlyBudgetJob', async () => { hourlyCalls += 1; }, { dedup: 'hourly' });
        const fiveMinute = guardScheduler('fiveMinuteBudgetJob', async () => { fiveMinuteCalls += 1; }, { dedup: '5min' });

        for (let minute = 0; minute < 120; minute += 1) {
            await hourly();
            await fiveMinute();
            advance(60_000);
        }

        assert.equal(hourlyCalls, 2);
        assert.equal(fiveMinuteCalls, 24);
        assert.equal(state.queries.length, (2 * 2) + (24 * 2));
    });

    it('does not cache null-dedup polling cadence', async () => {
        const { guardScheduler } = loadGuard();
        let calls = 0;
        const guarded = guardScheduler('nullBudgetJob', async () => { calls += 1; }, { dedup: null });

        for (let index = 0; index < 10; index += 1) await guarded();

        assert.equal(calls, 10);
        assert.equal(state.queries.length, 20);
    });

    it('rejects unsupported dedup and claim modes before execution', () => {
        const { guardScheduler } = loadGuard();
        assert.throws(() => guardScheduler('badDedup', async () => {}, { dedup: 'invalid' }), /Unsupported scheduler dedup/);
        assert.throws(() => guardScheduler('badClaim', async () => {}, { claimMode: 'invalid' }), /Unsupported scheduler claim mode/);
        assert.equal(state.queries.length, 0);
    });
});

describe('scheduler execution policy', () => {
    it('classifies every guarded registration and isolates owner-managed claims', () => {
        const {
            GUARDED_SCHEDULER_JOBS,
            OWNER_MANAGED_SCHEDULER_CLAIMS,
            schedulerExecutionPolicy
        } = require('../config/schedulerSurface');

        assert.equal(GUARDED_SCHEDULER_JOBS.length, 54);
        assert.equal(Object.keys(OWNER_MANAGED_SCHEDULER_CLAIMS).length, 6);
        for (const job of GUARDED_SCHEDULER_JOBS) {
            const policy = schedulerExecutionPolicy(job.name);
            assert.ok(['lease', 'owner'].includes(policy.claimMode), job.name);
            assert.ok(policy.leaseMs >= 5 * 60 * 1000, job.name);
        }
        for (const name of Object.keys(OWNER_MANAGED_SCHEDULER_CLAIMS)) {
            assert.equal(schedulerExecutionPolicy(name).claimMode, 'owner', name);
        }
    });
});
