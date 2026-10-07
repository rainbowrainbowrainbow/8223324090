'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/designs-page.js'), 'utf8');
const start = source.indexOf('function renderDesignGrid()');
const end = source.indexOf('\nfunction esc(', start);
assert.ok(start >= 0 && end > start);

function fixture(t) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'designs.html'), 'utf8'), { runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const context = dom.getInternalVMContext();
    context.designs = [];
    context.activePinFilter = false;
    context.activeTagFilter = null;
    context.reconcileDesignThumbnailUrls = () => {};
    vm.runInContext(source.slice(start, end), context);
    return { context, document: dom.window.document, grid: dom.window.document.getElementById('designGrid') };
}

for (const kind of ['search', 'collection', 'pin', 'tag']) {
    test(`empty design ${kind} filter explains hidden results instead of offering upload`, t => {
        const f = fixture(t);
        if (kind === 'search') f.document.getElementById('searchInput').value = 'Synthetic no match';
        if (kind === 'collection') {
            const select = f.document.getElementById('collectionFilter');
            select.add(new f.document.defaultView.Option('Synthetic collection', 'fixture'));
            select.value = 'fixture';
        }
        if (kind === 'pin') f.context.activePinFilter = true;
        if (kind === 'tag') f.context.activeTagFilter = 'fixture';
        f.context.renderDesignGrid();
        assert.match(f.grid.textContent, /за цими фільтрами не знайдено/);
        assert.doesNotMatch(f.grid.textContent, /Перетягніть файли/);
        assert.equal(f.grid.querySelector('[role="status"]') !== null, true);
    });
}
test('genuinely empty unfiltered design board retains its upload guidance', t => {
    const f = fixture(t);
    f.context.renderDesignGrid();
    assert.match(f.grid.textContent, /Немає дизайнів.*Перетягніть файли/);
});
