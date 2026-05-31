const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const model = require('../js/timeline-interaction-model');

const ROOT = path.join(__dirname, '..');

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

function baseGroup() {
    const main = booking({ id: 'BK-main', time: '14:00', lineId: 'line-1' });
    const linked = booking({ id: 'BK-linked', time: '14:10', lineId: 'line-2', linkedTo: 'BK-main' });
    return { main, linked };
}

function minutes(time) {
    return model.timeToMinutesValue(time);
}

function evaluateTwice(intent, allBookings) {
    const options = { dayStartMin: 12 * 60, dayEndMin: 20 * 60, minPause: 15 };
    const preview = model.evaluateTimelineCandidateConflicts(intent, allBookings, options);
    const final = model.evaluateTimelineCandidateConflicts(intent, allBookings, options);
    return { preview, final };
}

function summarizeConflict(result) {
    return {
        valid: result.valid,
        type: result.type || null,
        candidateId: result.candidate?.id || null,
        conflictId: result.conflictBooking?.id || null
    };
}

function savedDragResult(intent) {
    return {
        booking: { ...intent.mainCandidate.old, ...intent.mainCandidate.next },
        linkedBookings: intent.linkedCandidates.map(candidate => ({
            ...candidate.old,
            ...candidate.next
        }))
    };
}

test('timeline drag regression matrix keeps preview, save, and undo aligned', async (t) => {
    const dragCases = [
        {
            name: 'main same-line free target',
            actor: 'main',
            currentTime: '14:30',
            targetLineId: 'line-1',
            expectedMainPayload: { time: '14:30', lineId: 'line-1' },
            expectedLinkedPayload: [{ id: 'BK-linked', time: '14:40' }]
        },
        {
            name: 'main cross-line free target',
            actor: 'main',
            currentTime: '14:30',
            targetLineId: 'line-3',
            expectedMainPayload: { time: '14:30', lineId: 'line-3' },
            expectedLinkedPayload: [{ id: 'BK-linked', time: '14:40' }]
        },
        {
            name: 'linked secondary same-line free target',
            actor: 'linked',
            currentTime: '14:40',
            targetLineId: 'line-2',
            expectedMainPayload: { time: '14:30' },
            expectedLinkedPayload: [{ id: 'BK-linked', time: '14:40' }]
        },
        {
            name: 'linked secondary cross-line free target',
            actor: 'linked',
            currentTime: '14:40',
            targetLineId: 'line-4',
            expectedMainPayload: { time: '14:30' },
            expectedLinkedPayload: [{ id: 'BK-linked', time: '14:40', lineId: 'line-4' }]
        }
    ];

    for (const row of dragCases) {
        await t.test(row.name, () => {
            const { main, linked } = baseGroup();
            const draggedBooking = row.actor === 'main' ? main : linked;
            const intent = model.buildDragInteractionIntent({
                draggedBooking,
                allBookings: [main, linked],
                startMin: minutes(draggedBooking.time),
                currentMin: minutes(row.currentTime),
                startLineId: draggedBooking.lineId,
                targetLineId: row.targetLineId
            });
            const { preview, final } = evaluateTwice(intent, [main, linked]);
            const payload = model.buildDragAtomicPayload(intent);
            const snapshot = model.buildDragUndoSnapshot(intent, savedDragResult(intent));
            const undoPayload = model.buildDragUndoAtomicPayload(snapshot, savedDragResult(intent).booking);
            const changeSet = model.buildDragChangeSet(intent);

            assert.deepEqual(summarizeConflict(preview), summarizeConflict(final));
            assert.equal(final.valid, true);
            assert.deepEqual(payload.main, row.expectedMainPayload);
            assert.deepEqual(payload.linked, row.expectedLinkedPayload);
            assert.equal(changeSet.time.changed, row.currentTime !== draggedBooking.time);
            assert.equal(changeSet.line.changed, row.targetLineId !== draggedBooking.lineId);
            assert.deepEqual(undoPayload.main, { time: '14:00', lineId: 'line-1' });
            assert.deepEqual(undoPayload.linked, [{ id: 'BK-linked', time: '14:10', lineId: 'line-2' }]);
            assert.equal(undoPayload.historyAction, 'undo_drag');
        });
    }
});

test('timeline drag matrix rejects an occupied linked secondary cross-line target honestly', () => {
    const { main, linked } = baseGroup();
    const blocker = booking({ id: 'BK-blocker', time: '14:35', lineId: 'line-4', duration: 30 });
    const intent = model.buildDragInteractionIntent({
        draggedBooking: linked,
        allBookings: [main, linked, blocker],
        startMin: minutes(linked.time),
        currentMin: minutes('14:40'),
        startLineId: linked.lineId,
        targetLineId: 'line-4'
    });
    const { preview, final } = evaluateTwice(intent, [main, linked, blocker]);

    assert.deepEqual(summarizeConflict(preview), summarizeConflict(final));
    assert.deepEqual(summarizeConflict(final), {
        valid: false,
        type: 'overlap',
        candidateId: 'BK-linked',
        conflictId: 'BK-blocker'
    });
});

test('timeline drag ignores invisible non-target blockers but still rejects target-line blockers', async (t) => {
    await t.test('main cross-line drag only conflicts with the target line', () => {
        const { main, linked } = baseGroup();
        const offTargetBlocker = booking({
            id: 'BK-off-target',
            time: '14:30',
            lineId: 'line-99',
            duration: 60,
            label: 'Pin+1L'
        });
        const targetBlocker = booking({
            id: 'BK-target',
            time: '14:30',
            lineId: 'line-3',
            duration: 60,
            label: 'Real target blocker'
        });
        const freeIntent = model.buildDragInteractionIntent({
            draggedBooking: main,
            allBookings: [main, linked, offTargetBlocker],
            startMin: minutes(main.time),
            currentMin: minutes('14:30'),
            startLineId: main.lineId,
            targetLineId: 'line-3'
        });
        const free = evaluateTwice(freeIntent, [main, linked, offTargetBlocker]);

        assert.deepEqual(summarizeConflict(free.preview), summarizeConflict(free.final));
        assert.equal(free.final.valid, true);
        assert.equal(model.buildDragAtomicPayload(freeIntent).main.lineId, 'line-3');

        const blockedIntent = model.buildDragInteractionIntent({
            draggedBooking: main,
            allBookings: [main, linked, offTargetBlocker, targetBlocker],
            startMin: minutes(main.time),
            currentMin: minutes('14:30'),
            startLineId: main.lineId,
            targetLineId: 'line-3'
        });
        const blocked = evaluateTwice(blockedIntent, [main, linked, offTargetBlocker, targetBlocker]);

        assert.deepEqual(summarizeConflict(blocked.preview), summarizeConflict(blocked.final));
        assert.deepEqual(summarizeConflict(blocked.final), {
            valid: false,
            type: 'overlap',
            candidateId: 'BK-main',
            conflictId: 'BK-target'
        });
    });

    await t.test('linked secondary cross-line drag only conflicts with the dragged target line', () => {
        const { main, linked } = baseGroup();
        const offTargetBlocker = booking({
            id: 'BK-off-target',
            time: '14:40',
            lineId: 'line-99',
            duration: 60,
            label: 'Pin+1L'
        });
        const targetBlocker = booking({
            id: 'BK-target',
            time: '14:40',
            lineId: 'line-4',
            duration: 60,
            label: 'Real target blocker'
        });
        const freeIntent = model.buildDragInteractionIntent({
            draggedBooking: linked,
            allBookings: [main, linked, offTargetBlocker],
            startMin: minutes(linked.time),
            currentMin: minutes('14:40'),
            startLineId: linked.lineId,
            targetLineId: 'line-4'
        });
        const free = evaluateTwice(freeIntent, [main, linked, offTargetBlocker]);

        assert.deepEqual(summarizeConflict(free.preview), summarizeConflict(free.final));
        assert.equal(free.final.valid, true);
        assert.deepEqual(model.buildDragAtomicPayload(freeIntent).linked, [
            { id: 'BK-linked', time: '14:40', lineId: 'line-4' }
        ]);

        const blockedIntent = model.buildDragInteractionIntent({
            draggedBooking: linked,
            allBookings: [main, linked, offTargetBlocker, targetBlocker],
            startMin: minutes(linked.time),
            currentMin: minutes('14:40'),
            startLineId: linked.lineId,
            targetLineId: 'line-4'
        });
        const blocked = evaluateTwice(blockedIntent, [main, linked, offTargetBlocker, targetBlocker]);

        assert.deepEqual(summarizeConflict(blocked.preview), summarizeConflict(blocked.final));
        assert.deepEqual(summarizeConflict(blocked.final), {
            valid: false,
            type: 'overlap',
            candidateId: 'BK-linked',
            conflictId: 'BK-target'
        });
    });
});

test('timeline resize regression matrix covers free, occupied, and undo paths', async (t) => {
    await t.test('main resize free target updates group and undo restores persisted duration', () => {
        const { main, linked } = baseGroup();
        const intent = model.buildResizeInteractionIntent({
            booking: main,
            allBookings: [main, linked],
            newDuration: 90
        });
        const { preview, final } = evaluateTwice(intent, [main, linked]);
        const payload = model.buildResizeAtomicPayload(intent);
        const snapshot = model.buildResizeUndoSnapshot(intent, {
            booking: { ...main, duration: 90 },
            linkedBookings: [{ ...linked, duration: 90 }]
        });
        const undoPayload = model.buildResizeUndoAtomicPayload(snapshot, { ...main, duration: 90 });

        assert.deepEqual(summarizeConflict(preview), summarizeConflict(final));
        assert.equal(final.valid, true);
        assert.deepEqual(payload.main, { duration: 90 });
        assert.deepEqual(payload.linked, [{ id: 'BK-linked', duration: 90 }]);
        assert.deepEqual(undoPayload.main, { duration: 60 });
        assert.deepEqual(undoPayload.linked, [{ id: 'BK-linked', duration: 60 }]);
        assert.equal(undoPayload.historyAction, 'undo_resize');
    });

    await t.test('main resize blocked by occupied target', () => {
        const { main, linked } = baseGroup();
        const blocker = booking({ id: 'BK-blocker', time: '15:10', lineId: 'line-1', duration: 30 });
        const intent = model.buildResizeInteractionIntent({
            booking: main,
            allBookings: [main, linked, blocker],
            newDuration: 90
        });
        const { preview, final } = evaluateTwice(intent, [main, linked, blocker]);

        assert.deepEqual(summarizeConflict(preview), summarizeConflict(final));
        assert.deepEqual(summarizeConflict(final), {
            valid: false,
            type: 'overlap',
            candidateId: 'BK-main',
            conflictId: 'BK-blocker'
        });
    });

    await t.test('linked secondary resize blocked on its own line', () => {
        const { main, linked } = baseGroup();
        const blocker = booking({ id: 'BK-blocker', time: '15:00', lineId: 'line-2', duration: 30 });
        const intent = model.buildResizeInteractionIntent({
            booking: linked,
            allBookings: [main, linked, blocker],
            newDuration: 90
        });
        const { preview, final } = evaluateTwice(intent, [main, linked, blocker]);

        assert.deepEqual(summarizeConflict(preview), summarizeConflict(final));
        assert.deepEqual(summarizeConflict(final), {
            valid: false,
            type: 'overlap',
            candidateId: 'BK-linked',
            conflictId: 'BK-blocker'
        });
    });
});

test('timeline context parity keeps Event Genix and Maysternya Doli on one shared engine', () => {
    const contextCode = fs.readFileSync(path.join(ROOT, 'js', 'timeline-context.js'), 'utf8');
    const serverCode = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const packageJson = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');

    assert.match(contextCode, /event_genix/);
    assert.match(contextCode, /maysternya_doli/);
    assert.match(contextCode, /path: '\/maysternya-doli'/);
    assert.match(contextCode, /appendApiContext/);
    assert.match(contextCode, /withApiContext/);
    assert.match(serverCode, /app\.get\('\/maysternya-doli'/);
    assert.match(serverCode, /res\.sendFile\(path\.join\(__dirname, 'index\.html'\)\)/);
    assert.match(indexHtml, /js\/timeline-context\.js\?v=/);
    assert.match(indexHtml, /js\/timeline-interaction-model\.js\?v=/);
    assert.match(indexHtml, /js\/timeline\.js\?v=/);
    assert.doesNotMatch(indexHtml + packageJson, /maysternya-timeline\.js|timeline-maysternya\.js/);
});

test('phase 4 matrix is wired into unit and UI proof stack', () => {
    const packageJson = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
    const lifecycleTest = fs.readFileSync(path.join(ROOT, 'tests', 'timeline-lifecycle.test.js'), 'utf8');
    const uatDoc = fs.readFileSync(path.join(ROOT, 'docs', 'TIMELINE_UAT_REGRESSION_MATRIX.md'), 'utf8');

    assert.match(packageJson, /tests\/timeline-regression-matrix\.test\.js/);
    assert.match(packageJson, /tests\/timeline-lifecycle\.test\.js/);
    assert.match(lifecycleTest, /interaction save lock blocks a second drag start/);
    assert.match(lifecycleTest, /pointercancel during booking drag/);
    assert.match(uatDoc, /\/maysternya-doli/);
    assert.match(uatDoc, /TEST_USER/);
    assert.match(uatDoc, /linked secondary cross-line/);
});
