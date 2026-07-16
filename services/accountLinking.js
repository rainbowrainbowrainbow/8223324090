'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { recordAccountSecurityEvent } = require('./accountSecurity');
const { LOGIN_IDENTITY_WHERE_SQL, normalizeLoginIdentifier } = require('./authIdentity');
const { uniquePasswordCandidates } = require('./credentialInput');

function appError(message, statusCode = 400, code = 'account_link_error', details = {}) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    err.details = details;
    return err;
}

function normalizePositiveInt(value, fieldName = 'id') {
    if (value === null || value === undefined || value === '') return null;
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw appError(`Некоректний ${fieldName}`, 400, 'invalid_id', { fieldName });
    }
    return parsed;
}

function normalizeUsername(value) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '.').replace(/\.+/g, '.').replace(/^\.+|\.+$/g, '').slice(0, 50);
}

function staffPersonKey(staff = {}) {
    return normalizeUsername(String(staff.unique_person_key || '').replace(/\.\w+$/, ''));
}

function suggestUsernameForStaff(staff = {}) {
    const fromKey = staffPersonKey(staff);
    if (fromKey) return fromKey;
    const fromName = normalizeUsername(staff.name || '');
    if (fromName && /[a-zA-Z]/.test(fromName)) return fromName;
    return `staff.${staff.id || Date.now()}`;
}

function generateOneTimePassword(length = 10) {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const bytes = crypto.randomBytes(length);
    let password = '';
    for (let i = 0; i < length; i += 1) {
        password += chars[bytes[i] % chars.length];
    }
    return password;
}

async function verifyIssuedCredential({ client = pool, username, password } = {}) {
    const loginIdentifier = normalizeLoginIdentifier(username);
    if (!loginIdentifier || !password) {
        return {
            loginReady: false,
            reason: 'missing_login_or_password',
            username: username || '',
            isActive: false
        };
    }

    const result = await client.query(
        `SELECT u.id, u.username, u.password_hash, u.is_active
         FROM users u
         WHERE ${LOGIN_IDENTITY_WHERE_SQL}
         ORDER BY CASE WHEN LOWER(u.username) = $1 THEN 0 ELSE 1 END
         LIMIT 1`,
        [loginIdentifier]
    );
    const user = result.rows[0] || null;
    const isActive = !!user && user.is_active !== false;
    const passwordMatches = isActive
        ? await uniquePasswordCandidates(password).reduce(async (matchedPromise, candidate) => {
            if (await matchedPromise) return true;
            return bcrypt.compare(candidate, user.password_hash || '').catch(() => false);
        }, Promise.resolve(false))
        : false;

    return {
        loginReady: Boolean(user && isActive && passwordMatches),
        reason: !user ? 'user_not_found' : (!isActive ? 'inactive_account' : (passwordMatches ? 'ready' : 'password_mismatch')),
        username: user?.username || username,
        isActive
    };
}

async function reserveUsernameIdentity(client, username, {
    statusCode = 409,
    code = 'account_identity_occupied',
    message = 'Акаунт або login alias з таким username вже існує'
} = {}) {
    const identity = normalizeLoginIdentifier(username);
    if (!identity) {
        throw appError('Некоректний username', 400, 'invalid_username_identity');
    }

    await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`eventgenix:account-username:${identity}`]
    );
    const existing = await client.query(
        `SELECT id, username
         FROM users
         WHERE LOWER(username) = $1
            OR EXISTS (
                SELECT 1
                FROM unnest(COALESCE(login_aliases, '{}'::text[])) AS alias(value)
                WHERE LOWER(TRIM(alias.value)) = $1
            )
         LIMIT 1`,
        [identity]
    );
    if (existing.rows.length > 0) {
        throw appError(message, statusCode, code, { identity });
    }
    return identity;
}

async function uniqueUsername(client, baseUsername) {
    const base = normalizeUsername(baseUsername) || `user.${Date.now()}`;
    let candidate = base.slice(0, 50);
    for (let i = 0; i < 50; i += 1) {
        try {
            await reserveUsernameIdentity(client, candidate);
            return candidate;
        } catch (error) {
            if (error?.code !== 'account_identity_occupied') throw error;
        }
        const suffix = `.${i + 2}`;
        candidate = `${base.slice(0, Math.max(1, 50 - suffix.length))}${suffix}`;
    }
    throw appError('Не вдалося згенерувати унікальний логін', 409, 'username_generation_failed', { base });
}

function oneTimeCredential(username, password, source = 'account_management') {
    return {
        username,
        password,
        oneTime: true,
        source,
        issuedAt: new Date().toISOString(),
        note: 'Пароль показується тільки один раз. Старі паролі у CRM не зберігаються у відкритому вигляді.'
    };
}

async function getUserForUpdate(client, userId) {
    const result = await client.query(
        'SELECT id, username, name, role, is_active FROM users WHERE id = $1 FOR UPDATE',
        [userId]
    );
    if (result.rows.length === 0) {
        throw appError('Акаунт не знайдено', 404, 'user_not_found', { userId });
    }
    return result.rows[0];
}

async function getStaffForUpdate(client, staffId, { allowInactiveStaff = false } = {}) {
    const result = await client.query(
        `SELECT id, name, department, position, role_type, phone, telegram_username, telegram_id,
                is_active, is_freelance, unique_person_key
         FROM staff
         WHERE id = $1
         FOR UPDATE`,
        [staffId]
    );
    if (result.rows.length === 0) {
        throw appError('Staff-профіль не знайдено', 404, 'staff_not_found', { staffId });
    }
    const staff = result.rows[0];
    if (!allowInactiveStaff && staff.is_active === false) {
        throw appError('Staff-профіль неактивний', 409, 'staff_inactive', { staffId });
    }
    return staff;
}

async function linkUserToStaffProfile(client, {
    userId,
    staffId,
    actor = null,
    req = null,
    reason = 'account_management',
    eventType = 'account_staff_linked',
    details = {},
    allowInactiveStaff = false
} = {}) {
    const safeUserId = normalizePositiveInt(userId, 'userId');
    const safeStaffId = normalizePositiveInt(staffId, 'staffId');
    if (!safeUserId || !safeStaffId) {
        throw appError('Потрібні userId та staffId', 400, 'link_requires_user_and_staff');
    }

    const user = await getUserForUpdate(client, safeUserId);
    const staff = await getStaffForUpdate(client, safeStaffId, { allowInactiveStaff });

    const occupied = await client.query(
        `SELECT ep.id, ep.user_id, u.username, s.name AS staff_name, ep.staff_id
         FROM employee_profiles ep
         LEFT JOIN users u ON u.id = ep.user_id
         LEFT JOIN staff s ON s.id = ep.staff_id
         WHERE ep.staff_id = $1
           AND ep.user_id IS NOT NULL
           AND ep.user_id <> $2
         LIMIT 1`,
        [safeStaffId, safeUserId]
    );
    if (occupied.rows.length) {
        const row = occupied.rows[0];
        throw appError(
            `Staff-профіль вже прив'язаний до ${row.username || 'іншого акаунта'}`,
            409,
            'staff_already_linked',
            { staffId: safeStaffId, userId: row.user_id, username: row.username }
        );
    }

    await client.query(
        'UPDATE employee_profiles SET user_id = NULL WHERE user_id = $1 AND staff_id IS DISTINCT FROM $2',
        [safeUserId, safeStaffId]
    );

    const profile = await client.query(
        `SELECT id
         FROM employee_profiles
         WHERE staff_id = $1
         ORDER BY COALESCE(is_active, true) DESC, id
         LIMIT 1
         FOR UPDATE`,
        [safeStaffId]
    );

    let profileId;
    if (profile.rows.length) {
        const updated = await client.query(
            `UPDATE employee_profiles
             SET user_id = $1,
                 full_name = COALESCE(NULLIF(full_name, ''), $2),
                 department = COALESCE(department, $3),
                 role = COALESCE(role, $4, 'employee'),
                 phone = COALESCE(phone, $5),
                 telegram_username = COALESCE(telegram_username, $6),
                 is_active = true
             WHERE id = $7
             RETURNING id`,
            [safeUserId, staff.name, staff.department, staff.role_type, staff.phone, staff.telegram_username, profile.rows[0].id]
        );
        profileId = updated.rows[0].id;
    } else {
        const inserted = await client.query(
            `INSERT INTO employee_profiles (user_id, staff_id, full_name, phone, role, department, telegram_username, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true)
             RETURNING id`,
            [safeUserId, safeStaffId, staff.name, staff.phone || null, staff.role_type || 'employee', staff.department || null, staff.telegram_username || null]
        );
        profileId = inserted.rows[0].id;
    }

    await client.query(
        'UPDATE employee_profiles SET user_id = NULL, is_active = false WHERE staff_id = $1 AND id <> $2',
        [safeStaffId, profileId]
    );

    await recordAccountSecurityEvent({
        actor,
        target: user,
        eventType,
        reason,
        details: {
            ...details,
            staffId: safeStaffId,
            staffName: staff.name,
            profileId,
            canonicalBridge: 'employee_profiles'
        },
        req,
        client
    });

    return {
        user,
        staff,
        profile: { id: profileId, userId: safeUserId, staffId: safeStaffId },
        linked: true
    };
}

async function unlinkStaffAccount(client, {
    staffId,
    actor = null,
    req = null,
    reason = 'account_management',
    eventType = 'account_staff_unlinked',
    details = {}
} = {}) {
    const safeStaffId = normalizePositiveInt(staffId, 'staffId');
    if (!safeStaffId) throw appError('Потрібен staffId', 400, 'unlink_requires_staff');

    const staff = await getStaffForUpdate(client, safeStaffId, { allowInactiveStaff: true });
    const existing = await client.query(
        `SELECT ep.id AS profile_id, ep.user_id, u.username, u.name, u.role
         FROM employee_profiles ep
         LEFT JOIN users u ON u.id = ep.user_id
         WHERE ep.staff_id = $1
         FOR UPDATE`,
        [safeStaffId]
    );

    await client.query('UPDATE employee_profiles SET user_id = NULL WHERE staff_id = $1', [safeStaffId]);

    const user = existing.rows.find(row => row.user_id);
    if (user) {
        await recordAccountSecurityEvent({
            actor,
            target: { id: user.user_id, username: user.username, name: user.name, role: user.role },
            eventType,
            reason,
            details: {
                ...details,
                staffId: safeStaffId,
                staffName: staff.name,
                profileId: user.profile_id,
                canonicalBridge: 'employee_profiles'
            },
            req,
            client
        });
    }

    return {
        staff,
        user: user ? { id: user.user_id, username: user.username, name: user.name, role: user.role } : null,
        unlinked: true
    };
}

async function unlinkUserFromStaffProfiles(client, {
    userId,
    actor = null,
    req = null,
    reason = 'account_management',
    eventType = 'account_staff_unlinked',
    details = {}
} = {}) {
    const safeUserId = normalizePositiveInt(userId, 'userId');
    if (!safeUserId) throw appError('Потрібен userId', 400, 'unlink_requires_user');

    const user = await getUserForUpdate(client, safeUserId);
    const linked = await client.query(
        `SELECT ep.id AS profile_id, ep.staff_id, s.name AS staff_name
         FROM employee_profiles ep
         LEFT JOIN staff s ON s.id = ep.staff_id
         WHERE ep.user_id = $1
         FOR UPDATE`,
        [safeUserId]
    );
    await client.query('UPDATE employee_profiles SET user_id = NULL WHERE user_id = $1', [safeUserId]);

    if (linked.rows.length) {
        await recordAccountSecurityEvent({
            actor,
            target: user,
            eventType,
            reason,
            details: {
                ...details,
                removedLinks: linked.rows.map(row => ({
                    profileId: row.profile_id,
                    staffId: row.staff_id,
                    staffName: row.staff_name
                })),
                canonicalBridge: 'employee_profiles'
            },
            req,
            client
        });
    }

    return { user, removed: linked.rows };
}

async function getAccountLinkConflicts({ limit = 25 } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const [unlinkedUsers, unlinkedStaff, inactiveProfiles, duplicateTelegram, ambiguousProfiles] = await Promise.all([
        pool.query(
            `SELECT u.id, u.username, u.name, u.role, u.is_active
             FROM users u
             WHERE COALESCE(u.is_active, true) IS TRUE
               AND NOT EXISTS (
                   SELECT 1
                   FROM employee_profiles ep
                   WHERE ep.user_id = u.id
               )
               AND LOWER(u.username) NOT LIKE 'openclaw%'
               AND LOWER(u.username) NOT IN ('guardian', 'system')
             ORDER BY lower(COALESCE(NULLIF(u.name, ''), u.username)), u.id
             LIMIT $1`,
            [safeLimit]
        ),
        pool.query(
            `SELECT s.id, s.name, s.department, s.position, s.role_type, s.unique_person_key
             FROM staff s
             WHERE COALESCE(s.is_active, true) IS TRUE
               AND COALESCE(s.is_freelance, false) IS FALSE
               AND NOT EXISTS (
                   SELECT 1
                   FROM employee_profiles ep
                   WHERE ep.staff_id = s.id
                     AND ep.user_id IS NOT NULL
               )
             ORDER BY s.department, lower(s.name), s.id
             LIMIT $1`,
            [safeLimit]
        ),
        pool.query(
            `SELECT ep.id, ep.user_id, u.username, u.is_active AS user_active,
                    ep.staff_id, s.name AS staff_name, s.is_active AS staff_active, ep.is_active AS profile_active
             FROM employee_profiles ep
             LEFT JOIN users u ON u.id = ep.user_id
             LEFT JOIN staff s ON s.id = ep.staff_id
             WHERE (ep.user_id IS NOT NULL OR ep.staff_id IS NOT NULL)
               AND (
                    COALESCE(ep.is_active, true) IS FALSE
                    OR (ep.user_id IS NOT NULL AND COALESCE(u.is_active, true) IS FALSE)
                    OR (ep.staff_id IS NOT NULL AND COALESCE(s.is_active, true) IS FALSE)
               )
             ORDER BY ep.id
             LIMIT $1`,
            [safeLimit]
        ),
        pool.query(
            `WITH identities AS (
                SELECT 'users.telegram_username' AS source, id::text AS entity_id, username AS label,
                       LOWER(BTRIM(telegram_username)) AS value
                FROM users WHERE NULLIF(BTRIM(COALESCE(telegram_username, '')), '') IS NOT NULL
                UNION ALL
                SELECT 'users.telegram_chat_id', id::text, username, BTRIM(telegram_chat_id::text)
                FROM users WHERE telegram_chat_id IS NOT NULL
                UNION ALL
                SELECT 'staff.telegram_username', id::text, name, LOWER(BTRIM(telegram_username))
                FROM staff WHERE NULLIF(BTRIM(COALESCE(telegram_username, '')), '') IS NOT NULL
                UNION ALL
                SELECT 'staff.telegram_id', id::text, name, BTRIM(telegram_id::text)
                FROM staff WHERE NULLIF(BTRIM(COALESCE(telegram_id::text, '')), '') IS NOT NULL
                UNION ALL
                SELECT 'employee_profiles.telegram_username', id::text, full_name, LOWER(BTRIM(telegram_username))
                FROM employee_profiles WHERE NULLIF(BTRIM(COALESCE(telegram_username, '')), '') IS NOT NULL
                UNION ALL
                SELECT 'employee_profiles.telegram_chat_id', id::text, full_name, BTRIM(telegram_chat_id::text)
                FROM employee_profiles WHERE telegram_chat_id IS NOT NULL
             )
             SELECT value, COUNT(*)::int AS count,
                    JSON_AGG(JSON_BUILD_OBJECT('source', source, 'entityId', entity_id, 'label', label) ORDER BY source, entity_id) AS entities
             FROM identities
             WHERE value IS NOT NULL AND value <> ''
             GROUP BY value
             HAVING COUNT(*) > 1
             ORDER BY COUNT(*) DESC, value
             LIMIT $1`,
            [safeLimit]
        ),
        pool.query(
            `SELECT ep.id, ep.user_id, u.username, ep.staff_id, s.name AS staff_name,
                    CASE
                        WHEN ep.user_id IS NOT NULL AND u.id IS NULL THEN 'missing_user'
                        WHEN ep.staff_id IS NOT NULL AND s.id IS NULL THEN 'missing_staff'
                        WHEN ep.user_id IS NOT NULL AND ep.staff_id IS NULL THEN 'account_without_staff_bridge'
                        WHEN ep.staff_id IS NOT NULL AND ep.user_id IS NULL AND COALESCE(ep.is_active, true) IS TRUE THEN 'profile_without_account'
                        ELSE 'unknown'
                    END AS reason
             FROM employee_profiles ep
             LEFT JOIN users u ON u.id = ep.user_id
             LEFT JOIN staff s ON s.id = ep.staff_id
             WHERE (ep.user_id IS NOT NULL AND u.id IS NULL)
                OR (ep.staff_id IS NOT NULL AND s.id IS NULL)
                OR (ep.user_id IS NOT NULL AND ep.staff_id IS NULL)
                OR (ep.staff_id IS NOT NULL AND ep.user_id IS NULL AND COALESCE(ep.is_active, true) IS TRUE)
             ORDER BY ep.id
             LIMIT $1`,
            [safeLimit]
        )
    ]);

    const data = {
        unlinkedUsers: unlinkedUsers.rows,
        unlinkedStaff: unlinkedStaff.rows,
        inactiveProfileConflicts: inactiveProfiles.rows,
        duplicateTelegramIdentities: duplicateTelegram.rows,
        ambiguousProfiles: ambiguousProfiles.rows
    };
    const counts = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]));
    return { counts, data };
}

module.exports = {
    appError,
    normalizePositiveInt,
    normalizeUsername,
    suggestUsernameForStaff,
    generateOneTimePassword,
    verifyIssuedCredential,
    reserveUsernameIdentity,
    uniqueUsername,
    oneTimeCredential,
    linkUserToStaffProfile,
    unlinkStaffAccount,
    unlinkUserFromStaffProfiles,
    getAccountLinkConflicts
};
