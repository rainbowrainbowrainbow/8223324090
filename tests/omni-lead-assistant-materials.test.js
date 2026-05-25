const assert = require('node:assert/strict');
const test = require('node:test');

const {
    normalizeLeadAssistantConfig,
    normalizeAnalysis,
    normalizeRecommendedMaterials
} = require('../services/omniLeadAssistant');

test('normalizes Omni lead assistant catalog and script modules', () => {
    const config = normalizeLeadAssistantConfig({
        scenarios: [
            {
                id: 'Birthday Party',
                label: 'Birthday',
                keywords: 'birthday, party',
                requiredFieldKeys: 'client_name, event_date',
                catalogTags: 'program, cake',
                nextStepGoal: 'recommend_package',
                enabled: true
            }
        ],
        catalogSources: [
            { id: 'cakes', label: 'Cakes', source: 'products', domain: 'kitchen', kitchenType: 'cake', maxItems: 99, enabled: true }
        ],
        manualMaterials: [
            { id: 'birthday_pdf', title: 'Birthday PDF', url: 'https://example.test/birthday.pdf', tags: ['cake'], scenarioIds: ['birthday_party'] }
        ],
        guardrails: [
            { id: 'no_fake_price', label: 'No fake price', text: 'Use CRM prices only.', severity: 'blocker' }
        ],
        replyTemplates: [
            { key: 'offer', title: 'Offer', text: 'Take a look: {{materials}}' }
        ]
    });

    assert.equal(config.scenarios[0].id, 'birthday_party');
    assert.deepEqual(config.scenarios[0].catalogTags, ['program', 'cake']);
    assert.equal(config.catalogSources[0].maxItems, 40);
    assert.equal(config.manualMaterials[0].scenarioIds[0], 'birthday_party');
    assert.equal(config.guardrails[0].severity, 'blocker');
    assert.equal(config.replyTemplates[0].key, 'offer');
});

test('recommends catalog materials by scenario and tags', () => {
    const config = normalizeLeadAssistantConfig({
        manualMaterials: [
            {
                id: 'birthday_pdf',
                title: 'Birthday PDF',
                type: 'pdf',
                url: 'https://example.test/birthday.pdf',
                tags: ['program', 'cake'],
                scenarioIds: ['birthday'],
                enabled: true
            }
        ]
    });
    const materials = normalizeRecommendedMaterials([], config, {
        materials: [
            {
                id: 'product_quest',
                source: 'product',
                sourceId: 'quest_1',
                type: 'program',
                title: 'Quest',
                tags: ['program'],
                price: 3000,
                attachText: 'Quest\n3000 грн'
            }
        ]
    }, {
        eventType: 'birthday',
        programPreferences: 'quest and cake'
    }, {
        id: 'birthday',
        label: 'Birthday',
        catalogTags: ['program', 'cake']
    });

    assert.equal(materials[0].title, 'Birthday PDF');
    assert.ok(materials.some(item => item.sourceId === 'quest_1'));
});

test('adds scenario, score and recommended actions to analysis', () => {
    const analysis = normalizeAnalysis({
        lead: {
            clientName: 'Maryna',
            phone: '+380501112233',
            instagram: null,
            eventType: 'birthday',
            eventDate: '2026-06-14',
            eventDateText: null,
            childrenCount: 12,
            childAge: 8,
            celebrants: [],
            budget: 6000,
            programPreferences: 'quest',
            notes: null,
            leadType: 'quality',
            qualityCategory: 'birthday',
            confidence: 0.9
        },
        needs: [],
        summary: 'Hot birthday lead',
        suggestedReply: 'Thanks!'
    }, { conversation: {}, messages: [] }, normalizeLeadAssistantConfig(), { name: 'local', model: 'heuristic', status: 'fallback' });

    assert.equal(analysis.scenario.id, 'birthday');
    assert.ok(analysis.leadScore.score >= 70);
    assert.ok(analysis.recommendedActions.some(action => action.id === 'create_booking'));
});
