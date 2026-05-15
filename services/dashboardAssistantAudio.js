/**
 * services/dashboardAssistantAudio.js — transcription + TTS for CRM assistant rail
 */
const { createLogger } = require('../utils/logger');
const { dashboardAssistantError } = require('./dashboardAssistant');

const log = createLogger('DashboardAssistantAudio');
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const TTS_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']);

function requireOpenAIKey() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
        throw dashboardAssistantError('openai_not_configured', 503, 'OPENAI_API_KEY is not configured');
    }
    return key;
}

function normalizeVoice(value) {
    const voice = String(value || process.env.OPENAI_TTS_VOICE || 'alloy').trim();
    return TTS_VOICES.has(voice) ? voice : 'alloy';
}

async function transcribeDashboardAudio({ buffer, filename = 'crm-assistant.webm', mimetype = 'audio/webm' } = {}) {
    const apiKey = requireOpenAIKey();
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw dashboardAssistantError('audio_required', 400, 'Audio file is required');
    }

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimetype || 'application/octet-stream' }), filename);
    form.append('model', process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1');
    form.append('language', process.env.OPENAI_TRANSCRIPTION_LANGUAGE || 'uk');
    form.append('response_format', 'json');

    const response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: form
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        log.warn('OpenAI transcription failed', {
            status: response.status,
            error: payload?.error?.message || payload?.error || 'unknown'
        });
        throw dashboardAssistantError('transcription_failed', response.status >= 500 ? 502 : response.status, 'OpenAI transcription request failed');
    }

    return String(payload.text || '').trim();
}

async function synthesizeDashboardSpeech(text) {
    const apiKey = requireOpenAIKey();
    const input = String(text || '').trim().slice(0, 4096);
    if (!input) throw dashboardAssistantError('text_required', 400, 'Text is required');

    const response = await fetch(`${OPENAI_API_BASE}/audio/speech`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
            voice: normalizeVoice(),
            input,
            response_format: 'mp3',
            instructions: 'Говори українською природно, коротко, як спокійний CRM-провідник. Це AI-голос, не людина.'
        })
    });

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        log.warn('OpenAI speech failed', {
            status: response.status,
            error: payload?.error?.message || payload?.error || 'unknown'
        });
        throw dashboardAssistantError('speech_failed', response.status >= 500 ? 502 : response.status, 'OpenAI speech request failed');
    }

    return Buffer.from(await response.arrayBuffer());
}

module.exports = {
    transcribeDashboardAudio,
    synthesizeDashboardSpeech,
    normalizeVoice
};
