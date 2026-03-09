/**
 * routes/wallet.js — Game currency (coins) API
 * v22.5.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, ANY_ROLE } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Wallet');

// GET /api/wallet — current user balance
router.get('/', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        let wallet = await pool.query('SELECT * FROM game_wallets WHERE user_id = $1', [req.user.id]);
        if (wallet.rows.length === 0) {
            // Auto-create wallet with starter bonus (500 coins)
            await pool.query(
                'INSERT INTO game_wallets (user_id, coins, total_earned) VALUES ($1, 500, 500) ON CONFLICT (user_id) DO NOTHING',
                [req.user.id]
            );
            await pool.query(
                'INSERT INTO coin_transactions (user_id, amount, type, description) VALUES ($1, 500, $2, $3)',
                [req.user.id, 'starter_bonus', 'Стартовий бонус']
            );
            wallet = await pool.query('SELECT * FROM game_wallets WHERE user_id = $1', [req.user.id]);
        }
        const w = wallet.rows[0];
        res.json({
            coins: w.coins,
            totalEarned: w.total_earned,
            totalSpent: w.total_spent,
            loginStreak: w.login_streak || 0,
            lastLoginReward: w.last_login_reward
        });
    } catch (err) {
        log.error('Get wallet error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/wallet/daily-login — claim daily login reward
const DAILY_REWARDS = [10, 15, 20, 25, 30, 40, 50];

router.post('/daily-login', requireRole(...ANY_ROLE), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const wallet = await client.query(
            'SELECT * FROM game_wallets WHERE user_id = $1 FOR UPDATE',
            [req.user.id]
        );

        if (wallet.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Гаманець не знайдено' });
        }

        const w = wallet.rows[0];
        const today = new Date().toISOString().split('T')[0];

        if (w.last_login_reward === today) {
            await client.query('ROLLBACK');
            return res.json({ alreadyClaimed: true, loginStreak: w.login_streak, reward: 0 });
        }

        // Check if streak continues (yesterday) or resets
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        let streak = (w.last_login_reward === yesterday) ? (w.login_streak || 0) : 0;
        const dayIndex = streak % 7; // 0-6
        const reward = DAILY_REWARDS[dayIndex];
        streak++;

        // Award coins
        await client.query(
            'UPDATE game_wallets SET coins = coins + $1, total_earned = total_earned + $1, login_streak = $2, last_login_reward = $3, updated_at = NOW() WHERE user_id = $4',
            [reward, streak, today, req.user.id]
        );
        await client.query(
            'INSERT INTO coin_transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)',
            [req.user.id, reward, 'daily_login', `Щоденний бонус (день ${streak})`]
        );

        // Day 7 bonus: random common item
        let bonusItem = null;
        if (dayIndex === 6) {
            const items = await client.query(
                "SELECT id, name FROM shop_items WHERE rarity = 'common' AND is_available = true AND equip_slot IS NOT NULL ORDER BY RANDOM() LIMIT 1"
            );
            if (items.rows.length > 0) {
                const item = items.rows[0];
                await client.query(
                    `INSERT INTO user_inventory (user_id, item_id, quantity, obtained_from)
                     VALUES ($1, $2, 1, 'daily_login')
                     ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = user_inventory.quantity + 1`,
                    [req.user.id, item.id]
                );
                bonusItem = item.name;
            }
        }

        await client.query('COMMIT');
        res.json({
            alreadyClaimed: false,
            loginStreak: streak,
            reward,
            bonusItem,
            dayIndex: dayIndex + 1,
            nextReward: DAILY_REWARDS[(dayIndex + 1) % 7]
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Daily login error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// GET /api/wallet/history — transaction history
router.get('/history', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const offset = (page - 1) * limit;

        const [txns, count] = await Promise.all([
            pool.query(
                'SELECT * FROM coin_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
                [req.user.id, limit, offset]
            ),
            pool.query('SELECT COUNT(*) FROM coin_transactions WHERE user_id = $1', [req.user.id])
        ]);

        res.json({
            transactions: txns.rows.map(t => ({
                id: t.id,
                amount: t.amount,
                type: t.type,
                description: t.description,
                referenceId: t.reference_id,
                createdAt: t.created_at
            })),
            total: parseInt(count.rows[0].count),
            page,
            limit
        });
    } catch (err) {
        log.error('Get wallet history error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/wallet/transfer — send coins to another user
router.post('/transfer', requireRole(...ANY_ROLE), async (req, res) => {
    const { to_user_id, amount } = req.body;
    if (!to_user_id || !amount || amount < 1) {
        return res.status(400).json({ error: 'to_user_id та amount (>0) обов\'язкові' });
    }
    if (to_user_id === req.user.id) {
        return res.status(400).json({ error: 'Не можна переказати монети собі' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check sender balance
        const sender = await client.query(
            'SELECT coins FROM game_wallets WHERE user_id = $1 FOR UPDATE',
            [req.user.id]
        );
        if (sender.rows.length === 0 || sender.rows[0].coins < amount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Недостатньо монет' });
        }

        // Check recipient exists
        const recipient = await client.query('SELECT id, name FROM users WHERE id = $1', [to_user_id]);
        if (recipient.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Користувача не знайдено' });
        }

        // Deduct from sender
        await client.query(
            'UPDATE game_wallets SET coins = coins - $1, total_spent = total_spent + $1, updated_at = NOW() WHERE user_id = $2',
            [amount, req.user.id]
        );

        // Add to recipient (create wallet if needed)
        await client.query(
            `INSERT INTO game_wallets (user_id, coins, total_earned)
             VALUES ($1, $2, $2)
             ON CONFLICT (user_id) DO UPDATE SET coins = game_wallets.coins + $2, total_earned = game_wallets.total_earned + $2, updated_at = NOW()`,
            [to_user_id, amount]
        );

        // Transaction records
        await client.query(
            'INSERT INTO coin_transactions (user_id, amount, type, description, reference_id) VALUES ($1, $2, $3, $4, $5)',
            [req.user.id, -amount, 'gift', `Подарунок для ${recipient.rows[0].name}`, to_user_id]
        );
        await client.query(
            'INSERT INTO coin_transactions (user_id, amount, type, description, reference_id) VALUES ($1, $2, $3, $4, $5)',
            [to_user_id, amount, 'gift', `Подарунок від ${req.user.name || req.user.username}`, req.user.id]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: `Переказано ${amount} монет` });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Transfer error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
