const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function functionBlock(source, name) {
    const start = source.indexOf(`function ${name}`);
    assert.ok(start >= 0, `${name} should exist`);
    const next = source.indexOf('\nfunction ', start + 1);
    return source.slice(start, next >= 0 ? next : source.length);
}

test('booking banquet detail renders backend-backed deposit status field', () => {
    const api = read('js/api.js');
    const booking = read('js/booking.js');
    const banquetDetail = read('js/booking-banquet-detail.js');
    const css = read('css/timeline.css');

    assert.match(api, /function apiGetBanquetDepositByBooking\(bookingId\)/);
    assert.match(api, /\/banquets\/by-booking\/\$\{encodeURIComponent\(bookingId\)\}\/deposit/);
    assert.match(api, /function apiGetBanquetDepositByGroup\(groupId\)/);
    assert.match(api, /\/banquets\/\$\{encodeURIComponent\(groupId\)\}\/deposit/);

    assert.match(banquetDetail, /function renderBanquetDepositStatusSection\(anchorBooking = \{\}, snapshot = null, projection = \{ loading: true \}\)/);
    assert.match(banquetDetail, /renderBanquetDepositStatusSection\(anchorBooking, snapshot\)/);
    assert.match(banquetDetail, /id="bookingBanquetDepositStatus"/);
    assert.match(booking, /function renderBanquetDepositStatusSection\(anchorBooking = \{\}, snapshot = null, projection = \{ loading: true \}\)/);
    assert.match(booking, /bookingBanquetDetailRendererCall\('renderBanquetDepositStatusSection', arguments\)/);
    assert.match(booking, /loadBanquetDepositStatusForDetails\(booking, banquetSnapshot\)/);
    assert.match(css, /\.booking-banquet-deposit/);
});

test('deposit UI uses group projection first and never treats paid_amount as deposit status', () => {
    const booking = read('js/booking.js');
    const loadBlock = functionBlock(booking, 'loadBanquetDepositStatusForDetails');
    const labelBlock = functionBlock(booking, 'bookingDetailDepositStatusLabel');
    const warningsBlock = functionBlock(booking, 'bookingDetailDepositWarnings');

    assert.ok(
        loadBlock.indexOf('apiGetBanquetDepositByGroup(groupId)') < loadBlock.indexOf('apiGetBanquetDepositByBooking(primaryBookingId)'),
        'group deposit projection should be preferred before primary booking fallback'
    );
    assert.doesNotMatch(labelBlock, /paidAmount|paid_amount|paymentStatus|payment_status/);
    assert.match(warningsBlock, /paid_amount \/ payment_status/);
    assert.match(warningsBlock, /bookingDetailDepositHasCanonicalRecord\(projection\)/);
});

test('banquet booking-set only clears manager deposit fields after a successful existing projection load', () => {
    const booking = read('js/booking.js');
    const hydrateBlock = functionBlock(booking, 'hydrateBookingDepositFromServer');
    const stateBlock = functionBlock(booking, 'setBookingDepositHydrationState');
    const renderBlock = functionBlock(booking, 'renderBookingDepositHydrationStatus');
    const payloadBlock = functionBlock(booking, 'buildBanquetBookingSetPayload');

    assert.match(hydrateBlock, /setBookingDepositHydrationState\(cleanBookingId, 'loaded', hadDeposit\)/);
    assert.match(hydrateBlock, /setBookingDepositHydrationState\(cleanBookingId, 'failed', false, err\?\.message \|\| err\)/);
    assert.match(stateBlock, /renderBookingDepositHydrationStatus\(state\)/);
    assert.match(renderBlock, /setBookingDepositFieldsLocked\(shouldLock\)/);
    assert.match(renderBlock, /Завдаток не завантажився/);
    assert.match(booking, /id = 'bookingDepositRetryBtn'/);
    assert.match(booking, /hydrateBookingDepositFromServer\(bookingId\)/);
    assert.match(payloadBlock, /const depositCanMutate = depositHydration\.status === 'loaded'/);
    assert.match(payloadBlock, /formData\.deposit\?\.provided && primaryBookingId && !depositCanMutate/);
    assert.match(payloadBlock, /depositHydration\.status === 'loaded'/);
    assert.match(payloadBlock, /depositWasLoaded && depositHydration\.hadDeposit/);
    assert.match(payloadBlock, /provided:\s*true/);
    assert.match(payloadBlock, /expectedAmount:\s*null/);
    assert.match(payloadBlock, /delete primaryPatch\.deposit/);
    assert.match(payloadBlock, /delete primaryPatch\.banquetDeposit/);
});

test('deposit hydration failure locks manager fields and exposes retry action in the booking form', () => {
    const booking = read('js/booking.js');
    const helperStart = booking.indexOf('const BOOKING_DEPOSIT_FIELD_IDS');
    const helperEnd = booking.indexOf('function getBookingDepositFormData', helperStart);
    const stateStart = booking.indexOf('function setBookingDepositHydrationState');
    const stateEnd = booking.indexOf('function resetBookingDepositHydrationState', stateStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'deposit hydration UI helpers should exist');
    assert.ok(stateStart >= 0 && stateEnd > stateStart, 'deposit hydration state helper should exist');

    const dom = new JSDOM(`<!doctype html><html><body>
        <section id="bookingDepositSection">
            <div class="booking-section-heading"></div>
            <input id="bookingDepositExpectedAmount">
            <input id="bookingDepositDueDate">
            <select id="bookingDepositManagerStatus"></select>
            <textarea id="bookingDepositManagerNote"></textarea>
        </section>
    </body></html>`);
    const sandbox = {
        document: dom.window.document,
        BookingDrawerState: {},
        console
    };
    vm.createContext(sandbox);
    vm.runInContext(`
        ${booking.slice(helperStart, helperEnd)}
        ${booking.slice(stateStart, stateEnd)}
        globalThis.__depositHelpers = { setBookingDepositHydrationState };
    `, sandbox, { filename: 'js/booking.js#deposit-hydration-test' });

    sandbox.__depositHelpers.setBookingDepositHydrationState('BK-1', 'loading', true);
    assert.equal(dom.window.document.getElementById('bookingDepositExpectedAmount').disabled, true);
    assert.equal(dom.window.document.getElementById('bookingDepositHydrationStatus').hidden, false);
    assert.equal(dom.window.document.getElementById('bookingDepositRetryBtn').hidden, true);

    sandbox.__depositHelpers.setBookingDepositHydrationState('BK-1', 'failed', true, 'network');
    assert.equal(dom.window.document.getElementById('bookingDepositManagerNote').disabled, true);
    assert.match(dom.window.document.getElementById('bookingDepositHydrationMessage').textContent, /Завдаток не завантажився/);
    assert.equal(dom.window.document.getElementById('bookingDepositRetryBtn').hidden, false);
    assert.equal(dom.window.document.getElementById('bookingDepositRetryBtn').disabled, false);

    sandbox.__depositHelpers.setBookingDepositHydrationState('BK-1', 'loaded', true);
    assert.equal(dom.window.document.getElementById('bookingDepositExpectedAmount').disabled, false);
    assert.equal(dom.window.document.getElementById('bookingDepositHydrationStatus').hidden, true);
});
