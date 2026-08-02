/**
 * routes/auth.js — Login & token verification
 *
 * LLM HINT: This handles user authentication with bcrypt password verification.
 * Users are stored in the `users` table.
 * The repo does not ship shared default credentials; local bootstrap must be explicit via env.
 * JWT token expires in 24h. Role is embedded in token payload.
 */
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const crypto = require('crypto');
const { pool } = require('../db');
const {
    JWT_SECRET, authenticateToken, PAGE_ACCESS, ACTION_PERMISSIONS, ROLE_HIERARCHY, ROLE_LEVEL,
    createTokenPair, rotateRefreshToken, revokeRefreshToken, revokeAllUserTokens, cleanupRefreshTokens,
    buildAuthUserPayload, normalizeRoleList, normalizePageAllowlist, normalizePageDenylist, requireAction,
    canUseAction
} = require('../middleware/auth');
const { buildCapabilitySnapshot } = require('../services/accountAccessPolicy');
const { shapeRevenuePayload } = require('../services/revenueAccessPolicy');
const { resolveActiveQaCreatorLease } = require('../services/qaCreatorLease');
const { createLogger } = require('../utils/logger');
const { LOGIN_IDENTITY_WHERE_SQL, normalizeLoginIdentifier } = require('../services/authIdentity');
const {
    normalizeLoginCredentialPayload,
    normalizeManualPassword,
    uniquePasswordCandidates
} = require('../services/credentialInput');
const { buildTaskOwnerMatch, canMutateTask, normalizeUserId } = require('../services/taskPolicy');
const { canonicalTaskOrderSql } = require('../services/taskScheduling');
const { logTaskActionEvent, TASK_ACTION_TYPES } = require('../services/taskActionHistory');
const {
    uploadProfileAvatarWithFallback,
    validateProfileAvatarFile,
    MAX_AVATAR_BYTES
} = require('../services/profileAvatarStorage');
const {
    recordAccountSecurityEvent,
    listAccountSecurityEvents
} = require('../services/accountSecurity');
const {
    curateProfessionCatalogRows,
    normalizeSecondaryProfessions
} = require('../services/professions');
const { isProtectedSystemAccount } = require('../services/accountOnboarding');
const {
    resolveBusinessScope,
    requireBusinessScope,
    requireWritableBusinessScope,
    pushBusinessScopeCondition
} = require('../services/businessContext');

const log = createLogger('Auth');
const PROFILE_COCKPIT_WIDGET_IDS = Object.freeze([
    'active_tasks',
    'today_progress',
    'next_shift',
    'attention',
    'bookings_today',
    'certificates',
    'achievements'
]);
const DEFAULT_PROFILE_COCKPIT_WIDGETS = Object.freeze([
    'active_tasks',
    'today_progress',
    'next_shift',
    'attention',
    'bookings_today',
    'certificates',
    'achievements'
]);

const profileAvatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AVATAR_BYTES },
    fileFilter: (req, file, cb) => {
        try {
            validateProfileAvatarFile(file);
            cb(null, true);
        } catch (err) {
            cb(err);
        }
    }
});

function handleProfileAvatarUpload(req, res, next) {
    profileAvatarUpload.single('file')(req, res, (err) => {
        if (!err) return next();
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.statusCode || 400);
        res.status(status).json({ error: err.message || 'Не вдалося завантажити фото профілю' });
    });
}

function userAvatarPayload(row = {}) {
    return {
        avatar_url: row.avatar_url || null,
        avatarUrl: row.avatar_url || null,
        avatar_emoji: row.avatar_emoji || null,
        avatarEmoji: row.avatar_emoji || null,
        avatar_color: row.avatar_color || null,
        avatarColor: row.avatar_color || null
    };
}

function parseJsonValue(value, fallback) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string') return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function normalizeProfileCockpitWidgets(value) {
    const source = parseJsonValue(value, value);
    const rawList = Array.isArray(source)
        ? source
        : (Array.isArray(source?.widgets) ? source.widgets : []);
    const seen = new Set();
    rawList.forEach(id => {
        const key = String(id || '').trim();
        if (PROFILE_COCKPIT_WIDGET_IDS.includes(key)) seen.add(key);
    });
    const selected = Array.from(seen);
    return selected.length ? selected : [...DEFAULT_PROFILE_COCKPIT_WIDGETS];
}

function normalizeProfileStaffProfile(row) {
    if (!row) return null;
    const primaryRole = row.role_type || row.profile_role || '';
    return {
        id: row.id,
        employeeProfileId: row.employee_profile_id || null,
        name: row.name || row.full_name || '',
        department: row.department || row.profile_department || '',
        position: row.position || '',
        role_type: primaryRole,
        roleType: primaryRole,
        secondary_professions: normalizeSecondaryProfessions(row.secondary_professions, primaryRole),
        secondaryProfessions: normalizeSecondaryProfessions(row.secondary_professions, primaryRole),
        phone: row.phone || null
    };
}

function profileTaskOwnerWhere(user, alias = '') {
    const params = [];
    const prefix = alias ? `${alias}.` : '';
    const match = buildTaskOwnerMatch(user, params, alias || 'tasks')
        .replaceAll(`${alias || 'tasks'}.`, prefix);
    return { match, params };
}

function kyivDateStr(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

function profileTaskWorkloadDateSql(alias = 'tasks') {
    return `COALESCE(
        (${alias}.scheduled_start_at AT TIME ZONE 'Europe/Kyiv')::date,
        CASE WHEN LEFT(COALESCE(${alias}.date, ''), 10) ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN LEFT(${alias}.date, 10)::date END,
        (${alias}.deadline AT TIME ZONE 'Europe/Kyiv')::date,
        (${alias}.remind_at AT TIME ZONE 'Europe/Kyiv')::date
    )`;
}

function accountAuditIdentifierHash(value) {
    const normalized = normalizeLoginIdentifier(value);
    if (!normalized) return null;
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

async function recordLoginFailure({ user = null, loginIdentifier, reason, credentials = {}, req }) {
    await recordAccountSecurityEvent({
        actor: null,
        target: user ? { id: user.id, username: user.username } : null,
        eventType: 'login_failed',
        reason,
        details: {
            reason,
            identifierMatched: !!user,
            identifierHash: accountAuditIdentifierHash(loginIdentifier),
            parsedCredentialBlock: !!credentials.parsedCredentialBlock
        },
        req
    });
}

router.post('/login', async (req, res) => {
    try {
        const credentials = normalizeLoginCredentialPayload(req.body || {});
        const loginIdentifier = normalizeLoginIdentifier(credentials.username);
        if (!loginIdentifier || !credentials.password) {
            return res.status(400).json({ error: 'Введіть ім\'я та пароль' });
        }

        const result = await pool.query(
            `SELECT u.id, u.username, u.password_hash, u.role, u.extra_roles, u.page_allowlist, u.page_denylist, u.action_allowlist, u.action_denylist, u.business_contexts, u.default_business_context, u.name, u.telegram_chat_id, u.is_active,
                    u.avatar_emoji, u.avatar_color, upe.avatar_url
             FROM users u
             LEFT JOIN user_profiles_ext upe ON upe.username = u.username
             WHERE ${LOGIN_IDENTITY_WHERE_SQL}
             ORDER BY CASE WHEN LOWER(u.username) = $1 THEN 0 ELSE 1 END
             LIMIT 1`,
            [loginIdentifier]
        );

        // v39.9: Unified error message prevents username enumeration
        let user = result.rows[0];
        const passwordMatches = user && user.is_active !== false
            ? await credentials.passwordCandidates.reduce(async (matchedPromise, candidate) => {
                if (await matchedPromise) return true;
                return bcrypt.compare(candidate, user.password_hash || '').catch(() => false);
            }, Promise.resolve(false))
            : false;
        const valid = user && user.is_active !== false && passwordMatches;

        if (!valid) {
            const reason = !user ? 'user_not_found' : (user.is_active === false ? 'inactive_account' : 'password_mismatch');
            await recordLoginFailure({ user, loginIdentifier, reason, credentials, req });
            log.warn(`Login failed for "${loginIdentifier}" (${reason}${credentials.parsedCredentialBlock ? ', parsed_credential_block' : ''})`);
            return res.status(401).json({ error: 'Невірний логін або пароль' });
        }

        user = await resolveActiveQaCreatorLease(user, pool);

        // v38.4.0: Issue access + refresh token pair
        const deviceInfo = req.headers['user-agent'] || '';
        const ipAddress = req.ip || req.connection?.remoteAddress;
        const { accessToken, refreshToken, expiresAt } = await createTokenPair(user, { deviceInfo, ipAddress });

        // Backward compat: also issue legacy long-lived token for existing clients
        const authUser = buildAuthUserPayload(user);
        const token = jwt.sign(authUser, JWT_SECRET, { expiresIn: '24h' });

        await recordAccountSecurityEvent({
            actor: user,
            target: user,
            eventType: 'login_success',
            reason: 'auth_login',
            details: {
                refreshSessionCreated: true,
                parsedCredentialBlock: !!credentials.parsedCredentialBlock
            },
            req
        });

        log.info(`User "${user.username}" logged in (role: ${user.role})`);

        // v22.10.0: Update login streak (fire-and-forget)
        try { require('./streaks').updateStreak(user.id, 'login'); } catch (e) { log.warn('Streak update failed', e.message); }

        res.json({
            token, // legacy: 24h access token (backward compat)
            accessToken, // new: short-lived (15m)
            refreshToken, // new: long-lived (30d), store securely
            refreshExpiresAt: expiresAt,
            user: { ...authUser, ...userAvatarPayload(user) }
        });
    } catch (err) {
        log.error('Login error', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/verify', authenticateToken, async (req, res) => {
    try {
        // Read fresh role from DB (JWT may have stale role after role migration)
        const result = await pool.query(
            `SELECT u.id, u.username, u.role, u.extra_roles, u.page_allowlist, u.page_denylist, u.action_allowlist, u.action_denylist, u.business_contexts, u.default_business_context, u.name, u.telegram_chat_id, u.avatar_emoji, u.avatar_color, upe.avatar_url
             FROM users u
             LEFT JOIN user_profiles_ext upe ON upe.username = u.username
             WHERE u.username = $1 AND u.is_active = true`,
            [req.user.username]
        );
        if (result.rows.length === 0) {
            return res.status(403).json({ error: 'User not found or deactivated' });
        }
        const user = {
            ...result.rows[0],
            role: req.user.role,
            ...(req.user.qaCreatorLeaseId ? {
                qaCreatorLeaseId: req.user.qaCreatorLeaseId,
                qaCreatorLeaseExpiresAt: req.user.qaCreatorLeaseExpiresAt
            } : {})
        };
        res.json({ user: { ...buildAuthUserPayload(user), ...userAvatarPayload(user) } });
    } catch (err) {
        res.status(500).json({ error: 'Verification failed' });
    }
});

// v38.15: View profile by user ID (public profile data)
router.get('/profile/:userId', authenticateToken, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });

        const { rows: [user] } = await pool.query(
            `SELECT u.id, u.username, u.name, u.role, u.created_at,
                    u.avatar_emoji, u.avatar_color, upe.display_name, upe.avatar_url
             FROM users u
             LEFT JOIN user_profiles_ext upe ON upe.username = u.username
             WHERE u.id = $1`, [userId]
        );
        if (!user) return res.status(404).json({ error: 'User not found' });

        // If own profile — return basic info (full profile at GET /profile without id)
        if (req.user.username === user.username) {
            const ach = await pool.query(
                `SELECT a.code, a.name, a.icon, a.category, ua.unlocked_at
                 FROM user_achievements ua JOIN achievements a ON a.code = ua.achievement_code
                 WHERE ua.user_id = $1 ORDER BY ua.unlocked_at DESC LIMIT 20`, [userId]
            ).catch(() => ({ rows: [] }));
            return res.json({
                id: user.id, username: user.username, displayName: user.display_name || user.name,
                role: user.role, createdAt: user.created_at, ...userAvatarPayload(user),
                isOwnProfile: true, achievements: ach.rows
            });
        }

        // Public profile — limited data
        const achievements = await pool.query(
            `SELECT a.code, a.name, a.icon, a.category, ua.unlocked_at
             FROM user_achievements ua JOIN achievements a ON a.code = ua.achievement_code
             WHERE ua.user_id = $1 ORDER BY ua.unlocked_at DESC LIMIT 20`, [userId]
        ).catch(() => ({ rows: [] }));

        res.json({
            id: user.id,
            username: user.username,
            displayName: user.display_name || user.name,
            role: user.role,
            createdAt: user.created_at,
            ...userAvatarPayload(user),
            achievements: achievements.rows
        });
    } catch (err) {
        log.error('Get profile by ID error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v10.6: Personal cabinet — comprehensive profile data with shift, achievements, team, deltas
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const { username } = req.user;

        // User info (including telegram status)
        const userResult = await pool.query(
            `SELECT u.id, u.username, u.name, u.role, u.created_at, u.last_seen_at, u.password_changed_at, u.session_revoked_at, u.telegram_chat_id,
                    u.avatar_emoji, u.avatar_color, upe.display_name, upe.bio, upe.avatar_url, upe.profile_cockpit_widgets
             FROM users u
             LEFT JOIN user_profiles_ext upe ON upe.username = u.username
             WHERE u.username = $1`,
            [username]
        );
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const user = userResult.rows[0];
        const businessScope = resolveBusinessScope({ ...req, user });
        if (!requireBusinessScope(req, res, businessScope)) return;
        const ownerScope = profileTaskOwnerWhere(user);
        const ownerParams = ownerScope.params;
        const ownerBusinessCondition = pushBusinessScopeCondition(ownerParams, businessScope, 'tasks');
        const ownerWhere = `${ownerScope.match} AND ${ownerBusinessCondition}`;
        const ownerT = profileTaskOwnerWhere(user, 't');
        const ownerTBusinessCondition = pushBusinessScopeCondition(ownerT.params, businessScope, 't');
        ownerT.match = `${ownerT.match} AND ${ownerTBusinessCondition}`;
        const MANAGEMENT_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'admin'];
        const isAdminRole = MANAGEMENT_ROLES.includes(user.role);
        const canViewRevenue = canUseAction(req.user, 'view_revenue');
        const teamTaskParams = [];
        const teamTaskBusinessCondition = pushBusinessScopeCondition(teamTaskParams, businessScope, 't');
        const pointTaskParams = [username];
        const pointTaskBusinessCondition = pushBusinessScopeCondition(pointTaskParams, businessScope, 't');
        const completedUnitParams = [...ownerParams];

        const now = new Date();
        const today = kyivDateStr(now);
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        // Previous week range for delta comparison
        const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
        const twoWeeksAgo = new Date(now); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        const completedUnitTodayRef = `$${completedUnitParams.length + 1}`;
        const completedUnitWeekAgoRef = `$${completedUnitParams.length + 2}`;
        const completedUnitTwoWeeksAgoRef = `$${completedUnitParams.length + 3}`;
        completedUnitParams.push(today, weekAgo.toISOString(), twoWeeksAgo.toISOString());

        const results = await Promise.allSettled([
            // 0: Points (current month)
            pool.query(
                'SELECT monthly_points, permanent_points FROM user_points WHERE username = $1 AND month = $2',
                [username, month]
            ),
            // 1: Permanent total
            pool.query(
                'SELECT COALESCE(SUM(permanent_points), 0) as total FROM user_points WHERE username = $1',
                [username]
            ),
            // 2: Tasks stats by status
            pool.query(
                `SELECT status, COUNT(*)::int as count FROM tasks
                 WHERE ${ownerWhere}
                 GROUP BY status`,
                ownerParams
            ),
            // 3: Overdue tasks WITH DETAILS (not just count)
            pool.query(
                `SELECT id, title, deadline, scheduled_start_at, scheduled_end_at, schedule_slot, schedule_status, priority, category, task_mode, task_kind, visibility, workflow_state FROM tasks
                 WHERE ${ownerWhere}
                 AND status != 'done'
                 AND ((scheduled_end_at IS NOT NULL AND scheduled_end_at < NOW()) OR (scheduled_end_at IS NULL AND deadline IS NOT NULL AND deadline < NOW()))
                 ORDER BY ${canonicalTaskOrderSql('tasks')} LIMIT 10`,
                ownerParams
            ),
            // 4: Upcoming deadline tasks (within 48h — extended from 24h)
            pool.query(
                `SELECT id, title, deadline, scheduled_start_at, scheduled_end_at, schedule_slot, schedule_status, priority, category, status, task_mode, task_kind, visibility, workflow_state FROM tasks
                 WHERE ${ownerWhere}
                 AND status != 'done'
                 AND (
                    (scheduled_start_at IS NOT NULL AND scheduled_start_at > NOW() AND scheduled_start_at < NOW() + INTERVAL '48 hours')
                    OR (scheduled_start_at IS NULL AND deadline IS NOT NULL AND deadline > NOW() AND deadline < NOW() + INTERVAL '48 hours')
                 )
                 ORDER BY ${canonicalTaskOrderSql('tasks')} LIMIT 10`,
                ownerParams
            ),
            // 5: Tasks by category
            pool.query(
                `SELECT COALESCE(category, 'other') as category, COUNT(*)::int as count FROM tasks
                 WHERE ${ownerWhere} AND status != 'done'
                 GROUP BY category ORDER BY count DESC`,
                ownerParams
            ),
            // 6: Avg completion time (hours)
            pool.query(
                `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600)::numeric, 1) as avg_hours
                 FROM tasks
                 WHERE ${ownerWhere} AND status = 'done' AND completed_at IS NOT NULL`,
                ownerParams
            ),
            // 7: Escalation history (not just count — last 5)
            pool.query(
                `SELECT tl.task_id, tl.old_value, tl.new_value, tl.created_at, t.title
                 FROM task_logs tl JOIN tasks t ON tl.task_id = t.id
                 WHERE tl.action = 'escalated' AND ${ownerT.match}
                 ORDER BY tl.created_at DESC LIMIT 5`,
                ownerT.params
            ),
            // 8: Bookings created + by status
            pool.query(
                `SELECT status, COUNT(*)::int as count, COALESCE(SUM(price), 0)::int as revenue FROM bookings
                 WHERE created_by = $1 GROUP BY status`,
                [username]
            ),
            // 9: Top 3 programs
            pool.query(
                `SELECT program_name, COUNT(*)::int as count FROM bookings
                 WHERE created_by = $1 AND status != 'cancelled'
                 GROUP BY program_name ORDER BY count DESC LIMIT 3`,
                [username]
            ),
            // 10: Certificates issued WITH details
            pool.query(
                `SELECT id, cert_code, display_value, status, valid_until, used_at FROM certificates
                 WHERE issued_by_name = $1
                 ORDER BY created_at DESC LIMIT 10`,
                [username]
            ),
            // 11: Recent activity (last 20)
            pool.query(
                'SELECT action, data, created_at FROM history WHERE username = $1 ORDER BY created_at DESC LIMIT 20',
                [username]
            ),
            // 12: Recent point transactions (last 5) WITH task link
            pool.query(
                `SELECT pt.points, pt.type, pt.reason, pt.task_id, pt.created_at, t.title as task_title
                 FROM point_transactions pt
                 LEFT JOIN tasks t ON pt.task_id = t.id AND ${pointTaskBusinessCondition}
                 WHERE pt.username = $1 ORDER BY pt.created_at DESC LIMIT 5`,
                pointTaskParams
            ),
            // 13: Leaderboard rank — v19.12: use RANK() instead of fetching all users
            pool.query(
                `SELECT rank, total, total_users FROM (
                    SELECT username,
                           COALESCE(SUM(permanent_points), 0)::int as total,
                           RANK() OVER (ORDER BY COALESCE(SUM(permanent_points), 0) DESC) as rank,
                           COUNT(*) OVER () as total_users
                    FROM user_points GROUP BY username
                 ) lb WHERE username = $1`,
                [username]
            ),
            // 14: My tasks list (active, last 15)
            pool.query(
                `SELECT id, title, status, priority, deadline, scheduled_start_at, scheduled_end_at, schedule_slot, schedule_status, category, dependency_ids,
                        task_mode, task_kind, visibility, workflow_state, focus_rank, remind_at, snoozed_until
                 FROM tasks
                 WHERE ${ownerWhere} AND status != 'done'
                 ORDER BY ${canonicalTaskOrderSql('tasks')},
                  CASE WHEN deadline IS NOT NULL AND deadline < NOW() THEN 0 ELSE 1 END,
                  CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  deadline ASC NULLS LAST
                 LIMIT 15`,
                ownerParams
            ),
            // 15: Today's shift (match user to staff by name)
            pool.query(
                `SELECT ss.shift_start, ss.shift_end, ss.status, ss.note, s.name, s.department, s.position,
                        COALESCE((
                            SELECT jsonb_agg(jsonb_build_object(
                                'id', hss.id,
                                'professionKey', hss.profession_key,
                                'start', LEFT(hss.planned_start::text, 5),
                                'end', LEFT(hss.planned_end::text, 5),
                                'segmentId', hss.id,
                                'additionalRoles', COALESCE((
                                    SELECT jsonb_agg(jsonb_build_object(
                                        'professionKey', hssr.profession_key,
                                    'compensationMode', hssr.compensation_mode,
                                    'payMultiplier', hssr.pay_multiplier,
                                    'policyVersion', hssr.policy_version,
                                    'countsAsPhysicalTime', false
                                    ) ORDER BY hssr.profession_key)
                                    FROM hr_shift_segment_roles hssr
                                    WHERE hssr.segment_id = hss.id
                                ), '[]'::jsonb),
                                'additionalProfessionKeys', COALESCE((
                                    SELECT jsonb_agg(hssr.profession_key ORDER BY hssr.profession_key)
                                    FROM hr_shift_segment_roles hssr
                                    WHERE hssr.segment_id = hss.id
                                ), '[]'::jsonb),
                                'countsAsPhysicalTime', true,
                                'physicalTimeSource', 'segment'
                            ) ORDER BY hss.sort_order, hss.planned_start, hss.id)
                            FROM hr_shifts hs
                            JOIN hr_shift_segments hss ON hss.hr_shift_id = hs.id
                            WHERE hs.staff_id = ss.staff_id AND hs.shift_date = ss.date::date
                        ), '[]'::jsonb) AS segments
                 FROM staff_schedule ss JOIN staff s ON ss.staff_id = s.id
                 WHERE s.name = $1 AND ss.date = $2`,
                [user.name, today]
            ),
            // 16: Achievements
            pool.query(
                'SELECT achievement_key, unlocked_at FROM user_achievements WHERE username = $1 ORDER BY unlocked_at DESC',
                [username]
            ),
            // 17: Streak
            pool.query(
                'SELECT current_streak, longest_streak, last_active_date FROM user_streaks WHERE username = $1',
                [username]
            ),
            // 18: Delta — tasks done this week vs last week
            pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE completed_at >= $${ownerParams.length + 1}) ::int as this_week,
                    COUNT(*) FILTER (WHERE completed_at >= $${ownerParams.length + 2} AND completed_at < $${ownerParams.length + 1}) ::int as last_week
                 FROM tasks WHERE ${ownerWhere} AND status = 'done' AND completed_at IS NOT NULL`,
                [...ownerParams, weekAgo.toISOString(), twoWeeksAgo.toISOString()]
            ),
            // 19: Delta — bookings this week vs last week
            pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE created_at >= $2) ::int as this_week,
                    COUNT(*) FILTER (WHERE created_at >= $3 AND created_at < $2) ::int as last_week
                 FROM bookings WHERE created_by = $1`,
                [username, weekAgo.toISOString(), twoWeeksAgo.toISOString()]
            ),
            // 20: Team overview (admin only) — v19.12: LEFT JOIN instead of correlated subqueries
            isAdminRole ? pool.query(
                `SELECT u.username, u.name, u.role,
                    COALESCE(t_agg.open_tasks, 0)::int as open_tasks,
                    COALESCE(t_agg.overdue_tasks, 0)::int as overdue_tasks
                 FROM users u
                 LEFT JOIN (
                    SELECT owner_map.id AS user_id,
                           COUNT(*) FILTER (WHERE t.status != 'done') as open_tasks,
                           COUNT(*) FILTER (WHERE t.status != 'done' AND t.deadline IS NOT NULL AND t.deadline < NOW()) as overdue_tasks
                    FROM tasks t
                    JOIN users owner_map
                      ON owner_map.id = t.owner_user_id
                      OR (t.owner_user_id IS NULL AND (t.assigned_to = owner_map.username OR t.owner = owner_map.username))
                    WHERE COALESCE(t.visibility, 'team') = 'team'
                      AND ${teamTaskBusinessCondition}
                    GROUP BY owner_map.id
                 ) t_agg ON t_agg.user_id = u.id
                 WHERE u.role != 'viewer'
                 ORDER BY u.name`,
                teamTaskParams
            ) : Promise.resolve({ rows: [] }),
            // 21: Today's bookings count (for day progress)
            pool.query(
                `SELECT COUNT(*)::int as count FROM bookings WHERE date = $1 AND status != 'cancelled'`,
                [today]
            ),
            // 22: Today's tasks done count vs active workload for this user
            pool.query(
                `SELECT
                    COUNT(*) FILTER (
                        WHERE COALESCE(status, 'todo') = 'done'
                          AND completed_at IS NOT NULL
                          AND DATE(completed_at AT TIME ZONE 'Europe/Kyiv') = $${ownerParams.length + 1}::date
                    ) ::int as done_today,
                    COUNT(*) FILTER (
                        WHERE COALESCE(status, 'todo') NOT IN ('done','cancelled','archived')
                          AND (${profileTaskWorkloadDateSql('tasks')} = $${ownerParams.length + 1}::date OR ${profileTaskWorkloadDateSql('tasks')} IS NULL)
                    ) ::int as remaining
                 FROM tasks WHERE ${ownerWhere}
                `,
                [...ownerParams, today]
            ),
            // 23: Next scheduled working shift for this employee
            pool.query(
                `SELECT ss.date, ss.shift_start, ss.shift_end, ss.status, ss.note, s.name, s.department, s.position,
                        COALESCE((
                            SELECT jsonb_agg(jsonb_build_object(
                                'id', hss.id,
                                'professionKey', hss.profession_key,
                                'start', LEFT(hss.planned_start::text, 5),
                                'end', LEFT(hss.planned_end::text, 5),
                                'segmentId', hss.id,
                                'additionalRoles', COALESCE((
                                    SELECT jsonb_agg(jsonb_build_object(
                                        'professionKey', hssr.profession_key,
                                        'compensationMode', hssr.compensation_mode,
                                        'payMultiplier', hssr.pay_multiplier,
                                        'policyVersion', hssr.policy_version
                                    ) ORDER BY hssr.profession_key)
                                    FROM hr_shift_segment_roles hssr
                                    WHERE hssr.segment_id = hss.id
                                ), '[]'::jsonb),
                                'additionalProfessionKeys', COALESCE((
                                    SELECT jsonb_agg(hssr.profession_key ORDER BY hssr.profession_key)
                                    FROM hr_shift_segment_roles hssr
                                    WHERE hssr.segment_id = hss.id
                                ), '[]'::jsonb)
                            ) ORDER BY hss.sort_order, hss.planned_start, hss.id)
                            FROM hr_shifts hs
                            JOIN hr_shift_segments hss ON hss.hr_shift_id = hs.id
                            WHERE hs.staff_id = ss.staff_id AND hs.shift_date = ss.date::date
                        ), '[]'::jsonb) AS segments
                 FROM staff_schedule ss JOIN staff s ON ss.staff_id = s.id
                 WHERE s.name = $1
                   AND ss.date::date >= $2::date
                   AND COALESCE(ss.status, 'working') NOT IN ('day_off', 'vacation', 'sick', 'absent', 'no_show')
                   AND ss.shift_start IS NOT NULL
                 ORDER BY ss.date::date ASC, ss.shift_start ASC
                 LIMIT 1`,
                [user.name, today]
            ),
            // 24: Certificate total for profile cockpit, not just the recent list size
            pool.query(
                `SELECT COUNT(*)::int AS total
                 FROM certificates
                 WHERE issued_by_name = $1`,
                [username]
            ),
            // 25: Staff profile bridge for profession-centered profile surface
            pool.query(
                `SELECT s.id, ep.id AS employee_profile_id, s.name, s.department, s.position,
                        s.role_type, COALESCE(s.secondary_professions, '[]'::jsonb) AS secondary_professions,
                        s.phone, ep.role AS profile_role, ep.department AS profile_department, ep.full_name
                 FROM staff s
                 LEFT JOIN employee_profiles ep
                   ON ep.staff_id = s.id
                  AND ep.user_id = $1
                  AND COALESCE(ep.is_active, true) = true
                 WHERE ep.user_id = $1
                    OR LOWER(s.name) = LOWER($2)
                 ORDER BY CASE WHEN ep.user_id = $1 THEN 0 ELSE 1 END,
                          COALESCE(s.is_active, true) DESC,
                          s.id
                 LIMIT 1`,
                [user.id, user.name || user.display_name || username]
            ),
            // 26: Active HR profession catalog for profile cards and checklist previews
            pool.query(
                `SELECT id, key, title, department, short_info, responsibilities, checklist,
                        color, sort_order, is_active
                 FROM hr_professions
                 WHERE is_active = true
                 ORDER BY sort_order ASC, title ASC`
            ),
            // 27: Completed work units (parent tasks + completed subtasks)
            pool.query(
                `SELECT
                    COUNT(*) FILTER (WHERE COALESCE(tasks.status, 'todo') = 'done')::int AS parent_done_total,
                    COUNT(*) FILTER (
                        WHERE COALESCE(tasks.status, 'todo') = 'done'
                          AND tasks.completed_at IS NOT NULL
                          AND DATE(tasks.completed_at AT TIME ZONE 'Europe/Kyiv') = ${completedUnitTodayRef}::date
                    )::int AS parent_done_today,
                    COUNT(*) FILTER (
                        WHERE COALESCE(tasks.status, 'todo') = 'done'
                          AND tasks.completed_at IS NOT NULL
                          AND tasks.completed_at >= ${completedUnitWeekAgoRef}
                    )::int AS parent_done_this_week,
                    COUNT(*) FILTER (
                        WHERE COALESCE(tasks.status, 'todo') = 'done'
                          AND tasks.completed_at IS NOT NULL
                          AND tasks.completed_at >= ${completedUnitTwoWeeksAgoRef}
                          AND tasks.completed_at < ${completedUnitWeekAgoRef}
                    )::int AS parent_done_last_week,
                    COALESCE(SUM(COALESCE(st.done_total, 0)), 0)::int AS subtask_done_total,
                    COALESCE(SUM(COALESCE(st.done_today, 0)), 0)::int AS subtask_done_today,
                    COALESCE(SUM(COALESCE(st.done_this_week, 0)), 0)::int AS subtask_done_this_week,
                    COALESCE(SUM(COALESCE(st.done_last_week, 0)), 0)::int AS subtask_done_last_week
                 FROM tasks
                 LEFT JOIN (
                    SELECT task_id,
                           COUNT(*) FILTER (WHERE is_done = true)::int AS done_total,
                           COUNT(*) FILTER (
                               WHERE is_done = true
                                 AND completed_at IS NOT NULL
                                 AND DATE(completed_at AT TIME ZONE 'Europe/Kyiv') = ${completedUnitTodayRef}::date
                           )::int AS done_today,
                           COUNT(*) FILTER (
                               WHERE is_done = true
                                 AND completed_at IS NOT NULL
                                 AND completed_at >= ${completedUnitWeekAgoRef}
                           )::int AS done_this_week,
                           COUNT(*) FILTER (
                               WHERE is_done = true
                                 AND completed_at IS NOT NULL
                                 AND completed_at >= ${completedUnitTwoWeeksAgoRef}
                                 AND completed_at < ${completedUnitWeekAgoRef}
                           )::int AS done_last_week
                    FROM task_subtasks
                    GROUP BY task_id
                 ) st ON st.task_id = tasks.id
                 WHERE ${ownerWhere}`,
                completedUnitParams
            )
        ]);

        // Helper: safely get result
        const get = (idx) => results[idx].status === 'fulfilled' ? results[idx].value : null;

        // Points
        let points = { monthly_points: 0, permanent_points: 0, permanent_total: 0 };
        const pointsR = get(0);
        if (pointsR && pointsR.rows.length > 0) {
            points.monthly_points = pointsR.rows[0].monthly_points;
            points.permanent_points = pointsR.rows[0].permanent_points;
        }
        const permR = get(1);
        if (permR && permR.rows.length > 0) {
            points.permanent_total = parseInt(permR.rows[0].total);
        }

        // Tasks stats
        let tasks = { assigned: 0, done: 0, in_progress: 0, total: 0 };
        const taskR = get(2);
        if (taskR) {
            taskR.rows.forEach(r => {
                if (r.status === 'done') tasks.done = r.count;
                else if (r.status === 'in_progress') tasks.in_progress = r.count;
                else if (r.status === 'todo') tasks.assigned += r.count;
            });
        }
        const completedUnitR = get(27);
        const completedUnits = completedUnitR?.rows?.[0] || {};
        const parentDoneTotal = Number(completedUnits.parent_done_total || tasks.done || 0);
        const subtaskDoneTotal = Number(completedUnits.subtask_done_total || 0);
        tasks.parentDone = parentDoneTotal;
        tasks.completedParentTasks = parentDoneTotal;
        tasks.subtasksDone = subtaskDoneTotal;
        tasks.completedSubtasks = subtaskDoneTotal;
        tasks.completedUnits = parentDoneTotal + subtaskDoneTotal;
        tasks.completedMetricContract = 'completed_units = completed_parent_tasks + completed_subtasks';
        tasks.done = tasks.completedUnits;
        tasks.total = tasks.assigned + tasks.in_progress + tasks.done;

        // Overdue tasks with details
        const overdueR = get(3);
        tasks.overdueList = overdueR ? overdueR.rows.map(r => ({
            id: r.id, title: r.title, deadline: r.deadline, priority: r.priority, category: r.category
        })) : [];
        tasks.overdue = tasks.overdueList.length;

        // Upcoming deadlines (48h)
        const upcomingR = get(4);
        tasks.upcoming = upcomingR ? upcomingR.rows.map(r => ({
            id: r.id, title: r.title, deadline: r.deadline, priority: r.priority, category: r.category, status: r.status
        })) : [];

        // Tasks by category
        const catR = get(5);
        tasks.byCategory = catR ? catR.rows : [];

        // Avg completion time
        const avgR = get(6);
        tasks.avgCompletionHours = avgR && avgR.rows[0].avg_hours ? parseFloat(avgR.rows[0].avg_hours) : null;

        // Escalation history (not just count)
        const escR = get(7);
        tasks.escalations = escR ? escR.rows.length : 0;
        tasks.escalationHistory = escR ? escR.rows.map(r => ({
            taskId: r.task_id, title: r.title, from: r.old_value, to: r.new_value, at: r.created_at
        })) : [];

        // Bookings
        let bookings = { total: 0, byStatus: {}, revenue: 0, topPrograms: [] };
        const bkR = get(8);
        if (bkR) {
            bkR.rows.forEach(r => {
                bookings.byStatus[r.status] = r.count;
                if (r.status !== 'cancelled') {
                    bookings.total += r.count;
                    bookings.revenue += r.revenue;
                }
            });
        }
        const topR = get(9);
        bookings.topPrograms = topR ? topR.rows : [];

        // Certificates with details
        let certificates = { total: 0, byStatus: {}, recentList: [] };
        const certR = get(10);
        if (certR) {
            certR.rows.forEach(r => {
                certificates.byStatus[r.status] = (certificates.byStatus[r.status] || 0) + 1;
                certificates.total += 1;
            });
            certificates.recentList = certR.rows.map(r => ({
                id: r.id, code: r.cert_code, name: r.display_value,
                status: r.status, validUntil: r.valid_until, usedAt: r.used_at
            }));
        }
        const certTotalR = get(24);
        if (certTotalR && certTotalR.rows[0]) {
            certificates.total = Number(certTotalR.rows[0].total || 0);
        }

        const staffProfileR = get(25);
        const staffProfile = normalizeProfileStaffProfile(staffProfileR?.rows?.[0] || null);
        const professionCatalogR = get(26);
        const professionCatalog = professionCatalogR
            ? curateProfessionCatalogRows(professionCatalogR.rows)
            : [];

        // Recent activity
        const histR = get(11);
        const recentActivity = histR ? histR.rows : [];

        // Point transactions with task link
        const ptR = get(12);
        const pointTransactions = ptR ? ptR.rows.map(r => ({
            points: r.points, type: r.type, reason: r.reason,
            taskId: r.task_id, taskTitle: r.task_title, created_at: r.created_at
        })) : [];

        // Leaderboard rank — v19.12: optimized with RANK()
        let leaderboardRank = null;
        let leaderboardTotal = 0;
        const lbR = get(13);
        if (lbR && lbR.rows.length > 0) {
            leaderboardRank = parseInt(lbR.rows[0].rank);
            leaderboardTotal = parseInt(lbR.rows[0].total_users);
        }

        // My active tasks (with dependency blocking info)
        const myTasksR = get(14);
        const allTaskIds = myTasksR ? myTasksR.rows.map(t => t.id) : [];
        const myTasks = myTasksR ? myTasksR.rows.map(t => {
            const deps = t.dependency_ids || [];
            const isBlocked = deps.length > 0 && deps.some(d => allTaskIds.includes(d));
            return {
                id: t.id, title: t.title, status: t.status, priority: t.priority,
                deadline: t.deadline,
                scheduledStartAt: t.scheduled_start_at,
                scheduledEndAt: t.scheduled_end_at,
                scheduleSlot: t.schedule_slot,
                scheduleStatus: t.schedule_status,
                category: t.category,
                isOverdue: (t.scheduled_end_at || t.deadline) && new Date(t.scheduled_end_at || t.deadline) < now,
                isBlocked
            };
        }) : [];

        // Today's shift
        const shiftR = get(15);
        const todayShift = shiftR && shiftR.rows.length > 0 ? {
            date: today,
            start: shiftR.rows[0].shift_start,
            end: shiftR.rows[0].shift_end,
            status: shiftR.rows[0].status,
            note: shiftR.rows[0].note,
            department: shiftR.rows[0].department,
            position: shiftR.rows[0].position,
            segments: shiftR.rows[0].segments || [],
            blocks: shiftR.rows[0].segments || []
        } : null;

        const nextShiftR = get(23);
        const nextShift = nextShiftR && nextShiftR.rows.length > 0 ? {
            date: nextShiftR.rows[0].date,
            start: nextShiftR.rows[0].shift_start,
            end: nextShiftR.rows[0].shift_end,
            status: nextShiftR.rows[0].status,
            note: nextShiftR.rows[0].note,
            department: nextShiftR.rows[0].department,
            position: nextShiftR.rows[0].position,
            segments: nextShiftR.rows[0].segments || [],
            blocks: nextShiftR.rows[0].segments || []
        } : null;

        // Achievements
        const achR = get(16);
        const unlockedAchievements = achR ? achR.rows.map(r => ({
            key: r.achievement_key, at: r.unlocked_at
        })) : [];

        // Streak
        const streakR = get(17);
        const streak = streakR && streakR.rows.length > 0 ? {
            current: streakR.rows[0].current_streak,
            longest: streakR.rows[0].longest_streak,
            lastActiveDate: streakR.rows[0].last_active_date
        } : { current: 0, longest: 0, lastActiveDate: null };

        // Deltas
        const deltaTasksR = get(18);
        const deltaBkR = get(19);
        const parentThisWeek = Number(completedUnits.parent_done_this_week ?? deltaTasksR?.rows?.[0]?.this_week ?? 0);
        const parentLastWeek = Number(completedUnits.parent_done_last_week ?? deltaTasksR?.rows?.[0]?.last_week ?? 0);
        const subtaskThisWeek = Number(completedUnits.subtask_done_this_week || 0);
        const subtaskLastWeek = Number(completedUnits.subtask_done_last_week || 0);
        const deltas = {
            tasksDone: {
                thisWeek: parentThisWeek + subtaskThisWeek,
                lastWeek: parentLastWeek + subtaskLastWeek,
                parentThisWeek,
                parentLastWeek,
                subtaskThisWeek,
                subtaskLastWeek,
                completedMetricContract: tasks.completedMetricContract
            },
            bookings: deltaBkR ? { thisWeek: deltaBkR.rows[0].this_week, lastWeek: deltaBkR.rows[0].last_week } : null
        };

        // Team overview (admin)
        const teamR = get(20);
        const team = teamR ? teamR.rows.map(r => ({
            username: r.username, name: r.name, role: r.role,
            openTasks: r.open_tasks, overdueTasks: r.overdue_tasks
        })) : [];

        // Day progress
        const dayBkR = get(21);
        const dayTasksR = get(22);
        const parentDoneToday = Number(completedUnits.parent_done_today ?? dayTasksR?.rows?.[0]?.done_today ?? 0);
        const subtaskDoneToday = Number(completedUnits.subtask_done_today || 0);
        const dayProgress = {
            bookingsToday: dayBkR ? dayBkR.rows[0].count : 0,
            tasksDoneToday: parentDoneToday + subtaskDoneToday,
            taskParentsDoneToday: parentDoneToday,
            subtasksDoneToday: subtaskDoneToday,
            tasksRemaining: dayTasksR ? dayTasksR.rows[0].remaining : 0,
            completedMetricContract: tasks.completedMetricContract
        };

        // Auto-check achievements
        await _checkAndGrantAchievements(username, { tasks, bookings, streak, points });

        const profilePayload = {
            user: {
                username: user.username,
                name: user.name,
                role: user.role,
                createdAt: user.created_at,
                displayName: user.display_name || user.name,
                bio: user.bio || '',
                telegramConnected: !!user.telegram_chat_id,
                ...userAvatarPayload(user)
            },
            points: {
                monthly: points.monthly_points,
                permanentThisMonth: points.permanent_points,
                permanentTotal: points.permanent_total || 0,
                month
            },
            pointTransactions,
            leaderboard: { rank: leaderboardRank, total: leaderboardTotal },
            tasks,
            myTasks,
            bookings,
            certificates,
            recentActivity,
            todayShift,
            nextShift,
            achievements: unlockedAchievements,
            streak,
            deltas,
            team: isAdminRole ? team : [],
            dayProgress,
            staffProfile,
            professionCatalog,
            profilePreferences: {
                cockpitWidgets: normalizeProfileCockpitWidgets(user.profile_cockpit_widgets)
            },
            showRevenue: canViewRevenue
        };
        res.json(shapeRevenuePayload(profilePayload, canViewRevenue));
    } catch (err) {
        log.error('Profile error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/auth/profile/avatar — update own CRM avatar for profile/header/sidebar
router.patch('/profile/avatar', authenticateToken, async (req, res) => {
    try {
        const avatarType = ['emoji', 'image', 'initials'].includes(req.body.avatarType)
            ? req.body.avatarType
            : 'initials';
        const colorRaw = String(req.body.avatarColor || req.body.avatar_color || '').trim();
        const avatarColor = /^#[0-9a-f]{6}$/i.test(colorRaw) ? colorRaw : '#f59e0b';
        const emojiRaw = String(req.body.avatarEmoji || req.body.avatar_emoji || '').trim();
        const avatarEmoji = emojiRaw ? Array.from(emojiRaw).slice(0, 4).join('') : null;
        const urlRaw = String(req.body.avatarUrl || req.body.avatar_url || '').trim();
        const avatarUrl = urlRaw || null;

        if (avatarType === 'image') {
            if (!avatarUrl) return res.status(400).json({ error: 'Додайте URL фото' });
            if (avatarUrl.length > 500 || !/^https?:\/\//i.test(avatarUrl)) {
                return res.status(400).json({ error: 'Фото має бути https/http URL до 500 символів' });
            }
        }
        if (avatarType === 'emoji' && !avatarEmoji) {
            return res.status(400).json({ error: 'Оберіть emoji для аватарки' });
        }

        const finalEmoji = avatarType === 'emoji' ? avatarEmoji : null;
        const finalColor = avatarType === 'image' ? null : avatarColor;
        const finalUrl = avatarType === 'image' ? avatarUrl : null;
        const avatarStyle = avatarType === 'image' ? 'photo' : avatarType;

        await pool.query(
            `INSERT INTO user_profiles_ext (username, avatar_url, avatar_style)
             VALUES ($1, $2, $3)
             ON CONFLICT (username) DO UPDATE
             SET avatar_url = EXCLUDED.avatar_url,
                 avatar_style = EXCLUDED.avatar_style,
                 updated_at = NOW()`,
            [req.user.username, finalUrl, avatarStyle]
        );
        await pool.query(
            `UPDATE users
             SET avatar_emoji = $1,
                 avatar_color = $2
             WHERE username = $3`,
            [finalEmoji, finalColor, req.user.username]
        );

        const { rows: [user] } = await client.query(
            `SELECT u.id, u.username, u.name, u.role, u.avatar_emoji, u.avatar_color, upe.avatar_url
             FROM users u
             LEFT JOIN user_profiles_ext upe ON upe.username = u.username
             WHERE u.username = $1`,
            [req.user.username]
        );
        res.json({
            success: true,
            user: { id: user.id, username: user.username, name: user.name, role: user.role, ...userAvatarPayload(user) }
        });
    } catch (err) {
        log.error('Update profile avatar error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.patch('/profile/cockpit-widgets', authenticateToken, async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ error: 'Unauthenticated' });
        const widgets = normalizeProfileCockpitWidgets(req.body?.widgets);
        const { rows: [profile] } = await pool.query(
            `INSERT INTO user_profiles_ext (username, profile_cockpit_widgets)
             VALUES ($1, $2::jsonb)
             ON CONFLICT (username)
             DO UPDATE SET profile_cockpit_widgets = EXCLUDED.profile_cockpit_widgets,
                           updated_at = NOW()
             RETURNING profile_cockpit_widgets`,
            [username, JSON.stringify(widgets)]
        );
        res.json({
            success: true,
            widgets: normalizeProfileCockpitWidgets(profile?.profile_cockpit_widgets)
        });
    } catch (err) {
        log.error('Profile cockpit widget preferences update error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/profile/avatar/upload - upload own profile photo from device
router.post('/profile/avatar/upload', authenticateToken, handleProfileAvatarUpload, async (req, res) => {
    let client;
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Оберіть фото профілю' });
        }

        client = await pool.connect();
        await client.query('BEGIN');

        const stored = await uploadProfileAvatarWithFallback(req.file, {
            username: req.user.username,
            userId: req.user.id,
            query: client
        });

        await client.query(
            `INSERT INTO user_profiles_ext (username, avatar_url, avatar_style)
             VALUES ($1, $2, 'photo')
             ON CONFLICT (username) DO UPDATE
             SET avatar_url = EXCLUDED.avatar_url,
                 avatar_style = EXCLUDED.avatar_style,
                 updated_at = NOW()`,
            [req.user.username, stored.publicUrl]
        );
        await client.query(
            `UPDATE users
             SET avatar_emoji = NULL,
                 avatar_color = NULL
             WHERE username = $1`,
            [req.user.username]
        );

        const { rows: [user] } = await client.query(
            `SELECT u.id, u.username, u.name, u.role, u.avatar_emoji, u.avatar_color, upe.avatar_url
             FROM users u
             LEFT JOIN user_profiles_ext upe ON upe.username = u.username
             WHERE u.username = $1`,
            [req.user.username]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            storage: {
                provider: stored.provider,
                bucket: stored.bucket,
                key: stored.key,
                contentType: stored.contentType
            },
            user: { id: user.id, username: user.username, name: user.name, role: user.role, ...userAvatarPayload(user) }
        });
    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch {}
        }
        const status = err.statusCode || 500;
        log.error('Upload profile avatar error', err);
        res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
    } finally {
        if (client) client.release();
    }
});

// v10.6: Achievement definitions
const ACHIEVEMENTS = {
    first_task: { title: 'Перша задача', desc: 'Завершити першу задачу', icon: '🎯' },
    task_master_10: { title: 'Майстер задач', desc: 'Завершити 10 задач', icon: '🏆' },
    task_master_50: { title: 'Легенда задач', desc: 'Завершити 50 задач', icon: '👑' },
    speed_demon: { title: 'Швидкий як вітер', desc: 'Середній час виконання < 2 год', icon: '⚡' },
    booking_pro: { title: 'Бронювання Pro', desc: 'Створити 20+ бронювань', icon: '📅' },
    streak_3: { title: 'Стрік 3 дні', desc: 'Активність 3 дні поспіль', icon: '🔥' },
    streak_7: { title: 'Тижневий стрік', desc: 'Активність 7 днів поспіль', icon: '🔥🔥' },
    streak_30: { title: 'Місячний стрік', desc: 'Активність 30 днів поспіль', icon: '💎🔥' },
    zero_overdue: { title: 'Все вчасно', desc: 'Жодної простроченої задачі', icon: '✅' },
    point_collector: { title: 'Збирач балів', desc: 'Набрати 100+ постійних балів', icon: '💰' },
    no_escalation: { title: 'Без ескалацій', desc: 'Жодної ескалації за місяць', icon: '🛡️' },
    early_bird: { title: 'Рання пташка', desc: 'Завершити задачу до 09:00', icon: '🐦' }
};

// Auto-grant achievements based on current stats
async function _checkAndGrantAchievements(username, stats) {
    const checks = [];
    if (stats.tasks.done >= 1) checks.push('first_task');
    if (stats.tasks.done >= 10) checks.push('task_master_10');
    if (stats.tasks.done >= 50) checks.push('task_master_50');
    if (stats.tasks.avgCompletionHours !== null && stats.tasks.avgCompletionHours < 2) checks.push('speed_demon');
    if (stats.bookings.total >= 20) checks.push('booking_pro');
    if (stats.streak.current >= 3) checks.push('streak_3');
    if (stats.streak.current >= 7) checks.push('streak_7');
    if (stats.streak.current >= 30) checks.push('streak_30');
    if (stats.tasks.done > 0 && stats.tasks.overdue === 0) checks.push('zero_overdue');
    if (stats.points.permanent_total >= 100) checks.push('point_collector');
    if (stats.tasks.done > 0 && stats.tasks.escalations === 0) checks.push('no_escalation');

    for (const key of checks) {
        try {
            await pool.query(
                'INSERT INTO user_achievements (username, achievement_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [username, key]
            );
        } catch { /* ignore */ }
    }
}

// v10.6: Achievement definitions endpoint (for UI)
router.get('/achievements', authenticateToken, (req, res) => {
    res.json(ACHIEVEMENTS);
});

// v10.6: User action log — track UI clicks/navigations
router.post('/log-action', authenticateToken, async (req, res) => {
    try {
        const { action, target, meta } = req.body;
        if (!action) return res.status(400).json({ error: 'Action required' });
        await pool.query(
            'INSERT INTO user_action_log (username, action, target, meta) VALUES ($1, $2, $3, $4)',
            [req.user.username, action.substring(0, 50), (target || '').substring(0, 100), meta || null]
        );
        // Update streak
        const today = new Date().toISOString().split('T')[0];
        const streakResult = await pool.query(
            'SELECT current_streak, last_active_date FROM user_streaks WHERE username = $1',
            [req.user.username]
        );
        if (streakResult.rows.length === 0) {
            await pool.query(
                'INSERT INTO user_streaks (username, current_streak, longest_streak, last_active_date) VALUES ($1, 1, 1, $2)',
                [req.user.username, today]
            );
        } else {
            const s = streakResult.rows[0];
            if (s.last_active_date !== today) {
                const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = yesterday.toISOString().split('T')[0];
                let newStreak = s.last_active_date === yesterdayStr ? s.current_streak + 1 : 1;
                await pool.query(
                    `UPDATE user_streaks SET current_streak = $1, longest_streak = GREATEST(longest_streak, $1),
                     last_active_date = $2, updated_at = NOW() WHERE username = $3`,
                    [newStreak, today, req.user.username]
                );
            }
        }
        res.json({ ok: true });
    } catch (err) {
        log.error('Log action error', err);
        res.json({ ok: true }); // Don't fail the client for logging errors
    }
});

// v10.6: Quick task status change from profile
router.patch('/tasks/:id/quick-status', authenticateToken, async (req, res) => {
    try {
        const businessScope = resolveBusinessScope(req);
        if (!requireWritableBusinessScope(req, res, businessScope)) return;
        const { id } = req.params;
        const { status } = req.body;
        if (!['todo', 'in_progress', 'done'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const taskParams = [parseInt(id)];
        const taskBusinessCondition = pushBusinessScopeCondition(taskParams, businessScope, 'tasks');
        const task = await pool.query(
            `SELECT *
             FROM tasks
             WHERE id = $1 AND ${taskBusinessCondition}`,
            taskParams
        );
        if (task.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
        const t = task.rows[0];
        // Only assigned user, owner, or admin can change status
        const userId = normalizeUserId(req.user);
        const typedOwnerId = Number(t.owner_user_id || 0);
        const canChange = (typedOwnerId > 0 && userId === typedOwnerId)
            || (!typedOwnerId && (t.assigned_to === req.user.username || t.owner === req.user.username))
            || ['creator', 'director', 'vice_director', 'senior_manager', 'admin'].includes(req.user.role);
        if (!canChange) return res.status(403).json({ error: 'Недостатньо прав' });

        if (!canMutateTask(req.user, t)) return res.status(403).json({ error: 'Insufficient task permissions' });

        const oldStatus = t.status;
        const updateParams = [status, parseInt(id)];
        const updateBusinessCondition = pushBusinessScopeCondition(updateParams, businessScope, 'tasks');
        const update = await pool.query(
            `UPDATE tasks
             SET status = $1,
                 workflow_state = CASE WHEN $1 = 'done' THEN 'done' WHEN $1 = 'in_progress' THEN 'in_progress' ELSE COALESCE(NULLIF(workflow_state, 'done'), 'todo') END,
                 schedule_status = CASE WHEN $1 = 'done' AND scheduled_start_at IS NOT NULL THEN 'completed' WHEN $1 <> 'done' AND scheduled_start_at IS NOT NULL AND schedule_status = 'completed' THEN 'scheduled' ELSE schedule_status END,
                 completed_at = CASE WHEN $1 = 'done' THEN NOW() ELSE NULL END,
                 updated_at = NOW(),
                 version = COALESCE(version, 1) + 1
             WHERE id = $2 AND ${updateBusinessCondition}
             RETURNING *`,
            updateParams
        );
        const updatedTask = update.rows[0] || null;
        if (!updatedTask) return res.status(404).json({ error: 'Task not found' });
        // Legacy task_logs must not break the status mutation.
        try {
            await pool.query(
                'INSERT INTO task_logs (task_id, action, old_value, new_value, actor) VALUES ($1, $2, $3, $4, $5)',
                [parseInt(id), 'status_change', oldStatus, status, req.user.username]
            );
        } catch (logErr) {
            log.warn(`Quick task status legacy log skipped: ${logErr.message}`);
        }
        let historyEvent = null;
        try {
            historyEvent = await logTaskActionEvent({
                taskId: parseInt(id, 10),
                actionType: TASK_ACTION_TYPES.STATUS_CHANGED,
                actor: req.user,
                sourceSurface: 'profile_my_cabinet',
                oldValue: { status: oldStatus },
                newValue: { status },
                meta: {
                    route: 'auth_tasks_quick_status',
                    canonicalField: 'tasks.status',
                    legacyLog: 'task_logs'
                }
            });
        } catch (historyErr) {
            log.warn(`Quick task status history skipped: ${historyErr.message}`);
        }
        log.info(`Task #${id} status: ${oldStatus} → ${status} by ${req.user.username}`);
        res.json({
            success: true,
            oldStatus,
            newStatus: status,
            task: updatedTask,
            historyEvent,
            meta: {
                durableMutation: true,
                canonicalField: 'tasks.status',
                legacyRoute: true
            }
        });
    } catch (err) {
        log.error('Quick task status error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v10.6: User action log — recent actions
router.get('/action-log', authenticateToken, async (req, res) => {
    try {
        const isAdminRole = req.user.role === 'admin';
        const targetUser = isAdminRole && req.query.user ? req.query.user : req.user.username;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;
        const result = await pool.query(
            `SELECT action, target, meta, created_at FROM user_action_log
             WHERE username = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [targetUser, limit, offset]
        );
        const countR = await pool.query(
            'SELECT COUNT(*)::int as total FROM user_action_log WHERE username = $1',
            [targetUser]
        );
        res.json(shapeRevenuePayload(
            { items: result.rows, total: countR.rows[0].total },
            canUseAction(req.user, 'view_revenue')
        ));
    } catch (err) {
        log.error('Action log error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v10.4: Change password
router.put('/password', authenticateToken, async (req, res) => {
    try {
        const currentPassword = req.body?.currentPassword;
        const newPassword = normalizeManualPassword(req.body?.newPassword);
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Введіть поточний і новий паролі' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Новий пароль має бути не менше 6 символів' });
        }

        const result = await pool.query(
            'SELECT password_hash FROM users WHERE username = $1',
            [req.user.username]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        const valid = await uniquePasswordCandidates(currentPassword).reduce(async (matchedPromise, candidate) => {
            if (await matchedPromise) return true;
            return bcrypt.compare(candidate, result.rows[0].password_hash || '').catch(() => false);
        }, Promise.resolve(false));
        if (!valid) {
            return res.status(401).json({ error: 'Невірний поточний пароль' });
        }

        const hash = await bcrypt.hash(newPassword, 10);
        const updated = await pool.query(
            `UPDATE users
             SET password_hash = $1,
                 password_changed_at = NOW()
             WHERE username = $2
             RETURNING id, username`,
            [hash, req.user.username]
        );

        await recordAccountSecurityEvent({
            actor: req.user,
            target: updated.rows[0] || req.user,
            eventType: 'password_changed',
            reason: 'self_service',
            req
        });

        log.info(`User "${req.user.username}" changed password`);
        res.json({ success: true });
    } catch (err) {
        log.error('Password change error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Personal cabinet: account security summary, active sessions and recent account audit
router.get('/security', authenticateToken, async (req, res) => {
    try {
        const userResult = await pool.query(
            `SELECT id, username, name, role, created_at, last_seen_at, password_changed_at, session_revoked_at
             FROM users
             WHERE id = $1 AND is_active = true`,
            [req.user.id]
        );
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        const sessionsResult = await pool.query(
            `SELECT id, device_info, ip_address, created_at, expires_at
             FROM refresh_tokens
             WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 20`,
            [req.user.id]
        );
        const eventLimit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 50);
        const events = await listAccountSecurityEvents(req.user.id, eventLimit);

        res.json({
            user: userResult.rows[0],
            sessions: sessionsResult.rows,
            events
        });
    } catch (err) {
        log.error('Security summary error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Personal cabinet: revoke all sessions and force current device to log in again
router.post('/security/revoke-sessions', authenticateToken, async (req, res) => {
    try {
        await pool.query('UPDATE users SET session_revoked_at = NOW() WHERE id = $1', [req.user.id]);
        await revokeAllUserTokens(req.user.id);
        await recordAccountSecurityEvent({
            actor: req.user,
            target: req.user,
            eventType: 'sessions_revoked',
            reason: 'self_service',
            details: { scope: 'all_devices' },
            req
        });
        log.info(`All sessions revoked from personal cabinet for user "${req.user.username}"`);
        res.json({ success: true, reloginRequired: true });
    } catch (err) {
        log.error('Revoke own sessions error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v22.18.0: RBAC — return user permissions for frontend enforcement
router.get('/permissions', authenticateToken, (req, res) => {
    const role = req.user.role;
    const roles = normalizeRoleList(req.user);
    const pageAllowlist = normalizePageAllowlist(req.user);
    const pageDenylist = normalizePageDenylist(req.user);
    const level = roles.reduce((max, item) => Math.max(max, ROLE_LEVEL[item] ?? -1), -1);
    const snapshot = buildCapabilitySnapshot(req.user);
    const pageSources = {};
    const actionSources = {};

    for (const page of Object.keys(PAGE_ACCESS)) {
        const canonicalPage = snapshot.catalog.pageAliases[page] || page;
        pageSources[page] = snapshot.decisions[`page:${canonicalPage}`]?.source || 'default_deny';
    }
    for (const action of Object.keys(ACTION_PERMISSIONS)) {
        actionSources[action] = snapshot.decisions[`action:${action}`]?.source || 'default_deny';
    }

    res.json({
        role,
        roles,
        pageAllowlist,
        pageDenylist,
        actionAllowlist: req.user.actionAllowlist || req.user.action_allowlist || [],
        actionDenylist: req.user.actionDenylist || req.user.action_denylist || [],
        level,
        pages: snapshot.pages,
        actions: snapshot.actions,
        pageSources,
        actionSources,
        capabilities: snapshot.decisions,
        capabilityCatalog: snapshot.catalog
    });
});

// v24.0.0: Impersonation — creator can get a temporary JWT for any user
router.post('/impersonate', authenticateToken, requireAction('manage_accounts'), async (req, res) => {
    try {
        if (process.env.DISABLE_IMPERSONATION === 'true') {
            return res.status(403).json({ error: 'Impersonation disabled' });
        }
        if (req.user.role !== 'creator') {
            return res.status(403).json({ error: 'Only creator can impersonate' });
        }
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });
        if (Number(userId) === Number(req.user.id)) {
            return res.status(409).json({ error: 'Self-impersonation is not allowed', code: 'SELF_IMPERSONATION_FORBIDDEN' });
        }

        const result = await pool.query(
            'SELECT id, username, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context, name, telegram_chat_id, is_active FROM users WHERE id = $1',
            [parseInt(userId)]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const target = result.rows[0];
        if (isProtectedSystemAccount(target)) {
            return res.status(403).json({ error: 'Protected system accounts cannot be impersonated', code: 'PROTECTED_SYSTEM_ACCOUNT' });
        }
        if (!target.is_active) return res.status(400).json({ error: 'User is deactivated' });

        const authUser = { ...buildAuthUserPayload(target), imp: true, impBy: req.user.username };
        const token = jwt.sign(authUser, JWT_SECRET, { expiresIn: '1h' });

        // Audit log
        try {
            await pool.query(
                `INSERT INTO admin_audit_log (admin_username, action, target_type, target_id, details)
                 VALUES ($1, $2, $3, $4, $5)`,
                [req.user.username, 'impersonation', 'user', target.id,
                 JSON.stringify({ targetUsername: target.username, targetRole: target.role })]
            );
        } catch (e) { log.warn('Audit log failed for impersonation', e.message); }

        await recordAccountSecurityEvent({
            actor: req.user,
            target,
            eventType: 'account_impersonation_started',
            reason: 'account_management',
            details: { targetRole: target.role, expiresIn: '1h' },
            req
        });

        log.info(`Impersonation: ${req.user.username} → ${target.username} (${target.role})`);
        res.json({ token, user: authUser });
    } catch (err) {
        log.error('Impersonate error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v24.0.0: Users list for impersonation dropdown — creator only
router.get('/users-list', authenticateToken, requireAction('manage_accounts'), async (req, res) => {
    try {
        if (req.user.role !== 'creator') {
            return res.status(403).json({ error: 'Only creator can list users' });
        }
        const result = await pool.query(
            'SELECT id, username, name, role, extra_roles, page_allowlist, page_denylist, action_allowlist, action_denylist, business_contexts, default_business_context FROM users WHERE is_active = true ORDER BY name'
        );
        res.json(result.rows.filter(user => !isProtectedSystemAccount(user)));
    } catch (err) {
        log.error('Users list error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// v38.4.0: Refresh token — rotate and get new access token
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

        const deviceInfo = req.headers['user-agent'] || '';
        const ipAddress = req.ip || req.connection?.remoteAddress;
        const result = await rotateRefreshToken(refreshToken, { deviceInfo, ipAddress });

        if (result.error) {
            log.warn(`Refresh failed: ${result.error}`);
            return res.status(result.status).json({ error: result.error });
        }

        log.info(`Token refreshed for user "${result.user.username}"`);
        res.json({
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            refreshExpiresAt: result.expiresAt,
            user: buildAuthUserPayload(result.user)
        });
    } catch (err) {
        log.error('Refresh error', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// v38.4.0: Logout — revoke refresh token
// Note: revoking a single refresh token without auth is safe — the 96-char token
// itself is a bearer credential; knowing it already proves possession.
router.post('/logout', async (req, res) => {
    try {
        const { refreshToken, allDevices } = req.body;

        if (!refreshToken && !allDevices) {
            return res.status(400).json({ error: 'refreshToken or allDevices required' });
        }

        if (allDevices) {
            // Need auth to logout all devices
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1];
            if (!token) return res.status(401).json({ error: 'Auth required for logout-all' });
            try {
                const user = jwt.verify(token, JWT_SECRET);
                await pool.query('UPDATE users SET session_revoked_at = NOW() WHERE id = $1', [user.id]);
                await revokeAllUserTokens(user.id);
                await recordAccountSecurityEvent({
                    actor: user,
                    target: user,
                    eventType: 'sessions_revoked',
                    reason: 'logout_all_devices',
                    details: { scope: 'all_devices' },
                    req
                });
                log.info(`All tokens revoked for user "${user.username}"`);
            } catch {
                return res.status(401).json({ error: 'Invalid token' });
            }
        } else if (refreshToken) {
            const revokedUser = await revokeRefreshToken(refreshToken);
            if (revokedUser) {
                await recordAccountSecurityEvent({
                    actor: revokedUser,
                    target: revokedUser,
                    eventType: 'session_logout',
                    reason: 'logout_current_device',
                    details: { scope: 'current_device' },
                    req
                });
            }
        }

        res.json({ success: true });
    } catch (err) {
        log.error('Logout error', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// v38.4.0: Active sessions — list user's active refresh tokens
router.get('/sessions', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, device_info, ip_address, created_at, expires_at
             FROM refresh_tokens
             WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
             ORDER BY created_at DESC`,
            [req.user.id]
        );
        res.json({ sessions: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
