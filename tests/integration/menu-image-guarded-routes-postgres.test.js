'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');

test('guarded menu routes submit once, poll KIE and preserve reviewable draft', {
    skip: process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER !== 'true', timeout: 30000
}, async () => {
    const target = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env);
    assert.equal(target.isLocal, true);
    const schema = `menu_route_test_${randomBytes(8).toString('hex')}`;
    const common = { connectionString: target.url.toString(), ssl: false };
    const admin = new Pool(common);
    const db = require('../../db');
    const originalQuery = db.pool.query, originalConnect = db.pool.connect, originalFetch = global.fetch;
    const originalKey = process.env.KIE_API_KEY, originalFlag = process.env.CRM_MENU_PAID_GUARD_ENABLED;
    const imageStorage = require('../../services/imageStorage');
    const originalUpload = imageStorage.uploadFromUrl;
    let imageProvider, originalOpenAI;
    let pool, created = false;
    try {
        await admin.query(`CREATE SCHEMA ${schema}`); created = true;
        pool = new Pool({ ...common, options: `-c search_path=${schema}`, max: 10 });
        await pool.query(fs.readFileSync(path.join(__dirname, '../../db/migrations/387_menu_image_paid_operations.sql'), 'utf8'));
        await pool.query('CREATE TABLE products (id text PRIMARY KEY, business_context text, ai_card_draft jsonb, updated_at timestamptz, updated_by text)');
        await pool.query("INSERT INTO products VALUES ('fixture','event_genix','{}',now(),'fixture')");
        const base = { id: 'fixture', business_context: 'event_genix', domain: 'kitchen', kitchen_type: 'menu',
            name: 'Synthetic pasta', icon_url: '/current.png', is_active: true };
        db.pool.connect = (...args) => pool.connect(...args);
        db.pool.query = async (sql, params) => {
            if (sql.includes('WHERE p.id = $1')) {
                const row = await pool.query('SELECT ai_card_draft FROM products WHERE id=$1', [params[0]]);
                return { rows: row.rowCount ? [{ ...base, ...row.rows[0] }] : [], rowCount: row.rowCount };
            }
            return pool.query(sql, params);
        };
        let replaceOperationDuringUpload = false;
        imageStorage.uploadFromUrl = async () => {
            if (replaceOperationDuringUpload) await pool.query(
                `UPDATE products SET ai_card_draft=jsonb_set(ai_card_draft,'{imageStudio,operationId}',to_jsonb($1::text)) WHERE id='fixture'`,
                ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
            return '/generated.png';
        };
        imageProvider = require('../../services/menuPhotoGeneration');
        originalOpenAI = imageProvider.generateAndStoreMenuPhotoDraft;
        let openaiCalls = 0, failOpenAI = false, holdLegacy = null;
        imageProvider.generateAndStoreMenuPhotoDraft = async () => {
            openaiCalls++;
            if (holdLegacy) return holdLegacy();
            if (failOpenAI) throw new Error('synthetic timeout');
            return { status: 'ready', imageUrl: '/openai-generated.png', provider: 'openai' };
        };
        process.env.KIE_API_KEY = 'synthetic-test-key';
        process.env.CRM_MENU_PAID_GUARD_ENABLED = 'true';
        let starts = 0, polls = 0;
        global.fetch = async (_url, options) => {
            if (options.method === 'POST') { starts++; return new Response(JSON.stringify({ code: 200, data: { taskId: 'fixture-task' } })); }
            polls++; return new Response(JSON.stringify({ code: 200, data: { state: 'success',
                resultJson: JSON.stringify({ resultUrls: ['https://tempfileb.aiquickdraw.com/fixture.png'] }) } }));
        };
        const router = require('../../routes/products');
        const invoke = async (route, method, body = {}) => {
            const handler = router.stack.find(x => x.route?.path === route && x.route.methods[method]).route.stack.at(-1).handle;
            const response = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; }, setHeader() {} };
            await handler({ method: method.toUpperCase(), params: { id: 'fixture' }, query: { businessContext: 'event_genix' },
                body, headers: {}, user: { username: 'fixture', role: 'admin' } }, response);
            return response;
        };
        let releaseLegacy, signalLegacy;
        const legacyStarted = new Promise(resolve => { signalLegacy = resolve; });
        holdLegacy = () => { signalLegacy(); return new Promise(resolve => { releaseLegacy = resolve; }); };
        process.env.CRM_MENU_PAID_GUARD_ENABLED = 'false';
        const legacyRequest = invoke('/:id/menu-image/draft', 'post', { generator: 'openai' });
        await legacyStarted;
        process.env.CRM_MENU_PAID_GUARD_ENABLED = 'true';
        const transition = await invoke('/:id/menu-image/draft', 'post', { generator: 'kie/nano-banana-2' });
        assert.equal(transition.body.code, 'MENU_PAID_GUARD_TRANSITION');
        assert.equal(starts, 0);
        releaseLegacy({ status: 'ready', imageUrl: '/legacy-fixture.png', provider: 'openai' });
        assert.equal((await legacyRequest).statusCode, 200);
        holdLegacy = null;
        openaiCalls = 0;
        const first = await invoke('/:id/menu-image/draft', 'post', { generator: 'kie/nano-banana-2' });
        assert.equal(first.statusCode, 202);
        assert.equal(first.body.status, 'generating');
        assert.ok(first.body.draft.imageStudio.operationId);
        const duplicate = await invoke('/:id/menu-image/draft', 'post', { generator: 'kie/nano-banana-2' });
        assert.equal(duplicate.statusCode, 409);
        assert.equal(starts, 1);
        replaceOperationDuringUpload = true;
        const changed = await invoke('/:id/menu-image/status', 'get');
        assert.equal(changed.statusCode, 502);
        assert.equal((await pool.query('SELECT status FROM menu_image_paid_operations')).rows[0].status, 'provider_pending');
        replaceOperationDuringUpload = false;
        await pool.query(`UPDATE products SET ai_card_draft=jsonb_set(ai_card_draft,'{imageStudio,operationId}',to_jsonb($1::text)) WHERE id='fixture'`,
            [first.body.draft.imageStudio.operationId]);
        const finished = await invoke('/:id/menu-image/status', 'get');
        assert.equal(finished.body.status, 'ready');
        assert.equal(finished.body.draft.imageStudio.status, 'ready');
        assert.equal(finished.body.draft.imageStudio.imageUrl, '/generated.png');
        assert.equal(finished.body.product.iconUrl, '/current.png');
        assert.equal(polls, 2);
        const record = await pool.query('SELECT status, provider_task_id FROM menu_image_paid_operations');
        assert.equal(record.rows[0].status, 'succeeded');
        assert.equal(record.rows[0].provider_task_id, 'fixture-task');
        const openai = await invoke('/:id/menu-image/draft', 'post', { generator: 'openai' });
        assert.equal(openai.statusCode, 200);
        assert.equal(openai.body.status, 'ready');
        assert.equal(openai.body.draft.imageStudio.imageUrl, '/openai-generated.png');
        assert.equal(openaiCalls, 1);
        failOpenAI = true;
        const uncertain = await invoke('/:id/menu-image/draft', 'post', { generator: 'openai' });
        assert.equal(uncertain.statusCode, 502);
        assert.equal(uncertain.body.code, 'MENU_PAID_OUTCOME_REQUIRES_REVIEW');
        assert.equal(uncertain.body.product.aiCardDraft.imageStudio.status, 'generating');
        assert.equal(uncertain.body.product.aiCardDraft.imageStudio.outcomeUncertain, true);
        await pool.query(`UPDATE products SET ai_card_draft=ai_card_draft #- '{imageStudio,outcomeUncertain}' WHERE id='fixture'`);
        const checked = await invoke('/:id/menu-image/status', 'get');
        assert.equal(checked.body.status, 'unknown');
        assert.equal(checked.body.product.aiCardDraft.imageStudio.outcomeUncertain, true);
        assert.equal((await pool.query("SELECT ai_card_draft #>> '{imageStudio,outcomeUncertain}' AS warning FROM products")).rows[0].warning, null);
        await pool.query("UPDATE menu_image_paid_operations SET status='reserved', created_at=now()-interval '5 minutes' WHERE product_id='fixture' AND status='unknown'");
        const interrupted = await invoke('/:id/menu-image/status', 'get');
        assert.equal(interrupted.body.status, 'unknown');
        assert.equal(interrupted.body.product.aiCardDraft.imageStudio.outcomeUncertain, true);
        assert.equal((await pool.query("SELECT status FROM menu_image_paid_operations WHERE status='reserved'")).rowCount, 1);
        const savedDraft = (await pool.query("SELECT ai_card_draft FROM products WHERE id='fixture'")).rows[0].ai_card_draft;
        await pool.query("UPDATE products SET ai_card_draft='{}'::jsonb WHERE id='fixture'");
        process.env.CRM_MENU_PAID_GUARD_ENABLED = 'false';
        const detached = await invoke('/:id/menu-image/operation', 'get');
        assert.equal(detached.statusCode, 200);
        assert.equal(detached.body.operation.status, 'reserved');
        assert.equal(detached.body.operation.provider, 'openai');
        assert.equal(detached.body.operation.operationId, uncertain.body.product.aiCardDraft.imageStudio.operationId);
        assert.equal(openaiCalls, 2);
        const disabled = await invoke('/:id/menu-image/draft', 'post', { generator: 'openai' });
        assert.equal(disabled.statusCode, 503);
        assert.equal(disabled.body.code, 'MENU_PAID_GUARD_DISABLED');
        assert.equal(openaiCalls, 2);
        await pool.query("UPDATE products SET ai_card_draft=$1::jsonb WHERE id='fixture'", [JSON.stringify(savedDraft)]);
        process.env.CRM_MENU_PAID_GUARD_ENABLED = 'true';
        const retry = await invoke('/:id/menu-image/draft', 'post', { generator: 'openai' });
        assert.equal(retry.statusCode, 409);
        assert.equal(openaiCalls, 2);
    } finally {
        db.pool.query = originalQuery; db.pool.connect = originalConnect; global.fetch = originalFetch;
        imageStorage.uploadFromUrl = originalUpload;
        if (imageProvider) imageProvider.generateAndStoreMenuPhotoDraft = originalOpenAI;
        if (originalKey === undefined) delete process.env.KIE_API_KEY; else process.env.KIE_API_KEY = originalKey;
        if (originalFlag === undefined) delete process.env.CRM_MENU_PAID_GUARD_ENABLED; else process.env.CRM_MENU_PAID_GUARD_ENABLED = originalFlag;
        if (pool) await pool.end();
        if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end(); await db.pool.end();
    }
});
