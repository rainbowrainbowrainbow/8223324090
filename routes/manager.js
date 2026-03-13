/**
 * routes/manager.js — Manager AI Copilot API
 * v27.0.0: AI Live Coach, Objections, Scripts, Templates, Debrief,
 *          Sales Academy, Interactions, Battle Cards, Meeting Prep,
 *          Pipeline, AI Message Writer
 *
 * Endpoints:
 *   POST   /api/manager/coach           — AI Live Coach suggestions
 *   POST   /api/manager/objection       — AI custom objection handler
 *   POST   /api/manager/debrief         — AI call analysis
 *   POST   /api/manager/debrief/save    — Save debrief to DB
 *   GET    /api/manager/debrief/stats   — Manager stats
 *   POST   /api/manager/feedback        — Save thumbs up/down
 *   POST   /api/manager/sales-qa        — Sales Academy Q&A
 *   POST   /api/manager/meeting-prep    — AI meeting brief
 *   GET    /api/manager/pipeline/stats  — Pipeline analytics
 *   POST   /api/manager/write-message   — AI Message Writer
 *   GET    /api/manager/interactions    — Interaction feed
 *   GET    /api/manager/interactions/lead/:id — Lead timeline
 *   POST   /api/manager/interactions    — Add manual interaction
 *   PATCH  /api/manager/interactions/:id/followup — Mark follow-up done
 *   GET    /api/manager/interactions/alerts — Leads without contact
 *   GET    /api/manager/interactions/stats  — Team activity stats
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const { trackUsage } = require('../services/summary-agent');
const fs = require('fs');
const path = require('path');

const log = createLogger('Manager');

const MANAGER_ROLES = ['creator', 'director', 'vice_director', 'senior_manager', 'manager'];
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const COACH_MODEL = process.env.COACH_MODEL || process.env.OPENROUTER_MODEL || 'google/gemma-2-9b-it:free';

const MODEL_PRICING = {
    'google/gemma-2-9b-it:free': { input: 0, output: 0 },
    'google/gemini-2.0-flash-001': { input: 0.1, output: 0.4 },
    'anthropic/claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
    'anthropic/claude-sonnet-4-20250514': { input: 3, output: 15 },
    'meta-llama/llama-3.1-8b-instruct:free': { input: 0, output: 0 },
    'default': { input: 0.5, output: 1.5 }
};

// All routes require manager+ role
router.use(requireRole(...MANAGER_ROLES));

// Simple per-user rate limiter for AI endpoints
const _coachLimits = new Map();
function rateLimitCoach(req, res, next) {
    const userId = req.user.id;
    const now = Date.now();
    const window = 60000; // 1 minute
    const max = 15;

    if (!_coachLimits.has(userId)) _coachLimits.set(userId, []);
    const times = _coachLimits.get(userId).filter(t => t > now - window);
    if (times.length >= max) {
        return res.status(429).json({ success: false, error: 'Забагато запитів. Зачекайте хвилину.' });
    }
    times.push(now);
    _coachLimits.set(userId, times);
    next();
}

// ═══ OpenRouter helper ═══
async function callCoachLLM(systemPrompt, userMessage, maxTokens, service) {
    if (!OPENROUTER_API_KEY) {
        log.warn('No OPENROUTER_API_KEY — coach disabled');
        return null;
    }
    try {
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + OPENROUTER_API_KEY,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://park-zp.railway.app',
                'X-Title': 'Event Genix Manager Copilot'
            },
            body: JSON.stringify({
                model: COACH_MODEL,
                max_tokens: maxTokens || 800,
                temperature: 0.7,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ]
            })
        });

        if (!resp.ok) {
            const errText = await resp.text();
            log.error('OpenRouter error', { status: resp.status, body: errText });
            return null;
        }

        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content?.trim() || null;
        const usage = data.usage || {};
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const totalTokens = promptTokens + completionTokens;
        const pricing = MODEL_PRICING[COACH_MODEL] || MODEL_PRICING['default'];
        const costUsd = (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;

        await trackUsage(service || 'manager-coach', COACH_MODEL, promptTokens, completionTokens, totalTokens, costUsd, {});

        return { text, tokens: totalTokens, cost: costUsd, model: COACH_MODEL };
    } catch (err) {
        log.error('OpenRouter call failed', err.message);
        return null;
    }
}

// ═══ Data file loader (cached) ═══
const _dataCache = {};
function loadData(filename) {
    if (_dataCache[filename]) return _dataCache[filename];
    try {
        const filePath = path.join(__dirname, '..', 'data', filename);
        const raw = fs.readFileSync(filePath, 'utf-8');
        _dataCache[filename] = JSON.parse(raw);
        return _dataCache[filename];
    } catch (err) {
        log.error(`Failed to load data/${filename}`, err.message);
        return null;
    }
}

// ═══ System prompts ═══
function buildCoachPrompt(scenario, tone) {
    const SCENARIOS = {
        'first-call': 'перший вхідний дзвінок, клієнт нічого не знає про систему',
        'landing-lead': 'клієнт залишив заявку на лендінгу, вже зацікавлений',
        'after-demo': 'після онлайн-презентації, розглядає рішення',
        'price-negotiation': 'обговорення ціни, торг',
        'objection': 'клієнт заперечує або сумнівається',
        'closing': 'фінальний етап, закриття угоди',
        'follow-up': 'клієнт не відповідав 5-7 днів',
        'reactivation': 'клієнт не виходив на зв\'язок 2+ тижні'
    };
    const TONES = {
        'confident': 'впевнений, прямий, без зайвих слів',
        'empathetic': 'м\'який, емпатичний, слухаючий',
        'business': 'діловий, короткий, цифри і факти',
        'playful': 'дружній, легкий гумор де доречно'
    };

    return `Ти — AI-помічник менеджера Event Genix.
КОНТЕКСТ ПРОДУКТУ:
Event Genix — AI-CRM система для дитячих розважальних центрів.
• Базовий пакет: 2,000 ₴/міс (таймлайн, бронювання, чат, AI-дворецький, гейміфікація)
• Повний пакет: 21,000 ₴/міс (все включено)
• Вже використовується в Парку Закревського (Київ) з лютого 2026
• Головна цінність: економить 90+ хвилин/день рутини
• AI-дворецький Клешня: відповідає на питання, бронює, будує P&L за 10 секунд
РИНОК КЛІЄНТА:
• Власники дитячих квест-кімнат, батутних парків, розважальних центрів
• Болі: ручне бронювання, розклад у телефоні, конфлікти через плутанину, звітність в Excel
• Страхи: складно навчити команду, а раптом не злетить, дорого
КОНКУРЕНТИ:
• Excel/Google Sheets — таблиці не нагадують, не аналізують, не автоматизують
• Yclients/DIKIDI — для салонів, без AI, без гейміфікації
• "Зробимо самі боти" — хто підтримуватиме, скільки часу
СЦЕНАРІЙ РОЗМОВИ: ${SCENARIOS[scenario] || 'загальна розмова'}
ТОН: ${TONES[tone] || 'впевнений'}
ТВОЯ ЗАДАЧА — видати JSON:
{
  "suggestions": [
    {"type": "neutral", "text": "..."},
    {"type": "confident", "text": "..."},
    {"type": "empathy", "text": "..."}
  ],
  "tactic": "одне речення — яка тактика застосована",
  "avoid": ["що НЕ казати — 1-2 пункти"],
  "nextStep": "конкретна наступна дія менеджера"
}
ПРАВИЛА:
• Тільки українська мова
• Конкретні фрази, не шаблони
• Без "можливо", "спробуйте", "можна"
• Враховуй ринок дитячих розваг, не загальний B2B
• ЗАБОРОНЕНО: критикувати конкурентів напряму, тиснути штучними дедлайнами, обіцяти функціонал якого немає
• Відповідай ТІЛЬКИ валідним JSON без markdown-обгортки`;
}

function buildDebriefPrompt() {
    return `Ти — AI-аналітик продажів Event Genix. Аналізуєш дзвінки менеджерів.
Продукт: AI-CRM для дитячих розважальних центрів. Базовий 2,000 ₴/міс, повний 21,000 ₴/міс.
Дай JSON відповідь:
{
  "score": 1-10,
  "good": ["що зроблено добре — 2-3 пункти"],
  "improve": ["що покращити — 2-3 пункти"],
  "nextStep": "конкретний наступний крок для менеджера",
  "followUpDate": "рекомендована дата follow-up (YYYY-MM-DD або null)"
}
ПРАВИЛА: українська, конкретно, без загальних фраз. Відповідай ТІЛЬКИ валідним JSON.`;
}

function buildMeetingPrepPrompt() {
    return `Ти — AI-помічник менеджера Event Genix. Готуєш бриф перед дзвінком.
Продукт: AI-CRM для дитячих розважальних центрів.
Пакети: базовий 2,000 ₴/міс, повний 21,000 ₴/міс.
Референс: Парк Закревського (Київ) — -90 хв/день рутини.
Дай JSON відповідь:
{
  "focus": "головна ціль дзвінка",
  "opening_question": "перше питання для розмови",
  "killer_questions": ["Q1", "Q2", "Q3"],
  "likely_objections": [{"objection": "текст", "response": "відповідь"}],
  "call_goal": "конкретний результат",
  "potential_value": "оцінка потенціалу в ₴/міс",
  "decision_maker_hint": "як з'ясувати ЛПР"
}
ПРАВИЛА: українська, конкретно, адаптовано під ринок дитячих центрів. ТІЛЬКИ валідний JSON.`;
}

function buildMessageWriterPrompt() {
    return `Ти — копірайтер Event Genix. Пишеш персоналізовані повідомлення для менеджерів.
Продукт: AI-CRM для дитячих розважальних центрів. Базовий 2,000 ₴, повний 21,000 ₴/міс.
ПРАВИЛА:
• Тільки українська
• Живий стиль, НЕ корпоративна мова
• Звертайся по імені природньо
• Згадуй конкретні болі ЦЬОГО клієнта
• Тон підлаштований під контекст
• Без "Шановний", без канцеляризмів
• Кінець — конкретний наступний крок
Напиши ТІЛЬКИ текст повідомлення, без JSON, без пояснень.`;
}

function buildSalesQAPrompt(context) {
    return `Ти — Sales AI для менеджерів Event Genix.
Маєш доступ до:
1. Методологій продажів (SPIN, Challenger, SNAP, MEDDIC, Value-Based)
2. Кейсів Mindbody, Toast, Yclients
3. Психографіки власників дитячих центрів
4. Технік закриття угод
5. Повного знання продукту Event Genix
БАЗА ЗНАНЬ:
${context}
Відповідай конкретно, з прикладами, адаптованими до ринку дитячих розваг.
Якщо питання про продукт — давай точну відповідь.
Якщо питання про тактику — давай покрокову інструкцію.
Завжди: що робити ЗАРАЗ і яким буде наступний крок.
Українська мова.`;
}

// Parse AI response that should be JSON
function parseJSON(text) {
    if (!text) return null;
    try {
        // Remove markdown code block if present
        const cleaned = text.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();
        return JSON.parse(cleaned);
    } catch {
        log.warn('Failed to parse AI JSON response');
        return null;
    }
}

// ═══ Interaction logger (reusable) ═══
async function logInteraction(leadId, userId, type, summary, details, followUpDate) {
    try {
        await pool.query(
            `INSERT INTO lead_interactions (lead_id, user_id, type, summary, details, follow_up_date)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [leadId, userId || null, type, summary || null, JSON.stringify(details || {}), followUpDate || null]
        );
    } catch (err) {
        log.error('Failed to log interaction', err.message);
    }
}

// ═══════════════════════════════════════
//  MODULE 1: AI Live Coach
// ═══════════════════════════════════════
router.post('/coach', rateLimitCoach, async (req, res) => {
    try {
        const { clientText, scenario, tone, temperature } = req.body;
        if (!clientText?.trim()) {
            return res.status(400).json({ success: false, error: 'Текст клієнта обов\'язковий' });
        }

        const systemPrompt = buildCoachPrompt(scenario || 'first-call', tone || 'confident');
        const userMsg = `Клієнт сказав: "${clientText.trim()}"`;

        const result = await callCoachLLM(systemPrompt, userMsg, 800, 'manager-coach');
        if (!result) {
            return res.status(503).json({ success: false, error: 'AI сервіс недоступний' });
        }

        const parsed = parseJSON(result.text);
        if (!parsed) {
            return res.json({ success: true, raw: result.text, tokens: result.tokens, cost: result.cost });
        }

        res.json({ success: true, ...parsed, tokens: result.tokens, cost: result.cost });
    } catch (err) {
        log.error('POST /coach error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ═══════════════════════════════════════
//  MODULE 2: Objection handler (AI for custom)
// ═══════════════════════════════════════
router.post('/objection', rateLimitCoach, async (req, res) => {
    try {
        const { objectionText } = req.body;
        if (!objectionText?.trim()) {
            return res.status(400).json({ success: false, error: 'Текст заперечення обов\'язковий' });
        }

        const systemPrompt = buildCoachPrompt('objection', 'confident');
        const userMsg = `Клієнт заперечує: "${objectionText.trim()}". Дай 3 варіанти відповіді.`;

        const result = await callCoachLLM(systemPrompt, userMsg, 800, 'manager-objection');
        if (!result) {
            return res.status(503).json({ success: false, error: 'AI сервіс недоступний' });
        }

        const parsed = parseJSON(result.text);
        res.json({ success: true, ...(parsed || { raw: result.text }), tokens: result.tokens, cost: result.cost });
    } catch (err) {
        log.error('POST /objection error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// ═══════════════════════════════════════
//  MODULE 5: Debrief — AI analysis
// ═══════════════════════════════════════
router.post('/debrief', rateLimitCoach, async (req, res) => {
    try {
        const { clientName, result: callResult, durationMin, notes, mainObjection, whatWorked, whatImprove } = req.body;
        if (!notes?.trim()) {
            return res.status(400).json({ success: false, error: 'Нотатки обов\'язкові' });
        }

        const systemPrompt = buildDebriefPrompt();
        const userMsg = `Аналізуй дзвінок:
Клієнт: ${clientName || 'невідомий'}
Результат: ${callResult || 'невідомий'}
Тривалість: ${durationMin || '?'} хв
Заперечення: ${mainObjection || 'немає'}
Що обговорювали: ${notes}
Що спрацювало: ${whatWorked || 'не вказано'}
Що покращити: ${whatImprove || 'не вказано'}`;

        const aiResult = await callCoachLLM(systemPrompt, userMsg, 800, 'manager-debrief');
        if (!aiResult) {
            return res.status(503).json({ success: false, error: 'AI сервіс недоступний' });
        }

        const parsed = parseJSON(aiResult.text);
        res.json({ success: true, analysis: parsed || { raw: aiResult.text }, tokens: aiResult.tokens, cost: aiResult.cost });
    } catch (err) {
        log.error('POST /debrief error', err);
        res.status(500).json({ success: false, error: 'Помилка сервера' });
    }
});

// Save debrief to DB
router.post('/debrief/save', async (req, res) => {
    try {
        const { leadId, clientName, callResult, durationMin, notes, mainObjection, whatWorked, whatImprove, aiScore, aiAnalysis, nextStep } = req.body;

        const result = await pool.query(
            `INSERT INTO call_debriefs (user_id, lead_id, client_name, call_result, duration_min, notes, main_objection, what_worked, what_improve, ai_score, ai_analysis, next_step)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
            [req.user.id, leadId || null, clientName, callResult, durationMin || null, notes, mainObjection || null, whatWorked || null, whatImprove || null, aiScore || null, JSON.stringify(aiAnalysis || {}), nextStep || null]
        );

        // Log interaction if lead linked
        if (leadId) {
            const followUpDate = aiAnalysis?.followUpDate || null;
            await logInteraction(leadId, req.user.id, 'debrief', `Дебрифінг: ${callResult}. Score: ${aiScore || '?'}/10`, { debriefId: result.rows[0].id, score: aiScore, result: callResult, nextStep }, followUpDate);
        }

        log.info(`Debrief saved by ${req.user.username}, client: ${clientName}`);
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        log.error('POST /debrief/save error', err);
        res.status(500).json({ success: false, error: 'Помилка збереження' });
    }
});

// Debrief stats
router.get('/debrief/stats', async (req, res) => {
    try {
        const userId = req.query.userId || req.user.id;
        const days = parseInt(req.query.days) || 30;

        const { rows } = await pool.query(
            `SELECT COUNT(*) as total_calls, AVG(ai_score) as avg_score,
                    COUNT(CASE WHEN call_result = 'hot' THEN 1 END) as hot,
                    COUNT(CASE WHEN call_result = 'interested' THEN 1 END) as interested,
                    COUNT(CASE WHEN call_result = 'callback' THEN 1 END) as callback,
                    COUNT(CASE WHEN call_result = 'rejected' THEN 1 END) as rejected
             FROM call_debriefs
             WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 day' * $2`,
            [userId, days]
        );

        // Weekly trend
        const { rows: weekly } = await pool.query(
            `SELECT DATE_TRUNC('week', created_at) as week, AVG(ai_score) as avg_score, COUNT(*) as calls
             FROM call_debriefs WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 day' * $2
             GROUP BY week ORDER BY week`,
            [userId, days]
        );

        res.json({ success: true, stats: rows[0], weekly });
    } catch (err) {
        log.error('GET /debrief/stats error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// ═══════════════════════════════════════
//  MODULE 1: Feedback (thumbs up/down)
// ═══════════════════════════════════════
router.post('/feedback', async (req, res) => {
    try {
        const { scenario, clientText, suggestion, rating } = req.body;
        if (![1, -1].includes(rating)) {
            return res.status(400).json({ success: false, error: 'Rating must be 1 or -1' });
        }

        await pool.query(
            `INSERT INTO manager_feedback (user_id, scenario, client_text, suggestion, rating)
             VALUES ($1, $2, $3, $4, $5)`,
            [req.user.id, scenario || null, clientText || null, suggestion || null, rating]
        );

        res.json({ success: true });
    } catch (err) {
        log.error('POST /feedback error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// ═══════════════════════════════════════
//  MODULE 6: Sales Q&A
// ═══════════════════════════════════════
router.post('/sales-qa', rateLimitCoach, async (req, res) => {
    try {
        const { question, category } = req.body;
        if (!question?.trim()) {
            return res.status(400).json({ success: false, error: 'Питання обов\'язкове' });
        }

        // Load relevant knowledge
        const academy = loadData('sales-academy.json');
        const methodology = loadData('sales-methodology.json');
        const profiles = loadData('buyer-profiles.json');

        let context = '';
        if (category === 'methodology' && methodology) {
            context = JSON.stringify(methodology);
        } else if (category === 'psychology' && profiles) {
            context = JSON.stringify(profiles);
        } else {
            // Send abbreviated context
            const parts = [];
            if (academy) parts.push(JSON.stringify(academy).substring(0, 3000));
            if (methodology) parts.push(JSON.stringify(methodology).substring(0, 2000));
            if (profiles) parts.push(JSON.stringify(profiles).substring(0, 1000));
            context = parts.join('\n---\n');
        }

        const systemPrompt = buildSalesQAPrompt(context);
        const result = await callCoachLLM(systemPrompt, question.trim(), 1000, 'manager-sales-qa');
        if (!result) {
            return res.status(503).json({ success: false, error: 'AI сервіс недоступний' });
        }

        res.json({ success: true, answer: result.text, tokens: result.tokens, cost: result.cost });
    } catch (err) {
        log.error('POST /sales-qa error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// ═══════════════════════════════════════
//  MODULE 9: Meeting Prep
// ═══════════════════════════════════════
router.post('/meeting-prep', rateLimitCoach, async (req, res) => {
    try {
        const { clientName, source, businessSize, knownInfo, packageInterest, previousContact, callType } = req.body;
        if (!clientName?.trim()) {
            return res.status(400).json({ success: false, error: 'Ім\'я клієнта обов\'язкове' });
        }

        const systemPrompt = buildMeetingPrepPrompt();
        const userMsg = `Підготуй бриф для дзвінка:
Клієнт: ${clientName}
Джерело: ${source || 'невідомо'}
Розмір бізнесу: ${businessSize || 'невідомо'}
Що знаємо: ${knownInfo || 'нічого'}
Пакет: ${packageInterest || 'невідомо'}
Попередній контакт: ${previousContact || 'ні'}
Тип дзвінка: ${callType || 'перший'}`;

        const result = await callCoachLLM(systemPrompt, userMsg, 1000, 'manager-meeting-prep');
        if (!result) {
            return res.status(503).json({ success: false, error: 'AI сервіс недоступний' });
        }

        const parsed = parseJSON(result.text);

        // Save as interaction if lead found
        if (req.body.leadId) {
            await logInteraction(req.body.leadId, req.user.id, 'meeting_prep',
                `Підготовка до ${callType || 'дзвінка'}`,
                { brief: parsed || result.text }
            );
        }

        res.json({ success: true, brief: parsed || { raw: result.text }, tokens: result.tokens, cost: result.cost });
    } catch (err) {
        log.error('POST /meeting-prep error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// ═══════════════════════════════════════
//  MODULE 11: AI Message Writer
// ═══════════════════════════════════════
router.post('/write-message', rateLimitCoach, async (req, res) => {
    try {
        const { clientName, messageType, discussed, interested, concerns, result: callResult, nextStep, tone } = req.body;
        if (!clientName?.trim()) {
            return res.status(400).json({ success: false, error: 'Ім\'я клієнта обов\'язкове' });
        }

        const systemPrompt = buildMessageWriterPrompt();
        const userMsg = `Напиши повідомлення:
Клієнт: ${clientName}
Тип: ${messageType || 'після дзвінка'}
Обговорювали: ${discussed || 'загальне знайомство'}
Найбільше зацікавило: ${interested || 'не вказано'}
Що хвилює: ${concerns || 'не вказано'}
Результат: ${callResult || 'зацікавлений'}
Наступний крок: ${nextStep || 'follow-up'}
Тон: ${tone || 'дружній'}`;

        const result = await callCoachLLM(systemPrompt, userMsg, 600, 'manager-message-writer');
        if (!result) {
            return res.status(503).json({ success: false, error: 'AI сервіс недоступний' });
        }

        res.json({ success: true, message: result.text, tokens: result.tokens, cost: result.cost });
    } catch (err) {
        log.error('POST /write-message error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// ═══════════════════════════════════════
//  MODULE 7: Interactions
// ═══════════════════════════════════════

// Feed of all interactions
router.get('/interactions', async (req, res) => {
    try {
        const { type, userId: filterUser, days, search, limit: lim } = req.query;
        const conditions = [];
        const params = [];

        if (type) { params.push(type); conditions.push(`i.type = $${params.length}`); }
        if (filterUser) { params.push(parseInt(filterUser)); conditions.push(`i.user_id = $${params.length}`); }
        if (days) { params.push(parseInt(days)); conditions.push(`i.created_at > NOW() - INTERVAL '1 day' * $${params.length}`); }
        if (search) { params.push(`%${search}%`); conditions.push(`(i.summary ILIKE $${params.length} OR l.client_name ILIKE $${params.length})`); }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const limit = Math.min(parseInt(lim) || 50, 200);
        params.push(limit);

        const { rows } = await pool.query(
            `SELECT i.*, l.client_name as lead_name, l.phone as lead_phone, l.status as lead_status,
                    u.display_name as user_name
             FROM lead_interactions i
             LEFT JOIN leads l ON l.id = i.lead_id
             LEFT JOIN users u ON u.id = i.user_id
             ${where}
             ORDER BY i.created_at DESC
             LIMIT $${params.length}`,
            params
        );

        res.json({ success: true, interactions: rows });
    } catch (err) {
        log.error('GET /interactions error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// Lead timeline
router.get('/interactions/lead/:id', async (req, res) => {
    try {
        const leadId = parseInt(req.params.id);
        const { rows: interactions } = await pool.query(
            `SELECT i.*, u.display_name as user_name
             FROM lead_interactions i
             LEFT JOIN users u ON u.id = i.user_id
             WHERE i.lead_id = $1
             ORDER BY i.created_at DESC`,
            [leadId]
        );

        const { rows: leads } = await pool.query(
            `SELECT * FROM leads WHERE id = $1`, [leadId]
        );

        res.json({ success: true, lead: leads[0] || null, interactions });
    } catch (err) {
        log.error('GET /interactions/lead/:id error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// Add manual interaction
router.post('/interactions', async (req, res) => {
    try {
        const { leadId, type, summary, details, followUpDate } = req.body;
        if (!leadId || !type) {
            return res.status(400).json({ success: false, error: 'leadId і type обов\'язкові' });
        }

        await logInteraction(leadId, req.user.id, type, summary, details, followUpDate);
        log.info(`Interaction logged by ${req.user.username}: ${type} for lead ${leadId}`);
        res.json({ success: true });
    } catch (err) {
        log.error('POST /interactions error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// Mark follow-up done
router.patch('/interactions/:id/followup', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await pool.query(
            `UPDATE lead_interactions SET follow_up_done = true WHERE id = $1`, [id]
        );
        res.json({ success: true });
    } catch (err) {
        log.error('PATCH /interactions/:id/followup error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// Alerts — leads without contact
router.get('/interactions/alerts', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT l.id, l.client_name, l.phone, l.status, l.assigned_to,
                    u.display_name as manager_name,
                    MAX(i.created_at) as last_contact,
                    EXTRACT(DAY FROM NOW() - MAX(i.created_at)) as days_silent
             FROM leads l
             LEFT JOIN lead_interactions i ON i.lead_id = l.id
             LEFT JOIN users u ON u.id = l.assigned_to
             WHERE l.status NOT IN ('won', 'lost', 'closed', 'booked')
             GROUP BY l.id, l.client_name, l.phone, l.status, l.assigned_to, u.display_name
             HAVING MAX(i.created_at) IS NULL OR MAX(i.created_at) < NOW() - INTERVAL '3 days'
             ORDER BY MAX(i.created_at) ASC NULLS FIRST
             LIMIT 50`
        );

        res.json({ success: true, alerts: rows });
    } catch (err) {
        log.error('GET /interactions/alerts error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// Team activity stats
router.get('/interactions/stats', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;

        const { rows } = await pool.query(
            `SELECT u.display_name as manager, u.id as user_id,
                    COUNT(*) as total_interactions,
                    COUNT(CASE WHEN i.type = 'call' OR i.type = 'debrief' THEN 1 END) as calls,
                    COUNT(CASE WHEN i.type LIKE 'message%' THEN 1 END) as messages,
                    AVG(CASE WHEN d.ai_score IS NOT NULL THEN d.ai_score END) as avg_score
             FROM lead_interactions i
             JOIN users u ON u.id = i.user_id
             LEFT JOIN call_debriefs d ON d.user_id = i.user_id
                AND d.created_at > NOW() - INTERVAL '1 day' * $1
             WHERE i.created_at > NOW() - INTERVAL '1 day' * $1
             GROUP BY u.id, u.display_name
             ORDER BY total_interactions DESC`,
            [days]
        );

        res.json({ success: true, stats: rows, period: days });
    } catch (err) {
        log.error('GET /interactions/stats error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// ═══════════════════════════════════════
//  MODULE 10: Pipeline stats
// ═══════════════════════════════════════
router.get('/pipeline/stats', async (req, res) => {
    try {
        const userId = req.query.userId;
        const conditions = ["l.status NOT IN ('closed')"];
        const params = [];

        if (userId) { params.push(parseInt(userId)); conditions.push(`l.assigned_to = $${params.length}`); }

        const where = 'WHERE ' + conditions.join(' AND ');

        const { rows } = await pool.query(
            `SELECT l.pipeline_stage, COUNT(*) as count,
                    COALESCE(SUM(l.potential_value), 0) as total_value
             FROM leads l ${where}
             GROUP BY l.pipeline_stage
             ORDER BY CASE l.pipeline_stage
                WHEN 'new' THEN 1
                WHEN 'contacted' THEN 2
                WHEN 'demo' THEN 3
                WHEN 'negotiation' THEN 4
                WHEN 'won' THEN 5
                WHEN 'lost' THEN 6
                ELSE 7 END`,
            params
        );

        // Average cycle time
        const { rows: cycle } = await pool.query(
            `SELECT AVG(EXTRACT(DAY FROM booked_at - created_at)) as avg_cycle_days
             FROM leads WHERE booked_at IS NOT NULL AND created_at > NOW() - INTERVAL '90 days'`
        );

        res.json({
            success: true,
            stages: rows,
            avgCycleDays: Math.round(cycle[0]?.avg_cycle_days || 0),
            totalPipeline: rows.reduce((s, r) => s + parseInt(r.total_value || 0), 0)
        });
    } catch (err) {
        log.error('GET /pipeline/stats error', err);
        res.status(500).json({ success: false, error: 'Помилка' });
    }
});

// Export logInteraction for use in other routes
module.exports = router;
module.exports.logInteraction = logInteraction;
