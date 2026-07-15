'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    loadStaffProfessionCondition,
    normalizeProfessionConditionPayload,
    saveStaffProfessionCondition
} = require('../services/professions');

function createConditionsDb() {
    const state = {
        staff: new Map([
            [1, {
                id: 1,
                name: 'Test Worker',
                role_type: 'animator',
                secondary_professions: ['barista'],
                is_active: true,
                hourly_rate: 140,
                rate_unit: 'hour'
            }],
            [2, {
                id: 2,
                name: 'Archived Worker',
                role_type: 'animator',
                secondary_professions: [],
                is_active: false,
                hourly_rate: 100,
                rate_unit: 'hour'
            }],
            [3, {
                id: 3,
                name: 'Normalized Assignment Worker',
                role_type: 'cashier',
                secondary_professions: [],
                is_active: true,
                hourly_rate: 160,
                rate_unit: 'hour'
            }]
        ]),
        professions: new Map([
            ['animator', { id: 10, key: 'animator', title: 'Animator', is_active: true }],
            ['barista', { id: 11, key: 'barista', title: 'Barista', is_active: true }],
            ['host', { id: 12, key: 'host', title: 'Host', is_active: true }]
        ]),
        assignments: new Map([
            ['1:animator', {
                id: 100,
                staff_id: 1,
                profession_key: 'animator',
                is_primary: true,
                status: 'active',
                admission_status: 'approved',
                internship_status: 'none',
                hourly_rate: null
            }],
            ['1:barista', {
                id: 101,
                staff_id: 1,
                profession_key: 'barista',
                is_primary: false,
                status: 'active',
                admission_status: 'pending',
                internship_status: 'in_progress',
                hourly_rate: null
            }],
            ['2:animator', {
                id: 102,
                staff_id: 2,
                profession_key: 'animator',
                is_primary: true,
                status: 'inactive',
                admission_status: 'approved',
                internship_status: 'completed',
                hourly_rate: null
            }],
            ['3:host', {
                id: 103,
                staff_id: 3,
                profession_key: 'host',
                is_primary: false,
                status: 'active',
                admission_status: 'approved',
                internship_status: 'none',
                hourly_rate: null
            }]
        ]),
        rates: new Map(),
        preferences: new Map(),
        queries: []
    };

    return {
        state,
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            state.queries.push({ text, params });

            if (/^SELECT id, name, role_type, COALESCE\(secondary_professions/.test(text)) {
                const row = state.staff.get(Number(params[0]));
                return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
            }
            if (/^SELECT id, key, title, is_active FROM hr_professions/.test(text)) {
                const row = state.professions.get(String(params[0]));
                return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
            }
            if (/^SELECT id, is_primary, status, admission_status, internship_status FROM staff_role_assignments/.test(text)) {
                const row = state.assignments.get(`${Number(params[0])}:${String(params[1])}`);
                return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
            }
            if (/^SELECT hourly_rate FROM staff_profession_rates/.test(text)) {
                const value = state.rates.get(`${Number(params[0])}:${String(params[1])}`);
                return { rows: value == null ? [] : [{ hourly_rate: value }], rowCount: value == null ? 0 : 1 };
            }
            if (/^SELECT day_type, start_time, end_time, is_active FROM staff_shift_preferences/.test(text)) {
                const prefix = `${Number(params[0])}:${String(params[1])}:`;
                const rows = [...state.preferences.entries()]
                    .filter(([key]) => key.startsWith(prefix))
                    .map(([, row]) => ({ ...row }));
                return { rows, rowCount: rows.length };
            }
            if (/^INSERT INTO staff_profession_rates/.test(text)) {
                state.rates.set(`${Number(params[0])}:${String(params[1])}`, Number(params[2]));
                return { rows: [], rowCount: 1 };
            }
            if (/^DELETE FROM staff_profession_rates/.test(text)) {
                const deleted = state.rates.delete(`${Number(params[0])}:${String(params[1])}`);
                return { rows: [], rowCount: deleted ? 1 : 0 };
            }
            if (/^UPDATE staff_role_assignments/.test(text)) {
                const row = state.assignments.get(`${Number(params[0])}:${String(params[1])}`);
                if (row) row.hourly_rate = params[2];
                return { rows: [], rowCount: row ? 1 : 0 };
            }
            if (/^INSERT INTO staff_shift_preferences/.test(text)) {
                state.preferences.set(`${Number(params[0])}:${String(params[1])}:${String(params[2])}`, {
                    day_type: params[2],
                    start_time: params[3],
                    end_time: params[4],
                    is_active: true
                });
                return { rows: [], rowCount: 1 };
            }
            if (/^DELETE FROM staff_shift_preferences/.test(text)) {
                const deleted = state.preferences.delete(`${Number(params[0])}:${String(params[1])}:${String(params[2])}`);
                return { rows: [], rowCount: deleted ? 1 : 0 };
            }
            throw new Error(`Unexpected query: ${text}`);
        }
    };
}

function conditionPayload(rate, options = {}) {
    const weekday = options.weekday ?? ['10:00', '18:00'];
    const weekend = options.weekend ?? ['11:00', '19:00'];
    return {
        rateMode: rate == null ? 'fallback' : 'explicit',
        hourlyRate: rate,
        rateUnit: options.rateUnit || 'hour',
        shiftPreferences: [
            { dayType: 'weekday', startTime: weekday[0], endTime: weekday[1] },
            { dayType: 'weekend', startTime: weekend[0], endTime: weekend[1] }
        ]
    };
}

describe('profession staff conditions', () => {
    it('keeps different explicit rates and typical times for primary and secondary professions', async () => {
        const db = createConditionsDb();
        const animator = await saveStaffProfessionCondition(db, 1, 'animator', conditionPayload(180), { actor: 'qa' });
        const barista = await saveStaffProfessionCondition(db, 1, 'barista', conditionPayload(220, {
            weekday: ['09:00', '17:00'],
            weekend: ['10:00', '16:00']
        }), { actor: 'qa' });

        assert.equal(animator.after.explicitRate, 180);
        assert.equal(animator.after.isPrimary, true);
        assert.equal(barista.after.explicitRate, 220);
        assert.equal(barista.after.isPrimary, false);
        assert.equal(barista.after.admissionStatus, 'pending');
        assert.equal(db.state.rates.get('1:animator'), 180);
        assert.equal(db.state.rates.get('1:barista'), 220);
        assert.deepEqual(barista.after.shiftPreferences.map(row => [row.dayType, row.startTime, row.endTime]), [
            ['weekday', '09:00', '17:00'],
            ['weekend', '10:00', '16:00']
        ]);
    });

    it('uses the shared profession -> staff -> assignment lock order for mutations', async () => {
        const db = createConditionsDb();

        await saveStaffProfessionCondition(db, 1, 'animator', conditionPayload(180), { actor: 'qa' });

        const lockQueries = db.state.queries
            .filter(entry => /FOR (?:UPDATE|SHARE)/.test(entry.text))
            .slice(0, 3)
            .map(entry => entry.text);
        assert.match(lockQueries[0], /^SELECT id, key, title, is_active FROM hr_professions .* FOR UPDATE$/);
        assert.match(lockQueries[1], /^SELECT id, name, role_type, .* FROM staff .* FOR UPDATE$/);
        assert.match(lockQueries[2], /^SELECT id, is_primary, status, admission_status, internship_status FROM staff_role_assignments .* FOR UPDATE$/);
    });

    it('removes an explicit override and exposes staff.hourly_rate as the fallback source', async () => {
        const db = createConditionsDb();
        await saveStaffProfessionCondition(db, 1, 'animator', conditionPayload(180), { actor: 'qa' });
        const saved = await saveStaffProfessionCondition(db, 1, 'animator', conditionPayload(null), { actor: 'qa' });

        assert.equal(saved.after.rateMode, 'fallback');
        assert.equal(saved.after.explicitRate, null);
        assert.equal(saved.after.effectiveRate, 140);
        assert.equal(saved.after.rateSource, 'staff.hourly_rate');
        assert.equal(db.state.rates.has('1:animator'), false);
        assert.equal(db.state.assignments.get('1:animator').hourly_rate, null);
    });

    it('loads archived staff without changing assignment semantics', async () => {
        const db = createConditionsDb();
        const condition = await loadStaffProfessionCondition(db, 2, 'animator');

        assert.equal(condition.staffActive, false);
        assert.equal(condition.isPrimary, true);
        assert.equal(condition.assignmentStatus, 'inactive');
        assert.equal(condition.admissionStatus, 'approved');
        assert.equal(condition.internshipStatus, 'completed');
    });

    it('accepts a normalized-only staff_role_assignments profession absent from legacy staff fields', async () => {
        const db = createConditionsDb();
        const before = await loadStaffProfessionCondition(db, 3, 'host');
        const saved = await saveStaffProfessionCondition(db, 3, 'host', conditionPayload(210), { actor: 'qa' });

        assert.equal(before.professionKey, 'host');
        assert.equal(before.isPrimary, false);
        assert.equal(before.assignmentStatus, 'active');
        assert.equal(saved.after.explicitRate, 210);
        assert.equal(db.state.rates.get('3:host'), 210);
    });

    it('rejects invalid rates, malformed times, incomplete pairs, and incomplete day coverage', () => {
        const current = { rateUnit: 'hour' };

        assert.throws(() => normalizeProfessionConditionPayload(conditionPayload(0), current), /rate/i);
        assert.throws(() => normalizeProfessionConditionPayload(conditionPayload(-1), current), /rate/i);
        assert.throws(() => normalizeProfessionConditionPayload(conditionPayload(1000001), current), /rate/i);
        assert.throws(() => normalizeProfessionConditionPayload(conditionPayload(100, {
            weekday: ['10:00', '10:00']
        }), current), /must be different/);
        assert.throws(() => normalizeProfessionConditionPayload(conditionPayload(100, {
            weekday: ['10:00', '']
        }), current), /valid HH:MM/);
        assert.throws(() => normalizeProfessionConditionPayload(conditionPayload(100, {
            weekend: ['24:00', '18:00']
        }), current), /valid HH:MM/);
        assert.throws(() => normalizeProfessionConditionPayload({
            ...conditionPayload(100),
            shiftPreferences: [{ dayType: 'weekday', startTime: '10:00', endTime: '18:00' }]
        }, current), /weekday and weekend/);
        assert.throws(() => normalizeProfessionConditionPayload({
            ...conditionPayload(100),
            shiftPreferences: [
                { dayType: 'weekday', startTime: '10:00', endTime: '18:00' },
                { dayType: 'weekday', startTime: '11:00', endTime: '19:00' }
            ]
        }, current), /unique weekday\/weekend/);
    });

    it('rejects explicit profession overrides for day and month rate units but keeps fallback valid', () => {
        assert.throws(
            () => normalizeProfessionConditionPayload(conditionPayload(200, { rateUnit: 'day' }), { rateUnit: 'day' }),
            /only for hourly staff/
        );
        assert.throws(
            () => normalizeProfessionConditionPayload(conditionPayload(200, { rateUnit: 'month' }), { rateUnit: 'month' }),
            /only for hourly staff/
        );

        const dailyFallback = normalizeProfessionConditionPayload(conditionPayload(null, { rateUnit: 'day' }), { rateUnit: 'day' });
        const monthlyFallback = normalizeProfessionConditionPayload(conditionPayload(null, { rateUnit: 'month' }), { rateUnit: 'month' });
        assert.equal(dailyFallback.rateMode, 'fallback');
        assert.equal(dailyFallback.rateUnit, 'day');
        assert.equal(monthlyFallback.rateMode, 'fallback');
        assert.equal(monthlyFallback.rateUnit, 'month');
    });

    it('marks a stored hourly override as ignored when payroll uses day or month units', async () => {
        const db = createConditionsDb();
        db.state.staff.get(1).rate_unit = 'day';
        db.state.staff.get(1).hourly_rate = 1200;
        db.state.rates.set('1:animator', 250);

        const condition = await loadStaffProfessionCondition(db, 1, 'animator');

        assert.equal(condition.rateUnit, 'day');
        assert.equal(condition.rateMode, 'fallback');
        assert.equal(condition.explicitRate, null);
        assert.equal(condition.storedExplicitRate, 250);
        assert.equal(condition.ignoredExplicitRate, 250);
        assert.equal(condition.rateIgnored, true);
        assert.equal(condition.effectiveRate, 1200);
        assert.match(condition.rateSource, /ignored/);
    });

    it('rejects missing staff and professions that are not assigned to the staff member', async () => {
        const db = createConditionsDb();

        await assert.rejects(
            () => loadStaffProfessionCondition(db, 999, 'animator'),
            error => error.code === 'STAFF_NOT_FOUND' && error.statusCode === 404
        );
        await assert.rejects(
            () => loadStaffProfessionCondition(db, 2, 'barista'),
            error => error.code === 'PROFESSION_NOT_ASSIGNED' && error.statusCode === 409
        );
    });

    it('never reads or writes actual schedules, attendance, or historical payroll', async () => {
        const db = createConditionsDb();
        await saveStaffProfessionCondition(db, 1, 'animator', conditionPayload(190), { actor: 'qa' });

        const sql = db.state.queries.map(query => query.text).join('\n');
        assert.doesNotMatch(sql, /\bhr_shifts\b|\bstaff_schedule\b|\bhr_time_records\b|\bstaff_checkins\b|\bpayroll\b/i);
    });
});
