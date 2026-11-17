'use strict';

const contract = require('./staffSubstitutionContract');
const { localInstant } = require('./staffSubstitutionContext');
const { loadHrShiftDayPlan, normalizeHrShiftDayPlan, replaceHrShiftSegments,
    loadPaidRoleValidationContext, validatePaidAdditionalRoles } = require('./hrShiftSegments');
const { resolvePayrollConditions } = require('./hrPayrollConditions');
const { normalizeProfessionKey, staffProfessionKeys } = require('./professions');
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

function hasAnimatorRole(segment) {
    return segment.professionKey === 'animator' || segment.additionalRoles?.some(role => role.professionKey === 'animator');
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
    const remainder = saved.remainder && await loadHrShiftDayPlan(db, {
        staffId: input.originalStaffId, shiftDate: saved.remainder.date
    });
    const current = [planTerms(original.plan), planTerms(replacement?.plan)];
    if (contract.fingerprint(current) !== contract.fingerprint([saved.originalAfter, saved.replacementAfter])
        || saved.replacementBefore && saved.replacementBefore.shift.id !== replacement?.shift.id
        || saved.remainder && contract.fingerprint(planTerms(remainder?.plan)) !== contract.fingerprint(saved.remainder.plan)) {
        contract.fail('SUBSTITUTION_SOURCE_STALE', 'Денні плани підміни змінилися. Перевірте графік та історію.', 409);
    }
    return { original, replacement, remainder };
}

async function hasHrSubstitutionClaim(db, input, { partialOnly = false, nextDate = input.workDate } = {}) {
    const result = await db.query(`SELECT id FROM staff_substitutions
        WHERE business_context='event_genix' AND source_type='hr_shift' AND state<>'cancelled'
          AND (NOT $3::boolean OR slot_key='partial')
          AND (((work_date=$1 OR work_date=$4)
                AND (staff_id=ANY($2::int[]) OR original_staff_id=ANY($2::int[])))
            OR (original_staff_id=ANY($2::int[]) AND source_snapshot->'remainder'->>'date' IN ($1::date::text,$4::date::text)))
        LIMIT 1`,
    [input.workDate, [input.staffId, input.originalStaffId], partialOnly, nextDate]);
    return result.rows.length > 0;
}

async function conflictsWithAnimatorAssignments(db, date, staffId, plan) {
    const windows = (plan?.segments || []).filter(hasAnimatorRole)
        .map(segment => ({ start: segment.shiftStart, end: segment.shiftEnd }));
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
    const endDate = input.endsAt ? contract.kyivParts(input.endsAt).date : input.workDate;
    await db.query(`SELECT id FROM hr_shifts
        WHERE id=$1 OR (staff_id=$2 AND shift_date=$3)
            OR (shift_date=$4 AND $4::date<>$3::date AND staff_id=ANY($5::int[]))
        ORDER BY id FOR UPDATE`,
    [input.sourceId, input.staffId, input.workDate, endDate, [input.staffId, input.originalStaffId]]);
    const hasAdditionalAnimator = input.slotKey === 'partial' && input.professionKey !== 'animator'
        && (await db.query(`SELECT 1 FROM hr_shifts hs
            JOIN hr_shift_segments seg ON seg.hr_shift_id=hs.id
            JOIN hr_shift_segment_roles sr ON sr.segment_id=seg.id
            WHERE hs.shift_date=$1 AND hs.staff_id=ANY($2::int[]) AND sr.profession_key='animator'
            LIMIT 1`, [input.workDate, [input.staffId, input.originalStaffId]])).rows.length > 0;
    if (input.professionKey === 'animator' || hasAdditionalAnimator) {
        await lockBookingConflictResources(db, [input.originalStaffId, input.staffId].filter(Boolean)
            .map(staffId => ({ date: input.workDate, lineId: String(staffId) })));
    }
}

async function quoteSimultaneousRoles(db, input, transferred, originalAfter, replacementAfter) {
    const { staffId, originalStaffId, workDate } = input;
    const context = await loadPaidRoleValidationContext(db, [originalStaffId, staffId]);
    const staff = context.payrollConditions.staff.get(staffId);
    const primary = normalizeProfessionKey(staff?.role_type);
    const approved = role => context.approvedAssignments.has(`${staffId}:${role}`);
    const card = new Set(staffProfessionKeys(staff));
    for (const key of [transferred.professionKey, ...transferred.additionalRoles.map(role => role.professionKey)]) {
        if (!card.has(key) || key !== primary && !approved(key)) {
            contract.fail('SUBSTITUTION_SHIFT_ROLE_ADMISSION_REQUIRED',
                `Для передачі суміщених ролей потрібен чинний допуск виконавця в HR-картці: ${key}.`);
        }
    }
    validatePaidAdditionalRoles(originalAfter, originalStaffId, workDate, context);
    validatePaidAdditionalRoles(replacementAfter, staffId, workDate, context);
    return transferred.additionalRoles.map(role => {
        const { professionKey, compensationMode, policyVersion, payMultiplier } = role;
        if (compensationMode === 'unpaid') return { professionKey, compensationMode };
        const terms = resolvePayrollConditions(context.payrollConditions, staffId, professionKey, workDate, 'additional');
        if (terms.rateUnit !== 'hour') {
            contract.fail('SUBSTITUTION_SHIFT_ROLE_RATE_UNIT_UNSUPPORTED',
                `Для передачі оплачуваної суміщеної ролі потрібна погодинна ставка: ${professionKey}.`);
        }
        const rateMinor = contract.decimalUnits(String(terms.rate), 2, 'ставка суміщеної ролі');
        // Ordinary condition-based payroll rounds its hourly line to whole hryvnias.
        const amountMinor = Math.round(transferred.plannedMinutes / 60 * terms.rate) * 100;
        return { professionKey, compensationMode, policyVersion, payMultiplier, rateMinor, amountMinor,
            rateSource: terms.rateSource, profileVersionId: terms.profileVersionId ?? null,
            assignmentId: terms.assignmentId ?? null, exceptionId: terms.exception?.id ?? null,
            exceptionVersion: terms.exception?.version ?? null };
    });
}

function allocateShiftBreak(input, target, startMinute, endMinute, targetStart, targetEnd) {
    const shiftStart = timeToMinutes(target.shiftStart);
    const shiftEnd = timeToMinutes(target.shiftEnd);
    const breakStart = timeToMinutes(input.breakStartTime);
    const breakEnd = breakStart + target.breakMinutes;
    if (breakStart < shiftStart || breakEnd > shiftEnd) {
        contract.fail('SUBSTITUTION_SHIFT_BREAK_OUT_OF_BOUNDS', 'Уся підтверджена перерва має бути в межах початкового сегмента.');
    }
    if (!localInstant(input.workDate, input.breakStartTime)
        || (Date.parse(targetEnd) - Date.parse(targetStart)) / 60000 !== shiftEnd - shiftStart) {
        contract.fail('SUBSTITUTION_SHIFT_CLOCK_CHANGE', 'Часова зміна через переведення годинника потребує окремого обліку.');
    }
    const overlap = (from, to) => Math.max(0, Math.min(to, breakEnd) - Math.max(from, breakStart));
    const endTime = `${String(Math.floor(breakEnd / 60)).padStart(2, '0')}:${String(breakEnd % 60).padStart(2, '0')}`;
    return {
        startTime: input.breakStartTime, endTime, totalMinutes: target.breakMinutes,
        beforeMinutes: overlap(shiftStart, startMinute),
        replacementMinutes: overlap(startMinute, endMinute),
        afterMinutes: overlap(endMinute, shiftEnd)
    };
}

async function loadPartialShiftScope(db, input, current) {
    if (current) {
        const snapshot = current.source_snapshot;
        const agreed = current.input_json;
        const scopeFields = ['startsAt', 'endsAt', 'professionKey', 'breakStartTime', 'payMode', 'originalTreatment'];
        if (!snapshot.breakAllocation) scopeFields.push('breakMinutes');
        if (scopeFields.some(field => input[field] !== agreed[field])) {
            contract.fail('SUBSTITUTION_SCOPE_CHANGED', 'Для іншого часу, перерви, ролі або способу передачі скасуйте підміну й створіть нову.', 409);
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
    if (!target || target.professionKey !== input.professionKey) {
        block('SUBSTITUTION_SHIFT_SCOPE_REQUIRED', 'Оберіть час у межах одного сегмента тієї самої основної професії.');
        return scope;
    }
    const overnight = target.shiftEnd <= target.shiftStart;
    if (target.additionalRoles.length && (overnight || target.workMode === 'freelance')) {
        block('SUBSTITUTION_SHIFT_ROLE_SCOPE_UNSUPPORTED', 'Суміщені ролі можна передати в межах однієї дати штатної зміни Park.');
        return scope;
    }
    const targetEnd = localInstant(input.workDate, target.shiftEnd, overnight);
    if (input.professionKey === 'animator' && overnight) {
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
    const movesRemainder = overnight && input.endsAt < targetEnd && end.date !== start.date;
    if (movesRemainder) {
        const fullWallMinutes = 1440 + timeToMinutes(target.shiftEnd) - timeToMinutes(target.shiftStart);
        if (input.professionKey !== 'reception' || original.plan.segments.length !== 1
            || input.startsAt === targetStart || target.breakMinutes || input.breakMinutes || input.allowConcurrent
            || (Date.parse(targetEnd) - Date.parse(targetStart)) / 60000 !== fullWallMinutes) {
            block('SUBSTITUTION_SHIFT_POST_MIDNIGHT_REMAINDER',
                'Окремий план після опівночі доступний для однієї зміни рецепції без перерви, суміщення або переведення годинника.');
            return scope;
        }
        const workers = [input.originalStaffId, input.staffId];
        const nextDayPlans = await db.query(`SELECT 1 FROM hr_shifts WHERE shift_date=$1::date AND staff_id=ANY($2::int[])
            UNION ALL SELECT 1 FROM staff_schedule WHERE date=$1::date::text AND staff_id=ANY($2::int[]) LIMIT 1`, [end.date, workers]);
        if (nextDayPlans.rows.length) {
            block('SUBSTITUTION_SHIFT_NEXT_DATE_OCCUPIED', 'На наступну дату вже є план одного з працівників. Спочатку узгодьте графік.');
            return scope;
        }
    }
    if (overnight && !movesRemainder && input.startsAt !== targetStart && input.endsAt !== targetEnd) {
        block('SUBSTITUTION_SHIFT_OVERNIGHT_SPLIT', 'Оберіть край нічної зміни, щоб у графіку залишився один суцільний проміжок.');
        return scope;
    }
    const needsBreakAllocation = Boolean(!overnight && !wholeSegment && target.breakMinutes);
    if (needsBreakAllocation && !input.breakStartTime) {
        block('SUBSTITUTION_SHIFT_BREAK_START_REQUIRED', 'Для частини зміни підтвердьте початок неоплачуваної перерви.');
        return scope;
    }
    if (input.breakStartTime && !needsBreakAllocation) {
        block('SUBSTITUTION_SHIFT_BREAK_SCOPE_INVALID', 'Початок перерви можна уточнити для частини денного сегмента з перервою.');
        return scope;
    }
    if (!needsBreakAllocation && (input.breakMinutes !== (wholeSegment ? target.breakMinutes : 0)
        || !wholeSegment && target.breakMinutes || wholeSegment && original.plan.segments.length === 1)) {
        block('SUBSTITUTION_SHIFT_SCOPE_REQUIRED', 'Повний сегмент переноситься зі своєю перервою. Довільний проміжок можна передати з сегмента без перерви, якщо в початковій зміні лишається робота.');
        return scope;
    }
    if (await hasHrSubstitutionClaim(db, input, { nextDate: movesRemainder ? end.date : input.workDate })) {
        block('SUBSTITUTION_SHIFT_ALREADY_CLAIMED', 'На цей день один із денних планів уже має погоджену підміну.');
    }
    if (replacement && replacement.plan.status !== original.plan.status) {
        block('SUBSTITUTION_SHIFT_MERGE_REQUIRED', 'Денні плани мають різний формат роботи. Спочатку узгодьте роботу на місці або віддалено.');
    }
    if (!replacement && (await db.query('SELECT id FROM staff_schedule WHERE staff_id=$1 AND date=$2',
        [input.staffId, input.workDate])).rows.length) {
        block('SUBSTITUTION_SHIFT_MERGE_REQUIRED', 'У виконавця є окремий запис графіка. Узгодьте його з денним планом перед підміною.');
    }
    try {
        const breakAllocation = needsBreakAllocation
            ? allocateShiftBreak(input, target, startMinute, endMinute, targetStart, targetEnd) : null;
        const transferred = { ...segmentTerms(target), shiftStart: start.time, shiftEnd: end.time,
            breakMinutes: breakAllocation?.replacementMinutes ?? input.breakMinutes };
        const remaining = original.plan.segments.flatMap(segment => {
            if (segment !== target) return [segment];
            const parts = [];
            if (segment.shiftStart < start.time) {
                parts.push({ ...segment, shiftEnd: start.time, breakMinutes: breakAllocation?.beforeMinutes ?? segment.breakMinutes });
            }
            if (input.endsAt < targetEnd && !movesRemainder) {
                parts.push({ ...segment, id: parts.length ? null : segment.id, shiftStart: end.time,
                    breakMinutes: breakAllocation?.afterMinutes ?? segment.breakMinutes });
            }
            return parts;
        });
        const originalAfter = withSegments(original.plan, remaining);
        const replacementAfter = withSegments(replacement?.plan || { status: original.plan.status },
            [...(replacement?.plan.segments || []), transferred]);
        const remainder = movesRemainder && {
            date: end.date,
            plan: planTerms(withSegments(original.plan, [{ ...segmentTerms(target), shiftStart: end.time }]))
        };
        if (hasAnimatorRole(target) && await conflictsWithAnimatorAssignments(db, input.workDate, input.originalStaffId, originalAfter)) {
            block('SUBSTITUTION_ANIMATOR_ASSIGNMENT_OUTSIDE_SHIFT', 'У заміненого аніматора є бронювання або подія Афіші поза новим графіком.');
        }
        const simultaneousRoles = target.additionalRoles.length
            ? await quoteSimultaneousRoles(db, input,
                replacementAfter.segments.find(segment => sameSegmentScope(segment, transferred)), originalAfter, replacementAfter)
            : null;
        return { ...scope, transferred, originalBefore: original, replacementBefore: replacement,
            ...(remainder && { remainder }), ...(breakAllocation && { breakAllocation }), ...(simultaneousRoles && { simultaneousRoles }),
            originalAfter: planTerms(originalAfter), replacementAfter: planTerms(replacementAfter),
            originalSegments: originalAfter.segments, replacementSegments: replacementAfter.segments };
    } catch (error) {
        if (error.name !== 'HrShiftPlanError' && error.code !== 'HR_SHIFT_PAID_ROLE_NOT_ALLOWED'
            && !String(error.code).startsWith('SUBSTITUTION_SHIFT_')) throw error;
        block(error.code, error.message);
        return scope;
    }
}

async function writePlan(db, input, actor, shift, staffId, plan, date = input.workDate) {
    const staff = (await db.query('SELECT * FROM staff WHERE id=$1', [staffId])).rows[0];
    const allowedProfessionKeys = staffProfessionKeys(staff);
    if (staffId === input.staffId) allowedProfessionKeys.push(input.professionKey);
    const updated = await replaceHrShiftSegments(db, shift.id, plan, {
        actor: actor.username, auditSource: 'staff_substitution', professionCard: { staff, allowedProfessionKeys }
    });
    await upsertScheduleMirrorFromPlan(db, { staffId, date, note: shift.notes }, updated.plan);
}

async function insertShift(db, actor, staffId, date, segment, status, notes = null) {
    const { shiftStart, shiftEnd, breakMinutes, professionKey } = segment;
    return (await db.query(`INSERT INTO hr_shifts
        (staff_id,shift_date,planned_start,planned_end,break_minutes,profession_key,shift_type,created_by,notes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [staffId, date, shiftStart, shiftEnd, breakMinutes, professionKey,
        status === 'remote' ? 'remote' : 'regular', actor.username, notes])).rows[0];
}

async function applyPartialShift(db, actor, row, scope) {
    const input = row.input_json;
    const replacementShift = scope.replacementBefore?.shift || await insertShift(db, actor, input.staffId,
        input.workDate, scope.transferred, scope.replacementAfter.status);
    await writePlan(db, input, actor, scope.originalBefore.shift, input.originalStaffId,
        { ...scope.originalAfter, segments: scope.originalSegments });
    await writePlan(db, input, actor, replacementShift, input.staffId,
        { ...scope.replacementAfter, segments: scope.replacementSegments });
    if (scope.remainder) {
        const { date, plan } = scope.remainder;
        const shift = await insertShift(db, actor, input.originalStaffId, date, plan.segments[0], plan.status,
            scope.originalBefore.shift.notes);
        await writePlan(db, input, actor, shift, input.originalStaffId, plan, date);
    }
    await reconcileAnimatorRosterDates(db, [input.workDate]);
}

async function restorePartialShift(db, actor, row) {
    const input = row.input_json;
    const saved = row.source_snapshot;
    const { original, replacement, remainder } = await assertCurrent(db, input, saved);
    if (hasAnimatorRole(saved.transferred) && await conflictsWithAnimatorAssignments(db, input.workDate, input.staffId, saved.replacementBefore?.plan)) {
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
    if (remainder) {
        await db.query('DELETE FROM hr_shifts WHERE id=$1', [remainder.shift.id]);
        await db.query('DELETE FROM staff_schedule WHERE staff_id=$1 AND date=$2',
            [input.originalStaffId, saved.remainder.date]);
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
