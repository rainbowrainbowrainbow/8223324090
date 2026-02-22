/**
 * routes/finance.js — Finance module API (v16.0)
 *
 * CRUD for transactions & categories, P&L summary, reports, CSV export.
 * All amounts in UAH (integer).
 */

const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Finance');

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

// Role check: only admin
router.use((req, res, next) => {
    if (req.user && req.user.role === 'viewer') {
        return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
});

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

module.exports = router;
