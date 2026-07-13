const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../js/timeline-interaction-model');
const banquetConflictMatrix = require('./fixtures/banquet-conflict-matrix');

function booking(overrides = {}) {
    return {
        id: overrides.id || 'BK-1',
        date: '2026-05-26',
        time: overrides.time || '14:00',
        duration: overrides.duration || 60,
        lineId: overrides.lineId || 'line-1',
        label: overrides.label || 'Booking',
        programCode: overrides.programCode || 'PRG',
        room: overrides.room || 'Room A',
        linkedTo: overrides.linkedTo || null,
        status: overrides.status || 'confirmed',
        ...overrides
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

test('room drag changes room only and keeps animator line ids untouched', () => {
    const main = booking({ id: 'BK-main', time: '14:00', lineId: 'line-1', room: 'Room A' });
    const linked = booking({ id: 'BK-linked', time: '14:15', lineId: 'line-2', room: 'Room A', linkedTo: 'BK-main' });

    const intent = model.buildDragInteractionIntent({
        draggedBooking: main,
        allBookings: [main, linked],
        startMin: 14 * 60,
        currentMin: 14 * 60 + 30,
        startLineId: 'Room A',
        targetLineId: 'Room B',
        assignmentMode: 'room',
        startRoom: 'Room A',
        targetRoom: 'Room B'
    });
    const payload = model.buildDragAtomicPayload(intent);
    const snapshot = model.buildDragUndoSnapshot(intent);
    const undoPayload = model.buildDragUndoAtomicPayload(snapshot, { ...main, time: '14:30', room: 'Room B' });

    assert.equal(intent.mainCandidate.next.lineId, 'line-1');
    assert.equal(intent.mainCandidate.next.room, 'Room B');
    assert.equal(intent.assignmentMode, 'room');
    assert.equal(intent.targetRoom, 'Room B');
    assert.equal(intent.sourceBookingId, 'BK-main');
    assert.deepEqual(payload.main, { time: '14:30', room: 'Room B' });
    assert.deepEqual(payload.linked, [{ id: 'BK-linked', time: '14:45', room: 'Room B' }]);
    assert.deepEqual(undoPayload.main, { time: '14:00', room: 'Room A' });
    assert.deepEqual(undoPayload.linked, [{ id: 'BK-linked', time: '14:15', room: 'Room A' }]);
});

for (const scenario of banquetConflictMatrix) {
    test(`client banquet conflict matrix: ${scenario.name}`, () => {
        const candidate = booking({
            id: 'BK-candidate',
            time: '14:00',
            room: scenario.candidate.room || 'Room A',
            ...scenario.candidate
        });
        const conflict = booking({
            id: 'BK-conflict',
            time: '14:15',
            room: scenario.conflict.room || 'Room A',
            ...scenario.conflict
        });
        const intent = model.buildDragInteractionIntent({
            draggedBooking: candidate,
            allBookings: [candidate, conflict],
            startMin: 14 * 60,
            currentMin: 14 * 60,
            startLineId: candidate.room,
            targetLineId: candidate.room,
            assignmentMode: 'room',
            startRoom: candidate.room,
            targetRoom: candidate.room
        });
        const result = model.evaluateTimelineCandidateConflicts(intent, [candidate, conflict]);

        assert.equal(result.valid, scenario.expected === 'allow', scenario.name);
        if (scenario.expected === 'block') assert.equal(result.conflictBooking.id, 'BK-conflict');
    });
}

test('client defers a potentially legal banquet overlap when group metadata is incomplete', () => {
    const candidate = booking({ id: 'BK-candidate', category: 'animation', room: 'Room A' });
    const conflict = booking({ id: 'BK-conflict', category: 'kitchen', programCode: 'KITCHEN', room: 'Room A' });
    const intent = model.buildDragInteractionIntent({
        draggedBooking: candidate,
        allBookings: [candidate, conflict],
        assignmentMode: 'room',
        startRoom: 'Room A',
        targetRoom: 'Room A'
    });
    const result = model.evaluateTimelineCandidateConflicts(intent, [candidate, conflict]);

    assert.equal(result.valid, true);
    assert.equal(result.deferredToServer, true);
});

test('room drag conflict evaluation checks room overlaps, not line overlaps', () => {
    const main = booking({ id: 'BK-main', time: '14:00', lineId: 'line-1', room: 'Room A' });
    const linked = booking({ id: 'BK-linked', time: '14:15', lineId: 'line-2', room: 'Room A', linkedTo: 'BK-main' });
    const blocker = booking({ id: 'BK-blocker', time: '14:30', lineId: 'line-99', room: 'Room B', label: 'Blocker' });

    const intent = model.buildDragInteractionIntent({
        draggedBooking: main,
        allBookings: [main, linked, blocker],
        startMin: 14 * 60,
        currentMin: 14 * 60 + 30,
        startLineId: 'Room A',
        targetLineId: 'Room B',
        assignmentMode: 'room',
        startRoom: 'Room A',
        targetRoom: 'Room B'
    });
    const result = model.evaluateTimelineCandidateConflicts(intent, [main, linked, blocker], {
        dayStartMin: 12 * 60,
        dayEndMin: 20 * 60
    });

    assert.equal(result.valid, false);
    assert.equal(result.type, 'overlap');
    assert.equal(result.conflictBooking.id, 'BK-blocker');
    assert.equal(result.candidate.id, 'BK-main');
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

test('resize intent rejects a newly occupied target window', () => {
    const main = booking({ id: 'BK-main', time: '14:00', lineId: 'line-1', duration: 60 });
    const blocker = booking({ id: 'BK-blocker', time: '15:10', lineId: 'line-1', duration: 30 });

    const intent = model.buildResizeInteractionIntent({
        booking: main,
        allBookings: [main, blocker],
        newDuration: 90
    });
    const result = model.evaluateTimelineCandidateConflicts(intent, [main, blocker], {
        dayStartMin: 12 * 60,
        dayEndMin: 20 * 60
    });

    assert.equal(result.valid, false);
    assert.equal(result.type, 'overlap');
    assert.equal(result.conflictBooking.id, 'BK-blocker');
    assert.equal(result.candidate.id, 'BK-main');
});

test('room resize checks the physical room and carries banquet authorization metadata', () => {
    const activity = booking({
        id: 'BK-activity',
        lineId: 'animator-1',
        room: 'Room A',
        category: 'animation',
        banquetGroupId: 'BG-1',
        banquetGroupRole: 'activity'
    });
    const roomBlocker = booking({
        id: 'BK-blocker',
        time: '14:45',
        lineId: 'animator-99',
        room: 'Room A',
        category: 'animation',
        banquetGroupId: 'BG-2',
        banquetGroupRole: 'activity'
    });
    const intent = model.buildResizeInteractionIntent({
        booking: activity,
        allBookings: [activity, roomBlocker],
        newDuration: 90,
        assignmentMode: 'room',
        targetRoom: 'Room A'
    });
    const result = model.evaluateTimelineCandidateConflicts(intent, [activity, roomBlocker]);

    assert.equal(intent.assignmentMode, 'room');
    assert.equal(intent.targetRoom, 'Room A');
    assert.equal(intent.banquetGroupId, 'BG-1');
    assert.equal(intent.bookingRole, 'activity');
    assert.equal(intent.sourceBookingId, 'BK-activity');
    assert.equal(result.valid, false);
    assert.equal(result.conflictBooking.id, 'BK-blocker');
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

test('drag undo snapshot uses persisted saved rows when server result is available', () => {
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
    const snapshot = model.buildDragUndoSnapshot(intent, {
        booking: { ...main, time: '15:00', lineId: 'line-1' },
        linkedBookings: [{ ...linked, time: '15:15', lineId: 'line-4' }]
    });
    const payload = model.buildDragUndoAtomicPayload(snapshot, { ...main, time: '15:00' });

    assert.equal(snapshot.newTime, '15:00');
    assert.equal(snapshot.linked[0].newLineId, 'line-4');
    assert.deepEqual(payload.main, { time: '14:00', lineId: 'line-1' });
    assert.deepEqual(payload.linked, [{ id: 'BK-linked', time: '14:15', lineId: 'line-2' }]);
    assert.equal(payload.historyAction, 'undo_drag');
});

test('drag change summary includes time and host line reassignment from the same canonical intent', () => {
    const main = booking({ id: 'BK-main', time: '14:00', lineId: 'line-1', label: 'КВ1(60)' });
    const linked = booking({ id: 'BK-linked', time: '14:15', lineId: 'line-2', linkedTo: 'BK-main', label: '+Вед(60)' });

    const intent = model.buildDragInteractionIntent({
        draggedBooking: linked,
        allBookings: [main, linked],
        startMin: 14 * 60 + 15,
        currentMin: 14 * 60 + 10,
        startLineId: 'line-2',
        targetLineId: 'line-4'
    });
    const changeSet = model.buildDragChangeSet(intent);
    const summary = model.formatDragChangeSummary(changeSet, {
        assignmentLabel: 'ведучого',
        lineNames: {
            'line-2': 'Анна',
            'line-4': 'Діана'
        }
    });

    assert.deepEqual(changeSet.changedFields, ['time', 'line']);
    assert.deepEqual(changeSet.lineChanges, [{
        id: 'BK-linked',
        bookingId: 'BK-linked',
        bookingLabel: '+Вед(60)',
        isMain: false,
        isDragged: true,
        oldLineId: 'line-2',
        newLineId: 'line-4'
    }]);
    assert.equal(summary, '+Вед(60) перенесено на -5 хв, змінили ведучого з Анна на Діана');
});

test('drag change summary keeps time-only moves compact', () => {
    const main = booking({ id: 'BK-main', time: '14:00', lineId: 'line-1', label: 'АН(60)' });
    const intent = model.buildDragInteractionIntent({
        draggedBooking: main,
        allBookings: [main],
        startMin: 14 * 60,
        currentMin: 14 * 60 + 30,
        startLineId: 'line-1',
        targetLineId: 'line-1'
    });
    const summary = model.formatDragChangeSummary(model.buildDragChangeSet(intent), {
        assignmentLabel: 'ведучого',
        lineNames: { 'line-1': 'Анна' }
    });

    assert.equal(summary, 'АН(60) перенесено на +30 хв');
});

test('resize undo snapshot and payload use persisted saved duration', () => {
    const main = booking({ id: 'BK-main', time: '14:00', lineId: 'line-1', duration: 60 });
    const linked = booking({ id: 'BK-linked', time: '14:15', lineId: 'line-2', linkedTo: 'BK-main', duration: 60 });

    const intent = model.buildResizeInteractionIntent({
        booking: main,
        allBookings: [main, linked],
        newDuration: 90
    });
    const snapshot = model.buildResizeUndoSnapshot(intent, {
        booking: { ...main, duration: 90 },
        linkedBookings: [{ ...linked, duration: 90 }]
    });
    const payload = model.buildResizeUndoAtomicPayload(snapshot, { ...main, duration: 90 });

    assert.equal(snapshot.oldDuration, 60);
    assert.equal(snapshot.newDuration, 90);
    assert.deepEqual(snapshot.linked, ['BK-linked']);
    assert.deepEqual(payload.main, { duration: 60 });
    assert.deepEqual(payload.linked, [{ id: 'BK-linked', duration: 60 }]);
    assert.equal(payload.historyAction, 'undo_resize');
});
