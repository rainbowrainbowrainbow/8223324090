'use strict';

const { fail, integer } = require('./staffSubstitutionContract');

async function listFreelanceLinks(db, business, sourceId, segmentId = null, substitutionId = null) {
    if (business !== 'event_genix') {
        fail('SUBSTITUTION_BUSINESS_UNSUPPORTED', 'Зв’язування фрілансу доступне лише в Park.', 403);
    }
    const shiftId = integer(sourceId, 'зміна', 1);
    const { rows } = await db.query(`SELECT segment.id::text, hs.staff_id AS "staffId", worker.name AS "staffName",
            segment.profession_key AS "professionKey", physical.starts_at AS "startsAt", physical.ends_at AS "endsAt"
        FROM hr_shifts source
        JOIN hr_shifts hs ON hs.shift_date BETWEEN source.shift_date AND source.shift_date + 1
        JOIN hr_shift_segments segment ON segment.hr_shift_id = hs.id
        JOIN staff worker ON worker.id = hs.staff_id
        CROSS JOIN LATERAL (
            SELECT (hs.shift_date + segment.planned_start + COALESCE(segment.start_day_offset, 0) * INTERVAL '1 day')
                       AT TIME ZONE 'Europe/Kyiv' AS starts_at,
                   (hs.shift_date + segment.planned_end + COALESCE(segment.end_day_offset,
                       CASE WHEN segment.planned_end < segment.planned_start THEN 1 ELSE 0 END) * INTERVAL '1 day')
                       AT TIME ZONE 'Europe/Kyiv' AS ends_at
        ) physical
        WHERE source.id = $1 AND hs.id <> source.id AND segment.work_mode = 'freelance'
          AND segment.cancelled_at IS NULL
          AND physical.starts_at < ((source.shift_date + source.planned_end
              + CASE WHEN source.planned_end < source.planned_start THEN INTERVAL '1 day' ELSE INTERVAL '0 day' END)
                  AT TIME ZONE 'Europe/Kyiv')
          AND physical.ends_at > ((source.shift_date + source.planned_start) AT TIME ZONE 'Europe/Kyiv')
          AND ($2::bigint IS NULL OR segment.id = $2)
          AND NOT EXISTS (SELECT 1 FROM staff_substitutions link WHERE link.freelance_segment_id = segment.id
             AND link.state <> 'cancelled' AND link.id IS DISTINCT FROM $3::bigint)
        ORDER BY physical.starts_at, worker.name, segment.id`, [shiftId, segmentId, substitutionId]);
    return rows.map(row => ({ ...row, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() }));
}

async function findFreelanceLink(db, business, input, current, { lock = false } = {}) {
    if (!input.freelanceSegmentId) return null;
    if (lock) {
        await db.query('SELECT id FROM hr_shift_segments WHERE id=$1 FOR SHARE', [input.freelanceSegmentId]);
    }
    const [link] = await listFreelanceLinks(db, business, input.sourceId, input.freelanceSegmentId, current?.id);
    if (!link) {
        fail('SUBSTITUTION_FREELANCE_LINK_STALE', 'Фріланс-блок скасовано, вже пов’язано або він поза часом початкової зміни.', 409);
    }
    return link;
}

module.exports = { findFreelanceLink, listFreelanceLinks };
