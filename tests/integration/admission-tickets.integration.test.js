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

async function seedAdmissionTimelineLine(pool, { date, lineId, name }) {
    await pool.query(
        `INSERT INTO lines_by_date
            (business_context, date, line_id, name, color, from_sheet)
         VALUES ('event_genix', $1, $2, $3, '#2563EB', false)`,
        [date, lineId, name]
    );
}

async function deleteAdmissionBookingFixtures(pool, { bookingIds = [], lineFixtures = [] } = {}) {
    const ids = bookingIds.map(String).filter(Boolean);
    if (ids.length) {
        await pool.query(
            `DELETE FROM finance_transactions
             WHERE booking_id = ANY($1::text[])
               AND COALESCE(business_context, 'event_genix') = 'event_genix'`,
            [ids]
        );
        await pool.query(
            `DELETE FROM bookings
             WHERE id = ANY($1::text[])
               AND business_context = 'event_genix'`,
            [ids]
        );
    }
    for (const fixture of lineFixtures) {
        await pool.query(
            `DELETE FROM lines_by_date
             WHERE business_context = 'event_genix'
               AND date = $1
               AND line_id = $2`,
            [fixture.date, fixture.lineId]
        );
    }
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
                 kids_count, duration, price, extra_data
             )
             VALUES (
                 $1, 'event_genix', '2026-07-17', '14:00', 'room-yellow-table',
                 'Admission legacy fixture', 'Жовтий стіл', 'room-yellow-table',
                 12, 2, 12, 30, 3600, $2::jsonb
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
        const legacyGroupClient = await pool.connect();
        try {
            await legacyGroupClient.query('BEGIN');
            await legacyGroupClient.query(
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
            await legacyGroupClient.query(
            `INSERT INTO banquet_group_bookings (
                 group_id, business_context, booking_id, role, created_by
             )
             VALUES ($1, 'event_genix', $2, 'primary', 'admission_test')`,
            [legacyGroupId, legacyBookingId]
            );
            await legacyGroupClient.query('COMMIT');
        } catch (error) {
            await legacyGroupClient.query('ROLLBACK');
            throw error;
        } finally {
            legacyGroupClient.release();
        }
    });

    after(async () => {
        if (!pool) return;
        try {
            if (legacyGroupId) {
                await pool.query(
                    `UPDATE banquet_groups
                     SET status = 'cancelled'
                     WHERE id = $1`,
                    [legacyGroupId]
                );
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
        assert.equal(seniorWrite.status, 403);

        const creatorWrite = await apiRequest(
            'POST',
            '/api/center/tickets/regular_child/tariffs?businessContext=event_genix',
            { token: creatorToken, body: mutationPayload }
        );
        assert.equal(creatorWrite.status, 201, JSON.stringify(creatorWrite.body));
        assert.equal(creatorWrite.body.tariff.revision, 2);
        assert.equal(creatorWrite.body.tariff.amountUah, 351);
        assert.equal(creatorWrite.body.previousTariff.revision, 1);

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
                    ticketQuantities: [],
                    banquetContext: {
                        mode: 'new',
                        groupId: null,
                        guestArrivalTime: '12:00'
                    }
                }
            }
        );
        assert.equal(reserved.status, 200);
        assert.equal(reserved.body.quote.admissionContext, 'reserved_table_room');
        assert.equal(reserved.body.quote.ticketLines[0].unitPriceUah, 310);

        const physicalRoomWithoutBanquet = await apiRequest(
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
        assert.equal(physicalRoomWithoutBanquet.status, 200);
        assert.equal(physicalRoomWithoutBanquet.body.quote.admissionContext, 'standard');
        assert.equal(physicalRoomWithoutBanquet.body.quote.ticketLines[0].unitPriceUah, 350);

        const existingGroupMemberPreview = await apiRequest(
            'POST',
            '/api/bookings/ticket-quote?businessContext=event_genix',
            {
                token: receptionToken,
                body: {
                    banquetGroupId: legacyGroupId,
                    sourceBookingId: legacyBookingId,
                    date: '2026-07-17',
                    roomResourceId: 'room-yellow-table',
                    banquetGuests: 1,
                    kidsCount: 1,
                    banquetAdults: 0,
                    ticketQuantities: []
                }
            }
        );
        assert.equal(existingGroupMemberPreview.status, 200, JSON.stringify(existingGroupMemberPreview.body));
        assert.equal(existingGroupMemberPreview.body.quote.admissionContext, 'reserved_table_room');
        assert.equal(existingGroupMemberPreview.body.quote.ticketLines[0].unitPriceUah, 310);

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
        assert.equal(unavailable.body.error, 'Квиток для дитини до 3 років недоступний у вихідні.');
    });

    test('generic create persists the server ticket quote, booking total, and matching finance amount', async () => {
        const date = '2099-07-14';
        const lineId = `ticket-create-line-${suffix}`.slice(0, 100);
        let bookingId = null;
        await seedAdmissionTimelineLine(pool, {
            date,
            lineId,
            name: `Ticket create ${suffix}`.slice(0, 100)
        });
        try {
            const ticketQuantities = [{ code: 'birthday_child', quantity: 1 }];
            const preview = await apiRequest(
                'POST',
                '/api/bookings/ticket-quote?businessContext=event_genix',
                {
                    token: receptionToken,
                    body: {
                        date,
                        roomResourceId: 'room-yellow-table',
                        banquetGuests: 3,
                        kidsCount: 3,
                        banquetAdults: 1,
                        ticketQuantities
                    }
                }
            );
            assert.equal(preview.status, 200, JSON.stringify(preview.body));
            assert.equal(preview.body.quote.admissionContext, 'standard');

            const created = await apiRequest(
                'POST',
                '/api/bookings?businessContext=event_genix',
                {
                    token: receptionToken,
                    body: {
                        date,
                        time: '12:00',
                        lineId,
                        roomResourceId: 'room-yellow-table',
                        label: 'Admission ticket create fixture',
                        programCode: 'ADMISSION',
                        programName: 'Admission ticket create fixture',
                        category: 'admission',
                        duration: 30,
                        status: 'confirmed',
                        kidsCount: 3,
                        banquetGuests: 3,
                        banquetAdults: 1,
                        ticketQuantities,
                        ticketQuote: preview.body.quote,
                        skipNotification: true
                    }
                }
            );
            assert.equal(created.status, 200, JSON.stringify(created.body));
            assert.equal(created.body.success, true);
            bookingId = created.body.booking?.id;
            assert.ok(bookingId);

            const stored = await pool.query(
                `SELECT price::numeric::text AS price,
                        extra_data->'bookingPackage' AS package
                 FROM bookings
                 WHERE id = $1
                   AND business_context = 'event_genix'`,
                [bookingId]
            );
            assert.equal(stored.rows.length, 1);
            assert.equal(Number(stored.rows[0].price), preview.body.quote.ticketSubtotal);
            assert.equal(stored.rows[0].package.schemaVersion, 3);
            assert.equal(stored.rows[0].package.ticketSubtotal, preview.body.quote.ticketSubtotal);
            assert.deepEqual(
                stored.rows[0].package.ticketLines,
                preview.body.quote.ticketLines
            );

            const finance = await pool.query(
                `SELECT amount::numeric::text AS amount
                 FROM finance_transactions
                 WHERE booking_id = $1
                   AND type = 'income'
                   AND certificate_id IS NULL
                   AND COALESCE(business_context, 'event_genix') = 'event_genix'
                 ORDER BY id`,
                [bookingId]
            );
            assert.equal(finance.rows.length, 1);
            assert.equal(Number(finance.rows[0].amount), Number(stored.rows[0].price));
        } finally {
            await deleteAdmissionBookingFixtures(pool, {
                bookingIds: bookingId ? [bookingId] : [],
                lineFixtures: [{ date, lineId }]
            });
        }
    });

    test('full create persists a server-owned ticket snapshot and matching finance amount', async () => {
        const date = '2099-07-15';
        const lineId = `ticket-full-line-${suffix}`.slice(0, 100);
        let bookingId = null;
        await seedAdmissionTimelineLine(pool, {
            date,
            lineId,
            name: `Ticket full ${suffix}`.slice(0, 100)
        });
        try {
            const ticketQuantities = [{ code: 'discounted_child', quantity: 1 }];
            const preview = await apiRequest(
                'POST',
                '/api/bookings/ticket-quote?businessContext=event_genix',
                {
                    token: receptionToken,
                    body: {
                        date,
                        roomResourceId: 'room-yellow-table',
                        banquetGuests: 2,
                        kidsCount: 2,
                        banquetAdults: 0,
                        ticketQuantities
                    }
                }
            );
            assert.equal(preview.status, 200, JSON.stringify(preview.body));

            const created = await apiRequest(
                'POST',
                '/api/bookings/full?businessContext=event_genix',
                {
                    token: receptionToken,
                    body: {
                        main: {
                            date,
                            time: '12:00',
                            lineId,
                            roomResourceId: 'room-yellow-table',
                            label: 'Admission ticket full fixture',
                            programCode: 'ADMISSION_FULL',
                            programName: 'Admission ticket full fixture',
                            category: 'admission',
                            duration: 30,
                            status: 'confirmed',
                            kidsCount: 2,
                            banquetGuests: 2,
                            banquetAdults: 0,
                            ticketQuantities,
                            ticketQuote: preview.body.quote,
                            skipNotification: true
                        },
                        linked: [],
                        banquetActivities: []
                    }
                }
            );
            assert.equal(created.status, 200, JSON.stringify(created.body));
            assert.equal(created.body.success, true);
            bookingId = created.body.mainBooking?.id;
            assert.ok(bookingId);

            const stored = await pool.query(
                `SELECT price::numeric::text AS price,
                        extra_data->'bookingPackage' AS package
                 FROM bookings
                 WHERE id = $1
                   AND business_context = 'event_genix'`,
                [bookingId]
            );
            assert.equal(stored.rows.length, 1);
            assert.equal(Number(stored.rows[0].price), preview.body.quote.ticketSubtotal);
            assert.equal(stored.rows[0].package.schemaVersion, 3);
            assert.equal(stored.rows[0].package.ticketSubtotal, preview.body.quote.ticketSubtotal);

            const finance = await pool.query(
                `SELECT amount::numeric::text AS amount
                 FROM finance_transactions
                 WHERE booking_id = $1
                   AND type = 'income'
                   AND certificate_id IS NULL
                   AND COALESCE(business_context, 'event_genix') = 'event_genix'
                 ORDER BY id`,
                [bookingId]
            );
            assert.equal(finance.rows.length, 1);
            assert.equal(Number(finance.rows[0].amount), Number(stored.rows[0].price));
        } finally {
            await deleteAdmissionBookingFixtures(pool, {
                bookingIds: bookingId ? [bookingId] : [],
                lineFixtures: [{ date, lineId }]
            });
        }
    });

    test('booking-set updates a non-primary ticket owner atomically while generic member writes fail closed', async () => {
        const date = '2099-07-16';
        const lineId = `ticket-owner-line-${suffix}`.slice(0, 100);
        const primaryBookingId = `ticket-primary-${suffix}`.slice(0, 50);
        const groupId = `ticket-owner-group-${suffix}`.slice(0, 50);
        let ownerBookingId = null;
        let groupInserted = false;
        await seedAdmissionTimelineLine(pool, {
            date,
            lineId,
            name: `Ticket owner ${suffix}`.slice(0, 100)
        });
        try {
            const initialTicketQuantities = [{ code: 'birthday_child', quantity: 1 }];
            const initialPreview = await apiRequest(
                'POST',
                '/api/bookings/ticket-quote?businessContext=event_genix',
                {
                    token: receptionToken,
                    body: {
                        date,
                        roomResourceId: 'room-yellow-table',
                        banquetGuests: 3,
                        kidsCount: 3,
                        banquetAdults: 1,
                        ticketQuantities: initialTicketQuantities
                    }
                }
            );
            assert.equal(initialPreview.status, 200, JSON.stringify(initialPreview.body));
            const ownerCreate = await apiRequest(
                'POST',
                '/api/bookings?businessContext=event_genix',
                {
                    token: receptionToken,
                    body: {
                        date,
                        time: '16:00',
                        lineId,
                        roomResourceId: 'room-yellow-table',
                        label: 'Non-primary ticket owner fixture',
                        programCode: 'ADMISSION_OWNER',
                        programName: 'Non-primary ticket owner fixture',
                        category: 'admission',
                        duration: 30,
                        status: 'confirmed',
                        kidsCount: 3,
                        banquetGuests: 3,
                        banquetAdults: 1,
                        ticketQuantities: initialTicketQuantities,
                        ticketQuote: initialPreview.body.quote,
                        skipNotification: true
                    }
                }
            );
            assert.equal(ownerCreate.status, 200, JSON.stringify(ownerCreate.body));
            ownerBookingId = ownerCreate.body.booking?.id;
            assert.ok(ownerBookingId);

            const preexistingMembership = await pool.query(
                `SELECT group_id
                 FROM banquet_group_bookings
                 WHERE booking_id = $1
                   AND business_context = 'event_genix'`,
                [ownerBookingId]
            );
            assert.equal(preexistingMembership.rows.length, 0);

            await pool.query(
                `INSERT INTO bookings (
                     id, business_context, date, time, line_id, label,
                     program_code, program_name, category, duration, price,
                     room, room_resource_id, status, kids_count, banquet_guests,
                     banquet_adults, created_by, extra_data
                 )
                 VALUES (
                     $1, 'event_genix', $2, '12:00', 'banquet-service',
                     'Admission group primary fixture', 'KITCHEN',
                     'Admission group primary fixture', 'banquet', 30, 0,
                     'Жовтий стіл', 'room-yellow-table', 'confirmed', 0, 0, 0,
                     'admission_test', '{}'::jsonb
                 )`,
                [primaryBookingId, date]
            );
            const groupClient = await pool.connect();
            let group;
            try {
                await groupClient.query('BEGIN');
                group = await groupClient.query(
                `INSERT INTO banquet_groups (
                     id, business_context, primary_booking_id, date, room,
                     room_resource_id, guest_arrival_time, status, source, meta
                 )
                 VALUES (
                     $1, 'event_genix', $2, $3, 'Жовтий стіл',
                     'room-yellow-table', '11:30', 'active', 'admission_test',
                     $4::jsonb
                 )
                 RETURNING updated_at`,
                [
                    groupId,
                    primaryBookingId,
                    date,
                    JSON.stringify({
                        ticketBookingId: ownerBookingId,
                        packageOwnerBookingId: ownerBookingId
                    })
                ]
                );
                groupInserted = true;
                await groupClient.query(
                `INSERT INTO banquet_group_bookings (
                     group_id, business_context, booking_id, role, sort_order, created_by
                 )
                 VALUES
                     ($1, 'event_genix', $2, 'primary', 10, 'admission_test'),
                     ($1, 'event_genix', $3, 'kitchen', 20, 'admission_test')`,
                    [groupId, primaryBookingId, ownerBookingId]
                );
                await groupClient.query('COMMIT');
            } catch (error) {
                await groupClient.query('ROLLBACK');
                throw error;
            } finally {
                groupClient.release();
            }

            const beforeRejectedWrites = await pool.query(
                `SELECT status, date, room, room_resource_id, notes,
                        price::numeric::text AS price, extra_data
                 FROM bookings
                 WHERE id = $1`,
                [ownerBookingId]
            );
            const genericUpdate = await apiRequest(
                'PUT',
                `/api/bookings/${encodeURIComponent(ownerBookingId)}?businessContext=event_genix`,
                {
                    token: creatorToken,
                    body: { notes: 'must not persist through generic update' }
                }
            );
            assert.equal(genericUpdate.status, 409, JSON.stringify(genericUpdate.body));
            assert.equal(
                genericUpdate.body.code,
                'BANQUET_PACKAGE_OWNER_REQUIRES_ATOMIC_ENDPOINT'
            );

            for (const permanent of [false, true]) {
                const deleted = await apiRequest(
                    'DELETE',
                    `/api/bookings/${encodeURIComponent(ownerBookingId)}?businessContext=event_genix${permanent ? '&permanent=true' : ''}`,
                    { token: creatorToken }
                );
                assert.equal(deleted.status, 409, JSON.stringify(deleted.body));
                assert.equal(deleted.body.code, 'BANQUET_ROUTE_REQUIRED');
                assert.equal(deleted.body.details?.nextAction, 'manual_resolution');
                assert.ok(Array.isArray(deleted.body.details?.blockers));
            }

            const linkedAtomic = await apiRequest(
                'POST',
                `/api/bookings/${encodeURIComponent(ownerBookingId)}/linked-atomic?businessContext=event_genix`,
                {
                    token: creatorToken,
                    body: {
                        main: {
                            date: '2099-07-17',
                            room: 'Марвел',
                            roomResourceId: 'room-marvel'
                        },
                        linked: []
                    }
                }
            );
            assert.equal(linkedAtomic.status, 409, JSON.stringify(linkedAtomic.body));
            assert.equal(
                linkedAtomic.body.code,
                'BANQUET_PACKAGE_OWNER_REQUIRES_ATOMIC_ENDPOINT'
            );

            const afterRejectedWrites = await pool.query(
                `SELECT status, date, room, room_resource_id, notes,
                        price::numeric::text AS price, extra_data
                 FROM bookings
                 WHERE id = $1`,
                [ownerBookingId]
            );
            assert.deepEqual(afterRejectedWrites.rows[0], beforeRejectedWrites.rows[0]);
            const membershipAfterRejectedWrites = await pool.query(
                `SELECT role
                 FROM banquet_group_bookings
                 WHERE group_id = $1
                   AND booking_id = $2
                   AND business_context = 'event_genix'`,
                [groupId, ownerBookingId]
            );
            assert.deepEqual(membershipAfterRejectedWrites.rows, [{ role: 'kitchen' }]);

            const changedTicketQuantities = [{ code: 'birthday_child', quantity: 1 }];
            const changedPreview = await apiRequest(
                'POST',
                '/api/bookings/ticket-quote?businessContext=event_genix',
                {
                    token: creatorToken,
                    body: {
                        bookingId: ownerBookingId,
                        banquetGuests: 4,
                        kidsCount: 4,
                        banquetAdults: 1,
                        ticketQuantities: changedTicketQuantities
                    }
                }
            );
            assert.equal(changedPreview.status, 200, JSON.stringify(changedPreview.body));
            assert.equal(changedPreview.body.quote.admissionContext, 'reserved_table_room');

            const bookingSet = await apiRequest(
                'PUT',
                `/api/banquets/${encodeURIComponent(groupId)}/booking-set?businessContext=event_genix`,
                {
                    token: creatorToken,
                    body: {
                        primaryBookingId,
                        primaryPatch: {},
                        packageOwnerBookingId: ownerBookingId,
                        packageOwnerPatch: {
                            kidsCount: 4,
                            banquetGuests: 4,
                            banquetAdults: 1,
                            ticketQuantities: changedTicketQuantities,
                            ticketQuote: changedPreview.body.quote
                        },
                        activities: [],
                        expectedGroupUpdatedAt: group.rows[0].updated_at.toISOString()
                    }
                }
            );
            assert.equal(bookingSet.status, 200, JSON.stringify(bookingSet.body));
            assert.equal(bookingSet.body.success, true);
            assert.equal(bookingSet.body.packageOwnerBookingId, ownerBookingId);

            const storedGroup = await pool.query(
                `SELECT booking.id,
                        booking.price::numeric::text AS price,
                        booking.kids_count,
                        booking.banquet_guests,
                        booking.banquet_adults,
                        booking.extra_data->'bookingPackage' AS package,
                        banquet_group.meta
                 FROM bookings booking
                 JOIN banquet_groups banquet_group ON banquet_group.id = $2
                 WHERE booking.id = $1`,
                [ownerBookingId, groupId]
            );
            assert.equal(storedGroup.rows.length, 1);
            assert.equal(Number(storedGroup.rows[0].price), changedPreview.body.quote.ticketSubtotal);
            assert.equal(storedGroup.rows[0].kids_count, 4);
            assert.equal(storedGroup.rows[0].banquet_guests, 4);
            assert.equal(storedGroup.rows[0].banquet_adults, 1);
            assert.equal(storedGroup.rows[0].package.schemaVersion, 3);
            assert.equal(
                storedGroup.rows[0].package.ticketSubtotal,
                changedPreview.body.quote.ticketSubtotal
            );
            assert.equal(storedGroup.rows[0].meta.ticketBookingId, ownerBookingId);
            assert.equal(storedGroup.rows[0].meta.packageOwnerBookingId, ownerBookingId);

            const ownerInvariant = await pool.query(
                `SELECT COUNT(*) FILTER (
                            WHERE booking.extra_data->'bookingPackage'->>'schemaVersion' = '3'
                        )::integer AS v3_count
                 FROM banquet_group_bookings membership
                 JOIN bookings booking
                   ON booking.id = membership.booking_id
                  AND booking.business_context = membership.business_context
                 WHERE membership.group_id = $1
                   AND membership.business_context = 'event_genix'`,
                [groupId]
            );
            assert.equal(ownerInvariant.rows[0].v3_count, 1);

            const finance = await pool.query(
                `SELECT amount::numeric::text AS amount
                 FROM finance_transactions
                 WHERE booking_id = $1
                   AND type = 'income'
                   AND certificate_id IS NULL
                   AND COALESCE(business_context, 'event_genix') = 'event_genix'
                 ORDER BY id`,
                [ownerBookingId]
            );
            assert.equal(finance.rows.length, 1);
            assert.equal(Number(finance.rows[0].amount), Number(storedGroup.rows[0].price));
        } finally {
            if (groupInserted) {
                await pool.query(
                    `UPDATE banquet_groups
                     SET status = 'cancelled'
                     WHERE id = $1`,
                    [groupId]
                );
                await pool.query(
                    'DELETE FROM banquet_group_bookings WHERE group_id = $1',
                    [groupId]
                );
                await pool.query('DELETE FROM banquet_groups WHERE id = $1', [groupId]);
            }
            await deleteAdmissionBookingFixtures(pool, {
                bookingIds: [primaryBookingId, ownerBookingId].filter(Boolean),
                lineFixtures: [{ date, lineId }]
            });
        }
    });

    test('unrelated update preserves an existing no-ticket package without legacy auto-entry', async () => {
        const noTicketBookingId = `ticket-none-${suffix}`.slice(0, 50);
        await pool.query(
            `INSERT INTO bookings (
                 id, business_context, date, time, line_id, label,
                 room, room_resource_id, banquet_guests, banquet_adults,
                 kids_count, price, extra_data
             )
             VALUES (
                 $1, 'event_genix', '2026-07-17', '15:00', 'room-yellow-table',
                 'Admission no-ticket fixture', 'Жовтий стіл', 'room-yellow-table',
                 2, 1, 2, 0, $2::jsonb
             )`,
            [
                noTicketBookingId,
                JSON.stringify({
                    bookingPackage: {
                        schemaVersion: 2,
                        programBasePrice: 0,
                        entryCharge: null,
                        entrySubtotal: 0,
                        finalTotal: 0,
                        menuPositions: [],
                        serviceEvents: []
                    }
                })
            ]
        );
        try {
            const updated = await apiRequest(
                'PUT',
                `/api/bookings/${encodeURIComponent(noTicketBookingId)}?businessContext=event_genix`,
                {
                    token: receptionToken,
                    body: { notes: 'No-ticket preservation integration check' }
                }
            );
            assert.equal(updated.status, 200, JSON.stringify(updated.body));
            const stored = await pool.query(
                `SELECT price::numeric::text AS price,
                        extra_data->'bookingPackage' AS package
                 FROM bookings
                 WHERE id = $1`,
                [noTicketBookingId]
            );
            assert.equal(stored.rows[0].price, '0');
            assert.equal(stored.rows[0].package.schemaVersion, 2);
            assert.equal(stored.rows[0].package.entryCharge, null);
            assert.equal(stored.rows[0].package.entrySubtotal, 0);
            assert.equal(stored.rows[0].package.finalTotal, 0);

            const snakePreview = await apiRequest(
                'POST',
                '/api/bookings/ticket-quote?businessContext=event_genix',
                {
                    token: receptionToken,
                    body: {
                        booking_id: noTicketBookingId,
                        banquet_guests: 3,
                        banquet_adults: 1,
                        ticket_quantities: []
                    }
                }
            );
            assert.equal(snakePreview.status, 200, JSON.stringify(snakePreview.body));
            const snakeUpdate = await apiRequest(
                'PUT',
                `/api/bookings/${encodeURIComponent(noTicketBookingId)}?businessContext=event_genix`,
                {
                    token: receptionToken,
                    body: {
                        banquet_guests: 3,
                        banquet_adults: 1,
                        kids_count: 3,
                        ticket_quantities: [],
                        ticket_quote: snakePreview.body.quote
                    }
                }
            );
            assert.equal(snakeUpdate.status, 200, JSON.stringify(snakeUpdate.body));
            const afterSnakeUpdate = await pool.query(
                `SELECT banquet_guests, banquet_adults, kids_count,
                        extra_data->'bookingPackage'->>'schemaVersion' AS schema_version
                 FROM bookings
                 WHERE id = $1`,
                [noTicketBookingId]
            );
            assert.deepEqual(
                {
                    banquetGuests: afterSnakeUpdate.rows[0].banquet_guests,
                    banquetAdults: afterSnakeUpdate.rows[0].banquet_adults,
                    kidsCount: afterSnakeUpdate.rows[0].kids_count,
                    schemaVersion: afterSnakeUpdate.rows[0].schema_version
                },
                {
                    banquetGuests: 3,
                    banquetAdults: 1,
                    kidsCount: 3,
                    schemaVersion: '3'
                }
            );

            const manualEntryConflict = await apiRequest(
                'PUT',
                `/api/bookings/${encodeURIComponent(noTicketBookingId)}?businessContext=event_genix`,
                {
                    token: receptionToken,
                    body: {
                        menuPositions: [{
                            title: 'Вхід',
                            quantity: 1,
                            unitPrice: 1,
                            subtotal: 1
                        }]
                    }
                }
            );
            assert.equal(manualEntryConflict.status, 422, JSON.stringify(manualEntryConflict.body));
            assert.equal(manualEntryConflict.body.code, 'TICKET_MANUAL_ENTRY_CONFLICT');
            assert.match(manualEntryConflict.body.error, /«Вхід»/);

            const aliasConflict = await apiRequest(
                'PUT',
                `/api/bookings/${encodeURIComponent(noTicketBookingId)}?businessContext=event_genix`,
                {
                    token: receptionToken,
                    body: {
                        banquetGuests: 3,
                        banquet_guests: 4
                    }
                }
            );
            assert.equal(aliasConflict.status, 422, JSON.stringify(aliasConflict.body));
            assert.equal(aliasConflict.body.code, 'BOOKING_FIELD_ALIAS_CONFLICT');
            const afterAliasConflict = await pool.query(
                `SELECT banquet_guests, banquet_adults, kids_count,
                        jsonb_array_length(extra_data->'bookingPackage'->'menuPositions') AS menu_count
                 FROM bookings
                 WHERE id = $1`,
                [noTicketBookingId]
            );
            assert.deepEqual(afterAliasConflict.rows[0], {
                banquet_guests: 3,
                banquet_adults: 1,
                kids_count: 3,
                menu_count: 0
            });
        } finally {
            await pool.query('DELETE FROM bookings WHERE id = $1', [noTicketBookingId]);
        }
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
        const updateLegacyBookingSet = async ({
            primaryPatch = {},
            packageOwnerPatch = {}
        } = {}) => {
            const currentGroup = await pool.query(
                `SELECT updated_at
                 FROM banquet_groups
                 WHERE id = $1
                   AND business_context = 'event_genix'`,
                [legacyGroupId]
            );
            assert.equal(currentGroup.rows.length, 1);
            return apiRequest(
                'PUT',
                `/api/banquets/${encodeURIComponent(legacyGroupId)}/booking-set?businessContext=event_genix`,
                {
                    token: receptionToken,
                    body: {
                        primaryBookingId: legacyBookingId,
                        primaryPatch,
                        packageOwnerBookingId: legacyBookingId,
                        packageOwnerPatch,
                        activities: [],
                        expectedGroupUpdatedAt: currentGroup.rows[0].updated_at.toISOString()
                    }
                }
            );
        };
        const before = await pool.query(
            `SELECT extra_data->'bookingPackage'->'entryCharge' AS entry_charge
             FROM bookings
             WHERE id = $1`,
            [legacyBookingId]
        );
        const unrelated = await updateLegacyBookingSet({
            primaryPatch: {
                notes: 'Legacy preservation integration check',
                kidsCount: 12
            }
        });
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
        const converted = await updateLegacyBookingSet({
            primaryPatch: {
                kidsCount: 12,
                banquetGuests: 12,
                banquetAdults: 2
            },
            packageOwnerPatch: {
                kidsCount: 12,
                banquetGuests: 12,
                banquetAdults: 2,
                ticketQuantities: [],
                ticketQuote: conversionQuote.body.quote,
                convertLegacy: true
            }
        });
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

        for (const linkedField of ['linkedTo', 'linked_to']) {
            const linkedOwnerAttempt = await apiRequest(
                'PUT',
                `/api/bookings/${encodeURIComponent(legacyBookingId)}?businessContext=event_genix`,
                {
                    token: receptionToken,
                    body: {
                        [linkedField]: `ticket-parent-${suffix}`,
                        notes: `Reject v3 owner link through ${linkedField}`
                    }
                }
            );
            assert.equal(linkedOwnerAttempt.status, 422, JSON.stringify(linkedOwnerAttempt.body));
            assert.equal(linkedOwnerAttempt.body.code, 'TICKET_PACKAGE_OWNER_REQUIRED');
        }
        const ownerAfterRejectedLinks = await pool.query(
            `SELECT linked_to,
                    extra_data->'bookingPackage'->>'schemaVersion' AS schema_version
             FROM bookings
             WHERE id = $1`,
            [legacyBookingId]
        );
        assert.equal(ownerAfterRejectedLinks.rows[0].linked_to, null);
        assert.equal(ownerAfterRejectedLinks.rows[0].schema_version, '3');

        const originalQuote = await apiRequest(
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
        assert.equal(originalQuote.status, 200, JSON.stringify(originalQuote.body));

        const changedTicketQuantities = [
            { code: 'birthday_child', quantity: 1 }
        ];
        const changedGuestsPreview = await apiRequest(
            'POST',
            '/api/bookings/ticket-quote?businessContext=event_genix',
            {
                token: receptionToken,
                body: {
                    bookingId: legacyBookingId,
                    banquetGuests: 13,
                    banquetAdults: 2,
                    ticketQuantities: changedTicketQuantities
                }
            }
        );
        assert.equal(changedGuestsPreview.status, 200, JSON.stringify(changedGuestsPreview.body));
        assert.equal(changedGuestsPreview.body.quote.ticketSubtotal, 3750);
        assert.deepEqual(
            Object.fromEntries(changedGuestsPreview.body.quote.ticketLines.map(line => [
                line.ticketTypeCode,
                line.quantity
            ])),
            {
                regular_child: 12,
                birthday_child: 1,
                adult_companion: 2
            }
        );

        const beforeQuantityConflict = await pool.query(
            `SELECT price::numeric::text AS price, banquet_guests, banquet_adults,
                    kids_count, extra_data
             FROM bookings
             WHERE id = $1`,
            [legacyBookingId]
        );
        const staleQuantitySave = await updateLegacyBookingSet({
            primaryPatch: {
                kidsCount: 13,
                banquetGuests: 13,
                banquetAdults: 2
            },
            packageOwnerPatch: {
                kidsCount: 13,
                banquetGuests: 13,
                banquetAdults: 2,
                ticketQuantities: changedTicketQuantities,
                ticketQuote: originalQuote.body.quote
            }
        });
        assert.equal(staleQuantitySave.status, 409, JSON.stringify(staleQuantitySave.body));
        assert.equal(staleQuantitySave.body.code, 'TICKET_QUOTE_CHANGED');
        assert.equal(staleQuantitySave.body.details.quote.ticketSubtotal, 3750);
        const birthdayQuantityDiff = staleQuantitySave.body.details.diff
            .find(item => item.ticketTypeCode === 'birthday_child');
        assert.ok(birthdayQuantityDiff);
        assert.equal(birthdayQuantityDiff.previousQuantity, 0);
        assert.equal(birthdayQuantityDiff.currentQuantity, 1);
        const afterQuantityConflict = await pool.query(
            `SELECT price::numeric::text AS price, banquet_guests, banquet_adults,
                    kids_count, extra_data
             FROM bookings
             WHERE id = $1`,
            [legacyBookingId]
        );
        assert.deepEqual(afterQuantityConflict.rows[0], beforeQuantityConflict.rows[0]);

        const freshQuantitySave = await updateLegacyBookingSet({
            primaryPatch: {
                kidsCount: 13,
                banquetGuests: 13,
                banquetAdults: 2
            },
            packageOwnerPatch: {
                kidsCount: 13,
                banquetGuests: 13,
                banquetAdults: 2,
                ticketQuantities: changedTicketQuantities,
                ticketQuote: changedGuestsPreview.body.quote
            }
        });
        assert.equal(freshQuantitySave.status, 200, JSON.stringify(freshQuantitySave.body));
        const afterFreshQuantitySave = await pool.query(
            `SELECT price::numeric::text AS price, banquet_guests, banquet_adults,
                    kids_count, extra_data->'bookingPackage' AS package
             FROM bookings
             WHERE id = $1`,
            [legacyBookingId]
        );
        assert.deepEqual(
            {
                price: afterFreshQuantitySave.rows[0].price,
                banquetGuests: afterFreshQuantitySave.rows[0].banquet_guests,
                banquetAdults: afterFreshQuantitySave.rows[0].banquet_adults,
                kidsCount: afterFreshQuantitySave.rows[0].kids_count,
                ticketSubtotal: afterFreshQuantitySave.rows[0].package.ticketSubtotal
            },
            {
                price: '3750',
                banquetGuests: 13,
                banquetAdults: 2,
                kidsCount: 13,
                ticketSubtotal: 3750
            }
        );

        const beforeShadowSnapshot = await pool.query(
            `SELECT price::numeric::text AS price, banquet_guests, banquet_adults,
                    kids_count, extra_data
             FROM bookings
             WHERE id = $1`,
            [legacyBookingId]
        );
        const shadowSnapshotSave = await apiRequest(
            'PUT',
            `/api/bookings/${encodeURIComponent(legacyBookingId)}?businessContext=event_genix`,
            {
                token: receptionToken,
                body: {
                    price: 1,
                    bookingPackage: {
                        schemaVersion: 2,
                        programBase: 1
                    },
                    extraData: {
                        bookingPackage: {
                            schemaVersion: 3,
                            ticketQuote: {
                                ...changedGuestsPreview.body.quote,
                                ticketSubtotal: 1
                            },
                            ticketLines: changedGuestsPreview.body.quote.ticketLines,
                            ticketSubtotal: 1
                        }
                    }
                }
            }
        );
        assert.equal(shadowSnapshotSave.status, 422, JSON.stringify(shadowSnapshotSave.body));
        assert.equal(shadowSnapshotSave.body.code, 'TICKET_SNAPSHOT_INPUT_FORBIDDEN');
        assert.equal(
            shadowSnapshotSave.body.details.field,
            'extraData.bookingPackage.ticketQuote'
        );
        const afterShadowSnapshot = await pool.query(
            `SELECT price::numeric::text AS price, banquet_guests, banquet_adults,
                    kids_count, extra_data
             FROM bookings
             WHERE id = $1`,
            [legacyBookingId]
        );
        assert.deepEqual(afterShadowSnapshot.rows[0], beforeShadowSnapshot.rows[0]);

        const tariffPreview = await apiRequest(
            'POST',
            '/api/bookings/ticket-quote?businessContext=event_genix',
            {
                token: receptionToken,
                body: {
                    bookingId: legacyBookingId
                }
            }
        );
        assert.equal(tariffPreview.status, 200, JSON.stringify(tariffPreview.body));
        const tariffChange = await apiRequest(
            'POST',
            '/api/center/tickets/regular_child/tariffs?businessContext=event_genix',
            {
                token: creatorToken,
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
        const staleSave = await updateLegacyBookingSet({
            primaryPatch: {
                kidsCount: 13,
                banquetGuests: 13,
                banquetAdults: 2
            },
            packageOwnerPatch: {
                kidsCount: 13,
                banquetGuests: 13,
                banquetAdults: 2,
                ticketQuantities: changedTicketQuantities,
                ticketQuote: tariffPreview.body.quote
            }
        });
        assert.equal(staleSave.status, 409, JSON.stringify(staleSave.body));
        assert.equal(staleSave.body.code, 'TICKET_PRICE_CHANGED');
        assert.equal(staleSave.body.details.quote.ticketSubtotal, 3762);
        assert.equal(
            staleSave.body.details.diff.find(item => (
                item.ticketTypeCode === 'regular_child'
            ))?.ticketTypeCode,
            'regular_child'
        );
    });

    test('stale expectedRevision returns 409 with current tariff and audit stores old/new actor note', async () => {
        const stale = await apiRequest(
            'POST',
            '/api/center/tickets/regular_child/tariffs?businessContext=event_genix',
            {
                token: creatorToken,
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
