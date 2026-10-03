const { createLogger } = require('../utils/logger');

const {
    BIRTHDAY_TAG_KEY, BIRTHDAY_TAG_LABEL, BIRTHDAY_TAG_COLOR, BIRTHDAY_MONTH_KEYS,
    BIRTHDAY_SYSTEM_TAG_KEYS, BIRTHDAY_TAG_LABELS, BIRTHDAY_TAG_COLORS,
    birthdayMonthKey, birthdayMonthLabel, birthdaySystemTagsForDate,
    birthdaySystemTagsForChildren, birthdayChildrenSql
} = require('./customerBirthdaySegments');
const DEFAULT_BATCH_SIZE = 500;
const log = createLogger('CustomerBirthdayTags');

function isPoolLike(clientOrPool) {
    // Checked-out pg clients also expose connect(); their caller owns the transaction.
    return Boolean(clientOrPool && typeof clientOrPool.connect === 'function'
        && typeof clientOrPool.release !== 'function');
}

function birthdayTagDefaultPool() {
    return require('../db').pool;
}

function normalizeBatchSize(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
    return Math.min(parsed, 5000);
}

async function getBirthdayTagSchemaCapabilities(queryable) {
    const result = await queryable.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'customer_tags'
           AND column_name IN ('source', 'system_key', 'updated_at')`
    );
    const columns = new Set(result.rows.map(row => row.column_name));
    return {
        hasSource: columns.has('source'),
        hasSystemKey: columns.has('system_key'),
        hasUpdatedAt: columns.has('updated_at')
    };
}

async function withBirthdayTagClient(clientOrPool, work) {
    if (!clientOrPool) throw new Error('DB client or pool is required');

    if (!isPoolLike(clientOrPool)) {
        return work(clientOrPool);
    }

    const client = await clientOrPool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release?.();
    }
}

async function syncBirthdayTagsForCustomer(clientOrPool, customerId, options = {}) {
    const numericCustomerId = Number.parseInt(customerId, 10);
    if (!Number.isInteger(numericCustomerId) || numericCustomerId <= 0) {
        throw new Error('Valid customerId is required');
    }

    return withBirthdayTagClient(clientOrPool, async (db) => {
        let customerResult;
        try {
            customerResult = await db.query(
                `SELECT c.id, c.child_birthday, c.business_context,
                        cc.children AS birthday_children
                 FROM customers c
                 LEFT JOIN LATERAL (
                     SELECT COALESCE(jsonb_agg(jsonb_build_object('birthday', bd.birthday::text)
                         ORDER BY bd.sort_order, bd.id), '[]'::jsonb) AS children
                     FROM (${birthdayChildrenSql('c')}) bd
                 ) cc ON TRUE
                 WHERE c.id = $1
                 LIMIT 1`,
                [numericCustomerId]
            );
        } catch (err) {
            const message = String(err?.message || '');
            if (!['42P01', '42703'].includes(String(err?.code || ''))
                && !(/customer_children/i.test(message) && /(does not exist|undefined|column)/i.test(message))) {
                throw err;
            }
            customerResult = await db.query(
                `SELECT id, child_birthday, business_context
                 FROM customers
                 WHERE id = $1
                 LIMIT 1`,
                [numericCustomerId]
            );
        }

        const customer = customerResult.rows[0];
        const birthdayChildren = customer?.birthday_children
            ?? (customer?.child_birthday ? [{ birthday: customer.child_birthday }] : []);
        const childBirthday = birthdayChildren[0]?.birthday || null;
        if (!customer) {
            return {
                found: false,
                synced: false,
                customerId: numericCustomerId,
                businessContext: null,
                childBirthday: null,
                upsertedTags: [],
                skippedManualTags: []
            };
        }

        const deleteResult = await db.query(
            `DELETE FROM customer_tags
             WHERE customer_id = $1
               AND source = 'system'
               AND system_key = ANY($2::text[])`,
            [numericCustomerId, BIRTHDAY_SYSTEM_TAG_KEYS]
        );

        const desiredTags = birthdaySystemTagsForChildren(birthdayChildren);
        const desiredLabels = desiredTags.map(tag => tag.tag);
        let manualLabels = new Set();
        if (desiredLabels.length) {
            const manualResult = await db.query(
                `SELECT tag
                 FROM customer_tags
                 WHERE customer_id = $1
                   AND COALESCE(source, 'manual') != 'system'
                   AND tag = ANY($2::text[])`,
                [numericCustomerId, desiredLabels]
            );
            manualLabels = new Set(manualResult.rows.map(row => row.tag));
        }

        const upsertedTags = [];
        const skippedManualTags = [];
        for (const tag of desiredTags) {
            if (manualLabels.has(tag.tag)) {
                skippedManualTags.push(tag);
                continue;
            }
            await db.query(
                `INSERT INTO customer_tags (customer_id, tag, color, source, system_key, created_by, updated_at)
                 VALUES ($1, $2, $3, 'system', $4, $5, NOW())
                 ON CONFLICT (customer_id, system_key)
                 WHERE source = 'system' AND system_key IS NOT NULL
                 DO UPDATE SET
                    tag = EXCLUDED.tag,
                    color = EXCLUDED.color,
                    updated_at = NOW()`,
                [numericCustomerId, tag.tag, tag.color, tag.systemKey, options.userId || null]
            );
            upsertedTags.push(tag);
        }

        return {
            found: true,
            synced: true,
            customerId: customer.id,
            businessContext: customer.business_context || null,
            childBirthday,
            deletedTags: Number(deleteResult.rowCount || 0),
            upsertedTags,
            skippedManualTags,
            changed: Boolean(Number(deleteResult.rowCount || 0) || upsertedTags.length)
        };
    });
}

async function syncBirthdayTagsForAllCustomers(options = {}) {
    // Scheduled calls must never authorize a historical data reconciliation.
    // An operator may opt in only in a separately approved, scoped operation.
    if (options.allowReconciliation !== true) {
        return { processed: 0, updated: 0, errors: 0, batches: 0,
            skipped: true, reason: 'explicit_reconciliation_required' };
    }
    const queryable = options.clientOrPool || options.pool || birthdayTagDefaultPool();
    const batchSize = normalizeBatchSize(options.batchSize);
    const logger = options.logger || log;
    const userId = options.userId || null;
    const stats = {
        processed: 0,
        updated: 0,
        errors: 0,
        batches: 0,
        skipped: false,
        reason: null
    };

    const caps = await getBirthdayTagSchemaCapabilities(queryable);
    if (!caps.hasSource || !caps.hasSystemKey || !caps.hasUpdatedAt) {
        stats.skipped = true;
        stats.reason = 'customer_tags_system_columns_missing';
        logger.warn('Birthday tag reconciliation skipped: customer_tags system columns are missing', {
            hasSource: caps.hasSource,
            hasSystemKey: caps.hasSystemKey,
            hasUpdatedAt: caps.hasUpdatedAt
        });
        return stats;
    }

    let lastCustomerId = 0;
    while (true) {
        const customers = await queryable.query(
            `SELECT id
             FROM customers
             WHERE id > $1
             ORDER BY id ASC
             LIMIT $2`,
            [lastCustomerId, batchSize]
        );

        if (!customers.rows.length) break;
        stats.batches++;

        for (const row of customers.rows) {
            const customerId = Number(row.id);
            lastCustomerId = Math.max(lastCustomerId, customerId);
            stats.processed++;
            try {
                const result = await syncBirthdayTagsForCustomer(queryable, customerId, { userId });
                if (result.changed) stats.updated++;
            } catch (err) {
                stats.errors++;
                logger.warn('Birthday tag reconciliation failed for customer', {
                    customerId,
                    error: err.message
                });
            }
        }

        if (customers.rows.length < batchSize) break;
    }

    logger.info('Birthday tag reconciliation finished', stats);
    return stats;
}

module.exports = {
    BIRTHDAY_TAG_KEY,
    BIRTHDAY_TAG_LABEL,
    BIRTHDAY_TAG_COLOR,
    BIRTHDAY_MONTH_KEYS,
    BIRTHDAY_SYSTEM_TAG_KEYS,
    BIRTHDAY_TAG_LABELS,
    BIRTHDAY_TAG_COLORS,
    birthdayMonthKey,
    birthdayMonthLabel,
    birthdaySystemTagsForDate,
    syncBirthdayTagsForCustomer,
    syncBirthdayTagsForAllCustomers
};
