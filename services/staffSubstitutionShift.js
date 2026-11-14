'use strict';

const contract = require('./staffSubstitutionContract');
const { localInstant } = require('./staffSubstitutionContext');
const { loadHrShiftDayPlan, normalizeHrShiftDayPlan, replaceHrShiftSegments } = require('./hrShiftSegments');
const { staffProfessionKeys } = require('./professions');
const { isBookingWithinAvailabilityWindows, lockBookingConflictResources, timeToMinutes } = require('./booking');
const { birthdaySlotsForEvents, eventLineIds } = require('./afishaBirthdaySlots');
const { normalizeScheduleDate, upsertScheduleMirrorFromPlan, reconcileAnimatorRosterDates } = require('./staffScheduleMutations');

function segmentTerms(segment) {
    const { professionKey, shiftStart, shiftEnd, breakMinutes, note, additionalRoles } = segment;
    return { professionKey, shiftStart, shiftEnd, breakMinutes, note, additionalRoles };
}

function planTerms(plan) {
    return plan && { status: plan.status, primaryProfessionKey: plan.primaryProfessionKey,
        segments: plan.segments.map(segmentTerms) };
}

function sameSegmentScope(left, right) {
    return left.shiftStart === right.shiftStart && left.shiftEnd === right.shiftEnd
        && left.professionKey === right.professionKey;
}

function withSegments(plan, segments) {
    const primary = segments.find(segment => segment.professionKey === plan?.primaryProfessionKey) || segments[0];
    return normalizeHrShiftDayPlan({ primaryProfessionKey: primary.professionKey, segments },
        { status: plan?.status || 'working' });
}

async function loadPlans(db, input) {
    const original = await loadHrShiftDayPlan(db, { hrShiftId: input.sourceId });
    const replacement = await loadHrShiftDayPlan(db, { staffId: input.staffId, shiftDate: input.workDate });
    const linked = original && Number(original.shift.staff_id) === input.originalStaffId
        && normalizeScheduleDate(original.shift.shift_date) === input.workDate;
    if (!linked) contract.fail('SUBSTITUTION_SOURCE_STALE', 'Зміна вже належить іншому працівнику або даті', 409);
    return { original, replacement };
}

async function assertCurrent(db, input, saved) {
    const { original, replacement } = await loadPlans(db, input);
    const current = [planTerms(original.plan), planTerms(replacement?.plan)];
    if (contract.fingerprint(current) !== contract.fingerprint([saved.originalAfter, saved.replacementAfter])
        || saved.replacementBefore && saved.replacementBefore.shift.id !== replacement?.shift.id) {
        contract.fail('SUBSTITUTION_SOURCE_STALE', 'Денні плани підміни змінилися. Перевірте графік та історію.', 409);
    }
    return { original, replacement };
}

async function hasHrSubstitutionClaim(db, input, { partialOnly = false } = {}) {
    const result = await db.query(`SELECT id FROM staff_substitutions
        WHERE source_type='hr_shift' AND work_date=$1 AND state<>'cancelled'
          AND (NOT $3::boolean OR slot_key='partial')
          AND (staff_id=ANY($2::int[]) OR original_staff_id=ANY($2::int[])) LIMIT 1`,
    [input.workDate, [input.staffId, input.originalStaffId], partialOnly]);
    return result.rows.length > 0;
}

async function conflictsWithAnimatorAssignments(db, date, staffId, plan) {
    const windows = (plan?.segments || []).filter(segment =>
        segment.professionKey === 'animator' || segment.additionalRoles?.some(role => role.professionKey === 'animator')
    ).map(segment => ({ start: segment.shiftStart, end: segment.shiftEnd }));
    const bookings = (await db.query(`SELECT time,duration FROM bookings
        WHERE date=$1 AND line_id=$2 AND COALESCE(business_context,'event_genix')='event_genix'
        AND LOWER(COALESCE(NULLIF(BTRIM(status),''),'confirmed')) <> 'cancelled'`, [date,String(staffId)])).rows;
    const events = await birthdaySlotsForEvents(db, (await db.query('SELECT * FROM afisha WHERE date=$1 ORDER BY id', [date])).rows);
    const assignments = [...bookings, ...events.flatMap(event =>
        (event.birthday_slots || [{ time:event.time, duration:event.duration || 60 }])
            .filter(slot => eventLineIds(event,slot).includes(String(staffId))))];
    return assignments.some(item => !isBookingWithinAvailabilityWindows(item.time, item.duration, windows));
}

async function lockPartialShift(db, input) {
    await db.query('SELECT id FROM hr_shifts WHERE id=$1 OR (staff_id=$2 AND shift_date=$3) ORDER BY id FOR UPDATE',
        [input.sourceId, input.staffId, input.workDate]);
    if (input.professionKey === 'animator') {
        await lockBookingConflictResources(db, [input.originalStaffId, input.staffId].filter(Boolean)
            .map(staffId => ({ date: input.workDate, lineId: String(staffId) })));
    }
}

async function loadPartialShiftScope(db, input, current) {
    if (current) {
        const snapshot = current.source_snapshot;
        const agreed = current.input_json;
        const scopeFields = ['startsAt', 'endsAt', 'professionKey', 'breakMinutes', 'payMode', 'originalTreatment'];
        if (scopeFields.some(field => input[field] !== agreed[field])) {
            contract.fail('SUBSTITUTION_SCOPE_CHANGED', 'Для іншого часу, ролі або способу передачі скасуйте підміну й створіть нову.', 409);
        }
        const { replacement } = await assertCurrent(db, agreed, snapshot);
        return { ...snapshot, ownedSegmentId: replacement.plan.segments.find(segment =>
            sameSegmentScope(segment, snapshot.transferred))?.id };
    }
    const { original, replacement } = await loadPlans(db, input);
    const scope = { type: 'hr_shift', partial: true, blockers: [] };
    const block = (code, message) => scope.blockers.push({ code, message });
    const start = input.startsAt && contract.kyivParts(input.startsAt);
    const end = input.endsAt && contract.kyivParts(input.endsAt);
    const target = start && end && original.plan.segments.find(segment => {
        const from = localInstant(input.workDate, segment.shiftStart);
        const to = localInstant(input.workDate, segment.shiftEnd, segment.shiftEnd <= segment.shiftStart);
        return from && to && input.startsAt >= from && input.endsAt <= to;
    });
    if (!target || target.professionKey !== input.professionKey || target.additionalRoles.length) {
        block('SUBSTITUTION_SHIFT_SCOPE_REQUIRED', 'Оберіть час у межах одного сегмента тієї самої професії без суміщених ролей.');
        return scope;
    }
    const targetEnd = localInstant(input.workDate, target.shiftEnd, target.shiftEnd <= target.shiftStart);
    if (input.professionKey === 'animator' && target.shiftEnd <= target.shiftStart) {
        block('SUBSTITUTION_ANIMATOR_OVERNIGHT', 'Нічне вікно аніматора потребує перевірки призначень на обох датах.');
        return scope;
    }
    const targetStart = localInstant(input.workDate, target.shiftStart);
    const wholeSegment = input.startsAt === targetStart && input.endsAt === targetEnd;
    const startMinute = timeToMinutes(start.time);
    const endMinute = timeToMinutes(end.time) + (start.date !== end.date ? 1440 : 0);
    if (endMinute - startMinute !== (Date.parse(input.endsAt) - Date.parse(input.startsAt)) / 60000) {
        block('SUBSTITUTION_SHIFT_CLOCK_CHANGE', 'Часова зміна через переведення годинника потребує окремого обліку.');
        return scope;
    }
    if (target.shiftEnd <= target.shiftStart && input.endsAt < targetEnd && end.date !== start.date) {
        block('SUBSTITUTION_SHIFT_POST_MIDNIGHT_REMAINDER', 'Залишок після опівночі потребує окремого плану на наступну дату. Оберіть край нічної зміни.');
        return scope;
    }
    if (target.shiftEnd <= target.shiftStart && input.startsAt !== targetStart && input.endsAt !== targetEnd) {
        block('SUBSTITUTION_SHIFT_OVERNIGHT_SPLIT', 'Оберіть край нічної зміни, щоб у графіку залишився один суцільний проміжок.');
        return scope;
    }
    if (input.breakMinutes !== (wholeSegment ? target.breakMinutes : 0)
        || !wholeSegment && target.breakMinutes || wholeSegment && original.plan.segments.length === 1) {
        block('SUBSTITUTION_SHIFT_SCOPE_REQUIRED', 'Повний сегмент переноситься зі своєю перервою. Довільний проміжок можна передати з сегмента без перерви, якщо в початковій зміні лишається робота.');
        return scope;
    }
    if (await hasHrSubstitutionClaim(db, input)) {
        block('SUBSTITUTION_SHIFT_ALREADY_CLAIMED', 'На цей день один із денних планів уже має погоджену підміну.');
    }
    if (replacement && replacement.plan.status !== original.plan.status) {
        block('SUBSTITUTION_SHIFT_MERGE_REQUIRED', 'Денні плани мають різний формат роботи. Спочатку узгодьте роботу на місці або віддалено.');
    }
    if (!replacement && (await db.query('SELECT id FROM staff_schedule WHERE staff_id=$1 AND date=$2',
        [input.staffId, input.workDate])).rows.length) {
        block('SUBSTITUTION_SHIFT_MERGE_REQUIRED', 'У виконавця є окремий запис графіка. Узгодьте його з денним планом перед підміною.');
    }
    const transferred = { ...segmentTerms(target), shiftStart: start.time, shiftEnd: end.time, breakMinutes: input.breakMinutes };
    const remaining = original.plan.segments.flatMap(segment => {
        if (segment !== target) return [segment];
        const parts = [];
        if (segment.shiftStart < start.time) parts.push({ ...segment, shiftEnd: start.time });
        if (input.endsAt < targetEnd) parts.push({ ...segment, id: parts.length ? null : segment.id, shiftStart: end.time });
        return parts;
    });
    try {
        const originalAfter = withSegments(original.plan, remaining);
        const replacementAfter = withSegments(replacement?.plan || { status: original.plan.status },
            [...(replacement?.plan.segments || []), transferred]);
        if (input.professionKey === 'animator' && await conflictsWithAnimatorAssignments(db, input.workDate, input.originalStaffId, originalAfter)) {
            block('SUBSTITUTION_ANIMATOR_ASSIGNMENT_OUTSIDE_SHIFT', 'У заміненого аніматора є бронювання або подія Афіші поза новим графіком.');
        }
        return { ...scope, transferred, originalBefore: original, replacementBefore: replacement,
            originalAfter: planTerms(originalAfter), replacementAfter: planTerms(replacementAfter),
            originalSegments: originalAfter.segments, replacementSegments: replacementAfter.segments };
    } catch (error) {
        if (error.name !== 'HrShiftPlanError') throw error;
        block(error.code, error.message);
        return scope;
    }
}

async function writePlan(db, input, actor, shift, staffId, plan) {
    const staff = (await db.query('SELECT * FROM staff WHERE id=$1', [staffId])).rows[0];
    const allowedProfessionKeys = staffProfessionKeys(staff);
    if (staffId === input.staffId) allowedProfessionKeys.push(input.professionKey);
    const updated = await replaceHrShiftSegments(db, shift.id, plan, {
        actor: actor.username, auditSource: 'staff_substitution', professionCard: { staff, allowedProfessionKeys }
    });
    await upsertScheduleMirrorFromPlan(db, { staffId, date: input.workDate, note: shift.notes }, updated.plan);
}

async function applyPartialShift(db, actor, row, scope) {
    const input = row.input_json;
    let replacementShift = scope.replacementBefore?.shift;
    if (!replacementShift) {
        const { shiftStart, shiftEnd, breakMinutes, professionKey } = scope.transferred;
        replacementShift = (await db.query(`INSERT INTO hr_shifts
            (staff_id,shift_date,planned_start,planned_end,break_minutes,profession_key,shift_type,created_by)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [input.staffId, input.workDate, shiftStart, shiftEnd, breakMinutes, professionKey,
            scope.replacementAfter.status === 'remote' ? 'remote' : 'regular', actor.username])).rows[0];
    }
    await writePlan(db, input, actor, scope.originalBefore.shift, input.originalStaffId,
        { ...scope.originalAfter, segments: scope.originalSegments });
    await writePlan(db, input, actor, replacementShift, input.staffId,
        { ...scope.replacementAfter, segments: scope.replacementSegments });
    await reconcileAnimatorRosterDates(db, [input.workDate]);
}

async function restorePartialShift(db, actor, row) {
    const input = row.input_json;
    const saved = row.source_snapshot;
    const { original, replacement } = await assertCurrent(db, input, saved);
    if (input.professionKey === 'animator' && await conflictsWithAnimatorAssignments(db, input.workDate, input.staffId, saved.replacementBefore?.plan)) {
        contract.fail('SUBSTITUTION_ANIMATOR_ASSIGNMENT_OUTSIDE_SHIFT',
            'Після відновлення графіка у виконавця залишиться бронювання або подія Афіші поза зміною.', 409);
    }
    const remainingIds = new Set(original.plan.segments.map(segment => segment.id));
    const segments = saved.originalBefore.plan.segments.map(segment =>
        remainingIds.has(segment.id) ? segment : { ...segment, id: null });
    await writePlan(db, input, actor, original.shift, input.originalStaffId, { ...saved.originalBefore.plan, segments });
    if (saved.replacementBefore) {
        const restored = saved.replacementBefore.plan;
        const segments = restored.segments.map(segment => {
            const existing = replacement.plan.segments.find(item => sameSegmentScope(item, segment));
            return { ...segment, id: existing.id };
        });
        await writePlan(db, input, actor, replacement.shift, input.staffId, { ...restored, segments });
    } else {
        await db.query('DELETE FROM hr_shifts WHERE id=$1', [replacement.shift.id]);
        await db.query('DELETE FROM staff_schedule WHERE staff_id=$1 AND date=$2', [input.staffId, input.workDate]);
    }
    await reconcileAnimatorRosterDates(db, [input.workDate]);
}

function matchesSubstitutionBaseAllocation(input, snapshot, allocation) {
    const exactSegment = input.sourceType === 'booking' || input.sourceType === 'hr_shift'
        && (input.slotKey === 'partial' || input.payMode === 'additional');
    if (!exactSegment) return true;
    const segment = snapshot.plan?.segments?.[allocation.segmentIndex];
    const implicitWholeShift = input.sourceType === 'hr_shift' && input.slotKey === 'primary'
        && snapshot.plan?.segments?.length === 1 && segment?.id == null && allocation.segmentId == null;
    return segment && (implicitWholeShift || allocation.segmentId != null && String(allocation.segmentId) === String(segment.id))
        && segment.professionKey === input.professionKey && !allocation.overtimeMinutes
        && segment.shiftStart === contract.kyivParts(input.startsAt).time
        && segment.shiftEnd === contract.kyivParts(input.endsAt).time;
}

module.exports = { conflictsWithAnimatorAssignments, lockPartialShift, loadPartialShiftScope, hasHrSubstitutionClaim, assertCurrent, applyPartialShift, restorePartialShift, matchesSubstitutionBaseAllocation };
