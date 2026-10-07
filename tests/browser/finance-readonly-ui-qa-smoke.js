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
const fixtureNow = new Date();
const fixtureMonth = `${fixtureNow.getFullYear()}-${String(fixtureNow.getMonth() + 1).padStart(2, '0')}`;
const fixtureDate = day => `${fixtureMonth}-${String(day).padStart(2, '0')}`;
const previousMonthRange = month => {
    const [year, number] = month.split('-').map(Number);
    return { from:new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 10),
        to:new Date(Date.UTC(year, number - 1, 0)).toISOString().slice(0, 10) };
};
const totals = { income: 11600, expense: 0, profit: 11600 };
const metrics = { monthIncome: 11600, monthExpense: 0, monthProfit: 11600, avgBookingPrice: 1933, bookingsCount: 6, margin: 100 };
const pnl = { summary: { totalIncome: 11600, totalExpenses: 0, grossProfit: 11600, margin: 100,
    incomeChange: 0, expenseChange: 0, previousIncome: 0, previousExpenses: 0, previousProfit: 0 },
    bookingRevenue: 11600, revenue: [], expenses: [] };
const boot = `<script>
window.AppState = {};
const fixtureViewer = new URLSearchParams(location.search).has('fixtureViewer');
window.apiVerifyToken = async () => ({name:'Synthetic QA',role:fixtureViewer ? 'viewer' : 'creator',telegram_chat_id:'synthetic-qa'});
window.hydrateActionPermissions = async () => ({});
window.canUseAction = () => !fixtureViewer;
window.canAccessPage = () => true;
window.getAuthHeaders = () => ({});
window.handleAuthError = () => false;
window.showAuthenticatedPageShell = () => {
    document.getElementById('mainApp').classList.remove('hidden');
    document.body.classList.add('shell-ready');
    document.body.classList.toggle('dark-mode', localStorage.getItem('pzp_dark_mode') !== 'false');
};
window.getLegacyBusinessSurfaceAvailability = (surface) => surface === 'finance_salary'
    ? ({available:true}) : ({available:false,message:'Synthetic isolated fixture'});
window.apiFetchWithAuthRetry = (url,options) => fetch(url,options);
window.__budgetRequests = [];
window.apiGetBudgetComparison = async (year, month) => { window.__budgetRequests.push({year, month}); return ({ comparison:[{categoryName:'Матеріали',categoryType:'expense',planned:2500,actual:2100,diff:-400,percentUsed:84}],
    totals:{incomeActual:11600,incomePlanned:11000,expenseActual:2100,expensePlanned:2500,profitActual:9500,profitPlanned:8500} });
};
document.documentElement.setAttribute('data-theme',localStorage.getItem('pzp_dark_mode') === 'false' ? 'light' : 'dark');
</script><script src="/js/analytics-page.js"></script><script src="/js/finance-page.js"></script><script src="/js/finance-costing.js"></script>`;

async function main() {
    fs.mkdirSync(output, { recursive: true });
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/api/')) {
            requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
            if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
            let data;
            const rangeMonth = (url.searchParams.get('from') || fixtureDate(1)).slice(0, 7);
            const dated = day => `${rangeMonth}-${String(day).padStart(2, '0')}`;
            if (url.pathname.endsWith('/categories')) data = [];
            else if (url.pathname.endsWith('/dashboard')) data = { totals, bookingRevenue: { revenue: 11600, count: 6 },
                daily:[{date:dated(3),income:2800,expense:900},{date:dated(10),income:4100,expense:1600}],
                incomeByCategory:[{name:'Послуги',total:11600}], expenseByCategory:[{name:'Матеріали',total:2100}] };
            else if (url.pathname.endsWith('/overview')) data = { finance: totals,
                bookings: { revenue: 11600, total: 6, confirmed: 4, preliminary: 2, avgCheck: 1933 },
                customers: { newCustomers: 4, prevNew: 3 }, hr: { totalHours: 84, activeStaff: 6 } };
            else if (url.pathname.endsWith('/charts')) data = {
                dailyFinance: [{ date:dated(3), income:2800, expense:900 }, { date:dated(10), income:4100, expense:1600 }, { date:dated(17), income:4700, expense:2100 }],
                dailyBookings: [{ date:dated(3), revenue:2800, count:2 }, { date:dated(10), revenue:4100, count:2 }, { date:dated(17), revenue:4700, count:2 }],
                topPrograms: [{ name:'Групове заняття', count:4, revenue:7200 }, { name:'Оренда зали', count:2, revenue:4400 }],
                financeCategories: [{ name:'Послуги', total:11600, color:'#10B981' }],
                weekdayLoad: [{ name:'Субота', count:4, revenue:7200 }], customerSegments:{ total:6, champions:1, loyal:2, potential:3 }
            };
            else if (url.pathname.endsWith('/comparison')) data = { current:{from:url.searchParams.get('from'),to:url.searchParams.get('to')}, previous:previousMonthRange(rangeMonth),
                metrics:[{key:'finIncome',label:'Доходи',current:11600,previous:9800,growth:18.4},{key:'finExpense',label:'Витрати',current:2100,previous:2500,growth:-16}] };
            else if (url.pathname.endsWith('/deals-lifecycle')) data = { period:{from:url.searchParams.get('from'),to:url.searchParams.get('to')},accepted:5,closed:4,conversionRatio:80,
                trend:[{date:dated(3),accepted:2,closed:1},{date:dated(10),accepted:3,closed:3}] };
            else if (url.pathname.endsWith('/transactions')) data = { transactions: [
                {id:1,date:dated(17),type:'income',categoryName:'Послуги',description:'Групове заняття',amount:3200,paymentMethod:'card',createdBy:'Synthetic QA'},
                {id:2,date:dated(18),type:'expense',categoryName:'Матеріали',description:'Матеріали для заняття',amount:600,paymentMethod:'cash',createdBy:'Synthetic QA'}], totalPages: 1 };
            else if (url.pathname.endsWith('/report/monthly')) data = { months:[{monthName:'Поточний місяць',month:`${url.searchParams.get('year') || fixtureMonth.slice(0,4)}-${fixtureMonth.slice(5)}`,income:11600,expense:2100,profit:9500}],
                totals:{income:11600,expense:2100,profit:9500} };
            else if (url.pathname.endsWith('/shift/current')) data = { isOpen:true,shift:{openingCash:1000,cashIncome:3200,cashExpense:600,expectedCash:3600} };
            else if (url.pathname.endsWith('/shift/history')) data = { shifts:[{opened_at:`${fixtureDate(17)}T09:00:00Z`,closed_at:`${fixtureDate(17)}T18:00:00Z`,opening_cash:1000,closing_cash:3600,expected_cash:3600,cash_difference:0,status:'closed'}] };
            else if (url.pathname.endsWith('/debts')) data = { totalDebt:700,count:1,debts:[{date:fixtureDate(18),label:'Оренда зали',customerName:'Тестовий клієнт',price:1700,paidAmount:1000,debtAmount:700,bookingId:'synthetic-1'}] };
            else if (url.pathname.endsWith('/accounts')) data = { accounts:[{id:1,name:'Каса локації',emoji:'💵',type:'cash',description:'Тестовий рахунок'}] };
            else if (url.pathname.endsWith('/my')) data = { accounts:[{id:1,name:'Особистий рахунок',emoji:'💳',role:'owner'}] };
            else if (url.pathname.endsWith('/schemes')) data = { staff:[],schemes:[],totals:{} };
            else if (url.pathname.endsWith('/report/salary')) data = { staff:[{staffId:1,name:'Тестова працівниця',department:'education',position:'Викладачка',schemeType:'hourly',
                netAmount:8200,hoursWorked:42,daysWorked:12,paidAmount:4000,balanceAmount:4200,status:'reviewed'}],
                totals:{net:8200,paid:4000,balance:4200,base:7600,additional:600,bonuses:0,deductions:0,advances:0} };
            else if (url.pathname.endsWith('/templates')) data = { templates:[] };
            else if (url.pathname.endsWith('/plans/summaries')) data = { plans:[] };
            else if (url.pathname.endsWith('/plans')) data = { plans:[] };
            else if (url.pathname.endsWith('/groups')) data = { groups:[] };
            else if (url.pathname.endsWith('/management/pnl')) data = { summary:{ earnedRevenueMinor:'0',directCostMinor:'0',contributionMinor:'0' },lines:[],unresolved:[] };
            else if (url.pathname.endsWith('/forecast')) data = { totals: { expectedRevenue: 8700, bookingCount: 5 },
                weekly: [{week_start:`${fixtureDate(7)}T00:00:00.000Z`,booking_count:5,expected_revenue:8700}],historicalAverage:[] };
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
        const initialRange = await page.evaluate(() => ({
            from: document.getElementById('dateFromFilter').value,
            to: document.getElementById('dateToFilter').value
        }));
        for (const endpoint of ['/api/finance/dashboard','/api/analytics/overview','/api/analytics/charts',
            '/api/analytics/comparison','/api/analytics/deals-lifecycle']) {
            const seen = requests.find(item => item.path === endpoint);
            assert.ok(seen, `${endpoint}: initial GET missing`);
            assert.equal(seen.query.from, initialRange.from, endpoint);
            assert.equal(seen.query.to, initialRange.to, endpoint);
            if (endpoint.startsWith('/api/analytics/')) assert.equal(seen.query.period, 'custom', endpoint);
        }
        const changedRange = page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === '/api/analytics/overview' && url.searchParams.get('from') === '2026-09-01'
                && url.searchParams.get('to') === '2026-09-30';
        });
        await page.locator('#dateFromFilter').fill('2026-09-01');
        await page.locator('#dateToFilter').fill('2026-09-30');
        await changedRange;
        await page.locator('[data-finance-group="results"]').click();
        assert.ok(await page.locator('#dateToFilter').isVisible());
        assert.equal(await page.locator('#dateFromFilter').inputValue(), '2026-09-01');
        assert.equal(await page.locator('#dateToFilter').inputValue(), '2026-09-30');
        await page.locator('#financeInsightsMetrics').waitFor({ state:'visible' });
        assert.match(await page.locator('#financeInsightsMetrics').innerText(), /Нові клієнти[\s\S]*4[\s\S]*Попередній період: 3/);
        assert.match(await page.locator('#financeInsightsMetrics').innerText(), /Навантаження команди[\s\S]*84 год[\s\S]*Активних працівників: 6/);
        assert.match(await page.locator('#financeInsightsMetrics').innerText(), /Середній чек бронювання[\s\S]*1\s933/);
        assert.match(await page.locator('#financeInsightsMetrics').innerText(), /Статуси бронювань[\s\S]*4 підтверджено[\s\S]*Попередніх: 2/);
        await page.locator('[data-finance-group="overview"]').click();
        await page.locator('main').screenshot({path:path.join(output,'overview-desktop.png'),animations:'disabled'});
        await page.setViewportSize({width:820,height:1180});
        assert.ok(await page.locator('#dateFromFilter').isVisible());
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, {timeout:2000});
        // A one-CSS-pixel allowance covers fractional grid rounding in this stripped shell.
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.locator('main').screenshot({path:path.join(output,'overview-tablet.png'),animations:'disabled'});
        await page.locator('[data-finance-group="planning"]').click();
        await page.locator('.fin-tab[data-tab="forecast"]').click();
        await page.getByRole('cell', {name:`07.${fixtureMonth.slice(5)}.${fixtureMonth.slice(0,4)}`,exact:true}).waitFor();
        await page.locator('#tabForecast').screenshot({path:path.join(output,'forecast-tablet.png'),animations:'disabled'});
        await page.locator('[data-finance-group="results"]').click();
        await page.locator('.fin-tab[data-tab="advanced"]').click();
        await page.locator('#advancedContent [role=alert]').waitFor();
        await page.locator('#tabAdvanced').screenshot({path:path.join(output,'advanced-unavailable.png'),animations:'disabled'});
        await page.getByRole('button', {name:'Спробувати ще раз',exact:true}).click();
        await page.locator('#advancedContent .fin-stat-card').first().waitFor();
        assert.equal(await page.locator('#advancedContent [role=alert]').count(), 0);
        assert.equal(advancedAttempts, 2);
        await page.goto(`${origin}/finance?tab=pnl`);
        await page.locator('#pnlContent .fin-stat-card').first().waitFor();
        assert.ok(await page.locator('#tabPnl').isVisible());
        assert.equal(await page.locator('[data-finance-group="results"]').getAttribute('aria-current'), 'page');
        assert.equal(await page.locator('#dateFromFilter').isVisible(), false);
        advancedAttempts = 0;
        await page.goto(`${origin}/finance?tab=advanced`);
        await page.locator('#advancedContent [role=alert]').waitFor();
        await page.getByRole('button', {name:'Спробувати ще раз',exact:true}).click();
        await page.locator('#advancedContent .fin-stat-card').first().waitFor();
        assert.ok(await page.locator('#tabAdvanced').isVisible());
        assert.equal(advancedAttempts, 2);
        const panels = { transactions:'tabTransactions',shift:'tabShift',accounts:'tabAccounts',personal:'tabPersonal',
            debts:'tabDebts',pnl:'tabPnl',monthly:'tabMonthly',dashboard:'tabDashboard',advanced:'tabAdvanced',
            budget:'tabBudget',forecast:'tabForecast',costing:'tabCosting',salary:'tabSalary' };
        const groups = { transactions:'cash',shift:'cash',accounts:'cash',personal:'cash',debts:'cash',
            pnl:'results',monthly:'results',dashboard:'results',advanced:'results',
            budget:'planning',forecast:'planning',costing:'planning',salary:'team' };
        const ownPeriodEndpoints = { transactions:'/api/finance/transactions',dashboard:'/api/finance/dashboard',
            monthly:'/api/finance/report/monthly',salary:'/api/finance/report/salary',
            forecast:'/api/finance/forecast',pnl:'/api/finance/report/pnl' };
        async function assertInsightsNavBeforeContent(width) {
            await page.locator('#financeInsightsMetrics .fa-insight-metric').first().waitFor({ state:'visible' });
            const position = await page.evaluate(() => {
                const nav = document.getElementById('financeOperationsNav').getBoundingClientRect();
                const content = document.getElementById('faWorkspace').getBoundingClientRect();
                return { navBottom:nav.bottom, contentTop:content.top };
            });
            assert.ok(position.navBottom <= position.contentTop + 1, `insights ${width}: contextual navigation follows content`);
        }
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const matrix = [];
        await page.setViewportSize({width:1440,height:1000});
        for (const [tab,panel] of Object.entries(panels)) {
            const before = requests.length;
            const endpoint = ownPeriodEndpoints[tab];
            const response = endpoint ? page.waitForResponse(item => new URL(item.url()).pathname === endpoint) : null;
            await page.goto(`${origin}/finance?tab=${tab}`);
            if (response) await response;
            await page.locator(`#${panel}`).waitFor({ state:'visible' });
            if (endpoint) {
                const call = requests.slice(before).find(item => item.path === endpoint);
                assert.ok(call, `${tab}: own request missing`);
                if (['transactions','dashboard'].includes(tab)) {
                    assert.equal(call.query.from, await page.locator('#dateFromFilter').inputValue(), tab);
                    assert.equal(call.query.to, await page.locator('#dateToFilter').inputValue(), tab);
                } else {
                    assert.equal(call.query.from, undefined, `${tab}: shared date leaked into own period`);
                    assert.equal(call.query.to, undefined, `${tab}: shared date leaked into own period`);
                    if (tab === 'monthly') assert.equal(call.query.year, await page.locator('#yearFilter').inputValue());
                    if (tab === 'salary') assert.equal(call.query.month, await page.locator('#salaryMonth').inputValue());
                    if (tab === 'forecast') assert.equal(call.query.days, await page.locator('#forecastDays').inputValue());
                    if (tab === 'pnl') {
                        assert.equal(call.query.year, await page.locator('#pnlYear').inputValue());
                        assert.equal(call.query.month || '', await page.locator('#pnlMonth').inputValue());
                    }
                }
            }
            if (tab === 'budget') {
                await page.waitForFunction(() => window.__budgetRequests.length > 0);
                const own = await page.evaluate(() => ({
                    last:window.__budgetRequests.at(-1), year:Number(document.getElementById('budgetYear').value),
                    month:Number(document.getElementById('budgetMonth').value)
                }));
                assert.deepEqual(own.last, { year:own.year, month:own.month }, 'budget uses its own year and month');
            }
            assert.equal(await page.locator(`[data-finance-group="${groups[tab]}"]`).getAttribute('aria-current'), 'page', tab);
            assert.equal(await page.locator('#financePeriodControls').isVisible(), ['transactions','dashboard'].includes(tab), tab);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tab}: horizontal page overflow`);
            await page.locator('main').screenshot({path:path.join(output,`matrix-${tab}-1440-dark.png`),animations:'disabled'});
            matrix.push({view:tab,group:groups[tab],period:['transactions','dashboard'].includes(tab)});
        }
        for (const mode of ['overview','insights']) {
            const before = requests.length;
            const response = page.waitForResponse(item => new URL(item.url()).pathname === '/api/analytics/overview');
            await page.goto(`${origin}/finance?mode=${mode}`);
            await response;
            await page.locator('#faWorkspace').waitFor({ state:'visible' });
            assert.equal(await page.locator('#financePeriodControls').isVisible(), true);
            const overviewCall = requests.slice(before).find(item => item.path === '/api/analytics/overview');
            assert.equal(overviewCall.query.from, await page.locator('#dateFromFilter').inputValue(), mode);
            assert.equal(overviewCall.query.to, await page.locator('#dateToFilter').inputValue(), mode);
            if (mode === 'insights') {
                await assertInsightsNavBeforeContent(1440);
                assert.equal(await page.locator('#financeInsightsMetrics .fa-insight-metric').count(), 4);
            }
            await page.locator('main').screenshot({path:path.join(output,`matrix-${mode}-1440-dark.png`),animations:'disabled'});
            matrix.push({view:mode,group:mode === 'overview' ? 'overview' : 'results',period:true});
        }
        for (const viewport of [{width:820,height:1180},{width:390,height:844}]) {
            await page.setViewportSize(viewport);
            for (const view of ['overview','insights','transactions','salary','costing']) {
                await page.goto(`${origin}/finance?${['overview','insights'].includes(view) ? `mode=${view}` : `tab=${view}`}`);
                if (view === 'overview') await page.locator('#dailyFinanceChart').waitFor();
                if (view === 'insights') await assertInsightsNavBeforeContent(viewport.width);
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} ${viewport.width}: page overflow`);
                assert.ok(await page.evaluate(() => document.getElementById('main-content').scrollWidth <= innerWidth + 1), `${view} ${viewport.width}: clipped main content`);
                if (view === 'salary') {
                    await page.locator('#salaryPreviewPanel .salary-preview-card').waitFor();
                    const panels = await page.evaluate(() => ['salaryStaffList','salaryMainPanel','salaryPreviewPanel']
                        .map(id => document.getElementById(id).getBoundingClientRect())
                        .map(rect => ({ left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:rect.width })));
                    assert.ok(panels.every(rect => rect.width >= 200), `salary ${viewport.width}: narrow panel`);
                    for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
                        const a = panels[i]; const b = panels[j];
                        assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1,
                            `salary ${viewport.width}: panels overlap`);
                    }
                }
                await page.locator('main').screenshot({path:path.join(output,`matrix-${view}-${viewport.width}-dark.png`),animations:'disabled'});
            }
        }
        await page.evaluate(() => { document.body.classList.remove('dark-mode'); document.documentElement.setAttribute('data-theme','light'); localStorage.setItem('pzp_dark_mode','false'); });
        for (const view of ['overview','transactions','costing']) {
            await page.goto(`${origin}/finance?${view === 'overview' ? 'mode=overview' : `tab=${view}`}`);
            await page.locator('main').screenshot({path:path.join(output,`matrix-${view}-390-light.png`),animations:'disabled'});
        }
        await page.setViewportSize({width:1440,height:1000});
        await page.goto(`${origin}/finance?mode=overview`);
        await page.locator('[data-finance-group="planning"]').click();
        await page.locator('.fin-tab[data-tab="costing"]').click();
        assert.match(page.url(), /tab=costing/);
        await page.goBack();
        assert.equal(await page.locator('#tabBudget').isVisible(), true);
        assert.equal(new URL(page.url()).searchParams.get('tab'), 'budget');
        assert.equal(await page.locator('#financePeriodControls').isVisible(), false);
        await page.goBack();
        assert.equal(await page.locator('#faWorkspace').isVisible(), true);
        assert.equal(new URL(page.url()).searchParams.get('mode'), 'overview');
        assert.equal(await page.locator('#financePeriodControls').isVisible(), true);
        await page.goto(`${origin}/finance?tab=costing`);
        await page.locator('[data-cost-nav="management"]').click();
        assert.equal(await page.locator('#financePeriodControls').isVisible(), false);
        await page.locator('#costManagementFrom').fill('2026-09-05');
        await page.locator('#costManagementTo').fill('2026-09-20');
        const managementResponse = page.waitForResponse(item => new URL(item.url()).pathname === '/api/finance/costing/management/pnl');
        await page.locator('#costManagementRefresh').click();
        await managementResponse;
        const managementCall = requests.filter(item => item.path === '/api/finance/costing/management/pnl').at(-1);
        assert.deepEqual(managementCall.query, { from:'2026-09-05', to:'2026-09-20' });
        await page.goto(`${origin}/finance?tab=transactions`);
        assert.equal(await page.locator('#addTransactionBtn').isVisible(), true);
        assert.equal(await page.locator('#exportCsvBtn').count(), 1);
        await page.goto(`${origin}/finance?tab=transactions&fixtureViewer=1`);
        assert.equal(await page.locator('#addTransactionBtn').isVisible(), false);
        await page.locator('.fa-tools > summary').click();
        assert.equal(await page.locator('#addExpenseBtn').isVisible(), false);
        assert.equal(await page.locator('#exportCsvBtn').isVisible(), false);
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(output,'matrix.json'), JSON.stringify({views:matrix,viewportChecks:[820,390],themes:['dark','light'],back:true,roleVisibility:true},null,2));
        assert.ok(requests.every(request => request.method === 'GET'));
        console.log(JSON.stringify({passed:true,checks:['visible shared range','desktop/tablet layout','actual mode/tab clicks',
            'forecast ISO date','HTTP 500 state and GET retry','P&L deep link'],requests:requests.length,output}));
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
