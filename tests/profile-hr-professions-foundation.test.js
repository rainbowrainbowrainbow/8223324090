const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    normalizeSecondaryProfessions,
    normalizeProfessionCatalogRow,
    validateProfessionKeys
} = require('../services/professions');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

describe('profile, HR professions, and timeline compatibility foundation', () => {
    const migration = readRepoFile('db', 'migrations', '223_profile_hr_professions_foundation.sql');
    const hrRoute = readRepoFile('routes', 'hr.js');
    const authRoute = readRepoFile('routes', 'auth.js');
    const staffRoute = readRepoFile('routes', 'staff.js');
    const profilePage = readRepoFile('js', 'profile-page.js');
    const profileHtml = readRepoFile('profile.html');
    const hrPage = readRepoFile('js', 'hr-page.js');
    const hrHtml = readRepoFile('hr.html');
    const staffPage = readRepoFile('js', 'staff-page.js');
    const uiHelper = readRepoFile('js', 'ui.js');
    const bookingService = readRepoFile('services', 'booking.js');

    it('adds one additive profession catalog and one secondary-professions field', () => {
        assert.match(migration, /MIGRATION_KIND:\s*mixed/);
        assert.match(migration, /ALTER TABLE staff[\s\S]*ADD COLUMN IF NOT EXISTS secondary_professions JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
        assert.match(migration, /staff_secondary_professions_is_array/);
        assert.match(migration, /CREATE TABLE IF NOT EXISTS hr_professions/);
        assert.match(migration, /key VARCHAR\(64\) NOT NULL UNIQUE/);
        assert.match(migration, /responsibilities JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
        assert.match(migration, /checklist JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
        assert.match(migration, /ON CONFLICT \(key\) DO UPDATE SET/);
    });

    it('normalizes multiple professions without duplicating the primary role', () => {
        assert.deepEqual(
            normalizeSecondaryProfessions(['Animator', 'host', 'host', ' instructor ', ''], 'animator'),
            ['host', 'instructor']
        );
        assert.deepEqual(normalizeSecondaryProfessions('host; instructor,host', 'animator'), ['host', 'instructor']);
        assert.deepEqual(validateProfessionKeys(['host', 'unknown'], new Set(['host', 'animator'])), ['unknown']);

        const row = normalizeProfessionCatalogRow({
            key: ' Host ',
            title: 'Ведуча',
            short_info: 'Сценарій і темп',
            responsibilities: 'веде програму;тримає таймінг',
            checklist: ['сценарій', 'реквізит'],
            sort_order: '12'
        });
        assert.equal(row.key, 'host');
        assert.deepEqual(row.responsibilities, ['веде програму', 'тримає таймінг']);
        assert.deepEqual(row.checklist, ['сценарій', 'реквізит']);
        assert.equal(row.sortOrder, 12);
    });

    it('exposes profession catalog and secondary profession assignment through canonical API paths', () => {
        assert.match(hrRoute, /router\.get\('\/professions'/);
        assert.match(hrRoute, /router\.post\('\/professions'/);
        assert.match(hrRoute, /router\.put\('\/professions\/:id'/);
        assert.match(hrRoute, /COALESCE\(secondary_professions, '\[\]'::jsonb\) AS secondary_professions/);
        assert.match(hrRoute, /role_type = \$\$\{params\.length\} OR COALESCE\(secondary_professions, '\[\]'::jsonb\) \? \$\$\{params\.length\}/);
        assert.match(hrRoute, /validateStaffProfessionInput/);
        assert.match(hrRoute, /SELECT role_type FROM staff WHERE id = \$1/);
        assert.match(hrRoute, /secondary_professions = CASE[\s\S]*WHEN \$15::boolean THEN \$16::jsonb/);

        assert.match(staffRoute, /secondary_professions, secondaryProfessions/);
        assert.match(staffRoute, /effectivePrimaryRole/);
        assert.match(staffRoute, /INSERT INTO staff[\s\S]*secondary_professions/);
        assert.match(staffRoute, /secondary_professions = CASE WHEN \$13::boolean THEN \$14::jsonb ELSE secondary_professions END/);

        assert.match(authRoute, /function normalizeProfileStaffProfile/);
        assert.match(authRoute, /staffProfile/);
        assert.match(authRoute, /professionCatalog/);
        assert.match(authRoute, /FROM hr_professions[\s\S]*WHERE is_active = true/);
    });

    it('rebuilds profile around professions instead of the header cockpit strip', () => {
        assert.match(profilePage, /function renderProfileProfessionHeaderPanel/);
        assert.match(profilePage, /function profileProfessionEntries/);
        assert.match(profilePage, /function renderProfileProfessionCard/);
        assert.match(profilePage, /staffProfile/);
        assert.match(profilePage, /professionCatalog/);
        assert.doesNotMatch(profilePage, /renderProfileCockpitWidgetStrip\(\{ context: 'header'/);
        assert.match(profileHtml, /\.profile-profession-header-panel/);
        assert.match(profileHtml, /\.profile-profession-roster-panel/);
        assert.match(profileHtml, /\.profile-profession-card/);
    });

    it('adds HR professions and checklist surfaces plus safe edit controls', () => {
        assert.match(hrHtml, /data-tab="professions"/);
        assert.match(hrHtml, /data-tab="checklists"/);
        assert.match(hrHtml, /id="professionCatalogList"/);
        assert.match(hrHtml, /id="professionChecklistList"/);
        assert.match(hrHtml, /id="editSecondaryProfessions"/);
        assert.match(hrHtml, /\.hr-profession-card/);
        assert.match(hrHtml, /\.hr-checklist-card/);

        assert.match(hrPage, /async function loadProfessions/);
        assert.match(hrPage, /function renderProfessionChecklists/);
        assert.match(hrPage, /function openProfessionEditor/);
        assert.match(hrPage, /closeOnBackdrop:\s*false/);
        assert.match(hrPage, /function populateStaffProfessionControls/);
        assert.match(hrPage, /secondary_professions: normalizeProfessionList\(readStaffSecondaryProfessionSelection/);

        assert.match(uiHelper, /closeOnBackdrop = true/);
        assert.match(uiHelper, /e\.target === overlay && closeOnBackdrop/);
    });

    it('keeps staff and timeline grouping compatible with primary role semantics', () => {
        assert.match(staffPage, /roleKeys\.includes\(s\.role_type\)/);
        assert.match(staffPage, /allRoleKeys\.includes\(s\.role_type\)/);
        assert.match(staffPage, /secondary_professions: String\(result\.secondary_professions/);
        assert.match(bookingService, /s\.role_type = 'animator'/);
        assert.doesNotMatch(bookingService, /secondary_professions/);
    });
});
