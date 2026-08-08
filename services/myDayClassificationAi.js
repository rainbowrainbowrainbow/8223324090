'use strict';

const { callUnifiedChatCompletion } = require('./ai-config');
const {
    MAX_IMPACTS_PER_TASK,
    normalizeImpactIds,
    normalizeTags,
    myDayError
} = require('./myDayTaxonomy');

const DEFAULT_MY_DAY_CLASSIFICATION_MODEL = 'openai/gpt-5.4-nano';
const MY_DAY_CLASSIFICATION_MODEL = process.env.MY_DAY_CLASSIFICATION_MODEL || DEFAULT_MY_DAY_CLASSIFICATION_MODEL;
const MIN_CLASSIFICATION_CONFIDENCE = 0.55;

function stripJsonFence(text = '') {
    return String(text || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function parseAiJson(text = '') {
    const cleaned = stripJsonFence(text);
    if (!cleaned) throw myDayError('AI не повернув JSON.', 422, 'MY_DAY_AI_INVALID_JSON');
    try {
        return JSON.parse(cleaned);
    } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
        throw myDayError('AI повернув некоректний JSON.', 422, 'MY_DAY_AI_INVALID_JSON');
    }
}

function taskSnapshot(task = {}) {
    return {
        id: Number(task.id || task.task_id || task.taskId || 0),
        title: String(task.title || '').trim(),
        description: String(task.description || '').trim(),
        status: String(task.status || '').trim(),
        priority: String(task.priority || '').trim(),
        deadline: String(task.deadline || task.date || task.scheduled_start_at || task.scheduledStartAt || '').trim(),
        ownerUserId: task.owner_user_id || task.ownerUserId || null,
        assignedTo: task.assigned_to || task.assignedTo || null,
        updatedAt: task.updated_at || task.updatedAt || null
    };
}

function taskFingerprint(task = {}) {
    return JSON.stringify(taskSnapshot(task));
}

function activeImpactPayload(impacts = []) {
    return (Array.isArray(impacts) ? impacts : [])
        .filter(impact => impact && impact.isActive !== false)
        .map(impact => ({
            id: Number(impact.id),
            name: String(impact.name || '').trim(),
            icon: String(impact.icon || '').trim()
        }))
        .filter(impact => Number.isInteger(impact.id) && impact.id > 0 && impact.name);
}

function buildSystemPrompt() {
    return [
        'You classify one personal My Day task for Event Genix CRM.',
        'Return only strict JSON without markdown.',
        'Do not classify direction, status, priority, deadline, owner, or dependencies.',
        `Choose 0-${MAX_IMPACTS_PER_TASK} impactIds only from the provided active impacts.`,
        'Create 0-5 short Ukrainian or business-language tags.',
        'Tags must be concrete, useful for search, no # prefix, no empty tags, each up to 32 characters.',
        'If the task is too unclear, return empty impactIds/tags and confidence below 0.55.',
        'Required JSON shape: {"impactIds":[number],"tags":[string],"confidence":0.0,"reason":"short reason"}.'
    ].join('\n');
}

function buildUserMessage({ task, impacts }) {
    const safeTask = taskSnapshot(task);
    return JSON.stringify({
        task: {
            title: safeTask.title,
            description: safeTask.description
        },
        activeImpacts: activeImpactPayload(impacts),
        tagRules: {
            maxTags: 5,
            maxTagLength: 32,
            examples: ['CRM', 'Парк', 'Hermes', 'форма бронювання', 'каса', 'worker']
        }
    });
}

function normalizeAiClassification(raw, impacts = []) {
    const payload = raw && typeof raw === 'object' ? raw : {};
    const allowedImpactIds = new Set(activeImpactPayload(impacts).map(impact => impact.id));
    const impactIds = normalizeImpactIds(Array.isArray(payload.impactIds) ? payload.impactIds : []);
    const unknownIds = impactIds.filter(id => !allowedImpactIds.has(id));
    if (unknownIds.length) {
        throw myDayError('AI запропонував недоступний вплив.', 422, 'MY_DAY_AI_UNKNOWN_IMPACT');
    }
    const tags = normalizeTags(Array.isArray(payload.tags) ? payload.tags : []);
    const confidence = Number(payload.confidence);
    const safeConfidence = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
    const reason = String(payload.reason || '').trim().slice(0, 180);
    return { impactIds, tags, confidence: safeConfidence, reason };
}

async function classifyMyDayTask(input = {}, options = {}) {
    const aiClient = options.aiClient || callUnifiedChatCompletion;
    const task = input.task || {};
    const impacts = activeImpactPayload(input.impacts || []);
    const result = await aiClient({
        scope: 'chat_ai',
        model: MY_DAY_CLASSIFICATION_MODEL,
        title: 'Event Genix My Day Classification',
        systemPrompt: buildSystemPrompt(),
        userMessage: buildUserMessage({ task, impacts }),
        maxTokens: 420,
        temperature: 0.1
    });

    if (!result?.ok) {
        return {
            ok: false,
            code: result?.reason === 'missing_key' || result?.reason === 'disabled'
                ? 'MY_DAY_AI_PROVIDER_UNAVAILABLE'
                : 'MY_DAY_AI_PROVIDER_ERROR',
            statusCode: 503,
            reason: result?.reason || 'provider_error',
            provider: result?.provider || 'openrouter',
            model: result?.model || MY_DAY_CLASSIFICATION_MODEL
        };
    }

    let normalized;
    try {
        normalized = normalizeAiClassification(parseAiJson(result.text), impacts);
    } catch (error) {
        return {
            ok: false,
            code: error.code || 'MY_DAY_AI_INVALID_JSON',
            statusCode: error.statusCode || 422,
            reason: error.code || 'invalid_json',
            provider: result.provider,
            model: result.model || MY_DAY_CLASSIFICATION_MODEL
        };
    }

    if (normalized.confidence < MIN_CLASSIFICATION_CONFIDENCE) {
        return {
            ok: false,
            code: 'MY_DAY_AI_LOW_CONFIDENCE',
            statusCode: 422,
            reason: 'low_confidence',
            confidence: normalized.confidence,
            aiReason: normalized.reason,
            provider: result.provider,
            model: result.model || MY_DAY_CLASSIFICATION_MODEL
        };
    }

    return {
        ok: true,
        classification: {
            impactIds: normalized.impactIds,
            tags: normalized.tags
        },
        confidence: normalized.confidence,
        reason: normalized.reason,
        provider: result.provider,
        model: result.model || MY_DAY_CLASSIFICATION_MODEL,
        usage: result.usage || {}
    };
}

module.exports = {
    DEFAULT_MY_DAY_CLASSIFICATION_MODEL,
    MIN_CLASSIFICATION_CONFIDENCE,
    activeImpactPayload,
    buildSystemPrompt,
    buildUserMessage,
    classifyMyDayTask,
    normalizeAiClassification,
    parseAiJson,
    taskFingerprint,
    taskSnapshot
};
