const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function tick() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

test('AI draft composer is visible, shared, reviewable, and not hidden in advanced options', () => {
    const profileHtml = read('profile.html');
    const tasksHtml = read('tasks.html');
    const profileCode = read('js/profile-page.js');
    const tasksCode = read('js/tasks-page.js');
    const aiCode = read('js/task-ai-draft.js');
    const taskCreateCode = read('js/task-create.js');
    const css = read('css/task-ai-draft.css');

    assert.match(profileHtml, /css\/task-ai-draft\.css\?v=/);
    assert.match(tasksHtml, /css\/task-ai-draft\.css\?v=/);
    assert.match(profileHtml, /js\/task-ai-draft\.js\?v=/);
    assert.match(tasksHtml, /js\/task-ai-draft\.js\?v=/);
    assert.match(profileCode, /data-task-ai-draft-preview/);
    assert.match(tasksHtml, /data-task-ai-draft-preview/);
    assert.match(profileCode, /Опиши результат або деталі/);
    assert.match(tasksHtml, /Опиши результат або деталі/);
    assert.ok(profileCode.indexOf('data-task-ai-draft-panel') < profileCode.indexOf('cabinet-task-composer-meta'));
    assert.ok(tasksHtml.indexOf('data-task-ai-draft-panel') < tasksHtml.indexOf('id="taskComposerDetails"'));

    assert.match(taskCreateCode, /requestAiDraftPreview/);
    assert.match(taskCreateCode, /\/tasks\/ai-draft\/preview/);
    assert.match(taskCreateCode, /commitAiDraft/);
    assert.match(taskCreateCode, /\/tasks\/ai-draft\/commit/);
    assert.match(taskCreateCode, /Idempotency-Key/);
    assert.match(taskCreateCode, /description:/);

    assert.match(aiCode, /setLoading\(root, true\)/);
    assert.match(aiCode, /button\.disabled = Boolean\(loading\)/);
    assert.match(aiCode, /aria-busy/);
    assert.match(aiCode, /currentKey !== key/);
    assert.match(aiCode, /Чернетка змінилася/);
    assert.match(aiCode, /data-task-ai-draft-accept=/);
    assert.match(aiCode, /data-task-ai-draft-reject=/);
    assert.match(aiCode, /data-task-ai-draft-edit=/);
    assert.match(aiCode, /data-task-ai-draft-accept-all/);
    assert.match(aiCode, /data-task-ai-draft-cancel/);
    assert.match(aiCode, /acceptedFieldMask/);
    assert.match(aiCode, /decision === 'task_bundle'/);
    assert.match(aiCode, /data-task-ai-bundle-card/);
    assert.match(aiCode, /data-task-ai-bundle-field="title"/);
    assert.match(aiCode, /data-task-ai-bundle-field="description"/);
    assert.match(aiCode, /data-task-ai-bundle-field="impactIds"/);
    assert.match(aiCode, /data-task-ai-bundle-field="ownerUserId"/);
    assert.match(aiCode, /data-task-ai-bundle-field="scheduleDate"/);
    assert.match(aiCode, /data-task-ai-bundle-field="priority"/);
    assert.match(aiCode, /data-task-ai-bundle-accept=/);
    assert.match(aiCode, /data-task-ai-bundle-reject=/);
    assert.match(aiCode, /data-task-ai-bundle-edit=/);
    assert.match(aiCode, /data-task-ai-bundle-accept-all/);
    assert.match(aiCode, /data-task-ai-draft-submit-intent/);
    assert.match(aiCode, /bundlePayloadFor/);
    assert.match(aiCode, /renderStructureSelector/);
    assert.match(aiCode, /activeTasks\.length < 2/);
    assert.match(aiCode, /taskIds\.forEach\(id => lastCommittedAiTaskIds\.add\(id\)\)/);
    assert.doesNotMatch(aiCode, /\bcommittedTaskIds\b/);
    assert.match(aiCode, /commitType: 'bundle'/);
    assert.doesNotMatch(aiCode, /state\.preview\?\.proposal\?\.decision === 'task_bundle'\) return null/);
    assert.match(aiCode, /sourceType: 'ai_draft'/);
    assert.match(aiCode, /dataset\.subtaskSource = 'manual'/);
    assert.match(aiCode, /markUserEdited\(root, 'subtasks'\)/);
    assert.doesNotMatch(tasksHtml, /id="taskSubtaskDraftBtn"/);
    assert.doesNotMatch(profileCode, /id="cabinetSubtaskDraftBtn"/);

    assert.match(profileCode, /window\.TaskAiDraft\.bindComposer/);
    assert.match(tasksCode, /window\.TaskAiDraft\.bindComposer/);
    assert.match(profileCode, /commitPayloadFor/);
    assert.match(tasksCode, /commitPayloadFor/);
    assert.match(profileCode, /commitAiDraft/);
    assert.match(tasksCode, /commitAiDraft/);
    assert.match(profileCode, /markCommittedTaskId/);
    assert.match(tasksCode, /markCommittedTaskId/);
    assert.match(profileCode, /data-ai-created="true"/);
    assert.match(tasksCode, /data-ai-created="true"/);

    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /html\[data-theme="dark"\]/);
    assert.match(css, /@media \(max-width: 720px\)/);
    assert.match(css, /task-ai-created-marker/);
    assert.match(css, /task-ai-bundle-review/);
    assert.match(css, /task-ai-bundle-card/);
    assert.match(css, /task-ai-bundle-fields/);
    assert.match(css, /task-ai-bundle-impact-grid/);
    assert.match(css, /task-ai-bundle-counter/);
    assert.match(css, /task-ai-draft-structure/);
});

test('AI draft composer renders interactive task bundle review without single-task commit fallback', async () => {
    const dom = new JSDOM(`<!doctype html><body>
        <div id="composer" data-source-surface="test">
            <button type="button" data-task-ai-draft-preview>AI</button>
            <div data-task-ai-draft-status></div>
            <div data-task-ai-draft-review hidden></div>
        </div>
    </body>`, {
        runScripts: 'outside-only',
        url: 'https://crm.test/tasks'
    });

    const { window } = dom;
    window.MyDayClassification = {
        state: {
            impacts: [
                { id: 101, name: 'CRM', icon: '🌿', color: '#6366f1' },
                { id: 102, name: 'Hermes', icon: '⚡', color: '#14b8a6' },
                { id: 103, name: 'AI', icon: '🤖', color: '#8b5cf6' }
            ]
        }
    };
    window.TaskCreate = {
        requestAiDraftStatus: async () => ({ success: true, feature: { enabled: true } }),
        requestAiDraftPreview: async () => ({
            success: true,
            proposalToken: 'payload.signature',
            draftFingerprint: 'draft-hash',
            proposalHash: 'proposal-hash',
            catalogVersion: 'catalog-hash',
            currentUserId: 7,
            ownerCatalog: [
                { id: 7, label: 'Tester', role: 'user' },
                { id: 9, label: 'CRM owner', role: 'user' }
            ],
            proposal: {
                decision: 'task_bundle',
                action: 'needs_project',
                bundleTitle: 'CRM + Hermes bundle',
                tasks: [
                    {
                        title: 'Fix CRM intake',
                        description: 'Make the form safe.',
                        impactIds: [101],
                        priority: 'high',
                        scheduleDate: '2026-08-20',
                        ownerSuggestion: { userId: null, name: 'CRM owner', reason: 'Review owner.' }
                    },
                    {
                        title: 'Connect Hermes worker',
                        description: 'Wire the event.',
                        impactIds: [102, 103],
                        priority: 'normal',
                        scheduleDate: null,
                        ownerSuggestion: { userId: null, name: '', reason: '' }
                    }
                ]
            },
            diff: { changedFields: ['tasks'], fields: {} },
            impactCatalog: window.MyDayClassification.state.impacts
        })
    };
    window.eval(read('js/task-ai-draft.js'));

    const root = window.document.getElementById('composer');
    window.TaskAiDraft.bindComposer(root, {
        readDraft: () => ({
            title: 'CRM + Hermes rollout',
            description: 'split it',
            impactIds: [],
            scheduleDate: '2026-08-18',
            scheduleConfirmed: true
        }),
        applyField: () => {
            throw new Error('bundle preview must not apply fields into the single-task composer');
        }
    });
    await tick();

    root.querySelector('[data-task-ai-draft-preview]').click();
    await tick();
    await tick();

    assert.equal(root.querySelectorAll('[data-task-ai-bundle-card]').length, 2);
    assert.match(root.textContent, /AI .*2/);
    assert.match(root.textContent, /dependencies/);
    assert.equal(root.querySelector('[data-task-ai-bundle-field="ownerUserId"]').value, '7');
    assert.ok(root.querySelector('[data-task-ai-draft-submit-intent]').disabled);
    assert.equal(window.TaskAiDraft.commitPayloadFor(root), null);
    assert.equal(root.querySelectorAll('[data-task-ai-structure]').length, 2);

    root.querySelector('[data-task-ai-bundle-accept-all]').click();
    assert.equal(root.querySelector('[data-task-ai-draft-submit-intent]').disabled, true);
    assert.match(root.textContent, /1\/2/);
    root.querySelector('[data-task-ai-bundle-accept]').click();
    assert.equal(root.querySelector('[data-task-ai-draft-submit-intent]').disabled, false);
    assert.equal(window.TaskAiDraft.bundlePayloadFor(root).tasks.length, 2);
    assert.equal(window.TaskAiDraft.commitPayloadFor(root).commitType, 'bundle');
    assert.equal(window.TaskAiDraft.commitPayloadFor(root).tasks[0].scheduleDate, '2026-08-18');
    assert.equal(window.TaskAiDraft.commitPayloadFor(root).tasks[1].scheduleDate, '2026-08-18');
    assert.deepEqual(window.TaskAiDraft.bundlePayloadFor(root).acceptedTaskMask, [0, 1]);
    assert.deepEqual(window.TaskAiDraft.bundlePayloadFor(root).rejectedTaskMask, []);

    const firstTitle = root.querySelector('[data-task-ai-bundle-card] [data-task-ai-bundle-field="title"]');
    firstTitle.value = 'Fix CRM intake after review';
    firstTitle.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(root.querySelector('[data-task-ai-draft-submit-intent]').disabled, true);
    assert.equal(window.TaskAiDraft.bundlePayloadFor(root), null);

    root.querySelector('[data-task-ai-bundle-accept]').click();
    const secondReject = root.querySelectorAll('[data-task-ai-bundle-reject]')[1];
    secondReject.click();
    assert.match(root.querySelector('[data-task-ai-draft-submit-intent]').textContent, /1/);
    assert.equal(root.querySelector('[data-task-ai-draft-submit-intent]').disabled, true);
    assert.equal(window.TaskAiDraft.bundlePayloadFor(root), null);
    assert.match(root.textContent, /single-task/);
});

test('AI draft fingerprint rejects stale schedule confirmation changes', () => {
    const dom = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        url: 'https://crm.test/tasks'
    });
    const { window } = dom;
    window.eval(read('js/task-ai-draft.js'));

    const todayDraft = {
        title: 'Prepare reports',
        scheduleDate: '2026-08-18',
        duePreset: 'today',
        scheduleConfirmed: true
    };
    const noDateDraft = {
        ...todayDraft,
        duePreset: 'no_date',
        scheduleConfirmed: false
    };

    assert.notEqual(window.TaskAiDraft._draftKey(todayDraft), window.TaskAiDraft._draftKey(noDateDraft));
});
