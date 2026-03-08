/**
 * chat-bot.js — Kleshnya bot integration for team messenger
 *
 * Monitors messages in team chat channels.
 * - In DM with openclaw: responds to ALL messages
 * - In group channels: responds when @openclaw/@kleshnya is mentioned
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

// Cache: channelId → boolean (is DM with bot)
const _botDmChannels = {};

/**
 * Check if a channel is a DM with the bot user.
 */
async function isBotDmChannel(channelId) {
    if (_botDmChannels[channelId] !== undefined) return _botDmChannels[channelId];
    try {
        const botId = await getBotUserId();
        const result = await pool.query(
            'SELECT is_dm, dm_user_ids FROM chat_channels WHERE id = $1',
            [channelId]
        );
        const row = result.rows[0];
        if (row && row.is_dm && row.dm_user_ids) {
            _botDmChannels[channelId] = row.dm_user_ids.includes(botId);
        } else {
            _botDmChannels[channelId] = false;
        }
    } catch (err) {
        log.error('Error checking bot DM channel:', err);
        _botDmChannels[channelId] = false;
    }
    return _botDmChannels[channelId];
}

/**
 * Check if a message is directed at the bot via @mention.
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
    if (_channelHistory[channelId].length > MAX_HISTORY) {
        _channelHistory[channelId] = _channelHistory[channelId].slice(-MAX_HISTORY);
    }
}

/**
 * Process an incoming team chat message.
 * Called from the chat route after a message is sent.
 */
async function processMessage(message) {
    if (!message || !message.content) return;

    // Don't respond to own bot messages
    if (message.isBot || message.username === BOT_USERNAME) return;

    // Track in history
    trackMessage(message.channelId, message.username, message.content);

    // Determine if bot should respond:
    // 1. DM with bot — always respond
    // 2. Group channel — only on @mention
    const isDm = await isBotDmChannel(message.channelId);
    const hasMention = isBotMention(message.content);

    if (!isDm && !hasMention) return;

    // Rate limit per channel
    const now = Date.now();
    if (_lastResponse[message.channelId] && now - _lastResponse[message.channelId] < RATE_LIMIT_MS) {
        log.info(`Rate limited in channel ${message.channelId}`);
        return;
    }
    _lastResponse[message.channelId] = now;

    // In DM, use the full message; in channels, strip the @mention
    const question = isDm ? message.content.trim() : extractQuestion(message.content);
    if (!question) {
        await respondToChannel(message.channelId, message.id,
            '🦀 Привіт! Я Клешня — питай що хочеш! Бронювання, задачі, команду, виручку...');
        return;
    }

    log.info(`Bot ${isDm ? 'DM' : 'mention'} in ch:${message.channelId} by ${message.username}: "${question.substring(0, 50)}..."`);

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

        if (result.suggestions && result.suggestions.length > 0) {
            responseText += '\n\n💡 ' + result.suggestions.join(' · ');
        }

        await respondToChannel(message.channelId, message.id, responseText);

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
