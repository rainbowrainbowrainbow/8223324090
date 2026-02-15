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

// Template-based chat responses — futuristic operator style
function generateChatResponse(userMessage, ctx) {
    const lower = userMessage.toLowerCase();

    if (lower.includes('бронюван') || lower.includes('booking')) {
        if (ctx.bookingsCount > 0) {
            const confirmed = ctx.bookingsCount - ctx.preliminaryCount;
            let msg = `📡 Скан бронювань завершено. Знайдено: ${ctx.bookingsCount}. Виручка: ${ctx.totalRevenue} ₴.`;
            if (ctx.preliminaryCount > 0) {
                msg += ` ⚠️ Непідтверджених: ${ctx.preliminaryCount}. Рекомендую обробити.`;
            } else {
                msg += ` Всі ${confirmed} підтверджені. Статус: норма.`;
            }
            return msg;
        }
        return '📡 Скан завершено. Бронювань на сьогодні: 0. Система в режимі очікування.';
    }

    if (lower.includes('задач') || lower.includes('task')) {
        if (ctx.overdueTasks > 0) {
            return `🔴 Увага! Виявлено ${ctx.overdueTasks} прострочених місій. Загалом активних: ${ctx.pendingTasks}. Рекомендую пріоритезувати.`;
        }
        if (ctx.pendingTasks > 0) {
            return `📋 Активних місій: ${ctx.pendingTasks}. Критичних затримок не виявлено. Продовжуй виконання.`;
        }
        return '✅ Всі місії завершено. Черга порожня. Статус оперативника: вільний.';
    }

    if (lower.includes('стрік') || lower.includes('streak')) {
        if (ctx.streak >= 7) {
            return `🔥 Стрік: ${ctx.streak} днів безперервної роботи. Рівень: легенда. Системи вражені.`;
        }
        if (ctx.streak > 0) {
            return `🔥 Поточний стрік: ${ctx.streak} днів. Рекомендація: утримувати позицію.`;
        }
        return '🔥 Стрік: 0. Для активації — виконуй місії щодня. Перший день = старт відліку.';
    }

    if (lower.includes('аніматор') || lower.includes('animator')) {
        if (ctx.animatorsToday > 0) {
            return `👥 Сканування персоналу: ${ctx.animatorsToday} оперативників на позиціях. Команда укомплектована.`;
        }
        return '👥 Сканування персоналу: лінії не заповнені. Рекомендую перевірити розклад.';
    }

    if (lower.includes('привіт') || lower.includes('здоров') || lower.includes('hi') || lower.includes('hello')) {
        return '🦀 Клешня онлайн. Системи працюють. Обери тему або задай питання — я готовий до аналізу.';
    }

    if (lower.includes('допомо') || lower.includes('help') || lower.includes('що вмієш')) {
        return '🦀 Доступні модулі аналізу:\n• 📊 Бронювання — скан та статистика\n• 📋 Місії — статус задач\n• 🔥 Стрік — серія активних днів\n• 👥 Команда — персонал на зміні\n\nОбери тему. Розширення модулів — у розробці.';
    }

    // Default
    const defaults = [
        '🦀 Запит отримано. Цей модуль ще в розробці. Спробуй: бронювання, задачі, стрік або аніматори.',
        '🦀 Аналіз запиту... Модуль не знайдено. Доступні теми: бронювання, місії, стрік, команда.',
        '🦀 Обробка... Поки що мої сенсори обмежені. Скоро отримаю апгрейд. Питай про бронювання або задачі.'
    ];
    return defaults[Math.floor(Math.random() * defaults.length)];
}

module.exports = router;
