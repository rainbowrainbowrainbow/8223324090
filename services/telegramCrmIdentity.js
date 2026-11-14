'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { uniquePasswordCandidates } = require('./credentialInput');

function failure(statusCode, code, message) {
    return Object.assign(new Error(message), { statusCode, code });
}

function telegramId(value) {
    // Treat external IDs as decimal strings: reject truncation, fractions and exponent syntax.
    const text = String(value ?? '');
    if (!/^[1-9][0-9]{0,15}$/.test(text) || BigInt(text) > 4503599627370495n) {
        throw failure(400, 'TELEGRAM_ID_INVALID', 'Некоректний Telegram ID.');
    }
    return text;
}

function hashSecret(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function secretHash(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
        throw failure(400, 'TELEGRAM_LINK_INVALID', 'Недійсне підтвердження. Почніть підключення у профілі CRM.');
    }
    return hashSecret(value);
}

function equalHash(a, b) {
    return typeof a === 'string' && typeof b === 'string' && a.length === b.length
        && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function publicBinding(binding) {
    return {
        status: binding?.verified_at ? 'connected' : binding?.proposed_telegram_id ? 'preassigned' : 'disconnected',
        telegramId: binding?.telegram_user_id ? String(binding.telegram_user_id) : null,
        proposedTelegramId: binding?.proposed_telegram_id ? String(binding.proposed_telegram_id) : null,
        username: binding?.telegram_username || null,
        verifiedAt: binding?.verified_at || null,
        version: binding?.version ? String(binding.version) : null,
        pilotEnabled: binding?.pilot_enabled === true
    };
}

async function transaction(pool, work) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL statement_timeout = '8s'");
        await client.query("SET LOCAL lock_timeout = '3s'");
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505' && error.constraint === 'telegram_crm_bindings_telegram_user_id_key') {
            throw failure(409, 'TELEGRAM_ALREADY_LINKED', 'Цей Telegram уже підключений. Зверніться до адміністратора.');
        }
        throw error;
    } finally {
        client.release();
    }
}

async function audit(client, userId, type, version, operationId = null) {
    await client.query(
        `INSERT INTO telegram_crm_audit(user_id,event_type,binding_version,operation_id)
         VALUES ($1,$2,$3,$4)`, [userId, type, version, operationId]
    );
}

function createTelegramCrmIdentity({ pool, comparePassword = bcrypt.compare }) {
    async function configuration(client = pool, { allowOff = false } = {}) {
        const row = (await client.query('SELECT mode,bot_username FROM telegram_crm_settings WHERE singleton = TRUE')).rows[0];
        if (!row || (!allowOff && row.mode === 'off')) {
            throw failure(503, 'TELEGRAM_CRM_DISABLED', 'Інтеграція CRM тимчасово вимкнена.');
        }
        return row;
    }

    // Password hashing is deliberately outside the transaction. Its result is pinned
    // to the account/password/session state and rechecked after obtaining locks.
    async function reauthenticate(actor, password) {
        if (!actor?.id || typeof password !== 'string' || password.length > 1024) {
            throw failure(401, 'TELEGRAM_REAUTH_REQUIRED', 'Підтвердьте поточний пароль CRM.');
        }
        const user = (await pool.query(
            'SELECT id,password_hash,is_active,session_revoked_at FROM users WHERE id=$1', [actor.id]
        )).rows[0];
        let matched = false;
        if (user && user.is_active !== false) {
            for (const candidate of uniquePasswordCandidates(password)) {
                if (await comparePassword(candidate, user.password_hash || '')) { matched = true; break; }
            }
        }
        if (!matched) throw failure(401, 'TELEGRAM_REAUTH_REQUIRED', 'Не вдалося підтвердити поточний пароль CRM.');
        return user;
    }

    async function lockAccount(client, userId, proof = null, { allowDisabledPilot = false } = {}) {
        // All identity mutations and task writes use users -> binding -> request/operation.
        const user = (await client.query('SELECT * FROM users WHERE id=$1 FOR SHARE', [userId])).rows[0];
        if (!user || user.is_active === false) throw failure(403, 'TELEGRAM_ACCOUNT_INACTIVE', 'Акаунт CRM неактивний.');
        if (proof && (user.password_hash !== proof.password_hash
            || String(user.session_revoked_at) !== String(proof.session_revoked_at))) {
            throw failure(401, 'TELEGRAM_REAUTH_REQUIRED', 'Стан акаунта змінився. Підтвердьте вхід ще раз.');
        }
        const binding = (await client.query(
            'SELECT * FROM telegram_crm_bindings WHERE user_id=$1 FOR UPDATE', [userId]
        )).rows[0];
        if (!binding || (!allowDisabledPilot && !binding.pilot_enabled)) throw failure(403, 'TELEGRAM_PILOT_REQUIRED', 'Акаунт поки не підключений до пілоту.');
        return { user, binding };
    }

    async function status(actor) {
        const binding = (await pool.query('SELECT * FROM telegram_crm_bindings WHERE user_id=$1', [actor.id])).rows[0];
        const config = await configuration(pool, { allowOff: true }).catch(error => {
            if (error.code !== 'TELEGRAM_CRM_DISABLED') throw error;
            return { mode: 'off' };
        });
        return { ...publicBinding(binding), mode: config.mode };
    }

    async function begin(actor, password) {
        const proof = password === undefined ? null : await reauthenticate(actor, password);
        const token = crypto.randomBytes(32).toString('base64url');
        const browserProof = crypto.randomBytes(32).toString('base64url');
        const requestId = crypto.randomUUID();
        return transaction(pool, async client => {
            const config = await configuration(client);
            const { binding } = await lockAccount(client, actor.id, proof);
            // First onboarding already has an authenticated CRM session and still
            // requires proof from Telegram plus explicit confirmation in this tab.
            // Changes, reconnects and disconnects always require reauthentication.
            if (!proof && (String(binding.version) !== '1' || binding.verified_at || !binding.proposed_telegram_id)) {
                throw failure(401, 'TELEGRAM_REAUTH_REQUIRED', 'Підтвердьте поточний пароль CRM.');
            }
            await client.query(
                'UPDATE telegram_crm_link_requests SET cancelled_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL AND cancelled_at IS NULL', [actor.id]
            );
            const request = (await client.query(
                `INSERT INTO telegram_crm_link_requests(id,user_id,token_hash,browser_proof_hash,binding_version,expires_at)
                 VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '10 minutes') RETURNING expires_at`,
                [requestId, actor.id, hashSecret(token), hashSecret(browserProof), binding.version]
            )).rows[0];
            await audit(client, actor.id, 'link_started', binding.version, requestId);
            return { requestId, browserProof, expiresAt: request.expires_at,
                url: `https://t.me/${config.bot_username}?start=crm_${token}` };
        });
    }

    async function claim({ token, senderId, username, privateChat }) {
        if (privateChat !== true) throw failure(403, 'TELEGRAM_PRIVATE_REQUIRED', 'Підключення доступне лише в особистому чаті.');
        const candidateId = telegramId(senderId);
        const digest = secretHash(token);
        const found = (await pool.query('SELECT user_id,id FROM telegram_crm_link_requests WHERE token_hash=$1', [digest])).rows[0];
        if (!found) throw failure(410, 'TELEGRAM_LINK_EXPIRED', 'Посилання недійсне або вже використане.');
        return transaction(pool, async client => {
            await configuration(client);
            const { binding } = await lockAccount(client, found.user_id);
            const request = (await client.query(
                `SELECT *,expires_at>NOW() AS fresh FROM telegram_crm_link_requests WHERE id=$1 FOR UPDATE`, [found.id]
            )).rows[0];
            validatePending(request, binding);
            if (request.claimed_at) throw failure(409, 'TELEGRAM_LINK_CLAIMED', 'Посилання вже використане. Поверніться у CRM.');
            const cleanUsername = typeof username === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(username) ? username : null;
            await client.query(
                'UPDATE telegram_crm_link_requests SET candidate_telegram_id=$2,candidate_username=$3,claimed_at=NOW() WHERE id=$1',
                [request.id, candidateId, cleanUsername]
            );
            await audit(client, found.user_id, 'link_claimed', binding.version, request.id);
            return { status: 'awaiting_crm_confirmation' };
        });
    }

    function validatePending(request, binding) {
        if (!request || !request.fresh || request.cancelled_at || request.consumed_at
            || String(request.binding_version) !== String(binding.version)) {
            throw failure(410, 'TELEGRAM_LINK_EXPIRED', 'Підключення застаріло. Почніть його знову у профілі.');
        }
    }

    async function pending(actor, requestId, browserProof) {
        const digest = secretHash(browserProof);
        const row = (await pool.query(
            `SELECT r.*,r.expires_at>NOW() AS fresh,b.version
             FROM telegram_crm_link_requests r JOIN telegram_crm_bindings b ON b.user_id=r.user_id
             WHERE r.id=$1 AND r.user_id=$2`, [requestId, actor.id]
        )).rows[0];
        if (!row || !equalHash(row.browser_proof_hash, digest)) throw failure(404, 'TELEGRAM_LINK_NOT_FOUND', 'Підключення не знайдене.');
        validatePending(row, row);
        return { requestId: row.id, expiresAt: row.expires_at,
            status: row.claimed_at ? 'awaiting_confirmation' : 'awaiting_telegram',
            telegramId: row.candidate_telegram_id ? String(row.candidate_telegram_id) : null,
            username: row.candidate_username || null };
    }

    async function confirm(actor, { requestId, browserProof }) {
        const digest = secretHash(browserProof);
        return transaction(pool, async client => {
            await configuration(client);
            const { binding } = await lockAccount(client, actor.id);
            const request = (await client.query(
                'SELECT *,expires_at>NOW() AS fresh FROM telegram_crm_link_requests WHERE id=$1 AND user_id=$2 FOR UPDATE',
                [requestId, actor.id]
            )).rows[0];
            if (!request || !equalHash(request.browser_proof_hash, digest)) throw failure(404, 'TELEGRAM_LINK_NOT_FOUND', 'Підключення не знайдене.');
            validatePending(request, binding);
            if (!request.claimed_at) throw failure(409, 'TELEGRAM_LINK_NOT_CLAIMED', 'Спочатку відкрийте посилання в Telegram.');
            const updated = (await client.query(
                `UPDATE telegram_crm_bindings SET telegram_user_id=$2,telegram_username=$3,verified_at=NOW(),
                 version=version+1,updated_at=NOW() WHERE user_id=$1 RETURNING *`,
                [actor.id, request.candidate_telegram_id, request.candidate_username]
            )).rows[0];
            await client.query('UPDATE telegram_crm_link_requests SET consumed_at=NOW() WHERE id=$1', [requestId]);
            await invalidateDrafts(client, actor.id);
            await audit(client, actor.id, 'link_confirmed', updated.version, requestId);
            return publicBinding(updated);
        });
    }

    async function invalidateDrafts(client, userId) {
        await client.query("UPDATE telegram_crm_task_operations SET state='cancelled' WHERE user_id=$1 AND state='draft'", [userId]);
    }

    async function disconnect(actor, password) {
        const proof = await reauthenticate(actor, password);
        // Disconnect remains available even when the integration kill switch is off.
        return transaction(pool, async client => {
            const { binding } = await lockAccount(client, actor.id, proof, { allowDisabledPilot: true });
            const updated = (await client.query(
                `UPDATE telegram_crm_bindings SET telegram_user_id=NULL,telegram_username=NULL,verified_at=NULL,
                 proposed_telegram_id=NULL,version=version+1,updated_at=NOW() WHERE user_id=$1 RETURNING *`, [actor.id]
            )).rows[0];
            await client.query('UPDATE telegram_crm_link_requests SET cancelled_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL AND cancelled_at IS NULL', [actor.id]);
            await invalidateDrafts(client, actor.id);
            await audit(client, actor.id, 'link_disconnected', updated?.version || Number(binding.version) + 1);
            return publicBinding(updated);
        });
    }

    async function resolve(senderId, client = pool, { lock = false, expectedVersion = null, eventAt = null } = {}) {
        await configuration(client);
        const id = telegramId(senderId);
        const initial = (await client.query('SELECT user_id FROM telegram_crm_bindings WHERE telegram_user_id=$1', [id])).rows[0];
        if (!initial) throw failure(403, 'TELEGRAM_NOT_LINKED', 'Підключіть Telegram у своєму профілі CRM.');
        let user, binding;
        if (lock) ({ user, binding } = await lockAccount(client, initial.user_id));
        else {
            user = (await client.query('SELECT * FROM users WHERE id=$1', [initial.user_id])).rows[0];
            binding = (await client.query('SELECT * FROM telegram_crm_bindings WHERE user_id=$1', [initial.user_id])).rows[0];
        }
        if (!user || user.is_active === false || !binding?.pilot_enabled || !binding.verified_at
            || String(binding.telegram_user_id) !== id
            || (expectedVersion !== null && String(expectedVersion) !== String(binding.version))
            || (eventAt !== null && Number(eventAt) * 1000 < new Date(binding.verified_at).getTime())) {
            throw failure(403, 'TELEGRAM_LINK_REVOKED', 'Доступ Telegram змінився. Підключіть акаунт або повторіть запит.');
        }
        return { user, binding };
    }

    return { begin, claim, confirm, configuration, disconnect, lockAccount, pending, reauthenticate, resolve, status };
}

module.exports = { audit, createTelegramCrmIdentity, equalHash, failure, hashSecret, publicBinding, secretHash, telegramId, transaction };
