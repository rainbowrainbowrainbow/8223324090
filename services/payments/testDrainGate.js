'use strict';

class TestDrainError extends Error {
    constructor(code, status = 409) {
        super(code);
        this.name = 'TestDrainError';
        this.code = code;
        this.status = status;
        this.statusCode = status;
    }
}

async function lockFiscalRegister(client, profileId, registerId) {
    const ids = [profileId, registerId].map(Number);
    if (!ids.every(id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647)) {
        throw new TestDrainError('fiscal_register_lock_scope_invalid');
    }
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', ids);
}

async function loadActiveTestDrain(client, profileId, registerId) {
    const result = await client.query(
        `SELECT * FROM fiscal_register_payment_drains
          WHERE fiscal_profile_id = $1 AND fiscal_register_id = $2
            AND status IN ('draining', 'closed')`, [profileId, registerId]);
    return result.rows[0] || null;
}

async function assertRegisterAccepting(client, profileId, registerId) {
    await lockFiscalRegister(client, profileId, registerId);
    if (await loadActiveTestDrain(client, profileId, registerId)) {
        throw new TestDrainError('shared_test_register_draining');
    }
}

module.exports = { TestDrainError, lockFiscalRegister, loadActiveTestDrain, assertRegisterAccepting };
