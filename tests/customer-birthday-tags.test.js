const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    BIRTHDAY_TAG_KEY,
    BIRTHDAY_MONTH_KEYS,
    BIRTHDAY_SYSTEM_TAG_KEYS,
    BIRTHDAY_TAG_LABELS,
    birthdayMonthKey,
    birthdayMonthLabel,
    birthdaySystemTagsForDate,
    syncBirthdayTagsForCustomer,
    syncBirthdayTagsForAllCustomers
} = require('../services/customerBirthdayTags');

const ROOT = path.join(__dirname, '..');

function readSource(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function createFakeBirthdayTagClient(customerOverrides = {}, tagRows = []) {
    const customer = {
        id: 1,
        child_birthday: null,
        business_context: 'event_genix',
        ...customerOverrides
    };
    const state = {
        customer,
        customers: [customer],
        tags: tagRows.map(row => ({ ...row })),
        tx: [],
        released: false,
        schemaColumns: ['source', 'system_key', 'updated_at']
    };

    const client = {
        state,
        async query(sql, params = []) {
            const compactSql = String(sql).replace(/\s+/g, ' ').trim();
            if (compactSql === 'BEGIN' || compactSql === 'COMMIT' || compactSql === 'ROLLBACK') {
                state.tx.push(compactSql);
                return { rows: [], rowCount: 0 };
            }

            if (compactSql.includes('FROM information_schema.columns')) {
                const rows = state.schemaColumns.map(column_name => ({ column_name }));
                return { rows, rowCount: rows.length };
            }

            if (compactSql.startsWith('SELECT c.id, c.child_birthday, c.business_context,')) {
                const id = params[0];
                const row = state.customers.find(item => item.id === id) || null;
                if (!row) {
                    return { rows: [], rowCount: 0 };
                }
                return {
                    rows: [{
                        ...row,
                        canonical_child_birthday: row.canonical_child_birthday || row.canonicalChildBirthday || null
                    }],
                    rowCount: 1
                };
            }

            if (compactSql.startsWith('SELECT id, child_birthday, business_context FROM customers')) {
                const id = params[0];
                const row = state.customers.find(item => item.id === id) || null;
                if (!row) {
                    return { rows: [], rowCount: 0 };
                }
                return { rows: [{ ...row }], rowCount: 1 };
            }

            if (compactSql.startsWith('SELECT id FROM customers')) {
                const [lastId, limit] = params;
                const rows = state.customers
                    .filter(item => item.id > lastId)
                    .sort((a, b) => a.id - b.id)
                    .slice(0, limit)
                    .map(item => ({ id: item.id }));
                return { rows, rowCount: rows.length };
            }

            if (compactSql.startsWith('DELETE FROM customer_tags')) {
                const [customerId, systemKeys] = params;
                const before = state.tags.length;
                state.tags = state.tags.filter(tag => !(
                    tag.customer_id === customerId
                    && tag.source === 'system'
                    && systemKeys.includes(tag.system_key)
                ));
                return { rows: [], rowCount: before - state.tags.length };
            }

            if (compactSql.startsWith('SELECT tag FROM customer_tags')) {
                const [customerId, labels] = params;
                const rows = state.tags
                    .filter(tag => tag.customer_id === customerId)
                    .filter(tag => (tag.source || 'manual') !== 'system')
                    .filter(tag => labels.includes(tag.tag))
                    .map(tag => ({ tag: tag.tag }));
                return { rows, rowCount: rows.length };
            }

            if (compactSql.startsWith('INSERT INTO customer_tags')) {
                const [customerId, tag, color, systemKey, createdBy] = params;
                const existing = state.tags.find(row => (
                    row.customer_id === customerId
                    && row.source === 'system'
                    && row.system_key === systemKey
                ));
                if (existing) {
                    existing.tag = tag;
                    existing.color = color;
                    return { rows: [], rowCount: 1 };
                }
                state.tags.push({
                    id: state.tags.length + 1,
                    customer_id: customerId,
                    tag,
                    color,
                    source: 'system',
                    system_key: systemKey,
                    created_by: createdBy
                });
                return { rows: [], rowCount: 1 };
            }

            throw new Error(`Unexpected SQL in birthday tag fake client: ${compactSql}`);
        },
        release() {
            state.released = true;
        }
    };

    return client;
}

function createFakeBirthdayTagPool(customers, tagRows = []) {
    const client = createFakeBirthdayTagClient(customers[0] || null, tagRows);
    client.state.customers = customers.map(customer => ({ ...customer }));
    client.state.customer = client.state.customers[0] || null;
    return {
        client,
        async query(sql, params) {
            return client.query(sql, params);
        },
        async connect() {
            return client;
        }
    };
}

function systemTags(client) {
    return client.state.tags
        .filter(tag => tag.source === 'system')
        .sort((a, b) => a.system_key.localeCompare(b.system_key));
}

function systemTagsForCustomer(client, customerId) {
    return systemTags(client).filter(tag => tag.customer_id === customerId);
}

test('customer birthday tag taxonomy returns canonical birthday and month tags', () => {
    assert.equal(BIRTHDAY_TAG_KEY, 'birthday');
    assert.equal(BIRTHDAY_MONTH_KEYS.length, 12);
    assert.equal(BIRTHDAY_MONTH_KEYS[6], 'birthday_month_07');
    assert.equal(BIRTHDAY_TAG_LABELS.birthday, 'Іменинник');

    assert.equal(birthdayMonthKey('2019-07-20'), 'birthday_month_07');
    assert.equal(birthdayMonthLabel(7), 'Іменинники липня');
    assert.equal(birthdayMonthLabel('birthday_month_07'), 'Іменинники липня');

    const tags = birthdaySystemTagsForDate('2019-07-20');
    assert.deepEqual(tags.map(tag => tag.systemKey), ['birthday', 'birthday_month_07']);
    assert.deepEqual(tags.map(tag => tag.tag), ['Іменинник', 'Іменинники липня']);
    assert.ok(tags.every(tag => tag.source === 'system'));
});

test('customer birthday tag taxonomy ignores invalid birthday values', () => {
    assert.equal(birthdayMonthKey(null), null);
    assert.equal(birthdayMonthKey('not-a-date'), null);
    assert.equal(birthdayMonthLabel(13), null);
    assert.deepEqual(birthdaySystemTagsForDate('not-a-date'), []);
});

test('syncBirthdayTagsForCustomer removes birthday system tags and adds nothing when birthday is empty', async () => {
    const client = createFakeBirthdayTagClient(
        { child_birthday: null },
        [
            {
                id: 10,
                customer_id: 1,
                tag: 'VIP',
                color: '#0EA5E9',
                source: 'manual',
                system_key: null
            },
            {
                id: 11,
                customer_id: 1,
                tag: 'Іменинник',
                color: '#EC4899',
                source: 'system',
                system_key: 'birthday'
            }
        ]
    );

    const result = await syncBirthdayTagsForCustomer(client, 1);

    assert.equal(result.found, true);
    assert.deepEqual(result.upsertedTags, []);
    assert.deepEqual(systemTags(client), []);
    assert.deepEqual(client.state.tags.map(tag => tag.tag), ['VIP']);
});

test('syncBirthdayTagsForCustomer creates canonical birthday and month system tags', async () => {
    const client = createFakeBirthdayTagClient({ child_birthday: '2019-07-20' });

    const result = await syncBirthdayTagsForCustomer(client, 1, { userId: 7 });
    const tags = systemTags(client);

    assert.equal(result.businessContext, 'event_genix');
    assert.deepEqual(tags.map(tag => tag.system_key), ['birthday', 'birthday_month_07']);
    assert.deepEqual(tags.map(tag => tag.tag), ['Іменинник', 'Іменинники липня']);
    assert.ok(tags.every(tag => tag.created_by === 7));
});

test('syncBirthdayTagsForCustomer prefers canonical child birthday over legacy field', async () => {
    const client = createFakeBirthdayTagClient({
        child_birthday: '2019-07-20',
        canonical_child_birthday: '2019-08-20'
    });

    const result = await syncBirthdayTagsForCustomer(client, 1);

    assert.equal(result.childBirthday, '2019-08-20');
    assert.deepEqual(systemTags(client).map(tag => tag.system_key), ['birthday', 'birthday_month_08']);
});

test('syncBirthdayTagsForCustomer ignores manually superseded canonical child birthdays', () => {
    const serviceSource = readSource('services/customerBirthdayTags.js');

    assert.ok(serviceSource.includes("COALESCE(source_payload #>> '{manual_review,superseded}', 'false') <> 'true'"));
});

test('syncBirthdayTagsForCustomer is idempotent and does not duplicate system rows', async () => {
    const client = createFakeBirthdayTagClient({ child_birthday: '2019-07-20' });

    await syncBirthdayTagsForCustomer(client, 1);
    await syncBirthdayTagsForCustomer(client, 1);

    assert.equal(systemTags(client).length, 2);
    assert.deepEqual(systemTags(client).map(tag => tag.system_key), ['birthday', 'birthday_month_07']);
});

test('syncBirthdayTagsForCustomer replaces old month tag after birthday month changes', async () => {
    const client = createFakeBirthdayTagClient({ child_birthday: '2019-07-20' });

    await syncBirthdayTagsForCustomer(client, 1);
    client.state.customer.child_birthday = '2019-08-20';
    await syncBirthdayTagsForCustomer(client, 1);

    assert.deepEqual(systemTags(client).map(tag => tag.system_key), ['birthday', 'birthday_month_08']);
    assert.deepEqual(systemTags(client).map(tag => tag.tag), ['Іменинник', 'Іменинники серпня']);
});

test('syncBirthdayTagsForCustomer removes all birthday system tags when birthday is cleared', async () => {
    const client = createFakeBirthdayTagClient({ child_birthday: '2019-07-20' });

    await syncBirthdayTagsForCustomer(client, 1);
    client.state.customer.child_birthday = null;
    await syncBirthdayTagsForCustomer(client, 1);

    assert.deepEqual(systemTags(client), []);
});

test('syncBirthdayTagsForCustomer preserves manual tags with the same label', async () => {
    const client = createFakeBirthdayTagClient(
        { child_birthday: '2019-07-20' },
        [
            {
                id: 10,
                customer_id: 1,
                tag: 'Іменинник',
                color: '#111827',
                source: 'manual',
                system_key: null
            }
        ]
    );

    const result = await syncBirthdayTagsForCustomer(client, 1);

    assert.deepEqual(result.skippedManualTags.map(tag => tag.systemKey), ['birthday']);
    assert.deepEqual(systemTags(client).map(tag => tag.system_key), ['birthday_month_07']);
    assert.equal(client.state.tags.find(tag => tag.source === 'manual').color, '#111827');
});

test('syncBirthdayTagsForCustomer owns transaction only when pool is provided', async () => {
    const client = createFakeBirthdayTagClient({ child_birthday: '2019-07-20' });
    const pool = {
        async connect() {
            return client;
        }
    };

    await syncBirthdayTagsForCustomer(pool, 1);

    assert.deepEqual(client.state.tx, ['BEGIN', 'COMMIT']);
    assert.equal(client.state.released, true);
});

test('syncBirthdayTagsForCustomer reports missing customer without tag writes', async () => {
    const client = createFakeBirthdayTagClient(null);
    client.state.customer = null;
    client.state.customers = [];

    const result = await syncBirthdayTagsForCustomer(client, 1);

    assert.deepEqual(result, {
        found: false,
        synced: false,
        customerId: 1,
        businessContext: null,
        childBirthday: null,
        upsertedTags: [],
        skippedManualTags: []
    });
    assert.deepEqual(client.state.tags, []);
});

test('syncBirthdayTagsForAllCustomers reconciles all customers in batches', async () => {
    const pool = createFakeBirthdayTagPool(
        [
            { id: 1, child_birthday: '2019-07-20', business_context: 'event_genix' },
            { id: 2, child_birthday: null, business_context: 'event_genix' },
            { id: 3, child_birthday: '2019-08-20', business_context: 'maysternya_doli' }
        ],
        [
            {
                id: 20,
                customer_id: 3,
                tag: 'Іменинники липня',
                color: '#EC4899',
                source: 'system',
                system_key: 'birthday_month_07'
            }
        ]
    );
    const logs = [];
    const logger = {
        info(message, data) { logs.push({ level: 'info', message, data }); },
        warn(message, data) { logs.push({ level: 'warn', message, data }); }
    };

    const result = await syncBirthdayTagsForAllCustomers({
        pool,
        batchSize: 2,
        userId: 9,
        logger
    });

    assert.equal(result.processed, 3);
    assert.equal(result.updated, 2);
    assert.equal(result.errors, 0);
    assert.equal(result.batches, 2);
    assert.deepEqual(systemTagsForCustomer(pool.client, 1).map(tag => tag.system_key), ['birthday', 'birthday_month_07']);
    assert.deepEqual(systemTagsForCustomer(pool.client, 2), []);
    assert.deepEqual(systemTagsForCustomer(pool.client, 3).map(tag => tag.system_key), ['birthday', 'birthday_month_08']);
    assert.ok(logs.some(entry => entry.level === 'info' && entry.message === 'Birthday tag reconciliation finished'));
});

test('syncBirthdayTagsForAllCustomers skips safely when system tag columns are missing', async () => {
    const pool = createFakeBirthdayTagPool([
        { id: 1, child_birthday: '2019-07-20', business_context: 'event_genix' }
    ]);
    pool.client.state.schemaColumns = ['source'];
    const logs = [];
    const logger = {
        info(message, data) { logs.push({ level: 'info', message, data }); },
        warn(message, data) { logs.push({ level: 'warn', message, data }); }
    };

    const result = await syncBirthdayTagsForAllCustomers({ pool, logger });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'customer_tags_system_columns_missing');
    assert.equal(result.processed, 0);
    assert.equal(result.updated, 0);
    assert.deepEqual(systemTags(pool.client), []);
    assert.ok(logs.some(entry => entry.level === 'warn' && entry.message.includes('skipped')));
});

test('customer tag catalog endpoint exposes system tag capability for live API regression tests', () => {
    const routeSource = readSource('routes/customers.js');

    assert.ok(routeSource.includes('const caps = await getCustomerTagColumnCapabilities(pool);'));
    assert.ok(routeSource.includes('capabilities:'));
    assert.ok(routeSource.includes('systemTags: caps.hasSource && caps.hasSystemKey && caps.hasUpdatedAt'));
});

test('birthday tag scheduler is exported and registered with daily backfill guard', () => {
    const schedulerSource = readSource('services/scheduler.js');
    const serverSource = readSource('server.js');

    assert.ok(schedulerSource.includes('async function checkBirthdayTagSync()'));
    assert.ok(schedulerSource.includes('syncBirthdayTagsForAllCustomers'));
    assert.ok(schedulerSource.includes('checkBirthdayTagSync,'));
    assert.ok(serverSource.includes('checkBirthdayTagSync } = require'));
    assert.ok(serverSource.includes("guardScheduler('checkBirthdayTagSync', checkBirthdayTagSync"));
    assert.ok(serverSource.includes("'customer_birthday_tags_backfill_done'"));
});
