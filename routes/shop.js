/**
 * routes/shop.js — Shop + Inventory + Profile API
 * v22.4.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, ANY_ROLE } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Shop');

const tableColumnCache = new Map();

async function getTableColumns(tableName) {
    if (tableColumnCache.has(tableName)) return tableColumnCache.get(tableName);
    const result = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = $1`,
        [tableName]
    );
    const columns = new Set(result.rows.map(row => row.column_name));
    tableColumnCache.set(tableName, columns);
    return columns;
}

function columnSql(columns, alias, column, fallback) {
    return columns.has(column) ? `${alias}.${column}` : fallback;
}

// GET /api/shop — catalog
router.get('/', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM shop_items WHERE is_active = true ORDER BY category, price_coins'
        );
        res.json(result.rows.map(i => ({
            id: i.id, code: i.code, name: i.name, description: i.description,
            category: i.category, icon: i.icon, priceCoins: i.price_coins,
            rarity: i.rarity, equipSlot: i.equip_slot, type: i.type
        })));
    } catch (err) {
        log.error('Get shop error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/shop/buy — purchase item
router.post('/buy', requireRole(...ANY_ROLE), async (req, res) => {
    const { item_id } = req.body;
    if (!item_id) return res.status(400).json({ error: 'item_id обов\'язковий' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const item = await client.query('SELECT * FROM shop_items WHERE id = $1 AND is_active = true', [item_id]);
        if (item.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Товар не знайдено' });
        }
        const i = item.rows[0];

        // Check if already owned (non-consumable)
        if (i.equip_slot) {
            const owned = await client.query(
                'SELECT id FROM user_inventory WHERE user_id = $1 AND item_id = $2',
                [req.user.id, item_id]
            );
            if (owned.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Ви вже маєте цей предмет' });
            }
        }

        // Ensure wallet exists, then lock for update
        await client.query(
            'INSERT INTO game_wallets (user_id, coins) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING',
            [req.user.id]
        );
        const wallet = await client.query(
            'SELECT coins FROM game_wallets WHERE user_id = $1 FOR UPDATE',
            [req.user.id]
        );
        if (wallet.rows.length === 0 || wallet.rows[0].coins < i.price_coins) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Недостатньо монет' });
        }

        // Deduct coins
        await client.query(
            'UPDATE game_wallets SET coins = coins - $1, total_spent = total_spent + $1, updated_at = NOW() WHERE user_id = $2',
            [i.price_coins, req.user.id]
        );

        // Add to inventory
        await client.query(
            `INSERT INTO user_inventory (user_id, item_id, quantity, obtained_from)
             VALUES ($1, $2, 1, 'shop')
             ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = user_inventory.quantity + 1`,
            [req.user.id, item_id]
        );

        // Transaction record
        await client.query(
            'INSERT INTO coin_transactions (user_id, amount, type, description, reference_id) VALUES ($1, $2, $3, $4, $5)',
            [req.user.id, -i.price_coins, 'shop_purchase', `Купівля: ${i.name}`, item_id]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: `Куплено: ${i.name}`, item: i.name });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Buy error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// GET /api/inventory — my inventory
router.get('/inventory', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const inventoryColumns = await getTableColumns('user_inventory');
        const shopItemColumns = await getTableColumns('shop_items');
        const characterItemColumns = await getTableColumns('character_items');
        if (inventoryColumns.size === 0) return res.json([]);
        const useShopItems = inventoryColumns.has('user_id') && shopItemColumns.size > 0;
        if (!useShopItems && characterItemColumns.size === 0) return res.json([]);
        const itemTable = useShopItems ? 'shop_items' : 'character_items';
        const itemAlias = useShopItems ? 'si' : 'ci';
        if (!inventoryColumns.has('user_id') && !inventoryColumns.has('username')) return res.json([]);
        const ownerColumn = inventoryColumns.has('user_id') ? 'user_id' : 'username';
        const ownerValue = ownerColumn === 'user_id' ? req.user.id : req.user.username;
        const itemColumns = useShopItems ? shopItemColumns : characterItemColumns;
        const categorySql = useShopItems
            ? columnSql(itemColumns, itemAlias, 'category', "'item'")
            : columnSql(itemColumns, itemAlias, 'type', "'item'");
        const equipSlotSql = useShopItems
            ? columnSql(itemColumns, itemAlias, 'equip_slot', 'NULL')
            : columnSql(itemColumns, itemAlias, 'type', 'NULL');
        const result = await pool.query(`
            SELECT ui.id,
                   ui.item_id,
                   ${columnSql(inventoryColumns, 'ui', 'acquired_via', columnSql(inventoryColumns, 'ui', 'obtained_from', 'NULL'))} AS acquired_via,
                   ${columnSql(inventoryColumns, 'ui', 'acquired_at', 'NULL')} AS acquired_at,
                   ${columnSql(itemColumns, itemAlias, 'code', 'NULL')} AS code,
                   ${columnSql(itemColumns, itemAlias, 'name', "'Item'")} AS name,
                   ${columnSql(itemColumns, itemAlias, 'description', "''")} AS description,
                   ${categorySql} AS category,
                   ${columnSql(itemColumns, itemAlias, 'rarity', "'common'")} AS rarity,
                   ${equipSlotSql} AS equip_slot,
                   ${columnSql(itemColumns, itemAlias, 'icon', "''")} AS icon
            FROM user_inventory ui
            JOIN ${itemTable} ${itemAlias} ON ${itemAlias}.id = ui.item_id
            WHERE ui.${ownerColumn} = $1
            ORDER BY category, name
        `, [ownerValue]);

        res.json(result.rows.map(r => ({
            id: r.id, itemId: r.item_id, code: r.code, name: r.name,
            description: r.description, category: r.category, icon: r.icon,
            rarity: r.rarity, equipSlot: r.equip_slot,
            acquiredVia: r.acquired_via, acquiredAt: r.acquired_at
        })));
    } catch (err) {
        log.error('Get inventory error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/profile/equip — equip item
router.put('/profile/equip', requireRole(...ANY_ROLE), async (req, res) => {
    const { item_id, slot } = req.body;
    if (!item_id || !slot) return res.status(400).json({ error: 'item_id та slot обов\'язкові' });

    const validSlots = ['background', 'head', 'body', 'hand', 'frame', 'effect'];
    if (!validSlots.includes(slot)) return res.status(400).json({ error: 'Невірний слот' });

    try {
        // Verify ownership
        const inv = await pool.query(
            'SELECT * FROM user_inventory WHERE user_id = $1 AND item_id = $2',
            [req.user.id, item_id]
        );
        if (inv.rows.length === 0) return res.status(404).json({ error: 'Предмет не у вашому інвентарі' });

        // Verify slot matches
        const item = await pool.query('SELECT equip_slot FROM shop_items WHERE id = $1', [item_id]);
        if (item.rows[0].equip_slot !== slot) return res.status(400).json({ error: 'Невірний слот для цього предмету' });

        // Unequip current item in slot
        const slotCol = `equipped_${slot}`;
        await pool.query(
            `UPDATE user_inventory SET is_equipped = false
             WHERE user_id = $1 AND item_id = (SELECT ${slotCol} FROM user_profiles_extended WHERE user_id = $1)`,
            [req.user.id]
        );

        // Equip new item
        await pool.query('UPDATE user_inventory SET is_equipped = true WHERE user_id = $1 AND item_id = $2', [req.user.id, item_id]);
        await pool.query(
            `INSERT INTO user_profiles_extended (user_id, ${slotCol}) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET ${slotCol} = $2, updated_at = NOW()`,
            [req.user.id, item_id]
        );

        res.json({ success: true });
    } catch (err) {
        log.error('Equip error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/profile/unequip — unequip slot
router.put('/profile/unequip', requireRole(...ANY_ROLE), async (req, res) => {
    const { slot } = req.body;
    const validSlots = ['background', 'head', 'body', 'hand', 'frame', 'effect'];
    if (!slot || !validSlots.includes(slot)) return res.status(400).json({ error: 'Невірний слот' });

    try {
        const slotCol = `equipped_${slot}`;
        // Unequip in inventory
        await pool.query(
            `UPDATE user_inventory SET is_equipped = false
             WHERE user_id = $1 AND item_id = (SELECT ${slotCol} FROM user_profiles_extended WHERE user_id = $1)`,
            [req.user.id]
        );
        // Clear profile slot
        await pool.query(
            `UPDATE user_profiles_extended SET ${slotCol} = NULL, updated_at = NOW() WHERE user_id = $1`,
            [req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('Unequip error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/profile/:id — user profile with equipped items
router.get('/profile/:id', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const [user, profile, achievements, inventory] = await Promise.all([
            pool.query('SELECT id, username, name, role FROM users WHERE id = $1', [userId]),
            pool.query('SELECT * FROM user_profiles_extended WHERE user_id = $1', [userId]),
            pool.query(`
                SELECT a.icon, a.name, a.rarity FROM user_achievements ua
                JOIN achievements a ON a.id = ua.achievement_id
                WHERE ua.user_id = $1 AND ua.completed = true
                ORDER BY a.rarity DESC LIMIT 20
            `, [userId]),
            pool.query(`
                SELECT si.* FROM user_inventory ui
                JOIN shop_items si ON si.id = ui.item_id
                WHERE ui.user_id = $1 AND ui.is_equipped = true
            `, [userId])
        ]);

        if (user.rows.length === 0) return res.status(404).json({ error: 'Не знайдено' });

        const wallet = await pool.query('SELECT coins FROM game_wallets WHERE user_id = $1', [userId]);

        // Increment profile views (don't count self)
        if (userId !== req.user.id) {
            await pool.query(
                'UPDATE user_profiles_extended SET profile_views = profile_views + 1 WHERE user_id = $1',
                [userId]
            ).catch(() => {});
        }

        const u = user.rows[0];
        const p = profile.rows[0] || {};
        const equipped = {};
        for (const item of inventory.rows) {
            equipped[item.equip_slot] = {
                id: item.id, code: item.code, name: item.name,
                imageUrl: item.image_url, rarity: item.rarity
            };
        }

        res.json({
            id: u.id, username: u.username, displayName: u.name, role: u.role,
            bio: p.bio || '', hobbies: p.hobbies || [], avatarUrl: p.avatar_url,
            profileViews: p.profile_views || 0,
            coins: wallet.rows[0]?.coins || 0,
            equipped,
            achievements: achievements.rows.map(a => ({ icon: a.icon, name: a.name, rarity: a.rarity }))
        });
    } catch (err) {
        log.error('Get profile error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
