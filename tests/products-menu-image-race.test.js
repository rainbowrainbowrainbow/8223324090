'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../db');
const provider = require('../services/menuPhotoGeneration');
const originalGenerate = provider.generateAndStoreMenuPhotoDraft;
const originalQuery = pool.query;
let complete;
provider.generateAndStoreMenuPhotoDraft = () => new Promise((resolve, reject) => { complete = { resolve, reject }; });
const router = require('../routes/products');
after(() => { provider.generateAndStoreMenuPhotoDraft = originalGenerate; pool.query = originalQuery; });

for (const outcome of ['success', 'failure']) for (const changed of [false, true]) test(`OpenAI ${outcome}, draft ${changed ? 'rejected' : 'unchanged'} during generation`, async () => {
    complete = null;
    const product = { id: 'synthetic-1', business_context: 'event_genix', domain: 'kitchen',
        kitchen_type: 'menu', name: 'Synthetic pasta', icon_url: '/current.png', is_active: true,
        ai_card_draft: {} };
    pool.query = async (sql, params) => {
        if (sql.includes('WHERE p.id = $1')) return { rows: [{ ...product }], rowCount: 1 };
        if (sql.includes('jsonb_set(')) {
            if (sql.includes("'{imageStudio,preparedAt}' = $6")) {
                const current = product.ai_card_draft.imageStudio;
                if (current.status !== 'generating' || current.preparedAt !== params[5]) return { rowCount: 0 };
            }
            product.ai_card_draft = { ...product.ai_card_draft, imageStudio: JSON.parse(params[0]) };
            return { rowCount: 1 };
        }
        if (sql.includes('SET ai_card_draft = $1::jsonb')) {
            product.ai_card_draft = JSON.parse(params[0]);
            return { rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
    };
    const handler = router.stack.find(layer => layer.route?.path === '/:id/menu-image/draft').route.stack.at(-1).handle;
    const response = { statusCode: 200, status(n) { this.statusCode = n; return this; },
        json(body) { this.body = body; return this; }, setHeader() {} };
    const pending = handler({ params: { id: product.id }, body: {}, query: { businessContext: 'event_genix' },
        headers: {}, user: { username: 'synthetic', role: 'admin' } }, response);
    while (!complete) await new Promise(resolve => setImmediate(resolve));
    if (changed) {
        product.ai_card_draft.imageStudio.status = 'rejected';
        product.ai_card_draft.imageStudio.rejectedBy = 'synthetic';
    }
    if (outcome === 'success') complete.resolve({ status: 'ready', imageUrl: '/generated.png' });
    else complete.reject(new Error('Synthetic timeout'));
    await pending;
    assert.equal(response.statusCode, changed ? 409 : outcome === 'success' ? 200 : 502);
    if (changed) assert.equal(response.body.code, 'menu_image_draft_changed');
    assert.equal(product.ai_card_draft.imageStudio.status, changed ? 'rejected' : outcome === 'success' ? 'ready' : 'failed');
    assert.equal(product.icon_url, '/current.png');
});
