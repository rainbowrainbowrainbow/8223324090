'use strict';

const contract = require('./staffSubstitutionContract');
const { canUseTimelineAction } = require('./timelineContext');
const { canUseAction } = require('../middleware/auth');
const { canEditBooking } = require('./bookingVisibility');
const { getAnimatorTimelineLines, checkServerConflicts, lockBookingConflictResources } = require('./booking');
const { insertHistory } = require('./historyLog');
const { localInstant } = require('./staffSubstitutionContext');
const log = require('../utils/logger').createLogger('BookingSubstitution');

const PARK = 'event_genix';
const parkRow = "COALESCE(business_context,'event_genix')='event_genix'";
const activeRow = "LOWER(COALESCE(NULLIF(BTRIM(status),''),'confirmed')) <> 'cancelled'";
const unsupported = { code: 'SUBSTITUTION_BOOKING_LINK_UNSUPPORTED',
    message: 'Потрібне активне бронювання з однозначним призначенням аніматора.' };

async function bookingBanquetGroupId(db, bookingId) {
    return (await db.query('SELECT group_id FROM banquet_group_bookings WHERE business_context=$1 AND booking_id=$2',
        [PARK, bookingId])).rows[0]?.group_id ?? null;
}

async function readBanquetScope(db, rootId, children) {
    const ids = [rootId, ...children.map(row => row.id)];
    const result = await db.query(`SELECT m.booking_id, m.role, g.id, g.status, g.date, g.primary_booking_id
        FROM banquet_group_bookings m
        LEFT JOIN banquet_groups g ON g.id=m.group_id AND g.business_context=m.business_context
        WHERE m.business_context=$1 AND m.booking_id=ANY($2::text[])
        ORDER BY m.booking_id`, [PARK, ids]);
    const [member] = result.rows;
    if (member && (result.rows.length !== 1 || member.booking_id !== rootId || member.status !== 'active'
        || !['primary', 'activity'].includes(member.role)
        || (member.role === 'primary') !== (member.primary_booking_id === rootId))) return { eligible: false };
    const links = await db.query(`SELECT 1 FROM booking_banquet_links l
        WHERE l.business_context=$1 AND (l.booking_a_id=ANY($2::text[]) OR l.booking_b_id=ANY($2::text[]))
        AND NOT EXISTS (
            SELECT 1 FROM banquet_group_bookings a JOIN banquet_group_bookings b
              ON a.group_id=b.group_id AND a.business_context=b.business_context
            WHERE a.business_context=$1 AND a.group_id=$3
              AND a.booking_id=l.booking_a_id AND b.booking_id=l.booking_b_id
        ) LIMIT 1`, [PARK, ids, member?.id ?? null]);
    return { eligible: links.rowCount === 0, member: member || null };
}

function requireParkBookingEdit(actor) {
    if (!canUseTimelineAction(actor, PARK, 'edit') || !canUseAction(actor, 'edit_booking')) {
        contract.fail('SUBSTITUTION_SOURCE_FORBIDDEN', 'Немає права змінювати призначення бронювання Park.', 403);
    }
}

function bookingIdentity(row) {
    return row.extra_data?.timelineIdentity || row.extra_data?.timeline_identity;
}

function slotFor(root, children, slotKey) {
    if (root.linked_to || root.extra_data?.educationLesson || root.extra_data?.education_lesson
        || root.extra_data?.bookingWorkspace?.lesson || !['animator', undefined, null].includes(bookingIdentity(root)?.resourceType)) return null;
    const secondName = String(root.second_animator || '').trim();
    const secondLineId = String(root.extra_data?.bookingWorkspace?.secondAnimatorLineId || '');
    if (!children.length) return slotKey === 'primary' && !secondName && !secondLineId ? root : null;
    const [second] = children;
    if (children.length !== 1 || !secondName || (secondLineId && secondLineId !== second.line_id)
        || second.second_animator !== secondName || second.line_id === root.line_id || Number(second.price) !== 0
        || second.date !== root.date || second.time !== root.time || second.duration !== root.duration
        || second.program_id !== root.program_id || second.program_code !== root.program_code
        || second.room !== root.room || second.room_resource_id !== root.room_resource_id) return null;
    return slotKey === 'second' ? second : root;
}

function interval(row) {
    const startTime = String(row.time).slice(0, 5);
    const startsAt = localInstant(row.date, startTime);
    if (!startsAt || !(Number(row.duration) > 0)) return null;
    const endsAt = new Date(Date.parse(startsAt) + row.duration * 60000).toISOString();
    const end = contract.kyivParts(endsAt);
    return { startsAt, endsAt, startTime, endTime: end.time, endDate: end.date };
}

async function readBooking(db, actor, input) {
    requireParkBookingEdit(actor);
    const root = (await db.query(`SELECT * FROM bookings WHERE id=$1 AND ${parkRow} AND ${activeRow}`, [input.sourceId])).rows[0];
    if (!root || !canEditBooking(actor, root)) contract.fail('SUBSTITUTION_SOURCE_NOT_FOUND', 'Бронювання недоступне.', 404);
    const children = (await db.query(`SELECT * FROM bookings WHERE linked_to=$1 AND ${parkRow} AND ${activeRow} ORDER BY id`,
        [root.id])).rows;
    const target = slotFor(root, children, input.slotKey);
    const banquet = await readBanquetScope(db, root.id, children);
    const group = banquet.member ?? null;
    const valid = banquet.eligible && (!group || group.date === root.date);
    return { root, children, banquet: group, target: valid && target && canEditBooking(actor, target) ? target : null };
}

function scopedFacts(row) {
    return { id: row.id, date: row.date, time: row.time, duration: row.duration, linkedTo: row.linked_to };
}

function slotExtras(root, target) {
    const workspace = root.extra_data?.bookingWorkspace;
    const extra = target.extra_data || {};
    return {
        ...Object.fromEntries(['timelineIdentity', 'timeline_identity'].filter(key => Object.hasOwn(extra, key)).map(key => [key, extra[key]])),
        ...Object.fromEntries(['secondAnimatorLineId', 'secondAnimatorLineName']
            .filter(key => Object.hasOwn(workspace || {}, key)).map(key => [key, workspace[key]]))
    };
}

async function loadBookingScope(db, actor, input, current) {
    const { root, children, target, banquet } = await readBooking(db, actor, input);
    if (!target) return { type: 'booking', blockers: [unsupported] };
    const facts = [scopedFacts(root), ...children.map(scopedFacts)];
    const roster = await getAnimatorTimelineLines(input.workDate, db);
    const replacement = roster.find(line => line.staffId === input.staffId && line.assignmentAllowed && !line.isUnavailable);
    const original = roster.find(line => line.staffId === input.originalStaffId);
    const originalLineId = current ? current.source_snapshot.originalLineId : original?.id;
    const observedLine = current ? current.source_snapshot.replacementLineId : originalLineId;
    if (target.date !== input.workDate || !observedLine || target.line_id !== observedLine
        || current && (contract.fingerprint(facts) !== contract.fingerprint(current.source_snapshot.facts)
            || contract.fingerprint(banquet) !== contract.fingerprint(current.source_snapshot.banquet ?? null))) {
        contract.fail('SUBSTITUTION_SOURCE_STALE', 'Бронювання або його аніматор уже змінилися.', 409);
    }
    const blockers = [];
    const timing = interval(target);
    if (!timing || timing.startsAt !== input.startsAt || timing.endsAt !== input.endsAt || input.breakMinutes) {
        blockers.push({ code: 'SUBSTITUTION_BOOKING_TIME_REQUIRED', message: 'Час підміни має збігатися з бронюванням, без окремої перерви.' });
    }
    if (input.professionKey !== 'animator' || input.originalTreatment !== 'retain') {
        blockers.push({ code: 'SUBSTITUTION_BOOKING_PAY_SCOPE', message: 'Для бронювання оберіть роль аніматора та збереження звичайної оплати заміненого працівника.' });
    }
    if (!replacement) {
        blockers.push({ code: 'SUBSTITUTION_ROSTER_REQUIRED', message: 'Додайте погоджену зміну аніматора в графік виконавця.' });
    } else if ([root, ...children].some(row => row.id !== target.id && row.line_id === replacement.id)) {
        blockers.push({ code: 'SUBSTITUTION_DUPLICATE_SLOT', message: 'Виконавець уже займає інший слот цього бронювання.' });
    } else {
        const conflict = await checkServerConflicts(db, target.date, replacement.id, target.time, target.duration, target.id, PARK);
        if (conflict.overlap) blockers.push({ code: 'SUBSTITUTION_BOOKING_CONFLICT', message: 'Виконавець недоступний у цей час за графіком або календарем Park.' });
    }
    if (!current && !original?.assignmentAllowed) {
        blockers.push({ code: 'SUBSTITUTION_RESTORE_UNAVAILABLE', message: 'Початковий аніматор недоступний для повернення в графік. Спершу перевірте його лінію.' });
    }
    const alias = await db.query(`SELECT 1 FROM staff_substitutions s JOIN tasks t ON t.id::text=s.source_id
        WHERE s.source_type='task' AND s.business_context=$1 AND s.state<>'cancelled'
          AND ((t.source_type='booking' AND t.source_id=ANY($2::text[]))
               OR (t.source_entity_type='booking' AND t.source_entity_id=ANY($2::text[]))) LIMIT 1`,
    [PARK, facts.map(row => row.id)]);
    if (alias.rows.length) blockers.push({ code: 'SUBSTITUTION_BOOKING_TASK_CLAIMED', message: 'Пов’язана задача вже має погоджену підміну.' });
    return { type: 'booking', facts, ...(banquet && { banquet }), targetId: target.id, ownedBookingId: current ? target.id : null,
        originalLineId, replacementLineId: current ? observedLine : replacement?.id,
        originalSecondName: current ? current.source_snapshot.originalSecondName : root.second_animator,
        originalExtras: current ? current.source_snapshot.originalExtras : slotExtras(root, target),
        blockers };
}

async function lockBookingScope(db, input) {
    const groupId = await bookingBanquetGroupId(db, input.sourceId);
    if (groupId) {
        await db.query('SELECT id FROM banquet_groups WHERE id=$1 AND business_context=$2 FOR UPDATE', [groupId,PARK]);
    }
    const rows = (await db.query(`SELECT id,date,line_id FROM bookings WHERE (id=$1 OR linked_to=$1) AND ${parkRow}
        ORDER BY (id=$1) DESC,id FOR UPDATE`, [input.sourceId])).rows;
    const currentGroupId = await bookingBanquetGroupId(db, input.sourceId);
    if (currentGroupId !== groupId) contract.fail('SUBSTITUTION_SOURCE_STALE', 'Склад банкету змінився. Повторіть розрахунок.', 409);
    await lockBookingConflictResources(db, [...rows, { date: input.workDate, lineId: String(input.staffId) },
        { date: input.workDate, lineId: String(input.originalStaffId || '') }], PARK);
}

async function assertBookingScopeCurrent(db, actor, row) {
    const scope = await loadBookingScope(db, actor, row.input_json, row);
    if (!scope.targetId) contract.fail('SUBSTITUTION_SOURCE_STALE', unsupported.message, 409);
    return scope;
}

function restoreValues(object, keys, previous) {
    const result = { ...object };
    for (const key of keys) {
        if (Object.hasOwn(previous, key)) result[key] = previous[key];
        else delete result[key];
    }
    return result;
}

function nextExtras(row, line, { secondRoot = false, restore = null } = {}) {
    const extra = row.extra_data || {};
    const key = extra.timelineIdentity ? 'timelineIdentity' : extra.timeline_identity ? 'timeline_identity' : 'timelineIdentity';
    if (secondRoot) {
        const workspace = extra.bookingWorkspace || {};
        if (restore) {
            const restored = restoreValues(workspace, ['secondAnimatorLineId', 'secondAnimatorLineName'], restore);
            const result = { ...extra };
            if (Object.keys(restored).length) result.bookingWorkspace = restored;
            else delete result.bookingWorkspace;
            return Object.keys(result).length ? result : null;
        }
        return { ...extra, bookingWorkspace: { ...workspace, secondAnimatorLineId: line.id, secondAnimatorLineName: line.name } };
    }
    if (restore) {
        const result = restoreValues(extra, ['timelineIdentity', 'timeline_identity'], restore);
        return Object.keys(result).length ? result : null;
    }
    const identity = extra[key] || {};
    const updated = { ...identity, businessContext: PARK, resourceType: 'animator', source: 'staff_animator',
        resourceId: line.id, lineId: line.id, resourceName: line.name, lineName: line.name };
    for (const [snake, camel] of [['resource_id', 'resourceId'], ['line_id', 'lineId'],
        ['resource_name', 'resourceName'], ['line_name', 'lineName']]) {
        if (Object.hasOwn(identity, snake)) updated[snake] = updated[camel];
    }
    return {
        ...extra,
        ...(extra.timelineIdentity && extra.timeline_identity ? { timeline_identity: { ...extra.timeline_identity,
            ...updated, resource_id: line.id, line_id: line.id, resource_name: line.name, line_name: line.name } } : {}),
        [key]: updated
    };
}

async function changeBookingAssignment(db, actor, row, restore = false) {
    const input = row.input_json;
    const scope = row.source_snapshot;
    const { root, children, target, banquet } = await readBooking(db, actor, input);
    const lineId = restore ? scope.originalLineId : scope.replacementLineId;
    const roster = await getAnimatorTimelineLines(input.workDate, db);
    const line = roster.find(item => item.id === lineId && item.assignmentAllowed && !item.isUnavailable);
    if (!target || !line || target.id !== scope.targetId
        || target.line_id !== (restore ? scope.replacementLineId : scope.originalLineId)) {
        contract.fail('SUBSTITUTION_SOURCE_STALE', 'Призначення аніматора змінилося або лінія недоступна.', 409);
    }
    if ([root, ...children].some(item => item.id !== target.id && item.line_id === line.id)) {
        contract.fail('SUBSTITUTION_DUPLICATE_SLOT', 'Аніматор уже займає інший слот цього бронювання.', 409);
    }
    const conflict = await checkServerConflicts(db, target.date, line.id, target.time, target.duration, target.id, PARK);
    if (conflict.overlap) contract.fail('SUBSTITUTION_BOOKING_CONFLICT', 'Аніматор недоступний у цей час за графіком або календарем Park.', 409);
    const second = input.slotKey === 'second';
    const secondName = restore ? scope.originalSecondName : line.name;
    const originalExtras = restore ? scope.originalExtras : null;
    const updatedTarget = (await db.query(`UPDATE bookings SET line_id=$2,extra_data=$3,second_animator=$4,updated_at=NOW()
        WHERE id=$1 AND ${parkRow} RETURNING *`,
    [target.id, line.id, nextExtras(target, line, { restore: originalExtras }), second ? secondName : target.second_animator])).rows[0];
    const updates = [{ before: target, after: updatedTarget }];
    if (second) {
        const updatedRoot = (await db.query(`UPDATE bookings SET second_animator=$2,extra_data=$3,updated_at=NOW()
            WHERE id=$1 AND ${parkRow} RETURNING *`, [root.id, secondName,
            nextExtras(root, { ...line, name: secondName }, { secondRoot: true, restore: originalExtras })])).rows[0];
        updates.push({ before: root, after: updatedRoot });
    }
    if (banquet) {
        // Invalidate booking-set editors that opened the group before the assignment changed.
        await db.query('UPDATE banquet_groups SET updated_at=NOW(),updated_by=$3 WHERE id=$1 AND business_context=$2',
            [banquet.id,PARK,actor.username]);
    }
    await insertHistory(db, { businessContext: PARK, action: restore ? 'booking_substitution_restored' : 'booking_substitution_assigned',
        username: actor.username, data: { bookingId: root.id, slotBookingId: target.id, slot: input.slotKey, substitutionId: String(row.id),
            fromLineId: target.line_id, toLineId: line.id, ...(banquet && { groupId: banquet.id }) } });
    return () => {
        const { broadcastBookingEvent } = require('./websocket');
        for (const { before, after } of updates) {
            void broadcastBookingEvent('booking:updated', after, null, { businessContext: PARK, previousBooking: before })
                .catch(error => log.warn('Booking substitution broadcast failed', error.message));
        }
    };
}

async function listBookingScopes(db, actor, date, originalStaffId, slotKey) {
    requireParkBookingEdit(actor);
    const line = (await getAnimatorTimelineLines(date, db)).find(item => item.staffId === originalStaffId);
    if (!line) return [];
    const roots = (await db.query(`SELECT DISTINCT COALESCE(NULLIF(linked_to,''),id) AS id FROM bookings
        WHERE date=$1 AND line_id=$2 AND ${parkRow} AND ${activeRow}
          AND (NULLIF(linked_to,'') IS ${slotKey === 'second' ? 'NOT ' : ''}NULL) ORDER BY id LIMIT 100`,
    [date, line.id])).rows;
    const result = [];
    for (const { id } of roots) {
        try {
            const { root, target, banquet } = await readBooking(db, actor, { sourceId: id, slotKey });
            const timing = target && interval(target);
            if (target?.line_id === line.id && timing) result.push({ id, title: `${timing.startTime} · ${banquet ? 'Банкетне бронювання' : 'Бронювання'} №${root.id}`,
                startTime: timing.startTime, endTime: timing.endTime, endDate: timing.endDate });
        } catch (error) {
            if (error.statusCode !== 404) throw error;
        }
    }
    return result;
}

function isBookingSubstitutionGuard(error) {
    return error?.code === '23514' && error.constraint === 'booking_substitution_active_guard';
}

function bookingSubstitutionConflict(res) {
    return res.status(409).json({ success: false, code: 'BOOKING_SUBSTITUTION_ACTIVE',
        error: 'Бронювання має активну підміну. Спочатку завершіть або скасуйте її у розділі «Підміни».' });
}

module.exports = { loadBookingScope, lockBookingScope, assertBookingScopeCurrent, changeBookingAssignment, listBookingScopes,
    isBookingSubstitutionGuard, bookingSubstitutionConflict };
