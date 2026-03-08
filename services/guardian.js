/**
 * services/guardian.js — Guardian AI Agent 🛡️ v2.0
 *
 * Silent watcher mode:
 * - NO public messages in channels (eyes watch from above)
 * - Masks sensitive data silently (edits message, no announcement)
 * - DMs director with real-time incident alerts
 * - Broadcasts guardian:event for live security log panel
 * - Mood system: emoji changes periodically based on channel health
 * - Memory: stores context for AI analysis
 *
 * Uses Claude Haiku for conflict detection + daily reports.
 * Sensitive data masking works without AI (regex-based).
 */

const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { broadcastToChannel, sendToUser, broadcast } = require('./websocket');
const Anthropic = require('@anthropic-ai/sdk');

const log = createLogger('Guardian');

const GUARDIAN_USERNAME = 'guardian';
const MUTE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// AI setup
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AI_ENABLED = !!ANTHROPIC_API_KEY;
let anthropic = null;
if (AI_ENABLED) {
    anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    log.info('Guardian AI enabled');
}

// Cache guardian user ID
let _guardianUserId = null;

// Guardian mood system
const MOODS = [
    { emoji: '😊', label: 'Все спокійно', level: 'calm' },
    { emoji: '🧐', label: 'Аналізую...', level: 'watching' },
    { emoji: '😴', label: 'Тихо тут...', level: 'idle' },
    { emoji: '🤨', label: 'Щось підозріле', level: 'alert' },
    { emoji: '😤', label: 'Порушення!', level: 'angry' },
    { emoji: '🫡', label: 'Все під контролем', level: 'salute' },
    { emoji: '👀', label: 'Спостерігаю', level: 'default' },
    { emoji: '🛡️', label: 'Захищаю', level: 'protect' },
    { emoji: '☕', label: 'Перерва', level: 'break' },
    { emoji: '🎯', label: 'Зосереджений', level: 'focused' }
];

let _currentMood = { emoji: '👀', label: 'Спостерігаю', level: 'default' };
let _moodHistory = []; // last 20 mood changes
let _channelHealth = {}; // { channelId: { score: 0-100, lastIncident: timestamp } }
const _guardianMemory = {}; // { channelId: { events: [], context: '' } }

// Director user ID cache
let _directorUserId = null;

async function getGuardianUserId() {
    if (_guardianUserId) return _guardianUserId;
    try {
        const result = await pool.query(
            "SELECT id FROM users WHERE username = $1", [GUARDIAN_USERNAME]
        );
        _guardianUserId = result.rows[0]?.id;
        if (!_guardianUserId) {
            // Create guardian user if missing
            const ins = await pool.query(
                "INSERT INTO users (username, password_hash, name, role) VALUES ($1, '$2b$10$placeholder', 'Guardian 🛡️', 'bot') ON CONFLICT (username) DO UPDATE SET name = 'Guardian 🛡️' RETURNING id",
                [GUARDIAN_USERNAME]
            );
            _guardianUserId = ins.rows[0].id;
        }
    } catch (e) {
        log.error('Failed to get guardian user ID', e);
        _guardianUserId = null;
    }
    return _guardianUserId;
}

// ==========================================
// 1. SENSITIVE DATA MASKING
// ==========================================

const SENSITIVE_PATTERNS = [
    // Credit/debit card numbers: 13-19 digit sequences (with optional spaces/dashes)
    { regex: /\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})[\s-]?(\d{1,7})\b/g, replace: '$1 **** **** ****', type: 'card' },
    // Long digit sequences (5+ groups of 4) — catch-all for badly formatted cards
    { regex: /\b(\d{4})[\s-](\d{4})[\s-](\d{4})[\s-](\d{4})[\s-](\d{1,4})\b/g, replace: '$1 **** **** **** ****', type: 'card' },
    // Ukrainian phone: +380XXXXXXXXX, 380XXXXXXXXX, 0XXXXXXXXX
    { regex: /(\+?3?8?0)\s?(\d{2})\s?(\d{3})\s?(\d{2})\s?(\d{2})/g, replace: '+380 ** *** ** $5', type: 'phone' },
    // International phone
    { regex: /\+\d{1,3}\s?\d{2,4}\s?\d{3,4}\s?\d{2,4}/g, replace: '+*** **** ****', type: 'phone' },
    // IBAN
    { regex: /\b(UA)\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/gi, replace: 'UA** **** **** **** ****', type: 'iban' },
    // Email addresses
    { regex: /\b([a-zA-Z0-9._%+-]{1,2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, replace: '$1***@$2', type: 'email' },
    // Passport numbers (Ukrainian)
    { regex: /\b[А-ЯІЇЄҐA-Z]{2}\s?\d{6}\b/g, replace: '** ******', type: 'passport' },
    // ІПН/РНОКПП (Ukrainian tax ID, 10 digits)
    { regex: /\b\d{10}\b/g, replace: '**********', type: 'tax_id' },
];

/**
 * Check if message contains sensitive data and mask it.
 * Returns { hasSensitive, maskedContent, types[] } or null if clean.
 */
function detectAndMaskSensitive(content) {
    if (!content || content.length < 8) return null;

    let masked = content;
    const detectedTypes = [];
    let hasSensitive = false;

    for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.regex.test(masked)) {
            hasSensitive = true;
            detectedTypes.push(pattern.type);
            // Reset regex lastIndex
            pattern.regex.lastIndex = 0;
            masked = masked.replace(pattern.regex, pattern.replace);
        }
    }

    if (!hasSensitive) return null;

    return {
        hasSensitive: true,
        maskedContent: masked,
        types: [...new Set(detectedTypes)]
    };
}

/**
 * Mask sensitive data in a message and update in DB.
 * Returns true if message was modified.
 */
async function maskSensitiveInMessage(messageId, channelId, content, username) {
    const result = detectAndMaskSensitive(content);
    if (!result) return false;

    try {
        // Update message content in DB — SILENTLY (no public notice)
        await pool.query(
            'UPDATE chat_messages SET content = $1, edited_at = NOW() WHERE id = $2',
            [result.maskedContent, messageId]
        );

        // Log action
        await logAction('mask', channelId, null, messageId, {
            types: result.types,
            originalLength: content.length,
            username
        });

        // Broadcast edit to channel (message updates silently in UI)
        broadcastToChannel(channelId, 'chat:message-edited', {
            channelId,
            messageId,
            content: result.maskedContent,
            editedAt: new Date().toISOString()
        });

        // Update mood to protective
        setMood('protect', channelId);

        // Broadcast guardian event for security log panel
        broadcastGuardianEvent({
            type: 'mask',
            channelId,
            username,
            details: `Замасковано: ${result.types.join(', ')}`,
            severity: 'warning'
        });

        // DM director about the incident
        await alertDirector(
            `🛡️ <b>Маскування даних</b>\n` +
            `Канал: #${await getChannelSlug(channelId)}\n` +
            `Користувач: @${username}\n` +
            `Тип: ${result.types.join(', ')}`
        );

        log.info(`Masked sensitive data [${result.types.join(',')}] in msg:${messageId} by ${username}`);
        return true;
    } catch (err) {
        log.error('Failed to mask sensitive data', err);
        return false;
    }
}

// ==========================================
// 2. CONFLICT DETECTION
// ==========================================

// Recent messages per channel for conflict analysis
const _recentMessages = {};
const CONFLICT_WINDOW = 5; // analyze last N messages

// Track muted users: { `${channelId}:${userId}`: mutedUntilTimestamp }
const _activeMutes = {};

/**
 * Check if user is currently muted in channel.
 */
function isUserMuted(channelId, userId) {
    const key = `${channelId}:${userId}`;
    const until = _activeMutes[key];
    if (!until) return false;
    if (Date.now() > until) {
        delete _activeMutes[key];
        return false;
    }
    return true;
}

/**
 * Mute user in channel for 15 minutes.
 */
async function muteUser(channelId, userId, username, reason) {
    const mutedUntil = new Date(Date.now() + MUTE_DURATION_MS);
    const key = `${channelId}:${userId}`;
    _activeMutes[key] = mutedUntil.getTime();

    try {
        await pool.query(
            'INSERT INTO chat_mutes (channel_id, user_id, reason, muted_until) VALUES ($1, $2, $3, $4)',
            [channelId, userId, reason, mutedUntil]
        );

        await logAction('mute', channelId, userId, null, { reason, until: mutedUntil, username });

        // NO public message — just broadcast mute event (user sees mute countdown overlay)
        broadcastToChannel(channelId, 'chat:user-muted', {
            channelId,
            userId,
            username,
            mutedUntil: mutedUntil.toISOString(),
            reason
        });

        // Update mood to angry
        setMood('angry', channelId);

        // Broadcast guardian event for security log panel
        broadcastGuardianEvent({
            type: 'mute',
            channelId,
            username,
            details: `Заблоковано на 15 хв: ${reason}`,
            severity: 'danger'
        });

        // DM director about mute
        await alertDirector(
            `🚨 <b>Блокування користувача</b>\n` +
            `Канал: #${await getChannelSlug(channelId)}\n` +
            `Користувач: @${username}\n` +
            `Причина: ${reason}\n` +
            `До: ${mutedUntil.toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' })}`
        );

        log.info(`Muted ${username} (id:${userId}) in ch:${channelId} until ${mutedUntil.toISOString()}`);
    } catch (err) {
        log.error('Failed to mute user', err);
    }
}

// Aggressive words/phrases for quick detection (no AI needed)
const TOXIC_KEYWORDS = [
    'дурак', 'дурень', 'ідіот', 'тупий', 'тупа', 'кретин',
    'мудак', 'сука', 'бля', 'нахуй', 'нахій', 'піди на',
    'заткнись', 'заткнися', 'рот закрий',
    'пішов нафіг', 'пішла нафіг', 'пошел нафиг',
    'придурок', 'дебіл', 'дебил', 'лох', 'лошок',
    'fuck', 'shit', 'stfu', 'idiot', 'stupid'
];

/**
 * Quick keyword-based toxicity check.
 */
function quickToxicityCheck(content) {
    const lower = content.toLowerCase();
    const found = TOXIC_KEYWORDS.filter(word => lower.includes(word));
    return found.length > 0 ? found : null;
}

/**
 * AI-based conflict detection for ambiguous cases.
 * Analyzes last N messages in context.
 */
async function aiConflictCheck(messages) {
    if (!AI_ENABLED || !anthropic) return null;

    try {
        const chatLog = messages.map(m =>
            `[${m.username}]: ${m.content}`
        ).join('\n');

        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            system: `Ти — модератор чату. Проаналізуй останні повідомлення і визнач чи є конфлікт або агресія.
Відповідай ТІЛЬКИ у форматі JSON: {"conflict": true/false, "severity": "low"/"medium"/"high", "aggressors": ["username"], "reason": "короткий опис"}
Якщо конфлікту немає — {"conflict": false}
Враховуй контекст: жарти та легке підколювання — це нормально. Шукай справжню агресію та образи.`,
            messages: [{ role: 'user', content: chatLog }]
        });

        const text = response.content[0]?.text?.trim();
        if (!text) return null;

        // Parse JSON response
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return null;

        return JSON.parse(match[0]);
    } catch (err) {
        log.error('AI conflict check failed', err.message);
        return null;
    }
}

/**
 * Analyze message for conflicts. Mute if necessary.
 */
async function analyzeConflict(channelId, userId, username, content) {
    // Track recent messages
    if (!_recentMessages[channelId]) _recentMessages[channelId] = [];
    _recentMessages[channelId].push({ username, content, userId, ts: Date.now() });
    if (_recentMessages[channelId].length > CONFLICT_WINDOW * 2) {
        _recentMessages[channelId] = _recentMessages[channelId].slice(-CONFLICT_WINDOW);
    }

    // 1. Quick keyword check
    const toxicWords = quickToxicityCheck(content);
    if (toxicWords) {
        await muteUser(channelId, userId, username, `Нецензурна лексика: ${toxicWords.slice(0, 2).join(', ')}...`);
        return true;
    }

    // 2. AI check for subtle conflicts (if we have enough context)
    const recent = _recentMessages[channelId];
    if (recent.length >= 3 && AI_ENABLED) {
        const aiResult = await aiConflictCheck(recent.slice(-CONFLICT_WINDOW));
        if (aiResult && aiResult.conflict && aiResult.severity !== 'low') {
            // Find aggressors in recent messages
            const aggressors = aiResult.aggressors || [];
            for (const aggressorName of aggressors) {
                const aggressorMsg = recent.find(m => m.username === aggressorName);
                if (aggressorMsg && aggressorMsg.userId) {
                    await muteUser(channelId, aggressorMsg.userId, aggressorName,
                        aiResult.reason || 'Конфліктна поведінка');
                }
            }
            return aggressors.length > 0;
        }
    }

    return false;
}

// ==========================================
// 3. DAILY REPORTS
// ==========================================

/**
 * Collect important messages from a channel for a date range.
 */
async function collectImportantMessages(channelId, dateStr) {
    try {
        const result = await pool.query(`
            SELECT cm.id, cm.content, cm.created_at, u.username, u.name AS display_name
            FROM chat_messages cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.channel_id = $1
              AND cm.created_at::date = $2::date
              AND cm.deleted_at IS NULL
              AND cm.is_bot = false
              AND LENGTH(cm.content) > 20
            ORDER BY cm.created_at
        `, [channelId, dateStr]);

        return result.rows;
    } catch (err) {
        log.error('Failed to collect messages', err);
        return [];
    }
}

/**
 * Generate daily report for a channel using AI.
 */
async function generateDailyReport(channelId, dateStr) {
    const messages = await collectImportantMessages(channelId, dateStr);
    if (messages.length === 0) return null;

    // Get channel info
    const chResult = await pool.query('SELECT name, slug FROM chat_channels WHERE id = $1', [channelId]);
    const channel = chResult.rows[0];

    // Get guardian actions for this day
    const actionsResult = await pool.query(`
        SELECT action_type, COUNT(*) cnt
        FROM guardian_actions
        WHERE channel_id = $1 AND created_at::date = $2::date
        GROUP BY action_type
    `, [channelId, dateStr]);
    const actionCounts = {};
    actionsResult.rows.forEach(r => { actionCounts[r.action_type] = parseInt(r.cnt); });

    if (!AI_ENABLED) {
        // Simple report without AI
        const summary = `📊 Звіт за ${dateStr} | #${channel?.slug || channelId}\n` +
            `Повідомлень: ${messages.length}\n` +
            `Блокувань: ${actionCounts.mute || 0}\n` +
            `Замасковано: ${actionCounts.mask || 0}`;

        await saveReport(channelId, dateStr, summary, [], actionCounts.mute || 0, actionCounts.mask || 0);
        return summary;
    }

    // AI-powered report
    try {
        const chatLog = messages.map(m =>
            `[${new Date(m.created_at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}] ${m.username}: ${m.content}`
        ).join('\n');

        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 600,
            system: `Ти — Guardian, AI-модератор корпоративного чату розважального парку.
Створи короткий щоденний звіт з чату. Формат:

📊 <b>Звіт за [дата]</b> | #${channel?.slug || 'канал'}

<b>Головне:</b>
- Основні теми обговорення (2-3 пункти)

<b>Важливе:</b>
- Рішення, домовленості, або терміни які згадувались

<b>Модерація:</b>
- Блокувань: X, Замасковано даних: Y

Пиши українською, лаконічно. Ігноруй дрібні привітання та переписки.`,
            messages: [{ role: 'user', content: `Повідомлення за ${dateStr}:\n\n${chatLog}` }]
        });

        const summary = response.content[0]?.text || 'Не вдалось згенерувати звіт';

        // Extract important messages (mentioned decisions/deadlines)
        const important = messages.filter(m =>
            /терміново|дедлайн|завтра до|домовились|вирішили|треба зробити|план|бронюван/i.test(m.content)
        ).map(m => ({
            id: m.id,
            username: m.username,
            content: m.content.substring(0, 200),
            time: m.created_at
        }));

        await saveReport(channelId, dateStr, summary, important, actionCounts.mute || 0, actionCounts.mask || 0);

        log.info(`Daily report generated for ch:${channelId} date:${dateStr}, ${messages.length} messages analyzed`);
        return summary;
    } catch (err) {
        log.error('Failed to generate AI report', err);
        return null;
    }
}

async function saveReport(channelId, dateStr, summary, importantMessages, conflicts, masked) {
    try {
        await pool.query(`
            INSERT INTO guardian_reports (report_date, channel_id, summary, important_messages, conflicts_detected, sensitive_masked)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (report_date, channel_id) DO UPDATE SET
                summary = EXCLUDED.summary,
                important_messages = EXCLUDED.important_messages,
                conflicts_detected = EXCLUDED.conflicts_detected,
                sensitive_masked = EXCLUDED.sensitive_masked
        `, [dateStr, channelId, summary, JSON.stringify(importantMessages), conflicts, masked]);
    } catch (err) {
        log.error('Failed to save report', err);
    }
}

/**
 * Generate and post daily reports for all channels with the guardian.
 * Called by scheduler at end of day.
 */
async function runDailyReports() {
    const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });
    log.info(`Running daily reports for ${dateStr}`);

    try {
        // Find channels where guardian is a member
        const guardianId = await getGuardianUserId();
        if (!guardianId) return;

        const channels = await pool.query(`
            SELECT c.id, c.name, c.slug
            FROM chat_channels c
            JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = $1
            WHERE c.is_dm = false OR c.is_dm IS NULL
        `, [guardianId]);

        for (const ch of channels.rows) {
            const report = await generateDailyReport(ch.id, dateStr);
            if (report) {
                await sendGuardianMessage(ch.id, report);
            }
        }

        log.info(`Daily reports completed for ${channels.rows.length} channels`);
    } catch (err) {
        log.error('Daily reports failed', err);
    }
}

// ==========================================
// GUARDIAN MESSAGE SENDING
// ==========================================

/**
 * Send a message as the Guardian bot.
 */
async function sendGuardianMessage(channelId, content) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const seqResult = await client.query('SELECT next_chat_seq($1) AS seq', [channelId]);
        const seq = seqResult.rows[0].seq;
        const guardianId = await getGuardianUserId();
        if (!guardianId) {
            await client.query('ROLLBACK');
            return null;
        }

        const result = await client.query(`
            INSERT INTO chat_messages (channel_id, user_id, seq, content, is_bot, content_type, metadata)
            VALUES ($1, $2, $3, $4, true, 'bot', '{"source":"guardian"}')
            RETURNING *
        `, [channelId, guardianId, seq, content]);
        await client.query('COMMIT');

        const msg = result.rows[0];
        const full = await pool.query(`
            SELECT cm.*, u.username, u.name AS display_name
            FROM chat_messages cm JOIN users u ON u.id = cm.user_id
            WHERE cm.id = $1
        `, [msg.id]);

        const mapped = {
            id: full.rows[0].id,
            channelId: full.rows[0].channel_id,
            userId: full.rows[0].user_id,
            seq: full.rows[0].seq,
            content: full.rows[0].content,
            isBot: true,
            contentType: 'bot',
            createdAt: full.rows[0].created_at,
            username: GUARDIAN_USERNAME,
            displayName: 'Guardian 🛡️'
        };

        broadcastToChannel(channelId, 'chat:message', { channelId, message: mapped });
        return mapped;
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('Failed to send guardian message', err);
        return null;
    } finally {
        client.release();
    }
}

// ==========================================
// MAIN ENTRY: Process each message
// ==========================================

/**
 * Process an incoming message through the guardian pipeline.
 * Called from chat route AFTER message is saved.
 *
 * Pipeline:
 *   1. Check if user is muted → block
 *   2. Mask sensitive data
 *   3. Analyze for conflicts
 */
async function processMessage(message) {
    if (!message || !message.content) return { blocked: false };

    // Don't process bot messages
    if (message.isBot || message.username === GUARDIAN_USERNAME || message.username === 'openclaw') {
        return { blocked: false };
    }

    const { channelId, userId, content, username, id: messageId } = message;

    // 1. Check if muted
    if (isUserMuted(channelId, userId)) {
        log.info(`Blocked muted user ${username} in ch:${channelId}`);
        return {
            blocked: true,
            reason: 'muted',
            message: '🛡️ Ви заблоковані в цьому чаті. Зачекайте 15 хвилин.'
        };
    }

    // Briefly flash "watching" mood on new message
    if (_currentMood.level === 'calm' || _currentMood.level === 'idle' || _currentMood.level === 'break') {
        setMood('watching', channelId);
    }

    // Broadcast scan event for live log
    broadcastGuardianEvent({
        type: 'scan',
        channelId,
        username,
        details: `Повідомлення перевірено (${content.length} символів)`,
        severity: 'info'
    });

    // 2. Mask sensitive data (fire-and-forget)
    maskSensitiveInMessage(messageId, channelId, content, username).catch(err => {
        log.error('Masking error', err);
    });

    // 3. Analyze conflicts silently (no typing indicator shown)
    (async () => {
        try {
            await analyzeConflict(channelId, userId, username, content);
        } catch (err) {
            log.error('Conflict analysis error', err);
        }
    })();

    return { blocked: false };
}

// ==========================================
// ACTION LOGGING
// ==========================================

async function logAction(actionType, channelId, targetUserId, messageId, details) {
    try {
        await pool.query(
            'INSERT INTO guardian_actions (action_type, channel_id, target_user_id, message_id, details) VALUES ($1, $2, $3, $4, $5)',
            [actionType, channelId, targetUserId, messageId, JSON.stringify(details)]
        );
    } catch (err) {
        log.error('Failed to log guardian action', err);
    }
}

// ==========================================
// ENSURE GUARDIAN MEMBERSHIPS
// ==========================================

async function ensureGuardianMemberships() {
    try {
        const guardianId = await getGuardianUserId();
        if (!guardianId) return;

        await pool.query(`
            INSERT INTO chat_channel_members (channel_id, user_id)
            SELECT c.id, $1 FROM chat_channels c WHERE c.is_default = true
            ON CONFLICT (channel_id, user_id) DO NOTHING
        `, [guardianId]);

        log.info(`Guardian memberships ensured (id: ${guardianId})`);
    } catch (err) {
        log.error('Failed to ensure guardian memberships', err);
    }
}

// ==========================================
// MOOD SYSTEM
// ==========================================

function setMood(level, channelId) {
    const mood = MOODS.find(m => m.level === level) || MOODS.find(m => m.level === 'default');
    const prev = _currentMood;
    _currentMood = mood;
    _moodHistory.push({ ...mood, ts: Date.now(), channelId });
    if (_moodHistory.length > 20) _moodHistory = _moodHistory.slice(-20);

    // Broadcast mood change to all clients
    broadcast('guardian:mood', {
        emoji: mood.emoji,
        label: mood.label,
        level: mood.level,
        prevEmoji: prev.emoji
    });

    // Auto-reset to calm/watching after 30s if angry/alert
    if (level === 'angry' || level === 'alert' || level === 'protect') {
        setTimeout(() => {
            if (_currentMood.level === level) {
                setMood('salute', channelId);
            }
        }, 30000);
    }
}

function getMood() {
    return _currentMood;
}

// Periodic mood changes based on channel activity
function startMoodCycle() {
    setInterval(() => {
        // If no incidents for 5 min → calm/idle
        const now = Date.now();
        const lastEvent = _moodHistory.length > 0 ? _moodHistory[_moodHistory.length - 1].ts : 0;
        const elapsed = now - lastEvent;

        if (_currentMood.level === 'angry' || _currentMood.level === 'protect') return; // Don't override active states

        if (elapsed > 10 * 60 * 1000) {
            // 10+ min idle
            const idleMoods = ['idle', 'break', 'calm'];
            setMood(idleMoods[Math.floor(Math.random() * idleMoods.length)]);
        } else if (elapsed > 3 * 60 * 1000) {
            // 3-10 min → watching
            const watchMoods = ['default', 'focused', 'calm'];
            setMood(watchMoods[Math.floor(Math.random() * watchMoods.length)]);
        }
    }, 60000); // Check every minute
}

// ==========================================
// DIRECTOR ALERTS (DM)
// ==========================================

async function getDirectorUserId() {
    if (_directorUserId) return _directorUserId;
    try {
        // Director = first admin user (by id)
        const result = await pool.query(
            "SELECT id FROM users WHERE role = 'admin' AND is_active = true ORDER BY id LIMIT 1"
        );
        if (result.rows.length > 0) {
            _directorUserId = result.rows[0].id;
        }
        return _directorUserId;
    } catch (err) {
        log.error('Failed to find director', err);
        return null;
    }
}

async function alertDirector(content) {
    try {
        const directorId = await getDirectorUserId();
        if (!directorId) return;

        // Find or create DM channel with Guardian
        const guardianId = await getGuardianUserId();
        if (!guardianId) return;

        let dmChannel = await pool.query(`
            SELECT c.id FROM chat_channels c
            JOIN chat_channel_members m1 ON m1.channel_id = c.id AND m1.user_id = $1
            JOIN chat_channel_members m2 ON m2.channel_id = c.id AND m2.user_id = $2
            WHERE c.is_dm = true
            LIMIT 1
        `, [guardianId, directorId]);

        let channelId;
        if (dmChannel.rows.length > 0) {
            channelId = dmChannel.rows[0].id;
        } else {
            // Create DM channel
            const ch = await pool.query(`
                INSERT INTO chat_channels (name, slug, is_dm, created_by)
                VALUES ('Guardian → Director', 'dm-guardian-director', true, $1)
                RETURNING id
            `, [guardianId]);
            channelId = ch.rows[0].id;
            await pool.query('INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)', [channelId, guardianId, directorId]);
        }

        // Send DM message
        await sendGuardianMessage(channelId, content);

        log.info(`Alert sent to director: ${content.substring(0, 50)}...`);
    } catch (err) {
        log.error('Failed to alert director', err);
    }
}

// ==========================================
// GUARDIAN EVENT BROADCASTING (Security Log)
// ==========================================

function broadcastGuardianEvent(event) {
    const payload = {
        ...event,
        timestamp: new Date().toISOString(),
        mood: _currentMood
    };

    // Store in memory for channel context
    if (event.channelId) {
        if (!_guardianMemory[event.channelId]) {
            _guardianMemory[event.channelId] = { events: [], context: '' };
        }
        _guardianMemory[event.channelId].events.push(payload);
        // Keep last 50 events per channel
        if (_guardianMemory[event.channelId].events.length > 50) {
            _guardianMemory[event.channelId].events = _guardianMemory[event.channelId].events.slice(-50);
        }
    }

    // Broadcast to all connected admins via WebSocket
    broadcast('guardian:event', payload);
}

async function getChannelSlug(channelId) {
    try {
        const r = await pool.query('SELECT slug FROM chat_channels WHERE id = $1', [channelId]);
        return r.rows[0]?.slug || String(channelId);
    } catch { return String(channelId); }
}

function getGuardianState() {
    return {
        mood: _currentMood,
        moodHistory: _moodHistory.slice(-10),
        channelHealth: _channelHealth,
        memory: Object.fromEntries(
            Object.entries(_guardianMemory).map(([k, v]) => [k, { eventCount: v.events.length, lastEvent: v.events[v.events.length - 1] }])
        )
    };
}

// Start mood cycle on load
startMoodCycle();

module.exports = {
    processMessage,
    isUserMuted,
    detectAndMaskSensitive,
    generateDailyReport,
    runDailyReports,
    ensureGuardianMemberships,
    sendGuardianMessage,
    getMood,
    getGuardianState,
    broadcastGuardianEvent,
    alertDirector,
    GUARDIAN_USERNAME
};
