/**
 * routes/employees.js — Employee Mapping API (v19.0)
 * Unified identity: user ↔ staff ↔ telegram ↔ role ↔ access
 */
const router = require('express').Router();
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { linkUserToStaffProfile, unlinkStaffAccount } = require('../services/accountLinking');

const { requireAction, requireRole, canUseAction, ROLE_LEVEL } = require('../middleware/auth');
const log = createLogger('Employees');

// RBAC: Employee management — management + HR only
router.use(requireRole('creator', 'director', 'vice_director', 'senior_manager', 'hr'));

const ACCOUNT_MANAGER_PRIMARY_ROLES = new Set(['creator', 'director']);

function roleLevel(role) {
    return ROLE_LEVEL[String(role || '').trim()] ?? -1;
}

function normalizeAccountRoleSet(...roleLists) {
    const roles = [];
    roleLists.flat().forEach(role => {
        if (typeof role !== 'string') return;
        const value = role.trim();
        if (value && !roles.includes(value)) roles.push(value);
    });
    return roles;
}

function accountMaxRoleLevel(account = {}) {
    return normalizeAccountRoleSet([account.role], account.extra_roles, account.extraRoles)
        .reduce((max, role) => Math.max(max, roleLevel(role)), -1);
}

function canActorManageAccount(actor, account) {
    if (!actor || !account || !ACCOUNT_MANAGER_PRIMARY_ROLES.has(actor.role)) return false;
    if (actor.role === 'creator') return true;
    return accountMaxRoleLevel(account) < roleLevel('director');
}

function hasAccountLinkValue(value) {
    return value !== undefined && value !== null && value !== '';
}

function accountManagementError(message, statusCode = 403) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function ensureManageAccounts(actor) {
    if (!canUseAction(actor, 'manage_accounts')) {
        throw accountManagementError('Account link changes require manage_accounts permission');
    }
}

async function getAccountForManagement(client, userId) {
    const result = await client.query(
        'SELECT id, username, name, role, extra_roles FROM users WHERE id = $1 FOR UPDATE',
        [userId]
    );
    if (!result.rows.length) throw accountManagementError('Account not found', 404);
    return result.rows[0];
}

async function ensureActorCanManageAccountId(client, actor, userId) {
    if (!hasAccountLinkValue(userId)) return null;
    ensureManageAccounts(actor);
    const account = await getAccountForManagement(client, userId);
    if (!canActorManageAccount(actor, account)) {
        throw accountManagementError('Insufficient account-management permissions for this account');
    }
    return account;
}

// GET /api/employees — list all employee profiles
router.get('/', async (req, res) => {
    try {
        const { department, active } = req.query;
        let query = `SELECT ep.*,
            u.username, u.role as user_role,
            s.position, s.hire_date, s.color as staff_color
         FROM employee_profiles ep
         LEFT JOIN users u ON ep.user_id = u.id
         LEFT JOIN staff s ON ep.staff_id = s.id`;
        const conditions = [];
        const params = [];
        if (department) { params.push(department); conditions.push(`ep.department = $${params.length}`); }
        if (active !== undefined) { params.push(active === 'true'); conditions.push(`ep.is_active = $${params.length}`); }
        if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY ep.full_name';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        log.error('List employees error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/employees — create profile (link user + staff + telegram)
router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        const { user_id, staff_id, telegram_chat_id, telegram_username, full_name, email, phone, role, department, access_modules, permissions } = req.body;
        if (!full_name || !full_name.trim()) {
            return res.status(400).json({ error: 'Повне ім\'я обов\'язкове' });
        }

        await client.query('BEGIN');
        let profileId = null;
        if (hasAccountLinkValue(user_id)) {
            await ensureActorCanManageAccountId(client, req.user, user_id);
        }
        if (user_id && staff_id) {
            const link = await linkUserToStaffProfile(client, {
                userId: user_id,
                staffId: staff_id,
                actor: req.user,
                req,
                eventType: 'employee_profile_account_linked',
                details: { source: 'employees_create' }
            });
            profileId = link.profile.id;
        }

        const result = profileId
            ? await client.query(
                `UPDATE employee_profiles
                 SET telegram_chat_id=$1, telegram_username=$2, full_name=$3, email=$4, phone=$5,
                     role=$6, department=$7, access_modules=$8, permissions=$9, is_active=true
                 WHERE id=$10 RETURNING *`,
                [telegram_chat_id || null, telegram_username || null, full_name.trim(), email || null, phone || null,
                 role || 'employee', department || null, JSON.stringify(access_modules || []), JSON.stringify(permissions || {}), profileId]
            )
            : await client.query(
                `INSERT INTO employee_profiles (user_id, staff_id, telegram_chat_id, telegram_username, full_name, email, phone, role, department, access_modules, permissions)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
                [user_id || null, staff_id || null, telegram_chat_id || null,
                 telegram_username || null, full_name.trim(), email || null, phone || null,
                 role || 'employee', department || null,
                 JSON.stringify(access_modules || []), JSON.stringify(permissions || {})]
            );
        await client.query('COMMIT');

        log.info(`Employee profile created: ${full_name} (id: ${result.rows[0].id})`);
        res.json({ success: true, employee: result.rows[0] });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('Create employee error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    } finally {
        client.release();
    }
});

// PUT /api/employees/:id — update profile
router.put('/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { user_id, staff_id, telegram_chat_id, telegram_username, full_name, email, phone, role, department, access_modules, permissions, is_active } = req.body;

        await client.query('BEGIN');
        const current = await client.query('SELECT id, user_id, staff_id FROM employee_profiles WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (current.rows.length && hasAccountLinkValue(user_id)) {
            await ensureActorCanManageAccountId(client, req.user, user_id);
        } else if (current.rows.length && current.rows[0].user_id && current.rows[0].staff_id) {
            await ensureActorCanManageAccountId(client, req.user, current.rows[0].user_id);
        }
        if (current.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Профіль не знайдено' });
        }

        if (user_id && staff_id) {
            const link = await linkUserToStaffProfile(client, {
                userId: user_id,
                staffId: staff_id,
                actor: req.user,
                req,
                eventType: 'employee_profile_account_linked',
                details: { source: 'employees_update', profileId: req.params.id }
            });
            if (Number(link.profile.id) !== Number(req.params.id)) {
                throw Object.assign(new Error('Цей staff/account звʼязок належить іншому employee profile'), { statusCode: 409 });
            }
        } else if (!user_id && current.rows[0].user_id && current.rows[0].staff_id) {
            await unlinkStaffAccount(client, {
                staffId: current.rows[0].staff_id,
                actor: req.user,
                req,
                eventType: 'employee_profile_account_unlinked',
                details: { source: 'employees_update', profileId: req.params.id }
            });
        }

        const result = await client.query(
            `UPDATE employee_profiles SET
                user_id=$1, staff_id=$2, telegram_chat_id=$3, telegram_username=$4,
                full_name=$5, email=$6, phone=$7, role=$8, department=$9,
                access_modules=$10, permissions=$11, is_active=$12
             WHERE id=$13 RETURNING *`,
            [user_id || null, staff_id || null, telegram_chat_id || null,
             telegram_username || null, full_name, email || null, phone || null,
             role || 'employee', department || null,
             JSON.stringify(access_modules || []), JSON.stringify(permissions || {}),
             is_active !== false, req.params.id]
        );

        await client.query('COMMIT');
        log.info(`Employee profile updated: ${full_name} (id: ${req.params.id})`);
        res.json({ success: true, employee: result.rows[0] });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('Update employee error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    } finally {
        client.release();
    }
});

// GET /api/employees/overview — mapping stats (MUST be before /:id)
router.get('/overview', async (req, res) => {
    try {
        const [profiles, unlinked] = await Promise.all([
            pool.query(`SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_active) as active,
                COUNT(*) FILTER (WHERE user_id IS NOT NULL) as linked_users,
                COUNT(*) FILTER (WHERE staff_id IS NOT NULL) as linked_staff,
                COUNT(*) FILTER (WHERE telegram_chat_id IS NOT NULL) as linked_telegram
             FROM employee_profiles`),
            pool.query(`SELECT
                (SELECT COUNT(*) FROM users u WHERE u.id NOT IN (SELECT user_id FROM employee_profiles WHERE user_id IS NOT NULL)) as unlinked_users,
                (SELECT COUNT(*) FROM staff s WHERE s.is_active AND s.id NOT IN (SELECT staff_id FROM employee_profiles WHERE staff_id IS NOT NULL)) as unlinked_staff`)
        ]);
        res.json({ profiles: profiles.rows[0], unlinked: unlinked.rows[0] });
    } catch (err) {
        log.error('Overview error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/employees/:id — single profile
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ep.*,
                u.username, u.role as user_role,
                s.position, s.hire_date, s.color as staff_color, s.department as staff_department
             FROM employee_profiles ep
             LEFT JOIN users u ON ep.user_id = u.id
             LEFT JOIN staff s ON ep.staff_id = s.id
             WHERE ep.id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Профіль не знайдено' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Get employee error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/employees/auto-link — auto-create profiles from existing users/staff
router.post('/auto-link', requireAction('manage_accounts'), async (req, res) => {
    try {
        // Find staff without profiles
        const unlinkedStaff = await pool.query(
            `SELECT s.* FROM staff s
             LEFT JOIN employee_profiles ep ON ep.staff_id = s.id
             WHERE ep.id IS NULL AND s.is_active = true`
        );

        let created = 0;
        for (const staff of unlinkedStaff.rows) {
            // Try to find matching user by name
            const matchingUser = await pool.query(
                `SELECT id FROM users WHERE name ILIKE $1 AND id NOT IN (SELECT user_id FROM employee_profiles WHERE user_id IS NOT NULL)`,
                [staff.name]
            );

            await pool.query(
                `INSERT INTO employee_profiles (staff_id, user_id, full_name, phone, department, telegram_username, role)
                 VALUES ($1, $2, $3, $4, $5, $6, 'employee')
                 ON CONFLICT DO NOTHING`,
                [staff.id, matchingUser.rows[0]?.id || null, staff.name, staff.phone || null,
                 staff.department || null, staff.telegram_username || null]
            );
            created++;
        }

        log.info(`Auto-link: ${created} profiles created from ${unlinkedStaff.rows.length} unlinked staff`);
        res.json({ success: true, created, total_unlinked: unlinkedStaff.rows.length });
    } catch (err) {
        log.error('Auto-link error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
