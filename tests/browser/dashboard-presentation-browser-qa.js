// Run against dashboard-presentation-fixture.js via playwright-cli run-code --filename.
async (page) => {
    const base = 'http://127.0.0.1:4315';
    const results = [];
    const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
    const control = async data => page.request.post(base + '/__qa/control', { data });
    const state = async () => (await page.request.get(base + '/__qa/state')).json();
    const ready = async () => {
        await page.waitForFunction(() => document.querySelector('#dashboardDayOrientation')?.dataset.tone !== 'loading' && document.querySelector('#widget-my_focus'));
        await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
    };
    const order = () => page.locator('#dashboardGrid > [data-widget]').evaluateAll(els => els.map(el => el.dataset.widget));
    const screenshot = name => page.screenshot({ path: `output/playwright/dash05-${name}.png`, fullPage: true, animations: 'disabled' });
    const layout = async label => {
        const metrics = await page.evaluate(() => {
            const cards = [...document.querySelectorAll('#dashboardGrid > [data-widget]')].map(el => ({ name: el.dataset.widget, rect: el.getBoundingClientRect() }));
            const overlaps = cards.flatMap((a, i) => cards.slice(i + 1).filter(b => Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 1 && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 1).map(b => [a.name, b.name]));
            return { width: innerWidth, scroll: document.documentElement.scrollWidth, overlaps,
                clipped: [...document.querySelectorAll('.dashboard-day-orientation, .widget-task-info, .nearest-event-hero, .dashboard-actions')].filter(el => el.scrollWidth > el.clientWidth + 2).map(el => el.className) };
        });
        check(metrics.scroll <= metrics.width + 1 && !metrics.overlaps.length && !metrics.clipped.length, `${label}: no overflow, clipping or card overlap ${JSON.stringify(metrics)}`);
    };
    await page.clock.install({ time: new Date('2026-09-13T10:00:00Z') });
    await control({ reset: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + '/dashboard');
    await ready();
    check((await page.locator('#dashboardDayOrientation').textContent()).includes('2 задачі'), 'Initial event orientation uses preparation count');
    const initialState = await state();
    const widgetRequests = initialState.requests.filter(req => req.url.includes('/dashboard/widgets/'));
    for (const type of initialState.config.widgets) check(widgetRequests.filter(req => req.url.includes('/widgets/' + type + '?')).length === 1, `Cold ${type} hydration issues one request`);
    for (const [name, width, height] of [['desktop', 1440, 1000], ['laptop', 1280, 800], ['tablet', 768, 1024], ['mobile', 390, 844], ['small-mobile', 360, 800]]) {
        await page.setViewportSize({ width, height });
        // Shared sidebar updates its responsive geometry on a debounced resize.
        await page.waitForTimeout(500);
        for (const theme of ['light', 'dark']) {
            await page.evaluate(theme => { document.body.classList.toggle('dark-mode', theme === 'dark'); document.documentElement.dataset.theme = theme; }, theme);
            await layout(name + '-' + theme);
            await screenshot(name + '-' + theme);
        }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { document.body.classList.remove('dark-mode'); document.documentElement.dataset.theme = 'light'; });
    await control({ taskError: true });
    await page.locator('[data-dashboard-task-complete="501"]').click();
    await page.locator('.focus-task-action-error').waitFor();
    check(!(await state()).completed, 'Failed completion leaves task open');
    check((await page.locator('#dashboardDayOrientation').textContent()).includes('2 задачі'), 'Failed completion preserves orientation');
    await screenshot('task-error');
    await control({ taskError: false, slow: true });
    const previousPatches = (await state()).requests.filter(req => req.method === 'PATCH').length;
    await page.locator('[data-dashboard-task-complete="501"]').evaluate(button => { button.click(); button.click(); });
    check(await page.locator('[data-dashboard-task-complete="501"]').isDisabled(), 'Pending action disables repeated activation');
    check(!(await state()).completed, 'No completion before server response');
    await page.waitForFunction(() => document.querySelector('#dashboardDayOrientation').textContent.includes('1 задача'));
    check((await state()).requests.filter(req => req.method === 'PATCH').length === previousPatches + 1, 'Double activation sends exactly one mutation');
    check((await page.locator('#widget-quick_stats .stat-value').nth(1).textContent()).trim() === '0', 'Quick stats updated from server after completion');
    check((await page.locator('#widget-nearest_event').textContent()).includes('1 відкрито · 1 виконано'), 'Nearest event preparation updated from server');
    await control({ slow: false });
    await page.reload(); await ready();
    check((await page.locator('#dashboardDayOrientation').textContent()).includes('1 задача'), 'Completion is consistent after reload');

    const originalOrder = await order();
    await page.locator('[data-widget="funnel"] .widget-drag-handle').focus();
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => document.querySelector('#dashboardLayoutStatus').textContent === 'Порядок збережено');
    const movedOrder = await order();
    check(movedOrder.join() !== originalOrder.join(), 'Keyboard changes widget order');
    await page.reload(); await ready();
    check((await order()).join() === movedOrder.join(), 'Keyboard order survives reload');
    await control({ saveError: true });
    await page.locator('[data-widget="funnel"] .widget-drag-handle').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('#dashboardLayoutStatus').textContent.includes('Попередній порядок відновлено'));
    check((await order()).join() === movedOrder.join(), 'Failed save restores confirmed widget order');
    await control({ saveError: false });

    await page.locator('[data-widget="my_focus"] .widget-drag-handle').scrollIntoViewIfNeeded();
    const source = await page.locator('[data-widget="my_focus"] .widget-drag-handle').boundingBox();
    const target = await page.locator('[data-widget="funnel"]').boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + 55, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('#dashboardGrid').getAttribute('aria-busy') !== 'true');
    const draggedOrder = await order();
    check(draggedOrder.join() !== movedOrder.join(), 'Pointer drag changes widget order');
    await page.reload(); await ready();
    check((await order()).join() === draggedOrder.join(), 'Pointer order survives reload');

    await page.getByRole('button', { name: 'Налаштувати', exact: true }).click();
    await page.locator('#settingsOverlay').waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'settingsWidgetSearch');
    await page.locator('#settingsOverlay').getByRole('button', { name: 'Зберегти', exact: true }).focus();
    await page.keyboard.press('Tab');
    check(await page.locator('#settingsOverlay').evaluate(el => el.contains(document.activeElement)), 'Settings Tab focus remains in the modal');
    await page.locator('#settingsWidgetList [data-widget="weather"] input').uncheck();
    await page.locator('#settingsOverlay').getByRole('button', { name: 'Зберегти', exact: true }).click();
    await page.locator('#settingsOverlay').waitFor({ state: 'detached' });
    await page.reload(); await ready();
    check(!(await order()).includes('weather'), 'Hidden widget remains hidden after reload');
    await page.getByRole('button', { name: 'Додати віджет', exact: true }).click();
    await page.locator('#settingsWidgetList [data-widget="weather"] input').check();
    await page.locator('#settingsOverlay').getByRole('button', { name: 'Зберегти', exact: true }).click();
    await page.locator('#settingsOverlay').waitFor({ state: 'detached' });
    check((await order()).includes('weather'), 'Widget manager restores an explicitly selected widget');

    const stageHref = await page.locator('.dashboard-funnel-stage-chip[href]').first().getAttribute('href');
    check(stageHref === '/sales-funnel?view=kanban&pipeline_stage=negotiation', 'Funnel stage CTA carries the correct stage');
    // Isolate destination navigation from unrelated Leads bootstrap/API requirements.
    await page.route('**/sales-funnel?**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Local navigation boundary</p>' }));
    await page.locator('.dashboard-funnel-stage-chip[href]').first().click();
    check(page.url() === base + stageHref, 'Click navigates to the canonical funnel stage URL');
    await page.goto(base + '/dashboard'); await ready();
    await page.locator('.nearest-event-open').click();
    await page.locator('#bookingSummaryDocument').waitFor({ state: 'visible' });
    check(page.url().includes('/booking-summary.html?id=DASH-QA-42&'), 'Nearest event opens the matching canonical booking summary');
    check((await page.locator('#bookingSummaryDocument').textContent()).includes('Неонове шоу'), 'Canonical summary renders the selected event');
    await screenshot('canonical-event');

    for (const scenario of ['long', 'empty', 'error', 'denied', 'slow']) {
        await control({ reset: true });
        await control(scenario === 'error' ? { error: 'all' } : { [scenario]: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(base + '/dashboard');
        if (scenario === 'slow') {
            await page.locator('#dashboardDayOrientation[data-tone="loading"]').waitFor();
            check((await page.locator('#dashboardDayOrientation').textContent()).includes('Збираю'), 'Slow source exposes loading state');
        }
        await ready();
        await layout(scenario);
        const scenarioRequests = (await state()).requests.filter(req => req.url.includes('/dashboard/widgets/') && !req.url.endsWith('/currency'));
        check(scenarioRequests.length === 5, `${scenario}: one request per widget (${scenarioRequests.length})`);
        if (['error', 'denied'].includes(scenario)) {
            check((await page.locator('#dashboardDayOrientation').textContent()).includes('недоступна'), scenario + ': unavailable data never claims readiness');
            check(await page.locator('.dashboard-day-orientation-action').isEnabled(), scenario + ': retry is available');
        }
        await screenshot(scenario);
    }
    await control({ reset: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(base + '/dashboard'); await ready();
    return { passed: results.length, results };
}
