const { callUnifiedChatCompletion, publicAIConfig } = require('./ai-config');
const { normalizeSubtasksInput } = require('./taskSubtasks');

const DECOMPOSITION_MODES = ['none', 'manual', 'template', 'ai', 'template_ai'];

const TASK_DECOMPOSITION_TEMPLATES = Object.freeze({
    personal_home: {
        key: 'personal_home',
        label: 'Побут / особисте',
        description: 'Домашні та особисті справи з короткими фізичними кроками.',
        categories: ['personal'],
        items: [
            'Уточнити обсяг і потрібні матеріали',
            'Підготувати простір або інструменти',
            'Виконати основну частину роботи',
            'Перевірити результат і прибрати після себе'
        ]
    },
    event_preparation: {
        key: 'event_preparation',
        label: 'Підготовка події',
        description: 'Підготовка залу, програми, команди та контроль перед гостями.',
        categories: ['event', 'operational', 'checklist'],
        items: [
            'Підтвердити дату, час, локацію і формат події',
            'Перевірити готовність залу, реквізиту та матеріалів',
            'Узгодити ролі команди і відповідальних',
            'Підготувати фінальний чек перед стартом',
            'Зафіксувати результат або нюанси після події'
        ]
    },
    content_creation: {
        key: 'content_creation',
        label: 'Контент',
        description: 'Планування, створення, погодження і публікація матеріалу.',
        categories: ['content', 'marketing'],
        items: [
            'Сформулювати ціль і аудиторію матеріалу',
            'Зібрати факти, фото або референси',
            'Підготувати чернетку тексту чи візуалу',
            'Перевірити тон, помилки і відповідність бренду',
            'Опублікувати або передати на погодження'
        ]
    },
    crm_sales_followup: {
        key: 'crm_sales_followup',
        label: 'CRM / продаж',
        description: 'Follow-up з лідами, клієнтами, бронюваннями і наступними діями.',
        categories: ['sales', 'lead', 'customer', 'admin'],
        items: [
            'Перевірити картку клієнта або ліда',
            'Уточнити потребу, дату і бюджет',
            'Підготувати пропозицію або наступне повідомлення',
            'Зафіксувати відповідь у CRM',
            'Поставити наступний follow-up або закрити задачу'
        ]
    }
});

function compactText(value, max = 500) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeDecompositionMode(value, fallback = 'manual') {
    const raw = String(value || '').trim().toLowerCase();
    return DECOMPOSITION_MODES.includes(raw) ? raw : fallback;
}

function normalizeTemplateKey(value) {
    const raw = String(value || '').trim().toLowerCase();
    return TASK_DECOMPOSITION_TEMPLATES[raw] ? raw : null;
}

function getTaskDecompositionTemplates() {
    return Object.values(TASK_DECOMPOSITION_TEMPLATES).map(template => ({
        key: template.key,
        label: template.label,
        description: template.description,
        categories: template.categories.slice()
    }));
}

function scoreTemplate(template, context = {}) {
    const haystack = [
        context.title,
        context.description,
        context.category,
        context.subcategory,
        context.sourceType,
        context.sourceModule
    ].map(value => String(value || '').toLowerCase()).join(' ');
    let score = 0;
    for (const category of template.categories) {
        if (haystack.includes(String(category).toLowerCase())) score += 3;
    }
    if (/квартира|дім|дом|прибиран|clean|home|personal|особист|побут/i.test(haystack) && template.key === 'personal_home') score += 5;
    if (/поді|івент|event|брон|зал|аніматор|свят|гост/i.test(haystack) && template.key === 'event_preparation') score += 5;
    if (/контент|пост|сторіс|афіша|текст|фото|content|post/i.test(haystack) && template.key === 'content_creation') score += 5;
    if (/лід|lead|клієнт|продаж|sales|follow|дзвін|callback/i.test(haystack) && template.key === 'crm_sales_followup') score += 7;
    return score;
}

function pickTemplateKey(context = {}) {
    const explicit = normalizeTemplateKey(context.templateKey || context.template_key);
    if (explicit) return explicit;
    const ranked = Object.values(TASK_DECOMPOSITION_TEMPLATES)
        .map(template => ({ key: template.key, score: scoreTemplate(template, context) }))
        .sort((a, b) => b.score - a.score);
    return ranked[0]?.score > 0 ? ranked[0].key : 'event_preparation';
}

function templateItems(templateKey, context = {}) {
    const key = normalizeTemplateKey(templateKey) || pickTemplateKey(context);
    const template = TASK_DECOMPOSITION_TEMPLATES[key] || TASK_DECOMPOSITION_TEMPLATES.event_preparation;
    return template.items.map((title, index) => ({
        title,
        sort_order: index,
        source_type: 'template'
    }));
}

function canonicalTitleKey(title) {
    return compactText(title, 180)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeDraftItems(items, options = {}) {
    const sourceType = options.sourceType || 'ai';
    const maxItems = Math.max(2, Math.min(12, Number.parseInt(options.maxItems, 10) || 8));
    const normalized = normalizeSubtasksInput(items, { sourceType });
    const seen = new Set();
    const result = [];
    for (const item of normalized) {
        const title = compactText(item.title, 160);
        const key = canonicalTitleKey(title);
        if (!key || key.length < 3 || seen.has(key)) continue;
        seen.add(key);
        result.push({
            title,
            is_done: false,
            sort_order: result.length,
            source_type: item.source_type || sourceType
        });
        if (result.length >= maxItems) break;
    }
    return result;
}

function parseAiDraftText(text) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    const cleaned = raw.replace(/```json|```/gi, '').trim();
    const candidates = [];
    candidates.push(cleaned);
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) candidates.push(objectMatch[0]);
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) candidates.push(arrayMatch[0]);
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed)) return parsed;
            if (Array.isArray(parsed.subtasks)) return parsed.subtasks;
            if (Array.isArray(parsed.items)) return parsed.items;
            if (Array.isArray(parsed.steps)) return parsed.steps;
        } catch {
            // Try the next candidate.
        }
    }
    return cleaned
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*[-*•\d.)]+\s*/, '').trim())
        .filter(Boolean);
}

function buildSystemPrompt() {
    return `Ти допомагаєш Event Genix CRM розбити одну задачу на короткі підзадачі.
Поверни тільки JSON без markdown. Формат: {"subtasks":[{"title":"..."}]}.
Правила:
- 3-8 підзадач, без дублювання.
- Кожна підзадача має бути конкретною дією, яку можна виконати і відмітити.
- Не створюй окремі задачі, дедлайни, ролі чи вигадані дані.
- Відповідай українською, якщо вхід не іншою мовою.
- Не включай вступи, пояснення або нумерацію поза JSON.`;
}

function buildUserPrompt(context = {}, templateKey = null) {
    const template = TASK_DECOMPOSITION_TEMPLATES[templateKey] || null;
    const templateBlock = template
        ? `\nШаблон-орієнтир: ${template.label}\nБазові кроки:\n${template.items.map(item => `- ${item}`).join('\n')}`
        : '';
    return `Задача: ${compactText(context.title, 220)}
Опис: ${compactText(context.description, 600) || 'немає'}
Категорія: ${compactText(context.category, 80) || 'немає'}
Підкатегорія: ${compactText(context.subcategory, 80) || 'немає'}
Тип/режим: ${compactText(context.taskKind || context.task_kind || '', 80)} / ${compactText(context.taskMode || context.task_mode || '', 80)}
Контекст: ${compactText(context.sourceModule || context.source_module || context.sourceType || context.source_type || '', 120) || 'немає'}${templateBlock}`;
}

async function generateTaskDecompositionDraft(context = {}, options = {}) {
    const mode = normalizeDecompositionMode(context.mode || context.decompositionMode || context.decomposition_mode, 'ai');
    if (mode === 'none' || mode === 'manual') {
        return {
            success: true,
            mode,
            templateKey: null,
            source: mode,
            subtasks: [],
            draftItems: [],
            meta: {
                aiUsed: false,
                humanReviewRequired: false
            }
        };
    }

    const title = compactText(context.title, 220);
    if (title.length < 3) {
        return {
            success: false,
            status: 400,
            code: 'INSUFFICIENT_TASK_CONTEXT',
            error: 'Додайте назву задачі, щоб запропонувати підзадачі.'
        };
    }

    const templateKey = pickTemplateKey(context);
    const useTemplate = mode === 'template' || mode === 'template_ai';
    const baseTemplateItems = useTemplate ? normalizeDraftItems(templateItems(templateKey, context), { sourceType: 'template' }) : [];

    if (mode === 'template') {
        return {
            success: true,
            mode,
            templateKey,
            source: 'template',
            subtasks: baseTemplateItems,
            draftItems: baseTemplateItems,
            meta: {
                aiUsed: false,
                humanReviewRequired: true
            }
        };
    }

    const aiClient = options.aiClient || callUnifiedChatCompletion;
    const aiResult = await aiClient({
        scope: 'chat_ai',
        title: 'Event Genix Task Decomposition',
        systemPrompt: buildSystemPrompt(),
        userMessage: buildUserPrompt(context, useTemplate ? templateKey : null),
        maxTokens: 700
    });

    if (!aiResult?.ok) {
        if (baseTemplateItems.length) {
            return {
                success: true,
                mode,
                templateKey,
                source: 'template_fallback',
                subtasks: baseTemplateItems,
                draftItems: baseTemplateItems,
                meta: {
                    aiUsed: false,
                    aiReason: aiResult?.reason || 'ai_unavailable',
                    ai: publicAIConfig(aiResult || {}),
                    humanReviewRequired: true
                }
            };
        }
        return {
            success: false,
            status: aiResult?.reason === 'missing_key' || aiResult?.reason === 'disabled' ? 503 : 502,
            code: 'AI_DECOMPOSITION_UNAVAILABLE',
            error: aiResult?.reason === 'missing_key'
                ? 'AI ключ не налаштований. Підзадачі не збережено.'
                : 'AI не зміг запропонувати підзадачі. Спробуйте ще раз або додайте вручну.',
            meta: {
                aiReason: aiResult?.reason || 'provider_error',
                ai: publicAIConfig(aiResult || {})
            }
        };
    }

    let aiItems = normalizeDraftItems(parseAiDraftText(aiResult.text), { sourceType: 'ai' });
    if (aiItems.length < 2 && baseTemplateItems.length) {
        aiItems = baseTemplateItems;
    }
    if (!aiItems.length) {
        return {
            success: false,
            status: 422,
            code: 'AI_EMPTY_DECOMPOSITION',
            error: 'AI повернув порожню або непридатну чернетку. Підзадачі не збережено.',
            meta: {
                aiUsed: true,
                provider: aiResult.provider,
                model: aiResult.model
            }
        };
    }

    return {
        success: true,
        mode,
        templateKey: useTemplate ? templateKey : null,
        source: useTemplate ? 'template_ai' : 'ai',
        subtasks: aiItems,
        draftItems: aiItems,
        meta: {
            aiUsed: true,
            provider: aiResult.provider,
            model: aiResult.model,
            usage: aiResult.usage || {},
            humanReviewRequired: true
        }
    };
}

module.exports = {
    DECOMPOSITION_MODES,
    TASK_DECOMPOSITION_TEMPLATES,
    buildSystemPrompt,
    buildUserPrompt,
    generateTaskDecompositionDraft,
    getTaskDecompositionTemplates,
    normalizeDecompositionMode,
    normalizeDraftItems,
    parseAiDraftText,
    pickTemplateKey,
    templateItems
};
