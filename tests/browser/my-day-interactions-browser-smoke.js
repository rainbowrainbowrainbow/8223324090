#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HEADLESS = process.env.MY_DAY_INTERACTIONS_BROWSER_SMOKE_HEADLESS !== 'false';
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
  <link rel="stylesheet" href="/css/pages-profile.css">
  <link rel="stylesheet" href="/css/pages-cabinet.css">
  <link rel="stylesheet" href="/css/pages-tasks.css">
  <style>
    body { margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; font-family: system-ui, sans-serif; }
    body.dark-mode { background: #020617; color: #e2e8f0; }
    .harness-grid { display: grid; gap: 16px; max-width: 980px; }
    .harness-card { border: 1px solid rgba(148, 163, 184, .35); border-radius: 18px; padding: 16px; background: rgba(255,255,255,.9); }
    .harness-card.cabinet-task-card, .harness-card.cabinet-overdue-triage-row { display: grid; grid-template-columns: 1fr; gap: 10px; margin-inline: 0; }
    body.dark-mode .harness-card { background: rgba(15,23,42,.94); }
    .harness-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .task-ui-action-panel { z-index: 1; }
  </style>
</head>
<body>
  <main class="harness-grid">
    <section class="harness-card cabinet-task-card" data-task-id="101" id="normal-card">
      <h1>Normal My Day task</h1>
      <div data-my-day-classification-badges="101"></div>
      <div data-my-day-time-fixture="101"></div>
      <div class="harness-actions">
        <button id="manual-normal" type="button">Manual impacts</button>
        <button id="ai-normal" type="button" class="cabinet-task-action-ai" data-task-id="101">AI</button>
        <button id="deps-normal" type="button" data-task-id="101">Dependencies</button>
      </div>
    </section>
    <section class="harness-card cabinet-overdue-triage-row" data-task-id="202" id="overdue-card">
      <h2>Overdue My Day task</h2>
      <div data-my-day-classification-badges="202"></div>
      <button id="ai-overdue" type="button" class="cabinet-task-action-ai" data-task-id="202">AI</button>
    </section>
  </main>
  <script src="/js/task-ui.js"></script>
  <script src="/js/my-day-classification.js"></script>
  <script src="/js/my-day-dependencies.js"></script>
  <script src="/js/my-day-time-tracking.js"></script>
  <script>
  (() => {
    const impacts = [
      { id: 1, name: 'Робота: CRM', color: '#0EA5E9', icon: 'C', isActive: true },
      { id: 2, name: 'Робота: Hermes', color: '#8B5CF6', icon: 'H', isActive: true },
      { id: 3, name: 'Команда', color: '#10B981', icon: 'T', isActive: true }
    ];
    const state = {
      aiMode: 'success',
      calls: [],
      notifications: [],
      dependencies: {
        101: [{ id: 301, title: 'Existing prerequisite', status: 'todo', isOpen: true }],
        202: []
      },
      candidates: [
        { id: 302, title: 'Prepare CRM checklist', status: 'todo' },
        { id: 303, title: 'Hermes worker deploy', status: 'todo' }
      ],
      tasks: {
        101: { id: 101, title: 'Fix CRM booking form', description: 'validation', effortMinutes: 30, actualSeconds: 0, myDay: { impacts: [] } },
        202: { id: 202, title: 'Overdue Hermes worker', description: 'worker', effortMinutes: 30, actualSeconds: 0, myDay: { impacts: [] } }
      },
      classificationDelay: 0,
      classificationError: false,
      timeMenuOpened: 0,
      timeMenuError: '',
      removeInFlight: new Set(),
      previous: {}
    };
    const clone = value => JSON.parse(JSON.stringify(value));
    const classificationFromIds = ids => ({ impacts: ids.map(id => impacts.find(impact => impact.id === Number(id))).filter(Boolean) });
    const applyClassification = (taskId, classification) => {
      state.tasks[taskId].myDay = clone(classification);
      document.querySelectorAll('[data-my-day-classification-badges="' + taskId + '"]').forEach(node => {
        node.innerHTML = window.MyDayClassification.renderTaskBadges(classification, { taskId });
      });
    };
    const json = (payload, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' }
    }));
    document.querySelector('[data-my-day-time-fixture="101"]').innerHTML = window.MyDayTimeTracking.renderTaskControls(state.tasks[101]);
    window.getAuthHeaders = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer local-browser-fixture' });
    window.showNotification = (message, type) => state.notifications.push({ message, type });
    window.__MY_DAY_INTERACTIONS__ = { state, applyClassification };
    document.addEventListener('click', async event => {
      const actionButton = event.target.closest('[data-cabinet-task-action]');
      if (!actionButton) return;
      const action = actionButton.dataset.cabinetTaskAction;
      if (action === 'reveal-impact') {
        event.preventDefault();
        const group = actionButton.closest('[data-my-day-task-impact-chips]');
        group.querySelectorAll('.my-day-task-chip--removable[hidden]').forEach(chip => { chip.hidden = false; });
        actionButton.hidden = true;
        return;
      }
      if (action === 'time-menu') {
        event.preventDefault();
        const taskId = Number(actionButton.dataset.taskId);
        try {
          await window.MyDayTimeTracking.handleAction(action, taskId, async () => {}, actionButton, state.tasks[taskId]);
          state.timeMenuOpened += 1;
        } catch (error) {
          state.timeMenuError = error.message || String(error);
        }
        return;
      }
      if (action !== 'remove-impact') return;
      event.preventDefault();
      const taskId = Number(actionButton.dataset.taskId);
      const impactId = Number(actionButton.dataset.myDayImpactId);
      const key = taskId + ':' + impactId;
      if (state.removeInFlight.has(key)) return;
      const current = state.tasks[taskId].myDay.impacts || [];
      const impactIds = current.map(impact => Number(impact.id)).filter(id => id !== impactId);
      state.removeInFlight.add(key);
      actionButton.disabled = true;
      actionButton.classList.add('is-pending');
      try {
        const result = await window.MyDayClassification.saveTaskClassification(taskId, { impactIds });
        applyClassification(taskId, result.classification);
      } catch (error) {
        actionButton.disabled = false;
        actionButton.classList.remove('is-pending');
        window.showNotification(error.message, 'error');
      } finally {
        state.removeInFlight.delete(key);
      }
    });
    window.fetch = async (input, options = {}) => {
      const url = new URL(String(input), location.origin);
      const method = String(options.method || 'GET').toUpperCase();
      state.calls.push(method + ' ' + url.pathname + url.search);
      const body = options.body ? JSON.parse(options.body) : {};
      if (method === 'GET' && url.pathname === '/api/my-day/impacts') {
        return json({ success: true, impacts });
      }
      const classificationMatch = url.pathname.match(/^\\/api\\/my-day\\/tasks\\/(\\d+)\\/classification$/);
      if (classificationMatch && method === 'PUT') {
        if (state.classificationDelay) await new Promise(resolve => setTimeout(resolve, state.classificationDelay));
        if (state.classificationError) return json({ success: false, code: 'MY_DAY_FIXTURE_ERROR', error: 'classification failed' }, 500);
        const taskId = Number(classificationMatch[1]);
        const classification = classificationFromIds(body.impactIds || []);
        applyClassification(taskId, classification);
        return json({ success: true, taskId, classification });
      }
      const autoMatch = url.pathname.match(/^\\/api\\/my-day\\/tasks\\/(\\d+)\\/classification\\/auto$/);
      if (autoMatch && method === 'POST') {
        const taskId = Number(autoMatch[1]);
        if (state.aiMode === 'provider') return json({ success: false, code: 'MY_DAY_AI_PROVIDER_UNAVAILABLE', error: 'provider unavailable' }, 503);
        if (state.aiMode === 'conflict') return json({ success: false, code: 'MY_DAY_CLASSIFICATION_CHANGED_DURING_AI_CLASSIFICATION', error: 'classification conflict' }, 409);
        if (state.aiMode === 'no_match') return json({ success: false, code: 'MY_DAY_AI_NO_MATCH', error: 'no match' }, 422);
        state.previous[taskId] = clone(state.tasks[taskId].myDay);
        const classification = classificationFromIds(taskId === 202 ? [2, 3] : [1, 2]);
        applyClassification(taskId, classification);
        return json({ success: true, taskId, classification, undoToken: 'undo-' + taskId, ai: { confidence: 0.91, reason: 'fixture match', provider: 'openai', model: 'gpt-5.6-luna' } });
      }
      const undoMatch = url.pathname.match(/^\\/api\\/my-day\\/tasks\\/(\\d+)\\/classification\\/undo$/);
      if (undoMatch && method === 'POST') {
        const taskId = Number(undoMatch[1]);
        const classification = clone(state.previous[taskId] || { impacts: [] });
        applyClassification(taskId, classification);
        return json({ success: true, taskId, classification });
      }
      const dependencyRoot = url.pathname.match(/^\\/api\\/tasks\\/(\\d+)\\/dependencies$/);
      if (dependencyRoot && method === 'GET') {
        return json({ success: true, dependencies: clone(state.dependencies[Number(dependencyRoot[1])] || []) });
      }
      if (url.pathname === '/api/tasks' && method === 'GET') {
        return json({ success: true, tasks: clone(state.candidates) });
      }
      if (dependencyRoot && method === 'POST') {
        await new Promise(resolve => setTimeout(resolve, 80));
        const taskId = Number(dependencyRoot[1]);
        const candidate = state.candidates.find(item => Number(item.id) === Number(body.dependsOnTaskId));
        if (candidate && !state.dependencies[taskId].some(item => item.id === candidate.id)) state.dependencies[taskId].push({ ...candidate, isOpen: true });
        return json({ success: true });
      }
      const quickCreate = url.pathname.match(/^\\/api\\/tasks\\/(\\d+)\\/dependencies\\/quick-create$/);
      if (quickCreate && method === 'POST') {
        await new Promise(resolve => setTimeout(resolve, 80));
        const taskId = Number(quickCreate[1]);
        const id = 400 + state.dependencies[taskId].length;
        state.dependencies[taskId].push({ id, title: body.title, status: 'todo', isOpen: true });
        return json({ success: true, task: { id, title: body.title } });
      }
      const remove = url.pathname.match(/^\\/api\\/tasks\\/(\\d+)\\/dependencies\\/(\\d+)$/);
      if (remove && method === 'DELETE') {
        const taskId = Number(remove[1]);
        const dependencyId = Number(remove[2]);
        state.dependencies[taskId] = state.dependencies[taskId].filter(item => Number(item.id) !== dependencyId);
        return json({ success: true });
      }
      return json({ success: false, error: 'Unexpected fixture request: ' + method + ' ' + url.pathname }, 500);
    };
    document.getElementById('manual-normal').addEventListener('click', () => {
      window.MyDayClassification.openTaskEditor(document.getElementById('manual-normal'), state.tasks[101], async () => {});
    });
    document.getElementById('ai-normal').addEventListener('click', () => {
      window.MyDayClassification.autoClassifyTask(document.getElementById('ai-normal'), state.tasks[101], {
        onApplied: async result => applyClassification(result.taskId, result.classification)
      });
    });
    document.getElementById('ai-overdue').addEventListener('click', () => {
      window.MyDayClassification.autoClassifyTask(document.getElementById('ai-overdue'), state.tasks[202], {
        onApplied: async result => applyClassification(result.taskId, result.classification)
      });
    });
    document.getElementById('deps-normal').addEventListener('click', () => {
      window.MyDayDependencies.openManager(document.getElementById('deps-normal'), state.tasks[101], async () => {});
    });
  })();
  </script>
</body>
</html>`;
}

function staticFilePath(requestUrl) {
    const url = new URL(requestUrl, 'http://fixture');
    if (url.pathname === '/my-day-interactions-harness.html') return 'HARNESS';
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

async function assertNoOverflow(page) {
    const { overflow, offenders } = await page.evaluate(() => {
        const viewport = document.documentElement.clientWidth;
        const offenders = Array.from(document.querySelectorAll('body *'))
            .map(node => {
                const rect = node.getBoundingClientRect();
                return {
                    tag: node.tagName,
                    id: node.id || '',
                    className: String(node.className || ''),
                    text: String(node.textContent || '').trim().slice(0, 80),
                    left: Math.round(rect.left),
                    right: Math.round(rect.right),
                    width: Math.round(rect.width)
                };
            })
            .filter(item => item.right > viewport + 1 || item.left < -1)
            .sort((a, b) => Math.max(Math.abs(b.right - viewport), Math.abs(b.left)) - Math.max(Math.abs(a.right - viewport), Math.abs(a.left)))
            .slice(0, 5);
        return { overflow: document.documentElement.scrollWidth - viewport, offenders };
    });
    assert.ok(overflow <= 1, `page has horizontal overflow: ${overflow}px offenders=${JSON.stringify(offenders)}`);
}

async function runScenario(browser, fixture, { dark, viewport }) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.setDefaultTimeout(20_000);
    try {
        await page.goto(`${fixture.baseUrl}/my-day-interactions-harness.html`, { waitUntil: 'domcontentloaded' });
        if (dark) await page.evaluate(() => document.body.classList.add('dark-mode'));
        await page.waitForSelector('#manual-normal');

        await page.locator('#manual-normal').click();
        await page.locator('[data-my-day-impacts]').selectOption(['1', '2', '3']);
        await page.locator('[data-my-day-editor-save]').click();
        await page.waitForFunction(() => document.querySelector('[data-my-day-classification-badges="101"]')?.textContent?.includes('CRM'));
        await page.locator('[data-cabinet-task-action="reveal-impact"][data-task-id="101"]').click();
        await page.waitForSelector('[data-cabinet-task-action="remove-impact"][data-task-id="101"][data-my-day-impact-id="3"]:not([hidden])');
        const putCountBeforeRemove = await page.evaluate(() => window.__MY_DAY_INTERACTIONS__.state.calls.filter(call => call === 'PUT /api/my-day/tasks/101/classification').length);
        await page.locator('[data-cabinet-task-action="remove-impact"][data-task-id="101"][data-my-day-impact-id="1"]').click();
        await page.waitForFunction(() => !document.querySelector('[data-my-day-classification-badges="101"]')?.textContent?.includes('CRM'));
        assert.equal(await page.evaluate(() => window.__MY_DAY_INTERACTIONS__.state.calls.filter(call => call === 'PUT /api/my-day/tasks/101/classification').length), putCountBeforeRemove + 1);
        assert.match(await page.locator('[data-my-day-classification-badges="101"]').textContent(), /Hermes/);
        assert.match(await page.locator('[data-my-day-classification-badges="101"]').textContent(), /РљРѕРјР°РЅРґР°|Команда/);
        await page.evaluate(() => { window.__MY_DAY_INTERACTIONS__.state.classificationDelay = 100; });
        const putCountBeforeRapid = await page.evaluate(() => window.__MY_DAY_INTERACTIONS__.state.calls.filter(call => call === 'PUT /api/my-day/tasks/101/classification').length);
        await page.locator('[data-cabinet-task-action="remove-impact"][data-task-id="101"][data-my-day-impact-id="2"]').dblclick();
        await page.waitForFunction(() => !document.querySelector('[data-my-day-classification-badges="101"]')?.textContent?.includes('Hermes'));
        assert.equal(await page.evaluate(() => window.__MY_DAY_INTERACTIONS__.state.calls.filter(call => call === 'PUT /api/my-day/tasks/101/classification').length), putCountBeforeRapid + 1);
        await page.evaluate(() => {
          window.__MY_DAY_INTERACTIONS__.state.classificationDelay = 0;
          window.__MY_DAY_INTERACTIONS__.state.classificationError = true;
          window.__MY_DAY_INTERACTIONS__.applyClassification(101, { impacts: [{ id: 1, name: 'Р РѕР±РѕС‚Р°: CRM', color: '#0EA5E9', icon: 'C', isActive: true }] });
        });
        await page.locator('[data-cabinet-task-action="remove-impact"][data-task-id="101"][data-my-day-impact-id="1"]').click();
        await page.waitForFunction(() => window.__MY_DAY_INTERACTIONS__.state.notifications.some(item => item.type === 'error'));
        assert.match(await page.locator('[data-my-day-classification-badges="101"]').textContent(), /CRM/);
        await page.evaluate(() => { window.__MY_DAY_INTERACTIONS__.state.classificationError = false; });
        await page.locator('[data-cabinet-task-action="time-menu"][data-task-id="101"]').click();
        await page.waitForFunction(() => document.querySelector('[data-my-day-time-menu]') || window.__MY_DAY_INTERACTIONS__.state.timeMenuError);
        const timeMenuError = await page.evaluate(() => window.__MY_DAY_INTERACTIONS__.state.timeMenuError);
        assert.equal(timeMenuError, '');
        const timeMenuText = await page.locator('[data-my-day-time-menu]').textContent();
        assert.match(timeMenuText, /План/);
        assert.match(timeMenuText, /Факт/);
        assert.match(timeMenuText, /Додати час/);
        assert.match(timeMenuText, /Записи/);
        await page.keyboard.press('Escape');
        await page.waitForSelector('#taskUiActionSurface', { state: 'detached' });
        await assertNoOverflow(page);

        await page.locator('#ai-overdue').click();
        await page.waitForFunction(() => document.querySelector('[data-my-day-classification-badges="202"]')?.textContent?.includes('Hermes'));
        await page.locator('[data-my-day-ai-undo]').click();
        await page.waitForFunction(() => !document.querySelector('[data-my-day-classification-badges="202"]')?.textContent?.includes('Hermes'));

        await page.evaluate(() => { window.__MY_DAY_INTERACTIONS__.state.aiMode = 'provider'; });
        await page.locator('#ai-normal').click();
        await page.waitForSelector('.my-day-ai-result.is-error');
        assert.equal(await page.locator('#ai-normal').getAttribute('data-my-day-ai-state'), 'provider-unavailable');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('taskUiActionSurface'));

        await page.evaluate(() => { window.__MY_DAY_INTERACTIONS__.state.aiMode = 'conflict'; });
        await page.locator('#ai-normal').click();
        await page.waitForSelector('.my-day-ai-result.is-error');
        assert.equal(await page.locator('#ai-normal').getAttribute('data-my-day-ai-state'), 'conflict');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('taskUiActionSurface'));

        await page.locator('#deps-normal').click();
        await page.waitForSelector('[data-dependency-manager]');
        const beforeSearch = await page.locator('[data-dependency-results]').textContent();
        assert.doesNotMatch(beforeSearch || '', /Збігів немає/);
        await page.locator('[data-dependency-search]').fill('P');
        assert.equal(await page.locator('[data-dependency-link]').count(), 0);
        await page.locator('[data-dependency-search]').fill('Pre');
        await page.waitForSelector('[data-dependency-link]');
        const linkCountBefore = await page.evaluate(() => window.__MY_DAY_INTERACTIONS__.state.calls.filter(call => call === 'POST /api/tasks/101/dependencies').length);
        await page.locator('[data-dependency-link]').first().dblclick();
        await page.waitForFunction(before => window.__MY_DAY_INTERACTIONS__.state.calls.filter(call => call === 'POST /api/tasks/101/dependencies').length === before + 1, linkCountBefore);

        await page.locator('[data-dependency-create]').fill('Quick prerequisite');
        await page.locator('[data-dependency-quick-create]').dblclick();
        await page.waitForFunction(() => window.__MY_DAY_INTERACTIONS__.state.dependencies[101].some(item => item.title === 'Quick prerequisite'));
        await page.locator('[data-dependency-remove]').first().click();
        await page.waitForFunction(() => window.__MY_DAY_INTERACTIONS__.state.dependencies[101].length >= 1);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('taskUiActionSurface'));
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'deps-normal');

        await assertNoOverflow(page);
        assert.deepEqual(pageErrors, [], `browser runtime errors: ${pageErrors.join('; ')}`);
    } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
    }
}

async function run() {
    const { chromium } = requirePlaywright();
    const fixture = await createStaticServer();
    const browser = await chromium.launch({ headless: HEADLESS });
    try {
        await runScenario(browser, fixture, { dark: false, viewport: { width: 1440, height: 900 } });
        await runScenario(browser, fixture, { dark: true, viewport: { width: 1440, height: 900 } });
        await runScenario(browser, fixture, { dark: false, viewport: { width: 390, height: 844 } });
        await runScenario(browser, fixture, { dark: true, viewport: { width: 390, height: 844 } });
        console.log('My Day interactions browser smoke passed');
    } finally {
        await browser.close().catch(() => {});
        await new Promise(resolve => fixture.server.close(resolve));
    }
}

run().catch(error => {
    console.error(`My Day interactions browser smoke failed: ${error.stack || error.message}`);
    process.exitCode = 1;
});
