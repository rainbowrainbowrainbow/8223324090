'use strict';

// Explicit local QA fixture: real UI assets, synthetic in-memory data, no app/DB/provider imports.
// Run: node tests/browser/finance-workflow-fixture.js
// Open the printed URL with ?theme=light|dark, ?viewer=1, or &tab=budget/accounts/transactions.
// The category name "Помилка QA" intentionally produces a synthetic HTTP 400.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const publicDirectories = new Set(['css', 'js', 'images', 'fonts', 'icons']);
const mime = { '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

function bootstrap() {
    return `<script>
window.__financeFixture = { synthetic: true, viewer: new URLSearchParams(location.search).get('viewer') === '1', requests: [] };
window.AppState = {};
window.getCrmBusinessContext = () => 'event_genix';
window.getCrmBusinessProfile = () => ({ key: 'event_genix', businessContext: 'event_genix' });
window.apiVerifyToken = async () => ({ id: 900001, name: 'Synthetic QA', username: 'synthetic-qa', role: window.__financeFixture.viewer ? 'viewer' : 'creator' });
window.hydrateActionPermissions = async () => ({ synthetic: true });
window.canUseAction = action => !window.__financeFixture.viewer || ['view_revenue', 'view_payroll'].includes(action);
window.canAccess = window.canUseAction;
window.canAccessPage = () => true;
window.getAuthHeaders = json => ({ ...(json ? {'Content-Type': 'application/json'} : {}), 'X-Fixture-Viewer': window.__financeFixture.viewer ? '1' : '0' });
window.handleAuthError = () => false;
window.getLegacyBusinessSurfaceAvailability = () => ({ available: true });
window.apiFetchWithAuthRetry = (input, options = {}) => {
    const url = new URL(input, location.origin);
    if (url.origin !== location.origin) throw new Error('Synthetic fixture blocks external requests');
    window.__financeFixture.requests.push({ method: options.method || 'GET', path: url.pathname, query: url.search });
    return fetch(url, { ...options, headers: { ...getAuthHeaders(Boolean(options.body)), ...options.headers } });
};
window.__fixtureJson = async (url, options) => {
    const response = await apiFetchWithAuthRetry(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Synthetic fixture error');
    return data;
};
window.apiGetBudgetComparison = (year, month) => __fixtureJson('/api/finance/budget/comparison?year=' + year + '&month=' + month);
window.apiSaveBudget = body => __fixtureJson('/api/finance/budget', { method: 'PUT', body: JSON.stringify(body) });
window.initDarkMode = () => {
    const dark = new URLSearchParams(location.search).get('theme') !== 'light';
    localStorage.setItem('pzp_dark_mode', String(dark));
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.body.classList.toggle('dark-mode', dark);
};
window.showAuthenticatedPageShell = () => {
    document.getElementById('mainApp')?.classList.remove('hidden');
    document.body.classList.add('shell-ready');
    initDarkMode();
};
initDarkMode();
</script><script src="/js/ui.js"></script><script src="/js/analytics-page.js"></script>
<script src="/js/finance-page.js"></script><script src="/js/finance-costing.js"></script>`;
}

function createFixtureServer() {
    const categories = [
        { id: 1, name: 'Бронювання', type: 'income', icon: '🎉', color: '#10b981', isSystem: true, sortOrder: 1 },
        { id: 2, name: 'Матеріали QA', type: 'expense', icon: '🛒', color: '#6366f1', isSystem: false, sortOrder: 2 },
        { id: 3, name: 'Оренда QA', type: 'expense', icon: '🏠', color: '#f59e0b', isSystem: false, sortOrder: 3 }
    ];
    const accounts = [{ id: 1, name: 'Каса QA', emoji: '💵', type: 'cash', description: 'Синтетичні дані локальної QA' }];
    const plans = new Map([[2, 2500]]);
    let categoryId = 4;
    let accountId = 2;
    const requests = [];
    const now = new Date();
    const currentMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit' }).format(now);
    const monthMatch = currentMonth.match(/(\d{4})\D(\d{2})/);
    const month = monthMatch ? `${monthMatch[1]}-${monthMatch[2]}` : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const date = day => `${month}-${String(day).padStart(2, '0')}`;
    const iso = value => value.toISOString().slice(0, 10);
    const shiftDate = (value, days) => iso(new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000));
    const calendarMonth = (year, number) => ({
        from: iso(new Date(Date.UTC(year, number - 1, 1))),
        to: iso(new Date(Date.UTC(year, number, 0)))
    });
    function previousRange(range) {
        const first = new Date(`${range.from}T00:00:00Z`);
        const last = new Date(`${range.to}T00:00:00Z`);
        const fullMonths = first.getUTCDate() === 1
            && range.to === calendarMonth(last.getUTCFullYear(), last.getUTCMonth() + 1).to;
        const days = Math.round((last - first) / 86400000) + 1;
        const months = (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth() + 1;
        return { from: fullMonths ? calendarMonth(first.getUTCFullYear(), first.getUTCMonth() + 1 - months).from
            : shiftDate(range.from, -days), to: shiftDate(range.from, -1), basis: fullMonths ? 'calendar-months' : 'equal-days' };
    }
    const totals = { income: 11600, expense: 2100, profit: 9500 };
    const transactions = [
        { id: 1, date: date(3), type: 'income', categoryId: 1, description: 'Заняття QA', amount: 11600, paymentMethod: 'card', createdBy: 'Synthetic QA' },
        { id: 2, date: date(4), type: 'expense', categoryId: 2, description: 'Матеріали для заняття QA', amount: 1750, paymentMethod: 'cash', createdBy: 'Synthetic QA' },
        { id: 3, date: date(5), type: 'expense', categoryId: null, description: 'Нерозподілена витрата QA', amount: 350, paymentMethod: 'cash', createdBy: 'Synthetic QA' }
    ];

    function json(res, status, data) {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(JSON.stringify(data));
    }
    async function readBody(req) {
        let body = '';
        for await (const chunk of req) {
            body += chunk;
            if (body.length > 65536) throw new Error('Synthetic fixture body limit exceeded');
        }
        return body ? JSON.parse(body) : {};
    }
    function transactionView(tx) {
        const category = categories.find(item => item.id === tx.categoryId);
        return { ...tx, categoryName: category?.name || null, categoryIcon: category?.icon || null };
    }
    function budgetData() {
        const rows = [1, 2, null].map(id => {
            const category = categories.find(item => item.id === id);
            const actual = transactions.filter(tx => tx.categoryId === id).reduce((sum, tx) => sum + tx.amount, 0);
            const planned = plans.get(id) || 0;
            return { categoryId: id, categoryName: category?.name || 'Без категорії', categoryType: category?.type || 'expense',
                categoryIcon: category?.icon || '📁', hasPlan: plans.has(id), planned, actual, diff: actual - planned,
                percentUsed: planned ? Math.round(actual / planned * 100) : null, transactionCount: 1 };
        });
        for (const [id, planned] of plans) {
            if (rows.some(row => row.categoryId === id)) continue;
            const category = categories.find(item => item.id === id);
            rows.push({ categoryId: id, categoryName: category?.name || 'QA', categoryType: category?.type || 'expense',
                categoryIcon: category?.icon || '📁', hasPlan: true, planned, actual: 0, diff: -planned, percentUsed: 0, transactionCount: 0 });
        }
        const planned = type => rows.filter(row => row.categoryType === type).reduce((sum, row) => sum + row.planned, 0);
        return { comparison: rows, totals: { incomeActual: totals.income, expenseActual: totals.expense,
            profitActual: totals.profit, incomePlanned: planned('income'), expensePlanned: planned('expense'),
            profitPlanned: planned('income') - planned('expense') } };
    }

    async function api(req, res, url) {
        requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
        if (req.method !== 'GET' && req.headers['x-fixture-viewer'] === '1') return json(res, 403, { error: 'Synthetic viewer cannot mutate fixture data' });
        const match = url.pathname.match(/^\/api\/finance\/categories(?:\/(\d+))?$/);
        if (match) {
            const item = categories.find(value => value.id === Number(match[1]));
            if (req.method === 'GET') return json(res, 200, categories.filter(value => !value.archived).map(({ archived, ...value }) => value));
            if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return json(res, 405, { error: 'Fixture method not supported' });
            if (match[1] && !item) return json(res, 404, { error: 'Synthetic category not found' });
            const body = await readBody(req);
            if (String(body.name || '').trim() === 'Помилка QA') return json(res, 400, { error: 'Синтетична помилка QA: категорію не збережено' });
            if (req.method === 'DELETE') {
                if (item.isSystem) return json(res, 400, { error: 'Cannot archive synthetic system category' });
                item.archived = true;
                return json(res, 200, { success: true });
            }
            const name = body.name === undefined && item ? item.name : String(body.name || '').trim();
            const type = item?.type || body.type;
            if (!name || !['income', 'expense'].includes(type)) return json(res, 400, { error: 'Назва і тип категорії обов’язкові' });
            if (item?.isSystem && name !== item.name) return json(res, 400, { error: 'Назву системної категорії змінювати не можна' });
            if (categories.some(value => value !== item && !value.archived && value.type === type && value.name.toLocaleLowerCase('uk-UA') === name.toLocaleLowerCase('uk-UA'))) return json(res, 409, { error: 'Категорія з такою назвою вже існує' });
            if (item) {
                Object.assign(item, { name, icon: body.icon ?? item.icon, color: body.color ?? item.color });
                return json(res, 200, { success: true });
            }
            const created = { id: categoryId++, name, type, icon: body.icon || '📁', color: body.color || '#6366f1', isSystem: false, sortOrder: 99 };
            categories.push(created);
            return json(res, 201, created);
        }
        const accountMatch = url.pathname.match(/^\/api\/finance\/accounts(?:\/(\d+))?$/);
        if (accountMatch) {
            if (req.method === 'GET') return json(res, 200, { success: true, accounts: accounts.filter(account => account.is_active !== false) });
            if (req.method === 'POST') {
                const body = await readBody(req);
                if (!String(body.name || '').trim()) return json(res, 400, { error: 'Назва обов’язкова' });
                const account = { id: accountId++, name: body.name.trim(), type: body.type || 'cash', emoji: body.emoji || '💳', description: body.description || null };
                accounts.push(account);
                return json(res, 200, { success: true, account });
            }
            if (req.method === 'PATCH' && accountMatch[1]) {
                const account = accounts.find(item => item.id === Number(accountMatch[1]));
                if (!account) return json(res, 404, { error: 'Synthetic account not found' });
                const body = await readBody(req);
                for (const field of ['name', 'emoji', 'description']) {
                    if (Object.hasOwn(body, field)) account[field] = body[field];
                }
                if (Object.hasOwn(body, 'isActive')) account.is_active = body.isActive === true;
                return json(res, 200, { success: true, account });
            }
        }
        if (url.pathname === '/api/finance/budget' && req.method === 'PUT') {
            const body = await readBody(req);
            plans.set(Number(body.categoryId), Number(body.plannedAmount));
            return json(res, 200, { success: true });
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'This local fixture only mutates categories, accounts and budget plans' });
        const selectedMonth = (url.searchParams.get('from') || date(1)).slice(0, 7);
        const dated = day => `${selectedMonth}-${String(day).padStart(2, '0')}`;
        const analyticsPeriod = { from: url.searchParams.get('from') || date(1),
            to: url.searchParams.get('to') || calendarMonth(Number(month.slice(0, 4)), Number(month.slice(5))).to };
        const recordedDays = Math.round((Date.parse(`${analyticsPeriod.to}T00:00:00Z`) - Date.parse(`${analyticsPeriod.from}T00:00:00Z`)) / 86400000) + 1;
        const recordedTrend = Array.from({ length: recordedDays }, (_, index) => ({
            date: shiftDate(analyticsPeriod.from, index), accepted: index === 2 ? 3 : 0, closed: index === 2 ? 2 : 0
        }));
        const pnlYear = Number(url.searchParams.get('year')) || Number(month.slice(0, 4));
        const pnlMonth = Number(url.searchParams.get('month'));
        const pnlPeriod = pnlMonth >= 1 && pnlMonth <= 12 ? calendarMonth(pnlYear, pnlMonth)
            : { from: `${pnlYear}-01-01`, to: `${pnlYear}-12-31` };
        const previousPnlPeriod = pnlMonth >= 1 && pnlMonth <= 12 ? calendarMonth(pnlYear, pnlMonth - 1)
            : { from: `${pnlYear - 1}-01-01`, to: `${pnlYear - 1}-12-31` };
        const forecastDays = Number(url.searchParams.get('days')) || 30;
        const todayParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
        const todayPart = type => todayParts.find(part => part.type === type).value;
        const today = `${todayPart('year')}-${todayPart('month')}-${todayPart('day')}`;
        const forecastPeriod = { from: today, to: shiftDate(today, forecastDays - 1), days: forecastDays };
        const forecastWeekStart = shiftDate(today, 1 - (new Date(`${today}T00:00:00Z`).getUTCDay() || 7));
        const daily = [{ date: dated(3), income: 2800, expense: 900 }, { date: dated(10), income: 4100, expense: 1200 }];
        const data = {
            '/api/finance/dashboard': { totals, bookingRevenue: { revenue: 11600, count: 6 }, daily,
                incomeByCategory: [{ name: 'Бронювання', total: 11600 }], expenseByCategory: [{ name: 'Матеріали QA', total: 1750 }, { name: 'Без категорії', total: 350 }] },
            '/api/analytics/overview': { finance: totals, bookings: { revenue: 11600, total: 6, confirmed: 4, preliminary: 2, avgCheck: 1933 }, customers: { newCustomers: 4, prevNew: 3 }, hr: { totalHours: 84, activeStaff: 6 } },
            '/api/analytics/charts': { dailyFinance: daily, dailyBookings: [{ date: dated(3), revenue: 2800, count: 2 }, { date: dated(10), revenue: 8800, count: 4 }],
                topPrograms: [{ name: 'Заняття QA', count: 4, revenue: 7200 }, { name: 'Оренда QA', count: 2, revenue: 4400 }],
                financeCategories: [{ name: 'Бронювання', total: 11600, color: '#10b981' }],
                weekdayLoad: [{ name: 'Пн', count: 2 }, { name: 'Вт', count: 0 }, { name: 'Ср', count: 1 }, { name: 'Чт', count: 6 }, { name: 'Пт', count: 4 }, { name: 'Сб', count: 12 }, { name: 'Нд', count: 8 }],
                customerSegments: { total: 6, champions: 1, loyal: 2, potential: 3 } },
            '/api/analytics/comparison': { current: analyticsPeriod, previous: previousRange(analyticsPeriod), metrics: [{ key: 'finIncome', label: 'Доходи', current: 11600, previous: 9800, growth: 18.4 }] },
            '/api/analytics/deals-lifecycle': { period: analyticsPeriod, accepted: 5, closed: 4, conversionRatio: 80, dataMode: 'snapshot-only', stageTimestampTruth: 'missing', trend: [{ date: dated(3), accepted: 2, closed: 1 }, { date: dated(10), accepted: 3, closed: 3 }], recordedEvents: { period: analyticsPeriod, accepted: 3, closed: 2, trend: recordedTrend, meta: { coverage: 'recorded-transitions-only', conversionAvailable: false } } },
            '/api/finance/transactions': { transactions: transactions.filter(tx => (!url.searchParams.get('type') || tx.type === url.searchParams.get('type')) && (!url.searchParams.get('categoryId') || tx.categoryId === Number(url.searchParams.get('categoryId')))).map(transactionView), totalPages: 1, total: transactions.length },
            '/api/finance/report/monthly': { months: [{ monthName: 'Місяць QA', month, ...totals }], totals },
            '/api/finance/report/pnl': { period: pnlPeriod, previousPeriod: previousPnlPeriod, summary: { totalIncome: 11600, totalExpenses: 2100, grossProfit: 9500, margin: 82, incomeChange: 0, expenseChange: 0, previousIncome: 0, previousExpenses: 0, previousProfit: 0 }, bookingRevenue: 11600, revenue: [], expenses: [] },
            '/api/finance/shift/current': { isOpen: true, shift: { id: 1, openedAt: `${date(1)}T09:00:00Z`, openingCash: 5000, cashIncome: 0, cashExpense: 2100, expectedCash: 2900 } },
            '/api/finance/shift/history': { shifts: [{ opened_at: `${date(1)}T09:00:00Z`, closed_at: null, opening_cash: 5000, closing_cash: null, expected_cash: null, cash_difference: null, status: 'open' }] },
            '/api/finance/debts': { totalDebt: 70700, count: 101, returnedCount: 2, hasMore: true, debts: [1, 2].map(id => ({ date: date(id), label: `Оренда QA ${id}`, customerName: `Синтетичний клієнт ${id}`, price: 1700, paidAmount: 1000, debtAmount: 700, bookingId: `synthetic-${id}` })) },
            '/api/finance/budget/comparison': budgetData(),
            '/api/finance/forecast': { period: forecastPeriod, totals: { expectedRevenue: 8700, bookingCount: 5, expectedOutstanding: 5700, recordedPaid: 3000, unpaidBookingCount: 3 }, weekly: [{ week_start: forecastWeekStart, booking_count: 5, expected_revenue: 8700, expected_outstanding: 5700 }], historicalAverage: [] },
            '/api/finance/advanced-dashboard': { metrics: { monthIncome: 11600, monthExpense: 2100, monthProfit: 9500, avgBookingPrice: 1933, bookingsCount: 6, margin: 82 }, revenueTrend: [], topExpenses: [] },
            '/api/finance/currency/rates': { base: 'UAH', rates: {}, updatedAt: null, source: 'synthetic-fixture-unavailable', stale: true },
            '/api/dashboard/widgets/currency': { base: 'UAH', rates: { USD: 42.1234, EUR: 45.1234 }, date: '08.10.2026' },
            '/api/finance/report/salary': { staff: [], totals: { net: 0, paid: 0, balance: 0, base: 0, additional: 0, bonuses: 0, deductions: 0, advances: 0 } },
            '/api/payroll/schemes': { staff: [], schemes: [], totals: {} },
            '/api/payroll/payment-options': { success: true, businessContext: 'event_genix', accounts, paymentMethods: ['cash', 'card', 'transfer', 'mixed'], categories: { expense: categories.filter(c => c.type === 'expense' && !c.archived), income: categories.filter(c => c.type === 'income' && !c.archived) } },
            '/api/finance/costing/templates': { templates: [] }, '/api/finance/costing/plans': { plans: [] },
            '/api/finance/costing/actual/plans/summaries': { plans: [] }, '/api/finance/costing/actual/groups': { groups: [] },
            '/api/finance/costing/management/pnl': { summary: { earnedRevenueMinor: '0', directCostMinor: '0', contributionMinor: '0' }, lines: [], unresolved: [] },
            '/api/staff/link-status': { linked: false }, '/api/personal-accounts/my': { accounts: [] }
        }[url.pathname];
        return data === undefined ? json(res, 404, { error: `No synthetic fixture for ${url.pathname}` }) : json(res, 200, data);
    }

    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (url.pathname.startsWith('/api/')) return await api(req, res, url);
            if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Read-only static fixture' });
            if (['/', '/finance', '/finance.html'].includes(url.pathname)) {
                const html = fs.readFileSync(path.join(root, 'finance.html'), 'utf8')
                    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<link\b[^>]*href=["']https?:\/\/[^>]*>/gi, '')
                    .replace('</body>', `${bootstrap()}</body>`);
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
                    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'" });
                return res.end(req.method === 'HEAD' ? '' : html);
            }
            const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
            const extension = path.extname(parts.at(-1) || '').toLowerCase();
            if (!publicDirectories.has(parts[0]) || parts.some(part => part.startsWith('.') || part.includes('\\')) || !mime[extension]) return json(res, 404, { error: 'Not a public fixture asset' });
            const file = path.resolve(root, ...parts);
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()
                || !fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep)) return json(res, 404, { error: 'Asset not found' });
            res.writeHead(200, { 'Content-Type': mime[extension], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            res.end(req.method === 'HEAD' ? '' : fs.readFileSync(file));
        } catch (error) { json(res, 400, { error: `Synthetic fixture: ${error.message}` }); }
    });
    return { server, requests, categories, accounts };
}

if (require.main === module) {
    const { server } = createFixtureServer();
    server.on('error', error => { console.error(`Fixture failed: ${error.message}`); process.exitCode = 1; });
    server.listen(0, '127.0.0.1', () => {
        const origin = `http://127.0.0.1:${server.address().port}`;
        console.log(`Synthetic finance UI fixture: ${origin}/finance?theme=dark`);
        console.log(`Light theme: ${origin}/finance?theme=light`);
        console.log(`Read-only viewer: ${origin}/finance?theme=dark&viewer=1`);
        console.log('No real auth, database or external network. Only in-memory QA mutations; Ctrl+C to stop.');
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}

module.exports = { createFixtureServer };
