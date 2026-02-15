/**
 * routes/kleshnya.js — Kleshnya greeting & chat API (v11.0)
 *
 * GET  /api/kleshnya/greeting?date=YYYY-MM-DD — get daily greeting (cached 4h)
 * GET  /api/kleshnya/chat                      — get chat history
 * POST /api/kleshnya/chat                      — add user message + get response
 */
const router = require('express').Router();
const { getGreeting, getChatHistory, addChatMessage, gatherContext } = require('../services/kleshnya-greeting');
const { createLogger } = require('../utils/logger');

const log = createLogger('KleshnyaRoute');

// GET greeting for today (or specific date)
router.get('/greeting', async (req, res) => {
    try {
        const username = req.user?.username;
        const dateStr = req.query.date || new Date().toISOString().split('T')[0];
        const result = await getGreeting(username, dateStr);
        res.json(result);
    } catch (err) {
        log.error('Error fetching greeting', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET chat history
router.get('/chat', async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ error: 'Not authenticated' });
        const history = await getChatHistory(username);
        res.json(history);
    } catch (err) {
        log.error('Error fetching chat history', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST message to chat
router.post('/chat', async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ error: 'Not authenticated' });

        const { message } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Save user message
        await addChatMessage(username, 'user', message.trim());

        // Generate response (template-based for now, AI agent hook later)
        const dateStr = new Date().toISOString().split('T')[0];
        const ctx = await gatherContext(username, dateStr);
        const response = generateChatResponse(message.trim(), ctx);

        // Save assistant response
        const saved = await addChatMessage(username, 'assistant', response);

        res.json({
            role: 'assistant',
            message: response,
            id: saved.id,
            created_at: saved.created_at,
            source: 'template'
        });
    } catch (err) {
        log.error('Error in chat', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Simple template-based chat responses (will be replaced by AI agent)
function generateChatResponse(userMessage, ctx) {
    const lower = userMessage.toLowerCase();

    if (lower.includes('бронюван') || lower.includes('booking')) {
        if (ctx.bookingsCount > 0) {
            return `📊 Сьогодні ${ctx.bookingsCount} бронювань на суму ${ctx.totalRevenue} ₴. ${ctx.preliminaryCount > 0 ? `З них ${ctx.preliminaryCount} попередніх.` : 'Всі підтверджені!'}`;
        }
        return '📭 На сьогодні бронювань немає. Може ще з\'являться!';
    }

    if (lower.includes('задач') || lower.includes('task')) {
        if (ctx.overdueTasks > 0) {
            return `🔴 Маєш ${ctx.overdueTasks} прострочених задач! Загалом відкритих: ${ctx.pendingTasks}. Давай розберемось!`;
        }
        if (ctx.pendingTasks > 0) {
            return `📋 У тебе ${ctx.pendingTasks} відкритих задач. Все під контролем!`;
        }
        return '✅ Всі задачі виконані! Ти молодець! 🎉';
    }

    if (lower.includes('стрік') || lower.includes('streak')) {
        if (ctx.streak > 0) {
            return `🔥 Твій поточний стрік: ${ctx.streak} днів! ${ctx.streak >= 7 ? 'Ти легенда!' : 'Тримай темп!'}`;
        }
        return '🔥 Стрік поки 0. Починай працювати кожен день — і стрік зросте!';
    }

    if (lower.includes('аніматор') || lower.includes('animator')) {
        return `👥 Сьогодні на лініях ${ctx.animatorsToday} аніматорів. Все під контролем!`;
    }

    if (lower.includes('привіт') || lower.includes('здоров') || lower.includes('hi') || lower.includes('hello')) {
        return '🦀 Привіт! Я Клешня — твій помічник у парку. Питай про бронювання, задачі, стріки — допоможу!';
    }

    if (lower.includes('допомо') || lower.includes('help') || lower.includes('що вмієш')) {
        return '🦀 Я можу розповісти про:\n• 📊 Бронювання на сьогодні\n• 📋 Твої задачі\n• 🔥 Стрік\n• 👥 Аніматорів на зміні\n\nСкоро навчусь набагато більше — чекай оновлень!';
    }

    // Default
    const defaults = [
        '🦀 Цікаве питання! Скоро я навчусь відповідати на такі запити. А поки — питай про бронювання, задачі чи стріки!',
        '🦀 Хм, ще не знаю відповідь на це. Але вже скоро! Спробуй запитати про бронювання або задачі.',
        '🦀 Дай трохи часу — скоро стану розумнішим! Зараз можу допомогти з бронюваннями та задачами.'
    ];
    return defaults[Math.floor(Math.random() * defaults.length)];
}

module.exports = router;
