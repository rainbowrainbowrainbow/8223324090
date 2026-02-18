/**
 * routes/kleshnya.js — Kleshnya greeting & chat API (v12.8)
 *
 * GET  /api/kleshnya/greeting?date=YYYY-MM-DD — get daily greeting (cached 4h)
 * GET  /api/kleshnya/chat                      — get chat history
 * POST /api/kleshnya/chat                      — add user message + get AI/skill response
 * GET  /api/kleshnya/skills                    — list available skills
 */
const router = require('express').Router();
const { getGreeting, getChatHistory, addChatMessage } = require('../services/kleshnya-greeting');
const { generateChatResponse, SKILLS, AI_ENABLED } = require('../services/kleshnya-chat');
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

// POST message to chat — AI + skill fallback
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

        // Get chat history for AI context
        const chatHistory = AI_ENABLED ? await getChatHistory(username, 20) : [];

        // Generate response via AI or skill engine
        const result = await generateChatResponse(message.trim(), username, chatHistory);

        // Save assistant response
        const saved = await addChatMessage(username, 'assistant', result.message);

        res.json({
            role: 'assistant',
            message: result.message,
            suggestions: result.suggestions || [],
            id: saved.id,
            created_at: saved.created_at,
            source: result.source || 'skills'
        });
    } catch (err) {
        log.error('Error in chat', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET available skills
router.get('/skills', (req, res) => {
    const skills = SKILLS.map(s => ({
        id: s.id,
        name: s.name,
        icon: s.icon,
        description: s.description,
        examples: s.examples
    }));
    res.json(skills);
});

module.exports = router;
