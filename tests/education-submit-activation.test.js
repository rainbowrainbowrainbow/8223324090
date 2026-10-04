'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../js/booking.js'), 'utf8');
function form() {
    let text = 'Запланувати заняття', node = {};
    const button = { disabled: false, dataset: {}, classList: { toggle() {} }, setAttribute() {},
        get textContent() { return text; }, set textContent(value) { text = value; node = {}; },
        get firstChild() { return node; } };
    const hint = {}, state = { canSubmit: true, warnings: [] };
    const context = { document: { getElementById: id => id === 'bookingSubmitBtn' ? button : hint },
        getSmartBookingValidationState: () => state, syncBookingBoundaryWarningUi() {},
        selectedActivityPreflightUnavailable: () => false, isEducationTimelineBookingMode: () => true,
        BookingDrawerState: { validationAttempted: false } };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('const BOOKING_SUBMIT_INCOMPLETE_TEXT'), source.indexOf('function bookingSummaryActivityName')), context);
    return { context, button, state };
}
test('education validation refresh preserves the pressed submit text node when the label is unchanged', () => {
    const { context, button } = form(), pressedNode = button.firstChild;
    context.updateBookingSubmitState(); context.updateBookingSubmitState();
    assert.equal(button.firstChild, pressedNode, 'Replacing a pressed text node loses WebKit native click');
    assert.equal(button.disabled, false);
});
test('education validation still updates incomplete and restored labels', () => {
    const { context, button, state } = form(); state.canSubmit = false;
    context.updateBookingSubmitState(); assert.equal(button.textContent, 'Показати що заповнити');
    state.canSubmit = true; context.updateBookingSubmitState(); assert.equal(button.textContent, 'Запланувати заняття');
});
test('saving remains disabled and is not relabelled by validation refresh', () => {
    const { context, button } = form(); button.textContent = 'Збереження...'; button.disabled = true;
    const node = button.firstChild; context.updateBookingSubmitState();
    assert.equal(button.disabled, true); assert.equal(button.textContent, 'Збереження...'); assert.equal(button.firstChild, node);
});
