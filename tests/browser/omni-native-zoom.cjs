'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

// Native tab zoom, not CSS zoom, deviceScaleFactor or pinch emulation.
// https://playwright.dev/docs/chrome-extensions
// https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom
exports.launch = async chromium => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-omni-zoom-'));
  const extension = path.join(temporary, 'extension');
  fs.mkdirSync(extension);
  fs.writeFileSync(path.join(extension,'manifest.json'), JSON.stringify({manifest_version:3,name:'Omni native zoom QA',version:'1.0',permissions:['tabs'],background:{service_worker:'worker.js'}}));
  fs.writeFileSync(path.join(extension,'worker.js'),'chrome.runtime.onInstalled.addListener(() => {});');
  const context = await chromium.launchPersistentContext(path.join(temporary,'profile'), {
    channel:'chromium', headless:true, viewport:null,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--window-size=1366,855']
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  return {
    context,
    async check(page, artifacts) {
      const tab = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t=>t.url.includes('/omni')));
      assert.ok(tab, 'Omni tab unavailable to zoom controller');
      const cdp = await context.newCDPSession(page);
      const {windowId} = await cdp.send('Browser.getWindowForTarget');
      const results=[];
      for (const [width,height] of [[1366,768],[1024,600]]) {
        await worker.evaluate(id=>chrome.tabs.setZoom(id,1),tab.id);
        const frame = await page.evaluate(()=>({width:outerWidth-innerWidth,height:outerHeight-innerHeight}));
        await cdp.send('Browser.setWindowBounds',{windowId,bounds:{width:width+frame.width,height:height+frame.height}});
        await page.waitForTimeout(250);
        if (await page.locator('#omniMobileBack').isVisible()) await page.locator('#omniMobileBack').click();
        await page.locator('.omni-conv-item').first().click();
        await page.locator('#omniInput').fill('Чернетка під час масштабування');
        for (const zoom of [1,1.25,1.5]) {
          await worker.evaluate(({id,zoom})=>chrome.tabs.setZoom(id,zoom),{id:tab.id,zoom});
          await page.waitForTimeout(250);
          const actual = await worker.evaluate(id=>chrome.tabs.getZoom(id),tab.id);
          assert.equal(actual,zoom);
          const metrics = await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scrollWidth:document.documentElement.scrollWidth,input:document.querySelector('#omniInput').getBoundingClientRect().toJSON(),name:document.querySelector('#omniChatName').getBoundingClientRect().toJSON()}));
          assert.ok(Math.abs(metrics.width-width/zoom)<2,'native zoom viewport width mismatch');
          assert.ok(metrics.scrollWidth<=metrics.width+1,'native zoom horizontal overflow');
          assert.ok(metrics.input.top>=0&&metrics.input.bottom<=metrics.height+1,'native zoom composer clipped');
          assert.ok(metrics.name.width>=100,'native zoom identity crushed');
          assert.equal(await page.locator('#omniInput').inputValue(),'Чернетка під час масштабування');
          const more = page.locator('#omniChatMore > summary');
          const compactActions = await more.isVisible();
          let summaryAccess = null;
          if (compactActions) {
            summaryAccess = await more.evaluate(node => {
              const rect = node.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              return {
                inside: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1,
                hit: Boolean(hit && (hit === node || node.contains(hit))),
                rect: rect.toJSON()
              };
            });
            assert.ok(summaryAccess.inside && summaryAccess.hit,
              `native zoom hid the additional-actions trigger: ${JSON.stringify(summaryAccess)}`);
            await more.click();
            await page.locator('#omniChatMore[open]').waitFor();
          }
          const actionAccess = await page.evaluate(() => {
            const viewport = { width: innerWidth, height: innerHeight };
            const ids = ['omniCreateLead', 'omniToggleAI', 'omniCloseConv'];
            const inspect = id => {
              const node = document.getElementById(id);
              const rect = node?.getBoundingClientRect();
              const visible = Boolean(node?.offsetParent && rect && rect.width > 0 && rect.height > 0);
              const inside = Boolean(visible && rect.left >= -1 && rect.right <= viewport.width + 1 && rect.top >= -1 && rect.bottom <= viewport.height + 1);
              const hit = visible ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
              return { id, visible, inside, hit: Boolean(hit && (hit === node || node.contains(hit))), rect: rect?.toJSON() || null };
            };
            return ids.map(inspect);
          });
          assert.ok(actionAccess.every(action => action.visible && action.inside && action.hit),
            `native zoom hid a conversation action: ${JSON.stringify(actionAccess)}`);
          if (compactActions) {
            await page.keyboard.press('Escape');
            await page.locator('#omniChatMore:not([open])').waitFor();
          }
          const screenshot = `native-zoom-${width}-${zoom*100}.png`;
          // Playwright viewport screenshots clip native-zoom rendering in CSS
          // pixels. CDP captures the complete physical browser viewport.
          const capture = await cdp.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
          fs.writeFileSync(path.join(artifacts,screenshot), Buffer.from(capture.data,'base64'));
          results.push({screen:[width,height],zoom:actual,screenshot,actionMode:compactActions?'menu':'direct',summary:summaryAccess,actions:actionAccess,...metrics});
        }
      }
      await worker.evaluate(({ id }) => chrome.tabs.setZoom(id, 2), { id: tab.id });
      const telephonyUrl = new URL(page.url());
      telephonyUrl.searchParams.set('telView', 'all');
      await page.goto(telephonyUrl.href, { waitUntil: 'domcontentloaded' });
      await page.locator('#omniTelephonyWorkspace').waitFor({ state: 'visible' });
      await page.getByText('Тестовий клієнт', { exact: true }).waitFor();
      const telephonyMetrics = await page.evaluate(() => {
        const filters = document.querySelector('.omni-telephony-filters')?.getBoundingClientRect();
        const tabs = document.querySelector('.omni-telephony-tabs')?.getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, filters: filters?.toJSON() || null, tabs: tabs?.toJSON() || null };
      });
      assert.equal(await worker.evaluate(id => chrome.tabs.getZoom(id), tab.id), 2);
      assert.ok(telephonyMetrics.scrollWidth <= telephonyMetrics.width + 1, `telephony has horizontal page overflow at 200%: ${JSON.stringify(telephonyMetrics)}`);
      assert.ok(telephonyMetrics.filters?.width > 0 && telephonyMetrics.tabs?.width > 0, 'telephony controls disappeared at 200% zoom');
      const telephonyScreenshot = 'binotel-telephony-native-zoom-200.png';
      const telephonyCapture = await cdp.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
      fs.writeFileSync(path.join(artifacts,telephonyScreenshot), Buffer.from(telephonyCapture.data,'base64'));
      results.push({ screen: [telephonyMetrics.width, telephonyMetrics.height], zoom: 2, telephony: true, screenshot: telephonyScreenshot, ...telephonyMetrics });
      fs.writeFileSync(path.join(artifacts,'native-zoom.json'),JSON.stringify(results,null,2));
      console.log(JSON.stringify({nativeBrowserZoom:true,results}));
      return results;
    },
    async close() {
      await context.close();
      const resolved = fs.realpathSync(temporary);
      const tempRoot = fs.realpathSync(os.tmpdir()) + path.sep;
      assert.ok(resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('eg-omni-zoom-'));
      fs.rmSync(resolved,{recursive:true,force:true});
    }
  };
};
