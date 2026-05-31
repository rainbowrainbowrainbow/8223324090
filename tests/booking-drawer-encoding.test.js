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
