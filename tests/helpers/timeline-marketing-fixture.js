'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

// This fixture exercises real routes, permission/context guards and SQL, with a test-only
// authenticated principal. It does not replace production authentication in application code.
async function createFixture({ announcements = false, crmChat = false, now } = {}) {
    const url = new URL(process.env.TIMELINE_MARKETING_TEST_DATABASE_URL);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
    assert.notEqual(process.env.NODE_ENV, 'production');
    assert.ok(!process.env.RAILWAY_PROJECT_ID);
    assert.match(url.pathname, /test|postgres/);
    assert.notEqual(process.env.TIMELINE_MARKETING_TEST_DATABASE_URL, process.env.DATABASE_URL);
    const connection = { host: url.hostname, port: Number(url.port), user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password), database: url.pathname.slice(1), ssl: false };
    const name = `timeline_marketing_test_${crypto.randomBytes(8).toString('hex')}`;
    assert.match(name, /^timeline_marketing_test_[a-f0-9]{16}$/);
    const admin = new Pool(connection);
    await admin.query(`CREATE DATABASE "${name}"`);
    const pool = new Pool({ ...connection, database: name });
    const dbPath = require.resolve('../../db');
    const originalDb = require.cache[dbPath];
    let server;
    let auth;
    let originalAuthenticate;
    let resolveParticipant;
    const migrate = name => pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations', name), 'utf8'));
    async function close() {
        if (server) await new Promise(resolve => server.close(resolve));
        if (auth) auth.authenticateToken = originalAuthenticate;
        if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath];
        await pool.end();
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        await admin.end();
    }
    try {
        await pool.query(`CREATE TABLE history (id SERIAL PRIMARY KEY, business_context TEXT, action TEXT, username TEXT, data JSONB);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE afisha (id SERIAL PRIMARY KEY, date VARCHAR(10), time VARCHAR(10), title TEXT, duration INT,
                type VARCHAR(20), description TEXT, template_id INT, original_time VARCHAR(10), line_id VARCHAR(100));
            CREATE TABLE lines_by_date (id SERIAL PRIMARY KEY, date VARCHAR(10), line_id VARCHAR(100), name TEXT, business_context TEXT);
            CREATE TABLE bookings (id SERIAL PRIMARY KEY, date VARCHAR(10), time VARCHAR(10), duration INT,
                line_id VARCHAR(100), status TEXT, business_context TEXT, label TEXT, program_name TEXT, program_code TEXT);
            INSERT INTO lines_by_date (date,line_id,name,business_context) VALUES
                ('2026-10-19','1','Аніматор 1','event_genix'), ('2026-10-19','2','Аніматор 2','event_genix'),
                ('2026-10-20','1','Аніматор 1','event_genix'), ('2026-10-20','2','Аніматор 2','event_genix'),
                ('2026-10-21','1','Аніматор 1','event_genix'), ('2026-10-21','2','Аніматор 2','event_genix');
            CREATE TABLE afisha_templates (id SERIAL PRIMARY KEY, is_active BOOLEAN, date_from TEXT, date_to TEXT,
                recurrence_pattern TEXT, recurrence_days TEXT, title TEXT, time TEXT, duration INT, type TEXT, description TEXT);
            INSERT INTO afisha (date,time,title,duration,type,description,original_time,line_id) VALUES
                ('2026-10-19','14:00','Космічна вечірка',60,'event','Відкрита подія','14:00',1),
                ('2026-10-19','14:05','Казка',45,'regular','Регулярна подія','14:05',NULL),
                ('2026-10-19','14:10','Майстер-клас',30,'event','Друга подія','14:10',NULL);`);
        const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/383_timeline_promotions.sql'), 'utf8');
        await pool.query(migration);
        await pool.query(migration);
        const afishaMigration = fs.readFileSync(path.join(__dirname, '../../db/migrations/384_afisha_promotion_and_second_line.sql'), 'utf8');
        await pool.query(afishaMigration);
        await pool.query(afishaMigration);
        if (announcements) {
            const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/432_afisha_announcements.sql'), 'utf8');
            await pool.query(sql);
            await pool.query(sql);
            await migrate('433_afisha_publication_layouts.sql');
            await migrate('433_afisha_publication_layouts.sql');
            await pool.query('CREATE TABLE telegram_known_chats (chat_id bigint PRIMARY KEY, title text, type text)');
            await pool.query('CREATE TABLE telegram_known_threads (chat_id bigint, thread_id bigint, title text, PRIMARY KEY(chat_id, thread_id))');
        }
        const birthdayMigration = fs.readFileSync(path.join(__dirname, '../../db/migrations/385_afisha_birthday_slots.sql'), 'utf8');
        await pool.query(birthdayMigration);
        await pool.query(birthdayMigration);
        await pool.query(`CREATE TABLE staff_substitutions (id BIGSERIAL PRIMARY KEY, business_context TEXT,
            source_type TEXT, source_id TEXT, slot_key TEXT, state TEXT, work_date DATE, input_json JSONB, source_snapshot JSONB)`);
        const occurrenceMigration = fs.readFileSync(path.join(__dirname, '../../db/migrations/409_afisha_occurrence_substitutions.sql'), 'utf8');
        await pool.query(occurrenceMigration);
        if (crmChat) {
            await pool.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, username TEXT, name TEXT, role TEXT, is_active BOOLEAN DEFAULT TRUE);
                CREATE TABLE staff (id SERIAL PRIMARY KEY, is_active BOOLEAN DEFAULT TRUE);
                CREATE TABLE employee_profiles (user_id INT, staff_id INT, is_active BOOLEAN DEFAULT TRUE);
                CREATE TABLE timeline_resources (resource_id TEXT, business_context TEXT, type TEXT, is_active BOOLEAN, metadata JSONB);
                INSERT INTO users (username, name, role) VALUES ('publisher', 'Видавець', 'creator'),
                    ('member', 'Учасник', 'creator'), ('outsider', 'Сторонній', 'creator');`);
            for (const name of ['030_messenger.sql', '032_chat_dm_and_members.sql', '033_messenger_v2.sql',
                '101_booking_chat.sql', '338_chat_upload_blobs.sql', '357_organizations_business_memberships.sql']) await migrate(name);
            await pool.query(`ALTER TABLE chat_messages ADD COLUMN is_scheduled BOOLEAN, ADD COLUMN expires_at TIMESTAMPTZ;
                ALTER TABLE bookings ALTER COLUMN id DROP DEFAULT, ALTER COLUMN id TYPE TEXT,
                    ADD COLUMN room_resource_id TEXT, ADD COLUMN created_by TEXT;
                INSERT INTO organizations (slug, name) VALUES ('park', 'Парк');
                INSERT INTO businesses (organization_id, context_key, label, short_label, access_mode, modules)
                    VALUES (1, 'event_genix', 'Парк', 'Парк', 'membership', '["chat", "timeline"]');
                INSERT INTO organization_memberships (organization_id, user_id) SELECT 1, id FROM users;
                INSERT INTO business_memberships (business_id, organization_id, user_id, role, is_default)
                    SELECT 1, 1, id, 'creator', TRUE FROM users;`);
            resolveParticipant = async id => {
                const { loadParkWorkParticipants } = require('../../services/parkWorkModuleAccess');
                return (await loadParkWorkParticipants(pool, 'chat', [id])).get(id);
            };
        }
        require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } };
        auth = require('../../middleware/auth');
        originalAuthenticate = auth.authenticateToken;
        auth.authenticateToken = async (req, res, next) => {
            if (!req.headers.authorization) return res.status(401).json({ error: 'Unauthenticated fixture request' });
            const role = req.headers['x-fixture-role'] || 'creator';
            req.user = resolveParticipant ? await resolveParticipant(Number(req.headers['x-fixture-user'] || 1)) : { id: 1, username: 'timeline-fixture', role, roles: [role],
                businessContexts: role === 'park_only' ? ['event_genix'] : ['event_genix', 'dar'],
                business_contexts: role === 'park_only' ? ['event_genix'] : ['event_genix', 'dar'],
                defaultBusinessContext: 'event_genix', actionDenylist: role === 'denied' ? ['edit_booking', 'manage_settings'] : [] };
            if (!req.user) return res.status(403).json({ error: 'Fixture user has no Park chat access' });
            next();
        };
        const app = express();
        app.use(express.json());
        if (now) {
            const announcementRouter = express.Router();
            announcementRouter.use(auth.authenticateToken, require('../../routes/afisha-announcements').createAnnouncementRouter(pool, { now }));
            app.use('/api/afisha/announcements', announcementRouter);
        }
        app.use('/api/afisha', require('../../routes/afisha'));
        app.use('/api/timeline', require('../../routes/timeline-resources'));
        if (crmChat) {
            const { requireParkWorkModule } = require('../../services/parkWorkModuleAccess');
            const { requireParkChatUpload } = require('../../services/parkChatAccess');
            const { buildChatUploadBlobFallbackHandler } = require('../../services/chatUploadStorage');
            app.use('/uploads/chat', auth.authenticateToken, requireParkWorkModule('chat'), requireParkChatUpload(pool));
            app.get('/uploads/chat/*', buildChatUploadBlobFallbackHandler(pool));
            app.use('/api/chat', require('../../routes/chat'));
        }
        app.use(express.static(path.join(__dirname, '../..')));
        server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        async function request(method, route, body, headers = {}) {
            const multipart = body instanceof FormData;
            const response = await fetch(base + route, { method,
                headers: { Authorization: 'Bearer fixture', ...(multipart ? {} : { 'Content-Type': 'application/json' }), ...headers },
                ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) });
            const contentType = response.headers.get('content-type');
            const result = contentType?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
            return { status: response.status, body: result, contentType };
        }
        return { pool, base, request, close };
    } catch (error) { await close(); throw error; }
}
module.exports = { createFixture };
