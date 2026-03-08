/**
 * chat-bot.js — Kleshnya bot integration for team messenger
 *
 * Monitors messages in team chat channels.
 * When @openclaw or @kleshnya is mentioned, generates a response
 * via kleshnya-chat engine and posts it as a bot message.
 */

const { createLogger } = require('../utils/logger');
const log = createLogger('ChatBot');
const { generateChatResponse } = require('./kleshnya-chat');
const { sendBotMessage } = require('./chatService');
const { broadcastToChannel } = require('./websocket');
const { pool } = require('../db');

// Bot trigger patterns
const BOT_MENTIONS = ['@openclaw', '@kleshnya', '@клешня', '@бот'];
const BOT_USERNAME = 'openclaw';

// Rate limit: max 1 response per channel per 3 seconds
const _lastResponse = {};
const RATE_LIMIT_MS = 3000;

// Chat history cache per channel (last N messages for context)
const _channelHistory = {};
const MAX_HISTORY = 10;

/**
 * Check if a message is directed at the bot.
 */
function isBotMention(content) {
    if (!content) return false;
    const lower = content.toLowerCase();
    return BOT_MENTIONS.some(mention => lower.includes(mention));
}

/**
 * Extract the user's question from the message (remove bot mention).
 */
function extractQuestion(content) {
    let text = content;
    // Remove all bot mention patterns (case-insensitive)
    for (const mention of BOT_MENTIONS) {
        const regex = new RegExp(mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        text = text.replace(regex, '');
    }
    return text.trim();
}

/**
 * Add message to channel history for context.
 */
function trackMessage(channelId, username, content) {
    if (!_channelHistory[channelId]) {
        _channelHistory[channelId] = [];
    }
    _channelHistory[channelId].push({
        role: username === BOT_USERNAME ? 'assistant' : 'user',
        content: content
    });
    // Keep only last N
    if (_channelHistory[channelId].length > MAX_HISTORY) {
        _channelHistory[channelId] = _channelHistory[channelId].slice(-MAX_HISTORY);
    }
}

/**
 * Process an incoming team chat message.
 * Called from the chat route after a message is sent.
 *
 * @param {object} message - The full message object (with username, content, channelId, etc.)
 */
async function processMessage(message) {
    if (!message || !message.content) return;

    // Don't respond to own bot messages
    if (message.isBot || message.username === BOT_USERNAME) return;

    // Track in history
    trackMessage(message.channelId, message.username, message.content);

    // Check if this is a bot mention
    if (!isBotMention(message.content)) return;

    // Rate limit per channel
    const now = Date.now();
    if (_lastResponse[message.channelId] && now - _lastResponse[message.channelId] < RATE_LIMIT_MS) {
        log.info(`Rate limited in channel ${message.channelId}`);
        return;
    }
    _lastResponse[message.channelId] = now;

    const question = extractQuestion(message.content);
    if (!question) {
        // Just a mention with no question — send help
        await respondToChannel(message.channelId, message.id,
            '🦀 Привіт! Я Клешня — питай що хочеш! Бронювання, задачі, команду, виручку...');
        return;
    }

    log.info(`Bot mention in ch:${message.channelId} by ${message.username}: "${question.substring(0, 50)}..."`);

    // Show typing indicator
    broadcastToChannel(message.channelId, 'chat:typing', {
        channelId: message.channelId,
        userId: await getBotUserId(),
        username: BOT_USERNAME
    });

    try {
        const history = _channelHistory[message.channelId] || [];
        const result = await generateChatResponse(question, message.username, history);

        let responseText = result.message || '🦀 Не зрозумів, спробуй інакше.';

        // Add suggestions as inline hints
        if (result.suggestions && result.suggestions.length > 0) {
            responseText += '\n\n💡 ' + result.suggestions.join(' · ');
        }

        await respondToChannel(message.channelId, message.id, responseText);

        // Track bot response in history
        trackMessage(message.channelId, BOT_USERNAME, responseText);
    } catch (err) {
        log.error('Bot response error:', err);
        await respondToChannel(message.channelId, message.id,
            '🦀 Ой, щось пішло не так. Спробуй ще раз!');
    }
}

/**
 * Send a bot response to a channel.
 */
async function respondToChannel(channelId, replyToId, content) {
    try {
        const botMsg = await sendBotMessage(channelId, content, {
            contentType: 'bot',
            metadata: { replyTo: replyToId, source: 'kleshnya' }
        });

        // Broadcast to channel
        broadcastToChannel(channelId, 'chat:message', {
            channelId,
            message: botMsg
        });

        log.info(`Bot responded in ch:${channelId}, msg:${botMsg.id}`);
    } catch (err) {
        log.error('Failed to send bot message:', err);
    }
}

// Cache bot user ID
let _botUserId = null;
async function getBotUserId() {
    if (_botUserId) return _botUserId;
    try {
        const result = await pool.query(
            "SELECT id FROM users WHERE username = $1", [BOT_USERNAME]
        );
        _botUserId = result.rows[0]?.id || 1;
    } catch (e) {
        _botUserId = 1;
    }
    return _botUserId;
}

/**
 * Ensure bot user is member of all default channels.
 * Called once on startup.
 */
async function ensureBotMemberships() {
    try {
        const botId = await getBotUserId();
        await pool.query(`
            INSERT INTO chat_channel_members (channel_id, user_id)
            SELECT c.id, $1 FROM chat_channels c WHERE c.is_default = true
            ON CONFLICT (channel_id, user_id) DO NOTHING
        `, [botId]);
        log.info(`Bot memberships ensured for user ${BOT_USERNAME} (id: ${botId})`);
    } catch (err) {
        log.error('Failed to ensure bot memberships:', err);
    }
}

module.exports = {
    processMessage,
    isBotMention,
    ensureBotMemberships,
    BOT_USERNAME
};
