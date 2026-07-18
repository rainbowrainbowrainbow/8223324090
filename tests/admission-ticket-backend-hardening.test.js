'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(...segments) {
    return fs.readFileSync(path.join(ROOT, ...segments), 'utf8');
}

test('material package detection cannot be shadowed by an empty top-level alias', () => {
    const { bookingPackageHasBanquetData } = require('../services/banquetGroups');
    const materialPackage = {
        menuPositions: [{
            id: 'menu-1',
            quantity: 1,
            unitPrice: 100,
            subtotal: 100
        }]
    };

    assert.equal(bookingPackageHasBanquetData({
        bookingPackage: {},
        extraData: { bookingPackage: materialPackage }
    }), true);
    assert.equal(bookingPackageHasBanquetData({
        booking_package: '{}',
        extra_data: JSON.stringify({ booking_package: materialPackage })
    }), true);
});

test('source banquet bridges lock the group before the booking and detect membership drift', () => {
    const source = read('services', 'banquetGroups.js');
    const helperStart = source.indexOf('async function lockSourceBookingBanquetContext');
    const helperEnd = source.indexOf('async function attachBookingToBanquetGroup', helperStart);
    assert.ok(helperStart >= 0 && helperEnd > helperStart);

    const helper = source.slice(helperStart, helperEnd);
    const discoveryIndex = helper.indexOf('await findGroupForBooking(');
    const groupLockIndex = helper.indexOf('await getGroupByIdForUpdate(');
    const bookingLockIndex = helper.indexOf('await getScopedBookingForUpdate(');
    const membershipLockIndex = helper.indexOf('await getMembershipForBooking(');

    assert.ok(discoveryIndex >= 0);
    assert.ok(groupLockIndex > discoveryIndex);
    assert.ok(bookingLockIndex > groupLockIndex);
    assert.ok(membershipLockIndex > bookingLockIndex);
    assert.match(helper, /code:\s*'BANQUET_GROUP_VERSION_CONFLICT'/);

    for (const functionName of [
        'createMemberBookingFromSourceBooking',
        'createActivityBookingFromSourceBooking'
    ]) {
        const start = source.indexOf(`async function ${functionName}`);
        const nextFunction = source.indexOf('\nasync function ', start + 1);
        const block = source.slice(start, nextFunction === -1 ? source.length : nextFunction);
        assert.match(block, /await lockSourceBookingBanquetContext\(client, cleanSourceId, context\)/);
        assert.doesNotMatch(block, /await getScopedBookingForUpdate\(client, cleanSourceId, context\)/);
    }
});

test('payment patch keeps ticket finance and banquet optimistic version in one transaction', () => {
    const source = read('routes', 'bookings.js');
    const start = source.indexOf("router.patch('/:id/payment'");
    const end = source.indexOf('\nmodule.exports = router', start);
    assert.ok(start >= 0 && end > start);
    const route = source.slice(start, end);

    const beginIndex = route.indexOf("await client.query('BEGIN')");
    const membershipIndex = route.indexOf('await getBanquetMembershipForDelete(');
    const bookingLockIndex = route.indexOf('await getScopedBookingById(');
    const bookingUpdateIndex = route.indexOf('UPDATE bookings SET');
    const financeIndex = route.indexOf('await syncBookingFinanceInTransaction(');
    const groupVersionIndex = route.indexOf('UPDATE banquet_groups');
    const commitIndex = route.indexOf("await client.query('COMMIT')");

    assert.ok(beginIndex >= 0);
    assert.ok(membershipIndex > beginIndex);
    assert.ok(bookingLockIndex > membershipIndex);
    assert.ok(bookingUpdateIndex > bookingLockIndex);
    assert.ok(financeIndex > bookingUpdateIndex);
    assert.ok(groupVersionIndex > financeIndex);
    assert.ok(commitIndex > groupVersionIndex);
    assert.match(route, /optional:\s*false/);
    assert.match(
        route,
        /bookingRequiresStrictFinanceSync\(updatedBooking\) \|\| activeBanquetMembership/
    );
    assert.match(route, /SET updated_at = NOW\(\),\s*updated_by = \$3/);
});

test('recurring generation rejects ticket templates before room lookup or booking writes', () => {
    const source = read('services', 'recurring.js');
    const generateStart = source.indexOf('async function generateBookingsForTemplate');
    const generateEnd = source.indexOf('\nasync function generateAllRecurringBookings', generateStart);
    const generateBlock = source.slice(generateStart, generateEnd);
    const guardIndex = generateBlock.indexOf('assertRecurringTemplateTicketSafe(template)');
    const roomIndex = generateBlock.indexOf('await canonicalizeBookingRoomResource(');
    const writeIndex = generateBlock.indexOf('INSERT INTO bookings');

    assert.ok(guardIndex >= 0);
    assert.ok(roomIndex > guardIndex);
    assert.ok(writeIndex > guardIndex);

    const allBlock = source.slice(generateEnd);
    assert.match(allBlock, /error\?\.code !== 'TICKET_RECURRING_UNSUPPORTED'/);
    assert.match(allBlock, /totalBlockedTemplates \+= 1/);
});
