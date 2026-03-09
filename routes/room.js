/**
 * routes/room.js — Visual Room API
 * v22.5.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Room');

const ANY_ROLE = ['admin', 'user', 'animator', 'instructor', 'waiter', 'senior_instructor', 'manager', 'senior_manager', 'vice_director', 'director', 'creator'];

// GET /api/room — my room (auto-create)
router.get('/', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        let room = await pool.query('SELECT * FROM user_rooms WHERE user_id = $1', [req.user.id]);
        if (room.rows.length === 0) {
            await pool.query('INSERT INTO user_rooms (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [req.user.id]);
            room = await pool.query('SELECT * FROM user_rooms WHERE user_id = $1', [req.user.id]);
        }

        const r = room.rows[0];
        const [wallpaper, floor, inventory] = await Promise.all([
            r.wallpaper_item_id ? pool.query('SELECT code, name, rarity FROM shop_items WHERE id = $1', [r.wallpaper_item_id]) : { rows: [] },
            r.floor_item_id ? pool.query('SELECT code, name, rarity FROM shop_items WHERE id = $1', [r.floor_item_id]) : { rows: [] },
            pool.query(`
                SELECT ui.item_id, si.code, si.name, si.category, si.rarity, si.equip_slot
                FROM user_inventory ui
                JOIN shop_items si ON si.id = ui.item_id
                WHERE ui.user_id = $1 AND si.category = 'furniture'
            `, [req.user.id])
        ]);

        res.json({
            userId: r.user_id,
            wallpaper: wallpaper.rows[0] || null,
            floor: floor.rows[0] || null,
            layout: r.layout || {},
            mood: r.mood,
            visitorCount: r.visitor_count,
            furniture: inventory.rows.map(i => ({
                itemId: i.item_id, code: i.code, name: i.name, rarity: i.rarity
            }))
        });
    } catch (err) {
        log.error('Get room error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/room/:userId — visit another user's room
router.get('/:userId', requireRole(...ANY_ROLE), async (req, res) => {
    const userId = parseInt(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'Невірний userId' });

    try {
        const room = await pool.query('SELECT * FROM user_rooms WHERE user_id = $1', [userId]);
        if (room.rows.length === 0) return res.status(404).json({ error: 'Кімната не знайдена' });

        const r = room.rows[0];
        const [wallpaper, floor, inventory, owner] = await Promise.all([
            r.wallpaper_item_id ? pool.query('SELECT code, name, rarity FROM shop_items WHERE id = $1', [r.wallpaper_item_id]) : { rows: [] },
            r.floor_item_id ? pool.query('SELECT code, name, rarity FROM shop_items WHERE id = $1', [r.floor_item_id]) : { rows: [] },
            pool.query(`
                SELECT ui.item_id, si.code, si.name, si.category, si.rarity
                FROM user_inventory ui
                JOIN shop_items si ON si.id = ui.item_id
                WHERE ui.user_id = $1 AND si.category = 'furniture'
            `, [userId]),
            pool.query('SELECT id, name, username FROM users WHERE id = $1', [userId])
        ]);

        // Record visit (don't count self-visits)
        if (userId !== req.user.id) {
            await pool.query(
                'INSERT INTO room_visits (room_user_id, visitor_user_id) VALUES ($1, $2)',
                [userId, req.user.id]
            ).catch(() => {});
            await pool.query(
                'UPDATE user_rooms SET visitor_count = visitor_count + 1 WHERE user_id = $1',
                [userId]
            ).catch(() => {});
        }

        const o = owner.rows[0] || {};
        res.json({
            userId,
            ownerName: o.name || o.username,
            wallpaper: wallpaper.rows[0] || null,
            floor: floor.rows[0] || null,
            layout: r.layout || {},
            mood: r.mood,
            visitorCount: r.visitor_count + (userId !== req.user.id ? 1 : 0),
            furniture: inventory.rows.map(i => ({
                itemId: i.item_id, code: i.code, name: i.name, rarity: i.rarity
            }))
        });
    } catch (err) {
        log.error('Visit room error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/room/decorate — change wallpaper, floor, or layout
router.put('/decorate', requireRole(...ANY_ROLE), async (req, res) => {
    const { wallpaper_item_id, floor_item_id, layout, mood } = req.body;

    try {
        // Verify ownership of items
        if (wallpaper_item_id) {
            const owned = await pool.query(
                'SELECT 1 FROM user_inventory WHERE user_id = $1 AND item_id = $2',
                [req.user.id, wallpaper_item_id]
            );
            if (owned.rows.length === 0) return res.status(400).json({ error: 'Шпалери не у вашому інвентарі' });
        }
        if (floor_item_id) {
            const owned = await pool.query(
                'SELECT 1 FROM user_inventory WHERE user_id = $1 AND item_id = $2',
                [req.user.id, floor_item_id]
            );
            if (owned.rows.length === 0) return res.status(400).json({ error: 'Підлога не у вашому інвентарі' });
        }

        const updates = [];
        const values = [];
        let idx = 1;

        if (wallpaper_item_id !== undefined) { updates.push(`wallpaper_item_id = $${idx++}`); values.push(wallpaper_item_id); }
        if (floor_item_id !== undefined) { updates.push(`floor_item_id = $${idx++}`); values.push(floor_item_id); }
        if (layout !== undefined) { updates.push(`layout = $${idx++}`); values.push(JSON.stringify(layout)); }
        if (mood) {
            const validMoods = ['happy', 'working', 'tired', 'excited', 'chill'];
            if (validMoods.includes(mood)) { updates.push(`mood = $${idx++}`); values.push(mood); }
        }

        if (updates.length === 0) return res.status(400).json({ error: 'Нічого не змінено' });

        updates.push(`updated_at = NOW()`);
        values.push(req.user.id);

        await pool.query(
            `INSERT INTO user_rooms (user_id) VALUES ($${idx}) ON CONFLICT (user_id) DO NOTHING`,
            [req.user.id]
        );
        await pool.query(
            `UPDATE user_rooms SET ${updates.join(', ')} WHERE user_id = $${idx}`,
            values
        );

        res.json({ success: true });
    } catch (err) {
        log.error('Decorate room error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/room/move — move furniture item to grid position
router.put('/move', requireRole(...ANY_ROLE), async (req, res) => {
    const { item_id, row, col } = req.body;
    if (item_id === undefined || row === undefined || col === undefined) {
        return res.status(400).json({ error: 'item_id, row, col обов\'язкові' });
    }
    if (row < 0 || row > 5 || col < 0 || col > 7) {
        return res.status(400).json({ error: 'Позиція за межами кімнати (8x6)' });
    }

    try {
        // Verify ownership
        const owned = await pool.query(
            'SELECT 1 FROM user_inventory ui JOIN shop_items si ON si.id = ui.item_id WHERE ui.user_id = $1 AND ui.item_id = $2 AND si.category = $3',
            [req.user.id, item_id, 'furniture']
        );
        if (owned.rows.length === 0) return res.status(400).json({ error: 'Предмет не у вашому інвентарі' });

        // Update layout JSONB
        await pool.query(
            `UPDATE user_rooms SET layout = jsonb_set(COALESCE(layout, '{}'), $1, $2), updated_at = NOW() WHERE user_id = $3`,
            [`{${item_id}}`, JSON.stringify({ row, col }), req.user.id]
        );

        res.json({ success: true });
    } catch (err) {
        log.error('Move furniture error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/room/visitors/list — recent visitors
router.get('/visitors/list', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const visitors = await pool.query(`
            SELECT DISTINCT ON (rv.visitor_user_id)
                rv.visitor_user_id, u.name, u.username, rv.visited_at
            FROM room_visits rv
            JOIN users u ON u.id = rv.visitor_user_id
            WHERE rv.room_user_id = $1
            ORDER BY rv.visitor_user_id, rv.visited_at DESC
            LIMIT 20
        `, [req.user.id]);

        res.json(visitors.rows.map(v => ({
            userId: v.visitor_user_id,
            name: v.name || v.username,
            visitedAt: v.visited_at
        })));
    } catch (err) {
        log.error('Get visitors error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
