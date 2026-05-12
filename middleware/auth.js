/**
 * middleware/auth.js — JWT authentication + Role-based access control
 * v22.0.0: Expanded role system — 26 roles with hierarchy and access matrix
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Auth');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
if (!process.env.JWT_SECRET) {
    log.warn('JWT_SECRET not set in environment! Sessions will be lost on restart. Set JWT_SECRET env variable.');
}

// v22.0.0: Role hierarchy — 26 roles (higher index = more permissions)
const ROLE_HIERARCHY = [
    'waiter',            // 0
    'dishwasher',        // 1
    'maintenance',       // 2
    'cleaning',          // 3
    'wardrobe',          // 4
    'barista',           // 5
    'security',          // 6 — Охорона
    'reception',         // 7
    'animator',          // 7
    'pastry_chef',       // 8
    'head_pastry',       // 9
    'cook',              // 10
    'head_chef',         // 11
    'instructor',        // 12
    'senior_instructor', // 13
    'admin',             // 14
    'hr',                // 15
    'it_specialist',     // 16
    'marketer',          // 17
    'art_director',      // 18
    'accountant',        // 19
    'manager',           // 20
    'senior_manager',    // 21
    'vice_director',     // 22
    'director',          // 23
    'creator'            // 24
];

const ROLE_LEVEL = {};
ROLE_HIERARCHY.forEach((role, idx) => { ROLE_LEVEL[role] = idx; });

// v22.0.0: Page access matrix — all roles, merged pages (/leads→/customers, /designs→/art)
const ALL_STAFF = ROLE_HIERARCHY.filter(r => r !== 'waiter');
const MANAGEMENT_UP = ['creator', 'director', 'vice_director', 'senior_manager'];
const MANAGER_UP = [...MANAGEMENT_UP, 'manager'];
const ADMIN_UP = [...MANAGER_UP, 'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin'];
const LEADS_ACCESS = [...MANAGER_UP, 'marketer'];
const ART_ACCESS = [...MANAGER_UP, 'art_director', 'marketer'];
const PROGRAMS_ACCESS = [...MANAGER_UP, 'admin', 'senior_instructor', 'instructor', 'art_director'];
const STAFF_PAGE_ACCESS = [...MANAGER_UP, 'admin', 'hr', 'senior_instructor', 'instructor', 'it_specialist', 'security'];
const HR_PAGE_ACCESS = [...MANAGER_UP, 'hr', 'admin', 'security'];
const TRAINING_ACCESS = [...MANAGER_UP, 'hr', 'senior_instructor', 'instructor'];
const GUARDIAN_OPS_ACCESS = ['creator', 'director', 'admin', 'security'];
const PAGE_ACCESS = {
    '/dashboard': ROLE_HIERARCHY,  // Everyone
    '/':          ALL_STAFF,
    '/tasks':     ALL_STAFF,
    '/chat':      ALL_STAFF,
    '/kleshnya':  ALL_STAFF,
    '/center':    MANAGER_UP,
    '/art':       ART_ACCESS,
    '/art-director': ART_ACCESS,
    '/content':   ART_ACCESS,
    '/designer':  ART_ACCESS,
    '/designs':   ART_ACCESS,
    '/graduation': [...MANAGER_UP, 'admin', 'art_director', 'marketer'],
    '/customers': [...ADMIN_UP, 'reception'],
    '/staff':     STAFF_PAGE_ACCESS,
    '/warehouse': [...MANAGER_UP, 'admin'],
    '/training':  TRAINING_ACCESS,
    '/settings':  ['creator', 'director'],
    '/demo':      MANAGER_UP,
    '/programs':  PROGRAMS_ACCESS,
    '/hr':        HR_PAGE_ACCESS,
    '/checkin':   HR_PAGE_ACCESS,
    '/finance':   ['creator', 'director', 'accountant'],
    '/analytics': MANAGER_UP,
    '/status':    MANAGER_UP,
    '/guardian-ops': GUARDIAN_OPS_ACCESS,
    '/omni':      MANAGER_UP,
    '/copilot':   MANAGER_UP,
    '/sound':     [...MANAGER_UP, 'art_director'],
    '/afisha':    ALL_STAFF,
    '/certificates': ALL_STAFF,
    '/sales-funnel': LEADS_ACCESS,
    '/leads':     LEADS_ACCESS,
    '/report-agent': ['creator', 'director', 'vice_director'],
    '/reports':   ['creator', 'director', 'vice_director', 'senior_manager', 'accountant'],
    '/game':      ROLE_HIERARCHY,
    '/profile':   ROLE_HIERARCHY,
    '/quiz':      ROLE_HIERARCHY,
    '/room':      ROLE_HIERARCHY,
    '/shop':      ROLE_HIERARCHY,
};

// v22.0.0: Action permissions matrix for timeline
const ACTION_PERMISSIONS = {
    create_booking:  [...ADMIN_UP, 'reception'],
    edit_booking:    [...ADMIN_UP, 'reception'],
    cancel_booking:  MANAGER_UP,
    delete_booking:  ['creator', 'director'],
    view_all:        ADMIN_UP,
    view_own:        ['senior_instructor', 'instructor', 'animator', 'reception'],
    manage_users:    ['creator', 'director'],
    view_revenue:    [...MANAGER_UP, 'accountant'],
    manage_settings: ['creator', 'director'],
    export_data:     MANAGER_UP,
    manage_staff:    [...MANAGER_UP, 'hr'],
};

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;

        // v19.1: Update employee activity (fire-and-forget, throttled to 1/min per user)
        if (user.id) {
            const cacheKey = `activity_${user.id}`;
            const now = Date.now();
            if (!authenticateToken._activityCache) {
                authenticateToken._activityCache = new Map();
                // Cleanup stale entries every 10 minutes
                authenticateToken._activityCleanup = setInterval(() => {
                    const cutoff = Date.now() - 120000;
                    for (const [k, v] of authenticateToken._activityCache) {
                        if (v < cutoff) authenticateToken._activityCache.delete(k);
                    }
                }, 600000);
                if (authenticateToken._activityCleanup.unref) authenticateToken._activityCleanup.unref();
            }
            if (!authenticateToken._activityCache.has(cacheKey) || now - authenticateToken._activityCache.get(cacheKey) > 60000) {
                authenticateToken._activityCache.set(cacheKey, now);
                pool.query(
                    'UPDATE employee_profiles SET last_activity_at = NOW() WHERE user_id = $1',
                    [user.id]
                ).catch(() => {});
                pool.query(
                    'UPDATE users SET last_seen_at = NOW() WHERE id = $1',
                    [user.id]
                ).catch(() => {});
            }
        }

        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
}

// v22.0.0: Legacy role mapping — old roles expand to new ones for backward compat
const LEGACY_ROLE_MAP = {
    'admin': ADMIN_UP,
    'user': [...ADMIN_UP, 'senior_instructor', 'instructor'],
    'manager': MANAGER_UP,
    'viewer': ['animator', 'waiter', 'instructor', 'reception', 'barista', 'wardrobe', 'cleaning', 'maintenance', 'dishwasher'],
};

// v20.1.0: Check if user has one of the specified roles (with legacy expansion)
function requireRole(...roles) {
    // Expand legacy role names to new role system
    const expandedRoles = new Set();
    for (const role of roles) {
        if (LEGACY_ROLE_MAP[role]) {
            LEGACY_ROLE_MAP[role].forEach(r => expandedRoles.add(r));
        }
        expandedRoles.add(role);
    }

    return (req, res, next) => {
        if (!req.user || !expandedRoles.has(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

// v20.1.0: Check if user role is at least minRole in the hierarchy
function requireMinRole(minRole) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        const userLevel = ROLE_LEVEL[req.user.role];
        const minLevel = ROLE_LEVEL[minRole];
        if (userLevel === undefined || minLevel === undefined || userLevel < minLevel) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

// v20.1.0: Check if user can perform a specific action
function requireAction(action) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        const allowed = ACTION_PERMISSIONS[action];
        if (!allowed || !allowed.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

// Convenience: all roles that can access gamification features
const ANY_ROLE = ROLE_HIERARCHY;

// v38.4.0: Refresh token utilities
const REFRESH_TOKEN_EXPIRY_DAYS = 30;
const ACCESS_TOKEN_EXPIRY = '15m'; // Short-lived access token

/**
 * Generate a cryptographically secure refresh token
 */
function generateRefreshToken() {
    return crypto.randomBytes(48).toString('hex');
}

/**
 * Hash a refresh token for storage (never store raw tokens)
 */
function hashRefreshToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a new access + refresh token pair
 */
async function createTokenPair(user, { deviceInfo, ipAddress } = {}) {
    const accessToken = jwt.sign(
        { id: user.id, username: user.username, role: user.role, name: user.name },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    const refreshToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await pool.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, tokenHash, (deviceInfo || '').slice(0, 200), ipAddress || null, expiresAt]
    );

    return { accessToken, refreshToken, expiresAt };
}

/**
 * Rotate refresh token: verify old → issue new → revoke old
 * Implements replay detection: if already-revoked token is reused, revoke ALL tokens for that user
 */
async function rotateRefreshToken(oldRefreshToken, { deviceInfo, ipAddress } = {}) {
    const oldHash = hashRefreshToken(oldRefreshToken);

    const result = await pool.query(
        'SELECT id, user_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = $1',
        [oldHash]
    );

    if (result.rows.length === 0) {
        return { error: 'Invalid refresh token', status: 401 };
    }

    const oldToken = result.rows[0];

    // Replay detection: if token was already revoked, it's a potential theft
    if (oldToken.revoked_at) {
        log.warn(`Refresh token replay detected for user ${oldToken.user_id} — revoking all tokens`);
        await pool.query(
            'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
            [oldToken.user_id]
        );
        return { error: 'Token reuse detected. All sessions revoked.', status: 401 };
    }

    // Check expiry
    if (new Date(oldToken.expires_at) < new Date()) {
        await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [oldToken.id]);
        return { error: 'Refresh token expired', status: 401 };
    }

    // Get user
    const userResult = await pool.query(
        'SELECT id, username, role, name, is_active FROM users WHERE id = $1',
        [oldToken.user_id]
    );

    if (userResult.rows.length === 0 || !userResult.rows[0].is_active) {
        await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [oldToken.id]);
        return { error: 'User not found or deactivated', status: 403 };
    }

    const user = userResult.rows[0];

    // Issue new pair
    const { accessToken, refreshToken: newRefreshToken, expiresAt } = await createTokenPair(user, { deviceInfo, ipAddress });

    // Revoke old token and link to new via hash lookup (atomic)
    const newHash = hashRefreshToken(newRefreshToken);
    await pool.query(
        `UPDATE refresh_tokens SET revoked_at = NOW(),
                replaced_by = (SELECT id FROM refresh_tokens WHERE token_hash = $1)
         WHERE id = $2`,
        [newHash, oldToken.id]
    );

    return { accessToken, refreshToken: newRefreshToken, expiresAt, user };
}

/**
 * Revoke a specific refresh token (logout)
 */
async function revokeRefreshToken(refreshToken) {
    const tokenHash = hashRefreshToken(refreshToken);
    await pool.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
        [tokenHash]
    );
}

/**
 * Revoke all refresh tokens for a user (logout all devices)
 */
async function revokeAllUserTokens(userId) {
    await pool.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [userId]
    );
}

/**
 * Cleanup expired/revoked refresh tokens (called by scheduler)
 */
async function cleanupRefreshTokens() {
    const result = await pool.query(
        `DELETE FROM refresh_tokens
         WHERE (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days')
            OR (expires_at < NOW() - INTERVAL '7 days')
         RETURNING id`
    );
    return result.rowCount;
}

module.exports = {
    JWT_SECRET,
    ACCESS_TOKEN_EXPIRY,
    authenticateToken,
    requireRole,
    requireMinRole,
    requireAction,
    createTokenPair,
    rotateRefreshToken,
    revokeRefreshToken,
    revokeAllUserTokens,
    cleanupRefreshTokens,
    ROLE_HIERARCHY,
    ROLE_LEVEL,
    PAGE_ACCESS,
    ACTION_PERMISSIONS,
    ANY_ROLE
};
