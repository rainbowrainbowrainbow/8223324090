const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function jsonResponse(data, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
        blob: async () => new Blob([JSON.stringify(data)])
    };
}

async function waitFor(predicate, message = 'condition') {
    for (let i = 0; i < 60; i += 1) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`Timed out waiting for ${message}`);
}

async function setupReportsDom() {
    const html = fs.readFileSync(path.join(ROOT, 'reports.html'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'js/reports-page.js'), 'utf8');
    const dom = new JSDOM(html, {
        url: 'http://localhost:3000/reports',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const { window } = dom;
    const createdReports = [];
    const requests = [];

    window.AppState = {};
    window.apiVerifyToken = async () => ({ id: 1, username: 'serhiy', role: 'creator' });
    window.initDarkMode = () => {};
    window.showAuthenticatedPageShell = () => {};
    window.confirmModal = async () => true;
    window.promptModal = async () => 'Нова колонка';
    window.localStorage.setItem('pzp_token', 'test-token');
    window.fetch = async (url, options = {}) => {
        const target = String(url);
        requests.push({ url: target, options });
        if (target.startsWith('/api/reports/templates')) return jsonResponse({ success: true, templates: [], canManage: true });
        if (target.startsWith('/api/reports/drafts')) return jsonResponse({ success: true, drafts: [] });
        if (target.startsWith('/api/reports/summary')) return jsonResponse({ today: { income: 0, expense: 0, newReports: 0 }, statuses: { new: 0 } });
        if (target.startsWith('/api/reports/accountants')) return jsonResponse([]);
        if (target.startsWith('/api/reports/hashtags')) {
            return jsonResponse([
                { hashtag: 'table-finance', total: 100, count: 1, activeCount: 1, inactiveCount: 0 },
                { hashtag: 'visible-ops', total: 50, count: 1, activeCount: 1, inactiveCount: 0 }
            ]);
        }
        if (target === '/api/reports/table/close' && options.method === 'POST') {
            const body = JSON.parse(options.body || '{}');
            const rawData = JSON.parse(JSON.stringify(body.tableJson || {}));
            rawData.reportTableTemplate.lifecycle = {
                status: 'closed',
                closedAt: '2026-05-23T10:00:00.000Z',
                closedBy: 'serhiy',
                closedByUserId: 1
            };
            const report = {
                id: body.reportId || 9100,
                type: 'expense',
                amount: body.amount,
                description: body.description,
                category: body.category,
                submittedBy: 'Сергій',
                submittedVia: 'web-template',
                status: 'new',
                lifecycleStatus: 'closed',
                closedAt: '2026-05-23T10:00:00.000Z',
                closedByUsername: 'serhiy',
                createdAt: new Date().toISOString(),
                hashtags: body.hashtags || [],
                hashtagActive: true,
                rawData,
                lockedSnapshot: rawData
            };
            createdReports.unshift(report);
            return jsonResponse({ success: true, report }, body.reportId ? 200 : 201);
        }
        if (target.startsWith('/api/reports?')) return jsonResponse({ reports: createdReports, total: createdReports.length });
        if (target === '/api/reports' && options.method === 'POST') {
            const body = JSON.parse(options.body || '{}');
            const report = {
                id: 9001,
                type: body.type,
                amount: body.amount,
                description: body.description,
                category: body.category,
                submittedBy: 'Сергій',
                submittedVia: body.submittedVia,
                status: 'new',
                createdAt: new Date().toISOString(),
                hashtags: body.hashtags || [],
                hashtagActive: true,
                rawData: body.rawData || {}
            };
            createdReports.unshift(report);
            return jsonResponse(report, 201);
        }
        return jsonResponse({});
    };

    window.eval(js);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
    await waitFor(() => window.document.querySelectorAll('.rpt-sheet-input').length > 0, 'reports workspace init');
    return { window, requests };
}

test('reports workspace protects dirty table state and manages rows/columns', async () => {
    const { window } = await setupReportsDom();
    const document = window.document;

    const firstInput = document.querySelector('.rpt-sheet-input');
    firstInput.value = '2026-05-22';
    firstInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(document.getElementById('reportTemplateDirty').classList.contains('hidden'), false);

    window.confirmModal = async () => false;
    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'operations-checklist';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(document.getElementById('reportSheetTitle').textContent, /Фінансовий/);
    assert.equal(picker.value, 'finance-day-summary');

    window.confirmModal = async () => true;
    picker.value = 'operations-checklist';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /Операційний/.test(document.getElementById('reportSheetTitle').textContent), 'template switch');
    assert.equal(document.getElementById('reportTemplateDirty').classList.contains('hidden'), true);

    const rowsBefore = document.querySelectorAll('#reportSheetTable tbody tr').length;
    document.getElementById('reportTemplateAddRowBtn').click();
    assert.equal(document.querySelectorAll('#reportSheetTable tbody tr').length, rowsBefore + 1);

    document.querySelector('[data-report-row-duplicate="0"]').click();
    assert.equal(document.querySelectorAll('#reportSheetTable tbody tr').length, rowsBefore + 2);

    document.getElementById('reportTemplateAddColumnBtn').click();
    await waitFor(() => document.getElementById('reportSheetTable').textContent.includes('Нова колонка'), 'new column');
    const columnCount = document.querySelectorAll('#reportSheetTable thead th').length;
    const deleteColumnButtons = document.querySelectorAll('[data-report-column-delete]');
    deleteColumnButtons[deleteColumnButtons.length - 1].click();
    assert.equal(document.querySelectorAll('#reportSheetTable thead th').length, columnCount - 1);
});

test('reports create flow creates a real report without visible technical table hashtags', async () => {
    const { window, requests } = await setupReportsDom();
    const document = window.document;

    const firstInput = document.querySelector('.rpt-sheet-input');
    firstInput.value = '2026-05-22';
    firstInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    document.getElementById('reportTemplateSaveBtn').click();
    await waitFor(() => requests.some(req => req.url === '/api/reports' && req.options.method === 'POST'), 'report create request');

    const createRequest = requests.find(req => req.url === '/api/reports' && req.options.method === 'POST');
    const body = JSON.parse(createRequest.options.body);
    assert.equal(body.submittedVia, 'web-template');
    assert.deepEqual(body.hashtags, []);
    await waitFor(() => /Оновити звіт/.test(document.getElementById('reportTemplateSaveBtn').textContent), 'create mode update');
    assert.equal(document.getElementById('reportTemplateDirty').classList.contains('hidden'), true);
    assert.match(document.getElementById('reportSheetModeChip').textContent, /#9001/);
    assert.equal(document.getElementById('hashtagDashboard').textContent.includes('table-finance'), false);
    assert.equal(document.getElementById('hashtagDashboard').textContent.includes('visible-ops'), true);
});

test('standard park report totals dar subtotal and locks after close', async () => {
    const { window, requests } = await setupReportsDom();
    const document = window.document;

    const picker = document.getElementById('reportTemplatePicker');
    picker.value = 'park-standard-report';
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => /Стандартний/.test(document.getElementById('reportSheetTitle').textContent), 'standard template switch');

    assert.equal(document.getElementById('reportTemplatePicker').value, 'park-standard-report');
    const headers = [...document.querySelectorAll('#reportSheetTable thead th .rpt-sheet-th-content > span:first-child')]
        .map(th => th.textContent.trim())
        .slice(0, 5);
    assert.deepEqual(headers, ['Дата', 'Категорія', 'Документ', 'Сума', 'Коментар']);

    const date = document.querySelector('[data-row-index="0"][data-column-key="date"]');
    const category = document.querySelector('[data-row-index="0"][data-column-key="category"]');
    const documentType = document.querySelector('[data-row-index="0"][data-column-key="document"]');
    const amount = document.querySelector('[data-row-index="0"][data-column-key="amount"]');
    date.value = '2026-05-23';
    category.value = 'дар';
    documentType.value = 'чек';
    amount.value = '120';
    [date, category, documentType, amount].forEach(input => input.dispatchEvent(new window.Event('input', { bubbles: true })));

    const category2 = document.querySelector('[data-row-index="1"][data-column-key="category"]');
    const amount2 = document.querySelector('[data-row-index="1"][data-column-key="amount"]');
    category2.value = 'афіша';
    amount2.value = '80';
    [category2, amount2].forEach(input => input.dispatchEvent(new window.Event('input', { bubbles: true })));

    const summary = document.getElementById('reportSheetSummary').textContent;
    assert.match(summary, /Ітого/);
    assert.match(summary, /Ітого ДАР/);
    assert.match(summary, /200/);
    assert.match(summary, /120/);

    document.getElementById('reportTemplateCloseBtn').click();
    await waitFor(() => requests.some(req => req.url === '/api/reports/table/close'), 'report close request');

    const closeRequest = requests.find(req => req.url === '/api/reports/table/close');
    const body = JSON.parse(closeRequest.options.body);
    assert.equal(body.tableJson.reportTableTemplate.defaultReport.amountColumn, 'amount');
    assert.equal(body.tableJson.reportTableTemplate.defaultReport.subtotalRules[0].categoryValue, 'дар');
    assert.equal(body.amount, 200);

    await waitFor(() => /Закритий/.test(document.getElementById('reportSheetModeChip').textContent), 'closed lock render');
    assert.equal(document.getElementById('reportTemplateAddRowBtn').disabled, true);
    assert.equal(document.getElementById('reportTemplateAddColumnBtn').disabled, true);
    assert.equal(document.getElementById('reportTemplateCloseBtn').disabled, true);
    assert.equal(document.getElementById('reportTemplateExportCsvBtn').disabled, false);
    assert.equal(document.querySelector('.rpt-sheet-input').disabled, true);
});
