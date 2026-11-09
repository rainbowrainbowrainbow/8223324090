'use strict';

const { createHash } = require('node:crypto');

function operationError(statusCode, code, message) {
    return Object.assign(new Error(message), { statusCode, code });
}

function describeStaffCreationOperation(req, kind, payload, key = req?.headers?.['idempotency-key']) {
    if (key == null) return null;
    if (typeof key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
        throw operationError(400, 'STAFF_OPERATION_INVALID_KEY', 'Некоректний ключ операції створення');
    }
    const actor = Number(req.user?.id);
    if (!Number.isSafeInteger(actor) || actor < 1) {
        throw operationError(403, 'STAFF_OPERATION_ACTOR_REQUIRED', 'Не вдалося перевірити автора операції');
    }
    const membership = req.user.activeBusinessMembership;
    const parkScope = membership ? `park:${membership.organizationId}:${membership.businessId}` : 'park:compatibility';
    return {
        identity: [actor, parkScope, kind, key.toLowerCase()],
        requestHash: payload === undefined ? null : createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    };
}

async function readStaffCreationOperation(db, operation) {
    if (!operation) return null;
    const result = await db.query(
        `SELECT request_hash, staff_id, account_user_id, staff_created
         FROM staff_creation_operations
         WHERE actor_user_id = $1 AND park_scope = $2 AND operation_kind = $3 AND operation_key = $4`,
        operation.identity
    );
    return result.rows[0] || null;
}

async function lockStaffCreationOperation(client, operation) {
    if (!operation) return null;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [JSON.stringify(['staff-creation-operation', ...operation.identity])]);
    const saved = await readStaffCreationOperation(client, operation);
    if (saved && saved.request_hash !== operation.requestHash) {
        throw operationError(409, 'STAFF_OPERATION_PAYLOAD_CHANGED',
            'Цей ключ уже використано для іншого запиту. Спочатку перевірте збережений результат.');
    }
    return saved;
}

async function recordStaffCreationOperation(client, operation, { staffId, accountUserId = null, staffCreated }) {
    if (!operation) return;
    await client.query(
        `INSERT INTO staff_creation_operations
             (actor_user_id, park_scope, operation_kind, operation_key, request_hash, staff_id, account_user_id, staff_created)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [...operation.identity, operation.requestHash, staffId, accountUserId, staffCreated]
    );
}

module.exports = {
    describeStaffCreationOperation, readStaffCreationOperation, lockStaffCreationOperation, recordStaffCreationOperation
};
