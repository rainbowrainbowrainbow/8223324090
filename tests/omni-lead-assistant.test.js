const assert = require('node:assert/strict');
const test = require('node:test');

const {
    normalizeLeadAssistantConfig,
    buildLeadAssistantHistorySnapshot,
    extractFallbackLead,
    normalizeAnalysis,
    normalizeRecommendedMaterials,
    buildLeadInsertDraft,
    buildFollowUpTaskDraft
} = require('../services/omniLeadAssistant');

test('normalizes Omni lead assistant script fields', () => {
    const config = normalizeLeadAssistantConfig({
        enabled: true,
        model: ' gpt-4.1-mini ',
        tone: 'sales_direct',
        requiredFields: [
            { key: ' Event Date ', label: 'Дата', question: 'Коли?', required: true },
            { key: ' Event Date ', label: 'Дубль', question: 'Дубль?', required: false },
            { key: 'budget', label: 'Бюджет', question: 'Бюджет?', required: false }
        ],
        scriptRules: 'Питай по одному полю.'
    });

    assert.equal(config.model, 'gpt-4.1-mini');
    assert.equal(config.tone, 'sales_direct');
    assert.deepEqual(config.requiredFields.map(field => field.key), ['event_date', 'budget']);
    assert.equal(config.requiredFields[0].required, true);
    assert.equal(config.requiredFields[1].required, false);
    assert.ok(config.scenarios.some(scenario => scenario.id === 'birthday'));
    assert.ok(config.catalogSources.some(source => source.id === 'program_products'));
    assert.ok(config.manualMaterials.some(material => material.id === 'programs_page'));
});

test('keeps Omni lead assistant settings revision history metadata', () => {
    const config = normalizeLeadAssistantConfig({
        revision: 4,
        updatedAt: '2026-05-25T10:00:00.000Z',
        updatedBy: 'manager',
        history: [
            {
                revision: 3,
                updatedAt: '2026-05-24T10:00:00.000Z',
                updatedBy: 'admin',
                summary: 'old config',
                counts: { fields: 7, scenarios: 4 }
            }
        ]
    });

    const snapshot = buildLeadAssistantHistorySnapshot(config);

    assert.equal(config.revision, 4);
    assert.equal(config.updatedBy, 'manager');
    assert.equal(config.history[0].revision, 3);
    assert.equal(snapshot.revision, 4);
    assert.match(snapshot.summary, /fields/);
});

test('extracts a fallback lead draft from conversation text', () => {
    const draft = extractFallbackLead({
        conversation: {
            id: 41,
            channel: 'telegram',
            customer_name: 'Сергій Арт',
            customer_phone: '067 111 22 33',
            external_id: 'tg-1'
        },
        messages: [
            { direction: 'inbound', content: 'Хочу день народження 14.06.2026, 12 дітей, 8 років', created_at: '2026-05-25T10:00:00Z' },
            { direction: 'inbound', content: 'Бюджет 5000 грн, цікавить квест', created_at: '2026-05-25T10:01:00Z' }
        ]
    });

    assert.equal(draft.clientName, 'Сергій Арт');
    assert.equal(draft.phone, '+380671112233');
    assert.equal(draft.eventType, 'birthday');
    assert.equal(draft.eventDate, '2026-06-14');
    assert.equal(draft.childrenCount, 12);
    assert.equal(draft.childAge, 8);
    assert.equal(draft.budget, 5000);
    assert.equal(draft.programPreferences, 'квест');
});

test('normalizes analysis into a pinned needs checklist', () => {
    const config = normalizeLeadAssistantConfig({
        requiredFields: [
            { key: 'client_name', label: "Ім'я", question: 'Імʼя?', required: true },
            { key: 'event_date', label: 'Дата', question: 'Дата?', required: true },
            { key: 'budget', label: 'Бюджет', question: 'Бюджет?', required: false }
        ]
    });
    const analysis = normalizeAnalysis({
        summary: 'Є клієнт, дата ще невідома.',
        lead: {
            clientName: 'Олена',
            phone: null,
            instagram: null,
            eventType: 'birthday',
            eventDate: null,
            eventDateText: null,
            childrenCount: null,
            childAge: null,
            celebrants: [],
            budget: null,
            programPreferences: null,
            notes: null,
            leadType: 'quality',
            qualityCategory: 'birthday',
            confidence: 0.7
        },
        needs: [],
        suggestedReply: ''
    }, { conversation: {}, messages: [] }, config, { name: 'openai', model: 'gpt-4.1-mini', status: 'ok' });

    assert.equal(analysis.needs.find(item => item.key === 'client_name').status, 'found');
    assert.equal(analysis.needs.find(item => item.key === 'event_date').status, 'missing');
    assert.equal(analysis.needs.find(item => item.key === 'budget').status, 'optional');
    assert.deepEqual(analysis.missingRequiredKeys, ['event_date']);
    assert.match(analysis.suggestedReply, /Дата/);
});

test('builds a lead insert draft linked to the Omni conversation', () => {
    const analysis = normalizeAnalysis({
        lead: {
            clientName: 'Олена',
            phone: '+380501112233',
            instagram: null,
            eventType: 'birthday',
            eventDate: '2026-06-14',
            eventDateText: null,
            childrenCount: 10,
            childAge: 7,
            celebrants: [],
            budget: 4500,
            programPreferences: 'квест',
            notes: 'Любить динозаврів',
            leadType: 'quality',
            qualityCategory: 'birthday',
            confidence: 0.8
        },
        needs: [],
        summary: 'Готовий birthday lead',
        suggestedReply: 'Дякую!'
    }, { conversation: {}, messages: [] }, normalizeLeadAssistantConfig(), { name: 'openai', model: 'gpt-4.1-mini', status: 'ok' });

    const draft = buildLeadInsertDraft(analysis, {
        conversation: { id: 77, channel: 'instagram', customer_name: 'Олена', customer_phone: '', external_id: 'ig-77' },
        messages: []
    });

    assert.equal(draft.clientName, 'Олена');
    assert.equal(draft.sourceChannel, 'instagram');
    assert.equal(draft.externalId, 'omni_conv_77');
    assert.equal(draft.businessContext, 'event_genix');
    assert.match(draft.notes, /OmniClaw розмови #77/);
    assert.match(draft.customerCardNotes, /квест/);
});

test('builds an Omni follow-up task draft from lead analysis', () => {
    const analysis = normalizeAnalysis({
        lead: {
            clientName: 'Олена',
            phone: '+380501112233',
            instagram: null,
            eventType: 'birthday',
            eventDate: null,
            eventDateText: null,
            childrenCount: null,
            childAge: null,
            celebrants: [],
            budget: null,
            programPreferences: 'квест',
            notes: null,
            leadType: 'quality',
            qualityCategory: 'birthday',
            confidence: 0.8
        },
        summary: 'Клієнт думає над форматом',
        needs: [],
        suggestedReply: 'Добре, напишу завтра.'
    }, { conversation: {}, messages: [] }, normalizeLeadAssistantConfig(), { name: 'local', model: 'heuristic', status: 'fallback' });

    const draft = buildFollowUpTaskDraft({
        id: 41,
        channel: 'telegram',
        customer_name: 'Олена',
        meta: { lead_id: 99 }
    }, analysis, {
        user: { id: 7, username: 'manager' },
        date: '2026-05-26'
    });

    assert.equal(draft.source_type, 'omni_lead_followup');
    assert.equal(draft.source_id, 'omni:41');
    assert.equal(draft.source_entity_type, 'lead');
    assert.equal(draft.source_entity_id, '99');
    assert.equal(draft.owner_user_id, 7);
    assert.match(draft.description, /Omni conversation #41/);
});
