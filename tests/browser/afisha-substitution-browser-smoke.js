'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const root = path.resolve(__dirname, '../..');
const origin = 'http://afisha-fixture.test';
const scripts = ['event-cards', 'afisha-import-form', 'afisha-page'];
const date = '2099-01-16';
const events = [
    { id: 70, title: 'Захід без підміни', date, time: '12:00', type: 'event', duration: 60 },
    {
        id: 71, title: 'Два вітання', date, time: '14:00', type: 'birthday',
        line_id: '1', line_name: 'Аніматор за розкладом',
        birthday_slots: [
            { key: 'first', time: '14:05', base_time: '14:00', mode: 'auto' },
            { key: 'second', time: '18:00', base_time: '18:00', mode: 'manual' }
        ],
        substitutions: [
            { id: '901', slotKey: 'first:primary', state: 'active', animatorName: 'Олена <Тест>' },
            { id: '902', slotKey: 'second:second', state: 'completed', animatorName: 'Микола' }
        ]
    }
];

async function main() {
    const html = fs.readFileSync(path.join(root, 'afisha.html'), 'utf8')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace('</body>', scripts.map(name => '<script src="/js/' + name + '.js"></script>').join('') + '</body>');
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 320, height: 844 }, hasTouch: true, isMobile: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            window.apiVerifyToken = async () => ({ name: 'QA' });
            window.apiFetchWithAuthRetry = (...args) => fetch(...args);
            window.showAuthenticatedPageShell = () => {
                document.body.classList.add('shell-ready');
                document.getElementById('mainApp').classList.remove('hidden');
            };
        });
        await page.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (url.pathname === '/afisha') return route.fulfill({ contentType: 'text/html', body: html });
            if (url.pathname === '/api/afisha' && url.searchParams.get('includeSubstitutions') === 'true') {
                return route.fulfill({ json: events });
            }
            if (url.pathname === '/api/afisha/templates/list' || /^\/api\/afisha\/\d+\/materials$/.test(url.pathname)) {
                return route.fulfill({ json: [] });
            }
            const isPageScript = scripts.some(name => url.pathname === '/js/' + name + '.js');
            if (isPageScript || /^\/css\/[\w-]+\.css$/.test(url.pathname)
                || /^\/images\/[\w/.-]+\.(?:webp|png|jpg)$/.test(url.pathname)) {
                const file = path.join(root, url.pathname.slice(1));
                if (fs.existsSync(file)) return route.fulfill({ path: file });
            }
            return route.abort();
        });
        await page.goto(origin + '/afisha');
        const plain = page.locator('[data-afisha-id="70"]');
        const greeting = page.locator('[data-afisha-id="71"]');
        const detail = page.locator('#afishaEventWorkspace');
        const expected = [
            '14:05 · основний аніматор: Олена <Тест> · Підміна №901 · погоджено',
            '18:00 · другий аніматор: Микола · Підміна №902 · завершено'
        ];

        await greeting.locator('.afisha-substitution').first().waitFor();
        assert.deepEqual(await greeting.locator('.afisha-substitution').allTextContents(), expected);
        assert.equal(await plain.locator('.afisha-substitution').count(), 0);
        await greeting.locator('button.afisha-event-select').click();
        await detail.getByRole('heading', { name: 'Два вітання' }).waitFor();
        assert.deepEqual(await detail.locator('.afisha-substitution').allTextContents(), expected);
        assert.match(await detail.innerText(), /Аніматори за основним розкладом/);
        for (const label of await detail.locator('.afisha-substitution').all()) {
            assert.ok(await label.evaluate(node => {
                const range = document.createRange();
                range.selectNodeContents(node);
                return [...range.getClientRects()].every(bounds => bounds.left >= 0 && bounds.right <= innerWidth);
            }), 'Every line of the agreement fits the phone viewport');
        }

        const output = path.join(root, 'output/playwright');
        fs.mkdirSync(output, { recursive: true });
        await detail.locator('.afisha-event-hero-card').screenshot({
            path: path.join(output, 'afisha-substitution-mobile.png'),
            animations: 'disabled'
        });
        await plain.locator('button.afisha-event-select').click();
        await detail.getByRole('heading', { name: 'Захід без підміни' }).waitFor();
        assert.equal(await detail.locator('.afisha-substitution').count(), 0);
        assert.deepEqual(errors, []);
        console.log('Afisha occurrence agreement mobile smoke passed.');
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
