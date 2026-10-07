'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../js/analytics-page.js'), 'utf8');

function fixture(t) {
    const dom = new JSDOM(`<!doctype html><html><body>
        <section class="an-chart-container"><div id="weekdayChart"></div></section>
        <section class="an-chart-container"><div id="segmentsChart"></div></section>
        <div id="dealsLifecycleContent"></div>
    </body></html>`, { runScripts: 'outside-only', url: 'http://localhost/finance' });
    t.after(() => dom.window.close());
    dom.window.eval(source);
    return { document: dom.window.document, widgets: dom.window.CrmAnalyticsWidgets };
}

function weekdayValues(document) {
    return [...document.querySelectorAll('#weekdayChart [data-weekday]')].map(group => ({
        day: Number(group.dataset.weekday),
        name: group.querySelector('.an-bar-label').textContent,
        count: group.querySelector('.an-weekday-count').textContent,
        height: Number.parseFloat(group.querySelector('.an-bar').style.height)
    }));
}

test('weekday chart orders SQL days Monday to Sunday and fills missing days with real zeros', t => {
    const { document, widgets } = fixture(t);
    widgets.renderWeekdayChart([
        { dow: 0, count: 10000 },
        { dow: '3', count: '5' },
        { dow: 1, count: 10 }
    ]);
    const rows = weekdayValues(document);
    assert.deepEqual(rows.map(row => row.day), [1, 2, 3, 4, 5, 6, 0]);
    assert.deepEqual(rows.map(row => row.name), ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']);
    assert.deepEqual(rows.slice(0, 6).map(row => row.count), ['10', '0', '5', '0', '0', '0']);
    assert.equal(rows[1].height, 0, 'missing Tuesday must not have a positive bar');
    assert.equal(rows[6].height, 100, 'all days use one common scale');
    assert.ok(rows.every(row => Number.isFinite(row.height) && row.height >= 0 && row.height <= 100));
    const chart = document.getElementById('weekdayChart');
    assert.ok(chart.classList.contains('an-bar-chart--weekday'), 'shared renderer repairs bare host markup');
    assert.equal(chart.querySelector('[data-weekday="3"]').getAttribute('aria-label'), 'Середа: 5 бронювань');
});

test('weekday chart supports existing name-only fixtures and aggregates repeated day rows', t => {
    const { document, widgets } = fixture(t);
    widgets.renderWeekdayChart([
        { name: 'Субота', count: 4 },
        { name: 'Пт', count: 2 },
        { name: "п'ятниця", count: 3 }
    ]);
    const rows = weekdayValues(document);
    assert.equal(rows[4].count, '5');
    assert.equal(rows[5].count, '4');
    assert.equal(rows[0].count, '0');
});

test('empty successful weekday result shows seven zeros and clears prior values/readout', t => {
    const { document, widgets } = fixture(t);
    widgets.renderWeekdayChart([{ dow: 1, count: 4 }]);
    document.getElementById('weekdayChart').insertAdjacentHTML('afterend', '<div class="an-chart-readout" data-chart="weekdayLoad">Old data</div>');
    widgets.renderWeekdayChart([]);
    const rows = weekdayValues(document);
    assert.equal(rows.length, 7);
    assert.ok(rows.every(row => row.count === '0' && row.height === 0));
    assert.equal(document.querySelector('.an-weekday-note').textContent, 'За обраний період бронювань немає.');
    assert.equal(document.querySelector('[data-chart="weekdayLoad"]'), null);
    widgets.renderWeekdayChart([{ dow: 2, count: 2 }]);
    assert.equal(document.querySelector('.an-weekday-note'), null);
});

test('missing or invalid weekday data is unavailable instead of fabricated zero totals', t => {
    const { document, widgets } = fixture(t);
    for (const input of [null, undefined, {}, [{ dow: 8, count: 2 }], [{ dow: 1, count: -1 }], [{ dow: 1, count: 'oops' }], [{ dow: 1, count: ' ' }], [{ dow: 1, count: true }], [{ name: '<img src=x>', count: 1 }]]) {
        widgets.renderWeekdayChart(input);
        assert.equal(weekdayValues(document).length, 0);
        assert.match(document.getElementById('weekdayChart').textContent, /недоступні/);
        assert.equal(document.querySelector('img'), null);
    }
});

test('segments keep content-sized card behavior in both populated and empty states', t => {
    const { document, widgets } = fixture(t);
    widgets.renderSegments({ total: 6, champions: 1, loyal: 2, potential: 3 });
    const chart = document.getElementById('segmentsChart');
    assert.ok(chart.parentElement.classList.contains('an-chart-container--compact'));
    assert.equal(chart.querySelectorAll('.an-segment').length, 4);
    assert.equal(chart.querySelector('.an-segment-total').textContent, 'Всього: 6 клієнтів');
    widgets.renderSegments({ total: 0 });
    assert.equal(chart.querySelectorAll('.an-segment').length, 0);
    assert.match(chart.textContent, /Немає даних/);
});

test('snapshot deal counters and dates do not present a lifecycle conversion', t => {
    const { document, widgets } = fixture(t);
    for (const meta of [undefined, { reportability: 'snapshot-only' }, { stageTimestampTruth: false }]) {
        widgets.renderDealsLifecycle({
            accepted: 5, closed: 12, conversionRatio: 240, meta,
            period: { from: '2026-10-01', to: '2026-10-07' },
            trend: [{ date: '2026-10-03', accepted: 5, closed: 12 }]
        });
        const chart = document.getElementById('dealsLifecycleContent');
        assert.deepEqual([...chart.querySelectorAll('.an-kpi-value')].map(el => el.textContent), ['5', '12']);
        assert.doesNotMatch(chart.textContent, /240%/);
        assert.match(chart.textContent, /Історична конверсія поки недоступна/);
        assert.match(chart.textContent, /Поточні статуси за датою угоди/);
        assert.match(chart.textContent, /не за часом переходу між статусами/);
    }
});

test('shared weekday and segment renderers tolerate unmounted host elements', t => {
    const { document, widgets } = fixture(t);
    document.getElementById('weekdayChart').remove();
    document.getElementById('segmentsChart').remove();
    assert.doesNotThrow(() => widgets.renderWeekdayChart([]));
    assert.doesNotThrow(() => widgets.renderSegments({ total: 0 }));
});
