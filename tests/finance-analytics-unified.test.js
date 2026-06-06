const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('finance is the canonical unified finance and analytics surface', () => {
    const financeHtml = read('finance.html');
    const financeJs = read('js/finance-page.js');
    const analyticsJs = read('js/analytics-page.js');
    const analyticsHtml = read('analytics.html');
    const pagesCss = read('css/pages.css');
    const sidebarJs = read('js/components/sidebar.js');
    const serverJs = read('server.js');

    assert.match(financeHtml, /Фінанси та аналітика/);
    assert.match(financeHtml, /id="faExecutiveZone"/);
    assert.match(financeHtml, /id="faActionRail"/);
    assert.match(financeHtml, /id="faWorkspace"/);
    assert.match(financeHtml, /data-mode="overview"/);
    assert.match(financeHtml, /data-mode="operations"/);
    assert.match(financeHtml, /data-mode="insights"/);
    assert.match(financeHtml, /js\/analytics-page\.js/);
    assert.doesNotMatch(financeHtml, /data-tab="advanced">Аналітика</);

    assert.match(financeJs, /function fetchUnifiedOverview/);
    assert.match(financeJs, /\/api\/analytics\/overview/);
    assert.match(financeJs, /\/api\/analytics\/charts/);
    assert.match(financeJs, /\/api\/analytics\/comparison/);
    assert.match(financeJs, /\/api\/analytics\/deals-lifecycle/);
    assert.match(financeJs, /function setFinanceMode/);
    assert.match(financeJs, /renderOverviewWorkspace/);
    assert.match(financeJs, /renderInsightsWorkspace/);

    assert.match(analyticsJs, /window\.CrmAnalyticsWidgets/);
    assert.match(analyticsJs, /initStandaloneAnalyticsPage/);
    assert.match(analyticsJs, /document\.getElementById\('kpiGrid'\)/);
    assert.match(analyticsJs, /function renderChartReadout/);
    assert.match(financeJs, /function renderFinanceChartReadout/);
    assert.match(financeJs, /fin-chart-readout/);
    assert.match(pagesCss, /\.an-chart-readout/);
    assert.match(pagesCss, /\.fin-chart-readout/);

    assert.match(analyticsHtml, /window\.location\.replace\('\/finance\?mode=insights'\)/);
    assert.match(serverJs, /app\.get\('\/analytics'/);
    assert.match(serverJs, /res\.redirect\(301, `\/finance\?mode=/);

    assert.match(sidebarJs, /Фінанси та аналітика/);
    assert.doesNotMatch(sidebarJs, /href: '\/analytics'/);
});
