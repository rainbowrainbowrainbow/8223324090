const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const cachedModules = new Map();

function mockModule(modulePath, exports) {
    const id = require.resolve(modulePath);
    if (!cachedModules.has(id)) cachedModules.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function freshModule(modulePath) {
    const id = require.resolve(modulePath);
    if (!cachedModules.has(id)) cachedModules.set(id, require.cache[id]);
    delete require.cache[id];
    return require(modulePath);
}

function restoreModules() {
    for (const [id, cached] of cachedModules) {
        if (cached) require.cache[id] = cached;
        else delete require.cache[id];
    }
    cachedModules.clear();
}

function listen(app) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
        });
        server.on('error', reject);
    });
}

function close(server) {
    return new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}

async function request(baseUrl, method, path, body, headers = {}) {
    const reqHeaders = { ...headers };
    if (body !== undefined && !reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, text };
}

function userHeaders(contexts = ['event_genix'], defaultContext = contexts[0] || 'event_genix') {
    return {
        'x-test-business-contexts': contexts.join(','),
        'x-test-default-business-context': defaultContext
    };
}

function attachAuthMocks() {
    mockModule('../middleware/auth', {
        authenticateToken: (req, _res, next) => {
            const contexts = String(req.headers['x-test-business-contexts'] || 'event_genix')
                .split(',')
                .map(item => item.trim())
                .filter(Boolean);
            const defaultContext = String(req.headers['x-test-default-business-context'] || contexts[0] || 'event_genix');
            req.user = {
                id: 77,
                username: 'design-isolation',
                role: String(req.headers['x-test-role'] || 'creator'),
                businessContexts: contexts,
                business_contexts: contexts,
                defaultBusinessContext: defaultContext,
                default_business_context: defaultContext
            };
            next();
        },
        requireRole: (...roles) => (req, res, next) => {
            const role = req.user?.role;
            if (role === 'waiter' || (roles.length && role === 'viewer')) {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }
            next();
        }
    });
    mockModule('../services/telegram', {
        getConfiguredChatId: async () => 'unit-chat',
        sendTelegramPhoto: async () => ({ ok: true })
    });
}

function makeDesignRow(input) {
    return {
        id: input.id,
        business_context: input.business_context,
        filename: input.filename || `design-${input.id}.jpg`,
        original_name: input.original_name || `Design ${input.id}.jpg`,
        mime_type: input.mime_type || 'image/jpeg',
        file_size: input.file_size || 12,
        width: null,
        height: null,
        title: input.title || `Design ${input.id}`,
        description: input.description || null,
        is_pinned: input.is_pinned || false,
        collection_id: input.collection_id || null,
        collection_name: null,
        collection_color: null,
        publish_date: input.publish_date || null,
        created_by: input.created_by || 'fixture',
        created_at: input.created_at || '2026-09-13T00:00:00.000Z',
        storage_key: input.storage_key || `designs/${input.id}/${input.filename || `design-${input.id}.jpg`}`,
        tags: input.tags || ''
    };
}

class FakeDesignDb {
    constructor() {
        this.designs = new Map([
            [1, makeDesignRow({ id: 1, business_context: 'event_genix', collection_id: 10, tags: 'promo' })],
            [2, makeDesignRow({ id: 2, business_context: 'dar', collection_id: 20, tags: 'dar' })],
            [3, makeDesignRow({ id: 3, business_context: null, tags: 'orphan' })]
        ]);
        this.collections = new Map([
            [10, { id: 10, name: 'Park', color: '#111111', sort_order: 1, business_context: 'event_genix', created_at: '2026-09-13T00:00:00.000Z' }],
            [20, { id: 20, name: 'Dar', color: '#222222', sort_order: 1, business_context: 'dar', created_at: '2026-09-13T00:00:00.000Z' }]
        ]);
        this.blobs = new Map([
            ['designs/1/design-1.jpg', { storage_key: 'designs/1/design-1.jpg', data: Buffer.from('park-file'), checksum_sha256: 'park' }],
            ['designs/2/design-2.jpg', { storage_key: 'designs/2/design-2.jpg', data: Buffer.from('dar-file'), checksum_sha256: 'dar' }]
        ]);
        this.queries = [];
        this.telegramSends = 0;
        this.nextDesignId = 100;
    }

    async connect() {
        return {
            query: this.query.bind(this),
            release: () => {}
        };
    }

    rowsForContext(context) {
        return [...this.designs.values()]
            .filter(row => row.business_context === context)
            .map(row => this.withCollection(row));
    }

    withCollection(row) {
        const collection = row.collection_id ? this.collections.get(Number(row.collection_id)) : null;
        return {
            ...row,
            collection_name: collection && collection.business_context === row.business_context ? collection.name : null,
            collection_color: collection && collection.business_context === row.business_context ? collection.color : null
        };
    }

    async query(sql, params = []) {
        const text = String(sql);
        this.queries.push({ text, params });
        if (/^BEGIN\b|^COMMIT\b|^ROLLBACK\b/i.test(text)) return { rows: [], rowCount: 0 };

        if (/^\s*SELECT COUNT\(\*\) FROM designs d/i.test(text)) {
            return { rows: [{ count: String(this.rowsForContext(params[0]).length) }], rowCount: 1 };
        }
        if (/FROM design_tags dt\s+JOIN designs d/i.test(text)) {
            const context = params[0];
            const counts = new Map();
            for (const row of this.rowsForContext(context)) {
                for (const tag of String(row.tags || '').split(',').filter(Boolean)) {
                    counts.set(tag, (counts.get(tag) || 0) + 1);
                }
            }
            return { rows: [...counts.entries()].map(([tag, count]) => ({ tag, count })), rowCount: counts.size };
        }
        if (/FROM design_collections\s+WHERE business_context = \$1/i.test(text)) {
            const rows = [...this.collections.values()]
                .filter(row => row.business_context === params[0])
                .map(row => ({
                    ...row,
                    design_count: this.rowsForContext(params[0]).filter(design => Number(design.collection_id) === Number(row.id)).length
                }));
            return { rows, rowCount: rows.length };
        }
        if (/INSERT INTO design_collections/i.test(text)) {
            const id = 30 + this.collections.size;
            const row = { id, name: params[0], color: params[1], business_context: params[2], created_by_user_id: params[3], sort_order: 0 };
            this.collections.set(id, row);
            return { rows: [row], rowCount: 1 };
        }
        if (/UPDATE design_collections/i.test(text)) {
            const row = this.collections.get(Number(params[3]));
            if (!row || row.business_context !== params[4]) return { rows: [], rowCount: 0 };
            Object.assign(row, {
                name: params[0] || row.name,
                color: params[1] || row.color,
                sort_order: params[2] || row.sort_order
            });
            return { rows: [row], rowCount: 1 };
        }
        if (/SELECT id FROM design_collections WHERE id = \$1 AND business_context = \$2/i.test(text)) {
            const row = this.collections.get(Number(params[0]));
            return row && row.business_context === params[1] ? { rows: [{ id: row.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/DELETE FROM design_collections/i.test(text)) {
            const row = this.collections.get(Number(params[0]));
            if (!row || row.business_context !== params[1]) return { rows: [], rowCount: 0 };
            this.collections.delete(Number(params[0]));
            return { rows: [{ id: Number(params[0]) }], rowCount: 1 };
        }
        if (/UPDATE designs SET collection_id = NULL/i.test(text)) {
            for (const row of this.designs.values()) {
                if (Number(row.collection_id) === Number(params[0]) && row.business_context === params[1]) row.collection_id = null;
            }
            return { rows: [], rowCount: 1 };
        }
        if (/INSERT INTO designs/i.test(text)) {
            const id = this.nextDesignId++;
            const row = makeDesignRow({
                id,
                filename: params[0],
                original_name: params[1],
                mime_type: params[2],
                file_size: params[3],
                title: params[6],
                collection_id: params[7],
                created_by: params[8],
                business_context: params[9]
            });
            row.created_by_user_id = params[10];
            row.storage_key = null;
            this.designs.set(id, row);
            return { rows: [row], rowCount: 1 };
        }
        if (/INSERT INTO design_file_blobs/i.test(text)) {
            this.blobs.set(params[1], { storage_key: params[1], data: params[2], checksum_sha256: params[3] });
            return { rows: [], rowCount: 1 };
        }
        if (/UPDATE designs\s+SET storage_provider/i.test(text)) {
            const row = this.designs.get(Number(params[0]));
            if (!row) return { rows: [], rowCount: 0 };
            row.storage_provider = params[1];
            row.storage_key = params[2];
            return { rows: [row], rowCount: 1 };
        }
        if (/INSERT INTO design_tags/i.test(text)) {
            const row = this.designs.get(Number(params[0]));
            if (row) row.tags = [...new Set([...String(row.tags || '').split(',').filter(Boolean), params[1]])].join(',');
            return { rows: [], rowCount: 1 };
        }
        if (/DELETE FROM design_tags/i.test(text)) {
            const row = this.designs.get(Number(params[0]));
            if (row && row.business_context === params[1]) row.tags = '';
            return { rows: [], rowCount: 1 };
        }
        if (/FROM design_file_blobs/i.test(text)) {
            const row = this.designs.get(Number(params[0]));
            const key = params[1] || row?.storage_key;
            const blob = key ? this.blobs.get(key) : null;
            return blob ? { rows: [blob], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/SELECT id, filename, original_name, mime_type, storage_key FROM designs WHERE id = \$1 AND business_context = \$2/i.test(text)) {
            const row = this.designs.get(Number(params[0]));
            return row && row.business_context === params[1] ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/SELECT id, filename FROM designs WHERE id = \$1 AND business_context = \$2/i.test(text)) {
            const row = this.designs.get(Number(params[0]));
            return row && row.business_context === params[1]
                ? { rows: [{ id: row.id, filename: row.filename }], rowCount: 1 }
                : { rows: [], rowCount: 0 };
        }
        if (/SELECT \* FROM designs WHERE id = \$1 AND business_context = \$2/i.test(text)) {
            const row = this.designs.get(Number(params[0]));
            return row && row.business_context === params[1] ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/UPDATE designs SET/i.test(text)) {
            const row = this.designs.get(Number(params[5]));
            if (!row || row.business_context !== params[6]) return { rows: [], rowCount: 0 };
            row.title = params[0] || row.title;
            row.description = params[1] || row.description;
            row.is_pinned = params[2] ?? row.is_pinned;
            row.collection_id = params[3];
            row.publish_date = params[4];
            return { rows: [], rowCount: 1 };
        }
        if (/FROM designs d/i.test(text) && /WHERE d\.id = \$1\s+AND d\.business_context = \$2/i.test(text)) {
            const row = this.designs.get(Number(params[0]));
            return row && row.business_context === params[1] ? { rows: [this.withCollection(row)], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/FROM designs d/i.test(text) && /d\.business_context = \$1/i.test(text)) {
            const rows = this.rowsForContext(params[0]);
            return { rows, rowCount: rows.length };
        }
        if (/DELETE FROM design_file_blobs/i.test(text)) {
            for (const [key] of this.blobs) {
                if (key.startsWith(`designs/${params[0]}/`)) this.blobs.delete(key);
            }
            return { rows: [], rowCount: 1 };
        }
        if (/DELETE FROM designs WHERE id = \$1/i.test(text)) {
            const row = this.designs.get(Number(params[0]));
            if (row && row.business_context === params[1]) this.designs.delete(Number(params[0]));
            return { rows: [], rowCount: row && row.business_context === params[1] ? 1 : 0 };
        }

        throw new Error(`Unexpected design isolation SQL: ${text}`);
    }
}

async function withDesignApp(db, fn) {
    attachAuthMocks();
    mockModule('../db', { pool: db });
    const router = freshModule('../routes/designs');
    const app = express();
    app.use(express.json());
    app.use('/api/designs', router);
    const started = await listen(app);
    try {
        await fn(started.baseUrl);
    } finally {
        await close(started.server);
        restoreModules();
    }
}

test('Design Board list, tags, collections, and details stay inside the active business context', async () => {
    const db = new FakeDesignDb();
    await withDesignApp(db, async baseUrl => {
        const park = await request(baseUrl, 'GET', '/api/designs', undefined, userHeaders(['event_genix', 'dar']));
        assert.equal(park.status, 200, JSON.stringify(park.data));
        assert.deepEqual(park.data.items.map(item => item.id), [1]);
        assert.deepEqual(park.data.items.map(item => item.businessContext), ['event_genix']);

        const dar = await request(baseUrl, 'GET', '/api/designs?businessContext=dar', undefined, userHeaders(['event_genix', 'dar']));
        assert.equal(dar.status, 200, JSON.stringify(dar.data));
        assert.deepEqual(dar.data.items.map(item => item.id), [2]);

        const tags = await request(baseUrl, 'GET', '/api/designs/tags?businessContext=dar', undefined, userHeaders(['event_genix', 'dar']));
        assert.equal(tags.status, 200, JSON.stringify(tags.data));
        assert.deepEqual(tags.data.map(item => item.tag), ['dar']);

        const collections = await request(baseUrl, 'GET', '/api/designs/collections?businessContext=dar', undefined, userHeaders(['event_genix', 'dar']));
        assert.equal(collections.status, 200, JSON.stringify(collections.data));
        assert.deepEqual(collections.data.map(item => item.id), [20]);

        const disallowedContext = await request(baseUrl, 'GET', '/api/designs/2?businessContext=dar', undefined, userHeaders(['event_genix']));
        assert.equal(disallowedContext.status, 403, JSON.stringify(disallowedContext.data));

        const foreignDetail = await request(baseUrl, 'GET', '/api/designs/2', undefined, userHeaders(['event_genix']));
        assert.equal(foreignDetail.status, 404, JSON.stringify(foreignDetail.data));

        const foreignByDefaultContext = await request(baseUrl, 'GET', '/api/designs/2', undefined, userHeaders(['event_genix', 'dar']));
        assert.equal(foreignByDefaultContext.status, 404, JSON.stringify(foreignByDefaultContext.data));
    });
});

test('Design Board download, update, delete, and Telegram reject cross-business materials', async () => {
    const db = new FakeDesignDb();
    await withDesignApp(db, async baseUrl => {
        const foreignDownload = await request(baseUrl, 'GET', '/api/designs/2/download', undefined, userHeaders(['event_genix', 'dar']));
        assert.equal(foreignDownload.status, 404, foreignDownload.text);

        const foreignUpdate = await request(baseUrl, 'PUT', '/api/designs/2', { title: 'Wrong' }, userHeaders(['event_genix', 'dar']));
        assert.equal(foreignUpdate.status, 404, JSON.stringify(foreignUpdate.data));
        assert.equal(db.designs.get(2).title, 'Design 2');

        const foreignDelete = await request(baseUrl, 'DELETE', '/api/designs/2', undefined, userHeaders(['event_genix', 'dar']));
        assert.equal(foreignDelete.status, 404, JSON.stringify(foreignDelete.data));
        assert.equal(db.designs.has(2), true);

        const foreignTelegram = await request(baseUrl, 'POST', '/api/designs/2/telegram', {}, userHeaders(['event_genix', 'dar']));
        assert.equal(foreignTelegram.status, 404, JSON.stringify(foreignTelegram.data));
        assert.equal(db.telegramSends, 0);
    });
});

test('Design Board mutations reject collections from another business and stamp uploads with server scope', async () => {
    const db = new FakeDesignDb();
    await withDesignApp(db, async baseUrl => {
        const badUpdate = await request(baseUrl, 'PUT', '/api/designs/1', { collection_id: 20 }, userHeaders(['event_genix', 'dar']));
        assert.equal(badUpdate.status, 400, JSON.stringify(badUpdate.data));
        assert.equal(db.designs.get(1).collection_id, 10);

        const form = new FormData();
        form.set('collection_id', '20');
        form.append('files', new Blob([Buffer.from('design bytes')], { type: 'image/jpeg' }), 'fixture.jpg');
        const upload = await fetch(`${baseUrl}/api/designs/upload`, {
            method: 'POST',
            headers: userHeaders(['event_genix', 'dar']),
            body: form
        });
        assert.equal(upload.status, 400, await upload.text());
        assert.equal([...db.designs.values()].some(row => row.id >= 100), false);

        const goodForm = new FormData();
        goodForm.set('collection_id', '10');
        goodForm.append('files', new Blob([Buffer.from('design bytes')], { type: 'image/jpeg' }), 'fixture.jpg');
        const goodUpload = await fetch(`${baseUrl}/api/designs/upload`, {
            method: 'POST',
            headers: userHeaders(['event_genix', 'dar']),
            body: goodForm
        });
        const data = await goodUpload.json();
        assert.equal(goodUpload.status, 200, JSON.stringify(data));
        assert.equal(data.count, 1);
        assert.equal(data.items[0].businessContext, 'event_genix');
        assert.equal([...db.designs.values()].filter(row => row.id >= 100)[0].business_context, 'event_genix');
    });
});
