const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    staffProfessionKeys,
    staffHasProfession,
    normalizeProfessionKey,
    resolveStaffProfessionAssignment
} = require('../services/professions');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

describe('HR profession readiness, schedule gating, and profile history', () => {
    const migration = readRepoFile('db', 'migrations', '247_hr_profession_training_readiness.sql');
    const priorityMigration = readRepoFile('db', 'migrations', '248_hr_team_search_rates_structure.sql');
    const hrRoute = readRepoFile('routes', 'hr.js');
    const staffRoute = readRepoFile('routes', 'staff.js');
    const hrPage = readRepoFile('js', 'hr-page.js');
    const hrHtml = readRepoFile('hr.html');
    const staffPage = readRepoFile('js', 'staff-page.js');
    const staffHtml = readRepoFile('staff.html');

    it('normalizes staff profession assignments for primary and secondary roles', () => {
        const staff = {
            role_type: 'Animator',
            secondary_professions: ['host', 'host', ' bartender ', '']
        };
        assert.deepEqual(staffProfessionKeys(staff), ['animator', 'host', 'bartender']);
        assert.equal(staffHasProfession(staff, 'host'), true);
        assert.equal(staffHasProfession(staff, 'cook'), false);
        assert.equal(normalizeProfessionKey(' Bar Tender '), 'bar_tender');
    });

    it('gates schedule profession assignment against primary and secondary professions', async () => {
        const mockStaff = {
            id: 7,
            name: 'Тест Співробітник',
            role_type: 'animator',
            secondary_professions: ['host', 'barista'],
            is_active: true
        };
        const db = {
            async query() {
                return { rows: [mockStaff] };
            }
        };

        const host = await resolveStaffProfessionAssignment(db, 7, 'host');
        assert.equal(host.ok, true);
        assert.equal(host.professionKey, 'host');

        const missing = await resolveStaffProfessionAssignment(db, 7, 'cook');
        assert.equal(missing.ok, false);
        assert.equal(missing.status, 400);
        assert.match(missing.error, /немає в основних або додаткових професіях/);

        const inactive = await resolveStaffProfessionAssignment({
            async query() {
                return { rows: [{ ...mockStaff, is_active: false }] };
            }
        }, 7, 'animator');
        assert.equal(inactive.ok, false);
        assert.equal(inactive.error, 'Співробітник неактивний');
    });

    it('adds additive database links for training readiness and schedule profession keys', () => {
        assert.match(migration, /MIGRATION_KIND:\s*mixed/);
        assert.match(migration, /ALTER TABLE staff_schedule[\s\S]*ADD COLUMN IF NOT EXISTS profession_key VARCHAR\(64\)/);
        assert.match(migration, /ALTER TABLE hr_shifts[\s\S]*ADD COLUMN IF NOT EXISTS profession_key VARCHAR\(64\)/);
        assert.match(migration, /ALTER TABLE training_courses[\s\S]*ADD COLUMN IF NOT EXISTS profession_key VARCHAR\(64\)/);
        assert.match(migration, /CREATE TABLE IF NOT EXISTS hr_staff_profession_checklist_progress/);
        assert.match(migration, /UNIQUE\(staff_id, profession_key, checklist_key\)/);
        assert.match(migration, /source = 'hr_profession_seed'/);
        assert.match(migration, /jsonb_build_array\(/);
        assert.match(migration, /Підтвердити готовність до самостійної зміни/);
        assert.match(migration, /jsonb_array_elements_text\(\s*CASE/);
    });

    it('exposes HR APIs for readiness, checklist progress, schedule gating, and audit history', () => {
        assert.match(hrRoute, /const HR_VIEW_ROLES = \[[^\]]*'security'/);
        assert.match(hrRoute, /const HR_MANAGE_ROLES = \[[^\]]*'hr'[^\]]*'admin'[^\]]*\]/);
        assert.doesNotMatch(hrRoute, /const HR_MANAGE_ROLES = \[[^\]]*'security'/);
        assert.match(hrRoute, /const requireHrManage = requireAction\('manage_staff'\)/);
        assert.doesNotMatch(hrRoute, /router\.(post|put|delete|patch)\('[^']+', async \(req, res\)/);
        assert.match(hrRoute, /async function attachTrainingReadiness/);
        assert.match(hrRoute, /row\.training_readiness =/);
        assert.match(hrRoute, /SELECT c\.id, c\.profession_key, c\.target_roles, c\.title, c\.source/);
        assert.match(hrRoute, /\.filter\(course => !\(course\.source === 'hr_profession_seed' && checklistItems\.length\)\)/);
        assert.match(hrRoute, /router\.get\('\/staff\/:id\/history'/);
        assert.match(hrRoute, /router\.put\('\/staff\/:id\/profession-checklist'/);
        assert.match(hrRoute, /if \(payload\.key !== currentKey\)/);
        assert.match(hrRoute, /Key професії не можна змінювати після створення/);
        assert.match(hrRoute, /buildStaffProfileChanges/);
        assert.match(hrRoute, /resolveHrShiftProfession/);
        assert.match(hrRoute, /profession_key = COALESCE\(\$6, profession_key\)/);
        assert.match(hrRoute, /profession_key = EXCLUDED\.profession_key/);
        assert.match(hrRoute, /router\.post\('\/shifts', requireHrManage/);
        assert.match(hrRoute, /router\.put\('\/shifts\/:id', requireHrManage/);
        assert.match(hrRoute, /router\.delete\('\/shifts\/:id', requireHrManage/);
        assert.match(hrRoute, /SELECT \* FROM hr_shifts WHERE id = \$1 FOR UPDATE/);
        assert.match(hrRoute, /resolveHrShiftProfession\(staff_id, req\.body, client\)/);
        assert.match(hrRoute, /mirrorHrShiftToStaffSchedule\(result\.rows\[0\], client\)/);
        assert.match(hrRoute, /removeMirroredStaffSchedule\(existing\.rows\[0\]\.staff_id, existing\.rows\[0\]\.shift_date, client\)/);
        assert.match(hrRoute, /resolveHrShiftProfession\(sid, req\.body, client\)/);
        assert.match(hrRoute, /mirrorHrShiftToStaffSchedule\(result\.rows\[0\], client\)/);
        assert.match(hrRoute, /resolveHrShiftProfession\(row\.staff_id, \{ profession_key: row\.profession_key \}, client\)/);

        assert.match(staffRoute, /function scheduleStatusNeedsProfession/);
        assert.match(staffRoute, /resolveScheduleProfession/);
        assert.match(staffRoute, /resolveScheduleProfession\(e\.staffId, entryStatus, e, client\)/);
        assert.match(staffRoute, /resolveScheduleProfession\(row\.staff_id, row\.status, \{ profession_key: row\.profession_key \}, client\)/);
        assert.match(staffRoute, /INSERT INTO staff_schedule \(staff_id, date, shift_start, shift_end, status, note, profession_key\)/);
        assert.match(staffRoute, /COALESCE\(s\.secondary_professions, '\[\]'::jsonb\) AS secondary_professions/);
    });

    it('renders profession-aware controls and training/history UI in HR and staff pages', () => {
        assert.match(hrHtml, /id="shiftProfession"/);
        assert.match(hrHtml, /id="editStaffHistory"/);
        assert.match(hrHtml, /hr-team-training-readiness/);
        assert.match(hrPage, /function renderStaffTrainingReadiness/);
        assert.match(hrPage, /openStaffTrainingReadiness/);
        assert.match(hrPage, /toggleStaffProfessionChecklist/);
        assert.match(hrPage, /function loadStaffProfileHistory/);
        assert.match(hrPage, /function professionOptionsFromCatalog/);
        assert.doesNotMatch(hrPage, /Object\.entries\(ROLE_LABELS\)\.forEach\(\(\[value, label\]\)/);
        assert.match(hrPage, /key: current\?\.key \|\| result\.key/);
        assert.match(hrPage, /staffProfessionOptions\(staff \|\| \{\}, selectedProfession\)/);
        assert.match(hrPage, /staffHasProfession\(s, requiredProfession\)/);

        assert.match(staffHtml, /id="schProfession"/);
        assert.match(staffHtml, /sch-profession/);
        assert.match(staffPage, /async function fetchHrProfessions/);
        assert.match(staffPage, /StaffState\.professions/);
        assert.match(staffPage, /function professionCatalogOptions/);
        assert.match(staffPage, /await fetchHrProfessions\(\)/);
        assert.match(staffPage, /function staffProfessionOptions/);
        assert.match(staffPage, /professionKey: showTime \? normalizeProfessionKey\(emp\.role_type\) : null/);
        assert.match(staffPage, /saveScheduleEntry\(staffId, date, shiftStart, shiftEnd, status, note, professionKey\)/);
    });

    it('links HR team search, profession rates, structure nodes, and drag-drop moves', () => {
        assert.match(priorityMigration, /MIGRATION_KIND:\s*mixed/);
        assert.match(priorityMigration, /ADD COLUMN IF NOT EXISTS company_structure_node_id VARCHAR\(64\)/);
        assert.match(priorityMigration, /ADD COLUMN IF NOT EXISTS structure_node_id VARCHAR\(64\)/);
        assert.match(priorityMigration, /CREATE TABLE IF NOT EXISTS staff_profession_rates/);
        assert.match(priorityMigration, /UNIQUE\(staff_id, profession_key\)/);

        assert.match(hrRoute, /attachStaffProfessionRates/);
        assert.match(hrRoute, /replaceStaffProfessionRates/);
        assert.match(hrRoute, /rateForStaffProfession/);
        assert.match(hrRoute, /company_structure_node_id/);
        assert.match(hrRoute, /profession_rates/);
        assert.match(hrRoute, /await client\.query\('BEGIN'\)/);
        assert.match(hrRoute, /replaceStaffProfessionRates\(client, req\.params\.id, normalizedProfessionRates\)/);
        assert.match(hrRoute, /await client\.query\('COMMIT'\)/);
        assert.match(hrRoute, /router\.put\('\/company-structure', requireHrManage/);
        assert.match(hrRoute, /source\.baseUpdatedAt \|\| source\.expectedUpdatedAt/);
        assert.match(hrRoute, /Структуру вже оновили в іншій вкладці/);
        assert.match(hrRoute, /SET company_structure_node_id = NULL/);
        assert.match(hrRoute, /SET structure_node_id = NULL, updated_at = NOW\(\)/);
        assert.match(hrRoute, /COALESCE\(hs\.profession_key, s\.role_type\) AS profession_key/);
        assert.match(hrRoute, /SUM\(tr\.overtime_minutes\) AS overtime_minutes/);

        assert.match(hrPage, /function teamSearchHaystack/);
        assert.match(hrPage, /function renderStaffReadinessBadges/);
        assert.match(hrPage, /function renderStaffProfessionRatesEditor/);
        assert.match(hrPage, /currentInputValues\.has\(key\)/);
        assert.match(hrPage, /function readStaffProfessionRates/);
        assert.match(hrPage, /function initTeamDragAndDrop/);
        assert.match(hrPage, /moveStaffToBucket/);
        assert.match(hrPage, /staffHasProfession\(staff \|\| \{\}, selectedProfession\)/);
        assert.match(hrPage, /function renderSalaryRateSummary/);
        assert.match(hrPage, /structureNodeId: result\.structureNodeId \|\| null/);
        assert.match(hrPage, /let companyStructureUpdatedAt = null/);
        assert.match(hrPage, /baseUpdatedAt: companyStructureUpdatedAt/);

        assert.match(hrHtml, /id="teamSearch"/);
        assert.match(hrHtml, /id="teamRoleFilter" class="hr-team-select" hidden aria-hidden="true"/);
        assert.match(hrHtml, /id="editProfessionRates"/);
        assert.match(hrHtml, /id="editCompanyStructureNode"/);
        assert.match(hrHtml, /hr-ready-badge/);
        assert.match(hrHtml, /hr-profession-rate-editor/);
    });
});
