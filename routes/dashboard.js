/**
 * routes/dashboard.js — Dashboard API (v24.3.0)
 * User dashboard config, widget data, /today aggregate, weather/currency cache
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { getDefaultWidgets } = require('../config/roles');
const { createLogger } = require('../utils/logger');
const { getKyivDateStr } = require('../services/booking');

const log = createLogger('Dashboard');

// All routes require authentication
router.use(authenticateToken);

// GET /api/dashboard/config — user's dashboard configuration
router.get('/config', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT layout, widgets, theme FROM dashboard_configs WHERE user_id = $1',
            [req.user.id]
        );

        if (result.rows.length > 0) {
            return res.json({ success: true, config: result.rows[0] });
        }

        // Return defaults based on role
        const defaultWidgets = getDefaultWidgets(req.user.role);
        res.json({
            success: true,
            config: {
                layout: {},
                widgets: defaultWidgets,
                theme: 'default'
            },
            isDefault: true
        });
    } catch (err) {
        log.error('Failed to get dashboard config', err);
        res.status(500).json({ error: 'Failed to load dashboard config' });
    }
});

// PUT /api/dashboard/config — save user's dashboard configuration
router.put('/config', async (req, res) => {
    try {
        const { layout, widgets, theme } = req.body;
        await pool.query(`
            INSERT INTO dashboard_configs (user_id, layout, widgets, theme, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET layout = $2, widgets = $3, theme = $4, updated_at = NOW()
        `, [req.user.id, JSON.stringify(layout || {}), JSON.stringify(widgets || []), theme || 'default']);

        res.json({ success: true });
    } catch (err) {
        log.error('Failed to save dashboard config', err);
        res.status(500).json({ error: 'Failed to save dashboard config' });
    }
});

// GET /api/dashboard/widgets/:type — widget-specific data
router.get('/widgets/:type', async (req, res) => {
    try {
        const { type } = req.params;
        let data = {};

        switch (type) {
            case 'tasks': {
                const result = await pool.query(`
                    SELECT id, title, status, priority, deadline, category
                    FROM tasks
                    WHERE (assigned_to = $1 OR created_by = $1)
                    AND status != 'done' AND status != 'cancelled'
                    ORDER BY
                        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                        deadline ASC NULLS LAST
                    LIMIT 10
                `, [req.user.name]);
                data = { tasks: result.rows };
                break;
            }

            case 'bookings_today': {
                const today = getKyivDateStr();
                const result = await pool.query(`
                    SELECT b.id, b.label as client_name, b.program_name as program,
                           b.time as start_time, b.room, b.status, b.kids_count as children_count
                    FROM bookings b
                    WHERE b.date = $1 AND b.status != 'cancelled'
                    ORDER BY b.time ASC
                `, [today]);
                data = { bookings: result.rows, date: today };
                break;
            }

            case 'my_schedule': {
                const today = getKyivDateStr();
                const result = await pool.query(`
                    SELECT ss.date, ss.status, ss.shift_start as start_time, ss.shift_end as end_time, ss.note
                    FROM staff_schedule ss
                    JOIN employee_profiles ep ON ep.staff_id = ss.staff_id
                    WHERE ep.user_id = $1 AND ss.date::date >= $2::date
                    ORDER BY ss.date ASC
                    LIMIT 7
                `, [req.user.id, today]);
                data = { shifts: result.rows };
                break;
            }

            case 'team_online': {
                const result = await pool.query(`
                    SELECT u.id, u.name, u.role, COALESCE(u.last_seen_at, ep.last_activity_at) as last_seen
                    FROM users u
                    LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_active = true
                    WHERE u.is_active = true
                    AND u.role NOT IN ('bot', 'viewer')
                    AND (u.last_seen_at > NOW() - INTERVAL '5 minutes'
                         OR ep.last_activity_at > NOW() - INTERVAL '5 minutes')
                    ORDER BY COALESCE(u.last_seen_at, ep.last_activity_at) DESC
                `, []);
                data = { online: result.rows };
                break;
            }

            case 'quick_stats': {
                const today = getKyivDateStr();
                const [bookings, tasks, revenue, overdueQS, unconfirmedQS, lowStockQS, coldLeadsQS] = await Promise.all([
                    pool.query("SELECT COUNT(*) as count FROM bookings WHERE date = $1 AND status != 'cancelled'", [today]),
                    pool.query("SELECT COUNT(*) as count FROM tasks WHERE status = 'in_progress'"),
                    pool.query("SELECT COALESCE(SUM(price), 0) as total FROM bookings WHERE date = $1 AND status = 'confirmed'", [today]),
                    pool.query("SELECT COUNT(*) as count FROM tasks WHERE deadline < NOW() AND status NOT IN ('done','cancelled')"),
                    pool.query("SELECT COUNT(*) as count FROM bookings WHERE date = $1 AND status = 'preliminary'", [today]),
                    pool.query("SELECT COUNT(*) as count FROM warehouse_stock WHERE quantity <= min_quantity AND is_active = true"),
                    pool.query("SELECT COUNT(*) as count FROM leads WHERE status = 'new' AND created_at < NOW() - INTERVAL '48 hours'")
                ]);
                const ov = parseInt(overdueQS.rows[0].count);
                const uc = parseInt(unconfirmedQS.rows[0].count);
                const ls = parseInt(lowStockQS.rows[0].count);
                const cl = parseInt(coldLeadsQS.rows[0].count);
                data = {
                    bookingsToday: parseInt(bookings.rows[0].count),
                    activeTasks: parseInt(tasks.rows[0].count),
                    revenueToday: parseFloat(revenue.rows[0].total),
                    needsAttention: ov + uc + ls + cl,
                    overdueTasks: ov,
                    unconfirmedBookings: uc,
                    lowStockItems: ls,
                    coldLeads: cl
                };
                break;
            }

            case 'alerts': {
                const alertToday = getKyivDateStr();
                const [overdue, unconfirmed, lowStock, coldLeads, shiftCheck] = await Promise.all([
                    pool.query(`SELECT id, title, deadline FROM tasks
                                WHERE deadline < NOW() AND status NOT IN ('done','cancelled')
                                ORDER BY deadline ASC LIMIT 5`),
                    pool.query(`SELECT id, label, time FROM bookings
                                WHERE date = $1 AND status = 'preliminary' ORDER BY time LIMIT 5`, [alertToday]),
                    pool.query(`SELECT name, quantity, min_quantity, unit FROM warehouse_stock
                                WHERE quantity <= min_quantity AND is_active = true LIMIT 3`),
                    pool.query(`SELECT COUNT(*) as c FROM leads
                                WHERE status = 'new' AND created_at < NOW() - INTERVAL '48 hours'`),
                    pool.query(`SELECT
                                  (SELECT COUNT(*) FROM cash_register_shifts WHERE status = 'open') AS open_shifts,
                                  (SELECT COUNT(*) FROM bookings WHERE date = $1 AND status = 'confirmed') AS today_bk`,
                                [alertToday])
                ]);
                const alerts = [];
                overdue.rows.forEach(t => {
                    alerts.push({ id: `overdue_${t.id}`, type: 'warning', level: 'warning', icon: '⚠️',
                        title: `Прострочена: "${(t.title || '').slice(0, 40)}"`, link: '/tasks',
                        action: { label: '📋 Задача', prompt: `Задача прострочена: "${t.title}". Що робимо?` }
                    });
                });
                unconfirmed.rows.forEach(b => {
                    alerts.push({ id: `unconfirmed_${b.id}`, type: 'info', level: 'info', icon: '📋',
                        title: `Непідтверджене: ${(b.time || '').slice(0, 5)} ${b.label || ''}`, link: '/',
                        action: { label: '✅ Підтвердити', prompt: `Бронювання ${b.id} очікує підтвердження.` }
                    });
                });
                lowStock.rows.forEach((s, i) => {
                    alerts.push({ id: `stock_${i}`, type: 'warning', level: 'warning', icon: '📦',
                        title: `Мало: ${s.name} (${s.quantity} ${s.unit})`, link: '/warehouse',
                        action: { label: '📋 Замовити', prompt: `На складі мало: ${s.name} (${s.quantity}/${s.min_quantity}). Замовити.` }
                    });
                });
                const coldCount = parseInt(coldLeads.rows[0].c);
                if (coldCount > 0) {
                    alerts.push({ id: 'cold_leads', type: 'warning', level: 'warning', icon: '🥶',
                        title: `${coldCount} лідів без відповіді >48год`, link: '/sales-funnel',
                        action: { label: '📋 Обдзвін', prompt: `${coldCount} лідів без відповіді. Задача менеджеру.` }
                    });
                }
                const { open_shifts, today_bk } = shiftCheck.rows[0];
                if (parseInt(open_shifts) === 0 && parseInt(today_bk) > 0) {
                    alerts.push({ id: 'no_shift', type: 'critical', level: 'critical', icon: '🔴',
                        title: `Каса не відкрита! (${today_bk} броні)`, link: '/finance',
                        action: { label: '💰 Відкрити', prompt: 'Каса не відкрита. Нагадати.' }
                    });
                }
                data = { alerts, count: alerts.length };
                break;
            }

            case 'leads_new': {
                const result = await pool.query(`
                    SELECT id, client_name AS name, phone, source, status, created_at
                    FROM leads
                    WHERE status = 'new'
                    ORDER BY created_at DESC
                    LIMIT 8
                `);
                data = { leads: result.rows, total: result.rows.length };
                break;
            }

            case 'finance_today': {
                const finToday = getKyivDateStr();
                const [revenue, expenses, bookingCount] = await Promise.all([
                    pool.query("SELECT COALESCE(SUM(price), 0) as total FROM bookings WHERE date = $1 AND status = 'confirmed'", [finToday]),
                    pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM finance_transactions WHERE date = $1 AND type = 'expense'", [finToday]).catch(() => ({ rows: [{ total: 0 }] })),
                    pool.query("SELECT COUNT(*) as count FROM bookings WHERE date = $1 AND status != 'cancelled'", [finToday]),
                ]);
                data = {
                    revenue: parseFloat(revenue.rows[0].total),
                    expenses: parseFloat(expenses.rows[0].total),
                    bookings: parseInt(bookingCount.rows[0].count),
                    profit: parseFloat(revenue.rows[0].total) - parseFloat(expenses.rows[0].total),
                };
                break;
            }

            case 'announcements': {
                const result = await pool.query(`
                    SELECT id, title, text_content as content, priority, created_at, created_by as author_name
                    FROM announcements
                    WHERE status = 'active'
                    ORDER BY priority DESC, created_at DESC
                    LIMIT 5
                `);
                data = { announcements: result.rows };
                break;
            }

            case 'weather': {
                data = await getCachedData('weather', 1800, fetchWeather);
                break;
            }

            case 'currency': {
                data = await getCachedData('currency', 3600, fetchCurrency);
                break;
            }

            case 'reports_today': {
                const repToday = getKyivDateStr();
                const [repIncome, repExpense, repNew] = await Promise.all([
                    pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM reports WHERE created_at::date = $1 AND type = 'income'", [repToday]).catch(() => ({ rows: [{ total: 0 }] })),
                    pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM reports WHERE created_at::date = $1 AND type = 'expense'", [repToday]).catch(() => ({ rows: [{ total: 0 }] })),
                    pool.query("SELECT COUNT(*) as count FROM reports WHERE created_at::date = $1 AND status = 'new'", [repToday]).catch(() => ({ rows: [{ count: 0 }] })),
                ]);
                data = {
                    income: parseFloat(repIncome.rows[0].total),
                    expense: parseFloat(repExpense.rows[0].total),
                    newCount: parseInt(repNew.rows[0].count)
                };
                break;
            }

            case 'exceptions': {
                const excToday = getKyivDateStr();
                const [conflictsQ, noAnimatorQ, overduePrep, detractors, cleaningSLA, unconfirmedLate] = await Promise.all([
                    // Resource conflicts: same room, overlapping times
                    pool.query(`
                        SELECT b1.id as booking1, b2.id as booking2, b1.room, b1.time as time1, b2.time as time2
                        FROM bookings b1
                        JOIN bookings b2 ON b1.room = b2.room AND b1.date = b2.date AND b1.id < b2.id
                        WHERE b1.date = $1 AND b1.status != 'cancelled' AND b2.status != 'cancelled'
                          AND b1.room IS NOT NULL AND b1.room != ''
                          AND ABS(
                            (SUBSTRING(b1.time FROM 1 FOR 2)::int * 60 + SUBSTRING(b1.time FROM 4 FOR 2)::int) -
                            (SUBSTRING(b2.time FROM 1 FOR 2)::int * 60 + SUBSTRING(b2.time FROM 4 FOR 2)::int)
                          ) < COALESCE(b1.duration, 120)
                        LIMIT 5
                    `, [excToday]).catch(() => ({ rows: [] })),
                    // Bookings without assigned animator
                    pool.query(`
                        SELECT b.id, b.label, b.time, b.program_name, b.room
                        FROM bookings b
                        WHERE b.date = $1 AND b.status != 'cancelled'
                          AND (b.line_id IS NULL OR b.line_id = 0)
                        ORDER BY b.time LIMIT 5
                    `, [excToday]).catch(() => ({ rows: [] })),
                    // Overdue preparation tasks (event category, not done)
                    pool.query(`
                        SELECT id, title, deadline FROM tasks
                        WHERE category = 'event' AND status NOT IN ('done','cancelled')
                          AND deadline < NOW()
                        ORDER BY deadline ASC LIMIT 5
                    `).catch(() => ({ rows: [] })),
                    // Recent NPS detractors (rating 1-2, last 7 days, no follow-up)
                    pool.query(`
                        SELECT er.id, er.booking_id, er.rating, er.comment, er.customer_name, er.created_at
                        FROM event_reviews er
                        WHERE er.rating <= 2 AND er.created_at > NOW() - INTERVAL '7 days'
                          AND (er.follow_up_status IS NULL OR er.follow_up_status = 'none')
                        ORDER BY er.created_at DESC LIMIT 5
                    `).catch(() => ({ rows: [] })),
                    // Cleaning SLA breaches
                    pool.query(`
                        SELECT id, room, scheduled_at, sla_minutes FROM cleaning_tasks
                        WHERE status = 'pending'
                          AND scheduled_at < NOW() - (sla_minutes || ' minutes')::interval
                        ORDER BY scheduled_at ASC LIMIT 5
                    `).catch(() => ({ rows: [] })),
                    // Unconfirmed bookings close to start (< 2 hours)
                    pool.query(`
                        SELECT id, label, time, room FROM bookings
                        WHERE date = $1 AND status = 'preliminary'
                          AND (SUBSTRING(time FROM 1 FOR 2)::int * 60 + SUBSTRING(time FROM 4 FOR 2)::int)
                              - EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Europe/Kyiv')::int * 60
                              - EXTRACT(MINUTE FROM NOW() AT TIME ZONE 'Europe/Kyiv')::int
                              BETWEEN 0 AND 120
                        ORDER BY time LIMIT 5
                    `, [excToday]).catch(() => ({ rows: [] }))
                ]);

                const exceptions = [];

                conflictsQ.rows.forEach(c => {
                    exceptions.push({
                        id: `conflict_${c.booking1}_${c.booking2}`, type: 'conflict', level: 'critical', icon: '💥',
                        title: `Конфлікт кімнати ${c.room}: ${(c.time1 || '').slice(0,5)} vs ${(c.time2 || '').slice(0,5)}`,
                        link: '/', action: { label: 'Вирішити', prompt: `Конфлікт: бронювання ${c.booking1} і ${c.booking2} в кімнаті ${c.room}` }
                    });
                });
                noAnimatorQ.rows.forEach(b => {
                    exceptions.push({
                        id: `no_animator_${b.id}`, type: 'no_animator', level: 'warning', icon: '🎭',
                        title: `Без аніматора: ${(b.time || '').slice(0,5)} ${b.label || b.program_name}`,
                        link: '/', action: { label: 'Призначити', prompt: `Бронювання ${b.id} без аніматора` }
                    });
                });
                overduePrep.rows.forEach(t => {
                    exceptions.push({
                        id: `prep_overdue_${t.id}`, type: 'prep_overdue', level: 'warning', icon: '⏰',
                        title: `Прострочена підготовка: ${(t.title || '').slice(0,40)}`,
                        link: '/tasks', action: { label: 'Виконати', prompt: `Задача підготовки ${t.id} прострочена` }
                    });
                });
                detractors.rows.forEach(r => {
                    exceptions.push({
                        id: `detractor_${r.id}`, type: 'detractor', level: 'warning', icon: '😞',
                        title: `Незадоволений: ${r.customer_name || 'Клієнт'} (${r.rating}/5)`,
                        link: '/customers', action: { label: 'Зателефонувати', prompt: `Клієнт ${r.customer_name} поставив ${r.rating}/5. Коментар: ${r.comment}` }
                    });
                });
                cleaningSLA.rows.forEach(c => {
                    exceptions.push({
                        id: `cleaning_sla_${c.id}`, type: 'cleaning_sla', level: 'info', icon: '🧹',
                        title: `Прибирання просрочено: ${c.room}`,
                        link: '/tasks', action: { label: 'Перевірити', prompt: `Прибирання кімнати ${c.room} перевищило SLA ${c.sla_minutes} хв` }
                    });
                });
                unconfirmedLate.rows.forEach(b => {
                    exceptions.push({
                        id: `late_unconfirmed_${b.id}`, type: 'late_unconfirmed', level: 'critical', icon: '🔴',
                        title: `Не підтверджено за <2год: ${(b.time || '').slice(0,5)} ${b.label || ''}`,
                        link: '/', action: { label: 'Підтвердити', prompt: `Бронювання ${b.id} не підтверджене, початок менш ніж за 2 години!` }
                    });
                });

                data = {
                    exceptions,
                    count: exceptions.length,
                    categories: {
                        conflicts: conflictsQ.rows.length,
                        noAnimator: noAnimatorQ.rows.length,
                        overduePrep: overduePrep.rows.length,
                        detractors: detractors.rows.length,
                        cleaningSLA: cleaningSLA.rows.length,
                        unconfirmedLate: unconfirmedLate.rows.length
                    }
                };
                break;
            }

            case 'catalogs': {
                const [catDefs, catItems] = await Promise.all([
                    pool.query("SELECT cd.id, cd.name, cd.emoji, COUNT(ci.id)::int AS count FROM catalog_definitions cd LEFT JOIN catalog_items ci ON ci.catalog_id = cd.id AND ci.status = 'active' WHERE cd.is_active = true GROUP BY cd.id, cd.name, cd.emoji, cd.sort_order ORDER BY cd.sort_order").catch(() => ({ rows: [] })),
                    pool.query("SELECT ci.id, ci.name, ci.price, ci.image_url, ci.catalog_id, cd.name AS catalog_name, cd.emoji AS catalog_emoji FROM catalog_items ci JOIN catalog_definitions cd ON cd.id = ci.catalog_id WHERE ci.status = 'active' ORDER BY ci.created_at DESC LIMIT 5").catch(() => ({ rows: [] })),
                ]);
                data = { definitions: catDefs.rows, recentItems: catItems.rows };
                break;
            }

            case 'account_stats': {
                const stats = await pool.query(`
                    SELECT
                        COUNT(*) FILTER (WHERE s.is_active AND NOT COALESCE(s.is_freelance, false)) as total_staff,
                        COUNT(*) FILTER (WHERE s.is_active AND NOT COALESCE(s.is_freelance, false) AND ep.user_id IS NOT NULL) as with_account,
                        COUNT(*) FILTER (WHERE s.is_active AND NOT COALESCE(s.is_freelance, false) AND ep.user_id IS NULL) as without_account,
                        COUNT(*) FILTER (WHERE s.is_active AND COALESCE(s.is_freelance, false)) as freelance_slots
                    FROM staff s
                    LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
                `).catch(() => ({ rows: [{ total_staff: 0, with_account: 0, without_account: 0, freelance_slots: 0 }] }));
                data = stats.rows[0];
                break;
            }

            // v39.10: Staff on shift today
            case 'staff_today': {
                const today = getKyivDateStr();
                const result = await pool.query(`
                    SELECT s.id, s.name, s.department, s.position, s.color,
                           ss.shift_start, ss.shift_end, ss.status,
                           CASE WHEN u.last_seen_at > NOW() - INTERVAL '5 minutes' THEN true ELSE false END AS is_online
                    FROM staff_schedule ss
                    JOIN staff s ON s.id = ss.staff_id
                    LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
                    LEFT JOIN users u ON u.id = ep.user_id
                    WHERE ss.date = $1 AND s.is_active = true AND ss.status = 'working'
                    ORDER BY ss.shift_start, s.department, s.name
                `, [today]);
                const absent = await pool.query(`
                    SELECT s.name, ss.status FROM staff_schedule ss
                    JOIN staff s ON s.id = ss.staff_id
                    WHERE ss.date = $1 AND s.is_active = true AND ss.status IN ('sick', 'vacation')
                    ORDER BY s.name
                `, [today]);
                data = { onShift: result.rows, absent: absent.rows, date: today };
                break;
            }

            // v39.10: Bookings this week (7 days)
            case 'week_bookings': {
                const today = getKyivDateStr();
                const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 6);
                const to = weekEnd.toISOString().split('T')[0];
                const result = await pool.query(`
                    SELECT date, COUNT(*)::int AS count,
                           COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
                           COUNT(*) FILTER (WHERE status = 'preliminary')::int AS pending,
                           COALESCE(SUM(CASE WHEN status = 'confirmed' THEN price ELSE 0 END), 0)::int AS revenue
                    FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date AND linked_to IS NULL AND status != 'cancelled'
                    GROUP BY date ORDER BY date
                `, [today, to]);
                data = { days: result.rows, from: today, to };
                break;
            }

            // v39.10: Team tasks (for managers — all team's tasks)
            case 'team_tasks': {
                const today = getKyivDateStr();
                const result = await pool.query(`
                    SELECT id, title, assigned_to, status, priority, deadline,
                           CASE WHEN deadline < NOW() THEN true ELSE false END AS is_overdue
                    FROM tasks
                    WHERE status NOT IN ('done', 'cancelled')
                    ORDER BY
                        CASE WHEN deadline < NOW() THEN 0 ELSE 1 END,
                        CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                        deadline ASC NULLS LAST
                    LIMIT 15
                `);
                const stats = await pool.query(`
                    SELECT
                        COUNT(*) FILTER (WHERE status = 'todo')::int AS todo,
                        COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
                        COUNT(*) FILTER (WHERE deadline < NOW() AND status NOT IN ('done','cancelled'))::int AS overdue
                    FROM tasks
                `);
                data = { tasks: result.rows, stats: stats.rows[0] };
                break;
            }

            // v39.10: HR widget — absences, leaves, birthdays, contracts
            case 'hr_overview': {
                const today = getKyivDateStr();
                const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
                const weekStr = weekEnd.toISOString().split('T')[0];
                const [absences, pendingLeaves, birthdays, expiring] = await Promise.all([
                    pool.query(`SELECT s.name, ss.status FROM staff_schedule ss JOIN staff s ON s.id = ss.staff_id
                        WHERE ss.date = $1 AND ss.status IN ('sick','vacation') AND s.is_active = true ORDER BY s.name`, [today]),
                    pool.query(`SELECT lr.id, s.name, lr.type, lr.date_from, lr.date_to FROM hr_leave_requests lr
                        JOIN staff s ON s.id = lr.staff_id WHERE lr.status = 'pending' ORDER BY lr.created_at DESC LIMIT 5`).catch(() => ({ rows: [] })),
                    pool.query(`SELECT name, birth_date FROM staff WHERE is_active = true AND birth_date IS NOT NULL
                        AND EXTRACT(MONTH FROM birth_date::date) = EXTRACT(MONTH FROM $1::date)
                        AND EXTRACT(DAY FROM birth_date::date) BETWEEN EXTRACT(DAY FROM $1::date) AND EXTRACT(DAY FROM $2::date)
                        ORDER BY EXTRACT(DAY FROM birth_date::date)`, [today, weekStr]).catch(() => ({ rows: [] })),
                    pool.query(`SELECT name, contract_type FROM staff WHERE is_active = true
                        AND hire_date IS NOT NULL AND hire_date::date < NOW() - INTERVAL '11 months'
                        ORDER BY hire_date LIMIT 5`).catch(() => ({ rows: [] }))
                ]);
                data = {
                    absent: absences.rows,
                    pendingLeaves: pendingLeaves.rows,
                    birthdays: birthdays.rows,
                    contractsExpiring: expiring.rows
                };
                break;
            }

            // v39.10: Director P&L widget
            case 'director_pnl': {
                const today = getKyivDateStr();
                const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
                const ws = weekStart.toISOString().split('T')[0];
                const monthStart = today.slice(0, 7) + '-01';
                const [weekRev, monthRev, weekExp, monthExp, staffCost] = await Promise.all([
                    pool.query(`SELECT COALESCE(SUM(price),0)::int AS rev FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date AND status = 'confirmed' AND linked_to IS NULL`, [ws, today]),
                    pool.query(`SELECT COALESCE(SUM(price),0)::int AS rev FROM bookings WHERE date::date >= $1::date AND date::date <= $2::date AND status = 'confirmed' AND linked_to IS NULL`, [monthStart, today]),
                    pool.query(`SELECT COALESCE(SUM(amount),0)::int AS exp FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date AND type = 'expense'`, [ws, today]),
                    pool.query(`SELECT COALESCE(SUM(amount),0)::int AS exp FROM finance_transactions WHERE date::date >= $1::date AND date::date <= $2::date AND type = 'expense'`, [monthStart, today]),
                    pool.query(`SELECT COUNT(*)::int AS staff, COALESCE(SUM(hourly_rate),0)::int AS daily_cost FROM staff WHERE is_active = true AND (is_freelance = false OR is_freelance IS NULL)`).catch(() => ({ rows: [{ staff: 0, daily_cost: 0 }] }))
                ]);
                data = {
                    week: { revenue: weekRev.rows[0].rev, expenses: weekExp.rows[0].exp, profit: weekRev.rows[0].rev - weekExp.rows[0].exp },
                    month: { revenue: monthRev.rows[0].rev, expenses: monthExp.rows[0].exp, profit: monthRev.rows[0].rev - monthExp.rows[0].exp },
                    staffCount: staffCost.rows[0].staff,
                    dailyStaffCost: staffCost.rows[0].daily_cost
                };
                break;
            }

            // v39.10: Art director content pipeline
            case 'content_pipeline': {
                const [inReview, approved, tasks, catalogs] = await Promise.all([
                    pool.query(`SELECT id, title, status FROM art_director_content WHERE status = 'in_review' ORDER BY created_at DESC LIMIT 5`).catch(() => ({ rows: [] })),
                    pool.query(`SELECT COUNT(*)::int AS c FROM art_director_content WHERE status = 'approved' AND created_at > NOW() - INTERVAL '7 days'`).catch(() => ({ rows: [{ c: 0 }] })),
                    pool.query(`SELECT id, title, priority FROM tasks WHERE category = 'improvement' AND status NOT IN ('done','cancelled') ORDER BY priority DESC, deadline ASC LIMIT 5`).catch(() => ({ rows: [] })),
                    pool.query(`SELECT id, name, emoji, status FROM catalog_definitions WHERE is_active = true ORDER BY name`).catch(() => ({ rows: [] }))
                ]);
                data = {
                    inReview: inReview.rows,
                    approvedThisWeek: approved.rows[0].c,
                    designTasks: tasks.rows,
                    catalogs: catalogs.rows
                };
                break;
            }

            // v40.5: Task health widget
            case 'task_health': {
                const stats = await pool.query(`
                    SELECT
                        COUNT(*) FILTER (WHERE health_score > 70 AND status NOT IN ('done','cancelled','archived'))::int AS healthy,
                        COUNT(*) FILTER (WHERE health_score BETWEEN 41 AND 70 AND status NOT IN ('done','cancelled','archived'))::int AS warning,
                        COUNT(*) FILTER (WHERE health_score BETWEEN 1 AND 40 AND status NOT IN ('done','cancelled','archived'))::int AS critical,
                        COUNT(*) FILTER (WHERE status = 'archived')::int AS archived,
                        COALESCE(AVG(health_score) FILTER (WHERE status NOT IN ('done','cancelled','archived')), 0)::int AS avg_score
                    FROM tasks
                `).catch(() => ({ rows: [{ healthy: 0, warning: 0, critical: 0, archived: 0, avg_score: 0 }] }));
                data = stats.rows[0];
                break;
            }

            // v39.10: Vice director operations overview
            case 'operations': {
                const today = getKyivDateStr();
                const [procurement, complaints, quality, staffGaps] = await Promise.all([
                    pool.query(`SELECT id, name, status FROM procurement_lists WHERE status IN ('draft','ordered') ORDER BY created_at DESC LIMIT 5`).catch(() => ({ rows: [] })),
                    pool.query(`SELECT COUNT(*)::int AS c FROM leads WHERE status = 'new' AND source = 'complaint' AND created_at > NOW() - INTERVAL '7 days'`).catch(() => ({ rows: [{ c: 0 }] })),
                    pool.query(`SELECT COALESCE(AVG(rating),0)::numeric(3,1) AS avg_rating, COUNT(*)::int AS count FROM event_reviews WHERE created_at > NOW() - INTERVAL '30 days'`).catch(() => ({ rows: [{ avg_rating: 0, count: 0 }] })),
                    pool.query(`SELECT COUNT(*)::int AS gaps FROM staff_schedule ss
                        JOIN staff s ON s.id = ss.staff_id
                        JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
                        JOIN users u ON u.id = ep.user_id
                        WHERE ss.date = $1 AND ss.status = 'working' AND s.is_active = true
                        AND (u.last_seen_at IS NULL OR u.last_seen_at < NOW() - INTERVAL '30 minutes')`, [today]).catch(() => ({ rows: [{ gaps: 0 }] }))
                ]);
                data = {
                    procurement: procurement.rows,
                    complaintsWeek: complaints.rows[0].c,
                    quality: quality.rows[0],
                    staffNotCheckedIn: staffGaps.rows[0].gaps
                };
                break;
            }

            default:
                return res.status(400).json({ error: 'Unknown widget type' });
        }

        res.json({ success: true, data });
    } catch (err) {
        log.error(`Widget data error (${req.params.type})`, err);
        res.status(500).json({ error: 'Failed to load widget data' });
    }
});

// GET /api/dashboard/roles — role definitions for test panel
router.get('/roles', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT role_key, name_uk, department, level FROM role_definitions WHERE is_active = true ORDER BY level DESC'
        );
        res.json({ success: true, roles: result.rows });
    } catch (err) {
        log.error('Failed to get roles', err);
        res.status(500).json({ error: 'Failed to load roles' });
    }
});

// GET /api/dashboard/today — aggregate "today" data for quick overview
router.get('/today', async (req, res) => {
    try {
        const today = getKyivDateStr();

        const [bookings, tasks, revenue, teamOnline, newLeads] = await Promise.all([
            pool.query("SELECT COUNT(*) as count FROM bookings WHERE date = $1 AND status != 'cancelled'", [today]),
            pool.query("SELECT COUNT(*) as count FROM tasks WHERE (assigned_to = $1 OR created_by = $1) AND status NOT IN ('done', 'cancelled')", [req.user.name]),
            pool.query("SELECT COALESCE(SUM(price), 0) as total FROM bookings WHERE date = $1 AND status = 'confirmed'", [today]),
            pool.query("SELECT COUNT(*) as count FROM users u LEFT JOIN employee_profiles ep ON ep.user_id = u.id WHERE u.is_active = true AND ep.last_activity_at > NOW() - INTERVAL '5 minutes'"),
            pool.query("SELECT COUNT(*) as count FROM leads WHERE status = 'new'").catch(() => ({ rows: [{ count: 0 }] })),
        ]);

        res.json({
            success: true,
            data: {
                date: today,
                bookingsToday: parseInt(bookings.rows[0].count),
                myActiveTasks: parseInt(tasks.rows[0].count),
                revenueToday: parseFloat(revenue.rows[0].total),
                teamOnline: parseInt(teamOnline.rows[0].count),
                newLeads: parseInt(newLeads.rows[0].count),
            }
        });
    } catch (err) {
        log.error('Dashboard /today error', err);
        res.status(500).json({ error: 'Failed to load today data' });
    }
});

// --- Cache helpers ---
async function getCachedData(key, ttlSeconds, fetchFn) {
    try {
        const cached = await pool.query(
            'SELECT data FROM dashboard_cache WHERE cache_key = $1 AND expires_at > NOW()',
            [key]
        );
        if (cached.rows.length > 0) {
            return cached.rows[0].data;
        }

        const freshData = await fetchFn();
        await pool.query(`
            INSERT INTO dashboard_cache (cache_key, data, expires_at)
            VALUES ($1, $2, NOW() + make_interval(secs => $3))
            ON CONFLICT (cache_key)
            DO UPDATE SET data = $2, expires_at = NOW() + make_interval(secs => $3)
        `, [key, JSON.stringify(freshData), ttlSeconds]);

        return freshData;
    } catch (err) {
        log.error(`Cache error for ${key}`, err);
        return {};
    }
}

async function fetchWeather() {
    try {
        // Kyiv weather via Open-Meteo (free, no API key)
        const resp = await fetch('https://api.open-meteo.com/v1/forecast?latitude=50.45&longitude=30.52&current=temperature_2m,weathercode,windspeed_10m&timezone=Europe/Kyiv');
        if (!resp.ok) return { error: 'Weather API unavailable' };
        const data = await resp.json();
        return {
            temperature: data.current.temperature_2m,
            weatherCode: data.current.weathercode,
            windSpeed: data.current.windspeed_10m,
            city: 'Київ'
        };
    } catch {
        return { error: 'Weather fetch failed' };
    }
}

async function fetchCurrency() {
    try {
        // NBU currency rates
        const resp = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json');
        if (!resp.ok) return { error: 'Currency API unavailable' };
        const data = await resp.json();
        const usd = data.find(c => c.cc === 'USD');
        const eur = data.find(c => c.cc === 'EUR');
        return {
            usd: usd ? usd.rate : null,
            eur: eur ? eur.rate : null,
            date: usd ? usd.exchangedate : null
        };
    } catch {
        return { error: 'Currency fetch failed' };
    }
}

// GET /api/dashboard/alerts — standalone endpoint for alert bell
router.get('/alerts', async (req, res) => {
    try {
        const today = getKyivDateStr();
        const [overdue, unconfirmed, lowStock, coldLeads, shiftCheck] = await Promise.all([
            pool.query(`SELECT id, title, deadline FROM tasks WHERE deadline < NOW() AND status NOT IN ('done','cancelled') ORDER BY deadline ASC LIMIT 5`),
            pool.query(`SELECT id, label, time FROM bookings WHERE date = $1 AND status = 'preliminary' ORDER BY time LIMIT 5`, [today]),
            pool.query(`SELECT name, quantity, min_quantity, unit FROM warehouse_stock WHERE quantity <= min_quantity AND is_active = true LIMIT 3`),
            pool.query(`SELECT COUNT(*) as c FROM leads WHERE status='new' AND created_at < NOW() - INTERVAL '48 hours'`),
            pool.query(`SELECT (SELECT COUNT(*) FROM cash_register_shifts WHERE status='open') AS open_shifts,
                               (SELECT COUNT(*) FROM bookings WHERE date=$1 AND status='confirmed') AS today_bk`, [today])
        ]);
        const alerts = [];
        overdue.rows.forEach(t => {
            alerts.push({ id: `overdue_${t.id}`, level: 'warning', icon: '⚠️',
                title: `Прострочена: "${(t.title || '').slice(0, 40)}"`,
                link: `/tasks?open=${t.id}`, taskId: t.id,
                action: { label: '📋 Відкрити задачу', prompt: `Задача прострочена: "${t.title}". Що робимо?` }
            });
        });
        unconfirmed.rows.forEach(b => {
            alerts.push({ id: `unconfirmed_${b.id}`, level: 'info', icon: '📋',
                title: `Непідтверджене: ${(b.time || '').slice(0, 5)} ${b.label || ''}`,
                link: `/?date=${today}&highlight=${b.id}`, bookingId: b.id,
                action: { label: '✅ Підтвердити', prompt: `Бронювання ${b.id} очікує підтвердження.` }
            });
        });
        lowStock.rows.forEach((s, i) => {
            alerts.push({ id: `stock_${s.name}_${s.quantity}`, level: 'warning', icon: '📦',
                title: `Мало: ${s.name} (${s.quantity} ${s.unit})`,
                link: '/warehouse#procurement', stockItem: s.name,
                action: { label: '📋 Замовити', prompt: `Замовити ${s.name} (залишок: ${s.quantity}/${s.min_quantity} ${s.unit})`, assignRole: 'manager' }
            });
        });
        const cl = parseInt(coldLeads.rows[0].c);
        if (cl > 0) {
            alerts.push({ id: 'cold_leads', level: 'warning', icon: '🥶',
                title: `${cl} лідів без відповіді >48год`, link: '/sales-funnel',
                action: { label: '📋 Обдзвін', prompt: `${cl} лідів без відповіді >48год. Обдзвонити.`, assignRole: 'manager' }
            });
        }
        const os = parseInt(shiftCheck.rows[0].open_shifts);
        const tb = parseInt(shiftCheck.rows[0].today_bk);
        if (os === 0 && tb > 0) {
            alerts.push({ id: 'no_shift', level: 'critical', icon: '🔴',
                title: `Каса не відкрита! (${tb} броні)`, link: '/finance',
                action: { label: '💰 Відкрити касу', prompt: 'Каса не відкрита — відкрити.', assignRole: 'admin' }
            });
        }
        res.json({ success: true, alerts, count: alerts.length });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// v39.7.0 — WebSocket alert push: broadcast alerts to all connected users periodically
let _alertBroadcastTimer = null;
let _lastAlertHash = '';

async function broadcastAlerts() {
    try {
        const { broadcast } = require('../services/websocket');
        const today = getKyivDateStr();
        const [overdue, unconfirmed, lowStock, coldLeads, shiftCheck] = await Promise.all([
            pool.query(`SELECT id, title, deadline FROM tasks WHERE deadline < NOW() AND status NOT IN ('done','cancelled') ORDER BY deadline ASC LIMIT 5`),
            pool.query(`SELECT id, label, time FROM bookings WHERE date = $1 AND status = 'preliminary' ORDER BY time LIMIT 5`, [today]),
            pool.query(`SELECT name, quantity, min_quantity, unit FROM warehouse_stock WHERE quantity <= min_quantity AND is_active = true LIMIT 3`),
            pool.query(`SELECT COUNT(*) as c FROM leads WHERE status='new' AND created_at < NOW() - INTERVAL '48 hours'`),
            pool.query(`SELECT (SELECT COUNT(*) FROM cash_register_shifts WHERE status='open') AS open_shifts,
                               (SELECT COUNT(*) FROM bookings WHERE date=$1 AND status='confirmed') AS today_bk`, [today])
        ]);
        const alerts = [];
        overdue.rows.forEach(t => {
            alerts.push({ id: `overdue_${t.id}`, level: 'warning', icon: '⚠️',
                title: `Прострочена: "${(t.title || '').slice(0, 40)}"`,
                link: `/tasks?open=${t.id}`, taskId: t.id,
                action: { label: '📋 Відкрити задачу', prompt: `Задача прострочена: "${t.title}". Що робимо?` }
            });
        });
        unconfirmed.rows.forEach(b => {
            alerts.push({ id: `unconfirmed_${b.id}`, level: 'info', icon: '📋',
                title: `Непідтверджене: ${(b.time || '').slice(0, 5)} ${b.label || ''}`,
                link: `/?date=${today}&highlight=${b.id}`, bookingId: b.id,
                action: { label: '✅ Підтвердити', prompt: `Бронювання ${b.id} очікує підтвердження.` }
            });
        });
        lowStock.rows.forEach(s => {
            alerts.push({ id: `stock_${s.name}_${s.quantity}`, level: 'warning', icon: '📦',
                title: `Мало: ${s.name} (${s.quantity} ${s.unit})`,
                link: '/warehouse#procurement', stockItem: s.name,
                action: { label: '📋 Замовити', prompt: `Замовити ${s.name} (залишок: ${s.quantity}/${s.min_quantity} ${s.unit})`, assignRole: 'manager' }
            });
        });
        const cl = parseInt(coldLeads.rows[0].c);
        if (cl > 0) {
            alerts.push({ id: 'cold_leads', level: 'warning', icon: '🥶',
                title: `${cl} лідів без відповіді >48год`, link: '/sales-funnel',
                action: { label: '📋 Обдзвін', prompt: `${cl} лідів без відповіді >48год. Обдзвонити.`, assignRole: 'manager' }
            });
        }
        const os = parseInt(shiftCheck.rows[0].open_shifts);
        const tb = parseInt(shiftCheck.rows[0].today_bk);
        if (os === 0 && tb > 0) {
            alerts.push({ id: 'no_shift', level: 'critical', icon: '🔴',
                title: `Каса не відкрита! (${tb} броні)`, link: '/finance',
                action: { label: '💰 Відкрити касу', prompt: 'Каса не відкрита — відкрити.', assignRole: 'admin' }
            });
        }

        // Only broadcast if alerts changed
        const hash = JSON.stringify(alerts.map(a => a.id).sort());
        if (hash !== _lastAlertHash) {
            _lastAlertHash = hash;
            broadcast('alert:updated', { alerts, count: alerts.length });
        }
    } catch (err) {
        // Silent — don't crash on periodic check
    }
}

function startAlertBroadcaster(intervalMs = 60000) {
    if (_alertBroadcastTimer) clearInterval(_alertBroadcastTimer);
    _alertBroadcastTimer = setInterval(broadcastAlerts, intervalMs);
    // Initial broadcast after 5s delay
    setTimeout(broadcastAlerts, 5000);
}

function triggerAlertBroadcast() {
    // Debounce: wait 2s to batch rapid changes
    if (triggerAlertBroadcast._timer) clearTimeout(triggerAlertBroadcast._timer);
    triggerAlertBroadcast._timer = setTimeout(broadcastAlerts, 2000);
}

module.exports = router;
module.exports.startAlertBroadcaster = startAlertBroadcaster;
module.exports.triggerAlertBroadcast = triggerAlertBroadcast;
