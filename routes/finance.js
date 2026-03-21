/**
 * routes/finance.js — Finance module API (v16.0)
 *
 * CRUD for transactions & categories, P&L summary, reports, CSV export.
 * All amounts in UAH (integer).
 */

const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const { requireRole } = require('../middleware/auth');
const { publish } = require('../services/eventBus');
const log = createLogger('Finance');

// RBAC: Finance access — creator, director, accountant only
router.use(requireRole('creator', 'director', 'accountant'));

// ==========================================
// HELPERS
// ==========================================

function isValidDate(str) {
    return /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function getMonthRange(year, month) {
    const lastDay = new Date(year, month, 0).getDate();
    return {
        from: `${year}-${String(month).padStart(2, '0')}-01`,
        to: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    };
}

// ==========================================
// CATEGORIES
// ==========================================

// GET /api/finance/categories
router.get('/categories', async (req, res) => {
    try {
        const { type } = req.query;
        let sql = 'SELECT * FROM finance_categories WHERE is_active = true';
        const params = [];
        if (type && ['income', 'expense'].includes(type)) {
            params.push(type);
            sql += ` AND type = $${params.length}`;
        }
        sql += ' ORDER BY type, sort_order';
        const result = await pool.query(sql, params);
        res.json(result.rows.map(r => ({
            id: r.id,
            name: r.name,
            type: r.type,
            icon: r.icon,
            color: r.color,
            isSystem: r.is_system,
            sortOrder: r.sort_order
        })));
    } catch (err) {
        log.error('GET /categories error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/finance/categories
router.post('/categories', async (req, res) => {
    try {
        const { name, type, icon, color, sortOrder } = req.body;
        if (!name || !type || !['income', 'expense'].includes(type)) {
            return res.status(400).json({ error: 'name and type (income|expense) required' });
        }
        const result = await pool.query(
            `INSERT INTO finance_categories (name, type, icon, color, sort_order)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [name.trim(), type, icon || null, color || null, sortOrder || 0]
        );
        const r = result.rows[0];
        res.status(201).json({ id: r.id, name: r.name, type: r.type, icon: r.icon, color: r.color, isSystem: r.is_system, sortOrder: r.sort_order });
    } catch (err) {
        log.error('POST /categories error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/finance/categories/:id
router.put('/categories/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, icon, color, sortOrder } = req.body;
        // Cannot edit system categories' type
        const existing = await pool.query('SELECT * FROM finance_categories WHERE id = $1', [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Category not found' });

        await pool.query(
            `UPDATE finance_categories SET name = COALESCE($1, name), icon = COALESCE($2, icon),
             color = COALESCE($3, color), sort_order = COALESCE($4, sort_order) WHERE id = $5`,
            [name, icon, color, sortOrder, id]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('PUT /categories/:id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/finance/categories/:id
router.delete('/categories/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await pool.query('SELECT * FROM finance_categories WHERE id = $1', [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
        if (existing.rows[0].is_system) return res.status(400).json({ error: 'Cannot delete system category' });

        // Soft delete
        await pool.query('UPDATE finance_categories SET is_active = false WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /categories/:id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// TRANSACTIONS — CRUD
// ==========================================

// GET /api/finance/transactions
router.get('/transactions', async (req, res) => {
    try {
        const { type, categoryId, from, to, paymentMethod, search, page, limit: lim, sortBy } = req.query;
        const limit = Math.min(parseInt(lim) || 50, 200);
        const offset = ((parseInt(page) || 1) - 1) * limit;

        let where = 'WHERE 1=1';
        const params = [];

        if (type && ['income', 'expense'].includes(type)) {
            params.push(type);
            where += ` AND ft.type = $${params.length}`;
        }
        if (categoryId) {
            params.push(parseInt(categoryId));
            where += ` AND ft.category_id = $${params.length}`;
        }
        if (from && isValidDate(from)) {
            params.push(from);
            where += ` AND ft.date >= $${params.length}`;
        }
        if (to && isValidDate(to)) {
            params.push(to);
            where += ` AND ft.date <= $${params.length}`;
        }
        if (paymentMethod) {
            params.push(paymentMethod);
            where += ` AND ft.payment_method = $${params.length}`;
        }
        if (search) {
            params.push(`%${search}%`);
            where += ` AND ft.description ILIKE $${params.length}`;
        }

        const allowedSorts = {
            'date': 'ft.date DESC, ft.id DESC',
            'amount': 'ft.amount DESC',
            'amount_asc': 'ft.amount ASC',
            'created_at': 'ft.created_at DESC'
        };
        const orderBy = allowedSorts[sortBy] || allowedSorts['date'];

        // Count
        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS total FROM finance_transactions ft ${where}`, params
        );
        const total = countResult.rows[0].total;

        // Data
        const dataParams = [...params, limit, offset];
        const result = await pool.query(
            `SELECT ft.*, fc.name AS category_name, fc.icon AS category_icon, fc.color AS category_color
             FROM finance_transactions ft
             LEFT JOIN finance_categories fc ON ft.category_id = fc.id
             ${where}
             ORDER BY ${orderBy}
             LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
            dataParams
        );

        res.json({
            transactions: result.rows.map(r => ({
                id: r.id,
                type: r.type,
                categoryId: r.category_id,
                categoryName: r.category_name,
                categoryIcon: r.category_icon,
                categoryColor: r.category_color,
                amount: r.amount,
                description: r.description,
                date: r.date,
                paymentMethod: r.payment_method,
                bookingId: r.booking_id,
                staffId: r.staff_id,
                certificateId: r.certificate_id,
                createdBy: r.created_by,
                createdAt: r.created_at
            })),
            total,
            page: parseInt(page) || 1,
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        log.error('GET /transactions error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/finance/transactions
router.post('/transactions', async (req, res) => {
    try {
        const { type, categoryId, amount, description, date, paymentMethod, bookingId, staffId, certificateId } = req.body;
        if (!type || !['income', 'expense'].includes(type)) {
            return res.status(400).json({ error: 'type (income|expense) required' });
        }
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'amount must be positive integer' });
        }
        if (!date || !isValidDate(date)) {
            return res.status(400).json({ error: 'valid date (YYYY-MM-DD) required' });
        }

        const result = await pool.query(
            `INSERT INTO finance_transactions (type, category_id, amount, description, date, payment_method, booking_id, staff_id, certificate_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [type, categoryId || null, parseInt(amount), description || null, date,
             paymentMethod || null, bookingId || null, staffId || null, certificateId || null,
             req.user?.username]
        );

        const r = result.rows[0];

        // Publish income event for chat notifications
        if (r.type === 'income') {
            publish('finance.income', {
                amount: r.amount,
                description: r.description || '',
                category: ''
            }).catch(e => log.warn('eventBus publish income:', e.message));
        }

        res.status(201).json({
            id: r.id, type: r.type, categoryId: r.category_id, amount: r.amount,
            description: r.description, date: r.date, paymentMethod: r.payment_method,
            createdBy: r.created_by, createdAt: r.created_at
        });
    } catch (err) {
        log.error('POST /transactions error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/finance/transactions/:id
router.put('/transactions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { type, categoryId, amount, description, date, paymentMethod } = req.body;

        const existing = await pool.query('SELECT * FROM finance_transactions WHERE id = $1', [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });

        await pool.query(
            `UPDATE finance_transactions SET
                type = COALESCE($1, type),
                category_id = COALESCE($2, category_id),
                amount = COALESCE($3, amount),
                description = COALESCE($4, description),
                date = COALESCE($5, date),
                payment_method = COALESCE($6, payment_method),
                updated_at = NOW()
             WHERE id = $7`,
            [type, categoryId, amount ? parseInt(amount) : null, description, date, paymentMethod, id]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('PUT /transactions/:id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/finance/transactions/:id
router.delete('/transactions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await pool.query('SELECT * FROM finance_transactions WHERE id = $1', [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });

        await pool.query('DELETE FROM finance_transactions WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /transactions/:id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// DASHBOARD — overview for period
// ==========================================

router.get('/dashboard', async (req, res) => {
    try {
        let { from, to, period } = req.query;

        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            // Default: current month
            const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
            const range = getMonthRange(now.getFullYear(), now.getMonth() + 1);
            from = range.from;
            to = range.to;
        }

        // Totals
        const totalsResult = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::int AS total_income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::int AS total_expense,
                COUNT(*) FILTER (WHERE type = 'income')::int AS income_count,
                COUNT(*) FILTER (WHERE type = 'expense')::int AS expense_count
            FROM finance_transactions
            WHERE date >= $1 AND date <= $2
        `, [from, to]);

        const t = totalsResult.rows[0];
        const profit = t.total_income - t.total_expense;

        // Booking revenue (from bookings table, for cross-reference)
        const bookingRevenue = await pool.query(`
            SELECT COALESCE(SUM(price), 0)::int AS revenue, COUNT(*)::int AS count
            FROM bookings
            WHERE date >= $1 AND date <= $2
              AND linked_to IS NULL AND status = 'confirmed'
        `, [from, to]);

        // Income by category
        const incomeByCategory = await pool.query(`
            SELECT fc.name, fc.icon, fc.color,
                COALESCE(SUM(ft.amount), 0)::int AS total
            FROM finance_transactions ft
            JOIN finance_categories fc ON ft.category_id = fc.id
            WHERE ft.type = 'income' AND ft.date >= $1 AND ft.date <= $2
            GROUP BY fc.id, fc.name, fc.icon, fc.color
            ORDER BY total DESC
        `, [from, to]);

        // Expense by category
        const expenseByCategory = await pool.query(`
            SELECT fc.name, fc.icon, fc.color,
                COALESCE(SUM(ft.amount), 0)::int AS total
            FROM finance_transactions ft
            JOIN finance_categories fc ON ft.category_id = fc.id
            WHERE ft.type = 'expense' AND ft.date >= $1 AND ft.date <= $2
            GROUP BY fc.id, fc.name, fc.icon, fc.color
            ORDER BY total DESC
        `, [from, to]);

        // Daily breakdown
        const dailyResult = await pool.query(`
            SELECT date,
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::int AS income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::int AS expense
            FROM finance_transactions
            WHERE date >= $1 AND date <= $2
            GROUP BY date ORDER BY date
        `, [from, to]);

        // Payment methods breakdown
        const paymentMethods = await pool.query(`
            SELECT payment_method, type,
                COALESCE(SUM(amount), 0)::int AS total, COUNT(*)::int AS count
            FROM finance_transactions
            WHERE date >= $1 AND date <= $2 AND payment_method IS NOT NULL
            GROUP BY payment_method, type
            ORDER BY total DESC
        `, [from, to]);

        res.json({
            period: { from, to },
            totals: {
                income: t.total_income,
                expense: t.total_expense,
                profit,
                incomeCount: t.income_count,
                expenseCount: t.expense_count
            },
            bookingRevenue: {
                revenue: bookingRevenue.rows[0].revenue,
                count: bookingRevenue.rows[0].count
            },
            incomeByCategory: incomeByCategory.rows.map(r => ({
                name: r.name, icon: r.icon, color: r.color, total: r.total
            })),
            expenseByCategory: expenseByCategory.rows.map(r => ({
                name: r.name, icon: r.icon, color: r.color, total: r.total
            })),
            daily: dailyResult.rows.map(r => ({
                date: r.date, income: r.income, expense: r.expense
            })),
            paymentMethods: paymentMethods.rows.map(r => ({
                method: r.payment_method, type: r.type, total: r.total, count: r.count
            }))
        });
    } catch (err) {
        log.error('GET /dashboard error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// P&L REPORT — monthly comparison
// ==========================================

router.get('/report/monthly', async (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();

        const result = await pool.query(`
            SELECT
                EXTRACT(MONTH FROM date::date)::int AS month,
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::int AS income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::int AS expense
            FROM finance_transactions
            WHERE EXTRACT(YEAR FROM date::date) = $1
            GROUP BY month
            ORDER BY month
        `, [year]);

        // Fill all 12 months
        const months = [];
        const MONTH_NAMES = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
                             'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
        for (let m = 1; m <= 12; m++) {
            const row = result.rows.find(r => r.month === m);
            const income = row ? row.income : 0;
            const expense = row ? row.expense : 0;
            months.push({
                month: m,
                monthName: MONTH_NAMES[m - 1],
                income,
                expense,
                profit: income - expense
            });
        }

        const yearTotals = months.reduce((acc, m) => ({
            income: acc.income + m.income,
            expense: acc.expense + m.expense,
            profit: acc.profit + m.profit
        }), { income: 0, expense: 0, profit: 0 });

        res.json({ year, months, totals: yearTotals });
    } catch (err) {
        log.error('GET /report/monthly error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// SALARY REPORT — from HR time records
// ==========================================

router.get('/report/salary', async (req, res) => {
    try {
        const month = req.query.month; // YYYY-MM
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ error: 'month (YYYY-MM) required' });
        }
        const [year, mon] = month.split('-');
        const from = `${year}-${mon}-01`;
        const lastDay = new Date(parseInt(year), parseInt(mon), 0).getDate();
        const to = `${year}-${mon}-${String(lastDay).padStart(2, '0')}`;

        const result = await pool.query(`
            SELECT s.id, s.name, s.department, s.position,
                COALESCE(s.hourly_rate, 0)::numeric AS hourly_rate,
                COALESCE(SUM(tr.total_worked_minutes), 0)::int AS total_minutes,
                COALESCE(ROUND(SUM(tr.total_worked_minutes) / 60.0 * s.hourly_rate), 0)::int AS estimated_salary
            FROM staff s
            LEFT JOIN hr_time_records tr ON tr.staff_id = s.id
                AND tr.record_date >= $1 AND tr.record_date <= $2
            WHERE s.is_active = true
            GROUP BY s.id, s.name, s.department, s.position, s.hourly_rate
            HAVING COALESCE(SUM(tr.total_worked_minutes), 0) > 0
            ORDER BY estimated_salary DESC
        `, [from, to]);

        const totalSalary = result.rows.reduce((sum, r) => sum + r.estimated_salary, 0);

        res.json({
            month,
            staff: result.rows.map(r => ({
                id: r.id,
                name: r.name,
                department: r.department,
                position: r.position,
                hourlyRate: parseFloat(r.hourly_rate),
                totalHours: Math.round(r.total_minutes / 60 * 10) / 10,
                estimatedSalary: r.estimated_salary
            })),
            totalSalary
        });
    } catch (err) {
        log.error('GET /report/salary error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// BUDGET PLANNING (v17.0)
// ==========================================

// GET /api/finance/budget — get budget plan for a year
router.get('/budget', async (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();

        const result = await pool.query(`
            SELECT bp.*, fc.name AS category_name, fc.type AS category_type,
                   fc.icon AS category_icon, fc.color AS category_color
            FROM budget_plans bp
            JOIN finance_categories fc ON bp.category_id = fc.id
            WHERE bp.year = $1
            ORDER BY bp.month, fc.type, fc.sort_order
        `, [year]);

        res.json({
            year,
            plans: result.rows.map(r => ({
                id: r.id,
                year: r.year,
                month: r.month,
                categoryId: r.category_id,
                categoryName: r.category_name,
                categoryType: r.category_type,
                categoryIcon: r.category_icon,
                categoryColor: r.category_color,
                plannedAmount: r.planned_amount,
                notes: r.notes,
                createdBy: r.created_by
            }))
        });
    } catch (err) {
        log.error('GET /budget error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/finance/budget — create or update a budget entry (upsert)
router.put('/budget', async (req, res) => {
    try {
        const { year, month, categoryId, plannedAmount, notes } = req.body;

        if (!year || !month || !categoryId || plannedAmount === undefined) {
            return res.status(400).json({ error: 'year, month, categoryId, plannedAmount required' });
        }
        if (month < 1 || month > 12) {
            return res.status(400).json({ error: 'month must be 1-12' });
        }
        if (typeof plannedAmount !== 'number' || plannedAmount < 0) {
            return res.status(400).json({ error: 'plannedAmount must be a non-negative number' });
        }

        const result = await pool.query(`
            INSERT INTO budget_plans (year, month, category_id, planned_amount, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (year, month, category_id)
            DO UPDATE SET planned_amount = $4, notes = $5, updated_at = NOW()
            RETURNING *
        `, [year, month, categoryId, plannedAmount, notes || null, req.user.username]);

        res.json({ success: true, plan: result.rows[0] });
    } catch (err) {
        log.error('PUT /budget error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/finance/budget/:id — delete a budget entry
router.delete('/budget/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM budget_plans WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Budget plan not found' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /budget error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/finance/budget/comparison — plan vs fact
router.get('/budget/comparison', async (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = parseInt(req.query.month) || (new Date().getMonth() + 1);

        const range = getMonthRange(year, month);

        // Get budget plans for this month
        const plans = await pool.query(`
            SELECT bp.category_id, bp.planned_amount, fc.name, fc.type, fc.icon, fc.color
            FROM budget_plans bp
            JOIN finance_categories fc ON bp.category_id = fc.id
            WHERE bp.year = $1 AND bp.month = $2
            ORDER BY fc.type, fc.sort_order
        `, [year, month]);

        // Get actual spending per category for this month
        const actuals = await pool.query(`
            SELECT category_id,
                COALESCE(SUM(amount), 0)::int AS actual_amount,
                COUNT(*)::int AS transaction_count
            FROM finance_transactions
            WHERE date >= $1 AND date <= $2
            GROUP BY category_id
        `, [range.from, range.to]);

        const actualMap = {};
        for (const r of actuals.rows) {
            actualMap[r.category_id] = { actual: r.actual_amount, count: r.transaction_count };
        }

        const MONTH_NAMES = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
                             'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];

        const comparison = plans.rows.map(p => {
            const act = actualMap[p.category_id] || { actual: 0, count: 0 };
            const diff = act.actual - p.planned_amount;
            const pct = p.planned_amount > 0 ? Math.round((act.actual / p.planned_amount) * 100) : 0;
            return {
                categoryId: p.category_id,
                categoryName: p.name,
                categoryType: p.type,
                categoryIcon: p.icon,
                categoryColor: p.color,
                planned: p.planned_amount,
                actual: act.actual,
                diff,
                percentUsed: pct,
                transactionCount: act.count
            };
        });

        // Totals by type
        const incomePlanned = comparison.filter(c => c.categoryType === 'income').reduce((s, c) => s + c.planned, 0);
        const incomeActual = comparison.filter(c => c.categoryType === 'income').reduce((s, c) => s + c.actual, 0);
        const expensePlanned = comparison.filter(c => c.categoryType === 'expense').reduce((s, c) => s + c.planned, 0);
        const expenseActual = comparison.filter(c => c.categoryType === 'expense').reduce((s, c) => s + c.actual, 0);

        res.json({
            year,
            month,
            monthName: MONTH_NAMES[month - 1],
            comparison,
            totals: {
                incomePlanned, incomeActual,
                expensePlanned, expenseActual,
                profitPlanned: incomePlanned - expensePlanned,
                profitActual: incomeActual - expenseActual
            }
        });
    } catch (err) {
        log.error('GET /budget/comparison error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// EXCEL EXPORT (v17.0)
// ==========================================

router.get('/export-xlsx', async (req, res) => {
    try {
        let { from, to, type } = req.query;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            return res.status(400).json({ error: 'from and to dates required' });
        }

        let where = 'WHERE ft.date >= $1 AND ft.date <= $2';
        const params = [from, to];
        if (type && ['income', 'expense'].includes(type)) {
            params.push(type);
            where += ` AND ft.type = $${params.length}`;
        }

        const result = await pool.query(`
            SELECT ft.*, fc.name AS category_name
            FROM finance_transactions ft
            LEFT JOIN finance_categories fc ON ft.category_id = fc.id
            ${where}
            ORDER BY ft.date, ft.id
        `, params);

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Event Genix';
        const sheet = workbook.addWorksheet('Фінанси');

        sheet.columns = [
            { header: 'ID', key: 'id', width: 8 },
            { header: 'Тип', key: 'type', width: 12 },
            { header: 'Категорія', key: 'category', width: 20 },
            { header: 'Сума (₴)', key: 'amount', width: 14 },
            { header: 'Опис', key: 'description', width: 30 },
            { header: 'Дата', key: 'date', width: 14 },
            { header: 'Спосіб оплати', key: 'payment', width: 16 },
            { header: 'Створив', key: 'createdBy', width: 16 }
        ];

        // Style header row
        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };

        for (const r of result.rows) {
            sheet.addRow({
                id: r.id,
                type: r.type === 'income' ? 'Дохід' : 'Витрата',
                category: r.category_name || '',
                amount: r.amount,
                description: r.description || '',
                date: r.date,
                payment: r.payment_method || '',
                createdBy: r.created_by || ''
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="finance_${from}_${to}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        log.error('GET /export-xlsx error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// CSV EXPORT
// ==========================================

router.get('/export', async (req, res) => {
    try {
        let { from, to, type } = req.query;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            return res.status(400).json({ error: 'from and to dates required' });
        }

        let where = 'WHERE ft.date >= $1 AND ft.date <= $2';
        const params = [from, to];
        if (type && ['income', 'expense'].includes(type)) {
            params.push(type);
            where += ` AND ft.type = $${params.length}`;
        }

        const result = await pool.query(`
            SELECT ft.*, fc.name AS category_name
            FROM finance_transactions ft
            LEFT JOIN finance_categories fc ON ft.category_id = fc.id
            ${where}
            ORDER BY ft.date, ft.id
        `, params);

        // Build CSV (UTF-8 BOM + semicolon separator for Excel)
        const BOM = '\uFEFF';
        const header = 'ID;Тип;Категорія;Сума (₴);Опис;Дата;Спосіб оплати;Створив';
        const rows = result.rows.map(r =>
            [r.id, r.type === 'income' ? 'Дохід' : 'Витрата', r.category_name || '',
             r.amount, (r.description || '').replace(/;/g, ','), r.date,
             r.payment_method || '', r.created_by || ''].join(';')
        );

        const csv = BOM + header + '\n' + rows.join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="finance_${from}_${to}.csv"`);
        res.send(csv);
    } catch (err) {
        log.error('GET /export error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.6: CASH REGISTER SHIFTS
// ==========================================

// GET /api/finance/shift/current
router.get('/shift/current', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM cash_register_shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1`
        );
        if (result.rows.length === 0) {
            return res.json({ shift: null, isOpen: false });
        }
        const s = result.rows[0];
        // Calculate cash transactions during this shift
        const cashTx = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::int AS cash_income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::int AS cash_expense
            FROM finance_transactions
            WHERE payment_method = 'cash' AND created_at >= $1
        `, [s.opened_at]);
        const ct = cashTx.rows[0];
        res.json({
            shift: {
                id: s.id, openedBy: s.opened_by, openedAt: s.opened_at,
                openingCash: s.opening_cash, notes: s.notes,
                cashIncome: ct.cash_income, cashExpense: ct.cash_expense,
                expectedCash: s.opening_cash + ct.cash_income - ct.cash_expense
            },
            isOpen: true
        });
    } catch (err) {
        log.error('GET /shift/current error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/finance/shift/open
router.post('/shift/open', async (req, res) => {
    try {
        const { openingCash, notes } = req.body;
        if (openingCash === undefined || openingCash < 0) {
            return res.status(400).json({ error: 'openingCash (>=0) обовʼязковий' });
        }
        // Check if shift already open
        const existing = await pool.query(`SELECT id FROM cash_register_shifts WHERE status = 'open' LIMIT 1`);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Зміна вже відкрита. Спочатку закрийте поточну.' });
        }
        const result = await pool.query(
            `INSERT INTO cash_register_shifts (opened_by, opening_cash, notes) VALUES ($1, $2, $3) RETURNING *`,
            [req.user.id, parseInt(openingCash), notes || null]
        );
        res.status(201).json({ success: true, shift: result.rows[0] });
    } catch (err) {
        log.error('POST /shift/open error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/finance/shift/close
router.post('/shift/close', async (req, res) => {
    try {
        const { closingCash, notes } = req.body;
        if (closingCash === undefined || closingCash < 0) {
            return res.status(400).json({ error: 'closingCash (>=0) обовʼязковий' });
        }
        const current = await pool.query(`SELECT * FROM cash_register_shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1`);
        if (current.rows.length === 0) {
            return res.status(400).json({ error: 'Немає відкритої зміни' });
        }
        const shift = current.rows[0];
        // Calculate expected cash
        const cashTx = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::int AS cash_income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::int AS cash_expense
            FROM finance_transactions
            WHERE payment_method = 'cash' AND created_at >= $1
        `, [shift.opened_at]);
        const ct = cashTx.rows[0];
        const expectedCash = shift.opening_cash + ct.cash_income - ct.cash_expense;
        const cashDiff = parseInt(closingCash) - expectedCash;

        await pool.query(
            `UPDATE cash_register_shifts SET status = 'closed', closed_by = $1, closed_at = NOW(),
             closing_cash = $2, expected_cash = $3, cash_difference = $4, notes = COALESCE($5, notes)
             WHERE id = $6`,
            [req.user.id, parseInt(closingCash), expectedCash, cashDiff, notes, shift.id]
        );
        res.json({
            success: true,
            summary: {
                openingCash: shift.opening_cash,
                cashIncome: ct.cash_income,
                cashExpense: ct.cash_expense,
                expectedCash,
                closingCash: parseInt(closingCash),
                difference: cashDiff
            }
        });
    } catch (err) {
        log.error('POST /shift/close error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/finance/shift/history
router.get('/shift/history', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 30, 100);
        const result = await pool.query(
            `SELECT s.*, u1.name AS opened_by_name, u2.name AS closed_by_name
             FROM cash_register_shifts s
             LEFT JOIN users u1 ON s.opened_by = u1.id
             LEFT JOIN users u2 ON s.closed_by = u2.id
             ORDER BY s.opened_at DESC LIMIT $1`, [limit]
        );
        res.json({ shifts: result.rows });
    } catch (err) {
        log.error('GET /shift/history error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.6: REVENUE FORECAST
// ==========================================

router.get('/forecast', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const today = new Date().toISOString().split('T')[0];
        const endDate = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];

        // Confirmed bookings revenue
        const bookings = await pool.query(`
            SELECT date, COUNT(*)::int AS booking_count,
                COALESCE(SUM(price), 0)::int AS expected_revenue
            FROM bookings
            WHERE date >= $1 AND date <= $2 AND status = 'confirmed' AND linked_to IS NULL
            GROUP BY date ORDER BY date
        `, [today, endDate]);

        // Weekly aggregate
        const weekly = await pool.query(`
            SELECT DATE_TRUNC('week', date::date)::date AS week_start,
                COUNT(*)::int AS booking_count,
                COALESCE(SUM(price), 0)::int AS expected_revenue
            FROM bookings
            WHERE date >= $1 AND date <= $2 AND status = 'confirmed' AND linked_to IS NULL
            GROUP BY week_start ORDER BY week_start
        `, [today, endDate]);

        // Historical average (last 3 months same weekday pattern)
        const histAvg = await pool.query(`
            SELECT EXTRACT(DOW FROM date::date)::int AS dow,
                ROUND(AVG(daily_revenue))::int AS avg_revenue,
                ROUND(AVG(daily_count))::int AS avg_count
            FROM (
                SELECT date, SUM(price) AS daily_revenue, COUNT(*) AS daily_count
                FROM bookings
                WHERE date::date >= (CURRENT_DATE - INTERVAL '90 days') AND date::date < CURRENT_DATE
                  AND status = 'confirmed' AND linked_to IS NULL
                GROUP BY date
            ) sub
            GROUP BY dow ORDER BY dow
        `);

        const totalForecast = bookings.rows.reduce((s, r) => s + r.expected_revenue, 0);
        const totalBookings = bookings.rows.reduce((s, r) => s + r.booking_count, 0);

        res.json({
            period: { from: today, to: endDate, days },
            daily: bookings.rows,
            weekly: weekly.rows,
            historicalAverage: histAvg.rows,
            totals: { expectedRevenue: totalForecast, bookingCount: totalBookings }
        });
    } catch (err) {
        log.error('GET /forecast error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.6: EXPENSE ALLOCATION
// ==========================================

router.get('/expense-allocation', async (req, res) => {
    try {
        let { from, to } = req.query;
        if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
            const now = new Date();
            const range = getMonthRange(now.getFullYear(), now.getMonth() + 1);
            from = range.from;
            to = range.to;
        }

        const result = await pool.query(`
            SELECT fc.name, fc.icon, fc.color, fc.type,
                COALESCE(SUM(ft.amount), 0)::int AS total,
                COUNT(ft.id)::int AS count,
                ROUND(COALESCE(SUM(ft.amount), 0) * 100.0 /
                    NULLIF((SELECT SUM(amount) FROM finance_transactions WHERE type = 'expense' AND date >= $1 AND date <= $2), 0)
                )::int AS percentage
            FROM finance_categories fc
            LEFT JOIN finance_transactions ft ON ft.category_id = fc.id AND ft.date >= $1 AND ft.date <= $2
            WHERE fc.type = 'expense' AND fc.is_active = true
            GROUP BY fc.id, fc.name, fc.icon, fc.color, fc.type
            ORDER BY total DESC
        `, [from, to]);

        const totalExpenses = result.rows.reduce((s, r) => s + r.total, 0);

        res.json({
            period: { from, to },
            allocation: result.rows.map(r => ({
                category: r.name, icon: r.icon, color: r.color,
                total: r.total, count: r.count,
                percentage: r.percentage || 0
            })),
            totalExpenses
        });
    } catch (err) {
        log.error('GET /expense-allocation error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.6: ENHANCED P&L REPORT
// ==========================================

router.get('/report/pnl', async (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = parseInt(req.query.month);

        let from, to;
        if (month && month >= 1 && month <= 12) {
            const range = getMonthRange(year, month);
            from = range.from;
            to = range.to;
        } else {
            from = `${year}-01-01`;
            to = `${year}-12-31`;
        }

        // Revenue by category
        const income = await pool.query(`
            SELECT fc.name, fc.icon, COALESCE(SUM(ft.amount), 0)::int AS total
            FROM finance_transactions ft
            JOIN finance_categories fc ON ft.category_id = fc.id
            WHERE ft.type = 'income' AND ft.date >= $1 AND ft.date <= $2
            GROUP BY fc.id, fc.name, fc.icon ORDER BY total DESC
        `, [from, to]);

        // COGS / Direct expenses
        const expenses = await pool.query(`
            SELECT fc.name, fc.icon, COALESCE(SUM(ft.amount), 0)::int AS total
            FROM finance_transactions ft
            JOIN finance_categories fc ON ft.category_id = fc.id
            WHERE ft.type = 'expense' AND ft.date >= $1 AND ft.date <= $2
            GROUP BY fc.id, fc.name, fc.icon ORDER BY total DESC
        `, [from, to]);

        // Booking revenue (cross-reference)
        const bookingRev = await pool.query(`
            SELECT COALESCE(SUM(price), 0)::int AS total
            FROM bookings WHERE date >= $1 AND date <= $2
            AND status = 'confirmed' AND linked_to IS NULL
        `, [from, to]);

        const totalIncome = income.rows.reduce((s, r) => s + r.total, 0);
        const totalExpenses = expenses.rows.reduce((s, r) => s + r.total, 0);
        const grossProfit = totalIncome - totalExpenses;
        const margin = totalIncome > 0 ? Math.round((grossProfit / totalIncome) * 100) : 0;

        // Previous period comparison
        let prevFrom, prevTo;
        if (month) {
            const pm = month === 1 ? 12 : month - 1;
            const py = month === 1 ? year - 1 : year;
            const prevRange = getMonthRange(py, pm);
            prevFrom = prevRange.from;
            prevTo = prevRange.to;
        } else {
            prevFrom = `${year - 1}-01-01`;
            prevTo = `${year - 1}-12-31`;
        }

        const prevTotals = await pool.query(`
            SELECT
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::int AS income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::int AS expense
            FROM finance_transactions WHERE date >= $1 AND date <= $2
        `, [prevFrom, prevTo]);

        const prev = prevTotals.rows[0];

        res.json({
            period: { from, to, year, month: month || null },
            revenue: income.rows,
            expenses: expenses.rows,
            bookingRevenue: bookingRev.rows[0].total,
            summary: {
                totalIncome, totalExpenses, grossProfit, margin,
                previousIncome: prev.income, previousExpenses: prev.expense,
                previousProfit: prev.income - prev.expense,
                incomeChange: prev.income > 0 ? Math.round(((totalIncome - prev.income) / prev.income) * 100) : 0,
                expenseChange: prev.expense > 0 ? Math.round(((totalExpenses - prev.expense) / prev.expense) * 100) : 0
            }
        });
    } catch (err) {
        log.error('GET /report/pnl error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.6: RECEIPT / CHECK GENERATION
// ==========================================

router.post('/receipt', async (req, res) => {
    try {
        const { bookingId, transactionId, amount, paymentMethod, customerName, items } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'amount обовʼязковий' });
        }

        // Generate receipt number: RCP-YYYY-NNNN
        const yearStr = new Date().getFullYear().toString();
        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS cnt FROM receipts WHERE receipt_number LIKE $1`,
            [`RCP-${yearStr}-%`]
        );
        const num = (countResult.rows[0].cnt + 1).toString().padStart(4, '0');
        const receiptNumber = `RCP-${yearStr}-${num}`;

        // QR data: simple payment info
        const qrData = JSON.stringify({
            receipt: receiptNumber,
            amount,
            date: new Date().toISOString(),
            paymentMethod: paymentMethod || 'cash',
            company: 'Парк Закревського Періоду'
        });

        const result = await pool.query(
            `INSERT INTO receipts (booking_id, transaction_id, amount, payment_method, receipt_number, qr_data, customer_name, items, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [bookingId || null, transactionId || null, parseInt(amount),
             paymentMethod || null, receiptNumber, qrData,
             customerName || null, items ? JSON.stringify(items) : null, req.user?.username]
        );

        res.status(201).json({
            success: true,
            receipt: {
                id: result.rows[0].id,
                receiptNumber,
                amount: parseInt(amount),
                qrData,
                createdAt: result.rows[0].created_at
            }
        });
    } catch (err) {
        log.error('POST /receipt error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/finance/receipt/:id — get receipt for printing
router.get('/receipt/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM receipts WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Чек не знайдено' });
        const r = result.rows[0];
        res.json({
            id: r.id, receiptNumber: r.receipt_number, amount: r.amount,
            paymentMethod: r.payment_method, qrData: r.qr_data,
            customerName: r.customer_name, items: r.items,
            bookingId: r.booking_id, createdBy: r.created_by, createdAt: r.created_at
        });
    } catch (err) {
        log.error('GET /receipt/:id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.6: DEBT NOTIFICATIONS
// ==========================================

router.get('/debts', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.id, b.date, b.time, b.label, b.program_name, b.price,
                b.payment_status, b.paid_amount, b.customer_id,
                c.name AS customer_name, c.phone AS customer_phone,
                (COALESCE(b.price, 0) - COALESCE(b.paid_amount, 0)) AS debt_amount
            FROM bookings b
            LEFT JOIN customers c ON b.customer_id = c.id
            WHERE b.status = 'confirmed'
              AND b.linked_to IS NULL
              AND b.price > 0
              AND (b.payment_status IS NULL OR b.payment_status != 'paid')
              AND COALESCE(b.paid_amount, 0) < COALESCE(b.price, 0)
              AND b.date::date <= CURRENT_DATE
            ORDER BY b.date DESC
            LIMIT 100
        `);

        const totalDebt = result.rows.reduce((s, r) => s + r.debt_amount, 0);

        res.json({
            debts: result.rows.map(r => ({
                bookingId: r.id, date: r.date, time: r.time,
                label: r.label, programName: r.program_name,
                price: r.price, paidAmount: r.paid_amount,
                debtAmount: r.debt_amount,
                paymentStatus: r.payment_status,
                customerId: r.customer_id,
                customerName: r.customer_name,
                customerPhone: r.customer_phone
            })),
            totalDebt,
            count: result.rows.length
        });
    } catch (err) {
        log.error('GET /debts error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/finance/debts/:bookingId/mark-paid
router.post('/debts/:bookingId/mark-paid', async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { paidAmount } = req.body;
        const booking = await pool.query('SELECT price FROM bookings WHERE id = $1', [bookingId]);
        if (booking.rows.length === 0) return res.status(404).json({ error: 'Бронювання не знайдено' });

        const amount = paidAmount ? parseInt(paidAmount) : booking.rows[0].price;
        const status = amount >= booking.rows[0].price ? 'paid' : 'partial';

        await pool.query(
            `UPDATE bookings SET paid_amount = $1, payment_status = $2 WHERE id = $3`,
            [amount, status, bookingId]
        );
        res.json({ success: true, paymentStatus: status, paidAmount: amount });
    } catch (err) {
        log.error('POST /debts/:bookingId/mark-paid error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.6: MULTI-CURRENCY CONVERSION
// ==========================================

const CURRENCY_RATES = {
    EUR: 44.5,
    USD: 41.2,
    GBP: 52.1,
    PLN: 10.3,
    CZK: 1.7
};

router.get('/currency/rates', (req, res) => {
    res.json({
        base: 'UAH',
        rates: CURRENCY_RATES,
        updatedAt: new Date().toISOString()
    });
});

router.post('/currency/convert', async (req, res) => {
    try {
        const { amount, currency, bookingId } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ error: 'amount обовʼязковий' });
        const curr = (currency || 'EUR').toUpperCase();
        const rate = CURRENCY_RATES[curr];
        if (!rate) return res.status(400).json({ error: `Невідома валюта: ${curr}` });

        const converted = Math.round(amount * rate);

        await pool.query(
            `INSERT INTO currency_conversions (from_currency, to_currency, original_amount, rate, converted_amount, booking_id, created_by)
             VALUES ($1, 'UAH', $2, $3, $4, $5, $6)`,
            [curr, amount, rate, converted, bookingId || null, req.user?.username]
        );

        res.json({
            original: { amount, currency: curr },
            converted: { amount: converted, currency: 'UAH' },
            rate,
            formatted: `${amount} ${curr} = ${converted.toLocaleString('uk-UA')} ₴`
        });
    } catch (err) {
        log.error('POST /currency/convert error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.6: ACT OF COMPLETED WORK (Акт виконаних робіт)
// ==========================================

router.get('/act/:bookingId', async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await pool.query(`
            SELECT b.*, c.name AS customer_name, c.phone AS customer_phone
            FROM bookings b
            LEFT JOIN customers c ON b.customer_id = c.id
            WHERE b.id = $1
        `, [bookingId]);

        if (booking.rows.length === 0) return res.status(404).json({ error: 'Бронювання не знайдено' });
        const b = booking.rows[0];

        const actNumber = `ACT-${b.id}`;
        const actDate = new Date().toLocaleDateString('uk-UA');

        const html = `<!DOCTYPE html>
<html lang="uk"><head><meta charset="UTF-8">
<title>Акт ${actNumber}</title>
<style>
body{font-family:'Nunito',Arial,sans-serif;margin:40px;color:#1a1a2e;font-size:14px;line-height:1.6}
h1{text-align:center;font-size:20px;margin-bottom:4px}
.subtitle{text-align:center;color:#666;margin-bottom:30px}
table{width:100%;border-collapse:collapse;margin:20px 0}
th,td{border:1px solid #ddd;padding:10px 14px;text-align:left}
th{background:#f8f9fa;font-weight:700}
.total{font-weight:900;font-size:16px}
.signatures{display:flex;justify-content:space-between;margin-top:60px}
.sign-block{width:45%;border-top:1px solid #333;padding-top:8px;text-align:center}
.company{margin-bottom:20px}
@media print{body{margin:20px}button{display:none}}
</style></head><body>
<div class="company"><strong>ФОП "Парк Закревського Періоду"</strong><br>м. Київ, вул. Закревського</div>
<h1>АКТ ВИКОНАНИХ РОБІТ</h1>
<div class="subtitle">${actNumber} від ${actDate}</div>
<p><strong>Замовник:</strong> ${b.customer_name || 'Не вказано'}</p>
<p><strong>Телефон:</strong> ${b.customer_phone || 'Не вказано'}</p>
<p><strong>Дата проведення:</strong> ${b.date} о ${b.time}</p>
<table>
<thead><tr><th>№</th><th>Послуга</th><th>Тривалість</th><th>Сума, ₴</th></tr></thead>
<tbody>
<tr><td>1</td><td>${b.program_name || b.label || b.program_code || 'Розважальна програма'}</td>
<td>${b.duration || 0} хв</td><td>${(b.price || 0).toLocaleString('uk-UA')}</td></tr>
</tbody>
<tfoot><tr><td colspan="3" class="total">РАЗОМ:</td><td class="total">${(b.price || 0).toLocaleString('uk-UA')} ₴</td></tr></tfoot>
</table>
<p>Роботи виконані в повному обсязі. Замовник претензій до якості та обсягу наданих послуг не має.</p>
<div class="signatures">
<div class="sign-block">Виконавець<br><br>_______________<br>ФОП "Парк Закревського Періоду"</div>
<div class="sign-block">Замовник<br><br>_______________<br>${b.customer_name || '_______________'}</div>
</div>
<br><button onclick="window.print()" style="padding:12px 24px;background:#10B981;color:white;border:none;border-radius:8px;font-size:16px;cursor:pointer">Друкувати</button>
</body></html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        log.error('GET /act/:bookingId error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// v30.6: ADVANCED FINANCIAL DASHBOARD
// ==========================================

router.get('/advanced-dashboard', async (req, res) => {
    try {
        // Revenue trend (last 6 months)
        const revenueTrend = await pool.query(`
            SELECT TO_CHAR(date::date, 'YYYY-MM') AS month,
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::int AS income,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::int AS expense
            FROM finance_transactions
            WHERE date::date >= (CURRENT_DATE - INTERVAL '6 months')
            GROUP BY month ORDER BY month
        `);

        // Cash flow (income vs expense by week, last 8 weeks)
        const cashFlow = await pool.query(`
            SELECT DATE_TRUNC('week', date::date)::date AS week,
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0)::int AS inflow,
                COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0)::int AS outflow
            FROM finance_transactions
            WHERE date::date >= (CURRENT_DATE - INTERVAL '8 weeks')
            GROUP BY week ORDER BY week
        `);

        // Top 5 expenses (current month)
        const now = new Date();
        const range = getMonthRange(now.getFullYear(), now.getMonth() + 1);
        const topExpenses = await pool.query(`
            SELECT ft.description, ft.amount, ft.date, fc.name AS category_name, fc.icon
            FROM finance_transactions ft
            LEFT JOIN finance_categories fc ON ft.category_id = fc.id
            WHERE ft.type = 'expense' AND ft.date >= $1 AND ft.date <= $2
            ORDER BY ft.amount DESC LIMIT 5
        `, [range.from, range.to]);

        // Payment method distribution (current month)
        const paymentDist = await pool.query(`
            SELECT payment_method,
                COALESCE(SUM(amount), 0)::int AS total,
                COUNT(*)::int AS count
            FROM finance_transactions
            WHERE date >= $1 AND date <= $2 AND payment_method IS NOT NULL
            GROUP BY payment_method ORDER BY total DESC
        `, [range.from, range.to]);

        // Key metrics
        const metrics = await pool.query(`
            SELECT
                (SELECT COALESCE(SUM(amount), 0)::int FROM finance_transactions WHERE type = 'income' AND date >= $1 AND date <= $2) AS month_income,
                (SELECT COALESCE(SUM(amount), 0)::int FROM finance_transactions WHERE type = 'expense' AND date >= $1 AND date <= $2) AS month_expense,
                (SELECT COALESCE(SUM(price), 0)::int FROM bookings WHERE date >= $1 AND date <= $2 AND status = 'confirmed' AND linked_to IS NULL) AS month_bookings_revenue,
                (SELECT COUNT(*)::int FROM bookings WHERE date >= $1 AND date <= $2 AND status = 'confirmed' AND linked_to IS NULL) AS month_bookings_count,
                (SELECT COALESCE(AVG(price), 0)::int FROM bookings WHERE date >= $1 AND date <= $2 AND status = 'confirmed' AND linked_to IS NULL AND price > 0) AS avg_booking_price
        `, [range.from, range.to]);

        // Debt summary
        const debtSummary = await pool.query(`
            SELECT COUNT(*)::int AS count,
                COALESCE(SUM(COALESCE(price, 0) - COALESCE(paid_amount, 0)), 0)::int AS total_debt
            FROM bookings
            WHERE status = 'confirmed' AND linked_to IS NULL AND price > 0
              AND (payment_status IS NULL OR payment_status != 'paid')
              AND COALESCE(paid_amount, 0) < COALESCE(price, 0)
              AND date::date <= CURRENT_DATE
        `);

        const m = metrics.rows[0];

        res.json({
            revenueTrend: revenueTrend.rows,
            cashFlow: cashFlow.rows.map(r => ({
                week: r.week, inflow: r.inflow, outflow: r.outflow,
                netFlow: r.inflow - r.outflow
            })),
            topExpenses: topExpenses.rows.map(r => ({
                description: r.description, amount: r.amount,
                date: r.date, category: r.category_name, icon: r.icon
            })),
            paymentDistribution: paymentDist.rows,
            metrics: {
                monthIncome: m.month_income,
                monthExpense: m.month_expense,
                monthProfit: m.month_income - m.month_expense,
                bookingsRevenue: m.month_bookings_revenue,
                bookingsCount: m.month_bookings_count,
                avgBookingPrice: m.avg_booking_price,
                margin: m.month_income > 0 ? Math.round(((m.month_income - m.month_expense) / m.month_income) * 100) : 0
            },
            debt: debtSummary.rows[0]
        });
    } catch (err) {
        log.error('GET /advanced-dashboard error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── Finance Accounts (v33.5) ────────────────────────────────
const ACCOUNT_TYPES = ['cash', 'card', 'bank'];

router.get('/accounts', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM finance_accounts WHERE is_active = true ORDER BY sort_order'
        );
        res.json({ success: true, accounts: result.rows });
    } catch (err) {
        log.error('GET /accounts error', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

router.post('/accounts', requireRole('admin', 'senior_manager'), async (req, res) => {
    try {
        const { name, emoji, description, type, sortOrder } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'name required' });
        if (type && !ACCOUNT_TYPES.includes(type)) {
            return res.status(400).json({ error: 'Invalid type (cash|card|bank)' });
        }
        const r = await pool.query(
            `INSERT INTO finance_accounts (name, emoji, description, type, sort_order, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [name.trim(), emoji || '💳', description?.trim() || null,
             type || 'cash', sortOrder || 99, req.user.username]
        );
        res.json({ success: true, account: r.rows[0] });
    } catch (err) {
        log.error('POST /accounts error', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

router.patch('/accounts/:id', requireRole('admin', 'senior_manager'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid account ID' });
        const { name, emoji, description, isActive, sortOrder } = req.body;
        const sets = [], vals = [];
        let idx = 1;
        if (name !== undefined)        { sets.push(`name = $${idx++}`);        vals.push(String(name).trim()); }
        if (emoji !== undefined)       { sets.push(`emoji = $${idx++}`);       vals.push(String(emoji).slice(0, 10)); }
        if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description?.trim() || null); }
        if (isActive !== undefined)    { sets.push(`is_active = $${idx++}`);   vals.push(isActive === true || isActive === 'true'); }
        if (sortOrder !== undefined)   { sets.push(`sort_order = $${idx++}`);  vals.push(parseInt(sortOrder, 10) || 0); }
        if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
        vals.push(id);
        const r = await pool.query(
            `UPDATE finance_accounts SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
            vals
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true, account: r.rows[0] });
    } catch (err) {
        log.error('PATCH /accounts error', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

router.delete('/accounts/:id', requireRole('admin'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid account ID' });
        const r = await pool.query('UPDATE finance_accounts SET is_active = false WHERE id = $1', [id]);
        if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /accounts error', err);
        res.status(500).json({ success: false, error: 'Database error' });
    }
});

module.exports = router;
