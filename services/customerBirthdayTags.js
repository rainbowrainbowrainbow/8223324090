const { createLogger } = require('../utils/logger');

const BIRTHDAY_TAG_KEY = 'birthday';
const BIRTHDAY_TAG_LABEL = 'Іменинник';
const BIRTHDAY_TAG_COLOR = '#EC4899';
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_BUSINESS_CONTEXT = 'event_genix';

const log = createLogger('CustomerBirthdayTags');

const BIRTHDAY_MONTH_NAMES = Object.freeze([
    'січня',
    'лютого',
    'березня',
    'квітня',
    'травня',
    'червня',
    'липня',
    'серпня',
    'вересня',
    'жовтня',
    'листопада',
    'грудня'
]);

function padMonth(month) {
    return String(month).padStart(2, '0');
}

const BIRTHDAY_MONTH_KEYS = Object.freeze(
    BIRTHDAY_MONTH_NAMES.map((_, index) => `birthday_month_${padMonth(index + 1)}`)
);
const BIRTHDAY_SYSTEM_TAG_KEYS = Object.freeze([BIRTHDAY_TAG_KEY, ...BIRTHDAY_MONTH_KEYS]);

const BIRTHDAY_TAG_LABELS = Object.freeze({
    [BIRTHDAY_TAG_KEY]: BIRTHDAY_TAG_LABEL,
    ...Object.fromEntries(BIRTHDAY_MONTH_KEYS.map((key, index) => [
        key,
        `Іменинники ${BIRTHDAY_MONTH_NAMES[index]}`
    ]))
});

const BIRTHDAY_TAG_COLORS = Object.freeze({
    [BIRTHDAY_TAG_KEY]: BIRTHDAY_TAG_COLOR,
    ...Object.fromEntries(BIRTHDAY_MONTH_KEYS.map(key => [key, BIRTHDAY_TAG_COLOR]))
});

function normalizeBirthdayMonth(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.getUTCMonth() + 1;
    }

    if (Number.isInteger(value)) {
        return value >= 1 && value <= 12 ? value : null;
    }

    const text = String(value || '').trim();
    if (!text) return null;

    const keyMatch = text.match(/^birthday_month_(\d{2})$/);
    if (keyMatch) {
        const month = Number.parseInt(keyMatch[1], 10);
        return month >= 1 && month <= 12 ? month : null;
    }

    const dateMatch = text.match(/^\d{4}-(\d{2})-\d{2}/);
    if (dateMatch) {
        const month = Number.parseInt(dateMatch[1], 10);
        return month >= 1 && month <= 12 ? month : null;
    }

    return null;
}

function birthdayMonthKey(date) {
    const month = normalizeBirthdayMonth(date);
    return month ? `birthday_month_${padMonth(month)}` : null;
}

function birthdayMonthLabel(month) {
    const key = birthdayMonthKey(month);
    return key ? BIRTHDAY_TAG_LABELS[key] : null;
}

function birthdaySystemTag(key) {
    if (!key || !BIRTHDAY_TAG_LABELS[key]) return null;
    return {
        source: 'system',
        systemKey: key,
        tag: BIRTHDAY_TAG_LABELS[key],
        color: BIRTHDAY_TAG_COLORS[key] || BIRTHDAY_TAG_COLOR
    };
}

function birthdaySystemTagsForDate(childBirthday) {
    const monthKey = birthdayMonthKey(childBirthday);
    if (!monthKey) return [];
    return [
        birthdaySystemTag(BIRTHDAY_TAG_KEY),
        birthdaySystemTag(monthKey)
    ].filter(Boolean);
}

function isPoolLike(clientOrPool) {
    return Boolean(clientOrPool && typeof clientOrPool.connect === 'function');
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
                        cc.birthday AS canonical_child_birthday
                 FROM customers c
                 LEFT JOIN LATERAL (
                     SELECT birthday
                     FROM customer_children
                     WHERE customer_id = c.id
                       AND business_context = COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}')
                       AND birthday IS NOT NULL
                       AND COALESCE(source_payload #>> '{manual_review,superseded}', 'false') <> 'true'
                     ORDER BY sort_order ASC, id ASC
                     LIMIT 1
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
        const childBirthday = customer?.canonical_child_birthday || customer?.child_birthday || null;
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

        const desiredTags = birthdaySystemTagsForDate(childBirthday);
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
