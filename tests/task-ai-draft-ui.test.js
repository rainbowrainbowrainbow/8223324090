const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

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
    assert.match(aiCode, /sourceType: 'ai_draft'/);
    assert.match(aiCode, /dataset\.subtaskSource = 'manual'/);
    assert.match(aiCode, /markUserEdited\(root, 'subtasks'\)/);

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
});
