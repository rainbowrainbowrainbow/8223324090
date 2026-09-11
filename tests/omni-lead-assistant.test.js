const assert = require('node:assert/strict');
const test = require('node:test');
const { pool } = require('../db');

const {
    normalizeLeadAssistantConfig,
    buildLeadAssistantHistorySnapshot,
    extractFallbackLead,
    normalizeAnalysis,
    normalizeRecommendedMaterials,
    buildLeadInsertDraft,
    buildFollowUpTaskDraft,
    createLeadFromConversation
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
    assert.equal(draft.eventPreference.preferredDate, '2026-06-14');
    assert.equal(draft.eventPreference.childrenCount, 10);
    assert.match(draft.notes, /OmniClaw розмови #77/);
    assert.match(draft.notes, /квест/);
    assert.match(draft.notes, /Любить динозаврів/);
    assert.equal(Object.hasOwn(draft, 'customerCardNotes'), false);
});

function withFakeOmniPool(handler) {
    const originalQuery = pool.query;
    const originalConnect = pool.connect;
    return async () => {
        try {
            await handler({
                setQuery(fn) {
                    pool.query = fn;
                },
                setConnect(fn) {
                    pool.connect = fn;
                }
            });
        } finally {
            pool.query = originalQuery;
            pool.connect = originalConnect;
        }
    };
}

function createConversationFixture(overrides = {}) {
    return {
        id: 77,
        business_context: 'event_genix',
        channel: 'telegram',
        external_id: 'tg-77',
        customer_name: 'Олена',
        customer_phone: '+380501112233',
        assigned_to: 'vitalina',
        meta: {},
        ...overrides
    };
}

test('creates a reviewed Omni draft atomically with owner and event preference', withFakeOmniPool(async fake => {
    const conversation = createConversationFixture();
    const clientQueries = [];
    fake.setQuery(async (text, params = []) => {
        if (/SELECT \* FROM conversations WHERE id = \$1/i.test(text)) return { rows: [conversation] };
        if (/FROM conversation_messages/i.test(text)) return { rows: [] };
        throw new Error(`Unexpected pool query: ${text}`);
    });
    fake.setConnect(async () => ({
        async query(text, params = []) {
            clientQueries.push({ text, params });
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
            if (/FROM conversations/i.test(text) && /FOR UPDATE/i.test(text)) return { rows: [conversation] };
            if (/FROM leads/i.test(text) && /external_id = \$3/i.test(text)) return { rows: [] };
            if (/FROM users/i.test(text) && /\(username = \$1 OR name = \$1\)/i.test(text)) return { rows: [{ id: 12 }] };
            if (/INSERT INTO leads/i.test(text)) {
                return {
                    rows: [{
                        id: 501,
                        business_context: params[0],
                        client_name: params[1],
                        phone: params[2],
                        source_channel: params[5],
                        external_id: params[6],
                        event_date: params[8],
                        children_count: params[9],
                        notes: params[12],
                        assigned_to: params[13],
                        raw_payload: JSON.parse(params[17])
                    }]
                };
            }
            if (/INSERT INTO lead_event_preferences/i.test(text)) {
                return {
                    rows: [{
                        event_preference: {
                            id: 701,
                            lead_id: params[0],
                            business_context: params[1],
                            preferred_date: params[2],
                            children_count: params[3],
                            adults_count: params[4],
                            notes: params[5]
                        }
                    }]
                };
            }
            if (/UPDATE conversations/i.test(text)) return { rows: [], rowCount: 1 };
            throw new Error(`Unexpected client query: ${text}`);
        },
        release() {}
    }));

    const result = await createLeadFromConversation(77, null, {
        businessContext: 'event_genix',
        leadDraft: {
            clientName: 'Олена',
            eventDate: '2026-06-14',
            childrenCount: 10,
            adultsCount: 4,
            notes: 'Любить динозаврів'
        }
    });

    assert.equal(result.created, true);
    assert.equal(result.lead.assigned_to, 12);
    assert.equal(result.lead.eventPreference.preferredDate, '2026-06-14');
    assert.equal(result.lead.eventPreference.adultsCount, 4);
    assert.match(result.lead.notes, /Любить динозаврів/);
    assert.ok(clientQueries.some(query => query.text === 'COMMIT'));
    assert.ok(!clientQueries.some(query => query.text === 'ROLLBACK'));
}));

test('returns the existing Omni lead when insert loses the unique-source race', withFakeOmniPool(async fake => {
    const conversation = createConversationFixture();
    const existingLead = { id: 777, business_context: 'event_genix', source_channel: 'telegram', external_id: 'omni_conv_77' };
    let externalLookupCount = 0;
    fake.setQuery(async (text) => {
        if (/SELECT \* FROM conversations WHERE id = \$1/i.test(text)) return { rows: [conversation] };
        if (/FROM conversation_messages/i.test(text)) return { rows: [] };
        throw new Error(`Unexpected pool query: ${text}`);
    });
    fake.setConnect(async () => ({
        async query(text) {
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
            if (/FROM conversations/i.test(text) && /FOR UPDATE/i.test(text)) return { rows: [conversation] };
            if (/FROM leads/i.test(text) && /external_id = \$3/i.test(text)) {
                externalLookupCount += 1;
                return { rows: externalLookupCount > 1 ? [existingLead] : [] };
            }
            if (/FROM users/i.test(text)) return { rows: [] };
            if (/INSERT INTO leads/i.test(text)) return { rows: [] };
            if (/UPDATE conversations/i.test(text)) return { rows: [], rowCount: 1 };
            throw new Error(`Unexpected client query: ${text}`);
        },
        release() {}
    }));

    const result = await createLeadFromConversation(77, null, {
        businessContext: 'event_genix',
        leadDraft: { clientName: 'Олена' }
    });

    assert.equal(result.created, false);
    assert.equal(result.lead.id, 777);
}));

test('rolls back the Omni lead insert when conversation linking fails', withFakeOmniPool(async fake => {
    const conversation = createConversationFixture();
    const clientQueries = [];
    fake.setQuery(async (text) => {
        if (/SELECT \* FROM conversations WHERE id = \$1/i.test(text)) return { rows: [conversation] };
        if (/FROM conversation_messages/i.test(text)) return { rows: [] };
        throw new Error(`Unexpected pool query: ${text}`);
    });
    fake.setConnect(async () => ({
        async query(text, params = []) {
            clientQueries.push({ text, params });
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
            if (/FROM conversations/i.test(text) && /FOR UPDATE/i.test(text)) return { rows: [conversation] };
            if (/FROM leads/i.test(text) && /external_id = \$3/i.test(text)) return { rows: [] };
            if (/FROM users/i.test(text)) return { rows: [] };
            if (/INSERT INTO leads/i.test(text)) return { rows: [{ id: 501, business_context: 'event_genix' }] };
            if (/UPDATE conversations/i.test(text)) throw new Error('synthetic link failure');
            throw new Error(`Unexpected client query: ${text}`);
        },
        release() {}
    }));

    await assert.rejects(
        () => createLeadFromConversation(77, null, {
            businessContext: 'event_genix',
            leadDraft: { clientName: 'Олена' }
        }),
        /synthetic link failure/
    );
    assert.ok(clientQueries.some(query => query.text === 'ROLLBACK'));
    assert.ok(!clientQueries.some(query => query.text === 'COMMIT'));
}));

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
