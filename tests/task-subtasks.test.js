const test = require('node:test');
const assert = require('node:assert/strict');

const {
    hasSubtaskPayload,
    normalizeSubtaskInput,
    normalizeSubtasksInput,
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

test('calculates equal-weight subtask progress', () => {
    assert.equal(subtaskProgress(0, 0), null);
    assert.equal(subtaskProgress(1, 4), 25);
    assert.equal(subtaskProgress(2, 3), 67);
    assert.equal(subtaskProgress(5, 3), 100);
});

test('rejects blank subtask titles during normalization', () => {
    assert.equal(normalizeSubtaskInput({ title: '   ' }), null);
    assert.equal(normalizeSubtaskInput('Named part')?.title, 'Named part');
});
