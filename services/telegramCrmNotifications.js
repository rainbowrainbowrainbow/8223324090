'use strict';

const { failure, transaction } = require('./telegramCrmIdentity');
const { defaultActorContext } = require('./telegramCrmTasks');
const { canViewTask } = require('./taskPolicy');
const { isActiveTaskForHermesOutbox } = require('./notificationOutbox');
const { canonicalTaskDue } = require('./taskReschedule');

const eligible = `FROM telegram_crm_bindings b
    JOIN users u ON u.id = b.user_id
    JOIN telegram_crm_settings s ON s.singleton AND s.mode IN ('read', 'write')
    WHERE b.pilot_enabled AND b.verified_at IS NOT NULL AND u.is_active IS DISTINCT FROM FALSE`;
const supportedResults = new Map([
    ['sent', new Set([null])],
    ['retry', new Set(['rate_limited', 'connection_refused', 'crm_task_content_unavailable'])],
    ['blocked', new Set(['bot_blocked', 'chat_unavailable', 'telegram_rejected'])],
    ['cancelled', new Set(['legacy_delivery_evidence'])],
    ['uncertain', new Set(['telegram_result_unknown'])]
]);

function createTelegramCrmNotifications({ pool, identity, actorContext = defaultActorContext }) {
    async function recipients() {
        const { rows } = await pool.query(`SELECT b.user_id AS "userId",
            b.telegram_user_id::text AS "telegramId", b.version::text AS "bindingVersion"
            ${eligible} ORDER BY b.user_id`);
        return { recipients: rows };
    }

    async function claim(leaseId) {
        if (typeof leaseId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(leaseId)) {
            throw failure(400, 'TELEGRAM_DELIVERY_LEASE_INVALID', 'Invalid Telegram delivery lease');
        }
        await pool.query(`UPDATE telegram_crm_assignment_outbox
            SET status='uncertain', reason='lease_expired', finished_at=NOW()
            WHERE status='sending' AND lease_expires_at <= NOW()`);
        return transaction(pool, async client => {
            // Serialize retries of the same claim token. The caller retries a
            // lost CRM response before it attempts any Telegram request.
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 419))', [leaseId]);
            const { rows: [previous] } = await client.query(`SELECT id, status, lease_expires_at > NOW() AS valid
                FROM telegram_crm_assignment_outbox WHERE lease_id=$1`, [leaseId]);
            if (previous && (previous.status !== 'sending' || !previous.valid)) return { event: null };
            const { rows: [event] } = await client.query(`SELECT *, created_at < NOW() - INTERVAL '24 hours' AS expired
                FROM telegram_crm_assignment_outbox
                WHERE ($1::bigint IS NULL AND status IN ('pending', 'retry') AND available_at <= NOW())
                   OR (id=$1 AND status='sending' AND lease_id=$2 AND lease_expires_at > NOW())
                ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`, [previous?.id || null, leaseId]);
            if (!event) return { event: null };

            const finish = async (status, reason) => {
                await client.query(`UPDATE telegram_crm_assignment_outbox
                    SET status=$2, reason=$3, finished_at=NOW() WHERE id=$1`, [event.id, status, reason]);
                return { event: null, processed: true };
            };
            if (event.expired) return finish('expired', 'stale_assignment');
            // Legacy tasks.deadline stores a UTC timestamp without a zone. Attach
            // the zone before node-postgres can interpret it in the host timezone.
            const { rows: [task] } = await client.query(`SELECT tasks.*,
                deadline AT TIME ZONE 'UTC' AS assignment_deadline FROM tasks WHERE id=$1
                AND NOT EXISTS (SELECT 1 FROM telegram_crm_assignment_outbox WHERE task_id=$1 AND id>$2)`,
            [event.task_id, event.id]);
            if (!task || !isActiveTaskForHermesOutbox(task)
                || Number(task.owner_user_id) !== event.owner_user_id) {
                return finish('cancelled', 'assignment_inactive');
            }
            const { rows: [recipient] } = await client.query(`SELECT b.telegram_user_id::text AS destination
                ${eligible} AND b.user_id=$1 AND b.version=$2`, [event.owner_user_id, event.binding_version]);
            if (!recipient) return finish('cancelled', 'binding_unavailable');

            try {
                const { user } = await identity.resolve(recipient.destination, client, { expectedVersion: event.binding_version });
                const { actor } = await actorContext(user, client, task.business_context);
                if (!canViewTask(actor, task)) return finish('cancelled', 'task_access_revoked');
            } catch (error) {
                if (error.statusCode === 403 || error.code === 'TELEGRAM_CRM_DISABLED') {
                    return finish('cancelled', 'task_access_revoked');
                }
                throw error;
            }

            if (!previous) await client.query(`UPDATE telegram_crm_assignment_outbox
                SET status='sending', attempts=attempts+1, lease_id=$2,
                    lease_expires_at=NOW() + INTERVAL '2 minutes'
                WHERE id=$1`, [event.id, leaseId]);
            const due = canonicalTaskDue({ ...task, deadline: task.assignment_deadline });
            return { event: {
                id: String(event.id), leaseId, taskId: event.task_id, telegramId: recipient.destination,
                bindingVersion: String(event.binding_version), createdAt: event.created_at,
                task: {
                    id: task.id, title: task.title, description: task.description || null,
                    date: task.date || null, deadline: due.instant && due.source !== 'date' ? due.instant : null,
                    businessContext: task.business_context
                }
            } };
        });
    }

    async function finish(id, input = {}) {
        const { leaseId, status, reason = null, messageId = null, retryAfterSeconds = 0 } = input;
        if (!/^[1-9][0-9]{0,17}$/.test(id)
            || typeof leaseId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(leaseId)
            || !supportedResults.get(status)?.has(reason)
            || (status === 'sent' ? !Number.isSafeInteger(messageId) || messageId <= 0 : messageId !== null)
            || !Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 0 || retryAfterSeconds > 86400) {
            throw failure(400, 'TELEGRAM_DELIVERY_RESULT_INVALID', 'Invalid Telegram delivery result');
        }
        const { rows: [row] } = await pool.query(`UPDATE telegram_crm_assignment_outbox
            SET status=CASE WHEN $3='retry' AND attempts >= 5 THEN 'blocked' ELSE $3 END,
                reason=CASE WHEN $3='retry' AND attempts >= 5 THEN 'retry_exhausted:' || $4 ELSE $4 END,
                telegram_message_id=$5,
                finished_at=CASE WHEN $3='retry' AND attempts < 5 THEN NULL ELSE NOW() END,
                available_at=NOW() + GREATEST($6::integer, 15 * (1 << LEAST(attempts, 5))) * INTERVAL '1 second'
            WHERE id=$1 AND lease_id=$2 AND (
                status='sending' OR (status='uncertain' AND reason='lease_expired')
            ) RETURNING status`, [id, leaseId, status, reason, messageId, retryAfterSeconds]);
        if (row) return row;
        const { rows: [previous] } = await pool.query(`SELECT status, reason, telegram_message_id
            FROM telegram_crm_assignment_outbox WHERE id=$1 AND lease_id=$2`, [id, leaseId]);
        if (previous && (previous.status === status || (status === 'retry' && previous.status === 'blocked'))
            && (previous.reason === reason || previous.reason === 'retry_exhausted:' + reason)
            && (messageId === null || String(previous.telegram_message_id) === String(messageId))) {
            return { status: previous.status };
        }
        throw failure(409, 'TELEGRAM_DELIVERY_LEASE_LOST', 'Telegram delivery lease changed');
    }

    async function heartbeat(input) {
        const entries = input?.recipients;
        if (!Array.isArray(entries) || entries.length > 10000 || entries.some(entry =>
            !entry || !Number.isSafeInteger(entry.userId) || entry.userId <= 0
            || typeof entry.bindingVersion !== 'string' || !/^[1-9][0-9]{0,18}$/.test(entry.bindingVersion))) {
            throw failure(400, 'TELEGRAM_HEARTBEAT_INVALID', 'Invalid Telegram delivery heartbeat');
        }
        await pool.query(`INSERT INTO telegram_crm_notification_heartbeat (singleton, recipients)
            VALUES (TRUE,$1::jsonb) ON CONFLICT (singleton) DO UPDATE
            SET recipients=EXCLUDED.recipients, seen_at=NOW()`, [
            JSON.stringify(entries.map(({ userId, bindingVersion }) => ({ userId, bindingVersion })))
        ]);
        return {};
    }

    async function health() {
        const { rows } = await pool.query(`SELECT status, reason, COUNT(*)::int AS count,
            MIN(created_at) AS "oldestAt" FROM telegram_crm_assignment_outbox
            WHERE status IN ('pending','retry','sending','blocked','uncertain','expired')
            GROUP BY status, reason ORDER BY status, reason`);
        const { rows: missing } = await pool.query(`SELECT b.user_id AS "userId"
            ${eligible} AND NOT EXISTS (
                SELECT 1 FROM telegram_crm_notification_heartbeat worker
                WHERE worker.seen_at > NOW() - INTERVAL '3 minutes'
                  AND worker.recipients @> jsonb_build_array(jsonb_build_object(
                      'userId', b.user_id, 'bindingVersion', b.version::text))
            ) ORDER BY b.user_id`);
        return { outcomes: rows, missing };
    }

    return { recipients, claim, finish, health, heartbeat };
}

module.exports = { createTelegramCrmNotifications };
