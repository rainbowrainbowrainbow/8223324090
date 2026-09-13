'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { Pool } = require('pg');
const { transitionLeadStage } = require('../../services/leadStageTransition');
const { attachLeadBookingLink, ensureLeadForBooking, upsertLeadCustomerLink } = require('../../services/leadBookingLink');

const socket = process.env.BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST === '1';
const fixtureUrl = process.env.BUSINESS_MEMBERSHIP_TEST_DATABASE_URL;

function localConnection() {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) assert.ok(!process.env[key]);
    if (socket) {
        assert.equal(process.platform, 'linux');
        return { host: '/var/run/postgresql', user: 'postgres', database: 'postgres' };
    }
    const url = new URL(fixtureUrl);
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.match(url.pathname, /(?:^|[_-])(test|testing|ci|disposable)(?:[_-]|$)/i);
    assert.doesNotMatch(url.pathname, /(?:^|[_-])(prod|production|live)(?:[_-]|$)/i);
    assert.notEqual(fixtureUrl, process.env.DATABASE_URL);
    return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432),
        user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.slice(1)), ssl: false };
}

test('D04 direct lead services preserve related-record ownership and transaction integrity with PostgreSQL', {
    skip: !socket && !fixtureUrl, timeout: 120000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_d04_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_d04_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    let pool, created = false;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 8, connectionTimeoutMillis: 5000 });
        await pool.query(`
            CREATE TABLE organizations (id INT PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE businesses (context_key TEXT PRIMARY KEY, organization_id INT NOT NULL REFERENCES organizations(id),
                access_mode TEXT NOT NULL DEFAULT 'membership' CHECK(access_mode IN ('membership','compatibility')));
            CREATE TABLE products (id VARCHAR(50) PRIMARY KEY, business_context TEXT, name TEXT);
            CREATE TABLE customers (id SERIAL PRIMARY KEY, business_context TEXT, name TEXT, lead_id INT,
                source TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());
            CREATE TABLE bookings (id TEXT PRIMARY KEY, business_context TEXT, customer_id INT REFERENCES customers(id),
                program_id VARCHAR(50), status TEXT DEFAULT 'confirmed');
            CREATE TABLE leads (id SERIAL PRIMARY KEY, business_context TEXT, client_name TEXT, phone TEXT,
                telegram_id BIGINT, instagram TEXT, source TEXT, source_channel TEXT, external_id TEXT,
                program_id VARCHAR(50), booking_id TEXT REFERENCES bookings(id),
                event_date DATE, children_count INT, notes TEXT, raw_payload JSONB, lead_type TEXT DEFAULT 'quality',
                pipeline_stage TEXT DEFAULT 'new', status TEXT DEFAULT 'new', lost_reason TEXT,
                booked_at TIMESTAMPTZ, last_contact_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW());
            CREATE UNIQUE INDEX lead_external_fixture ON leads(business_context, source_channel, external_id)
                WHERE external_id IS NOT NULL;
            ALTER TABLE customers ADD FOREIGN KEY (lead_id) REFERENCES leads(id);
            CREATE TABLE lead_customer_links (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL,
                lead_id INT NOT NULL REFERENCES leads(id), customer_id INT NOT NULL REFERENCES customers(id),
                link_type TEXT NOT NULL, source TEXT, metadata JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(business_context, lead_id, customer_id, link_type));
            CREATE TABLE lead_interactions (id SERIAL PRIMARY KEY, lead_id INT NOT NULL REFERENCES leads(id),
                user_id INT, type TEXT, summary TEXT, details JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
            CREATE FUNCTION fixture_suppress_update() RETURNS trigger AS $$ BEGIN RETURN NULL; END; $$ LANGUAGE plpgsql;
            CREATE FUNCTION fixture_fail_insert() RETURNS trigger AS $$
                BEGIN RAISE EXCEPTION 'Disposable D04 child insert failure'; END; $$ LANGUAGE plpgsql;
        `);
        async function reset() {
            await pool.query(`DROP TRIGGER IF EXISTS fixture_parent_zero ON leads;
                DROP TRIGGER IF EXISTS fixture_customer_zero ON customers;
                DROP TRIGGER IF EXISTS fixture_child_failure ON lead_customer_links;
                TRUNCATE lead_interactions, lead_customer_links, leads, bookings, customers, products, businesses,
                    organizations RESTART IDENTITY CASCADE;
                INSERT INTO organizations VALUES (1,'Fixture A'),(2,'Fixture B');
                INSERT INTO businesses(context_key,organization_id) VALUES ('event_genix',1),('dar',1),('fixture_custom',2);
                INSERT INTO businesses VALUES ('maysternya_doli',1,'compatibility');
                INSERT INTO products VALUES ('park-product','event_genix','Park'),('dar-product','dar','Dar'),
                    ('custom-product','fixture_custom','Custom'),('legacy-product',NULL,'Legacy'),
                    ('md_full_consult_40','maysternya_doli','MD real product');
                INSERT INTO customers (id,business_context,name) VALUES (11,'event_genix','Park'),(12,'dar','Dar'),
                    (13,'fixture_custom','Custom'),(14,NULL,'Legacy'),(15,'maysternya_doli','MD');
                INSERT INTO bookings (id,business_context,customer_id,program_id) VALUES
                    ('park-booking','event_genix',11,'park-product'),('dar-booking','dar',12,'dar-product'),
                    ('custom-booking','fixture_custom',13,'custom-product'),('legacy-booking',NULL,14,'legacy-product'),
                    ('md-booking','maysternya_doli',15,'MD');
                INSERT INTO leads (id,business_context,client_name,phone) VALUES (101,'event_genix','Park','park-contact'),
                    (102,'dar','Dar','dar-contact'),(103,'fixture_custom','Custom','custom-contact'),(104,NULL,'Legacy','legacy-contact');
                SELECT setval(pg_get_serial_sequence('leads','id'),200);
                SELECT setval(pg_get_serial_sequence('customers','id'),20);`);
        }
        async function snapshot(queryable = pool) {
            const result = {};
            for (const table of ['leads', 'customers', 'bookings', 'lead_customer_links', 'lead_interactions']) {
                result[table] = (await queryable.query(`SELECT to_jsonb(s) AS row FROM ${table} s ORDER BY to_jsonb(s)::text`)).rows;
            }
            return result;
        }
        async function transaction(callback, { rollback = false } = {}) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query("SET LOCAL lock_timeout = '5s'");
                const result = await callback(client);
                await client.query(rollback ? 'ROLLBACK' : 'COMMIT');
                return result;
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally { client.release(); }
        }
        const bookingInput = (context = 'dar') => ({
            id: context === 'dar' ? 'dar-booking' : 'custom-booking',
            programId: context === 'dar' ? 'dar-product' : 'custom-product',
            status: 'confirmed', date: '2099-01-01', customer: { name: 'Disposable fixture', phone: 'new-contact' }
        });
        async function expectDenial(callback, expectedCode = 'lead_reference_unavailable') {
            const before = await snapshot();
            let failure;
            try { await transaction(callback); } catch (error) { failure = error; }
            assert.ok(failure, 'Direct service must reject the invalid related record');
            assert.ok([400, 404, 409].includes(failure.statusCode || failure.status),
                `Expected domain denial, received ${failure.code || failure.name}`);
            assert.equal(failure.code, expectedCode);
            assert.deepEqual(await snapshot(), before, 'Denied operation must not persist partial parents, links or interactions');
        }

        for (const [label, callback] of [
            ['stage transition rejects a supplied booking from another business in the same organization', c => transitionLeadStage(c, {
                leadId: 102, businessContext: 'dar', targetStage: 'deposit_received', bookingId: 'park-booking' })],
            ['stage transition rejects a supplied booking from a different organization', c => transitionLeadStage(c, {
                leadId: 102, businessContext: 'dar', targetStage: 'deposit_received', bookingId: 'custom-booking' })],
            ['skipped stage cannot attach a foreign booking through booking-only update', c => transitionLeadStage(c, {
                leadId: 102, businessContext: 'dar', targetStage: 'deposit_received', allowedFromStages: ['completed'], bookingId: 'park-booking' })],
            ['ensure rejects a supplied foreign booking even when its payload claims an owned product', c => ensureLeadForBooking(c, {
                businessContext: 'dar', customerId: 12, booking: { ...bookingInput(), id: 'park-booking' } })],
            ['ensure rejects a supplied foreign product before inserting the lead', c => ensureLeadForBooking(c, {
                businessContext: 'dar', customerId: 12, booking: { ...bookingInput(), programId: 'park-product' } })],
            ['ensure rejects a foreign customer before inserting the lead', c => ensureLeadForBooking(c, {
                businessContext: 'dar', customerId: 11, booking: bookingInput() })],
            ['attach rejects a foreign booking', c => attachLeadBookingLink(c, {
                businessContext: 'dar', leadId: 102, customerId: 12, bookingId: 'park-booking' })],
            ['attach rejects a foreign customer without a history link', c => attachLeadBookingLink(c, {
                businessContext: 'dar', leadId: 102, customerId: 11, bookingId: 'dar-booking' })],
            ['direct link upsert rejects a foreign customer', c => upsertLeadCustomerLink(c, {
                businessContext: 'dar', leadId: 102, customerId: 11 })],
            ['direct link upsert rejects a foreign lead', c => upsertLeadCustomerLink(c, {
                businessContext: 'dar', leadId: 101, customerId: 12 })],
            ['direct link upsert rejects a custom-context lead from another organization', c => upsertLeadCustomerLink(c, {
                businessContext: 'dar', leadId: 103, customerId: 12 })],
            ['legacy NULL customer context cannot inherit the requested Dar context', c => attachLeadBookingLink(c, {
                businessContext: 'dar', leadId: 102, customerId: 14, bookingId: 'dar-booking' })],
            ['legacy NULL lead context cannot inherit the requested Dar context', c => upsertLeadCustomerLink(c, {
                businessContext: 'dar', leadId: 104, customerId: 12 })]
        ]) {
            await t.test(label, async () => { await reset(); await expectDenial(callback); });
        }

        await t.test('foreign lead attachment preserves compatible unattached result and has no writes', async () => {
            await reset();
            const before = await snapshot();
            const result = await transaction(c => attachLeadBookingLink(c, {
                businessContext: 'dar', leadId: 101, customerId: 12, bookingId: 'dar-booking' }));
            assert.equal(result.attached, false);
            assert.equal(result.reason, 'lead_not_found');
            assert.deepEqual(await snapshot(), before);
        });

        for (const [label, callback, triggerTable] of [
            ['stage update', c => transitionLeadStage(c, { leadId: 102, businessContext: 'dar', targetStage: 'deposit_received' }), 'leads'],
            ['booking-only stage update', c => transitionLeadStage(c, { leadId: 102, businessContext: 'dar', targetStage: 'deposit_received',
                bookingId: 'dar-booking', allowedFromStages: ['completed'] }), 'leads'],
            ['ensure existing lead update', c => ensureLeadForBooking(c, { businessContext: 'dar', customerId: 12,
                booking: { ...bookingInput(), customer: { name: 'Dar', phone: 'dar-contact' } } }), 'leads'],
            ['attach customer update', c => attachLeadBookingLink(c, { businessContext: 'dar', leadId: 102, customerId: 12,
                bookingId: 'dar-booking' }), 'customers'],
            ['ensure customer update', c => ensureLeadForBooking(c, { businessContext: 'dar', customerId: 12,
                booking: bookingInput() }), 'customers']
        ]) {
            await t.test(`zero-row ${label} aborts and leaves no child links`, async () => {
                await reset();
                const triggerName = triggerTable === 'leads' ? 'fixture_parent_zero' : 'fixture_customer_zero';
                await pool.query(`CREATE TRIGGER ${triggerName} BEFORE UPDATE ON ${triggerTable}
                    FOR EACH ROW EXECUTE FUNCTION fixture_suppress_update()`);
                await expectDenial(callback, triggerTable === 'leads' ? 'lead_parent_update_failed' : 'customer_parent_update_failed');
            });
        }

        for (const [label, arrange, callback] of [
            ['retained foreign lead product', () => pool.query("UPDATE leads SET program_id='park-product' WHERE id=102"),
                c => transitionLeadStage(c, { leadId: 102, businessContext: 'dar', targetStage: 'contacted' })],
            ['retained foreign lead booking', () => pool.query("UPDATE leads SET booking_id='park-booking' WHERE id=102"),
                c => transitionLeadStage(c, { leadId: 102, businessContext: 'dar', targetStage: 'contacted' })],
            ['retained foreign customer lead during attachment', () => pool.query('UPDATE customers SET lead_id=101 WHERE id=12'),
                c => attachLeadBookingLink(c, { leadId: 102, customerId: 12, bookingId: 'dar-booking', businessContext: 'dar' })],
            ['retained foreign customer lead during ensure', () => pool.query('UPDATE customers SET lead_id=101 WHERE id=12'),
                c => ensureLeadForBooking(c, { customerId: 12, businessContext: 'dar', booking: bookingInput() })],
            ['retained foreign customer lead during direct link upsert', () => pool.query('UPDATE customers SET lead_id=101 WHERE id=12'),
                c => upsertLeadCustomerLink(c, { leadId: 102, customerId: 12, businessContext: 'dar' })],
            ['stored booking foreign product masked by an owned supplied product',
                () => pool.query("UPDATE bookings SET program_id='park-product' WHERE id='dar-booking'"),
                c => ensureLeadForBooking(c, { customerId: 12, businessContext: 'dar', booking: bookingInput() })],
            ['terminal external-id conflict retaining a foreign booking',
                () => pool.query(`UPDATE leads SET pipeline_stage='closed', status='completed', source_channel='booking',
                    external_id='dar-booking', booking_id='park-booking' WHERE id=102`),
                c => ensureLeadForBooking(c, { customerId: 12, businessContext: 'dar', booking: bookingInput() })],
            ['terminal external-id conflict retaining a foreign product',
                () => pool.query(`UPDATE leads SET pipeline_stage='closed', status='completed', source_channel='booking',
                    external_id='dar-booking', program_id='park-product' WHERE id=102`),
                c => ensureLeadForBooking(c, { customerId: 12, businessContext: 'dar', booking: bookingInput() })]
        ]) {
            await t.test(`${label} is denied without laundering a preexisting invalid relation`, async () => {
                await reset();
                await arrange();
                await expectDenial(callback);
            });
        }

        for (const [label, callback, code] of [
            ['malformed business context', c => ensureLeadForBooking(c, { booking: bookingInput(), customerId: 12,
                businessContext: '../../dar' }), 'business_context_invalid'],
            ['malformed lead identifier', c => upsertLeadCustomerLink(c, { leadId: '102junk', customerId: 12,
                businessContext: 'dar' }), 'invalid_lead_reference'],
            ['malformed customer identifier', c => upsertLeadCustomerLink(c, { leadId: 102, customerId: '12junk',
                businessContext: 'dar' }), 'invalid_lead_reference']
        ]) {
            await t.test(`${label} cannot silently normalize into an existing record`, async () => {
                await reset();
                await expectDenial(callback, code);
            });
        }

        for (const [label, callback] of [
            ['stage transition', c => transitionLeadStage(c, { leadId: 102, businessContext: 'dar', targetStage: 'contacted' })],
            ['booking attachment', c => attachLeadBookingLink(c, { leadId: 102, customerId: 12, bookingId: 'dar-booking', businessContext: 'dar' })],
            ['booking ensure', c => ensureLeadForBooking(c, { customerId: 12, businessContext: 'dar', booking: bookingInput() })]
        ]) {
            await t.test(`${label} refuses a nontransactional caller before writes`, async () => {
                await reset();
                const before = await snapshot();
                const client = await pool.connect();
                try { await assert.rejects(callback(client), error => error.code === 'lead_transaction_required'); }
                finally { client.release(); }
                assert.deepEqual(await snapshot(), before);
            });
        }

        for (const [label, callback] of [
            ['attach', c => attachLeadBookingLink(c, { businessContext: 'dar', leadId: 102, customerId: 12, bookingId: 'dar-booking' })],
            ['ensure', c => ensureLeadForBooking(c, { businessContext: 'dar', customerId: 12, booking: bookingInput() })]
        ]) {
            await t.test(`caught ${label} customer-update failure rolls back its service savepoint while caller can commit`, async () => {
                await reset();
                await pool.query(`CREATE TRIGGER fixture_customer_zero BEFORE UPDATE ON customers
                    FOR EACH ROW EXECUTE FUNCTION fixture_suppress_update()`);
                const before = await snapshot();
                await transaction(async client => {
                    await assert.rejects(callback(client), error => error.code === 'customer_parent_update_failed');
                    assert.deepEqual(await snapshot(client), before);
                    await client.query("INSERT INTO products(id,business_context,name) VALUES ('caller-marker','dar','Caller survives')");
                });
                assert.deepEqual(await snapshot(), before);
                assert.equal((await pool.query("SELECT id FROM products WHERE id='caller-marker'")).rowCount, 1);
            });
        }

        await t.test('caught child SQL error recovers the savepoint and preserves only unrelated caller work', async () => {
            await reset();
            await pool.query(`CREATE TRIGGER fixture_child_failure BEFORE INSERT ON lead_customer_links
                FOR EACH ROW EXECUTE FUNCTION fixture_fail_insert()`);
            const before = await snapshot();
            await transaction(async client => {
                await assert.rejects(ensureLeadForBooking(client, {
                    businessContext: 'dar', customerId: 12, booking: bookingInput() }), /Disposable D04 child insert failure/);
                assert.deepEqual(await snapshot(client), before);
                await client.query("INSERT INTO products(id,business_context,name) VALUES ('caller-marker','dar','Caller survives')");
            });
            assert.deepEqual(await snapshot(), before);
            assert.equal((await pool.query("SELECT id FROM products WHERE id='caller-marker'")).rowCount, 1);
        });

        for (const [label, callback] of [
            ['transition', c => transitionLeadStage(c, { leadId: 102, businessContext: 'dar', targetStage: 'deposit_received', bookingId: 'dar-booking' })],
            ['attach', c => attachLeadBookingLink(c, { businessContext: 'dar', leadId: 102, bookingId: 'dar-booking', customerId: 12 })],
            ['ensure', c => ensureLeadForBooking(c, { businessContext: 'dar', customerId: 12, booking: bookingInput() })],
            ['upsert', c => upsertLeadCustomerLink(c, { businessContext: 'dar', leadId: 102, customerId: 12 })]
        ]) {
            await t.test(`caller rollback after successful ${label} removes all partial records and interactions`, async () => {
                await reset();
                const before = await snapshot();
                await transaction(callback, { rollback: true });
                assert.deepEqual(await snapshot(), before);
            });
        }

        await t.test('child insert failure rolls back the newly created lead and customer pointer', async () => {
            await reset();
            await pool.query(`CREATE TRIGGER fixture_child_failure BEFORE INSERT ON lead_customer_links
                FOR EACH ROW EXECUTE FUNCTION fixture_fail_insert()`);
            const before = await snapshot();
            await assert.rejects(transaction(c => ensureLeadForBooking(c, {
                businessContext: 'dar', customerId: 12, booking: bookingInput() })), /Disposable D04 child insert failure/);
            assert.deepEqual(await snapshot(), before);
        });

        await t.test('same-business replay and concurrent attachment create one link and one stage interaction', async () => {
            await reset();
            const invoke = () => transaction(c => attachLeadBookingLink(c, {
                businessContext: 'dar', leadId: 102, customerId: 12, bookingId: 'dar-booking' }));
            const results = await Promise.all([invoke(), invoke(), invoke()]);
            assert.ok(results.every(result => result.attached && result.customerLinked));
            assert.equal(results.filter(result => result.stageChanged).length, 1);
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM lead_customer_links')).rows[0].n, 1);
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM lead_interactions')).rows[0].n, 1);
        });

        await t.test('same-booking ensure replay and concurrency create one lead and one link', async () => {
            await reset();
            const invoke = () => transaction(c => ensureLeadForBooking(c, {
                businessContext: 'dar', customerId: 12, booking: bookingInput() }));
            const results = await Promise.all([invoke(), invoke(), invoke()]);
            assert.ok(results.every(result => result.attached && result.customerLinked));
            assert.equal(new Set(results.map(result => result.leadId)).size, 1);
            assert.equal((await pool.query("SELECT count(*)::int AS n FROM leads WHERE booking_id='dar-booking'")).rows[0].n, 1);
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM lead_customer_links')).rows[0].n, 1);
        });

        await t.test('custom business in another organization creates only its own related records', async () => {
            await reset();
            const result = await transaction(c => ensureLeadForBooking(c, {
                businessContext: 'fixture_custom', customerId: 13, booking: bookingInput('fixture_custom') }));
            assert.equal(result.attached, true);
            assert.equal(result.businessContext, 'fixture_custom');
            const lead = (await pool.query('SELECT * FROM leads WHERE id=$1', [result.leadId])).rows[0];
            assert.equal(lead.business_context, 'fixture_custom');
            assert.equal(lead.program_id, 'custom-product');
            assert.equal(lead.booking_id, 'custom-booking');
            assert.equal((await pool.query('SELECT business_context FROM lead_customer_links')).rows[0].business_context, 'fixture_custom');
        });

        await t.test('legacy NULL contexts remain compatible only with Park and do not widen into Dar', async () => {
            await reset();
            const attached = await transaction(c => attachLeadBookingLink(c, {
                businessContext: 'event_genix', leadId: 104, customerId: 14, bookingId: 'legacy-booking' }));
            assert.equal(attached.attached, true);
            assert.equal(attached.customerLinked, true);
            const ensured = await transaction(c => ensureLeadForBooking(c, {
                businessContext: 'event_genix', customerId: 14, booking: {
                    id: 'legacy-booking', programId: 'legacy-product', customer: { name: 'Legacy', phone: 'legacy-contact' }
                } }));
            assert.equal(ensured.leadId, 104);
            assert.equal((await pool.query('SELECT business_context FROM lead_customer_links')).rows[0].business_context, 'event_genix');
            assert.equal((await pool.query('SELECT count(*)::int AS n FROM lead_customer_links')).rows[0].n, 1);
        });

        // Production bookings/leads.program_id are VARCHAR(50), without a products FK.
        // The legacy Maysternya webhook maps name-only input to MD and code-only input
        // to its opaque code; preserving this is not permission to resolve a foreign product.
        for (const [label, programId, registryPresent] of [
            ['name-only mapping', 'MD', true],
            ['external code-only mapping', 'TARO', true],
            ['pre-registry compatibility', 'MD', false],
            ['existing owned product', 'md_full_consult_40', true]
        ]) {
            await t.test(`Maysternya ${label} stays compatible without inventing product rows`, async () => {
                await reset();
                if (!registryPresent) await pool.query("DELETE FROM businesses WHERE context_key='maysternya_doli'");
                await pool.query("UPDATE bookings SET program_id=$1 WHERE id='md-booking'", [programId]);
                const productsBefore = (await pool.query('SELECT * FROM products ORDER BY id')).rows;
                const result = await transaction(c => ensureLeadForBooking(c, {
                    businessContext: 'maysternya_doli', customerId: 15,
                    booking: { id: 'md-booking', programId, sourceChannel: 'maysternya_bot',
                        customer: { name: 'MD synthetic', phone: 'md-fixture-contact' } }
                }));
                assert.equal(result.attached, true);
                const lead = (await pool.query('SELECT * FROM leads WHERE id=$1', [result.leadId])).rows[0];
                assert.equal(lead.business_context, 'maysternya_doli');
                assert.equal(lead.program_id, programId);
                assert.equal(lead.booking_id, 'md-booking');
                await transaction(c => transitionLeadStage(c, {
                    leadId: result.leadId, businessContext: 'maysternya_doli', targetStage: 'contacted'
                }));
                assert.deepEqual((await pool.query('SELECT * FROM products ORDER BY id')).rows, productsBefore);
            });
        }

        for (const [label, programId, membershipMode] of [
            ['another business product', 'park-product', false],
            ['another organization product', 'custom-product', false],
            ['legacy NULL product owned by Park', 'legacy-product', false],
            ['missing external code after membership cutover', 'TARO', true]
        ]) {
            await t.test(`Maysternya rejects ${label} before writing any lead relation`, async () => {
                await reset();
                if (membershipMode) await pool.query("UPDATE businesses SET access_mode='membership' WHERE context_key='maysternya_doli'");
                await pool.query("UPDATE bookings SET program_id=$1 WHERE id='md-booking'", [programId]);
                await expectDenial(c => ensureLeadForBooking(c, {
                    businessContext: 'maysternya_doli', customerId: 15,
                    booking: { id: 'md-booking', programId, customer: { name: 'MD synthetic' } }
                }));
            });
        }

        for (const [businessContext, bookingId, customerId] of [
            ['event_genix', 'park-booking', 11], ['dar', 'dar-booking', 12], ['fixture_custom', 'custom-booking', 13]
        ]) {
            await t.test(`${businessContext} cannot borrow the Maysternya opaque-program exception`, async () => {
                await reset();
                await expectDenial(c => ensureLeadForBooking(c, {
                    businessContext, customerId, booking: { id: bookingId, programId: 'TARO', customer: { name: 'Fixture' } }
                }));
            });
        }

        await t.test('two owned leads sharing a customer return a recoverable 409 and complete after whole-transaction retry', async () => {
            await reset();
            await pool.query(`INSERT INTO leads(id,business_context,client_name) VALUES (106,'dar','Second Dar lead');
                INSERT INTO bookings(id,business_context,customer_id,program_id) VALUES ('dar-secondary','dar',12,'dar-product');
                UPDATE customers SET lead_id=102 WHERE id=12;`);
            const beforeLeads = (await pool.query('SELECT * FROM leads WHERE id IN (102,106) ORDER BY id')).rows;
            const a = await pool.connect();
            const b = await pool.connect();
            let notifyCustomerLocked, releaseCustomerPause;
            const customerLocked = new Promise(resolve => { notifyCustomerLocked = resolve; });
            const customerPause = new Promise(resolve => { releaseCustomerPause = resolve; });
            let runA, runB;
            async function complete(client, queryable, leadId, bookingId) {
                try {
                    const result = await attachLeadBookingLink(queryable, { leadId, bookingId, customerId: 12, businessContext: 'dar' });
                    await client.query('COMMIT');
                    return { leadId, committed: true, result };
                } catch (error) {
                    await client.query('ROLLBACK');
                    return { leadId, committed: false, error };
                }
            }
            try {
                for (const client of [a, b]) {
                    await client.query('BEGIN');
                    await client.query("SET LOCAL deadlock_timeout = '100ms'");
                    await client.query("SET LOCAL lock_timeout = '5s'");
                }
                const aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
                const bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
                const aClient = { query: async (sql, params) => {
                    const result = await a.query(sql, params);
                    if (/^SELECT \* FROM customers/.test(String(sql).replace(/\s+/g, ' ').trim())) {
                        notifyCustomerLocked();
                        await customerPause;
                    }
                    return result;
                } };
                runA = complete(a, aClient, 106, 'dar-secondary');
                await customerLocked;
                runB = complete(b, b, 102, 'dar-booking');
                const deadline = Date.now() + 3000;
                let blocked = false;
                while (Date.now() < deadline) {
                    blocked = (await pool.query('SELECT $1::int = ANY(pg_blocking_pids($2)) AS blocked', [aPid, bPid])).rows[0].blocked;
                    if (blocked) break;
                    await new Promise(resolve => setImmediate(resolve));
                }
                assert.equal(blocked, true, 'B owns the primary lead and waits for the shared customer held by A');
                releaseCustomerPause();
                const outcomes = await Promise.all([runA, runB]);
                const failures = outcomes.filter(outcome => !outcome.committed);
                assert.equal(failures.length, 1);
                const failure = failures[0];
                assert.equal(failure.error.code, 'lead_transaction_conflict');
                assert.equal(failure.error.statusCode, 409);
                assert.equal(failure.error.cause?.code, '40P01');
                assert.deepEqual((await pool.query('SELECT * FROM leads WHERE id=$1', [failure.leadId])).rows[0],
                    beforeLeads.find(lead => lead.id === failure.leadId));
                assert.equal((await pool.query('SELECT id FROM lead_customer_links WHERE lead_id=$1', [failure.leadId])).rowCount, 0);
                assert.equal((await pool.query('SELECT id FROM lead_interactions WHERE lead_id=$1', [failure.leadId])).rowCount, 0);
                const retryClient = failure.leadId === 106 ? a : b;
                await retryClient.query('BEGIN');
                const retry = await complete(retryClient, retryClient, failure.leadId,
                    failure.leadId === 106 ? 'dar-secondary' : 'dar-booking');
                assert.equal(retry.committed, true);
                assert.equal(retry.result.attached, true);
                assert.equal((await pool.query('SELECT count(*)::int AS n FROM lead_customer_links')).rows[0].n, 2);
                assert.equal((await pool.query('SELECT count(*)::int AS n FROM lead_interactions')).rows[0].n, 2);
                assert.equal((await pool.query(`SELECT count(*)::int AS n FROM lead_customer_links x
                    LEFT JOIN leads l ON l.id=x.lead_id LEFT JOIN customers c ON c.id=x.customer_id
                    WHERE l.id IS NULL OR c.id IS NULL OR l.business_context<>x.business_context OR c.business_context<>x.business_context`)).rows[0].n, 0);
            } finally {
                releaseCustomerPause();
                if (runA) await runA;
                if (runB) await runB;
                for (const client of [a, b]) { await client.query('ROLLBACK'); client.release(); }
            }
        });

        await t.test('concurrent ownership move cannot pass a stale booking check', async () => {
            await reset();
            const mover = await pool.connect();
            const worker = await pool.connect();
            let pending;
            try {
                await mover.query('BEGIN');
                await mover.query("UPDATE bookings SET business_context='event_genix' WHERE id='dar-booking'");
                const before = await snapshot();
                await worker.query('BEGIN');
                await worker.query("SET LOCAL lock_timeout = '5s'");
                const workerPid = (await worker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
                pending = attachLeadBookingLink(worker, {
                    businessContext: 'dar', leadId: 102, customerId: 12, bookingId: 'dar-booking' });
                const outcome = pending.then(value => ({ value }), error => ({ error }));
                const deadline = Date.now() + 3000;
                let waiting = false;
                while (Date.now() < deadline) {
                    waiting = (await pool.query("SELECT pid FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'", [workerPid])).rowCount === 1;
                    if (waiting) break;
                    const finished = await Promise.race([outcome.then(() => true), new Promise(resolve => setImmediate(() => resolve(false)))]);
                    if (finished) break;
                }
                await mover.query('COMMIT');
                const result = await outcome;
                await worker.query('ROLLBACK');
                assert.equal(waiting, true, 'Service checks must lock the related booking before mutating the lead');
                assert.ok(result.error, 'Service must recheck the locked booking after its owner changed');
                assert.equal(result.error.code, 'lead_reference_unavailable');
                const after = await snapshot();
                delete before.bookings;
                delete after.bookings;
                assert.deepEqual(after, before);
            } finally {
                await mover.query('ROLLBACK');
                if (pending) await pending.catch(() => {});
                await worker.query('ROLLBACK');
                worker.release();
                mover.release();
            }
        });
    } finally {
        if (pool) await pool.end();
        try {
            if (created) {
                await admin.query(`DROP DATABASE "${database}"`);
                assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
                assert.equal((await admin.query('SELECT pid FROM pg_stat_activity WHERE datname=$1', [database])).rowCount, 0);
            }
        } finally { await admin.end(); }
    }
});
