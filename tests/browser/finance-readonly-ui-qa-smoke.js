'use strict';

// Actual finance markup/bootstrap with synthetic GET responses, no real auth/DB/providers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/finance-qa-local');
const html = fs.readFileSync(path.join(root, 'finance.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const requests = [];
let advancedAttempts = 0;
const totals = { income: 11600, expense: 0, profit: 11600 };
const metrics = { monthIncome: 11600, monthExpense: 0, monthProfit: 11600, avgBookingPrice: 1933, bookingsCount: 6, margin: 100 };
const pnl = { summary: { totalIncome: 11600, totalExpenses: 0, grossProfit: 11600, margin: 100,
    incomeChange: 0, expenseChange: 0, previousIncome: 0, previousExpenses: 0, previousProfit: 0 },
    bookingRevenue: 11600, revenue: [], expenses: [] };
const boot = `<script>
window.AppState = {};
window.apiVerifyToken = async () => ({name:'Synthetic QA',role:'creator'});
window.hydrateActionPermissions = async () => ({});
window.canUseAction = () => true;
window.getAuthHeaders = () => ({});
window.handleAuthError = () => false;
window.showAuthenticatedPageShell = () => {
    document.getElementById('mainApp').classList.remove('hidden');
    document.body.classList.add('shell-ready','dark-mode');
};
window.getLegacyBusinessSurfaceAvailability = () => ({available:false,message:'Synthetic isolated fixture'});
window.apiFetchWithAuthRetry = (url,options) => fetch(url,options);
document.documentElement.setAttribute('data-theme','dark');
</script><script src="/js/finance-page.js"></script>`;

async function main() {
    fs.mkdirSync(output, { recursive: true });
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/api/')) {
            requests.push({ method: req.method, path: url.pathname });
            if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
            let data;
            if (url.pathname.endsWith('/categories')) data = [];
            else if (url.pathname.endsWith('/dashboard')) data = { totals, bookingRevenue: { revenue: 11600, count: 6 } };
            else if (url.pathname.endsWith('/overview')) data = { finance: totals, bookings: { revenue: 11600, total: 6, confirmed: 6 } };
            else if (url.pathname.endsWith('/transactions')) data = { transactions: [], totalPages: 1 };
            else if (url.pathname.endsWith('/forecast')) data = { totals: { expectedRevenue: 8700, bookingCount: 5 },
                weekly: [{week_start:'2026-09-28T00:00:00.000Z',booking_count:5,expected_revenue:8700}],historicalAverage:[] };
            else if (url.pathname.endsWith('/advanced-dashboard')) {
                advancedAttempts++;
                if (advancedAttempts === 1) { res.writeHead(500, {'content-type':'application/json'}); return res.end(JSON.stringify({error:'synthetic unavailable'})); }
                data = { metrics };
            } else if (url.pathname.endsWith('/report/pnl')) data = pnl;
            else data = {};
            res.writeHead(200, {'content-type':'application/json'});
            return res.end(JSON.stringify(data));
        }
        if (url.pathname === '/finance') {
            res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
            return res.end(html.replace('</body>', `${boot}</body>`));
        }
        const file = path.resolve(root, `.${url.pathname}`);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, {'content-type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'application/octet-stream'});
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await chromium.launch({ headless: true,
            executablePath:'C:\\Users\\Plotva\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe' });
        const page = await browser.newPage({viewport:{width:1440,height:1000}});
        await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
        await page.goto(`${origin}/finance`);
        await page.locator('#faExecutiveZone .fa-exec-card').first().waitFor();
        assert.ok(await page.locator('#dateFromFilter').isVisible());
        await page.locator('#dateFromFilter').fill('2026-09-01');
        await page.locator('#dateToFilter').fill('2026-09-30');
        await page.getByRole('tab', {name:'Інсайти',exact:true}).click();
        assert.ok(await page.locator('#dateToFilter').isVisible());
        await page.getByRole('tab', {name:'Огляд',exact:true}).click();
        await page.locator('main').screenshot({path:path.join(output,'overview-desktop.png'),animations:'disabled'});
        await page.setViewportSize({width:820,height:1180});
        assert.ok(await page.locator('#dateFromFilter').isVisible());
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, {timeout:2000});
        // A one-CSS-pixel allowance covers fractional grid rounding in this stripped shell.
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.locator('main').screenshot({path:path.join(output,'overview-tablet.png'),animations:'disabled'});
        await page.getByRole('tab', {name:'Операції',exact:true}).click();
        await page.getByRole('button', {name:'Прогноз',exact:true}).click();
        await page.getByRole('cell', {name:'28.09.2026',exact:true}).waitFor();
        await page.locator('#tabForecast').screenshot({path:path.join(output,'forecast-tablet.png'),animations:'disabled'});
        await page.getByRole('button', {name:'Фін. панель',exact:true}).click();
        await page.locator('#advancedContent [role=alert]').waitFor();
        await page.locator('#tabAdvanced').screenshot({path:path.join(output,'advanced-unavailable.png'),animations:'disabled'});
        await page.getByRole('button', {name:'Спробувати ще раз',exact:true}).click();
        await page.locator('#advancedContent .fin-stat-card').first().waitFor();
        assert.equal(await page.locator('#advancedContent [role=alert]').count(), 0);
        assert.equal(advancedAttempts, 2);
        await page.goto(`${origin}/finance?tab=pnl`);
        await page.locator('#pnlContent .fin-stat-card').first().waitFor();
        assert.ok(await page.locator('#tabPnl').isVisible());
        assert.equal(await page.getByRole('tab', {name:'Операції',exact:true}).getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('#dateFromFilter').isVisible(), false);
        advancedAttempts = 0;
        await page.goto(`${origin}/finance?tab=advanced`);
        await page.locator('#advancedContent [role=alert]').waitFor();
        await page.getByRole('button', {name:'Спробувати ще раз',exact:true}).click();
        await page.locator('#advancedContent .fin-stat-card').first().waitFor();
        assert.ok(await page.locator('#tabAdvanced').isVisible());
        assert.equal(advancedAttempts, 2);
        assert.ok(requests.every(request => request.method === 'GET'));
        console.log(JSON.stringify({passed:true,checks:['visible shared range','desktop/tablet layout','actual mode/tab clicks',
            'forecast ISO date','HTTP 500 state and GET retry','P&L deep link'],requests:requests.length,output}));
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
