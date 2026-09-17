'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

module.exports = async function checkLayout(page, artifacts) {
  const results = [];
  const start = new URL(page.url());
  start.searchParams.delete('conversation');
  start.searchParams.delete('conversationId');
  for (const [width, height] of [[1440,900],[1366,768],[1180,700],[1024,600],[390,844],[320,640],[390,420]]) {
    await page.setViewportSize({width,height});
    await page.goto(start.href, {waitUntil:'domcontentloaded'});
    await page.locator('.omni-conv-item').first().waitFor();
    await page.waitForTimeout(300);
    const list = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {list:box('#omniConvList'),row:box('.omni-conv-item'),shell:box('.omni-workspace-shell'),width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight};
    });
    await page.screenshot({path:path.join(artifacts,`layout-list-${width}x${height}.png`)});
    await page.locator('.omni-conv-item').first().click();
    await page.locator('#omniInput').waitFor({state:'visible'});
    await page.waitForTimeout(200);
    const chat = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {name:box('#omniChatName'),header:box('#omniChatHeader'),messages:box('#omniMessages'),input:box('#omniInput'),send:box('#omniSendBtn'),width:document.documentElement.scrollWidth};
    });
    await page.screenshot({path:path.join(artifacts,`layout-chat-${width}x${height}.png`)});
    results.push({width,height,list,chat});
    await page.locator('#omniChatMore > summary').isVisible().then(async visible => {
      if (!visible) return;
      await page.locator('#omniChatMore > summary').click();
      assert.ok(await page.locator('#omniCloseConv').isVisible(), 'secondary actions inaccessible');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#omniChatMore').getAttribute('open'), null);
    });
  }
  fs.writeFileSync(path.join(artifacts,'layout-metrics.json'),JSON.stringify(results,null,2));
  const failures = [];
  for (const r of results) {
    const check = (ok, message) => {if (!ok) failures.push(`${r.width}x${r.height}: ${message}`);};
    check(r.chat.name.width >= 100,'name crushed');
    check(r.chat.header.height <= 165,'header consumes history');
    check(r.chat.messages.height >= 64,'history collapsed');
    check(r.chat.input.y >= 0 && r.chat.input.bottom <= r.height+1,'composer outside viewport');
    check(r.chat.send.right <= r.width+1,'send outside viewport');
    check(r.list.width <= r.width+1 && r.chat.width <= r.width+1,'horizontal overflow');
    if (r.width===1024) check(r.list.list.height >= 4*r.list.row.height,'fewer than four conversation rows');
  }
  console.log(JSON.stringify({layout:results.map(r=>({width:r.width,height:r.height,nameWidth:r.chat.name.width,headerHeight:r.chat.header.height,historyHeight:r.chat.messages.height,listRows:r.list.list.height/r.list.row.height})),failures}));
  assert.deepEqual(failures,[]);

  await page.setViewportSize({width:1024,height:600});
  await page.goto(start.href,{waitUntil:'domcontentloaded'});
  await page.locator('.omni-conv-item').first().waitFor();
  await page.locator('#omniStatusFilters > summary').click();
  await page.locator('#omniStatusSelect').selectOption('spam');
  await page.waitForFunction(()=>!document.querySelector('.omni-conv-item'));
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Очистити',exact:true}).first().click();
  await page.locator('.omni-conv-item').first().waitFor();
  await page.locator('#omniChannelSelect').selectOption('telegram');
  await page.locator('#omniSearch').fill('Тестовий');
  await page.waitForFunction(()=>!document.querySelector('.omni-conv-item[data-id="9001"]'));
  await page.locator('#omniClearSearch').click();
  await page.locator('.omni-conv-item[data-id="9001"]').waitFor();
  const desktopCollapseAvailable = await page.locator('#sidebarCollapseBtn').count() > 0;
  if (desktopCollapseAvailable) await page.locator('#sidebarCollapseBtn').click();
  await page.mouse.move(750,200);
  await page.waitForTimeout(350);
  await page.locator('.omni-conv-item').first().click();
  await page.locator('#omniInput').fill('Чернетка зі збереженням стану');
  await page.locator('#omniMessages').hover();
  await page.mouse.wheel(0,100000);
  await page.waitForTimeout(100);
  await page.screenshot({path:path.join(artifacts,'layout-desktop-navigation.png')});
  await page.getByRole('tab',{name:'Канали',exact:true}).click();
  assert.ok(await page.locator('#omniChannelsWorkspace').isVisible());
  await page.getByRole('tab',{name:'Стан',exact:true}).click();
  assert.ok(await page.locator('#omniHealthWorkspace').isVisible());
  await page.locator('#omniModeBack').click();
  await page.waitForTimeout(100);
  assert.ok(await page.locator('#omniMessages').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<2),'channel mode lost latest message');
  assert.equal(await page.locator('#omniInput').inputValue(),'Чернетка зі збереженням стану');
  await page.setViewportSize({width:320,height:640});
  await page.waitForTimeout(100);
  assert.ok(await page.locator('#omniInput').evaluate(el=>el.scrollHeight<=el.clientHeight+2),'resized draft is clipped');
  assert.ok(await page.locator('#omniMessages').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<2),'resize lost latest message');
  await page.setViewportSize({width:1024,height:600});
  await page.waitForTimeout(100);
  await page.locator('#omniMessages').hover();
  await page.mouse.wheel(0,-250);
  await page.waitForTimeout(100);
  const readingTop = await page.locator('#omniMessages').evaluate(el=>el.scrollTop);
  await page.getByRole('tab',{name:'Канали',exact:true}).click();
  await page.locator('#omniModeBack').click();
  await page.waitForTimeout(100);
  assert.ok(Math.abs(await page.locator('#omniMessages').evaluate(el=>el.scrollTop)-readingTop)<2,'channel mode lost reading position');
  await page.locator('#omniAccountsAlarm summary').click();
  await page.evaluate(()=>window.__omniFixtureRefreshAccounts());
  assert.notEqual(await page.locator('#omniAccountsAlarm details').getAttribute('open'),null);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#omniAccountsAlarm details').getAttribute('open'),null);

  for (const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    await page.locator('#omniMobileBack').click();
    await page.locator('#sidebarToggle').click();
    assert.ok(await page.locator('#sidebarNav').evaluate(el=>el.classList.contains('open')));
    await page.locator('#sidebarOverlay').click({position:{x:width-10,y:200}});
    assert.equal(await page.locator('#sidebarNav').evaluate(el=>el.classList.contains('open')),false);
    await page.locator('#omniConvList').hover();
    await page.mouse.wheel(0,350);
    await page.waitForTimeout(150);
    const scroll = await page.locator('#omniConvList').evaluate(el=>el.scrollTop);
    assert.ok(scroll>0,'list does not scroll');
    const rowId = await page.locator('#omniConvList').evaluate(list => {
      const bounds=list.getBoundingClientRect();
      return Array.from(list.querySelectorAll('.omni-conv-item')).find(row=>{
        const rect=row.getBoundingClientRect(); return rect.top>=bounds.top && rect.bottom<=bounds.bottom;
      })?.dataset.id;
    });
    assert.ok(rowId,'no complete conversation row');
    const row = page.locator(`.omni-conv-item[data-id="${rowId}"]`);
    await row.click();
    await page.locator('#omniInput').fill('Мобільна чернетка');
    await page.locator('#omniMobileBack').click();
    await page.waitForTimeout(50);
    assert.ok(Math.abs(await page.locator('#omniConvList').evaluate(el=>el.scrollTop)-scroll)<2,'list position lost');
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset.id),rowId,'back focus lost');
    await row.click();
    assert.equal(await page.locator('#omniInput').inputValue(),'Мобільна чернетка');
    await page.locator('.header-theme-toggle').click();
    await page.waitForTimeout(400);
    console.log(JSON.stringify({theme:await page.evaluate(()=>({root:document.documentElement.className,body:document.body.className,theme:document.documentElement.dataset.theme,tabColor:getComputedStyle(document.querySelector('.omni-mode-btn')).color,font:getComputedStyle(document.querySelector('#omniInput')).fontFamily}))}));
    await page.screenshot({path:path.join(artifacts,`layout-theme-${width}.png`)});
    await page.getByRole('tab',{name:'Канали',exact:true}).click();
    await page.screenshot({path:path.join(artifacts,`layout-channels-${width}.png`)});
    assert.ok(await page.locator('#omniModeBack').isVisible());
    await page.locator('#omniModeBack').click();
    assert.equal(await page.locator('#omniInput').inputValue(),'Мобільна чернетка');
  }
  console.log(JSON.stringify({layoutInteractions:true,filters:true,navigation:true,desktopCollapseAvailable,channelDetails:true,drafts:true,listScrollAndFocus:true,themes:true,browserZoom:'not measured',realWrites:0}));
};
