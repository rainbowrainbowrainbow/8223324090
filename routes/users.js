/**
 * routes/users.js — User management (v20.1.0)
 * Creator + Director only: list users, change roles, reset passwords, deactivate
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireRole, authenticateToken, ROLE_HIERARCHY, PAGE_ACCESS, ACTION_PERMISSIONS, revokeAllUserTokens } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const { recordAccountSecurityEvent } = require('../services/accountSecurity');
const {
    linkUserToStaffProfile,
    unlinkUserFromStaffProfiles,
    getAccountLinkConflicts,
    generateOneTimePassword,
    oneTimeCredential,
    verifyIssuedCredential
} = require('../services/accountLinking');

const log = createLogger('Users');

const ACCOUNT_MANAGER_ROLES = ['creator', 'director', 'hr'];
const HR_PROTECTED_ROLES = ['creator', 'director', 'vice_director', 'senior_manager'];

function canToggleAccount(actor, target) {
    if (!actor || !target) return false;
    if (target.id === actor.id) return false;
    if (actor.role !== 'creator' && target.role === 'creator') return false;
    if (actor.role === 'hr' && HR_PROTECTED_ROLES.includes(target.role)) return false;
    return true;
}

function canMutateSensitiveAccount(actor, target) {
    if (!actor || !target) return false;
    if (actor.role !== 'creator' && target.role === 'creator') return false;
    return true;
}

function normalizeUsername(value) {
    return String(value || '').trim();
}

function normalizeStaffId(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
}

function resetPasswordFromPayload(body = {}) {
    const candidates = [body.newPassword, body.password, body.manualPassword];
    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        const value = String(candidate);
        if (value.length > 0) return value;
    }
    return '';
}

function truthyResetFlag(value) {
    return value === true || value === 'true' || value === '1' || value === 1;
}

function shouldActivateAfterPasswordReset(body = {}) {
    return truthyResetFlag(body.activateOnReset) || truthyResetFlag(body.activate) || truthyResetFlag(body.reactivate);
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

// GET /api/users/staff-options — staff profiles available for account linking
router.get('/staff-options', requireRole('creator', 'director'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.id, s.name, s.department, s.position,
                    ep.user_id AS linked_user_id,
                    u.username AS linked_username
             FROM staff s
             LEFT JOIN employee_profiles ep ON ep.staff_id = s.id AND ep.is_active = true
             LEFT JOIN users u ON u.id = ep.user_id
             WHERE COALESCE(s.is_active, true) = true
             ORDER BY s.department, lower(s.name), s.id`
        );
        res.json({ success: true, staff: result.rows });
    } catch (err) {
        log.error('List staff options error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/users/link-conflicts — account/person/staff linkage health summary
router.get('/link-conflicts', requireRole(...ACCOUNT_MANAGER_ROLES), async (req, res) => {
    try {
        const result = await getAccountLinkConflicts({ limit: req.query.limit || 25 });
        res.json({
            success: true,
            ...result,
            canonical: {
                accountTruth: 'users',
                bridgeTruth: 'employee_profiles',
                staffTruth: 'staff'
            }
        });
    } catch (err) {
        log.error('Account link conflict report error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/users/:id/profile — edit account identity and HR staff binding
router.patch('/:id/profile', requireRole('creator', 'director'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { name } = req.body;
        const username = normalizeUsername(req.body.username);
        const staffId = normalizeStaffId(req.body.staffId);

        if (!username || !name || !String(name).trim()) {
            return res.status(400).json({ error: 'Логін та імʼя обовʼязкові' });
        }
        if (username.length < 3 || username.length > 50 || !/^[a-zA-Z0-9._-]+$/.test(username)) {
            return res.status(400).json({ error: 'Логін має містити 3-50 символів: латиниця, цифри, крапка, дефіс або підкреслення' });
        }
        if (Number.isNaN(staffId)) {
            return res.status(400).json({ error: 'Некоректний staff-профіль' });
        }

        await client.query('BEGIN');
        const target = await client.query('SELECT id, username, role FROM users WHERE id = $1 FOR UPDATE', [parseInt(id, 10)]);
        if (target.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Користувача не знайдено' });
        }
        if (!canMutateSensitiveAccount(req.user, target.rows[0])) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Цей акаунт не можна редагувати з поточного рівня доступу' });
        }
        if (target.rows[0].id === req.user.id && username.toLowerCase() !== target.rows[0].username.toLowerCase()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Не можна змінити власний логін з цього меню' });
        }

        const duplicate = await client.query(
            'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2 LIMIT 1',
            [username, parseInt(id, 10)]
        );
        if (duplicate.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Користувач з таким username вже існує' });
        }

        const updated = await client.query(
            `UPDATE users
             SET username = $1,
                 name = $2
             WHERE id = $3
             RETURNING id, username, name, role, extra_roles, page_allowlist, is_active`,
            [username, String(name).trim(), parseInt(id, 10)]
        );

        const staffLink = staffId
            ? await linkUserToStaffProfile(client, {
                userId: parseInt(id, 10),
                staffId,
                actor: req.user,
                req,
                eventType: 'account_profile_staff_linked',
                details: { source: 'users_profile_editor' }
            })
            : await unlinkUserFromStaffProfiles(client, {
                userId: parseInt(id, 10),
                actor: req.user,
                req,
                eventType: 'account_profile_staff_unlinked',
                details: { source: 'users_profile_editor' }
            });
        await recordAccountSecurityEvent({
            actor: req.user,
            target: target.rows[0],
            eventType: 'account_profile_updated',
            reason: 'account_management',
            details: {
                changedUsername: username.toLowerCase() !== target.rows[0].username.toLowerCase(),
                staffLinked: !!staffId
            },
            req,
            client
        });
        await client.query('COMMIT');

        log.info(`User ${req.user.username} updated account profile for ${target.rows[0].username}`);
        res.json({ success: true, user: updated.rows[0], staff: staffLink?.staff || null, link: staffLink || null });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('Update account profile error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    } finally {
        client.release();
    }
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

        await recordAccountSecurityEvent({
            actor: req.user,
            target: target.rows[0],
            eventType: 'account_roles_updated',
            reason: 'account_management',
            details: { oldRole, newRole: role, extraRoles: normalizedExtraRoles, pageAllowlistChanged: normalizedPageAllowlist !== null },
            req
        });

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
        const manualPassword = resetPasswordFromPayload(req.body || {});
        const issueOneTime = req.body?.issueOneTime === true || req.body?.generate === true;
        const activateOnReset = shouldActivateAfterPasswordReset(req.body || {});

        if (!manualPassword && !issueOneTime) {
            return res.status(400).json({ error: 'Потрібен новий пароль або one-time reissue' });
        }
        const finalPassword = issueOneTime ? generateOneTimePassword() : manualPassword;
        if (finalPassword.length < 6) {
            return res.status(400).json({ error: 'Пароль має бути не менше 6 символів' });
        }

        const target = await pool.query('SELECT id, username, name, role, is_active, login_aliases FROM users WHERE id = $1', [parseInt(id)]);
        if (target.rows.length === 0) return res.status(404).json({ error: 'Користувача не знайдено' });
        if (!canMutateSensitiveAccount(req.user, target.rows[0])) {
            return res.status(403).json({ error: 'Цей акаунт не можна змінити з поточного рівня доступу' });
        }
        if (activateOnReset && target.rows[0].is_active === false && !canToggleAccount(req.user, target.rows[0])) {
            return res.status(403).json({ error: 'Цей акаунт не можна активувати з поточного рівня доступу' });
        }

        const hash = await bcrypt.hash(finalPassword, 10);
        const hashVerified = await bcrypt.compare(finalPassword, hash);
        if (!hashVerified) {
            throw new Error('password_hash_verified_after_reset_failed');
        }
        const updated = await pool.query(
            `UPDATE users
             SET password_hash = $1,
                 password_changed_at = NOW(),
                 session_revoked_at = NOW(),
                 is_active = CASE WHEN $3::boolean THEN true ELSE is_active END
             WHERE id = $2
             RETURNING id, username, is_active, password_changed_at, session_revoked_at`,
            [hash, parseInt(id), activateOnReset]
        );
        const activatedByReset = activateOnReset && target.rows[0].is_active === false && updated.rows[0]?.is_active !== false;
        if (activatedByReset) {
            try {
                await pool.query('UPDATE employee_profiles SET is_active = true WHERE user_id = $1 AND staff_id IS NOT NULL', [parseInt(id)]);
            } catch (linkErr) {
                log.warn(`Password reset activated ${target.rows[0].username}, but staff profile activation failed: ${linkErr.message}`);
            }
        }
        const loginCheck = await verifyIssuedCredential({
            username: updated.rows[0]?.username || target.rows[0].username,
            password: finalPassword
        });
        if (updated.rows[0]?.is_active !== false && !loginCheck.loginReady) {
            throw new Error(`password_login_ready_check_failed_after_reset:${loginCheck.reason}`);
        }
        await revokeAllUserTokens(parseInt(id));
        await recordAccountSecurityEvent({
            actor: req.user,
            target: target.rows[0],
            eventType: issueOneTime ? 'password_one_time_reissued' : 'password_reset_by_admin',
            reason: 'account_management',
            details: { sessionsRevoked: true, oneTimeIssued: issueOneTime, activateOnReset, activatedByReset, loginReady: loginCheck.loginReady },
            req
        });

        log.info(`User ${req.user.username} reset password for ${target.rows[0].username}`);
        res.json({
            success: true,
            username: target.rows[0].username,
            login: target.rows[0].username,
            loginAliases: Array.isArray(target.rows[0].login_aliases) ? target.rows[0].login_aliases : [],
            isActive: updated.rows[0]?.is_active !== false,
            wasActive: target.rows[0].is_active !== false,
            activated: activatedByReset,
            loginReady: loginCheck.loginReady,
            loginReadyReason: loginCheck.reason,
            passwordChangedAt: updated.rows[0]?.password_changed_at || null,
            sessionRevokedAt: updated.rows[0]?.session_revoked_at || null,
            credential: issueOneTime ? oneTimeCredential(target.rows[0].username, finalPassword, 'password_reissue') : null
        });
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

        await pool.query(
            `UPDATE users
             SET is_active = $1,
                 session_revoked_at = CASE WHEN $1 = false THEN NOW() ELSE session_revoked_at END
             WHERE id = $2`,
            [!!isActive, parseInt(id)]
        );
        if (!isActive) {
            await pool.query('UPDATE employee_profiles SET is_active = false WHERE user_id = $1', [parseInt(id)]);
            await revokeAllUserTokens(parseInt(id));
        } else {
            await pool.query('UPDATE employee_profiles SET is_active = true WHERE user_id = $1 AND staff_id IS NOT NULL', [parseInt(id)]);
        }

        await recordAccountSecurityEvent({
            actor: req.user,
            target: target.rows[0],
            eventType: isActive ? 'account_activated' : 'account_deactivated',
            reason: 'account_management',
            details: { sessionsRevoked: !isActive },
            req
        });

        log.info(`User ${req.user.username} ${isActive ? 'activated' : 'deactivated'} ${target.rows[0].username}`);
        res.json({ success: true, username: target.rows[0].username, isActive: !!isActive });
    } catch (err) {
        log.error('Toggle active error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/users — create new user (creator + director only)
router.post('/', requireRole('creator', 'director'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { password, name, role, extraRoles, pageAllowlist } = req.body;
        const issueOneTime = req.body?.issueOneTime === true || req.body?.generate === true || !password;
        const username = normalizeUsername(req.body.username);
        const staffId = normalizeStaffId(req.body.staffId);

        if (!username || !name) {
            return res.status(400).json({ error: 'username та name обов\'язкові' });
        }
        if (username.length < 3 || username.length > 50 || !/^[a-zA-Z0-9._-]+$/.test(username)) {
            return res.status(400).json({ error: 'Логін має містити 3-50 символів: латиниця, цифри, крапка, дефіс або підкреслення' });
        }
        const finalPassword = issueOneTime ? generateOneTimePassword() : String(password || '');
        if (finalPassword.length < 6) {
            return res.status(400).json({ error: 'Пароль має бути не менше 6 символів' });
        }
        if (Number.isNaN(staffId)) {
            return res.status(400).json({ error: 'Некоректний staff-профіль' });
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

        const existing = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Користувач з таким username вже існує' });
        }

        await client.query('BEGIN');
        const hash = await bcrypt.hash(finalPassword, 10);
        const hashVerified = await bcrypt.compare(finalPassword, hash);
        if (!hashVerified) {
            throw new Error('password_hash_verified_after_create_failed');
        }
        const result = await client.query(
            'INSERT INTO users (username, password_hash, name, role, extra_roles, page_allowlist, password_changed_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id, username, name, role, extra_roles, page_allowlist, is_active',
            [username, hash, name.trim(), primaryRole, normalizedExtraRoles, normalizedPageAllowlist]
        );
        const loginCheck = await verifyIssuedCredential({
            client,
            username: result.rows[0].username,
            password: finalPassword
        });
        if (!loginCheck.loginReady) {
            throw new Error(`password_login_ready_check_failed_after_create:${loginCheck.reason}`);
        }

        if (staffId) {
            await linkUserToStaffProfile(client, {
                userId: result.rows[0].id,
                staffId,
                actor: req.user,
                req,
                eventType: 'account_created_with_staff_link',
                details: { source: 'users_create', oneTimeIssued: issueOneTime }
            });
        }
        await recordAccountSecurityEvent({
            actor: req.user,
            target: result.rows[0],
            eventType: 'account_created',
            reason: 'account_management',
            details: { role: primaryRole, extraRoles: normalizedExtraRoles, staffLinked: !!staffId, oneTimeIssued: issueOneTime, loginReady: loginCheck.loginReady },
            req,
            client
        });
        await client.query('COMMIT');

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

        res.json({
            success: true,
            user: result.rows[0],
            loginReady: loginCheck.loginReady,
            loginReadyReason: loginCheck.reason,
            credential: issueOneTime ? oneTimeCredential(result.rows[0].username, finalPassword, 'account_create') : null
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        log.error('Create user error', err);
        res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
