const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function listJsFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listJsFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(fullPath);
        }
    }
    return files;
}

function stripLineComments(source) {
    return source
        .split(/\r?\n/)
        .filter(line => !line.trim().startsWith('//'))
        .join('\n');
}

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `${name} exists`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    assert.fail(`${name} has a complete function body`);
}

test('booking hosts remains a host-count field, never a staff identity in runtime queries', () => {
    const forbidden = [
        /\b(?:WHERE|AND|OR|ON)\b.*\b\w*\.?hosts\s*=\s*\$\d+\b/i,
        /\b(?:WHERE|AND|OR|ON)\b.*\b\w*\.?hosts\s*=\s*(?:ep\.staff_id|s\.id)\b/i,
        /\b\w*\.?hosts\s+IN\s*\(/i,
        /SELECT\s+DISTINCT\s+hosts\s+AS\s+staff_id\b/i
    ];
    const runtimeFiles = [
        ...listJsFiles(path.join(ROOT, 'routes')),
        ...listJsFiles(path.join(ROOT, 'services'))
    ];
    const offenders = [];

    for (const file of runtimeFiles) {
        const relative = path.relative(ROOT, file).replace(/\\/g, '/');
        const body = stripLineComments(fs.readFileSync(file, 'utf8'));
        for (const pattern of forbidden) {
            if (pattern.test(body)) {
                offenders.push(`${relative}: ${pattern}`);
            }
        }
    }

    assert.deepEqual(offenders, []);
});

test('park second-host picker uses real day lines and only keeps free linked occupancy candidates', () => {
    const bookingJs = fs.readFileSync(path.join(ROOT, 'js', 'booking.js'), 'utf8');
    const bookingsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'bookings.js'), 'utf8');

    assert.doesNotMatch(bookingJs, /fetchParkAnimatorStaffCandidates/);
    assert.match(bookingJs, /filterAnimatorLineCandidatesForOpenSlot/);
    assert.match(bookingJs, /checkConflicts\(candidate\.id, time, duration, excludeId\)/);
    assert.match(bookingJs, /findEditingLinkedBookingIdForLine/);
    assert.match(bookingJs, /selectedAnimatorLineCandidate\('secondAnimatorSelect'/);
    assert.match(bookingJs, /option\.dataset\.lineId = line\.id/);
    assert.match(bookingJs, /function getBookingLineSnapshot/);
    assert.match(bookingJs, /lineName: formData\.lineName/);
    assert.match(bookingJs, /refreshCreatedBookingTimelineSnapshot/);
    assert.doesNotMatch(bookingJs, /primeCreatedBookingsInTimelineCache/);

    assert.match(bookingsRoute, /async function ensureParkAnimatorLine/);
    assert.match(bookingsRoute, /async function ensureBookingTimelineLine/);
    assert.match(bookingsRoute, /lineName \|\| booking\.resourceName \|\| booking\.room/);
    assert.match(bookingsRoute, /INSERT INTO lines_by_date \(business_context, date, line_id, name, color, from_sheet\)/);
    assert.match(bookingsRoute, /const ensuredPrimaryLine = await ensureBookingTimelineLine\(client, b, businessContext/s);
    assert.match(bookingsRoute, /const ensuredMainLine = await ensureBookingTimelineLine\(client, main, businessContext/s);
    assert.match(bookingsRoute, /async function bookingDayProjectionStatus/);
    assert.match(bookingsRoute, /const projectedDate = String\(date \|\| ''\)\.slice\(0, 10\)/);
    assert.match(bookingsRoute, /allBookings\.map\(async booking/);
    assert.match(bookingsRoute, /booking\.timelineProjection = await bookingDayProjectionStatus/);
    assert.match(bookingsRoute, /booking_line_not_visible/);
    assert.match(bookingsRoute, /ensureParkAnimatorLine\(client, \{\s*businessContext,\s*date: lb\.date \|\| main\.date/s);
    assert.match(bookingsRoute, /function attachLinkedBookingTimelineIdentity/);
    assert.match(bookingsRoute, /bookingExtraDataSqlValue\(lb\)/);
    assert.doesNotMatch(bookingsRoute, /lb\.extraData\s*\?\s*JSON\.stringify\(lb\.extraData\)\s*:\s*\(main\.extraData/);
    assert.match(bookingJs, /selectedSecondAnimatorLineCandidate/);
    assert.match(bookingJs, /secondAnimatorLineId:/);
    assert.match(bookingsRoute, /function bookingRequiresSecondAnimatorLink/);
    assert.match(bookingsRoute, /function normalizeBookingSecondAnimatorFields/);
    assert.match(bookingsRoute, /function ensureSecondAnimatorLineForBooking/);
    assert.match(bookingsRoute, /bookingSecondAnimatorLineId/);
    assert.match(bookingsRoute, /if \(bookingRequiresSecondAnimatorLink\(main\)\)/);
    assert.match(bookingsRoute, /const shouldHaveSecondLink = bookingRequiresSecondAnimatorLink\(b\)/);
    assert.match(bookingsRoute, /await insertSecondAnimatorLinkedBooking\(client/);
    assert.doesNotMatch(bookingsRoute, /Number\(b\.hosts \|\| 0\) > 1 && newSecond/);
});

test('booking duplicate guard excludes the linked edit group from self-conflicts', () => {
    const bookingJs = fs.readFileSync(path.join(ROOT, 'js', 'booking.js'), 'utf8');
    assert.match(bookingJs, /function collectDuplicateProgramExclusionIds/);
    assert.match(bookingJs, /function isDuplicateProgramRelevantEdit/);
    assert.match(bookingJs, /isDuplicateProgramRelevantEdit\(allBookings, excludeId, programId, time, duration\)/);
    assert.match(bookingJs, /const excludedBookingIds = collectDuplicateProgramExclusionIds\(allBookings, excludeId\)/);
    assert.match(bookingJs, /excludedBookingIds\.has\(normalizeBookingIdentity\(b\.id\)\)/);

    const code = [
        extractFunction(bookingJs, 'normalizeBookingIdentity'),
        extractFunction(bookingJs, 'collectDuplicateProgramExclusionIds'),
        extractFunction(bookingJs, 'isDuplicateProgramRelevantEdit')
    ].join('\n');
    const context = {
        bookings: [
            { id: 'BK-MAIN', programId: 'quest', time: '14:30', duration: 60 },
            { id: 'BK-LINK', linkedTo: 'BK-MAIN', programId: 'quest', time: '14:30', duration: 60 },
            { id: 'BK-LINK-2', linkedTo: 'BK-MAIN', programId: 'quest', time: '14:30', duration: 60 },
            { id: 'BK-OTHER', programId: 'quest', time: '14:30', duration: 60 }
        ]
    };
    vm.runInNewContext(`
        ${code}
        globalThis.mainEdit = [...collectDuplicateProgramExclusionIds(bookings, 'BK-MAIN')].sort();
        globalThis.linkEdit = [...collectDuplicateProgramExclusionIds(bookings, 'BK-LINK')].sort();
        globalThis.createMode = [...collectDuplicateProgramExclusionIds(bookings, null)].sort();
        globalThis.detailOnlyEditRelevant = isDuplicateProgramRelevantEdit(bookings, 'BK-MAIN', 'quest', '14:30', 60);
        globalThis.changedTimeRelevant = isDuplicateProgramRelevantEdit(bookings, 'BK-MAIN', 'quest', '15:00', 60);
        globalThis.createRelevant = isDuplicateProgramRelevantEdit(bookings, null, 'quest', '14:30', 60);
    `, context);

    assert.deepEqual(Array.from(context.mainEdit), ['BK-LINK', 'BK-LINK-2', 'BK-MAIN']);
    assert.deepEqual(Array.from(context.linkEdit), ['BK-LINK', 'BK-LINK-2', 'BK-MAIN']);
    assert.deepEqual(Array.from(context.createMode), []);
    assert.equal(context.detailOnlyEditRelevant, false);
    assert.equal(context.changedTimeRelevant, true);
    assert.equal(context.createRelevant, true);
});

test('timeline delete controls use the shared delete permission contract', () => {
    const bookingJs = fs.readFileSync(path.join(ROOT, 'js', 'booking.js'), 'utf8');
    const authJs = fs.readFileSync(path.join(ROOT, 'js', 'auth.js'), 'utf8');

    assert.match(authJs, /delete_booking:\s+_ADMIN_UP/);
    assert.match(bookingJs, /function canDeleteTimelineBooking/);
    assert.match(bookingJs, /canAccess\('delete_booking'\)/);
    assert.match(bookingJs, /if \(!canDeleteTimelineBooking\(\)\) \{\s*showNotification\('Недостатньо прав для видалення бронювання'/s);
    assert.match(bookingJs, /const deleteButton = canDeleteTimelineBooking\(\)/);
});

test('timeline boot binds booking handlers through explicit window exports', () => {
    const bookingJs = fs.readFileSync(path.join(ROOT, 'js', 'booking.js'), 'utf8');
    const appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

    assert.match(bookingJs, /async function handleBookingSubmit\(e\)/);
    assert.match(bookingJs, /window\.handleBookingSubmit = handleBookingSubmit/);
    assert.match(appJs, /function resolveTimelineBootHandler\(name, fallbackMessage\)/);
    assert.match(appJs, /resolveTimelineBootHandler\(\s*'handleBookingSubmit'/);
    assert.doesNotMatch(appJs, /addEventListener\('submit',\s*handleBookingSubmit\)/);
});

test('booking save and timeline navigation preserve selected date in the URL', () => {
    const bookingJs = fs.readFileSync(path.join(ROOT, 'js', 'booking.js'), 'utf8');
    const timelineJs = fs.readFileSync(path.join(ROOT, 'js', 'timeline.js'), 'utf8');
    const appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

    assert.match(timelineJs, /function setTimelineDateInUrl\(date\)/);
    assert.match(timelineJs, /window\.setTimelineDateInUrl = setTimelineDateInUrl/);
    assert.match(timelineJs, /setTimelineDateInUrl\(AppState\.selectedDate\)/);
    assert.match(timelineJs, /setTimelineDateInUrl\(dateStr\)/);
    assert.match(appJs, /url\.searchParams\.delete\('open'\)/);
    assert.doesNotMatch(appJs, /history\.replaceState\(null,\s*'',\s*window\.location\.pathname\)/);
    assert.match(appJs, /setTimelineDateInUrl\(AppState\.selectedDate\)/);
    assert.match(bookingJs, /function restoreTimelineDateAfterBookingSave/);
    assert.match(bookingJs, /restoreTimelineDateAfterBookingSave\(selectedDateBeforeSave \|\| booking\.date\)/);
});

test('stale cancelled booking edit falls back to a fresh create flow', () => {
    const bookingJs = fs.readFileSync(path.join(ROOT, 'js', 'booking.js'), 'utf8');
    const apiJs = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
    const bookingsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'bookings.js'), 'utf8');

    assert.match(bookingJs, /function resetBookingEditStateForCreate/);
    assert.match(bookingJs, /getBookingsForDate\(AppState\.selectedDate, \{ force: true \}\)/);
    assert.match(bookingJs, /delete booking\.id/);
    assert.match(bookingJs, /Попереднє бронювання вже скасоване або недоступне\. Створюю нове бронювання\./);
    assert.match(bookingJs, /cancelled_booking_cannot_be_restored/);
    assert.match(apiJs, /code: body\.code \|\| null/);
    assert.match(apiJs, /currentStatus: body\.currentStatus \|\| null/);
    assert.match(bookingsRoute, /code: 'cancelled_booking_cannot_be_restored'/);
    assert.match(bookingsRoute, /currentStatus: 'cancelled'/);
});

test('second animator repair audit is dry-run by default and inserts only missing linked rows with --fix', () => {
    const script = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-second-animator-links.js'), 'utf8');
    const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');

    assert.match(pkg, /"audit:second-animator-links": "node scripts\/audit-second-animator-links\.js"/);
    assert.match(script, /const FIX = flags\.has\('--fix'\)/);
    assert.match(script, /NULLIF\(BTRIM\(b\.second_animator\), ''\) IS NOT NULL/);
    assert.doesNotMatch(script, /COALESCE\(b\.hosts, 0\) > 1/);
    assert.match(script, /async function existingLinkedSecondAnimator/);
    assert.match(script, /linkedTimelineIdentityMismatch/);
    assert.match(script, /repairLinkedTimelineIdentity/);
    assert.match(script, /timelineIdentity/);
    assert.match(script, /extra_data/);
    assert.match(script, /linked_to = \$1/);
    assert.match(script, /generateBookingNumber\(client\)/);
    assert.match(script, /repair_second_animator_link/);
    assert.match(script, /repair_second_animator_identity/);
    assert.match(script, /if \(!FIX\) continue/);
    assert.match(script, /Database connection unavailable/);
});
