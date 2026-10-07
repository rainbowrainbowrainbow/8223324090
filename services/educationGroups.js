'use strict';

const { pool } = require('../db');

class EducationGroupError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

function positiveId(value, label = 'ID') {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new EducationGroupError(`${label}: invalid ID`);
    return id;
}

function dateValue(value, label) {
    const parsed = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
        || !parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new EducationGroupError(`${label}: invalid date`);
    }
    return value;
}

function day(value) {
    return String(value).slice(0, 10);
}

function maxConcurrent(rows) {
    const changes = new Map();
    for (const row of rows) {
        const start = day(row.start_date);
        const end = row.end_date ? day(row.end_date) : null;
        changes.set(start, (changes.get(start) || 0) + 1);
        if (end) {
            const next = new Date(`${end}T00:00:00Z`);
            next.setUTCDate(next.getUTCDate() + 1);
            const key = next.toISOString().slice(0, 10);
            changes.set(key, (changes.get(key) || 0) - 1);
        }
    }
    let count = 0;
    let max = 0;
    for (const key of [...changes.keys()].sort()) {
        count += changes.get(key);
        max = Math.max(max, count);
    }
    return max;
}

async function transaction(work) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function listTeachers(context, db = pool, includeInactive = false) {
    const result = await db.query(
        `SELECT s.id, s.name, (s.is_active IS TRUE AND COALESCE(m.is_active, TRUE)) AS is_active
         FROM staff s
         LEFT JOIN education_teacher_memberships m ON m.staff_id = s.id AND m.business_context = $1
         WHERE (m.staff_id IS NOT NULL OR EXISTS (
             SELECT 1 FROM education_groups g WHERE g.business_context = $1 AND g.teacher_id = s.id))
         AND ($2::boolean OR (s.is_active IS TRUE AND COALESCE(m.is_active, TRUE)))
         ORDER BY s.name, s.id`, [context, includeInactive]
    );
    return result.rows;
}

async function createTeacher(context, input, actorId = null) {
    const name = String(input.name || '').trim();
    if (!name || name.length > 100) throw new EducationGroupError('Ім’я викладача: від 1 до 100 символів');
    if (input.staffId != null || input.staff_id != null) throw new EducationGroupError('Створіть нового викладача; довільний staff ID не можна прив’язати');
    return transaction(async db => {
        const { getBusinessCabinetSettings } = require('./businessCabinet');
        const cabinet = await getBusinessCabinetSettings(db, context);
        if (cabinet.timelineMode !== 'education') throw new EducationGroupError('Викладачів можна додавати лише в навчальному бізнесі',409);
        const person = (await db.query(
            "INSERT INTO staff(name,department,position,is_active) VALUES ($1,'education','Викладач',true) RETURNING id,name,is_active", [name]
        )).rows[0];
        await db.query(`INSERT INTO education_teacher_memberships(business_context,staff_id,created_by,updated_by)
            VALUES ($1,$2,$3,$3)`, [context, person.id, actorId]);
        return person;
    });
}

async function setTeacherActive(context, teacherId, input, actorId = null) {
    if (typeof input.isActive !== 'boolean') throw new EducationGroupError('isActive must be boolean');
    const id = positiveId(teacherId, 'teacherId');
    return transaction(async db => {
        const person = (await db.query(`SELECT s.id,s.name,s.is_active FROM staff s
            WHERE s.id=$2 AND (EXISTS (SELECT 1 FROM education_teacher_memberships m WHERE m.business_context=$1 AND m.staff_id=s.id)
                OR EXISTS (SELECT 1 FROM education_groups g WHERE g.business_context=$1 AND g.teacher_id=s.id)) FOR UPDATE`, [context,id])).rows[0];
        if (!person) throw new EducationGroupError('Викладача не знайдено в цьому бізнесі',404);
        if (input.isActive && person.is_active !== true) throw new EducationGroupError('Працівник неактивний; відновлення виконується в чинному HR workflow',409);
        await db.query(`INSERT INTO education_teacher_memberships(business_context,staff_id,is_active,created_by,updated_by)
            VALUES ($1,$2,$3,$4,$4) ON CONFLICT(business_context,staff_id) DO UPDATE
            SET is_active=EXCLUDED.is_active, updated_by=EXCLUDED.updated_by, updated_at=NOW()`, [context,id,input.isActive,actorId]);
        return {id:person.id,name:person.name,is_active:input.isActive && person.is_active===true};
    });
}

async function assertLessonTeacher(db, context, lesson, previous = null) {
    const id = String(lesson.teacherId || '').trim();
    const oldId = String(previous?.teacherId || '').trim();
    // Legacy snapshots remain editable; only new or changed assignments require eligibility.
    if (previous && id === oldId) {
        if (!id && String(lesson.teacherName || '') !== String(previous.teacherName || '')) {
            throw new EducationGroupError('Оберіть викладача з довідника',400);
        }
        return { ...lesson, teacherName: previous.teacherName || '' };
    }
    if (!id) {
        if (lesson.teacherName) throw new EducationGroupError('Оберіть викладача з довідника',400);
        return lesson;
    }
    const teacherId = await checkTeacher(db,context,id);
    // A row lock prevents a scoped deactivation racing a new assignment.
    const staff = (await db.query('SELECT id,name,is_active FROM staff WHERE id=$1 FOR SHARE',[teacherId])).rows[0];
    const membership = await db.query('SELECT is_active FROM education_teacher_memberships WHERE business_context=$1 AND staff_id=$2 FOR SHARE',[context,teacherId]);
    if (!staff?.is_active || membership.rows[0]?.is_active === false) throw new EducationGroupError('Active teacher not found in this business',404);
    return {...lesson,teacherId:String(teacherId),teacherName:staff.name};
}

async function checkTeacher(db, context, teacherId) {
    if (teacherId == null || teacherId === '') return null;
    const id = positiveId(teacherId, 'teacherId');
    await db.query('SELECT id FROM staff WHERE id=$1 FOR SHARE', [id]);
    await db.query('SELECT staff_id FROM education_teacher_memberships WHERE business_context=$1 AND staff_id=$2 FOR SHARE', [context,id]);
    const teachers = await listTeachers(context, db);
    if (!teachers.some(teacher => Number(teacher.id) === id)) throw new EducationGroupError('Active teacher not found in this business', 404);
    return id;
}

async function lockedGroup(db, context, groupId) {
    const result = await db.query(
        'SELECT * FROM education_groups WHERE id = $1 AND business_context = $2 FOR UPDATE',
        [positiveId(groupId, 'groupId'), context]
    );
    if (!result.rowCount) throw new EducationGroupError('Group not found', 404);
    return result.rows[0];
}

async function assertLessonGroup(db, context, groupId, options = {}) {
    if (groupId == null || groupId === '') return null;
    const result = await db.query(
        'SELECT id, name, status FROM education_groups WHERE id = $1 AND business_context = $2 FOR SHARE',
        [positiveId(groupId, 'groupId'), context]
    );
    const group = result.rows[0];
    if (!group) throw new EducationGroupError('Group not found in this business', 404);
    if (group.status !== 'active' && !options.allowArchived) {
        throw new EducationGroupError('Archived group cannot be assigned to a lesson', 409);
    }
    return group;
}

async function listGroups(context, includeArchived = false) {
    const result = await pool.query(
        `SELECT g.*, s.name AS teacher_name,
                COUNT(m.id) FILTER (WHERE m.start_date <= (NOW() AT TIME ZONE 'Europe/Kyiv')::date
                    AND (m.end_date IS NULL OR m.end_date >= (NOW() AT TIME ZONE 'Europe/Kyiv')::date))::int AS occupancy
         FROM education_groups g
         LEFT JOIN staff s ON s.id = g.teacher_id
         LEFT JOIN education_group_members m ON m.group_id = g.id AND m.business_context = g.business_context
         WHERE g.business_context = $1 AND ($2::boolean OR g.status = 'active')
         GROUP BY g.id, s.name ORDER BY g.status, g.name, g.id`,
        [context, includeArchived]
    );
    return result.rows;
}

async function getGroup(context, groupId) {
    const result = await pool.query(
        `SELECT g.*, s.name AS teacher_name FROM education_groups g
         LEFT JOIN staff s ON s.id = g.teacher_id
         WHERE g.id = $1 AND g.business_context = $2`,
        [positiveId(groupId, 'groupId'), context]
    );
    if (!result.rowCount) throw new EducationGroupError('Group not found', 404);
    const members = await pool.query(
        `SELECT m.*, m.start_date::text AS start_date, m.end_date::text AS end_date,
                cc.name AS child_name, c.name AS parent_name
         FROM education_group_members m
         JOIN customer_children cc ON cc.id = m.child_id AND cc.business_context = m.business_context
         JOIN customers c ON c.id = cc.customer_id AND COALESCE(c.business_context, 'event_genix') = m.business_context
         WHERE m.group_id = $1 AND m.business_context = $2
         ORDER BY m.start_date DESC, m.id DESC`,
        [groupId, context]
    );
    return { ...result.rows[0], members: members.rows };
}

async function saveGroup(context, input, groupId = null) {
    return transaction(async db => {
        const name = String(input.name || '').trim();
        const capacity = Number(input.capacity);
        if (!name || name.length > 120) throw new EducationGroupError('Group name is required (max 120 characters)');
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
            throw new EducationGroupError('Capacity must be between 1 and 500');
        }
        const group = groupId == null ? null : await lockedGroup(db, context, groupId);
        const requestedTeacher = Object.hasOwn(input, 'teacherId') ? input.teacherId : group?.teacher_id;
        // Preserve an existing assignment, including inactive teachers, on unrelated edits.
        const teacherId = group && String(requestedTeacher ?? '') === String(group.teacher_id ?? '')
            ? group.teacher_id : await checkTeacher(db, context, requestedTeacher);
        if (groupId != null) {
            if (group.status !== 'active') throw new EducationGroupError('Archived group cannot be edited', 409);
            const members = await db.query(
                'SELECT start_date::text AS start_date, end_date::text AS end_date FROM education_group_members WHERE group_id = $1 AND business_context = $2',
                [group.id, context]
            );
            if (maxConcurrent(members.rows) > capacity) throw new EducationGroupError('Capacity is below existing membership', 409);
            const result = await db.query(
                `UPDATE education_groups SET name = $3, teacher_id = $4, capacity = $5, updated_at = NOW()
                 WHERE id = $1 AND business_context = $2 RETURNING *`,
                [group.id, context, name, teacherId, capacity]
            );
            return result.rows[0];
        }
        const result = await db.query(
            `INSERT INTO education_groups (business_context, name, teacher_id, capacity)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [context, name, teacherId, capacity]
        );
        return result.rows[0];
    });
}

async function archiveGroup(context, groupId) {
    return transaction(async db => {
        const group = await lockedGroup(db, context, groupId);
        const result = await db.query(
            `UPDATE education_groups SET status = 'archived', updated_at = NOW()
             WHERE id = $1 AND business_context = $2 RETURNING *`,
            [group.id, context]
        );
        return result.rows[0];
    });
}

async function enrollChild(context, groupId, input) {
    return transaction(async db => {
        const group = await lockedGroup(db, context, groupId);
        if (group.status !== 'active') throw new EducationGroupError('Archived group cannot accept children', 409);
        const childId = positiveId(input.childId, 'childId');
        const start = dateValue(input.startDate, 'startDate');
        const end = input.endDate ? dateValue(input.endDate, 'endDate') : null;
        if (end && end < start) throw new EducationGroupError('endDate precedes startDate');
        const child = await db.query(
            `SELECT cc.id FROM customer_children cc JOIN customers c ON c.id = cc.customer_id
             WHERE cc.id = $1 AND cc.business_context = $2 AND COALESCE(c.business_context, 'event_genix') = $2`,
            [childId, context]
        );
        if (!child.rowCount) throw new EducationGroupError('Child not found in this business', 404);
        const existing = await db.query(
            `SELECT id, child_id, start_date::text AS start_date, end_date::text AS end_date FROM education_group_members
             WHERE group_id = $1 AND business_context = $2`,
            [group.id, context]
        );
        const overlaps = existing.rows.some(row => Number(row.child_id) === childId
            && day(row.start_date) <= (end || '9999-12-31')
            && (!row.end_date || day(row.end_date) >= start));
        if (overlaps) throw new EducationGroupError('Child already belongs to this group during these dates', 409);
        if (maxConcurrent([...existing.rows, { start_date: start, end_date: end }]) > group.capacity) {
            throw new EducationGroupError('Group capacity exceeded', 409);
        }
        const result = await db.query(
            `INSERT INTO education_group_members (business_context, group_id, child_id, start_date, end_date)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [context, group.id, childId, start, end]
        );
        return result.rows[0];
    });
}

async function endMembership(context, groupId, membershipId, endDate) {
    return transaction(async db => {
        const group = await lockedGroup(db, context, groupId);
        const end = dateValue(endDate, 'endDate');
        const result = await db.query(
            `UPDATE education_group_members SET end_date = $4, updated_at = NOW()
             WHERE id = $1 AND group_id = $2 AND business_context = $3
               AND start_date <= $4 AND (end_date IS NULL OR end_date >= $4)
             RETURNING *`,
            [positiveId(membershipId, 'membershipId'), group.id, context, end]
        );
        if (!result.rowCount) throw new EducationGroupError('Membership not found or end date invalid', 404);
        return result.rows[0];
    });
}

module.exports = {
    EducationGroupError, assertLessonGroup, assertLessonTeacher, listGroups, getGroup, listTeachers, createTeacher, setTeacherActive,
    saveGroup, archiveGroup, enrollChild, endMembership
};
