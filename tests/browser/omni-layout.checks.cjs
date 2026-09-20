'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VIEWPORTS = [[1366,768],[1024,600],[390,844],[320,640],[390,420]];
const LONG_DRAFT = [
  'Довга чернетка перевіряє доступність поля відповіді.',
  'Другий рядок має лишатися доступним після зміни режиму.',
  'Третій рядок перевіряє внутрішню прокрутку короткого viewport.',
  'Четвертий рядок не повинен витісняти кнопку відправлення.'
].join('\n');

async function waitForLayout(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function collectLayout(page, width, height, label) {
  return page.evaluate(({ width, height, label }) => {
    const element = selector => document.querySelector(selector);
    const box = selector => element(selector)?.getBoundingClientRect().toJSON() || null;
    const fullyInside = (inner, outer, tolerance = 1) => Boolean(inner && outer
      && inner.left >= outer.left - tolerance && inner.right <= outer.right + tolerance
      && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance);
    const centerHit = selector => {
      const target = element(selector);
      const rect = target?.getBoundingClientRect();
      if (!target || !rect || rect.width < 1 || rect.height < 1) return false;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(hit && (hit === target || target.contains(hit)));
    };
    const messages = element('#omniMessages');
    const input = element('#omniInput');
    const send = element('#omniSendBtn');
    const name = element('#omniChatName');
    const list = element('#omniConvList');
    const listRect = list?.getBoundingClientRect();
    const rows = Array.from(list?.querySelectorAll('.omni-conv-item') || []);
    const completeRows = rows.filter(row => fullyInside(row.getBoundingClientRect(), listRect)).length;
    const latest = messages?.querySelector('.omni-msg:last-child');
    const latestRect = latest?.getBoundingClientRect().toJSON() || null;
    const messagesRect = messages?.getBoundingClientRect().toJSON() || null;
    const nameStyle = name ? getComputedStyle(name) : null;
    const inputStyle = input ? getComputedStyle(input) : null;
    const longMessage = messages?.querySelector('.omni-msg:last-child .omni-msg-content');
    const longMessageStyle = longMessage ? getComputedStyle(longMessage) : null;
    return {
      label, width, height,
      viewport: { width: innerWidth, height: innerHeight },
      page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      shell: box('.omni-workspace-shell'), container: box('#omniContainer'),
      sidebar: box('.omni-sidebar'), list: box('#omniConvList'), firstRow: box('.omni-conv-item'),
      completeRows, chat: box('.omni-chat'), header: box('#omniChatHeader'),
      name: box('#omniChatName'), messages: messagesRect, inputArea: box('#omniInputArea'),
      input: box('#omniInput'), send: box('#omniSendBtn'), latest: latestRect,
      nameWhiteSpace: nameStyle?.whiteSpace || '',
      nameClientHeight: name?.clientHeight || 0, nameScrollHeight: name?.scrollHeight || 0,
      historyClientHeight: messages?.clientHeight || 0, historyScrollHeight: messages?.scrollHeight || 0,
      historyScrollTop: messages?.scrollTop || 0,
      visibleMessages: Array.from(messages?.querySelectorAll('.omni-msg') || [])
        .filter(message => fullyInside(message.getBoundingClientRect(), messagesRect)).length,
      maximumVisibleMessageHeight: Math.max(0, ...Array.from(messages?.querySelectorAll('.omni-msg') || []).map(message => {
        const rect = message.getBoundingClientRect();
        return Math.max(0, Math.min(rect.bottom, messagesRect?.bottom || 0) - Math.max(rect.top, messagesRect?.top || 0));
      })),
      latestVisible: fullyInside(latestRect, messagesRect, 2),
      latestBottomVisible: Boolean(latestRect && messagesRect
        && latestRect.bottom <= messagesRect.bottom + 2 && latestRect.bottom >= messagesRect.top),
      inputClientHeight: input?.clientHeight || 0, inputScrollHeight: input?.scrollHeight || 0,
      inputOverflowY: inputStyle?.overflowY || '', inputHit: centerHit('#omniInput'),
      sendHit: centerHit('#omniSendBtn'), sendDisabled: Boolean(send?.disabled),
      longMessageWrap: longMessageStyle?.whiteSpace || '',
      longMessageFits: !longMessage || longMessage.scrollWidth <= longMessage.clientWidth + 1,
      workspaceNarrow: element('.omni-workspace-shell')?.classList.contains('omni-narrow') || false,
      workspaceShort: element('.omni-workspace-shell')?.classList.contains('omni-short') || false,
      mobileBackVisible: Boolean(element('#omniMobileBack')?.offsetParent),
      moreSummaryVisible: Boolean(element('#omniChatMore > summary')?.offsetParent),
      directCloseVisible: Boolean(element('#omniCloseConv')?.offsetParent),
      attachmentVisible: Boolean(element('[data-omni-attachment]')?.offsetParent),
      deliveryErrorVisible: Boolean(element('.omni-send-state.error')?.offsetParent)
    };
  }, { width, height, label });
}

function layoutFailures(result) {
  const failures = [];
  const fail = (condition, message) => { if (!condition) failures.push(`${result.label}: ${message}`); };
  const viewport = { left: 0, top: 0, right: result.viewport.width, bottom: result.viewport.height };
  const fullyInside = (inner, outer, tolerance = 1) => Boolean(inner && outer
    && inner.left >= outer.left - tolerance && inner.right <= outer.right + tolerance
    && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance);
  const shortViewport = result.height <= 480;
  const minimumHistory = shortViewport ? 60 : 120;

  fail(result.page.width <= result.viewport.width + 1, 'horizontal page overflow');
  fail(result.name && result.name.width >= 100, 'conversation name crushed');
  fail(result.nameWhiteSpace === 'nowrap' && result.nameScrollHeight <= result.nameClientHeight + 2,
    'conversation name wrapped vertically');
  fail(result.header && result.header.height <= Math.min(170, result.viewport.height * 0.38),
    'conversation header consumes the history');
  fail(result.messages && result.messages.height >= minimumHistory,
    `message history is not usable (${Math.round(result.messages?.height || 0)}px)`);
  fail(result.historyScrollHeight > result.historyClientHeight + 1, 'message history does not scroll independently');
  fail(shortViewport ? result.maximumVisibleMessageHeight >= 48 : result.visibleMessages >= 1,
    shortViewport ? 'less than a readable message segment is visible' : 'no complete message is visible');
  fail(shortViewport ? result.latestBottomVisible : result.latestVisible,
    'latest message is not reachable at the bottom');
  fail(fullyInside(result.input, viewport), 'composer input outside viewport');
  fail(fullyInside(result.send, viewport), 'send control outside viewport');
  fail(fullyInside(result.input, result.chat) && fullyInside(result.send, result.chat), 'composer escaped the conversation panel');
  fail(result.inputHit, 'composer input is covered by another element');
  fail(result.sendHit, 'send control is covered by another element');
  fail(!result.sendDisabled, 'send control unexpectedly disabled for connected fixture channel');
  fail(result.inputScrollHeight <= result.inputClientHeight + 2 || ['auto','scroll'].includes(result.inputOverflowY),
    'long draft is clipped without internal scrolling');
  fail(result.longMessageWrap === 'pre-wrap' && result.longMessageFits, 'long message does not wrap inside its bubble');
  fail(result.attachmentVisible, 'attachment action is not visible in the history');
  fail(result.deliveryErrorVisible, 'delivery error is not visible beside its message');
  if (result.label === '1024x600') {
    fail(result.completeRows >= 4, `only ${result.completeRows} complete conversation rows are visible`);
  }
  return failures;
}

function assertHealthyLayout(result) {
  const failures = layoutFailures(result);
  assert.deepEqual(failures, [], failures.join('\n'));
}

async function setViewportForElementWidth(page, selector, targetWidth, height) {
  let viewportWidth = Math.max(800, Math.round(targetWidth + 320));
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.setViewportSize({ width: viewportWidth, height });
    await waitForLayout(page);
    const actual = await page.locator(selector).evaluate(node => node.getBoundingClientRect().width);
    const difference = targetWidth - actual;
    if (Math.abs(difference) <= 1) return { viewportWidth, actual };
    viewportWidth = Math.max(760, Math.round(viewportWidth + difference));
  }
  return { viewportWidth, actual: await page.locator(selector).evaluate(node => node.getBoundingClientRect().width) };
}

async function expectFixtureRequest(page) {
  await page.waitForFunction(async () => (await window.__omniFixtureConversationState()).pending > 0);
}

async function testListStates(page) {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto(page.url().split('?')[0] + '?businessContext=event_genix', { waitUntil: 'domcontentloaded' });
  await page.locator('.omni-conv-item').first().waitFor();

  const channels = await page.locator('.omni-channel-dot').evaluateAll(nodes =>
    Array.from(new Set(nodes.map(node => node.getAttribute('aria-label')))));
  assert.ok(channels.length >= 6, `expected six fixture channels, got ${channels.join(', ')}`);

  await page.locator('#omniStatusFilters > summary').click();
  const popover = page.locator('#omniStatusFilters .omni-filter-popover');
  await popover.waitFor({ state: 'visible' });
  const popoverBox = await popover.boundingBox();
  assert.ok(popoverBox && popoverBox.x + popoverBox.width <= 1025 && popoverBox.y + popoverBox.height <= 601,
    `filter popover outside viewport: ${JSON.stringify(popoverBox)}`);
  await page.locator('#omniStatusSelect').selectOption('spam');
  await page.getByText('Розмов за цим зрізом немає', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Очистити', exact: true }).first().click();
  await page.locator('.omni-conv-item').first().waitFor();

  await page.evaluate(() => window.__omniFixtureSetConversationMode('error'));
  await page.locator('#omniSearch').fill('помилка');
  await page.getByText('Тестова помилка завантаження розмов', { exact: false }).waitFor();
  const retry = page.locator('[data-omni-conversations-retry]');
  assert.ok(await retry.isVisible(), 'error retry action is missing');
  await page.evaluate(() => window.__omniFixtureSetConversationMode('normal'));
  await retry.click();
  await page.getByText('Розмов за цим зрізом немає', { exact: true }).waitFor();

  await page.evaluate(() => window.__omniFixtureSetConversationMode('loading'));
  await page.locator('#omniSearch').fill('затримка');
  await expectFixtureRequest(page);
  assert.ok(await page.locator('#omniSearch').isEditable(), 'search became inaccessible while loading');
  assert.ok(await page.locator('[data-omni-view-filter="all"]').isEnabled(), 'view filters became inaccessible while loading');
  await page.evaluate(() => window.__omniFixtureSetConversationMode('normal'));
  await page.getByText('Розмов за цим зрізом немає', { exact: true }).waitFor();

  await page.locator('#omniClearSearch').click();
  await page.locator('.omni-conv-item').first().waitFor();
  await page.evaluate(() => window.__omniFixtureSetConversationMode('empty'));
  await page.evaluate(() => window.__omniFixtureRefresh());
  await page.getByText('Розмов ще немає', { exact: true }).waitFor();
  await page.evaluate(() => window.__omniFixtureSetConversationMode('normal'));
  await page.evaluate(() => window.__omniFixtureRefresh());
  await page.locator('.omni-conv-item').first().waitFor();

  await page.locator('#omniChannelSelect').selectOption('viber');
  await page.locator('.omni-channel-dot--viber').first().waitFor();
  assert.equal(await page.locator('.omni-conv-item:not(:has(.omni-channel-dot--viber))').count(), 0,
    'channel filter returned a different messenger');
  await page.locator('.omni-conv-item').first().click();
  await page.locator('#omniChatChannel [aria-label="Канал: Viber Bot API"]').waitFor();
  assert.ok(await page.locator('#omniInput').isDisabled(), 'disconnected channel incorrectly allows sending');
  assert.ok(await page.locator('#omniSendTruth').isVisible(), 'unavailable-channel reason is hidden');

  await page.locator('#omniChannelSelect').selectOption('telegram');
  await page.locator('.omni-conv-item[data-id="9001"]').waitFor();
  await page.evaluate(() => window.__omniFixtureUpdateConversation({ id: 9001,
    lastMessage: 'Оновлення розмови з WebSocket-подібного refresh' }));
  await page.evaluate(() => window.__omniFixtureRefresh());
  await page.getByText('Оновлення розмови з WebSocket-подібного refresh', { exact: true }).waitFor();
}

async function testPrimaryFlow(page, artifacts) {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.locator('#omniSearch').fill('діалог');
  await page.locator('.omni-conv-item[data-id="9001"]').waitFor();
  await page.locator('.omni-conv-item[data-id="9001"]').click();
  await page.locator('#omniInput').fill(LONG_DRAFT);
  await page.locator('#omniMessages .omni-msg:last-child').waitFor();
  await page.locator('#omniMessages').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await waitForLayout(page);

  const initialListPosition = await page.locator('#omniConvList').evaluate(node => node.scrollTop);
  await page.getByRole('tab', { name: 'Канали', exact: true }).click();
  await page.locator('#omniChannelsWorkspace').waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: 'Стан', exact: true }).click();
  await page.locator('#omniHealthWorkspace').waitFor({ state: 'visible' });
  await page.locator('#omniModeBack').click();
  await waitForLayout(page);
  assert.ok(await page.locator('#omniInput').isVisible(),
    `conversation hidden after mode return: ${JSON.stringify(await page.evaluate(() => window.__omniFixtureDebug()))}`);
  assert.equal(await page.locator('#omniInput').inputValue(), LONG_DRAFT,
    `draft state before resize: ${JSON.stringify(await page.evaluate(() => window.__omniFixtureDebug()))}`);
  assert.equal(await page.locator('#omniChannelSelect').inputValue(), 'telegram');
  assert.equal(await page.locator('#omniSearch').inputValue(), 'діалог');
  assert.ok(await page.locator('#omniMessages').evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop < 3),
    'mode switch lost the latest message');

  const channelStatus = page.locator('#omniAccountsAlarm summary');
  await channelStatus.click();
  await page.locator('#omniAccountsAlarm details[open]').waitFor();
  await page.evaluate(() => window.__omniFixtureRefreshAccounts());
  await page.locator('#omniAccountsAlarm details[open]').waitFor();
  assert.ok(await page.locator('#omniAccountsAlarm .omni-channel-popover').isVisible(),
    'channel details closed during the background refresh');
  await page.keyboard.press('Escape');
  await page.locator('#omniAccountsAlarm details:not([open])').waitFor();
  assert.equal(await channelStatus.evaluate(node => document.activeElement === node), true,
    'closing channel details did not restore focus to its summary');

  await page.setViewportSize({ width: 320, height: 640 });
  await waitForLayout(page);
  assert.equal(await page.locator('#omniInput').inputValue(), LONG_DRAFT,
    `draft state after resize: ${JSON.stringify(await page.evaluate(() => window.__omniFixtureDebug()))}`);
  assert.ok(await page.locator('#omniInput').evaluate(node =>
    node.scrollHeight <= node.clientHeight + 2 || ['auto','scroll'].includes(getComputedStyle(node).overflowY)),
  'resized long draft is clipped');
  await page.locator('#omniMobileBack').click();
  await page.locator('.omni-sidebar').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#omniChannelSelect').inputValue(), 'telegram');
  assert.equal(await page.locator('#omniSearch').inputValue(), 'діалог');
  assert.ok(Math.abs(await page.locator('#omniConvList').evaluate(node => node.scrollTop) - initialListPosition) < 2,
    'list position changed after returning from the conversation');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), '9001', 'conversation row did not regain focus');
  await page.locator('.omni-conv-item[data-id="9001"]').click();
  assert.equal(await page.locator('#omniInput').inputValue(), LONG_DRAFT);

  await page.setViewportSize({ width: 1024, height: 600 });
  await waitForLayout(page);
  await page.locator('#omniMessages').evaluate(node => { node.scrollTop = Math.max(1, node.scrollHeight / 2); });
  await waitForLayout(page);
  const readingPosition = await page.locator('#omniMessages').evaluate(node => node.scrollTop);
  assert.ok(readingPosition > 0, 'history did not move to an arbitrary reading position');
  await page.getByRole('tab', { name: 'Канали', exact: true }).click();
  await page.locator('#omniModeBack').click();
  await page.locator('#omniInput').waitFor({ state: 'visible' });
  assert.ok(Math.abs(await page.locator('#omniMessages').evaluate(node => node.scrollTop) - readingPosition) < 3,
    'mode switch lost the arbitrary reading position');
  assert.equal(await page.locator('#omniInput').inputValue(), LONG_DRAFT);
  await page.screenshot({ path: path.join(artifacts, 'layout-primary-flow.png'), animations: 'disabled' });
}

async function testResponsiveMatrix(page, artifacts) {
  const start = new URL(page.url());
  start.searchParams.delete('channel');
  start.searchParams.delete('search');
  start.searchParams.delete('conversation');
  start.searchParams.delete('conversationId');
  const results = [];
  for (const [width, height] of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await page.goto(start.href, { waitUntil: 'domcontentloaded' });
    await page.locator('.omni-conv-item[data-id="9001"]').waitFor();
    await waitForLayout(page);
    const listCompleteRows = await page.locator('#omniConvList').evaluate(list => {
      const bounds = list.getBoundingClientRect();
      return Array.from(list.querySelectorAll('.omni-conv-item')).filter(row => {
        const rect = row.getBoundingClientRect();
        return rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
      }).length;
    });
    await page.screenshot({ path: path.join(artifacts, `layout-list-${width}x${height}.png`), animations: 'disabled' });
    await page.locator('.omni-conv-item[data-id="9001"]').click();
    await page.locator('#omniInput').fill(LONG_DRAFT);
    await page.locator('#omniMessages .omni-msg:last-child').waitFor();
    await page.locator('#omniMessages').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await waitForLayout(page);
    const result = await collectLayout(page, width, height, `${width}x${height}`);
    result.completeRows = listCompleteRows;
    results.push(result);
    await page.screenshot({ path: path.join(artifacts, `layout-chat-${width}x${height}.png`), animations: 'disabled' });
    fs.writeFileSync(path.join(artifacts, 'layout-metrics.json'), JSON.stringify(results, null, 2));
    assertHealthyLayout(result);
    const more = page.locator('#omniChatMore > summary');
    if (await more.isVisible()) {
      await more.click();
      const close = page.locator('#omniCloseConv');
      await close.waitFor({ state: 'visible' });
      assert.ok(await close.isEnabled(), 'secondary actions are inaccessible');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#omniChatMore').getAttribute('open'), null);
    }
  }
  return results;
}

async function testBreakpointEdges(page) {
  const start = new URL(page.url());
  start.searchParams.set('channel', 'telegram');
  start.searchParams.delete('conversation');
  start.searchParams.delete('conversationId');
  await page.goto(start.href, { waitUntil: 'domcontentloaded' });
  await page.locator('.omni-conv-item[data-id="9001"]').waitFor();
  const workspaceBelow = await setViewportForElementWidth(page, '.omni-workspace-shell', 718, 700);
  await page.locator('.omni-conv-item[data-id="9001"]').click();
  await waitForLayout(page);
  assert.ok(workspaceBelow.actual <= 719, `workspace below breakpoint measured ${workspaceBelow.actual}`);
  assert.ok(await page.locator('.omni-workspace-shell').evaluate(node => node.classList.contains('omni-narrow')));
  assert.ok(await page.locator('#omniMobileBack').isVisible());
  await page.locator('#omniMobileBack').click();
  const workspaceAbove = await setViewportForElementWidth(page, '.omni-workspace-shell', 722, 700);
  await page.locator('.omni-conv-item[data-id="9001"]').click();
  await waitForLayout(page);
  assert.ok(workspaceAbove.actual > 719, `workspace above breakpoint measured ${workspaceAbove.actual}`);
  assert.equal(await page.locator('.omni-workspace-shell').evaluate(node => node.classList.contains('omni-narrow')), false);
  const chatBelow = await setViewportForElementWidth(page, '.omni-chat', 658, 700);
  assert.ok(chatBelow.actual < 660, `chat below breakpoint measured ${chatBelow.actual}`);
  assert.ok(await page.locator('#omniChatMore > summary').isVisible());
  const chatAbove = await setViewportForElementWidth(page, '.omni-chat', 662, 700);
  assert.ok(chatAbove.actual >= 660, `chat above breakpoint measured ${chatAbove.actual}`);
  assert.equal(await page.locator('#omniChatMore > summary').isVisible(), false);
  assert.ok(await page.locator('#omniCloseConv').isVisible());
  return { workspaceBelow, workspaceAbove, chatBelow, chatAbove };
}

async function testMobileNavigation(page) {
  for (const width of [390,320]) {
    await page.setViewportSize({ width, height: 844 });
    await waitForLayout(page);
    if (await page.locator('#omniContainer').getAttribute('data-mobile-view') === 'conversation') {
      await page.locator('#omniMobileBack').click();
    }
    await page.locator('.omni-sidebar').waitFor({ state: 'visible' });
    await page.locator('#sidebarToggle').click();
    await page.locator('#sidebarNav').waitFor({ state: 'visible' });
    assert.ok(await page.locator('#sidebarNav').evaluate(node => node.classList.contains('open')));
    await page.locator('#sidebarOverlay').click({ position: { x: width - 10, y: 200 } });
    assert.equal(await page.locator('#sidebarNav').evaluate(node => node.classList.contains('open')), false);
    await page.locator('#omniConvList').evaluate(node => { node.scrollTop = Math.min(350, node.scrollHeight); });
    await waitForLayout(page);
    const listState = await page.locator('#omniConvList').evaluate(node => ({
      scrollTop: node.scrollTop,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      rows: node.querySelectorAll('.omni-conv-item').length,
      display: getComputedStyle(node).display,
      sidebar: node.closest('.omni-sidebar')?.getBoundingClientRect().toJSON(),
      container: document.querySelector('#omniContainer')?.getBoundingClientRect().toJSON(),
      shell: document.querySelector('.omni-workspace-shell')?.getBoundingClientRect().toJSON(),
      mode: document.querySelector('#omniContainer')?.dataset.omniMode,
      mobileView: document.querySelector('#omniContainer')?.dataset.mobileView
    }));
    const scrollTop = listState.scrollTop;
    assert.ok(scrollTop > 0, `conversation list does not scroll independently at ${width}px: ${JSON.stringify(listState)}`);
    const rowId = await page.locator('#omniConvList').evaluate(list => {
      const bounds = list.getBoundingClientRect();
      return Array.from(list.querySelectorAll('.omni-conv-item')).find(row => {
        const rect = row.getBoundingClientRect();
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      })?.dataset.id;
    });
    assert.ok(rowId, 'no complete conversation row is available after scrolling');
    await page.locator(`.omni-conv-item[data-id="${rowId}"]`).click();
    await page.locator('#omniInput').fill(`Мобільна чернетка ${width}`);
    await page.locator('#omniMobileBack').click();
    assert.ok(Math.abs(await page.locator('#omniConvList').evaluate(node => node.scrollTop) - scrollTop) < 2,
      'mobile back lost list position');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.id), rowId, 'mobile back lost row focus');
    await page.locator(`.omni-conv-item[data-id="${rowId}"]`).click();
    assert.equal(await page.locator('#omniInput').inputValue(), `Мобільна чернетка ${width}`);
    await page.locator('#omniMobileBack').click();
  }
}

async function testIntentionalFaults(page, artifacts) {
  await page.setViewportSize({ width: 1024, height: 600 });
  if (await page.locator('.omni-sidebar').isVisible()) await page.locator('.omni-conv-item[data-id="9001"]').click();
  await page.locator('#omniInput').fill(LONG_DRAFT);
  await page.locator('#omniMessages .omni-msg:last-child').waitFor();
  await page.locator('#omniMessages').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await waitForLayout(page);
  assertHealthyLayout(await collectLayout(page, 1024, 600, 'fault-baseline'));

  const nameFault = await page.addStyleTag({ content: '#omniChatName{width:12px!important;white-space:normal!important;overflow:visible!important}' });
  await waitForLayout(page);
  const nameFailures = layoutFailures(await collectLayout(page, 1024, 600, 'intentional-name-fault'));
  assert.ok(nameFailures.some(message => /name (?:crushed|wrapped)/.test(message)),
    `name fault was not detected: ${nameFailures.join('; ')}`);
  await page.screenshot({ path: path.join(artifacts, 'intentional-fault-name-detected.png'), animations: 'disabled' });
  await nameFault.evaluate(node => node.remove());
  await waitForLayout(page);
  assertHealthyLayout(await collectLayout(page, 1024, 600, 'name-fault-recovered'));

  const composerFault = await page.addStyleTag({ content: '#omniInputArea{transform:translateY(900px)!important}' });
  await waitForLayout(page);
  const composerFailures = layoutFailures(await collectLayout(page, 1024, 600, 'intentional-composer-fault'));
  assert.ok(composerFailures.some(message => /composer .*outside|composer escaped/.test(message)),
    `composer fault was not detected: ${composerFailures.join('; ')}`);
  await page.screenshot({ path: path.join(artifacts, 'intentional-fault-composer-detected.png'), animations: 'disabled' });
  await composerFault.evaluate(node => node.remove());
  await waitForLayout(page);
  assertHealthyLayout(await collectLayout(page, 1024, 600, 'composer-fault-recovered'));
  return { nameFaultDetected: true, composerFaultDetected: true };
}

module.exports = async function checkLayout(page, artifacts) {
  await testListStates(page);
  await testPrimaryFlow(page, artifacts);
  const matrix = await testResponsiveMatrix(page, artifacts);
  const breakpoints = await testBreakpointEdges(page);
  await testMobileNavigation(page);
  const faultInjection = await testIntentionalFaults(page, artifacts);
  const summary = {
    layoutInteractions:true, javascript:true, realClicks:true,
    channels:['telegram','viber','sms','facebook','instagram','whatsapp'],
    filters:true, loadingEmptyError:true, attachments:true, deliveryErrors:true,
    conversationRefresh:true, navigation:true, drafts:true,
    historyAndListScroll:true, focusRestoration:true,
    breakpointEdges:breakpoints, faultInjection,
    viewports:matrix.map(result => [result.width,result.height]),
    browserZoom:'not measured', realWrites:0
  };
  console.log(JSON.stringify(summary));
  return summary;
};
