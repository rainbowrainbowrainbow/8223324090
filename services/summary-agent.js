/**
 * services/summary-agent.js — Sub-agent for chat summaries via OpenRouter
 *
 * Collects messages from all channels, generates summaries,
 * tracks LLM usage costs. Only escalates to Kleshnya if decisions needed.
 */

const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('SummaryAgent');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SUMMARY_MODEL = process.env.SUMMARY_MODEL || process.env.OPENROUTER_MODEL || 'google/gemma-2-9b-it:free';

// Pricing per 1M tokens (USD) — update as models change
const MODEL_PRICING = {
    'google/gemma-2-9b-it:free': { input: 0, output: 0 },
    'google/gemini-2.0-flash-001': { input: 0.1, output: 0.4 },
    'anthropic/claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
    'anthropic/claude-sonnet-4-20250514': { input: 3, output: 15 },
    'meta-llama/llama-3.1-8b-instruct:free': { input: 0, output: 0 },
    'mistralai/mistral-7b-instruct:free': { input: 0, output: 0 },
    'default': { input: 0.5, output: 1.5 }
};

/**
 * Call OpenRouter API and track usage
 */
async function callLLM(systemPrompt, userMessage, maxTokens, service) {
    if (!OPENROUTER_API_KEY) {
        log.warn('No OPENROUTER_API_KEY set — summary agent disabled');
        return null;
    }

    maxTokens = maxTokens || 1000;
    service = service || 'summary';

    try {
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + OPENROUTER_API_KEY,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://park-zp.railway.app',
                'X-Title': 'Event Genix Summary Agent'
            },
            body: JSON.stringify({
                model: SUMMARY_MODEL,
                max_tokens: maxTokens,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ]
            })
        });

        if (!resp.ok) {
            const errText = await resp.text();
            log.error('OpenRouter error', { status: resp.status, body: errText });
            return null;
        }

        const data = await resp.json();
        const text = data.choices?.[0]?.message?.content?.trim() || null;

        // Track usage
        const usage = data.usage || {};
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const totalTokens = promptTokens + completionTokens;

        const pricing = MODEL_PRICING[SUMMARY_MODEL] || MODEL_PRICING['default'];
        const costUsd = (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;

        await trackUsage(service, SUMMARY_MODEL, promptTokens, completionTokens, totalTokens, costUsd, {});

        return { text, tokens: totalTokens, cost: costUsd, model: SUMMARY_MODEL };
    } catch (err) {
        log.error('OpenRouter call failed', err.message);
        return null;
    }
}

/**
 * Save LLM usage to database
 */
async function trackUsage(service, model, promptTokens, completionTokens, totalTokens, costUsd, metadata) {
    try {
        await pool.query(
            `INSERT INTO llm_usage (service, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [service, model, promptTokens, completionTokens, totalTokens, costUsd, JSON.stringify(metadata || {})]
        );
    } catch (err) {
        log.error('Failed to track LLM usage', err.message);
    }
}

/**
 * Get messages from a channel (last N hours or all today)
 */
async function getChannelMessages(channelId, hoursBack) {
    hoursBack = hoursBack || 24;
    const { rows } = await pool.query(
        `SELECT m.id, m.content, m.created_at, u.display_name as author
         FROM chat_messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.channel_id = $1
           AND m.created_at > NOW() - INTERVAL '1 hour' * $2
           AND m.deleted_at IS NULL
         ORDER BY m.created_at ASC
         LIMIT 500`,
        [channelId, hoursBack]
    );
    return rows;
}

/**
 * Get all active channels
 */
async function getActiveChannels() {
    const { rows } = await pool.query(
        `SELECT id, name FROM chat_channels WHERE archived_at IS NULL ORDER BY id`
    );
    return rows;
}

/**
 * Generate summary for a specific channel
 */
async function summarizeChannel(channelId, hoursBack, requestedBy) {
    const messages = await getChannelMessages(channelId, hoursBack || 24);
    if (!messages.length) return { summary: 'Немає повідомлень за цей період.', tokens: 0, cost: 0 };

    const chatLog = messages.map(m => {
        const time = new Date(m.created_at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        return `[${time}] ${m.author}: ${m.content}`;
    }).join('\n');

    const systemPrompt = `Ти — асистент Event Genix. Твоя задача — робити стислі резюме командних розмов.
Правила:
- Відповідай ТІЛЬКИ українською
- Виділяй ключові рішення, завдання, проблеми
- Якщо є щось що потребує рішення керівника — відміть як [ПОТРЕБУЄ РІШЕННЯ]
- Формат: стислий список пунктів
- Не більше 500 слів`;

    const userMsg = `Зроби резюме цієї розмови (${messages.length} повідомлень):\n\n${chatLog}`;

    const result = await callLLM(systemPrompt, userMsg, 1000, 'summary');
    if (!result) return { summary: 'Помилка генерації резюме. OpenRouter недоступний.', tokens: 0, cost: 0 };

    // Save summary to DB
    try {
        await pool.query(
            `INSERT INTO chat_summaries (channel_id, summary, messages_count, period_from, period_to, model, tokens_used, cost_usd, requested_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                channelId,
                result.text,
                messages.length,
                messages[0].created_at,
                messages[messages.length - 1].created_at,
                result.model,
                result.tokens,
                result.cost,
                requestedBy || null
            ]
        );
    } catch (err) {
        log.error('Failed to save summary', err.message);
    }

    return {
        summary: result.text,
        tokens: result.tokens,
        cost: result.cost,
        messagesCount: messages.length,
        needsDecision: (result.text || '').includes('[ПОТРЕБУЄ РІШЕННЯ]')
    };
}

/**
 * Generate summary for ALL channels
 */
async function summarizeAll(hoursBack, requestedBy) {
    const channels = await getActiveChannels();
    const results = [];

    for (const ch of channels) {
        const messages = await getChannelMessages(ch.id, hoursBack || 24);
        if (messages.length < 2) continue; // skip empty/near-empty channels

        const result = await summarizeChannel(ch.id, hoursBack, requestedBy);
        results.push({
            channelId: ch.id,
            channelName: ch.name,
            ...result
        });
    }

    const totalTokens = results.reduce((s, r) => s + (r.tokens || 0), 0);
    const totalCost = results.reduce((s, r) => s + (r.cost || 0), 0);
    const needsDecision = results.some(r => r.needsDecision);

    return { channels: results, totalTokens, totalCost, needsDecision };
}

/**
 * Get LLM usage stats
 */
async function getUsageStats(days) {
    days = days || 30;
    const { rows } = await pool.query(
        `SELECT
            service,
            model,
            COUNT(*) as calls,
            SUM(prompt_tokens) as total_prompt_tokens,
            SUM(completion_tokens) as total_completion_tokens,
            SUM(total_tokens) as total_tokens,
            SUM(cost_usd) as total_cost_usd
         FROM llm_usage
         WHERE created_at > NOW() - INTERVAL '1 day' * $1
         GROUP BY service, model
         ORDER BY total_cost_usd DESC`,
        [days]
    );

    const totals = await pool.query(
        `SELECT
            SUM(total_tokens) as tokens,
            SUM(cost_usd) as cost_usd,
            COUNT(*) as calls
         FROM llm_usage
         WHERE created_at > NOW() - INTERVAL '1 day' * $1`,
        [days]
    );

    return {
        byService: rows,
        totals: totals.rows[0] || { tokens: 0, cost_usd: 0, calls: 0 },
        period: days + ' days'
    };
}

/**
 * Get recent summaries
 */
async function getRecentSummaries(limit) {
    const { rows } = await pool.query(
        `SELECT s.*, c.name as channel_name
         FROM chat_summaries s
         LEFT JOIN chat_channels c ON c.id = s.channel_id
         ORDER BY s.created_at DESC
         LIMIT $1`,
        [limit || 20]
    );
    return rows;
}

module.exports = {
    summarizeChannel,
    summarizeAll,
    getUsageStats,
    getRecentSummaries,
    trackUsage
};
