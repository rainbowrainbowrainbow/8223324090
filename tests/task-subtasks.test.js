const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    hasSubtaskPayload,
    normalizeSubtaskInput,
    normalizeSubtaskReorderIds,
    normalizeSubtasksInput,
    replaceTaskSubtasks,
    reorderTaskSubtasks,
    subtaskCompletionState,
    subtaskPayloadFromBody,
    subtaskProgress
} = require('../services/taskSubtasks');

test('normalizes manual subtask payloads with stable order and source', () => {
    const subtasks = normalizeSubtasksInput([
        { title: '  First part  ', isDone: true, sourceType: 'ai' },
        '',
        { name: 'Second part', sortOrder: 99 },
        { title: '   ' }
    ]);

    assert.equal(subtasks.length, 2);
    assert.deepEqual(subtasks.map(item => item.title), ['First part', 'Second part']);
    assert.deepEqual(subtasks.map(item => item.sort_order), [0, 1]);
    assert.equal(subtasks[0].is_done, true);
    assert.equal(subtasks[0].source_type, 'ai');
    assert.equal(subtasks[1].source_type, 'manual');
});

test('detects accepted API subtask payload names', () => {
    assert.equal(hasSubtaskPayload({ subtasks: [] }), true);
    assert.equal(hasSubtaskPayload({ taskSubtasks: [] }), true);
    assert.equal(hasSubtaskPayload({ task_subtasks: [] }), true);
    assert.equal(hasSubtaskPayload({ title: 'No decomposition' }), false);
    assert.deepEqual(subtaskPayloadFromBody({ taskSubtasks: [{ title: 'A' }] }), [{ title: 'A' }]);
});

test('normalizes subtask reorder payload variants', () => {
    assert.deepEqual(normalizeSubtaskReorderIds({ subtaskIds: ['4', 2, null, 'bad'] }), [4, 2]);
    assert.deepEqual(normalizeSubtaskReorderIds({ subtasks: [{ id: 9 }, { subtaskId: '8' }, { subtask_id: 7 }] }), [9, 8, 7]);
    assert.deepEqual(normalizeSubtaskReorderIds({ order: [3, 1, 2] }), [3, 1, 2]);
});

test('reorders task subtasks transactionally with canonical sort_order', async () => {
    const rows = [
        { id: 3, task_id: 77, title: 'Third', is_done: false, sort_order: 0, source_type: 'manual' },
        { id: 4, task_id: 77, title: 'Fourth', is_done: true, sort_order: 1, source_type: 'manual' },
        { id: 5, task_id: 77, title: 'Fifth', is_done: false, sort_order: 2, source_type: 'manual' }
    ];
    const statements = [];
    const client = {
        async query(text, params = []) {
            statements.push({ text, params });
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
            if (/SELECT \*\s+FROM task_subtasks/i.test(text) && /FOR UPDATE/i.test(text)) {
                return { rows: rows.map(row => ({ ...row })) };
            }
            if (/UPDATE task_subtasks/i.test(text)) {
                const [sortOrder, taskId, subtaskId] = params;
                const row = rows.find(item => item.task_id === Number(taskId) && item.id === Number(subtaskId));
                if (row) row.sort_order = Number(sortOrder);
                return { rows: [] };
            }
            if (/UPDATE tasks SET updated_at = NOW\(\) WHERE id = \$1/i.test(text)) {
                return { rows: [] };
            }
            if (/SELECT \*\s+FROM task_subtasks/i.test(text) && /ORDER BY sort_order ASC, id ASC/i.test(text)) {
                return { rows: rows.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id) };
            }
            throw new Error(`Unexpected query: ${text}`);
        },
        release() {}
    };
    const result = await reorderTaskSubtasks({ connect: async () => client }, 77, { subtaskIds: [5, 3, 4] });

    assert.deepEqual(result.map(item => item.id), [5, 3, 4]);
    assert.deepEqual(result.map(item => item.sortOrder), [0, 1, 2]);
    assert.equal(statements[0].text, 'BEGIN');
    assert.equal(statements.at(-1).text, 'COMMIT');
});

test('replaces subtasks on an already connected transactional client without reconnecting', async () => {
    const statements = [];
    let nextId = 10;
    const client = {
        async connect() {
            throw new Error('connected client must not be connected again');
        },
        async query(text, params = []) {
            statements.push({ text, params });
            if (/SELECT id FROM task_subtasks WHERE task_id = \$1/i.test(text)) {
                return { rows: [] };
            }
            if (/DELETE FROM task_subtasks WHERE task_id = \$1/i.test(text)) {
                return { rows: [] };
            }
            if (/INSERT INTO task_subtasks/i.test(text)) {
                const [taskId, title, isDone, sortOrder, sourceType] = params;
                return {
                    rows: [{
                        id: nextId++,
                        task_id: taskId,
                        title,
                        is_done: isDone,
                        sort_order: sortOrder,
                        source_type: sourceType
                    }]
                };
            }
            if (/UPDATE tasks/i.test(text)) {
                return { rows: [] };
            }
            throw new Error(`Unexpected query: ${text}`);
        },
        release() {}
    };

    const result = await replaceTaskSubtasks(client, 88, ['First', 'Second'], { sourceType: 'manual' });

    assert.deepEqual(result.map(item => item.title), ['First', 'Second']);
    assert.equal(statements.some(statement => statement.text === 'BEGIN'), false);
    assert.equal(statements.some(statement => statement.text === 'COMMIT'), false);
});

test('calculates equal-weight subtask progress', () => {
    assert.equal(subtaskProgress(0, 0), null);
    assert.equal(subtaskProgress(1, 4), 25);
    assert.equal(subtaskProgress(2, 3), 67);
    assert.equal(subtaskProgress(5, 3), 100);
});

test('reports whether a decomposed parent can be completed', () => {
    assert.deepEqual(subtaskCompletionState(0, 0), {
        total: 0,
        done: 0,
        open: 0,
        canCompleteParent: true,
        progress: null
    });
    assert.deepEqual(subtaskCompletionState(2, 5), {
        total: 5,
        done: 2,
        open: 3,
        canCompleteParent: false,
        progress: 40
    });
    assert.deepEqual(subtaskCompletionState(9, 5), {
        total: 5,
        done: 5,
        open: 0,
        canCompleteParent: true,
        progress: 100
    });
});

test('rejects blank subtask titles during normalization', () => {
    assert.equal(normalizeSubtaskInput({ title: '   ' }), null);
    assert.equal(normalizeSubtaskInput('Named part')?.title, 'Named part');
});

test('list projections carry concrete subtask rows for clickable decomposed cards', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tasks.js'), 'utf8');
    const projectionCount = (route.match(/COALESCE\(subtask_rows\.subtasks, '\[\]'::json\) AS subtasks/g) || []).length;
    assert.ok(projectionCount >= 2, 'tasks list and my-cabinet projection should include subtask arrays');
    assert.match(route, /json_agg\(json_build_object\(\s*'id', id,\s*'task_id', task_id,\s*'title', title,/);
});

test('profile subtasks expose persisted reorder contract', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'tasks.js'), 'utf8');
    const profile = fs.readFileSync(path.join(__dirname, '..', 'js', 'profile-page.js'), 'utf8');
    assert.match(route, /router\.post\('\/:id\/subtasks\/reorder'/);
    assert.match(route, /reorderTaskSubtasks\(pool, req\.params\.id, orderedIds\)/);
    assert.match(profile, /data-cabinet-subtask-drag-handle/);
    assert.match(profile, /apiPost\(`\/tasks\/\$\{id\}\/subtasks\/reorder`/);
    assert.match(profile, /notifyTaskWidgetsChanged\(\{ action: 'subtask_reorder'/);
});
