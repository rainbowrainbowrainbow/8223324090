#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'blocked-subtask-completion');

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

function checklistRows(surface) {
    if (surface === 'tasks') {
        return `<label class="task-card-subtask-item is-done"><input type="checkbox" checked data-subtask-check><span>Готовий пункт</span></label>
        <label class="task-card-subtask-item"><input type="checkbox" data-subtask-check><span>Незавершений пункт</span></label>`;
    }
    return `<div class="cabinet-subtask-inline-item is-done"><span aria-hidden="true">⋮⋮</span><label class="cabinet-subtask-inline-check"><input type="checkbox" checked data-subtask-check><span>Готовий пункт</span></label></div>
        <div class="cabinet-subtask-inline-item"><span aria-hidden="true">⋮⋮</span><label class="cabinet-subtask-inline-check"><input type="checkbox" data-subtask-check><span>Незавершений пункт</span></label></div>`;
}

function harnessHtml() {
    return `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="/css/pages-cabinet.css">
  <link rel="stylesheet" href="/css/pages-tasks.css">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #f8fafc; font-family: Arial, sans-serif; color: #0f172a; }
    body.dark-mode { background: #020617; color: #e2e8f0; }
    main { display: grid; gap: 20px; width: min(100%, 860px); margin: 0 auto; }
    .fixture { min-width: 0; }
    .fixture h2 { margin: 0 0 8px; font-size: 16px; }
    .task-card { display: grid; gap: 8px; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; }
    body.dark-mode .task-card { background: #0f172a; border-color: #475569; }
    .task-row-primary { min-height: 36px; border: 1px solid rgba(20,184,166,.28); border-radius: 8px; background: rgba(16,185,129,.12); color: #047857; font-weight: 800; }
    .task-row-primary[aria-disabled="true"] { cursor: help; opacity: .72; border-color: rgba(220,38,38,.34); background: rgba(254,226,226,.72); color: #991b1b; }
    .task-card-subtasks-panel { padding: 8px; border: 1px solid rgba(148,163,184,.18); border-radius: 10px; background: rgba(248,250,252,.82); }
    .task-card-subtasks-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-size: 11px; }
    .task-card-subtasks-list { display: grid; gap: 5px; }
    .task-card-subtask-item { display: grid; grid-template-columns: 16px minmax(0,1fr); gap: 7px; padding: 6px 7px; border-radius: 8px; background: rgba(255,255,255,.78); font-size: 12px; font-weight: 700; }
    .task-card-subtask-item.is-done span { color: #94a3b8; text-decoration: line-through; }
    .task-card.is-subtask-completion-blocked { border-color: rgba(220,38,38,.42); box-shadow: inset 4px 0 0 #dc2626, 0 8px 22px rgba(127,29,29,.10); }
    .task-card-subtasks-panel.is-completion-blocked-attention { border-color: rgba(220,38,38,.36); background: rgba(254,242,242,.88); }
    .task-card-subtask-item.is-blocked-attention { border: 1px solid rgba(220,38,38,.40); background: #fff1f2; color: #991b1b; }
    body.dark-mode .task-row-primary[aria-disabled="true"] { border-color: rgba(248,113,113,.46); background: rgba(127,29,29,.28); color: #fecaca; }
    body.dark-mode .task-card-subtasks-panel, body.dark-mode .task-card-subtask-item { background: rgba(15,23,42,.72); border-color: rgba(148,163,184,.20); color: #dbeafe; }
    body.dark-mode .task-card-subtasks-panel.is-completion-blocked-attention, body.dark-mode .task-card-subtask-item.is-blocked-attention { border-color: rgba(248,113,113,.42); background: rgba(127,29,29,.24); color: #fecaca; }
    .cabinet-task-card { padding: 12px; }
    .cabinet-task-zone--header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .task-card-subtasks-panel[hidden], .cabinet-subtask-inline-panel[hidden] { display: none; }
    .fixture-live { min-height: 18px; margin: 6px 0 0; color: #b91c1c; font-size: 12px; font-weight: 700; }
    @media (max-width: 480px) { body { padding: 12px; } }
  </style>
</head>
<body>
  <main>
    <section class="fixture" data-fixture="tasks">
      <h2>Tasks</h2>
      <article class="task-card task-work-row" data-card>
        <strong>Підготувати подію</strong>
        <button type="button" class="task-row-primary btn-done" data-complete aria-disabled="true" data-task-completion-blocked="subtasks">✓ Виконати</button>
        <div class="task-card-subtasks-panel" data-panel hidden>
          <div class="task-card-subtasks-head"><span>Підпункти</span><b>1/2</b></div>
          <div class="task-card-subtasks-list">${checklistRows('tasks')}</div>
        </div>
      </article>
      <p class="fixture-live" role="status" aria-live="polite"></p>
    </section>
    <section class="fixture" data-fixture="profile">
      <h2>My Day</h2>
      <article class="cabinet-task-card" data-card>
        <div class="cabinet-task-zone cabinet-task-zone--header"><strong>Підготувати звіт</strong><button type="button" class="cabinet-task-action-btn cabinet-task-action-done" data-complete aria-disabled="true" data-cabinet-completion-blocked="subtasks">✓</button></div>
        <div class="cabinet-subtask-inline-panel" data-panel hidden>
          <div class="cabinet-subtask-inline-list">${checklistRows('profile')}</div>
        </div>
      </article>
      <p class="fixture-live" role="status" aria-live="polite"></p>
    </section>
  </main>
  <script>
    window.parentStatusMutations = 0;
    document.querySelectorAll('[data-fixture]').forEach(fixture => {
      const button = fixture.querySelector('[data-complete]');
      const card = fixture.querySelector('[data-card]');
      const panel = fixture.querySelector('[data-panel]');
      const live = fixture.querySelector('.fixture-live');
      const rows = () => Array.from(fixture.querySelectorAll('[data-subtask-check]'));
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-disabled') !== 'true') {
          window.parentStatusMutations += 1;
          return;
        }
        panel.hidden = false;
        card.classList.add('is-subtask-completion-blocked');
        panel.classList.add('is-completion-blocked-attention');
        rows().forEach(input => {
          const row = input.closest('.task-card-subtask-item, .cabinet-subtask-inline-item');
          row.classList.toggle('is-blocked-attention', !input.checked);
        });
        const firstOpen = rows().find(input => !input.checked);
        firstOpen.focus();
        live.textContent = 'Спочатку закрийте підпункти: 1/2';
      });
      rows().forEach(input => input.addEventListener('change', () => {
        if (rows().some(item => !item.checked)) return;
        card.classList.remove('is-subtask-completion-blocked');
        panel.classList.remove('is-completion-blocked-attention');
        rows().forEach(item => item.closest('.task-card-subtask-item, .cabinet-subtask-inline-item').classList.remove('is-blocked-attention'));
        button.removeAttribute('aria-disabled');
        live.textContent = 'Усі підпункти закриті. Тепер можна виконати задачу.';
      }));
    });
  </script>
</body>
</html>`;
}

function startServer() {
    const server = http.createServer((request, response) => {
        if (request.url === '/') {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(harnessHtml());
            return;
        }
        const filePath = path.join(ROOT, request.url.replace(/^\//, ''));
        if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath)) {
            response.writeHead(404);
            response.end('Not found');
            return;
        }
        response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        fs.createReadStream(filePath).pipe(response);
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function exerciseFixture(page, name, keyboardKey) {
    const fixture = page.locator(`[data-fixture="${name}"]`);
    const button = fixture.locator('[data-complete]');
    if (keyboardKey) {
        await button.evaluate(node => node.focus());
        await page.keyboard.press(keyboardKey);
    } else {
        await button.click({ force: true });
    }
    await assert.doesNotReject(() => fixture.locator('[data-panel]').waitFor({ state: 'visible' }));
    assert.equal(await page.evaluate(() => window.parentStatusMutations), 0);
    assert.equal(await fixture.locator('.is-blocked-attention').count(), 1);
    assert.equal(await fixture.locator('.is-done.is-blocked-attention').count(), 0);
    assert.equal(await fixture.locator('[data-subtask-check]:not(:checked)').evaluate(node => document.activeElement === node), true);
    assert.match(await fixture.locator('.fixture-live').textContent(), /Спочатку закрийте підпункти: 1\/2/);
}

async function runScenario(browser, baseUrl, viewport, dark) {
    const page = await browser.newPage({ viewport });
    await page.goto(baseUrl);
    if (dark) await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.body.classList.add('dark-mode');
    });
    await exerciseFixture(page, 'tasks', null);
    await exerciseFixture(page, 'profile', 'Space');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `blocked completion fixture overflows by ${overflow}px`);
    await page.screenshot({ fullPage: true, path: path.join(OUTPUT_DIR, `blocked-subtasks-${viewport.width}-${dark ? 'dark' : 'light'}.png`) });

    for (const name of ['tasks', 'profile']) {
        const fixture = page.locator(`[data-fixture="${name}"]`);
        await fixture.locator('[data-subtask-check]:not(:checked)').check();
        assert.equal(await fixture.locator('[data-complete]').getAttribute('aria-disabled'), null);
        await fixture.locator('[data-complete]').click();
    }
    assert.equal(await page.evaluate(() => window.parentStatusMutations), 2, 'each resolved parent completes exactly once');
    await page.close();
}

(async () => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const server = await startServer();
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: true });
    try {
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
            await runScenario(browser, baseUrl, viewport, false);
            await runScenario(browser, baseUrl, viewport, true);
        }
        console.log('Blocked subtask completion browser smoke passed.');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
