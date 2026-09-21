'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async (page, artifactDir) => {
  const results = [];
  for (const [width, height] of [[1366, 768], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height });
    for (const [channel, id] of [['facebook', 9004], ['instagram', 9005]]) {
      await page.reload();
      await page.locator('body.shell-ready #omniContainer').waitFor();
      if (await page.locator('#omniMobileBack').isVisible()) await page.locator('#omniMobileBack').click();
      await page.locator('.omni-conv-item[data-id="' + id + '"]').click();
      const labels = page.locator('.omni-msg-footer .omni-status-label');
      await labels.first().waitFor();
      assert.deepEqual(await labels.allTextContents(), ['Надіслано', 'Доставлено', 'Прочитано', 'Не надіслано', 'Статус невідомий']);
      assert.doesNotMatch(await page.locator('#omniMessages').textContent(), /у v1/);
      const errors = page.locator('.omni-send-error');
      assert.equal(await errors.count(), 2);
      await errors.first().scrollIntoViewIfNeeded();
      assert.equal(await errors.first().isVisible(), true);
      const summary = page.locator('.omni-send-compact summary');
      await summary.click();
      assert.equal(await page.locator('.omni-send-hint').isVisible(), true);
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.omni-send-hint').isVisible(), false);
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.omni-send-hint').isVisible(), true);
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth > innerWidth,
        messages: document.querySelector('#omniMessages').scrollWidth > document.querySelector('#omniMessages').clientWidth + 1
      }));
      assert.deepEqual(overflow, { page: false, messages: false });
      await page.screenshot({ path: path.join(artifactDir, `${channel}-${width}-hint.png`) });
      await summary.click();
      await errors.last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(artifactDir, `${channel}-${width}-errors.png`) });
      results.push({ channel, width, height, statuses: true, pointerAndKeyboardHint: true, errorsVisible: true, overflow: false });
    }
  }
  return { metaMessageStatuses: results };
};
