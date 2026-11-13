'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { installHarness, requirePlaywright, readRepo, HR_HTML, ROOT } = require('./hr-team-browser-smoke');
(async () => {
    const browser = await requirePlaywright().chromium.launch({ headless: true,
        ...(process.env.HR_BROWSER_EXECUTABLE ? { executablePath: process.env.HR_BROWSER_EXECUTABLE } : {}) });
    const out = path.join(ROOT, 'output/playwright/hr-team-menu');
    fs.mkdirSync(out, { recursive: true });
    const realCss = [...HR_HTML.matchAll(/href="(css\/[^"?]+)\?[^\"]*"/g)].map(match => readRepo(match[1])).join('\n');
    const results = [];
    try {
        for (const width of [1100, 390]) {
            for (const theme of ['light', 'dark']) {
                const page = await browser.newPage({ viewport: { width, height: 844 } });
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                await installHarness(page, { dark: theme === 'dark' });
                await page.evaluate(() => {
                    const team = document.getElementById('tab-team');
                    const shell = document.createElement('div');
                    shell.className = 'page-container';
                    team.before(shell);
                    shell.append(team);
                    document.getElementById('outsideButton').style.visibility = 'hidden';
                    for (const person of teamStaff) {
                        person.photo_url = null;
                        if (person.id === 1) person.name = 'Тестовий співробітник';
                    }
                    teamLoadState.workflows = { documents: true, move: true };
                    filterAndRenderTeam();
                });
                await page.addStyleTag({ content: realCss });
                await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
                const trigger = page.locator('.hr-team-card[data-staff-id="1"] .hr-team-overflow-trigger');
                await trigger.click();
                const menu = page.locator('#hrTeamCardMenu1');
                await menu.waitFor({ state: 'visible' });
                for (const item of ['.hr-team-document', '.hr-team-move']) {
                    const action = menu.locator(item);
                    assert.equal(await action.getAttribute('aria-disabled'), null);
                    assert.ok(await action.getAttribute('onclick'));
                }
                await page.waitForFunction(() => document.querySelector('#hrTeamCardMenu1').contains(document.activeElement));
                const state = await menu.evaluate(el => {
                    const style = getComputedStyle(el);
                    const card = el.closest('.hr-team-card');
                    const button = card.querySelector('.hr-team-overflow-trigger');
                    const bounds = el.getBoundingClientRect();
                    const action = el.querySelector('button');
                    return { background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow,
                        card: getComputedStyle(card).backgroundColor, color: getComputedStyle(action).color,
                        rect: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom },
                        triggerWidth: button.getBoundingClientRect().width,
                        triggerHeight: button.getBoundingClientRect().height,
                        svg: button.querySelector('svg')?.getBoundingClientRect().toJSON() };
                });
                assert.notEqual(state.background, state.card);
                assert.notEqual(state.shadow, 'none');
                assert.ok(state.rect.left >= 0 && state.rect.right <= width);
                assert.ok(state.rect.top >= 0 && state.rect.bottom <= 844);
                assert.ok(state.triggerWidth >= 44 && state.triggerHeight >= 44);
                await page.screenshot({ path: path.join(out, theme + '-' + width + '.png'), fullPage: false });
                if (width === 390) {
                    const cardBounds = await page.locator('.hr-team-card[data-staff-id="1"]').boundingBox();
                    const top = Math.max(0, Math.floor(cardBounds.y) - 8);
                    await page.screenshot({ path: path.join(out, theme + '-detail.png'),
                        clip: { x: 0, y: top, width, height: 844 - top } });
                }
                await page.keyboard.press('End');
                assert.equal(await page.locator('.hr-team-card[data-staff-id="1"] .hr-team-delete').evaluate(el => el === document.activeElement), true);
                await page.keyboard.press('Home');
                await page.keyboard.press('ArrowDown');
                assert.equal(await menu.evaluate(el => el.contains(document.activeElement)), true);
                await page.keyboard.press('Escape');
                assert.equal(await menu.isVisible(), false);
                assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
                await trigger.press('Enter');
                await menu.waitFor({ state: 'visible' });
                await page.mouse.click(5, 5);
                assert.equal(await menu.isVisible(), false);
                await page.evaluate(() => {
                    window.__workflowClicks = [];
                    const transport = hrFetch;
                    hrFetch = async (url, options = {}) => {
                        if (url === '/staff/1' && options.method === 'PUT') {
                            window.__workflowClicks.push({ revision: options.headers?.['X-Staff-Profile-Revision'], body: options.body });
                            return { success: true, data: { profile_revision: '102' } };
                        }
                        const response = await transport(url, options);
                        if (url === '/staff/1' && response?.data) response.data.profile_revision = '101';
                        return response;
                    };
                });
                await trigger.click();
                await menu.locator('.hr-team-document').click();
                await page.locator('#editStaffDocumentsPanel').waitFor({ state: 'visible' });
                await page.evaluate(() => closeHrEditableModal('staffEditModal', true));
                await trigger.click();
                await menu.locator('.hr-team-move').click();
                const moveDialog = page.locator('.hr-staff-move-modal');
                await moveDialog.waitFor({ state: 'visible' });
                await moveDialog.getByRole('combobox').first().selectOption('reserve');
                assert.equal(await moveDialog.getByLabel('Основна професія').isVisible(), false);
                assert.equal(await moveDialog.getByLabel('Причина для чорного списку').isVisible(), false);
                await moveDialog.getByText('Заплановані виходи від сьогодні без запису відвідування буде прибрано.').waitFor();
                await page.screenshot({ path: path.join(out, 'move-' + theme + '-' + width + '.png'), fullPage: false });
                await moveDialog.getByRole('button', { name: 'Перемістити', exact: true }).click();
                await page.waitForFunction(() => window.__workflowClicks.length === 1);
                const saved = await page.evaluate(() => window.__workflowClicks[0]);
                assert.equal(saved.revision, '101');
                assert.equal(saved.body.hr_pool_status, 'reserve');
                await page.evaluate(() => {
                    const transport = hrFetch;
                    hrFetch = async (url, options = {}) => {
                        if (url === '/staff/3' && options.method === 'PUT') {
                            window.__workflowClicks.push({ body: options.body });
                            return { success: true, data: { profile_revision: '202' } };
                        }
                        const response = await transport(url, options);
                        if (url === '/staff/3' && response?.data) response.data.profile_revision = '201';
                        return response;
                    };
                    window.__hrTeamBrowserSmoke.setBucket('interns');
                });
                const internTrigger = page.locator('.hr-team-card[data-staff-id="3"] .hr-team-overflow-trigger');
                await internTrigger.click();
                await page.locator('#hrTeamCardMenu3 .hr-team-move').click();
                await moveDialog.waitFor({ state: 'visible' });
                const destination = moveDialog.getByRole('combobox').first();
                await destination.selectOption('workers');
                assert.equal(await moveDialog.getByLabel('Основна професія').isVisible(), true);
                await destination.selectOption('blacklist');
                assert.equal(await moveDialog.getByLabel('Основна професія').isVisible(), false);
                assert.equal(await moveDialog.getByLabel('Причина для чорного списку').isVisible(), true);
                await moveDialog.getByRole('button', { name: 'Перемістити', exact: true }).click();
                assert.equal(await moveDialog.isVisible(), true);
                assert.equal(await page.evaluate(() => window.__workflowClicks.length), 1);
                assert.deepEqual(errors, []);
                if (width === 390 && theme === 'dark') {
                    await page.evaluate(async () => {
                        const board = document.createElement('div');
                        board.id = 'candidatesKanban';
                        document.body.append(board);
                        currentVacancyId = 41;
                        hrFetch = async path => {
                            assertVacancyRequest(path);
                            return { success: true, applications: [
                                { id: 1, name: 'Тестовий кандидат', status: 'offer' },
                                { id: 2, name: 'Тестовий найнятий', status: 'hired' },
                                { id: 3, name: 'Тестовий відхилений', status: 'rejected' }
                            ] };
                        };
                        function assertVacancyRequest(path) {
                            if (path !== '/vacancies/41/applications') throw new Error('Unexpected request: ' + path);
                        }
                        await refreshCandidates();
                    });
                    const board = page.locator('#candidatesKanban');
                    assert.equal(await board.locator('.kanban-col').count(), 6);
                    for (const name of ['Тестовий найнятий', 'Тестовий відхилений']) {
                        const card = board.locator('.kanban-card').filter({ hasText: name });
                        assert.equal(await card.count(), 1);
                        assert.equal(await card.getByRole('button').count(), 1);
                    }
                    await page.evaluate(async () => {
                        hrFetch = async () => ({ success: false, status: 403 });
                        await refreshCandidates();
                    });
                    assert.equal(await board.textContent(), 'Кандидати недоступні для поточного доступу.');
                }
                results.push({ width, theme, ...state });
                await page.close();
            }
        }
        fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
        console.log(JSON.stringify(results));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
