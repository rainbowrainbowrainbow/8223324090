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
        const displayName = req.user?.name || username;
        const dateStr = req.query.date || new Date().toISOString().split('T')[0];
        const result = await getGreeting(username, dateStr, displayName);
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

// Template-based chat responses
function generateChatResponse(userMessage, ctx) {
    const lower = userMessage.toLowerCase();

    if (lower.includes('бронюван') || lower.includes('booking')) {
        if (ctx.bookingsCount > 0) {
            const confirmed = ctx.bookingsCount - ctx.preliminaryCount;
            let msg = `📊 Сьогодні ${ctx.bookingsCount} бронювань на ${ctx.totalRevenue} ₴.`;
            if (ctx.preliminaryCount > 0) {
                msg += ` ${ctx.preliminaryCount} непідтверджених — варто глянути.`;
            } else {
                msg += ` Всі ${confirmed} підтверджені, все ок!`;
            }
            return msg;
        }
        return '📊 Бронювань на сьогодні немає. Поки тихо!';
    }

    if (lower.includes('задач') || lower.includes('task') || lower.includes('місі')) {
        if (ctx.overdueTasks > 0) {
            return `🔴 Є ${ctx.overdueTasks} прострочених задач! Всього активних: ${ctx.pendingTasks}. Варто розібратись.`;
        }
        if (ctx.pendingTasks > 0) {
            return `📋 Активних задач: ${ctx.pendingTasks}. Прострочених немає — все під контролем.`;
        }
        return '✅ Задач немає — все зроблено, можна відпочити!';
    }

    if (lower.includes('стрік') || lower.includes('streak')) {
        if (ctx.streak >= 7) {
            return `🔥 Стрік ${ctx.streak} днів! Ти легенда, так тримати!`;
        }
        if (ctx.streak > 0) {
            return `🔥 Стрік: ${ctx.streak} днів. Не зупиняйся!`;
        }
        return '🔥 Стрік поки 0. Виконуй задачі щодня — і він почне рости!';
    }

    if (lower.includes('аніматор') || lower.includes('animator') || lower.includes('команд')) {
        if (ctx.animatorsToday > 0) {
            return `👥 Сьогодні ${ctx.animatorsToday} аніматорів на зміні. Команда на місці!`;
        }
        return '👥 Лінії поки порожні — перевір розклад.';
    }

    if (lower.includes('привіт') || lower.includes('здоров') || lower.includes('hi') || lower.includes('hello')) {
        return '🦀 Привіт! Питай про бронювання, задачі, стрік чи аніматорів — розкажу!';
    }

    if (lower.includes('допомо') || lower.includes('help') || lower.includes('що вмієш')) {
        return '🦀 Можу розповісти про:\n• 📊 Бронювання — скільки і на яку суму\n• 📋 Задачі — що треба зробити\n• 🔥 Стрік — скільки днів поспіль працюєш\n• 👥 Аніматори — хто сьогодні на зміні';
    }

    // Default
    const defaults = [
        '🦀 Хм, не зовсім зрозумів. Спробуй запитати про бронювання, задачі, стрік або аніматорів!',
        '🦀 Поки вмію відповідати на: бронювання, задачі, стрік, аніматори. Скоро навчусь більшому!',
        '🦀 Цікаве питання! Але поки знаю тільки про бронювання, задачі, стрік та команду.'
    ];
    return defaults[Math.floor(Math.random() * defaults.length)];
}

module.exports = router;
