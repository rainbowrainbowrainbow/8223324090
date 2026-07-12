const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const repoRoot = path.resolve(__dirname, '..');
const centerPageSource = fs.readFileSync(path.join(repoRoot, 'js', 'center-page.js'), 'utf8');
const lifecycleStart = centerPageSource.indexOf('function toggleSection');
const lifecycleEnd = centerPageSource.indexOf("document.addEventListener('DOMContentLoaded', initCenterPage);", lifecycleStart);

assert.ok(lifecycleStart >= 0 && lifecycleEnd > lifecycleStart, 'Center section lifecycle source exists');

const loaderNames = [
    'loadOverview', 'loadHotLeads', 'loadConversion', 'loadCharts', 'loadGoals', 'loadBriefing',
    'loadWorkers', 'loadWorkload', 'loadTasks', 'loadProgramPerformance', 'loadHeatmap',
    'loadCrossSell', 'loadLoyalty', 'loadDiscounts', 'loadProposals', 'loadPrices',
    'loadCatalog', 'loadReconciliation', 'loadEventLog', 'loadReport'
];

function centerSectionMarkup(id, label) {
    return `<section class="center-section" id="${id}">
        <div class="center-section-title" onclick="toggleSection(this)">
            <span class="collapse-arrow">▼</span>${label}
        </div>
        <div class="section-body"><div class="center-loading">Loading</div></div>
    </section>`;
}

function createHarness() {
    const dom = new JSDOM(`<!doctype html><html><body>
        ${centerSectionMarkup('kpiSection', 'KPI')}
        ${centerSectionMarkup('chartsSection', 'Charts')}
        ${centerSectionMarkup('goalsSection', 'Goals')}
    </body></html>`, { runScripts: 'outside-only', url: 'https://crm.test/center' });
    const context = dom.getInternalVMContext();
    context.console = { error() {}, warn() {}, log() {} };
    const calls = new Map();
    const implementations = new Map();

    loaderNames.forEach(name => {
        context[name] = async (...args) => {
            calls.set(name, (calls.get(name) || 0) + 1);
            return implementations.get(name)?.(...args);
        };
    });

    vm.runInContext(`
        const centerSectionState = new Map();
        ${centerPageSource.slice(lifecycleStart, lifecycleEnd)}
        this.__centerLazyLoadingHooks = {
            toggleSection,
            restoreCollapsedState,
            enhanceCenterSectionHeaders,
            loadInitiallyVisibleCenterSections,
            loadCenterSection,
            bindCenterSectionLoading,
            getState: id => centerSectionState.get(id)
        };
    `, context, { filename: 'js/center-page.js' });

    return {
        dom,
        document: dom.window.document,
        hooks: context.__centerLazyLoadingHooks,
        callCount: name => calls.get(name) || 0,
        setLoader: (name, implementation) => implementations.set(name, implementation),
        settle: () => new Promise(resolve => dom.window.setTimeout(resolve, 0))
    };
}

test('Center keeps only KPI open for a new user and exposes semantic section buttons', () => {
    const harness = createHarness();
    const { document, hooks } = harness;

    hooks.enhanceCenterSectionHeaders();
    hooks.restoreCollapsedState();

    assert.equal(document.getElementById('kpiSection').classList.contains('collapsed'), false);
    assert.equal(document.getElementById('chartsSection').classList.contains('collapsed'), true);
    assert.equal(document.getElementById('goalsSection').classList.contains('collapsed'), true);

    const kpiToggle = document.querySelector('#kpiSection .center-section-toggle');
    assert.ok(kpiToggle, 'KPI header uses a native button');
    assert.equal(kpiToggle.tagName, 'BUTTON');
    assert.equal(kpiToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(kpiToggle.getAttribute('aria-controls'), 'kpiSectionBody');
    assert.equal(document.querySelector('#kpiSection .center-section-title').hasAttribute('onclick'), false);
    harness.dom.window.close();
});

test('Center loads every restored visible section once and skips collapsed sections', async () => {
    const harness = createHarness();
    const { document, hooks } = harness;
    harness.dom.window.localStorage.setItem('center_collapsed', JSON.stringify({
        chartsSection: false,
        goalsSection: true
    }));

    hooks.enhanceCenterSectionHeaders();
    hooks.restoreCollapsedState();
    await hooks.loadInitiallyVisibleCenterSections();

    assert.equal(document.getElementById('kpiSection').classList.contains('collapsed'), false);
    assert.equal(document.getElementById('chartsSection').classList.contains('collapsed'), false);
    assert.equal(document.getElementById('goalsSection').classList.contains('collapsed'), true);
    assert.equal(harness.callCount('loadOverview'), 1);
    assert.equal(harness.callCount('loadCharts'), 1);
    assert.equal(harness.callCount('loadGoals'), 0);

    await hooks.loadInitiallyVisibleCenterSections();
    assert.equal(harness.callCount('loadOverview'), 1, 'KPI cache prevents a duplicate request');
    assert.equal(harness.callCount('loadCharts'), 1, 'restored Charts cache prevents a duplicate request');
    harness.dom.window.close();
});

test('Center opening a section shares one in-flight loader promise', async () => {
    const harness = createHarness();
    const { document, hooks } = harness;
    let finishGoals;
    harness.setLoader('loadGoals', () => new Promise(resolve => { finishGoals = resolve; }));

    hooks.enhanceCenterSectionHeaders();
    hooks.restoreCollapsedState();
    const goalsToggle = document.querySelector('#goalsSection .center-section-toggle');
    hooks.toggleSection(goalsToggle);
    const sameRequest = hooks.loadCenterSection('goalsSection');
    await Promise.resolve();

    assert.equal(harness.callCount('loadGoals'), 1);
    finishGoals();
    await sameRequest;
    assert.equal(hooks.getState('goalsSection').status, 'loaded');
    await hooks.loadCenterSection('goalsSection');
    assert.equal(harness.callCount('loadGoals'), 1, 'loaded section is cached');
    harness.dom.window.close();
});

test('Center retry reruns only the failed section and clears its retry control on success', async () => {
    const harness = createHarness();
    const { document, hooks } = harness;
    let attempts = 0;
    harness.setLoader('loadGoals', () => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary goals failure');
        document.querySelector('#goalsSection .section-body').innerHTML = '<div>Goals loaded</div>';
    });

    hooks.enhanceCenterSectionHeaders();
    hooks.restoreCollapsedState();
    hooks.bindCenterSectionLoading();
    await hooks.loadCenterSection('goalsSection');

    assert.equal(hooks.getState('goalsSection').status, 'error');
    const retry = document.querySelector('#goalsSection [data-center-section-retry]');
    assert.ok(retry, 'failed section exposes a retry control');

    retry.dispatchEvent(new harness.dom.window.MouseEvent('click', { bubbles: true }));
    await harness.settle();

    assert.equal(attempts, 2);
    assert.equal(hooks.getState('goalsSection').status, 'loaded');
    assert.equal(document.querySelector('#goalsSection [data-center-section-retry]'), null);
    assert.equal(harness.callCount('loadOverview'), 0, 'retry does not reload KPI');
    assert.equal(harness.callCount('loadCharts'), 0, 'retry does not reload Charts');
    harness.dom.window.close();
});
