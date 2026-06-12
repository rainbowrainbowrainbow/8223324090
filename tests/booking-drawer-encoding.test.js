const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const mojibakeMarkers = [
    'Рџ', 'РЎ', 'Рќ', 'Рљ', 'Рђ', 'Р†', 'Р ', 'Р‘', 'Р’', 'Р“', 'Р”', 'Р—', 'Рњ', 'Р©',
    'СЏ', 'С–', 'СЋ', 'СЊ', 'С‡', 'С€',
    'вЂ', 'вњ', 'рџ', 'В·'
];

function assertCleanEncoding(surfaceName, content) {
    const found = mojibakeMarkers.filter(marker => content.includes(marker));
    assert.deepEqual(found, [], `${surfaceName} contains mojibake markers: ${found.join(', ')}`);
}

test('booking drawer frontend sources do not contain mojibake markers', () => {
    assertCleanEncoding('js/booking.js', read('js', 'booking.js'));
    assertCleanEncoding('js/booking-form.js', read('js', 'booking-form.js'));

    const html = read('index.html');
    const start = html.indexOf('<aside id="bookingPanel"');
    const end = html.indexOf('</aside>', start);
    assert.ok(start >= 0, 'booking panel markup exists');
    assert.ok(end > start, 'booking panel slice end exists');
    assertCleanEncoding('index.html booking panel', html.slice(start, end + '</aside>'.length));
});

test('booking drawer controls keep reliable hit targets and footer spacing', () => {
    const html = read('index.html');
    const bookingJs = read('js', 'booking.js');
    const kitchenMenuImagesJs = read('js', 'kitchen-menu-images.js');
    const panelCss = read('css', 'panel.css');
    const responsiveCss = read('css', 'responsive.css');
    const panelStart = html.indexOf('<aside id="bookingPanel"');
    const panelEnd = html.indexOf('</aside>', panelStart);
    const bookingPanelHtml = panelStart >= 0 && panelEnd > panelStart
        ? html.slice(panelStart, panelEnd + '</aside>'.length)
        : html;

    [
        'bookingMenuAddBtn',
        'bookingMenuCatalogOpenBtn',
        'bookingMenuCatalogPanel',
        'bookingMenuCatalogSearch',
        'bookingMenuCatalogTabs',
        'bookingMenuCatalogList',
        'bookingMenuCatalogCart',
        'bookingMenuCatalogCartList',
        'bookingMenuCatalogMobileCartBtn',
        'bookingSubmitBtn'
    ].forEach(id => assert.match(html, new RegExp(`id="${id}"`), `${id} exists in booking drawer`));
    assert.match(html, /id="bookingMenuCatalogPanel" class="booking-menu-catalog-panel booking-menu-catalog-overlay hidden" hidden aria-hidden="true" role="dialog" aria-modal="true"/);
    assert.doesNotMatch(bookingPanelHtml, /bookingMenuCatalogPanel/);
    assert.match(html, /js\/kitchen-menu-images\.js\?v=0\.75\.20/);
    assert.ok(html.indexOf('js/kitchen-menu-images.js') < html.indexOf('js/config.js'), 'kitchen menu image manifest loads before config');
    assert.match(kitchenMenuImagesJs, /window\.KITCHEN_MENU_IMAGES/);
    assert.match(kitchenMenuImagesJs, /basePath:\s*'\/images\/kitchen-menu\/'/);
    assert.match(kitchenMenuImagesJs, /"MENU-026":\s*"01_Бургери\/002_Бургер з біфштексом\.jpg"/);
    assert.match(kitchenMenuImagesJs, /"CAKE-06":\s*"10_Торти\/088_Снікерс\.jpg"/);
    assert.match(html, /id="bookingHasEventToggle" checked hidden aria-hidden="true"/);
    assert.match(html, /id="bookingKitchenToggle" hidden aria-hidden="true"/);
    assert.match(html, /id="bookingLeadDetailsToggle" hidden aria-hidden="true"/);
    assert.doesNotMatch(bookingPanelHtml, /bookingModeSelector/);
    assert.doesNotMatch(bookingPanelHtml, /Що входить у бронювання/);
    assert.doesNotMatch(html, /bookingCreateCustomerBtn/);
    assert.match(html, /Знайдіть і виберіть існуючу картку клієнта перед збереженням бронювання/);
    assert.match(html, /id="bookingPrimaryAnimatorSelect"/);

    assert.match(bookingJs, /const BOOKING_PROGRAM_ONLY_WORKSPACE = true/);
    assert.match(bookingJs, /if \(isRoomFirstTimelineView\(\)\) return false;/);
    assert.match(bookingJs, /return true;/);
    assert.match(bookingJs, /return isRoomFirstTimelineView\(\) && timelineKitchenEnabled\(\);/);
    assert.match(bookingJs, /function isBookingLeadDetailsEnabled\(\) \{\s*return false;/);
    assert.match(bookingJs, /ROOM_FIRST_BANQUET_SERVICE_LINE_ID = 'banquet-service'/);
    assert.match(bookingJs, /const hasEvent = roomFirst \? false : true;/);
    assert.match(bookingJs, /eventFields\.hidden = roomFirst;/);
    assert.match(bookingJs, /prefillRoomFirstCustomerFromRoomLine/);
    assert.match(bookingJs, /openAnimationBookingInAnimatorView/);
    assert.match(bookingJs, /Оберіть програму події/);
    assert.doesNotMatch(bookingJs, /bookingHasEventToggle'\)\?\.addEventListener\('change'/);
    assert.doesNotMatch(bookingJs, /bookingKitchenToggle'\)\?\.addEventListener\('change'/);
    assert.doesNotMatch(bookingJs, /bookingLeadDetailsToggle'\)\?\.addEventListener\('change'/);
    assert.match(bookingJs, /bookingMenuAddBtn'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /bookingMenuCatalogOpenBtn'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /bookingMenuCatalogSearch'\)\?\.addEventListener\('input'/);
    assert.match(bookingJs, /bookingMenuCatalogPanel'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /bookingMenuCatalogPanel'\)\?\.addEventListener\('change'/);
    assert.match(bookingJs, /bookingMenuCatalogPanel'\)\?\.addEventListener\('keydown'/);
    assert.match(bookingJs, /bookingMenuCatalogMobileCartBtn'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /bookingMenuCatalogCartCloseBtn'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /data-menu-catalog-quantity-input/);
    assert.match(bookingJs, /data-menu-catalog-price-input/);
    assert.match(bookingJs, /data-menu-catalog-note-input/);
    assert.match(bookingJs, /BOOKING_MENU_CATALOG_FILTERS/);
    assert.match(bookingJs, /function bookingMenuImageManifestUrl/);
    assert.match(bookingJs, /window\.KITCHEN_MENU_IMAGES/);
    assert.match(bookingJs, /bookingMenuCatalogHandleImageError/);
    assert.match(bookingJs, /upsertBookingMenuCatalogProduct/);
    assert.match(bookingJs, /renderBookingMenuCatalogCart/);
    assert.match(bookingJs, /setBookingMenuCatalogCartOpen/);
    assert.match(bookingJs, /isBookingMenuCatalogMobileCartLayout/);
    assert.match(bookingJs, /preferCart/);
    assert.match(bookingJs, /commitBookingMenuCatalogInlineInput/);
    assert.match(bookingJs, /document\.body\?\.classList\.toggle\('booking-menu-catalog-active', nextOpen\)/);
    assert.match(bookingJs, /bookingMenuCatalogPanel'\)\?\.addEventListener\('click'/);
    assert.match(bookingJs, /cart\.setAttribute\('inert'/);
    assert.match(bookingJs, /window\.addEventListener\('resize'/);
    assert.match(bookingJs, /event\.key !== 'Escape'/);
    assert.match(bookingJs, /document\.createElement\('button'\)/);
    assert.match(bookingJs, /icon\.type = 'button'/);
    assert.match(bookingJs, /aria-pressed/);

    assert.match(panelCss, /--booking-footer-space:\s*calc\(28px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
    assert.match(panelCss, /scroll-padding-bottom:\s*var\(--booking-footer-space\)/);
    assert.match(panelCss, /\.booking-sticky-footer\s*\{[\s\S]*position:\s*static;/);
    assert.match(panelCss, /\.booking-sticky-footer\s*\{[\s\S]*width:\s*100%;/);
    assert.match(panelCss, /\.booking-sticky-footer\s*\{[\s\S]*max-width:\s*none;/);
    assert.match(panelCss, /\.booking-summary-note--error/);
    assert.match(panelCss, /\.btn-submit\.btn-submit--needs-input/);
    assert.doesNotMatch(panelCss, /bottom:\s*calc\(0px - 18px\)/);
    assert.doesNotMatch(panelCss, /margin:\s*20px -24px -18px/);
    assert.doesNotMatch(panelCss, /\.booking-sticky-footer\s*\{[\s\S]*position:\s*sticky;/);
    assert.doesNotMatch(panelCss, /\.booking-sticky-footer\s*\{[\s\S]*calc\(var\(--booking-panel-pad-x\) \* -1\)/);

    assert.match(panelCss, /\.btn-submit:disabled/);
    assert.match(panelCss, /\.booking-mode-card:focus-within/);
    assert.match(panelCss, /\.booking-menu-add-btn:focus-visible/);
    assert.match(panelCss, /\.booking-menu-catalog-panel/);
    assert.match(panelCss, /\.booking-menu-catalog-overlay/);
    assert.match(panelCss, /body\.booking-menu-catalog-active/);
    assert.match(panelCss, /\.booking-menu-catalog-panel\s*\{[\s\S]*position:\s*fixed;/);
    assert.match(panelCss, /\.booking-menu-catalog-panel\s*\{[\s\S]*inset:\s*0;/);
    assert.match(panelCss, /\.booking-menu-catalog-body\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(320px,\s*380px\)/);
    assert.match(panelCss, /\.booking-menu-catalog-list\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(320px,\s*1fr\)\)/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb img/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb\.has-image span/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb\.is-image-missing img/);
    assert.match(panelCss, /\.booking-menu-catalog-thumb--cart/);
    assert.match(panelCss, /\.booking-menu-catalog-cart/);
    assert.match(panelCss, /\.booking-menu-catalog-mobile-cart/);
    assert.match(panelCss, /\.booking-menu-catalog-cart-open \.booking-menu-catalog-cart/);
    assert.match(panelCss, /\.booking-menu-catalog-stepper/);
    assert.match(panelCss, /\.booking-menu-catalog-group-heading/);
    assert.match(panelCss, /\.booking-menu-catalog-item\.selected/);
    assert.match(panelCss, /\.booking-menu-catalog-inline-input/);
    assert.match(panelCss, /\.booking-menu-catalog-note-editor/);
    assert.match(panelCss, /@media \(max-width:\s*900px\)/);
    assert.match(panelCss, /\.booking-menu-catalog-panel::after/);
    assert.match(panelCss, /\.program-icon:focus-visible/);
    assert.match(panelCss, /body\.timeline-dashboard-page \.pinata-mode-section/);
    assert.match(panelCss, /body\.timeline-dashboard-page \.pinata-filler-section select/);
    assert.match(panelCss, /body\.timeline-dashboard-page \.pinata-service-section input/);
    assert.match(responsiveCss, /--booking-footer-space:\s*calc\(32px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
    assert.match(responsiveCss, /width:\s*min\(92vw,\s*680px\)/);
});

test('timeline caches are scoped by business and display mode before booking visibility checks', () => {
    const timelineJs = read('js', 'timeline.js');
    const bookingJs = read('js', 'booking.js');

    assert.match(timelineJs, /function timelineCacheScopeKey/);
    assert.match(timelineJs, /function timelineCacheKeyForDate/);
    assert.match(timelineJs, /getTimelineCacheEntry\(AppState\.cachedLines/);
    assert.match(timelineJs, /getTimelineCacheEntry\(AppState\.cachedBookings/);
    assert.match(timelineJs, /window\.invalidateTimelineDateCache = invalidateTimelineDateCache/);
    assert.doesNotMatch(timelineJs, /AppState\.cachedBookings\[dateStr\]/);
    assert.doesNotMatch(timelineJs, /AppState\.cachedLines\[dateStr\]/);
    assert.match(bookingJs, /createdBookingVisibilityDiagnostics/);
    assert.match(bookingJs, /waitForCreatedBookingBlocks/);
    assert.match(bookingJs, /лінія \$\{lineId\} не відкрита в поточному таймлайні/);
    assert.match(bookingJs, /поза видимим діапазоном/);
    assert.match(bookingJs, /тривалість запису 0 хв/);
    assert.match(bookingJs, /refreshCreatedBookingTimelineSnapshot/);
    assert.match(bookingJs, /previousCachedBookings/);
    assert.match(bookingJs, /preservedBookings/);
    assert.match(bookingJs, /mergedBookingsById/);
    assert.match(bookingJs, /invalidateBookingTimelineDateCache\(currentDate, \{ bookings: false \}\)/);
    assert.match(bookingJs, /getLinesForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(bookingJs, /getBookingsForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(bookingJs, /function createdBookingTimelineProjection/);
    assert.match(bookingJs, /function createdBookingProjectionMatchesCurrentSlice/);
    assert.doesNotMatch(bookingJs, /if \(projection && projection\.visible === false\) return false/);
    assert.match(bookingJs, /lineId \|\| projection\?\.visible === true/);
    assert.match(bookingJs, /серверна проекція не бачить запис/);
    assert.match(bookingJs, /projectionRecoveredIds/);
    assert.match(bookingJs, /setTimelineCacheEntry\(AppState\.cachedBookings, currentDate, snapshot\.bookings\)/);
    assert.match(bookingJs, /bookings: changedDateKey !== selectedDateKey/);
    assert.match(bookingJs, /серверний список дня не повернув запис/);
    assert.match(bookingJs, /createdBookingVisibilityMessage\(createdBookings, timelineSnapshot\)/);
});

test('booking lifecycle actions force fresh day snapshots before mutating the server', () => {
    const bookingJs = read('js', 'booking.js');
    const uiJs = read('js', 'ui.js');

    assert.match(bookingJs, /async function deleteBooking\(bookingId\)[\s\S]*getBookingsForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(bookingJs, /async function shiftBookingTime\(bookingId, minutes\)[\s\S]*getBookingsForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(bookingJs, /async function switchBookingLine\(bookingId, targetLineId\)[\s\S]*getBookingsForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(uiJs, /async function changeBookingStatus\(bookingId, newStatus\)[\s\S]*getBookingsForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(bookingJs, /invalidateBookingTimelineDateCache\(AppState\.selectedDate, \{ lines: false \}\)/);
    assert.match(uiJs, /invalidateTimelineDateCache\(AppState\.selectedDate, \{ lines: false \}\)/);
});

test('booking drawer keeps readable Ukrainian labels for manager-facing controls', () => {
    const bookingJs = read('js', 'booking.js');
    const bookingHtml = read('index.html');

    assert.match(bookingJs, /label: 'Усі'/);
    assert.match(bookingJs, /label: 'Анімація'/);
    assert.match(bookingJs, /label: 'Квести'/);
    assert.match(bookingJs, /label: 'Піньяти'/);
    assert.match(bookingJs, /Скопіювати всю інформацію/);
    assert.match(bookingJs, /Редагувати бронювання/);
    assert.match(bookingJs, /Не вдалося скопіювати/);

    assert.match(bookingHtml, /Оберіть позицію з меню/);
    assert.match(bookingHtml, /Кухня \/ меню/);
    assert.match(bookingHtml, /Додати позицію/);
    assert.match(bookingHtml, /Пошук програми/);
});
