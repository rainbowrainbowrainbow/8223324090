/**
 * routes/agents.js — Agent Activity Tracking API
 * Contour 2: Monitor LLM agents, get summaries, track progress.
 */
const express = require('express');
const router = express.Router();
const { logActivity, getActivityFeed, getAgentStatus, generateSummary, getLastSummary, parseGitLog } = require('../services/agentTracker');
const { createLogger } = require('../utils/logger');

const log = createLogger('AgentsRoute');

/**
 * GET /api/agents/activity
 * Activity feed with optional filters.
 * Query: ?agent=claude-code&type=feature&since=2026-03-10&limit=50&offset=0
 */
router.get('/activity', async (req, res) => {
    try {
        const { agent, type, since, limit = 50, offset = 0 } = req.query;
        const feed = await getActivityFeed({
            agentTag: agent,
            actionType: type,
            since,
            limit: Math.min(parseInt(limit) || 50, 200),
            offset: parseInt(offset) || 0
        });
        res.json(feed);
    } catch (err) {
        log.error('GET /activity error', err);
        res.status(500).json({ error: 'Не вдалось отримати стрічку активності' });
    }
});

/**
 * GET /api/agents/status
 * Current status of all agents (last activity per agent).
 */
router.get('/status', async (req, res) => {
    try {
        const status = await getAgentStatus();
        res.json(status);
    } catch (err) {
        log.error('GET /status error', err);
        res.status(500).json({ error: 'Не вдалось отримати статус агентів' });
    }
});

/**
 * GET /api/agents/summary
 * AI-generated summary for a period.
 * Query: ?period=today|week|session&agent=claude-code
 */
router.get('/summary', async (req, res) => {
    try {
        const { period = 'today', agent } = req.query;
        // First try to get cached summary
        const cached = await getLastSummary(period, agent || null);
        // If cached and less than 1 hour old, return it
        if (cached && (Date.now() - new Date(cached.createdAt).getTime()) < 3600000) {
            return res.json(cached);
        }
        // Generate fresh
        const summary = await generateSummary(period, agent || null);
        res.json(summary || { summary: 'Немає даних для саммарі.', stats: {} });
    } catch (err) {
        log.error('GET /summary error', err);
        res.status(500).json({ error: 'Не вдалось отримати саммарі' });
    }
});

/**
 * POST /api/agents/activity
 * Webhook: external agent records an activity.
 * Body: { agentTag, actionType, summary, details?, sessionId? }
 */
router.post('/activity', async (req, res) => {
    try {
        const { agentTag, actionType, summary, details, sessionId } = req.body;
        if (!agentTag || !actionType || !summary) {
            return res.status(400).json({ error: 'agentTag, actionType, summary обовʼязкові' });
        }

        const VALID_TAGS = ['claude-code', 'kleshnya', 'anthropic', 'human', 'github'];
        if (!VALID_TAGS.includes(agentTag)) {
            return res.status(400).json({ error: `agentTag повинен бути одним з: ${VALID_TAGS.join(', ')}` });
        }

        const id = await logActivity(agentTag, actionType, summary, details || {}, sessionId);
        res.json({ success: true, id });
    } catch (err) {
        log.error('POST /activity error', err);
        res.status(500).json({ error: 'Не вдалось записати активність' });
    }
});

/**
 * POST /api/agents/sync-git
 * Trigger git log parsing manually.
 */
router.post('/sync-git', async (req, res) => {
    try {
        const { hours = 24 } = req.body;
        const added = await parseGitLog(Math.min(parseInt(hours) || 24, 168));
        res.json({ success: true, added });
    } catch (err) {
        log.error('POST /sync-git error', err);
        res.status(500).json({ error: 'Не вдалось синхронізувати git' });
    }
});

/**
 * POST /api/agents/summary/generate
 * Force generate a fresh summary.
 */
router.post('/summary/generate', async (req, res) => {
    try {
        const { period = 'today', agent } = req.body;
        const summary = await generateSummary(period, agent || null);
        res.json(summary || { summary: 'Немає даних.', stats: {} });
    } catch (err) {
        log.error('POST /summary/generate error', err);
        res.status(500).json({ error: 'Не вдалось згенерувати саммарі' });
    }
});

module.exports = router;
