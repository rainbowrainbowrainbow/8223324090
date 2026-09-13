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
    let config = { widgets: [...defaultWidgets], layout: {}, mode: 'workspace', boardState: { items: [], drawings: [], connectors: [] } };
    let options = {};
    let completed = false;
    const requests = [];
    app.post('/__qa/control', (req, res) => {
        options = { ...options, ...req.body };
        if (req.body.reset) { completed = false; options = {}; config.widgets = [...defaultWidgets]; requests.length = 0; }
        if (req.body.widgets) config.widgets = req.body.widgets;
        res.json({ success: true });
    });
    app.get('/__qa/state', (req, res) => res.json({ options, config, completed, requests }));
    app.use('/api', async (req, res) => {
        requests.push({ method: req.method, url: req.originalUrl });
        if (options.slow) await new Promise(resolve => setTimeout(resolve, 1400));
        if (req.path === '/dashboard/config') {
            if (req.method === 'PUT') {
                if (options.saveError) return res.status(503).json({ success: false, error: 'Тестова помилка збереження' });
                config = { ...config, ...req.body };
            }
            return res.json({ success: true, config });
        }
        if (req.path === '/tasks/501/status' && req.method === 'PATCH') {
            if (options.taskError || options.denied) return res.status(options.denied ? 403 : 503).json({ success: false, error: 'Тестова відмова виконання' });
            completed = true;
            return res.json({ success: true, task: { id: 501, status: 'done' } });
        }
        if (req.path.startsWith('/dashboard/widgets/')) {
            const type = req.path.split('/').pop();
            if (options.error === 'all' || options.error === type || options.denied) return res.status(options.denied ? 403 : 503).json({ success: false, error: 'Тестове джерело недоступне' });
            const title = options.long ? 'ПеревіритиРеквізитТаУзгодитиСценарій'.repeat(9) : 'Перевірити реквізит до неонового шоу';
            const tasks = options.empty ? [] : [
                ...(!completed ? [{ id: 501, title, status: 'in_progress', priority: 'high', ownerLabel: 'Тестова команда', deadline: '2026-09-13T12:00:00Z' }] : []),
                { id: 502, title: 'Підготувати залу до приходу гостей', status: 'todo', priority: 'medium', ownerLabel: 'Тестова команда' }
            ];
            const data = {
                quick_stats: { bookingsToday: options.empty ? 0 : 3, activeTasks: tasks.filter(task => task.status === 'in_progress').length, revenueToday: 0, overdueTasks: 0, unconfirmedBookings: 0, alerts: [] },
                my_focus: { tasks: tasks.filter(task => task.id === 501), overdueCount: 0, waitingCount: 0 },
                tasks: { tasks },
                nearest_event: { event: options.empty ? null : { id: 'DASH-QA-42', date: '2026-09-13', time: '14:30', program: options.long ? title : 'Неонове шоу', room: 'Святкова зала', clientName: 'Тестова подія · DASH QA', responsibleLabel: 'Тестова команда', status: 'confirmed', canonicalHref: '/booking-summary.html?id=DASH-QA-42&businessContext=event_genix&return=%2Fdashboard' }, confirmation: { status: 'confirmed', label: 'Підтверджено', confirmed: true }, preparation: { tasks, totalCount: options.empty ? 0 : 2, openCount: tasks.length, doneCount: completed ? 1 : 0, overdueCount: 0 } },
                funnel: { items: [], meta: { funnelInsights: { total: options.empty ? 0 : 8, waitingAction: options.empty ? 0 : 2, stages: options.empty ? [] : [{ stage: 'negotiation', label: 'Узгодження', total: 5, waitingAction: 2, href: '/sales-funnel?view=kanban&pipeline_stage=negotiation' }] } } },
                weather: { temp: 21, temperature: 21, city: 'Київ', description: 'Мінлива хмарність' }
            }[type] || {};
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
