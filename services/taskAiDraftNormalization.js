'use strict';

const { normalizeImpactIds } = require('./myDayTaxonomy');
const { compactString } = require('./myDayTaskOpenAIClient');

const MAX_TASK_AI_DRAFT_TITLE_CHARS = 180;
const MAX_TASK_AI_DRAFT_DESCRIPTION_CHARS = 700;
const MIN_HUMAN_DESCRIPTION_CHARS = 12;
const MAX_ACTIVE_IMPACTS_FOR_NORMALIZATION = 80;

const TECHNICAL_AI_TEXT_PATTERNS = Object.freeze([
    /```/,
    /\bTASK_AI_DRAFT_[A-Z0-9_]+\b/,
    /\bproposalToken\b/i,
    /\bdraftFingerprint\b/i,
    /\bacceptedFieldMask\b/i,
    /\bcontractVersion\b/i,
    /\bpromptVersion\b/i,
    /\bimpactIds\b/,
    /\bsubtasks\b/,
    /\bconfidence\b/,
    /\bJSON\s+object\b/i,
    /^\s*(?:\{|\[).*["'](?:decision|title|description|impactIds|subtasks)["']\s*:/s,
    /^(?:sure|here(?:'s| is))\b.*\b(?:json|draft|task)\b/i,
    /^as an ai\b/i
]);

function textWords(value = '') {
    return String(value || '').match(/[\p{L}\p{N}]{2,}/gu) || [];
}

function isTechnicalAiDraftText(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    return TECHNICAL_AI_TEXT_PATTERNS.some(pattern => pattern.test(text));
}

function isHumanTaskText(value, { minChars = 3, minWords = 1 } = {}) {
    const text = String(value || '').trim();
    if (text.length < minChars) return false;
    if (isTechnicalAiDraftText(text)) return false;
    return textWords(text).length >= minWords;
}

function sentenceFromText(value, maxChars = MAX_TASK_AI_DRAFT_TITLE_CHARS) {
    const text = compactString(value, maxChars);
    if (!text || isTechnicalAiDraftText(text)) return '';
    const firstSentence = text.split(/(?<=[.!?])\s+/u)[0] || text;
    return compactString(firstSentence, maxChars);
}

function normalizeTaskDraftTitle(value, fallbackDraft = {}) {
    const title = compactString(value, MAX_TASK_AI_DRAFT_TITLE_CHARS);
    if (isHumanTaskText(title, { minChars: 3, minWords: 1 })) return title;
    const fallbackTitle = compactString(fallbackDraft.title, MAX_TASK_AI_DRAFT_TITLE_CHARS);
    if (isHumanTaskText(fallbackTitle, { minChars: 3, minWords: 1 })) return fallbackTitle;
    const fromDescription = sentenceFromText(fallbackDraft.description, MAX_TASK_AI_DRAFT_TITLE_CHARS);
    if (isHumanTaskText(fromDescription, { minChars: 3, minWords: 2 })) return fromDescription;
    return '';
}

function normalizeTaskDraftDescription(value, fallbackDraft = {}, title = '') {
    const description = compactString(value, MAX_TASK_AI_DRAFT_DESCRIPTION_CHARS);
    if (isHumanTaskText(description, {
        minChars: MIN_HUMAN_DESCRIPTION_CHARS,
        minWords: 2
    })) {
        return description;
    }
    const fallbackDescription = compactString(fallbackDraft.description, MAX_TASK_AI_DRAFT_DESCRIPTION_CHARS);
    if (isHumanTaskText(fallbackDescription, {
        minChars: MIN_HUMAN_DESCRIPTION_CHARS,
        minWords: 2
    })) {
        return fallbackDescription;
    }
    const safeTitle = normalizeTaskDraftTitle(title || fallbackDraft.title, fallbackDraft);
    return safeTitle ? compactString(`Потрібно виконати: ${safeTitle}`, MAX_TASK_AI_DRAFT_DESCRIPTION_CHARS) : '';
}

function normalizeTaskDraftImpactIds(value = []) {
    return normalizeImpactIds(Array.isArray(value) ? value : []);
}

function activeImpactIdSet(activeImpacts = {}) {
    return new Set((Array.isArray(activeImpacts) ? activeImpacts : [])
        .filter(impact => impact && impact.isActive !== false)
        .map(impact => ({
            id: Number(impact.id),
            name: compactString(impact.name, 80)
        }))
        .filter(impact => Number.isInteger(impact.id) && impact.id > 0 && impact.name)
        .slice(0, MAX_ACTIVE_IMPACTS_FOR_NORMALIZATION)
        .map(impact => impact.id));
}

function filterKnownActiveImpactIds(impactIds = [], activeImpacts = []) {
    const allowed = activeImpactIdSet(activeImpacts);
    return normalizeTaskDraftImpactIds(impactIds).filter(id => allowed.has(id));
}

function normalizeTaskDraftImpactSelection(impactIds = [], activeImpacts = []) {
    const normalized = normalizeTaskDraftImpactIds(impactIds);
    const allowed = activeImpactIdSet(activeImpacts);
    const selectedImpactIds = normalized.filter(id => allowed.has(id));
    const rejectedImpactIds = normalized.filter(id => !allowed.has(id));
    return {
        impactIds: selectedImpactIds,
        rejectedImpactIds,
        filteredImpactCount: rejectedImpactIds.length,
        filterReason: rejectedImpactIds.length ? 'filter_known_active' : ''
    };
}

module.exports = {
    MAX_ACTIVE_IMPACTS_FOR_NORMALIZATION,
    MAX_TASK_AI_DRAFT_DESCRIPTION_CHARS,
    MAX_TASK_AI_DRAFT_TITLE_CHARS,
    MIN_HUMAN_DESCRIPTION_CHARS,
    activeImpactIdSet,
    filterKnownActiveImpactIds,
    isHumanTaskText,
    isTechnicalAiDraftText,
    normalizeTaskDraftDescription,
    normalizeTaskDraftImpactIds,
    normalizeTaskDraftImpactSelection,
    normalizeTaskDraftTitle
};
