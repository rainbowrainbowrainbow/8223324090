const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    normalizeMenuPositions,
    menuPositionsSubtotal,
    buildLegacyBanquetMenu,
    applyBookingPackage,
    bookingPackageAudit
} = require('../services/bookingPackage');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

test('booking package normalizes menu positions with price and subtotal', () => {
    const positions = normalizeMenuPositions([
        { productId: 'menu_pizza', title: 'Піца', quantity: 3, unitPrice: 250 },
        { product_id: 'menu_juice', label: 'Сік', qty: 2, price: 80, note: 'яблуко' },
        { title: '' }
    ]);

    assert.equal(positions.length, 2);
    assert.equal(positions[0].subtotal, 750);
    assert.equal(positions[1].subtotal, 160);
    assert.equal(menuPositionsSubtotal(positions), 910);
    assert.match(buildLegacyBanquetMenu(positions), /Піца - 3 x 250 грн/);
    assert.match(buildLegacyBanquetMenu(positions), /Сік - 2 x 80 грн \(яблуко\)/);
});

test('booking package persists final total into booking price and extraData', () => {
    const booking = applyBookingPackage({
        price: 2200,
        programBasePrice: 2200,
        menuPositions: [
            { productId: 'menu_pizza', title: 'Піца', quantity: 2, unitPrice: 300 }
        ],
        extraData: { tags: ['birthday'] }
    });

    assert.equal(booking.price, 2800);
    assert.equal(booking.extraData.tags[0], 'birthday');
    assert.equal(booking.extraData.bookingPackage.programBasePrice, 2200);
    assert.equal(booking.extraData.bookingPackage.positionsSubtotal, 600);
    assert.equal(booking.extraData.bookingPackage.finalTotal, 2800);
    assert.equal(booking.extraData.bookingPackage.menuPositions[0].productId, 'menu_pizza');
    assert.match(booking.banquetMenu, /Піца - 2 x 300 грн/);
});

test('booking package audit records client and commercial package changes', () => {
    const audit = bookingPackageAudit(
        {
            customer_id: 10,
            price: 2200,
            banquet_menu: null,
            extra_data: {
                bookingPackage: {
                    finalTotal: 2200,
                    menuPositions: []
                }
            }
        },
        {
            customerId: 12,
            price: 2800,
            banquetMenu: 'Піца - 2 x 300 грн',
            extraData: {
                bookingPackage: {
                    finalTotal: 2800,
                    menuPositions: [{ title: 'Піца', quantity: 2, unitPrice: 300, subtotal: 600 }]
                }
            }
        }
    );

    assert.equal(audit.customerChanged, true);
    assert.equal(audit.packageChanged, true);
    assert.equal(audit.from.customerId, 10);
    assert.equal(audit.to.customerId, 12);
});

test('booking workspace exposes first-class client, menu positions, summary, and backend persistence', () => {
    const html = read('index.html');
    const bookingJs = read('js', 'booking.js');
    const route = read('routes', 'bookings.js');

    assert.match(html, /booking-workspace-heading/);
    assert.match(html, /bookingMenuProductSelect/);
    assert.match(html, /bookingPackageSummary/);
    assert.match(html, /id="customerDataToggle" checked hidden/);

    assert.match(bookingJs, /function addBookingMenuPositionFromForm/);
    assert.match(bookingJs, /programBasePrice/);
    assert.match(bookingJs, /positionsSubtotal/);
    assert.match(bookingJs, /finalTotal/);
    assert.match(bookingJs, /Вкажіть клієнта або оберіть існуючу картку/);

    assert.match(route, /applyBookingPackage/);
    assert.match(route, /banquet_guests/);
    assert.match(route, /banquet_tables/);
    assert.match(route, /banquet_menu/);
    assert.match(route, /bookingPackageAudit/);
    assert.match(route, /lb\.extraData = null;/);
    assert.match(route, /b\.duration,\s*0,\s*b\.hosts/);
    assert.match(route, /b\.createdBy,\s*id,\s*newStatus,\s*b\.kidsCount \|\| null,\s*b\.groupName \|\| null,\s*null\]/);
});
