const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
    checkServerConflicts,
    reconcileScheduledAnimatorLines,
    getAnimatorTimelineLines
} = require('../services/booking');

function rosterDb(initial = {}) {
    const state = {
        schedule: [...(initial.schedule || [])],
        lines: new Map((initial.lines || []).map(line => [String(line.line_id), { ...line }])),
        bookingLineIds: new Set((initial.bookingLineIds || []).map(String)),
        afishaLineIds: new Set((initial.afishaLineIds || []).map(String)),
        writes: []
    };
    return {
        state,
        async query(sql, params = []) {
            const normalized = sql.replace(/\s+/g, ' ').trim();
            if (normalized.includes('FROM staff_schedule ss') && normalized.includes("ss.status IN ('working', 'remote')")) {
                return { rows: state.schedule.filter(row => ['working', 'remote'].includes(row.status)) };
            }
            if (normalized.startsWith('INSERT INTO lines_by_date')) {
                state.writes.push('insert');
                const [, , lineId, name, color] = params;
                state.lines.set(String(lineId), {
                    line_id: String(lineId),
                    name,
                    color,
                    from_sheet: true
                });
                return { rows: [], rowCount: 1 };
            }
            if (normalized.startsWith('DELETE FROM lines_by_date l') && normalized.includes('l.from_sheet IS TRUE')) {
                state.writes.push('delete');
                const scheduledIds = new Set((params[2] || []).map(String));
                const removed = [];
                for (const [lineId, line] of state.lines) {
                    if (line.from_sheet !== true || scheduledIds.has(lineId)) continue;
                    if (state.bookingLineIds.has(lineId) || state.afishaLineIds.has(lineId)) continue;
                    state.lines.delete(lineId);
                    removed.push({ line_id: lineId });
                }
                return { rows: removed, rowCount: removed.length };
            }
            if (normalized.includes('FROM lines_by_date l') && normalized.includes('AS has_active_booking')) {
                return {
                    rows: [...state.lines.values()].map(line => ({
                        ...line,
                        has_active_booking: state.bookingLineIds.has(String(line.line_id)),
                        has_active_afisha: state.afishaLineIds.has(String(line.line_id))
                    }))
                };
            }
            throw new Error(`Unexpected roster query: ${normalized}`);
        }
    };
}

function scheduledAnimator(id, status = 'working') {
    return {
        staff_id: id,
        name: `Animator ${id}`,
        color: '#10B981',
        shift_start: '10:00',
        shift_end: '20:00',
        status
    };
}

function animatorWithWindows(id, windows, assignments = []) {
    return {
        ...scheduledAnimator(id),
        availability_windows: windows,
        active_assignments: assignments
    };
}

test('working to sick/dayoff/delete removes only free generated lines', async () => {
    const db = rosterDb({ schedule: [scheduledAnimator(7)] });
    await reconcileScheduledAnimatorLines('2026-07-20', db);
    assert.equal(db.state.lines.has('7'), true);

    for (const status of ['sick', 'dayoff']) {
        db.state.schedule = [scheduledAnimator(7, status)];
        const result = await reconcileScheduledAnimatorLines('2026-07-20', db);
        assert.equal(result.removed, status === 'sick' ? 1 : 0);
        assert.equal(db.state.lines.has('7'), false);
    }

    db.state.schedule = [];
    const deleted = await reconcileScheduledAnimatorLines('2026-07-20', db);
    assert.equal(deleted.count, 0);
    assert.equal(db.state.lines.size, 0);
});

test('replacement removes the old free line and materializes the replacement line', async () => {
    const db = rosterDb({
        schedule: [scheduledAnimator(7)],
        lines: [{ line_id: '7', name: 'Animator 7', color: '#10B981', from_sheet: true }]
    });
    db.state.schedule = [scheduledAnimator(9)];

    const result = await reconcileScheduledAnimatorLines('2026-07-20', db);

    assert.deepEqual(result.removedLineIds, ['7']);
    assert.equal(db.state.lines.has('7'), false);
    assert.equal(db.state.lines.has('9'), true);
});

test('generated stale line with booking is preserved as unavailable orphan while manual line stays assignable', async () => {
    const db = rosterDb({
        lines: [
            { line_id: '7', name: 'Former animator', color: '#64748B', from_sheet: true },
            { line_id: 'manual-host', name: 'Manual host', color: '#8B5CF6', from_sheet: false }
        ],
        bookingLineIds: ['7']
    });

    const reconciliation = await reconcileScheduledAnimatorLines('2026-07-20', db);
    const lines = await getAnimatorTimelineLines('2026-07-20', db);

    assert.equal(reconciliation.removed, 0);
    assert.equal(lines.find(line => line.id === '7').assignmentAllowed, false);
    assert.equal(lines.find(line => line.id === '7').source, 'staff_schedule_orphan');
    assert.equal(lines.find(line => line.id === 'manual-host').assignmentAllowed, true);
});

test('empty roster returns a virtual unavailable fallback without writes during read', async () => {
    const db = rosterDb();

    const lines = await getAnimatorTimelineLines('2026-07-20', db);

    assert.equal(lines.length, 1);
    assert.equal(lines[0].source, 'empty_roster_virtual');
    assert.equal(lines[0].assignmentAllowed, false);
    assert.deepEqual(db.state.writes, []);
});

test('secondary animator role exposes two real availability windows without filling the gap', async () => {
    const windows = [
        { start: '10:00', end: '13:00', segmentId: 501 },
        { start: '17:00', end: '20:00', segmentId: 502 }
    ];
    const db = rosterDb({ schedule: [animatorWithWindows(7, windows)] });

    const lines = await getAnimatorTimelineLines('2026-07-20', db);

    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].availabilityWindows, windows);
    assert.equal(lines[0].shiftStart, '10:00');
    assert.equal(lines[0].shiftEnd, '20:00');
});

test('new booking must fit one availability window while the gap is rejected', async () => {
    const windows = [
        { start: '10:00', end: '13:00', segmentId: 501 },
        { start: '17:00', end: '20:00', segmentId: 502 }
    ];
    const client = {
        async query(sql) {
            if (sql.includes('FROM bookings WHERE')) return { rows: [] };
            if (sql.includes('FROM staff s')) return { rows: [{ staff_id: 7, status: 'working', availability_windows: windows }] };
            throw new Error(`Unexpected query: ${sql}`);
        }
    };

    assert.equal((await checkServerConflicts(client, '2026-07-20', '7', '10:30', 60)).overlap, false);
    const gap = await checkServerConflicts(client, '2026-07-20', '7', '14:00', 60);
    assert.equal(gap.overlap, true);
    assert.equal(gap.unavailable, true);
    assert.equal(gap.reason, 'outside_availability_window');
    assert.equal((await checkServerConflicts(client, '2026-07-20', '7', '18:00', 60)).overlap, false);
});

test('overnight animator window accepts its after-midnight continuation', async () => {
    const windows = [{ start: '22:00', end: '02:00', segmentId: 41 }];
    const client = {
        async query(sql) {
            if (sql.includes('FROM bookings WHERE')) return { rows: [] };
            if (sql.includes('FROM staff s')) return { rows: [{ staff_id: 17, status: 'working', availability_windows: windows }] };
            throw new Error(`Unexpected query: ${sql}`);
        }
    };

    const beforeMidnight = await checkServerConflicts(client, '2026-07-14', '17', '23:00', 60);
    const afterMidnight = await checkServerConflicts(client, '2026-07-14', '17', '01:00', 60);
    const outside = await checkServerConflicts(client, '2026-07-14', '17', '03:00', 30);

    assert.equal(beforeMidnight.overlap, false);
    assert.equal(afterMidnight.overlap, false);
    assert.equal(outside.unavailable, true);
});

test('existing booking in a removed window remains visible and is marked for review', async () => {
    const db = rosterDb({
        schedule: [animatorWithWindows(7, [
            { start: '10:00', end: '13:00', segmentId: 501 }
        ], [
            { id: 'BK-GAP', time: '17:00', duration: 60, label: 'Existing booking' }
        ])],
        lines: [{ line_id: '7', name: 'Animator 7', color: '#10B981', from_sheet: true }],
        bookingLineIds: ['7']
    });

    const lines = await getAnimatorTimelineLines('2026-07-20', db);
    const line = lines.find(item => item.id === '7');

    assert.equal(line.needsReview, true);
    assert.equal(line.unavailableAssignments[0].id, 'BK-GAP');
    assert.equal(db.state.lines.has('7'), true);
    assert.deepEqual(db.state.writes, []);
});

test('line GET is read-only and schedule mutation routes reconcile before commit', () => {
    const linesRoute = fs.readFileSync(path.join(ROOT, 'routes/lines.js'), 'utf8');
    const bookingsRoute = fs.readFileSync(path.join(ROOT, 'routes/bookings.js'), 'utf8');
    const staffRoute = fs.readFileSync(path.join(ROOT, 'routes/staff.js'), 'utf8');
    const hrRoute = fs.readFileSync(path.join(ROOT, 'routes/hr.js'), 'utf8');
    const getBlock = linesRoute.slice(linesRoute.indexOf("router.get('/:date'"), linesRoute.indexOf("router.post('/:date'"));

    assert.doesNotMatch(getBlock, /syncScheduledAnimatorLines|INSERT INTO lines_by_date|DELETE FROM lines_by_date/);
    assert.match(getBlock, /getAnimatorTimelineLines\(date, pool\)/);
    assert.match(staffRoute, /reconcileAnimatorRosterDates\(client, \[date\]\)[\s\S]*client\.query\('COMMIT'\)/);
    assert.match(staffRoute, /timeline:roster-updated/);
    assert.match(hrRoute, /reconcileRosterDates\(client, \[existing\.rows\[0\]\.shift_date\]\)[\s\S]*client\.query\('COMMIT'\)/);
    assert.match(hrRoute, /broadcastRosterDates\(scheduleCleanup\?\.dates \|\| \[\]/);
    assert.match(bookingsRoute, /from_sheet IS DISTINCT FROM true[\s\S]*ss\.status IN \('working', 'remote'\)/);
});

test('operational consumers use segment windows without duplicating staff rows', () => {
    const staffRoute = fs.readFileSync(path.join(ROOT, 'routes', 'staff.js'), 'utf8');
    const authRoute = fs.readFileSync(path.join(ROOT, 'routes', 'auth.js'), 'utf8');
    const dashboardRoute = fs.readFileSync(path.join(ROOT, 'routes', 'dashboard.js'), 'utf8');
    const boardRoute = fs.readFileSync(path.join(ROOT, 'routes', 'board.js'), 'utf8');
    const centerRoute = fs.readFileSync(path.join(ROOT, 'routes', 'center.js'), 'utf8');
    const kleshnya = fs.readFileSync(path.join(ROOT, 'services', 'kleshnya-chat.js'), 'utf8');
    const recurring = fs.readFileSync(path.join(ROOT, 'services', 'recurring.js'), 'utf8');
    const timeline = fs.readFileSync(path.join(ROOT, 'js', 'timeline.js'), 'utf8');
    const timelineCss = fs.readFileSync(path.join(ROOT, 'css', 'timeline.css'), 'utf8');

    assert.match(staffRoute, /getScheduledAnimatorLines\(date, pool\)/);
    assert.match(staffRoute, /availabilityWindows: line\.availabilityWindows/);
    assert.match(authRoute, /AS segments/);
    assert.match(dashboardRoute, /SELECT DISTINCT ON \(s\.id\)/);
    assert.match(dashboardRoute, /CURRENT_TIMESTAMP AT TIME ZONE 'Europe\/Kyiv'/);
    assert.match(boardRoute, /COUNT\(DISTINCT ss\.staff_id\)/);
    assert.match(centerRoute, /isWindowCurrentForScheduleDate\(scheduleDate, today, nowMinutes, availabilityWindows\)/);
    assert.match(centerRoute, /ss\.date::date = \$2::date[\s\S]*hss_previous\.planned_end <= hss_previous\.planned_start/);
    assert.match(kleshnya, /staffShiftBlocks/);
    assert.match(recurring, /outside animator availability; windows:/);
    assert.match(timeline, /timelineCandidateFitsAvailability/);
    assert.match(timeline, /grid-cell--outside-availability/);
    assert.match(timelineCss, /\.grid-cell\.grid-cell--outside-availability/);
});
