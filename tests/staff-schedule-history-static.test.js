const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const staffDisplayGroups = require('../services/staffDisplayGroups');

const staffRoute = fs.readFileSync('routes/staff.js', 'utf8');
const hrRoute = fs.readFileSync('routes/hr.js', 'utf8');
const staffDisplayGroupService = fs.readFileSync('services/staffDisplayGroups.js', 'utf8');
const staffOperationalFilters = fs.readFileSync('services/staffOperationalFilters.js', 'utf8');
const hrPage = fs.readFileSync('js/hr-page.js', 'utf8');
const staffPage = fs.readFileSync('js/staff-page.js', 'utf8');
const staffHtml = fs.readFileSync('staff.html', 'utf8');
const staffScheduleShell = fs.readFileSync('js/staff-schedule-shell.js', 'utf8');
const staffCss = fs.readFileSync('css/pages-hr-staff.css', 'utf8');

function routeBlock(path) {
    const start = staffRoute.indexOf(`router.get('${path}'`);
    assert.notEqual(start, -1, `Missing GET ${path}`);
    const nextRoute = staffRoute.indexOf('\nrouter.', start + 1);
    return staffRoute.slice(start, nextRoute === -1 ? staffRoute.length : nextRoute);
}

function hrRouteBlock(path) {
    const start = hrRoute.indexOf(`router.get('${path}'`);
    assert.notEqual(start, -1, `Missing HR GET ${path}`);
    const nextRoute = hrRoute.indexOf('\nrouter.', start + 1);
    return hrRoute.slice(start, nextRoute === -1 ? hrRoute.length : nextRoute);
}

function routePostBlock(path) {
    const start = staffRoute.indexOf(`router.post('${path}'`);
    assert.notEqual(start, -1, `Missing POST ${path}`);
    const nextRoute = staffRoute.indexOf('\nrouter.', start + 1);
    return staffRoute.slice(start, nextRoute === -1 ? staffRoute.length : nextRoute);
}

describe('staff schedule safety guards', () => {
    it('keeps schedule read endpoints free of hidden write-backfills', () => {
        assert.doesNotMatch(routeBlock('/schedule'), /backfillStaffScheduleFromHrShifts/);
        assert.doesNotMatch(routeBlock('/schedule/hours'), /backfillStaffScheduleFromHrShifts/);
        assert.doesNotMatch(routeBlock('/schedule/check/:date'), /backfillStaffScheduleFromHrShifts/);
    });

    it('logs schedule write history into existing HR audit log', () => {
        assert.match(staffRoute, /router\.get\('\/schedule\/history\/:staffId\/:date'/);
        assert.match(staffRoute, /INSERT INTO hr_audit_log \(action, staff_id, performed_by, details, ip_address\)/);
        assert.match(staffRoute, /staff_schedule_update/);
        assert.match(staffRoute, /staff_schedule_bulk_update/);
        assert.match(staffRoute, /staff_schedule_copy_week/);
        assert.match(staffRoute, /staff_schedule_replacement_set/);
    });

    it('does not treat empty schedule cells as working in UI summaries and export', () => {
        assert.doesNotMatch(staffPage, /entry \? entry\.status : 'working'/);
        assert.match(staffPage, /entry \? normalizeScheduleStatus\(entry\.status\) : 'unset'/);
    });

    it('keeps sensitive attendance and payroll staff endpoints role-gated', () => {
        assert.match(staffRoute, /const STAFF_ATTENDANCE_READ_ROLES = \['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'hr', 'admin', 'accountant'\]/);
        assert.match(staffRoute, /const STAFF_PAYROLL_READ_ROLES = \['creator', 'director', 'vice_director', 'senior_manager', 'hr', 'accountant'\]/);
        assert.match(routeBlock('/attendance'), /router\.get\('\/attendance', requireRole\(\.\.\.STAFF_ATTENDANCE_READ_ROLES\)/);
        assert.match(routeBlock('/payroll'), /router\.get\('\/payroll', requireRole\(\.\.\.STAFF_PAYROLL_READ_ROLES\)/);
    });

    it('uses HR-card light staff rows and hides freelance placeholders from active schedule by default', () => {
        const staffListRoute = routeBlock('/');
        assert.doesNotMatch(staffListRoute, /SELECT staff\.\*/);
        assert.match(staffListRoute, /COALESCE\(NULLIF\(staff\.display_name, ''\), staff\.name\) AS display_name/);
        assert.match(staffListRoute, /staff\.position AS role/);
        assert.match(staffListRoute, /COALESCE\(staff\.secondary_professions, '([^']*)'\::jsonb\) AS secondary_professions/);
        assert.match(staffListRoute, /AS professions/);
        assert.match(staffListRoute, /staff\.photo_url/);
        assert.match(staffListRoute, /include_freelance/);
        assert.match(staffListRoute, /activeScheduleStaffWhere\('staff', 'CURRENT_DATE', \{ includeFreelance: shouldIncludeFreelance \}\)/);
        assert.match(staffOperationalFilters, /COALESCE\(\$\{safeAlias\}\.is_freelance, false\) = false/);
        assert.match(staffOperationalFilters, /COALESCE\(\$\{safeAlias\}\.hr_pool_status, 'core'\) = 'core'/);
        assert.match(staffListRoute, /'hr_staff_card_light' AS card_source/);
        assert.doesNotMatch(staffListRoute, /\bstaff\.(phone|emergency_contact|emergency_phone|birth_date|address|hourly_rate|rate_unit|notes|telegram_id|telegram_username|termination_reason|termination_recorded_by)\b/);
        assert.match(staffPage, /function renderStaffCardAvatar/);
        assert.match(staffPage, /function staffCardTrainingReadiness/);
        assert.match(staffPage, /function renderStaffCardReadinessBadge/);
        assert.match(staffPage, /function renderStaffCardBadges/);
        assert.match(staffPage, /renderStaffCardReadinessBadge\(staff\)/);
        assert.match(staffPage, /staff\.is_freelance[\s\S]*staff-card-badge neutral freelance/);
        assert.match(staffPage, /String\(emp\.display_name \|\| emp\.name \|\| ''\)/);
        assert.match(staffPage, /class="emp-name"><span class="emp-name-text">/);
        assert.match(staffPage, /class="emp-readiness"/);
        assert.match(staffPage, /href="\/hr\?employee=\$\{encodeURIComponent\(staffId\)\}"/);
        assert.match(staffPage, /data-hr-profile="\$\{emp\.id\}"/);
        assert.match(staffPage, /cell\.addEventListener\('keydown'/);
        assert.match(staffCss, /\.schedule-table \.emp-info/);
        assert.match(staffCss, /\.schedule-table \.emp-name-text/);
        assert.match(staffCss, /text-overflow:\s*ellipsis/);
        assert.match(staffCss, /\.schedule-table \.emp-position/);
        assert.match(staffCss, /\.schedule-table \.hr-crosslink/);
        assert.match(staffCss, /\.staff-card-badge\.freelance/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.schedule-table \.hr-crosslink/);
    });

    it('adds passive schedule health scoring, filters, and issue badges without blocking editing', () => {
        const renderSchedulePrimaryBlock = staffPage.slice(
            staffPage.indexOf('function renderSchedule()'),
            staffPage.indexOf('// Group staff by department')
        );
        const scheduleViewModeBlock = staffPage.slice(
            staffPage.indexOf('async function setScheduleViewMode'),
            staffPage.indexOf('function bindScheduleViewSwitchControls')
        );
        const healthBadgeBlock = staffPage.slice(
            staffPage.indexOf('function renderScheduleHealthBadges'),
            staffPage.indexOf('function renderScheduleHealthIssueList')
        );
        const renderEmpRowBlock = staffPage.slice(
            staffPage.indexOf('function renderEmpRow'),
            staffPage.indexOf('function scheduleCellFromEvent')
        );
        const summaryIndex = staffScheduleShell.indexOf('id="scheduleSummary"');
        const tableIndex = staffScheduleShell.indexOf('id="scheduleWrapper"');
        const healthPanelIndex = staffScheduleShell.indexOf('id="scheduleHealthPanel"');

        assert.match(staffPage, /healthFilter:\s*'all'/);
        assert.match(staffPage, /scheduleRawEntries:\s*\[\]/);
        assert.match(staffPage, /const SCHEDULE_HEALTH_FILTERS = \['all', 'critical', 'warning', 'ok'\]/);
        assert.match(staffPage, /const SCHEDULE_HEALTH_DEPARTMENT_MIN_WORKING/);
        assert.match(staffPage, /function buildScheduleHealth/);
        assert.match(staffPage, /function scheduleHealthScore/);
        assert.match(staffPage, /function renderScheduleHealthPanel/);
        assert.match(staffPage, /function renderScheduleHealthBadges/);
        assert.match(healthBadgeBlock, /const counts = scheduleHealthCounts\(sorted\)/);
        assert.match(healthBadgeBlock, /const severity = scheduleHealthSeverity\(sorted\)/);
        assert.match(healthBadgeBlock, /schedule-health-badge schedule-health-badge-compact is-\$\{severity\}/);
        assert.match(healthBadgeBlock, /data-health-detail="\$\{escapeHtml\(detail\)\}"/);
        assert.match(healthBadgeBlock, /schedule-health-badge-count/);
        assert.doesNotMatch(healthBadgeBlock, /visible\.map\(issue/);
        assert.doesNotMatch(healthBadgeBlock, /schedule-health-badge-more/);
        assert.match(staffPage, /function scheduleHealthFilteredStaff/);
        [
            'missing_account',
            'missing_face_descriptor',
            'missing_readiness',
            'staff_inactive',
            'staff_blacklisted_or_offboarded',
            'freelance_without_explicit_mode',
            'duplicate_shift',
            'overlapping_shift',
            'shift_without_role',
            'profession_mismatch',
            'long_shift',
            'planned_off_conflict',
            'department_understaffed',
            'no_responsible_manager'
        ].forEach(code => assert.match(staffPage, new RegExp(code)));
        assert.match(staffPage, /StaffState\.scheduleRawEntries\.push\(normalizedEntry\)/);
        assert.match(staffPage, /const health = buildScheduleHealth\(dates, baseFiltered, \{ department: StaffState\.activeDept \}\)/);
        assert.match(staffPage, /const filtered = scheduleHealthFilteredStaff\(baseFiltered, health\)/);
        assert.match(staffPage, /tbody\.classList\.toggle\('show-hours', Boolean\(StaffState\.showHours\)\)/);
        assert.doesNotMatch(scheduleViewModeBlock, /classList\.add\('show-hours'\)/);
        assert.match(staffPage, /function scheduleCellAriaLabel/);
        assert.match(staffPage, /role="button" tabindex="0" aria-label="\$\{escapeHtml\(cellAriaLabel\)\}"/);
        assert.match(staffPage, /function bindScheduleCellActivation/);
        assert.match(staffPage, /event\.key !== 'Enter' && event\.key !== ' '/);
        assert.match(staffPage, /event\.preventDefault\(\)/);
        assert.match(staffPage, /openScheduleCell\(cell\)/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /renderScheduleHealthPanel\(health\)/);
        assert.match(staffPage, /renderSummary\(filtered, dates\)/);
        assert.match(staffPage, /renderEmpRow\(emp, dates, today, health\)/);
        assert.match(staffPage, /class="sch-cell status-\$\{status\} \$\{loadClass\}[\s\S]*\$\{cellHealthClass\}"/);
        assert.doesNotMatch(renderEmpRowBlock, /attendanceClass|attendanceIndicator|renderScheduleAttendanceIndicator\(emp\.id|has-attendance-/);
        assert.match(staffPage, /bindScheduleHealthDetailButtons\(tbody\)/);
        assert.match(staffPage, /event\.stopPropagation\(\)/);
        assert.ok(summaryIndex > -1 && tableIndex > summaryIndex && healthPanelIndex > tableIndex);
        assert.match(staffScheduleShell, /id="scheduleHealthPanel"/);
        assert.match(staffScheduleShell, /id="scheduleHealthPanel"[^>]*hidden/);
        assert.match(staffCss, /body\[data-page-group="hr"\] \.schedule-secondary-diagnostics > \[hidden\]\s*\{[\s\S]*display:\s*none\s*!important;[\s\S]*margin:\s*0\s*!important;[\s\S]*padding:\s*0\s*!important;[\s\S]*box-shadow:\s*none\s*!important;[\s\S]*\}/);
        assert.match(staffCss, /\.schedule-health-panel/);
        assert.match(staffCss, /\.schedule-health-score/);
        assert.match(staffCss, /\.schedule-health-filter/);
        assert.match(staffCss, /\.schedule-health-badge/);
        assert.match(staffCss, /\.schedule-health-badges\s*\{[\s\S]*flex-wrap:\s*nowrap;[\s\S]*\}/);
        assert.match(staffCss, /\.schedule-health-badge-compact\s*\{[\s\S]*border-radius:\s*999px;[\s\S]*white-space:\s*nowrap;[\s\S]*\}/);
        assert.match(staffCss, /\.schedule-health-badge-count/);
        assert.match(staffCss, /\.sch-cell\.has-health-critical/);
        assert.match(staffCss, /\.sch-cell:focus-visible/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.schedule-health-panel/);
    });

    it('adds passive staffing demand forecast from bookings without auto-scheduling', () => {
        const renderSchedulePrimaryBlock = staffPage.slice(
            staffPage.indexOf('function renderSchedule()'),
            staffPage.indexOf('// Group staff by department')
        );
        const weekNavigationBlock = staffPage.slice(
            staffPage.indexOf('async function goToWeek'),
            staffPage.indexOf('function prevWeek')
        );
        const initPrimaryLoadBlock = staffPage.slice(
            staffPage.indexOf('async function initStaffSchedulePage'),
            staffPage.indexOf('// Event listeners')
        );

        assert.match(staffPage, /staffingForecast:\s*null/);
        assert.match(staffPage, /staffingForecastBookings:\s*\{\}/);
        assert.match(staffPage, /staffingForecastAvailable:\s*false/);
        assert.match(staffPage, /const STAFFING_FORECAST_DEPARTMENTS = \['animators', 'trampoline', 'reception', 'managers', 'tech', 'cafe', 'cleaning'\]/);
        ['emptyDay', 'animators', 'trampoline', 'reception', 'managers', 'tech', 'cafe', 'cleaning']
            .forEach(rule => assert.match(staffPage, new RegExp(rule)));
        assert.match(staffPage, /function staffingForecastExpectedGuests/);
        assert.match(staffPage, /function staffingForecastDayRecommendation/);
        assert.match(staffPage, /function staffingForecastScheduledCounts/);
        assert.match(staffPage, /function buildStaffingDemandForecast/);
        assert.match(staffPage, /function renderStaffingForecastPanel/);
        assert.match(staffPage, /function fetchStaffingForecastBookings/);
        assert.match(staffPage, /\/api\/bookings\/\$\{encodeURIComponent\(date\)\}/);
        assert.match(staffPage, /source:\s*'bookings_timeline_heuristics_v1'/);
        assert.match(staffPage, /recommended\.animators/);
        assert.match(staffPage, /recommended\.trampoline/);
        assert.match(staffPage, /recommended\.reception = 1/);
        assert.match(staffPage, /recommended\.managers = 1/);
        assert.match(staffPage, /recommended\.tech = 1/);
        assert.match(staffPage, /recommended\.cafe = cafeGuests/);
        assert.match(staffPage, /recommended\.cleaning = 1/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /const forecast = buildStaffingDemandForecast\(dates, baseFiltered\)/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /StaffState\.staffingForecast = forecast/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /renderStaffingForecastPanel\(forecast\)/);
        assert.doesNotMatch(weekNavigationBlock, /await fetchStaffingForecastBookings\(from, to\)/);
        assert.doesNotMatch(initPrimaryLoadBlock, /await fetchStaffingForecastBookings\(from, to\)/);
        const forecastFetchBlock = staffPage.match(/async function fetchStaffingForecastBookings[\s\S]*?async function postAttendanceAction/)?.[0] || '';
        assert.doesNotMatch(forecastFetchBlock, /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/);
        assert.doesNotMatch(forecastFetchBlock, /\/api\/staff\/schedule/);
        assert.match(staffScheduleShell, /id="scheduleForecastPanel"/);
        assert.match(staffScheduleShell, /id="scheduleForecastPanel"[^>]*hidden/);
        assert.match(staffCss, /\.schedule-forecast-panel/);
        assert.match(staffCss, /\.forecast-day-card/);
        assert.match(staffCss, /\.forecast-gap-chip\.is-missing/);
        assert.match(staffCss, /\.forecast-rules/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.schedule-forecast-panel/);
    });

    it('adds read-only manager accountability without fake unavailable metrics or new protected surfaces', () => {
        const renderSchedulePrimaryBlock = staffPage.slice(
            staffPage.indexOf('function renderSchedule()'),
            staffPage.indexOf('// Group staff by department')
        );

        assert.match(staffPage, /managerAccountability:\s*null/);
        assert.match(staffPage, /accountabilityDeptFilter:\s*'all'/);
        assert.match(staffPage, /accountabilityManagerFilter:\s*'all'/);
        assert.match(staffPage, /const MANAGER_ACCOUNTABILITY_ROLES = new Set\(\['manager', 'senior_manager', 'admin', 'vice_director', 'art_director'\]\)/);
        assert.match(staffPage, /const MANAGER_ACCOUNTABILITY_UNAVAILABLE_METRICS = \{/);
        [
            'late_reports_source_missing',
            'payroll_reconciliation_source_missing',
            'shift_approval_source_missing',
            'historical_accountability_snapshot_missing',
            'manager_action_log_source_missing'
        ].forEach(source => assert.match(staffPage, new RegExp(source)));
        assert.match(staffPage, /function buildManagerAccountability/);
        assert.match(staffPage, /function managerAccountabilityAttendanceCounts/);
        assert.match(staffPage, /function managerAccountabilityMissingReadiness/);
        assert.match(staffPage, /function renderManagerAccountabilityPanel/);
        assert.match(staffPage, /Explicit manager→department mapping is missing/);
        assert.match(staffPage, /not counted as zero/);
        assert.match(staffPage, /renderManagerAccountabilityMetric\(row\.lateReports, 'late reports'\)/);
        assert.match(staffPage, /renderManagerAccountabilityMetric\(row\.payrollDiscrepancies, 'payroll'\)/);
        assert.match(staffPage, /renderManagerAccountabilityMetric\(row\.unapprovedShifts, 'unapproved'\)/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /const accountability = buildManagerAccountability\(dates, baseFiltered, health\)/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /StaffState\.managerAccountability = accountability/);
        assert.doesNotMatch(renderSchedulePrimaryBlock, /renderManagerAccountabilityPanel\(accountability\)/);
        assert.match(staffPage, /data-accountability-filter="department"/);
        assert.match(staffPage, /data-accountability-filter="manager"/);
        assert.match(staffPage, /data-accountability-dept/);
        assert.match(staffPage, /href="\/reports\.html"/);
        assert.match(staffPage, /href="\/hr\.html"/);
        assert.doesNotMatch(staffPage, /\/api\/manager-accountability|\/api\/accountability/);
        assert.doesNotMatch(staffPage, /CREATE TABLE|ALTER TABLE|INSERT INTO manager|UPDATE manager/);
        assert.match(staffScheduleShell, /id="managerAccountabilityPanel"/);
        assert.match(staffScheduleShell, /id="managerAccountabilityPanel"[^>]*hidden/);
        assert.match(staffCss, /\.manager-accountability-panel/);
        assert.match(staffCss, /\.accountability-table/);
        assert.match(staffCss, /\.accountability-metric\.is-unavailable/);
        assert.match(staffCss, /\.accountability-manager-row/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.manager-accountability-panel/);
    });

    it('links schedule plans to payroll-ready attendance without adding a new data model', () => {
        const renderEmpRowBlock = staffPage.slice(
            staffPage.indexOf('function renderEmpRow'),
            staffPage.indexOf('function scheduleCellFromEvent')
        );
        const attendanceRoute = routeBlock('/attendance');
        assert.match(attendanceRoute, /hr_time_records tr/);
        assert.match(attendanceRoute, /FULL OUTER JOIN staff_checkins sc/);
        assert.match(attendanceRoute, /tr\.clock_in/);
        assert.match(attendanceRoute, /tr\.clock_out/);
        assert.match(attendanceRoute, /tr\.planned_start/);
        assert.match(attendanceRoute, /tr\.planned_end/);
        assert.match(attendanceRoute, /tr\.late_minutes/);
        assert.match(attendanceRoute, /tr\.early_leave_minutes/);
        assert.match(attendanceRoute, /tr\.total_worked_minutes/);
        assert.match(attendanceRoute, /attendance_source/);
        assert.doesNotMatch(attendanceRoute, /CREATE TABLE|ALTER TABLE|INSERT INTO hr_time_records|UPDATE hr_time_records/);

        assert.match(staffPage, /attendance:\s*\{\}/);
        assert.match(staffPage, /async function fetchScheduleAttendance/);
        assert.match(staffPage, /\/api\/staff\/attendance\?from=\$\{encodeURIComponent\(from\)\}&to=\$\{encodeURIComponent\(to\)\}/);
        assert.match(staffPage, /function scheduleAttendanceStatus/);
        ['planned', 'checked_in', 'late', 'absent', 'left_early', 'completed', 'manual_review', 'excused']
            .forEach(status => assert.match(staffPage, new RegExp(status)));
        assert.match(staffPage, /function renderScheduleAttendanceIndicator/);
        assert.match(staffPage, /function renderScheduleAttendanceSummary/);
        assert.doesNotMatch(renderEmpRowBlock, /renderScheduleAttendanceIndicator|attendanceIndicator|attendanceClass|has-attendance-/);
        assert.match(staffPage, /postAttendanceAction\(action, staffId\)/);
        assert.match(staffPage, /\/api\/hr\/clock-in/);
        assert.match(staffPage, /\/api\/hr\/clock-out/);
        assert.match(staffPage, /\/api\/hr\/mark-absent/);
        assert.match(staffPage, /data-attendance-action/);
        assert.match(staffPage, /event\.stopPropagation\(\)/);
        assert.match(staffPage, /renderScheduleAttendanceSummary\(dates, filtered\)/);
        assert.match(staffScheduleShell, /id="scheduleAttendanceSummary"/);
        assert.match(staffCss, /\.schedule-attendance-summary/);
        assert.match(staffCss, /\.sch-attendance\.is-late/);
        assert.match(staffCss, /\.sch-attendance\.is-absent/);
        assert.match(staffCss, /\.attendance-action-btn/);
        assert.match(staffCss, /\.sch-cell\.has-attendance-late/);
    });

    it('groups reception, managers, and security into schedule display departments without changing stored departments', () => {
        assert.match(staffPage, /const SCHEDULE_DEPARTMENT_ORDER = \['animators', 'trampoline', 'reception', 'admin', 'cafe', 'tech', 'cleaning'\]/);
        assert.match(staffPage, /const SCHEDULE_RECEPTION_ROLE_KEYS = new Set\(\['reception', 'manager', 'senior_manager'\]\)/);
        assert.match(staffPage, /const backendGroup = normalizeScheduleDisplayGroupKey\(staff\.display_group \|\| staff\.displayGroup\)/);
        assert.match(staffPage, /if \(SCHEDULE_RECEPTION_ROLE_KEYS\.has\(roleKey\)\) return 'reception'/);
        assert.match(staffPage, /if \(department === 'security'\) return 'tech'/);
        assert.match(staffPage, /reception:\s*'Рецепшен'/);
        assert.match(staffPage, /tech:\s*'Технічний відділ'/);
        assert.match(staffPage, /reception:\s*\[\s*\{\s*key:\s*'reception',\s*label:\s*'Рецепція'/);
        assert.match(staffPage, /key:\s*'manager,senior_manager',\s*label:\s*'Менеджери'/);
        assert.match(staffPage, /tech:\s*\[\s*\{\s*departments:\s*'tech',\s*label:\s*'Технічний відділ'/);
        assert.match(staffPage, /departments:\s*'security',\s*key:\s*'security',\s*label:\s*'Охорона'/);
        assert.match(staffPage, /key:\s*'pizzaiolo',\s*label:\s*'Піцайоло'/);
        assert.match(staffPage, /key:\s*'wardrobe',\s*label:\s*'Гардероб'/);
        assert.match(staffPage, /value:\s*'reception',\s*label:\s*'Рецепція'/);
        assert.match(staffPage, /value:\s*'pizzaiolo',\s*label:\s*'Піцайоло'/);
        assert.match(staffPage, /value:\s*'wardrobe',\s*label:\s*'Гардероб'/);
        assert.doesNotMatch(staffPage, /const SCHEDULE_DEPARTMENT_ORDER = \[[^\]]*'security'/);
        assert.doesNotMatch(staffPage, /(?:s|emp|staff)\.department === StaffState\.activeDept/);
    });

    it('centralizes operational staff display groups in the backend contract', () => {
        assert.deepEqual(staffDisplayGroups.listStaffDisplayGroups().map(group => group.key), [
            'animators', 'trampoline', 'reception', 'admin', 'cafe', 'tech', 'cleaning'
        ]);
        assert.equal(staffDisplayGroups.resolveStaffDisplayGroup({ department: 'security', role_type: 'maintenance' }), 'tech');
        assert.equal(staffDisplayGroups.resolveStaffDisplayGroup({ department: 'admin', role_type: 'manager' }), 'reception');
        assert.equal(staffDisplayGroups.resolveStaffDisplayGroup({ department: 'admin', role_type: 'senior_manager' }), 'reception');
        assert.equal(staffDisplayGroups.resolveStaffDisplayGroup({ department: 'cleaning', role_type: 'reception' }), 'reception');
        assert.equal(staffDisplayGroups.resolveStaffDisplayGroup(
            { department: 'security', role_type: 'maintenance' },
            { structureNode: { displayGroup: 'cafe' } }
        ), 'cafe');
        assert.equal(staffDisplayGroups.resolveStaffDisplayGroup(
            { department: 'security', role_type: 'maintenance' },
            { structureNode: { displayGroup: 'unknown' } }
        ), 'tech');
        assert.equal(staffDisplayGroups.staffStructureDisplayGroupKey({ id: 'managers' }), 'reception');
        assert.equal(staffDisplayGroups.staffStructureDisplayGroupKey({ id: 'technical_staff' }), 'tech');
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup({ department: 'security' }).display_group_label, 'Технічний відділ');
        assert.doesNotMatch(staffDisplayGroupService, /key:\s*'security'/);
        assert.match(staffRoute, /require\('\.\.\/services\/staffDisplayGroups'\)/);
        assert.match(staffRoute, /router\.get\('\/display-groups'/);
        assert.match(staffRoute, /displayGroups: listStaffDisplayGroups\(\)/);
        assert.match(hrRoute, /decorateStaffWithDisplayGroup\(s, \{ displayGroupContext \}\)/);
        assert.match(hrRoute, /display_group: displayStaff\.display_group/);
        assert.match(hrRoute, /displayGroup: displayStaff\.displayGroup/);
        assert.match(hrRoute, /displayGroups: listStaffDisplayGroups\(\)/);
    });

    it('resolves staff display groups from company structure context before fallback', async () => {
        const context = await staffDisplayGroups.loadStaffDisplayGroupContext({
            async query(sql) {
                if (/FROM settings/i.test(sql)) {
                    return {
                        rows: [{
                            value: {
                                nodes: [
                                    { id: 'ops_node', title: 'Ops', displayGroup: 'cafe' },
                                    { id: 'tech_node', title: 'Tech', displayGroup: 'tech' },
                                    { id: 'blank_node', title: 'No display group' }
                                ]
                            }
                        }]
                    };
                }
                if (/FROM hr_professions/i.test(sql)) {
                    return { rows: [{ key: 'maintenance', structure_node_id: 'tech_node' }] };
                }
                return { rows: [] };
            }
        });
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup(
            { department: 'security', role_type: 'maintenance', company_structure_node_id: 'ops_node' },
            { displayGroupContext: context }
        ).display_group, 'cafe');
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup(
            { department: 'admin', role_type: 'manager', company_structure_node_id: 'ops_node' },
            { displayGroupContext: context }
        ).display_group, 'cafe');
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup(
            { department: 'security', role_type: 'maintenance' },
            { displayGroupContext: context }
        ).display_group, 'tech');
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup(
            { department: 'security', role_type: 'unknown', company_structure_node_id: 'missing_node' },
            { displayGroupContext: context }
        ).display_group, 'tech');
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup(
            { department: 'security', role_type: 'unknown', company_structure_node_id: 'blank_node' },
            { displayGroupContext: context }
        ).display_group, 'tech');
        assert.equal(staffDisplayGroups.decorateStaffWithDisplayGroup(
            { department: 'admin', role_type: 'senior_manager', company_structure_node_id: 'blank_node' },
            { displayGroupContext: context }
        ).display_group, 'reception');

        const staffScheduleRoute = routeBlock('/schedule');
        const staffListRoute = routeBlock('/');
        const hrStaffRoute = hrRouteBlock('/staff');
        const hrTodayRoute = hrRouteBlock('/today');
        assert.match(staffScheduleRoute, /s\.role_type, s\.company_structure_node_id/);
        assert.match(staffScheduleRoute, /const displayGroupContext = await loadStaffDisplayGroupContext\(pool\)/);
        assert.match(staffScheduleRoute, /decorateStaffRowsWithDisplayGroups\(result\.rows, \{ displayGroupContext \}\)/);
        assert.match(staffListRoute, /staff\.company_structure_node_id/);
        assert.match(staffListRoute, /const displayGroupContext = await loadStaffDisplayGroupContext\(pool\)/);
        assert.match(staffListRoute, /decorateStaffRowsWithDisplayGroups\(result\.rows, \{ displayGroupContext \}\)/);
        assert.match(staffListRoute, /buildStaffDisplayGroupOptions\(result\.rows, \{ displayGroupContext \}\)/);
        assert.match(hrStaffRoute, /const displayGroupContext = await loadStaffDisplayGroupContext\(pool\)/);
        assert.match(hrStaffRoute, /decorateStaffRowsWithDisplayGroups\(result\.rows, \{ displayGroupContext \}\)/);
        assert.match(hrTodayRoute, /company_structure_node_id/);
        assert.match(hrTodayRoute, /const displayGroupContext = await loadStaffDisplayGroupContext\(pool\)/);
        assert.match(hrTodayRoute, /decorateStaffWithDisplayGroup\(s, \{ displayGroupContext \}\)/);
    });

    it('uses shared display groups for HR today filters and searchable raw department metadata', () => {
        assert.match(hrPage, /let todayDisplayGroups = \[\]/);
        assert.match(hrPage, /function normalizeStaffDisplayGroups\(groups = \[\]\)/);
        assert.match(hrPage, /function setStaffDisplayGroupsContract\(groups = \[\], options = \{\}\)/);
        assert.match(hrPage, /function staffDisplayGroupKeyForStaff\(staff = \{\}\)/);
        assert.match(hrPage, /const backendGroup = normalizeStaffDisplayGroupKey\(staff\.display_group \|\| staff\.displayGroup\)/);
        assert.match(hrPage, /function legacyStaffDisplayGroupKeyForStaff\(staff = \{\}\)/);
        assert.match(hrPage, /if \(\['reception', 'manager', 'senior_manager'\]\.includes\(roleKey\)\) return 'reception'/);
        assert.match(hrPage, /if \(departmentKey === 'security'\) return 'tech'/);
        assert.match(hrPage, /function todayDepartmentOptions\(items = \[\], groups = staffDisplayGroupsContract\)/);
        assert.match(hrPage, /const key = staffDisplayGroupKeyForStaff\(item\)/);
        assert.match(hrPage, /if \(department !== 'all' && staffDisplayGroupKeyForStaff\(item\) !== department\) return false/);
        assert.match(hrPage, /setStaffDisplayGroupsContract\(data\.displayGroups \|\| data\.display_groups \|\| staffDisplayGroupsContract\)/);
        assert.match(hrPage, /function companyStructureDisplayGroupOptions\(selectedValue = ''\) \{[\s\S]*activeStaffDisplayGroups\(staffDisplayGroupsContract\)[\s\S]*groups\.map\(group =>/);
        assert.match(hrPage, /displayGroupLabel/);
        assert.match(hrPage, /departmentLabel\(item\.department\)/);
        assert.match(staffPage, /StaffState\.displayGroups = normalizeScheduleDisplayGroups\(data\.displayGroups \|\| data\.display_groups \|\| StaffState\.displayGroups\)/);
    });

    it('uses schedule display groups in filters, fill-week, load view, export, and copy-week safety', () => {
        assert.match(staffPage, /function scheduleStaffVisibleWithoutSearch\(staffList = StaffState\.staff\) \{[\s\S]*staffMatchesScheduleDepartment\(staff, StaffState\.activeDept\)[\s\S]*\}/);
        assert.match(staffPage, /function scheduleVisibleStaff\(staffList = StaffState\.staff\) \{[\s\S]*const visible = scheduleStaffVisibleWithoutSearch\(staffList\);[\s\S]*const query = normalizeScheduleSearchText\(StaffState\.searchQuery\);[\s\S]*scheduleStaffSearchHaystack\(staff\)\.includes\(query\)[\s\S]*\}/);
        assert.match(staffPage, /function legacyScheduleDisplayDepartmentKey\(staff = \{\}\)/);
        assert.match(staffPage, /function scheduleDepartmentOptions\(\) \{[\s\S]*const counts = scheduleDepartmentCountMap\(StaffState\.staff\)[\s\S]*scheduleDisplayGroupOrder\(\)/);
        assert.match(staffPage, /function staffScheduleDepartmentKeys\(staff = \{\}\) \{[\s\S]*staffProfessionKeys\(staff\)[\s\S]*add\(scheduleDisplayDepartmentKey\(staff\)\)/);
        assert.match(staffPage, /function staffMatchesScheduleDepartment\(staff = \{\}, departmentKey = ''\) \{[\s\S]*staffScheduleDepartmentKeys\(staff\)\.includes\(normalized\)/);
        assert.match(staffPage, /function scheduleStaffGroupingDepartmentKeys\(staff = \{\}, options = \{\}\)/);
        assert.match(staffPage, /return staffMatchesScheduleDepartment\(staff, activeDepartment\) \? \[activeDepartment\] : \[\]/);
        assert.match(staffPage, /function scheduleDepartmentRenderOrder\(grouped = \{\}\) \{[\s\S]*scheduleDisplayGroupOrder\(\)\.filter\(key => grouped\[key\]\)/);
        assert.match(staffPage, /if \(StaffState\.activeDept !== 'all' && !options\.some\(option => option\.value === StaffState\.activeDept\)\) \{[\s\S]*StaffState\.activeDept = 'all'/);
        assert.match(staffPage, /function openFillWeekModal\(\) \{[\s\S]*const filtered = scheduleVisibleStaff\(\)/);
        assert.match(staffPage, /if \(staffValue === 'all'\) \{[\s\S]*targetStaff = scheduleVisibleStaff\(\)/);
        assert.match(staffPage, /function handleFillWeekSave\(\) \{[\s\S]*const dates = getScheduleDates\(\)[\s\S]*checkedDays\.includes\(d\.getDay\(\)\)/);
        assert.match(staffPage, /const needsConfirmation = dates\.length > STAFF_SCHEDULE_WINDOW_DAYS[\s\S]*entries\.length >= STAFF_SCHEDULE_BULK_CONFIRM_ENTRY_THRESHOLD/);
        assert.match(staffPage, /confirmModal\(confirmLines\.join\('\\n'\), \{ type: 'warning', okText: 'Заповнити' \}\)/);
        assert.match(staffPage, /await goToScheduleRange\(currentRange\.start, currentRange\.end, currentMode\)/);
        assert.match(staffPage, /function renderLoadView\(\) \{[\s\S]*const filtered = scheduleVisibleStaff\(\)/);
        assert.match(staffPage, /function scheduleExportVisibleStaff\(\) \{[\s\S]*scheduleVisibleStaff\(\)[\s\S]*StaffState\.staff/);
        assert.match(staffPage, /const health = buildScheduleHealth\(dates, baseFiltered, \{ department: StaffState\.activeDept \}\)/);
        assert.match(staffPage, /const grouped = groupStaffByScheduleDepartment\(filtered, \{ department: StaffState\.activeDept \}\)/);
        assert.match(staffPage, /function buildScheduleWorkbookHtml\(options = \{\}\) \{[\s\S]*const grouped = groupStaffByScheduleDepartment\(scheduleExportVisibleStaff\(\), \{ department: StaffState\.activeDept \}\)/);
        assert.match(staffPage, /function buildScheduleWorkbookHtml\(options = \{\}\) \{[\s\S]*const deptLabel = scheduleDisplayDepartmentLabel\(dept\)/);
        assert.match(staffPage, /const SCHEDULE_COPY_RAW_DEPARTMENT_SAFE = new Set\(\['animators', 'trampoline', 'cafe', 'cleaning'\]\)/);
        assert.match(staffPage, /const SCHEDULE_COPY_EXPLICIT_STAFF_CATEGORIES = new Set\(\['reception', 'tech', 'admin'\]\)/);
        assert.match(staffPage, /function scheduleCopyWeekModeForDepartment/);
        assert.match(staffPage, /function scheduleCopyWeekVisibleStaffIds/);
        assert.match(staffPage, /function scheduleCopyWeekPayload/);
        assert.match(staffPage, /body\.department = department/);
        assert.match(staffPage, /body\.staffIds = scheduleCopyWeekVisibleStaffIds\(\)/);
        assert.match(staffPage, /function canCopyWeekInCurrentRange\(\) \{[\s\S]*scheduleRangeDayCount\(range\.start, range\.end\) === STAFF_SCHEDULE_WINDOW_DAYS/);
        assert.match(staffPage, /if \(!canCopyWeekInCurrentRange\(\)\) \{[\s\S]*Копія тижня недоступна для довільного періоду/);
        assert.match(staffPage, /Довільний visible range не копіюється цією дією/);
        assert.match(staffPage, /copyWeekSchedule\(fromMonday, toMonday, \{ dryRun: true \}\)/);
        assert.match(staffPage, /visible staffIds\[\]/);
    });

    it('supports full copy-week for virtual categories through explicit staffIds and dry-run preview', () => {
        const copyWeekRoute = routePostBlock('/schedule/copy-week');
        assert.match(copyWeekRoute, /const \{ fromMonday, toMonday \} = req\.body/);
        assert.match(copyWeekRoute, /const displayGroup = String\(req\.body\.displayGroup \|\| req\.body\.display_group/);
        assert.match(copyWeekRoute, /const dryRun = req\.body\.dryRun === true \|\| req\.body\.dry_run === true/);
        assert.match(copyWeekRoute, /const staffIds = normalizeCopyWeekStaffIds\(req\.body\.staffIds \|\| req\.body\.staff_ids\)/);
        assert.match(staffRoute, /const STAFF_COPY_WEEK_RAW_DEPARTMENT_ALLOWLIST = new Set\(\['animators', 'trampoline', 'cafe', 'cleaning'\]\)/);
        assert.match(copyWeekRoute, /staffIds\.length && department/);
        assert.match(copyWeekRoute, /!STAFF_COPY_WEEK_RAW_DEPARTMENT_ALLOWLIST\.has\(department\)/);
        assert.match(copyWeekRoute, /virtual\/display group/);
        assert.match(copyWeekRoute, /ss\.staff_id = ANY\(\$\$\{params\.length\}::int\[\]\)/);
        assert.match(copyWeekRoute, /dryRun/);
        assert.match(copyWeekRoute, /conflicts/);
        assert.match(copyWeekRoute, /copyMode/);
        assert.match(copyWeekRoute, /displayGroup/);
        assert.match(copyWeekRoute, /staffCount: sourceStaffIds\.length/);
        assert.match(copyWeekRoute, /staff_schedule_copy_week/);
        assert.match(copyWeekRoute, /staffIds: copyMode === 'explicit_staff_ids' \? sourceStaffIds : undefined/);
    });

    it('keeps canonical and legacy trampoline roles in the same schedule subgroup', () => {
        assert.match(staffPage, /key:\s*'trampoline_instructor,senior_instructor,instructor',\s*label:\s*'Батутисти'/);
        assert.match(staffPage, /trampoline:\s*\[\s*\{\s*key:\s*'trampoline_instructor,senior_instructor,instructor'/);
        assert.match(staffPage, /function staffMatchesDepartmentSubGroup/);
        assert.match(staffPage, /function departmentSubGroupDepartmentKeys/);
        assert.match(staffPage, /function scheduleRenderableSubGroups/);
        assert.match(staffPage, /function shouldSkipScheduleSubGroup/);
        assert.match(staffPage, /const renderableSubGroups = scheduleRenderableSubGroups\(dept, deptStaff, subGroups\)/);
        assert.match(staffPage, /deptStaff\.filter\(s => !renderedStaffIds\.has\(Number\(s\.id\)\)\)/);
        assert.match(staffPage, /placeholder:\s*'host, trampoline_instructor'/);
        assert.doesNotMatch(staffPage, /placeholder:\s*'host, instructor'/);
    });

    it('renders schedule department and subgroup icons as CRM SVG icons instead of emoji', () => {
        const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
        const departmentIconsBlock = staffPage.match(/const DEPT_ICONS = \{[\s\S]*?\n\};/)?.[0] || '';
        const subGroupsBlock = staffPage.match(/const DEPT_SUB_GROUPS = \{[\s\S]*?\n\};/)?.[0] || '';

        assert.match(staffPage, /const SCHEDULE_CRM_ICON_SVG = \{/);
        assert.match(staffPage, /function renderScheduleCrmIcon/);
        assert.match(departmentIconsBlock, /animators:\s*'drama'/);
        assert.match(departmentIconsBlock, /trampoline:\s*'activity'/);
        assert.match(departmentIconsBlock, /cafe:\s*'coffee'/);
        assert.match(subGroupsBlock, /label:\s*'Аніматори',\s*icon:\s*'drama'/);
        assert.match(subGroupsBlock, /label:\s*'Батутисти',\s*icon:\s*'activity'/);
        assert.match(staffPage, /renderScheduleCrmIcon\(DEPT_ICONS\[dept\], 'dept-icon schedule-crm-icon'\)/);
        assert.match(staffPage, /renderScheduleCrmIcon\(sg\.icon, 'sub-group-icon schedule-crm-icon'\)/);
        assert.doesNotMatch(departmentIconsBlock, emojiPattern);
        assert.doesNotMatch(subGroupsBlock, emojiPattern);
        assert.match(staffCss, /\.schedule-crm-icon\s*\{/);
        assert.match(staffCss, /\.schedule-crm-icon svg\s*\{/);
        assert.match(staffCss, /\.dept-row\[data-dept="animators"\] \.dept-icon/);
    });

    it('does not render cross-category subgroup headers inside expanded schedule groups', () => {
        const renderableSubGroupsBlock = staffPage.slice(
            staffPage.indexOf('function scheduleRenderableSubGroups'),
            staffPage.indexOf('function normalizeScheduleSearchText')
        );

        assert.match(staffPage, /function scheduleDisplayGroupKeyForRawDepartment/);
        assert.match(staffPage, /if \(raw === 'security'\) return 'tech'/);
        assert.match(staffPage, /function scheduleSubGroupMatchesParentDepartment/);
        assert.match(renderableSubGroupsBlock, /scheduleSubGroupMatchesParentDepartment\(departmentKey, subGroup\)/);
        assert.ok(
            renderableSubGroupsBlock.indexOf('scheduleSubGroupMatchesParentDepartment(departmentKey, subGroup)')
                < renderableSubGroupsBlock.indexOf('shouldSkipScheduleSubGroup(departmentKey, subGroup)'),
            'cross-category subgroups must be filtered before duplicate-label skipping'
        );
        assert.match(staffPage, /function scheduleSubGroupDisplayDepartmentKey/);
    });

    it('keeps staff import and account linking on canonical role aliases', () => {
        const importRoleMap = staffRoute.match(/const EXCEL_TO_CRM_ROLE = \{[\s\S]*?\n\};/)?.[0] || '';
        assert.match(importRoleMap, /'Батутисти':\s*\{\s*dept:\s*'trampoline',\s*role:\s*'trampoline_instructor'\s*\}/);
        assert.match(importRoleMap, /'Хозяюшки залу':\s*\{\s*dept:\s*'cleaning',\s*role:\s*'cleaner'\s*\}/);
        assert.doesNotMatch(importRoleMap, /role:\s*'instructor'/);
        assert.doesNotMatch(importRoleMap, /role:\s*'cleaning'/);

        const accountRoleMapper = staffRoute.match(/function staffRoleToAccountRole\(roleType\) \{[\s\S]*?\n\}/)?.[0] || '';
        assert.match(accountRoleMapper, /trampoline_instructor:\s*'animator'/);
        assert.match(accountRoleMapper, /senior_instructor:\s*'manager'/);
        assert.match(accountRoleMapper, /cleaner:\s*'cleaning'/);
        assert.match(accountRoleMapper, /pizzaiolo:\s*'cook'/);
        assert.doesNotMatch(accountRoleMapper, /trampoline_instructor:\s*'instructor'/);
        assert.match(accountRoleMapper, /'instructor'/);
        assert.match(accountRoleMapper, /'cleaning'/);
    });

    it('renders explicit cell history UI and fetches it from the staff API', () => {
        assert.match(staffScheduleShell, /id="schHistoryList"/);
        assert.match(staffScheduleShell, /Історія клітинки/);
        assert.match(staffPage, /function renderScheduleHistoryList/);
        assert.match(staffPage, /fetchScheduleHistory/);
        assert.match(staffPage, /\/api\/staff\/schedule\/history\/\$\{encodeURIComponent\(staffId\)\}/);
    });
    it('keeps the schedule shift modal viewport-safe and dark-theme readable', () => {
        const modalStart = staffScheduleShell.indexOf('id="schModalOverlay"');
        const fillStart = staffScheduleShell.indexOf('id="fillWeekOverlay"');
        const scheduleModal = staffScheduleShell.slice(modalStart, fillStart);
        const modalCssBlock = staffCss.slice(
            staffCss.indexOf('/* Edit modal */'),
            staffCss.indexOf('/* Dark mode overrides */')
        );
        const darkModalCssBlock = staffCss.slice(
            staffCss.indexOf('body.dark-mode #schModalOverlay .sch-modal--schedule select,'),
            staffCss.indexOf('/* Extracted from staff.html presentation-only inline attrs. */')
        );

        assert.ok(modalStart > -1 && fillStart > modalStart, 'schedule modal shell is present before fill modal');
        assert.ok(modalCssBlock.length > 0, 'schedule modal layout CSS block is present');
        assert.ok(darkModalCssBlock.length > 0, 'schedule modal dark-theme CSS block is present');
        assert.match(scheduleModal, /class="sch-modal sch-modal--schedule"/);
        assert.match(scheduleModal, /class="sch-modal-scroll"/);
        assert.match(scheduleModal, /id="schShiftPreferencePanel"/);
        assert.match(scheduleModal, /class="modal-actions sch-primary-actions"/);
        assert.ok(scheduleModal.indexOf('class="sch-modal-scroll"') < scheduleModal.indexOf('class="modal-actions sch-primary-actions"'));

        assert.match(modalCssBlock, /\.sch-modal-overlay\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*overscroll-behavior:\s*contain;[\s\S]*\}/);
        assert.match(modalCssBlock, /\.sch-modal\s*\{[\s\S]*max-height:\s*calc\(100dvh - 32px\);[\s\S]*overflow-y:\s*auto;[\s\S]*\}/);
        assert.match(modalCssBlock, /#schModalOverlay \.sch-modal--schedule\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*overflow:\s*hidden;[\s\S]*\}/);
        assert.match(modalCssBlock, /#schModalOverlay \.sch-modal-scroll\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;[\s\S]*\}/);
        assert.match(modalCssBlock, /#schModalOverlay \.sch-primary-actions\s*\{[\s\S]*flex:\s*0 0 auto;[\s\S]*border-top:\s*1px solid rgba\(148, 163, 184, 0\.22\);[\s\S]*background:\s*inherit;[\s\S]*\}/);
        assert.match(modalCssBlock, /#schModalOverlay \.sch-primary-actions > button\s*\{[\s\S]*min-height:\s*44px;[\s\S]*\}/);
        assert.match(modalCssBlock, /\.sch-shift-preferences\s*\{/);
        assert.match(modalCssBlock, /\.sch-shift-preference-options\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*\}/);
        assert.match(modalCssBlock, /\.sch-shift-preference-option\.is-recommended/);
        assert.match(staffCss, /#schModalOverlay \.sch-history-list\s*\{[\s\S]*max-height:\s*min\(190px, 28dvh\);[\s\S]*\}/);

        assert.match(darkModalCssBlock, /body\.dark-mode #schModalOverlay \.sch-modal--schedule select/);
        assert.match(darkModalCssBlock, /\[data-theme="dark"\] #schModalOverlay \.sch-modal--schedule input/);
        assert.match(darkModalCssBlock, /color-scheme:\s*dark;/);
        assert.match(darkModalCssBlock, /background-color:\s*#0B1220;/);
        assert.match(darkModalCssBlock, /color:\s*#F8FAFC;/);
        assert.match(darkModalCssBlock, /background-position:\s*[\s\S]*calc\(100% - 25px\) 50%,[\s\S]*calc\(100% - 17px\) 50%;/);
        assert.match(darkModalCssBlock, /background-size:\s*8px 8px,\s*8px 8px;/);
        assert.match(darkModalCssBlock, /background-repeat:\s*no-repeat;/);
        assert.match(darkModalCssBlock, /padding-right:\s*52px;/);
        assert.match(darkModalCssBlock, /input\[type="time"\][\s\S]*background-image:\s*url\("data:image\/svg\+xml/);
        assert.match(darkModalCssBlock, /input\[type="time"\][\s\S]*background-position:\s*calc\(100% - 18px\) 50%;/);
        assert.match(darkModalCssBlock, /input\[type="time"\][\s\S]*background-size:\s*20px 20px;/);
        assert.match(darkModalCssBlock, /select option,\s*[\s\S]*select optgroup/);
        assert.match(darkModalCssBlock, /select option:checked/);
        assert.match(darkModalCssBlock, /select:disabled/);
        assert.match(darkModalCssBlock, /input:disabled/);
        assert.match(darkModalCssBlock, /input::placeholder/);
        assert.match(darkModalCssBlock, /input\[type="time"\]::-webkit-calendar-picker-indicator/);
        assert.match(darkModalCssBlock, /input\[type="time"\]::-webkit-calendar-picker-indicator,[\s\S]*opacity:\s*0;/);
        assert.match(darkModalCssBlock, /body\.dark-mode #schModalOverlay \.sch-shift-preferences/);
        assert.match(darkModalCssBlock, /body\.dark-mode #schModalOverlay \.sch-shift-preference-option\.is-recommended/);
        assert.doesNotMatch(darkModalCssBlock, /!important/);
    });

    it('loads staff shift preferences into schedule modal quick options without changing schedule save API', () => {
        assert.match(staffPage, /shiftPreferences:\s*\{\}/);
        assert.match(staffPage, /function fetchScheduleShiftPreferences/);
        assert.match(staffPage, /function renderScheduleShiftPreferencePanel/);
        assert.match(staffPage, /function applyScheduleShiftPreference/);
        assert.match(staffPage, /weekday:\s*'ПН-ПТ'/);
        assert.match(staffPage, /weekend:\s*'СБ-НД'/);
        assert.match(staffPage, /function setScheduleShiftPreferenceActiveDay/);
        assert.match(staffPage, /setScheduleShiftPreferenceActiveDay\(normalized\.dayType\)/);
        assert.match(staffPage, /button\.classList\.toggle\('is-recommended', isActive\)/);
        assert.match(staffPage, /button\.setAttribute\('aria-pressed', isActive \? 'true' : 'false'\)/);
        assert.match(staffPage, /aria-pressed="\$\{row\.dayType === activeDayType \? 'true' : 'false'\}"/);
        assert.match(staffPage, /\/api\/staff\/\$\{encodeURIComponent\(numericStaffId\)\}\/shift-preferences/);
        assert.match(staffPage, /renderScheduleShiftPreferencePanel\(preferences, \{ autoApply: 'force' \}\)/);
        assert.match(staffPage, /loadScheduleShiftPreferences\(staffId, \{/);
        assert.match(staffPage, /autoApply: \(!entry\?\.shift_start && !entry\?\.shift_end\) \? 'missing-only' : false/);
        assert.match(staffPage, /saveScheduleEntry\(staffId, date, shiftStart, shiftEnd, status, note, professionKey\)/);
        assert.doesNotMatch(staffPage, /saveScheduleEntry\(staffId, date, shiftStart, shiftEnd, status, note, professionKey,\s*shiftPreferences/);
    });

    it('keeps shift load classes as metadata without painting schedule cells', () => {
        assert.match(staffPage, /const STAFF_FULL_SHIFT_MINUTES = 8 \* 60/);
        assert.match(staffPage, /const STAFF_WEEKEND_FULL_SHIFT_MINUTES = 10 \* 60/);
        assert.match(staffPage, /function scheduleShiftLoadFullShiftMinutes/);
        assert.match(staffPage, /scheduleShiftLoadDate\(entry\.date \|\| entry\.shift_date \|\| entry\.schedule_date\)/);
        assert.match(staffPage, /function scheduleShiftLoadMeta/);
        assert.match(staffPage, /scheduleShiftLoadFullShiftMinutes\(entry\)/);
        assert.match(staffPage, /bucket = 'half'/);
        assert.match(staffPage, /bucket = 'three-quarter'/);
        assert.match(staffPage, /bucket = 'long'/);
        assert.match(staffPage, /className: `shift-load-\$\{bucket\}`/);
        assert.match(staffPage, /class="sch-cell status-\$\{status\} \$\{loadClass\}/);
        assert.match(staffPage, /data-shift-load="\$\{loadMeta\.bucket \|\| ''\}"/);
        assert.match(staffPage, /scheduleShiftLoadMeta\(\{ \.\.\.entry, date, shift_start: shiftStart, shift_end: shiftEnd \}\)/);
        assert.match(staffPage, /scheduleShiftLoadMeta\(\{ \.\.\.entry, status, date \}\)/);
        assert.match(staffPage, /scheduleShiftLoadMeta\(\{ \.\.\.entry, status, date: ds, shift_start: shiftStart, shift_end: shiftEnd \}\)/);
        assert.doesNotMatch(staffPage, /class="sch-load-badge"/);
        assert.match(staffCss, /\.sch-cell \.sch-load-badge/);
        assert.match(staffCss, /display: none !important/);
        assert.match(staffCss, /\.sch-cell\[class\*="shift-load-"\]\s*\{/);
        assert.match(staffCss, /\.sch-cell\[class\*="shift-load-"\]::after\s*\{[\s\S]*content:\s*none;[\s\S]*display:\s*none;/);
        assert.doesNotMatch(staffCss, /--sch-load-(?:accent|border|bg|bg-soft|marker)/);
        assert.doesNotMatch(staffCss, /inset 0 -5px 0 var\(--sch-load-accent\)/);
        assert.doesNotMatch(staffCss, /\.sch-cell\.shift-load-(?:quarter|half|three-quarter|long|extra-long)[^{]*\{[\s\S]*background:/);
        assert.doesNotMatch(staffCss, /\.sch-cell\.shift-load-(?:quarter|half|three-quarter|long|extra-long) \.sch-time/);
        assert.doesNotMatch(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.schedule-table \.sch-cell\.shift-load-/);
        assert.doesNotMatch(staffCss, /\[data-theme="dark"\] body\[data-page-group="hr"\] \.schedule-table \.sch-cell\.shift-load-/);
    });
});
