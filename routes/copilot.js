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
                l.created_at, l.last_contact_at,
                u.name as manager_name
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            ${whereClause}
            ORDER BY l.last_contact_at DESC NULLS LAST, l.created_at DESC
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
                u.name as manager_name
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
                u.name as manager_name
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
                u.name as manager_name,
                MAX(li.created_at) as last_interaction,
                EXTRACT(EPOCH FROM (NOW() - MAX(li.created_at)))/86400 as days_ago
            FROM leads l
            LEFT JOIN lead_interactions li ON l.id = li.lead_id
            LEFT JOIN users u ON l.assigned_to = u.id
            WHERE l.status NOT IN ('closed', 'lost')
            ${!isDirector ? 'AND l.assigned_to = $1' : ''}
            GROUP BY l.id, l.client_name, l.phone, l.status, u.name
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
                u.name as manager_name,
                u.id as manager_id,
                COUNT(li.id)::int as total_interactions,
                COUNT(CASE WHEN li.type = 'call' THEN 1 END)::int as calls,
                COUNT(CASE WHEN li.type LIKE 'message%' THEN 1 END)::int as messages,
                ROUND(AVG((li.details->>'score')::numeric), 1) as avg_score
            FROM users u
            LEFT JOIN lead_interactions li ON u.id = li.user_id
                AND li.created_at >= NOW() - INTERVAL '${interval}'
            WHERE u.role IN ('manager', 'senior_manager', 'director')
            GROUP BY u.id, u.name
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

// ==========================================
// v43.3: AI WORKFLOW ENGINE
// ==========================================

// GET /api/copilot/workflow/flag — check if workflow v2 enabled
router.get('/workflow/flag', async (req, res) => {
    try {
        const r = await pool.query("SELECT is_enabled FROM feature_flags WHERE code = 'ai_workflow_v2'");
        res.json({ enabled: r.rows[0]?.is_enabled || false });
    } catch { res.json({ enabled: false }); }
});

// POST /api/copilot/workflow/run — main workflow endpoint
router.post('/workflow/run', requireRole(...MANAGER_ROLES), rateLimitAI, async (req, res) => {
    try {
        const { prompt, mode = 'quick', role, context, task_context, case_id } = req.body;
        if (!prompt) return res.status(400).json({ success: false, error: 'prompt обовʼязковий' });

        // Check feature flag
        const flag = await pool.query("SELECT is_enabled FROM feature_flags WHERE code = 'ai_workflow_v2'");
        if (!flag.rows[0]?.is_enabled) return res.status(403).json({ success: false, error: 'AI Workflow V2 вимкнено' });

        // Build case context if case_id provided
        let caseContext = '';
        if (case_id) {
            const c = await pool.query('SELECT title, business_context, constraints, last_summary FROM ai_cases WHERE id = $1', [case_id]);
            if (c.rows[0]) {
                const cs = c.rows[0];
                caseContext = `\n\nКОНТЕКСТ КЕЙСУ: ${cs.title}\n${cs.business_context || ''}\n${cs.constraints ? 'Обмеження: ' + cs.constraints : ''}\n${cs.last_summary ? 'Попередній підсумок: ' + cs.last_summary : ''}`;
            }
        }

        // Detect research-worthy queries
        const researchKeywords = ['аналіз', 'дослідження', 'конкурент', 'район', 'ніша', 'ринок', 'стратегія', 'оцін', 'порівнян', 'кав\'ярня', 'відкрити', 'запустити'];
        const needsResearch = researchKeywords.some(k => prompt.toLowerCase().includes(k));

        // Build system prompt based on mode
        let systemPrompt = 'Ти — AI-асистент CRM Event Genix для бізнес-аналізу та прийняття рішень. Відповідай УКРАЇНСЬКОЮ.';
        if (role) systemPrompt += `\nТвоя роль: ${role}`;
        if (context) systemPrompt += `\nКонтекст: ${context}`;
        if (task_context) systemPrompt += `\nЗадача: ${task_context}`;

        if (mode === 'research') {
            systemPrompt += '\n\nРежим: ДОСЛІДЖЕННЯ. Проведи глибокий аналіз. Структуруй відповідь: 1) Огляд ситуації 2) Ключові факти 3) Ризики 4) Можливості 5) Рекомендації. Будь об\'єктивним.';
        } else if (mode === 'task') {
            systemPrompt += '\n\nРежим: ЗАДАЧА. На основі запиту сформуй: 1) Назву задачі 2) Опис 3) Чеклист кроків 4) Очікуваний результат 5) Кому призначити. Будь конкретним.';
        } else {
            systemPrompt += '\n\nРежим: ШВИДКИЙ. Дай коротку чітку відповідь. Без зайвого.';
        }
        systemPrompt += caseContext;

        let result;
        try {
            const { openRouterChat } = require('../services/copilot');
            result = await openRouterChat({
                system: systemPrompt,
                messages: [{ role: 'user', content: prompt }],
                temperature: mode === 'research' ? 0.4 : 0.7,
                max_tokens: mode === 'research' ? 2000 : mode === 'task' ? 1500 : 800
            });
        } catch (llmErr) {
            // Fallback mock when no API key
            log.warn('Workflow LLM fallback:', llmErr.message);
            const mocks = {
                quick: `На основі вашого запиту: "${prompt.substring(0, 50)}..."\n\nОсновні рекомендації:\n1. Визначте цільову аудиторію\n2. Проаналізуйте конкурентів\n3. Складіть план дій\n\n⚠️ Це mock-відповідь. Підключіть OPENROUTER_API_KEY для реального AI.`,
                research: `## Дослідження: ${prompt.substring(0, 40)}\n\n### Огляд\nТема потребує глибокого аналізу.\n\n### Ключові факти\n- Потрібно зібрати дані з ринку\n- Визначити цільові метрики\n\n### Ризики\n- Недостатньо даних для точних висновків\n\n### Рекомендації\n1. Провести детальне дослідження\n2. Зібрати реальні дані\n\n⚠️ Mock-відповідь.`,
                task: `## Задача\n**Назва:** ${prompt.substring(0, 50)}\n\n**Опис:** На основі запиту потрібно виконати аналіз і підготувати план.\n\n**Чеклист:**\n1. Зібрати вхідні дані\n2. Проаналізувати\n3. Сформувати рекомендації\n\n⚠️ Mock-відповідь.`
            };
            result = mocks[mode] || mocks.quick;
        }

        // Update case summary if case_id
        if (case_id && result) {
            await pool.query(
                'UPDATE ai_cases SET last_summary = $1, updated_at = NOW() WHERE id = $2',
                [result.substring(0, 500), case_id]
            ).catch(() => {});
        }

        res.json({ success: true, response: result, mode, needsResearch, case_id });
    } catch (err) {
        log.error('POST /workflow/run error', err);
        res.status(500).json({ success: false, error: 'AI помилка: ' + err.message });
    }
});

// POST /api/copilot/workflow/self-check — re-analyze/improve response
router.post('/workflow/self-check', requireRole(...MANAGER_ROLES), rateLimitAI, async (req, res) => {
    try {
        const { original_response, action } = req.body;
        if (!original_response || !action) return res.status(400).json({ success: false, error: 'Потрібні original_response та action' });

        const actions = {
            verify: 'Перевір цю відповідь на фактичні помилки, слабкі місця та неточності. Вкажи що виправити.',
            weaknesses: 'Знайди 3-5 слабких місць у цій відповіді. Запропонуй покращення для кожного.',
            shorten: 'Перепиши цю відповідь коротше і сильніше. Збережи ключові пункти, видали воду.'
        };
        const prompt = actions[action] || actions.verify;

        let result;
        try {
            const { openRouterChat } = require('../services/copilot');
            result = await openRouterChat({
                system: 'Ти — критичний рецензент. Аналізуй відповіді AI на якість. Відповідай УКРАЇНСЬКОЮ.',
                messages: [{ role: 'user', content: `${prompt}\n\n---\nОригінальна відповідь:\n${original_response}` }],
                temperature: 0.3,
                max_tokens: 1500
            });
        } catch {
            result = `${action === 'verify' ? '✅ Перевірка' : action === 'weaknesses' ? '🔍 Аналіз слабких місць' : '✂️ Скорочення'}:\n\nМock self-check для тестування. Підключіть OPENROUTER_API_KEY.`;
        }
        res.json({ success: true, response: result, action });
    } catch (err) {
        log.error('POST /workflow/self-check error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/copilot/workflow/task-preview — generate task from AI response
router.post('/workflow/task-preview', requireRole(...MANAGER_ROLES), async (req, res) => {
    try {
        const { ai_response, context } = req.body;
        if (!ai_response) return res.status(400).json({ success: false, error: 'ai_response обовʼязковий' });

        let result;
        try {
            const { openRouterChat } = require('../services/copilot');
            result = await openRouterChat({
                system: 'Ти конвертуєш AI-відповідь у структуровану задачу для CRM. Відповідай JSON: {"title":"...","description":"...","checklist":["..."],"expected_result":"...","suggested_assignee":"...","priority":"normal"}. Відповідай УКРАЇНСЬКОЮ.',
                messages: [{ role: 'user', content: `Перетвори цю AI-відповідь у задачу:\n\n${ai_response}\n\n${context ? 'Контекст: ' + context : ''}` }],
                temperature: 0.3,
                max_tokens: 800
            });
        } catch {
            result = JSON.stringify({ title: ai_response.substring(0, 60), description: ai_response, checklist: ['Визначити вхідні дані', 'Проаналізувати', 'Підготувати результат'], expected_result: 'Завершена задача', suggested_assignee: '', priority: 'normal' });
        }

        // Parse JSON from response
        let taskPreview;
        try {
            const jsonMatch = result.match(/\{[\s\S]*\}/);
            taskPreview = jsonMatch ? JSON.parse(jsonMatch[0]) : { title: 'Нова задача', description: result };
        } catch {
            taskPreview = { title: 'Нова задача', description: result };
        }
        res.json({ success: true, preview: taskPreview });
    } catch (err) {
        log.error('POST /workflow/task-preview error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// === AI Cases CRUD ===

// GET /api/copilot/cases — list user's cases
router.get('/cases', requireRole(...MANAGER_ROLES), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, title, case_type, status, last_summary, updated_at FROM ai_cases
             WHERE created_by = $1 AND status != 'deleted' ORDER BY updated_at DESC LIMIT 50`,
            [req.user?.username]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        log.error('GET /cases error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/copilot/cases — create case
router.post('/cases', requireRole(...MANAGER_ROLES), async (req, res) => {
    try {
        const { title, case_type, business_context, constraints } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'title обовʼязковий' });
        const result = await pool.query(
            `INSERT INTO ai_cases (title, case_type, business_context, constraints, created_by)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [title, case_type || 'research', business_context || null, constraints || null, req.user?.username]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('POST /cases error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/copilot/cases/:id
router.get('/cases/:id', requireRole(...MANAGER_ROLES), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ai_cases WHERE id = $1 AND created_by = $2', [req.params.id, req.user?.username]);
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Кейс не знайдено' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('GET /cases/:id error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/copilot/cases/:id
router.put('/cases/:id', requireRole(...MANAGER_ROLES), async (req, res) => {
    try {
        const { title, business_context, constraints, messages, last_summary } = req.body;
        const result = await pool.query(
            `UPDATE ai_cases SET title = COALESCE($1, title), business_context = COALESCE($2, business_context),
             constraints = COALESCE($3, constraints), messages = COALESCE($4, messages),
             last_summary = COALESCE($5, last_summary), updated_at = NOW()
             WHERE id = $6 AND created_by = $7 RETURNING *`,
            [title, business_context, constraints, messages ? JSON.stringify(messages) : null,
             last_summary, req.params.id, req.user?.username]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Кейс не знайдено' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        log.error('PUT /cases/:id error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/copilot/cases/:id
router.delete('/cases/:id', requireRole(...MANAGER_ROLES), async (req, res) => {
    try {
        await pool.query("UPDATE ai_cases SET status = 'deleted', updated_at = NOW() WHERE id = $1 AND created_by = $2", [req.params.id, req.user?.username]);
        res.json({ success: true });
    } catch (err) {
        log.error('DELETE /cases/:id error', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
