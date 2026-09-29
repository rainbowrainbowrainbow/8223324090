/**
 * Real HTTP and PostgreSQL regression coverage for education booking series.
 * Run only through `npm run test:integration:education-series:isolated`.
 */
'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

const enabled = process.env.RUN_EDUCATION_SERIES_INTEGRATION === 'true';

function isolatedDatabase() {
    assert.equal(enabled, true, 'run through the isolated education-series test runner');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(process.env.TEST_DATABASE_URL);
    assert.ok(process.env.TEST_URL);
    return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, {
        ...process.env,
        DATABASE_URL: ''
    });
}

function utcDateAfter(days) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

async function request(method, pathname, token, body) {
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
        body: await response.json().catch(() => ({}))
    };
}

async function createBooking(token, booking) {
    return request('POST', '/api/bookings/education-series?businessContext=event_genix', token, { booking });
}

describe('education lesson series on isolated PostgreSQL', { skip: !enabled, concurrency: 1 }, () => {
    let pool;
    let token;
    let suffix;

    before(async () => {
        const testDb = isolatedDatabase();
        pool = new Pool({
            connectionString: testDb.url.toString(),
            ssl: testDb.isLocal ? false : { rejectUnauthorized: false },
            max: 4,
            connectionTimeoutMillis: 10_000
        });
        suffix = `${process.pid}_${Date.now()}`;

        const login = await request('POST', '/api/auth/login', null, {
            username: process.env.TEST_USER,
            password: process.env.TEST_PASS
        });
        assert.equal(login.status, 200, `isolated test login failed: ${JSON.stringify(login.body)}`);
        token = login.body.accessToken || login.body.token;
        assert.ok(token);
    });

    after(async () => {
        await pool?.end();
    });

    test('single lesson can be created, opened in canonical details, and edited', async () => {
        const title = `EDU single ${suffix}`;
        const created = await request('POST', '/api/bookings?businessContext=event_genix', token, {
            date: utcDateAfter(9),
            time: '14:05',
            duration: 45,
            lineId: 'edu-cabinet-1',
            room: 'Кабінет 1',
            label: 'Заняття',
            programName: title,
            category: 'education',
            kidsCount: 2,
            skipNotification: true,
            extraData: {
                educationLesson: {
                    mode: 'education_lesson',
                    title,
                    teacherId: `edu-single-teacher-${suffix}`,
                    teacherName: `Викладач ${suffix}`
                }
            }
        });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        assert.ok(created.body.booking?.id);
        const bookingId = created.body.booking.id;

        const detail = await request(
            'GET',
            `/api/bookings/detail/${encodeURIComponent(bookingId)}?businessContext=event_genix`,
            token
        );
        assert.equal(detail.status, 200, JSON.stringify(detail.body));
        assert.equal(detail.body.booking.programName, title);
        assert.equal(detail.body.booking.extraData.educationLesson.title, title);

        const updated = await request(
            'PUT',
            `/api/bookings/${encodeURIComponent(bookingId)}?businessContext=event_genix`,
            token,
            { notes: `Edited EDU ${suffix}` }
        );
        assert.equal(updated.status, 200, JSON.stringify(updated.body));

        const editedDetail = await request(
            'GET',
            `/api/bookings/detail/${encodeURIComponent(bookingId)}?businessContext=event_genix`,
            token
        );
        assert.equal(editedDetail.status, 200, JSON.stringify(editedDetail.body));
        assert.equal(editedDetail.body.booking.notes, `Edited EDU ${suffix}`);
        assert.equal(editedDetail.body.booking.extraData.educationLesson.teacherId, `edu-single-teacher-${suffix}`);
    });

    test('weekly series creates occurrences, preserves a single edit, opens details, and cancels future entries', async () => {
        const label = `EDU integration ${suffix}`;
        const booking = {
            date: utcDateAfter(10),
            time: '15:10',
            duration: 45,
            lineId: 'edu-cabinet-1',
            room: 'Кабінет 1',
            label,
            category: 'education',
            kidsCount: 3,
            skipNotification: true,
            extraData: {
                educationLesson: {
                    mode: 'education_lesson',
                    title: label,
                    teacherId: `edu-teacher-${suffix}`,
                    teacherName: `Викладач ${suffix}`,
                    seriesSize: 3,
                    repeatEvery: 'weekly'
                }
            }
        };

        const created = await createBooking(token, booking);
        assert.equal(created.status, 200, JSON.stringify(created.body));
        assert.equal(created.body.success, true);
        assert.equal(created.body.bookings.length, 3);
        assert.equal(created.body.bookings[0].date, booking.date);
        assert.equal(created.body.bookings[1].date, addDays(booking.date, 7));
        assert.equal(created.body.bookings[2].date, addDays(booking.date, 14));
        assert.ok(created.body.seriesId);

        const editedId = created.body.bookings[1].id;
        const updated = await request(
            'PUT',
            `/api/bookings/${encodeURIComponent(editedId)}?businessContext=event_genix`,
            token,
            { notes: `Edited occurrence ${suffix}` }
        );
        assert.equal(updated.status, 200, JSON.stringify(updated.body));
        const detail = await request(
            'GET',
            `/api/bookings/detail/${encodeURIComponent(editedId)}?businessContext=event_genix`,
            token
        );
        assert.equal(detail.status, 200, JSON.stringify(detail.body));
        assert.equal(detail.body.booking.notes, `Edited occurrence ${suffix}`);
        assert.equal(detail.body.booking.extraData.educationLesson.seriesId, created.body.seriesId);

        const listed = await request(
            'GET',
            `/api/bookings/education-series/${encodeURIComponent(created.body.seriesId)}?businessContext=event_genix`,
            token
        );
        assert.equal(listed.status, 200, JSON.stringify(listed.body));
        assert.equal(listed.body.bookings.length, 3);
        assert.equal(listed.body.bookings[1].programName, label);

        const cancelled = await request(
            'POST',
            `/api/bookings/education-series/${encodeURIComponent(created.body.seriesId)}/cancel?businessContext=event_genix`,
            token,
            { scope: 'future', referenceBookingId: editedId }
        );
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        assert.equal(cancelled.body.cancelledCount, 2);

        const active = await request(
            'GET',
            `/api/bookings/education-series/${encodeURIComponent(created.body.seriesId)}?businessContext=event_genix`,
            token
        );
        assert.equal(active.status, 200, JSON.stringify(active.body));
        assert.equal(active.body.bookings.length, 1);
        assert.equal(active.body.bookings[0].id, created.body.bookings[0].id);
    });

    test('teacher conflict on a later occurrence rolls back the earlier occurrence', async () => {
        const label = `EDU rollback ${suffix}`;
        const startDate = utcDateAfter(12);
        const conflictDate = addDays(startDate, 7);
        const conflictId = `edu-conflict-${suffix}`.slice(0, 50);
        const teacherId = `edu-conflict-teacher-${suffix}`;

        await pool.query(
            `INSERT INTO bookings (
                id, business_context, date, time, line_id, label, room, duration, status, extra_data
             ) VALUES ($1, 'event_genix', $2::date, '15:10', 'edu-cabinet-2',
                       $3, 'Кабінет 2', 45, 'confirmed', $4::jsonb)`,
            [
                conflictId,
                conflictDate,
                `EDU existing conflict ${suffix}`,
                JSON.stringify({
                    educationLesson: {
                        mode: 'education_lesson',
                        title: 'Existing test lesson',
                        teacherId,
                        teacherName: `Викладач конфлікту ${suffix}`
                    }
                })
            ]
        );

        try {
            const result = await createBooking(token, {
                date: startDate,
                time: '15:10',
                duration: 45,
                lineId: 'edu-cabinet-1',
                room: 'Кабінет 1',
                label,
                category: 'education',
                kidsCount: 3,
                skipNotification: true,
                extraData: {
                    educationLesson: {
                        mode: 'education_lesson',
                        title: label,
                        teacherId,
                        teacherName: `Викладач конфлікту ${suffix}`,
                        seriesSize: 2,
                        repeatEvery: 'weekly'
                    }
                }
            });

            assert.equal(result.status, 409, JSON.stringify(result.body));
            assert.match(result.body.error, /Викладач/i);
            const rolledBack = await pool.query(
                `SELECT COUNT(*)::int AS count
                   FROM bookings
                  WHERE business_context = 'event_genix' AND program_name = $1`,
                [label]
            );
            assert.equal(rolledBack.rows[0].count, 0, 'first occurrence must roll back with the conflicting series');
            const conflictStillExists = await pool.query('SELECT id FROM bookings WHERE id = $1', [conflictId]);
            assert.equal(conflictStillExists.rows[0]?.id, conflictId);
        } finally {
            await pool.query('DELETE FROM bookings WHERE id = $1', [conflictId]);
        }
    });

    test('cabinet conflict on a later occurrence rolls back the earlier occurrence', async () => {
        const label = `EDU room rollback ${suffix}`;
        const startDate = utcDateAfter(14);
        const conflictDate = addDays(startDate, 7);
        const conflictId = `edu-room-conflict-${suffix}`.slice(0, 50);

        await pool.query(
            `INSERT INTO bookings (
                id, business_context, date, time, line_id, label, room, duration, status, extra_data
             ) VALUES ($1, 'event_genix', $2::date, '15:10', 'edu-cabinet-2',
                       $3, 'Кабінет 1', 45, 'confirmed', $4::jsonb)`,
            [
                conflictId,
                conflictDate,
                `EDU existing room conflict ${suffix}`,
                JSON.stringify({
                    educationLesson: {
                        mode: 'education_lesson',
                        title: 'Existing test lesson',
                        teacherId: `edu-other-teacher-${suffix}`,
                        teacherName: `Інший викладач ${suffix}`
                    }
                })
            ]
        );

        try {
            const result = await createBooking(token, {
                date: startDate,
                time: '15:10',
                duration: 45,
                lineId: 'edu-cabinet-1',
                room: 'Кабінет 1',
                label,
                category: 'education',
                kidsCount: 3,
                skipNotification: true,
                extraData: {
                    educationLesson: {
                        mode: 'education_lesson',
                        title: label,
                        teacherId: `edu-new-teacher-${suffix}`,
                        teacherName: `Новий викладач ${suffix}`,
                        seriesSize: 2,
                        repeatEvery: 'weekly'
                    }
                }
            });

            assert.equal(result.status, 409, JSON.stringify(result.body));
            assert.match(result.body.error, /зайнятий|зайнята/i);
            const rolledBack = await pool.query(
                `SELECT COUNT(*)::int AS count
                   FROM bookings
                  WHERE business_context = 'event_genix' AND program_name = $1`,
                [label]
            );
            assert.equal(rolledBack.rows[0].count, 0, 'first occurrence must roll back with the cabinet conflict');
            const conflictStillExists = await pool.query('SELECT id FROM bookings WHERE id = $1', [conflictId]);
            assert.equal(conflictStillExists.rows[0]?.id, conflictId);
        } finally {
            await pool.query('DELETE FROM bookings WHERE id = $1', [conflictId]);
        }
    });
});
