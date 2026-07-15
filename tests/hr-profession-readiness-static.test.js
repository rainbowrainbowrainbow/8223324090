const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    staffProfessionKeys,
    staffHasProfession,
    normalizeProfessionKey,
    isHiddenProfessionKey,
    resolveStaffProfessionAssignment,
    curateProfessionCatalogRows,
    professionCatalogActiveKeySet
} = require('../services/professions');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

describe('HR profession readiness, schedule gating, and profile history', () => {
    const migration = readRepoFile('db', 'migrations', '247_hr_profession_training_readiness.sql');
    const priorityMigration = readRepoFile('db', 'migrations', '248_hr_team_search_rates_structure.sql');
    const checklistMigration = readRepoFile('db', 'migrations', '294_hr_profession_checklist_templates.sql');
    const checklistService = readRepoFile('services', 'professionChecklists.js');
    const hrRoute = readRepoFile('routes', 'hr.js');
    const hrOnboardingService = readRepoFile('services', 'hrOnboarding.js');
    const staffRoute = readRepoFile('routes', 'staff.js');
    const shiftSegmentsService = readRepoFile('services', 'hrShiftSegments.js');
    const staffScheduleMutations = readRepoFile('services', 'staffScheduleMutations.js');
    const hrPage = readRepoFile('js', 'hr-page.js');
    const hrHtml = `${readRepoFile('hr.html')}\n${readRepoFile('css', 'hr-page.css')}`;
    const trainingPage = readRepoFile('js', 'training-page.js');
    const trainingSurface = `${readRepoFile('training.html')}\n${readRepoFile('css', 'training.css')}`;
    const staffPage = readRepoFile('js', 'staff-page.js');
    const staffHtml = readRepoFile('staff.html');
    const staffScheduleShell = readRepoFile('js', 'staff-schedule-shell.js');
    const staffSurface = `${staffHtml}\n${staffScheduleShell}\n${readRepoFile('css', 'pages-hr-staff.css')}`;
    const authCode = readRepoFile('js', 'auth.js');
    const sidebarCode = readRepoFile('js', 'components', 'sidebar.js');
    const profileCode = readRepoFile('js', 'profile-page.js');
    const uiCode = readRepoFile('js', 'ui.js');
    const professionWorkspaceSaveStart = hrPage.indexOf('async function saveProfessionWorkspace');
    const professionWorkspaceSaveEnd = hrPage.indexOf('\nasync function toggleProfessionWorkspaceArchived', professionWorkspaceSaveStart);
    const professionWorkspaceSaveBlock = hrPage.slice(professionWorkspaceSaveStart, professionWorkspaceSaveEnd);
    const professionWorkspaceBodyStart = professionWorkspaceSaveBlock.indexOf('const body = {');
    const professionWorkspaceBodyEnd = professionWorkspaceSaveBlock.indexOf('\n    };', professionWorkspaceBodyStart);
    const professionWorkspaceBodyBlock = professionWorkspaceSaveBlock.slice(professionWorkspaceBodyStart, professionWorkspaceBodyEnd);

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

    it('curates public profession catalog without legacy duplicates', () => {
        const catalog = curateProfessionCatalogRows([
            { id: 1, key: 'bartender', title: 'Бармен', department: 'Кафе', sort_order: 1, is_active: true },
            { id: 2, key: 'hr_manager', title: 'HR-менеджер', department: 'Керівництво', sort_order: 2, is_active: true },
            { id: 3, key: 'instructor', title: 'Інструктор', department: 'Батути', sort_order: 3, is_active: true },
            { id: 4, key: 'senior_instructor', title: 'Старший інструктор', department: 'Батути', sort_order: 4, is_active: true },
            { id: 5, key: 'cleaning', title: 'Клінінг', department: 'Чистота', sort_order: 5, is_active: true },
            { id: 6, key: 'cleaner', title: 'Прибиральник', department: 'Чистота', sort_order: 6, is_active: true },
            { id: 7, key: 'technician', title: 'Технік', department: 'Техніка', sort_order: 7, is_active: true },
            { id: 8, key: 'maintenance', title: 'Технік', department: 'Техніка', sort_order: 8, is_active: true },
            { id: 9, key: 'head_cook', title: 'Шеф-кухар', department: 'Кухня', sort_order: 9, is_active: true }
        ]);
        const byKey = new Map(catalog.map(row => [row.key, row]));

        assert.equal(byKey.has('bartender'), false);
        assert.equal(byKey.has('hr_manager'), false);
        assert.equal(byKey.has('instructor'), false);
        assert.equal(byKey.has('cleaning'), false);
        assert.equal(byKey.has('technician'), false);
        assert.equal(byKey.has('head_cook'), false);
        ['bartender', 'hr_manager', 'instructor', 'head_cook', 'head_chef', 'cleaning', 'technician']
            .forEach(key => assert.equal(isHiddenProfessionKey(key), true));
        assert.equal(isHiddenProfessionKey('pizzaiolo'), false);
        assert.equal(byKey.get('senior_instructor')?.title, 'Адміністратор ігрових зон');
        assert.equal(byKey.get('maintenance')?.title, 'Технічний директор');
        assert.equal(byKey.get('cleaner')?.title, 'Прибиральник');
        assert.equal(byKey.get('pizzaiolo')?.title, 'Піцайоло');
        assert.equal(byKey.get('pizzaiolo')?.is_virtual, true);

        const activeKeys = professionCatalogActiveKeySet(catalog);
        assert.equal(activeKeys.has('pizzaiolo'), true);
        assert.equal(activeKeys.has('bartender'), false);
    });

    it('keeps adjacent UI role labels on canonical profession names', () => {
        const roleNames = authCode.match(/const ROLE_NAMES = \{[\s\S]*?\n\};/)?.[0] || '';
        const sidebarLabels = sidebarCode.match(/const labels = \{[\s\S]*?\n\s*\};/)?.[0] || '';
        const profileLabels = profileCode.match(/function profileRoleLabel\(role\) \{[\s\S]*?const labels = \{[\s\S]*?\n\s*\};/)?.[0] || '';
        const pointsRoles = uiCode.match(/const POINTS_ROLE_HIERARCHY = \[[\s\S]*?\n\];/)?.[0] || '';
        const releaseLabelBlocks = `${roleNames}\n${sidebarLabels}\n${profileLabels}\n${pointsRoles}`;

        assert.match(roleNames, /senior_instructor:\s*'Адміністратор ігрових зон'/);
        assert.match(roleNames, /instructor:\s*'Інструктор батутів'/);
        assert.match(roleNames, /trampoline_instructor:\s*'Інструктор батутів'/);
        assert.match(roleNames, /maintenance:\s*'Технічний директор'/);
        assert.match(roleNames, /technician:\s*'Технічний директор'/);
        assert.match(roleNames, /cleaning:\s*'Прибиральник'/);
        assert.match(roleNames, /cleaner:\s*'Прибиральник'/);
        assert.match(roleNames, /bartender:\s*'Бариста'/);
        assert.match(roleNames, /head_chef:\s*'Кухар'/);
        assert.match(roleNames, /head_cook:\s*'Кухар'/);

        assert.match(sidebarLabels, /senior_instructor:\s*'Адміністратор ігрових зон'/);
        assert.match(sidebarLabels, /instructor:\s*'Інструктор батутів'/);
        assert.match(sidebarLabels, /bartender:\s*'Бариста'/);
        assert.match(sidebarLabels, /head_cook:\s*'Кухар'/);
        assert.match(sidebarLabels, /maintenance:\s*'Технічний директор'/);
        assert.match(sidebarLabels, /cleaning:\s*'Прибиральник'/);

        assert.match(profileLabels, /senior_instructor:\s*'Адміністратор ігрових зон'/);
        assert.match(profileLabels, /instructor:\s*'Інструктор батутів'/);
        assert.match(profileLabels, /technician:\s*'Технічний директор'/);
        assert.match(profileLabels, /cleaner:\s*'Прибиральник'/);
        assert.match(profileLabels, /head_chef:\s*'Кухар'/);

        assert.match(pointsRoles, /key:\s*'senior_instructor',\s*name:\s*'Адміністратор ігрових зон'/);
        assert.match(pointsRoles, /key:\s*'instructor',\s*name:\s*'Інструктор батутів'/);

        assert.doesNotMatch(releaseLabelBlocks, /Старший інструктор|Ст\. інструктор|Клінінг|Технік|Бармен|Шеф-кухар|HR-менеджер|HR менеджер/);
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

    it('normalizes profession checklist templates around immutable item keys without discarding legacy progress', () => {
        assert.match(checklistMigration, /MIGRATION_KIND:\s*mixed/);
        assert.match(checklistMigration, /CREATE TABLE IF NOT EXISTS hr_profession_checklist_items/);
        assert.match(checklistMigration, /item_key VARCHAR\(128\) NOT NULL/);
        assert.match(checklistMigration, /WITH ORDINALITY AS item\(value, ordinality\)/);
        assert.match(checklistMigration, /ADD COLUMN IF NOT EXISTS checklist_item_id BIGINT/);
        assert.match(checklistMigration, /ADD COLUMN IF NOT EXISTS legacy_checklist_key VARCHAR\(128\)/);
        assert.match(checklistMigration, /CREATE TABLE IF NOT EXISTS hr_profession_checklist_migration_issues/);
        assert.match(checklistMigration, /candidate_item_keys JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
        assert.match(checklistMigration, /WHERE progress\.checklist_item_id IS NULL[\s\S]*progress\.checklist_key ~ '\^item_\[1-9\]\[0-9\]\*\$'/);
        assert.match(checklistMigration, /ALTER TABLE training_course_lectures[\s\S]*ADD COLUMN IF NOT EXISTS checklist_item_id BIGINT/);

        assert.match(checklistService, /function generateChecklistItemKey/);
        assert.match(checklistService, /function syncProfessionChecklistCompatibilityMirror/);
        assert.match(checklistService, /ON CONFLICT \(staff_id, checklist_item_id\)[\s\S]*WHERE checklist_item_id IS NOT NULL/);
        assert.match(checklistService, /function loadProfessionChecklistDashboard/);
        assert.doesNotMatch(checklistService, /checklistKeyForIndex/);
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
        assert.match(hrRoute, /router\.get\('\/checklists\/dashboard'/);
        assert.match(hrRoute, /router\.get\('\/professions\/:professionKey\/checklist'/);
        assert.match(hrRoute, /router\.post\('\/professions\/:professionKey\/checklist\/items', requireHrManage/);
        assert.match(hrRoute, /router\.put\('\/professions\/:professionKey\/checklist\/reorder', requireHrManage/);
        assert.match(hrRoute, /router\.put\('\/professions\/:professionKey\/checklist\/items\/:itemKey', requireHrManage/);
        assert.match(hrRoute, /router\.put\('\/professions\/:professionKey\/checklist\/items\/:itemKey\/archive', requireHrManage/);
        assert.match(hrRoute, /'\/professions\/:professionKey\/staff\/:staffId\/checklist\/:itemKey'[\s\S]*requireHrManage[\s\S]*handleStaffProfessionChecklistToggle/);
        assert.match(hrRoute, /syncProfessionOnboardingProgressForProfession/);
        assert.match(hrRoute, /onboarding_sync: onboardingSync\.audit/);
        assert.match(hrRoute, /function loadStaffLifecycleChecklist/);
        assert.match(hrRoute, /router\.get\('\/staff\/:id\/lifecycle-checklist', requireHrManage/);
        assert.match(hrRoute, /candidate_approved/);
        assert.match(hrRoute, /hiring_application: hiringApplication/);
        assert.match(hrRoute, /FROM job_applications a[\s\S]*a\.staff_id = \$1/);
        assert.match(hrRoute, /future_schedule_count/);
        assert.match(hrRoute, /open_payroll_count/);
        assert.match(hrRoute, /if \(payload\.key !== currentKey\)/);
        assert.match(hrRoute, /Key професії не можна змінювати після створення/);
        assert.match(hrRoute, /isHiddenProfessionKey\(payload\.key\)/);
        assert.match(hrRoute, /прихована як дубль/);
        assert.match(hrRoute, /buildStaffProfileChanges/);
        assert.match(hrRoute, /require\('\.\.\/services\/hrShiftSegments'\)/);
        assert.match(hrRoute, /saveHrShiftDayPlan\(client/);
        assert.match(hrRoute, /loadHrShiftDayPlan\(client/);
        assert.match(hrRoute, /validateHrShiftDayPlanProfessions\(client, replacementStaffId, loaded\.plan\)/);
        assert.doesNotMatch(hrRoute, /resolveHrShiftProfession/);
        assert.match(hrRoute, /router\.post\('\/shifts', requireHrManage/);
        assert.match(hrRoute, /router\.put\('\/shifts\/:id', requireHrManage/);
        assert.match(hrRoute, /router\.delete\('\/shifts\/:id', requireHrManage/);
        assert.match(shiftSegmentsService, /SELECT \* FROM hr_shifts WHERE id = \$1 FOR UPDATE/);
        assert.match(shiftSegmentsService, /resolveStaffProfessionAssignments\(client, staffId/);
        assert.match(hrRoute, /mirrorHrShiftToStaffSchedule\(saved\.shift, client, \{[^]*?staffValidation: shiftValidation/);
        assert.match(hrRoute, /mirrorHrDayPlanToStaffSchedule\([\s\S]*?currentShift\.staff_id,[\s\S]*?currentShift\.shift_date/);
        assert.match(hrRoute, /dayPlanPayload\(loaded\.plan/);

        assert.match(staffScheduleMutations, /function scheduleStatusNeedsProfession/);
        assert.match(staffRoute, /require\('\.\.\/services\/hrShiftSegments'\)/);
        assert.match(staffScheduleMutations, /saveHrShiftDayPlan\(client/);
        assert.match(staffRoute, /validateHrShiftDayPlanProfessions\(client, replacementStaffId, sourcePlan\.plan\)/);
        assert.doesNotMatch(staffRoute, /resolveScheduleProfession/);
        assert.match(staffRoute, /INSERT INTO staff_schedule \(staff_id, date, shift_start, shift_end, status, note, profession_key\)/);
        assert.match(staffRoute, /COALESCE\(s\.secondary_professions, '\[\]'::jsonb\) AS secondary_professions/);
    });

    it('renders profession-aware controls and training/history UI in HR and staff pages', () => {
        assert.match(hrHtml, /id="shiftProfession"/);
        assert.match(hrHtml, /id="editStaffHistory"/);
        assert.match(hrHtml, /id="editStaffLifecycleChecklist"/);
        assert.match(hrHtml, /hr-team-training-compact/);
        assert.match(hrPage, /function renderTeamTrainingCompact/);
        assert.match(hrPage, /function renderStaffLifecycleChecklist/);
        assert.match(hrPage, /function loadStaffLifecycleChecklist/);
        assert.match(hrPage, /hrFetch\(`\/staff\/\$\{id\}\/lifecycle-checklist`\)/);
        assert.match(hrPage, /openStaffTrainingReadiness/);
        assert.match(hrPage, /toggleStaffProfessionChecklist/);
        assert.match(hrPage, /function loadStaffProfileHistory/);
        assert.match(hrPage, /function professionOptionsFromCatalog/);
        assert.doesNotMatch(hrPage, /Object\.entries\(ROLE_LABELS\)\.forEach\(\(\[value, label\]\)/);
        assert.match(hrPage, /async function openProfessionWorkspace/);
        assert.match(hrPage, /function syncProfessionCatalogCapabilityUi/);
        assert.match(hrPage, /button\.hidden = !editable/);
        assert.match(hrPage, /function professionConditionTimePayload/);
        assert.match(hrPage, /source === 'system_fallback' && !touched/);
        assert.match(hrPage, /function syncSavedProfessionConditionCaches\(condition\)[\s\S]*currentWorkspaceKey === professionKey/);
        assert.match(hrPage, /async function refreshProfessionChecklistTemplate\(professionKey = professionWorkspaceState\.data\?\.profession\?\.key\)/);
        assert.match(hrPage, /function updateProfessionChecklistCaches\(template, expectedProfessionKey = ''\)/);
        assert.match(hrPage, /const isCurrentWorkspace = \(\) => professionWorkspaceState\.open[\s\S]*=== professionKey/);
        assert.match(hrPage, /key: isNew \? document\.getElementById\('professionWorkspaceKey'\)/);
        assert.match(hrPage, /profession\.source === 'system'/);
        assert.match(hrPage, /System profession · readonly/);
        assert.match(hrPage, /history\.back\(\)/);
        assert.match(hrPage, /function professionChecklistDashboardQuery/);
        assert.match(hrPage, /hrFetch\(`\/checklists\/dashboard\$\{query \? `\?\$\{query\}` : ''\}`\)/);
        assert.match(hrPage, /function renderProfessionWorkspaceChecklist/);
        assert.match(hrPage, /data-checklist-item-key/);
        assert.match(hrPage, /\/checklist\/items\/\$\{encodeURIComponent\(itemKey\)\}/);
        assert.match(hrHtml, /id="professionChecklistDashboardSummary"/);
        assert.match(hrHtml, /id="professionChecklistDashboardStatus"/);
        assert.match(hrHtml, /id="professionWorkspaceChecklistEditor"/);
        assert.match(hrHtml, /id="professionWorkspaceChecklistItems"/);
        assert.match(hrHtml, /id="professionWorkspaceChecklistNewTitle"/);
        assert.doesNotMatch(hrHtml, /<textarea[^>]+id="professionWorkspaceChecklist"/);
        assert.notEqual(professionWorkspaceSaveStart, -1);
        assert.notEqual(professionWorkspaceSaveEnd, -1);
        assert.notEqual(professionWorkspaceBodyStart, -1);
        assert.doesNotMatch(professionWorkspaceBodyBlock, /\bchecklist\s*:/);
        assert.match(hrPage, /staffProfessionOptions\(staff \|\| \{\}, selectedProfession\)/);
        assert.match(hrPage, /staffHasProfession\(s, requiredProfession\)/);

        assert.match(staffScheduleShell, /id="schSegmentsList"/);
        assert.match(staffScheduleShell, /id="schPrimaryProfession"/);
        assert.match(staffSurface, /sch-profession/);
        assert.match(staffPage, /async function fetchHrProfessions/);
        assert.match(staffPage, /StaffState\.professions/);
        assert.match(staffPage, /function professionCatalogOptions/);
        assert.match(staffPage, /await fetchHrProfessions\(\)/);
        assert.match(staffPage, /function staffProfessionOptions/);
        assert.match(staffPage, /function schedulePlanProfessionOptions/);
        assert.match(staffPage, /qualifiedStaff\.some\(staff => !staffHasProfession\(staff, role\)\)/);
        assert.match(staffPage, /saveScheduleEntry\(staffId, date, shiftStart, shiftEnd, status, note, professionKey, \{/);
    });

    it('keeps corporate and profession onboarding as independent UI scopes', () => {
        assert.match(hrPage, /function renderStaffOnboardingScopeCard/);
        assert.match(hrPage, /\/staff\/\$\{staffId\}\/onboarding-processes/);
        assert.match(hrPage, /\/staff\/\$\{staffId\}\/role-assignments/);
        assert.match(hrPage, /Загальний корпоративний онбординг/);
        assert.match(hrPage, /Основна професія/);
        assert.match(hrPage, /Додаткова професія/);
        assert.match(hrPage, /toggleProfessionOnboardingItem/);
        assert.match(hrPage, /\/profession-checklist/);
        assert.match(hrPage, /visibleWhen: values => values\.scope === 'profession'/);
        assert.match(hrPage, /optionsFor: staffId =>/);
        assert.match(trainingPage, /data-profession-key/);
        assert.match(trainingPage, /scope\.professionKey/);
        assert.match(trainingPage, /\/profession-checklist/);
        assert.match(trainingPage, /Корпоративний setup/);
        assert.match(trainingPage, /onboardingStatusLabel\(process\.status \|\| process\.training_status\)/);
        assert.doesNotMatch(trainingPage, /onboardingStatusLabel\(process\.training_status \|\| process\.status\)/);
        assert.match(trainingSurface, /aria-live="polite" aria-busy="true"/);
        assert.match(trainingSurface, /training-onboarding-scope-grid/);
        assert.match(hrHtml, /Корпоративний setup та допуск кожної професії показуються незалежно/);
    });

    it('keeps the team summary corporate-scoped and reports profession processes separately', () => {
        assert.match(hrOnboardingService, /profession_onboarding_summary/);
        assert.match(hrOnboardingService, /op\.profession_key IS NOT NULL/);
        assert.match(hrOnboardingService, /COUNT\(\*\) FILTER \(WHERE op\.status <> 'completed'\)::int AS active_count/);
        assert.match(hrPage, /function staffProfessionOnboardingSummary/);
        assert.match(hrPage, /Корпоративний онбординг/);
        assert.match(hrPage, /Професійні процеси:/);
        assert.match(hrPage, /if \(!assignment && !professionSummary\.activeCount\) return '';/);
        assert.match(hrPage, /const percent = assignment \? assignment\.percent : 0/);
        assert.doesNotMatch(hrPage, /professionSummary\.activeCount[\s\S]{0,120}percent/);
    });

    it('keeps HR team card profession display on canonical role fields', () => {
        assert.match(hrPage, /function staffTeamPrimaryProfessionLabel\(staff = \{\}\)/);
        assert.match(hrPage, /function staffTeamLegacyPositionMeta\(staff = \{\}\) \{[\s\S]*return normalizeProfessionKey\(staff\.role_type\) \? '' : position;/);
        assert.match(hrPage, /const primaryRole = staffTeamPrimaryProfessionLabel\(s\);/);
        assert.match(hrPage, /const legacyPosition = staffTeamLegacyPositionMeta\(s\);/);
        assert.match(hrPage, /\$\{legacyPosition \? `<span>\$\{escapeHtml\(legacyPosition\)\}<\/span>` : ''\}/);
        assert.doesNotMatch(hrPage, /s\.position \? `<span>\$\{escapeHtml\(s\.position\)\}<\/span>` : ''/);
    });

    it('links HR team category-local search, profession rates, structure nodes, and drag-drop moves', () => {
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
        assert.match(hrRoute, /Object\.prototype\.hasOwnProperty\.call\(source, 'baseUpdatedAt'\)/);
        assert.match(hrRoute, /source\.baseUpdatedAt \?\? source\.expectedUpdatedAt \?\? null/);
        assert.match(hrRoute, /Структуру вже оновили в іншій вкладці/);
        assert.match(hrRoute, /SET company_structure_node_id = NULL/);
        assert.match(hrRoute, /SET structure_node_id = NULL, updated_at = NOW\(\)/);
        assert.match(hrRoute, /COALESCE\(hs\.profession_key, s\.role_type\) AS profession_key/);
        assert.match(hrRoute, /SUM\(tr\.overtime_minutes\) AS overtime_minutes/);

        assert.match(hrPage, /function teamSearchHaystack/);
        assert.match(hrPage, /function renderStaffReadinessBadges/);
        assert.match(hrPage, /function staffHasProfilePhoto/);
        assert.match(hrPage, /function staffHasFaceDescriptor/);
        assert.match(hrPage, /function staffHasCrmAccount/);
        assert.match(hrPage, /function staffHasStructureLink/);
        assert.match(hrPage, /function renderTeamCardStatusChips/);
        assert.match(hrPage, /function renderTeamTrainingCompact/);
        assert.match(hrPage, /function renderTeamOnboardingCompact/);
        assert.match(hrPage, /function clearTeamSearchOnBucketChange/);
        assert.match(hrPage, /const activeStaff = teamStaff\.filter\(item => bucketForStaff\(item\) === activePeopleBucket\);/);
        assert.match(hrPage, /activeStaff\.filter\(item => teamSearchHaystack\(item\)\.includes\(query\)\)/);
        assert.doesNotMatch(hrPage, /HR_TEAM_SETUP_FILTERS/);
        assert.doesNotMatch(hrPage, /window\.setTeamSetupFilter/);
        assert.match(hrPage, /Фото профілю/);
        assert.match(hrPage, /Камера \/ Face ID/);
        assert.doesNotMatch(hrPage, /Фото є/);
        assert.doesNotMatch(hrPage, /Фото не додано/);
        assert.match(hrPage, /function renderStaffProfessionRatesEditor/);
        assert.match(hrPage, /currentInputValues\.has\(key\)/);
        assert.match(hrPage, /function readStaffProfessionRates/);
        assert.match(hrPage, /function renderStaffShiftPreferencesEditor/);
        assert.match(hrPage, /function loadStaffShiftPreferences/);
        assert.match(hrPage, /function readStaffShiftPreferences/);
        assert.match(hrPage, /function saveStaffShiftPreferences/);
        assert.match(hrPage, /refreshStaffShiftPreferencesFromCurrentForm/);
        assert.match(hrPage, /crmApiFetch\(`\/api\/staff\/\$\{encodeURIComponent\(numericStaffId\)\}\/shift-preferences`/);
        assert.match(hrPage, /saveStaffShiftPreferences\(staffId\)/);
        assert.match(hrPage, /function initTeamDragAndDrop/);
        assert.match(hrPage, /moveStaffToBucket/);
        assert.match(hrPage, /staffHasProfession\(staff \|\| \{\}, selectedProfession\)/);
        assert.match(hrPage, /function renderSalaryRateSummary/);
        assert.match(hrPage, /structureNodeId: document\.getElementById\('professionWorkspaceStructureNode'\)\?\.value \|\| null/);
        assert.match(hrPage, /let companyStructureUpdatedAt = null/);
        assert.match(hrPage, /baseUpdatedAt: companyStructureUpdatedAt/);

        assert.match(hrHtml, /id="teamSearch"/);
        assert.doesNotMatch(hrHtml, /id="teamArchiveSearch"/);
        assert.doesNotMatch(hrHtml, /Шукати в архіві/);
        assert.doesNotMatch(hrHtml, /id="teamMissingBanner"/);
        assert.doesNotMatch(hrHtml, /id="teamRoleFilter"/);
        assert.match(hrHtml, /id="editProfessionRates"/);
        assert.match(hrHtml, /id="editStaffShiftPreferences"/);
        assert.match(hrHtml, /id="editShiftPreferencesRefresh"/);
        assert.match(hrHtml, /hr-shift-preference-card/);
        assert.match(hrHtml, /hr-shift-preference-time-row input\[type="time"\]/);
        assert.match(hrHtml, /id="editCompanyStructureNode"/);
        assert.match(hrHtml, /hr-ready-badge/);
        assert.match(hrHtml, /hr-profession-rate-editor/);
    });


});
