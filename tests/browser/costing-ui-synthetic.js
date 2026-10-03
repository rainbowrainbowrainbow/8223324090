'use strict';

// Browser flow against actual page/scripts, with an in-memory costing API and no production access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { calculatePlan } = require('../../services/costingCalculator');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/costing-synthetic');
const html = fs.readFileSync(path.join(root, 'finance.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const definition = { revenueBasis: 'participant', revenueRateMinor: '30000', lines: [
    { code: 'teacher', label: 'Викладач', basis: 'hour', rateMinor: '25000' },
    { code: 'materials', label: 'Матеріали', basis: 'participant', rateMinor: '4000' },
    { code: 'room', label: 'Зала', basis: 'execution', rateMinor: '15000' },
    { code: 'fee', label: 'Комісія', basis: 'percent', percentBps: 500, percentBase: 'revenue' }
] };
const template = { id: '1', name: 'Групове заняття', kind: 'lesson' };
const version = { id: '1', version_number: 1, effective_from: '2026-01-01', definition };
const plans = [];
const requests = [];
const boot = `<script>
window.AppState = {};
window.apiVerifyToken = async () => ({name:'Synthetic QA',role:'creator'});
window.hydrateActionPermissions = async () => ({});
window.canUseAction = () => true;
window.getAuthHeaders = () => ({'Content-Type':'application/json'});
window.handleAuthError = () => false;
window.showAuthenticatedPageShell = () => {
    document.getElementById('mainApp').classList.remove('hidden');
    document.body.classList.add('shell-ready','dark-mode');
};
window.getLegacyBusinessSurfaceAvailability = () => ({available:false,message:'Synthetic isolated fixture'});
window.apiFetchWithAuthRetry = (url,options) => fetch(url,options);
window.escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
document.documentElement.setAttribute('data-theme','dark');
</script><script src="/js/finance-page.js"></script><script src="/js/finance-costing.js"></script>`;

function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value));
}

async function main() {
    fs.mkdirSync(output, { recursive: true });
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/api/')) {
            requests.push({ method: req.method, path: url.pathname });
            const endpoint = url.pathname.replace('/api/finance/costing', '');
            if (req.method === 'GET' && endpoint === '/templates') return json(res, 200, { templates: [template] });
            if (req.method === 'GET' && endpoint === '/templates/1') return json(res, 200, { template, versions: [version] });
            if (req.method === 'GET' && endpoint === '/plans') return json(res, 200, { plans });
            if (req.method === 'POST' && ['/preview', '/plans'].includes(endpoint)) {
                let body = '';
                for await (const part of req) body += part;
                const payload = JSON.parse(body);
                const calculation = calculatePlan(definition, payload.inputs);
                if (endpoint === '/preview') return json(res, 200, { version: { id: '1', number: 1, effectiveFrom: version.effective_from }, calculation });
                assert.equal(payload.expectedVersionId, '1');
                plans.push({ execution_label: payload.executionLabel, execution_date: payload.executionDate,
                    template_name: template.name, version_number: 1, contribution_minor: calculation.contributionMinor });
                return json(res, 201, { planId: String(plans.length), versionId: '1', calculation });
            }
            if (req.method === 'GET') {
                if (url.pathname.endsWith('/categories')) return json(res, 200, []);
                return json(res, 200, {});
            }
            return json(res, 405, { error: 'Unexpected synthetic request' });
        }
        if (url.pathname === '/finance') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(html.replace('</body>', `${boot}</body>`));
        }
        const file = path.resolve(root, `.${url.pathname}`);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await chromium.launch({ headless: true,
            executablePath: 'C:\\Users\\Plotva\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe' });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
        await page.goto(`${origin}/finance?tab=costing`);
        await page.locator('#costTemplateSelect option[value="1"]').waitFor({ state: 'attached' });
        await page.locator('#costTemplateSelect').selectOption('1');
        await page.locator('#costExecutionLabel').fill('Урок 12 жовтня');
        await page.locator('#costExecutionDate').fill('2026-10-12');
        await page.locator('#costParticipants').fill('10');
        await page.locator('#costPaidParticipants').fill('8');
        await page.locator('#costHours').fill('2');
        await page.locator('#costDiscountPercent').fill('10');
        await page.locator('#costPreview').click();
        await page.locator('#costPreviewResult').getByText('1 002,00 ₴').waitFor();
        assert.match(await page.locator('#costPreviewResult').innerText(), /46\.39%/);
        await page.locator('#costSavePlan').click();
        await page.locator('#costPlanList').getByText('Урок 12 жовтня').waitFor();
        assert.equal(plans.length, 1);
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 820, height: 1180 });
        const tabletBounds = await page.locator('#tabCosting .cost-card').evaluateAll(cards => cards.map(card => {
            const rect = card.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
        }));
        assert.ok(tabletBounds.every(rect => rect.left >= 0 && rect.right <= 821), JSON.stringify(tabletBounds));
        await page.screenshot({ path: path.join(output, 'tablet.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
        assert.ok(await page.locator('#tabCosting').isVisible());
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ passed: true, contributionMinor: plans[0].contribution_minor,
            requests: requests.filter(r => r.path.startsWith('/api/finance/costing')), output }));
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
