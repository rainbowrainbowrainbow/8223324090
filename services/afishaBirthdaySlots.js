'use strict';

const { validateTime, timeToMinutes, minutesToTime } = require('./booking');
const { insertHistory } = require('./historyLog');

const SLOT_DEFINITIONS = Object.freeze([
    { key: 'first', baseTime: '14:00' },
    { key: 'second', baseTime: '18:00' }
]);
const DURATION = 15;
const MAX_SHIFT = 90;
const isAfishaSubstitutionConflict = error => ['afisha_substitution_schedule_conflict', 'afisha_substitution_schedule_busy',
    'afisha_greeting_substitution_active_guard'].includes(error?.constraint);
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
// A greeting is identified by its stored type, so renaming it cannot change scheduling rules.
const isGreetingEvent = event => event.type === 'birthday' || event.type === 'greeting';
const definitionsFor = event => event.type === 'birthday' ? SLOT_DEFINITIONS :
    [{ key: 'single', baseTime: String(event.original_time || event.time).slice(0, 5) }];

function slotRange(time) {
    const start = timeToMinutes(time);
    return { start, end: start + DURATION };
}

function eventLineIds(event, slot) {
    return slot?.line_ids ?? [event.line_id, event.second_line_id].filter(Boolean).map(String);
}

function projectBirthdaySlots(events, savedSlots = [], bookings = [], assignments = []) {
    const byId = new Map(events.map(event => [Number(event.id), { ...event }]));
    const saved = new Map(savedSlots.map(row => [`${row.afisha_id}:${row.slot_key}`, row]));
    const overrides = new Map(assignments.map(row => [`${row.afisha_id}:${row.occurrence}:${row.role}`, row]));
    const dates = new Map();
    for (const event of byId.values()) {
        if (!dates.has(event.date)) dates.set(event.date, []);
        dates.get(event.date).push(event);
    }

    for (const [date, dayEvents] of dates) {
        const greetings = dayEvents.filter(isGreetingEvent).sort((a, b) => Number(a.id) - Number(b.id));
        if (!greetings.length) continue;
        const eventsOccupied = dayEvents.filter(event => !isGreetingEvent(event)).map(event => {
            const start = timeToMinutes(event.time);
            return { start, end: start + Number(event.duration || 60), label: `Захід «${event.title}»`, kind: 'event' };
        });
        const animatorBookings = bookings.filter(row => (row.date instanceof Date
            ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10)) === date).map(row => {
            const start = timeToMinutes(row.time);
            return { start, end: start + Number(row.duration || 0), lineId: String(row.line_id),
                label: 'Бронювання аніматора', kind: 'booking' };
        });
        const occupied = [];
        const slots = [];
        for (const event of greetings) {
            event.birthday_slots = [];
            for (const definition of definitionsFor(event)) {
                const row = saved.get(`${event.id}:${definition.key}`);
                const legacyManual = event.type !== 'birthday' && !row && event.time !== definition.baseTime;
                const primary = overrides.get(`${event.id}:${definition.key}:primary`);
                const second = overrides.get(`${event.id}:${definition.key}:second`);
                const completedTime = primary?.completed_time || second?.completed_time;
                const mode = completedTime || row?.mode === 'manual' || legacyManual ? 'manual' : 'auto';
                const slot = { key: definition.key, base_time: definition.baseTime,
                    line_ids: [primary?.line_id || event.line_id, second?.line_id || event.second_line_id].filter(Boolean).map(String),
                    ...(primary?.state || second?.state ? { substitution_state: completedTime ? 'completed' : 'active' } : {}),
                    time: completedTime || (mode === 'manual' ? (row?.time || event.time) : definition.baseTime), duration: DURATION, mode,
                    reason: null, conflict: false, conflict_kind: null, updated_by: row?.updated_by || null,
                    updated_at: row?.updated_at || null };
                event.birthday_slots.push(slot);
                slots.push({ event, slot });
            }
        }
        // A manual choice is immovable, including when another event later occupies its time.
        for (const { event, slot } of slots.filter(item => item.slot.mode === 'manual')) {
            const range = slotRange(slot.time);
            occupied.push({ ...range, eventId: event.id, key: slot.key,
                label: 'Вручну зафіксоване вітання', kind: 'greeting' });
        }
        function obstacles(event, slot) {
            const lineIds = eventLineIds(event, slot);
            return [
                ...eventsOccupied,
                ...animatorBookings.filter(item => !lineIds.length || lineIds.includes(item.lineId)),
                ...occupied.filter(item => !(item.eventId === event.id && item.key === slot.key))
            ];
        }
        for (const { event, slot } of slots) {
            const baseRange = slotRange(slot.base_time);
            const baseConflict = obstacles(event, slot).find(item => overlaps(baseRange, item));
            if (slot.mode === 'manual') {
                const conflict = obstacles(event, slot).find(item => overlaps(slotRange(slot.time), item));
                slot.conflict = Boolean(conflict);
                slot.conflict_kind = conflict ? 'occupied' : null;
                slot.reason = conflict ? `Конфлікт: ${conflict.label}` : 'Час встановлено вручну';
                continue;
            }
            const base = baseRange.start;
            const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
            const dayStart = (dayOfWeek === 0 || dayOfWeek === 6) ? 600 : 720;
            const choices = [base];
            for (let delta = 5; delta <= MAX_SHIFT; delta += 5) choices.push(base + delta, base - delta);
            const chosen = choices.find(start => start >= dayStart && start + DURATION <= 1200
                && !obstacles(event, slot).some(item => overlaps({ start, end: start + DURATION }, item)));
            if (chosen == null) {
                slot.conflict = true;
                slot.conflict_kind = 'no_available_slot';
                slot.reason = 'Немає вільних 15 хвилин у межах ±90 хв';
            } else {
                slot.time = minutesToTime(chosen);
                if (chosen !== base) slot.reason = baseConflict
                    ? `Перенесено з ${slot.base_time}: ${baseConflict.label}`
                    : `Перенесено з ${slot.base_time} через інше вітання`;
            }
            occupied.push({ start: chosen ?? base, end: (chosen ?? base) + DURATION,
                eventId: event.id, key: slot.key, label: 'Інше вітання', kind: 'greeting' });
        }
    }
    return events.map(event => byId.get(Number(event.id)) || event);
}

async function birthdaySlotsForEvents(queryable, events, options = {}) {
    const birthdayEvents = events.filter(isGreetingEvent);
    if (!birthdayEvents.length) return events;
    const ids = birthdayEvents.map(event => Number(event.id));
    const saved = await queryable.query(
        'SELECT afisha_id, slot_key, time, mode, updated_by, updated_at FROM afisha_birthday_slots WHERE afisha_id = ANY($1::integer[])',
        [ids]
    );
    const slotRows = saved.rows.filter(row => !(options.override && Number(row.afisha_id) === Number(options.override.afisha_id)
        && row.slot_key === options.override.slot_key));
    if (options.override) slotRows.push(options.override);
    const assigned = (await queryable.query(`SELECT source_id::integer AS afisha_id,
        split_part(slot_key,':',1) AS occurrence, split_part(slot_key,':',2) AS role,
        source_snapshot->>'replacementLineId' AS line_id,
        state, CASE WHEN state='completed' THEN source_snapshot->>'time' END AS completed_time,
        id::text AS claim_id FROM staff_substitutions
        WHERE business_context='event_genix' AND source_type='afisha' AND state<>'cancelled'
          AND source_id=ANY($1::text[]) AND slot_key LIKE '%:%'`,[ids.map(String)])).rows;
    const assignments = assigned.filter(row => row.claim_id !== options.excludeClaimId &&
        !(options.assignment && row.afisha_id === options.assignment.afisha_id && row.occurrence === options.assignment.occurrence && row.role === options.assignment.role));
    if (options.assignment) assignments.push(options.assignment);
    const lineIds = [...new Set([...birthdayEvents.flatMap(event => eventLineIds(event)), ...assignments.map(row => row.line_id)])];
    const hasUnassignedGreeting = birthdayEvents.some(event => !event.line_id && !event.second_line_id);
    const dates = [...new Set(birthdayEvents.map(event => event.date))];
    const result = await queryable.query(
        `SELECT date, line_id, time, duration FROM bookings
         WHERE date = ANY($1::text[]) AND line_id IS NOT NULL
           AND ($2::text[] IS NULL OR line_id = ANY($2::text[]))
           AND COALESCE(business_context, 'event_genix') = 'event_genix'
           AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) != 'cancelled'
           AND id::text <> ALL($3::text[])`,
        [dates, hasUnassignedGreeting ? null : lineIds, (options.excludeBookingIds || []).map(String)]
    );
    return projectBirthdaySlots(events, slotRows, [...result.rows, ...(options.additionalBookings || [])], assignments);
}

async function assertGreetingRestore(db, row, source) {
    const date = row.input_json.workDate;
    const events = (await db.query('SELECT * FROM afisha WHERE date=$1 ORDER BY id',[date])).rows;
    const projected = await birthdaySlotsForEvents(db,events,{ excludeClaimId:String(row.id) });
    const target = projected.find(event => String(event.id) === row.source_id)?.birthday_slots?.find(slot => slot.key === source.occurrence);
    const { getAnimatorTimelineLines, isBookingWithinAvailabilityWindows } = require('./booking');
    const original = (await getAnimatorTimelineLines(date,db)).find(line => line.id===source.originalLineId && line.assignmentAllowed && !line.isUnavailable);
    if (!target || target.conflict || !original || new Set(target.line_ids).size !== target.line_ids.length
        || !isBookingWithinAvailabilityWindows(target.time,target.duration,original.availabilityWindows)) {
        throw fail(409, 'Попередній аніматор недоступний у час вітання.');
    }
}

async function setBirthdaySlot(pool, id, key, input, actor) {
    if (!/^[1-9]\d*$/.test(String(id)) || !['first', 'second', 'single'].includes(key)) {
        throw fail(400, 'Некоректний слот вітання');
    }
    if (!['manual', 'auto'].includes(input.mode)) throw fail(400, 'Оберіть автоматичний або ручний режим');
    if (!['manual', 'auto'].includes(input.expectedMode) || !validateTime(input.expectedTime)) {
        throw fail(400, 'Передайте поточний режим і час');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const date = (await client.query('SELECT date FROM afisha WHERE id=$1',[id])).rows[0]?.date;
        if (date) await client.query('SELECT lock_afisha_substitution_days_v404(ARRAY[$1::text])',[date]);
        const found = await client.query('SELECT * FROM afisha WHERE id = $1 FOR UPDATE', [id]);
        const event = found.rows[0];
        if (!event) throw fail(404, 'Вітання не знайдено');
        if (!isGreetingEvent(event) || !definitionsFor(event).some(slot => slot.key === key)) {
            throw fail(400, 'Це не вітання іменинників');
        }
        if ((await client.query(`SELECT 1 FROM staff_substitutions WHERE business_context='event_genix'
            AND source_type='afisha' AND source_id=$1 AND state='active'
            AND ((slot_key NOT LIKE '%:%' AND source_snapshot->'event'->>'type'='greeting') OR split_part(slot_key,':',1)=$2)`, [String(id),key])).rowCount) {
            throw fail(409, 'Вітання має активну підміну. Спочатку завершіть або скасуйте її.');
        }
        const definition = definitionsFor(event).find(slot => slot.key === key);
        if (input.mode === 'manual' && (!validateTime(input.time) || timeToMinutes(input.time) % 5 !== 0
            || Math.abs(timeToMinutes(input.time) - timeToMinutes(definition.baseTime)) > MAX_SHIFT)) {
            throw fail(400, 'Оберіть час із кроком 5 хв у межах ±90 хв');
        }
        const day = await client.query('SELECT * FROM afisha WHERE date = $1 ORDER BY id', [event.date]);
        const current = await birthdaySlotsForEvents(client, day.rows);
        const currentSlot = current.find(row => Number(row.id) === Number(id)).birthday_slots.find(slot => slot.key === key);
        if (currentSlot.mode !== input.expectedMode || currentSlot.time !== input.expectedTime) {
            throw fail(409, 'Час вітання вже змінився. Оновіть таймлайн і повторіть дію.');
        }
        const nextTime = input.mode === 'manual' ? input.time : definition.baseTime;
        if (input.mode === 'manual') {
            const proposed = await birthdaySlotsForEvents(client, day.rows, { override: {
                afisha_id: Number(id), slot_key: key, time: nextTime, mode: 'manual', updated_by: actor
            } });
            const proposedSlot = proposed.find(row => Number(row.id) === Number(id)).birthday_slots.find(slot => slot.key === key);
            if (proposedSlot.conflict) throw fail(409, proposedSlot.reason);
        }
        await client.query(
            `INSERT INTO afisha_birthday_slots (afisha_id, slot_key, time, mode, updated_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (afisha_id, slot_key) DO UPDATE SET time = EXCLUDED.time, mode = EXCLUDED.mode,
                 updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
            [id, key, nextTime, input.mode, actor]
        );
        await insertHistory(client, { businessContext: 'event_genix', action: 'afisha_birthday_slot', username: actor,
            data: { id: Number(id), slot: key, from: { time: currentSlot.time, mode: currentSlot.mode },
                to: { time: nextTime, mode: input.mode } } });
        const updated = await birthdaySlotsForEvents(client, day.rows);
        await client.query('COMMIT');
        return updated.find(row => Number(row.id) === Number(id)).birthday_slots;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

module.exports = { SLOT_DEFINITIONS, DURATION, MAX_SHIFT, isGreetingEvent, projectBirthdaySlots,
    birthdaySlotsForEvents, eventLineIds, assertGreetingRestore, isAfishaSubstitutionConflict, setBirthdaySlot };
