/**
 * routes/catalogs.js — Multi-catalog system v1.0
 * TABLES: catalog_definitions, catalog_subcategories, catalog_items,
 *         catalog_settings, trend_proposals
 *
 * Does NOT duplicate products (programs) — physical goods only
 */
const router  = require('express').Router();
const https   = require('https');
const { pool }  = require('../db');
const { uploadFromUrl, makeFilename } = require('../services/imageStorage');
const { callUnifiedChatCompletion } = require('../services/ai-config');
const { requireRole, authenticateToken } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Catalogs');
function getKleshnya() { return require('../services/kleshnya'); }

const KIE_KEY = process.env.KIE_API_KEY || '';

// ─── Kie.ai helpers ──────────────────────────────────────────
function kieRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const postData = body ? JSON.stringify(body) : null;
        const req = https.request({
            hostname: 'api.kie.ai', path, method,
            headers: {
                'Authorization': `Bearer ${KIE_KEY}`,
                'Content-Type': 'application/json',
                ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
            }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error('Invalid JSON from Kie.ai')); }
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Kie.ai timeout')); });
        if (postData) req.write(postData);
        req.end();
    });
}

function parseKieImageUrl(data) {
    if (!data) return null;
    try {
        const rj = typeof data.resultJson === 'string'
            ? JSON.parse(data.resultJson) : (data.resultJson || {});
        return rj?.resultUrls?.[0] || null;
    } catch { return null; }
}

// ─── Catalog definitions ─────────────────────────────────────
router.get('/definitions', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const defs = await pool.query(
            'SELECT * FROM catalog_definitions WHERE is_active = true ORDER BY sort_order LIMIT 500'
        );
        const subs = await pool.query(
            'SELECT * FROM catalog_subcategories ORDER BY catalog_id, sort_order LIMIT 1000'
        );
        const result = defs.rows.map(d => ({
            ...d,
            subcategories: subs.rows
                .filter(s => s.catalog_id === d.id)
                .map(s => ({ id: s.id, name: s.name }))
        }));
        res.json({ success: true, catalogs: result });
    } catch (err) {
        log.error('GET /definitions error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/definitions', requireRole('admin', 'creator', 'director'), async (req, res) => {
    try {
        const { id, name, emoji, description, aiStyle, hasSubcategories, hasSizes, sortOrder } = req.body;
        if (!id || !name) return res.status(400).json({ error: 'id та name required' });
        await pool.query(
            `INSERT INTO catalog_definitions (id, name, emoji, description, ai_style, has_subcategories, has_sizes, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [id, name, emoji || '🗂️', description || null, aiStyle || null,
             hasSubcategories || false, hasSizes || false, sortOrder || 0]
        );
        await pool.query(
            'INSERT INTO catalog_settings (catalog_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]
        );
        res.json({ success: true });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Каталог з таким id вже існує' });
        log.error('POST /definitions error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/definitions/:id/subcategories', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { name, sortOrder } = req.body;
        if (!name) return res.status(400).json({ error: 'name required' });
        const r = await pool.query(
            'INSERT INTO catalog_subcategories (catalog_id, name, sort_order) VALUES ($1, $2, $3) RETURNING *',
            [req.params.id, name, sortOrder || 0]
        );
        res.json({ success: true, subcategory: r.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ─── CRUD items ──────────────────────────────────────────────
router.get('/items', async (req, res) => {
    try {
        const { catalogId, subcategory, status, includeArchived } = req.query;
        const conds  = [];
        const params = [];
        let idx = 1;
        if (!includeArchived) { conds.push(`ci.status = $${idx++}`); params.push('active'); }
        else if (status) { conds.push(`ci.status = $${idx++}`); params.push(status); }
        if (catalogId)   { conds.push(`ci.catalog_id = $${idx++}`);  params.push(catalogId); }
        if (subcategory) { conds.push(`ci.subcategory = $${idx++}`); params.push(subcategory); }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const result = await pool.query(
            `SELECT ci.*, cd.name AS catalog_name, cd.emoji AS catalog_emoji
             FROM catalog_items ci
             JOIN catalog_definitions cd ON cd.id = ci.catalog_id
             ${where}
             ORDER BY ci.subcategory NULLS LAST, ci.created_at DESC`,
            params
        );
        res.json({ success: true, items: result.rows, total: result.rowCount });
    } catch (err) {
        log.error('GET /items error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/items/:id', async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT ci.*, cd.name AS catalog_name, cd.emoji AS catalog_emoji, cd.ai_style
             FROM catalog_items ci
             JOIN catalog_definitions cd ON cd.id = ci.catalog_id
             WHERE ci.id = $1`,
            [req.params.id]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true, item: r.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/items', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { catalogId, subcategory, name, description, price, imageUrl, extraData } = req.body;
        if (!catalogId) return res.status(400).json({ error: 'catalogId required' });
        if (!name?.trim()) return res.status(400).json({ error: 'name required' });
        const catCheck = await pool.query('SELECT id FROM catalog_definitions WHERE id = $1', [catalogId]);
        if (!catCheck.rowCount) return res.status(400).json({ error: `Каталог '${catalogId}' не знайдено` });
        const r = await pool.query(
            `INSERT INTO catalog_items (catalog_id, subcategory, name, description, price, image_url, extra_data, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [catalogId, subcategory || null, name.trim(), description || null,
             price || null, imageUrl || null, JSON.stringify(extraData || {}), req.user.username]
        );
        res.json({ success: true, item: r.rows[0] });
    } catch (err) {
        log.error('POST /items error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch('/items/:id', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { name, description, price, imageUrl, subcategory, status, extraData } = req.body;
        const COLS = {
            name, description, price, subcategory, status,
            image_url: imageUrl,
            extra_data: extraData !== undefined ? JSON.stringify(extraData) : undefined
        };
        const sets = [], vals = [];
        let idx = 1;
        for (const [col, val] of Object.entries(COLS)) {
            if (val !== undefined) { sets.push(`${col} = $${idx++}`); vals.push(val); }
        }
        if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
        sets.push('updated_at = NOW()');
        vals.push(req.params.id);
        const r = await pool.query(
            `UPDATE catalog_items SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
            vals
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true, item: r.rows[0] });
    } catch (err) {
        log.error('PATCH /items/:id error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.delete('/items/:id', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        await pool.query(
            "UPDATE catalog_items SET status = 'archived', updated_at = NOW() WHERE id = $1",
            [req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/items/:id/restore', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const r = await pool.query(
            "UPDATE catalog_items SET status = 'active', updated_at = NOW() WHERE id = $1 RETURNING *",
            [req.params.id]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true, item: r.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ─── Image generation (Kie.ai) ──────────────────────────────
const DEFAULT_AI_STYLE = 'colorful illustration, white background, vibrant colors, professional, no text';

router.post('/generate-image', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { name, catalogId, subcategory, customPrompt } = req.body;
        if (!name && !customPrompt) return res.status(400).json({ error: 'name required' });
        let aiStyle = DEFAULT_AI_STYLE;
        if (catalogId) {
            const catRow = await pool.query('SELECT ai_style FROM catalog_definitions WHERE id = $1', [catalogId]);
            if (catRow.rows[0]?.ai_style) aiStyle = catRow.rows[0].ai_style;
        }
        const themeContext = [name, subcategory].filter(Boolean).join(', ');
        // v38.11: Transliterate Ukrainian→English for AI (Gemini rejects cyrillic)
        const _tr = {'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya'};
        const enContext = themeContext.split('').map(c => _tr[c.toLowerCase()] || c).join('');
        const prompt = customPrompt || `${aiStyle}. Product: "${enContext}". Children's entertainment park toy.`;
        const r = await kieRequest('POST', '/api/v1/jobs/createTask', {
            model: 'nano-banana-2',
            input: { prompt, aspect_ratio: '1:1', resolution: '1K', output_format: 'png' }
        });
        const taskId = r?.data?.taskId;
        if (!taskId) {
            const kieErr = r?.message || r?.error || JSON.stringify(r || {}).slice(0, 200);
            log.error('Kie.ai no taskId:', kieErr);
            return res.status(502).json({ error: `Kie.ai не створив задачу: ${kieErr}. Спробуйте пізніше.` });
        }
        res.json({ success: true, taskId, status: 'processing' });
    } catch (err) {
        log.error('POST /generate-image error', err);
        const msg = err.message.includes('timeout') ? 'Kie.ai не відповідає (таймаут). Спробуйте пізніше.' : err.message;
        res.status(502).json({ success: false, error: msg });
    }
});

router.get('/generate-image/:taskId', async (req, res) => {
    try {
        const taskId = String(req.params.taskId || '').trim();
        const r = await kieRequest('GET', `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
        const data   = r?.data || {};
        const state  = data.state || null;
        const imgUrl = parseKieImageUrl(data);
        const done   = state === 'success' && !!imgUrl;
        res.json({ success: true, taskId, state, done,
                   imageUrl: done ? imgUrl : null,
                   error: state === 'failed' ? (data.failMsg || 'Failed') : null });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/catalogs/generate-image-from-ref — Image-to-Image using reference
router.post('/generate-image-from-ref', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { referenceUrl, prompt, catalogId } = req.body;
        if (!referenceUrl) return res.status(400).json({ error: 'referenceUrl is required' });
        const finalPrompt = prompt || 'keep style, enhance quality, clean background';
        const r = await kieRequest('POST', '/api/v1/jobs/createTask', {
            model: 'nano-banana-2',
            input: {
                prompt: finalPrompt,
                image: referenceUrl,
                aspect_ratio: '1:1',
                resolution: '1K',
                output_format: 'png'
            }
        });
        const taskId = r?.data?.taskId;
        if (!taskId) {
            const kieErr = r?.message || r?.error || JSON.stringify(r || {}).slice(0, 200);
            log.error('Kie.ai ref no taskId:', kieErr);
            return res.status(502).json({ error: `Kie.ai не створив задачу: ${kieErr}` });
        }
        res.json({ success: true, taskId, status: 'processing' });
    } catch (err) {
        log.error('POST /generate-image-from-ref error', err);
        const msg = err.message.includes('timeout') ? 'Kie.ai не відповідає (таймаут). Спробуйте пізніше.' : err.message;
        res.status(502).json({ success: false, error: msg });
    }
});

router.post('/batch-generate', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { catalogId } = req.body;
        const conds  = ["ci.status = 'active'", 'ci.image_url IS NULL'];
        const params = [];
        let idx = 1;
        if (catalogId) { conds.push(`ci.catalog_id = $${idx++}`); params.push(catalogId); }
        const items = await pool.query(
            `SELECT ci.id, ci.name, ci.subcategory, ci.catalog_id, cd.ai_style
             FROM catalog_items ci
             JOIN catalog_definitions cd ON cd.id = ci.catalog_id
             WHERE ${conds.join(' AND ')} LIMIT 20`,
            params
        );
        if (!items.rowCount) return res.json({ success: true, started: 0 });
        const tasks = [];
        for (const item of items.rows) {
            try {
                const style = item.ai_style || DEFAULT_AI_STYLE;
                const themeCtx = [item.name, item.subcategory].filter(Boolean).join(', ');
                const _tr = {'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya',' ':' '};
                const enCtx = themeCtx.split('').map(c => _tr[c.toLowerCase()] || c).join('');
                const prompt = `${style}. Product: "${enCtx}". Ukrainian children's park.`;
                const r = await kieRequest('POST', '/api/v1/jobs/createTask', {
                    model: 'nano-banana-2',
                    input: { prompt, aspect_ratio: '1:1', resolution: '1K', output_format: 'png' }
                });
                if (r?.data?.taskId) tasks.push({ itemId: item.id, taskId: r.data.taskId });
            } catch (e) { log.warn(`Batch gen failed ${item.id}: ${e.message}`); }
        }
        res.json({ success: true, started: tasks.length, tasks,
                   estimatedCost: `~$${(tasks.length * 0.02).toFixed(2)}` });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/apply-image', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { itemId, taskId } = req.body;
        if (!itemId || !taskId) return res.status(400).json({ error: 'itemId і taskId required' });
        const r = await kieRequest('GET', `/api/v1/jobs/recordInfo?taskId=${taskId}`);
        const kieUrl = parseKieImageUrl(r?.data);
        if (!kieUrl) return res.json({ success: false, done: false, state: r?.data?.state });

        // v38.11: Store generated image permanently instead of keeping Kie.ai temp URL (14 days)
        const item = await pool.query('SELECT name, catalog_id FROM catalog_items WHERE id = $1', [itemId]);
        const itemName = item.rows[0]?.name || 'item';
        const catalogId = item.rows[0]?.catalog_id || 'misc';
        const filename = makeFilename(catalogId, itemName);
        log.info(`apply-image: downloading ${kieUrl.substring(0, 50)}... → ${filename}`);
        const permanentUrl = await uploadFromUrl(kieUrl, filename);
        const finalUrl = permanentUrl || kieUrl;
        log.info(`apply-image: saved as ${permanentUrl ? 'CRM upload' : 'KIE.AI fallback'}: ${finalUrl.substring(0, 60)}`);


        await pool.query('UPDATE catalog_items SET image_url = $1, updated_at = NOW() WHERE id = $2', [finalUrl, itemId]);
        res.json({ success: true, done: true, imageUrl: finalUrl });
    } catch (err) {
        log.error('apply-image error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/kie-balance', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const r = await kieRequest('GET', '/api/v1/chat/credit');
        res.json({ success: true, balance: r?.data || 0 });
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ─── Cover image generation (v39.7.0) ───────────────────────
const _tr = {'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya'};
function _transliterate(text) { return text.split('').map(c => _tr[c.toLowerCase()] || c).join(''); }

router.post('/:catalogId/generate-cover', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { catalogId } = req.params;
        const { customPrompt } = req.body;
        const catRow = await pool.query('SELECT * FROM catalog_definitions WHERE id = $1', [catalogId]);
        if (!catRow.rowCount) return res.status(404).json({ error: 'Каталог не знайдено' });
        const cat = catRow.rows[0];
        const aiStyle = cat.ai_style || DEFAULT_AI_STYLE;
        const enName = _transliterate(cat.name || catalogId);
        const prompt = customPrompt || `${aiStyle}. Professional catalog cover design for "${enName}" collection. Modern, elegant, eye-catching catalog front page, children's entertainment park.`;
        const r = await kieRequest('POST', '/api/v1/jobs/createTask', {
            model: 'nano-banana-2',
            input: { prompt, aspect_ratio: '4:3', resolution: '2K', output_format: 'png' }
        });
        const taskId = r?.data?.taskId;
        if (!taskId) {
            return res.status(502).json({ error: `Kie.ai не створив задачу: ${r?.message || 'unknown'}` });
        }
        res.json({ success: true, taskId, status: 'processing' });
    } catch (err) {
        log.error('generate-cover error', err);
        res.status(502).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/:catalogId/apply-cover', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { catalogId } = req.params;
        const { taskId } = req.body;
        if (!taskId) return res.status(400).json({ error: 'taskId required' });
        const r = await kieRequest('GET', `/api/v1/jobs/recordInfo?taskId=${taskId}`);
        const kieUrl = parseKieImageUrl(r?.data);
        if (!kieUrl) return res.json({ success: false, done: false, state: r?.data?.state });

        const filename = makeFilename(catalogId, 'cover');
        const permanentUrl = await uploadFromUrl(kieUrl, filename);
        const finalUrl = permanentUrl || kieUrl;

        await pool.query('UPDATE catalog_definitions SET cover_image_url = $1 WHERE id = $2', [finalUrl, catalogId]);

        // Also update cover page (page_number=0) if exists
        await pool.query('UPDATE catalog_pages SET background_url = $1, image_url = $1, updated_at = NOW() WHERE catalog_id = $2 AND page_number = 0', [finalUrl, catalogId]);

        res.json({ success: true, done: true, imageUrl: finalUrl });
    } catch (err) {
        log.error('apply-cover error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ─── Telegram share ──────────────────────────────────────────
router.post('/items/:id/telegram', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { targetChatId, caption: extraCaption } = req.body;
        const { sendTelegramPhoto, sendTelegramMessage, getConfiguredChatId } = require('../services/telegram');
        const r = await pool.query(
            'SELECT ci.*, cd.name AS catalog_name FROM catalog_items ci JOIN catalog_definitions cd ON cd.id = ci.catalog_id WHERE ci.id = $1',
            [req.params.id]
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
        const it = r.rows[0];
        const cap = extraCaption
            || `${it.catalog_emoji || '🗂️'} *${it.name}*${it.subcategory ? ' (' + it.subcategory + ')' : ''}\n${it.description ? it.description + '\n' : ''}${it.price ? '💰 ' + it.price + ' ₴' : ''}`;
        const chatId = targetChatId || (await getConfiguredChatId());
        if (!chatId) return res.status(400).json({ error: 'chatId не знайдено' });
        if (it.image_url) await sendTelegramPhoto(chatId, it.image_url, cap);
        else await sendTelegramMessage(chatId, cap);
        res.json({ success: true });
    } catch (err) {
        log.error('POST /items/:id/telegram error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ─── Price suggestion ────────────────────────────────────────
router.post('/suggest-price', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { catalogId, subcategory, complexity } = req.body;
        const conds  = ["catalog_id = $1", "status = 'active'", "price > 0"];
        const params = [catalogId];
        let idx = 2;
        if (subcategory) { conds.push(`subcategory = $${idx++}`); params.push(subcategory); }
        const avg = await pool.query(
            `SELECT AVG(price) AS avg, MIN(price) AS min, MAX(price) AS max FROM catalog_items WHERE ${conds.join(' AND ')}`,
            params
        );
        const row = avg.rows[0];
        let suggested;
        if (row?.avg) {
            const mult = { easy: 0.8, medium: 1.0, hard: 1.3, premium: 1.6 }[complexity] || 1.0;
            suggested = Math.round(parseFloat(row.avg) * mult / 50) * 50;
        } else {
            const DEFAULTS = { pinyata: 500, cake: 1200, menu: 150, costume: 2000 };
            suggested = DEFAULTS[catalogId] || 500;
        }
        res.json({ suggested, basis: row?.avg ? 'avg_existing' : 'base_price',
                   avgExisting: row?.avg ? Math.round(parseFloat(row.avg)) : null,
                   range: row?.avg ? { min: row.min, max: row.max } : null });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ─── Publish (transaction) ───────────────────────────────────
router.post('/publish', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    const { catalogId, subcategory, name, description, price, imageUrl, extraData,
            createTask: doTask = true, createPrice: doPrice = true } = req.body;
    if (!catalogId || !name?.trim())
        return res.status(400).json({ error: 'catalogId та name обов\'язкові' });
    const results = { catalogItem: null, priceItem: null, task: null, errors: [] };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const r1 = await client.query(
            `INSERT INTO catalog_items (catalog_id, subcategory, name, description, price, image_url, extra_data, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [catalogId, subcategory || null, name.trim(), description || null,
             price || null, imageUrl || null, JSON.stringify(extraData || {}), req.user.username]
        );
        results.catalogItem = { id: r1.rows[0].id };
        if (doPrice && price > 0) {
            const catRow = await client.query('SELECT name FROM catalog_definitions WHERE id = $1', [catalogId]);
            const catName = catRow.rows[0]?.name || catalogId;
            const r2 = await client.query(
                `INSERT INTO price_rules (code, name, value, unit, category, description, updated_by)
                 VALUES ($1, $2, $3, '₴', $4, $5, $6) RETURNING id`,
                [`cat_${catalogId}_${Date.now()}`, name.trim(), price, catName,
                 [subcategory, description].filter(Boolean).join(' — ') || null, req.user.username]
            );
            results.priceItem = { id: r2.rows[0].id };
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('Publish ROLLBACK', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
    if (doTask) {
        try {
            const kleshnya = require('../services/kleshnya');
            const task = await kleshnya.createTask({
                title: `🖨️ Роздрукуй нову сторінку каталогу: ${name.trim()}`,
                description: `"${name.trim()}" в каталозі ${catalogId}${subcategory ? ' / ' + subcategory : ''}.\nЦіна: ${price ? price + '₴' : '—'}\n${imageUrl ? '🖼 Зображення є.' : '⚠️ Зображення відсутнє.'}`,
                priority: 'normal', source_type: 'kleshnya', category: 'admin',
                created_by: req.user.username
            });
            results.task = { id: task.id };
        } catch (err) {
            log.warn('Task creation non-critical fail:', err.message);
            results.errors.push(`Задача: ${err.message}`);
        }
    }
    res.json({ success: true, results });
});

// ─── Demand stats ────────────────────────────────────────────
router.get('/demand-stats', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { catalogId } = req.query;
        let query, params = [];
        if (catalogId === 'pinyata') {
            query = `SELECT ci.id, ci.name, ci.subcategory, ci.price, ci.image_url,
                            COUNT(b.id)::int AS bookings_count
                     FROM catalog_items ci
                     LEFT JOIN bookings b ON b.pinata_filler ILIKE '%' || ci.name || '%'
                        AND COALESCE(b.pinata_mode, 'park') = 'park'
                        AND b.status != 'cancelled'
                     WHERE ci.catalog_id = 'pinyata' AND ci.status = 'active'
                     GROUP BY ci.id ORDER BY bookings_count DESC, ci.name`;
        } else if (catalogId === 'costume') {
            query = `SELECT ci.id, ci.name, ci.subcategory, ci.price, ci.image_url,
                            COUNT(b.id)::int AS bookings_count
                     FROM catalog_items ci
                     LEFT JOIN bookings b ON b.costume ILIKE '%' || ci.name || '%'
                     WHERE ci.catalog_id = 'costume' AND ci.status = 'active'
                     GROUP BY ci.id ORDER BY bookings_count DESC, ci.name`;
        } else {
            query = `SELECT id, name, subcategory, price, image_url, 0::int AS bookings_count
                     FROM catalog_items
                     WHERE ${catalogId ? 'catalog_id = $1 AND ' : ''}status = 'active'
                     ORDER BY subcategory NULLS LAST, name`;
            if (catalogId) params.push(catalogId);
        }
        const result = await pool.query(query, params);
        res.json({ success: true, items: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// ─── Settings & Trends ──────────────────────────────────────
router.get('/trends-history', async (req, res) => {
    try {
        const { catalogId, status } = req.query;
        const conds = [], params = [];
        let idx = 1;
        if (catalogId) { conds.push(`catalog_id = $${idx++}`); params.push(catalogId); }
        if (status)    { conds.push(`status = $${idx++}`);     params.push(status); }
        const r = await pool.query(
            `SELECT * FROM trend_proposals ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
             ORDER BY created_at DESC LIMIT 100`,
            params
        );
        res.json({ success: true, proposals: r.rows });
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

router.get('/settings/:catalogId', async (req, res) => {
    try {
        await pool.query(
            'INSERT INTO catalog_settings (catalog_id) VALUES ($1) ON CONFLICT DO NOTHING',
            [req.params.catalogId]
        );
        const r = await pool.query('SELECT * FROM catalog_settings WHERE catalog_id = $1', [req.params.catalogId]);
        res.json({ success: true, settings: r.rows[0] });
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

router.put('/settings/:catalogId', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { autoEnabled, trendFrequency, trendRegion } = req.body;
        const sets = ['updated_at = NOW()'], vals = [];
        let idx = 1;
        if (autoEnabled !== undefined)  { sets.push(`auto_enabled = $${idx++}`);    vals.push(autoEnabled); }
        if (trendFrequency)             { sets.push(`trend_frequency = $${idx++}`); vals.push(trendFrequency); }
        if (trendRegion)                { sets.push(`trend_region = $${idx++}`);    vals.push(trendRegion); }
        vals.push(req.params.catalogId);
        await pool.query('INSERT INTO catalog_settings (catalog_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.params.catalogId]);
        await pool.query(`UPDATE catalog_settings SET ${sets.join(', ')} WHERE catalog_id = $${idx}`, vals);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

router.post('/analyze-trends', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { catalogId = 'pinyata', region = 'Київ' } = req.body;
        const catRow = await pool.query('SELECT name FROM catalog_definitions WHERE id = $1', [catalogId]);
        const catName = catRow.rows[0]?.name || catalogId;
        const prompt = `Які дитячі теми/персонажі/тренди найпопулярніші в Україні для дітей 3-12 років?
Мультфільми, ігри, TikTok тренди ${new Date().getFullYear()} року. Регіон: ${region}.
Категорія для дитячого парку розваг: ${catName}.
ТІЛЬКИ JSON без пояснень:
[{"name":"Назва","reason":"чому популярно","suggestedPrice":600,"imagePrompt":"short english prompt"}]`;
        const aiResult = await callUnifiedChatCompletion({
            scope: 'chat_ai',
            title: 'Event Genix Catalog Trend Analysis',
            model: process.env.CATALOG_TREND_MODEL || 'google/gemini-flash-1.5',
            systemPrompt: 'Return only valid compact JSON for catalog trend proposals. Do not wrap the response in markdown.',
            userMessage: prompt,
            maxTokens: 600
        });
        if (!aiResult.ok) return res.status(503).json({ error: 'OpenRouter API key not configured' });
        const content = aiResult.text || '[]';
        let trends = [];
        try { trends = JSON.parse(content.replace(/```json|```/g, '').trim()); } catch { trends = []; }
        if (!Array.isArray(trends)) trends = [];
        const inserted = [];
        for (const t of trends.slice(0, 5)) {
            if (!t.name) continue;
            const r = await pool.query(
                `INSERT INTO trend_proposals (catalog_id, trend_name, proposal, suggested_price, image_prompt)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [catalogId, t.name, t.reason || '', t.suggestedPrice || null, t.imagePrompt || '']
            );
            inserted.push(r.rows[0]);
        }
        await pool.query('UPDATE catalog_settings SET last_trend_check = NOW() WHERE catalog_id = $1', [catalogId]);
        res.json({ success: true, trends: inserted });
    } catch (err) {
        log.error('POST /analyze-trends error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.patch('/trend/:id', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { status, generatedItemId } = req.body;
        if (!['approved', 'rejected'].includes(status))
            return res.status(400).json({ error: 'approved або rejected' });
        await pool.query(
            `UPDATE trend_proposals SET status = $1, resolved_at = NOW(), resolved_by = $2, generated_item_id = $3 WHERE id = $4`,
            [status, req.user.username, generatedItemId || null, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════
// CATALOG DEFINITION — update & delete (v38.14)
// ═══════════════════════════════════════════════

// PUT /api/catalogs/:id — update catalog definition (cover image, etc.)
router.put('/:id', requireRole('admin', 'creator', 'director'), async (req, res) => {
    const { name, description, emoji, ai_style, background_url, cover_url, image_url, is_active } = req.body;
    try {
        const sets = [];
        const vals = [];
        let n = 1;
        if (name !== undefined) { sets.push(`name = $${n++}`); vals.push(name); }
        if (description !== undefined) { sets.push(`description = $${n++}`); vals.push(description); }
        if (emoji !== undefined) { sets.push(`emoji = $${n++}`); vals.push(emoji); }
        if (ai_style !== undefined) { sets.push(`ai_style = $${n++}`); vals.push(ai_style); }
        if (is_active !== undefined) { sets.push(`is_active = $${n++}`); vals.push(is_active); }
        // Support cover/background image via metadata or direct columns
        if (background_url !== undefined || cover_url !== undefined || image_url !== undefined) {
            const imgUrl = background_url || cover_url || image_url;
            sets.push(`description = COALESCE(description, '') || ''`);
            // Store in ai_style as fallback since catalog_definitions has no image column
            // The cover page (page_number=0) should be used for cover images instead
        }
        if (sets.length === 0) return res.json({ success: true });
        vals.push(req.params.id);
        const result = await pool.query(
            `UPDATE catalog_definitions SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`, vals
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Каталог не знайдено' });
        res.json({ success: true, catalog: result.rows[0] });
    } catch (err) {
        log.error('PUT /:id error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/catalogs/:id — delete catalog and all its pages
router.delete('/:id', requireRole('admin', 'creator', 'director'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM catalog_pages WHERE catalog_id = $1', [req.params.id]);
        await client.query('DELETE FROM catalog_items WHERE catalog_id = $1', [req.params.id]);
        await client.query('DELETE FROM catalog_subcategories WHERE catalog_id = $1', [req.params.id]);
        await client.query('DELETE FROM catalog_settings WHERE catalog_id = $1', [req.params.id]);
        await client.query('DELETE FROM catalog_definitions WHERE id = $1', [req.params.id]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('DELETE /:id error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// ═══════════════════════════════════════════════
// CATALOG PAGES — HTML pages with images (v38.12)
// ═══════════════════════════════════════════════

// GET /api/catalogs/:catalogId/pages — all pages for catalog
router.get('/:catalogId/pages', async (req, res) => {
    try {
        const pages = await pool.query(
            'SELECT * FROM catalog_pages WHERE catalog_id = $1 AND is_active = true ORDER BY page_number',
            [req.params.catalogId]
        );
        res.json({ success: true, pages: pages.rows });
    } catch (err) {
        log.error('GET /pages error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/catalogs/:catalogId/pages — create new page
router.post('/:catalogId/pages', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { title, subtitle, description, price, priceLabel, price_label, imageUrl, image_url, backgroundUrl, background_url, details, detail, product_id } = req.body;
        if (!title?.trim()) return res.status(400).json({ error: 'title required' });
        const maxPage = await pool.query(
            'SELECT COALESCE(MAX(page_number), -1) as max FROM catalog_pages WHERE catalog_id = $1',
            [req.params.catalogId]
        );
        const nextPage = maxPage.rows[0].max + 1;
        const r = await pool.query(
            `INSERT INTO catalog_pages (catalog_id, page_number, title, subtitle, description, price, price_label, image_url, background_url, details)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [req.params.catalogId, nextPage, title.trim(), subtitle || null, description || null,
             price ? parseInt(price) : null, priceLabel || price_label || null,
             imageUrl || image_url || null, backgroundUrl || background_url || null,
             JSON.stringify(details || {})]
        );
        res.json({ success: true, page: r.rows[0] });
    } catch (err) {
        log.error('POST /pages error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/catalogs/:catalogId/pages/:pageNumber — update page (insert image!)
router.put('/:catalogId/pages/:pageNumber', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const { title, subtitle, description, price, priceLabel, price_label, imageUrl, image_url, backgroundUrl, background_url, details, detail, product_id } = req.body;
        const sets = [], vals = [req.params.catalogId, parseInt(req.params.pageNumber)];
        let idx = 3;
        if (title !== undefined) { sets.push(`title=$${idx++}`); vals.push(title); }
        if (subtitle !== undefined) { sets.push(`subtitle=$${idx++}`); vals.push(subtitle); }
        if (description !== undefined) { sets.push(`description=$${idx++}`); vals.push(description); }
        if (price !== undefined) { sets.push(`price=$${idx++}`); vals.push(price ? parseInt(price) : null); }
        const pl = priceLabel !== undefined ? priceLabel : price_label;
        if (pl !== undefined) { sets.push(`price_label=$${idx++}`); vals.push(pl); }
        const iu = imageUrl !== undefined ? imageUrl : image_url;
        if (iu !== undefined) { sets.push(`image_url=$${idx++}`); vals.push(iu); }
        const bu = backgroundUrl !== undefined ? backgroundUrl : background_url;
        if (bu !== undefined) { sets.push(`background_url=$${idx++}`); vals.push(bu); }
        if (details !== undefined) { sets.push(`details=$${idx++}`); vals.push(JSON.stringify(details)); }
        const it = req.body.items;
        if (it !== undefined) { sets.push(`items=$${idx++}`); vals.push(JSON.stringify(it)); }
        if (req.body.theme !== undefined) { sets.push(`theme=$${idx++}`); vals.push(req.body.theme); }
        if (req.body.reference_url !== undefined) { sets.push(`reference_url=$${idx++}`); vals.push(req.body.reference_url); }
        if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
        sets.push('updated_at=NOW()');
        const r = await pool.query(
            `UPDATE catalog_pages SET ${sets.join(',')} WHERE catalog_id=$1 AND page_number=$2 RETURNING *`, vals
        );
        if (!r.rowCount) return res.status(404).json({ error: 'Page not found' });
        // Save version history (fire-and-forget)
        const updated = r.rows[0];
        pool.query(
            `INSERT INTO catalog_page_history (catalog_page_id, version, title, subtitle, description, price_label, image_url, items, theme, details, changed_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [updated.id, (updated.version || 1), updated.title, updated.subtitle, updated.description, updated.price_label, updated.image_url,
             JSON.stringify(updated.items || []), updated.theme, JSON.stringify(updated.details || {}), req.user?.username || 'unknown']
        ).catch(() => {});
        // Increment version
        pool.query('UPDATE catalog_pages SET version = COALESCE(version,1) + 1 WHERE id = $1', [updated.id]).catch(() => {});
        res.json({ success: true, page: updated });
    } catch (err) {
        log.error('PUT /pages error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/catalogs/:catalogId/pages/:pageNumber
router.delete('/:catalogId/pages/:pageNumber', requireRole('admin', 'creator', 'director'), async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM catalog_pages WHERE catalog_id=$1 AND page_number=$2',
            [req.params.catalogId, parseInt(req.params.pageNumber)]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /pages error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/catalogs/:catalogId/reorder — swap two page numbers
router.post('/:catalogId/reorder', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { from, to } = req.body;
        const catalogId = req.params.catalogId;
        if (from === undefined || to === undefined) return res.status(400).json({ error: 'from and to required' });
        const fromNum = parseInt(from);
        const toNum = parseInt(to);
        await client.query('BEGIN');
        // Swap: from→temp(-1), to→from, temp→to
        await client.query('UPDATE catalog_pages SET page_number = -1 WHERE catalog_id=$1 AND page_number=$2', [catalogId, fromNum]);
        await client.query('UPDATE catalog_pages SET page_number = $1 WHERE catalog_id=$2 AND page_number=$3', [fromNum, catalogId, toNum]);
        await client.query('UPDATE catalog_pages SET page_number = $1 WHERE catalog_id=$2 AND page_number=-1', [toNum, catalogId]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('POST /reorder error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/catalogs/:catalogId/public-link — generate public sharing token
router.post('/:catalogId/public-link', requireRole('admin', 'creator', 'director', 'manager'), async (req, res) => {
    try {
        const catalogId = req.params.catalogId;
        const crypto = require('crypto');
        const token = crypto.randomBytes(16).toString('hex');
        await pool.query('UPDATE catalog_definitions SET public_token=$1 WHERE id=$2', [token, catalogId]);
        res.json({ success: true, token, url: `/catalog/${catalogId}/${token}` });
    } catch (err) {
        log.error('POST /public-link error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/catalogs/:catalogId/pages/:pageNumber/duplicate — duplicate a page
router.post('/:catalogId/pages/:pageNumber/duplicate', requireRole('admin', 'creator', 'director', 'art_director', 'manager'), async (req, res) => {
    try {
        const catalogId = req.params.catalogId;
        const pageNumber = parseInt(req.params.pageNumber);
        // Get source page
        const src = await pool.query('SELECT * FROM catalog_pages WHERE catalog_id=$1 AND page_number=$2', [catalogId, pageNumber]);
        if (!src.rowCount) return res.status(404).json({ error: 'Page not found' });
        // Find next page number
        const maxR = await pool.query('SELECT COALESCE(MAX(page_number),0) as mx FROM catalog_pages WHERE catalog_id=$1', [catalogId]);
        const newNum = (maxR.rows[0].mx || 0) + 1;
        const p = src.rows[0];
        const r = await pool.query(
            `INSERT INTO catalog_pages (catalog_id, page_number, title, subtitle, description, price, price_label, image_url, background_url, details, items, theme, reference_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [catalogId, newNum, (p.title || '') + ' (копія)', p.subtitle, p.description, p.price, p.price_label, p.image_url, p.background_url,
             JSON.stringify(p.details || {}), JSON.stringify(p.items || []), p.theme, p.reference_url]
        );
        res.json({ success: true, page: r.rows[0] });
    } catch (err) {
        log.error('POST /duplicate error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── Automations CRUD ──────────────────────────────
// GET /api/catalogs/:catalogId/automations
router.get('/:catalogId/automations', authenticateToken, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM catalog_automations WHERE catalog_id=$1 AND is_active=true ORDER BY created_at', [req.params.catalogId]);
        res.json({ success: true, automations: r.rows });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/catalogs/:catalogId/automations
router.post('/:catalogId/automations', requireRole('admin', 'creator', 'director', 'manager'), async (req, res) => {
    try {
        const { name, description, triggerType, assignedRole } = req.body;
        if (!name) return res.status(400).json({ error: 'name required' });
        const r = await pool.query(
            'INSERT INTO catalog_automations (catalog_id, name, description, trigger_type, assigned_role) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            [req.params.catalogId, name, description || null, triggerType || 'manual', assignedRole || 'admin']
        );
        res.json({ success: true, automation: r.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/catalogs/:catalogId/automations/:id/run — create task from automation
router.post('/:catalogId/automations/:id/run', requireRole('admin', 'creator', 'director', 'manager'), async (req, res) => {
    try {
        const auto = await pool.query('SELECT * FROM catalog_automations WHERE id=$1 AND catalog_id=$2', [req.params.id, req.params.catalogId]);
        if (!auto.rowCount) return res.status(404).json({ error: 'Automation not found' });
        const a = auto.rows[0];
        const task = await getKleshnya().createTask({
            title: a.name,
            description: a.description || `Автозадача з каталогу ${req.params.catalogId}`,
            category: 'admin',
            priority: 'normal',
            owner_role: a.assigned_role || 'admin',
            created_by: req.user?.username || 'system',
            source_type: 'catalog_automation',
            source_id: String(a.id),
            source_entity_type: 'catalog',
            source_entity_id: String(req.params.catalogId),
            duplicateMode: 'skip'
        });
        res.json({ success: true, taskId: task.id, duplicateSkipped: !!task.duplicateSkipped });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/catalogs/:catalogId/automations/:id
router.delete('/:catalogId/automations/:id', requireRole('admin', 'creator', 'director'), async (req, res) => {
    try {
        await pool.query('UPDATE catalog_automations SET is_active=false WHERE id=$1 AND catalog_id=$2', [req.params.id, req.params.catalogId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Bulk image generation ──────────────────────────────
// POST /api/catalogs/:catalogId/bulk-generate-images
router.post('/:catalogId/bulk-generate-images', requireRole('admin', 'creator', 'director', 'art_director'), async (req, res) => {
    try {
        const pages = await pool.query(
            "SELECT * FROM catalog_pages WHERE catalog_id=$1 AND is_active=true AND (image_url IS NULL OR image_url='') AND page_number > 0 ORDER BY page_number",
            [req.params.catalogId]
        );
        if (!pages.rowCount) return res.json({ success: true, started: 0, message: 'Всі сторінки вже мають фото' });
        // ai_style from DB = single source of truth for catalog context
        const catDef = await pool.query('SELECT ai_style FROM catalog_definitions WHERE id=$1', [req.params.catalogId]);
        const aiStyle = catDef.rows[0]?.ai_style || DEFAULT_AI_STYLE;
        const tasks = [];
        const _tr = {'а':'a','б':'b','в':'v','г':'h','ґ':'g','д':'d','е':'e','є':'ye','ж':'zh','з':'z','и':'y','і':'i','ї':'yi','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ь':'','ю':'yu','я':'ya',' ':' ',"'":''};
        const tl = (s) => (s||'').split('').map(c => _tr[c.toLowerCase()] !== undefined ? _tr[c.toLowerCase()] : c).join('');
        for (const page of pages.rows) {
            const enTitle = tl(page.title);
            const enSub = tl(page.subtitle);
            const enDesc = tl((page.description || '').slice(0, 100));
            const prompt = `${aiStyle}. Product: "${enTitle}"${enSub ? ', ' + enSub : ''}${enDesc ? '. ' + enDesc : ''}. Studio lighting, clean white background, centered, no text, 4K`;
            try {
                const r = await kieRequest('POST', '/api/v1/jobs/createTask', {
                    model: 'nano-banana-2',
                    input: { prompt, aspect_ratio: '1:1', resolution: '1K', output_format: 'png' }
                });
                if (r?.data?.taskId) tasks.push({ pageNumber: page.page_number, taskId: r.data.taskId, title: page.title });
            } catch (e) { /* skip failed */ }
        }
        res.json({ success: true, started: tasks.length, total: pages.rowCount, tasks });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Page version history ──────────────────────────────
// GET /api/catalogs/:catalogId/pages/:pageNumber/history
router.get('/:catalogId/pages/:pageNumber/history', authenticateToken, async (req, res) => {
    try {
        const page = await pool.query('SELECT id FROM catalog_pages WHERE catalog_id=$1 AND page_number=$2', [req.params.catalogId, parseInt(req.params.pageNumber)]);
        if (!page.rowCount) return res.status(404).json({ error: 'Page not found' });
        const h = await pool.query('SELECT * FROM catalog_page_history WHERE catalog_page_id=$1 ORDER BY version DESC LIMIT 20', [page.rows[0].id]);
        res.json({ success: true, history: h.rows });
    } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
