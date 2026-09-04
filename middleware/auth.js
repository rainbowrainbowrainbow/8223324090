/**
 * middleware/auth.js — JWT authentication + Role-based access control
 * v22.0.0: Expanded role system — 26 roles with hierarchy and access matrix
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const {
    allowedBusinessContextsForUser,
    resolveDefaultBusinessContext,
    resolveBusinessContextPolicy
} = require('../services/businessContext');
const {
    ROLE_HIERARCHY,
    PAGE_ACCESS,
    ACTION_PERMISSIONS,
    NON_DELEGABLE_ACTIONS,
    normalizeRoleList,
    normalizePageAllowlist,
    normalizePageDenylist,
    normalizeActionOverrideList,
    resolveCapability
} = require('../services/accountAccessPolicy');
const { resolveActiveQaCreatorLease } = require('../services/qaCreatorLease');

const log = createLogger('Auth');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
if (!process.env.JWT_SECRET) {
    log.warn('JWT_SECRET not set in environment! Sessions will be lost on restart. Set JWT_SECRET env variable.');
}

const ROLE_LEVEL = {};
ROLE_HIERARCHY.forEach((role, idx) => { ROLE_LEVEL[role] = idx; });

const MANAGEMENT_UP = ['creator', 'director', 'vice_director', 'senior_manager'];
const MANAGER_UP = [...MANAGEMENT_UP, 'manager'];
const ADMIN_UP = [...MANAGER_UP, 'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin'];

function userHasAnyRole(user, allowedRoles) {
    if (!Array.isArray(allowedRoles) || !allowedRoles.length) return false;
    const roles = normalizeRoleList(user);
    return roles.includes('creator') || roles.some(role => allowedRoles.includes(role));
}

function userMaxRoleLevel(user) {
    return normalizeRoleList(user).reduce((max, role) => Math.max(max, ROLE_LEVEL[role] ?? -1), -1);
}

function actionPermissionDecision(user, action) {
    const resolved = resolveCapability(user, action, { type: 'action' });
    return { ...resolved, action: resolved.key || String(action || '') };
}

function canUseAction(user, action) {
    return actionPermissionDecision(user, action).allowed;
}

function buildAuthUserPayload(user) {
    const extraRoles = Array.isArray(user?.extra_roles) ? user.extra_roles : (Array.isArray(user?.extraRoles) ? user.extraRoles : []);
    const pageAllowlist = normalizePageAllowlist(user);
    const pageDenylist = normalizePageDenylist(user);
    const actionAllowlist = normalizeActionOverrideList(user?.action_allowlist || user?.actionAllowlist);
    const actionDenylist = normalizeActionOverrideList(user?.action_denylist || user?.actionDenylist);
    const roles = normalizeRoleList({ ...user, extraRoles });
    const businessContexts = allowedBusinessContextsForUser(user);
    const businessContextPolicy = resolveBusinessContextPolicy(user);
    const defaultBusinessContext = businessContextPolicy.defaultContext || resolveDefaultBusinessContext(user, businessContexts);
    const staffIds = Array.from(new Set([
        ...(Array.isArray(user?.staff_ids) ? user.staff_ids : []),
        ...(Array.isArray(user?.staffIds) ? user.staffIds : []),
        user?.staff_id,
        user?.staffId
    ].map(value => Number(value)).filter(value => Number.isInteger(value) && value > 0)));
    const qaCreatorLeaseId = user?.qaCreatorLeaseId || user?.qa_creator_lease_id || null;
    const qaCreatorLeaseExpiresAt = user?.qaCreatorLeaseExpiresAt || user?.qa_creator_lease_expires_at || null;
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        roles,
        extraRoles: roles.filter(role => role !== user.role),
        pageAllowlist,
        page_allowlist: pageAllowlist,
        pageDenylist,
        page_denylist: pageDenylist,
        actionAllowlist,
        actionDenylist,
        action_allowlist: actionAllowlist,
        action_denylist: actionDenylist,
        businessContexts,
        business_contexts: businessContexts,
        defaultBusinessContext,
        default_business_context: defaultBusinessContext,
        businessContextPolicy,
        staffIds,
        staff_ids: staffIds,
        name: user.name,
        telegram_chat_id: user.telegram_chat_id || user.telegramChatId || null,
        telegramChatId: user.telegram_chat_id || user.telegramChatId || null,
        ...(qaCreatorLeaseId && qaCreatorLeaseExpiresAt ? {
            qaCreatorLeaseId,
            qaCreatorLeaseExpiresAt
        } : {})
    };
}

function authSessionError(message, code = 'auth_session_invalid') {
    const error = new Error(message);
    error.code = code;
    error.status = 401;
    error.isAuthSessionError = true;
    return error;
}

function isAuthCompatibilityMiss(error) {
    const message = String(error?.message || '');
    return /Unexpected .*query/i.test(message)
        || /column .*session_revoked_at.*does not exist/i.test(message)
        || /relation .*users.*does not exist/i.test(message);
}

function isDemoTokenPrincipal(user) {
    return Number(user?.id) === -1
        && user?.isDemo === true
        && String(user?.username || '') === 'demo'
        && String(user?.role || '') === 'viewer'
        && (!user?.tokenPurpose || user.tokenPurpose === 'demo');
}

function isDemoTokenRequestAllowed(req) {
    const method = String(req?.method || 'GET').toUpperCase();
    const path = String(req?.path || req?.url || req?.originalUrl || '')
        .split('?')[0]
        .replace(/\/+$/, '');
    const apiLocalPath = path.startsWith('/api/') ? path.slice(4) : path;
    if (method === 'GET' && apiLocalPath === '/demo/overview') return true;
    if (method === 'POST' && apiLocalPath === '/demo/sessions') return true;
    return method === 'PUT' && /^\/demo\/sessions\/[^/]+$/.test(apiLocalPath);
}

async function loadAuthenticatedUserAccess(user, options = {}) {
    const requireFresh = options.requireFresh === true;
    const requireIdentityMatch = options.requireIdentityMatch === true;
    const includeStaffProfile = options.includeStaffProfile === true
        || (requireFresh && options.includeStaffProfile !== false);
    const db = options.db || pool;
    const lockUser = options.lockUser === true;
    const userId = user?.id || user?.userId || user?.sub;
    if (!userId) {
        if (requireFresh) throw authSessionError('User not found or deactivated', 'auth_user_missing');
        return user;
    }

    try {
        const sessionState = await db.query(
            `SELECT is_active, session_revoked_at FROM users WHERE id = $1${lockUser ? ' FOR UPDATE' : ''}`,
            [userId]
        );
        const sessionRow = sessionState.rows[0];
        if (!sessionRow) {
            throw authSessionError('User not found or deactivated', 'auth_user_missing');
        }
        if (sessionRow?.is_active === false) {
            throw authSessionError('User not found or deactivated', 'auth_user_deactivated');
        }
        const revokedAtMs = sessionRow?.session_revoked_at
            ? new Date(sessionRow.session_revoked_at).getTime()
            : NaN;
        const issuedAtMs = Number(user.sessionIssuedAt || user.session_issued_at || 0);
        const revokedUnix = Number.isFinite(revokedAtMs) ? Math.floor(revokedAtMs / 1000) : 0;
        const issuedBeforeCutoff = Number.isFinite(revokedAtMs)
            && (issuedAtMs > 0
                ? issuedAtMs <= revokedAtMs
                : Number(user.iat || 0) <= revokedUnix);
        if (issuedBeforeCutoff) {
            throw authSessionError('Session revoked. Please login again.', 'auth_session_revoked');
        }

        const freshAccessState = await db.query(
            `SELECT id, username, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts,
                    default_business_context, name, telegram_chat_id, is_active
             FROM users WHERE id = $1`,
            [userId]
        );
        const freshUser = freshAccessState.rows[0];
        if (!freshUser) {
            if (requireFresh) throw authSessionError('User not found or deactivated', 'auth_user_missing');
            return user;
        }
        if (requireIdentityMatch) {
            const tokenUsername = String(user?.username || '').trim().toLowerCase();
            const freshUsername = String(freshUser.username || '').trim().toLowerCase();
            if (!tokenUsername || tokenUsername !== freshUsername) {
                throw authSessionError('Authenticated user identity changed', 'auth_identity_changed');
            }
        }
        if (freshUser.is_active === false) {
            throw authSessionError('User not found or deactivated', 'auth_user_deactivated');
        }
        const accessUser = user?.qaCreatorLeaseId
            ? await resolveActiveQaCreatorLease(freshUser, db, { expectedLeaseId: user.qaCreatorLeaseId })
            : freshUser;

        let staffState = { rows: [] };
        if (includeStaffProfile) {
            try {
                staffState = await db.query(
                    `SELECT staff_id
                     FROM employee_profiles
                     WHERE user_id = $1
                       AND COALESCE(is_active, true) IS TRUE
                       AND staff_id IS NOT NULL`,
                    [userId]
                );
            } catch (error) {
                if (requireFresh) throw error;
            }
        }
        const staffIds = staffState.rows
            .map(row => Number(row.staff_id))
            .filter(value => Number.isInteger(value) && value > 0);

        return {
            ...user,
            ...buildAuthUserPayload({ ...accessUser, staffIds }),
            iat: user.iat,
            exp: user.exp,
            imp: user.imp,
            impBy: user.impBy
        };
    } catch (error) {
        if (error?.isAuthSessionError) throw error;
        if (!requireFresh && isAuthCompatibilityMiss(error)) return user;
        throw error;
    }
}

async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({
            error: 'Authentication required',
            code: 'auth_token_missing'
        });
    }

    try {
        const user = jwt.verify(token, JWT_SECRET);
        if (isDemoTokenPrincipal(user)) {
            if (!isDemoTokenRequestAllowed(req)) {
                return res.status(403).json({
                    error: 'Demo session is not allowed for this resource',
                    code: 'auth_demo_scope_denied'
                });
            }
            req.user = user;
            return next();
        }
        const recoveryMode = process.env.BACKUP_RECOVERY_MODE === 'true';
        const requestUser = await loadAuthenticatedUserAccess(user, {
            requireFresh: recoveryMode,
            requireIdentityMatch: recoveryMode
        });
        req.user = requestUser;

        // v19.1: Update employee activity (fire-and-forget, throttled to 1/min per user)
        // Recovery requests must not mutate the snapshot after a restore commit.
        if (user.id && !recoveryMode) {
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
        if (err?.isAuthSessionError) {
            return res.status(err.status || 401).json({ error: err.message, code: err.code });
        }
        if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError || err instanceof jwt.NotBeforeError) {
            return res.status(401).json({
                error: 'Invalid or expired token',
                code: 'auth_token_invalid'
            });
        }
        log.error('Authentication verification unavailable', err);
        return res.status(503).json({
            error: 'Authentication verification temporarily unavailable',
            code: 'auth_verification_unavailable',
            retryable: true
        });
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
        if (!req.user || !userHasAnyRole(req.user, Array.from(expandedRoles))) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

// v20.1.0: Check if user role is at least minRole in the hierarchy
function requireMinRole(minRole) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        const userLevel = userMaxRoleLevel(req.user);
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
        if (!canUseAction(req.user, action)) {
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
const REFRESH_ROTATION_DUPLICATE_GRACE_MS = 5000;

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
async function createTokenPair(user, { deviceInfo, ipAddress } = {}, db = pool) {
    const authUser = buildAuthUserPayload(user);
    const refreshToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const insertResult = await db.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp())
         RETURNING created_at`,
        [user.id, tokenHash, (deviceInfo || '').slice(0, 200), ipAddress || null, expiresAt]
    );

    const databaseIssuedAt = new Date(insertResult.rows?.[0]?.created_at).getTime();
    const sessionIssuedAt = Number.isFinite(databaseIssuedAt) ? databaseIssuedAt : Date.now();
    const accessToken = jwt.sign(
        { ...authUser, sessionIssuedAt },
        JWT_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    return { accessToken, refreshToken, expiresAt, sessionIssuedAt };
}

/**
 * Rotate refresh token under a row lock so parallel refreshes cannot both consume
 * the same token. A same-client duplicate stays non-destructive even when the
 * first successful response was lost and the client retries later.
 */
async function rotateRefreshToken(oldRefreshToken, { deviceInfo, ipAddress } = {}) {
    const oldHash = hashRefreshToken(oldRefreshToken);
    const normalizedDeviceInfo = (deviceInfo || '').slice(0, 200);
    const normalizedIpAddress = ipAddress ? String(ipAddress) : null;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const ownerResult = await client.query(
            'SELECT user_id FROM refresh_tokens WHERE token_hash = $1',
            [oldHash]
        );
        if (ownerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return { error: 'Invalid refresh token', code: 'refresh_token_invalid', status: 401 };
        }

        // Keep the same lock order as account lifecycle transactions:
        // users row first, refresh-token row second.
        const userResult = await client.query(
            `SELECT id, username, role, extra_roles, page_allowlist, page_denylist,
                    action_allowlist, action_denylist, business_contexts,
                    default_business_context, name, telegram_chat_id, is_active,
                    session_revoked_at
             FROM users
             WHERE id = $1
             FOR UPDATE`,
            [ownerResult.rows[0].user_id]
        );
        const result = await client.query(
            `SELECT id, user_id, device_info, ip_address, revoked_at, replaced_by, expires_at, created_at,
                    EXTRACT(EPOCH FROM (clock_timestamp() - revoked_at)) * 1000 AS rotation_age_ms
             FROM refresh_tokens
             WHERE token_hash = $1
             FOR UPDATE`,
            [oldHash]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return { error: 'Invalid refresh token', code: 'refresh_token_invalid', status: 401 };
        }

        const oldToken = result.rows[0];
        const storedUser = userResult.rows[0] || null;

        if (!storedUser || !storedUser.is_active) {
            await client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [oldToken.id]);
            await client.query('COMMIT');
            return { error: 'User not found or deactivated', code: 'refresh_user_inactive', status: 401 };
        }

        const revokedAtMs = storedUser.session_revoked_at
            ? new Date(storedUser.session_revoked_at).getTime()
            : NaN;
        const tokenCreatedAtMs = oldToken.created_at
            ? new Date(oldToken.created_at).getTime()
            : NaN;
        if (Number.isFinite(revokedAtMs)
            && (!Number.isFinite(tokenCreatedAtMs) || tokenCreatedAtMs <= revokedAtMs)) {
            if (!oldToken.revoked_at) {
                await client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [oldToken.id]);
            }
            await client.query('COMMIT');
            return { error: 'Session revoked. Please login again.', code: 'refresh_session_revoked', status: 401 };
        }

        if (oldToken.revoked_at) {
            if (oldToken.replaced_by) {
                const rotationAgeMs = Number(oldToken.rotation_age_ms);
                if (Number.isFinite(rotationAgeMs)
                    && rotationAgeMs >= 0
                    && rotationAgeMs <= REFRESH_ROTATION_DUPLICATE_GRACE_MS) {
                    await client.query('ROLLBACK');
                    return {
                        error: 'Refresh token was already rotated by this client',
                        code: 'refresh_already_rotated',
                        status: 409,
                        reloginRequired: true
                    };
                }

                const replacementIds = [];
                const visited = new Set();
                let replacementId = oldToken.replaced_by;
                while (replacementId && !visited.has(Number(replacementId))) {
                    const replacementResult = await client.query(
                        `SELECT id, user_id, revoked_at, replaced_by
                         FROM refresh_tokens
                         WHERE id = $1 AND user_id = $2
                         FOR UPDATE`,
                        [replacementId, oldToken.user_id]
                    );
                    const replacement = replacementResult.rows[0] || null;
                    if (!replacement) break;
                    const tokenId = Number(replacement.id);
                    visited.add(tokenId);
                    replacementIds.push(tokenId);
                    replacementId = replacement.replaced_by;
                }
                if (replacementIds.length > 0) {
                    await client.query(
                        `UPDATE refresh_tokens
                         SET revoked_at = clock_timestamp()
                         WHERE id = ANY($1::int[]) AND revoked_at IS NULL`,
                        [replacementIds]
                    );
                }
                await client.query('COMMIT');
                return {
                    error: 'Refresh token reuse detected. This session was revoked.',
                    code: 'refresh_token_reuse',
                    status: 401
                };
            }
            await client.query('ROLLBACK');
            return {
                error: 'Refresh token was revoked',
                code: 'refresh_token_revoked',
                status: 401
            };
        }

        if (new Date(oldToken.expires_at) < new Date()) {
            await client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [oldToken.id]);
            await client.query('COMMIT');
            return { error: 'Refresh token expired', code: 'refresh_token_expired', status: 401 };
        }

        const user = await resolveActiveQaCreatorLease(storedUser, client);
        const { accessToken, refreshToken: newRefreshToken, expiresAt } = await createTokenPair(
            user,
            { deviceInfo: normalizedDeviceInfo, ipAddress: normalizedIpAddress },
            client
        );
        const newHash = hashRefreshToken(newRefreshToken);
        await client.query(
            `UPDATE refresh_tokens SET revoked_at = clock_timestamp(),
                    replaced_by = (SELECT id FROM refresh_tokens WHERE token_hash = $1)
             WHERE id = $2`,
            [newHash, oldToken.id]
        );
        await client.query('COMMIT');

        return { accessToken, refreshToken: newRefreshToken, expiresAt, user };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Revoke a specific refresh token (logout)
 */
async function revokeRefreshToken(refreshToken) {
    const tokenHash = hashRefreshToken(refreshToken);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const ownerResult = await client.query(
            'SELECT user_id FROM refresh_tokens WHERE token_hash = $1',
            [tokenHash]
        );
        if (ownerResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return null;
        }

        const userResult = await client.query(
            `SELECT id, username, role, extra_roles, page_allowlist, page_denylist,
                    action_allowlist, action_denylist, name, telegram_chat_id
             FROM users
             WHERE id = $1
             FOR UPDATE`,
            [ownerResult.rows[0].user_id]
        );
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return null;
        }

        const tokenIds = [];
        const visited = new Set();
        let tokenResult = await client.query(
            `SELECT id, user_id, revoked_at, replaced_by
             FROM refresh_tokens
             WHERE token_hash = $1
             FOR UPDATE`,
            [tokenHash]
        );
        let tokenRow = tokenResult.rows[0] || null;
        while (tokenRow && !visited.has(Number(tokenRow.id))) {
            const tokenId = Number(tokenRow.id);
            visited.add(tokenId);
            tokenIds.push(tokenId);
            if (!tokenRow.replaced_by) break;
            tokenResult = await client.query(
                `SELECT id, user_id, revoked_at, replaced_by
                 FROM refresh_tokens
                 WHERE id = $1 AND user_id = $2
                 FOR UPDATE`,
                [tokenRow.replaced_by, ownerResult.rows[0].user_id]
            );
            tokenRow = tokenResult.rows[0] || null;
        }

        const revokeResult = tokenIds.length > 0
            ? await client.query(
                `UPDATE refresh_tokens
                 SET revoked_at = clock_timestamp()
                 WHERE id = ANY($1::int[]) AND revoked_at IS NULL
                 RETURNING id`,
                [tokenIds]
            )
            : { rowCount: 0 };
        await client.query('COMMIT');
        return revokeResult.rowCount > 0 ? userResult.rows[0] : null;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Revoke all refresh tokens for a user (logout all devices)
 */
async function revokeAllUserTokens(userId, db = pool) {
    await db.query(
        'UPDATE refresh_tokens SET revoked_at = clock_timestamp() WHERE user_id = $1 AND revoked_at IS NULL',
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
    NON_DELEGABLE_ACTIONS,
    normalizeRoleList,
    normalizePageAllowlist,
    normalizePageDenylist,
    normalizeActionOverrideList,
    userHasAnyRole,
    userMaxRoleLevel,
    canUseAction,
    actionPermissionDecision,
    resolveCapability,
    buildAuthUserPayload,
    loadAuthenticatedUserAccess,
    ANY_ROLE
};
