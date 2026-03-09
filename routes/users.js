/**
 * routes/users.js — User management (v20.1.0)
 * Creator + Director only: list users, change roles, reset passwords, deactivate
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireRole, ROLE_HIERARCHY, PAGE_ACCESS, ACTION_PERMISSIONS } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Users');

// GET /api/users — list all users (creator + director only)
router.get('/', requireRole('creator', 'director'), async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, name, role, is_active, created_at FROM users ORDER BY id'
        );
        res.json(result.rows);
    } catch (err) {
        log.error('List users error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/users/roles — return role definitions and access matrix
router.get('/roles', async (req, res) => {
    res.json({
        hierarchy: ROLE_HIERARCHY,
        pageAccess: PAGE_ACCESS,
        actionPermissions: ACTION_PERMISSIONS
    });
});

// PATCH /api/users/:id/role — change user role (creator + director only)
router.patch('/:id/role', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!role || !ROLE_HIERARCHY.includes(role)) {
            return res.status(400).json({ error: `Невалідна роль. Допустимі: ${ROLE_HIERARCHY.join(', ')}` });
        }

        // Cannot change own role (safety)
        const target = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [parseInt(id)]);
        if (target.rows.length === 0) return res.status(404).json({ error: 'Користувача не знайдено' });

        if (target.rows[0].id === req.user.id) {
            return res.status(400).json({ error: 'Не можна змінити власну роль' });
        }

        // Director cannot set creator role
        if (req.user.role === 'director' && role === 'creator') {
            return res.status(403).json({ error: 'Тільки creator може призначити creator' });
        }

        const oldRole = target.rows[0].role;
        await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, parseInt(id)]);

        log.info(`User ${req.user.username} changed role of ${target.rows[0].username}: ${oldRole} → ${role}`);
        res.json({ success: true, username: target.rows[0].username, oldRole, newRole: role });
    } catch (err) {
        log.error('Change role error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/users/:id/reset-password — reset password (creator + director only)
router.post('/:id/reset-password', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: 'Пароль має бути не менше 6 символів' });
        }

        const target = await pool.query('SELECT id, username FROM users WHERE id = $1', [parseInt(id)]);
        if (target.rows.length === 0) return res.status(404).json({ error: 'Користувача не знайдено' });

        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, parseInt(id)]);

        log.info(`User ${req.user.username} reset password for ${target.rows[0].username}`);
        res.json({ success: true, username: target.rows[0].username });
    } catch (err) {
        log.error('Reset password error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/users/:id/active — activate/deactivate user (creator + director only)
router.patch('/:id/active', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        const target = await pool.query('SELECT id, username FROM users WHERE id = $1', [parseInt(id)]);
        if (target.rows.length === 0) return res.status(404).json({ error: 'Користувача не знайдено' });

        if (target.rows[0].id === req.user.id) {
            return res.status(400).json({ error: 'Не можна деактивувати себе' });
        }

        await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [!!isActive, parseInt(id)]);

        log.info(`User ${req.user.username} ${isActive ? 'activated' : 'deactivated'} ${target.rows[0].username}`);
        res.json({ success: true, username: target.rows[0].username, isActive: !!isActive });
    } catch (err) {
        log.error('Toggle active error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/users — create new user (creator + director only)
router.post('/', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { username, password, name, role } = req.body;

        if (!username || !password || !name) {
            return res.status(400).json({ error: 'username, password, name обов\'язкові' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Пароль має бути не менше 6 символів' });
        }
        if (role && !ROLE_HIERARCHY.includes(role)) {
            return res.status(400).json({ error: `Невалідна роль. Допустимі: ${ROLE_HIERARCHY.join(', ')}` });
        }

        // Director cannot create creator
        if (req.user.role === 'director' && role === 'creator') {
            return res.status(403).json({ error: 'Тільки creator може створити creator' });
        }

        const existing = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Користувач з таким username вже існує' });
        }

        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, name, role',
            [username.trim(), hash, name.trim(), role || 'admin']
        );

        log.info(`User ${req.user.username} created user ${username} (role: ${role || 'admin'})`);
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        log.error('Create user error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
