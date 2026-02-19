/**
 * routes/kleshnya.js — Kleshnya Chat v2.0 API
 *
 * Sessions:
 *   GET    /api/kleshnya/sessions                  — list user sessions
 *   POST   /api/kleshnya/sessions                  — create new session
 *   PUT    /api/kleshnya/sessions/:id              — rename / pin / emoji
 *   DELETE /api/kleshnya/sessions/:id              — delete session + messages
 *   GET    /api/kleshnya/sessions/:id/messages     — session messages (paginated)
 *   DELETE /api/kleshnya/sessions/:id/messages     — clear session messages
 *
 * Chat:
 *   GET    /api/kleshnya/greeting?date=YYYY-MM-DD  — daily greeting (cached)
 *   GET    /api/kleshnya/chat                      — global chat history (backward compat)
 *   POST   /api/kleshnya/chat                      — send message (+ session + bridge)
 *   GET    /api/kleshnya/skills                    — available skills
 *
 * Bridge (OpenClaw polling):
 *   GET    /api/kleshnya/pending-messages           — poll pending messages (secret auth)
 *   POST   /api/kleshnya/sync-chat                  — synchronous chat via local engine (secret auth)
 *   POST   /api/kleshnya/webhook                    — OpenClaw response (secret auth)
 *
 * Reactions:
 *   PATCH  /api/kleshnya/messages/:id/reaction     — like/dislike
 *
 * Media:
 *   GET    /api/kleshnya/media                     — media library
 *   GET    /api/kleshnya/media/:id                 — single media item
 *   GET    /api/kleshnya/media/file/:fileId        — proxy Telegram file download
 */
const router = require('express').Router();
const { pool } = require('../db');
const { getGreeting, getChatHistory, addChatMessage } = require('../services/kleshnya-greeting');
const { generateChatResponse, SKILLS, AI_ENABLED } = require('../services/kleshnya-chat');
const { getPendingMessages, handleWebhookResponse, getTelegramFileUrl,
        BRIDGE_ENABLED, KLESHNYA_WEBHOOK_SECRET } = require('../services/kleshnya-bridge');
const { sendToUsername } = require('../services/websocket');
const { createLogger } = require('../utils/logger');

const log = createLogger('KleshnyaRoute');

// ==========================================
// GENERATION TRIGGERS
// ==========================================

const GENERATION_TRIGGERS = {
    image: {
        patterns: [
            /згенеруй\s+(афішу|зображення|фото|картинку|постер|банер|обкладинку)/i,
            /зроби\s+(афішу|постер|банер|обкладинку|картинку)/i,
            /намалюй/i,
            /створи\s+(зображення|картинку|афішу|постер)/i,
        ],
        label: 'зображення 🎨'
    },
    audio: {
        patterns: [
            /згенеруй\s+(пісню|музику|трек|аудіо)/i,
            /зроби\s+(пісню|трек|музику)/i,
            /створи\s+(пісню|музику|трек)/i,
            /напиши\s+пісню/i,
        ],
        label: 'аудіо 🎵'
    },
    video: {
        patterns: [
            /згенеруй\s+відео/i,
            /зроби\s+відео/i,
            /сними\s+відео/i,
        ],
        label: 'відео 🎬'
    }
};

function detectGenerationTrigger(text) {
    for (const [type, config] of Object.entries(GENERATION_TRIGGERS)) {
        for (const pattern of config.patterns) {
            if (pattern.test(text)) {
                return { type, label: config.label };
            }
        }
    }
    return null;
}

// ==========================================
// SESSIONS CRUD
// ==========================================

// GET /sessions — list user sessions
router.get('/sessions', async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ error: 'Not authenticated' });

        const result = await pool.query(
            `SELECT id, title, emoji, is_pinned, message_count, last_message,
                    last_message_at, created_at, updated_at
             FROM chat_sessions WHERE username = $1
             ORDER BY is_pinned DESC, updated_at DESC`,
            [username]
        );

        res.json(result.rows);
    } catch (err) {
        log.error('Error fetching sessions', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /sessions — create new session
router.post('/sessions', async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ error: 'Not authenticated' });

        const { title, emoji } = req.body;
        const result = await pool.query(
            `INSERT INTO chat_sessions (username, title, emoji)
             VALUES ($1, $2, $3) RETURNING *`,
            [username, title || 'Новий чат', emoji || '💬']
        );

        res.json(result.rows[0]);
    } catch (err) {
        log.error('Error creating session', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /sessions/:id — update session (rename, pin, emoji)
router.put('/sessions/:id', async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ error: 'Not authenticated' });

        const { id } = req.params;
        const { title, emoji, is_pinned } = req.body;

        const sets = [];
        const params = [];
        let i = 1;

        if (title !== undefined) { sets.push(`title = $${i++}`); params.push(title); }
        if (emoji !== undefined) { sets.push(`emoji = $${i++}`); params.push(emoji); }
        if (is_pinned !== undefined) { sets.push(`is_pinned = $${i++}`); params.push(is_pinned); }
        sets.push('updated_at = NOW()');

        if (sets.length === 1) return res.status(400).json({ error: 'Nothing to update' });

        params.push(id, username);

        const result = await pool.query(
            `UPDATE chat_sessions SET ${sets.join(', ')}
             WHERE id = $${i++} AND username = $${i++} RETURNING *`,
            params
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Error updating session', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /sessions/:id — delete session + all messages (CASCADE)
router.delete('/sessions/:id', async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ error: 'Not authenticated' });

        const { id } = req.params;
        const result = await pool.query(
            'DELETE FROM chat_sessions WHERE id = $1 AND username = $2 RETURNING id',
            [id, username]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });
        res.json({ success: true });
    } catch (err) {
        log.error('Error deleting session', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /sessions/:id/messages — paginated messages for session
router.get('/sessions/:id/messages', async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ error: 'Not authenticated' });

        const { id } = req.params;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;

        // Verify ownership
        const session = await pool.query(
            'SELECT id FROM chat_sessions WHERE id = $1 AND username = $2',
            [id, username]
        );
        if (session.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

        const result = await pool.query(
            `SELECT id, role, message, media_type, media_url, media_file_id, media_caption,
                    media_duration, skill_used, is_generating, reaction, created_at
             FROM kleshnya_chat WHERE session_id = $1 AND username = $2
             ORDER BY created_at ASC LIMIT $3 OFFSET $4`,
            [id, username, limit, offset]
        );

        res.json(result.rows);
    } catch (err) {
        log.error('Error fetching session messages', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /sessions/:id/messages — clear session messages (keep session)
router.delete('/sessions/:id/messages', async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ error: 'Not authenticated' });

        const { id } = req.params;
        await pool.query(
            'DELETE FROM kleshnya_chat WHERE session_id = $1 AND username = $2',
            [id, username]
        );
        await pool.query(
            `UPDATE chat_sessions SET message_count = 0, last_message = NULL,
             last_message_at = NULL, updated_at = NOW()
             WHERE id = $1 AND username = $2`,
            [id, username]
        );

        res.json({ success: true });
    } catch (err) {
        log.error('Error clearing session messages', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// GREETING (unchanged)
// ==========================================

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

// ==========================================
// CHAT (upgraded with sessions + bridge)
// ==========================================

// GET /chat — global chat history (backward compat for widget)
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

// POST /chat — send message (session + bridge + local engine)
router.post('/chat', async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ error: 'Not authenticated' });

        const { message, session_id } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const text = message.trim();
        let activeSessionId = session_id || null;

        // If session_id provided, verify it belongs to user
        if (activeSessionId) {
            const check = await pool.query(
                'SELECT id FROM chat_sessions WHERE id = $1 AND username = $2',
                [activeSessionId, username]
            );
            if (check.rows.length === 0) {
                // Auto-create session
                const autoTitle = text.substring(0, 30) + (text.length > 30 ? '...' : '');
                const newSession = await pool.query(
                    'INSERT INTO chat_sessions (username, title) VALUES ($1, $2) RETURNING id',
                    [username, autoTitle]
                );
                activeSessionId = newSession.rows[0].id;
            }
        }

        // Save user message
        const savedUser = await addChatMessage(username, 'user', text, activeSessionId);

        // Update session metadata
        if (activeSessionId) {
            await pool.query(
                `UPDATE chat_sessions SET message_count = message_count + 1,
                 last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
                [text.substring(0, 100), activeSessionId]
            );
        }

        // --- Bridge path: mark as pending for OpenClaw polling ---
        if (BRIDGE_ENABLED && activeSessionId) {
            const genTrigger = detectGenerationTrigger(text);

            // Mark message as pending (OpenClaw will pick it up via GET /pending-messages)
            await pool.query(
                'UPDATE kleshnya_chat SET is_generating = TRUE WHERE id = $1',
                [savedUser.id]
            );

            // Broadcast thinking event
            sendToUsername(username, 'kleshnya:thinking', { session_id: activeSessionId });

            return res.json({
                status: 'pending',
                session_id: activeSessionId,
                message_id: savedUser.id,
                action: genTrigger ? 'generating' : 'thinking',
                generation: genTrigger ? { skill: genTrigger.type, prompt: text } : undefined,
                message: genTrigger
                    ? `Зараз створюю ${genTrigger.label}! ⏳ ~30 сек...`
                    : undefined
            });
        }

        // --- Local engine path: AI + skills ---
        const chatHistory = AI_ENABLED
            ? await getChatHistory(username, 20, activeSessionId)
            : [];
        const result = await generateChatResponse(text, username, chatHistory);

        // Save assistant response
        const saved = await addChatMessage(
            username, 'assistant', result.message, activeSessionId, result.skill_used
        );

        // Update session
        if (activeSessionId) {
            await pool.query(
                `UPDATE chat_sessions SET message_count = message_count + 1,
                 last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
                [result.message.substring(0, 100), activeSessionId]
            );
        }

        res.json({
            role: 'assistant',
            message: result.message,
            session_id: activeSessionId,
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

// ==========================================
// BRIDGE: POLLING + WEBHOOK (OpenClaw — secret auth)
// ==========================================

// GET /pending-messages — OpenClaw polls this to get new messages
router.get('/pending-messages', async (req, res) => {
    try {
        // Auth via query param or header (OpenClaw sends secret)
        const secret = req.query.secret || req.headers['x-webhook-secret'];

        if (!KLESHNYA_WEBHOOK_SECRET || secret !== KLESHNYA_WEBHOOK_SECRET) {
            return res.status(403).json({ error: 'Invalid secret' });
        }

        const messages = await getPendingMessages();
        res.json({ messages });
    } catch (err) {
        log.error('Error fetching pending messages', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /sync-chat — synchronous chat via local engine (for OpenClaw bridge)
// Auth: X-Webhook-Secret (NOT JWT). Always uses local engine, never queues to pending.
router.post('/sync-chat', async (req, res) => {
    try {
        const secret = req.headers['x-webhook-secret'] || req.query.secret;
        if (!KLESHNYA_WEBHOOK_SECRET || secret !== KLESHNYA_WEBHOOK_SECRET) {
            return res.status(403).json({ error: 'Invalid secret' });
        }

        const { username, message, session_id } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'message is required' });
        }
        if (!username) {
            return res.status(400).json({ error: 'username is required' });
        }

        const text = message.trim();
        let activeSessionId = session_id || null;

        // Verify session exists (or auto-create)
        if (activeSessionId) {
            const check = await pool.query(
                'SELECT id FROM chat_sessions WHERE id = $1 AND username = $2',
                [activeSessionId, username]
            );
            if (check.rows.length === 0) {
                const autoTitle = text.substring(0, 30) + (text.length > 30 ? '...' : '');
                const newSession = await pool.query(
                    'INSERT INTO chat_sessions (username, title) VALUES ($1, $2) RETURNING id',
                    [username, autoTitle]
                );
                activeSessionId = newSession.rows[0].id;
            }
        }

        // Save user message
        const savedUser = await addChatMessage(username, 'user', text, activeSessionId);

        if (activeSessionId) {
            await pool.query(
                `UPDATE chat_sessions SET message_count = message_count + 1,
                 last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
                [text.substring(0, 100), activeSessionId]
            );
        }

        // Generate response via local engine (always sync, never pending)
        const chatHistory = AI_ENABLED
            ? await getChatHistory(username, 20, activeSessionId)
            : [];
        const result = await generateChatResponse(text, username, chatHistory);

        // Save assistant response
        const saved = await addChatMessage(
            username, 'assistant', result.message, activeSessionId, result.skill_used
        );

        if (activeSessionId) {
            await pool.query(
                `UPDATE chat_sessions SET message_count = message_count + 1,
                 last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
                [result.message.substring(0, 100), activeSessionId]
            );
        }

        // Broadcast via WebSocket so CRM UI updates in real-time
        sendToUsername(username, 'kleshnya:reply', {
            id: saved.id,
            role: 'assistant',
            message: result.message,
            created_at: saved.created_at,
            source: result.source || 'skills',
            session_id: activeSessionId
        });

        log.info(`sync-chat: replied to "${text.substring(0, 40)}" for ${username}`);

        res.json({
            role: 'assistant',
            message: result.message,
            session_id: activeSessionId,
            suggestions: result.suggestions || [],
            id: saved.id,
            created_at: saved.created_at,
            source: result.source || 'skills'
        });
    } catch (err) {
        log.error('Error in sync-chat', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /webhook — OpenClaw sends responses here
router.post('/webhook', async (req, res) => {
    try {
        // Accept secret from X-Webhook-Secret header (OpenClaw) or body.secret (fallback)
        const secret = req.headers['x-webhook-secret'] || req.body.secret;

        // Validate webhook secret
        if (!KLESHNYA_WEBHOOK_SECRET || secret !== KLESHNYA_WEBHOOK_SECRET) {
            log.warn('Webhook: invalid or missing secret');
            return res.status(403).json({ error: 'Invalid secret' });
        }

        const wsEvent = await handleWebhookResponse(req.body);

        if (wsEvent) {
            // Broadcast to user via WebSocket
            sendToUsername(wsEvent.username, wsEvent.type, wsEvent.message);
            log.info(`Webhook: ${wsEvent.type} broadcast to ${wsEvent.username}`);
        }

        res.json({ ok: true });
    } catch (err) {
        log.error('Webhook error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// REACTIONS
// ==========================================

router.patch('/messages/:id/reaction', async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ error: 'Not authenticated' });

        const { id } = req.params;
        const { reaction } = req.body; // '👍' | '👎' | null

        const result = await pool.query(
            'UPDATE kleshnya_chat SET reaction = $1 WHERE id = $2 AND username = $3 RETURNING id, reaction',
            [reaction || null, id, username]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Message not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Error updating reaction', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// MEDIA
// ==========================================

// GET /media — media library for user
router.get('/media', async (req, res) => {
    try {
        const username = req.user?.username;
        if (!username) return res.status(401).json({ error: 'Not authenticated' });

        const type = req.query.type;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const offset = parseInt(req.query.offset) || 0;

        let query = 'SELECT * FROM kleshnya_media WHERE created_by = $1';
        const params = [username];
        let i = 2;

        if (type) {
            query += ` AND type = $${i++}`;
            params.push(type);
        }

        query += ` ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        log.error('Error fetching media', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /media/:id — single media item
router.get('/media/:id', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM kleshnya_media WHERE id = $1',
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Media not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        log.error('Error fetching media item', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /media/file/:fileId — proxy Telegram file download
router.get('/media/file/:fileId', async (req, res) => {
    try {
        const url = await getTelegramFileUrl(req.params.fileId);
        if (!url) {
            return res.status(404).json({ error: 'File not found' });
        }
        res.redirect(url);
    } catch (err) {
        log.error('Error proxying media file', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==========================================
// SKILLS (unchanged)
// ==========================================

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
