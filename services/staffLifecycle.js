'use strict';

const { recordAccountSecurityEvent } = require('./accountSecurity');

function normalizeLifecycleDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const raw = String(value).trim();
    if (!raw) return null;
    const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
}

function fallbackToday() {
    return new Date().toISOString().slice(0, 10);
}

async function cleanupFutureStaffOperationalSchedule(db, staffId, fromDate) {
    const id = Number(staffId);
    const safeFrom = normalizeLifecycleDate(fromDate) || fallbackToday();
    if (!Number.isFinite(id) || id <= 0) {
        return { hr_shifts: 0, staff_schedule: 0, from_date: safeFrom };
    }
    const shifts = await db.query(
        `DELETE FROM hr_shifts hs
         WHERE hs.staff_id = $1
           AND hs.shift_date >= $2::date
           AND NOT EXISTS (
                SELECT 1 FROM hr_time_records tr
                WHERE tr.staff_id = hs.staff_id
                  AND tr.record_date = hs.shift_date
           )`,
        [id, safeFrom]
    );
    const schedule = await db.query(
        `DELETE FROM staff_schedule ss
         WHERE ss.staff_id = $1
           AND LEFT(ss.date::text, 10) >= $2
           AND NOT EXISTS (
                SELECT 1 FROM hr_time_records tr
                WHERE tr.staff_id = ss.staff_id
                  AND tr.record_date::text = LEFT(ss.date::text, 10)
           )`,
        [id, safeFrom]
    );
    return {
        hr_shifts: shifts.rowCount || 0,
        staff_schedule: schedule.rowCount || 0,
        from_date: safeFrom
    };
}

function defaultAccountMeta(row = {}, currentUserId = null) {
    const id = Number(row.id || row.user_id);
    return {
        id,
        username: row.username || '',
        name: row.name || '',
        role: row.role || '',
        profile_id: row.profile_id ? Number(row.profile_id) : null,
        is_current_user: Number.isFinite(Number(currentUserId)) && id === Number(currentUserId)
    };
}

async function syncLinkedStaffAccountDeactivation(client, staffId, options = {}) {
    const id = Number(staffId);
    const actor = options.actor || null;
    const req = options.req || null;
    const reason = options.reason || 'staff_deactivation';
    const source = options.source || reason;
    const canDisableAccount = typeof options.canDisableAccount === 'function'
        ? options.canDisableAccount
        : () => false;
    const blockReason = typeof options.blockReason === 'function'
        ? options.blockReason
        : () => null;
    const accountMeta = typeof options.accountMeta === 'function'
        ? options.accountMeta
        : row => defaultAccountMeta(row, actor?.id);
    const logger = options.logger || null;

    if (!Number.isFinite(id) || id <= 0) {
        return {
            profiles_deactivated: 0,
            disabled_accounts: 0,
            disabled_account_usernames: [],
            account_deactivation_blocked: false,
            account_deactivation_blockers: []
        };
    }

    const linkedAccounts = await client.query(
        `SELECT u.id, u.username, u.name, u.role, u.extra_roles, ep.id AS profile_id
         FROM employee_profiles ep
         JOIN users u ON u.id = ep.user_id
         WHERE ep.staff_id = $1
           AND ep.user_id IS NOT NULL
           AND COALESCE(u.is_active, true) = true
         FOR UPDATE OF ep, u`,
        [id]
    ).catch(err => {
        if (logger?.warn) logger.warn(`Linked staff account lookup skipped: ${err.message}`);
        return { rows: [] };
    });

    const profiles = await client.query(
        `UPDATE employee_profiles
         SET is_active = false
         WHERE staff_id = $1
           AND COALESCE(is_active, true) = true
         RETURNING id, user_id`,
        [id]
    ).catch(err => {
        if (logger?.warn) logger.warn(`Linked staff profile deactivation skipped: ${err.message}`);
        return { rowCount: 0, rows: [] };
    });

    const allowedAccounts = linkedAccounts.rows.filter(row => canDisableAccount(row));
    const blockers = linkedAccounts.rows
        .filter(row => !canDisableAccount(row))
        .map(row => {
            const reasonCode = blockReason(row);
            return reasonCode ? { ...accountMeta(row), block_reason: reasonCode } : null;
        })
        .filter(Boolean);

    const userIds = allowedAccounts.map(row => Number(row.id)).filter(Number.isFinite);
    let disabledRows = [];
    if (userIds.length) {
        const disabled = await client.query(
            `UPDATE users
             SET is_active = false,
                 session_revoked_at = NOW()
             WHERE id = ANY($1::int[])
             RETURNING id, username, name, role`,
            [userIds]
        );
        disabledRows = disabled.rows;
        const disabledUserIds = disabledRows.map(row => Number(row.id)).filter(Number.isFinite);
        if (disabledUserIds.length) {
            await client.query(
                `UPDATE refresh_tokens
                 SET revoked_at = NOW()
                 WHERE user_id = ANY($1::int[]) AND revoked_at IS NULL`,
                [disabledUserIds]
            ).catch(err => {
                if (logger?.warn) logger.warn(`Linked staff token revoke skipped: ${err.message}`);
            });
            for (const target of disabledRows) {
                await recordAccountSecurityEvent({
                    actor,
                    target,
                    eventType: 'account_deactivated',
                    reason,
                    details: {
                        staffId: id,
                        source,
                        sessionsRevoked: true,
                        ...(options.eventDetails || {})
                    },
                    req,
                    client
                });
            }
        }
    }

    return {
        profiles_deactivated: profiles.rowCount || 0,
        disabled_accounts: disabledRows.length,
        disabled_account_usernames: disabledRows.map(row => row.username).filter(Boolean),
        account_deactivation_blocked: blockers.length > 0,
        account_deactivation_blockers: blockers
    };
}

module.exports = {
    cleanupFutureStaffOperationalSchedule,
    normalizeLifecycleDate,
    syncLinkedStaffAccountDeactivation
};
