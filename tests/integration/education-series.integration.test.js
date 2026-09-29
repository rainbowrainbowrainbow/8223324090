/**
 * Real HTTP and PostgreSQL regression coverage for education booking series.
 * Run only through `npm run test:integration:education-series:isolated`.
 */
'use strict';

const { after, before, describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { initializeTimelineResources } = require('../../services/timelineResources');

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
    return request('POST', '/api/bookings/education-series?businessContext=dar', token, { booking });
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
        await pool.query(
            `INSERT INTO settings (key, value)
             VALUES ('timeline_display:dar', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [JSON.stringify({ mode: 'education' })]
        );
        await initializeTimelineResources(pool, 'dar', { types: ['cabinet'] });
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
        const created = await request('POST', '/api/bookings?businessContext=dar', token, {
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
            `/api/bookings/detail/${encodeURIComponent(bookingId)}?businessContext=dar`,
            token
        );
        assert.equal(detail.status, 200, JSON.stringify(detail.body));
        assert.equal(detail.body.booking.programName, title);
        assert.equal(detail.body.booking.extraData.educationLesson.title, title);
        assert.equal(detail.body.booking.extraData.educationLesson.groupId ?? null, null, 'legacy lesson remains unlinked');

        const updated = await request(
            'PUT',
            `/api/bookings/${encodeURIComponent(bookingId)}?businessContext=dar`,
            token,
            { notes: `Edited EDU ${suffix}` }
        );
        assert.equal(updated.status, 200, JSON.stringify(updated.body));

        const editedDetail = await request(
            'GET',
            `/api/bookings/detail/${encodeURIComponent(bookingId)}?businessContext=dar`,
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
            `/api/bookings/${encodeURIComponent(editedId)}?businessContext=dar`,
            token,
            { notes: `Edited occurrence ${suffix}` }
        );
        assert.equal(updated.status, 200, JSON.stringify(updated.body));
        const detail = await request(
            'GET',
            `/api/bookings/detail/${encodeURIComponent(editedId)}?businessContext=dar`,
            token
        );
        assert.equal(detail.status, 200, JSON.stringify(detail.body));
        assert.equal(detail.body.booking.notes, `Edited occurrence ${suffix}`);
        assert.equal(detail.body.booking.extraData.educationLesson.seriesId, created.body.seriesId);

        const listed = await request(
            'GET',
            `/api/bookings/education-series/${encodeURIComponent(created.body.seriesId)}?businessContext=dar`,
            token
        );
        assert.equal(listed.status, 200, JSON.stringify(listed.body));
        assert.equal(listed.body.bookings.length, 3);
        assert.equal(listed.body.bookings[1].extraData.educationLesson.title, label);

        const cancelled = await request(
            'POST',
            `/api/bookings/education-series/${encodeURIComponent(created.body.seriesId)}/cancel?businessContext=dar`,
            token,
            { scope: 'future', referenceBookingId: editedId }
        );
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        assert.equal(cancelled.body.cancelledCount, 2);

        const active = await request(
            'GET',
            `/api/bookings/education-series/${encodeURIComponent(created.body.seriesId)}?businessContext=dar`,
            token
        );
        assert.equal(active.status, 200, JSON.stringify(active.body));
        assert.equal(active.body.bookings.length, 1);
        assert.equal(active.body.bookings[0].id, created.body.bookings[0].id);
    });

    test('daily and biweekly series preserve calendar dates and local start time', async () => {
        const schedules = [
            { repeatEvery: 'daily', intervalDays: 1, startOffset: 17, time: '16:10' },
            { repeatEvery: 'biweekly', intervalDays: 14, startOffset: 18, time: '17:10' }
        ];

        for (const schedule of schedules) {
            const title = `EDU ${schedule.repeatEvery} ${suffix}`;
            const startDate = utcDateAfter(schedule.startOffset);
            const created = await createBooking(token, {
                date: startDate,
                time: schedule.time,
                duration: 45,
                lineId: 'edu-cabinet-3',
                room: 'Кабінет 3',
                label: title,
                category: 'education',
                kidsCount: 3,
                skipNotification: true,
                extraData: {
                    educationLesson: {
                        mode: 'education_lesson',
                        title,
                        teacherId: `edu-${schedule.repeatEvery}-teacher-${suffix}`,
                        teacherName: `Викладач ${schedule.repeatEvery} ${suffix}`,
                        seriesSize: 3,
                        repeatEvery: schedule.repeatEvery
                    }
                }
            });

            assert.equal(created.status, 200, `${schedule.repeatEvery}: ${JSON.stringify(created.body)}`);
            assert.equal(created.body.bookings.length, 3);
            assert.deepEqual(
                created.body.bookings.map(item => item.date),
                [0, 1, 2].map(index => addDays(startDate, schedule.intervalDays * index))
            );
            assert.ok(created.body.bookings.every(item => item.time === schedule.time));
        }
    });

    test('teacher conflict on a later occurrence rolls back the earlier occurrence', async () => {
        const label = `EDU rollback ${suffix}`;
        const startDate = utcDateAfter(12);
        const conflictDate = addDays(startDate, 7);
        const teacherId = `edu-conflict-teacher-${suffix}`;

        const conflict = await request('POST', '/api/bookings?businessContext=dar', token, {
            date: conflictDate,
            time: '15:10',
            duration: 45,
            lineId: 'edu-cabinet-2',
            room: 'Кабінет 2',
            label: 'Заняття',
            programName: `EDU existing conflict ${suffix}`,
            category: 'education',
            kidsCount: 2,
            status: 'confirmed',
            skipNotification: true,
            extraData: {
                educationLesson: {
                    mode: 'education_lesson',
                    title: 'Existing test lesson',
                    teacherId,
                    teacherName: `Викладач конфлікту ${suffix}`
                }
            }
        });
        assert.equal(conflict.status, 200, JSON.stringify(conflict.body));
        const conflictId = conflict.body.booking.id;

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
              WHERE business_context = 'dar' AND program_name = $1`,
            [label]
        );
        assert.equal(rolledBack.rows[0].count, 0, 'first occurrence must roll back with the conflicting series');
        const conflictStillExists = await pool.query('SELECT id FROM bookings WHERE id = $1', [conflictId]);
        assert.equal(conflictStillExists.rows[0]?.id, conflictId);
    });

    test('cabinet conflict on a later occurrence rolls back the earlier occurrence', async () => {
        const label = `EDU room rollback ${suffix}`;
        const startDate = utcDateAfter(14);
        const conflictDate = addDays(startDate, 7);

        const conflict = await request('POST', '/api/bookings?businessContext=dar', token, {
            date: conflictDate,
            time: '15:10',
            duration: 45,
            lineId: 'edu-cabinet-1',
            room: 'Кабінет 1',
            label: 'Заняття',
            programName: `EDU existing room conflict ${suffix}`,
            category: 'education',
            kidsCount: 2,
            status: 'confirmed',
            skipNotification: true,
            extraData: {
                educationLesson: {
                    mode: 'education_lesson',
                    title: 'Existing test lesson',
                    teacherId: `edu-other-teacher-${suffix}`,
                    teacherName: `Інший викладач ${suffix}`
                }
            }
        });
        assert.equal(conflict.status, 200, JSON.stringify(conflict.body));
        const conflictId = conflict.body.booking.id;

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
        assert.match(result.body.error, /Кабінет зайнятий/i);
        const rolledBack = await pool.query(
            `SELECT COUNT(*)::int AS count
               FROM bookings
              WHERE business_context = 'dar' AND program_name = $1`,
            [label]
        );
        assert.equal(rolledBack.rows[0].count, 0, 'first occurrence must roll back with the cabinet conflict');
        const conflictStillExists = await pool.query('SELECT id FROM bookings WHERE id = $1', [conflictId]);
        assert.equal(conflictStillExists.rows[0]?.id, conflictId);
    });
    test('groups isolate children, serialize capacity, retain history, and link lesson series', async () => {
        const parent = await pool.query(
            `INSERT INTO customers (business_context, name, source) VALUES ('dar', $1, 'education_test') RETURNING id`,
            [`EDU parent ${suffix}`]
        );
        const parentId = parent.rows[0].id;
        const children = await pool.query(
            `INSERT INTO customer_children (business_context, customer_id, name, source_kind)
             VALUES ('dar', $1, $2, 'education_test'), ('dar', $1, $3, 'education_test') RETURNING id`,
            [parentId, `EDU child A ${suffix}`, `EDU child B ${suffix}`]
        );
        const foreignParent = await pool.query(
            `INSERT INTO customers (business_context, name, source) VALUES ('event_genix', $1, 'education_test') RETURNING id`,
            [`EDU foreign parent ${suffix}`]
        );
        const foreignChild = await pool.query(
            `INSERT INTO customer_children (business_context, customer_id, name, source_kind)
             VALUES ('event_genix', $1, $2, 'education_test') RETURNING id`,
            [foreignParent.rows[0].id, `EDU foreign child ${suffix}`]
        );
        const groupResult = await request('POST', '/api/education/groups?businessContext=dar', token, {
            businessContext: 'dar', name: `EDU group ${suffix}`, capacity: 1
        });
        assert.equal(groupResult.status, 201, JSON.stringify(groupResult.body));
        const groupId = groupResult.body.group.id;
        const foreignGroup = await pool.query(
            `INSERT INTO education_groups (business_context, name, capacity)
             VALUES ('event_genix', $1, 5) RETURNING id`,
            [`EDU foreign group ${suffix}`]
        );
        const startDate = utcDateAfter(60);
        const foreign = await request('POST', `/api/education/groups/${groupId}/members?businessContext=dar`, token, {
            businessContext: 'dar', childId: foreignChild.rows[0].id, startDate
        });
        assert.equal(foreign.status, 404, JSON.stringify(foreign.body));
        const otherContext = await request('GET', `/api/education/groups/${groupId}?businessContext=event_genix`, token);
        assert.ok([403, 404].includes(otherContext.status), JSON.stringify(otherContext.body));

        const enrollments = await Promise.all(children.rows.map(child => request(
            'POST', `/api/education/groups/${groupId}/members?businessContext=dar`, token,
            { businessContext: 'dar', childId: child.id, startDate }
        )));
        assert.deepEqual(enrollments.map(item => item.status).sort(), [201, 409]);
        const winner = enrollments.find(item => item.status === 201).body.member;
        const duplicate = await request('POST', `/api/education/groups/${groupId}/members?businessContext=dar`, token, {
            businessContext: 'dar', childId: winner.child_id, startDate
        });
        assert.equal(duplicate.status, 409);
        const roster = await request('GET', `/api/education/groups/${groupId}?businessContext=dar`, token);
        assert.equal(roster.status, 200);
        assert.equal(roster.body.group.members.length, 1);

        const series = await createBooking(token, {
            date: utcDateAfter(90), time: '09:10', duration: 40,
            lineId: 'edu-cabinet-1', room: 'Кабінет 1', label: 'Заняття', category: 'education',
            skipNotification: true,
            extraData: { educationLesson: { mode: 'education_lesson', title: `EDU group series ${suffix}`,
                groupId, groupName: `EDU group ${suffix}`, teacherId: `edu-group-teacher-${suffix}`,
                teacherName: `Викладач ${suffix}`, seriesSize: 2, repeatEvery: 'weekly' } }
        });
        assert.equal(series.status, 200, JSON.stringify(series.body));
        assert.equal(series.body.bookings.length, 2);
        for (const booking of series.body.bookings) {
            const detail = await request('GET', `/api/bookings/detail/${booking.id}?businessContext=dar`, token);
            assert.equal(detail.status, 200);
            assert.equal(Number(detail.body.booking.extraData.educationLesson.groupId), Number(groupId));
        }
        const secondGroup = await request('POST', '/api/education/groups?businessContext=dar', token, {
            businessContext: 'dar', name: `EDU second group ${suffix}`, capacity: 2
        });
        assert.equal(secondGroup.status, 201, JSON.stringify(secondGroup.body));
        const firstId = series.body.bookings[0].id;
        const changedGroup = await request('PUT', `/api/bookings/${firstId}?businessContext=dar`, token, {
            extraData: { educationLesson: { groupId: secondGroup.body.group.id } }
        });
        assert.equal(changedGroup.status, 200, JSON.stringify(changedGroup.body));
        const changedDetail = await request('GET', `/api/bookings/detail/${firstId}?businessContext=dar`, token);
        assert.equal(Number(changedDetail.body.booking.extraData.educationLesson.groupId), Number(secondGroup.body.group.id));
        assert.equal(changedDetail.body.booking.extraData.educationLesson.teacherId, `edu-group-teacher-${suffix}`);
        assert.equal(changedDetail.body.booking.time, '09:10');
        const foreignSeries = await createBooking(token, {
            date: utcDateAfter(120), time: '09:10', duration: 40,
            lineId: 'edu-cabinet-1', room: 'Кабінет 1', label: 'Заняття', category: 'education',
            skipNotification: true,
            extraData: { educationLesson: { mode: 'education_lesson', title: `EDU foreign group ${suffix}`,
                groupId: foreignGroup.rows[0].id, seriesSize: 2, repeatEvery: 'weekly' } }
        });
        assert.equal(foreignSeries.status, 404, JSON.stringify(foreignSeries.body));

        const ended = await request('POST', `/api/education/groups/${groupId}/members/${winner.id}/end?businessContext=dar`, token, {
            businessContext: 'dar', endDate: addDays(startDate, 1)
        });
        assert.equal(ended.status, 200, JSON.stringify(ended.body));
        const archived = await request('POST', `/api/education/groups/${groupId}/archive?businessContext=dar`, token, { businessContext: 'dar' });
        assert.equal(archived.status, 200, JSON.stringify(archived.body));
        const history = await request('GET', `/api/education/groups/${groupId}?businessContext=dar`, token);
        assert.equal(history.body.group.members.length, 1);
        assert.equal(history.body.group.status, 'archived');
        const archivedEnroll = await request('POST', `/api/education/groups/${groupId}/members?businessContext=dar`, token, {
            businessContext: 'dar', childId: children.rows[1].id, startDate: utcDateAfter(150)
        });
        assert.equal(archivedEnroll.status, 409);
        const archivedSeries = await createBooking(token, {
            date: utcDateAfter(150), time: '09:10', duration: 40,
            lineId: 'edu-cabinet-1', room: 'Кабінет 1', label: 'Заняття', category: 'education',
            skipNotification: true,
            extraData: { educationLesson: { mode: 'education_lesson', title: `EDU archived group ${suffix}`,
                groupId, seriesSize: 2, repeatEvery: 'weekly' } }
        });
        assert.equal(archivedSeries.status, 409, JSON.stringify(archivedSeries.body));
        const oldDetail = await request('GET', `/api/bookings/detail/${series.body.bookings[1].id}?businessContext=dar`, token);
        assert.equal(Number(oldDetail.body.booking.extraData.educationLesson.groupId), Number(groupId));
    });
});
