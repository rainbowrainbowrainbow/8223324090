/**
 * services/guardian.js — Guardian AI Agent 🛡️
 *
 * AI-powered chat moderator that:
 * 1. Collects important messages for daily reports
 * 2. Detects conflicts/arguments and mutes users for 15 min
 * 3. Masks sensitive data (phone numbers, card numbers, emails, etc.)
 *
 * Uses Claude Haiku for conflict detection.
 * Sensitive data masking works without AI (regex-based).
 */

const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { broadcastToChannel } = require('./websocket');
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
    // Ukrainian phone: +380XXXXXXXXX, 380XXXXXXXXX, 0XXXXXXXXX
    { regex: /(\+?3?8?0)\s?(\d{2})\s?(\d{3})\s?(\d{2})\s?(\d{2})/g, replace: '+380 ** *** ** $5', type: 'phone' },
    // International phone
    { regex: /\+\d{1,3}\s?\d{2,4}\s?\d{3,4}\s?\d{2,4}/g, replace: '+*** **** ****', type: 'phone' },
    // Credit/debit card numbers
    { regex: /\b(\d{4})\s?(\d{4})\s?(\d{4})\s?(\d{4})\b/g, replace: '$1 **** **** $4', type: 'card' },
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
        // Update message content in DB
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

        // Broadcast edit to channel
        broadcastToChannel(channelId, 'chat:message-edited', {
            channelId,
            messageId,
            content: result.maskedContent,
            editedAt: new Date().toISOString()
        });

        // Send guardian notice
        await sendGuardianMessage(channelId,
            `🛡️ Я замаскував чутливі дані (${result.types.join(', ')}) у повідомленні @${username}. Будьте обережні з персональними даними!`
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

        // Notify channel
        await sendGuardianMessage(channelId,
            `🛡️ @${username} заблоковано на 15 хвилин.\n<i>Причина: ${reason}</i>\n\nБудь ласка, спілкуйтесь з повагою! 🤝`
        );

        // Broadcast mute event
        broadcastToChannel(channelId, 'chat:user-muted', {
            channelId,
            userId,
            username,
            mutedUntil: mutedUntil.toISOString(),
            reason
        });

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

    // 2. Mask sensitive data (fire-and-forget)
    maskSensitiveInMessage(messageId, channelId, content, username).catch(err => {
        log.error('Masking error', err);
    });

    // 3. Analyze conflicts — show guardian typing first
    (async () => {
        try {
            // Show typing indicator for Guardian
            const guardianId = await getGuardianUserId();
            if (guardianId) {
                broadcastToChannel(channelId, 'chat:typing', {
                    channelId,
                    userId: guardianId,
                    username: GUARDIAN_USERNAME
                });
            }
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

module.exports = {
    processMessage,
    isUserMuted,
    detectAndMaskSensitive,
    generateDailyReport,
    runDailyReports,
    ensureGuardianMemberships,
    sendGuardianMessage,
    GUARDIAN_USERNAME
};
