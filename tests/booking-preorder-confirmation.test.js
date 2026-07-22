const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..');
const bookingJs = fs.readFileSync(path.join(repoRoot, 'js', 'booking.js'), 'utf8');

function bookingPreorderConfirmationSandbox(confirmResult) {
    const dom = new JSDOM('<input type="radio" name="bookingStatus" value="confirmed" checked>');
    const calls = [];
    const sourceStart = bookingJs.indexOf('const BANQUET_PREORDER_MENU_MINIMUMS');
    const sourceEnd = bookingJs.indexOf('const BOOKING_SUBMIT_INCOMPLETE_TEXT', sourceStart);
    assert.notEqual(sourceStart, -1, 'banquet preorder constants should exist');
    assert.notEqual(sourceEnd, -1, 'booking submit constants should follow preorder confirmation');

    const sandbox = {
        document: dom.window.document,
        confirmModal: async (message, options = {}) => {
            calls.push({ message, options });
            return confirmResult;
        },
        formatPrice(value) {
            return `${Number(value || 0).toLocaleString('uk-UA')} ₴`;
        }
    };

    vm.runInNewContext(`${bookingJs.slice(sourceStart, sourceEnd)}
this.__confirmBookingPreorderWarningsBeforeSubmit = confirmBookingPreorderWarningsBeforeSubmit;`, sandbox);

    return {
        calls,
        confirm: sandbox.__confirmBookingPreorderWarningsBeforeSubmit
    };
}

function warningFormData() {
    return {
        kitchenEnabled: true,
        room: 'Диван 3',
        positionsSubtotal: 1900,
        deposit: {
            provided: true,
            expectedAmount: 2000
        }
    };
}

test('booking preorder warning uses explicit save confirmation labels', async () => {
    const { calls, confirm } = bookingPreorderConfirmationSandbox(true);
    const formData = warningFormData();

    const accepted = await confirm(formData);

    assert.equal(accepted, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.type, 'warning');
    assert.equal(calls[0].options.okText, 'Зберегти бронювання');
    assert.equal(calls[0].options.cancelText, 'Повернутися до меню');
    assert.doesNotMatch(calls[0].message, /Видалити/);
    assert.doesNotMatch(JSON.stringify(calls[0].options), /Видалити/);
    assert.equal(formData.preorderWarningAcknowledgement.confirmed, true);
    assert.deepEqual(Array.from(formData.preorderWarningAcknowledgement.warningCodes), ['banquet_menu_minimum_below']);
});

test('booking preorder warning cancel stops submit acknowledgement', async () => {
    const { calls, confirm } = bookingPreorderConfirmationSandbox(false);
    const formData = warningFormData();

    const accepted = await confirm(formData);

    assert.equal(accepted, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.okText, 'Зберегти бронювання');
    assert.equal(calls[0].options.cancelText, 'Повернутися до меню');
    assert.equal(formData.preorderWarningAcknowledgement, undefined);
});

test('booking preorder warning no longer calls legacy customConfirm', () => {
    const sourceStart = bookingJs.indexOf('async function confirmBookingPreorderWarningsBeforeSubmit');
    const sourceEnd = bookingJs.indexOf('const BOOKING_SUBMIT_INCOMPLETE_TEXT', sourceStart);
    const source = bookingJs.slice(sourceStart, sourceEnd);

    assert.match(source, /confirmModal\(text,/);
    assert.match(source, /okText: 'Зберегти бронювання'/);
    assert.match(source, /cancelText: 'Повернутися до меню'/);
    assert.doesNotMatch(source, /customConfirm/);
});
