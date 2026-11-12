'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseAfishaImport } = require('../services/afishaImport');

test('expands dates and repeated days only within the selected month', () => {
    const result = parseAfishaImport({
        month: '2028-02',
        text: '29;16:00;Майстер-клас;45\nвихідні;12:00;Шоу\n29;16:00;Майстер-клас;45'
    });

    assert.deepEqual(result.items.map(item => item.date), [
        '2028-02-05', '2028-02-06', '2028-02-12', '2028-02-13',
        '2028-02-19', '2028-02-20', '2028-02-26', '2028-02-27', '2028-02-29'
    ]);
    assert.equal(result.items[0].duration, 60);
    assert.equal(result.items.at(-1).duration, 45);
    assert.equal(result.repeated, 1);
});

test('accepts Afisha CSV exports with a header, escaped quotes, and multiline fields', () => {
    const result = parseAfishaImport({
        text: '\uFEFFdate;time;duration;title;description;type\r\n'
            + '"2026-12-05";"16:00";"15";"Вітання; ""Парк""";"Перша лінія\r\nДруга лінія";"greeting"'
    });
    assert.deepEqual(result.items, [{
        date: '2026-12-05', time: '16:00', title: 'Вітання; "Парк"',
        duration: 15, type: 'greeting', description: 'Перша лінія\nДруга лінія'
    }]);
});

test('timeline lines starting with a time use the selected date', () => {
    const { items } = parseAfishaImport({
        month: '2026-12', date: '2026-12-11', text: '14:00;Шоу\n16:00;Майстер-клас;45\n12;12:00;Квест'
    });
    assert.deepEqual(items.map(({ date, time, duration }) => [date, time, duration]), [
        ['2026-12-11', '14:00', 60], ['2026-12-11', '16:00', 45], ['2026-12-12', '12:00', 60]
    ]);
    assert.throws(() => parseAfishaImport({ text: '14:00;Шоу' }),
        { statusCode: 400, message: /Рядок 1.*Оберіть дату/ });
});

test('reports invalid rows and bounds expanded schedules', () => {
    assert.throws(() => parseAfishaImport({
        month: '2026-02', text: '5;16:00;Шоу\n\n29;16:00;Майстер-клас'
    }), { statusCode: 400, message: /Рядок 3.*Такого дня/ });
    assert.throws(() => parseAfishaImport({ month: '2026-12', text: '5;25:00;Шоу' }),
        { statusCode: 400, message: /Рядок 1.*час/ });
    assert.throws(() => parseAfishaImport({ month: '2026-12', text: '5;10:00;"Шоу' }),
        { statusCode: 400, message: /Рядок 1.*лапки/ });
    assert.throws(() => parseAfishaImport({
        month: '2026-12', text: 'щодня;16:00;Шоу\n'.repeat(10)
    }), { statusCode: 400, message: /до 300 подій/ });
});
