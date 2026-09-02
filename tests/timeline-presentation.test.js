const test = require('node:test');
const assert = require('node:assert/strict');

const presentation = require('../js/timeline-presentation');

const pinataNumbers = {
    normalize(value) {
        return String(value || '').replace(/^P-/i, '').replace(/^0+/, '') || String(value || '');
    },
    display(value) {
        return this.normalize(value);
    },
    valueFromBooking(booking) {
        return booking.pinataNumber || booking.pinata_number || '';
    },
    isPinataBooking(booking) {
        return booking.category === 'pinata';
    }
};

test('timeline presentation composes category and product code without duplicated prefixes', () => {
    const row = presentation.resolveTimelineActivityPresentation({
        category: 'masterclass',
        timelineCode: 'РЕС',
        label: 'Сумки(75)',
        programName: 'МК Розпис еко-сумок',
        time: '15:00',
        duration: 75,
        room: 'Марвел',
        status: 'confirmed'
    });

    assert.equal(row.categoryCode, 'МК');
    assert.equal(row.productCode, 'РЕС');
    assert.equal(row.compactLabel, 'МК РЕС');
    assert.equal(row.fullLabel, 'МК РЕС: МК Розпис еко-сумок');
    assert.doesNotMatch(row.compactLabel, /МК\s+МК/u);
    assert.match(row.ariaLabel, /Марвел/);
    assert.match(row.ariaLabel, /75 хв/);
});

test('timeline presentation keeps shows explicit, including Mafia', () => {
    const row = presentation.resolveTimelineActivityPresentation({
        category: 'show',
        timelineCode: 'Маф',
        label: 'Мафія(90)',
        programName: 'Мафія',
        time: '16:00',
        duration: 90,
        room: 'Джунглі',
        status: 'preliminary'
    });

    assert.equal(row.categoryCode, 'ШОУ');
    assert.equal(row.productCode, 'Маф');
    assert.equal(row.compactLabel, 'ШОУ Маф');
    assert.match(row.tooltip, /Мафія/);
    assert.match(row.tooltip, /preliminary/);
});

test('timeline presentation gives old quest bookings current catalog code shape', () => {
    const row = presentation.resolveTimelineActivityPresentation({
        category: 'quest',
        timelineCode: '7',
        programCode: 'КВ7',
        label: 'КВ7(60)',
        programName: 'Гра в Кальмара',
        duration: 60
    });

    assert.equal(row.compactLabel, 'КВ 7');
    assert.equal(row.fullLabel, 'КВ 7: Гра в Кальмара');
});

test('timeline presentation uses pinata number dynamically for micro labels', () => {
    const row = presentation.resolveTimelineActivityPresentation({
        category: 'pinata',
        timelineCode: 'STD',
        programCode: 'Пін',
        label: 'Пін(15)',
        programName: 'Піньята',
        pinataMode: 'park',
        pinataNumber: 'P-501',
        duration: 15
    }, null, '', '', { pinataNumbers });

    assert.equal(row.categoryCode, 'П');
    assert.equal(row.productCode, '501');
    assert.equal(row.compactLabel, 'П 501');
    assert.match(row.pinataDetail, /501/);
    assert.equal(row.verticalCompactCode, true);

    assert.deepEqual(presentation.timelineCompactLabelRenderModel(row, 'tiny', '', { zoomLevel: 30 }), {
        label: 'П 501',
        tokens: ['П', '501'],
        characterCount: 5,
        tokenCount: 2,
        maxTokenLength: 3,
        segments: ['П', '5', '0', '1'],
        segmentCount: 4,
        layout: 'characters'
    });
    assert.deepEqual(
        presentation.timelineCompactLabelRenderModel(row, 'tiny', '', { zoomLevel: 15 }).segments,
        ['П', '501']
    );
    assert.equal(
        presentation.timelineCompactLabelRenderModel(row, 'tiny', '', { zoomLevel: 15 }).layout,
        'stacked'
    );
    assert.deepEqual(presentation.timelineCompactLabelRenderModel(row, 'short').segments, ['П', '501']);
    assert.equal(presentation.timelineCompactLabelRenderModel(row, 'short').layout, 'inline');

    const client = presentation.resolveTimelineActivityPresentation({
        category: 'pinata',
        timelineCode: 'STD',
        programName: 'Піньята',
        pinataMode: 'client'
    }, null, '', '', { pinataNumbers });
    assert.equal(client.compactLabel, 'П КЛ');
    assert.deepEqual(
        presentation.timelineCompactLabelRenderModel(client, 'micro', '', { zoomLevel: 60 }).segments,
        ['П', 'К', 'Л']
    );
});

test('timeline presentation collapses the generic custom product to one clear identity', () => {
    const row = presentation.resolveTimelineActivityPresentation({
        category: 'custom',
        timelineCode: 'ІН',
        label: 'Інше(30)',
        programName: 'Інше',
        duration: 30
    });

    assert.equal(row.categoryCode, 'ІНШ');
    assert.equal(row.productCode, 'ІНШЕ');
    assert.equal(row.compactLabel, 'ІНШЕ');
    assert.equal(row.fullLabel, 'ІНШЕ');
    assert.doesNotMatch(row.compactLabel, /ІНШ\s+ІН/u);
});

test('timeline density avoids the old abrupt 44px micro breakpoint', () => {
    assert.equal(presentation.timelineBookingBlockDensity(33), 'micro');
    assert.equal(presentation.timelineBookingBlockDensity(34), 'tiny');
    assert.equal(presentation.timelineBookingBlockDensity(72), 'short');
    assert.equal(presentation.timelineBookingBlockDensity(132), 'medium');
    assert.equal(presentation.timelineBookingBlockDensity(220), 'wide');
});

test('compact label metrics size typography by the longest token instead of total label length', () => {
    assert.deepEqual(presentation.timelineCompactLabelMetrics('П 501'), {
        label: 'П 501',
        tokens: ['П', '501'],
        characterCount: 5,
        tokenCount: 2,
        maxTokenLength: 3
    });
    assert.equal(presentation.timelineCompactLabelMetrics('ШОУ Маф').maxTokenLength, 3);
    assert.equal(presentation.timelineCompactLabelMetrics('МК РЕС').maxTokenLength, 3);
});
