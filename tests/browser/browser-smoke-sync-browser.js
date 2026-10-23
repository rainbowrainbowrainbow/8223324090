'use strict';
const assert = require('node:assert/strict');
const { requirePlaywright } = require('./hr-checklists-async-browser-smoke');
const { waitForStableLayout } = require('../helpers/browser-smoke-sync');
(async () => {
    const browser = await requirePlaywright().chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<style>#shell{width:100px;height:50px;transition:width .6s ease}#spin{animation:spin 1s infinite}@keyframes spin{to{transform:rotate(360deg)}}</style><div id="shell"><span id="spin">x</span></div>');
        await page.locator('#shell').evaluate(node => { node.getBoundingClientRect(); node.style.width = '300px'; });
        await waitForStableLayout(page, ['#shell']);
        assert.equal(await page.locator('#shell').evaluate(node => node.getBoundingClientRect().width), 300);
        // Deliberate overflow stays observable after the wait; it is not clipped or disabled.
        await page.setViewportSize({ width: 320, height: 700 });
        await page.locator('#shell').evaluate(node => { node.style.width = '600px'; });
        await waitForStableLayout(page, ['#shell']);
        assert.equal(await page.locator('#shell').evaluate(node => node.getBoundingClientRect().width), 600);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
        console.log('Browser smoke synchronization: PASS (finite motion awaited, perpetual animation tolerated, overflow retained).');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
