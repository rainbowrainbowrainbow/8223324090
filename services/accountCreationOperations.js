'use strict';

const { createHash } = require('node:crypto');
const { recordAccountSecurityEvent } = require('./accountSecurity');

function operationError(message, statusCode, code) {
    return Object.assign(new Error(message), { statusCode, code });
}

function describeAccountCreationOperation(req, kind, payload) {
    const key = req.get('Idempotency-Key');
    if (key === undefined) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
        throw operationError('Некоректний ключ операції створення', 400, 'ACCOUNT_CREATION_INVALID_KEY');
    }
    return {
        actor: req.user, kind, key: key.toLowerCase(),
        fingerprint: createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    };
}

async function lockAccountCreationOperation(client, operation) {
    if (!operation) return null;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [JSON.stringify(['account-creation', operation.actor.id, operation.kind, operation.key])]);
    const { rows: [saved] } = await client.query(
        `SELECT details FROM account_security_events
         WHERE actor_user_id = $1 AND event_type = 'account_creation_operation'
           AND reason = $2 AND details->>'operationKey' = $3
         ORDER BY id DESC LIMIT 1`, [operation.actor.id, operation.kind, operation.key]
    );
    if (!saved) return null;
    if (saved.details.fingerprint !== operation.fingerprint) {
        throw operationError('Цей ключ уже використано для іншого створення', 409, 'ACCOUNT_CREATION_KEY_CONFLICT');
    }
    return saved.details.receipt;
}

async function recordAccountCreationOperation(client, operation, receipt, req) {
    if (!operation) return;
    await recordAccountSecurityEvent({
        client, req, actor: operation.actor, eventType: 'account_creation_operation', reason: operation.kind,
        details: { operationKey: operation.key, fingerprint: operation.fingerprint, receipt }, strict: true
    });
}

module.exports = { describeAccountCreationOperation, lockAccountCreationOperation, recordAccountCreationOperation };
