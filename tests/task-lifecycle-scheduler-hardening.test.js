const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeBusinessContext } = require('../services/businessContext');

let state;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/taskLifecycle',
        '../utils/logger'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function compact(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function resetState() {
    state = {
        logs: [],
        tasks: [],
        queries: [],
        updates: [],
        archives: [],
        failSelect: false
    };
}

function makeTask(overrides = {}) {
    return {
        id: overrides.id ?? 1,
        title: overrides.title || `Task ${overrides.id ?? 1}`,
        date: overrides.date || '2026-06-28',
        status: overrides.status || 'new',
        priority: overrides.priority || 'normal',
        updated_at: overrides.updated_at || '2026-06-28T10:00:00.000Z',
        created_at: overrides.created_at || '2026-06-28T09:00:00.000Z',
        last_activity_at: overrides.last_activity_at ?? overrides.updated_at ?? '2026-06-28T10:00:00.000Z',
        business_context: overrides.business_context || 'park',
        archived_at: overrides.archived_at ?? null,
        health_score: overrides.health_score ?? null
    };
}

function createGate() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
}

function createQuery(options = {}) {
    return async (sql, params = []) => {
        const text = compact(sql);
        state.queries.push({ text, params });

        if (/^SELECT id, title, date, status, priority, updated_at, created_at, last_activity_at, business_context FROM tasks/i.test(text)) {
            if (state.failSelect) throw new Error('planned lifecycle failure');
            if (options.blockSelectOnce && !options._blocked) {
                options._blocked = true;
                options.onSelectStarted?.();
                await options.blockSelectOnce.promise;
            }
            const rows = state.tasks
                .filter(task => !['done', 'cancelled', 'archived'].includes(task.status))
                .filter(task => task.archived_at == null)
                .map(task => ({ ...task }));
            return { rows, rowCount: rows.length };
        }

        if (/^UPDATE tasks SET status = 'archived'/i.test(text)) {
            const [id, businessContext] = params;
            const task = state.tasks.find(item => item.id === id && normalizeBusinessContext(item.business_context || 'event_genix') === businessContext);
            if (task) {
                task.status = 'archived';
                task.archived_at = 'now';
                task.archive_reason = 'auto_expired';
                task.health_score = 0;
            }
            state.archives.push({ id, businessContext, text });
            return { rows: [], rowCount: task ? 1 : 0 };
        }

        if (/^UPDATE tasks SET health_score = \$1 WHERE id = \$2/i.test(text)) {
            const [score, id, businessContext] = params;
            const task = state.tasks.find(item => item.id === id && normalizeBusinessContext(item.business_context || 'event_genix') === businessContext);
            if (task) task.health_score = score;
            state.updates.push({ id, score, businessContext, text });
            return { rows: [], rowCount: task ? 1 : 0 };
        }

        throw new Error(`Unexpected task lifecycle query: ${text}`);
    };
}

function loadLifecycle() {
    clearModules();
    installMock('../db', {
        pool: {
            query: async () => {
                throw new Error('Unexpected real DB query in task lifecycle scheduler test');
            }
        }
    });
    installMock('../utils/logger', {
        createLogger: name => ({
            info: (...args) => state.logs.push({ level: 'info', name, args }),
            warn: (...args) => state.logs.push({ level: 'warn', name, args }),
            error: (...args) => state.logs.push({ level: 'error', name, args })
        })
    });
    return require('../services/taskLifecycle');
}

describe('task lifecycle raw scheduler hardening', () => {
    beforeEach(resetState);

    afterEach(() => {
        clearModules();
    });

    it('exits cleanly when there are no eligible tasks', async () => {
        const { runTaskLifecycle } = loadLifecycle();

        const result = await runTaskLifecycle({
            query: createQuery(),
            now: new Date('2026-06-28T12:00:00.000Z')
        });

        assert.deepEqual(result, { skipped: false, checked: 0, updated: 0, archived: 0 });
        assert.equal(state.queries.length, 1);
        assert.equal(state.updates.length, 0);
        assert.equal(state.archives.length, 0);
    });

    it('updates health score for an eligible active task', async () => {
        state.tasks.push(makeTask({
            id: 11,
            date: '2026-06-28',
            updated_at: '2026-06-28T10:00:00.000Z',
            business_context: 'park'
        }));
        const { runTaskLifecycle } = loadLifecycle();

        const result = await runTaskLifecycle({
            query: createQuery(),
            now: new Date('2026-06-28T12:00:00.000Z')
        });

        assert.deepEqual(result, { skipped: false, checked: 1, updated: 1, archived: 0 });
        assert.deepEqual(state.updates, [{ id: 11, score: 100, businessContext: 'event_genix', text: state.updates[0].text }]);
        assert.equal(state.archives.length, 0);
        assert.equal(state.tasks[0].health_score, 100);
    });

    it('auto-archives a task whose health score reaches zero', async () => {
        state.tasks.push(makeTask({
            id: 22,
            date: '2026-05-01',
            updated_at: '2026-05-01T09:00:00.000Z',
            last_activity_at: '2026-05-01T09:00:00.000Z',
            business_context: 'park'
        }));
        const { runTaskLifecycle } = loadLifecycle();

        const result = await runTaskLifecycle({
            query: createQuery(),
            now: new Date('2026-06-28T12:00:00.000Z')
        });

        assert.deepEqual(result, { skipped: false, checked: 1, updated: 0, archived: 1 });
        assert.equal(state.archives.length, 1);
        assert.equal(state.archives[0].id, 22);
        assert.equal(state.tasks[0].status, 'archived');
        assert.equal(state.tasks[0].archive_reason, 'auto_expired');
    });

    it('is idempotent for archive candidates across repeated lifecycle runs', async () => {
        state.tasks.push(makeTask({
            id: 33,
            date: '2026-05-01',
            updated_at: '2026-05-01T09:00:00.000Z',
            last_activity_at: '2026-05-01T09:00:00.000Z',
            business_context: 'park'
        }));
        const { runTaskLifecycle } = loadLifecycle();
        const query = createQuery();
        const now = new Date('2026-06-28T12:00:00.000Z');

        const first = await runTaskLifecycle({ query, now });
        const second = await runTaskLifecycle({ query, now });

        assert.equal(first.archived, 1);
        assert.equal(second.checked, 0);
        assert.equal(second.archived, 0);
        assert.equal(state.archives.length, 1);
        assert.ok(state.queries.every(queryRecord => !/^INSERT\b/i.test(queryRecord.text)));
    });

    it('skips an overlapping run inside one process', async () => {
        state.tasks.push(makeTask({ id: 44, business_context: 'park' }));
        const gate = createGate();
        let selectStarted;
        const selectStartedPromise = new Promise(resolve => { selectStarted = resolve; });
        const { runTaskLifecycle } = loadLifecycle();

        const first = runTaskLifecycle({
            query: createQuery({ blockSelectOnce: gate, onSelectStarted: selectStarted }),
            now: new Date('2026-06-28T12:00:00.000Z')
        });
        await selectStartedPromise;

        const second = await runTaskLifecycle({
            query: createQuery(),
            now: new Date('2026-06-28T12:00:00.000Z')
        });

        assert.deepEqual(second, { skipped: true, checked: 0, updated: 0, archived: 0 });
        gate.release();
        const firstResult = await first;
        assert.equal(firstResult.updated, 1);
        assert.equal(state.updates.length, 1);
    });

    it('resets the overlap guard after a lifecycle error', async () => {
        state.failSelect = true;
        state.tasks.push(makeTask({ id: 55, business_context: 'park' }));
        const { runTaskLifecycle } = loadLifecycle();

        const failed = await runTaskLifecycle({
            query: createQuery(),
            now: new Date('2026-06-28T12:00:00.000Z')
        });

        assert.deepEqual(failed, { skipped: false, error: 'planned lifecycle failure' });
        state.failSelect = false;
        const recovered = await runTaskLifecycle({
            query: createQuery(),
            now: new Date('2026-06-28T12:00:00.000Z')
        });

        assert.equal(recovered.skipped, false);
        assert.equal(recovered.updated, 1);
    });

    it('keeps startup and daily scheduler timing unchanged in server.js', () => {
        const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

        assert.match(server, /const \{ runTaskLifecycle \} = require\('\.\/services\/taskLifecycle'\);/);
        assert.match(server, /setTimeout\(\(\) => runTaskLifecycle\(\)\.catch\(\(\) => \{\}\), 30000\)/);
        assert.match(server, /setInterval\(\(\) => runTaskLifecycle\(\)\.catch\(\(\) => \{\}\), 24 \* 60 \* 60 \* 1000\)/);
    });

    it('does not add direct Telegram, chat, push, or webhook side effects', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'taskLifecycle.js'), 'utf8');

        assert.doesNotMatch(source, /sendTelegramMessage|telegramRequest|broadcastToChannel|push|webhook/i);
        assert.match(source, /UPDATE tasks SET health_score/);
        assert.match(source, /status = 'archived'/);
    });
});
