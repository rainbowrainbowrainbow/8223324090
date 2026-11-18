'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { chromium } = require('../helpers/playwright')();
const { assertSafeTestDatabaseUrl, assertSafeIsolatedTestUrl } = require('../../scripts/test-db-safety');
const profiles = require('../../services/hrPayrollProfiles');

async function run() {
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, { ...process.env, DATABASE_URL: '' });
    assert.equal(target.isLocal, true);
    const base = assertSafeIsolatedTestUrl(process.env.TEST_URL);
    const db = new Pool({ connectionString: target.url.toString(), ssl: false });
    const out = process.env.PAY_RULES_BROWSER_OUTPUT
        ? path.resolve(process.env.PAY_RULES_BROWSER_OUTPUT)
        : path.resolve(__dirname, '../../output/playwright/payroll-configurable-rules');
    fs.mkdirSync(out, { recursive: true });
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(new Date());
    const month = date.slice(0, 7);
    const profession = 'pay_browser_' + process.pid;
    const actor = { username: 'synthetic_pay_browser' };
    let browser, stage = 'fixture';
    try {
        await db.query('INSERT INTO hr_professions(key,title,department) VALUES($1,$2,$3)', [profession, 'Synthetic compensation profession', 'Аніматори']);
        const staffId = Number((await db.query(`INSERT INTO staff(name,department,position,role_type,hourly_rate,rate_unit,is_active,hire_date)
            VALUES('Synthetic compensation browser','animators','Synthetic',$1,100,'hour',true,'2020-01-01') RETURNING id`, [profession])).rows[0].id);
        const rules = { schemaVersion: 1, daily: { mode: 'proportional', fullDayMinutes: 600 }, note: 'Чайові не входять до нарахування', components: [
            { id: 'advertising', title: 'Реклама', kind: 'monthly', amount: 3500, monthly: { mode: 'fixed', partialMonth: 'calendar_days' } },
            { id: 'own', title: 'Власні оформлення', kind: 'percent', percent: 4, basisKey: 'own_bookings' },
            { id: 'other', title: 'Оформлення інших менеджерів', kind: 'percent', percent: 1, basisKey: 'other_bookings' }
        ] };
        const profile = await profiles.createPayrollProfile({ title: 'Synthetic browser base', professionKey: profession, profileKind: 'shared',
            isDefaultForProfession: true, status: 'active', rateUnit: 'day', defaultRate: 600, effectiveFrom: '2020-01-01', payRules: rules }, actor, { db });
        const menuProfile = await profiles.createPayrollProfile({ title: 'Synthetic menu level 400', professionKey: profession, profileKind: 'shared',
            status: 'active', rateUnit: 'day', defaultRate: 400, effectiveFrom: '2020-01-01', payRules: { schemaVersion: 1, daily: { mode: 'per_exit' } } }, actor, { db });
        const vacancyId = Number((await db.query(`INSERT INTO job_vacancies(title,role_type,department,business_context,compensation_template)
            VALUES('Synthetic compensation vacancy',$1,'animators','event_genix',$2::jsonb) RETURNING id`, [profession,
            JSON.stringify({ schemaVersion: 1, rateUnit: 'month', defaultRate: 19000, payRules: { schemaVersion: 1, monthly: { mode: 'fixed' } } })])).rows[0].id);
        const applicationId = Number((await db.query(`INSERT INTO job_applications(vacancy_id,name,status)
            VALUES($1,'Synthetic compensation hire','offer') RETURNING id`, [vacancyId])).rows[0].id);
        // Same synthetic membership fixture as the existing actual-app HR pay gate.
        const userId = Number((await db.query('SELECT id FROM users WHERE username=$1', [process.env.TEST_USER])).rows[0].id);
        const organizationId = Number((await db.query(`INSERT INTO organizations(slug,name)
            VALUES('synthetic-configurable-pay','Synthetic configurable compensation') RETURNING id`)).rows[0].id);
        const businessId = Number((await db.query(`INSERT INTO businesses(organization_id,context_key,label,short_label,access_mode)
            VALUES($1,'event_genix','Synthetic Park','Synthetic','membership') RETURNING id`, [organizationId])).rows[0].id);
        await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'owner')`, [organizationId, userId]);
        await db.query(`INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default)
            VALUES($1,$2,$3,'creator',true)`, [businessId, organizationId, userId]);
        const loginResponse = await fetch(new URL('/api/auth/login', base), { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: process.env.TEST_USER, password: process.env.TEST_PASS }) });
        assert.equal(loginResponse.status, 200);
        const auth = await loginResponse.json();
        assert.equal(auth.user.membershipMode, 'membership');
        const accessPending = process.env.PAY_RULES_VERIFY_ACCESS_BARRIER === 'true';
        const workspaceAccess = await fetch(new URL(`/api/hr/staff/${staffId}/payroll-rules?businessContext=park&asOfDate=${date}`, base), {
            headers: { Authorization: 'Bearer ' + (auth.accessToken || auth.token) }
        });
        assert.equal(workspaceAccess.status, accessPending ? 403 : 200, 'Exact rule operation mapping controls access');
        const launch = fs.existsSync(chromium.executablePath()) ? {} : { channel: 'msedge' };
        browser = await chromium.launch({ headless: true, ...launch });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'uk-UA' });
        // Match the existing onboarding fixture: payroll checks never exercise
        // third-party telemetry, but still fail on every application page error.
        await context.route('https://www.clarity.ms/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
        await context.addInitScript(auth => {
            localStorage.setItem('pzp_token', auth.accessToken || auth.token);
            localStorage.setItem('pzp_access_token', auth.accessToken || auth.token);
            localStorage.setItem('pzp_current_user', JSON.stringify(auth.user));
            localStorage.setItem('pzp_crm_business_context', 'park');
            localStorage.setItem('pzp_crm_business_context_user', String(auth.user.id || auth.user.username));
            if (auth.refreshToken) localStorage.setItem('pzp_refresh_token', auth.refreshToken);
        }, auth);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => { errors.push(error.message); console.error('[pay-rules-browser] ' + error.stack); });
        const activeModal = () => page.locator('.confirm-overlay:not(.confirm-exit)').last();
        const submit = () => activeModal().locator('.confirm-ok').click();
        const fill = (key, value) => activeModal().locator('#fm_' + key).fill(String(value));
        const select = (key, value) => activeModal().locator('#fm_' + key).selectOption(String(value));
        const screenshot = async name => {
            await page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 12000 });
            assert.ok(await activeModal().evaluate(el => el.scrollWidth <= window.innerWidth + 1), 'Modal must fit viewport');
            await activeModal().locator('.form-modal-fields').evaluate(el => { el.scrollTop = 0; });
            await activeModal().screenshot({ path: path.join(out, name + '.png') });
        };
        stage = 'employee navigation';
        const staffLoaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/hr/staff' && response.request().method() === 'GET');
        await page.goto(new URL('/hr?businessContext=park&businessScope=single#workers', base).href, { waitUntil: 'domcontentloaded' });
        const staffResponse = await staffLoaded;
        const staffPayload = await staffResponse.json();
        if (staffResponse.status() !== 200) {
            const scopeHeaders = Object.fromEntries(Object.entries(staffResponse.request().headers()).filter(([key]) => key.startsWith('x-business')));
            console.error('Synthetic browser scope diagnostics: ' + JSON.stringify({ scopeHeaders,
                business: await page.evaluate(() => ({ context: getCrmBusinessContext(), scope: getCrmBusinessScope() })) }));
        }
        assert.equal(staffResponse.status(), 200, 'Staff API: ' + (staffPayload.code || staffPayload.error || 'unknown'));
        assert.ok(staffPayload.data.some(item => Number(item.id) === staffId), 'Own synthetic staff must be returned');
        await page.locator('#teamSearch').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForFunction(() => teamLoadState.status === 'success');
        await page.locator('#teamSearch').fill('Synthetic compensation browser');
        const card = page.locator(`[data-staff-id="${staffId}"]`);
        await card.locator('.hr-team-name-action').click();
        await page.locator('#staffProfileTabPayroll').click();
        await page.locator('[data-staff-payroll-profile-action="rules-workspace"]').waitFor();
        const workspace = async action => {
            await page.locator('[data-staff-payroll-profile-action="rules-workspace"]').click();
            await select('action', action);
            await submit();
        };
        if (!accessPending) {
        stage = 'company default template';
        await workspace('default'); await select('rateUnit', 'month'); await fill('defaultRate', 24000);
        await select('payMonthPartial', 'calendar_days'); await fill('reason', 'Synthetic company default policy');
        await screenshot('company-default-desktop');
        const defaultSaved = page.waitForResponse(response => response.url().includes('/payroll-rules/defaults') && response.request().method() === 'POST');
        await submit(); assert.equal((await defaultSaved).status(), 200);
        assert.equal(Number((await db.query('SELECT template FROM hr_payroll_rule_defaults WHERE profession_key=$1', [profession])).rows[0].template.defaultRate), 24000);
        stage = 'own commission base';
        await workspace('own_bookings');
        await fill('month', month); await submit();
        await fill('amount', 10000); await select('confirmed', 'yes'); await fill('reason', 'Synthetic confirmed own base');
        await screenshot('commission-base-desktop');
        const ownSaved = page.waitForResponse(response => response.url().includes('/payroll-rules/component-input') && response.request().method() === 'PUT');
        await submit(); assert.equal((await ownSaved).status(), 200);
        stage = 'other commission base';
        await workspace('other_bookings'); await fill('month', month); await submit();
        await fill('amount', 20000); await select('confirmed', 'yes'); await fill('reason', 'Synthetic confirmed other base');
        const otherSaved = page.waitForResponse(response => response.url().includes('/payroll-rules/component-input') && response.request().method() === 'PUT');
        await submit(); assert.equal((await otherSaved).status(), 200);
        const inputs = await db.query('SELECT basis_key,amount FROM hr_payroll_component_inputs WHERE staff_id=$1 ORDER BY basis_key', [staffId]);
        assert.equal(inputs.rows.length, 2);
        assert.equal(Number(inputs.rows.find(row => row.basis_key === 'own_bookings').amount), 10000);
        stage = 'create and select level';
        await workspace('add_level');
        await fill('title', 'Здав меню — Synthetic'); await fill('rank', 1); await select('profileId', menuProfile.id);
        const levelSaved = page.waitForResponse(response => response.url().includes('/payroll-rules/levels') && response.request().method() === 'POST');
        await submit(); assert.equal((await levelSaved).status(), 200);
        await workspace('change');
        await select('payDecision', 'use_level'); await fill('effectiveFrom', date); await fill('reason', 'Synthetic menu assessment passed');
        await screenshot('level-transition-desktop');
        const promoted = page.waitForResponse(response => response.url().includes('/payroll-rules/qualification') && response.request().method() === 'POST');
        await submit(); assert.equal((await promoted).status(), 200);
        assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM hr_staff_qualification_events WHERE staff_id=$1', [staffId])).rows[0].count, 1);
        }
        const editedProfileId = accessPending ? profile.id : menuProfile.id;
        stage = 'fixed monthly form and mobile';
        await page.locator('[data-staff-payroll-profile-action="change"]').click();
        await activeModal().getByRole('button', { name: 'Продовжити', exact: true }).click();
        await select('rateUnit', 'month'); await fill('defaultRate', 19000); await select('payRuleSelection', 'configured');
        await select('payMonthMode', 'fixed'); await select('payMonthPartial', 'calendar_days');
        await fill('changeReason', 'Synthetic fixed monthly terms');
        await screenshot('fixed-month-desktop');
        await page.setViewportSize({ width: 390, height: 844 });
        await screenshot('fixed-month-mobile');
        await activeModal().locator('#fm_defaultRate').focus();
        await page.keyboard.press('Tab');
        assert.ok(await activeModal().evaluate(el => el.contains(document.activeElement)), 'Keyboard focus remains in the form');
        const versionSaved = page.waitForResponse(response => response.url().includes(`/payroll-profiles/${editedProfileId}/versions`) && response.request().method() === 'POST');
        await submit(); assert.equal((await versionSaved).status(), 201);
        const version = (await db.query('SELECT rate_unit,default_rate,pay_rules FROM payroll_profile_versions WHERE profile_id=$1 ORDER BY version_number DESC LIMIT 1', [editedProfileId])).rows[0];
        assert.equal(version.rate_unit, 'month'); assert.equal(Number(version.default_rate), 19000); assert.equal(version.pay_rules.monthly.mode, 'fixed');
        if (!accessPending) {
        stage = 'vacancy pay template';
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.locator('#editCloseTop').click();
        await page.locator('#staffEditModal').waitFor({ state: 'hidden' });
        await page.goto(new URL('/hr#vacancies', base).href, { waitUntil: 'domcontentloaded' });
        await page.locator(`[data-vacancy-pay-rules="${vacancyId}"]`).click();
        await fill('defaultRate', 20000); await fill('reason', 'Synthetic vacancy terms update');
        await screenshot('vacancy-month-desktop');
        const vacancySaved = page.waitForResponse(response => response.url().includes(`/vacancies/${vacancyId}/payroll-template`) && response.request().method() === 'PUT');
        await submit(); assert.equal((await vacancySaved).status(), 200);
        assert.equal((await db.query('SELECT compensation_template FROM job_vacancies WHERE id=$1', [vacancyId])).rows[0].compensation_template.defaultRate, 20000);
        stage = 'reviewed vacancy hire';
        await activeModal().waitFor({ state: 'hidden' });
        await page.locator('.hr-vacancy-card').filter({ has: page.locator(`[data-vacancy-pay-rules="${vacancyId}"]`) }).locator('.vac-title').click();
        await page.locator('.kanban-card').filter({ hasText: 'Synthetic compensation hire' }).getByRole('button', { name: 'Найняти', exact: true }).click();
        await select('applyCompensation', 'yes'); await fill('compensationRate', 20000);
        await fill('compensationDate', date); await fill('compensationReason', 'Synthetic reviewed vacancy copy');
        await select('startOnboarding', 'no'); await select('vacancyAction', 'keep_open');
        await screenshot('reviewed-hire-desktop');
        const hireSaved = page.waitForResponse(response => response.url().includes(`/applications/${applicationId}/hire`) && response.request().method() === 'POST');
        await submit(); assert.equal((await hireSaved).status(), 200);
        const hire = (await db.query('SELECT staff_id,status FROM job_applications WHERE id=$1', [applicationId])).rows[0];
        assert.equal(hire.status, 'hired'); assert.ok(Number(hire.staff_id) > 0);
        const inherited = (await db.query(`SELECT p.template_origin,v.rate_unit,v.default_rate,v.pay_rules
            FROM payroll_profiles p JOIN payroll_profile_versions v ON v.profile_id=p.id
            WHERE p.owner_staff_id=$1`, [hire.staff_id])).rows[0];
        assert.equal(inherited.template_origin.vacancyId, vacancyId);
        assert.equal(inherited.rate_unit, 'month'); assert.equal(Number(inherited.default_rate), 20000);
        assert.equal(inherited.pay_rules.monthly.mode, 'fixed');
        }
        assert.equal(errors.length, 0, errors.join('\n'));
        fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ status: accessPending ? 'ACCESS_BLOCKED_UI_PARTIAL' : 'PASS', membershipMode: auth.user.membershipMode,
            screenshots: accessPending ? ['fixed-month-desktop', 'fixed-month-mobile'] : ['company-default-desktop', 'commission-base-desktop', 'level-transition-desktop', 'fixed-month-desktop', 'fixed-month-mobile', 'vacancy-month-desktop', 'reviewed-hire-desktop'],
            checks: accessPending ? ['expected rule workspace 403', 'real employee navigation', 'fixed monthly save', 'mobile overflow and keyboard'] : ['real employee navigation', 'scoped company default', 'manual own/other bases', 'level create/promotion', 'fixed monthly save', 'mobile overflow and keyboard', 'vacancy template save', 'reviewed vacancy hire with immutable personal copy'],
            productionWrites: 0 }, null, 2));
        console.log(accessPending ? 'Partial actual-app browser checks completed; full rule workspace remains blocked by the unchanged access map.' : 'Configurable compensation actual-app browser journey PASS (membership mode).');
    } catch (error) {
        console.error(`Compensation browser stage failed: ${stage}: ${error.message}`);
        throw error;
    } finally { await browser?.close(); await db.end(); }
}
run().catch(() => { process.exitCode = 1; });
