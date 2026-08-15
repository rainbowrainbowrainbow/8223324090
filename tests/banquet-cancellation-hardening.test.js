'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('generic booking DELETE routes active banquet members to canonical cancellation endpoints', () => {
    const route = read('routes/bookings.js');
    const deleteBlock = route.slice(route.indexOf("router.delete('/:id'"), route.indexOf('// Update booking'));
    const service = read('services/banquetCancellation.js');
    assert.match(deleteBlock, /routeRequiredPayload/);
    assert.match(deleteBlock, /banquet_group_cancel/);
    assert.match(deleteBlock, /banquet_activity_cancel/);
    assert.match(service, /BANQUET_ROUTE_REQUIRED/);
    assert.doesNotMatch(deleteBlock, /preflightActiveBanquetPrimaryCancellation\(client/);
});

test('banquet cancellation service treats price-only as safe and hard artifacts as blockers', () => {
    const service = read('services/banquetCancellation.js');
    assert.match(service, /bookingHardBlockers/);
    assert.doesNotMatch(service, /Number\(booking\.price \|\| 0\) > 0\) blockers/);
    for (const token of [
        'paid_amount',
        'payment_status',
        'certificate',
        'fiscal_receipt',
        'receipt',
        'noncanonical_finance',
        'stock_without_provenance'
    ]) {
        assert.match(service, new RegExp(token));
    }
    assert.match(service, /syncBookingFinanceInTransaction\(client, booking/);
    assert.match(service, /optional: false/);
});

test('frontend cancellation UI is readiness-driven and has no generic undo restore after cancel', () => {
    const booking = read('js/booking.js');
    const api = read('js/api.js');
    const ws = read('js/ws.js');
    assert.match(api, /apiGetBookingCancellationReadiness/);
    assert.match(api, /apiCancelBanquetActivity/);
    assert.match(api, /apiCancelBanquetGroup/);
    assert.match(booking, /requestBookingCancellation/);
    assert.match(booking, /renderBookingCancellationAction/);
    assert.match(booking, /Прибрати складову/);
    assert.match(booking, /Скасувати весь банкет/);
    assert.match(booking, /Скасувати бронювання/);
    assert.doesNotMatch(booking.slice(booking.indexOf('async function requestBookingCancellation')), /pushUndo\('delete'/);
    assert.match(ws, /case 'banquet:booking-set-updated':/);
});

test('banquet cancellation broadcasts booking-set updates to same-user tabs', () => {
    const service = read('services/banquetCancellation.js');
    const start = service.indexOf('function broadcastCancellation');
    const end = service.indexOf('module.exports', start);
    const block = service.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(block, /broadcastBookingEvent\('booking:deleted', booking, excludeUserId/);
    assert.match(
        block,
        /broadcastBanquetEvent\('banquet:booking-set-updated'[\s\S]*?\}, null, \{/,
        'banquet booking-set broadcast must not exclude the initiating user because other same-user tabs need the WS invalidation'
    );
});

test('room hardening closes known active write paths and adds not-valid guards', () => {
    const bookingRoutes = read('routes/bookings.js');
    const banquetService = read('services/banquetGroups.js');
    const graduation = read('routes/graduation.js');
    const secondAnimator = read('scripts/audit-second-animator-links.js');
    const reconcileScript = read('scripts/reconcile-banquet-groups.js');
    const repairScript = read('scripts/repair-banquet-activity-consistency.js');
    const backfillScript = read('scripts/backfill-room-resource-id.js');
    const migration = read('db/migrations/332_booking_room_identity_active_guards.sql');
    assert.match(bookingRoutes, /activeEventGenixRoomIdentityRequired\(payload, businessContext\)/);
    assert.match(banquetService, /assertActiveBookingRoomIdentity\(primary, context/);
    assert.match(banquetService, /primary_room_identity_invalid/);
    assert.match(graduation, /canonicalizeBookingRoomResource/);
    assert.match(graduation, /room_resource_id/);
    assert.match(secondAnimator, /room_resource_id/);
    assert.match(secondAnimator, /refusing to create linked second animator booking/);
    assert.match(reconcileScript, /room_identity_required/);
    assert.match(repairScript, /Promotion target room identity invalid/);
    assert.match(backfillScript, /buildBackfillManifest/);
    assert.match(backfillScript, /zeroMutationProof/);
    assert.match(backfillScript, /manifestHash/);
    assert.match(migration, /NOT VALID/);
    assert.match(migration, /chk_bookings_active_room_identity_v332/);
    assert.match(migration, /trg_banquet_groups_identity_v332/);
});

test('active banquet fixtures keep room identity and transactional group invariants', () => {
    const routeSmoke = read('tests/route-smoke.test.js');
    const banquetLinks = read('tests/booking-banquet-links.test.js');
    const packageContract = read('tests/booking-package-contract.test.js');
    const banquetService = read('services/banquetGroups.js');

    for (const fixtureId of [
        'BK-AUTO-KITCHEN',
        'BK-AUTO-ACTIVITY',
        'BK-AUTO-ACTIVITY-SECOND',
        'BK-AUTO-DIFFERENT-CUSTOMER',
        'BK-AUTO-DIFFERENT-ROOM',
        'BK-AUTO-DIFFERENT-DATE'
    ]) {
        assert.match(
            routeSmoke,
            new RegExp(`id: '${fixtureId}'[\\s\\S]{0,900}room_resource_id: 'room-`),
            `${fixtureId} must carry a durable room_resource_id fixture`
        );
    }

    assert.match(routeSmoke, /membersById\.get\('BK-AUTO-KITCHEN'\)\?\.membershipRole, 'primary'/);
    assert.match(routeSmoke, /membersById\.get\('BK-AUTO-ACTIVITY'\)\?\.membershipRole, 'activity'/);
    assert.match(routeSmoke, /membersById\.get\('BK-AUTO-ACTIVITY-SECOND'\)\?\.membershipRole, 'activity'/);
    assert.match(banquetService, /createBanquetGroupInTransaction/);
    assert.match(banquetLinks, /ROLLBACK/);
    assert.match(packageContract, /room_resource_id: 'room-marvel'/);
    assert.doesNotMatch(routeSmoke, /status: 'confirmed'[\s\S]{0,500}room_resource_id: null/);
});

test('trusted QA markers require server token and manifest registration', () => {
    const service = read('services/trustedQaRuns.js');
    const bookings = read('routes/bookings.js');
    const migration = read('db/migrations/333_trusted_qa_runs.sql');
    const lifecycleMigration = read('db/migrations/334_trusted_qa_lifecycle_hardening.sql');
    const executionWindowMigration = read('db/migrations/335_trusted_qa_execution_window.sql');
    const scheduler = read('server.js');
    const schedulerSurface = read('config/schedulerSurface.js');
    const schedulerDocs = read('docs/SCHEDULER_SURFACE.md');
    const disposableQa = read('services/disposableQa.js');
    assert.match(service, /QA_MARKER_UNTRUSTED/);
    assert.match(service, /QA_RUN_TOKEN_REPLAYED/);
    assert.match(service, /assertRunMatchesRequest\(req\.__trustedQaContext\.run, req, booking, businessContext\)/);
    assert.match(service, /runTrustedQaCleanupWatchdog/);
    assert.match(service, /token_hash/);
    assert.match(service, /prepareTrustedQaBookingInput/);
    assert.match(disposableQa, /DISPOSABLE_QA_TRUSTED_SOURCE/);
    assert.match(bookings, /prepareTrustedQaBookingInput/);
    assert.match(bookings, /registerQaEntity/);
    assert.match(bookings, /hasTrustedQaBookingMarker/);
    assert.match(bookings, /suppressTrustedQaSideEffects/);
    assert.match(bookings, /!suppressTrustedQaSideEffects && sideEffectsAllowedForContext/);
    assert.match(bookings, /registerQaEntity\(client, qaContext, 'banquet_group'/);
    assert.match(bookings, /'banquet_membership'/);
    assert.match(bookings, /'booking_banquet_link'/);
    assert.match(bookings, /bookingCreateSideEffectsAllowed\(\)\s*\?\s*await syncManagerDepositForBooking/);
    assert.match(bookings, /if \(bookingCreateSideEffectsAllowed\(\)\) \{\s*await syncBookingLeadHandoff/);
    assert.match(service, /QA_RUN_SIDE_EFFECT_BLOCKER/);
    assert.match(service, /QA_RUN_SIDE_EFFECT_VISIBILITY_BLOCKER/);
    assert.match(service, /processedHistoricalCount/);
    assert.doesNotMatch(service, /DELETE FROM event_queue/);
    assert.match(service, /TRUSTED_QA_SIDE_EFFECT_TABLES/);
    assert.match(bookings, /bookingCreateSideEffectsAllowed\(\) && b\.secondAnimator && b\.date/);
    assert.match(bookings, /fullCreateSideEffectsAllowed\(\) \? Boolean\(lb\.skipNotification\) : true/);
    assert.match(migration, /trusted_qa_runs/);
    assert.match(migration, /trusted_qa_run_entities/);
    assert.match(lifecycleMigration, /trusted_qa_run_token_uses/);
    assert.match(lifecycleMigration, /cleanup_pending/);
    assert.match(executionWindowMigration, /required_line_id/);
    assert.match(executionWindowMigration, /allowed_date/);
    assert.match(service, /QA_RUN_LINE_MISMATCH/);
    assert.match(service, /QA_RUN_DATE_MISMATCH/);
    assert.match(service, /QA_RUN_TIME_WINDOW_MISMATCH/);
    assert.match(scheduler, /runTrustedQaCleanupWatchdog/);
    assert.match(schedulerSurface, /runTrustedQaCleanupWatchdog/);
    assert.match(schedulerDocs, /tests\/trusted-qa-runs\.test\.js/);
});
