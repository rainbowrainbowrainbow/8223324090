/**
 * routes/leads.js — Leads (hot prospects) API
 * v20.7.0: Lead tracking, follow-up alerts
 * v20.9.13: Full CRUD with booking_id, instagram, source, lost_reason
 *
 * Endpoints:
 *   GET    /api/leads           — list leads (with filters)
 *   GET    /api/leads/hot       — leads needing attention (24h+ without response)
 *   GET    /api/leads/stats     — funnel stats
 *   POST   /api/leads           — create lead
 *   PATCH  /api/leads/:id       — update lead status/fields
 *   DELETE /api/leads/:id       — delete lead
 */
const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { notifyNewLead } = require('../services/leadNotifier');
const { broadcast } = require('../services/websocket');

const log = createLogger('Leads');

const UNIVERSAL_WEBHOOK_TOKEN = process.env.UNIVERSAL_WEBHOOK_TOKEN || '';
const FB_VERIFY_TOKEN         = process.env.FB_VERIFY_TOKEN         || '';
const FB_PAGE_ACCESS_TOKEN    = process.env.FB_PAGE_ACCESS_TOKEN    || '';
const VIBER_AUTH_TOKEN        = process.env.VIBER_AUTH_TOKEN        || '';

// POST /api/leads/landing — public endpoint for landing page form (no auth required)
router.post('/landing', async (req, res) => {
    try {
        const { name, phone, package: pkg } = req.body;
        if (!name && !phone) {
            return res.status(400).json({ success: false, error: 'Ім\'я або телефон обов\'язкові' });
        }
        const notes = pkg ? `Пакет: ${pkg}` : 'Заявка з лендінгу';
        const result = await pool.query(`
            INSERT INTO leads (client_name, phone, source, notes, status)
            VALUES ($1, $2, 'landing', $3, 'new')
            RETURNING id, client_name, phone, source, status, created_at
        `, [name || 'Невідомий', phone || null, notes]);

        const lead = result.rows[0];
        log.info(`Landing lead created: ${lead.client_name} (${lead.phone})`);

        // Notify via lead notifier if available
        try {
            if (typeof notifyNewLead === 'function') {
                await notifyNewLead(lead);
            }
        } catch (e) { /* non-blocking */ }

        // Broadcast to dashboard via WebSocket
        try { broadcast('lead:new', { lead }); } catch (e) { /* non-blocking */ }

        res.json({ success: true, lead: { id: lead.id } });
    } catch (err) {
        log.error('POST /leads/landing error', err);
        res.status(500).json({ success: false, error: 'Помилка збереження заявки' });
    }
});

// GET /api/leads — list all leads with optional filters
router.get('/', async (req, res) => {
    try {
        const { status, assigned_to, source, limit: lim, search, pipeline_stage } = req.query;
        const conditions = [];
        const params = [];

        if (pipeline_stage) {
            params.push(pipeline_stage);
            conditions.push(`l.pipeline_stage = $${params.length}`);
        }
        if (status) {
            params.push(status);
            conditions.push(`l.status = $${params.length}`);
        }
        if (assigned_to) {
            const assignedId = parseInt(assigned_to);
            if (isNaN(assignedId)) {
                return res.status(400).json({ success: false, error: 'assigned_to повинен бути числом' });
            }
            params.push(assignedId);
            conditions.push(`l.assigned_to = $${params.length}`);
        }
        if (source) {
            params.push(source);
            conditions.push(`l.source = $${params.length}`);
        }
        if (search) {
            const pattern = `%${search}%`;
            params.push(pattern);
            conditions.push(`(l.client_name ILIKE $${params.length} OR l.phone ILIKE $${params.length} OR l.instagram ILIKE $${params.length})`);
        }

        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const limitVal = Math.min(parseInt(lim) || 50, 200);
        params.push(limitVal);

        const result = await pool.query(`
            SELECT l.*, u.name AS assigned_name, p.label AS program_name
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            LEFT JOIN products p ON l.program_id = p.id
            ${where}
            ORDER BY l.created_at DESC
            LIMIT $${params.length}
        `, params);

        res.json({ success: true, leads: result.rows });
    } catch (err) {
        log.error('GET /leads error', err);
        res.status(500).json({ success: false, error: 'Помилка завантаження лідів' });
    }
});

// GET /api/leads/hot — leads that need attention (24h+ since creation, still 'new')
router.get('/hot', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT l.*, u.name AS assigned_name, p.label AS program_name,
                   EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 3600 AS hours_waiting
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            LEFT JOIN products p ON l.program_id = p.id
            WHERE l.status = 'new'
              AND l.created_at < NOW() - INTERVAL '24 hours'
            ORDER BY l.created_at ASC
            LIMIT 50
        `);
        res.json({ success: true, leads: result.rows });
    } catch (err) {
        log.error('GET /leads/hot error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// GET /api/leads/stats — funnel statistics
router.get('/stats', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT status, COUNT(*) AS count
            FROM leads
            GROUP BY status
        `);
        const stats = {};
        for (const r of result.rows) stats[r.status] = parseInt(r.count);
        const total = Object.values(stats).reduce((s, v) => s + v, 0);
        res.json({ success: true, stats, total });
    } catch (err) {
        log.error('GET /leads/stats error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// POST /api/leads — create new lead
router.post('/', async (req, res) => {
    try {
        const { client_name, phone, telegram_id, instagram, source, program_id, event_date, children_count, child_age, notes, assigned_to } = req.body;
        if (!client_name) {
            return res.status(400).json({ success: false, error: "Ім'я клієнта обов'язкове" });
        }
        const result = await pool.query(`
            INSERT INTO leads (client_name, phone, telegram_id, instagram, source, program_id, event_date, children_count, child_age, notes, assigned_to)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [client_name, phone || null, telegram_id || null, instagram || null, source || null,
            program_id || null, event_date || null,
            children_count || null, child_age || null, notes || null, assigned_to || null]);

        log.info(`Lead created: ${client_name} by ${req.user.username}`);

        // Broadcast to dashboard via WebSocket
        try { broadcast('lead:new', { lead: result.rows[0] }); } catch (e) { /* non-blocking */ }

        res.json({ success: true, lead: result.rows[0] });
    } catch (err) {
        log.error('POST /leads error', err);
        res.status(500).json({ success: false, error: 'Помилка створення ліду' });
    }
});

// PATCH /api/leads/:id — update lead
router.patch('/:id', async (req, res) => {
    try {
        const { status, notes, assigned_to, last_contact_at, booking_id, lost_reason, client_name, phone, instagram, source, event_date, children_count, child_age, program_id, pipeline_stage, milestone_tags } = req.body;
        const updates = [];
        const params = [];

        if (status) {
            params.push(status);
            updates.push(`status = $${params.length}`);
            if (status === 'booked') updates.push(`booked_at = NOW()`);
        }
        if (notes !== undefined) { params.push(notes); updates.push(`notes = $${params.length}`); }
        if (assigned_to !== undefined) { params.push(assigned_to); updates.push(`assigned_to = $${params.length}`); }
        if (booking_id !== undefined) { params.push(booking_id); updates.push(`booking_id = $${params.length}`); }
        if (lost_reason !== undefined) { params.push(lost_reason); updates.push(`lost_reason = $${params.length}`); }
        if (client_name !== undefined) { params.push(client_name); updates.push(`client_name = $${params.length}`); }
        if (phone !== undefined) { params.push(phone); updates.push(`phone = $${params.length}`); }
        if (instagram !== undefined) { params.push(instagram); updates.push(`instagram = $${params.length}`); }
        if (source !== undefined) { params.push(source); updates.push(`source = $${params.length}`); }
        if (event_date !== undefined) { params.push(event_date || null); updates.push(`event_date = $${params.length}`); }
        if (children_count !== undefined) { params.push(children_count); updates.push(`children_count = $${params.length}`); }
        if (child_age !== undefined) { params.push(child_age); updates.push(`child_age = $${params.length}`); }
        if (program_id !== undefined) { params.push(program_id || null); updates.push(`program_id = $${params.length}`); }
        if (pipeline_stage !== undefined) { params.push(pipeline_stage); updates.push(`pipeline_stage = $${params.length}`); }
        if (milestone_tags !== undefined) { params.push(milestone_tags); updates.push(`milestone_tags = $${params.length}`); }
        if (last_contact_at) {
            params.push(last_contact_at);
            updates.push(`last_contact_at = $${params.length}`);
        } else if (status === 'contact') {
            updates.push(`last_contact_at = COALESCE(last_contact_at, NOW())`);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'Немає полів для оновлення' });
        }

        params.push(parseInt(req.params.id));
        const result = await pool.query(
            `UPDATE leads SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
            params
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Лід не знайдено' });
        }
        res.json({ success: true, lead: result.rows[0] });
    } catch (err) {
        log.error('PATCH /leads/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка оновлення' });
    }
});

// GET /api/leads/pipeline — pipeline funnel by stages (v25.4.0)
router.get('/pipeline', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pipeline_stage, COUNT(*) AS count
            FROM leads
            WHERE status NOT IN ('closed', 'lost')
            GROUP BY pipeline_stage
            ORDER BY CASE pipeline_stage
                WHEN 'new' THEN 1 WHEN 'contacted' THEN 2 WHEN 'demo' THEN 3
                WHEN 'proposal' THEN 4 WHEN 'negotiation' THEN 5 WHEN 'won' THEN 6
                ELSE 7 END
        `);
        const stages = {};
        for (const r of result.rows) stages[r.pipeline_stage || 'new'] = parseInt(r.count);
        res.json({ success: true, pipeline: stages });
    } catch (err) {
        log.error('GET /leads/pipeline error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// DELETE /api/leads/:id
router.delete('/:id', async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM leads WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Лід не знайдено' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /leads/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка видалення' });
    }
});

// ============================================================
// v23.4.0: Lead Capture Webhooks
// ============================================================

/** Helper: create lead from webhook data, dedup by phone or external_id */
async function createLeadFromWebhook({ client_name, phone, telegram_id, instagram,
                                       notes, source_channel, external_id, raw_payload }) {
    // Dedup by phone
    if (phone) {
        const dup = await pool.query(
            `SELECT id FROM leads WHERE phone = $1 AND status NOT IN ('booked','closed','lost') LIMIT 1`,
            [phone]
        );
        if (dup.rows.length > 0) {
            await pool.query(
                `UPDATE leads
                   SET notes = COALESCE(notes,'') || E'\n[' || $1 || '] ' || COALESCE($2,''),
                       last_contact_at = NOW()
                 WHERE id = $3`,
                [source_channel, notes, dup.rows[0].id]
            );
            return null;
        }
    }

    const result = await pool.query(
        `INSERT INTO leads
           (client_name, phone, telegram_id, instagram,
            source, source_channel, external_id, notes, raw_payload, status)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,'new')
         ON CONFLICT (source_channel, external_id)
           WHERE external_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [
            client_name || null,
            phone       || null,
            telegram_id || null,
            instagram   || null,
            source_channel,
            external_id || null,
            notes       || null,
            raw_payload ? JSON.stringify(raw_payload) : null,
        ]
    );
    return result.rows[0] || null;
}

// POST /api/leads/webhook/universal?source=tiktok
// Auth: Authorization: Bearer UNIVERSAL_WEBHOOK_TOKEN
// Body: { name, phone, message?, instagram?, external_id? }
router.post('/webhook/universal', async (req, res) => {
    try {
        const auth = req.headers['authorization'] || '';
        if (!UNIVERSAL_WEBHOOK_TOKEN || auth !== `Bearer ${UNIVERSAL_WEBHOOK_TOKEN}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const source_channel = (req.query.source || 'universal').toLowerCase().slice(0, 50);
        const { name, phone, message, instagram, external_id } = req.body;

        if (!name && !phone) {
            return res.status(400).json({ error: "Потрібно 'name' або 'phone'" });
        }

        const lead = await createLeadFromWebhook({
            client_name:    name,
            phone,
            instagram,
            notes:          message,
            source_channel,
            external_id:    external_id || (phone ? `${source_channel}_${phone}` : null),
            raw_payload:    req.body,
        });

        if (lead) {
            notifyNewLead(lead).catch(() => {});
            try { broadcast('lead:new', { lead }); } catch (e) { /* ok */ }
            log.info(`New lead via universal [${source_channel}]: ${name || phone}`);
        }
        res.json({ success: true, created: !!lead });
    } catch (err) {
        log.error('Universal webhook error', err);
        res.status(500).json({ error: 'Internal error' });
    }
});

// GET /api/leads/webhook/facebook — Meta verification
router.get('/webhook/facebook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' &&
        req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
        log.info('Facebook webhook verified');
        return res.status(200).send(req.query['hub.challenge']);
    }
    res.sendStatus(403);
});

// POST /api/leads/webhook/facebook — Facebook Lead Ads
router.post('/webhook/facebook', async (req, res) => {
    res.sendStatus(200); // Meta expects fast response
    try {
        if (req.body.object !== 'page') return;

        for (const entry of (req.body.entry || [])) {
            for (const change of (entry.changes || [])) {
                if (change.field !== 'leadgen') continue;
                const leadgenId = change.value?.leadgen_id;
                if (!leadgenId || !FB_PAGE_ACCESS_TOKEN) continue;

                // Fetch lead data via Graph API
                const https = require('https');
                const fbData = await new Promise((resolve, reject) => {
                    const url = `https://graph.facebook.com/v21.0/${leadgenId}`;
                    const options = {
                        headers: { 'Authorization': `Bearer ${FB_PAGE_ACCESS_TOKEN}` }
                    };
                    https.get(url, options, (resp) => {
                        let data = '';
                        resp.on('data', c => data += c);
                        resp.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
                    }).on('error', reject);
                });

                const fields = Object.fromEntries(
                    (fbData.field_data || []).map(f => [f.name, f.values?.[0] || ''])
                );

                const lead = await createLeadFromWebhook({
                    client_name:    fields.full_name || fields.first_name || null,
                    phone:          fields.phone_number || null,
                    instagram:      fields.instagram || null,
                    notes:          `Facebook Lead Ad | ${fbData.ad_name || leadgenId}`,
                    source_channel: 'facebook',
                    external_id:    `fb_${leadgenId}`,
                    raw_payload:    fbData,
                });

                if (lead) {
                    notifyNewLead(lead).catch(() => {});
                    try { broadcast('lead:new', { lead }); } catch (e) { /* ok */ }
                    log.info(`New FB lead: ${lead.client_name}`);
                }
            }
        }
    } catch (err) {
        log.error('Facebook webhook processing error', err);
    }
});

// GET /api/leads/webhook/instagram — Meta verification (same token as FB)
router.get('/webhook/instagram', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' &&
        req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
        log.info('Instagram webhook verified');
        return res.status(200).send(req.query['hub.challenge']);
    }
    res.sendStatus(403);
});

// POST /api/leads/webhook/instagram — Instagram DM / Lead Ads
router.post('/webhook/instagram', async (req, res) => {
    res.sendStatus(200);
    try {
        for (const entry of (req.body.entry || [])) {
            for (const messaging of (entry.messaging || [])) {
                const senderId = messaging.sender?.id;
                const text     = messaging.message?.text;
                if (!senderId || !text) continue;

                const lead = await createLeadFromWebhook({
                    client_name:    `IG_${senderId}`,
                    notes:          text.slice(0, 500),
                    source_channel: 'instagram',
                    external_id:    `ig_${senderId}`,
                    raw_payload:    messaging,
                });

                if (lead) {
                    notifyNewLead(lead).catch(() => {});
                    try { broadcast('lead:new', { lead }); } catch (e) { /* ok */ }
                    log.info(`New IG lead: ig_${senderId}`);
                }
            }
        }
    } catch (err) {
        log.error('Instagram webhook error', err);
    }
});

// POST /api/leads/webhook/viber — Viber Business Messages
router.post('/webhook/viber', async (req, res) => {
    try {
        // Signature verification
        if (VIBER_AUTH_TOKEN) {
            const sig = req.headers['x-viber-content-signature'] || '';
            const bodyStr = JSON.stringify(req.body);
            const expected = crypto
                .createHmac('sha256', VIBER_AUTH_TOKEN)
                .update(bodyStr)
                .digest('hex');
            const sigBuf = Buffer.from(sig, 'hex');
            const expBuf = Buffer.from(expected, 'hex');
            if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
                return res.status(401).json({ error: 'Invalid signature' });
            }
        }

        res.sendStatus(200);

        const { event, sender, message } = req.body;
        if (!['message', 'conversation_started'].includes(event)) return;

        const lead = await createLeadFromWebhook({
            client_name:    sender?.name || `Viber_${sender?.id}`,
            notes:          message?.text?.slice(0, 500) || 'Нове звернення через Viber',
            source_channel: 'viber',
            external_id:    `viber_${sender?.id}`,
            raw_payload:    req.body,
        });

        if (lead) {
            notifyNewLead(lead).catch(() => {});
            try { broadcast('lead:new', { lead }); } catch (e) { /* ok */ }
            log.info(`New Viber lead: ${sender?.name}`);
        }
    } catch (err) {
        log.error('Viber webhook error', err);
    }
});

// GET /api/leads/webhook/status — webhook configuration status
router.get('/webhook/status', (req, res) => {
    res.json({
        success: true,
        webhooks: {
            telegram:  { configured: true, note: 'Built into /api/telegram/webhook (private chats)' },
            facebook:  { configured: !!FB_PAGE_ACCESS_TOKEN, endpoint: '/api/leads/webhook/facebook'  },
            instagram: { configured: !!FB_PAGE_ACCESS_TOKEN, endpoint: '/api/leads/webhook/instagram' },
            viber:     { configured: !!VIBER_AUTH_TOKEN,     endpoint: '/api/leads/webhook/viber'     },
            universal: {
                configured: !!UNIVERSAL_WEBHOOK_TOKEN,
                endpoint:   '/api/leads/webhook/universal?source=<name>',
                sources:    ['tiktok', 'turbo', 'bnderoga', 'custom'],
            }
        }
    });
});

module.exports = router;
