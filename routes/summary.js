/**
 * routes/summary.js — Chat summary & LLM usage API
 */

const express = require('express');
const router = express.Router();
const { createLogger } = require('../utils/logger');
const summaryAgent = require('../services/summary-agent');

const log = createLogger('SummaryRoute');

// POST /api/summary/channel/:id — summarize a specific channel
router.post('/channel/:id', async (req, res) => {
    try {
        const channelId = parseInt(req.params.id, 10);
        if (isNaN(channelId)) return res.status(400).json({ error: 'Invalid channel ID' });

        const hours = parseInt(req.query.hours, 10) || 24;
        const userId = req.user?.id || req.user?.userId;

        const result = await summaryAgent.summarizeChannel(channelId, hours, userId);
        res.json(result);
    } catch (err) {
        log.error('Summary channel error', err);
        res.status(500).json({ error: 'Failed to generate summary' });
    }
});

// POST /api/summary/all — summarize all active channels
router.post('/all', async (req, res) => {
    try {
        const hours = parseInt(req.query.hours, 10) || 24;
        const userId = req.user?.id || req.user?.userId;

        const result = await summaryAgent.summarizeAll(hours, userId);
        res.json(result);
    } catch (err) {
        log.error('Summary all error', err);
        res.status(500).json({ error: 'Failed to generate summaries' });
    }
});

// GET /api/summary/history — recent summaries
router.get('/history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 20;
        const summaries = await summaryAgent.getRecentSummaries(limit);
        res.json(summaries);
    } catch (err) {
        log.error('Summary history error', err);
        res.status(500).json({ error: 'Failed to fetch summaries' });
    }
});

// GET /api/summary/usage — LLM usage stats
router.get('/usage', async (req, res) => {
    try {
        const days = parseInt(req.query.days, 10) || 30;
        const stats = await summaryAgent.getUsageStats(days);
        res.json(stats);
    } catch (err) {
        log.error('Usage stats error', err);
        res.status(500).json({ error: 'Failed to fetch usage stats' });
    }
});

module.exports = router;
