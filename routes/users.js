/**
 * routes/users.js — User management (v20.1.0)
 * Creator + Director only: list users, change roles, reset passwords, deactivate
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireRole, authenticateToken, ROLE_HIERARCHY, PAGE_ACCESS, ACTION_PERMISSIONS } = require('../middleware/auth'); 
const { createLogger } = require('../utils/logger');

const log = createLogger('Users');

const ACCOUNT_MANAGER_ROLES = ['creator', 'director', 'hr'];
const HR_PROTECTED_ROLES = ['creator', 'director', 'vice_director', 'senior_manager'];

function canToggleAccount(actor, target) {
    if (!actor || !target) return false;
    if (target.id === actor.id) return false;
    if (actor.role === 'hr' && HR_PROTECTED_ROLES.includes(target.role)) return false;
    return true;
}

// GET /api/users — list all users for account management (creator/director/hr)
// v39.8: Security — require authentication
router.use(authenticateToken);
router.get('/', requireRole(...ACCOUNT_MANAGER_ROLES), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.username, u.name, u.role, u.extra_roles, u.page_allowlist, u.is_active, u.created_at, u.last_seen_at,
                    ep.staff_id, ep.id AS profile_id, ep.full_name AS profile_name,
                    s.name AS staff_name, s.department AS staff_department, s.position AS staff_position
             FROM users u
             LEFT JOIN employee_profiles ep ON ep.user_id = u.id AND ep.is_active = true
             LEFT JOIN staff s ON s.id = ep.staff_id
             ORDER BY COALESCE(u.is_active, true) DESC, lower(COALESCE(NULLIF(u.name, ''), u.username)), u.id`
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
        rolePresets: {
            executive: ['creator', 'director', 'vice_director'],
            management: ['senior_manager', 'manager'],
            operations: ['admin', 'reception', 'security'],
            creative: ['art_director', 'marketer'],
            finance: ['accountant'],
            programs: ['senior_instructor', 'instructor', 'animator'],
            maysternyaDoli: ['director', 'manager', 'admin'],
            support: ['barista', 'wardrobe', 'cleaning', 'maintenance', 'dishwasher', 'waiter']
        },
        pageAccess: PAGE_ACCESS,
        actionPermissions: ACTION_PERMISSIONS
    });
});

// PATCH /api/users/:id/role — change user role (creator + director only)
router.patch('/:id/role', requireRole('creator', 'director'), async (req, res) => {
    try {
        const { id } = req.params;
        const { role, extraRoles, pageAllowlist } = req.body;

        if (!role || !ROLE_HIERARCHY.includes(role)) {
            return res.status(400).json({ error: `Невалідна роль. Допустимі: ${ROLE_HIERARCHY.join(', ')}` });
        }

        const normalizedExtraRoles = Array.isArray(extraRoles)
            ? Array.from(new Set(extraRoles.filter(item => ROLE_HIERARCHY.includes(item) && item !== role))).slice(0, 3)
            : null;
        const normalizedPageAllowlist = Array.isArray(pageAllowlist)
            ? Array.from(new Set(pageAllowlist.filter(item => typeof item === 'string' && item.startsWith('/')))).slice(0, 50)
            : null;

        // Cannot change own role (safety)
        const target = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [parseInt(id)]);
        if (target.rows.length === 0) return res.status(404).json({ error: 'Користувача не знайдено' });

        if (target.rows[0].id === req.user.id) {
            return res.status(400).json({ error: 'Не можна змінити власну роль' });
        }

        // Director cannot set creator role
        if (req.user.role === 'director' && (role === 'creator' || (normalizedExtraRoles || []).includes('creator'))) {
            return res.status(403).json({ error: 'Тільки creator може призначити creator' });
        }

        const oldRole = target.rows[0].role;
        await pool.query(
            `UPDATE users
             SET role = $1,
                 extra_roles = COALESCE($2::text[], extra_roles),
                 page_allowlist = COALESCE($3::text[], page_allowlist)
             WHERE id = $4`,
            [role, normalizedExtraRoles, normalizedPageAllowlist, parseInt(id)]
        );

        log.info(`User ${req.user.username} changed role of ${target.rows[0].username}: ${oldRole} → ${role}`);
        res.json({ success: true, username: target.rows[0].username, oldRole, newRole: role, extraRoles: normalizedExtraRoles, pageAllowlist: normalizedPageAllowlist });
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

// PATCH /api/users/:id/active — activate/deactivate user (creator/director/hr, guarded)
router.patch('/:id/active', requireRole(...ACCOUNT_MANAGER_ROLES), async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        const target = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [parseInt(id)]);
        if (target.rows.length === 0) return res.status(404).json({ error: 'Користувача не знайдено' });

        if (!canToggleAccount(req.user, target.rows[0])) {
            return res.status(400).json({ error: 'Цей акаунт не можна змінити з поточного рівня доступу' });
        }

        await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [!!isActive, parseInt(id)]);
        if (!isActive) {
            await pool.query('UPDATE employee_profiles SET is_active = false WHERE user_id = $1', [parseInt(id)]);
        } else {
            await pool.query('UPDATE employee_profiles SET is_active = true WHERE user_id = $1 AND staff_id IS NOT NULL', [parseInt(id)]);
        }

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
        const { username, password, name, role, extraRoles, pageAllowlist } = req.body;

        if (!username || !password || !name) {
            return res.status(400).json({ error: 'username, password, name обов\'язкові' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Пароль має бути не менше 6 символів' });
        }
        if (role && !ROLE_HIERARCHY.includes(role)) {
            return res.status(400).json({ error: `Невалідна роль. Допустимі: ${ROLE_HIERARCHY.join(', ')}` });
        }

        const primaryRole = role || 'admin';
        const normalizedExtraRoles = Array.isArray(extraRoles)
            ? Array.from(new Set(extraRoles.filter(item => ROLE_HIERARCHY.includes(item) && item !== primaryRole))).slice(0, 3)
            : [];
        const normalizedPageAllowlist = Array.isArray(pageAllowlist)
            ? Array.from(new Set(pageAllowlist.filter(item => typeof item === 'string' && item.startsWith('/')))).slice(0, 50)
            : [];

        // Director cannot create creator
        if (req.user.role === 'director' && (primaryRole === 'creator' || normalizedExtraRoles.includes('creator'))) {
            return res.status(403).json({ error: 'Тільки creator може створити creator' });
        }

        const existing = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username.trim()]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Користувач з таким username вже існує' });
        }

        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, name, role, extra_roles, page_allowlist) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, name, role, extra_roles, page_allowlist',
            [username.trim(), hash, name.trim(), primaryRole, normalizedExtraRoles, normalizedPageAllowlist]
        );

        log.info(`User ${req.user.username} created user ${username} (role: ${primaryRole})`);

        // Auto-add new user to default chat channels
        try {
            const newUserId = result.rows[0].id;
            const defaultChannels = await pool.query(
                'SELECT id FROM chat_channels WHERE is_default = true'
            );
            for (const ch of defaultChannels.rows) {
                await pool.query(
                    'INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [ch.id, newUserId]
                );
            }
        } catch (e) { /* non-critical */ }

        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        log.error('Create user error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
