'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    decodeCompletionHistoryCursor,
    listTaskCompletionHistory,
    normalizeCompletionHistoryLimit
} = require('../services/taskCompletionHistory');

const ROOT = path.resolve(__dirname, '..');
const USER = { id: 7, username: 'serhiy', name: 'Serhiy', role: 'creator' };
const BUSINESS_SCOPE = {
    mode: 'single',
    activeContext: 'event_genix',
    selectedContexts: ['event_genix']
};

function completionRows(count, options = {}) {
    const sameTimestampEvery = Number(options.sameTimestampEvery || 0);
    return Array.from({ length: count }, (_, index) => {
        const bucket = sameTimestampEvery > 0 ? Math.floor(index / sameTimestampEvery) : index;
        const completed = new Date(Date.UTC(2026, 7, 14, 12, 0, 0) - bucket * 60_000).toISOString();
        return {
            id: 5000 - index,
            title: `Done parent ${index + 1}`,
            status: 'done',
            completed_at: completed,
            updated_at: completed,
            created_at: completed,
            owner_user_id: USER.id,
            assigned_to: USER.username,
            owner: USER.name,
            business_context: BUSINESS_SCOPE.activeContext,
            subtasks: [{ id: 9000 + index, title: 'Done subtask', is_done: true }],
            subtask_count: 1,
            subtask_done_count: 1
        };
    });
}

function effectiveTimestamp(row) {
    return new Date(row.completed_at || row.updated_at || row.created_at).getTime();
}

function makeCompletionHistoryPool(rows, options = {}) {
    const calls = [];
    const businessContext = options.businessContext || BUSINESS_SCOPE.activeContext;
    const ownerUserId = Number(options.ownerUserId || USER.id);
    const scopedRows = rows
        .filter(row => Number(row.owner_user_id) === ownerUserId)
        .filter(row => String(row.business_context || 'event_genix') === businessContext)
        .sort((a, b) => {
            const tsDelta = effectiveTimestamp(b) - effectiveTimestamp(a);
            return tsDelta || Number(b.id) - Number(a.id);
        });
    return {
        calls,
        async query(text, params = []) {
            calls.push({ text, params });
            if (/SELECT t\.\*, u\.name AS owner_name/.test(text) && /COALESCE\(t\.status, 'todo'\) = 'done'/.test(text)) {
                const limit = Number(params.at(-1));
                let filtered = scopedRows;
                if (/t\.id < \$\d+/.test(text)) {
                    const cursorTimestamp = new Date(params.at(-3)).getTime();
                    const cursorId = Number(params.at(-2));
                    filtered = filtered.filter(row => {
                        const ts = effectiveTimestamp(row);
                        return ts < cursorTimestamp || (ts === cursorTimestamp && Number(row.id) < cursorId);
                    });
                }
                return { rows: filtered.slice(0, limit) };
            }
            if (/SELECT COUNT\(\*\)::int AS completed_parent_total/.test(text)) {
                return { rows: [{ completed_parent_total: scopedRows.length }] };
            }
            if (/FROM unnest\(\$2::int\[\]\)/.test(text)) {
                return {
                    rows: (params[1] || []).map(taskId => ({
                        task_id: taskId,
                        direction_id: null,
                        impacts: [{ id: 9, name: 'CRM', color: '#0EA5E9', icon: 'crm', isActive: true }]
                    }))
                };
            }
            if (/FROM task_dependencies d/.test(text)) return { rows: [] };
            if (/actual_seconds_today/.test(text)) return { rows: [] };
            if (/AS actual_seconds/.test(text)) {
                return { rows: (params[1] || []).map(taskId => ({ task_id: taskId, actual_seconds: 60 })) };
            }
            return { rows: [] };
        }
    };
}

test('completion history route is additive and mounted before the legacy my-cabinet projection', () => {
    const routeSource = fs.readFileSync(path.join(ROOT, 'routes', 'tasks.js'), 'utf8');
    const serviceSource = fs.readFileSync(path.join(ROOT, 'services', 'taskCompletionHistory.js'), 'utf8');
    const completionRouteIndex = routeSource.indexOf("router.get('/my-cabinet/completions'");
    const cabinetRouteIndex = routeSource.indexOf("router.get('/my-cabinet'");

    assert.ok(completionRouteIndex > -1, 'completion history route should be registered');
    assert.ok(cabinetRouteIndex > -1, 'legacy my-cabinet route should remain registered');
    assert.ok(completionRouteIndex < cabinetRouteIndex, 'completion history route should be mounted before /my-cabinet');
    assert.match(routeSource, /period !== 'history'/);
    assert.match(routeSource, /listTaskCompletionHistory\(pool, \{\s*user: req\.user,\s*businessScope/s);
    assert.match(serviceSource, /Buffer\.from\(JSON\.stringify/);
    assert.match(serviceSource, /\.toString\('base64url'\)/);
    assert.match(serviceSource, /Invalid completion history cursor/);
});

test('completion history uses keyset pagination without duplicates across 73 parent tasks', async () => {
    const pool = makeCompletionHistoryPool(completionRows(73, { sameTimestampEvery: 5 }));
    const seenIds = [];
    let cursor = '';
    let pages = 0;
    do {
        const page = await listTaskCompletionHistory(pool, {
            user: USER,
            businessScope: BUSINESS_SCOPE,
            cursor,
            limit: 36,
            today: '2026-08-14'
        });
        pages += 1;
        seenIds.push(...page.items.map(item => item.id));
        assert.equal(page.success, true);
        assert.equal(page.period, 'history');
        assert.equal(page.pagination.limit, 36);
        assert.equal(page.pagination.returned, page.items.length);
        assert.equal(page.totals.completedParentTotal, 73);
        cursor = page.pagination.nextCursor || '';
        if (page.pagination.hasMore) assert.ok(cursor, 'page with more rows should expose nextCursor');
    } while (cursor);

    assert.equal(pages, 3);
    assert.equal(seenIds.length, 73);
    assert.equal(new Set(seenIds).size, 73);
    assert.deepEqual(seenIds.slice(0, 7), [5000, 4999, 4998, 4997, 4996, 4995, 4994]);
    assert.equal(pool.calls.filter(call => /SELECT t\.\*, u\.name AS owner_name/.test(call.text)).length, 3);
});

test('completion history cursor validates payload and uses timestamp plus id tie-breaker', async () => {
    const pool = makeCompletionHistoryPool(completionRows(37, { sameTimestampEvery: 37 }));
    const first = await listTaskCompletionHistory(pool, {
        user: USER,
        businessScope: BUSINESS_SCOPE,
        limit: 36,
        today: '2026-08-14'
    });
    const decoded = decodeCompletionHistoryCursor(first.pagination.nextCursor);
    const second = await listTaskCompletionHistory(pool, {
        user: USER,
        businessScope: BUSINESS_SCOPE,
        cursor: first.pagination.nextCursor,
        limit: 36,
        today: '2026-08-14'
    });

    assert.equal(decoded.id, 4965);
    assert.equal(second.items.length, 1);
    assert.equal(second.items[0].id, 4964);
    assert.equal(second.pagination.hasMore, false);
    await assert.rejects(
        () => listTaskCompletionHistory(pool, {
            user: USER,
            businessScope: BUSINESS_SCOPE,
            cursor: 'not-a-valid-cursor',
            today: '2026-08-14'
        }),
        error => error.statusCode === 400 && error.code === 'TASK_COMPLETION_HISTORY_CURSOR_INVALID'
    );
});

test('completion history keeps owner and business scope on every cursor page', async () => {
    const rows = completionRows(40).concat(completionRows(10).map(row => ({
        ...row,
        id: row.id - 1000,
        owner_user_id: 99,
        assigned_to: 'other',
        owner: 'Other'
    })));
    const firstPool = makeCompletionHistoryPool(rows);
    const first = await listTaskCompletionHistory(firstPool, {
        user: USER,
        businessScope: BUSINESS_SCOPE,
        limit: 36,
        today: '2026-08-14'
    });
    const otherUserPool = makeCompletionHistoryPool(rows, { ownerUserId: 99 });
    const second = await listTaskCompletionHistory(otherUserPool, {
        user: { id: 99, username: 'other', name: 'Other', role: 'user' },
        businessScope: BUSINESS_SCOPE,
        cursor: first.pagination.nextCursor,
        limit: 36,
        today: '2026-08-14'
    });
    const pageCalls = firstPool.calls.filter(call => /SELECT t\.\*, u\.name AS owner_name/.test(call.text));
    const firstPageCall = pageCalls[0];

    assert.deepEqual(firstPageCall.params.slice(0, 4), ['serhiy', 'Serhiy', 7, 'event_genix']);
    assert.match(firstPageCall.text, /t\.owner_user_id = \$\d+/);
    assert.match(firstPageCall.text, /COALESCE\(t\.business_context, 'event_genix'\) = \$\d+/);
    assert.equal(second.items.length, 0);
    assert.equal(second.totals.completedParentTotal, 10);
});

test('completion history limit defaults to 36 and caps at 100', () => {
    assert.equal(normalizeCompletionHistoryLimit(undefined), 36);
    assert.equal(normalizeCompletionHistoryLimit('bad'), 36);
    assert.equal(normalizeCompletionHistoryLimit(12), 12);
    assert.equal(normalizeCompletionHistoryLimit(500), 100);
});
