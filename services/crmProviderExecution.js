'use strict';

function executionError(code, statusCode = 409) {
    return Object.assign(new Error(code), { code, statusCode });
}

function requireExecutionEnabled(env, flag) {
    if (env[flag] !== 'true') throw executionError('CRM_EXECUTION_DISABLED', 503);
}

async function transaction(client, work) {
    await client.query('BEGIN');
    try {
        const value = await work();
        await client.query('COMMIT');
        return value;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
}

// A session lock bounds paid provider concurrency across CRM replicas, without
// keeping a database transaction open while waiting for a provider.
async function withProviderExecution(pool, work, lockName = 'crm_paid_provider_execution') {
    const client = await pool.connect();
    let locked = false;
    try {
        const result = await client.query(
            'SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockName]
        );
        locked = result.rows[0]?.locked === true;
        if (!locked) throw executionError('CRM_PROVIDER_BUSY', 429);
        return await work(client);
    } finally {
        let releaseError;
        try {
            if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
        } catch (error) {
            releaseError = error;
            throw error;
        } finally {
            // A failed unlock must destroy the session rather than return an
            // advisory lock to the connection pool indefinitely.
            client.release(releaseError);
        }
    }
}

module.exports = { executionError, requireExecutionEnabled, transaction, withProviderExecution };
