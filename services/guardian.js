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

const log = createLogger('Guardian');

const GUARDIAN_USERNAME = 'guardian';
const MUTE_DURATION_MS = 1 * 60 * 1000; // 1 minute

// AI setup — OpenRouter (cheap models) or Anthropic fallback
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AI_ENABLED = !!(OPENROUTER_API_KEY || ANTHROPIC_API_KEY);
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemma-2-9b-it:free';

if (OPENROUTER_API_KEY) {
    log.info(`Guardian AI enabled (OpenRouter: ${OPENROUTER_MODEL})`);
} else if (ANTHROPIC_API_KEY) {
    log.info('Guardian AI enabled (Anthropic fallback)');
}

/**
 * Unified LLM call — tries OpenRouter first, Anthropic fallback.
 * Returns text response or null on error.
 */
async function callLLM(systemPrompt, userMessage, maxTokens) {
    maxTokens = maxTokens || 300;

    if (OPENROUTER_API_KEY) {
        try {
            const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + OPENROUTER_API_KEY,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://park-zp.railway.app',
                    'X-Title': 'Park Guardian AI'
                },
                body: JSON.stringify({
                    model: OPENROUTER_MODEL,
                    max_tokens: maxTokens,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage }
                    ]
                })
            });
            if (!resp.ok) {
                const errText = await resp.text();
                log.error('OpenRouter API error', { status: resp.status, body: errText });
                return null;
            }
            const data = await resp.json();
            return data.choices?.[0]?.message?.content?.trim() || null;
        } catch (err) {
            log.error('OpenRouter call failed', err.message);
            return null;
        }
    }

    if (ANTHROPIC_API_KEY) {
        try {
            const Anthropic = require('@anthropic-ai/sdk');
            const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
            const response = await anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: maxTokens,
                system: systemPrompt,
                messages: [{ role: 'user', content: userMessage }]
            });
            return response.content[0]?.text?.trim() || null;
        } catch (err) {
            log.error('Anthropic call failed', err.message);
            return null;
        }
    }

    return null;
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
            details: `Заблоковано на 1 хв: ${reason}`,
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
    'whore', 'slut'
];

// Dynamic toxic words loaded from DB
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
    // Normalize: remove separators between letters (catches "г а в н о", "г-а-в-н-о")
    const normalized = lower.replace(/[\s.\-_*!?,;:'"()]+/g, '');

    // 0. Detect Russian language — block entirely
    const ruDetect = detectRussianLanguage(content);
    if (ruDetect) {
        return ['🇷🇺 російська мова'];
    }

    // 1. Direct match on all keywords (base + dynamic)
    const allKeywords = [...TOXIC_KEYWORDS_BASE, ..._dynamicToxicWords];
    const directMatch = allKeywords.filter(word => lower.includes(word) || normalized.includes(word));
    if (directMatch.length > 0) return directMatch;

    // 2. Fuzzy regex match (catches leet-speak, substitutions)
    const fuzzyMatch = [];
    for (const { word, regex } of _fuzzyRegexes) {
        if (regex.test(lower)) {
            fuzzyMatch.push(word);
            if (fuzzyMatch.length >= 3) break; // enough evidence
        }
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
                    _dynamicToxicWords.push(lower);
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
                    _dynamicToxicWords.push(lower);
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
            `Ти — модератор чату. Проаналізуй останні повідомлення і визнач чи є конфлікт або агресія.
Відповідай ТІЛЬКИ у форматі JSON: {"conflict": true/false, "severity": "low"/"medium"/"high", "aggressors": ["username"], "reason": "короткий опис"}
Якщо конфлікту немає — {"conflict": false}
Враховуй контекст: жарти та легке підколювання — це нормально. Шукай справжню агресію та образи.`,
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

        const summary = await callLLM(
            `Ти — Guardian, AI-модератор корпоративного чату розважального парку "Парк Закревського Періоду".
Створи щоденний звіт з чату для директора. Формат:

📊 <b>Звіт за [дата]</b> | #${channel?.slug || 'канал'}

<b>👥 Хто про що:</b>
- @username1 — обговорював [тема], запитував про [тема]
- @username2 — повідомив про [тема], домовився з @username3 про [тема]
(перелічи КОЖНОГО активного учасника та коротко що він обговорював/робив)

<b>📌 Головне:</b>
- Ключові теми та рішення (2-3 пункти)

<b>⚠️ Важливе:</b>
- Рішення, домовленості, дедлайни, задачі

<b>🛡️ Модерація:</b>
- Блокувань: ${actionCounts.mute || 0}, Замасковано: ${actionCounts.mask || 0}, AI-блокувань: ${findingsCount}
${findingsSection}

Пиши українською, лаконічно. Ігноруй дрібні привітання. Фокусуйся на робочих темах та хто чим займався.`,
            `Повідомлення за ${dateStr}:\n\n${chatLog}`, 600
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
                _dynamicToxicWords.push(word);
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
        await muteUser(channelId, userId, username, reason);
        _trackLLMFinding(channelId, username, 'keyword', reason, toxicWords);
        await logAction('block_precheck', channelId, userId, null, { reason, words: toxicWords, username, source: 'keyword' });
        return { blocked: true, reason, message: '🛡️ ' + reason };
    }

    // 3. LLM profanity check — catches creative bypass (1-2s)
    if (AI_ENABLED && content.length >= 3) {
        const llmResult = await llmProfanityCheck(content);
        if (llmResult && llmResult.toxic) {
            const reason = `AI: ${llmResult.reason || 'Нецензурна лексика (обхід фільтру)'}`;
            await muteUser(channelId, userId, username, reason);
            _learnWordsFromLLM(llmResult.words);
            _trackLLMFinding(channelId, username, 'llm-realtime', reason, llmResult.words || []);
            await logAction('block_precheck', channelId, userId, null, { reason, words: llmResult.words, username, source: 'llm' });
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

    // Don't process bot messages
    if (message.isBot || message.username === GUARDIAN_USERNAME || message.username === 'openclaw') {
        return;
    }

    const { channelId, userId, content, username, id: messageId } = message;

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

// Load dynamic toxic words from DB
loadDynamicToxicWords().catch(() => {});

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
    flushLearnBatch,
    preCheckMessage,
    GUARDIAN_USERNAME
};
