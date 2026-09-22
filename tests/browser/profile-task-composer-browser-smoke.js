const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', 'profile-task-composer');

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
  <link rel="stylesheet" href="/css/pages-cabinet.css">
  <style>
    :root { --gray-900: #111827; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #eef2f7; font-family: Arial, sans-serif; }
    body.dark-mode { background: #020617; }
    main { width: min(100%, 980px); margin: 0 auto; }
    button, textarea { font: inherit; }
  </style>
</head>
<body class="profile-page profile-work-mode">
  <main>
    <form class="cabinet-capture cabinet-task-composer is-collapsed" id="cabinetTaskComposer" data-cabinet-composer-state="collapsed">
      <div class="cabinet-task-composer-head">
        <div><span class="cabinet-kicker">Нова задача</span><h3>Додати в мій робочий простір</h3></div>
      </div>
      <div class="cabinet-task-composer-main">
        <label class="cabinet-task-title-field" for="cabinetTaskTitle">
          <span>Що потрібно зробити?</span>
          <textarea id="cabinetTaskTitle" rows="1" autocomplete="off" placeholder="Наприклад: підготувати кошторис до п’ятниці" aria-describedby="cabinetTaskTitleGuidance cabinetTaskComposerStatus" aria-invalid="false"></textarea>
          <span id="cabinetTaskTitleGuidance" class="cabinet-task-title-guidance" role="status" aria-live="polite"></span>
        </label>
        <div class="cabinet-task-composer-actions">
          <button type="submit" class="cabinet-task-create-submit">Додати задачу</button>
          <button type="button" class="cabinet-task-ai-fill task-ai-draft-trigger">Заповнити з AI</button>
          <button type="button" class="cabinet-task-composer-toggle" aria-expanded="false" aria-controls="cabinetTaskComposerAdvanced">Більше параметрів</button>
        </div>
        <div id="cabinetTaskComposerAdvanced" data-cabinet-composer-advanced aria-hidden="true" hidden></div>
      </div>
      <div class="cabinet-task-composer-meta">
        <div class="cabinet-task-composer-essential">
          <div class="cabinet-due-presets" role="group" aria-label="Коли виконати">
            <button type="button" class="cabinet-due-chip active">Сьогодні</button>
            <button type="button" class="cabinet-due-chip">Завтра</button>
            <button type="button" class="cabinet-due-chip">Без дати</button>
          </div>
          <div class="cabinet-priority-presets" role="group" aria-label="Пріоритет задачі">
            <button type="button" class="cabinet-priority-chip active">Звичайний</button>
            <button type="button" class="cabinet-priority-chip">Високий</button>
          </div>
        </div>
      </div>
      <p id="cabinetTaskComposerStatus" class="task-ai-draft-status cabinet-task-composer-status" role="status" aria-live="polite"></p>
    </form>
  </main>
  <script>
    (() => {
      const form = document.getElementById('cabinetTaskComposer');
      const input = document.getElementById('cabinetTaskTitle');
      const guidance = document.getElementById('cabinetTaskTitleGuidance');
      let validSubmissions = 0;
      window.getValidSubmissions = () => validSubmissions;
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (input.value.trim()) {
          validSubmissions += 1;
          return;
        }
        guidance.textContent = 'Заповніть назву задачі';
        guidance.className = 'cabinet-task-title-guidance error';
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      });
      input.addEventListener('input', () => {
        if (!input.value.trim()) return;
        guidance.textContent = '';
        guidance.className = 'cabinet-task-title-guidance';
        input.setAttribute('aria-invalid', 'false');
      });
    })();
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

async function runScenario(browser, baseUrl, viewport, dark) {
    const page = await browser.newPage({ viewport });
    await page.goto(baseUrl);
    if (dark) await page.evaluate(() => document.body.classList.add('dark-mode'));

    const composer = page.locator('#cabinetTaskComposer');
    const input = page.locator('#cabinetTaskTitle');
    assert.equal(await page.locator('label[for="cabinetTaskTitle"] > span').first().textContent(), 'Що потрібно зробити?');
    assert.equal(await input.getAttribute('placeholder'), 'Наприклад: підготувати кошторис до п’ятниці');
    assert.equal(await page.locator('#cabinetTaskComposerAdvanced').isHidden(), true);

    const metrics = await composer.evaluate(node => {
        const inputNode = node.querySelector('#cabinetTaskTitle');
        const inputStyle = getComputedStyle(inputNode);
        const buttons = Array.from(node.querySelectorAll('.cabinet-task-composer-actions button')).map(button => {
            const rect = button.getBoundingClientRect();
            return {
                text: button.textContent.trim(),
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                scrollWidth: button.scrollWidth,
                background: getComputedStyle(button).backgroundColor
            };
        });
        return {
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            composerOverflow: node.scrollWidth - node.clientWidth,
            borderWidth: parseFloat(inputStyle.borderTopWidth),
            buttons
        };
    });
    assert.ok(metrics.documentOverflow <= 1, `document overflows horizontally: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.composerOverflow <= 1, `composer overflows horizontally: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.borderWidth >= 2, `task input is not visually distinct: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.buttons.every(button => button.width > 0 && button.scrollWidth <= button.width + 1), `button text is clipped: ${JSON.stringify(metrics.buttons)}`);
    assert.ok(metrics.buttons[0].width >= 140, `primary action is too narrow to remain legible: ${JSON.stringify(metrics.buttons[0])}`);
    assert.notEqual(metrics.buttons[0].background, metrics.buttons[1].background, 'primary and AI actions must remain visually distinct');

    await composer.screenshot({ path: path.join(OUTPUT_DIR, `task-composer-${viewport.width}-${dark ? 'dark' : 'light'}.png`) });
    await composer.evaluate(node => node.requestSubmit());
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'cabinetTaskTitle');
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    assert.match(await page.locator('#cabinetTaskTitleGuidance').textContent(), /Заповніть назву задачі/);

    await input.fill('Підготувати кошторис');
    assert.equal(await input.getAttribute('aria-invalid'), 'false');
    assert.equal(await page.locator('#cabinetTaskTitleGuidance').textContent(), '');
    const createButton = page.locator('.cabinet-task-create-submit');
    await createButton.focus();
    await createButton.press('Enter');
    assert.equal(await page.evaluate(() => window.getValidSubmissions()), 1);
    await page.close();
}

(async () => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const server = await startServer();
    const address = server.address();
    const { chromium } = requirePlaywright();
    const browser = await chromium.launch({ headless: true });
    try {
        const baseUrl = `http://127.0.0.1:${address.port}`;
        for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
            await runScenario(browser, baseUrl, viewport, false);
            await runScenario(browser, baseUrl, viewport, true);
        }
        console.log('Profile task composer browser smoke passed.');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
