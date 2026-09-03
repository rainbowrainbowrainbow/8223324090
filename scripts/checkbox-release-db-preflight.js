'use strict';

const { Pool } = require('pg');

class CheckboxReleaseDbPreflightError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'CheckboxReleaseDbPreflightError';
        this.code = code;
    }
}

function requiredDatabaseUrl(env = process.env) {
    const value = String(env.CHECKBOX_RELEASE_PREFLIGHT_DATABASE_URL || '').trim();
    if (!value) {
        throw new CheckboxReleaseDbPreflightError(
            'checkbox_release_preflight_database_url_required',
            'CHECKBOX_RELEASE_PREFLIGHT_DATABASE_URL is required; DATABASE_URL is intentionally not used as a fallback'
        );
    }
    return value;
}

function sslConfig(env = process.env) {
    const value = String(env.CHECKBOX_RELEASE_PREFLIGHT_DATABASE_SSL || '').trim().toLowerCase();
    if (!['true', 'false'].includes(value)) {
        throw new CheckboxReleaseDbPreflightError(
            'checkbox_release_preflight_database_ssl_required',
            'CHECKBOX_RELEASE_PREFLIGHT_DATABASE_SSL must be explicitly true or false'
        );
    }
    return value === 'true' ? { rejectUnauthorized: false } : false;
}

async function inspectCheckboxMigrationReadiness(dbPool) {
    const client = await dbPool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SET TRANSACTION READ ONLY');
        const result = await client.query(
            `SELECT
                 (SELECT COUNT(*)::integer
                    FROM fiscal_shifts
                   WHERE NOT (
                       (
                           (status = 'closed' AND lifecycle_stage = 'CLOSED')
                           OR (status = 'opening' AND lifecycle_stage IN ('CREATED', 'OPENING'))
                           OR (status = 'open' AND lifecycle_stage = 'OPENED')
                           OR (status = 'closing' AND lifecycle_stage = 'CLOSING')
                           OR (
                               status IN ('unknown', 'failed', 'blocked')
                               AND lifecycle_stage IN ('CREATED', 'OPENING', 'OPENED', 'CLOSING')
                           )
                       )
                       AND (
                           lifecycle_stage IN ('CREATED', 'OPENING')
                           OR provider_shift_id IS NOT NULL
                       )
                   )) AS shift_lifecycle_mismatches,
                 (SELECT COUNT(*)::integer
                    FROM fiscal_operations
                   WHERE operation_type IN ('shift_open', 'shift_close')
                     AND (fiscal_shift_id IS NULL OR fiscal_register_id IS NULL)) AS orphan_shift_operations,
                 (SELECT COUNT(*)::integer
                    FROM fiscal_operations operation
                    LEFT JOIN fiscal_shifts shift
                      ON shift.id = operation.fiscal_shift_id
                     AND shift.fiscal_profile_id = operation.fiscal_profile_id
                     AND shift.fiscal_register_id = operation.fiscal_register_id
                   WHERE operation.operation_type IN ('shift_open', 'shift_close')
                     AND shift.id IS NULL) AS shift_operation_scope_mismatches,
                 (SELECT COUNT(*)::integer
                    FROM (
                          SELECT fiscal_profile_id, fiscal_shift_id, operation_type
                            FROM fiscal_operations
                           WHERE operation_type IN ('shift_open', 'shift_close')
                             AND fiscal_shift_id IS NOT NULL
                           GROUP BY fiscal_profile_id, fiscal_shift_id, operation_type
                          HAVING COUNT(*) > 1
                         ) duplicate_operations) AS duplicate_shift_operations,
                 (SELECT COUNT(*)::integer
                    FROM (
                          SELECT fiscal_profile_id, fiscal_register_id
                            FROM fiscal_shifts
                           WHERE lifecycle_stage IN ('CREATED', 'OPENING', 'OPENED', 'CLOSING')
                           GROUP BY fiscal_profile_id, fiscal_register_id
                          HAVING COUNT(*) > 1
                         ) duplicate_lifecycles) AS duplicate_unresolved_shift_lifecycles,
                 (SELECT COUNT(*)::integer
                    FROM fiscal_shifts shift
                    LEFT JOIN fiscal_operations operation
                      ON operation.id = shift.open_operation_id
                     AND operation.fiscal_profile_id = shift.fiscal_profile_id
                     AND operation.fiscal_register_id = shift.fiscal_register_id
                     AND operation.fiscal_shift_id = shift.id
                     AND operation.operation_type = 'shift_open'
                   WHERE shift.open_operation_id IS NOT NULL
                     AND operation.id IS NULL) AS invalid_open_operation_links,
                 (SELECT COUNT(*)::integer
                    FROM fiscal_shifts shift
                    LEFT JOIN fiscal_operations operation
                      ON operation.id = shift.close_operation_id
                     AND operation.fiscal_profile_id = shift.fiscal_profile_id
                     AND operation.fiscal_register_id = shift.fiscal_register_id
                     AND operation.fiscal_shift_id = shift.id
                     AND operation.operation_type = 'shift_close'
                   WHERE shift.close_operation_id IS NOT NULL
                     AND operation.id IS NULL) AS invalid_close_operation_links`
        );
        await client.query('COMMIT');
        const counts = Object.fromEntries(
            Object.entries(result.rows[0] || {}).map(([key, value]) => [key, Number(value || 0)])
        );
        const blockers = Object.entries(counts)
            .filter(([, count]) => count > 0)
            .map(([code, count]) => ({ code, count }));
        return { ok: blockers.length === 0, blockers, counts };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function run({ env = process.env, dbPool = null } = {}) {
    let ownedPool = null;
    const effectivePool = dbPool || (() => {
        ownedPool = new Pool({
            connectionString: requiredDatabaseUrl(env),
            ssl: sslConfig(env),
            max: 1,
            connectionTimeoutMillis: 5000,
            application_name: 'eventgenix-checkbox-release-preflight'
        });
        return ownedPool;
    })();
    try {
        return await inspectCheckboxMigrationReadiness(effectivePool);
    } finally {
        if (ownedPool) await ownedPool.end();
    }
}

if (require.main === module) {
    run()
        .then(result => {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            if (!result.ok) process.exitCode = 2;
        })
        .catch(error => {
            process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'checkbox_release_db_preflight_failed' })}\n`);
            process.exitCode = 2;
        });
}

module.exports = {
    CheckboxReleaseDbPreflightError,
    inspectCheckboxMigrationReadiness,
    requiredDatabaseUrl,
    run,
    sslConfig
};
