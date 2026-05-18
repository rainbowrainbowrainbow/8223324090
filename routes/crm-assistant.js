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
const TELEMETRY_EVENT_TYPES = new Set([
    'action_unavailable',
    'foundation_context_failed',
    'playback_blocked',
    'playback_failed',
    'reply_failed',
    'snapshot_failed',
    'teaching_target_missing',
    'voice_transcription_failed'
]);

router.use(authenticateToken);

function sendAssistantError(res, error, fallbackCode) {
    const status = Number(error?.status || 500);
    const code = error?.code || fallbackCode || 'crm_assistant_failed';
    if (status >= 500) log.error(code, error);
    else log.warn(code, { status, message: error?.message });
    res.status(status).json({ success: false, error: code });
}

function compactTelemetryText(value, limit = 120) {
    const text = String(value || '')
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
        .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, '[jwt-redacted]')
        .replace(/\b(sk|rk|pk|org|proj)-[A-Za-z0-9_-]{12,}\b/g, '$1-[redacted]')
        .replace(/\s+/g, ' ')
        .trim();
    return text.slice(0, limit);
}

function sanitizeTelemetryEvent(body = {}, user = {}) {
    const rawType = compactTelemetryText(body.eventType || body.type, 80);
    const eventType = TELEMETRY_EVENT_TYPES.has(rawType) ? rawType : 'foundation_context_failed';
    return {
        eventType,
        page: compactTelemetryText(body.page || body.module || 'unknown', 80),
        module: compactTelemetryText(body.module || 'assistant', 80),
        assistantState: compactTelemetryText(body.assistantState || body.mode || '', 80),
        playbackState: compactTelemetryText(body.playbackState || '', 80),
        failureReason: compactTelemetryText(body.failureReason || body.reason || '', 180),
        fallbackShown: body.fallbackShown === true,
        actionId: compactTelemetryText(body.actionId || '', 100),
        targetId: compactTelemetryText(body.targetId || '', 100),
        snapshotKey: compactTelemetryText(body.snapshotKey || '', 100),
        source: compactTelemetryText(body.source || 'client', 80),
        role: compactTelemetryText(user.role || '', 80)
    };
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

router.post('/telemetry', express.json({ limit: '16kb' }), async (req, res) => {
    try {
        const event = sanitizeTelemetryEvent(req.body || {}, req.user || {});
        const noisy = ['playback_failed', 'snapshot_failed', 'teaching_target_missing', 'voice_transcription_failed', 'action_unavailable'].includes(event.eventType);
        const logger = noisy || event.fallbackShown ? log.warn : log.info;
        logger.call(log, 'assistant_telemetry', event);
        res.json({ success: true, eventType: event.eventType });
    } catch (error) {
        sendAssistantError(res, error, 'assistant_telemetry_failed');
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
