const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

describe('backoffice foundation v1 contracts', () => {
    const migration = readRepoFile('db', 'migrations', '177_backoffice_foundation_v1.sql');
    const hrRoute = readRepoFile('routes', 'hr.js');
    const staffRoute = readRepoFile('routes', 'staff.js');
    const shiftSegmentsService = readRepoFile('services', 'hrShiftSegments.js');
    const staffScheduleMutations = readRepoFile('services', 'staffScheduleMutations.js');
    const hrPage = readRepoFile('js', 'hr-page.js');
    const hrHtml = readRepoFile('hr.html');
    const staffPage = readRepoFile('js', 'staff-page.js');
    const staffHtml = readRepoFile('staff.html');
    const staffScheduleShell = readRepoFile('js', 'staff-schedule-shell.js');
    const sidebar = readRepoFile('js', 'components', 'sidebar.js');

    it('keeps schema changes additive and explicitly governed', () => {
        assert.match(migration, /MIGRATION_KIND:\s*schema/);
        assert.match(migration, /SAFETY:/);
        assert.match(migration, /ROLLBACK:/);
        assert.match(migration, /ALTER TABLE staff[\s\S]*ADD COLUMN IF NOT EXISTS address TEXT/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS hr_pool_status VARCHAR\(20\) DEFAULT 'core'/);
        assert.match(migration, /staff_hr_pool_status_check/);
        assert.match(migration, /ALTER TABLE hr_shifts[\s\S]*ADD COLUMN IF NOT EXISTS original_staff_id/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS replacement_reason TEXT/);
        assert.match(migration, /ALTER TABLE job_applications[\s\S]*ADD COLUMN IF NOT EXISTS raw_application_text TEXT/);
        assert.match(migration, /ADD COLUMN IF NOT EXISTS parsed_payload JSONB/);
        assert.doesNotMatch(migration, /CREATE TABLE\s+(IF NOT EXISTS\s+)?warehouses\b/i);
        assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE/i);
    });

    it('mirrors HR shifts into the legacy schedule surface and supports explicit replacement', () => {
        assert.match(hrRoute, /function mirrorHrShiftToStaffSchedule/);
        assert.match(hrRoute, /INSERT INTO staff_schedule/);
        assert.match(hrRoute, /ON CONFLICT \(staff_id, date\)/);
        assert.match(hrRoute, /function removeMirroredStaffSchedule/);
        assert.doesNotMatch(hrRoute, /function backfillHrShiftsFromStaffSchedule/);
        assert.doesNotMatch(hrRoute, /await backfillHrShiftsFromStaffSchedule\(dateFrom, dateTo\)/);
        assert.match(hrRoute, /router\.post\('\/shifts\/:id\/replace'/);
        assert.match(hrRoute, /replacement_staff_id/);
        assert.match(hrRoute, /original_staff_id = COALESCE\(original_staff_id, staff_id\)/);
        assert.match(hrPage, /async function replaceShift/);
        assert.match(hrPage, /document\.getElementById\('shiftReplace'\)\?\.addEventListener\('click', replaceShift\)/);
        assert.match(hrHtml, /id="shiftReplace"/);
        assert.match(staffRoute, /router\.post\('\/schedule\/:id\/replace'/);
        assert.match(staffRoute, /router\.post\('\/schedule\/:id\/replacement-clear'/);
        assert.match(staffRoute, /original_staff\.name AS original_staff_name/);
        assert.match(staffRoute, /function replacementNote/);
        assert.match(staffScheduleMutations, /async function loadEnrichedScheduleEntry/);
        assert.match(staffScheduleMutations, /function syncHrShiftFromScheduleEntry/);
        assert.match(staffScheduleMutations, /saveHrShiftDayPlan\(client/);
        assert.doesNotMatch(staffRoute, /INSERT INTO hr_shifts/);
        assert.match(shiftSegmentsService, /INSERT INTO hr_shifts/);
        assert.match(shiftSegmentsService, /ON CONFLICT \(staff_id, shift_date\) DO UPDATE/);
        assert.doesNotMatch(staffRoute, /function backfillStaffScheduleFromHrShifts/);
        assert.doesNotMatch(staffRoute, /router\.get\('\/schedule'[\s\S]*await backfillStaffScheduleFromHrShifts\(from, to\)/);
        assert.match(staffRoute, /hs\.shift_date::text = LEFT\(ss\.date::text, 10\)/);
        assert.match(staffRoute, /router\.get\('\/schedule\/history\/:staffId\/:date'/);
        assert.match(staffScheduleMutations, /function recordScheduleAudit/);
        assert.match(staffRoute, /staff_schedule_update/);
        assert.match(staffPage, /async function replaceScheduleEntry/);
        assert.match(staffPage, /async function clearScheduleReplacement/);
        assert.match(staffPage, /function scheduleReplacementCandidates/);
        assert.match(staffPage, /sch-replacement-badge/);
        assert.match(staffScheduleShell, /id="schReplaceBtn"/);
        assert.match(staffScheduleShell, /id="schClearReplacementBtn"/);
        assert.match(staffScheduleShell, /id="schReplacementDetails"/);
    });

    it('adds HR-owned structure, reserve, blacklist, and task KPI without a new task engine', () => {
        assert.match(hrRoute, /router\.get\('\/company-structure'/);
        assert.match(hrRoute, /router\.put\('\/company-structure'/);
        assert.match(hrRoute, /hr_company_structure/);
        assert.match(hrRoute, /router\.get\('\/pool'/);
        assert.match(hrRoute, /router\.put\('\/staff\/:id\/pool-status'/);
        assert.match(hrRoute, /FROM tasks t[\s\S]*JOIN employee_profiles ep ON ep\.user_id = t\.owner_user_id/);
        assert.match(hrRoute, /task_kpi/);
        assert.doesNotMatch(hrRoute, /new TaskEngine|TaskEngineV2|taskAnalyticsV2/);
    });

    it('wires HR navigation and profile deep-links to existing HR page semantics', () => {
        assert.match(sidebar, /href: '\/hr'[\s\S]*label: 'Пульс компанії'[\s\S]*access: 'hr_page'/);
        assert.match(sidebar, /activeHashes: \['today', 'schedule', 'reports'\]/);
        assert.match(sidebar, /href: '\/hr#team',\s+icon: '👥', label: 'Команда'/);
        assert.match(sidebar, /activeHashes: \['team', 'workers', 'interns', 'reserve', 'blacklist', 'dismissed'\]/);
        assert.match(sidebar, /href: '\/hr#payroll'[\s\S]*label: 'ЗП та KPI'[\s\S]*activeHashes: \['payroll', 'salary', 'zrs', 'kpi'\]/);
        assert.doesNotMatch(sidebar, /href: '\/hr#workers'/);
        assert.doesNotMatch(sidebar, /href: '\/hr#interns'/);
        assert.doesNotMatch(sidebar, /href: '\/hr#reserve'/);
        assert.doesNotMatch(sidebar, /href: '\/hr#blacklist'/);
        assert.doesNotMatch(sidebar, /href: '\/hr#dismissed'/);
        assert.match(sidebar, /HR_TEAM_BUCKET_VISIBILITY[\s\S]*admin: \['workers', 'interns', 'dismissed'\]/);
        assert.match(sidebar, /href: '\/hr#other'[\s\S]*label: 'Вакансії'[\s\S]*activeHashes: \['other', 'vacancies'\]/);
        assert.match(sidebar, /href: '\/training'[\s\S]*label: 'Навчання'[\s\S]*activeHashes: \['materials', 'tests', 'progress', 'leaderboard', 'onboarding'\]/);
        assert.doesNotMatch(sidebar, /href: '\/hr#other'[\s\S]*costumes/);
        assert.match(hrPage, /window\.location\.replace\('\/warehouse#costumes'\)/);
        assert.doesNotMatch(sidebar, /href: '\/hr#team'[\s\S]*label: 'HR'[\s\S]*navLegacy: true/);
        assert.doesNotMatch(sidebar, /staffView: 'team'/);
        assert.match(hrPage, /function getInitialHrTab/);
        assert.match(hrPage, /id: 'pulse'[\s\S]*label: 'Пульс компанії'/);
        assert.match(hrPage, /const HR_TAB_ALIASES[\s\S]*reserve: \{ tab: 'team', bucket: 'reserve' \}/);
        assert.match(hrPage, /other: \{ tab: 'vacancies' \}/);
        assert.match(hrPage, /window\.location\.replace\('\/training#onboarding'\)/);
        assert.match(hrPage, /payroll: \{ tab: 'salary' \}/);
        assert.match(hrPage, /new URLSearchParams\(window\.location\.search\)\.get\('employee'\)/);
        assert.match(hrPage, /activateHrTab\('team'/);
        assert.match(hrHtml, /id="tab-structure"/);
        assert.match(hrPage, /id: 'reserve'/);
        assert.match(hrPage, /id: 'blacklist'/);
        assert.match(hrPage, /id: 'dismissed'/);
    });

    it('keeps employee and candidate profile data durable in existing routes and forms', () => {
        assert.match(staffRoute, /const \{[\s\S]*role_type[\s\S]*address[\s\S]*\} = req\.body/);
        assert.match(staffRoute, /INSERT INTO staff[\s\S]*role_type[\s\S]*address/);
        assert.match(staffRoute, /UPDATE staff SET[\s\S]*role_type\s*=\s*COALESCE\(\$\d+,role_type\)[\s\S]*address\s*=\s*COALESCE\(\$\d+,address\)/);
        assert.match(hrPage, /id="editAddress"|editAddress/);
        assert.match(hrPage, /editStaffName/);
        assert.match(hrPage, /setPoolStatus/);
        assert.doesNotMatch(hrHtml, /id="editPoolStatus"/);
        assert.match(hrPage, /raw_application_text/);
        assert.match(hrHtml, /id="editAddress"/);
        assert.match(hrHtml, /id="editStaffName"/);
    });
});
