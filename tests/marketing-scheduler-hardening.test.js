const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let state;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../lib/social-publishers',
        '../lib/marketing-agent',
        '../utils/logger'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function resetState() {
    state = {
        logs: [],
        dbQueries: 0,
        publisherCalls: 0
    };
}

function createGate() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
}

function loadAgent() {
    clearModules();
    installMock('../db', {
        pool: {
            query: async () => {
                state.dbQueries += 1;
                throw new Error('Unexpected DB access in marketing scheduler test');
            }
        }
    });
    installMock('../lib/social-publishers', {
        getPublisher: () => {
            state.publisherCalls += 1;
            throw new Error('Unexpected publisher access in marketing scheduler test');
        }
    });
    installMock('../utils/logger', {
        createLogger: name => ({
            info: (...args) => state.logs.push({ level: 'info', name, args }),
            warn: (...args) => state.logs.push({ level: 'warn', name, args }),
            error: (...args) => state.logs.push({ level: 'error', name, args })
        })
    });
    return require('../lib/marketing-agent');
}

describe('marketing raw scheduler hardening', () => {
    beforeEach(resetState);

    afterEach(() => {
        clearModules();
    });

    it('runs scheduled publish through injected scheduler dependency without external access', async () => {
        const { runMarketingScheduledPublish } = loadAgent();
        const calls = [];

        const result = await runMarketingScheduledPublish({
            publishScheduled: async () => {
                calls.push('publish');
                return [{ postId: 101, success: true }];
            }
        });

        assert.deepEqual(result, {
            skipped: false,
            results: [{ postId: 101, success: true }],
            count: 1
        });
        assert.deepEqual(calls, ['publish']);
        assert.equal(state.dbQueries, 0);
        assert.equal(state.publisherCalls, 0);
    });

    it('skips overlapping scheduled publish runs inside one process', async () => {
        const { runMarketingScheduledPublish } = loadAgent();
        const gate = createGate();
        let started;
        const startedPromise = new Promise(resolve => { started = resolve; });

        const first = runMarketingScheduledPublish({
            publishScheduled: async () => {
                started();
                await gate.promise;
                return [{ postId: 201, success: true }];
            }
        });
        await startedPromise;

        const second = await runMarketingScheduledPublish({
            publishScheduled: async () => {
                throw new Error('overlap should not publish');
            }
        });

        assert.deepEqual(second, { skipped: true, reason: 'overlap', results: [], count: 0 });
        gate.release();
        assert.deepEqual(await first, {
            skipped: false,
            results: [{ postId: 201, success: true }],
            count: 1
        });
    });

    it('resets scheduled publish guard after errors', async () => {
        const { runMarketingScheduledPublish } = loadAgent();

        await assert.rejects(
            () => runMarketingScheduledPublish({
                publishScheduled: async () => {
                    throw new Error('planned publish failure');
                }
            }),
            /planned publish failure/
        );

        const recovered = await runMarketingScheduledPublish({
            publishScheduled: async () => [{ postId: 301, success: true }]
        });

        assert.equal(recovered.skipped, false);
        assert.equal(recovered.count, 1);
    });

    it('skips weekly plan generation outside the Wednesday 08:00 UTC window', async () => {
        const { runMarketingWeeklyPlanScheduler } = loadAgent();
        let calls = 0;

        const wrongDay = await runMarketingWeeklyPlanScheduler({
            now: new Date('2026-07-02T08:00:00.000Z'),
            generateWeeklyPlan: async () => {
                calls += 1;
                return [];
            }
        });
        const wrongTime = await runMarketingWeeklyPlanScheduler({
            now: new Date('2026-07-01T08:06:00.000Z'),
            generateWeeklyPlan: async () => {
                calls += 1;
                return [];
            }
        });

        assert.deepEqual(wrongDay, { skipped: true, reason: 'not_wednesday' });
        assert.deepEqual(wrongTime, { skipped: true, reason: 'outside_window' });
        assert.equal(calls, 0);
    });

    it('generates one weekly plan per in-memory UTC day with expected defaults', async () => {
        const { runMarketingWeeklyPlanScheduler } = loadAgent();
        const calls = [];

        const first = await runMarketingWeeklyPlanScheduler({
            now: new Date('2026-07-01T08:00:00.000Z'),
            generateWeeklyPlan: async (...args) => {
                calls.push(args);
                return [{ id: 1 }, { id: 2 }];
            }
        });
        const second = await runMarketingWeeklyPlanScheduler({
            now: new Date('2026-07-01T08:01:00.000Z'),
            generateWeeklyPlan: async (...args) => {
                calls.push(args);
                return [];
            }
        });

        assert.equal(first.skipped, false);
        assert.equal(first.count, 2);
        assert.equal(first.weekNumber, 28);
        assert.equal(first.year, 2026);
        assert.deepEqual(calls, [[
            28,
            2026,
            ['instagram', 'telegram'],
            ['animation', 'quest', 'birthday', 'show', 'masterclass'],
            null
        ]]);
        assert.deepEqual(second, {
            skipped: true,
            reason: 'already_ran_today',
            date: '2026-07-01'
        });
    });

    it('does not mark weekly generation as completed when generation fails', async () => {
        const { runMarketingWeeklyPlanScheduler } = loadAgent();
        let calls = 0;

        await assert.rejects(
            () => runMarketingWeeklyPlanScheduler({
                now: new Date('2026-07-01T08:00:00.000Z'),
                generateWeeklyPlan: async () => {
                    calls += 1;
                    throw new Error('planned weekly failure');
                }
            }),
            /planned weekly failure/
        );

        const recovered = await runMarketingWeeklyPlanScheduler({
            now: new Date('2026-07-01T08:01:00.000Z'),
            generateWeeklyPlan: async () => {
                calls += 1;
                return [{ id: 9 }];
            }
        });

        assert.equal(calls, 2);
        assert.equal(recovered.skipped, false);
        assert.equal(recovered.count, 1);
    });

    it('skips overlapping weekly plan generation inside one process', async () => {
        const { runMarketingWeeklyPlanScheduler } = loadAgent();
        const gate = createGate();
        let started;
        const startedPromise = new Promise(resolve => { started = resolve; });

        const first = runMarketingWeeklyPlanScheduler({
            now: new Date('2026-07-01T08:00:00.000Z'),
            generateWeeklyPlan: async () => {
                started();
                await gate.promise;
                return [{ id: 11 }];
            }
        });
        await startedPromise;

        const second = await runMarketingWeeklyPlanScheduler({
            now: new Date('2026-07-01T08:00:30.000Z'),
            generateWeeklyPlan: async () => {
                throw new Error('overlap should not generate');
            }
        });

        assert.deepEqual(second, { skipped: true, reason: 'overlap' });
        gate.release();
        assert.equal((await first).count, 1);
    });

    it('keeps marketing scheduler intervals unchanged in server.js', () => {
        const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

        assert.match(server, /runMarketingScheduledPublish/);
        assert.match(server, /await runMarketingScheduledPublish\(\);/);
        assert.match(server, /5 \* 60 \* 1000/);
        assert.match(server, /await runMarketingWeeklyPlanScheduler\(\);/);
        assert.match(server, /60 \* 1000/);
        assert.doesNotMatch(server, /lastWeeklyGenDate/);
    });
});
