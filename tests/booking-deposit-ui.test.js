const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
    const payloadBlock = functionBlock(booking, 'buildBanquetBookingSetPayload');

    assert.match(hydrateBlock, /setBookingDepositHydrationState\(cleanBookingId, 'loaded', hadDeposit\)/);
    assert.match(hydrateBlock, /setBookingDepositHydrationState\(cleanBookingId, 'failed', false\)/);
    assert.match(payloadBlock, /depositHydration\.status === 'loaded'/);
    assert.match(payloadBlock, /depositWasLoaded && depositHydration\.hadDeposit/);
    assert.match(payloadBlock, /provided:\s*true/);
    assert.match(payloadBlock, /expectedAmount:\s*null/);
    assert.match(payloadBlock, /delete primaryPatch\.deposit/);
    assert.match(payloadBlock, /delete primaryPatch\.banquetDeposit/);
});
