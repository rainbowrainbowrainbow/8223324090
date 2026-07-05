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
        assert.match(staffPage, /healthFilter:\s*'all'/);
        assert.match(staffPage, /scheduleRawEntries:\s*\[\]/);
        assert.match(staffPage, /const SCHEDULE_HEALTH_FILTERS = \['all', 'critical', 'warning', 'ok'\]/);
        assert.match(staffPage, /const SCHEDULE_HEALTH_DEPARTMENT_MIN_WORKING/);
        assert.match(staffPage, /function buildScheduleHealth/);
        assert.match(staffPage, /function scheduleHealthScore/);
        assert.match(staffPage, /function renderScheduleHealthPanel/);
        assert.match(staffPage, /function renderScheduleHealthBadges/);
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
        assert.match(staffPage, /const health = buildScheduleHealth\(dates, baseFiltered\)/);
        assert.match(staffPage, /const filtered = scheduleHealthFilteredStaff\(baseFiltered, health\)/);
        assert.match(staffPage, /renderScheduleHealthPanel\(health\)/);
        assert.match(staffPage, /renderSummary\(filtered\)/);
        assert.match(staffPage, /renderEmpRow\(emp, dates, today, health\)/);
        assert.match(staffPage, /class="sch-cell status-\$\{status\} \$\{loadClass\}[\s\S]*\$\{cellHealthClass\} \$\{attendanceClass\}"/);
        assert.match(staffPage, /bindScheduleHealthDetailButtons\(tbody\)/);
        assert.match(staffPage, /event\.stopPropagation\(\)/);
        assert.match(staffScheduleShell, /id="scheduleHealthPanel"/);
        assert.match(staffCss, /\.schedule-health-panel/);
        assert.match(staffCss, /\.schedule-health-score/);
        assert.match(staffCss, /\.schedule-health-filter/);
        assert.match(staffCss, /\.schedule-health-badge/);
        assert.match(staffCss, /\.sch-cell\.has-health-critical/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.schedule-health-panel/);
    });

    it('adds passive staffing demand forecast from bookings without auto-scheduling', () => {
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
        assert.match(staffPage, /const forecast = buildStaffingDemandForecast\(dates, baseFiltered\)/);
        assert.match(staffPage, /StaffState\.staffingForecast = forecast/);
        assert.match(staffPage, /renderStaffingForecastPanel\(forecast\)/);
        assert.match(staffPage, /await fetchStaffingForecastBookings\(from, to\)/);
        const forecastFetchBlock = staffPage.match(/async function fetchStaffingForecastBookings[\s\S]*?async function postAttendanceAction/)?.[0] || '';
        assert.doesNotMatch(forecastFetchBlock, /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/);
        assert.doesNotMatch(forecastFetchBlock, /\/api\/staff\/schedule/);
        assert.match(staffScheduleShell, /id="scheduleForecastPanel"/);
        assert.match(staffCss, /\.schedule-forecast-panel/);
        assert.match(staffCss, /\.forecast-day-card/);
        assert.match(staffCss, /\.forecast-gap-chip\.is-missing/);
        assert.match(staffCss, /\.forecast-rules/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.schedule-forecast-panel/);
    });

    it('adds read-only manager accountability without fake unavailable metrics or new protected surfaces', () => {
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
        assert.match(staffPage, /const accountability = buildManagerAccountability\(dates, baseFiltered, health\)/);
        assert.match(staffPage, /StaffState\.managerAccountability = accountability/);
        assert.match(staffPage, /renderManagerAccountabilityPanel\(accountability\)/);
        assert.match(staffPage, /data-accountability-filter="department"/);
        assert.match(staffPage, /data-accountability-filter="manager"/);
        assert.match(staffPage, /data-accountability-dept/);
        assert.match(staffPage, /href="\/reports\.html"/);
        assert.match(staffPage, /href="\/hr\.html"/);
        assert.doesNotMatch(staffPage, /\/api\/manager-accountability|\/api\/accountability/);
        assert.doesNotMatch(staffPage, /CREATE TABLE|ALTER TABLE|INSERT INTO manager|UPDATE manager/);
        assert.match(staffScheduleShell, /id="managerAccountabilityPanel"/);
        assert.match(staffCss, /\.manager-accountability-panel/);
        assert.match(staffCss, /\.accountability-table/);
        assert.match(staffCss, /\.accountability-metric\.is-unavailable/);
        assert.match(staffCss, /\.accountability-manager-row/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.manager-accountability-panel/);
    });

    it('links schedule plans to payroll-ready attendance without adding a new data model', () => {
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
        assert.match(staffPage, /function scheduleVisibleStaff\(staffList = StaffState\.staff\) \{[\s\S]*scheduleDisplayDepartmentKey\(staff\) === StaffState\.activeDept[\s\S]*\}/);
        assert.match(staffPage, /function legacyScheduleDisplayDepartmentKey\(staff = \{\}\)/);
        assert.match(staffPage, /function scheduleDepartmentOptions\(\) \{[\s\S]*scheduleDisplayDepartmentKey\(staff\)[\s\S]*scheduleDisplayGroupOrder\(\)/);
        assert.match(staffPage, /function scheduleDepartmentRenderOrder\(grouped = \{\}\) \{[\s\S]*scheduleDisplayGroupOrder\(\)\.filter\(key => grouped\[key\]\)/);
        assert.match(staffPage, /if \(StaffState\.activeDept !== 'all' && !options\.some\(option => option\.value === StaffState\.activeDept\)\) \{[\s\S]*StaffState\.activeDept = 'all'/);
        assert.match(staffPage, /function openFillWeekModal\(\) \{[\s\S]*const filtered = scheduleVisibleStaff\(\)/);
        assert.match(staffPage, /if \(staffValue === 'all'\) \{[\s\S]*targetStaff = scheduleVisibleStaff\(\)/);
        assert.match(staffPage, /function renderLoadView\(\) \{[\s\S]*const filtered = scheduleVisibleStaff\(\)/);
        assert.match(staffPage, /groupStaffByScheduleDepartment\(StaffState\.staff\)/);
        assert.match(staffPage, /function handleExcelExport\(\) \{[\s\S]*const grouped = groupStaffByScheduleDepartment\(StaffState\.staff\)/);
        assert.match(staffPage, /function handleExcelExport\(\) \{[\s\S]*const deptLabel = scheduleDisplayDepartmentLabel\(dept\)/);
        assert.match(staffPage, /const SCHEDULE_COPY_RAW_DEPARTMENT_SAFE = new Set\(\['animators', 'trampoline', 'cafe', 'cleaning'\]\)/);
        assert.match(staffPage, /const SCHEDULE_COPY_EXPLICIT_STAFF_CATEGORIES = new Set\(\['reception', 'tech', 'admin'\]\)/);
        assert.match(staffPage, /function scheduleCopyWeekModeForDepartment/);
        assert.match(staffPage, /function scheduleCopyWeekVisibleStaffIds/);
        assert.match(staffPage, /function scheduleCopyWeekPayload/);
        assert.match(staffPage, /body\.department = department/);
        assert.match(staffPage, /body\.staffIds = scheduleCopyWeekVisibleStaffIds\(\)/);
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
        assert.match(staffPage, /function staffMatchesAnyDepartmentSubGroup/);
        assert.match(staffPage, /deptStaff\.filter\(s => !staffMatchesAnyDepartmentSubGroup\(s, subGroups\)\)/);
        assert.match(staffPage, /placeholder:\s*'host, trampoline_instructor'/);
        assert.doesNotMatch(staffPage, /placeholder:\s*'host, instructor'/);
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
    it('marks partial shifts with durable load classes and theme-safe colors', () => {
        assert.match(staffPage, /const STAFF_FULL_SHIFT_MINUTES = 8 \* 60/);
        assert.match(staffPage, /function scheduleShiftLoadMeta/);
        assert.match(staffPage, /bucket = 'half'/);
        assert.match(staffPage, /bucket = 'three-quarter'/);
        assert.match(staffPage, /bucket = 'long'/);
        assert.match(staffPage, /className: `shift-load-\$\{bucket\}`/);
        assert.match(staffPage, /class="sch-cell status-\$\{status\} \$\{loadClass\}/);
        assert.match(staffPage, /data-shift-load="\$\{loadMeta\.bucket \|\| ''\}"/);
        assert.doesNotMatch(staffPage, /class="sch-load-badge"/);
        assert.match(staffCss, /\.sch-cell \.sch-load-badge/);
        assert.match(staffCss, /display: none !important/);
        assert.match(staffCss, /--sch-load-marker/);
        assert.match(staffCss, /--sch-load-bg/);
        assert.match(staffCss, /\.sch-cell\[class\*="shift-load-"\]::after/);
        assert.match(staffCss, /\.sch-cell\.shift-load-half/);
        assert.match(staffCss, /\.sch-cell\.shift-load-three-quarter/);
        assert.match(staffCss, /\.sch-cell\.shift-load-long/);
        assert.match(staffCss, /\.sch-cell\.shift-load-full::after/);
        assert.match(staffCss, /display: none;/);
        assert.match(staffCss, /body\.dark-mode\[data-page-group="hr"\] \.schedule-table \.sch-cell\.shift-load-half/);
        assert.match(staffCss, /\[data-theme="dark"\] body\[data-page-group="hr"\] \.schedule-table \.sch-cell\.shift-load-three-quarter/);
    });
});
