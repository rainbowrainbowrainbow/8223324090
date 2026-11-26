const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('legacy deposit markers distinguish a missing link from an ordinary task', () => {
    const window = {};
    vm.runInNewContext(read('js/task-ui-shared.js'), { window });
    const ref = window.TaskUiShared.taskBanquetDepositRef;
    assert.equal(ref({ sourceType: 'booking', sourceId: '7' }), null);
    assert.equal(ref({ source_type: 'BANQUET_DEPOSIT', source_id: 'bad' }).id, null);
    assert.equal(ref({ control_meta: '{"deposit_id":"81"}' }).id, 81);
    assert.equal(ref({ controlMeta: { depositId: 'broken' }, sourceEntityType: 'banquet_deposit', sourceEntityId: '27' }).id, 27);
});

test('My Day provides backend-backed banquet deposit confirmation', () => {
    const profile = read('js/profile-page.js');
    const card = read('js/profile-my-day.js');
    const center = read('js/tasks-page.js');
    assert.match(center, /newStatus === 'done' && window\.TaskUiShared\.taskBanquetDepositRef\(currentTask\)/);
    assert.match(center, /openBanquetDepositTaskForCompletion\(taskId\)/);
    assert.match(profile, /apiGetScopedJson\('\/banquet-deposits\/' \+ id/);
    assert.match(profile, /apiPost\('\/banquet-deposits\/' \+ id \+ '\/confirm'/);
    for (const field of ['clientName', 'receivedDate', 'eventDate', 'banquetNumber', 'amount', 'paymentMethod']) {
        assert.ok(card.includes(field), field);
    }
});

test('deposit task completion reloads confirmation status before sending the mutation', () => {
    const card = read('js/profile-my-day.js');
    assert.match(card, /submitOperation\('complete'[\s\S]*await detailActions\.loadDeposit\(depositId, controller.signal\)[\s\S]*if \(!isConfirmedDeposit\(projection\)[\s\S]*return complete\(previous, id\)/);
    assert.match(read('js/profile-page.js'), /action === 'done' && window\.TaskUiShared\?\.taskBanquetDepositRef/);
});
