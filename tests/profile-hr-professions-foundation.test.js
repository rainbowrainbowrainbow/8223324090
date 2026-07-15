const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    normalizeSecondaryProfessions,
    normalizeProfessionCatalogRow,
    loadProfessionWorkspaceCatalog,
    loadProfessionWorkspace,
    validateProfessionKeys
} = require('../services/professions');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

describe('profile, HR professions, and timeline compatibility foundation', () => {
    const migration = readRepoFile('db', 'migrations', '223_profile_hr_professions_foundation.sql');
    const hrRoute = readRepoFile('routes', 'hr.js');
    const professionsService = readRepoFile('services', 'professions.js');
    const authRoute = readRepoFile('routes', 'auth.js');
    const staffRoute = readRepoFile('routes', 'staff.js');
    const profilePage = readRepoFile('js', 'profile-page.js');
    const profileHtml = readRepoFile('profile.html');
    const hrPage = readRepoFile('js', 'hr-page.js');
    const hrHtml = `${readRepoFile('hr.html')}\n${readRepoFile('css', 'hr-page.css')}`;
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
        assert.match(professionsService, /SELECT id, name, role_type, COALESCE\(secondary_professions, '\[\]'::jsonb\) AS secondary_professions, is_active/);
        assert.match(hrRoute, /hasSecondaryProfessions/);
        assert.match(hrRoute, /queueStaffUpdate\('secondary_professions'[\s\S]*'::jsonb'\)/);

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
        assert.match(profilePage, /function profileActiveProfessionEntry/);
        assert.match(profilePage, /function setProfileProfessionContext/);
        assert.match(profilePage, /function renderProfileProfessionCard/);
        assert.match(profilePage, /staffProfile/);
        assert.match(profilePage, /professionCatalog/);
        assert.doesNotMatch(profilePage, /renderProfileCockpitWidgetStrip\(\{ context: 'header'/);
        assert.match(profilePage, /profileWorkHubTabOrder/);
        assert.match(profilePage, /function profileSecondaryTabOrder/);
        assert.match(profilePage, /\.\.\.profileWorkHubTabOrder\(\)\.map/);
        assert.doesNotMatch(profilePage, /renderProfileWorkHubTabs\(professionEntries\)/);
        assert.match(profilePage, /label: 'Професії'/);
        assert.match(profilePage, /label: 'Чеклісти'/);
        assert.match(profilePage, /label: 'Матеріали'/);
        assert.match(profileHtml, /\.profile-profession-header-panel/);
        assert.match(profileHtml, /\.profile-secondary-work-menu/);
        assert.match(profileHtml, /\.profile-secondary-tabs/);
        assert.match(profileHtml, /\.profile-work-hub-context/);
        assert.match(profileHtml, /\.profile-profession-switcher/);
        assert.match(profileHtml, /\.profile-profession-roster-panel/);
        assert.match(profileHtml, /\.profile-profession-card/);
    });

    it('makes profile top menu a real work hub for checklists and materials', () => {
        assert.match(profilePage, /case 'checklists': return renderProfileChecklistsTab\(\)/);
        assert.match(profilePage, /case 'materials': return renderProfileMaterialsTab\(\)/);
        assert.match(profilePage, /apiGet\(`\/training\/knowledge-base\?role=\$\{trainingRole\}`\)/);
        assert.match(profilePage, /apiGet\('\/training\/materials\?page=1&limit=30'\)/);
        assert.match(profilePage, /renderProfileChecklistItemsForProfession/);
        assert.match(profilePage, /profileMaterialMatchesProfession/);
        assert.match(profilePage, /function profileWorkTabMetric/);
        assert.match(profilePage, /Пункти активної професії та live-задачі/);
        assert.match(profilePage, /Навчання, інструкції і робочі нотатки/);
        assert.match(profileHtml, /\.profile-material-grid/);
        assert.match(profileHtml, /\.profile-secondary-work-menu/);
        assert.match(profilePage, /<nav class="profile-secondary-work-menu"/);
        assert.doesNotMatch(profilePage, /<details class="profile-secondary-work-menu"/);
        assert.doesNotMatch(profilePage, /<summary>Ще в профілі<\/summary>/);
        assert.match(profileHtml, /\.profile-secondary-tabs[\s\S]*flex-wrap:\s*wrap/);
        assert.match(profileHtml, /\.profile-material-card/);
    });

    it('adds HR professions and checklist surfaces plus safe edit controls', () => {
        assert.match(hrHtml, /id="tab-professions"/);
        assert.match(hrHtml, /id="tab-checklists"/);
        assert.match(hrPage, /id: 'professions', label: 'Професії'/);
        assert.match(hrPage, /id: 'checklists', label: 'Чеклисти'/);
        assert.match(hrHtml, /id="professionCatalogList"/);
        assert.match(hrHtml, /id="professionChecklistList"/);
        assert.match(hrHtml, /id="editSecondaryProfessions"/);
        assert.match(hrHtml, /\.hr-profession-master-row/);
        assert.match(hrHtml, /id="professionWorkspace"/);

        assert.match(hrPage, /async function loadProfessions/);
        assert.match(hrPage, /function renderProfessionChecklists/);
        assert.match(hrPage, /async function openProfessionWorkspace/);
        assert.match(hrPage, /function openProfessionEditor/);
        assert.match(hrPage, /history\.back\(\)/);
        assert.match(hrPage, /parseProfessionWorkspaceLocation/);
        assert.match(hrPage, /function populateStaffProfessionControls/);
        assert.match(hrPage, /secondary_professions: normalizeProfessionList\(readStaffSecondaryProfessionSelection/);

        assert.match(uiHelper, /closeOnBackdrop = true/);
        assert.match(uiHelper, /e\.target === overlay && closeOnBackdrop/);
    });

    it('builds one aggregated profession workspace for zero, one, and multiple staff', async () => {
        const db = {
            async query(sql) {
                if (/FROM hr_professions\s+ORDER BY/i.test(sql)) {
                    return { rows: [
                        { id: 1, key: 'empty_role', title: 'Без команди', checklist: [], is_active: true, sort_order: 1 },
                        { id: 2, key: 'host', title: 'Ведуча', checklist: ['Сценарій'], is_active: true, sort_order: 2, structure_node_id: 'art' },
                        { id: 3, key: 'animator', title: 'Аніматор', checklist: ['Реквізит', 'Програма'], is_active: true, sort_order: 3 },
                        { id: 4, key: 'archived_role', title: 'Архівна', checklist: [], is_active: false, sort_order: 4 }
                    ] };
                }
                if (/WITH profession_assignments AS/i.test(sql)) {
                    return { rows: [
                        { profession_key: 'host', staff_id: 10, staff_name: 'Олена', department: 'Арт', is_active: true, is_primary: true, explicit_hourly_rate: 180, fallback_hourly_rate: 140, rate_unit: 'hour', assignment_status: 'active', admission_status: 'approved', internship_status: 'none' },
                        { profession_key: 'animator', staff_id: 11, staff_name: 'Іван', department: 'Аніматори', is_active: true, is_primary: true, explicit_hourly_rate: null, fallback_hourly_rate: 160, rate_unit: 'hour', assignment_status: 'active', admission_status: 'approved', internship_status: 'none' },
                        { profession_key: 'animator', staff_id: 12, staff_name: 'Марія', department: 'Аніматори', is_active: false, is_primary: false, explicit_hourly_rate: null, fallback_hourly_rate: 120, rate_unit: 'hour', assignment_status: 'inactive', admission_status: 'pending', internship_status: 'completed' }
                    ] };
                }
                if (/FROM staff_shift_preferences/i.test(sql)) return { rows: [{ staff_id: 10, profession_key: 'host', day_type: 'weekday', start_time: '10:00', end_time: '18:00' }] };
                if (/FROM hr_staff_profession_checklist_progress/i.test(sql)) return { rows: [{ profession_key: 'animator', progress_records: 4, completed_records: 3, staff_with_progress: 2 }] };
                if (/FROM training_courses/i.test(sql)) return { rows: [{ profession_key: 'animator', course_count: 2, active_course_count: 1 }] };
                if (/FROM settings WHERE key = 'hr_company_structure'/i.test(sql)) return { rows: [{ value: { nodes: [{ id: 'art', title: 'Арт' }] } }] };
                throw new Error(`Unexpected profession workspace query: ${sql}`);
            }
        };

        const catalog = await loadProfessionWorkspaceCatalog(db);
        assert.equal(catalog.items.find(item => item.key === 'empty_role').staffCount, 0);
        assert.equal(catalog.items.find(item => item.key === 'host').staffCount, 1);
        assert.equal(catalog.items.find(item => item.key === 'host').people[0].shiftPreferences[0].startTime, '10:00');
        assert.equal(catalog.items.find(item => item.key === 'host').people[0].rateSource, 'staff_profession_rates.hourly_rate');
        assert.equal(catalog.items.find(item => item.key === 'animator').people[0].rateSource, 'staff.hourly_rate');
        assert.equal(catalog.items.find(item => item.key === 'animator').people[1].assignmentStatus, 'inactive');
        assert.equal(catalog.items.find(item => item.key === 'animator').staffCount, 2);
        assert.equal(catalog.items.find(item => item.key === 'archived_role').isActive, false);
        assert.equal(catalog.items.find(item => item.key === 'pizzaiolo').source, 'system');
        assert.equal(catalog.items.find(item => item.key === 'pizzaiolo').isReadonly, true);

        const workspace = await loadProfessionWorkspace(db, { key: 'animator' });
        assert.equal(workspace.people.length, 2);
        assert.deepEqual(workspace.trainingUsage, { courses: 2, activeCourses: 1 });
        assert.equal(await loadProfessionWorkspace(db, { key: 'missing' }), null);
    });

    it('keeps staff schedule grouping compatible with primary and secondary profession semantics', () => {
        assert.match(staffPage, /function staffProfessionKeys\(staff = \{\}\)/);
        assert.match(staffPage, /function scheduleSubGroupProfessionCandidates\(staff = \{\}, activeDepartment = ''\)/);
        assert.match(staffPage, /function resolveScheduleSubGroup\(staff = \{\}, departmentKey = '', context = \{\}\)/);
        assert.match(staffPage, /departmentSubGroupRoleKeys\(subGroup\)\.includes\(professionKey\)/);
        assert.match(staffPage, /function partitionScheduleStaffBySubGroup\(departmentKey = '', deptStaff = \[\], subGroups = null, context = \{\}\)/);
        assert.match(staffPage, /uniqueScheduleStaffById\(deptStaff \|\| \[\]\)/);
        assert.match(staffPage, /function staffScheduleDepartmentKeys\(staff = \{\}\)/);
        assert.match(staffPage, /function scheduleDepartmentCountMap\(staffList = StaffState\.staff\)/);
        assert.match(staffPage, /secondary_professions: String\(result\.secondary_professions/);
        assert.match(bookingService, /hss\.profession_key = 'animator'/);
        assert.match(bookingService, /hssr\.profession_key = 'animator'/);
        assert.match(bookingService, /availability_windows/);
        assert.doesNotMatch(bookingService, /secondary_professions/);
    });
});
