const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

describe('backoffice foundation v2 contracts', () => {
    const centerRoute = readRepoFile('routes', 'center.js');
    const centerPage = readRepoFile('js', 'center-page.js');
    const centerHtml = readRepoFile('center.html');
    const productsRoute = readRepoFile('routes', 'products.js');
    const designsPage = readRepoFile('js', 'designs-page.js');
    const designsHtml = readRepoFile('designs.html');
    const staffPage = readRepoFile('js', 'staff-page.js');
    const staffHtml = readRepoFile('staff.html');
    const linesRoute = readRepoFile('routes', 'lines.js');
    const bookingService = readRepoFile('services', 'booking.js');
    const timelinePage = readRepoFile('js', 'timeline.js');
    const settingsPage = readRepoFile('js', 'settings.js');
    const sidebar = readRepoFile('js', 'components', 'sidebar.js');
    const sidebarAurora = readRepoFile('css', 'sidebar-aurora.css');
    const ui = readRepoFile('js', 'ui.js');
    const warehouseRoute = readRepoFile('routes', 'warehouse.js');
    const warehousePage = readRepoFile('js', 'warehouse-page.js');
    const warehouseHtml = readRepoFile('warehouse.html');
    const usersRoute = readRepoFile('routes', 'users.js');
    const staffRoute = readRepoFile('routes', 'staff.js');
    const employeesRoute = readRepoFile('routes', 'employees.js');
    const hrPage = readRepoFile('js', 'hr-page.js');
    const accountLinkingService = readRepoFile('services', 'accountLinking.js');
    const accountSecurityService = readRepoFile('services', 'accountSecurity.js');
    const migration = readRepoFile('db', 'migrations', '177_backoffice_foundation_v1.sql');
    const warehouseMultiMigration = readRepoFile('db', 'migrations', '184_warehouse_multi_location_contractors.sql');
    const chatUniqueMigration = readRepoFile('db', 'migrations', '164_chat_channel_provisioning_unique.sql');
    const productPriceMigration = readRepoFile('db', 'migrations', '180_product_price_rules.sql');

    it('keeps department work legacy-compatible when final source image is missing', () => {
        assert.match(staffPage, /function getDepartmentOptionsFromStaffState/);
        assert.match(staffPage, /StaffState\.departments/);
        assert.match(staffPage, /LEGACY_DEPARTMENT_FALLBACK/);
        assert.doesNotMatch(staffPage, /const DEPTS = \[/);
        assert.match(staffPage, /STAFF_ROLE_OPTIONS_BY_DEPT/);
        assert.match(staffPage, /dependsOn:\s*'department'/);
        assert.match(staffPage, /optionsBy:\s*STAFF_ROLE_OPTIONS_BY_DEPT/);
        assert.doesNotMatch(staffPage, /ROLE_HIERARCHY|PAGE_ACCESS|SIDEBAR_ACCESS/);
    });

    it('supports department-aware select options in the shared form modal without changing auth', () => {
        assert.match(ui, /dependsOn/);
        assert.match(ui, /optionsBy/);
        assert.match(ui, /parent\.addEventListener\('change', rebuild\)/);
        assert.match(ui, /renderSelectOptions/);
    });

    it('completes price center product linkage without requiring a fake pricing source', () => {
        assert.match(centerRoute, /router\.get\('\/prices\/positions'/);
        assert.match(centerRoute, /FROM products p[\s\S]*LEFT JOIN price_rules pr ON pr\.product_id = p\.id/);
        assert.match(centerRoute, /linkSource:\s*'price_rules\.product_id'/);
        assert.match(centerRoute, /const hasProductLinkUpdate/);
        assert.match(centerRoute, /SELECT id FROM products WHERE id = \$1/);
        assert.doesNotMatch(centerRoute, /priceCenterV2|pricingEngineV2/);

        assert.match(centerPage, /apiCenterPricePositions/);
        assert.match(centerPage, /appendPricePositionsPanel/);
        assert.match(centerPage, /createPriceForProduct/);
        assert.match(centerHtml, /price-position-panel/);
    });

    it('keeps design price sheet tied to Price Center instead of duplicated product prices', () => {
        assert.match(productsRoute, /LEFT JOIN LATERAL \([\s\S]*FROM price_rules pr[\s\S]*WHERE pr\.product_id = p\.id/);
        assert.match(productsRoute, /priceSource:\s*hasCenterPrice \? 'price_rules' : 'products'/);
        assert.match(productsRoute, /upsertProductPriceRule/);
        assert.match(productsRoute, /buildProductPriceRuleCode/);

        assert.match(designsPage, /function renderPriceSourceBadge/);
        assert.match(designsPage, /priceSource === 'price_rules'/);
        assert.match(designsPage, /Центр ціни є основним прайсом/);
        assert.match(designsPage, /Ярлик:/);

        assert.match(designsHtml, /price-source-strip/);
        assert.match(designsHtml, /price-source-badge/);

        assert.match(productPriceMigration, /MIGRATION_KIND: data-fix/);
        assert.match(productPriceMigration, /INSERT INTO price_rules[\s\S]*product_id/);
        assert.match(productPriceMigration, /updated_by='migration_180_product_price_rules'/);
    });

    it('keeps chat channel unique migration executable in PL/pgSQL', () => {
        assert.match(chatUniqueMigration, /FROM chat_channels[\s\S]*WHERE line_id IS NOT NULL[\s\S]*AND type = 'room'[\s\S]*GROUP BY line_id/);
        assert.match(chatUniqueMigration, /EXECUTE 'CREATE UNIQUE INDEX uniq_chat_channels_room_line_active[\s\S]*type = ''room''/);
    });

    it('keeps the schedule all-departments chip readable in dark theme', () => {
        assert.match(staffHtml, /body\.dark-mode \.dept-chip\[data-dept="all"\]\.active/);
        assert.match(staffHtml, /\[data-theme="dark"\] \.dept-chip\[data-dept="all"\]\.active/);
        assert.match(staffHtml, /color:\s*#F8FAFC/);
        assert.match(staffHtml, /hover[\s\S]*color:\s*#FFFFFF/);
    });

    it('opens the staff schedule on yesterday, today, and upcoming days', () => {
        assert.match(staffPage, /const STAFF_SCHEDULE_WINDOW_DAYS = 9/);
        assert.match(staffPage, /const STAFF_SCHEDULE_TODAY_OFFSET_DAYS = 1/);
        assert.match(staffPage, /function getScheduleFocusStart\(d\)/);
        assert.match(staffPage, /goToWeek\(getScheduleFocusStart\(new Date\(\)\)\)/);
        assert.match(staffPage, /StaffState\.weekStart = getScheduleFocusStart\(new Date\(\)\)/);
        assert.match(staffPage, /getScheduleRangeEnd\(dates\)/);
        assert.doesNotMatch(staffPage, /dates\[6\]/);
        assert.match(staffHtml, /Вчора, сьогодні і найближчі дні/);
    });

    it('uses animator shifts as the timeline line source of truth', () => {
        assert.match(bookingService, /function getScheduledAnimatorLines/);
        assert.match(bookingService, /FROM staff_schedule ss[\s\S]*JOIN staff s ON s\.id = ss\.staff_id/);
        assert.match(bookingService, /ss\.status IN \('working', 'remote'\)/);
        assert.match(bookingService, /s\.department = 'animators'/);
        assert.match(bookingService, /s\.role_type = 'animator'/);
        assert.match(bookingService, /COALESCE\(s\.is_freelance, false\) = true/);
        assert.doesNotMatch(bookingService, /s\.department = 'animators'\s+OR\s+s\.role_type = 'animator'/);
        assert.match(bookingService, /INSERT INTO lines_by_date[\s\S]*ON CONFLICT \(business_context, date, line_id\)/);
        assert.match(bookingService, /function cleanupLegacyDefaultAnimatorLines/);
        assert.match(bookingService, /LOWER\(TRIM\(l\.name\)\) ~ '\^аніматор\[\[:space:\]\]\+\[0-9\]\+\$'/);
        assert.match(bookingService, /NOT EXISTS \([\s\S]*FROM bookings b[\s\S]*b\.status != 'cancelled'/);
        assert.match(bookingService, /NOT EXISTS \([\s\S]*FROM afisha a/);
        assert.match(linesRoute, /syncScheduledAnimatorLines\(date\)/);
        assert.match(linesRoute, /X-Timeline-Lines-Source/);
        assert.match(timelinePage, /function getLineSubtitle/);
        assert.match(timelinePage, /зі зміни/);
    });

    it('filters the timeline edit-line picker to active regular or freelance animators', () => {
        const populateSelect = settingsPage.match(/async function populateAnimatorsSelect[\s\S]*?\n\}/)?.[0] || '';
        assert.match(settingsPage, /function isTimelineAnimatorStaff/);
        assert.match(settingsPage, /fetch\(`\$\{API_BASE\}\/staff\?active=true`/);
        assert.match(settingsPage, /role === 'animator'/);
        assert.match(settingsPage, /position\.includes\('аніматор'\)/);
        assert.match(settingsPage, /isAnimatorFreelance/);
        assert.match(settingsPage, /await getTimelineAnimatorStaffOptions\(\)/);
        assert.doesNotMatch(populateSelect, /getSavedAnimators\(\)/);
        assert.doesNotMatch(populateSelect, /поточна лінія/);
    });

    it('keeps sidebar menu clicks from drawing the floating active frame', () => {
        assert.match(sidebar, /function _ensureActiveIndicator\(\) \{[\s\S]*sidebarActiveIndicator'\)\?\.remove\(\);[\s\S]*\}/);
        assert.match(sidebar, /function _updateActiveIndicator\(\) \{[\s\S]*indicator\.remove\(\);[\s\S]*\}/);
        assert.match(sidebarAurora, /\.sidebar-active-indicator \{[\s\S]*display:\s*none !important/);
        assert.match(sidebarAurora, /\.sidebar-active-indicator\.visible \{[\s\S]*opacity:\s*0/);
    });

    it('keeps warehouse owner partition while declaring location transfer truth', () => {
        assert.match(warehouseRoute, /const VALID_OWNERS = \['park', 'dar', 'shared'\]/);
        assert.match(warehouseRoute, /warehouseMode/);
        assert.match(warehouseRoute, /transferSemantics:\s*'warehouse_stock_movements'/);
        assert.match(warehouseRoute, /COALESCE\(owner, 'park'\) =/);
        assert.match(warehousePage, /OWNER_LABELS/);
        assert.match(warehousePage, /getOwnerLabel/);
        assert.match(warehouseHtml, /wh-owner-badge/);
        assert.match(warehouseRoute, /router\.post\('\/stock\/:id\/transfer'/);
        assert.match(warehouseMultiMigration, /CREATE TABLE IF NOT EXISTS warehouse_locations/);
        assert.match(warehouseMultiMigration, /CREATE TABLE IF NOT EXISTS warehouse_stock_movements/);
        assert.doesNotMatch(migration, /CREATE TABLE\s+(IF NOT EXISTS\s+)?warehouses\b/i);
    });

    it('routes account and staff binding through one safe linkage contract', () => {
        assert.match(accountLinkingService, /async function linkUserToStaffProfile/);
        assert.match(accountLinkingService, /async function unlinkStaffAccount/);
        assert.match(accountLinkingService, /async function unlinkUserFromStaffProfiles/);
        assert.match(accountLinkingService, /function oneTimeCredential/);
        assert.match(accountLinkingService, /async function verifyIssuedCredential/);
        const oneTimeChars = accountLinkingService.match(/const chars = '([^']+)'/)?.[1] || '';
        assert.ok(oneTimeChars && !/[ILO0l1]/.test(oneTimeChars), 'one-time passwords avoid visually ambiguous characters');
        assert.match(accountLinkingService, /async function getAccountLinkConflicts/);
        assert.match(accountLinkingService, /staff_already_linked/);
        assert.match(accountSecurityService, /delete clone\.manualPassword/);

        assert.match(usersRoute, /router\.get\('\/link-conflicts'/);
        assert.match(usersRoute, /linkUserToStaffProfile/);
        assert.match(usersRoute, /unlinkUserFromStaffProfiles/);
        assert.match(usersRoute, /password_one_time_reissued/);
        assert.match(usersRoute, /credential:\s*issueOneTime \?/);
        assert.match(usersRoute, /function resetPasswordFromPayload/);
        assert.match(usersRoute, /body\.newPassword,\s*body\.password,\s*body\.manualPassword/);
        assert.match(usersRoute, /function shouldActivateAfterPasswordReset/);
        assert.match(usersRoute, /activateOnReset/);
        assert.match(usersRoute, /is_active = CASE WHEN \$3::boolean THEN true ELSE is_active END/);
        assert.match(usersRoute, /activatedByReset/);
        assert.match(usersRoute, /password_hash_verified_after_reset_failed/);
        assert.match(usersRoute, /password_hash_verified_after_create_failed/);
        assert.match(usersRoute, /password_login_ready_check_failed_after_reset/);
        assert.match(usersRoute, /password_login_ready_check_failed_after_create/);
        assert.match(usersRoute, /loginReady/);
        assert.match(usersRoute, /loginAliases/);

        assert.match(staffRoute, /staff_overlay_account_linked/);
        assert.match(staffRoute, /bulk_account_created_with_staff_link/);
        assert.match(staffRoute, /bulk_account_login_ready_check_failed/);
        assert.match(staffRoute, /credentialsPolicy/);
        assert.match(staffRoute, /router\.post\('\/bulk-pdf'[\s\S]*res\.status\(410\)/);
        assert.match(staffRoute, /function staffRoleToAccountRole/);

        assert.match(employeesRoute, /employee_profile_account_linked/);
        assert.match(employeesRoute, /employee_profile_account_unlinked/);

        assert.match(hrPage, /function renderAccountConflictSummary/);
        assert.match(hrPage, /openAccountCreateForStaff/);
        assert.match(hrPage, /openAccountLinkForStaff/);
        assert.match(hrPage, /showOneTimeCredentialModal/);
        assert.match(hrPage, /user\.is_active === false/);
        assert.match(hrPage, /activateOnReset/);
        assert.match(hrPage, /showOneTimeCredentialModal\(response\.credential,[\s\S]*response\)/);
        assert.match(hrPage, /showManualPasswordResetResult/);
        assert.match(hrPage, /Логін для входу/);
        assert.match(staffPage, /createAccountForLinkingStaff/);
        assert.match(staffPage, /data-linked-user/);
        assert.match(staffHtml, /linkCreateAccountBtn/);
        assert.match(staffHtml, /bulkCsvBtn" class="btn-page-secondary hidden/);
    });
});
