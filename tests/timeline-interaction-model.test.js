const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../js/timeline-interaction-model');

function booking(overrides = {}) {
    return {
        id: overrides.id || 'BK-1',
        date: '2026-05-26',
        time: overrides.time || '14:00',
        duration: overrides.duration || 60,
        lineId: overrides.lineId || 'line-1',
        label: overrides.label || 'Booking',
        programCode: overrides.programCode || 'PRG',
        linkedTo: overrides.linkedTo || null,
        status: overrides.status || 'confirmed'
    };
}

test('drag intent moves main booking across lines and shifts linked bookings from one model', () => {
    const main = booking({ id: 'BK-main', time: '14:00', lineId: 'line-1' });
    const linked = booking({ id: 'BK-linked', time: '14:15', lineId: 'line-2', linkedTo: 'BK-main' });

    const intent = model.buildDragInteractionIntent({
        draggedBooking: main,
        allBookings: [main, linked],
        startMin: 14 * 60,
        currentMin: 15 * 60,
        startLineId: 'line-1',
        targetLineId: 'line-3'
    });
    const payload = model.buildDragAtomicPayload(intent);

    assert.equal(intent.mainId, 'BK-main');
    assert.equal(payload.main.time, '15:00');
    assert.equal(payload.main.lineId, 'line-3');
    assert.deepEqual(payload.linked, [{ id: 'BK-linked', time: '15:15' }]);
});

test('drag intent targets main atomic endpoint when a linked booking is dragged across lines', () => {
    const main = booking({ id: 'BK-main', time: '14:00', lineId: 'line-1' });
    const linked = booking({ id: 'BK-linked', time: '14:15', lineId: 'line-2', linkedTo: 'BK-main' });

    const intent = model.buildDragInteractionIntent({
        draggedBooking: linked,
        allBookings: [main, linked],
        startMin: 14 * 60 + 15,
        currentMin: 15 * 60 + 15,
        startLineId: 'line-2',
        targetLineId: 'line-4'
    });
    const payload = model.buildDragAtomicPayload(intent);

    assert.equal(intent.mainBooking.id, 'BK-main');
    assert.equal(payload.main.time, '15:00');
    assert.deepEqual(payload.linked, [{ id: 'BK-linked', time: '15:15', lineId: 'line-4' }]);
});

test('candidate conflict evaluation checks linked actor target lines, not only the main booking', () => {
    const main = booking({ id: 'BK-main', time: '14:00', lineId: 'line-1' });
    const linked = booking({ id: 'BK-linked', time: '14:15', lineId: 'line-2', linkedTo: 'BK-main' });
    const blocker = booking({ id: 'BK-blocker', time: '15:00', lineId: 'line-4', label: 'Blocker' });

    const intent = model.buildDragInteractionIntent({
        draggedBooking: linked,
        allBookings: [main, linked, blocker],
        startMin: 14 * 60 + 15,
        currentMin: 15 * 60 + 15,
        startLineId: 'line-2',
        targetLineId: 'line-4'
    });
    const result = model.evaluateTimelineCandidateConflicts(intent, [main, linked, blocker], {
        dayStartMin: 12 * 60,
        dayEndMin: 20 * 60
    });

    assert.equal(result.valid, false);
    assert.equal(result.type, 'overlap');
    assert.equal(result.conflictBooking.id, 'BK-blocker');
    assert.equal(result.candidate.id, 'BK-linked');
});

test('resize intent updates the whole linked group and excludes siblings from conflicts', () => {
    const main = booking({ id: 'BK-main', time: '14:00', lineId: 'line-1', duration: 60 });
    const linked = booking({ id: 'BK-linked', time: '14:15', lineId: 'line-2', linkedTo: 'BK-main', duration: 60 });

    const intent = model.buildResizeInteractionIntent({
        booking: main,
        allBookings: [main, linked],
        newDuration: 90
    });
    const payload = model.buildResizeAtomicPayload(intent);
    const result = model.evaluateTimelineCandidateConflicts(intent, [main, linked], {
        dayStartMin: 12 * 60,
        dayEndMin: 20 * 60
    });

    assert.deepEqual(payload.main, { duration: 90 });
    assert.deepEqual(payload.linked, [{ id: 'BK-linked', duration: 90 }]);
    assert.equal(result.valid, true);
});

test('drag undo snapshot preserves old and new linked positions', () => {
    const main = booking({ id: 'BK-main', time: '14:00', lineId: 'line-1' });
    const linked = booking({ id: 'BK-linked', time: '14:15', lineId: 'line-2', linkedTo: 'BK-main' });

    const intent = model.buildDragInteractionIntent({
        draggedBooking: linked,
        allBookings: [main, linked],
        startMin: 14 * 60 + 15,
        currentMin: 15 * 60 + 15,
        startLineId: 'line-2',
        targetLineId: 'line-4'
    });
    const snapshot = model.buildDragUndoSnapshot(intent);

    assert.equal(snapshot.bookingId, 'BK-main');
    assert.equal(snapshot.oldTime, '14:00');
    assert.equal(snapshot.newTime, '15:00');
    assert.deepEqual(snapshot.linked, [{
        id: 'BK-linked',
        oldTime: '14:15',
        oldLineId: 'line-2',
        newTime: '15:15',
        newLineId: 'line-4'
    }]);
});
