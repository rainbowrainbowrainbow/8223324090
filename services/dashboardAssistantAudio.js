/**
 * services/dashboardAssistantAudio.js - transcription + TTS for CRM assistant rail
 */
const { createLogger } = require('../utils/logger');
const { dashboardAssistantError } = require('./dashboardAssistant');

const log = createLogger('DashboardAssistantAudio');
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
const FALLBACK_TTS_MODEL = 'tts-1';
const DEFAULT_TTS_VOICE = 'nova';
const TTS_VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']);
const TTS_INSTRUCTIONS = [
    'Speak in natural Ukrainian (uk-UA), warm and clear, as a calm CRM guide.',
    'Do not pronounce markdown, emoji, URLs, internal ids, or formatting symbols.',
    'Use a measured pace, Ukrainian stress and intonation, and avoid a robotic English accent.'
].join(' ');

function requireOpenAIKey() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
        throw dashboardAssistantError('openai_not_configured', 503, 'OPENAI_API_KEY is not configured');
    }
    return key;
}

function normalizeVoice(value) {
    const voice = String(value || process.env.OPENAI_TTS_VOICE || DEFAULT_TTS_VOICE).trim();
    return TTS_VOICES.has(voice) ? voice : DEFAULT_TTS_VOICE;
}

function normalizeSpeechText(value) {
    const input = String(value || '').trim();
    if (!input) return '';

    return input
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]+\)/g, '$1')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, ' і ')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/[*_~#>`]+/g, ' ')
        .replace(/[•·]/g, ', ')
        .replace(/[→⇒]/g, ', ')
        .replace(/\bCRM\b/g, 'сі-ер-ем')
        .replace(/\bAI\b/g, 'ей-ай')
        .replace(/\bAPI\b/g, 'ей-пі-ай')
        .replace(/\bP&L\b/g, 'прибутки і витрати')
        .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ' ')
        .replace(/\s+([,.!?;:])/g, '$1')
        .replace(/([,.!?;:]){3,}/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function uniqueSpeechModels(...models) {
    return models
        .map(model => String(model || '').trim())
        .filter(Boolean)
        .filter((model, index, list) => list.indexOf(model) === index);
}

function speechModelSupportsInstructions(model) {
    return /^gpt-4o/i.test(String(model || ''));
}

async function requestSpeechAudio(apiKey, model, input) {
    const body = {
        model,
        voice: normalizeVoice(),
        input,
        response_format: 'mp3'
    };
    if (speechModelSupportsInstructions(model)) {
        body.instructions = TTS_INSTRUCTIONS;
    }

    return fetch(`${OPENAI_API_BASE}/audio/speech`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
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
    const input = normalizeSpeechText(text).slice(0, 4096);
    if (!input) throw dashboardAssistantError('text_required', 400, 'Text is required');

    const models = uniqueSpeechModels(process.env.OPENAI_TTS_MODEL || DEFAULT_TTS_MODEL, DEFAULT_TTS_MODEL, FALLBACK_TTS_MODEL);
    let lastFailure = null;
    for (const model of models) {
        const response = await requestSpeechAudio(apiKey, model, input);
        if (response.ok) {
            return Buffer.from(await response.arrayBuffer());
        }
        const payload = await response.json().catch(() => ({}));
        lastFailure = {
            status: response.status,
            model,
            error: payload?.error?.message || payload?.error || 'unknown'
        };
        log.warn('OpenAI speech failed', {
            status: lastFailure.status,
            model: lastFailure.model,
            error: lastFailure.error
        });
        if (response.status === 401 || response.status === 403) break;
    }

    throw dashboardAssistantError('speech_failed', lastFailure?.status >= 500 ? 502 : (lastFailure?.status || 502), 'OpenAI speech request failed');
}

module.exports = {
    transcribeDashboardAudio,
    synthesizeDashboardSpeech,
    normalizeVoice,
    normalizeSpeechText,
    uniqueSpeechModels,
    speechModelSupportsInstructions
};
