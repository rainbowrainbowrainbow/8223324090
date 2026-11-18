'use strict';

// Reuse the existing canonical booking marker and cleanup protocol. The exact
// run ID and hash-bound marker distinguish this child from other trusted runs.
const SOURCE = 'trusted_qa';
const registry = () => require('./trustedQaRuns');
function requireQa(condition, code) {
    if (!condition) throw new (registry().TrustedQaRunError)('Baseline booking QA validation failed', code, {}, 409);
}

function normalizeBaselineBooking(value, runId) {
    const fixture = registry().normalizeTrustedQaBookingFixture(value);
    requireQa(fixture.requestId === `${runId}-booking` && fixture.label === `${runId}-event`
        && fixture.duration <= 120 && fixture.hosts === 1 && fixture.status === 'confirmed'
        && fixture.pinataMode === 'none' && !fixture.pinataNumber && !fixture.secondAnimatorLineId && !fixture.secondAnimator,
    'BASELINE_QA_BOOKING_SCOPE_INVALID');
    const start = Number(fixture.time.slice(0, 2)) * 60 + Number(fixture.time.slice(3));
    requireQa(start >= 10 * 60 && start + fixture.duration <= 20 * 60, 'BASELINE_QA_BOOKING_SCOPE_INVALID');
    return fixture;
}

async function preflightBaselineBooking(db, fixture, { allowPendingClassification = false } = {}) {
    const room = await db.query(`SELECT resource_id,name,metadata FROM timeline_resources
        WHERE business_context='event_genix' AND resource_id=$1 AND type='room' AND is_active IS TRUE`, [fixture.roomResourceId]);
    requireQa(room.rowCount === 1 && room.rows[0].name === fixture.room, 'BASELINE_QA_ROOM_DRIFT');
    const classified = room.rows[0].metadata?.workArea === 'game_zone';
    requireQa(classified || (allowPendingClassification && room.rows[0].metadata && typeof room.rows[0].metadata === 'object'
        && !Array.isArray(room.rows[0].metadata)
        && !Object.hasOwn(room.rows[0].metadata, 'workArea')), 'BASELINE_QA_ZONE_CLASSIFICATION_REQUIRED');
    const line = await db.query(`SELECT line_id,name FROM lines_by_date l WHERE business_context='event_genix'
        AND LEFT(date::text,10)=$1 AND line_id=$2 AND (from_sheet IS DISTINCT FROM true OR EXISTS(
            SELECT 1 FROM staff_schedule ss JOIN staff s ON s.id=ss.staff_id
            WHERE ss.staff_id::text=l.line_id AND LEFT(ss.date::text,10)=$1
              AND ss.status IN ('working','remote') AND s.is_active IS TRUE))`, [fixture.date, fixture.lineId]);
    requireQa(line.rowCount === 1 && /^Аніматор\s*[1-5]$/.test(line.rows[0].name), 'BASELINE_QA_LINE_UNAVAILABLE');
    const product = await db.query(`SELECT p.id,p.name,p.code,p.timeline_code,p.category,p.domain,
        EXISTS(SELECT 1 FROM product_stock_requirements psr WHERE psr.product_id::text=p.id::text) AS has_stock
        FROM products p WHERE p.id=$1 AND p.is_active IS TRUE AND COALESCE(p.business_context,'event_genix')='event_genix'`,
    [fixture.productId || fixture.programId]);
    const item = product.rows[0];
    requireQa(product.rowCount === 1 && item && !item.has_stock && (item.domain || 'program') === 'program'
        && fixture.programId === String(item.id) && fixture.programName === item.name
        && [item.code,item.timeline_code].includes(fixture.programCode) && fixture.category === item.category
        && !/banquet|kitchen|certificate|банкет|кух/i.test(item.category || ''), 'BASELINE_QA_PRODUCT_DRIFT');
    const overlap = await db.query(`SELECT COUNT(*)::int AS count FROM bookings
        WHERE business_context='event_genix' AND LEFT(date::text,10)=$1
          AND LOWER(COALESCE(NULLIF(BTRIM(status),''),'confirmed')) NOT IN ('cancelled','canceled')
          AND (line_id=$2 OR room_resource_id=$3) AND time::time<($4::time+($5::text||' minutes')::interval)
          AND time::time+(COALESCE(duration,0)::text||' minutes')::interval>$4::time`,
    [fixture.date, fixture.lineId, fixture.roomResourceId, fixture.time, fixture.duration]);
    requireQa(Number(overlap.rows[0]?.count) === 0, 'BASELINE_QA_BOOKING_WINDOW_OCCUPIED');
    return { ready: classified, classificationRequired: !classified };
}

async function createBaselineBookingRun(db, plan, planHash, identities) {
    requireQa(plan.booking && /^[a-f0-9]{64}$/.test(planHash), 'BASELINE_QA_BOOKING_PLAN_REQUIRED');
    await preflightBaselineBooking(db, plan.booking);
    const admin = identities.actors.find(actor => actor.role === 'admin');
    const owned = await db.query(`SELECT u.id FROM trusted_qa_runs r
        JOIN trusted_qa_run_entities e ON e.run_id=r.id AND e.entity_type='baseline_account' AND e.cleanup_state='active'
        JOIN users u ON u.id::text=e.entity_id
        WHERE r.id=$1 AND r.run_id=$2 AND r.source='baseline_access_qa' AND r.state='active' AND r.expires_at>clock_timestamp()
          AND r.test_customer_marker=$3 AND u.id=$4 AND u.role='admin' AND u.is_active IS TRUE
          AND u.username=$5 AND e.payload->>'role'='admin' FOR SHARE OF r,u`,
    [identities.runId, plan.runId, `${plan.runId}:baseline:${planHash}`, admin?.id, `${plan.runId}-account-2`]);
    requireQa(owned.rowCount === 1, 'BASELINE_QA_BOOKING_ACTOR_NOT_OWNED');
    const result = await registry().createTrustedQaRun(db, {
        runId: `${plan.runId}-booking`, source: SOURCE, businessContext: 'event_genix',
        operatorUserId: admin.id, requiredOperatorUserId: admin.id, requiredUserId: admin.id,
        maxEntityCount: 1, ttlMinutes: plan.ttlMinutes,
        testCustomerMarker: `${plan.runId}:booking:${planHash}`,
        allowedEndpoints: ['POST /api/bookings'], bookingFixtures: [plan.booking],
        requiredProgramId: plan.booking.programId, requiredProductId: plan.booking.productId || plan.booking.programId,
        requiredRoomResourceId: plan.booking.roomResourceId, requiredLineId: plan.booking.lineId,
        allowedDate: plan.booking.date, allowedStartTime: '10:00', allowedEndTime: '20:00'
    });
    const scope = { runId: result.run.id, operatorId: admin.id };
    Object.defineProperty(scope, 'token', { value: result.token });
    return scope;
}

async function finishBaselineBookingRun(db, plan, planHash) {
    const found = await db.query(`SELECT id FROM trusted_qa_runs WHERE run_id=$1 AND source=$2
        AND business_context='event_genix' AND test_customer_marker=$3 AND max_entity_count=1 FOR UPDATE`,
    [`${plan.runId}-booking`, SOURCE, `${plan.runId}:booking:${planHash}`]);
    if (!found.rowCount) return { status: 'absent', state: 'absent' };
    requireQa(found.rowCount === 1, 'BASELINE_QA_BOOKING_RUN_INVALID');
    return registry().cleanupTrustedQaRun(db, found.rows[0].id, { forUpdate: true });
}

module.exports = { SOURCE, normalizeBaselineBooking, preflightBaselineBooking, createBaselineBookingRun, finishBaselineBookingRun };
