const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');

const {
    EVENT_CARD_BASE_PATH,
    getEventCard,
    getEventCardFile,
    getEventCardMeta,
    renderEventCardImage,
    resolveEventCardKey
} = require('../js/event-cards');

const ROOT = path.join(__dirname, '..');

function readProjectFile(...parts) {
    return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function assertScriptBefore(htmlFile, dependency, consumer) {
    const html = readProjectFile(htmlFile);
    const dependencyIndex = html.indexOf(dependency);
    const consumerIndex = html.indexOf(consumer);

    assert.ok(dependencyIndex >= 0, `${htmlFile} loads ${dependency}`);
    assert.ok(consumerIndex >= 0, `${htmlFile} loads ${consumer}`);
    assert.ok(dependencyIndex < consumerIndex, `${htmlFile} loads ${dependency} before ${consumer}`);
}

test('event card resolver exposes stable public image paths', () => {
    const meta = getEventCardMeta({ category: 'quest' });

    assert.equal(EVENT_CARD_BASE_PATH, '/images/event-cards/');
    assert.equal(meta.key, 'quest');
    assert.equal(meta.file, 'event-card-quest.png');
    assert.equal(meta.src, '/images/event-cards/event-card-quest.png');
    assert.equal(getEventCard({ category: 'quest' }), meta.src);
    assert.equal(getEventCardFile({ category: 'quest' }), meta.file);
});

test('event card resolver maps all six planned event card scenarios', () => {
    const cases = [
        [{ title: 'Квест: пошук скарбів' }, 'quest', 'event-card-quest.png'],
        [{ name: 'Шоу-програма з аніматорами' }, 'show-program', 'event-card-show-program.png'],
        [{ description: 'Творчий майстер-клас hand-made' }, 'workshop', 'event-card-workshop.png'],
        [{ qualityCategory: 'family', notes: 'Сімейне свято' }, 'family-event', 'event-card-family-event.png'],
        [{ eventType: 'corporate', title: 'VIP закрита вечірка' }, 'private-party', 'event-card-private-party.png'],
        [{ type: 'birthday', title: 'День народження' }, 'holiday-party', 'event-card-holiday-party.png']
    ];

    cases.forEach(([event, key, file]) => {
        assert.equal(resolveEventCardKey(event), key);
        assert.equal(getEventCardFile(event), file);
        assert.equal(getEventCard(event), `/images/event-cards/${file}`);
    });
});

test('event card resolver falls back to holiday card for unknown or empty data', () => {
    assert.equal(resolveEventCardKey({}), 'holiday-party');
    assert.equal(getEventCardFile({ category: 'unknown-event-type', title: 'Unmapped service' }), 'event-card-holiday-party.png');
    assert.equal(getEventCard({}), '/images/event-cards/event-card-holiday-party.png');
});

test('event card renderer keeps shared image markup stable', () => {
    const html = renderEventCardImage(
        { category: 'quest', title: 'Quest <demo>' },
        { modifier: 'compact', alt: 'Custom "alt"', className: 'qa-class' }
    );

    assert.match(html, /class="event-card-visual event-card-visual--compact qa-class"/);
    assert.match(html, /src="\/images\/event-cards\/event-card-quest\.png"/);
    assert.match(html, /alt="Custom &quot;alt&quot;"/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /decoding="async"/);

    const fallbackHtml = renderEventCardImage({ type: 'unknown-event-type' }, { modifier: 'booking' });
    assert.match(fallbackHtml, /class="event-card-visual event-card-visual--booking"/);
    assert.match(fallbackHtml, /src="\/images\/event-cards\/event-card-holiday-party\.png"/);
});

test('event card visual smoke renders DOM image without production data', () => {
    const dom = new JSDOM(`<main>${renderEventCardImage({ title: 'Mystery quest' }, { modifier: 'workspace' })}</main>`);
    const img = dom.window.document.querySelector('.event-card-visual.event-card-visual--workspace img');

    assert.ok(img, 'event-card visual image exists');
    assert.equal(img.getAttribute('src'), '/images/event-cards/event-card-quest.png');
    assert.equal(img.getAttribute('loading'), 'lazy');
    assert.equal(img.getAttribute('decoding'), 'async');
    assert.ok(img.getAttribute('alt'), 'event-card visual has alt text');
    dom.window.close();

    const fallbackDom = new JSDOM(`<main>${renderEventCardImage({ type: 'unknown-event-type' })}</main>`);
    const fallbackImg = fallbackDom.window.document.querySelector('.event-card-visual img');

    assert.ok(fallbackImg, 'fallback event-card visual image exists');
    assert.equal(fallbackImg.getAttribute('src'), '/images/event-cards/event-card-holiday-party.png');
    fallbackDom.window.close();
});

test('event card resolver covers requested card assignments without DOM or server data', () => {
    const cases = [
        ['квест', { title: 'Квест: пошук скарбів' }, 'quest', 'event-card-quest.png'],
        ['шоу-програма', { title: 'Шоу-програма з аніматорами' }, 'show-program', 'event-card-show-program.png'],
        ['майстер-клас', { title: 'Майстер-клас hand-made' }, 'workshop', 'event-card-workshop.png'],
        ['сімейне свято', { title: 'Сімейне свято' }, 'family-event', 'event-card-family-event.png'],
        ['приватна вечірка', { title: 'Приватна вечірка VIP' }, 'private-party', 'event-card-private-party.png'],
        ['день народження', { title: 'День народження' }, 'holiday-party', 'event-card-holiday-party.png'],
        ['невідомий тип', { type: 'unknown-event-type' }, 'holiday-party', 'event-card-holiday-party.png']
    ];

    cases.forEach(([label, event, key, file]) => {
        assert.equal(resolveEventCardKey(event), key, label);
        assert.equal(getEventCardFile(event), file, label);
        assert.equal(getEventCard(event), `/images/event-cards/${file}`, label);
    });
});

test('event card resolver reads existing CRM field variants and nested payloads', () => {
    assert.equal(getEventCardFile({ program_name: 'Детективна програма' }), 'event-card-quest.png');
    assert.equal(getEventCardFile({ programCode: 'SHOW-01', label: 'Bubble show' }), 'event-card-show-program.png');
    assert.equal(getEventCardFile({ quality_category: 'corporate' }), 'event-card-private-party.png');
    assert.equal(getEventCardFile({ extraData: { bookingPackage: { title: 'Craft workshop' } } }), 'event-card-workshop.png');
    assert.equal(getEventCardFile({ extra_data: JSON.stringify({ inbound: { topic: 'family session' } }) }), 'event-card-family-event.png');
});

test('event card resolver covers real CRM catalog and lead values', () => {
    const cases = [
        ['catalog quest code', { category: 'custom', programCode: 'КВ1', programName: 'Легендарний тренд' }, 'quest', 'event-card-quest.png'],
        ['animation program code', { category: 'custom', programCode: 'АН(60)', programName: 'Анімація 60хв' }, 'show-program', 'event-card-show-program.png'],
        ['additional host program name', { programName: 'Додатковий ведучий', programCode: '+Вед' }, 'show-program', 'event-card-show-program.png'],
        ['catalog masterclass name', { category: 'custom', programName: 'МК Браслети' }, 'workshop', 'event-card-workshop.png'],
        ['education booking category', { category: 'education', title: 'Заняття 45 хв' }, 'workshop', 'event-card-workshop.png'],
        ['lead graduation quality category', { quality_category: 'graduation', title: 'Випускний' }, 'family-event', 'event-card-family-event.png'],
        ['lead trip quality category', { quality_category: 'trip', notes: 'Виїзд до клієнта' }, 'family-event', 'event-card-family-event.png'],
        ['afisha regular type', { type: 'regular', title: 'Щотижнева казка' }, 'holiday-party', 'event-card-holiday-party.png'],
        ['pinata catalog category', { category: 'pinata', programName: 'Піньята PRO' }, 'holiday-party', 'event-card-holiday-party.png'],
        ['photo catalog category', { category: 'photo', programName: 'Фотосесія + магніти' }, 'holiday-party', 'event-card-holiday-party.png'],
        ['birthday note shorthand', { notes: 'ДР Максима' }, 'holiday-party', 'event-card-holiday-party.png'],
        ['unknown custom value', { category: 'custom', programName: 'Unknown service' }, 'holiday-party', 'event-card-holiday-party.png']
    ];

    cases.forEach(([label, event, key, file]) => {
        assert.equal(resolveEventCardKey(event), key, label);
        assert.equal(getEventCardFile(event), file, label);
        assert.equal(getEventCard(event), `/images/event-cards/${file}`, label);
    });
});

test('event card resolver is wired into event UI surfaces', () => {
    assertScriptBefore('index.html', 'js/event-cards.js', 'js/booking.js');
    assertScriptBefore('programs.html', 'js/event-cards.js', 'js/programs-page.js');
    assertScriptBefore('leads.html', 'js/event-cards.js', 'js/leads-page.js');
    assertScriptBefore('afisha.html', 'js/event-cards.js', 'js/afisha-page.js');

    const pagesCss = readProjectFile('css', 'pages.css');
    assert.match(pagesCss, /\.event-card-visual\s*\{/);
    assert.match(pagesCss, /aspect-ratio:\s*16\s*\/\s*9/);
    assert.match(pagesCss, /\.event-card-visual img\s*\{[\s\S]*object-fit:\s*cover/);

    const eventCardsJs = readProjectFile('js', 'event-cards.js');
    assert.match(eventCardsJs, /function renderEventCardImage\(event = \{\}, options = \{\}\)/);
    assert.match(eventCardsJs, /loading="\$\{loading\}"/);
    assert.match(eventCardsJs, /decoding="\$\{decoding\}"/);

    assert.match(readProjectFile('js', 'programs-page.js'), /window\.EventCards\.renderEventCardImage\(p\)/);
    assert.match(readProjectFile('js', 'afisha-page.js'), /window\.EventCards\.renderEventCardImage\(item,\s*\{\s*modifier:\s*'compact'\s*\}\)/);
    assert.match(readProjectFile('js', 'afisha-page.js'), /window\.EventCards\.renderEventCardImage\(item,\s*\{\s*modifier:\s*'workspace'\s*\}\)/);
    assert.match(readProjectFile('js', 'leads-page.js'), /window\.EventCards\.renderEventCardImage\(l,\s*\{\s*modifier:\s*'compact'\s*\}\)/);
    assert.match(readProjectFile('js', 'leads-page.js'), /window\.EventCards\.renderEventCardImage\(lead,\s*\{\s*modifier:\s*'workspace'\s*\}\)/);
    assert.match(readProjectFile('js', 'booking.js'), /window\.EventCards\.renderEventCardImage\(bookingEventCardRecord,\s*\{\s*modifier:\s*'booking'\s*\}\)/);

    [
        ['js', 'programs-page.js'],
        ['js', 'afisha-page.js'],
        ['js', 'leads-page.js'],
        ['js', 'booking.js']
    ].forEach(parts => {
        const source = readProjectFile(...parts);
        assert.doesNotMatch(source, /function render(?:Program|Afisha|Lead|Booking)EventCardVisual/);
        assert.doesNotMatch(source, /function get(?:Program|Afisha|Lead|Booking)EventCardMeta/);
    });
});
