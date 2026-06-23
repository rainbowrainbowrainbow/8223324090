const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('task detail modal has backend-backed banquet deposit confirmation UX', () => {
    const tasksPage = read('js/tasks-page.js');
    assert.match(tasksPage, /function isBanquetDepositTask\(task = \{\}\)/);
    assert.match(tasksPage, /sourceType === 'banquet_deposit'/);
    assert.match(tasksPage, /function renderBanquetDepositTaskPanel\(task = \{\}, projection = null/);
    assert.match(tasksPage, /apiGetBanquetDeposit\(depositId\)/);
    assert.match(tasksPage, /apiConfirmBanquetDeposit\(depositId/);
    assert.match(tasksPage, /\/banquet-deposits\/\$\{encodeURIComponent\(depositId\)\}/);
    assert.match(tasksPage, /\/banquet-deposits\/\$\{encodeURIComponent\(depositId\)\}\/confirm/);
    assert.match(tasksPage, /taskApiUrl[\s\S]*banquet-deposits/);
    [
        '_tdDepositClientName',
        '_tdDepositReceivedDate',
        '_tdDepositEventDate',
        '_tdDepositBanquetNumber',
        '_tdDepositAmount',
        '_tdDepositPaymentMethod'
    ].forEach(id => assert.match(tasksPage, new RegExp(id)));
});

test('deposit task completion is gated by successful confirm and backend reload', () => {
    const tasksPage = read('js/tasks-page.js');
    const completeIndex = tasksPage.indexOf('async function taskDetailComplete');
    const confirmIndex = tasksPage.indexOf('confirmBanquetDepositFromTask(taskId)', completeIndex);
    const completeApiIndex = tasksPage.indexOf('apiCompleteTask(taskId', completeIndex);
    assert.ok(confirmIndex > completeIndex, 'task detail completion should call deposit confirm');
    assert.ok(completeApiIndex > confirmIndex, 'task complete API must run after deposit confirm');
    assert.match(tasksPage, /const reloaded = await reloadBanquetDepositForm\(depositId\);[\s\S]*if \(!reloaded\) return false;/);
    assert.match(tasksPage, /sourcePayload\?\.accountantConfirmation/);
    assert.match(tasksPage, /newStatus === 'done' && isBanquetDepositTask\(currentTask\)/);
    assert.match(tasksPage, /openBanquetDepositTaskForCompletion\(taskId\)/);
    assert.match(tasksPage, /rememberBanquetDepositFormState\(\)/);
    assert.match(tasksPage, /isBanquetDepositFormDirty\(\)/);
});
