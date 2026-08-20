'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');

function tick() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

test('My Day AI draft UI carries accepted description and impacts into commit payload', async () => {
    const dom = new JSDOM(`<!doctype html>
        <div data-task-ai-draft-panel data-source-surface="profile_my_day">
            <button type="button" data-task-ai-draft-preview>Заповнити з AI</button>
            <button type="button" data-task-ai-draft-submit-intent>Створити</button>
            <p data-task-ai-draft-status></p>
            <div data-task-ai-draft-review hidden></div>
        </div>`, {
        runScripts: 'outside-only',
        url: 'https://crm.test/profile?tab=myday'
    });
    const { window } = dom;
    const draft = {
        title: 'crm handoff',
        description: '',
        mode: 'simple',
        taskMode: 'work',
        impactIds: []
    };
    let requestSubmitCount = 0;
    let submittedPayload = null;

    window.MyDayImpactIcons = {
        MAX_SELECTED_IMPACTS: 5,
        render: impact => `<span>${impact.icon || ''}</span>`
    };
    window.MyDayClassification = {
        state: {
            impacts: [
                { id: 101, name: 'Work: CRM', icon: 'crm', color: '#2563eb', isActive: true }
            ]
        }
    };
    window.TaskCreate = {
        requestAiDraftPreview: async () => ({
            success: true,
            proposalToken: 'token.signature',
            proposalHash: 'proposal-hash',
            draftFingerprint: 'draft-fingerprint',
            catalogVersion: 'catalog-version',
            impactCatalog: window.MyDayClassification.state.impacts,
            proposal: {
                decision: 'single_task',
                action: 'apply',
                mode: 'simple',
                title: 'CRM lead handoff',
                description: 'Prepare a readable CRM lead handoff with owner risks and next actions.',
                impactIds: [101],
                subtasks: [],
                reason: 'Readable task draft.'
            },
            diff: {
                changedFields: ['title', 'description', 'impactIds'],
                fields: {
                    title: { before: 'crm handoff', after: 'CRM lead handoff', changed: true },
                    description: {
                        before: '',
                        after: 'Prepare a readable CRM lead handoff with owner risks and next actions.',
                        changed: true
                    },
                    impactIds: { before: [], after: [101], changed: true }
                }
            }
        })
    };

    window.eval(fs.readFileSync(path.join(root, 'js', 'task-ai-draft.js'), 'utf8'));
    const composer = window.document.querySelector('[data-task-ai-draft-panel]');
    window.TaskAiDraft.bindComposer(composer, {
        sourceSurface: 'profile_my_day',
        readDraft: () => ({ ...draft, impactIds: [...draft.impactIds] }),
        applyField: (field, value) => {
            draft[field] = Array.isArray(value) ? [...value] : value;
        },
        requestSubmit: () => {
            requestSubmitCount += 1;
            submittedPayload = window.TaskAiDraft.commitPayloadFor(composer);
        }
    });

    composer.querySelector('[data-task-ai-draft-preview]').click();
    await tick();
    await tick();
    const acceptAll = composer.querySelector('[data-task-ai-draft-accept-all]');
    assert.ok(acceptAll, 'AI review should render accept-all control');
    acceptAll.click();
    assert.equal(draft.description, 'Prepare a readable CRM lead handoff with owner risks and next actions.');
    assert.deepEqual(draft.impactIds, [101]);

    composer.querySelector('[data-task-ai-draft-submit-intent]').click();
    assert.equal(requestSubmitCount, 1);
    assert.equal(submittedPayload.finalDraft.description, 'Prepare a readable CRM lead handoff with owner risks and next actions.');
    assert.deepEqual(submittedPayload.finalDraft.impactIds, [101]);
    assert.ok(submittedPayload.acceptedFieldMask.includes('description'));
    assert.ok(submittedPayload.acceptedFieldMask.includes('impactIds'));
    assert.equal(Array.isArray(submittedPayload.editedFieldMask), true);
    assert.equal(submittedPayload.editedFieldMask.length, 0);
});
