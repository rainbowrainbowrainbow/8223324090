'use strict';

const { timeToMinutes, lockBookingConflictResources } = require('./booking');

function overlaps(time, duration, row) {
    const start = timeToMinutes(time);
    const otherStart = timeToMinutes(row.time);
    return start < otherStart + (Number(row.duration) || 0)
        && otherStart < start + duration;
}

async function assertAfishaLinesFree(client, { date, time, duration, lineIds, excludeId = null }) {
    if (!lineIds.length) return;
    const ids = [...new Set(lineIds.map(String))].sort();
    await lockBookingConflictResources(client, ids.map(lineId => ({ date, lineId })));
    // Serialize concurrent Afisha assignments to the same date and animator.
    await client.query(`SELECT line_id FROM lines_by_date
        WHERE date = $1 AND COALESCE(business_context, 'event_genix') = 'event_genix'
          AND line_id = ANY($2::text[]) ORDER BY line_id FOR UPDATE`, [date, ids]);
    const [bookings, afisha] = await Promise.all([
        client.query(`SELECT line_id, time, duration, COALESCE(label, program_name, program_code, 'Бронювання') AS title
            FROM bookings WHERE date = $1 AND COALESCE(business_context, 'event_genix') = 'event_genix'
              AND line_id = ANY($2::text[])
              AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) != 'cancelled'`, [date, ids]),
        client.query(`SELECT id, date, line_id, second_line_id, time, original_time, duration, title, type FROM afisha
            WHERE date = $1 AND ($2::integer IS NULL OR id <> $2)`, [date, excludeId])
    ]);
    const { birthdaySlotsForEvents } = require('./afishaBirthdaySlots');
    const obstacle = { id: -1, date, time, duration, title: 'Новий захід', type: 'event' };
    const projected = await birthdaySlotsForEvents(client, [...afisha.rows, obstacle]);
    for (const id of ids) {
        const booking = bookings.rows.find(row => String(row.line_id) === id && overlaps(time, duration, row));
        const event = projected.filter(row => row.id !== -1).find(row =>
            [row.line_id, row.second_line_id].map(String).includes(id) &&
            (row.birthday_slots?.length ? row.birthday_slots : [{ time: row.time, duration: row.duration || 60 }])
                .some(slot => overlaps(time, duration, slot)));
        const eventSlot = event?.birthday_slots?.find(slot => overlaps(time, duration, slot));
        const occupied = booking || (event && { ...event, time: eventSlot?.time || event.time });
        if (occupied) {
            throw Object.assign(new Error(`Аніматор ${id} зайнятий о ${String(occupied.time).slice(0, 5)}: ${occupied.title}`), {
                statusCode: 409, code: 'AFISHA_LINE_CONFLICT'
            });
        }
    }
}

module.exports = { assertAfishaLinesFree, overlaps };
