const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
    assert.match(bookingsRoute, /\[mainBooking, \.\.\.linkedBookings\]\.map\(async booking/);
    assert.match(bookingsRoute, /booking\.timelineProjection = await bookingDayProjectionStatus/);
    assert.match(bookingsRoute, /booking_line_not_visible/);
    assert.match(bookingsRoute, /ensureParkAnimatorLine\(client, \{\s*businessContext,\s*date: lb\.date \|\| main\.date/s);
    assert.match(bookingsRoute, /Number\(main\.hosts \|\| 0\) > 1 && main\.secondAnimator/);
});
