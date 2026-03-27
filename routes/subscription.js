/**
 * routes/subscription.js — CRM subscription status & reminders
 * v32.1: Track payment dates, show reminders on dashboard
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, authenticateToken } = require('../middleware/auth'); 
const { createLogger } = require('../utils/logger');

const log = createLogger('Subscription');

// Ensure subscription table exists
async function ensureTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS subscription (
            id SERIAL PRIMARY KEY,
            plan_name VARCHAR(100) DEFAULT 'Базовий',
            amount INTEGER DEFAULT 2000,
            next_payment_date DATE,
            billing_period VARCHAR(20) DEFAULT 'monthly',
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
    const { rows } = await pool.query('SELECT COUNT(*) FROM subscription');
    if (parseInt(rows[0].count) === 0) {
        await pool.query(
            `INSERT INTO subscription (plan_name, amount, next_payment_date, billing_period)
             VALUES ('Базовий', 2000, CURRENT_DATE + INTERVAL '30 days', 'monthly')`
        );
    }
}

// GET /api/subscription/status
// v39.8: Security — require authentication
router.use(authenticateToken);
router.get('/status', async (req, res) => {
    try {
        await ensureTable();
        const result = await pool.query('SELECT * FROM subscription ORDER BY id LIMIT 1');
        if (result.rows.length === 0) {
            return res.json({ success: true, nextPaymentDate: null, daysUntilPayment: null, status: 'unknown' });
        }
        const sub = result.rows[0];
        const nextDate = sub.next_payment_date ? new Date(sub.next_payment_date) : null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysUntil = nextDate ? Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24)) : null;

        res.json({
            success: true,
            planName: sub.plan_name,
            amount: sub.amount,
            nextPaymentDate: sub.next_payment_date,
            billingPeriod: sub.billing_period,
            daysUntilPayment: daysUntil,
            status: daysUntil === null ? 'unknown' : daysUntil < 0 ? 'overdue' : 'active',
            notes: sub.notes
        });
    } catch (err) {
        log.error('GET /subscription/status error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// PATCH /api/subscription — update subscription info (director/creator only)
router.patch('/', requireRole('director', 'creator'), async (req, res) => {
    try {
        await ensureTable();
        const { amount, nextPaymentDate, billingPeriod, planName, notes } = req.body;
        const fields = [];
        const params = [];
        let idx = 1;

        if (amount !== undefined) { fields.push(`amount = $${idx++}`); params.push(amount); }
        if (nextPaymentDate !== undefined) { fields.push(`next_payment_date = $${idx++}`); params.push(nextPaymentDate); }
        if (billingPeriod !== undefined) { fields.push(`billing_period = $${idx++}`); params.push(billingPeriod); }
        if (planName !== undefined) { fields.push(`plan_name = $${idx++}`); params.push(planName); }
        if (notes !== undefined) { fields.push(`notes = $${idx++}`); params.push(notes); }

        if (fields.length === 0) return res.json({ success: false, error: 'Нічого оновлювати' });

        fields.push('updated_at = NOW()');
        await pool.query(`UPDATE subscription SET ${fields.join(', ')} WHERE id = (SELECT id FROM subscription ORDER BY id LIMIT 1)`, params);
        res.json({ success: true });
    } catch (err) {
        log.error('PATCH /subscription error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
