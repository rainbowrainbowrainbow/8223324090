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
    const panelCss = read('css', 'panel.css');
    const responsiveCss = read('css', 'responsive.css');

    [
        'bookingHasEventToggle',
        'bookingKitchenToggle',
        'bookingLeadDetailsToggle',
        'bookingMenuAddBtn',
        'bookingCreateCustomerBtn',
        'bookingSubmitBtn'
    ].forEach(id => assert.match(html, new RegExp(`id="${id}"`), `${id} exists in booking drawer`));

    assert.match(bookingJs, /bookingHasEventToggle'\)\?\.addEventListener\('change'/);
    assert.match(bookingJs, /bookingKitchenToggle'\)\?\.addEventListener\('change'/);
    assert.match(bookingJs, /bookingLeadDetailsToggle'\)\?\.addEventListener\('change'/);
    assert.match(bookingJs, /bookingMenuAddBtn'\)\?\.addEventListener\('click'/);
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
    assert.match(panelCss, /\.program-icon:focus-visible/);
    assert.match(responsiveCss, /--booking-footer-space:\s*calc\(32px \+ env\(safe-area-inset-bottom,\s*0px\)\)/);
    assert.match(responsiveCss, /width:\s*min\(92vw,\s*680px\)/);
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
