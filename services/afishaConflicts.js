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
        client.query(`SELECT id, line_id, second_line_id, time, duration, title FROM afisha
            WHERE date = $1 AND (line_id = ANY($2::text[]) OR second_line_id = ANY($2::text[]))
              AND ($3::integer IS NULL OR id <> $3)`, [date, ids, excludeId])
    ]);
    for (const id of ids) {
        const booking = bookings.rows.find(row => String(row.line_id) === id && overlaps(time, duration, row));
        const event = afisha.rows.find(row => [row.line_id, row.second_line_id].map(String).includes(id)
            && overlaps(time, duration, row));
        const occupied = booking || event;
        if (occupied) {
            throw Object.assign(new Error(`Аніматор ${id} зайнятий о ${String(occupied.time).slice(0, 5)}: ${occupied.title}`), {
                statusCode: 409, code: 'AFISHA_LINE_CONFLICT'
            });
        }
    }
}

module.exports = { assertAfishaLinesFree, overlaps };
