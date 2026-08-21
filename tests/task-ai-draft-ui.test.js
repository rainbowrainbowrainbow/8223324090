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

function createSingleTaskDraftDom(options = {}) {
    const dom = new JSDOM(`<!doctype html><body>
        <form id="composer" data-source-surface="profile_my_cabinet">
            <textarea id="cabinetTaskTitle" data-task-ai-source-field="title">${options.title || 'Manual task'}</textarea>
            <button type="submit" data-cabinet-create-action="plain">Створити</button>
            <button type="button" id="cabinetTaskAiFillBtn" data-cabinet-create-action="ai" data-task-ai-draft-preview>${options.buttonLabel || 'Заповнити з AI'}</button>
            <div data-task-ai-draft-status></div>
            <div data-task-ai-draft-review hidden></div>
        </form>
    </body>`, {
        runScripts: 'outside-only',
        url: 'https://crm.test/profile?tab=myday'
    });
    const { window } = dom;
    const draft = {
        title: options.title || 'Manual task',
        description: options.description || ''
    };
    let previewCalls = 0;
    let createCalls = 0;
    window.TaskCreate = {
        requestAiDraftStatus: async () => ({ success: true, feature: { enabled: true } }),
        requestAiDraftPreview: async () => {
            previewCalls += 1;
            if (options.providerError) throw new Error(options.providerError);
            return {
                success: true,
                proposalToken: 'payload.signature',
                draftFingerprint: 'draft-hash',
                proposalHash: 'proposal-hash',
                catalogVersion: 'catalog-hash',
                proposal: {
                    decision: 'single_task',
                    action: 'apply',
                    title: options.aiTitle || draft.title,
                    description: options.aiDescription || 'AI prepared details',
                    impactIds: [],
                    subtasks: []
                },
                diff: {
                    changedFields: ['description'],
                    fields: {
                        description: {
                            before: draft.description,
                            after: options.aiDescription || 'AI prepared details',
                            changed: true
                        }
                    }
                },
                impactCatalog: []
            };
        },
        createTask: async () => {
            createCalls += 1;
            return { success: true, task: { id: 1 } };
        }
    };
    window.eval(read('js/task-ai-draft.js'));

    const root = window.document.getElementById('composer');
    const input = window.document.getElementById('cabinetTaskTitle');
    window.TaskAiDraft.bindComposer(root, {
        readDraft: () => ({ ...draft }),
        applyField: (field, value) => {
            draft[field] = String(value || '');
            if (field === 'title') input.value = draft[field];
        },
        focusField: field => {
            if (field === 'title') input.focus();
        }
    });
    return {
        window,
        root,
        draft,
        get previewCalls() { return previewCalls; },
        get createCalls() { return createCalls; }
    };
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
    assert.match(profileCode, /id="cabinetTaskAiFillBtn"[^>]*data-task-ai-draft-preview/);
    assert.match(tasksHtml, /data-task-ai-draft-preview/);
    assert.doesNotMatch(profileCode, /Опиши результат або деталі/);
    assert.doesNotMatch(profileCode, /Підготувати з AI/);
    assert.match(profileCode, /id="cabinetTaskDetails"[^>]*hidden[^>]*aria-hidden="true"/);
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
    assert.match(aiCode, /data-task-ai-draft-edit-input=/);
    assert.match(aiCode, /data-task-ai-draft-edit-apply=/);
    assert.match(aiCode, /data-task-ai-draft-edit-cancel=/);
    assert.match(aiCode, /data-task-ai-draft-accept-all/);
    assert.match(aiCode, /data-task-ai-draft-cancel/);
    assert.match(aiCode, /acceptedFieldMask/);
    assert.match(aiCode, /decision === 'task_bundle'/);
    assert.match(aiCode, /data-task-ai-bundle-card/);
    assert.match(aiCode, /data-task-ai-bundle-field="title"/);
    assert.match(aiCode, /data-task-ai-bundle-field="description"/);
    assert.match(aiCode, /data-task-ai-bundle-field="impactIds"/);
    assert.match(aiCode, /data-task-ai-bundle-field="subtasks"/);
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
    assert.match(css, /task-ai-draft-inline-editor/);
});

test('AI draft details edit opens a visible textarea and stores edited text in commit payload', async () => {
    const ctx = createSingleTaskDraftDom({ description: '', aiDescription: 'AI details before edit' });
    await tick();

    const aiButton = ctx.root.querySelector('[data-task-ai-draft-preview]');
    aiButton.click();
    await tick();
    await tick();

    assert.equal(aiButton.textContent, 'Заповнити з AI');
    ctx.root.querySelector('[data-task-ai-draft-edit="description"]').click();
    const editor = ctx.root.querySelector('[data-task-ai-draft-edit-input="description"]');
    assert.ok(editor, 'details editor is rendered inline');
    assert.equal(ctx.window.document.activeElement, editor, 'focus moves into the visible details editor');
    assert.equal(editor.closest('[hidden]'), null, 'details editor is not inside a hidden element');

    editor.value = 'Edited details from keyboard';
    ctx.root.querySelector('[data-task-ai-draft-edit-apply="description"]').click();

    const payload = ctx.window.TaskAiDraft.commitPayloadFor(ctx.root);
    assert.equal(ctx.draft.description, 'Edited details from keyboard');
    assert.equal(payload.finalDraft.description, 'Edited details from keyboard');
    assert.equal(JSON.stringify(payload.acceptedFieldMask), JSON.stringify(['description']));
    assert.equal(JSON.stringify(payload.editedFieldMask), JSON.stringify(['description']));
});

test('AI draft details can be cleared explicitly', async () => {
    const ctx = createSingleTaskDraftDom({ description: 'Manual details', aiDescription: 'AI details before clear' });
    await tick();

    ctx.root.querySelector('[data-task-ai-draft-preview]').click();
    await tick();
    await tick();
    ctx.root.querySelector('[data-task-ai-draft-edit="description"]').click();
    const editor = ctx.root.querySelector('[data-task-ai-draft-edit-input="description"]');
    editor.value = '';
    ctx.root.querySelector('[data-task-ai-draft-edit-apply="description"]').click();

    const payload = ctx.window.TaskAiDraft.commitPayloadFor(ctx.root);
    assert.equal(ctx.draft.description, '');
    assert.equal(payload.finalDraft.description, '');
    assert.equal(JSON.stringify(payload.acceptedFieldMask), JSON.stringify(['description']));
    assert.equal(JSON.stringify(payload.editedFieldMask), JSON.stringify(['description']));
});

test('AI draft details edit cancel keeps the original draft untouched', async () => {
    const ctx = createSingleTaskDraftDom({ description: 'Manual details', aiDescription: 'AI details before cancel' });
    await tick();

    ctx.root.querySelector('[data-task-ai-draft-preview]').click();
    await tick();
    await tick();
    ctx.root.querySelector('[data-task-ai-draft-edit="description"]').click();
    const editor = ctx.root.querySelector('[data-task-ai-draft-edit-input="description"]');
    editor.value = 'Discard this edit';
    ctx.root.querySelector('[data-task-ai-draft-edit-cancel="description"]').click();

    assert.equal(ctx.draft.description, 'Manual details');
    assert.equal(ctx.root.querySelector('[data-task-ai-draft-edit-input="description"]'), null);
    assert.equal(ctx.window.TaskAiDraft.commitPayloadFor(ctx.root), null);
    assert.equal(ctx.root.querySelector('[data-task-ai-draft-preview]').textContent, 'Заповнити з AI');
});

test('AI draft provider errors keep text, restore action label, and never auto-create a task', async () => {
    const ctx = createSingleTaskDraftDom({
        title: 'Перевірити provider retry для Task Composer',
        providerError: 'AI provider timeout'
    });
    await tick();

    const input = ctx.window.document.getElementById('cabinetTaskTitle');
    const plainCreate = ctx.root.querySelector('[data-cabinet-create-action="plain"]');
    const aiButton = ctx.root.querySelector('[data-task-ai-draft-preview]');

    aiButton.click();
    assert.equal(aiButton.disabled, true, 'AI button is disabled while provider request is pending');
    await tick();
    await tick();

    assert.equal(ctx.previewCalls, 1);
    assert.equal(ctx.createCalls, 0, 'AI preview error must not create a task');
    assert.equal(input.value, 'Перевірити provider retry для Task Composer', 'AI error keeps typed composer text');
    assert.equal(plainCreate.disabled, false, 'plain create remains available after AI error');
    assert.equal(aiButton.disabled, false, 'AI retry is available after provider error');
    assert.equal(aiButton.textContent, 'Заповнити з AI', 'AI button restores the Profile composer label after error');
    assert.match(ctx.root.querySelector('[data-task-ai-draft-status]').textContent, /AI provider timeout/);
    assert.equal(ctx.window.TaskAiDraft.commitPayloadFor(ctx.root), null, 'failed preview leaves no commit payload');

    aiButton.click();
    await tick();
    await tick();
    assert.equal(ctx.previewCalls, 2, 'retry calls preview again');
    assert.equal(ctx.createCalls, 0, 'retry still does not auto-create a task');
    assert.equal(input.value, 'Перевірити provider retry для Task Composer', 'retry error still keeps typed text');
    assert.equal(aiButton.textContent, 'Заповнити з AI', 'AI button label is stable after retry error');
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
                        subtasks: [{ title: 'Check validation path' }],
                        priority: 'high',
                        scheduleDate: '2026-08-20',
                        ownerSuggestion: { userId: null, name: 'CRM owner', reason: 'Review owner.' }
                    },
                    {
                        title: 'Connect Hermes worker',
                        description: 'Wire the event.',
                        impactIds: [102, 103],
                        subtasks: [],
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
    assert.ok(root.querySelector('.task-ai-bundle-field-states'));
    assert.equal(root.querySelector('[data-task-ai-bundle-field="subtasks"]').value, 'Check validation path');
    assert.equal(root.querySelector('[data-task-ai-bundle-field="ownerUserId"]').value, '');
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
    assert.deepEqual(Array.from(window.TaskAiDraft.bundlePayloadFor(root).acceptedFieldMasks[0].fields), ['title', 'description', 'impactIds', 'subtasks', 'owner', 'dueDate', 'priority']);
    assert.deepEqual(Array.from(window.TaskAiDraft.bundlePayloadFor(root).editedFieldMasks[0].fields), ['dueDate']);

    const firstTitle = root.querySelector('[data-task-ai-bundle-card] [data-task-ai-bundle-field="title"]');
    firstTitle.value = 'Fix CRM intake after review';
    firstTitle.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(root.querySelector('[data-task-ai-draft-submit-intent]').disabled, true);
    assert.equal(window.TaskAiDraft.bundlePayloadFor(root), null);

    root.querySelector('[data-task-ai-bundle-accept]').click();
    assert.deepEqual(Array.from(window.TaskAiDraft.bundlePayloadFor(root).editedFieldMasks[0].fields), ['dueDate', 'title']);
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

test('AI draft accept-all does not overwrite existing manual subtasks without explicit subtask acceptance', async () => {
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
    const applied = [];
    window.TaskCreate = {
        requestAiDraftStatus: async () => ({ success: true, feature: { enabled: true } }),
        requestAiDraftPreview: async () => ({
            success: true,
            proposalToken: 'payload.signature',
            draftFingerprint: 'draft-hash',
            proposalHash: 'proposal-hash',
            catalogVersion: 'catalog-hash',
            proposal: {
                decision: 'checklist',
                action: 'apply',
                mode: 'checklist',
                title: 'AI checklist title',
                description: 'AI checklist description',
                impactIds: [],
                subtasks: [
                    { title: 'AI step one' },
                    { title: 'AI step two' }
                ]
            },
            diff: {
                changedFields: ['title', 'mode', 'subtasks'],
                fields: {
                    title: { before: 'Manual title', after: 'AI checklist title', changed: true },
                    mode: { before: 'checklist', after: 'checklist', changed: false },
                    subtasks: {
                        before: [{ title: 'Manual step one' }, { title: 'Manual step two' }],
                        after: [{ title: 'AI step one' }, { title: 'AI step two' }],
                        changed: true
                    }
                }
            },
            impactCatalog: []
        })
    };
    window.eval(read('js/task-ai-draft.js'));

    const root = window.document.getElementById('composer');
    window.TaskAiDraft.bindComposer(root, {
        readDraft: () => ({
            title: 'Manual title',
            mode: 'checklist',
            taskMode: 'personal',
            subtasks: [{ title: 'Manual step one' }, { title: 'Manual step two' }]
        }),
        applyField: (field, value) => applied.push({ field, value })
    });
    await tick();

    root.querySelector('[data-task-ai-draft-preview]').click();
    await tick();
    await tick();
    root.querySelector('[data-task-ai-draft-accept-all]').click();

    assert.deepEqual(applied.map(item => item.field), ['title', 'mode']);
    assert.equal(applied.some(item => item.field === 'subtasks'), false);
    assert.equal(window.TaskAiDraft.commitPayloadFor(root).acceptedFieldMask.includes('subtasks'), false);

    root.querySelector('[data-task-ai-draft-accept="subtasks"]').click();
    assert.equal(applied.at(-1).field, 'subtasks');
    assert.equal(window.TaskAiDraft.commitPayloadFor(root).acceptedFieldMask.includes('subtasks'), true);
});
