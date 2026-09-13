'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { Pool } = require('pg');
const express = require('express');
const jwt = require('jsonwebtoken');

const localSocket = process.env.BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST === '1';
const fixtureUrl = process.env.BUSINESS_MEMBERSHIP_TEST_DATABASE_URL;
function localConnection() {
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID']) assert.ok(!process.env[key]);
    if (localSocket) {
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

test('customer and lead domains enforce business membership and related-record ownership with actual HTTP/PostgreSQL', {
    skip: !localSocket && !fixtureUrl, timeout: 120000
}, async t => {
    const connection = localConnection();
    const database = 'eventgenix_membership_test_' + crypto.randomUUID().replaceAll('-', '');
    assert.match(database, /^eventgenix_membership_test_[a-f0-9]{32}$/);
    const admin = new Pool({ ...connection, max: 1, connectionTimeoutMillis: 5000 });
    const dbId = require.resolve('../../db');
    const previousDb = require.cache[dbId];
    let pool;
    let server;
    let auth;
    let created = false;
    try {
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        pool = new Pool({ ...connection, database, max: 6, connectionTimeoutMillis: 5000 });
        await pool.query(`
            CREATE TABLE users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'animator', extra_roles TEXT[] NOT NULL DEFAULT '{}',
                page_allowlist TEXT[] NOT NULL DEFAULT '{}', page_denylist TEXT[] NOT NULL DEFAULT '{}',
                action_allowlist TEXT[] NOT NULL DEFAULT '{}', action_denylist TEXT[] NOT NULL DEFAULT '{}',
                business_contexts TEXT[] NOT NULL DEFAULT '{event_genix}', default_business_context TEXT,
                telegram_chat_id TEXT, is_active BOOLEAN NOT NULL DEFAULT true, session_revoked_at TIMESTAMPTZ,
                last_seen_at TIMESTAMPTZ);
            CREATE TABLE employee_profiles (user_id INT REFERENCES users(id), staff_id INT, department TEXT,
                is_active BOOLEAN DEFAULT true, last_activity_at TIMESTAMPTZ);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE products (id TEXT PRIMARY KEY, business_context TEXT NOT NULL, label TEXT, name TEXT);
            CREATE TABLE customers (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL DEFAULT 'event_genix',
                name TEXT, phone TEXT, instagram TEXT, child_name TEXT, child_birthday DATE, source TEXT, notes TEXT,
                social_identities JSONB DEFAULT '[]', lead_id INT, total_bookings INT DEFAULT 0, total_spent INT DEFAULT 0,
                first_visit DATE, last_visit DATE, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE bookings (id TEXT PRIMARY KEY, business_context TEXT NOT NULL, customer_id INT REFERENCES customers(id),
                date DATE, time TEXT, status TEXT DEFAULT 'confirmed', price INT, program_name TEXT, program_code TEXT,
                label TEXT, room TEXT, linked_to TEXT, category TEXT, duration INT, banquet_guests INT, banquet_adults INT,
                banquet_tables INT, banquet_menu JSONB);
            CREATE TABLE leads (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL DEFAULT 'event_genix',
                client_name TEXT, phone TEXT, telegram_id TEXT, instagram TEXT, source TEXT, source_channel TEXT, raw_payload JSONB,
                program_id TEXT, booking_id TEXT REFERENCES bookings(id), event_date DATE, children_count INT, child_age INT,
                notes TEXT, assigned_to INT REFERENCES users(id), celebrants JSONB DEFAULT '[]', status TEXT DEFAULT 'new',
                pipeline_stage TEXT DEFAULT 'new', lead_type TEXT DEFAULT 'quality', quality_category TEXT, milestone_tags TEXT[],
                kanban_position NUMERIC, potential_value INT, lost_reason TEXT, external_id TEXT,
                created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), last_contact_at TIMESTAMP, booked_at TIMESTAMP);
            CREATE TABLE customer_cards (id SERIAL PRIMARY KEY, lead_id INT REFERENCES leads(id), business_context TEXT NOT NULL,
                budget_approx INT, updated_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE lead_event_preferences (id SERIAL PRIMARY KEY, lead_id INT REFERENCES leads(id), business_context TEXT,
                preferred_date DATE, children_count INT, adults_count INT, notes TEXT,
                created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE mailing_list (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL, name TEXT, phone TEXT, email TEXT,
                source_channel TEXT, contact_value TEXT, lead_id INT REFERENCES leads(id), notes TEXT, status TEXT DEFAULT 'active',
                created_at TIMESTAMP DEFAULT NOW());
            CREATE UNIQUE INDEX mailing_phone_fixture ON mailing_list(business_context, phone) WHERE phone IS NOT NULL;
            CREATE TABLE customer_children (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL, customer_id INT REFERENCES customers(id),
                lead_id INT REFERENCES leads(id), booking_id TEXT REFERENCES bookings(id), name TEXT, birthday DATE, age_snapshot INT,
                note TEXT, source_kind TEXT, source_payload JSONB DEFAULT '{}', sort_order INT DEFAULT 0,
                dietary_tags TEXT[] DEFAULT '{}', dietary_note TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE event_reviews (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL, customer_id INT REFERENCES customers(id),
                booking_id TEXT REFERENCES bookings(id), rating INT, comment TEXT, created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE customer_tags (id SERIAL PRIMARY KEY, customer_id INT REFERENCES customers(id), tag TEXT, color TEXT,
                created_by INT REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE communication_log (id SERIAL PRIMARY KEY, customer_id INT REFERENCES customers(id), type TEXT, summary TEXT,
                created_by INT REFERENCES users(id), created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE lead_interactions (id SERIAL PRIMARY KEY, lead_id INT REFERENCES leads(id), user_id INT REFERENCES users(id),
                type TEXT, summary TEXT, details JSONB, follow_up_date DATE, follow_up_done BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE certificates (id SERIAL PRIMARY KEY, customer_id INT REFERENCES customers(id), cert_code TEXT,
                display_value TEXT, type_text TEXT, status TEXT, valid_until DATE, issued_at TIMESTAMP);
            CREATE TABLE tasks (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL, title TEXT, description TEXT,
                source_type TEXT, source_id TEXT, status TEXT DEFAULT 'todo', priority TEXT DEFAULT 'normal', deadline TIMESTAMP,
                owner_user_id INT REFERENCES users(id), owner TEXT, assigned_to TEXT, created_by TEXT, deleted_at TIMESTAMP,
                visibility TEXT DEFAULT 'team', created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE task_observers (task_id INT REFERENCES tasks(id), user_id INT REFERENCES users(id));
            CREATE TABLE conversations (id SERIAL PRIMARY KEY, business_context TEXT NOT NULL, channel TEXT, customer_id INT REFERENCES customers(id),
                customer_name TEXT, customer_phone TEXT, status TEXT DEFAULT 'open', assigned_to INT, unread_count INT DEFAULT 0,
                last_message_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), last_inbound_at TIMESTAMP,
                last_outbound_at TIMESTAMP, reply_expected BOOLEAN DEFAULT false, awaiting_reply_since TIMESTAMP,
                reply_expected_message_id INT, reply_owner TEXT, reply_owner_user_id INT, reply_sla_at TIMESTAMP);
            CREATE TABLE conversation_messages (id SERIAL PRIMARY KEY, conversation_id INT REFERENCES conversations(id),
                content TEXT, delivery_status TEXT, created_at TIMESTAMP DEFAULT NOW());
        `);
        for (const migration of ['357_organizations_business_memberships.sql', '262_leads_customer_links_and_value.sql']) {
            await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations', migration), 'utf8'));
        }
        await pool.query(`
            INSERT INTO organizations(id,slug,name) VALUES (1,'fixture-own','Fixture Own'),(2,'fixture-foreign','Fixture Foreign');
            INSERT INTO businesses(id,organization_id,context_key,label,short_label,access_mode,modules) VALUES
                (1,1,'event_genix','Fixture Park','Park','membership','["customers","leads"]'),(2,1,'dar','Fixture Dar','Dar','membership','["customers","leads"]'),
                (3,2,'fixture_other','Fixture Other','Other','membership','["customers","leads"]');
            INSERT INTO users(id,username,name,role) VALUES (1,'actor','Actor','animator'),(2,'dar_candidate','Dar candidate','animator'),
                (3,'foreign_candidate','Foreign candidate','manager'),(4,'revoked_candidate','Revoked candidate','manager'),
                (5,'park_candidate','Park candidate','manager'),(6,'dar_accountant','Dar accountant','animator');
            INSERT INTO organization_memberships(organization_id,user_id,role) VALUES
                (1,1,'member'),(1,2,'member'),(2,3,'member'),(1,4,'member'),(1,5,'member'),(1,6,'member');
            INSERT INTO business_memberships(business_id,organization_id,user_id,role,is_default,is_active) VALUES
                (1,1,1,'manager',false,true),(2,1,1,'manager',true,true),(2,1,2,'manager',true,true),
                (3,2,3,'manager',true,true),(2,1,4,'manager',true,false),(1,1,5,'manager',true,true),
                (2,1,6,'accountant',true,true);
            INSERT INTO products(id,business_context,label,name) VALUES
                ('dar-product','dar','Dar product','Dar full product'),('park-product','event_genix','Foreign product','Foreign full product');
            INSERT INTO customers(id,business_context,name,phone) VALUES
                (10,'dar','Fixture shared customer','+380000000111'),(11,'event_genix','Foreign customer','+380000000111');
            INSERT INTO bookings(id,business_context,date) VALUES ('dar-booking','dar','2099-01-01'),('park-booking','event_genix','2099-01-01');
            INSERT INTO leads(id,business_context,client_name,phone,program_id,created_at) VALUES
                (101,'dar','Fixture shared customer','+380000000111','dar-product',NOW()-INTERVAL '2 days'),
                (102,'event_genix','Foreign lead','+380000000111','park-product',NOW()-INTERVAL '2 days');
            SELECT setval('leads_id_seq', 200);
            INSERT INTO customer_children(id,business_context,customer_id,name,source_kind) VALUES
                (301,'dar',10,'Dar child','manual'),(302,'event_genix',10,'Foreign poisoned child','manual');
            INSERT INTO event_reviews(id,business_context,customer_id,rating,comment) VALUES
                (401,'dar',10,5,'Dar review'),(402,'event_genix',10,1,'Foreign poisoned review');
            INSERT INTO conversations(id,business_context,channel,customer_id,customer_name,customer_phone,reply_expected_message_id) VALUES
                (201,'dar','telegram',10,'Fixture shared customer','+380000000111',1002),
                (202,'event_genix','telegram',10,'Fixture shared customer','+380000000111',NULL),
                (203,'dar','telegram',NULL,'Fixture shared customer','+380000000111',NULL),
                (204,'event_genix','telegram',NULL,'Fixture shared customer','+380000000111',NULL),
                (205,'fixture_other','telegram',NULL,'Fixture shared customer','+380000000111',NULL);
            INSERT INTO conversation_messages(id,conversation_id,content,delivery_status) VALUES
                (1001,201,'Dar message','delivered'),(1002,202,'Foreign secret message','failed'),
                (1003,203,'Dar suggested message','delivered'),(1004,204,'Foreign suggested secret','delivered'),
                (1005,205,'Other organization secret','delivered');
        `);
        require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool } };
        auth = require('../../middleware/auth');
        let verifiedActor;
        const app = express();
        app.use(express.json());
        app.use(auth.authenticateToken, (req, res, next) => { verifiedActor = req.user; next(); });
        app.use('/api/leads', require('../../routes/leads'));
        app.use('/api/customers', require('../../routes/customers'));
        server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        const token = jwt.sign({ id: 1, username: 'actor', role: 'animator' }, auth.JWT_SECRET, { expiresIn: '1h' });
        async function request(method, route, body, context = 'dar') {
            const response = await fetch(base + route, { method,
                headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
                    'X-Business-Context': context, Connection: 'close' },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
            return { status: response.status, body: await response.json() };
        }

        await t.test('assignees and writes use current Dar memberships, not global roles or stale context mirrors', async () => {
            const directory = await request('GET', '/api/leads/assignees');
            assert.equal(directory.status, 200, JSON.stringify(directory.body));
            assert.deepEqual(directory.body.users.map(user => user.id).sort(), [1, 2]);
            assert.equal(directory.body.users.find(user => user.id === 2).role, 'manager');
            for (const id of [3, 4, 5]) {
                const denied = await request('PATCH', '/api/leads/101', { assigned_to: id });
                assert.equal(denied.status, 400, JSON.stringify(denied.body));
            }
            assert.equal((await pool.query('SELECT assigned_to FROM leads WHERE id=101')).rows[0].assigned_to, null);
            assert.equal((await request('PATCH', '/api/leads/101', { assigned_to: 2 })).status, 200);
            await pool.query('UPDATE business_memberships SET is_active=false WHERE business_id=2 AND user_id=2');
            assert.equal((await request('PATCH', '/api/leads/101', { assigned_to: 2 })).status, 400);
            await pool.query('UPDATE business_memberships SET is_active=true WHERE business_id=2 AND user_id=2');
            const source = fs.readFileSync(path.join(__dirname, '../../routes/leads.js'), 'utf8');
            const start = source.indexOf('async function findAccountantTaskOwner(');
            const end = source.indexOf('function buildDepositAccountantTaskPayload', start);
            assert.ok(start >= 0 && end > start);
            const context = { pool, businessUserAccessSql: require('../../services/businessUserAccess').businessUserAccessSql };
            vm.createContext(context);
            vm.runInContext(source.slice(start, end), context);
            assert.equal((await context.findAccountantTaskOwner('dar', verifiedActor)).id, 6,
                'An active Dar accountant must not disappear because the legacy mirror says Park');
        });

        await t.test('foreign product, booking and mailing references fail before any local record is changed', async () => {
            const count = Number((await pool.query('SELECT COUNT(*) FROM leads')).rows[0].count);
            const create = await request('POST', '/api/leads', { client_name: 'Rejected fixture', program_id: 'park-product' });
            assert.equal(create.status, 404, JSON.stringify(create.body));
            assert.equal(Number((await pool.query('SELECT COUNT(*) FROM leads')).rows[0].count), count);
            for (const body of [{ program_id: 'park-product', notes: 'must-not-write' }, { booking_id: 'park-booking', notes: 'must-not-write' }]) {
                const denied = await request('PATCH', '/api/leads/101', body);
                assert.equal(denied.status, 404, JSON.stringify(denied.body));
            }
            const lead = (await pool.query('SELECT program_id, booking_id, notes FROM leads WHERE id=101')).rows[0];
            assert.deepEqual(lead, { program_id: 'dar-product', booking_id: null, notes: null });
            assert.equal((await request('POST', '/api/leads/mailing', { name: 'Rejected mailing', lead_id: 102 })).status, 404);
            assert.equal(Number((await pool.query('SELECT COUNT(*) FROM mailing_list')).rows[0].count), 0);
            assert.equal((await request('PATCH', '/api/leads/101', { booking_id: 'dar-booking', program_id: 'dar-product' })).status, 200);
            assert.equal((await request('POST', '/api/leads/mailing', { name: 'Allowed mailing', lead_id: 101 })).status, 200);
            assert.equal((await request('PATCH', '/api/leads/101', { booking_id: null, program_id: null })).status, 200);
            await pool.query("UPDATE leads SET program_id='dar-product' WHERE id=101");
        });

        await t.test('D04 HTTP stage transitions reject stored foreign references through the real service', async () => {
            await pool.query(`
                INSERT INTO products(id,business_context,label,name) VALUES ('other-product','fixture_other','Other product','Other product');
                INSERT INTO bookings(id,business_context,date) VALUES ('other-booking','fixture_other','2099-01-01');
            `);
            try {
                for (const [column, foreignId] of [
                    ['program_id', 'park-product'], ['booking_id', 'park-booking'],
                    ['program_id', 'other-product'], ['booking_id', 'other-booking']
                ]) {
                    await pool.query(`UPDATE leads SET ${column}=$1 WHERE id=101`, [foreignId]);
                    const before = (await pool.query('SELECT * FROM leads WHERE id=101')).rows[0];
                    const interactions = (await pool.query('SELECT COUNT(*)::int AS count FROM lead_interactions')).rows[0].count;
                    const response = await request('PATCH', '/api/leads/101/stage', {
                        pipeline_stage: 'contacted', updated_at: before.updated_at.toISOString()
                    });
                    assert.equal(response.status, 404, `${column}: ${JSON.stringify(response.body)}`);
                    assert.deepEqual((await pool.query('SELECT * FROM leads WHERE id=101')).rows[0], before);
                    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM lead_interactions')).rows[0].count, interactions);
                    await pool.query("UPDATE leads SET program_id='dar-product', booking_id=NULL WHERE id=101");
                }
            } finally {
                await pool.query("UPDATE leads SET program_id='dar-product', booking_id=NULL WHERE id=101");
                await pool.query("DELETE FROM products WHERE id='other-product'; DELETE FROM bookings WHERE id='other-booking'");
            }
        });

        await t.test('D04 background customer-link writer checks both parent owners atomically and replays safely', async () => {
            const source = fs.readFileSync(path.join(__dirname, '../../routes/leads.js'), 'utf8');
            const start = source.indexOf('async function linkLeadCustomer(');
            const end = source.indexOf('function customerMatchesBusinessContext(', start);
            assert.ok(start >= 0 && end > start);
            const context = { DEFAULT_BUSINESS_CONTEXT: 'event_genix',
                normalizeBusinessContext: require('../../services/businessContext').normalizeBusinessContext };
            vm.createContext(context);
            vm.runInContext(source.slice(start, end), context);
            const baseline = (await pool.query('SELECT COUNT(*)::int AS count FROM lead_customer_links')).rows[0].count;
            for (const [leadId, customerId] of [[101, 11], [102, 10], [101, 999999]]) {
                assert.equal(await context.linkLeadCustomer(pool, { businessContext: 'dar', leadId, customerId }), null);
                assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM lead_customer_links')).rows[0].count, baseline);
            }
            const first = await context.linkLeadCustomer(pool, { businessContext: 'dar', leadId: 101, customerId: 10 });
            const replay = await context.linkLeadCustomer(pool, { businessContext: 'dar', leadId: 101, customerId: 10 });
            assert.equal(replay.id, first.id);
            assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM lead_customer_links')).rows[0].count, baseline + 1);
            await pool.query('DELETE FROM lead_customer_links WHERE id=$1', [first.id]);
        });

        await t.test('D04 HTTP parent UPDATE=0 rolls back partial lead fields and audit instead of returning success', async () => {
            await pool.query(`
                CREATE FUNCTION d04_skip_stage_update() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.id=101 AND NEW.pipeline_stage='contacted' THEN RETURN NULL; END IF;
                    RETURN NEW;
                END $$;
                CREATE TRIGGER d04_skip_stage BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION d04_skip_stage_update();
            `);
            try {
                const before = (await pool.query('SELECT * FROM leads WHERE id=101')).rows[0];
                const interactions = (await pool.query('SELECT COUNT(*)::int AS count FROM lead_interactions')).rows[0].count;
                for (const [route, body] of [
                    ['/api/leads/101/stage', { pipeline_stage: 'contacted', updated_at: before.updated_at.toISOString() }],
                    ['/api/leads/101', { pipeline_stage: 'contacted', notes: 'D04 must roll back' }]
                ]) {
                    const response = await request('PATCH', route, body);
                    assert.ok([404, 409].includes(response.status), JSON.stringify(response.body));
                    assert.deepEqual((await pool.query('SELECT * FROM leads WHERE id=101')).rows[0], before);
                    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM lead_interactions')).rows[0].count, interactions);
                }
            } finally {
                await pool.query('DROP TRIGGER d04_skip_stage ON leads; DROP FUNCTION d04_skip_stage_update()');
            }
        });

        await t.test('D04 HTTP reference writes keep ownership locks through the parent transaction', async () => {
            await pool.query(`
                CREATE FUNCTION d04_hold_parent_update() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.id=101 AND NEW.notes='D04 ownership lock barrier' THEN
                        PERFORM pg_advisory_xact_lock(20404,101);
                    END IF;
                    RETURN NEW;
                END $$;
                CREATE TRIGGER d04_hold_parent BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION d04_hold_parent_update();
            `);
            const barrier = await pool.connect();
            const contender = await pool.connect();
            try {
                for (const [column, table, id] of [
                    ['booking_id', 'bookings', 'dar-booking'], ['program_id', 'products', 'dar-product']
                ]) {
                    await barrier.query('SELECT pg_advisory_lock(20404,101)');
                    let pending;
                    try {
                        pending = request('PATCH', '/api/leads/101', {
                            [column]: id, notes: 'D04 ownership lock barrier'
                        });
                        let blocked = false;
                        for (let attempt = 0; attempt < 100; attempt += 1) {
                            const waiting = await pool.query(`SELECT 1 FROM pg_locks
                                WHERE locktype='advisory' AND classid=20404 AND objid=101 AND NOT granted`);
                            if (waiting.rowCount) { blocked = true; break; }
                            await new Promise(resolve => setTimeout(resolve, 20));
                        }
                        assert.equal(blocked, true, 'HTTP parent update must reach the deterministic transaction barrier');
                        await contender.query('BEGIN');
                        // A business_context UPDATE takes this row-lock class. NOWAIT
                        // proves exclusion without spending the HTTP statement budget
                        // waiting for a deliberately blocked fixture transaction.
                        await assert.rejects(
                            contender.query(`SELECT id FROM ${table} WHERE id=$1 FOR NO KEY UPDATE NOWAIT`, [id]),
                            error => error.code === '55P03',
                            'The checked related row must remain protected from a concurrent ownership change'
                        );
                    } finally {
                        await contender.query('ROLLBACK');
                        await barrier.query('SELECT pg_advisory_unlock(20404,101)');
                    }
                    const response = await pending;
                    assert.equal(response.status, 200, JSON.stringify(response.body));
                    assert.equal((await pool.query(`SELECT business_context FROM ${table} WHERE id=$1`, [id])).rows[0].business_context, 'dar');
                    await pool.query("UPDATE leads SET notes=NULL, booking_id=NULL, program_id='dar-product' WHERE id=101");
                }
            } finally {
                await contender.query('ROLLBACK');
                await barrier.query('SELECT pg_advisory_unlock_all()');
                contender.release();
                barrier.release();
                await pool.query('DROP TRIGGER d04_hold_parent ON leads; DROP FUNCTION d04_hold_parent_update()');
                await pool.query("UPDATE leads SET notes=NULL, booking_id=NULL, program_id='dar-product' WHERE id=101");
            }
        });

        await t.test('existing poisoned product references do not expose labels through list, hot or workspace', async () => {
            await pool.query("UPDATE leads SET program_id='park-product' WHERE id=101");
            for (const route of ['/api/leads', '/api/leads/hot', '/api/leads/101/workspace']) {
                const response = await request('GET', route);
                assert.equal(response.status, 200, JSON.stringify(response.body));
                assert.equal(JSON.stringify(response.body).includes('Foreign full product'), false);
                assert.equal(JSON.stringify(response.body).includes('Foreign product'), false);
            }
            await pool.query("UPDATE leads SET program_id='dar-product' WHERE id=101");
        });

        await t.test('customer communication and lead workspace isolate exact and suggested conversations and message identity', async () => {
            const customer = await request('GET', '/api/customers/10/communication-context');
            assert.equal(customer.status, 200, JSON.stringify(customer.body));
            assert.deepEqual(customer.body.context.live.exactConversations.map(row => row.id), [201]);
            assert.deepEqual(customer.body.context.live.suggestedConversations.map(row => row.id), [203]);
            assert.equal(customer.body.context.live.exactConversations[0].replyDeliveryStatus, null);
            const lead = await request('GET', '/api/leads/101/workspace');
            assert.equal(lead.status, 200, JSON.stringify(lead.body));
            assert.deepEqual(lead.body.workspace.conversations.map(row => row.id).sort(), [201, 203]);
            assert.equal(lead.body.workspace.conversations.find(row => row.id === 201).replyDeliveryStatus, null);
            assert.equal(JSON.stringify([customer.body, lead.body]).includes('Foreign secret'), false);
            assert.equal(JSON.stringify([customer.body, lead.body]).includes('Other organization secret'), false);
        });

        await t.test('customer child list and reviews reject poisoned records from another business', async () => {
            const list = await request('GET', '/api/customers');
            assert.equal(list.status, 200, JSON.stringify(list.body));
            assert.equal(list.body.customers.length, 1);
            assert.equal(JSON.stringify(list.body).includes('Dar child'), true);
            assert.equal(JSON.stringify(list.body).includes('Foreign poisoned child'), false);
            const detail = await request('GET', '/api/customers/10');
            assert.equal(detail.status, 200, JSON.stringify(detail.body));
            assert.deepEqual(detail.body.reviews.map(review => review.comment), ['Dar review']);
            assert.equal((await request('GET', '/api/customers/11')).status, 404);
            assert.equal((await request('GET', '/api/leads/102/workspace')).status, 404);
        });

        await t.test('aggregate reads stay in one organization and aggregate writes cannot mutate records', async () => {
            const aggregate = await request('GET', '/api/leads?businessScope=all');
            assert.equal(aggregate.status, 200, JSON.stringify(aggregate.body));
            assert.deepEqual(aggregate.body.leads.map(lead => lead.business_context).sort(), ['dar', 'event_genix']);
            const denied = await request('PATCH', '/api/leads/101?businessScope=all', { notes: 'aggregate forbidden' });
            assert.equal(denied.status, 403, JSON.stringify(denied.body));
            assert.equal((await pool.query('SELECT notes FROM leads WHERE id=101')).rows[0].notes, null);
            assert.equal((await request('GET', '/api/leads', undefined, 'fixture_other')).status, 403);
        });
    } finally {
        if (server) { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
        if (auth?.authenticateToken._activityCleanup) clearInterval(auth.authenticateToken._activityCleanup);
        if (previousDb) require.cache[dbId] = previousDb;
        else delete require.cache[dbId];
        if (pool) await pool.end();
        try {
            if (created) {
                await admin.query(`DROP DATABASE "${database}"`);
                assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
            }
        } finally { await admin.end(); }
    }
});
