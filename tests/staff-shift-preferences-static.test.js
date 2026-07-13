const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('db/migrations/279_staff_shift_preferences.sql', 'utf8');
const migrationSql = migration
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
const staffRoute = fs.readFileSync('routes/staff.js', 'utf8');
const dbIndex = fs.readFileSync('db/index.js', 'utf8');
const hrPage = fs.readFileSync('js/hr-page.js', 'utf8');
const staffPage = fs.readFileSync('js/staff-page.js', 'utf8');

function routeBlock(method, path) {
    const start = staffRoute.indexOf(`router.${method}('${path}'`);
    assert.notEqual(start, -1, `Missing ${method.toUpperCase()} ${path}`);
    const nextRoute = staffRoute.indexOf('\nrouter.', start + 1);
    return staffRoute.slice(start, nextRoute === -1 ? staffRoute.length : nextRoute);
}

describe('staff shift preferences contract', () => {
    it('adds staff shift preferences through a governed migration only', () => {
        assert.match(migration, /-- MIGRATION_KIND: mixed/);
        assert.match(migration, /-- SAFETY: Additive table for staff-level default shift preferences/);
        assert.match(migration, /-- DATA_SCOPE: Current staff rows/);
        assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_shift_preferences/);
        assert.match(migration, /staff_id INTEGER NOT NULL REFERENCES staff\(id\) ON DELETE CASCADE/);
        assert.match(migration, /profession_key VARCHAR\(64\) NOT NULL/);
        assert.match(migration, /day_type VARCHAR\(16\) NOT NULL/);
        assert.match(migration, /start_time TIME NOT NULL/);
        assert.match(migration, /end_time TIME NOT NULL/);
        assert.match(migration, /UNIQUE \(staff_id, profession_key, day_type\)/);
        assert.match(migration, /CHECK \(day_type IN \('weekday', 'weekend'\)\)/);
        assert.match(migration, /CHECK \(start_time <> end_time\)/);

        assert.doesNotMatch(dbIndex, /staff_shift_preferences/);
        assert.doesNotMatch(migrationSql, /\bUPDATE\s+staff_schedule\b/i);
        assert.doesNotMatch(migrationSql, /\bINSERT\s+INTO\s+staff_schedule\b/i);
        assert.doesNotMatch(migrationSql, /\bhr_shifts\b/i);
    });

    it('backfills only safe animator and trampoline profession defaults', () => {
        assert.match(migration, /\('animator', 'weekday', '12:00'::time, '20:00'::time\)/);
        assert.match(migration, /\('animator', 'weekend', '10:00'::time, '20:00'::time\)/);
        assert.match(migration, /\('instructor', 'weekday', '11:00'::time, '20:00'::time\)/);
        assert.match(migration, /\('instructor', 'weekend', '09:00'::time, '20:00'::time\)/);
        assert.match(migration, /\('trampoline_instructor', 'weekday', '11:00'::time, '20:00'::time\)/);
        assert.match(migration, /\('trampoline_instructor', 'weekend', '09:00'::time, '20:00'::time\)/);
        assert.match(migration, /\('senior_instructor', 'weekday', '11:00'::time, '20:00'::time\)/);
        assert.match(migration, /\('senior_instructor', 'weekend', '09:00'::time, '20:00'::time\)/);
        assert.match(migration, /ON CONFLICT \(staff_id, profession_key, day_type\) DO NOTHING/);
    });

    it('exposes read and write endpoints without changing actual schedule rows', () => {
        const getBlock = routeBlock('get', '/:id/shift-preferences');
        const putBlock = routeBlock('put', '/:id/shift-preferences');
        const crudIndex = staffRoute.indexOf('// STAFF CRUD');

        assert.ok(staffRoute.indexOf("router.get('/:id/shift-preferences'") < crudIndex);
        assert.ok(staffRoute.indexOf("router.put('/:id/shift-preferences'") < crudIndex);
        assert.match(staffRoute, /staffProfessionKeys/);
        assert.match(staffRoute, /function normalizeShiftPreferenceDayType/);
        assert.match(staffRoute, /function normalizeShiftPreferenceTime/);
        assert.match(staffRoute, /function validateStaffShiftPreferencePayload/);
        assert.match(staffRoute, /allowedProfessionSet\.has\(professionKey\)/);
        assert.match(getBlock, /loadStaffShiftPreferences\(pool, staffId, \{ professionKeys: allowedProfessions \}\)/);
        assert.match(putBlock, /requireAction\('manage_staff'\)/);
        assert.match(putBlock, /INSERT INTO staff_shift_preferences/);
        assert.match(putBlock, /ON CONFLICT \(staff_id, profession_key, day_type\)/);
        assert.match(putBlock, /insertHrAuditLog\(client, 'staff_shift_preferences_update'/);
        assert.doesNotMatch(putBlock, /staff_schedule/);
        assert.doesNotMatch(putBlock, /hr_shifts/);
        assert.doesNotMatch(putBlock, /syncHrShiftFromScheduleEntry/);
    });

    it('completes missing profession defaults without overwriting configured times', () => {
        const putBlock = routeBlock('put', '/:id/shift-preferences');
        const fallbackInsertIndex = putBlock.indexOf('for (const preference of fallbackPreferences)');
        const explicitUpsertIndex = putBlock.indexOf('for (const preference of validation.preferences)');

        assert.match(staffRoute, /function missingStaffShiftPreferenceDefaults/);
        assert.match(staffRoute, /for \(const professionKey of allowedProfessions\)/);
        assert.match(staffRoute, /for \(const dayType of STAFF_SHIFT_PREFERENCE_DAY_TYPE_KEYS\)/);
        assert.match(putBlock, /missingStaffShiftPreferenceDefaults\([\s\S]*validation\.allowedProfessions,[\s\S]*validation\.preferences/);
        assert.match(putBlock, /ON CONFLICT \(staff_id, profession_key, day_type\) DO NOTHING/);
        assert.match(putBlock, /ensuredFallbackCount: createdFallbacks\.length/);
        assert.ok(fallbackInsertIndex >= 0 && fallbackInsertIndex < explicitUpsertIndex, 'fallback rows are inserted before explicit values are upserted');
        assert.match(staffRoute, /animator:\s*Object\.freeze\(\{[\s\S]*weekday:[\s\S]*12:00[\s\S]*weekend:[\s\S]*10:00/);
    });

    it('saves card times, refreshes the schedule, and exposes saved-versus-fallback sources', () => {
        assert.match(hrPage, /const shouldSaveShiftPreferences = scope === 'work'/);
        assert.match(hrPage, /await saveStaffShiftPreferences\(staffId\)/);
        assert.match(hrPage, /await refreshHrStaffScheduleAfterWorkSave\(staffId\)/);
        assert.match(staffPage, /function fallbackScheduleShiftPreference/);
        assert.match(staffPage, /data-shift-pref-source=/);
        assert.match(staffPage, /row\.source === 'fallback' \? 'Fallback' : 'Збережено'/);
        assert.match(staffPage, /applyScheduleShiftPreference\([\s\S]*force: true/);
        assert.doesNotMatch(hrPage, /UPDATE\s+staff_schedule/i);
    });
});
