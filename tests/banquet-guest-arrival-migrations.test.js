'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    auditBanquetGuestArrival,
    buildBanquetGuestArrivalAudit,
    resolveBanquetArrivalBackfillCandidate
} = require('../services/banquetGroups');

const ROOT = path.join(__dirname, '..');

test('arrival backfill resolver prefers one explicit primary membership', () => {
    const resolution = resolveBanquetArrivalBackfillCandidate(
        { primary_booking_id: 'booking-fallback' },
        [{ booking_id: 'booking-explicit', role: 'primary' }],
        [{ id: 'booking-explicit', time: '12:30' }, { id: 'booking-fallback', time: '13:00' }]
    );
    assert.deepEqual(resolution, {
        resolved: true,
        source: 'explicit_primary_membership',
        bookingId: 'booking-explicit',
        guestArrivalTime: '12:30',
        reason: null
    });
});

test('arrival backfill resolver uses group primary only without explicit primary', () => {
    const resolution = resolveBanquetArrivalBackfillCandidate(
        { primary_booking_id: 'booking-primary' },
        [{ booking_id: 'booking-kitchen', role: 'kitchen' }],
        [{ id: 'booking-primary', time: '09:05' }]
    );
    assert.equal(resolution.resolved, true);
    assert.equal(resolution.source, 'group_primary_booking');
    assert.equal(resolution.guestArrivalTime, '09:05');
});

test('arrival backfill resolver never guesses ambiguous or invalid explicit primary', () => {
    const ambiguous = resolveBanquetArrivalBackfillCandidate(
        { primary_booking_id: 'booking-fallback' },
        [{ booking_id: 'booking-a', role: 'primary' }, { booking_id: 'booking-b', role: 'primary' }],
        [{ id: 'booking-a', time: '11:00' }, { id: 'booking-b', time: '12:00' }, { id: 'booking-fallback', time: '13:00' }]
    );
    const invalid = resolveBanquetArrivalBackfillCandidate(
        { primary_booking_id: 'booking-fallback' },
        [{ booking_id: 'booking-a', role: 'primary' }],
        [{ id: 'booking-a', time: '25:00' }, { id: 'booking-fallback', time: '13:00' }]
    );
    assert.equal(ambiguous.reason, 'ambiguous_explicit_primary');
    assert.equal(invalid.reason, 'invalid_primary_time');
    assert.equal(ambiguous.resolved, false);
    assert.equal(invalid.resolved, false);
});

test('arrival audit separates resolvable groups and unambiguous legacy components', () => {
    const report = buildBanquetGuestArrivalAudit({
        groupRows: [
            { id: 'group-explicit', business_context: 'event_genix', date: '2026-07-20', primary_booking_id: 'booking-fallback' },
            { id: 'group-missing', business_context: 'event_genix', date: '2026-07-21', primary_booking_id: null }
        ],
        membershipRows: [{ group_id: 'group-explicit', business_context: 'event_genix', booking_id: 'booking-explicit', role: 'primary' }],
        bookingRows: [
            { id: 'booking-explicit', business_context: 'event_genix', time: '12:30', status: 'confirmed' },
            { id: 'legacy-anchor', business_context: 'event_genix', date: '2026-07-22', time: '14:15', line_id: 'banquet-service', status: 'confirmed' },
            { id: 'legacy-activity', business_context: 'event_genix', date: '2026-07-22', time: '15:00', category: 'show', status: 'confirmed' }
        ],
        legacyLinks: [{ business_context: 'event_genix', booking_a_id: 'legacy-anchor', booking_b_id: 'legacy-activity', relation_type: 'banquet_activity' }]
    });
    assert.equal(report.summary.activeGroupsWithNull, 2);
    assert.equal(report.summary.explicitPrimaryCandidates, 1);
    assert.equal(report.summary.legacyLinkOnlyGroups, 1);
    assert.equal(report.summary.singleBanquetAnchors, 1);
    assert.equal(report.summary.ambiguousOrMissingPrimary, 1);
});

test('read-only arrival audit queries do not mutate bookings or banquet data', async () => {
    const queries = [];
    const db = {
        async query(sql) {
            const text = String(sql);
            queries.push(text);
            if (/FROM banquet_groups bg/i.test(text)) return { rows: [] };
            if (/FROM booking_banquet_links/i.test(text)) return { rows: [] };
            if (/FROM banquet_group_bookings/i.test(text)) return { rows: [] };
            if (/FROM bookings b/i.test(text)) return { rows: [] };
            throw new Error(`Unexpected audit query: ${text}`);
        }
    };
    const report = await auditBanquetGuestArrival({ db });
    assert.equal(report.summary.readyForRequiredConstraint, true);
    assert.equal(queries.length, 4);
    for (const query of queries) {
        assert.match(query.trim(), /^SELECT\b/i);
        assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
    }
    const auditScript = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-banquet-guest-arrival.js'), 'utf8');
    assert.match(auditScript, /BEGIN TRANSACTION READ ONLY/);
    assert.doesNotMatch(auditScript, /--apply|--repair/);
});

test('migration 285 is governed, idempotent, NULL-only, and leaves hardening to a later deploy', () => {
    const migration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '285_banquet_guest_arrival_backfill.sql'), 'utf8');
    assert.match(migration, /-- MIGRATION_KIND: data-fix/);
    assert.match(migration, /-- SAFETY:/);
    assert.match(migration, /-- ROLLBACK:/);
    assert.match(migration, /-- DATA_SCOPE:/);
    assert.match(migration, /WITH RECURSIVE/i);
    assert.match(migration, /LOCK TABLE banquet_groups, banquet_group_bookings IN SHARE ROW EXCLUSIVE MODE/i);
    assert.doesNotMatch(migration, /nc\.business_context,\s*nc\.component_key,\s*b\.\*/i);
    assert.match(migration, /anchor_count[\s\S]*= 1/i);
    assert.match(migration, /guest_arrival_time IS NULL/i);
    assert.match(migration, /ON CONFLICT(?: \([^)]*\))? DO NOTHING/i);
    assert.match(migration, /\^\(\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]\$/);
    assert.doesNotMatch(migration, /ALTER\s+COLUMN\s+guest_arrival_time\s+SET\s+NOT\s+NULL/i);
    assert.doesNotMatch(migration, /UPDATE\s+bookings\b/i);
});
