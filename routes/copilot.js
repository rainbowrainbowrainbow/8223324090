/**
 * routes/copilot.js — Manager AI Copilot API
 * v27.0.0 | 2026-03-13 | Клешня 🦞
 *
 * Endpoints:
 *   POST /api/copilot/coach          — AI Live Coach підказки
 *   POST /api/copilot/objection      — AI відповідь на заперечення
 *   POST /api/copilot/debrief        — AI аналіз дзвінка
 *   POST /api/copilot/debrief/save   — зберегти дебрифінг
 *   GET  /api/copilot/debrief/stats  — статистика менеджера
 *   POST /api/copilot/feedback       — 👍/👎 на підказку
 *   POST /api/copilot/sales-qa       — Q&A з бази знань
 *   POST /api/copilot/meeting-prep   — бриф перед дзвінком
 *   GET  /api/copilot/pipeline/stats — аналітика воронки
 *   POST /api/copilot/write-message  — AI Message Writer
 *   GET  /api/copilot/interactions   — стрічка взаємодій
 *   GET  /api/copilot/interactions/lead/:id — таймлайн по ліду
 *   POST /api/copilot/interactions   — додати взаємодію вручну
 *   PATCH /api/copilot/interactions/:id/followup — позначити виконаним
 *   GET  /api/copilot/interactions/alerts — ліди без контакту
 *   GET  /api/copilot/interactions/stats  — аналітика команди
 */

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const {
    openRouterChat,
    buildCoachPrompt,
    buildDebriefPrompt,
    buildMeetingPrepPrompt,
    buildMessageWriterPrompt,
    buildSalesQAPrompt,
    buildObjectionPrompt
} = require('../services/copilot');

const log = createLogger('Copilot');

// Roles with access
const MANAGER_ROLES = ['creator', 'director', 'senior_manager', 'manager'];

// Rate limit: 15 req/min per user on AI endpoints
const rateLimitAI = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    keyGenerator: (req) => String(req.user?.id || 'anon'),
    message: { error: 'Забагато запитів. Зачекайте хвилину.' },
    standardHeaders: false,
    legacyHeaders: false,
    validate: { ipv6SubnetOrKeyGenerator: false }
});

// All routes require manager+ role
router.use(requireRole(...MANAGER_ROLES));

// Load static data files with cache
const dataCache = {};
function loadData(filename) {
    if (!dataCache[filename]) {
        const filePath = path.join(__dirname, '..', 'data', filename);
        try {
            dataCache[filename] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            log.warn(`Could not load data file: ${filename}`);
            dataCache[filename] = null;
        }
    }
    return dataCache[filename];
}

/**
 * Parse JSON from AI response (handle markdown code blocks)
 */
function parseAIJson(text) {
    const cleaned = text.replace(/^```(?:json)?\n?/gm, '').replace(/```$/gm, '').trim();
    return JSON.parse(cleaned);
}

// ─── MODULE 1: AI Live Coach ───────────────────────────────────────────────

// POST /api/copilot/coach
router.post('/coach', rateLimitAI, async (req, res) => {
    try {
        const { clientText, scenario = 'first-call', tone = 'confident', sessionHistory = [] } = req.body;

        if (!clientText?.trim()) {
            return res.status(400).json({ error: 'Текст клієнта обов\'язковий' });
        }

        const systemPrompt = buildCoachPrompt(scenario, tone);
        const messages = [
            ...sessionHistory.slice(-6),
            { role: 'user', content: `Клієнт сказав: "${clientText}"` }
        ];

        const raw = await openRouterChat({
            system: systemPrompt,
            messages,
            temperature: 0.7,
            max_tokens: 900
        });

        let parsed;
        try {
            parsed = parseAIJson(raw);
        } catch (e) {
            log.warn('Failed to parse coach response as JSON', e.message);
            parsed = {
                suggestions: [
                    { type: 'neutral', text: raw.substring(0, 200) },
                    { type: 'confident', text: 'Давайте розглянемо це детальніше...' },
                    { type: 'empathy', text: 'Розумію ваше питання...' }
                ],
                tactic: 'Загальна відповідь',
                avoid: ['Не тиснути на клієнта'],
                nextStep: 'Уточнити деталі'
            };
        }

        res.json({ success: true, ...parsed });
    } catch (err) {
        log.error('POST /copilot/coach error', err);
        res.status(500).json({ error: 'Помилка AI сервісу: ' + err.message });
    }
});

// ─── MODULE 2: Objection Handler ──────────────────────────────────────────

// POST /api/copilot/objection
router.post('/objection', rateLimitAI, async (req, res) => {
    try {
        const { objectionText } = req.body;
        if (!objectionText?.trim()) {
            return res.status(400).json({ error: 'Текст заперечення обов\'язковий' });
        }

        const systemPrompt = buildObjectionPrompt(objectionText);
        const raw = await openRouterChat({
            messages: [{ role: 'user', content: `Заперечення: "${objectionText}"` }],
            system: systemPrompt,
            temperature: 0.7,
            max_tokens: 700
        });

        let parsed;
        try {
            parsed = parseAIJson(raw);
        } catch (e) {
            parsed = { responses: [{ type: 'main', label: 'Відповідь', text: raw }], nextStep: '' };
        }

        res.json({ success: true, ...parsed });
    } catch (err) {
        log.error('POST /copilot/objection error', err);
        res.status(500).json({ error: 'Помилка AI: ' + err.message });
    }
});

// ─── MODULE 5: Call Debrief ────────────────────────────────────────────────

// POST /api/copilot/debrief — AI analysis
router.post('/debrief', rateLimitAI, async (req, res) => {
    try {
        const { clientName, callResult, durationMin, notes, mainObjection, whatWorked, whatImprove } = req.body;

        if (!notes?.trim()) {
            return res.status(400).json({ error: 'Нотатки про дзвінок обов\'язкові' });
        }

        const systemPrompt = buildDebriefPrompt({ clientName, callResult, durationMin, notes, mainObjection, whatWorked, whatImprove });
        const raw = await openRouterChat({
            messages: [{ role: 'user', content: 'Проаналізуй дзвінок.' }],
            system: systemPrompt,
            temperature: 0.5,
            max_tokens: 600
        });

        let parsed;
        try {
            parsed = parseAIJson(raw);
        } catch (e) {
            parsed = { score: 7, good: ['Проведено дзвінок'], improve: ['Деталізувати записи'], nextStep: 'Надіслати follow-up' };
        }

        res.json({ success: true, ...parsed });
    } catch (err) {
        log.error('POST /copilot/debrief error', err);
        res.status(500).json({ error: 'Помилка AI: ' + err.message });
    }
});

// POST /api/copilot/debrief/save — save to DB
router.post('/debrief/save', async (req, res) => {
    try {
        const { clientName, callResult, durationMin, notes, mainObjection, whatWorked, whatImprove, aiScore, aiAnalysis, nextStep, leadId, followUpDate } = req.body;

        const result = await pool.query(`
            INSERT INTO call_debriefs
              (user_id, client_name, call_result, duration_min, notes, main_objection, what_worked, what_improve, ai_score, ai_analysis, next_step)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            RETURNING id, created_at
        `, [req.user.id, clientName, callResult, durationMin, notes, mainObjection, whatWorked, whatImprove, aiScore, JSON.stringify(aiAnalysis || {}), nextStep]);

        // Log interaction if leadId provided
        if (leadId) {
            await pool.query(`
                INSERT INTO lead_interactions (lead_id, user_id, type, summary, details, follow_up_date)
                VALUES ($1, $2, 'debrief', $3, $4, $5)
            `, [leadId, req.user.id, `Дзвінок: ${callResult} | Score: ${aiScore}/10`, JSON.stringify({ score: aiScore, result: callResult, debrief_id: result.rows[0].id }), followUpDate || null]);
        }

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        log.error('POST /copilot/debrief/save error', err);
        res.status(500).json({ error: 'Помилка збереження: ' + err.message });
    }
});

// GET /api/copilot/debrief/stats
router.get('/debrief/stats', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*)::int as total,
                ROUND(AVG(ai_score), 1) as avg_score,
                COUNT(CASE WHEN call_result = 'hot' THEN 1 END)::int as hot,
                COUNT(CASE WHEN call_result = 'interested' THEN 1 END)::int as interested,
                COUNT(CASE WHEN call_result = 'callback' THEN 1 END)::int as callback,
                COUNT(CASE WHEN call_result = 'rejected' THEN 1 END)::int as rejected,
                MAX(created_at) as last_debrief
            FROM call_debriefs
            WHERE user_id = $1
        `, [req.user.id]);

        const weekly = await pool.query(`
            SELECT
                DATE_TRUNC('week', created_at) as week,
                ROUND(AVG(ai_score), 1) as avg_score,
                COUNT(*)::int as count
            FROM call_debriefs
            WHERE user_id = $1 AND created_at > NOW() - INTERVAL '8 weeks'
            GROUP BY 1 ORDER BY 1
        `, [req.user.id]);

        res.json({ success: true, stats: result.rows[0], weekly: weekly.rows });
    } catch (err) {
        log.error('GET /copilot/debrief/stats error', err);
        res.status(500).json({ error: 'Помилка статистики' });
    }
});

// ─── MODULE 1 Feedback ────────────────────────────────────────────────────

// POST /api/copilot/feedback
router.post('/feedback', async (req, res) => {
    try {
        const { scenario, clientText, suggestion, rating } = req.body;
        if (![1, -1].includes(rating)) {
            return res.status(400).json({ error: 'Rating must be 1 or -1' });
        }

        await pool.query(`
            INSERT INTO manager_feedback (user_id, scenario, client_text, suggestion, rating)
            VALUES ($1, $2, $3, $4, $5)
        `, [req.user.id, scenario, clientText, suggestion, rating]);

        res.json({ success: true });
    } catch (err) {
        log.error('POST /copilot/feedback error', err);
        res.status(500).json({ error: 'Помилка збереження feedback' });
    }
});

// ─── MODULE 6: Sales Q&A ──────────────────────────────────────────────────

// POST /api/copilot/sales-qa
router.post('/sales-qa', rateLimitAI, async (req, res) => {
    try {
        const { question, category = 'all' } = req.body;
        if (!question?.trim()) {
            return res.status(400).json({ error: 'Питання обов\'язкове' });
        }

        const academy = loadData('sales-academy.json');
        const methodology = loadData('sales-methodology.json');
        const profiles = loadData('buyer-profiles.json');

        const systemPrompt = buildSalesQAPrompt(
            category === 'all' ? academy : (academy?.sections?.find(s => s.id === category) || academy),
            methodology,
            profiles
        );

        const raw = await openRouterChat({
            system: systemPrompt,
            messages: [{ role: 'user', content: question }],
            temperature: 0.6,
            max_tokens: 700
        });

        res.json({ success: true, answer: raw });
    } catch (err) {
        log.error('POST /copilot/sales-qa error', err);
        res.status(500).json({ error: 'Помилка AI: ' + err.message });
    }
});

// ─── MODULE 9: Meeting Prep ────────────────────────────────────────────────

// POST /api/copilot/meeting-prep
router.post('/meeting-prep', rateLimitAI, async (req, res) => {
    try {
        const { clientName, source, businessSize, notes, package: pkg, previousContact, callType, leadId } = req.body;

        if (!clientName?.trim()) {
            return res.status(400).json({ error: 'Ім\'я клієнта обов\'язкове' });
        }

        const systemPrompt = buildMeetingPrepPrompt({
            clientName, source, businessSize, notes,
            package: pkg, previousContact, callType
        });

        const raw = await openRouterChat({
            messages: [{ role: 'user', content: 'Підготуй бриф для дзвінка.' }],
            system: systemPrompt,
            temperature: 0.6,
            max_tokens: 800
        });

        let parsed;
        try {
            parsed = parseAIJson(raw);
        } catch (e) {
            parsed = { focus: raw.substring(0, 200), killerQuestions: [], likelyObjections: [] };
        }

        // Log as meeting_prep interaction if leadId provided
        if (leadId) {
            await pool.query(`
                INSERT INTO lead_interactions (lead_id, user_id, type, summary, details)
                VALUES ($1, $2, 'meeting_prep', $3, $4)
            `, [leadId, req.user.id, `Підготовка до дзвінка: ${callType}`, JSON.stringify(parsed)]);
        }

        res.json({ success: true, brief: parsed });
    } catch (err) {
        log.error('POST /copilot/meeting-prep error', err);
        res.status(500).json({ error: 'Помилка AI: ' + err.message });
    }
});

// ─── MODULE 10: Pipeline Stats ────────────────────────────────────────────

// GET /api/copilot/pipeline/stats
router.get('/pipeline/stats', async (req, res) => {
    try {
        const { managerId } = req.query;
        const isDirector = ['creator', 'director', 'senior_manager'].includes(req.user.role);

        let whereClause = '';
        let params = [];

        if (!isDirector) {
            whereClause = 'WHERE l.assigned_to = $1';
            params = [req.user.id];
        } else if (managerId) {
            whereClause = 'WHERE l.assigned_to = $1';
            params = [parseInt(managerId)];
        }

        const leads = await pool.query(`
            SELECT
                l.id, l.client_name, l.phone, l.status, l.notes,
                l.created_at, l.updated_at,
                u.full_name as manager_name
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            ${whereClause}
            ORDER BY l.updated_at DESC NULLS LAST
        `, params);

        const stats = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'new')::int as new_count,
                COUNT(*) FILTER (WHERE status = 'contact')::int as contact_count,
                COUNT(*) FILTER (WHERE status = 'demo')::int as demo_count,
                COUNT(*) FILTER (WHERE status = 'negotiation')::int as negotiation_count,
                COUNT(*) FILTER (WHERE status = 'closed')::int as closed_count,
                COUNT(*) FILTER (WHERE status = 'lost')::int as lost_count
            FROM leads l
            ${whereClause}
        `, params);

        res.json({ success: true, leads: leads.rows, stats: stats.rows[0] });
    } catch (err) {
        log.error('GET /copilot/pipeline/stats error', err);
        res.status(500).json({ error: 'Помилка pipeline: ' + err.message });
    }
});

// ─── MODULE 11: AI Message Writer ────────────────────────────────────────

// POST /api/copilot/write-message
router.post('/write-message', rateLimitAI, async (req, res) => {
    try {
        const { clientName, messageType, discussedTopics, mainInterest, concerns, callResult, nextStep, tone = 'friendly', leadId } = req.body;

        if (!clientName?.trim()) {
            return res.status(400).json({ error: 'Ім\'я клієнта обов\'язкове' });
        }

        const systemPrompt = buildMessageWriterPrompt({
            clientName, messageType, discussedTopics, mainInterest,
            concerns, callResult, nextStep, tone
        });

        const raw = await openRouterChat({
            messages: [{ role: 'user', content: 'Напиши повідомлення.' }],
            system: systemPrompt,
            temperature: 0.8,
            max_tokens: 500
        });

        // Log as message_draft if leadId
        if (leadId) {
            await pool.query(`
                INSERT INTO lead_interactions (lead_id, user_id, type, summary, details)
                VALUES ($1, $2, 'message_draft', $3, $4)
            `, [leadId, req.user.id, `Чернетка: ${messageType}`, JSON.stringify({ text: raw, type: messageType })]);
        }

        res.json({ success: true, message: raw });
    } catch (err) {
        log.error('POST /copilot/write-message error', err);
        res.status(500).json({ error: 'Помилка AI: ' + err.message });
    }
});

// ─── MODULE 7: Interaction Tracker ────────────────────────────────────────

// GET /api/copilot/interactions
router.get('/interactions', async (req, res) => {
    try {
        const { type, from, to, managerId, limit = 50 } = req.query;
        const isDirector = ['creator', 'director', 'senior_manager'].includes(req.user.role);

        const conditions = [];
        const params = [];

        if (!isDirector) {
            params.push(req.user.id);
            conditions.push(`li.user_id = $${params.length}`);
        } else if (managerId) {
            params.push(parseInt(managerId));
            conditions.push(`li.user_id = $${params.length}`);
        }

        if (type) {
            params.push(type);
            conditions.push(`li.type = $${params.length}`);
        }
        if (from) {
            params.push(from);
            conditions.push(`li.created_at >= $${params.length}`);
        }
        if (to) {
            params.push(to);
            conditions.push(`li.created_at <= $${params.length}`);
        }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        params.push(Math.min(parseInt(limit) || 50, 200));

        const result = await pool.query(`
            SELECT
                li.*,
                l.client_name as lead_name,
                l.phone as lead_phone,
                l.status as lead_status,
                u.full_name as manager_name
            FROM lead_interactions li
            LEFT JOIN leads l ON li.lead_id = l.id
            LEFT JOIN users u ON li.user_id = u.id
            ${where}
            ORDER BY li.created_at DESC
            LIMIT $${params.length}
        `, params);

        res.json({ success: true, interactions: result.rows });
    } catch (err) {
        log.error('GET /copilot/interactions error', err);
        res.status(500).json({ error: 'Помилка завантаження взаємодій' });
    }
});

// GET /api/copilot/interactions/lead/:id
router.get('/interactions/lead/:id', async (req, res) => {
    try {
        const leadId = parseInt(req.params.id);
        const result = await pool.query(`
            SELECT
                li.*,
                u.full_name as manager_name
            FROM lead_interactions li
            LEFT JOIN users u ON li.user_id = u.id
            WHERE li.lead_id = $1
            ORDER BY li.created_at DESC
        `, [leadId]);

        // Get lead info
        const lead = await pool.query(`SELECT * FROM leads WHERE id = $1`, [leadId]);

        res.json({ success: true, interactions: result.rows, lead: lead.rows[0] || null });
    } catch (err) {
        log.error('GET /copilot/interactions/lead error', err);
        res.status(500).json({ error: 'Помилка завантаження' });
    }
});

// POST /api/copilot/interactions — manual interaction
router.post('/interactions', async (req, res) => {
    try {
        const { leadId, type, summary, details, followUpDate } = req.body;

        if (!leadId || !type) {
            return res.status(400).json({ error: 'leadId і type обов\'язкові' });
        }

        const result = await pool.query(`
            INSERT INTO lead_interactions (lead_id, user_id, type, summary, details, follow_up_date)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, created_at
        `, [leadId, req.user.id, type, summary, JSON.stringify(details || {}), followUpDate || null]);

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        log.error('POST /copilot/interactions error', err);
        res.status(500).json({ error: 'Помилка збереження' });
    }
});

// PATCH /api/copilot/interactions/:id/followup
router.patch('/interactions/:id/followup', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await pool.query(`
            UPDATE lead_interactions SET follow_up_done = true WHERE id = $1
        `, [id]);
        res.json({ success: true });
    } catch (err) {
        log.error('PATCH /copilot/interactions followup error', err);
        res.status(500).json({ error: 'Помилка оновлення' });
    }
});

// GET /api/copilot/interactions/alerts — leads without contact 3+ days
router.get('/interactions/alerts', async (req, res) => {
    try {
        const isDirector = ['creator', 'director', 'senior_manager'].includes(req.user.role);

        const result = await pool.query(`
            SELECT
                l.id, l.client_name, l.phone, l.status,
                u.full_name as manager_name,
                MAX(li.created_at) as last_interaction,
                EXTRACT(EPOCH FROM (NOW() - MAX(li.created_at)))/86400 as days_ago
            FROM leads l
            LEFT JOIN lead_interactions li ON l.id = li.lead_id
            LEFT JOIN users u ON l.assigned_to = u.id
            WHERE l.status NOT IN ('closed', 'lost')
            ${!isDirector ? 'AND l.assigned_to = $1' : ''}
            GROUP BY l.id, l.client_name, l.phone, l.status, u.full_name
            HAVING MAX(li.created_at) < NOW() - INTERVAL '3 days'
              OR MAX(li.created_at) IS NULL
            ORDER BY days_ago DESC NULLS LAST
            LIMIT 50
        `, !isDirector ? [req.user.id] : []);

        res.json({ success: true, alerts: result.rows });
    } catch (err) {
        log.error('GET /copilot/interactions/alerts error', err);
        res.status(500).json({ error: 'Помилка алертів' });
    }
});

// GET /api/copilot/interactions/stats
router.get('/interactions/stats', async (req, res) => {
    try {
        const { period = 'week' } = req.query;
        const interval = period === 'month' ? '1 month' : '1 week';

        const result = await pool.query(`
            SELECT
                u.full_name as manager_name,
                u.id as manager_id,
                COUNT(li.id)::int as total_interactions,
                COUNT(CASE WHEN li.type = 'call' THEN 1 END)::int as calls,
                COUNT(CASE WHEN li.type LIKE 'message%' THEN 1 END)::int as messages,
                ROUND(AVG((li.details->>'score')::numeric), 1) as avg_score
            FROM users u
            LEFT JOIN lead_interactions li ON u.id = li.user_id
                AND li.created_at >= NOW() - INTERVAL '${interval}'
            WHERE u.role IN ('manager', 'senior_manager', 'director')
            GROUP BY u.id, u.full_name
            ORDER BY total_interactions DESC
        `);

        res.json({ success: true, stats: result.rows });
    } catch (err) {
        log.error('GET /copilot/interactions/stats error', err);
        res.status(500).json({ error: 'Помилка статистики' });
    }
});

// ─── Static data endpoints ────────────────────────────────────────────────

// GET /api/copilot/data/:file
router.get('/data/:file', (req, res) => {
    const allowed = ['objections', 'call-scripts', 'message-templates', 'battle-cards', 'sales-academy', 'sales-methodology', 'buyer-profiles'];
    const filename = req.params.file;
    if (!allowed.includes(filename)) {
        return res.status(404).json({ error: 'Файл не знайдено' });
    }
    const data = loadData(`${filename}.json`);
    if (!data) return res.status(404).json({ error: 'Файл не знайдено' });
    res.json(data);
});

module.exports = router;
