/**
 * Real PostgreSQL and HTTP coverage for migration 300 and admission ticket APIs.
 *
 * Run only through:
 *   npm run test:integration:admission-tickets:isolated
 */
'use strict';

const crypto = require('node:crypto');
const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const {
    AdmissionTicketError,
    appendAdmissionTicketTariffVersion,
    resolveAdmissionTicketQuote
} = require('../../services/admissionTickets');
const { loadBackupCatalog } = require('../../services/backupCatalog');

const enabled = process.env.RUN_ADMISSION_TICKETS_INTEGRATION === 'true';

function requireIsolatedDatabase() {
    assert.equal(enabled, true, 'set RUN_ADMISSION_TICKETS_INTEGRATION=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL);
    assert.ok(process.env.TEST_URL);
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

function createPool(testDb) {
    return new Pool({
        connectionString: testDb.url.toString(),
        ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
        max: 8,
        connectionTimeoutMillis: 10_000
    });
}

async function apiRequest(method, pathname, { token = null, body = undefined } = {}) {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${process.env.TEST_URL}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000)
    });
    return {
        status: response.status,
        headers: response.headers,
        body: await response.json().catch(() => ({}))
    };
}

async function login(username, password) {
    const response = await apiRequest('POST', '/api/auth/login', {
        body: { username, password }
    });
    assert.equal(response.status, 200, `login failed for ${username}: ${JSON.stringify(response.body)}`);
    assert.ok(response.body.token);
    return response.body.token;
}

async function expectPgCode(promise, code) {
    let caught = null;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    assert.ok(caught, `expected PostgreSQL error ${code}`);
    assert.equal(caught.code, code);
}

describe('admission ticket migration 300 and APIs on isolated PostgreSQL', {
    skip: !enabled,
    concurrency: 1
}, () => {
    let pool;
    let suffix;
    let password;
    let manager;
    let seniorManager;
    let reception;
    let animator;
    let creatorToken;
    let managerToken;
    let seniorManagerToken;
    let receptionToken;
    let animatorToken;
    let legacyBookingId;
    let legacyGroupId;

    before(async () => {
        const testDb = requireIsolatedDatabase();
        pool = createPool(testDb);
        suffix = `${process.pid}_${Date.now()}`;
        password = `Admission-${crypto.randomBytes(18).toString('base64url')}`;
        const passwordHash = await bcrypt.hash(password, 4);
        const users = [];
        for (const role of ['manager', 'senior_manager', 'reception', 'animator']) {
            const username = `ticket_${role}_${suffix}`.slice(0, 80);
            const result = await pool.query(
                `INSERT INTO users (username, password_hash, name, role, is_active)
                 VALUES ($1, $2, $3, $4, true)
                 RETURNING id, username, role`,
                [username, passwordHash, `Ticket ${role} ${suffix}`, role]
            );
            users.push(result.rows[0]);
        }
        [manager, seniorManager, reception, animator] = users;

        creatorToken = await login(process.env.TEST_USER, process.env.TEST_PASS);
        managerToken = await login(manager.username, password);
        seniorManagerToken = await login(seniorManager.username, password);
        receptionToken = await login(reception.username, password);
        animatorToken = await login(animator.username, password);

        legacyBookingId = `ticket-legacy-${suffix}`.slice(0, 50);
        legacyGroupId = `ticket-group-${suffix}`.slice(0, 50);
        await pool.query(
            `INSERT INTO bookings (
                 id, business_context, date, time, line_id, label,
                 room, room_resource_id, banquet_guests, banquet_adults,
                 kids_count, extra_data
             )
             VALUES (
                 $1, 'event_genix', '2026-07-17', '14:00', 'room-yellow-table',
                 'Admission legacy fixture', 'Жовтий стіл', 'room-yellow-table',
                 12, 2, 12, $2::jsonb
             )`,
            [
                legacyBookingId,
                JSON.stringify({
                    bookingPackage: {
                        schemaVersion: 2,
                        entryCharge: {
                            quantity: 12,
                            unitPrice: 300,
                            subtotal: 3600,
                            ruleCode: 'banquet_entry_weekday_child'
                        },
                        entrySubtotal: 3600
                    }
                })
            ]
        );
        await pool.query(
            `INSERT INTO banquet_groups (
                 id, business_context, primary_booking_id, date, room,
                 room_resource_id, guest_arrival_time, status, source
             )
             VALUES (
                 $1, 'event_genix', $2, '2026-07-17', 'Жовтий стіл',
                 'room-yellow-table', '14:00', 'active', 'admission_test'
             )`,
            [legacyGroupId, legacyBookingId]
        );
        await pool.query(
            `INSERT INTO banquet_group_bookings (
                 group_id, business_context, booking_id, role, created_by
             )
             VALUES ($1, 'event_genix', $2, 'primary', 'admission_test')`,
            [legacyGroupId, legacyBookingId]
        );
    });

    after(async () => {
        if (!pool) return;
        try {
            if (legacyGroupId) {
                await pool.query('DELETE FROM banquet_group_bookings WHERE group_id = $1', [legacyGroupId]);
                await pool.query('DELETE FROM banquet_groups WHERE id = $1', [legacyGroupId]);
            }
            if (legacyBookingId) {
                await pool.query('DELETE FROM bookings WHERE id = $1', [legacyBookingId]);
            }
            const userIds = [manager, seniorManager, reception, animator]
                .map(user => Number(user?.id))
                .filter(Number.isInteger);
            if (userIds.length) {
                await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]);
            }
        } finally {
            await pool.end();
            pool = null;
        }
    });

    test('fresh migration seeds six types, 24 tariff cells, audit rows, and preserves legacy rules', async () => {
        const counts = await pool.query(`
            SELECT
                (SELECT COUNT(*)::integer
                 FROM admission_ticket_types
                 WHERE business_context = 'event_genix') AS type_count,
                (SELECT COUNT(*)::integer
                 FROM admission_ticket_tariff_versions version
                 JOIN admission_ticket_types type ON type.id = version.ticket_type_id
                 WHERE type.business_context = 'event_genix') AS tariff_count,
                (SELECT COUNT(*)::integer
                 FROM admission_ticket_tariff_audit
                 WHERE business_context = 'event_genix') AS audit_count
        `);
        assert.deepEqual(counts.rows[0], {
            type_count: 6,
            tariff_count: 24,
            audit_count: 24
        });

        const underThreeWeekend = await pool.query(
            `SELECT context.admission_context, version.availability, version.amount_uah
             FROM (
                 VALUES ('standard'::text), ('reserved_table_room'::text)
             ) context(admission_context)
             JOIN admission_ticket_types type
               ON type.business_context = 'event_genix'
              AND type.code = 'under_3_child'
             JOIN admission_ticket_tariff_versions version
               ON version.ticket_type_id = type.id
              AND version.admission_context = context.admission_context
              AND version.day_type = 'weekend'
              AND version.revision = 1
             ORDER BY context.admission_context`
        );
        assert.deepEqual(underThreeWeekend.rows, [
            { admission_context: 'reserved_table_room', availability: 'unavailable', amount_uah: null },
            { admission_context: 'standard', availability: 'unavailable', amount_uah: null }
        ]);

        const legacy = await pool.query(
            `SELECT code, value::numeric::text AS value
             FROM price_rules
             WHERE code = ANY($1::text[])
             ORDER BY code`,
            [['banquet_entry_weekday_child', 'banquet_entry_weekend_child']]
        );
        assert.deepEqual(legacy.rows, [
            { code: 'banquet_entry_weekday_child', value: '300' },
            { code: 'banquet_entry_weekend_child', value: '400' }
        ]);
    });

    test('database blocks type mutation/deletion, remainder deactivation, tariff mutation, and invalid amount shape', async () => {
        await expectPgCode(
            pool.query(
                `UPDATE admission_ticket_types
                 SET code = 'changed_code'
                 WHERE business_context = 'event_genix'
                   AND code = 'birthday_child'`
            ),
            '55000'
        );
        await expectPgCode(
            pool.query(
                `UPDATE admission_ticket_types
                 SET is_active = false
                 WHERE business_context = 'event_genix'
                   AND code = 'regular_child'`
            ),
            '55000'
        );
        await expectPgCode(
            pool.query(
                `DELETE FROM admission_ticket_types
                 WHERE business_context = 'event_genix'
                   AND code = 'adult_game'`
            ),
            '55000'
        );
        await expectPgCode(
            pool.query(
                `UPDATE admission_ticket_tariff_versions
                 SET amount_uah = 999
                 WHERE id = (
                     SELECT version.id
                     FROM admission_ticket_tariff_versions version
                     JOIN admission_ticket_types type ON type.id = version.ticket_type_id
                     WHERE type.business_context = 'event_genix'
                     LIMIT 1
                 )`
            ),
            '55000'
        );
        await expectPgCode(
            pool.query(
                `INSERT INTO admission_ticket_tariff_versions (
                     ticket_type_id, admission_context, day_type, availability,
                     amount_uah, effective_from, revision, created_by
                 )
                 SELECT id, 'standard', 'weekday', 'available',
                        NULL, DATE '2099-01-01', 99, 'invalid_test'
                 FROM admission_ticket_types
                 WHERE business_context = 'event_genix'
                   AND code = 'birthday_child'`
            ),
            '23514'
        );
    });

    test('catalog and mutation endpoints enforce authentication, role floors, and context isolation', async () => {
        const unauthenticated = await apiRequest('GET', '/api/center/tickets?businessContext=event_genix');
        assert.equal(unauthenticated.status, 401);

        const insufficient = await apiRequest('GET', '/api/center/tickets?businessContext=event_genix', {
            token: animatorToken
        });
        assert.equal(insufficient.status, 403);

        const managerRead = await apiRequest(
            'GET',
            '/api/center/tickets?businessContext=event_genix&pricingDate=2026-07-18',
            { token: managerToken }
        );
        assert.equal(managerRead.status, 200);
        assert.equal(managerRead.body.ticketTypes.length, 6);
        assert.match(managerRead.headers.get('cache-control') || '', /no-store/i);

        const mutationPayload = {
            admissionContext: 'standard',
            dayType: 'weekday',
            availability: 'available',
            amountUah: 351,
            effectiveFrom: '2026-08-01',
            expectedRevision: 1,
            changeNote: '<script>audit is data, never HTML</script>'
        };
        const managerWrite = await apiRequest(
            'POST',
            '/api/center/tickets/regular_child/tariffs?businessContext=event_genix',
            { token: managerToken, body: mutationPayload }
        );
        assert.equal(managerWrite.status, 403);

        const seniorWrite = await apiRequest(
            'POST',
            '/api/center/tickets/regular_child/tariffs?businessContext=event_genix',
            { token: seniorManagerToken, body: mutationPayload }
        );
        assert.equal(seniorWrite.status, 201, JSON.stringify(seniorWrite.body));
        assert.equal(seniorWrite.body.tariff.revision, 2);
        assert.equal(seniorWrite.body.tariff.amountUah, 351);
        assert.equal(seniorWrite.body.previousTariff.revision, 1);

        const darCatalog = await apiRequest(
            'GET',
            '/api/center/tickets?businessContext=dar&pricingDate=2026-07-18',
            { token: creatorToken }
        );
        assert.equal(darCatalog.status, 200);
        assert.deepEqual(darCatalog.body.ticketTypes, []);

        const darWrite = await apiRequest(
            'POST',
            '/api/center/tickets/regular_child/tariffs?businessContext=dar',
            { token: creatorToken, body: mutationPayload }
        );
        assert.equal(darWrite.status, 404);
        assert.equal(darWrite.body.code, 'TICKET_TYPE_NOT_FOUND');
    });

    test('effective date and revision order select the latest applicable tariff without repricing earlier dates', async () => {
        const before = await resolveAdmissionTicketQuote({
            queryable: pool,
            businessContext: 'event_genix',
            input: {
                date: '2026-07-31',
                roomResourceId: 'room-takeaway',
                banquetGuests: 1,
                banquetAdults: 0,
                ticketQuantities: []
            },
            newBanquetFlow: true
        });
        assert.equal(before.ticketLines[0].unitPriceUah, 350);
        assert.equal(before.ticketLines[0].tariffVersionId > 0, true);

        const appended = await appendAdmissionTicketTariffVersion(pool, {
            businessContext: 'event_genix',
            code: 'regular_child',
            actor: 'integration_revision_editor',
            input: {
                admissionContext: 'standard',
                dayType: 'weekday',
                availability: 'available',
                amountUah: 352,
                effectiveFrom: '2026-08-01',
                expectedRevision: 2,
                changeNote: 'Same-date revision selection'
            }
        });
        assert.equal(appended.tariff.revision, 3);

        const after = await resolveAdmissionTicketQuote({
            queryable: pool,
            businessContext: 'event_genix',
            input: {
                date: '2026-08-03',
                roomResourceId: 'room-takeaway',
                banquetGuests: 1,
                banquetAdults: 0,
                ticketQuantities: []
            },
            newBanquetFlow: true
        });
        assert.equal(after.ticketLines[0].unitPriceUah, 352);
        assert.equal(after.ticketLines[0].tariffVersionId, appended.tariff.id);
    });

    test('two concurrent tariff editors serialize on the type row and one receives a stale revision conflict', async () => {
        const payload = amountUah => appendAdmissionTicketTariffVersion(pool, {
            businessContext: 'event_genix',
            code: 'adult_game',
            actor: `concurrent_${amountUah}`,
            input: {
                admissionContext: 'standard',
                dayType: 'weekday',
                availability: 'available',
                amountUah,
                effectiveFrom: '2026-08-01',
                expectedRevision: 1,
                changeNote: 'Concurrent integration test'
            }
        });
        const outcomes = await Promise.allSettled([payload(76), payload(77)]);
        assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
        const rejection = outcomes.find(result => result.status === 'rejected').reason;
        assert.equal(rejection instanceof AdmissionTicketError, true);
        assert.equal(rejection.status, 409);
        assert.equal(rejection.code, 'TICKET_TARIFF_REVISION_CONFLICT');

        const versions = await pool.query(
            `SELECT version.revision, version.amount_uah::numeric::text AS amount
             FROM admission_ticket_tariff_versions version
             JOIN admission_ticket_types type ON type.id = version.ticket_type_id
             WHERE type.business_context = 'event_genix'
               AND type.code = 'adult_game'
               AND version.admission_context = 'standard'
               AND version.day_type = 'weekday'
             ORDER BY version.revision`
        );
        assert.equal(versions.rows.length, 2);
        assert.deepEqual(versions.rows.map(row => row.revision), [1, 2]);
    });

    test('quote API uses server context/formulas, rejects tampering, and distinguishes weekend unavailable', async () => {
        const unauthenticated = await apiRequest('POST', '/api/bookings/ticket-quote', {
            body: {
                date: '2026-07-17',
                roomResourceId: 'room-takeaway',
                banquetGuests: 1,
                banquetAdults: 0,
                ticketQuantities: []
            }
        });
        assert.equal(unauthenticated.status, 401);

        const insufficient = await apiRequest('POST', '/api/bookings/ticket-quote', {
            token: animatorToken,
            body: {
                date: '2026-07-17',
                roomResourceId: 'room-takeaway',
                banquetGuests: 1,
                banquetAdults: 0,
                ticketQuantities: []
            }
        });
        assert.equal(insufficient.status, 403);

        const mixed = await apiRequest(
            'POST',
            '/api/bookings/ticket-quote?businessContext=event_genix',
            {
                token: receptionToken,
                body: {
                    businessContext: 'dar',
                    date: '2026-07-17',
                    roomResourceId: 'room-takeaway',
                    banquetGuests: 5,
                    banquetAdults: 2,
                    ticketQuantities: [
                        { code: 'birthday_child', quantity: 1 },
                        { code: 'discounted_child', quantity: 1 },
                        { code: 'adult_game', quantity: 1 }
                    ]
                }
            }
        );
        assert.equal(mixed.status, 200, JSON.stringify(mixed.body));
        assert.equal(mixed.body.quote.admissionContext, 'standard');
        assert.equal(mixed.body.quote.dayType, 'weekday');
        assert.equal(mixed.body.quote.ticketSubtotal, 1320);
        assert.deepEqual(
            Object.fromEntries(mixed.body.quote.ticketLines.map(line => [
                line.ticketTypeCode,
                line.quantity
            ])),
            {
                regular_child: 3,
                discounted_child: 1,
                birthday_child: 1,
                adult_companion: 1,
                adult_game: 1
            }
        );

        const reserved = await apiRequest(
            'POST',
            '/api/bookings/ticket-quote?businessContext=event_genix',
            {
                token: receptionToken,
                body: {
                    date: '2026-07-17',
                    roomResourceId: 'room-yellow-table',
                    banquetGuests: 1,
                    banquetAdults: 0,
                    ticketQuantities: []
                }
            }
        );
        assert.equal(reserved.status, 200);
        assert.equal(reserved.body.quote.admissionContext, 'reserved_table_room');
        assert.equal(reserved.body.quote.ticketLines[0].unitPriceUah, 310);

        const tampered = await apiRequest(
            'POST',
            '/api/bookings/ticket-quote?businessContext=event_genix',
            {
                token: receptionToken,
                body: {
                    date: '2026-07-17',
                    roomResourceId: 'room-takeaway',
                    banquetGuests: 1,
                    banquetAdults: 0,
                    ticketQuantities: [],
                    unitPrice: 1,
                    subtotal: 1
                }
            }
        );
        assert.equal(tampered.status, 422);
        assert.equal(tampered.body.code, 'TICKET_PRICING_FIELD_FORBIDDEN');

        const unavailable = await apiRequest(
            'POST',
            '/api/bookings/ticket-quote?businessContext=event_genix',
            {
                token: receptionToken,
                body: {
                    date: '2026-07-18',
                    roomResourceId: 'room-yellow-table',
                    banquetGuests: 1,
                    banquetAdults: 0,
                    ticketQuantities: [{ code: 'under_3_child', quantity: 1 }]
                }
            }
        );
        assert.equal(unavailable.status, 422);
        assert.equal(unavailable.body.code, 'TICKET_TYPE_UNAVAILABLE');
    });

    test('existing booking quote reads legacy snapshot without conversion and canonical group/room evidence on explicit conversion', async () => {
        const legacy = await apiRequest(
            'POST',
            '/api/bookings/ticket-quote?businessContext=event_genix',
            {
                token: receptionToken,
                body: { bookingId: legacyBookingId }
            }
        );
        assert.equal(legacy.status, 200, JSON.stringify(legacy.body));
        assert.equal(legacy.body.quote.legacy, true);
        assert.equal(legacy.body.quote.requiresExplicitConversion, true);
        assert.equal(legacy.body.quote.ticketSubtotal, 3600);
        assert.equal(legacy.body.quote.ticketLines.length, 1);

        const converted = await apiRequest(
            'POST',
            '/api/bookings/ticket-quote?businessContext=event_genix',
            {
                token: receptionToken,
                body: {
                    bookingId: legacyBookingId,
                    convertLegacy: true,
                    ticketQuantities: []
                }
            }
        );
        assert.equal(converted.status, 200, JSON.stringify(converted.body));
        assert.equal(converted.body.quote.legacy, false);
        assert.equal(converted.body.quote.admissionContext, 'reserved_table_room');
        assert.equal(converted.body.quote.ticketSubtotal, 3740);
    });

    test('legacy update preserves entryCharge until explicit v3 conversion and stale save is rejected', async () => {
        const before = await pool.query(
            `SELECT extra_data->'bookingPackage'->'entryCharge' AS entry_charge
             FROM bookings
             WHERE id = $1`,
            [legacyBookingId]
        );
        const unrelated = await apiRequest(
            'PUT',
            `/api/bookings/${encodeURIComponent(legacyBookingId)}?businessContext=event_genix`,
            {
                token: receptionToken,
                body: {
                    notes: 'Legacy preservation integration check',
                    kidsCount: 12
                }
            }
        );
        assert.equal(unrelated.status, 200, JSON.stringify(unrelated.body));
        const preserved = await pool.query(
            `SELECT extra_data->'bookingPackage'->'entryCharge' AS entry_charge
             FROM bookings
             WHERE id = $1`,
            [legacyBookingId]
        );
        assert.deepEqual(preserved.rows[0].entry_charge, before.rows[0].entry_charge);

        const conversionQuote = await apiRequest(
            'POST',
            '/api/bookings/ticket-quote?businessContext=event_genix',
            {
                token: receptionToken,
                body: {
                    bookingId: legacyBookingId,
                    convertLegacy: true,
                    ticketQuantities: []
                }
            }
        );
        assert.equal(conversionQuote.status, 200, JSON.stringify(conversionQuote.body));
        const converted = await apiRequest(
            'PUT',
            `/api/bookings/${encodeURIComponent(legacyBookingId)}?businessContext=event_genix`,
            {
                token: receptionToken,
                body: {
                    kidsCount: 12,
                    banquetGuests: 12,
                    banquetAdults: 2,
                    ticketQuantities: [],
                    ticketQuote: conversionQuote.body.quote,
                    convertLegacy: true
                }
            }
        );
        assert.equal(converted.status, 200, JSON.stringify(converted.body));
        const stored = await pool.query(
            `SELECT price::numeric::text AS price,
                    extra_data->'bookingPackage' AS package
             FROM bookings
             WHERE id = $1`,
            [legacyBookingId]
        );
        assert.equal(stored.rows[0].package.schemaVersion, 3);
        assert.equal(stored.rows[0].package.entryCharge, null);
        assert.equal(stored.rows[0].package.ticketSubtotal, 3740);
        assert.equal(stored.rows[0].package.ticketLines.length, 2);
        assert.equal(stored.rows[0].price, '3740');
        const groupOwner = await pool.query(
            `SELECT meta->>'ticketBookingId' AS ticket_booking_id,
                    meta->>'packageOwnerBookingId' AS package_owner_booking_id
             FROM banquet_groups
             WHERE id = $1`,
            [legacyGroupId]
        );
        assert.equal(groupOwner.rows[0].ticket_booking_id, legacyBookingId);
        assert.equal(groupOwner.rows[0].package_owner_booking_id, legacyBookingId);

        const preview = await apiRequest(
            'POST',
            '/api/bookings/ticket-quote?businessContext=event_genix',
            {
                token: receptionToken,
                body: {
                    bookingId: legacyBookingId,
                    ticketQuantities: []
                }
            }
        );
        assert.equal(preview.status, 200, JSON.stringify(preview.body));
        const tariffChange = await apiRequest(
            'POST',
            '/api/center/tickets/regular_child/tariffs?businessContext=event_genix',
            {
                token: seniorManagerToken,
                body: {
                    admissionContext: 'reserved_table_room',
                    dayType: 'weekday',
                    availability: 'available',
                    amountUah: 311,
                    effectiveFrom: '2026-07-14',
                    expectedRevision: 1,
                    changeNote: 'Stale booking save integration check'
                }
            }
        );
        assert.equal(tariffChange.status, 201, JSON.stringify(tariffChange.body));
        const staleSave = await apiRequest(
            'PUT',
            `/api/bookings/${encodeURIComponent(legacyBookingId)}?businessContext=event_genix`,
            {
                token: receptionToken,
                body: {
                    kidsCount: 12,
                    banquetGuests: 12,
                    banquetAdults: 2,
                    ticketQuantities: [],
                    ticketQuote: preview.body.quote
                }
            }
        );
        assert.equal(staleSave.status, 409, JSON.stringify(staleSave.body));
        assert.equal(staleSave.body.code, 'TICKET_PRICE_CHANGED');
        assert.equal(staleSave.body.details.quote.ticketSubtotal, 3752);
        assert.equal(staleSave.body.details.diff[0].ticketTypeCode, 'regular_child');
    });

    test('stale expectedRevision returns 409 with current tariff and audit stores old/new actor note', async () => {
        const stale = await apiRequest(
            'POST',
            '/api/center/tickets/regular_child/tariffs?businessContext=event_genix',
            {
                token: seniorManagerToken,
                body: {
                    admissionContext: 'standard',
                    dayType: 'weekday',
                    availability: 'available',
                    amountUah: 353,
                    effectiveFrom: '2026-08-01',
                    expectedRevision: 2,
                    changeNote: 'stale'
                }
            }
        );
        assert.equal(stale.status, 409);
        assert.equal(stale.body.code, 'TICKET_TARIFF_REVISION_CONFLICT');
        assert.equal(stale.body.details.currentRevision, 3);
        assert.equal(stale.body.details.currentTariff.amountUah, 352);

        const audit = await pool.query(
            `SELECT actor, old_amount_uah::numeric::text AS old_amount,
                    new_amount_uah::numeric::text AS new_amount, change_note
             FROM admission_ticket_tariff_audit
             WHERE business_context = 'event_genix'
               AND ticket_type_code = 'regular_child'
               AND admission_context = 'standard'
               AND day_type = 'weekday'
             ORDER BY id DESC
             LIMIT 1`
        );
        assert.deepEqual(audit.rows[0], {
            actor: 'integration_revision_editor',
            old_amount: '351.00',
            new_amount: '352.00',
            change_note: 'Same-date revision selection'
        });
    });

    test('structured backup catalog includes admission types, versions, and audit while excluding schema_migrations', async () => {
        const client = await pool.connect();
        try {
            const catalog = await loadBackupCatalog(client);
            const tableNames = catalog.tables.map(table => table.name);
            for (const name of [
                'admission_ticket_types',
                'admission_ticket_tariff_versions',
                'admission_ticket_tariff_audit'
            ]) {
                assert.equal(tableNames.includes(name), true, `${name} must be in structured backup`);
            }
            assert.equal(tableNames.includes('schema_migrations'), false);
        } finally {
            client.release();
        }
    });
});
