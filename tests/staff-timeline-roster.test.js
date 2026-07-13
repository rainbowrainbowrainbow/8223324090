const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const {
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
