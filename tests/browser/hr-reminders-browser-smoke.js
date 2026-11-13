'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requirePlaywright } = require('./hr-team-browser-smoke');

const root = path.join(__dirname, '../..');
const output = path.join(root, 'output/playwright/hr-reminders');
const profileMarkup = fs.readFileSync(path.join(root, 'profile.html'), 'utf8');
const profileStyles = Array.from(profileMarkup.matchAll(/<link rel="stylesheet" href="(css\/[^"?]+)/g), match => match[1]);

async function run() {
    fs.mkdirSync(output, { recursive: true });
    const browser = await requirePlaywright().chromium.launch();
    try {
        for (const [width, dark] of [[1366, false], [1366, true], [390, false], [390, true]]) {
            const page = await browser.newPage({ viewport: { width, height: 844 } });
            try {
                await page.route('http://hr-fixture.test/**', route => route.fulfill({
                    contentType: 'text/html; charset=utf-8',
                    body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body class="profile-page ${dark ? 'dark-mode' : ''}"><button id="fixtureBell">Сповіщення</button><main id="fixtureContent"></main></body>`
                }));
                await page.goto('http://hr-fixture.test/profile');
                for (const file of profileStyles) {
                    await page.addStyleTag({ path: path.join(root, file) });
                }
                for (const [, css] of profileMarkup.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
                    await page.addStyleTag({ content: css });
                }
                for (const file of ['js/ui.js', 'js/profile-page.js', 'js/alerts.js']) {
                    await page.addScriptTag({ path: path.join(root, file) });
                }
                await page.evaluate(() => {
                    const alerts = [{
                        id: 'hr_resource_1_2026-11-12_overdue', type: 'hr_deadline', level: 'critical',
                        title: 'Повернути майно', message: 'Тестовий предмет <b>№1</b>',
                        dueDate: '2026-11-12', stage: 'overdue', link: '/profile?tab=myday#hr-personal-reminders'
                    }];
                    window.apiFetchWithAuthRetry = async () => ({ ok: true, json: async () => ({ alerts }) });
                    window.switchTab = async () => {
                        myCabinetData = { hrReminders: alerts, hrReminderScope: cabinetHrReminderScope() };
                        document.getElementById('fixtureContent').innerHTML = renderMyDayHrReminders();
                    };
                    document.getElementById('fixtureBell').onclick = toggleAlertsPanel;
                });
                await page.getByRole('button', { name: 'Сповіщення', exact: true }).click();
                await page.locator('.ap-item-main').getByText('Повернути майно').click();
                const reminder = page.getByRole('region', { name: 'Нагадування HR' });
                assert.equal(await reminder.locator('time').getAttribute('datetime'), '2026-11-12');
                assert.match(await reminder.innerText(), /Прострочено.*\n.*<b>№1<\/b>/s);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                await page.screenshot({ path: path.join(output, `my-day-${width}-${dark ? 'dark' : 'light'}.png`) });
            } finally {
                await page.close();
            }
        }
        console.log('HR reminders browser smoke passed (desktop/mobile, light/dark).');
    } finally {
        await browser.close();
    }
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
