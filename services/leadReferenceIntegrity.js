'use strict';

const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext, normalizeKnownBusinessContext } = require('./businessContext');
const REFERENCE_TABLES = new Set(['leads', 'customers', 'bookings', 'products']);

function integrityError(code, message, statusCode = 409) {
    return Object.assign(new Error(message), { name: 'LeadReferenceIntegrityError', code, statusCode });
}

function linkBusinessContext(value) {
    if (value === undefined) return DEFAULT_BUSINESS_CONTEXT;
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!normalizeKnownBusinessContext(raw) && !/^[a-z][a-z0-9_]{2,63}$/.test(raw)) {
        throw integrityError('business_context_invalid', 'Invalid relationship business context', 400);
    }
    return normalizeBusinessContext(raw);
}

function positiveRecordId(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (!/^[0-9]+$/.test(String(value ?? '').trim())) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function assertLeadReference(client, table, id, businessContext, { lock = 'SHARE' } = {}) {
    if (!REFERENCE_TABLES.has(table) || !['SHARE', 'UPDATE'].includes(lock)) throw new TypeError('Unsupported relationship reference');
    const value = ['leads', 'customers'].includes(table) ? positiveRecordId(id)
        : typeof id === 'string' && id.trim() && id.length <= 120 ? id.trim() : null;
    if (!value) throw integrityError('invalid_lead_reference', 'Invalid relationship reference', 400);
    if (table === 'products' && businessContext === 'maysternya_doli') {
        // Legacy MD stores provider program codes (including name-only "MD")
        // in program_id without a product FK. Preserve that existing contract
        // only before membership cutover; an actual foreign product never qualifies.
        const product = await client.query('SELECT id, business_context FROM products WHERE id = $1 FOR SHARE', [value]);
        if (product.rows[0]) {
            if ((product.rows[0].business_context ?? DEFAULT_BUSINESS_CONTEXT) === businessContext) return product.rows[0];
        } else {
            const registry = await client.query('SELECT access_mode FROM businesses WHERE context_key = $1 FOR SHARE', [businessContext]);
            if (!registry.rows[0] || registry.rows[0].access_mode === 'compatibility') return null;
        }
        throw integrityError('lead_reference_unavailable', 'Related record is unavailable in this business', 404);
    }
    const result = await client.query(
        `SELECT * FROM ${table} WHERE id = $1
         AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2 FOR ${lock}`,
        [value, businessContext]
    );
    if (!result.rows[0]) throw integrityError('lead_reference_unavailable', 'Related record is unavailable in this business', 404);
    return result.rows[0];
}

function requireParentUpdate(result, parent = 'lead') {
    if (result.rowCount !== 1) throw integrityError(`${parent}_parent_update_failed`, 'Related record update did not complete');
}

// Callers own BEGIN/COMMIT. A savepoint also undoes JavaScript validation errors
// when an optional caller catches them and continues its outer transaction.
async function withLeadSavepoint(client, name, operation) {
    if (!['lead_stage_transition', 'lead_booking_attach', 'lead_booking_ensure'].includes(name)) throw new TypeError('Unknown lead savepoint');
    try {
        await client.query(`SAVEPOINT ${name}`);
    } catch (error) {
        if (error.code === '25P01') throw integrityError('lead_transaction_required', 'Lead relationship operations require a transaction client', 500);
        throw error;
    }
    try {
        const result = await operation();
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return result;
    } catch (error) {
        // If cleanup fails, propagate that failure so the caller must roll back
        // the outer transaction; never report a successful partial handoff.
        try {
            await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
            await client.query(`RELEASE SAVEPOINT ${name}`);
        } catch (cleanupError) {
            const failure = integrityError('lead_savepoint_cleanup_failed', 'Lead relationship rollback could not be verified', 500);
            failure.cause = cleanupError;
            throw failure;
        }
        if (error.code === '40P01') {
            const conflict = integrityError('lead_transaction_conflict', 'Concurrent lead relationship update', 409);
            conflict.publicMessage = 'Пов’язані записи одночасно змінюються. Повторіть спробу.';
            conflict.cause = error;
            throw conflict;
        }
        throw error;
    }
}

module.exports = { integrityError, linkBusinessContext, positiveRecordId, assertLeadReference, requireParentUpdate, withLeadSavepoint };
