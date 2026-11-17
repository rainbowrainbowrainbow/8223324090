'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installHarness } = require('./hr-team-browser-smoke');
const { requirePlaywright } = require('./timeline-room-summary-browser-smoke');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/hr-team-ux');
const markup = fs.readFileSync(path.join(root, 'hr.html'), 'utf8');
const styles = [...markup.matchAll(/href="(css\/[^"?]+\.css)/g)]
    .map(match => fs.readFileSync(path.join(root, match[1]), 'utf8')).join('\n');

async function checkCreation(page, width, dark) {
    await installHarness(page);
    await page.locator('head style').evaluate((el, css) => { el.textContent = css; }, styles);
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(({ markup, dark }) => {
        document.body.classList.toggle('dark-mode', dark);
        if (dark) document.documentElement.dataset.theme = 'dark';
        const parsed = new DOMParser().parseFromString(markup, 'text/html');
        for (const id of ['hrNewStaffFields', 'hrCreateStaffDialog']) document.body.append(parsed.getElementById(id));
        for (const id of ['tab-professions', 'professionWorkspaceOverlay']) {
            document.body.append(parsed.getElementById(id));
        }
        const button = document.createElement('button');
        button.id = 'hrCreateStaffBtn';
        button.textContent = 'Додати співробітника';
        document.body.append(button);
        teamStaff = [
            { id: 1, name: 'Тестовий працівник', department: 'Кафе', position: 'Офіціант' },
            { id: 2, name: 'Тестовий бариста', department: 'Кафе', position: 'Бариста' }
        ];
        hrProfessions = [
            { key: 'waiter', title: 'Офіціант', department: 'Кафе' },
            { key: 'barista', title: 'Бариста', department: 'cafe' },
            { key: 'animator', title: 'Аніматор', department: 'Арт-відділ' },
            { key: 'pizzaiolo', title: 'Піцайоло', department: 'kitchen' }
        ];
        document.getElementById('tab-professions').classList.add('active');
        bindProfessionWorkspaceControls();
        renderProfessionCatalogFilterOptions();
        renderProfessions();
        ensureProfessionsLoaded = async () => hrProfessions;
        recoverStaffCreation = async () => null;
        submitStaffCreation = async (_kind, body) => {
            window.__uxSubmission = body;
            return { result: { success: false, error: 'Synthetic save captured' } };
        };
        bindHrStaffCreation();
    }, { markup, dark });
    const filter = page.locator('#professionCatalogDepartment');
    assert.equal(await filter.locator('option').filter({ hasText: /^Кафе$/ }).count(), 1);
    await filter.selectOption({ label: 'Кафе' });
    const rows = page.locator('#professionCatalogList .hr-profession-master-row');
    assert.equal(await rows.count(), 2);
    const search = page.getByRole('searchbox', { name: 'Пошук посад' });
    await search.fill('Бариста');
    assert.equal(await rows.count(), 1);
    assert.match(await rows.first().textContent(), /Бариста.*Кафе/s);
    await page.locator('#tab-professions').screenshot({ path: path.join(output, `departments-${width}-${dark ? 'dark' : 'light'}.png`) });
    await page.locator('#hrCreateStaffBtn').click();
    const dialog = page.locator('#hrCreateStaffDialog');
    await dialog.locator('[name="family_name"]').fill('Тестова');
    await dialog.locator('[name="given_name"]').fill('Картка');
    await dialog.locator('[name="phone"]').fill('+380671234567');
    await dialog.locator('[name="department"]').focus();
    assert.equal(await dialog.locator('[name="phone"]').inputValue(), '+380 67 123 45 67');
    await dialog.locator('[name="department"]').selectOption({ label: 'Кухня' });
    assert.equal(await dialog.locator('[name="position"] option[value="pizzaiolo"]').textContent(), 'Кухар піци');
    await dialog.locator('[name="department"]').selectOption({ label: 'Кафе' });
    assert.equal(await dialog.locator('[name="department"] option').filter({ hasText: /^Кафе$/ }).count(), 1);
    assert.equal(await dialog.locator('[name="position"] option[value="barista"]').count(), 1);
    await dialog.locator('[name="position"]').selectOption('waiter');
    assert.equal(await dialog.locator('[name="position"] option[value="animator"]').count(), 0);
    await dialog.locator('[name="department"]').selectOption({ label: 'Арт-відділ' });
    assert.equal(await dialog.locator('[name="position"]').inputValue(), '');
    await dialog.locator('[name="department"]').selectOption({ label: 'Кафе' });
    await dialog.locator('[name="position"]').selectOption('waiter');
    await dialog.screenshot({ path: path.join(output, `create-${width}-${dark ? 'dark' : 'light'}.png`) });
    await dialog.getByRole('button', { name: 'Створити картку', exact: true }).click();
    const submitted = await page.evaluate(() => window.__uxSubmission);
    assert.equal(submitted.secondary_professions, undefined);
    assert.equal(submitted.family_name, 'Тестова');
    assert.equal(submitted.given_name, 'Картка');
    assert.equal(submitted.department, 'Кафе');
    assert.equal(submitted.position, 'Офіціант');
    assert.equal(submitted.role_type, 'waiter');
    assert.equal(submitted.phone, '+380 67 123 45 67');
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await page.locator('#hrCreateStaffCancel').click();
}

async function checkDrawer(page, width, dark) {
    await installHarness(page);
    await page.locator('head style').evaluate((el, css) => { el.textContent = css; }, styles);
    await page.evaluate(dark => {
        document.body.classList.toggle('dark-mode', dark);
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    }, dark);
    await page.evaluate(() => window.__hrTeamBrowserSmoke.seedStaffNameParts());
    await page.locator('.hr-team-card[data-staff-id="1"] .hr-team-open').click();
    const givenName = page.locator('#editStaffGivenName');
    await givenName.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#editStaffName').isVisible(), false);
    assert.equal(await givenName.inputValue(), 'Жан П’єр');
    await givenName.fill('Жан Поль');
    await page.locator('#editStaffFamilyName').focus();
    await page.screenshot({ path: path.join(output, `name-edit-${width}-${dark ? 'dark' : 'light'}.png`) });
    await page.locator('#staffProfileTabWork').click();
    await page.waitForFunction(() => document.getElementById('staffProfileTabWork').getAttribute('aria-selected') === 'true');
    assert.deepEqual(await page.evaluate(() => window.__hrTeamBrowserSmoke.staffUpdates().at(-1).body),
        { family_name: 'Ван Гут', given_name: 'Жан Поль' });
    const notes = page.locator('#editNotes');
    await notes.fill('Перевірка збереження при переході');
    await page.evaluate(() => window.__hrTeamBrowserSmoke.failNextStaffUpdate());
    await page.locator('#staffProfileTabPayroll').click();
    await page.waitForFunction(() => document.getElementById('staffProfileLiveStatus').textContent.includes('незбережені'));
    assert.equal(await page.locator('#staffProfileTabWork').getAttribute('aria-selected'), 'true');
    assert.equal(await notes.inputValue(), 'Перевірка збереження при переході');
    await page.waitForFunction(() => !document.getElementById('editSaveWork').disabled);
    await page.locator('#staffProfileTabPayroll').click();
    await page.waitForFunction(() => document.getElementById('staffProfileTabPayroll').getAttribute('aria-selected') === 'true');
    assert.equal(await page.evaluate(() => window.__hrTeamBrowserSmoke.staffUpdates().at(-1).body.notes),
        'Перевірка збереження при переході');
    await page.locator('#staffProfileTabResources').click();
    const documentFile = page.locator('#editDocumentFile');
    await documentFile.setInputFiles({ name: 'qa-scan.png', mimeType: 'image/png', buffer: Buffer.from('QA scan') });
    assert.match(await page.locator('#editDocumentFileStatus').textContent(), /ще не завантажено/);
    await documentFile.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `document-pending-${width}-${dark ? 'dark' : 'light'}.png`) });
    await documentFile.setInputFiles([]);
    for (const [id, field] of [['editDocumentUpload', 'editDocumentFile'], ['editMedicalSave', 'editMedicalNotes'], ['editResourceIssue', 'editResourceNotes']]) {
        const button = page.locator('#' + id);
        await button.scrollIntoViewIfNeeded();
        assert.equal(await button.isVisible(), true);
        const geometry = await button.evaluate((el, fieldId) => {
            const b = el.getBoundingClientRect();
            const f = document.getElementById(fieldId).getBoundingClientRect();
            return { afterFields: b.top >= f.bottom, fits: b.left >= 0 && b.right <= innerWidth, touch: b.height >= 44 };
        }, field);
        assert.deepEqual(geometry, { afterFields: true, fits: true, touch: true });
        await page.screenshot({ path: path.join(output, `${id}-${width}-${dark ? 'dark' : 'light'}.png`) });
    }
    const returnOnEnd = page.locator('#editResourceReturnOnEmploymentEnd');
    await returnOnEnd.check();
    assert.equal(await page.locator('#editResourceDueReturnAt').isDisabled(), true);
    await page.screenshot({ path: path.join(output, `resource-return-${width}-${dark ? 'dark' : 'light'}.png`) });
    await returnOnEnd.uncheck();
    assert.equal(await page.locator('#editResourceDueReturnAt').isEnabled(), true);
    await page.locator('#staffProfileTabPayroll').click();
    const preview = page.locator('.hr-staff-payroll-preview-summary');
    await preview.waitFor();
    assert.equal(await page.locator('.hr-staff-payroll-profile-panel').evaluate(panel =>
        Boolean(panel.compareDocumentPosition(document.querySelector('.hr-primary-rate-card')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    await preview.scrollIntoViewIfNeeded();
    if (dark) {
        const rgb = await preview.locator('div').first().evaluate(el => getComputedStyle(el).backgroundColor);
        assert.ok(Number(rgb.match(/[\d.]+/)[0]) < 100, 'pay summary uses a dark theme surface');
    }
    await page.screenshot({ path: path.join(output, `payroll-${width}-${dark ? 'dark' : 'light'}.png`) });
    await page.locator('#editCloseTop').click();
}

async function checkBackdrop(page) {
    await page.evaluate(markup => {
        const parsed = new DOMParser().parseFromString(markup, 'text/html');
        document.body.append(parsed.getElementById('accountOnboardingOverlay'));
        accountOnboardingState = { open: true, submitting: false };
        bindAccountOnboardingControls();
        document.getElementById('accountOnboardingOverlay').classList.remove('hidden');
        document.getElementById('accountOnboardingUsername').value = 'synthetic.draft';
    }, markup);
    await page.locator('#accountOnboardingOverlay').click({ position: { x: 1, y: 1 } });
    assert.equal(await page.locator('#accountOnboardingOverlay').isVisible(), true);
    assert.equal(await page.locator('#accountOnboardingUsername').inputValue(), 'synthetic.draft');
}

async function checkPassword(page) {
    await page.evaluate(() => {
        window.__uxPassword = formModal('Оновити пароль', [
            { key: 'newPassword', label: 'Новий пароль', type: 'password', passwordToggle: true },
            { key: 'confirmPassword', label: 'Повторіть пароль', type: 'password', passwordToggle: true }
        ]);
    });
    await page.locator('#fm_newPassword').fill('Synthetic234');
    const toggle = page.locator('[data-fm-field-wrap="newPassword"] [data-fm-password-toggle]');
    await toggle.click();
    assert.equal(await page.locator('#fm_newPassword').getAttribute('type'), 'text');
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#fm_confirmPassword').getAttribute('type'), 'password');
    await toggle.click();
    assert.equal(await page.locator('#fm_newPassword').getAttribute('type'), 'password');
    assert.equal(await page.locator('#fm_newPassword').inputValue(), 'Synthetic234');
    assert.equal(await page.locator('[data-fm-password-regenerate]').count(), 0);
    await page.locator('#fm_newPassword').fill('');
    await page.locator('.confirm-cancel').click();
    await page.locator('#fm_newPassword').waitFor({ state: 'detached' });
    await page.evaluate(() => {
        void formModal('Початковий пароль', [
            { key: 'password', label: 'Пароль', type: 'password', initialPasswordControls: true, defaultValue: 'SyntheticInitial123!' }
        ]);
    });
    const initial = page.locator('#fm_password');
    const initialToggle = page.getByRole('button', { name: 'Показати пароль', exact: true });
    assert.equal(await initial.getAttribute('autocomplete'), 'new-password');
    await initialToggle.click();
    assert.equal(await initial.getAttribute('type'), 'text');
    await initialToggle.click();
    assert.equal(await initial.getAttribute('type'), 'password');
    assert.equal(await initial.inputValue(), 'SyntheticInitial123!');
    assert.equal(await page.locator('[data-fm-password-regenerate]').count(), 0);
    await page.locator('.confirm-cancel').click();
}

async function run() {
    fs.mkdirSync(output, { recursive: true });
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    try {
        for (const width of [1366, 390]) {
            for (const dark of [false, true]) {
                const page = await browser.newPage();
                try {
                    await checkCreation(page, width, dark);
                    await checkPassword(page);
                    await checkDrawer(page, width, dark);
                    await checkBackdrop(page);
                } finally { await page.close(); }
            }
        }
        console.log('HR Team UX browser smoke passed (1366/390px, light/dark).');
    } finally { await browser.close(); }
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
