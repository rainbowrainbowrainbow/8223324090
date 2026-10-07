'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function harness() {
    const source = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
    const start = source.indexOf('var _customConfirmActiveClose = null;');
    const end = source.indexOf('const _toastMaxVisible', start);
    assert.ok(start >= 0 && end > start);
    const elements = new Map(['confirmModal', 'confirmTitle', 'confirmMessage', 'confirmYes', 'confirmNo'].map(id => {
        const listeners = new Map();
        return [id, { textContent: id === 'confirmYes' ? 'Видалити' : '',
            addEventListener: (name, callback) => listeners.set(name, callback),
            removeEventListener: name => listeners.delete(name),
            click: () => listeners.get('click')?.({ preventDefault() {} }) }];
    }));
    const context = vm.createContext({ document: { getElementById: id => elements.get(id),
        addEventListener() {}, removeEventListener() {} }, openModal() {}, closeModal() {} });
    vm.runInContext(source.slice(start, end), context);
    return { context, elements };
}
test('booking conflict names its real overwrite and refresh actions', async () => {
    const { context, elements } = harness();
    const result = context.customConfirm('Another editor changed this booking', 'Конфлікт редагування', 'Перезаписати', 'Оновити дані');
    assert.equal(elements.get('confirmYes').textContent, 'Перезаписати');
    assert.equal(elements.get('confirmNo').textContent, 'Оновити дані');
    elements.get('confirmNo').click();
    assert.equal(await result, false);
});
test('a later generic confirmation clears labels from a previous operation', async () => {
    const { context, elements } = harness();
    const first = context.customConfirm('Old action', 'Delete', 'Delete', 'Keep');
    const second = context.customConfirm('New action');
    assert.equal(await first, false);
    assert.equal(elements.get('confirmYes').textContent, 'Підтвердити');
    assert.equal(elements.get('confirmNo').textContent, 'Скасувати');
    elements.get('confirmYes').click();
    assert.equal(await second, true);
});
