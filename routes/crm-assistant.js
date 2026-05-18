/**
 * routes/crm-assistant.js — shared CRM assistant AI and voice endpoints
 */
const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const dashboardAssistant = require('../services/dashboardAssistant');
const { transcribeDashboardAudio, synthesizeDashboardSpeech } = require('../services/dashboardAssistantAudio');

const router = express.Router();
const log = createLogger('CrmAssistantRoutes');
const { getDashboardAssistantReply } = dashboardAssistant;
const normalizeAssistantReply = dashboardAssistant.normalizeAssistantReply || ((reply) => reply);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024 }
});

router.use(authenticateToken);

function sendAssistantError(res, error, fallbackCode) {
    const status = Number(error?.status || 500);
    const code = error?.code || fallbackCode || 'crm_assistant_failed';
    if (status >= 500) log.error(code, error);
    else log.warn(code, { status, message: error?.message });
    res.status(status).json({ success: false, error: code });
}

router.post('/reply', async (req, res) => {
    try {
        const body = req.body || {};
        const userRole = req.user?.role || body.role || '';
        const previewRole = userRole === 'creator' ? body.scenePreset || body.previewRole || body.recentState?.previewRole || '' : '';
        const scenePreset = previewRole || userRole || '';
        const assistantInput = {
            ...body,
            role: userRole,
            displayRole: body.displayRole || '',
            scenePreset,
            recentState: {
                ...(body.recentState || {}),
                previewRole
            }
        };
        const reply = await getDashboardAssistantReply(assistantInput);
        res.json({ success: true, reply: normalizeAssistantReply(reply, assistantInput) });
    } catch (error) {
        sendAssistantError(res, error, 'assistant_reply_failed');
    }
});

router.post('/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file?.buffer) return res.status(400).json({ success: false, error: 'audio_required' });
        const text = await transcribeDashboardAudio({
            buffer: req.file.buffer,
            filename: req.file.originalname || 'crm-assistant.webm',
            mimetype: req.file.mimetype || 'audio/webm'
        });
        res.json({ success: true, text });
    } catch (error) {
        sendAssistantError(res, error, 'transcription_failed');
    }
});

router.post('/speak', async (req, res) => {
    try {
        const text = String(req.body?.text || '').trim();
        if (!text) return res.status(400).json({ success: false, error: 'text_required' });
        const buffer = await synthesizeDashboardSpeech(text);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-AI-Generated-Voice', 'true');
        res.send(buffer);
    } catch (error) {
        sendAssistantError(res, error, 'speech_failed');
    }
});

module.exports = router;
