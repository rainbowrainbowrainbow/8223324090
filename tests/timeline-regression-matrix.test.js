const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const model = require('../js/timeline-interaction-model');

const ROOT = path.join(__dirname, '..');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'timeline-regression-matrix-test-secret';

function readProjectFile(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function getTimelineIsolationHooks() {
    return require('../routes/lines').__timelineIsolationTestHooks;
}

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
    const contextCode = readProjectFile('js/timeline-context.js');
    const serverCode = readProjectFile('server.js');
    const indexHtml = readProjectFile('index.html');
    const packageJson = readProjectFile('package.json');

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

test('timeline view isolation matrix keeps polluted room rows out of animator state', () => {
    const hooks = getTimelineIsolationHooks();
    assert.ok(hooks, 'routes/lines.js should expose timeline isolation test hooks');

    const pollutedLegacyRows = [
        { line_id: '748', name: 'Пасенко Женя', from_sheet: false },
        { line_id: 'room-takeaway', name: 'На виніс', source: 'rooms_virtual' },
        { line_id: 'room-marvel', name: 'Марвел', resource_type: 'room' }
    ];
    const animatorRows = pollutedLegacyRows.filter(row => {
        if (String(row.line_id || '').trim() === 'banquet-service') return false;
        return !hooks.isLegacyRoomTimelineLineRow(row);
    });

    assert.deepEqual(animatorRows.map(row => row.line_id), ['748']);
    assert.equal(hooks.isLegacyRoomTimelineLineRow({ line_id: 'room-takeaway', name: 'На виніс' }), true);
    assert.equal(hooks.isLegacyRoomTimelineLineRow({ line_id: 'room-marvel', name: 'Марвел' }), true);
    assert.equal(hooks.isLegacyRoomTimelineLineRow({ line_id: '748', name: 'Пасенко Женя' }), false);

    const roomRows = hooks.withTakeawayRoomLine([
        {
            id: 'room-marvel',
            resourceId: 'room-marvel',
            resourceType: 'room',
            name: 'Марвел',
            source: 'timeline_resource'
        }
    ], 'event_genix');
    assert.deepEqual(roomRows.map(line => line.id), ['room-takeaway', 'room-marvel']);
    assert.equal(hooks.isRoomTimelineLinePayload({ id: 'room-marvel', resourceType: 'room' }), true);
    assert.equal(hooks.isRoomTimelineLinePayload({ id: '748', resourceType: 'animator', name: 'Пасенко Женя' }), false);
});

test('timeline view switch isolation keeps room rows out of animator render and cache scope', () => {
    const timeline = readProjectFile('js/timeline.js');
    const api = readProjectFile('js/api.js');
    const linesRoute = readProjectFile('routes/lines.js');

    assert.match(linesRoute, /timelineView === 'rooms' && businessContext === DEFAULT_TIMELINE_CONTEXT[\s\S]*roomTimelineLinesForContext\(businessContext\)/);
    assert.match(linesRoute, /res\.set\('X-Timeline-View', 'rooms'\)/);
    assert.match(linesRoute, /businessContext === DEFAULT_TIMELINE_CONTEXT && display\.mode === 'park' && lines\.some\(isRoomTimelineLinePayload\)/);
    assert.match(linesRoute, /const quarantinedRoomRows = result\.rows\.filter\(isLegacyRoomTimelineLineRow\)/);
    assert.match(linesRoute, /const lines = filteredRows/);

    assert.match(timeline, /function timelineCacheScopeKey\(\)[\s\S]*const timelineView = timelineCurrentView\(\);[\s\S]*return `\$\{context\}\|\$\{mode\}\|\$\{resourceType\}\|\$\{timelineView\}`/);
    const setViewBlock = timeline.slice(
        timeline.indexOf('async function setTimelineView'),
        timeline.indexOf('window.TimelineView =')
    );
    assert.match(setViewBlock, /if \(next !== current\) \{[\s\S]*clearTimelineBanquetRoomPreviews\(\);[\s\S]*if \(options\.render !== false\) \{/);
    assert.match(setViewBlock, /if \(options\.render !== false\) \{[\s\S]*AppState\.cachedBookings = \{\};[\s\S]*AppState\.cachedLines = \{\};[\s\S]*AppState\.lines = \[\];[\s\S]*AppState\.linesByDate = \{\};/);
    assert.match(timeline, /function isTimelineRoomOnlyLine/);
    assert.match(timeline, /function normalizeTimelineLinesForContext[\s\S]*!isTimelineBanquetServicePseudoLine\(line\) && !isTimelineRoomOnlyLine\(line\)/);
    assert.match(timeline, /lineHeader\?\.addEventListener\('click', event => \{[\s\S]*if \(isRoomTimelineView\(\)\) return;[\s\S]*editLineModal\(line\.id\)/);

    assert.match(api, /async function apiSaveLines\(date, lines\) \{[\s\S]*window\.TimelineView\?\.isRooms\?\.\(\)[\s\S]*success: false[\s\S]*room_timeline_legacy_line_save_blocked[\s\S]*timelineApiUrlWithView\(`\/lines\/\$\{date\}`\)/);
    assert.match(api, /function timelineApiUrlWithView[\s\S]*timelineView=\$\{encodeURIComponent\(String\(view\)\)\}/);
});

test('timeline view isolation matrix includes horizontal scroll scope and reset', () => {
    const timeline = readProjectFile('js/timeline.js');
    const setViewBlock = timeline.slice(
        timeline.indexOf('async function setTimelineView'),
        timeline.indexOf('window.TimelineView =')
    );
    const scrollKeyBlock = timeline.slice(
        timeline.indexOf('function timelineHorizontalScrollStateKey'),
        timeline.indexOf('function getTimelineCacheEntry')
    );

    assert.match(scrollKeyBlock, /timelineCacheScopeKey\(\)/);
    assert.match(scrollKeyBlock, /timelineDateKey\(date\)/);
    assert.match(scrollKeyBlock, /const period = timelineHorizontalScrollPeriodKey\(\)/);
    assert.match(scrollKeyBlock, /const zoom = timelineHorizontalScrollZoomKey\(\)/);
    assert.match(scrollKeyBlock, /const compact = AppState\.compactMode \? 'compact' : 'regular'/);
    assert.match(setViewBlock, /if \(next !== current\) \{[\s\S]*clearTimelineBanquetRoomPreviews\(\);[\s\S]*markTimelineNavigationScrollReset\('view-switch-before-render'\);[\s\S]*if \(options\.render !== false\) \{/);
    assert.match(timeline, /async function handleTimelineBusinessContextChanged[\s\S]*markTimelineNavigationScrollReset\('business-context-change'\);[\s\S]*updateTimelineViewControls\(\)/);
});

test('phase 4 matrix is wired into unit and UI proof stack', () => {
    const packageJson = readProjectFile('package.json');
    const lifecycleTest = readProjectFile('tests/timeline-lifecycle.test.js');
    const uatDoc = readProjectFile('docs/TIMELINE_UAT_REGRESSION_MATRIX.md');

    assert.match(packageJson, /tests\/timeline-regression-matrix\.test\.js/);
    assert.match(packageJson, /tests\/timeline-lifecycle\.test\.js/);
    assert.match(lifecycleTest, /interaction save lock blocks a second drag start/);
    assert.match(lifecycleTest, /pointercancel during booking drag/);
    assert.match(uatDoc, /\/maysternya-doli/);
    assert.match(uatDoc, /TEST_USER/);
    assert.match(uatDoc, /linked secondary cross-line/);
});
