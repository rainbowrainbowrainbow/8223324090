const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildHistorySuggestion,
    deriveTemplateSourceType,
    normalizeTemplateItems,
    normalizeTemplatePayload,
    rankSavedTemplates
} = require('../services/taskDecompositionLibrary');

test('normalizes saved decomposition template payload with stable ordered items', () => {
    const payload = normalizeTemplatePayload({
        name: '  Event prep  ',
        category: 'event',
        subtasks: [
            { title: 'Confirm date', sourceType: 'ai' },
            '',
            { title: 'Prepare room', source_type: 'template' },
            { title: '   ' }
        ]
    });

    assert.equal(payload.name, 'Event prep');
    assert.equal(payload.category, 'event');
    assert.equal(payload.source_type, 'template_ai');
    assert.deepEqual(payload.items.map(item => item.title), ['Confirm date', 'Prepare room']);
    assert.deepEqual(payload.items.map(item => item.sort_order), [0, 1]);
});

test('derives truthful template source type from saved draft item origins', () => {
    assert.equal(deriveTemplateSourceType([{ source_type: 'ai' }, { source_type: 'template' }]), 'template_ai');
    assert.equal(deriveTemplateSourceType([{ source_type: 'ai' }]), 'ai');
    assert.equal(deriveTemplateSourceType([{ source_type: 'template' }]), 'template');
    assert.equal(deriveTemplateSourceType([{ source_type: 'manual' }]), 'manual');
    assert.equal(deriveTemplateSourceType([{ source_type: 'system' }]), 'mixed');
});

test('ranks saved templates by title/category signal without pretending certainty', () => {
    const ranked = rankSavedTemplates([
        {
            id: 1,
            name: 'Apartment cleaning',
            category: 'personal',
            usageCount: 0,
            subtasks: normalizeTemplateItems(['Kitchen', 'Bathroom'])
        },
        {
            id: 2,
            name: 'CRM lead follow-up',
            category: 'admin',
            usageCount: 7,
            subtasks: normalizeTemplateItems(['Open lead card', 'Call client'])
        }
    ], {
        title: 'Clean apartment before guests',
        category: 'personal'
    });

    assert.equal(ranked[0].template.id, 1);
    assert.equal(ranked[0].type, 'saved_template');
    assert.ok(ranked[0].confidence < 100);
});

test('builds history suggestion from repeated real subtask structures', () => {
    const suggestion = buildHistorySuggestion([
        {
            title: 'Clean apartment',
            category: 'personal',
            status: 'done',
            items: [
                { title: 'Clean kitchen', source_type: 'manual' },
                { title: 'Clean bathroom', source_type: 'manual' },
                { title: 'Take out trash', source_type: 'manual' }
            ]
        },
        {
            title: 'Apartment reset',
            category: 'personal',
            status: 'done',
            items: [
                { title: 'Clean kitchen', source_type: 'manual' },
                { title: 'Vacuum floor', source_type: 'manual' }
            ]
        }
    ], {
        title: 'Clean apartment before party',
        category: 'personal'
    });

    assert.equal(suggestion.type, 'history');
    assert.ok(suggestion.confidence < 100);
    assert.ok(suggestion.subtasks.length >= 2);
    assert.equal(suggestion.subtasks[0].source_type, 'system');
    assert.ok(suggestion.subtasks.some(item => item.title === 'Clean kitchen'));
});
