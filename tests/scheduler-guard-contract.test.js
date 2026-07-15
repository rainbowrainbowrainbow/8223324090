const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let state;
const RealDate = Date;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/schedulerGuard',
        '../utils/logger'
    ].forEach(modulePath => {
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

        static now() {
            return fixedMs;
        }

        static parse(value) {
            return RealDate.parse(value);
        }

        static UTC(...args) {
            return RealDate.UTC(...args);
        }
    };
}

function restoreDate() {
    global.Date = RealDate;
}

function resetState() {
    state = {
        rows: new Map(),
        queries: [],
        successWrites: [],
        errorWrites: [],
        loggerErrors: []
    };
}

function createFakePool() {
    return {
        async query(sql, params = []) {
            const text = compact(sql);
            state.queries.push({ text, params });

            if (/SELECT last_run_date, is_paused, consecutive_failures FROM scheduler_executions WHERE scheduler_name = \$1/i.test(text)) {
                const row = state.rows.get(params[0]);
                return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
            }

            if (/INSERT INTO scheduler_executions/i.test(text) && /last_run_date/i.test(text)) {
                state.successWrites.push({ text, params });
                state.rows.set(params[0], {
                    scheduler_name: params[0],
                    last_run_date: params[1],
                    is_paused: false,
                    consecutive_failures: 0
                });
                return { rows: [], rowCount: 1 };
            }

            if (/INSERT INTO scheduler_executions/i.test(text) && /error_message/i.test(text)) {
                state.errorWrites.push({ text, params });
                const existing = state.rows.get(params[0]) || {};
                const consecutiveFailures = (existing.consecutive_failures || 0) + 1;
                const isPaused = consecutiveFailures >= 10 || existing.is_paused === true;
                state.rows.set(params[0], {
                    ...existing,
                    scheduler_name: params[0],
                    consecutive_failures: consecutiveFailures,
                    is_paused: isPaused,
                    result: 'error',
                    error_message: params[1]
                });
                return {
                    rows: [{ consecutive_failures: consecutiveFailures, is_paused: isPaused }],
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
            warn: () => {}
        })
    });
    return require('../services/schedulerGuard');
}

describe('schedulerGuard dedup contract', () => {
    beforeEach(() => {
        resetState();
        installFixedDate('2026-06-28T12:07:30.000Z');
    });

    afterEach(() => {
        restoreDate();
        clearModules();
    });

    it('skips daily jobs that already ran today', async () => {
        state.rows.set('dailyJob', { last_run_date: '2026-06-28', is_paused: false, consecutive_failures: 0 });
        const { guardScheduler } = loadGuard();
        let calls = 0;

        await guardScheduler('dailyJob', async () => { calls++; }, { dedup: 'daily' })();

        assert.equal(calls, 0);
        assert.equal(state.successWrites.length, 0);
    });

    it('runs daily jobs on a new day and stores the current day key', async () => {
        state.rows.set('dailyJob', { last_run_date: '2026-06-27', is_paused: false, consecutive_failures: 0 });
        const { guardScheduler } = loadGuard();
        let calls = 0;

        await guardScheduler('dailyJob', async () => { calls++; }, { dedup: 'daily' })();

        assert.equal(calls, 1);
        assert.equal(state.successWrites.length, 1);
        assert.equal(state.successWrites[0].params[1], '2026-06-28');
    });

    it('skips hourly jobs that already ran in the current hour', async () => {
        state.rows.set('hourlyJob', { last_run_date: '2026-06-28T15', is_paused: false, consecutive_failures: 0 });
        const { guardScheduler } = loadGuard();
        let calls = 0;

        await guardScheduler('hourlyJob', async () => { calls++; }, { dedup: 'hourly' })();

        assert.equal(calls, 0);
        assert.equal(state.successWrites.length, 0);
    });

    it('runs hourly jobs in a new hour and stores the current hour key', async () => {
        state.rows.set('hourlyJob', { last_run_date: '2026-06-28T14', is_paused: false, consecutive_failures: 0 });
        const { guardScheduler } = loadGuard();
        let calls = 0;

        await guardScheduler('hourlyJob', async () => { calls++; }, { dedup: 'hourly' })();

        assert.equal(calls, 1);
        assert.equal(state.successWrites.length, 1);
        assert.equal(state.successWrites[0].params[1], '2026-06-28T15');
    });

    it('runs null-dedup jobs every call while still writing tracking rows', async () => {
        state.rows.set('noDedupJob', { last_run_date: '2026-06-28T15:07', is_paused: false, consecutive_failures: 0 });
        const { guardScheduler } = loadGuard();
        let calls = 0;
        const guarded = guardScheduler('noDedupJob', async () => { calls++; }, { dedup: null });

        await guarded();
        await guarded();

        assert.equal(calls, 2);
        assert.equal(state.successWrites.length, 2);
        assert.equal(state.successWrites[0].params[1], '2026-06-28T15:07');
        assert.equal(state.successWrites[1].params[1], '2026-06-28T15:07');
    });

    it('does not record a polling no-op as scheduler success', async () => {
        const { guardScheduler, skipSchedulerTracking } = loadGuard();

        await guardScheduler(
            'pollingJob',
            async () => skipSchedulerTracking(),
            { dedup: null }
        )();

        assert.equal(state.successWrites.length, 0);
        assert.equal(state.errorWrites.length, 0);
    });

    it('skips paused scheduler rows without writing success', async () => {
        state.rows.set('pausedJob', { last_run_date: '2026-06-27', is_paused: true, consecutive_failures: 3 });
        const { guardScheduler } = loadGuard();
        let calls = 0;

        await guardScheduler('pausedJob', async () => { calls++; }, { dedup: 'daily' })();

        assert.equal(calls, 0);
        assert.equal(state.successWrites.length, 0);
        assert.equal(state.errorWrites.length, 0);
    });

    it('tracks failures and swallows job errors', async () => {
        state.rows.set('failingJob', { last_run_date: '2026-06-27', is_paused: false, consecutive_failures: 4 });
        const { guardScheduler } = loadGuard();

        await assert.doesNotReject(
            guardScheduler('failingJob', async () => {
                throw new Error('planned failure');
            }, { dedup: 'daily' })()
        );

        assert.equal(state.successWrites.length, 0);
        assert.equal(state.errorWrites.length, 1);
        assert.equal(state.errorWrites[0].params[0], 'failingJob');
        assert.equal(state.errorWrites[0].params[1], 'planned failure');
        assert.match(state.errorWrites[0].text, /consecutive_failures = scheduler_executions\.consecutive_failures \+ 1/i);
        assert.match(state.errorWrites[0].text, /is_paused = CASE/i);
    });

    it('skips 5min jobs inside the current five-minute bucket', async () => {
        state.rows.set('fiveMinJob', { last_run_date: '2026-06-28T15:05', is_paused: false, consecutive_failures: 0 });
        const { guardScheduler } = loadGuard();
        let calls = 0;

        await guardScheduler('fiveMinJob', async () => { calls++; }, { dedup: '5min' })();

        assert.equal(calls, 0);
        assert.equal(state.successWrites.length, 0);
    });

    it('runs 5min jobs in the next five-minute bucket and stores the bucket key', async () => {
        state.rows.set('fiveMinJob', { last_run_date: '2026-06-28T15:00', is_paused: false, consecutive_failures: 0 });
        const { guardScheduler } = loadGuard();
        let calls = 0;

        await guardScheduler('fiveMinJob', async () => { calls++; }, { dedup: '5min' })();

        assert.equal(calls, 1);
        assert.equal(state.successWrites.length, 1);
        assert.equal(state.successWrites[0].params[1], '2026-06-28T15:05');
    });

    it('rejects unsupported dedup values before a job can run', () => {
        const { guardScheduler } = loadGuard();

        assert.throws(
            () => guardScheduler('badJob', async () => {}, { dedup: 'invalid' }),
            /Unsupported scheduler dedup: invalid/
        );
        assert.equal(state.queries.length, 0);
    });
});
