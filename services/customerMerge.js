'use strict';

const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');

// Financial and untyped references are inspected, never reassigned by this MVP.
const CUSTOMER_MERGE_RELATIONS = Object.freeze([
    { table: 'bookings', label: 'Бронювання', mode: 'transfer' },
    { table: 'conversations', label: 'Діалоги', mode: 'transfer' },
    { table: 'customer_children', label: 'Записи дітей', mode: 'transfer' },
    { table: 'lead_customer_links', label: 'Зв’язки з лідами', mode: 'transfer' },
    { table: 'event_reviews', label: 'Відгуки та NPS', mode: 'transfer' },
    { table: 'communication_log', label: 'Історія комунікацій', mode: 'transfer' },
    { table: 'customer_tags', label: 'Теги', mode: 'transfer' },
    { table: 'support_tickets', label: 'Звернення підтримки', mode: 'transfer' },
    { table: 'banquet_groups', label: 'Банкетні групи', mode: 'transfer' },
    { table: 'certificates', label: 'Захищені записи', mode: 'protected' },
    { table: 'discount_usage', label: 'Захищені записи', mode: 'protected' },
    { table: 'banquet_deposits', label: 'Захищені записи', mode: 'protected' },
    { table: 'graduation_quotes', label: 'Захищені записи', mode: 'protected' },
    { table: 'customer_retention_log', label: 'Історичні записи без зовнішнього ключа', mode: 'review' },
    { table: 'tasks', label: 'Завдання з текстовим посиланням', mode: 'review', typed: true },
    { table: 'hermes_jobs', label: 'Службові процеси з текстовим посиланням', mode: 'review', typed: true },
    { table: 'trusted_qa_runs', label: 'Захищені QA-записи', mode: 'protected', column: 'required_customer_id', text: true }
]);
const RELATION_BY_TABLE = new Map(CUSTOMER_MERGE_RELATIONS.map(relation => [relation.table, relation]));
const KNOWN_CUSTOMER_FIELDS = new Set([
    'id', 'name', 'phone', 'instagram', 'child_name', 'child_birthday', 'source', 'notes',
    'social_identities', 'lead_id', 'business_context', 'total_bookings', 'total_spent',
    'first_visit', 'last_visit', 'average_rating', 'created_at', 'updated_at'
]);

class CustomerMergeError extends Error {
    constructor(code, message, status = 409) {
        super(message);
        this.name = 'CustomerMergeError';
        this.code = code;
        this.status = status;
    }
}

function validateMergeInput(primaryId, duplicateId, businessContext) {
    const values = [primaryId, duplicateId];
    if (values.some(value => typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value)))) {
        throw new CustomerMergeError('CUSTOMER_MERGE_INVALID_PAIR', 'Виберіть дві різні картки клієнтів.', 400);
    }
    const ids = values.map(value => Number(value));
    if (ids.some(id => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) || ids[0] === ids[1]) {
        throw new CustomerMergeError('CUSTOMER_MERGE_INVALID_PAIR', 'Виберіть дві різні картки клієнтів.', 400);
    }
    if (!businessContext || businessContext === 'all' || typeof businessContext !== 'string'
        || normalizeBusinessContext(businessContext) !== businessContext) {
        throw new CustomerMergeError('CUSTOMER_MERGE_INVALID_CONTEXT', 'Виберіть один доступний бізнес.', 400);
    }
    return { primaryId: ids[0], duplicateId: ids[1], businessContext };
}

function identityKey(identity) {
    if (!identity || typeof identity !== 'object') return null;
    const channel = String(identity.channel || identity.type || identity.provider || 'other').toLowerCase();
    const value = identity.handle || identity.username || identity.value || identity.phone || identity.email
        || identity.externalId || identity.external_id || identity.url || identity.href;
    if (!value) return null;
    return channel + ':' + String(value).trim().replace(channel === 'instagram' ? /^@+/ : /^$/, '').toLowerCase();
}

function mergeIdentities(primary, duplicate) {
    const result = [];
    const byKey = new Map();
    for (const values of [primary, duplicate]) {
        if (values !== null && values !== undefined && !Array.isArray(values)) {
            throw new CustomerMergeError('CUSTOMER_MERGE_IDENTITIES_INVALID', 'Контакти потребують ручного уточнення.');
        }
        for (const identity of values || []) {
            const key = identityKey(identity);
            if (!key) throw new CustomerMergeError('CUSTOMER_MERGE_IDENTITIES_INVALID', 'Контакти потребують ручного уточнення.');
            if (byKey.has(key)) {
                if (JSON.stringify(byKey.get(key)) !== JSON.stringify(identity)) {
                    throw new CustomerMergeError('CUSTOMER_MERGE_IDENTITIES_CONFLICT', 'Для одного контакту збережені різні дані. Уточніть їх перед об’єднанням.');
                }
                continue;
            }
            byKey.set(key, identity);
            result.push(identity);
        }
    }
    if (result.length > 12) throw new CustomerMergeError('CUSTOMER_MERGE_IDENTITIES_LIMIT', 'Після об’єднання буде понад 12 контактів. Потрібна ручна перевірка.');
    return result;
}

function customerProfileConflicts(primary, duplicate) {
    const conflicts = [];
    const add = (code, message) => conflicts.push({ code, message });
    for (const field of ['phone', 'instagram']) {
        const normalize = value => field === 'phone'
            ? String(value || '').replace(/\D/g, '')
            : String(value || '').trim().replace(/^@+/, '').toLowerCase();
        const a = normalize(primary[field]);
        const b = normalize(duplicate[field]);
        if (a && b && a !== b) add('CUSTOMER_MERGE_CONTACT_CONFLICT', 'Основні контакти відрізняються. Спочатку уточніть, чи це одна сім’я.');
    }
    for (const [field, value] of Object.entries(duplicate)) {
        if (!KNOWN_CUSTOMER_FIELDS.has(field) && value !== null && value !== undefined && value !== '') {
            add('CUSTOMER_MERGE_PROFILE_FIELD_UNSUPPORTED', 'У картці є додаткові дані, для яких перенесення ще не перевірене.');
            break;
        }
    }
    try { mergeIdentities(primary.social_identities, duplicate.social_identities); }
    catch (error) { add(error.code, error.message); }
    return conflicts;
}

async function readMergeSchema(client) {
    const columns = await client.query(`SELECT table_name, array_agg(column_name::text ORDER BY column_name) AS columns
        FROM information_schema.columns WHERE table_schema = 'public'
        GROUP BY table_name`);
    const tables = new Map(columns.rows.map(row => [row.table_name, new Set(row.columns)]));
    const foreignKeys = await client.query(`SELECT child_ns.nspname AS schema_name, child.relname AS table_name,
            array_agg(child_col.attname::text ORDER BY key.ordinality) AS columns,
            array_agg(parent_col.attname::text ORDER BY key.ordinality) AS referenced_columns
        FROM pg_constraint fk JOIN pg_class parent ON parent.oid = fk.confrelid
        JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
        JOIN pg_class child ON child.oid = fk.conrelid
        JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
        CROSS JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute child_col ON child_col.attrelid = child.oid AND child_col.attnum = key.attnum
        JOIN pg_attribute parent_col ON parent_col.attrelid = parent.oid AND parent_col.attnum = fk.confkey[key.ordinality]
        WHERE fk.contype = 'f' AND parent_ns.nspname = 'public' AND parent.relname = 'customers'
        GROUP BY fk.oid, child_ns.nspname, child.relname`);
    const customerForeignKeys = new Set();
    const unknown = [];
    for (const row of foreignKeys.rows) {
        if (row.schema_name !== 'public' || !RELATION_BY_TABLE.has(row.table_name)
            || row.columns.length !== 1 || row.columns[0] !== 'customer_id'
            || row.referenced_columns.length !== 1 || row.referenced_columns[0] !== 'id') {
            unknown.push(row.table_name);
        } else customerForeignKeys.add(row.table_name);
    }
    for (const [table, names] of tables) {
        if ((names.has('customer_id') || (names.has('source_entity_type') && names.has('source_entity_id')))
            && !RELATION_BY_TABLE.has(table)) {
            // A view is not an independently stored reference.
            const kind = await client.query(`SELECT relkind FROM pg_class
                WHERE oid = to_regclass($1)`, ['public.' + table]);
            if (['r', 'p'].includes(kind.rows[0]?.relkind)) unknown.push(table);
        }
    }
    return { tables, customerForeignKeys, unknown: [...new Set(unknown)].sort() };
}

async function readMergeReferences(client, input, schema) {
    const references = [];
    for (const relation of CUSTOMER_MERGE_RELATIONS) {
        const columns = schema.tables.get(relation.table);
        if (!columns) continue;
        const required = relation.typed ? ['id', 'source_entity_type', 'source_entity_id'] : ['id', relation.column || 'customer_id'];
        if (required.some(column => !columns.has(column))) {
            throw new CustomerMergeError('CUSTOMER_MERGE_SCHEMA_UNSUPPORTED', 'Модель пов’язаних даних змінилася. Об’єднання потребує перевірки.');
        }
        const reference = 'r.' + (relation.typed ? 'source_entity_id' : relation.column || 'customer_id');
        const idType = relation.typed || relation.text ? 'text' : 'int';
        const typed = relation.typed ? "r.source_entity_type = 'customer' AND " : '';
        const businessViolation = columns.has('business_context')
            ? `COALESCE(r.business_context, '${DEFAULT_BUSINESS_CONTEXT}') <> $3` : 'FALSE AND $3::text IS NOT NULL';
        const result = await client.query(`SELECT
                COUNT(*) FILTER (WHERE ${reference} = $1::${idType})::int AS primary_count,
                COUNT(*) FILTER (WHERE ${reference} = $2::${idType})::int AS duplicate_count,
                COUNT(*) FILTER (WHERE ${businessViolation})::int AS foreign_business_count
            FROM public.${relation.table} r
            WHERE ${typed}${reference} IN ($1::${idType}, $2::${idType})`,
        [input.primaryId, input.duplicateId, input.businessContext]);
        references.push({ ...relation, ...result.rows[0],
            hasForeignKey: schema.customerForeignKeys.has(relation.table) });
    }
    return references;
}

async function readMergeConflicts(client, input, schema, primary, duplicate, references) {
    const blockers = customerProfileConflicts(primary, duplicate);
    const add = (code, message) => blockers.push({ code, message });
    if (schema.unknown.length) add('CUSTOMER_MERGE_REFERENCE_UNSUPPORTED', 'Знайдено залежність, для якої перенесення ще не перевірене.');
    for (const reference of references) {
        if (reference.foreign_business_count) add('CUSTOMER_MERGE_FOREIGN_REFERENCE', 'Пов’язані записи належать різним бізнесам. Потрібна ручна перевірка.');
        if (!reference.duplicate_count) continue;
        if (reference.mode === 'protected') add('CUSTOMER_MERGE_PROTECTED_HISTORY', 'Друга картка має захищені історичні записи. Їх автоматичне перенесення не входить у цей етап.');
        else if (reference.mode === 'review' || !reference.hasForeignKey) add('CUSTOMER_MERGE_UNTYPED_REFERENCE', 'Є посилання без перевіреного зовнішнього ключа. Спочатку потрібне узгодження цих зв’язків.');
    }
    if (schema.tables.has('lead_customer_links')) {
        const overlap = await client.query(`SELECT 1 FROM lead_customer_links a JOIN lead_customer_links b
            ON a.business_context = b.business_context AND a.lead_id = b.lead_id AND a.link_type = b.link_type
            WHERE a.customer_id = $1 AND b.customer_id = $2 LIMIT 1`, [input.primaryId, input.duplicateId]);
        if (overlap.rows.length) add('CUSTOMER_MERGE_LEAD_LINK_CONFLICT', 'Обидві картки містять той самий зв’язок із лідом. Потрібна перевірка його історії.');
    }
    const children = references.find(reference => reference.table === 'customer_children');
    if (children && Number(children.primary_count) + Number(children.duplicate_count) > 50) {
        add('CUSTOMER_MERGE_CHILD_LIMIT', 'Разом є понад 50 записів дітей. Потрібна ручна перевірка.');
    }
    if (children) {
        const overlap = await client.query(`SELECT 1 FROM customer_children a JOIN customer_children b
            ON a.business_context = b.business_context AND (
                (a.source_kind = 'legacy_customer_child' AND b.source_kind = a.source_kind)
                OR (a.source_kind = 'lead_celebrant' AND b.source_kind = a.source_kind
                    AND a.lead_id = b.lead_id AND a.source_payload->>'celebrant_index' = b.source_payload->>'celebrant_index')
                OR (NULLIF(BTRIM(a.name), '') IS NOT NULL AND LOWER(BTRIM(a.name)) = LOWER(BTRIM(b.name))
                    AND a.birthday IS NOT DISTINCT FROM b.birthday))
            WHERE a.customer_id = $1 AND b.customer_id = $2 LIMIT 1`, [input.primaryId, input.duplicateId]);
        if (overlap.rows.length) add('CUSTOMER_MERGE_CHILD_CONFLICT', 'Записи дітей можуть дублюватися. Уточніть їх перед об’єднанням.');
    }
    if (schema.tables.has('customer_tags')) {
        const overlap = await client.query(`SELECT 1 FROM customer_tags a JOIN customer_tags b ON a.tag = b.tag
            WHERE a.customer_id = $1 AND b.customer_id = $2 LIMIT 1`, [input.primaryId, input.duplicateId]);
        if (overlap.rows.length) add('CUSTOMER_MERGE_TAG_CONFLICT', 'На обох картках є однакові теги. Потрібно узгодити їхню історію.');
    }
    if ((duplicate.child_name || duplicate.child_birthday) && !Number(children?.duplicate_count)) {
        add('CUSTOMER_MERGE_LEGACY_CHILD', 'Дані дитини збережені в старих полях картки. Їх перенесення потрібно перевірити окремо.');
    }
    const parentLinks = [
        ['customers', 'lead_id', 'leads', 'id'],
        ['lead_customer_links', 'lead_id', 'leads', 'customer_id'],
        ['customer_children', 'lead_id', 'leads', 'customer_id'],
        ['customer_children', 'booking_id', 'bookings', 'customer_id'],
        ['conversations', 'lead_id', 'leads', 'customer_id'],
        ['event_reviews', 'booking_id', 'bookings', 'customer_id'],
        ['banquet_groups', 'primary_booking_id', 'bookings', 'customer_id']
    ];
    for (const [table, column, parent, owner] of parentLinks) {
        if (!schema.tables.get(table)?.has(column) || !schema.tables.get(parent)?.has('business_context')) continue;
        const mismatch = await client.query(`SELECT 1 FROM public.${table} r
            LEFT JOIN public.${parent} p ON p.id = r.${column}
            WHERE r.${owner} IN ($1, $2) AND r.${column} IS NOT NULL
                AND (p.id IS NULL OR COALESCE(p.business_context, '${DEFAULT_BUSINESS_CONTEXT}') <> $3)
            LIMIT 1`, [input.primaryId, input.duplicateId, input.businessContext]);
        if (mismatch.rows.length) add('CUSTOMER_MERGE_PARENT_REFERENCE', 'Пов’язаний лід або бронювання відсутні чи належать іншому бізнесу. Потрібна ручна перевірка.');
    }
    return [...new Map(blockers.map(blocker => [blocker.code, blocker])).values()];
}

async function buildCustomerMergePlan(client, input) {
    const result = await client.query(`SELECT * FROM customers
        WHERE id = ANY($1::int[]) AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
        ORDER BY id`, [[input.primaryId, input.duplicateId], input.businessContext]);
    if (result.rows.length !== 2) throw new CustomerMergeError('CUSTOMER_MERGE_PAIR_NOT_FOUND', 'Обидві картки мають існувати в обраному бізнесі.', 404);
    const primary = result.rows.find(row => row.id === input.primaryId);
    const duplicate = result.rows.find(row => row.id === input.duplicateId);
    const schema = await readMergeSchema(client);
    const references = await readMergeReferences(client, input, schema);
    const blockers = await readMergeConflicts(client, input, schema, primary, duplicate, references);
    return { input, primary, duplicate, schema, references, blockers };
}

function publicCustomerMergePlan(plan) {
    const profile = customer => ({ id: customer.id, name: customer.name, phone: customer.phone, instagram: customer.instagram });
    return {
        primary: profile(plan.primary), duplicate: profile(plan.duplicate), businessContext: plan.input.businessContext,
        canMerge: false, reviewPassed: plan.blockers.length === 0, blockers: plan.blockers,
        message: 'Це перевірка зв’язків без змін даних. Об’єднання залишається недоступним.',
        records: plan.references.filter(reference=>reference.mode !== 'protected')
            .map(reference=>({ key: reference.table, label: reference.label, count: Number(reference.duplicate_count) })),
        fields: ['Лічильники стосуються другої картки в цій парі.',
            'Відсутність виявлених конфліктів не гарантує безпечне об’єднання.',
            'Збіг контактів не доводить, що це одна сім’я.'],
        changesPerformed: false
    };
}

async function previewCustomerMerge(pool, primaryId, duplicateId, businessContext) {
    const input = validateMergeInput(primaryId, duplicateId, businessContext);
    const client = await pool.connect();
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query("SET LOCAL statement_timeout = '10s'");
        await client.query("SET LOCAL lock_timeout = '2s'");
        const plan = await buildCustomerMergePlan(client, input);
        await client.query('COMMIT');
        return publicCustomerMergePlan(plan);
    } catch (error) {
        await client.query('ROLLBACK').catch(()=>{});
        throw error;
    } finally { client.release(); }
}

module.exports = { CustomerMergeError, CUSTOMER_MERGE_RELATIONS, validateMergeInput, mergeIdentities,
    customerProfileConflicts, readMergeSchema, buildCustomerMergePlan, publicCustomerMergePlan, previewCustomerMerge };
