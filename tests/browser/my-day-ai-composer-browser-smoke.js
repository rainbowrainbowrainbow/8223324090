#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HEADLESS = process.env.MY_DAY_AI_COMPOSER_BROWSER_SMOKE_HEADLESS !== 'false';
const MIME = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8'
};

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

function harnessHtml() {
    return `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/css/task-ai-draft.css">
  <style>
    body { margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; font-family: system-ui, sans-serif; }
    html[data-theme="dark"] body { background: #020617; color: #e2e8f0; }
    main { width: min(100%, 780px); margin: 0 auto; display: grid; gap: 14px; }
    label { display: grid; gap: 6px; font-weight: 700; }
    input, textarea { font: inherit; padding: 10px 12px; border-radius: 12px; border: 1px solid #94a3b8; }
    textarea { min-height: 76px; resize: vertical; }
    .impact-row, .subtask-row, .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .impact-chip { border: 1px solid #64748b; border-radius: 999px; padding: 7px 10px; background: #fff; }
    .impact-chip.is-selected { background: #eef2ff; border-color: #4f46e5; }
    .created-card { border: 2px solid #22c55e; border-radius: 16px; padding: 12px; }
    .ai-marker { display: inline-block; margin-inline-start: 8px; padding: 2px 8px; border-radius: 999px; background: #ede9fe; color: #5b21b6; }
    @media (max-width: 520px) { body { padding: 12px; } }
  </style>
</head>
<body>
  <main data-task-ai-draft-panel data-source-surface="browser_smoke">
    <label>Title <input id="title" data-task-ai-source-field="title" value="crm hermes ai task"></label>
    <label>Description <textarea id="description" data-task-ai-source-field="description">prepare safer workflow</textarea></label>
    <div class="impact-row" id="impacts" aria-label="Impacts"></div>
    <div id="subtasks" class="subtask-row" aria-label="Subtasks"></div>
    <button type="button" data-task-ai-draft-preview>AI preview</button>
    <div data-task-ai-draft-status aria-live="polite"></div>
    <div data-task-ai-draft-review hidden></div>
    <div class="actions">
      <button type="button" id="create">Create</button>
      <button type="button" id="clarify">Clarification mode</button>
      <button type="button" id="bundle">Bundle mode</button>
      <button type="button" id="providerUnavailable">Provider unavailable</button>
    </div>
    <section id="created"></section>
  </main>
  <script src="/js/task-ai-draft.js"></script>
  <script>
  (() => {
    const impacts = [
      { id: 101, name: 'CRM', icon: 'C', color: '#0ea5e9' },
      { id: 102, name: 'Hermes', icon: 'H', color: '#8b5cf6' },
      { id: 104, name: 'AI', icon: 'A', color: '#f59e0b' },
      { id: 105, name: 'Content', icon: 'M', color: '#ec4899' }
    ];
    const state = {
      mode: 'apply',
      calls: [],
      draft: { title: 'crm hermes ai task', description: 'prepare safer workflow', mode: 'simple', impactIds: [], subtasks: [] },
      created: JSON.parse(localStorage.getItem('ai-composer-created') || 'null'),
      bundleCreated: JSON.parse(localStorage.getItem('ai-composer-bundle-created') || 'null')
    };
    const title = document.getElementById('title');
    const description = document.getElementById('description');
    const impactsHost = document.getElementById('impacts');
    const subtasksHost = document.getElementById('subtasks');
    const created = document.getElementById('created');
    window.__AI_COMPOSER_SMOKE__ = state;
    function renderImpacts() {
      impactsHost.innerHTML = impacts.map(impact => '<button type="button" class="impact-chip ' + (state.draft.impactIds.includes(impact.id) ? 'is-selected' : '') + '" data-impact="' + impact.id + '" data-my-day-composer-impact-chip>' + impact.name + '</button>').join('');
    }
    function renderSubtasks() {
      subtasksHost.innerHTML = state.draft.subtasks.map((item, index) => '<input data-task-subtask-row data-index="' + index + '" data-subtask-source="' + (item.sourceType || 'manual') + '" value="' + item.title + '">').join('');
    }
    function renderCreated() {
      const singleHtml = state.created
        ? '<article class="created-card" data-ai-created="true"><strong>' + state.created.title + '</strong><span class="ai-marker">AI assisted</span><div>' + state.created.impactIds.join(',') + '</div><ol>' + state.created.subtasks.map(item => '<li>' + item.title + '</li>').join('') + '</ol></article>'
        : '';
      const bundleHtml = state.bundleCreated
        ? '<section data-ai-bundle-created="true">' + state.bundleCreated.tasks.map(task => '<article class="created-card" data-ai-bundle-task><strong>' + task.title + '</strong><span class="ai-marker">AI bundle</span><div>' + (task.impactIds || []).join(',') + '</div></article>').join('') + '</section>'
        : '';
      created.innerHTML = singleHtml + bundleHtml;
    }
    function syncDraftFromInputs() {
      state.draft.title = title.value;
      state.draft.description = description.value;
      state.draft.subtasks = [...subtasksHost.querySelectorAll('input')].map(input => ({ title: input.value, sourceType: input.dataset.subtaskSource || 'manual' }));
    }
    function readDraft() {
      syncDraftFromInputs();
      return JSON.parse(JSON.stringify(state.draft));
    }
    window.TaskCreate = {
      requestAiDraftStatus: async () => ({ success: true, feature: { enabled: true, reason: 'browser_smoke' } }),
      requestAiDraftPreview: async payload => {
        state.calls.push({ type: 'preview', payload });
        await new Promise(resolve => setTimeout(resolve, 40));
        if (state.mode === 'provider_unavailable') {
          return { success: false, code: 'TASK_AI_PROVIDER_UNAVAILABLE', error: 'AI provider unavailable' };
        }
        if (state.mode === 'clarification') {
          return {
            success: true,
            proposalToken: 'token-clarify',
            proposalHash: 'hash-clarify',
            draftFingerprint: 'fingerprint-clarify',
            catalogVersion: 'catalog',
            impactCatalog: impacts,
            proposal: { action: 'needs_clarification', mode: null, title: null, description: null, impactIds: [], subtasks: [], reason: 'Need clearer scope.' },
            diff: { changedFields: [], fields: {} }
          };
        }
        if (state.mode === 'bundle') {
          const tasks = [
            { title: 'Audit CRM booking funnel', description: 'Check CRM booking issues.', impactIds: [101], priority: 'high', dueDate: '2099-02-01', ownerSuggestion: { userId: null, name: null, reason: null }, confidence: { overall: 0.9, title: 0.9, description: 0.8, impacts: 0.9, subtasks: 0.8, mode: 0.8 } },
            { title: 'Prepare Hermes worker', description: 'Prepare Hermes worker changes.', impactIds: [102], priority: 'normal', dueDate: null, ownerSuggestion: { userId: null, name: null, reason: null }, confidence: { overall: 0.9, title: 0.9, description: 0.8, impacts: 0.9, subtasks: 0.8, mode: 0.8 } },
            { title: 'Verify AI automation', description: 'Verify automation behavior.', impactIds: [104], priority: 'normal', dueDate: null, ownerSuggestion: { userId: null, name: null, reason: null }, confidence: { overall: 0.9, title: 0.9, description: 0.8, impacts: 0.9, subtasks: 0.8, mode: 0.8 } },
            { title: 'Publish content update', description: 'Prepare content update.', impactIds: [105], priority: 'low', dueDate: null, ownerSuggestion: { userId: null, name: null, reason: null }, confidence: { overall: 0.9, title: 0.9, description: 0.8, impacts: 0.9, subtasks: 0.8, mode: 0.8 } }
          ];
          return {
            success: true,
            proposalToken: 'token-bundle',
            proposalHash: 'hash-bundle',
            draftFingerprint: 'fingerprint-bundle',
            catalogVersion: 'catalog',
            impactCatalog: impacts,
            proposal: {
              decision: 'task_bundle',
              mode: null,
              title: null,
              description: null,
              impactIds: [],
              subtasks: [],
              bundleTitle: 'CRM Hermes AI content bundle',
              tasks,
              confidence: { overall: 0.9, title: 0.9, description: 0.8, impacts: 0.9, subtasks: 0.8, mode: 0.8 },
              reason: 'Several independent tasks.'
            },
            diff: { changedFields: ['title', 'description'], fields: {} }
          };
        }
        return {
          success: true,
          proposalToken: 'token-apply',
          proposalHash: 'hash-apply',
          draftFingerprint: 'fingerprint-apply',
          catalogVersion: 'catalog',
          impactCatalog: impacts,
          proposal: {
            action: 'apply',
            mode: 'checklist',
            title: 'Prepare CRM and Hermes AI workflow',
            description: 'Use AI to prepare a safer CRM and Hermes checklist.',
            impactIds: [101, 102, 104],
            subtasks: [
              { title: 'Review CRM draft flow' },
              { title: 'Check Hermes notification flow' },
              { title: 'Verify AI proposal review' }
            ],
            reason: 'Clear mixed task.'
          },
          diff: {
            changedFields: ['title', 'description', 'mode', 'impactIds', 'subtasks'],
            fields: {
              title: { before: state.draft.title, after: 'Prepare CRM and Hermes AI workflow', changed: true },
              description: { before: state.draft.description, after: 'Use AI to prepare a safer CRM and Hermes checklist.', changed: true },
              mode: { before: state.draft.mode, after: 'checklist', changed: true },
              impactIds: { before: state.draft.impactIds, after: [101, 102, 104], changed: true },
              subtasks: { before: state.draft.subtasks, after: [
                { title: 'Review CRM draft flow' },
                { title: 'Check Hermes notification flow' },
                { title: 'Verify AI proposal review' }
              ], changed: true }
            }
          }
        };
      },
      commitAiDraft: async payload => {
        state.calls.push({ type: 'commit', payload });
        state.created = payload.finalDraft;
        localStorage.setItem('ai-composer-created', JSON.stringify(state.created));
        renderCreated();
        return { success: true, task: { id: 777, ...state.created, sourceType: 'ai_draft' } };
      },
      commitAiDraftBundle: async payload => {
        state.calls.push({ type: 'bundle_commit', payload });
        state.bundleCreated = {
          bundle: { id: 'bundle-browser-smoke', taskIds: payload.tasks.map((_, index) => 900 + index) },
          tasks: payload.tasks.map((task, index) => ({ id: 900 + index, ...task, sourceType: 'ai_draft_bundle' }))
        };
        localStorage.setItem('ai-composer-bundle-created', JSON.stringify(state.bundleCreated));
        renderCreated();
        return { success: true, bundle: state.bundleCreated.bundle, tasks: state.bundleCreated.tasks };
      }
    };
    window.TaskAiDraft.bindComposer(document.querySelector('[data-task-ai-draft-panel]'), {
      readDraft,
      applyField(field, value) {
        if (field === 'title') title.value = value || '';
        else if (field === 'description') description.value = value || '';
        else if (field === 'mode') state.draft.mode = value || 'simple';
        else if (field === 'impactIds') { state.draft.impactIds = value || []; renderImpacts(); }
        else if (field === 'subtasks') { state.draft.subtasks = (value || []).map(item => ({ title: item.title, sourceType: 'ai' })); renderSubtasks(); }
      },
      focusField(field) {
        if (field === 'title') title.focus();
        if (field === 'description') description.focus();
      },
      commitBundle: window.TaskCreate.commitAiDraftBundle
    });
    document.getElementById('create').addEventListener('click', async () => {
      const panel = document.querySelector('[data-task-ai-draft-panel]');
      const bundlePayload = window.TaskAiDraft.bundlePayloadFor(panel);
      if (bundlePayload) {
        await window.TaskCreate.commitAiDraftBundle(bundlePayload);
        return;
      }
      const payload = window.TaskAiDraft.commitPayloadFor(panel);
      if (!payload) return;
      await window.TaskCreate.commitAiDraft(payload);
    });
    document.getElementById('clarify').addEventListener('click', () => { state.mode = 'clarification'; });
    document.getElementById('bundle').addEventListener('click', () => { state.mode = 'bundle'; });
    document.getElementById('providerUnavailable').addEventListener('click', () => { state.mode = 'provider_unavailable'; });
    impactsHost.addEventListener('click', event => {
      const button = event.target.closest('[data-impact]');
      if (!button) return;
      const id = Number(button.dataset.impact);
      state.draft.impactIds = state.draft.impactIds.includes(id) ? state.draft.impactIds.filter(item => item !== id) : [...state.draft.impactIds, id];
      renderImpacts();
    });
    renderImpacts();
    renderSubtasks();
    renderCreated();
  })();
  </script>
</body>
</html>`;
}

function staticFilePath(requestUrl) {
    const url = new URL(requestUrl, 'http://fixture');
    if (url.pathname === '/ai-composer-harness.html') return 'HARNESS';
    const file = path.resolve(ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    return file.startsWith(`${ROOT}${path.sep}`) ? file : null;
}

function createStaticServer() {
    const server = http.createServer((req, res) => {
        const file = staticFilePath(req.url || '/');
        if (file === 'HARNESS') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            res.end(harnessHtml());
            return;
        }
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.writeHead(file ? 404 : 403);
            res.end();
            return;
        }
        res.writeHead(200, {
            'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'cache-control': 'no-store'
        });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve({
            server,
            baseUrl: `http://127.0.0.1:${server.address().port}`
        }));
    });
}

async function runScenario(browser, fixture, { dark, viewport }) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.setDefaultTimeout(20_000);
    try {
        await page.goto(`${fixture.baseUrl}/ai-composer-harness.html`, { waitUntil: 'domcontentloaded' });
        if (dark) await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
        await page.click('[data-task-ai-draft-preview]');
        await page.waitForSelector('.task-ai-draft-review');
        assert.equal(await page.locator('[data-task-ai-draft-field]').count(), 5);
        await page.click('[data-task-ai-draft-reject="description"]');
        await page.click('[data-task-ai-draft-accept="title"]');
        await page.click('[data-task-ai-draft-edit="subtasks"]');
        await page.locator('[data-task-subtask-row]').first().fill('User edited AI subtask');
        await page.click('[data-task-ai-draft-accept-all]');
        const payloadBeforeCreate = await page.evaluate(() => window.TaskAiDraft.commitPayloadFor(document.querySelector('[data-task-ai-draft-panel]')));
        assert.ok(payloadBeforeCreate);
        assert.equal(payloadBeforeCreate.acceptedFieldMask.includes('description'), false);
        assert.equal(payloadBeforeCreate.acceptedFieldMask.includes('subtasks'), true);
        assert.equal(payloadBeforeCreate.finalDraft.subtasks[0].sourceType, 'manual');
        await page.click('#create');
        await page.waitForSelector('[data-ai-created="true"]');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-ai-created="true"]');
        await page.click('#clarify');
        await page.click('[data-task-ai-draft-preview]');
        await page.waitForSelector('.task-ai-draft-review.is-clarification');
        await page.keyboard.press('Tab');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `AI composer has horizontal overflow: ${overflow}px`);
        assert.deepEqual(pageErrors, []);
    } finally {
        await context.close();
    }
}

async function runBundleScenario(browser, fixture, { dark, viewport }) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.setDefaultTimeout(20_000);
    try {
        await page.goto(`${fixture.baseUrl}/ai-composer-harness.html`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => localStorage.removeItem('ai-composer-bundle-created'));
        if (dark) await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
        await page.click('#bundle');
        await page.click('[data-task-ai-draft-preview]');
        await page.waitForSelector('.task-ai-bundle-review');
        assert.equal(await page.locator('[data-task-ai-bundle-card]').count(), 4);
        await page.locator('[data-task-ai-bundle-card]').first().locator('[data-task-ai-bundle-field="title"]').fill('Edited CRM booking funnel');
        assert.equal(await page.locator('[data-task-ai-draft-bundle-create]').isDisabled(), true);
        await page.locator('[data-task-ai-bundle-reject]').nth(3).click();
        assert.match(await page.locator('[data-task-ai-draft-bundle-create]').textContent(), /3/);
        await page.click('[data-task-ai-bundle-accept-all]');
        assert.equal(await page.locator('[data-task-ai-draft-bundle-create]').isDisabled(), true);
        await page.locator('[data-task-ai-bundle-accept]').first().click();
        assert.equal(await page.locator('[data-task-ai-draft-bundle-create]').isDisabled(), false);
        const payloadBeforeCreate = await page.evaluate(() => window.TaskAiDraft.bundlePayloadFor(document.querySelector('[data-task-ai-draft-panel]')));
        assert.equal(payloadBeforeCreate.tasks.length, 3);
        assert.deepEqual(payloadBeforeCreate.acceptedTaskMask, [0, 1, 2]);
        assert.deepEqual(payloadBeforeCreate.rejectedTaskMask, [3]);
        assert.equal(payloadBeforeCreate.tasks[0].title, 'Edited CRM booking funnel');
        assert.equal(payloadBeforeCreate.tasks.some(task => /Publish content update/.test(task.title)), false);
        await page.click('#create');
        await page.waitForSelector('[data-ai-bundle-created="true"]');
        assert.equal(await page.locator('[data-ai-bundle-task]').count(), 3);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-ai-bundle-created="true"]');
        assert.equal(await page.locator('[data-ai-bundle-task]').count(), 3);

        await page.click('#providerUnavailable');
        await page.click('[data-task-ai-draft-preview]');
        await page.waitForFunction(() => document.querySelector('[data-task-ai-draft-status]')?.textContent?.includes('AI provider unavailable'));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `AI bundle composer has horizontal overflow: ${overflow}px`);
        assert.deepEqual(pageErrors, []);
    } finally {
        await context.close();
    }
}

(async () => {
    const playwright = requirePlaywright();
    const fixture = await createStaticServer();
    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    try {
        await runScenario(browser, fixture, { dark: false, viewport: { width: 1440, height: 900 } });
        await runScenario(browser, fixture, { dark: true, viewport: { width: 1440, height: 900 } });
        await runScenario(browser, fixture, { dark: false, viewport: { width: 390, height: 844 } });
        await runScenario(browser, fixture, { dark: true, viewport: { width: 390, height: 844 } });
        await runBundleScenario(browser, fixture, { dark: false, viewport: { width: 1440, height: 900 } });
        await runBundleScenario(browser, fixture, { dark: true, viewport: { width: 390, height: 844 } });
        console.log('My Day AI composer browser smoke passed');
    } finally {
        await browser.close().catch(() => {});
        await new Promise(resolve => fixture.server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
