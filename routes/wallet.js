/**
 * routes/wallet.js — Game currency (coins) API
 * v22.5.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, ANY_ROLE } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Wallet');

// Existing deployments and fresh migrations use two supported inventory/ledger layouts.
const walletColumnCache = new Map();
async function walletTableColumns(client, tableName) {
    if (walletColumnCache.has(tableName)) return walletColumnCache.get(tableName);
    const result = await client.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
        [tableName]
    );
    const columns = new Set(result.rows.map(row => row.column_name));
    if (!columns.size) throw new Error(`Wallet table unavailable: ${tableName}`);
    walletColumnCache.set(tableName, columns);
    return columns;
}

async function recordWalletTransaction(client, userId, amount, type, description, referenceId = null) {
    const columns = await walletTableColumns(client, 'coin_transactions');
    const withUsername = columns.has('username');
    await client.query(
        `INSERT INTO coin_transactions (user_id, ${withUsername ? 'username,' : ''} amount, type, description, reference_id)
         VALUES ($1, ${withUsername ? '(SELECT username FROM users WHERE id = $1),' : ''} $2, $3, $4, $5)`,
        [userId, amount, type, description, referenceId]
    );
}

// GET /api/wallet — current user balance
router.get('/', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        let wallet = await pool.query('SELECT * FROM game_wallets WHERE user_id = $1', [req.user.id]);
        if (wallet.rows.length === 0) {
            // v39.9: Wrap in transaction to prevent duplicate starter bonus race condition
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const created = await client.query(
                    'INSERT INTO game_wallets (user_id, coins, total_earned) VALUES ($1, 500, 500) ON CONFLICT (user_id) DO NOTHING RETURNING user_id',
                    [req.user.id]
                );
                // Only insert bonus if wallet was actually created (not already exists)
                if (created.rows.length > 0) {
                    await recordWalletTransaction(client, req.user.id, 500, 'starter_bonus', 'Стартовий бонус');
                }
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK').catch(() => {});
                throw e;
            } finally { client.release(); }
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
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const wallet = await client.query(
            'SELECT *, last_login_reward::text AS last_login_reward_day FROM game_wallets WHERE user_id = $1 FOR UPDATE',
            [req.user.id]
        );

        if (wallet.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Гаманець не знайдено' });
        }

        const w = wallet.rows[0];
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        if (w.last_login_reward_day === today) {
            await client.query('ROLLBACK');
            return res.json({ alreadyClaimed: true, loginStreak: w.login_streak, reward: 0 });
        }

        // Double-check via coin_transactions to prevent duplicate claims
        const alreadyClaimed = await client.query(
            `SELECT 1 FROM coin_transactions WHERE user_id = $1 AND type = 'daily_login'
                AND created_at >= (($2::date::timestamp AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone'))
                AND created_at < ((($2::date + 1)::timestamp AT TIME ZONE 'UTC') AT TIME ZONE current_setting('TimeZone'))
                LIMIT 1`,
            [req.user.id, today]
        );
        if (alreadyClaimed.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.json({ alreadyClaimed: true, loginStreak: w.login_streak || 0, reward: 0 });
        }

        // Check if streak continues (yesterday) or resets
        const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
        let streak = (w.last_login_reward_day === yesterday) ? (w.login_streak || 0) : 0;
        const dayIndex = streak % 7; // 0-6
        const reward = DAILY_REWARDS[dayIndex];
        streak++;

        // Award coins
        await client.query(
            'UPDATE game_wallets SET coins = coins + $1, total_earned = total_earned + $1, login_streak = $2, last_login_reward = $3, updated_at = NOW() WHERE user_id = $4',
            [reward, streak, today, req.user.id]
        );
        await recordWalletTransaction(client, req.user.id, reward, 'daily_login', `Щоденний бонус (день ${streak})`);

        // Day 7 bonus: random common item
        let bonusItem = null;
        if (dayIndex === 6) {
            const inventoryColumns = await walletTableColumns(client, 'user_inventory');
            const usesShopInventory = inventoryColumns.has('user_id');
            const items = await client.query(
                usesShopInventory
                    ? "SELECT id, name FROM shop_items WHERE rarity = 'common' AND is_available = true AND equip_slot IS NOT NULL ORDER BY RANDOM() LIMIT 1"
                    : "SELECT item_id AS id, name FROM shop_items WHERE rarity = 'common' AND is_active = true AND equip_slot IS NOT NULL AND item_id IS NOT NULL ORDER BY RANDOM() LIMIT 1"
            );
            if (items.rows.length > 0) {
                const item = items.rows[0];
                if (usesShopInventory) {
                    const withUsername = inventoryColumns.has('username');
                    await client.query(
                        `INSERT INTO user_inventory (user_id, item_id, quantity, obtained_from${withUsername ? ', username' : ''})
                         VALUES ($1, $2, 1, 'daily_login'${withUsername ? ', (SELECT username FROM users WHERE id = $1)' : ''})
                         ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = user_inventory.quantity + 1`,
                        [req.user.id, item.id]
                    );
                    bonusItem = item.name;
                } else {
                    // Match the canonical achievement writer: unique owned character items.
                    const granted = await client.query(
                        `INSERT INTO user_inventory (username, item_id, acquired_via)
                         VALUES ((SELECT username FROM users WHERE id = $1), $2, 'daily_login')
                         ON CONFLICT (username, item_id) DO NOTHING RETURNING id`,
                        [req.user.id, item.id]
                    );
                    if (granted.rows.length) bonusItem = item.name;
                }
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
        if (client) await client.query('ROLLBACK').catch(() => {});
        log.error('Daily login error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (client) client.release();
    }
});

function parseWalletHistoryInteger(value) {
    // Preserve scalar/first repeated-value parsing without coercing query objects.
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === 'string' ? parseInt(raw) : NaN;
}

// GET /api/wallet/history — transaction history
router.get('/history', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const parsedLimit = parseWalletHistoryInteger(req.query.limit);
        const limit = parsedLimit > 0 ? Math.min(parsedLimit, 50) : 20;
        const parsedPage = parseWalletHistoryInteger(req.query.page);
        const page = Number.isSafeInteger(parsedPage) && parsedPage > 0
            && Number.isSafeInteger((parsedPage - 1) * limit) ? parsedPage : 1;
        const offset = (page - 1) * limit;

        const [txns, count] = await Promise.all([
            pool.query(
                'SELECT * FROM coin_transactions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3',
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
function walletPositiveInteger(value) {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value.trim()))) return null;
    const number = Number(value);
    // Wallet amounts and user IDs are PostgreSQL INTEGER columns.
    return Number.isSafeInteger(number) && number > 0 && number <= 2147483647 ? number : null;
}

router.post('/transfer', requireRole(...ANY_ROLE), async (req, res) => {
    const to_user_id = walletPositiveInteger(req.body?.to_user_id);
    const amount = walletPositiveInteger(req.body?.amount);
    if (to_user_id === null || amount === null) {
        return res.status(400).json({ error: 'to_user_id та amount (>0) обов\'язкові' });
    }
    if (to_user_id === Number(req.user.id)) {
        return res.status(400).json({ error: 'Не можна переказати монети собі' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Check recipient exists
        const recipient = await client.query('SELECT id, name FROM users WHERE id = $1', [to_user_id]);
        if (recipient.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Користувача не знайдено' });
        }

        // Lock both wallets in consistent order (lower id first) to prevent deadlocks
        const [firstId, secondId] = req.user.id < to_user_id
            ? [req.user.id, to_user_id]
            : [to_user_id, req.user.id];

        await client.query(
            'SELECT 1 FROM game_wallets WHERE user_id = $1 FOR UPDATE',
            [firstId]
        );
        await client.query(
            'SELECT 1 FROM game_wallets WHERE user_id = $1 FOR UPDATE',
            [secondId]
        );

        // Check sender balance (re-read after lock)
        const sender = await client.query(
            'SELECT coins FROM game_wallets WHERE user_id = $1',
            [req.user.id]
        );
        if (sender.rows.length === 0 || sender.rows[0].coins < amount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Недостатньо монет' });
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
        await recordWalletTransaction(client, req.user.id, -amount, 'gift', `Подарунок для ${recipient.rows[0].name}`, to_user_id);
        await recordWalletTransaction(client, to_user_id, amount, 'gift', `Подарунок від ${req.user.name || req.user.username}`, req.user.id);

        await client.query('COMMIT');
        res.json({ success: true, message: `Переказано ${amount} монет` });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        log.error('Transfer error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (client) client.release();
    }
});

module.exports = router;
