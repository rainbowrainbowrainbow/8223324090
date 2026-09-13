const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const DESIGNER_HTML = fs.readFileSync(path.join(ROOT, 'designer.html'), 'utf8');
const DESIGNS_HTML = fs.readFileSync(path.join(ROOT, 'designs.html'), 'utf8');
const DESIGNS_CSS = fs.readFileSync(path.join(ROOT, 'css', 'designs.css'), 'utf8');
const DESIGNER_CSS = fs.readFileSync(path.join(ROOT, 'css', 'designer-guidebook.css'), 'utf8');

function extractDesignerTabsScript() {
    const start = DESIGNER_HTML.indexOf('const DESIGNER_TABS');
    assert.ok(start >= 0, 'designer tab script must define DESIGNER_TABS');
    const end = DESIGNER_HTML.indexOf('</script>', start);
    assert.ok(end > start, 'designer tab script must end');
    return DESIGNER_HTML.slice(start, end);
}

function createDesignerDom(url) {
    const dom = new JSDOM(DESIGNER_HTML, { url, runScripts: 'outside-only' });
    const context = vm.createContext({
        ...dom.window,
        window: dom.window,
        document: dom.window.document,
        history: dom.window.history
    });
    vm.runInContext(extractDesignerTabsScript(), context, { filename: 'designer.html' });
    return dom;
}

test('Design Board exposes Style Guide as an internal child entry', () => {
    const dom = new JSDOM(DESIGNS_HTML);
    const entry = dom.window.document.getElementById('designGuideEntry');
    assert.ok(entry);
    assert.equal(entry.getAttribute('data-page-access'), '/designer');
    assert.equal(entry.querySelector('a')?.getAttribute('href'), '/designer#styleguide');
    assert.match(entry.textContent, /Гайдбук і стайлгайд/);
    assert.match(entry.textContent, /3 SVG шаблони/);
});

test('/designer#styleguide opens the Style Guide tab while /designer keeps catalogs default', () => {
    const styleguide = createDesignerDom('https://crm.test/designer#styleguide').window.document;
    assert.equal(styleguide.querySelector('.designer-tab.active')?.dataset.tab, 'styleguide');
    assert.ok(styleguide.getElementById('tabStyleguide')?.classList.contains('active'));

    const catalogs = createDesignerDom('https://crm.test/designer').window.document;
    assert.equal(catalogs.querySelector('.designer-tab.active')?.dataset.tab, 'catalogs');
    assert.ok(catalogs.getElementById('tabCatalogs')?.classList.contains('active'));
});

test('Designer tab clicks update hashes and unknown hashes fall back safely', () => {
    const dom = createDesignerDom('https://crm.test/designer#unknown');
    assert.equal(dom.window.document.querySelector('.designer-tab.active')?.dataset.tab, 'catalogs');

    dom.window.document.querySelector('[data-tab="brand"]').click();
    assert.equal(dom.window.location.hash, '#brand');
    assert.equal(dom.window.document.querySelector('.designer-tab.active')?.dataset.tab, 'brand');

    dom.window.document.querySelector('[data-tab="catalogs"]').click();
    assert.equal(dom.window.location.hash, '');
    assert.equal(dom.window.document.querySelector('.designer-tab.active')?.dataset.tab, 'catalogs');
});

test('Designer tabs support keyboard navigation and hidden panel states', () => {
    const dom = createDesignerDom('https://crm.test/designer#guideline');
    const document = dom.window.document;
    const activeTab = document.querySelector('[data-tab="guideline"]');
    assert.equal(activeTab?.getAttribute('aria-selected'), 'true');
    assert.equal(document.getElementById('tabGuideline')?.hidden, false);
    assert.equal(document.getElementById('tabBrand')?.hidden, true);

    activeTab.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(document.querySelector('.designer-tab.active')?.dataset.tab, 'brand');
    assert.equal(dom.window.location.hash, '#brand');
    assert.equal(document.getElementById('tabGuideline')?.hidden, true);
    assert.equal(document.getElementById('tabBrand')?.hidden, false);
});

test('Design Board theme CSS does not apply light catalog overrides in dark mode', () => {
    assert.doesNotMatch(DESIGNS_HTML, /body:not\(\.dark-mode\)/);
    assert.doesNotMatch(DESIGNS_CSS, /body:not\(\.dark-mode\)/);
    assert.match(DESIGNS_HTML, /html\[data-theme="light"\] body \.img-picker-modal/);
    assert.match(DESIGNS_CSS, /html\[data-theme="dark"\] \.design-guide-entry/);
});

test('Style Guide local styles follow the document theme contract', () => {
    assert.match(DESIGNER_HTML, /css\/designer-guidebook\.css\?v=0\.81\.153/);
    assert.match(DESIGNER_CSS, /html\[data-theme="dark"\] \.designer-page/);
    assert.match(DESIGNER_CSS, /--dg-active-text:#A7F3D0/);
    assert.match(DESIGNER_CSS, /designer-tab:focus-visible/);
    assert.match(DESIGNER_HTML, /<h3>Inter<\/h3>/);
    assert.doesNotMatch(DESIGNER_HTML, /Основний шрифт CRM\. Ваги/);
});

test('Guidebook exposes real downloadable demo templates and copy actions', () => {
    const templateSources = [
        'images/brand/guidebook/templates/event-genix-post-template.svg',
        'images/brand/guidebook/templates/event-genix-stories-template.svg',
        'images/brand/guidebook/templates/event-genix-cover-template.svg'
    ];
    for (const source of templateSources) {
        assert.match(DESIGNER_HTML, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.ok(fs.existsSync(path.join(ROOT, source)), `${source} must exist`);
    }
    assert.equal((DESIGNER_HTML.match(/class="template-download"/g) || []).length, 3);
    assert.match(DESIGNER_HTML, /data-guide-copy="#17324D"/);
    assert.match(DESIGNER_HTML, /async function copyGuideText/);
    assert.match(DESIGNER_HTML, /Копіювання недоступне/);
});
