'use strict';

// Local browser QA only. Real Dashboard HTML/CSS/JS with disposable in-memory API data.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');

function startFixture(port = 0) {
    const app = express();
    app.use(express.json());
    const defaultWidgets = ['quick_stats', 'my_focus', 'funnel', 'nearest_event', 'weather'];
    let configRevision = 1;
    const revision = () => new Date(Date.UTC(2026, 8, 13, 10, 0, 0, configRevision)).toISOString();
    const initialConfig = () => ({ widgets: [...defaultWidgets], layout: {}, mode: 'workspace', serverRevision: revision(), boardState: { items: [], drawings: [], connectors: [] } });
    let config = initialConfig();
    let options = {};
    let completed = false;
    const doneTasks = new Set();
    const snoozedTasks = new Set();
    const focusedTasks = new Set([502]);
    const requests = [];
    app.post('/__qa/control', (req, res) => {
        if (req.body.reset) {
            completed = false;
            options = {};
            configRevision = 1;
            config = initialConfig();
            doneTasks.clear();
            snoozedTasks.clear();
            focusedTasks.clear();
            focusedTasks.add(502);
            requests.length = 0;
        }
        options = { ...options, ...req.body };
        if (Array.isArray(req.body.widgets)) config.widgets = req.body.widgets;
        if (req.body.layout) config.layout = { ...config.layout, ...req.body.layout };
        res.json({ success: true });
    });
    app.get('/__qa/state', (req, res) => res.json({ options, config, completed, requests }));
    app.use('/api', async (req, res) => {
        requests.push({ method: req.method, url: req.originalUrl });
        if (options.slow) await new Promise(resolve => setTimeout(resolve, 1400));
        if (req.path === '/dashboard/config') {
            if (req.method === 'PUT') {
                if (options.saveError) return res.status(503).json({ success: false, error: 'Тестова помилка збереження' });
                if (options.saveConflict || req.body.baseRevision !== config.serverRevision) return res.status(409).json({ success: false, conflict: true, currentConfig: config, error: 'Тестова розкладка змінилася в іншій вкладці' });
                configRevision += 1;
                config = { ...config, ...req.body, layout: { ...config.layout, ...(req.body.layout || {}) }, serverRevision: revision() };
            }
            return res.json({ success: true, config });
        }
        const taskAction = req.path.match(/^\/tasks\/(501|502)\/(status|focus|snooze)$/);
        if (taskAction && req.method === (taskAction[2] === 'status' ? 'PATCH' : 'POST')) {
            if (options.taskError || options.denied) return res.status(options.denied ? 403 : 503).json({ success: false, error: 'Тестова відмова виконання' });
            const id = Number(taskAction[1]);
            if (taskAction[2] === 'status') {
                if (req.body.status !== 'done') return res.status(400).json({ success: false, error: 'Fixture accepts only done status' });
                doneTasks.add(id);
                completed = doneTasks.has(501);
            }
            if (taskAction[2] === 'focus') {
                if (req.body.enabled === false) focusedTasks.delete(id);
                else focusedTasks.add(id);
            }
            if (taskAction[2] === 'snooze') snoozedTasks.add(id);
            return res.json({ success: true, task: { id, status: doneTasks.has(id) ? 'done' : (id === 501 ? 'in_progress' : 'todo'), focus_rank: focusedTasks.has(id) ? 1 : 0, isSelectedFocus: focusedTasks.has(id), snoozed_until: snoozedTasks.has(id) ? '2026-09-14T10:00:00Z' : null } });
        }
        if (req.path.startsWith('/dashboard/widgets/')) {
            const type = req.path.split('/').pop();
            if (options.error === 'all' || options.error === type || options.denied) return res.status(options.denied ? 403 : 503).json({ success: false, error: 'Тестове джерело недоступне' });
            const title = options.long ? 'ПеревіритиРеквізитТаУзгодитиСценарій'.repeat(9) : 'Перевірити реквізит до неонового шоу';
            const allTasks = options.empty ? [] : [
                { id: 501, title, status: 'in_progress', priority: 'high', ownerLabel: 'Тестова команда', deadline: '2026-09-13T12:00:00Z', effectiveDate: '2026-09-13', effectiveDueAt: '2026-09-13T12:00:00Z', dueState: 'today', isOverdue: false },
                { id: 502, title: 'Підготувати залу до приходу гостей', status: 'todo', priority: 'medium', ownerLabel: 'Тестова команда', effectiveDate: null, effectiveDueAt: null, dueState: 'unscheduled', isOverdue: false }
            ].map(task => ({ ...task, status: doneTasks.has(task.id) ? 'done' : task.status, focus_rank: focusedTasks.has(task.id) ? 1 : 0, isSelectedFocus: focusedTasks.has(task.id), snoozed_until: snoozedTasks.has(task.id) ? '2026-09-14T10:00:00Z' : null }));
            const tasks = allTasks.filter(task => task.status !== 'done' && !snoozedTasks.has(task.id));
            const selectedTasks = tasks.filter(task => task.isSelectedFocus);
            const recommendedTasks = tasks.filter(task => !task.isSelectedFocus);
            const businessScope = { activeContext: 'event_genix', selectedContexts: ['event_genix'] };
            const taskMeta = { sourceStates: { tasks: 'ready' }, warnings: [], partial: false, businessScope };
            const data = {
                quick_stats: { bookingsToday: options.empty ? 0 : 3, activeTasks: allTasks.filter(task => task.status === 'in_progress').length, revenueToday: 0, overdueTasks: 0, unconfirmedBookings: 0, coldLeads: options.empty ? 0 : 2, alerts: [], meta: { ...taskMeta, period: { key: 'today', date: '2026-09-13', timezone: 'Europe/Kyiv' } } },
                my_focus: { tasks: [...selectedTasks, ...recommendedTasks].slice(0, 3), selectedTasks, recommendedTasks, selectedCount: selectedTasks.length, recommendedCount: recommendedTasks.length, actionableCount: tasks.length, overdueCount: 0, waitingCount: 0, meta: taskMeta },
                tasks: { tasks },
                nearest_event: { event: options.empty ? null : { id: 'DASH-QA-42', date: '2026-09-13', time: '14:30', dateScope: 'today', program: options.long ? title : 'Неонове шоу', room: 'Святкова зала', clientName: 'Тестова подія · DASH QA', responsibleLabel: 'Тестова команда', status: 'confirmed', canonicalHref: '/booking-summary.html?id=DASH-QA-42&businessContext=event_genix&return=%2Fdashboard' }, confirmation: { status: 'confirmed', label: 'Підтверджено', confirmed: true }, preparation: { tasks: allTasks, totalCount: allTasks.length, openCount: allTasks.filter(task => task.status !== 'done').length, doneCount: allTasks.filter(task => task.status === 'done').length, overdueCount: 0 }, meta: { ...taskMeta, today: '2026-09-13', nowTime: '13:00:00', dateScope: 'today' } },
                funnel: { items: [], meta: { funnelInsights: { total: options.empty ? 0 : 8, waitingAction: options.empty ? 0 : 2, stages: options.empty ? [] : [{ stage: 'negotiation', label: 'Узгодження', total: 5, waitingAction: 2, href: '/sales-funnel?view=kanban&pipeline_stage=negotiation' }] } } },
                weather: { temp: 21, temperature: 21, city: 'Київ', description: 'Мінлива хмарність', weatherCode: 3, windSpeed: 7.2 },
                currency: { usd: 40, eur: 45 },
                bookings_today: { bookings: options.empty ? [] : [{ id: 'DASH-QA-42', start_time: '14:30', status: 'confirmed', client_name: 'Тестова подія · DASH QA', program: options.long ? title : 'Неонове шоу', children_count: 8 }], meta: taskMeta },
                my_schedule: { shifts: options.empty ? [] : [{ date: '2026-09-13', status: 'working', start_time: '10:00', end_time: '18:00' }], meta: taskMeta },
                team_online: { users: options.empty ? [] : [{ id: 9001, name: 'Тестовий користувач', username: 'dashboard.qa', isOnline: true }], meta: { ...taskMeta, onlineCount: options.empty ? 0 : 1, returned: options.empty ? 0 : 1 } },
                announcements: { announcements: options.empty ? [] : [{ id: 801, title: 'Тестове оголошення', content: options.long ? title : 'Перед початком події перевірте реквізит і робочий розклад.', created_at: '2026-09-13T09:00:00Z', author_name: 'Тестова команда' }] },
                alerts: { alerts: options.empty ? [] : [{ level: 'info', icon: 'ℹ', title: 'Тестова задача потребує перевірки', link: '/tasks?open=501' }], meta: taskMeta },
                exceptions: { exceptions: options.empty ? [] : [{ level: 'warning', icon: '⚠', title: 'Тестове попередження про підготовку', link: '/tasks?open=501' }], categories: { overduePrep: options.empty ? 0 : 1 }, meta: taskMeta },
                event_risk_summary: { cards: [
                    { key: 'unconfirmed_today', kind: 'unconfirmed', label: 'Непідтверджені сьогодні', count: 0, href: '/?date=2026-09-13' },
                    { key: 'unconfirmed_tomorrow', kind: 'unconfirmed', label: 'Непідтверджені завтра', count: 0, href: '/?date=2026-09-14' },
                    { key: 'late_preliminary', kind: 'late_preliminary', label: 'Критично пізні попередні', count: 0, href: '/?date=2026-09-13' },
                    { key: 'overdue_prep', kind: 'overdue_prep', label: 'Прострочена підготовка', count: 0, href: '/tasks?source_type=booking&overdue=1&businessContext=event_genix' },
                    { key: 'resource_warnings', kind: 'resource_warnings', label: 'Питання ресурсів сьогодні', count: 0, href: '/?date=2026-09-13' }
                ], meta: taskMeta },
                leads_new: { leads: options.empty ? [] : [{ id: 701, name: 'Тестовий лід DASH QA', client_name: 'Тестовий лід DASH QA', phone: '', created_at: '2026-09-13T09:00:00Z' }], total: options.empty ? 0 : 1, meta: taskMeta },
                finance_today: { bookingValue: 0, revenue: 0, bookings: 0, meta: taskMeta },
                reports_today: { income: 0, expense: 0, newCount: 0, meta: taskMeta },
                director_pnl: { week: { bookingValue: 0 }, month: { bookingValue: 0 }, meta: taskMeta },
                operations: { quality: { avg_rating: null }, complaintsWeek: 0, staffNotCheckedIn: 0, procurement: options.empty ? [] : [{ name: 'Тестовий реквізит', status: 'ordered' }], meta: taskMeta },
                hr_overview: { absent: [], pendingLeaves: options.empty ? [] : [{ id: 901, name: 'Тестовий працівник', type: 'Відпустка', date_from: '2026-09-20', date_to: '2026-09-21' }], birthdays: [], contractsExpiring: [], meta: taskMeta },
                team_tasks: { tasks: tasks.map(task => ({ ...task, assigned_to: 'Тестова команда', is_overdue: false, subtask_count: 6, subtask_done_count: 2 })), stats: { todo: tasks.filter(task => task.status === 'todo').length, in_progress: tasks.filter(task => task.status === 'in_progress').length, overdue: 0 }, meta: taskMeta },
                task_health: { healthy: tasks.length, warning: 0, critical: 0, avg_score: tasks.length ? 100 : 0, meta: taskMeta },
                staff_today: { onShift: options.empty ? [] : [{ name: 'Тестовий працівник', department: 'animators', shift_start: '10:00', shift_end: '18:00', is_online: true }], absent: [], meta: taskMeta },
                week_bookings: { from: '2026-09-13', days: options.empty ? [] : [{ date: '2026-09-13', count: 1, confirmed: 1, pending: 0, revenue: 0 }], meta: taskMeta },
                account_stats: { total_staff: 1, with_account: 1, without_account: 0, freelance_slots: 0, meta: taskMeta },
                catalogs: { definitions: [], recentItems: [], legacyCatalogs: { available: false, message: 'Спільні каталоги тимчасово недоступні у цьому бізнесі.' } },
                content_pipeline: { inReview: options.empty ? [] : [{ title: options.long ? title : 'Тестовий сценарій на перевірці' }], approvedThisWeek: 0, designTasks: [], catalogs: [], legacyCatalogs: { available: false, message: 'Спільні каталоги тимчасово недоступні у цьому бізнесі.' }, meta: { ...taskMeta, partial: true, sourceStates: { inReview: 'ready', catalogs: 'unavailable' }, warnings: [{ source: 'catalogs', message: 'Спільні каталоги тимчасово недоступні у цьому бізнесі.' }] } }
            }[type] || {};
            if (options.partial === 'all' || options.partial === type) data.meta = { ...taskMeta, partial: true, sourceStates: { primary: 'ready', secondary: 'unavailable' }, warnings: [{ source: 'secondary', message: 'Частина тестових джерел недоступна.' }] };
            return res.json({ success: true, data });
        }
        if (req.path === '/bookings/DASH-QA-42/banquet-summary') return res.json({
            success: true, mode: 'client', bookingId: 'DASH-QA-42',
            document: { title: 'БАНКЕТНИЙ ЛИСТ', generatedBy: 'Dashboard QA' },
            event: { date: '2026-09-13', time: '14:30', room: 'Святкова зала', programName: 'Неонове шоу', programDisplayName: 'Неонове шоу', hasRealProgram: true },
            customer: { name: 'Тестова подія · DASH QA', children: [] }, counts: { children: 8, adults: 2, guests: 10 },
            responsible: { rows: [{ label: 'Команда', name: 'Тестова команда', modes: ['client'] }] },
            venue: { name: 'Event Genix' }, schedule: [], orderRows: [], totals: {}, notes: []
        });
        return res.json({ success: true, data: [], users: [], alerts: [] });
    });
    app.get('/dashboard', (req, res) => {
        let html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
        html = html.replace('</body>', `<script src="/js/config.js"></script><script>
            AppState.currentUser = { id: 9001, username: 'dashboard.qa', name: 'Тестовий користувач', role: 'manager' };
            localStorage.setItem('pzp_token', 'local-fixture-only');
            window.apiVerifyToken = async () => AppState.currentUser;
            window.hydrateActionPermissions = async () => ({});
            window.captureAuthBootstrapSession = () => ({});
            window.isAuthBootstrapSessionCurrent = () => true;
            window.enforceCurrentPageAccess = () => true;
            window.getUserRole = () => 'manager'; window.hasMinRole = () => true;
            window.ROLE_NAMES = { manager: 'Менеджер' };
            window.canAccessPage = () => true; window.canAccess = () => true;
            window.resolveCapability = () => ({ allowed: true });
            window.CrmBusinessContext = { current: () => 'event_genix', scope: () => ({ activeContext:'event_genix', selectedContexts:['event_genix'] }), apiUrl: url => url + (url.includes('?') ? '&' : '?') + 'businessContext=event_genix' };
            window.showNotification = (message, type) => { window.__qaNotifications = [...(window.__qaNotifications || []), {message, type}]; };
            document.documentElement.dataset.theme = localStorage.getItem('pzp_dark_mode') === 'true' ? 'dark' : 'light';
            document.body.classList.toggle('dark-mode', document.documentElement.dataset.theme === 'dark');
        </script><script src="/js/components/sidebar.js"></script><script>Sidebar.init();</script>
        <script src="/js/dashboard-page.js"></script><script src="/js/ui.js"></script></body>`);
        res.send(html);
    });
    // Serve only public frontend assets; never expose local env files or secrets.
    for (const dir of ['css', 'js', 'images', 'fonts']) app.use('/' + dir, express.static(path.join(ROOT, dir)));
    app.get('/booking-summary.html', (req, res) => res.send(fs.readFileSync(path.join(ROOT, 'booking-summary.html'), 'utf8')
        .replace(/<script[^>]+src="js\/(?:auth|ws)\.js[^>]+><\/script>/g, '')));
    app.get('/sales-funnel', (req, res) => res.sendFile(path.join(ROOT, 'leads.html')));
    return new Promise(resolve => { const server = app.listen(port, '127.0.0.1', () => resolve(server)); });
}
module.exports = { startFixture };
if (require.main === module) startFixture(4315).then(() => console.log('Dashboard QA fixture: http://127.0.0.1:4315/dashboard'));
