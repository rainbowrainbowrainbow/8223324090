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
const crypto = require('node:crypto');
const { createLogger } = require('../utils/logger');
const { broadcastToChannel, sendToUser, broadcast } = require('./websocket');
const { provisionGuardianDirectorDm } = require('./guardianDmProvisioning');
const { claimGuardianMute } = require('./guardianIdempotency');
const { callUnifiedChatCompletion, hasAnySharedAIKey, getAvailableProviders } = require('./ai-config');
const {
    GUARDIAN_DIRECTOR_DM_REQUESTED,
    GUARDIAN_TELEGRAM_ALERT_REQUESTED,
    buildGuardianDeliveryIdempotencyKey
} = require('./guardianDelivery');

const log = createLogger('Guardian');

const GUARDIAN_USERNAME = 'guardian';
const MUTE_DURATION_MS = 1 * 60 * 1000; // 1 minute

function buildGuardianActionMetadata(actions) {
    const groupId = crypto.randomUUID();
    return (actions || []).map((action, index) => ({
        ...action,
        actionToken: `guardian-action:${groupId}:${index}`
    }));
}

// ==========================================
// EMERGENCY STOP — миттєве вимкнення Guardian
// ==========================================
let GUARDIAN_EMERGENCY_STOP = false;

// ==========================================
// WHITELIST — слова/фрази що НІКОЛИ не є матюком
// ==========================================
const TOXIC_WHITELIST = [
    'небо', 'небос', 'хибне', 'хибн', 'облибок', 'необхідно', 'необхідність',
    'підходить', 'відходить', 'виходить', 'доходить', 'підход', 'відход',
    'підхід', 'обхід', 'виход', 'доход', 'похід', 'нахил', 'нахил',
    'захід', 'прихід', 'прийде', 'приходить',
    // Можна розширювати через адмін-панель (guardian_whitelist table)
];

// Dynamic whitelist loaded from DB
let _dynamicWhitelist = [];
let _whitelistLoaded = false;

// Per-channel settings cache
const _channelSettingsCache = {}; // { channelId: { guardian_enabled, contour2_enabled, ts } }
const CACHE_TTL_MS = 60 * 1000; // 1 хвилина

// Telegram alerts for critical events (Contour 2)
const BOSS_TELEGRAM_ID = process.env.BOSS_TELEGRAM_ID || '674972415';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Rate limiter for Telegram alerts (max 1 per 30s per type)
const _telegramAlertCooldowns = {};
const TELEGRAM_COOLDOWN_MS = 30 * 1000;

// Spam tracker: { userId: { timestamps[] } }
const _spamTracker = {};
const SPAM_WINDOW_MS = 30 * 1000;
const SPAM_THRESHOLD = 10;

// AI setup — shared CRM AI key source with Guardian-specific provider/model overlay.
const AI_ENABLED = hasAnySharedAIKey();
if (AI_ENABLED) {
    log.info(`Guardian AI enabled via shared key source (${getAvailableProviders().join(', ')})`);
}

/**
 * Unified LLM call — tries OpenRouter first, Anthropic fallback.
 * Returns text response or null on error.
 */
async function callLLM(systemPrompt, userMessage, maxTokens) {
    maxTokens = maxTokens || 300;

    const result = await callUnifiedChatCompletion({
        scope: 'guardian_ai',
        title: 'Event Genix Guardian AI',
        systemPrompt,
        userMessage,
        maxTokens
    });

    if (!result.ok) {
        log.warn('Guardian AI unavailable', {
            reason: result.reason,
            provider: result.provider,
            status: result.status
        });
        return null;
    }

    return result.text || null;
}

/**
 * Send critical alert to director via Telegram.
 * Only fires for: conflict high, sensitive data, 5+ blocks/hour, mass spam.
 */
async function alertDirectorTelegram(htmlContent, alertType) {
    if (!TELEGRAM_BOT_TOKEN) return;

    // Rate limit: 1 alert per type per 30s
    const now = Date.now();
    const cooldownKey = alertType || 'generic';
    if (_telegramAlertCooldowns[cooldownKey] && now - _telegramAlertCooldowns[cooldownKey] < TELEGRAM_COOLDOWN_MS) {
        return;
    }
    _telegramAlertCooldowns[cooldownKey] = now;

    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: BOSS_TELEGRAM_ID,
                text: htmlContent,
                parse_mode: 'HTML'
            })
        });
        log.info(`Telegram alert sent [${alertType}]: ${htmlContent.substring(0, 60)}...`);
    } catch (err) {
        log.error('Telegram alert failed', err.message);
    }
}

/**
 * Track spam (10+ messages in 30s → alert).
 */
function trackSpam(userId, username, channelId) {
    const now = Date.now();
    if (!_spamTracker[userId]) _spamTracker[userId] = [];
    _spamTracker[userId].push(now);
    // Clean old timestamps
    _spamTracker[userId] = _spamTracker[userId].filter(ts => now - ts < SPAM_WINDOW_MS);

    if (_spamTracker[userId].length >= SPAM_THRESHOLD) {
        alertDirectorTelegram(
            `🔴 <b>Масовий спам!</b>\n` +
            `Користувач: @${username}\n` +
            `${_spamTracker[userId].length} повідомлень за 30 сек`,
            `spam-${userId}`
        );
        _spamTracker[userId] = []; // Reset after alert
    }
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

// Batch learning buffer (instead of per-message API calls)
let _pendingLearnMessages = [];
const LEARN_BATCH_SIZE = 20;
const LEARN_INTERVAL_MS = 5 * 60 * 1000; // 5 min

// Conversation tracker for better reports
const _conversationTracker = {}; // channelId -> [{ username, content, ts }]
const CONVERSATION_MAX_PER_CHANNEL = 200;

// v38.4.0: Periodic cleanup of all in-memory caches to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    // _channelSettingsCache — remove expired entries
    for (const k in _channelSettingsCache) {
        if (now - (_channelSettingsCache[k]?.ts || 0) > CACHE_TTL_MS) delete _channelSettingsCache[k];
    }
    // _telegramAlertCooldowns — remove expired
    for (const k in _telegramAlertCooldowns) {
        if (now - _telegramAlertCooldowns[k] > TELEGRAM_COOLDOWN_MS * 2) delete _telegramAlertCooldowns[k];
    }
    // _spamTracker — remove empty/stale entries
    for (const k in _spamTracker) {
        if (!_spamTracker[k]?.length) { delete _spamTracker[k]; continue; }
        _spamTracker[k] = _spamTracker[k].filter(ts => now - ts < SPAM_WINDOW_MS * 2);
        if (!_spamTracker[k].length) delete _spamTracker[k];
    }
    // _guardianMemory — cap events per channel
    for (const k in _guardianMemory) {
        if (_guardianMemory[k]?.events?.length > 100) {
            _guardianMemory[k].events = _guardianMemory[k].events.slice(-100);
        }
    }
    // _conversationTracker — remove stale channels (>24h)
    for (const k in _conversationTracker) {
        const tracker = _conversationTracker[k];
        if (!tracker?.length) { delete _conversationTracker[k]; continue; }
        const lastTs = tracker[tracker.length - 1]?.ts || 0;
        if (now - lastTs > 24 * 60 * 60 * 1000) delete _conversationTracker[k];
    }
    // _channelHealth — remove stale channels (>7d)
    for (const k in _channelHealth) {
        if (_channelHealth[k]?.lastIncident && now - _channelHealth[k].lastIncident > 7 * 24 * 60 * 60 * 1000) delete _channelHealth[k];
    }
    // _moodHistory — cap at 20
    if (_moodHistory.length > 20) _moodHistory = _moodHistory.slice(-20);
}, 5 * 60 * 1000).unref(); // every 5 min, doesn't prevent shutdown

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
    // Passwords: "пароль: xxx", "password: xxx", "пароль xxx", "pass: xxx"
    { regex: /(?:парол[ьі]|password|pass|pwd)\s*[:=]\s*\S{3,}/gi, replace: '*****: [замасковано]', type: 'password' },
    // JWT tokens (base64.base64.base64)
    { regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replace: '[JWT замасковано]', type: 'jwt' },
    // API keys / Bearer tokens (long alphanumeric strings with common prefixes)
    { regex: /\b(?:sk-|pk-|api[_-]?key|bearer)\s*[:=]?\s*[A-Za-z0-9_-]{20,}\b/gi, replace: '[API ключ замасковано]', type: 'api_key' },
    // Ukrainian addresses: вул./вулиця + name + number
    { regex: /(?:вул(?:иця|\.)?|просп(?:ект|\.)?|бульв(?:ар|\.)?|пров(?:улок|\.))\s+[А-ЯІЇЄҐа-яіїєґ']+\s*,?\s*(?:буд(?:инок|\.)?)?\s*\d{1,4}[а-яА-Я]?/gi, replace: '[адреса замасковано]', type: 'address' },
    // Date of birth patterns: ДД.ММ.РРРР, ДД/ММ/РРРР (years 1940-2025)
    { regex: /\b(?:0[1-9]|[12]\d|3[01])[./](?:0[1-9]|1[0-2])[./](?:19[4-9]\d|20[0-2]\d)\b/g, replace: '[дата замасковано]', type: 'dob' },
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
        const alertText = `🛡️ <b>Маскування даних</b>\n` +
            `Канал: #${await getChannelSlug(channelId)}\n` +
            `Користувач: @${username}\n` +
            `Тип: ${result.types.join(', ')}`;
        await alertDirector(alertText);

        // Critical types → also alert via Telegram
        const criticalTypes = ['card', 'iban', 'passport', 'tax_id', 'password', 'jwt'];
        if (result.types.some(t => criticalTypes.includes(t))) {
            alertDirectorTelegram(alertText, `sensitive-${channelId}`);
        }

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
const CONFLICT_WINDOW = 15; // analyze last N messages (expanded from 5)

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
 * Clear mute from in-memory cache (called on appeal/manual unmute).
 */
function clearMuteCache(channelId, userId) {
    const key = `${channelId}:${userId}`;
    delete _activeMutes[key];
}

/**
 * Mute user in channel for 1 minute.
 */
async function muteUser(channelId, userId, username, reason) {
    try {
        // Use auto-escalation to determine mute duration
        const escalation = await checkEscalation(userId, channelId);
        let muteDurationMs = escalation.muteDurationMs || MUTE_DURATION_MS;

        // Check trust score — restricted users get 2x duration
        const trust = await getTrustScore(userId);
        if (trust.level === 'restricted') {
            muteDurationMs = muteDurationMs * 2;
        }

        // If escalation says warn only (level 1), still mute but for minimum duration
        if (escalation.action === 'warn' && escalation.level === 1) {
            muteDurationMs = MUTE_DURATION_MS; // default 1 min
        }

        const mutedUntil = new Date(Date.now() + muteDurationMs);
        const muteDurationMinutes = Math.round(muteDurationMs / 60000);
        const key = `${channelId}:${userId}`;
        const slug = await getChannelSlug(channelId);
        const directorAlertContent =
            `🚨 <b>Блокування користувача</b>\n` +
            `Канал: #${slug}\n` +
            `Користувач: @${username}\n` +
            `Причина: ${reason}\n` +
            `Рівень ескалації: ${escalation.level} (інцидентів: ${escalation.incidentCount})\n` +
            `Довіра: ${trust.score}/100 (${trust.level})\n` +
            `До: ${mutedUntil.toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' })} (${muteDurationMinutes} хв)`;
        const directorActions = [
            { action: 'mute_both', label: '🔇 Мютити обох', channelId, userId },
            { action: 'warn', label: '⚠️ Попередження', channelId, userId, username },
            { action: 'watch', label: '👀 Спостерігаю', channelId, userId }
        ];
        const deliveryEvents = [{
            eventType: GUARDIAN_DIRECTOR_DM_REQUESTED,
            aggregateType: 'guardian_mute',
            aggregateId: ({ muteId }) => String(muteId),
            idempotencyKey: ({ muteId }) => buildGuardianDeliveryIdempotencyKey('mute.dm', muteId),
            payload: ({ muteId }) => {
                const deliveryKey = buildGuardianDeliveryIdempotencyKey('mute.dm', muteId);
                return {
                    deliveryKey,
                    deliveryType: 'guardian_mute_director_dm',
                    sourceType: 'guardian_mute',
                    sourceId: String(muteId),
                    channelId,
                    userId,
                    username,
                    content: directorAlertContent,
                    actions: directorActions
                };
            }
        }];

        if (escalation.notifyTelegram) {
            deliveryEvents.push({
                eventType: GUARDIAN_TELEGRAM_ALERT_REQUESTED,
                aggregateType: 'guardian_mute',
                aggregateId: ({ muteId }) => String(muteId),
                idempotencyKey: ({ muteId }) => buildGuardianDeliveryIdempotencyKey('mute.telegram', muteId),
                payload: ({ muteId }) => {
                    const deliveryKey = buildGuardianDeliveryIdempotencyKey('mute.telegram', muteId);
                    return {
                        deliveryKey,
                        deliveryType: 'guardian_mute_telegram',
                        sourceType: 'guardian_mute',
                        sourceId: String(muteId),
                        channelId,
                        userId,
                        username,
                        alertType: `escalation-${userId}`,
                        content:
                            `🚨 <b>Ескалація рівень ${escalation.level}!</b>\n` +
                            `Користувач: @${username}\n` +
                            `Канал: #${slug}\n` +
                            `Інцидентів за 24г: ${escalation.incidentCount}\n` +
                            `Мут: ${muteDurationMinutes} хв`
                    };
                }
            });
        }

        deliveryEvents.push({
            eventType: GUARDIAN_TELEGRAM_ALERT_REQUESTED,
            aggregateType: 'guardian_moderation_counter',
            aggregateId: ({ moderationState }) => `repeat:${userId}:${moderationState?.repeatOffender?.windowKey || 'rolling-7d'}`,
            idempotencyKey: ({ moderationState }) => moderationState?.repeatOffender?.alert
                ? buildGuardianDeliveryIdempotencyKey('repeat-offender.telegram', `${userId}:${moderationState.repeatOffender.windowKey}`)
                : null,
            payload: ({ moderationState }) => {
                const repeat = moderationState?.repeatOffender;
                if (!repeat?.alert) return null;
                return {
                    deliveryKey: buildGuardianDeliveryIdempotencyKey('repeat-offender.telegram', `${userId}:${repeat.windowKey}`),
                    deliveryType: 'guardian_repeat_offender_telegram',
                    sourceType: 'guardian_moderation_counter',
                    sourceId: `repeat:${userId}:${repeat.windowKey}`,
                    channelId,
                    userId,
                    username,
                    alertType: `repeat-offender-${userId}`,
                    content:
                        `🔴 <b>Повторний порушник!</b>\n` +
                        `Користувач: @${username}\n` +
                        `Порушень за тиждень: ${repeat.count}\n` +
                        `Потрібне втручання директора`
                };
            }
        }, {
            eventType: GUARDIAN_TELEGRAM_ALERT_REQUESTED,
            aggregateType: 'guardian_moderation_counter',
            aggregateId: ({ moderationState }) => `hourly:${userId}:${moderationState?.hourlyBlocks?.windowKey || 'unknown'}`,
            idempotencyKey: ({ moderationState }) => moderationState?.hourlyBlocks?.alert
                ? buildGuardianDeliveryIdempotencyKey('hourly-blocks.telegram', `${userId}:${moderationState.hourlyBlocks.windowKey}`)
                : null,
            payload: ({ moderationState }) => {
                const hourly = moderationState?.hourlyBlocks;
                if (!hourly?.alert) return null;
                return {
                    deliveryKey: buildGuardianDeliveryIdempotencyKey('hourly-blocks.telegram', `${userId}:${hourly.windowKey}`),
                    deliveryType: 'guardian_hourly_blocks_telegram',
                    sourceType: 'guardian_moderation_counter',
                    sourceId: `hourly:${userId}:${hourly.windowKey}`,
                    channelId,
                    userId,
                    username,
                    alertType: `hourly-blocks-${userId}:${hourly.windowKey}`,
                    content:
                        `🔴 <b>5+ блокувань за годину!</b>\n` +
                        `Користувач: @${username}\n` +
                        `Блокувань: ${hourly.count}`
                };
            }
        });

        const muteClaim = await claimGuardianMute({
            pool,
            channelId,
            userId,
            reason,
            mutedUntil,
            details: {
                reason, until: mutedUntil, username,
                escalationLevel: escalation.level,
                trustLevel: trust.level
            },
            deliveryEvents
        });

        if (muteClaim.duplicate) {
            if (muteClaim.mutedUntil) {
                _activeMutes[key] = new Date(muteClaim.mutedUntil).getTime();
            }
            log.info(`Skipped duplicate mute for ${username} (id:${userId}) in ch:${channelId}; active mute already exists`);
            return muteClaim;
        }

        _activeMutes[key] = mutedUntil.getTime();

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
            details: `Заблоковано на ${muteDurationMinutes} хв (рівень ${escalation.level}): ${reason}`,
            severity: 'danger'
        });

        log.info(`Guardian mute delivery queued via outbox for ${username} (id:${userId}) in ch:${channelId}`);

        // Update trust score on mute
        updateTrustScore(userId, -10, 'mute').catch(err => {
            log.error('Trust score update on mute failed', err);
        });

        // Update activity heatmap
        updateActivityHeatmap(channelId, 'mute').catch(err => {
            log.error('Activity heatmap mute update failed', err);
        });

        // Track repeated offense for trust
        if (escalation.level >= 3) {
            updateTrustScore(userId, -15, 'repeated_offense').catch(err => {
                log.error('Trust score update on repeated offense failed', err);
            });
        }

        log.info(`Muted ${username} (id:${userId}) in ch:${channelId} for ${muteDurationMinutes}min (escalation:${escalation.level}, trust:${trust.level}) until ${mutedUntil.toISOString()}`);
        return muteClaim;
    } catch (err) {
        log.error('Failed to mute user', err);
        return { muted: false, duplicate: false, error: err };
    }
}

// Aggressive words/phrases for quick detection — EXPANDED
const TOXIC_KEYWORDS_BASE = [
    // Ukrainian profanity (all forms/variations)
    'хуй', 'хуя', 'хую', 'хуї', 'хує', 'хуйн', 'хуйо', 'хуйл', 'хуїв',
    'нахуй', 'нахій', 'нахуя', 'похуй', 'захуяр', 'охуе', 'охуєт', 'охуїт',
    'піздец', 'пізда', 'піздат', 'пизд', 'пізд', 'піздо', 'підар',
    'їбат', 'єбат', 'їбан', 'єбан', 'їбаш', 'єбаш', 'їбуч', 'єбуч',
    'їбла', 'єбла', 'їблан', 'єблан', 'їбать', 'єбать', 'їбані', 'єбані',
    'їбав', 'єбав', 'їбало', 'єбало', 'їбал', 'єбал', 'їбаль', 'єбаль',
    'їбе', 'єбе', 'їбу', 'єбу', 'їбі', 'єбі', 'їбон', 'єбон',
    'заєб', 'заїб', 'наєб', 'наїб', 'виїб', 'виєб', 'поїб', 'поєб', 'проєб', 'проїб',
    'їбло', 'єбло', 'їбальник', 'єбальник',
    'бля', 'блять', 'блядь', 'бляд', 'блядин', 'блядськ',
    'курва', 'курв',
    'сука', 'сучк', 'сучар', 'сучий',
    'мудак', 'мудил', 'мудо', 'мудач',
    'дурак', 'дурень', 'дурн', 'дура',
    'ідіот', 'ідіотк', 'ідіотськ',
    'тупий', 'тупа', 'тупе', 'тупиц',
    'кретин', 'кретинк',
    'дебіл', 'дебил', 'дебільн',
    'придурок', 'придурк',
    'лох', 'лошок', 'лохан', 'лошар',
    'гандон', 'гондон',
    'мразь', 'мразот',
    'гнид', 'гнида',
    'тварь', 'тварюк',
    'козел', 'козлин',
    'баран', 'баранин',
    'свиня', 'свинюк', 'свинач',
    'урод', 'виродок', 'виродк',
    'заткнись', 'заткнися', 'рот закрий', 'закрий рота', 'замовкни', 'замовчи',
    'пішов нафіг', 'пішла нафіг', 'пошел нафиг', 'пішов на',
    'піди на', 'іди на', 'іди нах',
    'йобан', 'йобнут',
    'шльондра', 'шалава', 'повія',
    'стерв', 'стервоз',
    'дятел', 'чмо', 'чмошник',
    'падл', 'падлюк', 'падло',
    // Additional Ukrainian/Russian slang profanity
    'гавно', 'гівно', 'говно', 'говн', 'гівн',
    'сосат', 'сосать', 'соси', 'соска', 'соснул', 'відсос', 'отсос',
    'піська', 'писька', 'пісюн', 'пісюк', 'піпіськ',
    'жоп', 'жопа', 'жопе', 'жопу', 'дупа', 'дупе', 'дупу', 'сракa', 'срак',
    'срат', 'срать', 'засран', 'обісрав', 'обісрат', 'насрат', 'насрать',
    'залуп', 'залупа', 'залупин',
    'член', 'членосос',
    'шмар', 'шмара', 'шмарк',
    'їбар', 'їбарь', 'єбарь',
    'довбо', 'довбой', 'довбан',
    'їбаний', 'єбаний', 'їбана', 'єбана', 'їбане', 'єбане',
    'їбанут', 'єбанут', 'їбнут', 'єбнут',
    'йобан', 'йобнут', 'йобаний',
    'хуєсос', 'хуесос', 'хуїсос',
    'підарас', 'пидарас', 'підар', 'пидар', 'підор', 'пидор',
    'в рот', 'в їбало', 'в ебало', 'в пізд', 'в пизд',
    // Russian profanity (common in UA chat)
    'блять', 'ебать', 'ёбан', 'ебан', 'ёбнут', 'ебнут',
    'пиздец', 'пизда', 'пиздат',
    'хуй', 'хуя', 'нахуй', 'похуй',
    'сука', 'сучка', 'сукин',
    'мудак', 'мудил',
    'дебил', 'дебилк',
    'пошёл нахуй', 'пошел нахуй',
    'иди нахуй', 'иди на хуй',
    'пошол нафиг', 'пошёл нафиг',
    // English profanity
    'fuck', 'fucker', 'fuckin', 'motherfuck', 'wtf', 'fck', 'f*ck',
    'shit', 'shitty', 'bullshit',
    'bitch', 'bitchin',
    'asshole', 'ass hole',
    'dick', 'dickhead',
    'stfu', 'gtfo',
    'idiot', 'moron', 'retard',
    'stupid', 'dumb',
    'bastard', 'cunt',
    'damn', 'dammit',
    'piss off', 'screw you',
    'whore', 'slut',
    // Slang shortcuts / abbreviations
    'пидр', 'підр', 'пидрас', 'підрас',
    'проститутк', 'проститук', 'простітутк',
    'шлюх', 'шлюха', 'шлюшк',
    'куні', 'кунілінгус', 'кунілінг',
    'ніга', 'нига', 'нігга', 'нигга',
    'пінаєш', 'пінає', 'пінати',
    'вдупляю', 'вдуплят', 'вдупл',
    // Sexual/NSFW content (blocked in children's park system)
    'порно', 'порнух', 'порнограф', 'порев', 'порево',
    'секс', 'сексуальн',
    'бдсм', 'bdsm',
    'анал', 'анальн', 'анл',
    'мінет', 'минет',
    'оральн', 'орал',
    'ізвращ', 'извращ', 'збочен', 'збоченц',
    'педофіл', 'педофил', 'педо',
    'дитяче порно', 'датяче порно', 'детское порно', 'cp',
    'хентай', 'hentai',
    'дівчатка голі', 'голі діти',
    // Hate speech / slurs
    'нигер', 'нігер', 'nigger', 'nigga',
    'гей', 'гейськ', 'faggot', 'fag',
    'підар', 'пидар',
    // Violence threats
    'убий', 'убьем', "убь'м", 'убьм', 'убити', 'вбити', 'вб\'ю', 'убью',
    'зарежу', 'заріжу', 'зарізати',
    'давай всех убь', 'давай всіх вб',
    'вбивай', 'убивай',
    'застрелю', 'застрел',
    'повісити', 'повішу',
    // Drugs
    'наркот', 'нарик', 'трава', 'шмаль',
    'кокаїн', 'кокаин', 'cocaine',
    'героїн', 'героин', 'heroin',
    'амфетамін', 'амфетамин',
    'мефедрон', 'мефедр',
    'закладка', 'закладки'
];

// Dynamic toxic words loaded from DB (max 500 to prevent unbounded memory growth)
const MAX_DYNAMIC_TOXIC_WORDS = 500;
let _dynamicToxicWords = [];
let _toxicWordsLoaded = false;

async function loadDynamicToxicWords() {
    try {
        const result = await pool.query('SELECT word FROM guardian_toxic_words');
        _dynamicToxicWords = result.rows.map(r => r.word.toLowerCase());
        _toxicWordsLoaded = true;
        log.info(`Loaded ${_dynamicToxicWords.length} dynamic toxic words`);
    } catch (err) {
        // Table might not exist yet
        _dynamicToxicWords = [];
    }
}

/**
 * Load dynamic whitelist phrases from DB.
 * Merged with static TOXIC_WHITELIST for isWhitelisted checks.
 */
async function loadDynamicWhitelist() {
    try {
        const result = await pool.query('SELECT phrase FROM guardian_whitelist');
        _dynamicWhitelist = result.rows.map(r => r.phrase.toLowerCase());
        _whitelistLoaded = true;
        log.info(`Loaded ${_dynamicWhitelist.length} whitelist phrases`);
    } catch (err) {
        // Table might not exist yet (migration pending)
        _dynamicWhitelist = [];
    }
}

/**
 * Extract the full word around a match position in content.
 */
function extractWordAround(content, matchIndex, matchLength) {
    const lower = content.toLowerCase();
    let start = matchIndex;
    let end = matchIndex + matchLength;
    // Expand left to word boundary
    while (start > 0 && /[а-яґєіїёa-z]/i.test(lower[start - 1])) start--;
    // Expand right to word boundary
    while (end < lower.length && /[а-яґєіїёa-z]/i.test(lower[end])) end++;
    return lower.slice(start, end);
}

/**
 * Check if a match at given position is whitelisted.
 * Returns true → skip this match (not toxic).
 */
function isWhitelisted(content, matchIndex, matchLength) {
    const word = extractWordAround(content, matchIndex, matchLength);
    const allWhitelist = [...TOXIC_WHITELIST, ..._dynamicWhitelist];
    return allWhitelist.some(w => word.includes(w.toLowerCase()));
}

/**
 * Get channel settings (guardian_enabled, contour2_enabled) with TTL cache.
 */
async function getChannelSettings(channelId) {
    const cached = _channelSettingsCache[channelId];
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
        return cached;
    }
    try {
        const result = await pool.query(
            'SELECT guardian_enabled, contour2_enabled FROM chat_channels WHERE id = $1',
            [channelId]
        );
        const row = result.rows[0] || {};
        const settings = {
            guardian_enabled: row.guardian_enabled !== false, // default true
            contour2_enabled: row.contour2_enabled !== false, // default true
            ts: Date.now()
        };
        _channelSettingsCache[channelId] = settings;
        return settings;
    } catch (err) {
        // Column might not exist yet — default to enabled
        return { guardian_enabled: true, contour2_enabled: true, ts: Date.now() };
    }
}

/**
 * Invalidate channel settings cache entry.
 */
function invalidateChannelSettingsCache(channelId) {
    delete _channelSettingsCache[channelId];
}

// Letter substitution map for fuzzy matching (leet-speak, similar chars)
const CHAR_SUBSTITUTIONS = {
    'а': '[аaа@]', 'б': '[бb6]', 'в': '[вvb]', 'г': '[гgґ]',
    'д': '[дd]', 'е': '[еeеє3]', 'є': '[єеe3]', 'ж': '[жж]',
    'з': '[зz3]', 'и': '[иuіы]', 'і': '[іiи1!]', 'ї': '[їіи]',
    'й': '[йиі]', 'к': '[кk]', 'л': '[лl]', 'м': '[мm]',
    'н': '[нn]', 'о': '[оo0]', 'п': '[пp]', 'р': '[рrp]',
    'с': '[сsc$]', 'т': '[тt7]', 'у': '[уuy]', 'ф': '[фf]',
    'х': '[хxh]', 'ц': '[цc]', 'ч': '[чch4]', 'ш': '[шsh]',
    'щ': '[щш]', 'ь': '[ьъ]?', 'ю': '[юuю]', 'я': '[яяа]',
    'ъ': '[ъьь]?', 'ы': '[ыиіi]', 'ё': '[ёеeє]',
    'a': '[аaа@]', 'b': '[бb6]', 'c': '[сsc$]', 'd': '[дd]',
    'e': '[еeеє3]', 'f': '[фf]', 'g': '[гgґ]', 'h': '[хxh]',
    'i': '[іiи1!]', 'k': '[кk]', 'l': '[лl]', 'm': '[мm]',
    'n': '[нn]', 'o': '[оo0]', 'p': '[пpр]', 'r': '[рrp]',
    's': '[сsc$]', 't': '[тt7]', 'u': '[уuy]', 'v': '[вvb]',
    'x': '[хxh]', 'y': '[уuy]', 'z': '[зz3]'
};

/**
 * Build a fuzzy regex from a word (handles leet-speak, similar chars, optional separators)
 */
function buildFuzzyRegex(word) {
    const chars = word.toLowerCase().split('');
    const pattern = chars.map(c => {
        const sub = CHAR_SUBSTITUTIONS[c];
        return sub ? sub : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('[\\s.\\-_*]*'); // Allow separators between chars
    return new RegExp(pattern, 'i');
}

// Pre-build regexes for base keywords
let _fuzzyRegexes = TOXIC_KEYWORDS_BASE.map(w => ({ word: w, regex: buildFuzzyRegex(w) }));

/**
 * Quick keyword-based toxicity check with fuzzy matching.
 */
/**
 * Detect Russian language in text.
 * Russian-specific letters not present in Ukrainian: ы, э, ё, ъ
 * Also detects common Russian word patterns and endings.
 */
function detectRussianLanguage(content) {
    const lower = content.toLowerCase();

    // 1. Russian-specific letters (don't exist in Ukrainian)
    if (/[ыэёъ]/i.test(lower)) {
        return 'russian-letters';
    }

    // 2. Common Russian words/endings not used in Ukrainian
    const russianPatterns = [
        /\bчто\b/, /\bкогда\b/, /\bтолько\b/, /\bесли\b/, /\bпочему\b/,
        /\bпотому\b/, /\bсейчас\b/, /\bздесь\b/, /\bтоже\b/, /\bтогда\b/,
        /\bникогда\b/, /\bвсегда\b/, /\bхорошо\b/, /\bконечно\b/, /\bнаверное\b/,
        /\bдаже\b/, /\bможет\b/, /\bбудет\b/, /\bбыло\b/, /\bбыли\b/,
        /\bделает\b/, /\bделаешь\b/, /\bпонятно\b/, /\bладно\b/, /\bреально\b/,
        /\bговорит\b/, /\bговоришь\b/, /\bзнаешь\b/, /\bзнает\b/,
        /\bнужно\b/, /\bможно\b/, /\bнельзя\b/, /\bпожалуйста\b/,
        /\bспасибо\b/, /\bничего\b/, /\bкакой\b/, /\bкакая\b/,
        /\bещё\b/, /\bеще\b/, /\bуже\b/, /\bочень\b/,
        /ает\b/, /ует\b/, /ёт\b/, /ться\b/,
        /\bне\s+блокает\b/, /\bне\s+работает\b/
    ];

    const matchCount = russianPatterns.filter(p => p.test(lower)).length;
    if (matchCount >= 1) return 'russian-words';

    return null;
}

function quickToxicityCheck(content) {
    const lower = content.toLowerCase();
    // Normalize: remove ALL non-letter chars (catches "г а в н о", "х*й", "п*зда", "х-у-й")
    const normalized = lower.replace(/[^а-яґєіїёa-z]/g, '');
    // Collapse repeated chars: "пиииздааааа" → "пизда"
    const collapsed = normalized.replace(/(.)\1{2,}/g, '$1');
    // Strip asterisks/dots but keep spaces (for "х*й" → "хй", "п*зда" → "пзда")
    const destarred = lower.replace(/[*._\-]/g, '');
    // Restore vowels in star-censored words: "х*й"→"хуй", "п*зда"→"пізда"
    const uncensored = lower
        .replace(/х\*й/g, 'хуй').replace(/х\*і/g, 'хуї').replace(/х\*є/g, 'хує')
        .replace(/п\*зд/g, 'пізд').replace(/п\*зда/g, 'пізда')
        .replace(/б\*я/g, 'бля').replace(/б\*ть/g, 'блять')
        .replace(/с\*ка/g, 'сука').replace(/с\*к/g, 'сук')
        .replace(/\*{2,}/g, '');  // "***" pure stars = suspicious

    // Number substitution: "3.14здей" → "піздей", "пі3.14здей"
    const deNumbered = lower
        .replace(/3[\s.,]*14/g, 'пі')  // 3.14 = пі
        .replace(/0/g, 'о').replace(/1/g, 'і').replace(/3/g, 'з')
        .replace(/4/g, 'ч').replace(/6/g, 'б').replace(/8/g, 'в');
    const deNumberedClean = deNumbered.replace(/[^а-яґєіїёa-z]/g, '');

    // 0. Block phone/card numbers (privacy protection in children's park)
    const contentNoSpaces = content.replace(/\s/g, '');
    const digitCount = (contentNoSpaces.match(/[\d*]/g) || []).length;
    const pureDigits = (contentNoSpaces.match(/\d/g) || []).length;
    // Card numbers: 4-4-4-4 or 16 digits or masked with *
    if (/\d{4}[\s\-*]*\d{4}[\s\-*]*\d{4}[\s\-*]*\d{4}/.test(content) ||
        /\d{4}[\s\-]*\*{4}[\s\-]*\*{4}[\s\-]*\*{4}/.test(content) ||
        /\d{13,19}/.test(contentNoSpaces)) {
        return ['💳 номер картки'];
    }
    // Phone numbers
    const phonePatterns = [
        /(?:\+?38)?0\d{9}/,
        /\+?\d[\d\s\-]{8,}\d/,
        /\d{3}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/,
        /\+\*{3}\s?\*{4}\s?\*{4}/
    ];
    if (phonePatterns.some(p => p.test(content) || p.test(contentNoSpaces))) {
        if (pureDigits >= 7) {
            return ['📱 телефонний номер'];
        }
    }

    // 0.5. Detect Russian language — block entirely
    const ruDetect = detectRussianLanguage(content);
    if (ruDetect) {
        return ['🇷🇺 російська мова'];
    }

    // 1. Direct match on all keywords — check ALL normalized forms
    const allKeywords = [...TOXIC_KEYWORDS_BASE, ..._dynamicToxicWords];
    const variants = [lower, normalized, collapsed, destarred, deNumberedClean, uncensored];
    const directMatch = allKeywords.filter(word => {
        for (const v of variants) {
            const idx = v.indexOf(word);
            if (idx === -1) continue;
            // Whitelist check: if the surrounding word is in whitelist — skip
            if (isWhitelisted(v, idx, word.length)) continue;
            return true;
        }
        return false;
    });
    if (directMatch.length > 0) return directMatch;

    // 2. Fuzzy regex match (catches leet-speak, substitutions)
    const fuzzyMatch = [];
    for (const { word, regex } of _fuzzyRegexes) {
        for (const v of variants) {
            const match = regex.exec(v);
            if (match) {
                // Whitelist check on the matched position
                if (isWhitelisted(v, match.index, match[0].length)) continue;
                fuzzyMatch.push(word);
                break;
            }
        }
        if (fuzzyMatch.length >= 3) break;
    }
    if (fuzzyMatch.length > 0) return fuzzyMatch;

    return null;
}

/**
 * Real-time LLM profanity check — catches creative/obfuscated profanity
 * that keyword filters miss. Returns { toxic: bool, reason, words[] } or null.
 */
const _llmCache = new Map(); // simple cache to avoid duplicate calls
const LLM_CACHE_TTL = 60000; // 1 min

async function llmProfanityCheck(content) {
    if (!AI_ENABLED) return null;
    // Skip very short or very long messages
    if (content.length < 3 || content.length > 500) return null;

    // Check cache
    const cacheKey = content.toLowerCase().trim();
    const cached = _llmCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < LLM_CACHE_TTL) return cached.result;

    // Clean old cache entries periodically
    if (_llmCache.size > 200) {
        const now = Date.now();
        for (const [k, v] of _llmCache) {
            if (now - v.ts > LLM_CACHE_TTL) _llmCache.delete(k);
        }
    }

    try {
        const systemPrompt = `Ти — модератор чату дитячого парку. Аналізуй повідомлення на наявність:
- Нецензурної лексики (мат, лайка) будь-якою мовою
- Обхід фільтрів: заміна літер цифрами, пропуски, зірочки, транслітерація
- Образливі слова, сексуальний підтекст, агресія
- Креативний мат: "п1зд@", "ху.й", "bl9d'", "шл юх а", "с у к а"

Відповідай ТІЛЬКИ у форматі JSON:
{"toxic": true/false, "reason": "коротке пояснення укр", "words": ["знайдене_слово1"]}

Якщо повідомлення чисте — {"toxic": false}
Будь ДУЖЕ суворим. Краще помилитись і заблокувати, ніж пропустити мат.`;

        const result = await callLLM(systemPrompt, content, 150);
        if (!result) {
            _llmCache.set(cacheKey, { ts: Date.now(), result: null });
            return null;
        }

        // Parse JSON from response
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            _llmCache.set(cacheKey, { ts: Date.now(), result: null });
            return null;
        }

        const parsed = JSON.parse(jsonMatch[0]);
        const res = {
            toxic: !!parsed.toxic,
            reason: parsed.reason || null,
            words: Array.isArray(parsed.words) ? parsed.words : []
        };

        _llmCache.set(cacheKey, { ts: Date.now(), result: res });

        if (res.toxic) {
            log.info(`LLM detected profanity: "${content}" → ${res.reason} [${res.words.join(', ')}]`);
        }

        return res;
    } catch (err) {
        log.error('LLM profanity check error', err.message);
        _llmCache.set(cacheKey, { ts: Date.now(), result: null });
        return null;
    }
}

/**
 * Delete toxic message from DB and notify via WebSocket.
 * Used only for CRITICAL severity (threats, doxing, etc.)
 */
async function deleteToxicMessage(messageId, channelId, username, reason) {
    try {
        await pool.query(
            'UPDATE chat_messages SET deleted_at = NOW() WHERE id = $1',
            [messageId]
        );
        broadcastToChannel(channelId, 'chat:delete', {
            channelId,
            messageId,
            deletedBy: 'guardian'
        });
        await logAction('delete', channelId, null, messageId, {
            reason,
            username
        });

        broadcastGuardianEvent({
            type: 'delete',
            channelId,
            username,
            details: `Повідомлення видалено: ${reason}`,
            severity: 'danger'
        });

        log.info(`Deleted toxic message ${messageId} by ${username}: ${reason}`);
    } catch (err) {
        log.error('Failed to delete toxic message', err);
    }
}

/**
 * Replace all toxic words in text with ****.
 */
function censorContent(text) {
    let result = text;
    const allToxic = [...TOXIC_KEYWORDS_BASE, ..._dynamicToxicWords];
    for (const word of allToxic) {
        try {
            const regex = buildFuzzyRegex(word);
            result = result.replace(new RegExp(regex.source, 'gi'), '****');
        } catch (_) {
            // Skip bad regex
        }
    }
    return result;
}

/**
 * Censor toxic message: edit content (replace toxic words with ****) instead of deleting.
 * Used for mild profanity — preserves conversation context.
 * Delete (deleteToxicMessage) is reserved for CRITICAL severity only.
 */
async function censorToxicMessage(messageId, channelId, content, username, reason) {
    try {
        const censored = censorContent(content);

        await pool.query(
            'UPDATE chat_messages SET content = $1, edited_by_guardian = true, guardian_edit_reason = $2 WHERE id = $3',
            [censored, reason, messageId]
        );

        // Broadcast chat:edit so frontend updates in place
        broadcastToChannel(channelId, 'chat:edit', {
            channelId,
            messageId,
            content: censored,
            editedByGuardian: true
        });

        await logAction('censor', channelId, null, messageId, { reason, username });

        broadcastGuardianEvent({
            type: 'censor',
            channelId,
            username,
            details: `Повідомлення відцензуровано: ${reason}`,
            severity: 'warning'
        });

        log.info(`Censored message ${messageId} by ${username}: ${reason}`);
    } catch (err) {
        log.error('Failed to censor toxic message', err);
    }
}

/**
 * AI learns new toxic words from context and adds to dynamic filter.
 */
async function aiLearnToxicWords(content, username) {
    if (!AI_ENABLED) return;

    try {
        const text = await callLLM(
            `Ти — AI модератор чату. Перевір повідомлення на наявність образливих, токсичних або нецензурних слів/фраз будь-якою мовою.
Якщо знайдеш нові образливі слова (які можуть бути замасковані спецсимволами, пробілами, або іншими трюками) — поверни їх.
Відповідай ТІЛЬКИ у форматі JSON: {"toxic": true/false, "words": ["слово1", "слово2"], "reason": "опис"}
Якщо повідомлення чисте: {"toxic": false}
Не включай слова які вже є в стандартних словниках мату. Шукай тільки НОВІ варіації.`,
            content, 200
        );
        if (!text) return;

        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return;

        const result = JSON.parse(match[0]);
        if (result.toxic && result.words && result.words.length > 0) {
            // Add new words to DB
            for (const word of result.words) {
                const lower = word.toLowerCase().trim();
                if (lower.length < 3 || lower.length > 50) continue;
                try {
                    await pool.query(
                        'INSERT INTO guardian_toxic_words (word, added_by, source) VALUES ($1, $2, $3) ON CONFLICT (word) DO NOTHING',
                        [lower, 'guardian-ai', 'llm-detected']
                    );
                    if (_dynamicToxicWords.length < MAX_DYNAMIC_TOXIC_WORDS) _dynamicToxicWords.push(lower);
                    log.info(`AI learned new toxic word: "${lower}" from ${username}`);
                } catch (e) { /* duplicate or error, ignore */ }
            }

            broadcastGuardianEvent({
                type: 'learn',
                channelId: null,
                username: 'guardian',
                details: `AI навчився: ${result.words.join(', ')}`,
                severity: 'info'
            });
        }
    } catch (err) {
        log.error('AI toxic learn failed', err.message);
    }
}

/**
 * Flush pending learn messages as a single batch AI call.
 * Called every 5 min by scheduler or when buffer is full.
 */
async function flushLearnBatch() {
    if (!AI_ENABLED || _pendingLearnMessages.length === 0) return;

    const batch = _pendingLearnMessages.splice(0, LEARN_BATCH_SIZE);
    log.info(`Flushing learn batch: ${batch.length} messages`);

    try {
        const chatLog = batch.map((m, i) =>
            `${i + 1}. [${m.username}]: ${m.content}`
        ).join('\n');

        const text = await callLLM(
            `Ти — AI модератор чату. Переглянь пачку повідомлень і знайди НОВІ образливі/токсичні слова чи фрази (будь-якою мовою).
Шукай тільки НОВІ варіації мату — замасковані спецсимволами, пробілами, літ-спіком, транслітом тощо.
НЕ включай стандартні відомі матюки — тільки креативні обхідні варіанти.
Відповідай ТІЛЬКИ у форматі JSON: {"toxic": true/false, "words": ["слово1", "слово2"], "reason": "опис"}
Якщо все чисто: {"toxic": false}`,
            chatLog, 300
        );
        if (!text) return;

        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return;

        const result = JSON.parse(match[0]);
        if (result.toxic && result.words && result.words.length > 0) {
            for (const word of result.words) {
                const lower = word.toLowerCase().trim();
                if (lower.length < 3 || lower.length > 50) continue;
                try {
                    await pool.query(
                        'INSERT INTO guardian_toxic_words (word, added_by, source) VALUES ($1, $2, $3) ON CONFLICT (word) DO NOTHING',
                        [lower, 'guardian-ai', 'llm-detected']
                    );
                    if (_dynamicToxicWords.length < MAX_DYNAMIC_TOXIC_WORDS) _dynamicToxicWords.push(lower);
                    log.info(`AI batch-learned toxic word: "${lower}"`);
                } catch (e) { /* duplicate or error, ignore */ }
            }

            broadcastGuardianEvent({
                type: 'learn',
                channelId: null,
                username: 'guardian',
                details: `AI навчився (батч): ${result.words.join(', ')}`,
                severity: 'info'
            });
        }
    } catch (err) {
        log.error('AI batch learn failed', err.message);
    }
}

/**
 * AI-based conflict detection for ambiguous cases.
 * Analyzes last N messages in context.
 */
async function aiConflictCheck(messages) {
    if (!AI_ENABLED) return null;

    try {
        const chatLog = messages.map(m =>
            `[${m.username}]: ${m.content}`
        ).join('\n');

        const text = await callLLM(
            `Ти — модератор чату дитячого парку. Проаналізуй останні повідомлення і визнач чи є конфлікт або агресія.
Відповідай ТІЛЬКИ у форматі JSON: {"conflict": true/false, "severity": "low"/"medium"/"high", "aggressors": ["username"], "reason": "короткий опис"}
Якщо конфлікту немає — {"conflict": false}
Враховуй контекст: жарти та легке підколювання — це нормально. Шукай справжню агресію та образи.
Звертай увагу на ланцюжки відповідей (reply chains) — конфлікт може розвиватися через кілька відповідей.
Якщо бачиш ескалацію (кожне наступне повідомлення більш агресивне) — severity: "high".`,
            chatLog, 200
        );
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
 * Analyze message for conflicts (fire-and-forget from processMessage).
 * Keyword + LLM profanity checks are now INLINE in processMessage.
 * This only handles: conflict detection + batch learning.
 */
async function analyzeConflict(channelId, userId, username, content, messageId) {
    // Emergency Stop guard
    if (GUARDIAN_EMERGENCY_STOP) return;

    // Track recent messages for conflict context
    if (!_recentMessages[channelId]) _recentMessages[channelId] = [];
    _recentMessages[channelId].push({ username, content, userId, messageId, ts: Date.now() });
    if (_recentMessages[channelId].length > CONFLICT_WINDOW * 2) {
        _recentMessages[channelId] = _recentMessages[channelId].slice(-CONFLICT_WINDOW);
    }

    // 1. AI conflict check (needs context of multiple messages)
    const recent = _recentMessages[channelId];
    if (recent.length >= 3 && AI_ENABLED) {
        const aiResult = await aiConflictCheck(recent.slice(-CONFLICT_WINDOW));
        if (aiResult && aiResult.conflict && aiResult.severity !== 'low') {
            const aggressors = aiResult.aggressors || [];
            for (const aggressorName of aggressors) {
                const aggressorMsg = recent.find(m => m.username === aggressorName);
                if (aggressorMsg && aggressorMsg.userId) {
                    await muteUser(channelId, aggressorMsg.userId, aggressorName,
                        aiResult.reason || 'Конфліктна поведінка');
                }
            }

            // High severity conflict → Telegram alert to director
            if (aiResult.severity === 'high') {
                const slug = await getChannelSlug(channelId);
                alertDirectorTelegram(
                    `🚨 <b>Серйозний конфлікт!</b>\n` +
                    `Канал: #${slug}\n` +
                    `Учасники: ${aggressors.map(a => '@' + a).join(', ')}\n` +
                    `Причина: ${aiResult.reason || 'Конфліктна поведінка'}`,
                    `conflict-high-${channelId}`
                );
            }

            return aggressors.length > 0;
        }
    }

    // 2. Buffer for batch learning
    if (AI_ENABLED && content.length > 10) {
        _pendingLearnMessages.push({ content, username, channelId });
        if (_pendingLearnMessages.length >= LEARN_BATCH_SIZE) {
            flushLearnBatch().catch(err => {
                log.error('AI batch learn error', err.message);
            });
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

        // Collect LLM findings for this channel
        const findings = _llmFindings[channelId] || [];
        const findingsCount = findings.length;
        const findingsSection = findingsCount > 0
            ? `\n<b>🤖 AI-модерація:</b>\n- Заблоковано спроб обходу фільтру: ${findingsCount}\n- Користувачі: ${[...new Set(findings.map(f => f.username))].join(', ')}\n- Причини: ${[...new Set(findings.map(f => f.reason))].slice(0, 3).join('; ')}`
            : '';

        // Count unique participants
        const uniqueUsers = [...new Set(messages.map(m => m.username))];
        const totalUsers = uniqueUsers.length;
        const userMsgCounts = {};
        messages.forEach(m => { userMsgCounts[m.username] = (userMsgCounts[m.username] || 0) + 1; });
        const sortedUsers = Object.entries(userMsgCounts).sort((a, b) => b[1] - a[1]);
        const mostActive = sortedUsers[0] ? `@${sortedUsers[0][0]} (${sortedUsers[0][1]} msg)` : 'н/д';
        const leastActive = sortedUsers.length > 1 ? `@${sortedUsers[sortedUsers.length - 1][0]} (${sortedUsers[sortedUsers.length - 1][1]} msg)` : 'н/д';

        const summary = await callLLM(
            `Ти — Guardian, AI-модератор корпоративного чату розважального парку "Парк Закревського Періоду".
Створи щоденний звіт з чату для директора. Формат:

📊 <b>Звіт по командному чату — ${dateStr}</b>

<b>👥 Активність:</b>
• Всього повідомлень: ${messages.length}
• Активних учасників: ${totalUsers}
• Найактивніший: ${mostActive}
• Найтихіший: ${leastActive}

<b>💬 Теми розмов (по учасниках):</b>
- @username1 — обговорював [тема], запитував про [тема]
- @username2 — повідомив про [тема], домовився з @username3 про [тема]
(перелічи КОЖНОГО активного учасника та коротко що він обговорював/робив)

<b>📌 Головне:</b>
- Ключові теми та рішення (2-3 пункти)

<b>⚠️ Важливе:</b>
- Рішення, домовленості, дедлайни, задачі (якщо є)

<b>🛡️ Модерація:</b>
• Заблоковано: ${actionCounts.mute || 0} повідомлень
• Замасковано: ${actionCounts.mask || 0}
• AI-блокувань: ${findingsCount}
${findingsSection}

<b>⚠️ Незвичайне:</b>
- Вкажи незвичайну активність: спам, великі паузи, раптові теми (якщо були)

Пиши українською, лаконічно. Ігноруй дрібні привітання. Фокусуйся на робочих темах та хто чим займався.`,
            `Повідомлення за ${dateStr}:\n\n${chatLog}`, 800
        ) || 'Не вдалось згенерувати звіт';

        // Clear findings for this channel after report
        _llmFindings[channelId] = [];

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

        const allReports = [];
        for (const ch of channels.rows) {
            const report = await generateDailyReport(ch.id, dateStr);
            if (report) {
                await sendGuardianMessage(ch.id, report);
                allReports.push({ channel: ch.name || ch.slug, report });
            }
        }

        // Send consolidated digest to director as DM
        if (allReports.length > 0) {
            await sendDirectorDigest(allReports, dateStr);
        }

        // Flush any remaining learn messages
        await flushLearnBatch();

        // Clear conversation tracker for the day
        Object.keys(_conversationTracker).forEach(k => { _conversationTracker[k] = []; });

        log.info(`Daily reports completed for ${channels.rows.length} channels`);
    } catch (err) {
        log.error('Daily reports failed', err);
    }
}

/**
 * Track conversation topics for daily report enrichment.
 * Stores recent messages per channel in memory.
 */
function _trackConversation(channelId, username, content) {
    if (!_conversationTracker[channelId]) _conversationTracker[channelId] = [];
    _conversationTracker[channelId].push({
        username,
        content: content.substring(0, 300),
        ts: Date.now()
    });
    // Limit memory
    if (_conversationTracker[channelId].length > CONVERSATION_MAX_PER_CHANNEL) {
        _conversationTracker[channelId] = _conversationTracker[channelId].slice(-CONVERSATION_MAX_PER_CHANNEL);
    }
}

// ==========================================
// LLM FINDINGS TRACKER (for digest enrichment)
// ==========================================

const _llmFindings = {}; // { channelId: [{ username, type, reason, words, ts }] }

/**
 * Track LLM moderation findings for daily digest.
 */
function _trackLLMFinding(channelId, username, type, reason, words) {
    if (!_llmFindings[channelId]) _llmFindings[channelId] = [];
    _llmFindings[channelId].push({ username, type, reason, words: words || [], ts: Date.now() });
    if (_llmFindings[channelId].length > 100) {
        _llmFindings[channelId] = _llmFindings[channelId].slice(-50);
    }
}

/**
 * Learn new toxic words from LLM detection result.
 */
async function _learnWordsFromLLM(words) {
    if (!words || words.length === 0) return;
    for (const w of words) {
        const word = w.toLowerCase().trim();
        if (word.length >= 2 && !TOXIC_KEYWORDS_BASE.includes(word) && !_dynamicToxicWords.includes(word)) {
            try {
                await pool.query(
                    `INSERT INTO guardian_toxic_words (word, added_by, source) VALUES ($1, 'guardian', 'llm-realtime') ON CONFLICT DO NOTHING`,
                    [word]
                );
                if (_dynamicToxicWords.length < MAX_DYNAMIC_TOXIC_WORDS) _dynamicToxicWords.push(word);
                _fuzzyRegexes.push({ word, regex: buildFuzzyRegex(word) });
                log.info(`Learned new toxic word from LLM: "${word}"`);
            } catch (err) {
                log.error('Failed to save learned word', err.message);
            }
        }
    }
}

/**
 * Send consolidated daily digest to director as DM.
 * Combines all channel reports + adds learned words info.
 */
async function sendDirectorDigest(allReports, dateStr) {
    try {
        // Count learned words today
        const learnedResult = await pool.query(`
            SELECT COUNT(*) cnt FROM guardian_toxic_words
            WHERE created_at::date = $1::date AND source = 'llm-detected'
        `, [dateStr]);
        const learnedCount = parseInt(learnedResult.rows[0]?.cnt || 0);

        // Count total actions today
        const actionsResult = await pool.query(`
            SELECT action_type, COUNT(*) cnt FROM guardian_actions
            WHERE created_at::date = $1::date
            GROUP BY action_type
        `, [dateStr]);
        const totalActions = {};
        actionsResult.rows.forEach(r => { totalActions[r.action_type] = parseInt(r.cnt); });

        let digestHtml = `🛡️ <b>Вечірній дайджест Guardian</b>\n📅 ${dateStr}\n\n`;

        for (const r of allReports) {
            digestHtml += `━━━ <b>#${r.channel}</b> ━━━\n${r.report}\n\n`;
        }

        digestHtml += `━━━ <b>Загальна статистика</b> ━━━\n`;
        digestHtml += `🛡️ Блокувань: ${totalActions.mute || 0}\n`;
        digestHtml += `🔒 Замасковано: ${totalActions.mask || 0}\n`;
        digestHtml += `🗑️ Видалено: ${totalActions.delete || 0}\n`;
        digestHtml += `🧠 Нових слів вивчено: ${learnedCount}\n`;

        await alertDirector(digestHtml);
        log.info(`Director digest sent for ${dateStr}, ${allReports.length} channels`);
    } catch (err) {
        log.error('Failed to send director digest', err);
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
 * Pre-check message BEFORE saving to DB.
 * Called from chat route — blocks toxic messages before they appear.
 *
 * Pipeline:
 *   1. Check if user is muted → block
 *   2. Keyword profanity check (instant) → block
 *   3. LLM profanity check (1-2s) → block
 *
 * Returns: { blocked: bool, reason?, message? }
 */
async function preCheckMessage({ channelId, userId, username, content }) {
    if (!content) return { blocked: false };

    // Emergency Stop — якщо активовано, нічого не перевіряємо
    if (GUARDIAN_EMERGENCY_STOP) return { blocked: false };

    // Per-channel toggle — якщо Guardian вимкнений для цього каналу, пропускаємо
    try {
        const channelSettings = await getChannelSettings(channelId);
        if (!channelSettings.guardian_enabled) return { blocked: false };
    } catch (_) { /* default: enabled */ }

    // 0. Track spam (fire-and-forget)
    trackSpam(userId, username, channelId);

    // 1. Check if muted
    if (isUserMuted(channelId, userId)) {
        log.info(`Blocked muted user ${username} in ch:${channelId}`);
        return {
            blocked: true,
            reason: 'muted',
            message: '🛡️ Ви заблоковані в цьому чаті. Зачекайте 1 хвилину.'
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

    // 2. Quick keyword check — blocks BEFORE message is saved
    const toxicWords = quickToxicityCheck(content);
    if (toxicWords) {
        const isRussian = toxicWords.some(w => w.includes('російська'));
        const reason = isRussian
            ? '🇷🇺 Російська мова заборонена. Спілкуйтесь українською!'
            : `Нецензурна лексика: ${toxicWords.slice(0, 2).join(', ')}`;
        const muteClaim = await muteUser(channelId, userId, username, reason);
        if (!muteClaim?.duplicate) {
            _trackLLMFinding(channelId, username, 'keyword', reason, toxicWords);
            await logAction('block_precheck', channelId, userId, null, { reason, words: toxicWords, username, source: 'keyword' });
        }
        return { blocked: true, reason, message: '🛡️ ' + reason };
    }

    // 3. LLM profanity check — catches creative bypass (1-2s)
    if (AI_ENABLED && content.length >= 3) {
        const llmResult = await llmProfanityCheck(content);
        if (llmResult && llmResult.toxic) {
            const reason = `AI: ${llmResult.reason || 'Нецензурна лексика (обхід фільтру)'}`;
            const muteClaim = await muteUser(channelId, userId, username, reason);
            if (!muteClaim?.duplicate) {
                _learnWordsFromLLM(llmResult.words);
                _trackLLMFinding(channelId, username, 'llm-realtime', reason, llmResult.words || []);
                await logAction('block_precheck', channelId, userId, null, { reason, words: llmResult.words, username, source: 'llm' });
            }
            return { blocked: true, reason, message: '🛡️ ' + reason };
        }
    }

    return { blocked: false };
}

/**
 * Process an already-saved message (background tasks).
 * Called from chat route AFTER message is saved and sent to client.
 *
 * Pipeline:
 *   1. Track conversation for daily reports
 *   2. Mask sensitive data (fire-and-forget)
 *   3. Conflict detection + batch learning (fire-and-forget)
 */
async function processMessage(message) {
    if (!message || !message.content) return;

    // Emergency Stop — якщо активовано, не обробляємо
    if (GUARDIAN_EMERGENCY_STOP) return;

    // Don't process bot messages
    if (message.isBot || message.username === GUARDIAN_USERNAME || message.username === 'openclaw') {
        return;
    }

    const { channelId, userId, content, username, id: messageId } = message;

    // Per-channel Contour-2 toggle
    try {
        const channelSettings = await getChannelSettings(channelId);
        if (!channelSettings.guardian_enabled) return;
        // contour2_enabled controls processMessage (AI analysis)
        if (!channelSettings.contour2_enabled) return;
    } catch (_) { /* default: enabled */ }

    // 1. Track conversation for daily reports
    _trackConversation(channelId, username, content);

    // 2. Mask sensitive data (fire-and-forget)
    maskSensitiveInMessage(messageId, channelId, content, username).catch(err => {
        log.error('Masking error', err);
    });

    // 3. Conflict detection + batch learning (fire-and-forget)
    (async () => {
        try {
            await analyzeConflict(channelId, userId, username, content, messageId);
        } catch (err) {
            log.error('Conflict analysis error', err);
        }
    })();

    // 4. Sentiment analysis (fire-and-forget)
    analyzeSentiment(channelId, userId, messageId, content).catch(err => {
        log.error('Sentiment analysis error', err);
    });

    // 5. Activity heatmap update (fire-and-forget)
    updateActivityHeatmap(channelId, 'message').catch(err => {
        log.error('Activity heatmap update error', err);
    });
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

/**
 * Send DM to director with inline action buttons (metadata).
 * Frontend renders buttons based on message metadata.actions array.
 */
async function alertDirectorWithActions(content, actions) {
    try {
        const directorId = await getDirectorUserId();
        if (!directorId) return;

        const guardianId = await getGuardianUserId();
        if (!guardianId) return;

        const { channelId } = await provisionGuardianDirectorDm({ pool, guardianId, directorId });

        // Send message with action metadata
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const seqResult = await client.query('SELECT next_chat_seq($1) AS seq', [channelId]);
            const seq = seqResult.rows[0].seq;

            const actionMetadata = buildGuardianActionMetadata(actions);
            const metadata = JSON.stringify({ source: 'guardian', actions: actionMetadata });
            const result = await client.query(`
                INSERT INTO chat_messages (channel_id, user_id, seq, content, is_bot, content_type, metadata)
                VALUES ($1, $2, $3, $4, true, 'bot', $5)
                RETURNING *
            `, [channelId, guardianId, seq, content, metadata]);
            await client.query('COMMIT');

            const msg = result.rows[0];
            broadcastToChannel(channelId, 'chat:message', {
                channelId,
                message: {
                    id: msg.id,
                    channelId: msg.channel_id,
                    userId: msg.user_id,
                    seq: msg.seq,
                    content: msg.content,
                    isBot: true,
                    contentType: 'bot',
                    metadata: { source: 'guardian', actions: actionMetadata },
                    createdAt: msg.created_at,
                    username: GUARDIAN_USERNAME,
                    displayName: 'Guardian 🛡️'
                }
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        log.info(`Alert with actions sent to director: ${content.substring(0, 50)}...`);
    } catch (err) {
        log.error('Failed to alert director with actions', err);
    }
}

async function alertDirector(content) {
    try {
        const directorId = await getDirectorUserId();
        if (!directorId) return;

        const guardianId = await getGuardianUserId();
        if (!guardianId) return;

        const { channelId } = await provisionGuardianDirectorDm({ pool, guardianId, directorId });

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

// Load dynamic toxic words from DB
loadDynamicToxicWords().catch(() => {});
// Load dynamic whitelist from DB
loadDynamicWhitelist().catch(() => {});

// ==========================================
// GUARDIAN CHAT COMMANDS (/g or /guardian)
// ==========================================

/**
 * Log a guardian command execution to the database.
 */
async function logGuardianCommand(channelId, userId, username, command, args) {
    try {
        await pool.query(
            `INSERT INTO guardian_commands_log (channel_id, user_id, username, command, args)
             VALUES ($1, $2, $3, $4, $5)`,
            [channelId, userId, username, command, JSON.stringify(args)]
        );
    } catch (err) {
        log.error('Failed to log guardian command', err);
    }
}

/**
 * Handle /g or /guardian chat commands.
 * Returns { handled: true, response: "..." } if the command was recognized,
 * or { handled: false } if not a guardian command.
 */
async function handleGuardianCommand(channelId, userId, username, commandText, isAdmin) {
    // Parse command: strip /g or /guardian prefix
    const trimmed = commandText.trim();
    let body = '';
    if (trimmed.startsWith('/guardian ')) {
        body = trimmed.slice('/guardian '.length).trim();
    } else if (trimmed === '/guardian') {
        body = 'help';
    } else if (trimmed.startsWith('/g ')) {
        body = trimmed.slice('/g '.length).trim();
    } else if (trimmed === '/g') {
        body = 'help';
    } else {
        return { handled: false };
    }

    const parts = body.split(/\s+/);
    const cmd = (parts[0] || 'help').toLowerCase();
    const args = parts.slice(1);

    // Log every command
    await logGuardianCommand(channelId, userId, username, cmd, args);

    try {
        switch (cmd) {
            case 'help':
                return { handled: true, response: cmdHelp(isAdmin) };
            case 'status':
                return { handled: true, response: await cmdStatus(channelId) };
            case 'stats':
                return { handled: true, response: await cmdStats(channelId, args[0]) };
            case 'mood':
                return { handled: true, response: await cmdMood(channelId) };
            case 'health':
                return { handled: true, response: await cmdHealth(channelId) };
            case 'top':
                if (!isAdmin) return { handled: true, response: '🔒 Ця команда доступна тільки адміністраторам.' };
                return { handled: true, response: await cmdTop(channelId, args[0]) };
            case 'history':
                if (!isAdmin) return { handled: true, response: '🔒 Ця команда доступна тільки адміністраторам.' };
                return { handled: true, response: await cmdHistory(args[0]) };
            case 'mute':
                if (!isAdmin) return { handled: true, response: '🔒 Ця команда доступна тільки адміністраторам.' };
                return { handled: true, response: await cmdMute(channelId, args[0], args[1]) };
            case 'unmute':
                if (!isAdmin) return { handled: true, response: '🔒 Ця команда доступна тільки адміністраторам.' };
                return { handled: true, response: await cmdUnmute(channelId, args[0]) };
            case 'trust':
                if (!isAdmin) return { handled: true, response: '🔒 Ця команда доступна тільки адміністраторам.' };
                return { handled: true, response: await cmdTrust(args) };
            case 'report':
                if (!isAdmin) return { handled: true, response: '🔒 Ця команда доступна тільки адміністраторам.' };
                return { handled: true, response: await cmdReport(channelId) };
            case 'rules':
                if (!isAdmin) return { handled: true, response: '🔒 Ця команда доступна тільки адміністраторам.' };
                return { handled: true, response: await cmdRules() };
            case 'learn':
                if (!isAdmin) return { handled: true, response: '🔒 Ця команда доступна тільки адміністраторам.' };
                return { handled: true, response: await cmdLearn(args) };
            case 'config':
                if (!isAdmin) return { handled: true, response: '🔒 Ця команда доступна тільки адміністраторам.' };
                return { handled: true, response: cmdConfig() };
            default:
                return { handled: true, response: `❓ Невідома команда: "${cmd}". Введіть /g help для списку команд.` };
        }
    } catch (err) {
        log.error(`Guardian command error [${cmd}]`, err);
        return { handled: true, response: `⚠️ Помилка виконання команди "${cmd}": ${err.message}` };
    }
}

// --- Command implementations ---

function cmdHelp(isAdmin) {
    let text = `🛡️ **Guardian — Команди**\n\n`;
    text += `📋 Доступні всім:\n`;
    text += `  /g help — Показати цю довідку\n`;
    text += `  /g status — Стан Guardian: настрій, мьюти, дії\n`;
    text += `  /g stats [today|week|month] — Статистика за період\n`;
    text += `  /g mood — Настрій команди в каналі\n`;
    text += `  /g health — Здоров'я каналу з розбивкою\n`;
    if (isAdmin) {
        text += `\n🔐 Тільки для адмінів:\n`;
        text += `  /g top [offenders|helpers] — Топ-5 порушників або помічників\n`;
        text += `  /g history @username — Історія модерації користувача\n`;
        text += `  /g mute @username [хвилини] — Замʼютити (за замовч. 5 хв)\n`;
        text += `  /g unmute @username — Зняти мʼют\n`;
        text += `  /g trust @username [+|-] [причина] — Змінити рівень довіри\n`;
        text += `  /g report — Згенерувати звіт за сьогодні\n`;
        text += `  /g rules — Показати активні правила\n`;
        text += `  /g learn word1, word2 — Додати слова до фільтра\n`;
        text += `  /g config — Поточна конфігурація Guardian\n`;
    }
    return text;
}

async function cmdStatus(channelId) {
    const state = getGuardianState();
    const mood = getMood();

    // Count active mutes
    const now = Date.now();
    let activeMutes = 0;
    for (const key of Object.keys(_activeMutes)) {
        if (_activeMutes[key] > now) activeMutes++;
    }

    // Today's actions count
    let todayActions = 0;
    try {
        const r = await pool.query(
            `SELECT COUNT(*)::int AS cnt FROM guardian_actions
             WHERE created_at >= CURRENT_DATE`
        );
        todayActions = r.rows[0]?.cnt || 0;
    } catch { /* ignore */ }

    // Channel health
    const health = _channelHealth[channelId];
    const healthStr = health
        ? `${health.score}/100 (останній інцидент: ${health.lastIncident ? new Date(health.lastIncident).toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv' }) : 'немає'})`
        : 'немає даних';

    return `🛡️ **Guardian Status**\n\n` +
        `${mood.emoji} Настрій: ${mood.label} (${mood.level})\n` +
        `🔇 Активних мʼютів: ${activeMutes}\n` +
        `📊 Дій сьогодні: ${todayActions}\n` +
        `💚 Здоровʼя каналу: ${healthStr}`;
}

async function cmdStats(channelId, period) {
    const validPeriods = { today: 'CURRENT_DATE', week: "CURRENT_DATE - INTERVAL '7 days'", month: "CURRENT_DATE - INTERVAL '30 days'" };
    const periodKey = (period && validPeriods[period]) ? period : 'today';
    const since = validPeriods[periodKey];

    try {
        const r = await pool.query(
            `SELECT action_type, COUNT(*)::int AS cnt
             FROM guardian_actions
             WHERE created_at >= ${since}
               AND ($1::int IS NULL OR channel_id = $1)
             GROUP BY action_type
             ORDER BY cnt DESC`,
            [channelId || null]
        );

        const stats = {};
        let total = 0;
        for (const row of r.rows) {
            stats[row.action_type] = row.cnt;
            total += row.cnt;
        }

        const periodLabels = { today: 'сьогодні', week: 'за тиждень', month: 'за місяць' };
        let text = `📊 **Статистика Guardian (${periodLabels[periodKey]})**\n\n`;
        text += `Всього дій: ${total}\n`;
        text += `🔍 Просканованих: ${stats['scan'] || 0}\n`;
        text += `🚫 Заблокованих: ${stats['block'] || 0}\n`;
        text += `🔇 Замʼючених: ${stats['mute'] || 0}\n`;
        text += `🎭 Замаскованих: ${stats['mask'] || 0}\n`;
        if (stats['warn']) text += `⚠️ Попереджень: ${stats['warn']}\n`;
        if (stats['escalate']) text += `🚨 Ескалацій: ${stats['escalate']}\n`;
        return text;
    } catch (err) {
        return `⚠️ Не вдалося отримати статистику: ${err.message}`;
    }
}

async function cmdMood(channelId) {
    try {
        const r = await pool.query(
            `SELECT AVG(sentiment)::numeric(3,2) AS avg_sentiment,
                    COUNT(*)::int AS total,
                    mode() WITHIN GROUP (ORDER BY emoji) AS top_emoji
             FROM guardian_mood_tracking
             WHERE channel_id = $1
               AND created_at >= CURRENT_DATE - INTERVAL '24 hours'`,
            [channelId]
        );

        const row = r.rows[0];
        const avgSentiment = row?.avg_sentiment ? parseFloat(row.avg_sentiment) : null;
        const topEmoji = row?.top_emoji || '—';
        const total = row?.total || 0;

        // Mood trend
        let trend = '➡️ Стабільний';
        if (avgSentiment !== null) {
            if (avgSentiment > 0.5) trend = '📈 Позитивний';
            else if (avgSentiment > 0.2) trend = '🙂 Добрий';
            else if (avgSentiment < -0.3) trend = '📉 Негативний';
            else if (avgSentiment < -0.1) trend = '😐 Нейтральний';
        }

        // Top emojis
        let topEmojis = topEmoji;
        try {
            const re = await pool.query(
                `SELECT emoji, COUNT(*)::int AS cnt
                 FROM guardian_mood_tracking
                 WHERE channel_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '24 hours'
                   AND emoji IS NOT NULL
                 GROUP BY emoji ORDER BY cnt DESC LIMIT 5`,
                [channelId]
            );
            if (re.rows.length > 0) {
                topEmojis = re.rows.map(r => `${r.emoji} (${r.cnt})`).join(', ');
            }
        } catch { /* ignore */ }

        return `😊 **Настрій каналу**\n\n` +
            `📊 Середній сентимент: ${avgSentiment !== null ? avgSentiment.toFixed(2) : 'немає даних'}\n` +
            `${trend}\n` +
            `💬 Повідомлень проаналізовано: ${total}\n` +
            `🏆 Топ емоджі: ${topEmojis}`;
    } catch (err) {
        return `⚠️ Не вдалося отримати настрій: ${err.message}`;
    }
}

async function cmdHealth(channelId) {
    try {
        const r = await pool.query(
            `SELECT
                score,
                COALESCE((factors->>'masksToday')::int, 0) AS masks_today,
                COALESCE((factors->>'spamToday')::int, 0) AS spam_today,
                COALESCE((factors->>'conflictsToday')::int, 0) AS conflicts_today,
                COALESCE((factors->>'cleanMessages')::int, 0) AS clean_messages,
                calculated_at AS updated_at
             FROM guardian_channel_health
             WHERE channel_id = $1
             ORDER BY calculated_at DESC LIMIT 1`,
            [channelId]
        );

        if (!r.rows.length) {
            // Fallback to in-memory health
            const health = _channelHealth[channelId];
            if (health) {
                return `💚 **Здоровʼя каналу**: ${health.score}/100\n(дані з памʼяті)`;
            }
            return `💚 **Здоровʼя каналу**: немає даних для цього каналу.`;
        }

        const h = r.rows[0];
        const scoreEmoji = h.score >= 80 ? '💚' : h.score >= 50 ? '💛' : '❤️';

        return `${scoreEmoji} **Здоровʼя каналу: ${h.score}/100**\n\n` +
            `🧪 Маски: ${h.masks_today ?? '—'}\n` +
            `📨 Спам: ${h.spam_today ?? '—'}\n` +
            `⚔️ Конфлікти: ${h.conflicts_today ?? '—'}\n` +
            `💬 Чисті повідомлення: ${h.clean_messages ?? '—'}\n` +
            `🕐 Оновлено: ${h.updated_at ? new Date(h.updated_at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' }) : '—'}`;
    } catch (err) {
        return `⚠️ Не вдалося отримати здоровʼя каналу: ${err.message}`;
    }
}

async function cmdTop(channelId, type) {
    const category = (type || 'offenders').toLowerCase();

    if (category === 'helpers') {
        try {
            const r = await pool.query(
                `SELECT u.username, AVG(gmt.score)::numeric(3,2) AS avg_sent, COUNT(*)::int AS cnt
                 FROM guardian_mood_tracking gmt
                 JOIN users u ON u.id = gmt.user_id
                 WHERE gmt.analyzed_at >= CURRENT_DATE - INTERVAL '7 days'
                   AND gmt.score > 0
                 GROUP BY u.username
                 ORDER BY avg_sent DESC, cnt DESC
                 LIMIT 5`
            );
            if (!r.rows.length) return `🌟 Немає даних про помічників за цей тиждень.`;

            let text = `🌟 **Топ-5 помічників (тиждень)**\n\n`;
            r.rows.forEach((row, i) => {
                text += `${i + 1}. @${row.username} — сентимент: ${row.avg_sent}, повідомлень: ${row.cnt}\n`;
            });
            return text;
        } catch (err) {
            return `⚠️ Не вдалося отримати топ помічників: ${err.message}`;
        }
    }

    // Default: offenders
    try {
        const r = await pool.query(
            `SELECT ga.target_user_id, u.username, COUNT(*)::int AS cnt
             FROM guardian_actions ga
             LEFT JOIN users u ON u.id = ga.target_user_id
             WHERE ga.action_type IN ('mute', 'block', 'warn')
               AND ga.created_at >= CURRENT_DATE - INTERVAL '7 days'
             GROUP BY ga.target_user_id, u.username
             ORDER BY cnt DESC
             LIMIT 5`
        );
        if (!r.rows.length) return `😇 Немає порушників за цей тиждень!`;

        let text = `🚨 **Топ-5 порушників (тиждень)**\n\n`;
        r.rows.forEach((row, i) => {
            text += `${i + 1}. @${row.username || 'ID:' + row.target_user_id} — порушень: ${row.cnt}\n`;
        });
        return text;
    } catch (err) {
        return `⚠️ Не вдалося отримати топ порушників: ${err.message}`;
    }
}

async function cmdHistory(usernameArg) {
    if (!usernameArg) return `⚠️ Вкажіть імʼя користувача: /g history @username`;
    const uname = usernameArg.replace(/^@/, '');

    try {
        // Find user
        const ur = await pool.query('SELECT id FROM users WHERE username = $1', [uname]);
        if (!ur.rows.length) return `⚠️ Користувача @${uname} не знайдено.`;
        const targetId = ur.rows[0].id;

        // Actions history
        const ar = await pool.query(
            `SELECT action_type, COUNT(*)::int AS cnt
             FROM guardian_actions
             WHERE target_user_id = $1
             GROUP BY action_type
             ORDER BY cnt DESC`,
            [targetId]
        );

        // Trust score
        let trustScore = null;
        try {
            const tr = await pool.query(
                `SELECT gts.trust_score AS score, th.reason, gts.updated_at
                 FROM guardian_trust_scores gts
                 LEFT JOIN LATERAL (
                    SELECT reason
                    FROM guardian_trust_history
                    WHERE user_id = gts.user_id
                    ORDER BY created_at DESC
                    LIMIT 1
                 ) th ON true
                 WHERE gts.user_id = $1`,
                [targetId]
            );
            if (tr.rows.length) trustScore = tr.rows[0];
        } catch { /* table may not exist */ }

        let text = `📋 **Історія модерації: @${uname}**\n\n`;

        if (ar.rows.length) {
            text += `📊 Дії:\n`;
            for (const row of ar.rows) {
                const icons = { mute: '🔇', block: '🚫', warn: '⚠️', mask: '🎭', escalate: '🚨' };
                text += `  ${icons[row.action_type] || '•'} ${row.action_type}: ${row.cnt}\n`;
            }
        } else {
            text += `✅ Порушень не зафіксовано.\n`;
        }

        if (trustScore) {
            text += `\n🤝 Рівень довіри: ${trustScore.score}\n`;
            if (trustScore.reason) text += `   Причина: ${trustScore.reason}\n`;
            text += `   Оновлено: ${new Date(trustScore.updated_at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}`;
        }

        return text;
    } catch (err) {
        return `⚠️ Не вдалося отримати історію: ${err.message}`;
    }
}

async function cmdMute(channelId, usernameArg, minutesArg) {
    if (!usernameArg) return `⚠️ Вкажіть імʼя: /g mute @username [хвилини]`;
    const uname = usernameArg.replace(/^@/, '');
    const minutes = parseInt(minutesArg) || 5;

    try {
        const ur = await pool.query('SELECT id FROM users WHERE username = $1', [uname]);
        if (!ur.rows.length) return `⚠️ Користувача @${uname} не знайдено.`;
        const targetId = ur.rows[0].id;

        // Custom duration mute
        const mutedUntil = new Date(Date.now() + minutes * 60 * 1000);
        const key = `${channelId}:${targetId}`;
        _activeMutes[key] = mutedUntil.getTime();

        await pool.query(
            'INSERT INTO chat_mutes (channel_id, user_id, reason, muted_until) VALUES ($1, $2, $3, $4)',
            [channelId, targetId, `Ручний мʼют через /g mute (${minutes} хв)`, mutedUntil]
        );

        await logAction('mute', channelId, targetId, null, { reason: `Manual mute via /g command`, minutes, username: uname });

        broadcastToChannel(channelId, 'chat:user-muted', {
            channelId,
            userId: targetId,
            username: uname,
            mutedUntil: mutedUntil.toISOString(),
            reason: `Ручний мʼют (${minutes} хв)`
        });

        return `🔇 @${uname} замʼючено на ${minutes} хв (до ${mutedUntil.toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' })}).`;
    } catch (err) {
        return `⚠️ Не вдалося замʼютити: ${err.message}`;
    }
}

async function cmdUnmute(channelId, usernameArg) {
    if (!usernameArg) return `⚠️ Вкажіть імʼя: /g unmute @username`;
    const uname = usernameArg.replace(/^@/, '');

    try {
        const ur = await pool.query('SELECT id FROM users WHERE username = $1', [uname]);
        if (!ur.rows.length) return `⚠️ Користувача @${uname} не знайдено.`;
        const targetId = ur.rows[0].id;

        clearMuteCache(channelId, targetId);

        await pool.query(
            'UPDATE chat_mutes SET muted_until = NOW() WHERE channel_id = $1 AND user_id = $2 AND muted_until > NOW()',
            [channelId, targetId]
        );

        broadcastToChannel(channelId, 'chat:user-unmuted', {
            channelId,
            userId: targetId,
            username: uname
        });

        return `🔊 @${uname} розмʼючено.`;
    } catch (err) {
        return `⚠️ Не вдалося розмʼютити: ${err.message}`;
    }
}

async function cmdTrust(args) {
    // /g trust @username [+|-] [reason...]
    if (!args.length) return `⚠️ Формат: /g trust @username [+|-] [причина]`;
    const uname = args[0].replace(/^@/, '');
    const direction = args[1]; // '+' or '-'
    const reason = args.slice(2).join(' ') || null;

    if (direction !== '+' && direction !== '-') {
        return `⚠️ Вкажіть напрямок: + (підвищити) або - (знизити). Приклад: /g trust @${uname} + Допомагає новачкам`;
    }

    const delta = direction === '+' ? 10 : -10;

    try {
        const ur = await pool.query('SELECT id FROM users WHERE username = $1', [uname]);
        if (!ur.rows.length) return `⚠️ Користувача @${uname} не знайдено.`;
        const targetId = ur.rows[0].id;

        const r = await pool.query(
            `INSERT INTO guardian_trust_scores (user_id, trust_score, level, updated_at)
             VALUES ($1, GREATEST(0, LEAST(100, 50 + $2)), $3, NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET trust_score = GREATEST(0, LEAST(100, guardian_trust_scores.trust_score + $2)),
                           updated_at = NOW()
             RETURNING trust_score AS score`,
            [targetId, delta, getTrustLevel(50 + delta)]
        );

        const newScore = parseInt(r.rows[0].score);
        await pool.query(
            'UPDATE guardian_trust_scores SET level = $1 WHERE user_id = $2',
            [getTrustLevel(newScore), targetId]
        );
        await pool.query(
            'INSERT INTO guardian_trust_history (user_id, delta, reason) VALUES ($1, $2, $3)',
            [targetId, delta, reason || (direction === '+' ? 'manual_increase' : 'manual_decrease')]
        );
        const emoji = direction === '+' ? '📈' : '📉';
        return `${emoji} Довіра @${uname}: ${newScore} (${direction === '+' ? '+' : ''}${delta})${reason ? `\nПричина: ${reason}` : ''}`;
    } catch (err) {
        return `⚠️ Не вдалося оновити довіру: ${err.message}`;
    }
}

async function cmdReport(channelId) {
    try {
        const report = await generateDailyReport(channelId);
        if (report) {
            return `📝 **Звіт згенеровано:**\n\n${report}`;
        }
        return `📝 Звіт згенеровано та відправлено директору.`;
    } catch (err) {
        return `⚠️ Не вдалося згенерувати звіт: ${err.message}`;
    }
}

async function cmdRules() {
    try {
        const toxicCount = TOXIC_KEYWORDS_BASE.length + _dynamicToxicWords.length;
        let text = `📏 **Правила Guardian**\n\n`;
        text += `🔤 Базових токсичних слів: ${TOXIC_KEYWORDS_BASE.length}\n`;
        text += `📚 Динамічних (навчених): ${_dynamicToxicWords.length}\n`;
        text += `📋 Всього в фільтрі: ${toxicCount}\n\n`;
        text += `⚙️ Активні правила:\n`;
        text += `  • Авто-мʼют за токсичність\n`;
        text += `  • Маскування чутливих даних (телефони, картки, ІПН)\n`;
        text += `  • Анти-спам (${SPAM_THRESHOLD} повідомлень / ${SPAM_WINDOW_MS / 1000}с)\n`;
        text += `  • Рецидивісти (${REPEAT_OFFENDER_THRESHOLD} порушення / тиждень)\n`;
        text += `  • Погодинний ліміт блокувань: ${HOURLY_BLOCK_THRESHOLD}\n`;
        return text;
    } catch (err) {
        return `⚠️ Не вдалося отримати правила: ${err.message}`;
    }
}

async function cmdLearn(args) {
    // Args: ["word1,", "word2,", "word3"] or ["word1", "word2"]
    const rawText = args.join(' ');
    const words = rawText.split(/[,\s]+/).map(w => w.trim().toLowerCase()).filter(w => w.length >= 2);

    if (!words.length) return `⚠️ Вкажіть слова: /g learn word1, word2, word3`;

    const added = [];
    const skipped = [];

    for (const word of words) {
        if (TOXIC_KEYWORDS_BASE.includes(word) || _dynamicToxicWords.includes(word)) {
            skipped.push(word);
            continue;
        }
        try {
            await pool.query(
                `INSERT INTO guardian_toxic_words (word) VALUES ($1) ON CONFLICT DO NOTHING`,
                [word]
            );
            if (_dynamicToxicWords.length < MAX_DYNAMIC_TOXIC_WORDS) _dynamicToxicWords.push(word);
            added.push(word);
        } catch {
            skipped.push(word);
        }
    }

    let text = `📚 **Навчання фільтра**\n\n`;
    if (added.length) text += `✅ Додано: ${added.join(', ')}\n`;
    if (skipped.length) text += `⏭️ Пропущено (вже є): ${skipped.join(', ')}\n`;
    text += `📋 Всього в фільтрі: ${TOXIC_KEYWORDS_BASE.length + _dynamicToxicWords.length}`;
    return text;
}

function cmdConfig() {
    const state = getGuardianState();
    const aiProviders = getAvailableProviders();
    const aiEnabled = aiProviders.length > 0;

    let text = `⚙️ **Конфігурація Guardian**\n\n`;
    text += `🤖 AI аналіз: ${aiEnabled ? '✅ Увімкнено' : '❌ Вимкнено'}${aiEnabled ? ` (${aiProviders.join(', ')})` : ''}\n`;
    text += `${state.mood.emoji} Поточний настрій: ${state.mood.label}\n`;
    text += `🔇 Тривалість мʼюту: ${MUTE_DURATION_MS / 1000}с (авто) / 5 хв (ручний)\n`;
    text += `📨 Спам поріг: ${SPAM_THRESHOLD} повідомлень / ${SPAM_WINDOW_MS / 1000}с\n`;
    text += `🔄 Рецидивіст поріг: ${REPEAT_OFFENDER_THRESHOLD} за тиждень\n`;
    text += `⏰ Погодинний ліміт: ${HOURLY_BLOCK_THRESHOLD} блокувань\n`;
    text += `📱 Telegram алерти: ${TELEGRAM_BOT_TOKEN ? '✅' : '❌'}\n`;
    text += `👤 Boss Telegram ID: ${BOSS_TELEGRAM_ID}\n`;
    text += `🧠 Каналів у памʼяті: ${Object.keys(state.memory).length}\n`;
    text += `📊 Історія настрою: ${state.moodHistory.length} записів`;
    return text;
}

// ==========================================
// CHANNEL HEALTH SCORE SYSTEM
// ==========================================

/**
 * Calculate health score (0-100) for a channel based on incidents.
 */
async function calculateChannelHealth(channelId) {
    try {
        const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' });

        // Count conflicts today (mutes)
        const conflictsRes = await pool.query(
            `SELECT COUNT(*) cnt FROM guardian_actions
             WHERE channel_id = $1 AND action_type = 'mute' AND created_at::date = $2::date`,
            [channelId, todayStr]
        );
        const conflicts = parseInt(conflictsRes.rows[0]?.cnt || 0);

        // Count mask events today
        const masksRes = await pool.query(
            `SELECT COUNT(*) cnt FROM guardian_actions
             WHERE channel_id = $1 AND action_type = 'mask' AND created_at::date = $2::date`,
            [channelId, todayStr]
        );
        const masks = parseInt(masksRes.rows[0]?.cnt || 0);

        // Count spam detections today
        const spamRes = await pool.query(
            `SELECT COUNT(*) cnt FROM guardian_actions
             WHERE channel_id = $1 AND action_type IN ('block_precheck', 'delete') AND created_at::date = $2::date`,
            [channelId, todayStr]
        );
        const spamIncidents = parseInt(spamRes.rows[0]?.cnt || 0);

        // Count active mutes
        const activeMutesRes = await pool.query(
            `SELECT COUNT(*) cnt FROM chat_mutes
             WHERE channel_id = $1 AND muted_until > NOW()`,
            [channelId]
        );
        const activeMutes = parseInt(activeMutesRes.rows[0]?.cnt || 0);

        // Count total messages today (for positive factor)
        const messagesRes = await pool.query(
            `SELECT COUNT(*) cnt FROM chat_messages
             WHERE channel_id = $1 AND created_at::date = $2::date AND deleted_at IS NULL AND is_bot = false`,
            [channelId, todayStr]
        );
        const totalMessages = parseInt(messagesRes.rows[0]?.cnt || 0);
        const totalIncidents = conflicts + masks + spamIncidents;
        const cleanMessages = Math.max(0, totalMessages - totalIncidents);

        // Calculate score
        let score = 100;
        score -= conflicts * 15;
        score -= masks * 10;
        score -= spamIncidents * 20;
        score -= activeMutes * 10;
        score += Math.floor(cleanMessages / 50) * 5;
        score = Math.max(0, Math.min(100, score));

        const level = getChannelHealthLevel(score);
        const prevScore = _channelHealth[channelId]?.score;

        // Update in-memory cache
        _channelHealth[channelId] = { score, level, updatedAt: new Date().toISOString() };

        const factors = {
            conflictsToday: conflicts,
            masksToday: masks,
            spamToday: spamIncidents,
            activeMutes,
            cleanMessages
        };

        // Upsert into guardian_channel_health
        await pool.query(`
            INSERT INTO guardian_channel_health (channel_id, score, level, factors, calculated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (channel_id) DO UPDATE SET
                score = EXCLUDED.score, level = EXCLUDED.level,
                factors = EXCLUDED.factors,
                calculated_at = NOW()
        `, [channelId, score, level, JSON.stringify(factors)]);

        // Store history
        await pool.query(`
            INSERT INTO guardian_health_history (channel_id, score, level)
            VALUES ($1, $2, $3)
        `, [channelId, score, level]);

        // Alert if score drops below 40
        if (score < 40 && (prevScore === undefined || prevScore >= 40)) {
            const slug = await getChannelSlug(channelId);
            alertDirectorTelegram(
                `🔴 <b>Здоров'я каналу критичне!</b>\n` +
                `Канал: #${slug}\n` +
                `Бал: ${score}/100 (${level})\n` +
                `Конфлікти: ${conflicts}, Маски: ${masks}, Спам: ${spamIncidents}`,
                `channel-health-${channelId}`
            );
        }

        // Broadcast WebSocket event if score changed
        if (prevScore === undefined || prevScore !== score) {
            broadcast('guardian:health', {
                channelId,
                score,
                level,
                prevScore: prevScore || null
            });
        }

        return { score, level, conflicts, masks, spamIncidents, activeMutes, cleanMessages };
    } catch (err) {
        log.error('Failed to calculate channel health', err);
        return null;
    }
}

/**
 * Update health scores for all channels (called by scheduler).
 */
async function updateAllChannelHealth() {
    try {
        const guardianId = await getGuardianUserId();
        if (!guardianId) return;

        const channels = await pool.query(`
            SELECT c.id FROM chat_channels c
            JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = $1
            WHERE c.is_dm = false OR c.is_dm IS NULL
        `, [guardianId]);

        for (const ch of channels.rows) {
            await calculateChannelHealth(ch.id);
        }
        log.info(`Channel health updated for ${channels.rows.length} channels`);
    } catch (err) {
        log.error('Failed to update all channel health', err);
    }
}

/**
 * Get health level label from score.
 */
function getChannelHealthLevel(score) {
    if (score >= 80) return 'green';
    if (score >= 40) return 'yellow';
    return 'red';
}

// ==========================================
// TEAM MOOD / SENTIMENT TRACKING
// ==========================================

const POSITIVE_WORDS = [
    'дякую', 'супер', 'клас', 'круто', 'молодець', 'чудово', 'вітаю', 'люблю',
    'прекрасно', 'добре', 'згоден', 'так', 'ура', '❤️', '👍', '🎉', '😊', '💪',
    '🔥', 'красиво', 'файно', 'здорово', 'відмінно', 'чіткий', 'потужно'
];

const NEGATIVE_WORDS = [
    'проблема', 'помилка', 'баг', 'зламав', 'не працює', 'жах', 'погано', 'відстій',
    'ненавиджу', 'бісить', 'дратує', 'фу', '😡', '😤', '👎', 'кошмар', 'жесть',
    'хрінь', 'фігня'
];

const EMOTION_KEYWORDS = {
    joy: ['ура', 'супер', 'круто', 'клас', '🎉', '😊', 'вау', 'чудово', 'здорово'],
    gratitude: ['дякую', 'вдячний', 'вдячна', 'спасибі', 'дяка', '🙏', 'респект'],
    frustration: ['не працює', 'баг', 'помилка', 'зламав', 'фігня', 'хрінь', 'знову', 'опять'],
    anger: ['бісить', 'дратує', 'ненавиджу', 'жах', 'кошмар', '😡', '😤', 'жесть', 'відстій']
};

/**
 * Analyze sentiment of a message using keyword-based approach.
 */
async function analyzeSentiment(channelId, userId, messageId, content) {
    try {
        if (!content || content.length < 2) return;

        const lower = content.toLowerCase();

        let positiveCount = 0;
        let negativeCount = 0;

        for (const word of POSITIVE_WORDS) {
            if (lower.includes(word)) positiveCount++;
        }
        for (const word of NEGATIVE_WORDS) {
            if (lower.includes(word)) negativeCount++;
        }

        const total = positiveCount + negativeCount;
        let score = 0;
        if (total > 0) {
            score = (positiveCount - negativeCount) / total;
        }
        // Clamp to -1.0 to +1.0
        score = Math.max(-1.0, Math.min(1.0, score));

        // Detect emotions
        const emotions = [];
        for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
            if (keywords.some(kw => lower.includes(kw))) {
                emotions.push(emotion);
            }
        }
        if (emotions.length === 0) emotions.push('neutral');

        const sentiment = score > 0.3 ? 'positive' : score < -0.3 ? 'negative' : 'neutral';

        // Store in guardian_mood_tracking
        await pool.query(`
            INSERT INTO guardian_mood_tracking (channel_id, user_id, message_id, sentiment, score, emotions)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [channelId, userId, messageId, sentiment, score, JSON.stringify(emotions)]);

        // If positive mood, award trust
        if (score > 0.5) {
            updateTrustScore(userId, 1, 'positive_mood').catch(err => {
                log.error('Trust score update on positive mood failed', err);
            });
        }

        return { score, emotions, positiveCount, negativeCount };
    } catch (err) {
        log.error('Failed to analyze sentiment', err);
        return null;
    }
}

/**
 * Get mood summary for a channel over a period.
 */
async function getChannelMoodSummary(channelId, period) {
    try {
        let dateFilter;
        if (period === 'today') {
            dateFilter = "analyzed_at::date = CURRENT_DATE";
        } else if (period === 'week') {
            dateFilter = "analyzed_at >= NOW() - INTERVAL '7 days'";
        } else {
            dateFilter = "analyzed_at::date = CURRENT_DATE";
        }

        const result = await pool.query(`
            SELECT
                COUNT(*) AS total_messages,
                AVG(score) AS avg_sentiment,
                COUNT(*) FILTER (WHERE score > 0.3) AS positive_count,
                COUNT(*) FILTER (WHERE score < -0.3) AS negative_count,
                COUNT(*) FILTER (WHERE score BETWEEN -0.3 AND 0.3) AS neutral_count
            FROM guardian_mood_tracking
            WHERE channel_id = $1 AND ${dateFilter}
        `, [channelId]);

        const row = result.rows[0];

        // Get top emotions
        const emotionsResult = await pool.query(`
            SELECT emotions FROM guardian_mood_tracking
            WHERE channel_id = $1 AND ${dateFilter}
        `, [channelId]);

        const emotionCounts = {};
        for (const r of emotionsResult.rows) {
            const emo = typeof r.emotions === 'string' ? JSON.parse(r.emotions) : r.emotions;
            if (Array.isArray(emo)) {
                for (const e of emo) {
                    emotionCounts[e] = (emotionCounts[e] || 0) + 1;
                }
            }
        }

        return {
            totalMessages: parseInt(row.total_messages || 0),
            avgSentiment: parseFloat(row.avg_sentiment || 0),
            positiveCount: parseInt(row.positive_count || 0),
            negativeCount: parseInt(row.negative_count || 0),
            neutralCount: parseInt(row.neutral_count || 0),
            topEmotions: Object.entries(emotionCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([emotion, count]) => ({ emotion, count })),
            period
        };
    } catch (err) {
        log.error('Failed to get channel mood summary', err);
        return null;
    }
}

/**
 * Get mood profile for a specific user.
 */
async function getUserMoodProfile(userId) {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) AS total_messages,
                AVG(score) AS avg_sentiment,
                MIN(score) AS min_sentiment,
                MAX(score) AS max_sentiment,
                COUNT(*) FILTER (WHERE score > 0.3) AS positive_count,
                COUNT(*) FILTER (WHERE score < -0.3) AS negative_count
            FROM guardian_mood_tracking
            WHERE user_id = $1
        `, [userId]);

        const row = result.rows[0];

        // Recent trend (last 7 days vs previous 7 days)
        const trendResult = await pool.query(`
            SELECT
                AVG(score) FILTER (WHERE analyzed_at >= NOW() - INTERVAL '7 days') AS recent_avg,
                AVG(score) FILTER (WHERE analyzed_at >= NOW() - INTERVAL '14 days' AND analyzed_at < NOW() - INTERVAL '7 days') AS prev_avg
            FROM guardian_mood_tracking
            WHERE user_id = $1
        `, [userId]);

        const trend = trendResult.rows[0];
        const recentAvg = parseFloat(trend.recent_avg || 0);
        const prevAvg = parseFloat(trend.prev_avg || 0);

        return {
            totalMessages: parseInt(row.total_messages || 0),
            avgSentiment: parseFloat(row.avg_sentiment || 0),
            minSentiment: parseFloat(row.min_sentiment || 0),
            maxSentiment: parseFloat(row.max_sentiment || 0),
            positiveCount: parseInt(row.positive_count || 0),
            negativeCount: parseInt(row.negative_count || 0),
            trend: recentAvg - prevAvg,
            trendLabel: recentAvg > prevAvg ? 'improving' : recentAvg < prevAvg ? 'declining' : 'stable'
        };
    } catch (err) {
        log.error('Failed to get user mood profile', err);
        return null;
    }
}

// ==========================================
// WEEKLY REPORT SYSTEM
// ==========================================

/**
 * Generate weekly report (called Monday 9:00 AM).
 */
async function generateWeeklyReport() {
    try {
        // Previous Monday-Sunday
        const now = new Date();
        const kyivNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }));
        const dayOfWeek = kyivNow.getDay(); // 0=Sun, 1=Mon
        const lastSunday = new Date(kyivNow);
        lastSunday.setDate(kyivNow.getDate() - (dayOfWeek === 0 ? 0 : dayOfWeek));
        lastSunday.setHours(23, 59, 59, 999);
        const lastMonday = new Date(lastSunday);
        lastMonday.setDate(lastSunday.getDate() - 6);
        lastMonday.setHours(0, 0, 0, 0);

        const periodStart = lastMonday.toLocaleDateString('sv-SE');
        const periodEnd = lastSunday.toLocaleDateString('sv-SE');

        // Previous week for comparison
        const prevSunday = new Date(lastMonday);
        prevSunday.setDate(lastMonday.getDate() - 1);
        const prevMonday = new Date(prevSunday);
        prevMonday.setDate(prevSunday.getDate() - 6);
        const prevStart = prevMonday.toLocaleDateString('sv-SE');
        const prevEnd = prevSunday.toLocaleDateString('sv-SE');

        // Stats for current week
        const statsRes = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM chat_messages WHERE created_at::date BETWEEN $1 AND $2 AND deleted_at IS NULL AND is_bot = false) AS total_messages,
                (SELECT COUNT(*) FROM guardian_actions WHERE action_type = 'mute' AND created_at::date BETWEEN $1 AND $2) AS conflicts,
                (SELECT COUNT(*) FROM guardian_actions WHERE action_type = 'mask' AND created_at::date BETWEEN $1 AND $2) AS masks,
                (SELECT COUNT(*) FROM guardian_toxic_words WHERE created_at::date BETWEEN $1 AND $2) AS new_toxic_words
        `, [periodStart, periodEnd]);

        const stats = statsRes.rows[0];
        const totalMessages = parseInt(stats.total_messages || 0);
        const conflicts = parseInt(stats.conflicts || 0);
        const masks = parseInt(stats.masks || 0);
        const newToxicWords = parseInt(stats.new_toxic_words || 0);

        // Count mutes for the week
        const mutesRes = await pool.query(`
            SELECT COUNT(*) cnt FROM chat_mutes
            WHERE created_at::date BETWEEN $1 AND $2
        `, [periodStart, periodEnd]);
        const mutes = parseInt(mutesRes.rows[0]?.cnt || 0);

        // Stats for previous week (comparison)
        const prevStatsRes = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM chat_messages WHERE created_at::date BETWEEN $1 AND $2 AND deleted_at IS NULL AND is_bot = false) AS total_messages,
                (SELECT COUNT(*) FROM guardian_actions WHERE action_type = 'mute' AND created_at::date BETWEEN $1 AND $2) AS conflicts,
                (SELECT COUNT(*) FROM guardian_actions WHERE action_type = 'mask' AND created_at::date BETWEEN $1 AND $2) AS masks
        `, [prevStart, prevEnd]);

        const prevStats = prevStatsRes.rows[0];
        const prevMessages = parseInt(prevStats.total_messages || 0);
        const prevConflicts = parseInt(prevStats.conflicts || 0);

        // Trend calculation
        const msgTrend = prevMessages > 0 ? ((totalMessages - prevMessages) / prevMessages * 100).toFixed(1) : 'N/A';
        const conflictTrend = prevConflicts > 0 ? ((conflicts - prevConflicts) / prevConflicts * 100).toFixed(1) : 'N/A';

        // Channel breakdown
        const channelBreakdown = await pool.query(`
            SELECT c.id, c.name, c.slug,
                (SELECT COUNT(*) FROM chat_messages cm WHERE cm.channel_id = c.id AND cm.created_at::date BETWEEN $1 AND $2 AND cm.deleted_at IS NULL AND cm.is_bot = false) AS msg_count,
                (SELECT COUNT(*) FROM guardian_actions ga WHERE ga.channel_id = c.id AND ga.action_type = 'mute' AND ga.created_at::date BETWEEN $1 AND $2) AS mute_count
            FROM chat_channels c
            WHERE (c.is_dm = false OR c.is_dm IS NULL)
            ORDER BY msg_count DESC
        `, [periodStart, periodEnd]);

        // Top 5 offenders
        const offendersRes = await pool.query(`
            SELECT u.username, COUNT(*) cnt
            FROM chat_mutes cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.created_at::date BETWEEN $1 AND $2
            GROUP BY u.username
            ORDER BY cnt DESC
            LIMIT 5
        `, [periodStart, periodEnd]);

        // Top 5 positive contributors
        const positiveRes = await pool.query(`
            SELECT u.username, AVG(gmt.score) avg_score, COUNT(*) msg_count
            FROM guardian_mood_tracking gmt
            JOIN users u ON u.id = gmt.user_id
            WHERE gmt.analyzed_at::date BETWEEN $1 AND $2
            GROUP BY u.username
            HAVING COUNT(*) >= 5
            ORDER BY avg_score DESC
            LIMIT 5
        `, [periodStart, periodEnd]);

        // Build report
        let report = `📊 <b>Тижневий звіт Guardian</b>\n`;
        report += `📅 ${periodStart} — ${periodEnd}\n\n`;

        report += `<b>📈 Загальна статистика:</b>\n`;
        report += `• Повідомлень: ${totalMessages} (${msgTrend !== 'N/A' ? (parseFloat(msgTrend) >= 0 ? '+' : '') + msgTrend + '%' : 'перший тиждень'})\n`;
        report += `• Конфліктів: ${conflicts} (${conflictTrend !== 'N/A' ? (parseFloat(conflictTrend) >= 0 ? '+' : '') + conflictTrend + '%' : 'перший тиждень'})\n`;
        report += `• Блокувань (mute): ${mutes}\n`;
        report += `• Замасковано даних: ${masks}\n`;
        report += `• Нових токсичних слів: ${newToxicWords}\n\n`;

        report += `<b>📋 Канали:</b>\n`;
        for (const ch of channelBreakdown.rows) {
            if (parseInt(ch.msg_count) === 0) continue;
            const healthData = _channelHealth[ch.id];
            const healthStr = healthData ? ` | Здоров'я: ${healthData.score}/100` : '';
            report += `• #${ch.slug || ch.name}: ${ch.msg_count} msg, ${ch.mute_count} mutes${healthStr}\n`;
        }

        if (offendersRes.rows.length > 0) {
            report += `\n<b>⚠️ Топ-5 порушників:</b>\n`;
            for (const o of offendersRes.rows) {
                report += `• @${o.username}: ${o.cnt} блокувань\n`;
            }
        }

        if (positiveRes.rows.length > 0) {
            report += `\n<b>🌟 Топ-5 позитивних:</b>\n`;
            for (const p of positiveRes.rows) {
                report += `• @${p.username}: настрій ${parseFloat(p.avg_score).toFixed(2)} (${p.msg_count} msg)\n`;
            }
        }

        // Recommendations
        if (AI_ENABLED) {
            const aiRecommendation = await callLLM(
                `Ти — Guardian AI, модератор чату дитячого парку. На основі тижневої статистики дай 2-3 коротких рекомендації для покращення атмосфери у чаті. Відповідай українською, лаконічно.`,
                `Повідомлень: ${totalMessages}, Конфлікти: ${conflicts}, Блокувань: ${mutes}, Замасковано: ${masks}, Тренд повідомлень: ${msgTrend}%, Тренд конфліктів: ${conflictTrend}%`,
                200
            );
            if (aiRecommendation) {
                report += `\n<b>💡 Рекомендації AI:</b>\n${aiRecommendation}\n`;
            }
        } else {
            report += `\n<b>💡 Рекомендації:</b>\n`;
            if (conflicts > 5) report += `• Високий рівень конфліктів — розглянути профілактичні заходи\n`;
            if (masks > 10) report += `• Багато витоків даних — нагадати команді про безпеку\n`;
            if (totalMessages < 50) report += `• Низька активність — перевірити залученість команди\n`;
            if (conflicts === 0 && masks === 0) report += `• Відмінний тиждень! Продовжувати в тому ж дусі\n`;
        }

        // Save to DB
        const statsPayload = {
            totalMessages,
            conflicts,
            mutes,
            masks,
            newToxicWords,
            trends: { messages: msgTrend, conflicts: conflictTrend }
        };
        await pool.query(`
            INSERT INTO guardian_weekly_reports (week_start, week_end, summary, stats, channel_breakdown, top_offenders, recommendations)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (week_start) DO UPDATE SET
                week_end = EXCLUDED.week_end,
                summary = EXCLUDED.summary,
                stats = EXCLUDED.stats,
                channel_breakdown = EXCLUDED.channel_breakdown,
                top_offenders = EXCLUDED.top_offenders,
                recommendations = EXCLUDED.recommendations,
                created_at = NOW()
        `, [
            periodStart,
            periodEnd,
            report,
            JSON.stringify(statsPayload),
            JSON.stringify(channelBreakdown.rows),
            JSON.stringify(offendersRes.rows),
            JSON.stringify([])
        ]);

        // Send via Telegram
        await sendWeeklyReportTelegram(report);

        log.info(`Weekly report generated for ${periodStart} — ${periodEnd}`);
        return report;
    } catch (err) {
        log.error('Failed to generate weekly report', err);
        return null;
    }
}

/**
 * Send weekly report to director via Telegram.
 */
async function sendWeeklyReportTelegram(report) {
    try {
        // Telegram has 4096 char limit, split if needed
        if (report.length <= 4000) {
            await alertDirectorTelegram(report, 'weekly-report');
        } else {
            // Split into chunks
            const chunks = [];
            let remaining = report;
            while (remaining.length > 0) {
                const chunk = remaining.substring(0, 4000);
                const lastNewline = chunk.lastIndexOf('\n');
                if (lastNewline > 3000 && remaining.length > 4000) {
                    chunks.push(remaining.substring(0, lastNewline));
                    remaining = remaining.substring(lastNewline);
                } else {
                    chunks.push(chunk);
                    remaining = remaining.substring(4000);
                }
            }
            for (const chunk of chunks) {
                await alertDirectorTelegram(chunk, 'weekly-report');
            }
        }

        // Also send as DM in chat
        await alertDirector(report);
    } catch (err) {
        log.error('Failed to send weekly report via Telegram', err);
    }
}

// ==========================================
// ACTIVITY HEATMAP DATA
// ==========================================

/**
 * Update activity heatmap for a channel (hourly buckets).
 */
async function updateActivityHeatmap(channelId, eventType) {
    try {
        const now = new Date();
        const kyivStr = now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' });
        const kyivDate = new Date(kyivStr);
        kyivDate.setMinutes(0, 0, 0);

        // Determine which column to increment
        let messageInc = 0, conflictInc = 0, muteInc = 0;
        if (eventType === 'message') messageInc = 1;
        else if (eventType === 'conflict') conflictInc = 1;
        else if (eventType === 'mute') muteInc = 1;

        await pool.query(`
            INSERT INTO guardian_activity_heatmap (channel_id, hour_bucket, message_count, conflict_count, mute_count)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (channel_id, hour_bucket) DO UPDATE SET
                message_count = guardian_activity_heatmap.message_count + EXCLUDED.message_count,
                conflict_count = guardian_activity_heatmap.conflict_count + EXCLUDED.conflict_count,
                mute_count = guardian_activity_heatmap.mute_count + EXCLUDED.mute_count
        `, [channelId, kyivDate, messageInc, conflictInc, muteInc]);
    } catch (err) {
        log.error('Failed to update activity heatmap', err);
    }
}

/**
 * Get activity heatmap data for a channel.
 */
async function getActivityHeatmap(channelId, days) {
    try {
        days = days || 7;
        const result = await pool.query(`
            SELECT
                TO_CHAR(hour_bucket AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM-DD') AS date,
                EXTRACT(HOUR FROM hour_bucket AT TIME ZONE 'Europe/Kyiv')::int AS hour,
                message_count,
                conflict_count,
                mute_count,
                avg_sentiment
            FROM guardian_activity_heatmap
            WHERE channel_id = $1 AND hour_bucket >= NOW() - ($2 || ' days')::interval
            ORDER BY hour_bucket
        `, [channelId, days]);

        // Also get avg sentiment per hour bucket from mood tracking
        const sentimentResult = await pool.query(`
            SELECT
                TO_CHAR(analyzed_at AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM-DD') AS date,
                EXTRACT(HOUR FROM analyzed_at AT TIME ZONE 'Europe/Kyiv')::int AS hour,
                AVG(score) AS avg_sentiment
            FROM guardian_mood_tracking
            WHERE channel_id = $1 AND analyzed_at >= NOW() - ($2 || ' days')::interval
            GROUP BY TO_CHAR(analyzed_at AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM-DD'), EXTRACT(HOUR FROM analyzed_at AT TIME ZONE 'Europe/Kyiv')
            ORDER BY date, hour
        `, [channelId, days]);

        // Merge sentiment data into heatmap
        const sentimentMap = {};
        for (const r of sentimentResult.rows) {
            const key = `${r.date}:${r.hour}`;
            sentimentMap[key] = parseFloat(r.avg_sentiment || 0);
        }

        return result.rows.map(r => ({
            date: r.date,
            hour: r.hour,
            messageCount: parseInt(r.message_count || 0),
            conflictCount: parseInt(r.conflict_count || 0),
            muteCount: parseInt(r.mute_count || 0),
            avgSentiment: sentimentMap[`${r.date}:${r.hour}`] || parseFloat(r.avg_sentiment || 0)
        }));
    } catch (err) {
        log.error('Failed to get activity heatmap', err);
        return [];
    }
}

// ==========================================
// AUTO-ESCALATION SYSTEM
// ==========================================

/**
 * Check escalation level for a user based on recent incidents.
 */
async function checkEscalation(userId, channelId) {
    try {
        // Count incidents in last 24 hours
        const incidentsRes = await pool.query(`
            SELECT COUNT(*) cnt FROM guardian_actions
            WHERE target_user_id = $1 AND action_type IN ('mute', 'block_precheck')
              AND created_at >= NOW() - INTERVAL '24 hours'
        `, [userId]);
        const incidentCount = parseInt(incidentsRes.rows[0]?.cnt || 0);

        // Get escalation config from DB (seeded in migration)
        let levels;
        try {
            const configRes = await pool.query(`
                SELECT level, threshold AS min_incidents, action, mute_duration_minutes, notify_telegram
                FROM guardian_escalation_config
                ORDER BY level ASC
            `);
            levels = configRes.rows;
        } catch (e) {
            // Fallback if table doesn't exist
            levels = [
                { level: 1, min_incidents: 1, action: 'warn', mute_duration_minutes: 0, notify_telegram: false },
                { level: 2, min_incidents: 2, action: 'mute', mute_duration_minutes: 1, notify_telegram: false },
                { level: 3, min_incidents: 3, action: 'mute', mute_duration_minutes: 10, notify_telegram: false },
                { level: 4, min_incidents: 4, action: 'mute', mute_duration_minutes: 30, notify_telegram: true },
                { level: 5, min_incidents: 5, action: 'mute', mute_duration_minutes: 1440, notify_telegram: true }
            ];
        }

        // Find matching escalation level (highest that matches)
        let matchedLevel = null;
        for (const lvl of levels) {
            if (incidentCount >= parseInt(lvl.min_incidents)) {
                matchedLevel = lvl;
            }
        }

        if (!matchedLevel) {
            return { level: 0, action: 'none', muteDurationMs: MUTE_DURATION_MS, notifyTelegram: false, incidentCount };
        }

        const muteDurationMs = parseInt(matchedLevel.mute_duration_minutes) * 60 * 1000 || MUTE_DURATION_MS;

        return {
            level: parseInt(matchedLevel.level),
            action: matchedLevel.action,
            muteDurationMs,
            notifyTelegram: matchedLevel.notify_telegram,
            incidentCount
        };
    } catch (err) {
        log.error('Failed to check escalation', err);
        return { level: 0, action: 'none', muteDurationMs: MUTE_DURATION_MS, notifyTelegram: false, incidentCount: 0 };
    }
}

/**
 * Get current escalation level for a user (info only).
 */
async function getEscalationLevel(userId) {
    try {
        const incidentsRes = await pool.query(`
            SELECT COUNT(*) cnt FROM guardian_actions
            WHERE target_user_id = $1 AND action_type IN ('mute', 'block_precheck')
              AND created_at >= NOW() - INTERVAL '24 hours'
        `, [userId]);
        const incidentCount = parseInt(incidentsRes.rows[0]?.cnt || 0);

        if (incidentCount >= 5) return { level: 5, incidentCount };
        if (incidentCount >= 4) return { level: 4, incidentCount };
        if (incidentCount >= 3) return { level: 3, incidentCount };
        if (incidentCount >= 2) return { level: 2, incidentCount };
        if (incidentCount >= 1) return { level: 1, incidentCount };
        return { level: 0, incidentCount };
    } catch (err) {
        log.error('Failed to get escalation level', err);
        return { level: 0, incidentCount: 0 };
    }
}

// ==========================================
// TRUST SCORE SYSTEM
// ==========================================

/**
 * Update trust score for a user.
 * delta: positive or negative change
 * reason: 'mute', 'repeated_offense', 'clean_messages', 'positive_mood'
 */
async function updateTrustScore(userId, delta, reason) {
    try {
        // For positive_mood: max once per day
        if (reason === 'positive_mood') {
            const todayCheck = await pool.query(`
                SELECT id FROM guardian_trust_history
                WHERE user_id = $1 AND reason = 'positive_mood' AND created_at::date = CURRENT_DATE
                LIMIT 1
            `, [userId]);
            if (todayCheck.rows.length > 0) return; // Already awarded today
        }

        // Upsert trust score
        await pool.query(`
            INSERT INTO guardian_trust_scores (user_id, trust_score, level)
            VALUES ($1, GREATEST(0, LEAST(100, 50 + $2)), $3)
            ON CONFLICT (user_id) DO UPDATE SET
                trust_score = GREATEST(0, LEAST(100, guardian_trust_scores.trust_score + $2)),
                level = $3,
                updated_at = NOW()
        `, [userId, delta, getTrustLevel(50 + delta)]);

        // Update the level based on actual score
        const currentRes = await pool.query(
            'SELECT trust_score AS score FROM guardian_trust_scores WHERE user_id = $1',
            [userId]
        );
        if (currentRes.rows.length > 0) {
            const currentScore = parseInt(currentRes.rows[0].score);
            const level = getTrustLevel(currentScore);
            await pool.query(
                'UPDATE guardian_trust_scores SET level = $1 WHERE user_id = $2',
                [level, userId]
            );
        }

        // Log history
        await pool.query(`
            INSERT INTO guardian_trust_history (user_id, delta, reason)
            VALUES ($1, $2, $3)
        `, [userId, delta, reason]);

        log.info(`Trust score updated for user ${userId}: ${delta > 0 ? '+' : ''}${delta} (${reason})`);
    } catch (err) {
        log.error('Failed to update trust score', err);
    }
}

/**
 * Get trust score for a user.
 */
async function getTrustScore(userId) {
    try {
        const result = await pool.query(
            'SELECT trust_score AS score, level, updated_at FROM guardian_trust_scores WHERE user_id = $1',
            [userId]
        );
        if (result.rows.length === 0) {
            return { score: 50, level: 'normal', userId };
        }
        const row = result.rows[0];
        return {
            score: parseInt(row.score),
            level: row.level,
            updatedAt: row.updated_at,
            userId
        };
    } catch (err) {
        log.error('Failed to get trust score', err);
        return { score: 50, level: 'normal', userId };
    }
}

/**
 * Get trust level label from score.
 */
function getTrustLevel(score) {
    if (score >= 80) return 'trusted';
    if (score >= 40) return 'normal';
    if (score >= 20) return 'watched';
    return 'restricted';
}

module.exports = {
    processMessage,
    isUserMuted,
    clearMuteCache,
    detectAndMaskSensitive,
    generateDailyReport,
    runDailyReports,
    ensureGuardianMemberships,
    sendGuardianMessage,
    getMood,
    getGuardianState,
    broadcastGuardianEvent,
    alertDirector,
    alertDirectorWithActions,
    alertDirectorTelegram,
    flushLearnBatch,
    preCheckMessage,
    handleGuardianCommand,
    GUARDIAN_USERNAME,
    // Channel Health
    calculateChannelHealth,
    updateAllChannelHealth,
    getChannelHealthLevel,
    // Sentiment Tracking
    analyzeSentiment,
    getChannelMoodSummary,
    getUserMoodProfile,
    // Weekly Reports
    generateWeeklyReport,
    sendWeeklyReportTelegram,
    // Activity Heatmap
    updateActivityHeatmap,
    getActivityHeatmap,
    // Auto-Escalation
    checkEscalation,
    getEscalationLevel,
    // Trust Score
    updateTrustScore,
    getTrustScore,
    getTrustLevel,
    // Etap 1: Whitelist + Censor + Toggle + Emergency Stop
    loadDynamicWhitelist,
    censorToxicMessage,
    censorContent,
    getChannelSettings,
    invalidateChannelSettingsCache,
    setEmergencyStop: (val) => {
        GUARDIAN_EMERGENCY_STOP = !!val;
        log.info(`Guardian Emergency Stop: ${GUARDIAN_EMERGENCY_STOP}`);
    },
    getEmergencyStop: () => GUARDIAN_EMERGENCY_STOP
};
