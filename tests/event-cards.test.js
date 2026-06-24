const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    EVENT_CARD_BASE_PATH,
    getEventCard,
    getEventCardFile,
    getEventCardMeta,
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
    assert.equal(getEventCardFile({ category: 'graduation', title: 'Випускний' }), 'event-card-holiday-party.png');
    assert.equal(getEventCard({}), '/images/event-cards/event-card-holiday-party.png');
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

test('event card resolver is wired into event UI surfaces', () => {
    assertScriptBefore('index.html', 'js/event-cards.js', 'js/booking.js');
    assertScriptBefore('programs.html', 'js/event-cards.js', 'js/programs-page.js');
    assertScriptBefore('leads.html', 'js/event-cards.js', 'js/leads-page.js');
    assertScriptBefore('afisha.html', 'js/event-cards.js', 'js/afisha-page.js');

    const pagesCss = readProjectFile('css', 'pages.css');
    assert.match(pagesCss, /\.event-card-visual\s*\{/);
    assert.match(pagesCss, /aspect-ratio:\s*16\s*\/\s*9/);
    assert.match(pagesCss, /\.event-card-visual img\s*\{[\s\S]*object-fit:\s*cover/);

    assert.match(readProjectFile('js', 'programs-page.js'), /renderProgramEventCardVisual\(p\)/);
    assert.match(readProjectFile('js', 'afisha-page.js'), /renderAfishaEventCardVisual\(item,\s*'compact'\)/);
    assert.match(readProjectFile('js', 'afisha-page.js'), /renderAfishaEventCardVisual\(item,\s*'workspace'\)/);
    assert.match(readProjectFile('js', 'leads-page.js'), /renderLeadEventCardVisual\(l,\s*'compact'\)/);
    assert.match(readProjectFile('js', 'leads-page.js'), /renderLeadEventCardVisual\(lead,\s*'workspace'\)/);
    assert.match(readProjectFile('js', 'booking.js'), /renderBookingEventCardVisual\(bookingEventCardRecord\)/);
});
