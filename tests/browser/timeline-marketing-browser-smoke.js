'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFixture } = require('../helpers/timeline-marketing-fixture');
const { requirePlaywright, routeMockedApi, businessProfilePayload, SMOKE_USER } = require('./timeline-room-summary-browser-smoke');

(async () => {
    const fixture = await createFixture();
    let browser;
    const output = path.join(__dirname, '../../output/playwright');
    fs.mkdirSync(output, { recursive: true });
    const errors = [];
    const diagnostics = [];
    let context;
    let page;
    try {
        browser = await requirePlaywright().chromium.launch({
            headless: true,
            ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
            ...(process.env.EVENTGENIX_BROWSER_CHANNEL ? { channel: process.env.EVENTGENIX_BROWSER_CHANNEL } : {})
        });
        context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
        await context.addInitScript(user => {
            localStorage.setItem('pzp_token', 'fixture');
            localStorage.setItem('pzp_access_token', 'fixture');
            localStorage.setItem('pzp_current_user', JSON.stringify(user));
            localStorage.setItem('pzp_crm_business_context', 'event_genix');
            localStorage.setItem('pzp_crm_business_context_user', String(user.id));
            localStorage.setItem('pzp_dark_mode', 'false');
        }, SMOKE_USER);
        page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (['error', 'warning'].includes(message.type())) diagnostics.push(message.text()); });
        page.on('requestfailed', request => diagnostics.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
        await routeMockedApi(page);
        await page.route('**/api/business/profile**', route => {
            const profile = businessProfilePayload();
            const settings = profile.businessProfile.businesses[0].timeline;
            settings.defaultTimelineView = 'animators';
            settings.enabledModules.afisha = true;
            settings.timelineFeatures.afisha = true;
            return route.fulfill({ json: profile });
        });
        await page.route('**/api/lines/**', route => route.fulfill({ json: [
            { id: '1', name: 'Аніматор 1', color: '#6952ce' }, { id: '2', name: 'Аніматор 2', color: '#4595d2' }
        ] }));
        await page.route('**/api/bookings/**', route => {
            const date = new URL(route.request().url()).pathname.split('/').pop();
            return route.fulfill({ json: date === '2026-10-19' ? [{ id: 'fixture-booking', lineId: '1', date,
                time: '14:00', duration: 60, label: 'Тестове бронювання', programName: 'Свято', programCode: 'СВ',
                status: 'confirmed', category: 'animation', businessContext: 'event_genix', price: 0 }] : [] });
        });
        // These requests reach actual Express routers and the disposable PostgreSQL database.
        await page.route('**/api/afisha/**', route => route.continue());
        await page.route('**/api/timeline/promotions**', route => route.continue());
        await page.goto(fixture.base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.AppState && window.TimelineAfisha && window.__crmBusinessNavigationPending !== true
            && !document.getElementById('mainApp').classList.contains('hidden'));
        async function display(multi = false) {
            await page.evaluate(async multi => {
                AppState.selectedDate = new Date('2026-10-19T12:00:00');
                AppState.multiDayMode = multi;
                AppState.daysToShow = multi ? 7 : 1;
                if (window.TimelineView?.set) await window.TimelineView.set('animators', { render: false });
                await renderTimeline();
            }, multi);
            await page.locator('.timeline-promotions [data-toggle-marketing]').waitFor();
        }
        async function verifyFlagGeometry() {
            const overlaps = await page.evaluate(() => {
                const failures = [];
                document.querySelectorAll('.line-grid, .mini-line-grid').forEach(grid => {
                    const gridRect = grid.getBoundingClientRect();
                    grid.querySelectorAll('.afisha-type-birthday').forEach(birthday => {
                        const greeting = birthday.getBoundingClientRect();
                        if (greeting.top < gridRect.top || greeting.bottom > gridRect.bottom) failures.push({
                            kind: 'birthday-outside-grid', grid: [gridRect.top, gridRect.bottom],
                            greeting: [greeting.top, greeting.bottom], top: getComputedStyle(birthday).top,
                            transform: getComputedStyle(birthday).transform,
                            birthdayClass: birthday.className,
                            parent: birthday.parentElement?.className,
                            row: grid.closest('.timeline-line, .mini-timeline-line')?.className,
                            flags: grid.querySelectorAll('.afisha-flag').length
                        });
                    });
                    const flags = [...grid.querySelectorAll('.afisha-flag')];
                    flags.forEach((flag, index) => {
                        const a = flag.getBoundingClientRect();
                        const others = [...flags.slice(index + 1), ...grid.querySelectorAll('.booking-block, .mini-booking-block')];
                        others.forEach(other => {
                            const b = other.getBoundingClientRect();
                            if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) failures.push(flag.dataset.afishaId);
                        });
                    });
                });
                return failures;
            });
            assert.deepEqual(overlaps, [], 'flags must not overlap each other or booking cards');
        }
        await display();
        assert.equal(await page.locator('[data-toggle-marketing]').getAttribute('aria-expanded'), 'false');
        assert.equal(await page.locator('.timeline-marketing-body').isHidden(), true);
        await page.locator('[data-toggle-marketing]').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('[data-toggle-marketing]').getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('.timeline-marketing-body').isHidden(), true);
        const pageFlow = await page.evaluate(() => {
            const shell = document.querySelector('.timeline-container');
            const scroll = document.getElementById('timelineScroll');
            return { maxHeight: getComputedStyle(shell).maxHeight,
                shellHeight: shell.getBoundingClientRect().height,
                contentHeight: scroll.getBoundingClientRect().height,
                verticalOverflow: scroll.scrollHeight - scroll.clientHeight };
        });
        assert.equal(pageFlow.maxHeight, 'none', 'Park timeline has no viewport height cap');
        assert.ok(pageFlow.shellHeight >= pageFlow.contentHeight, 'timeline grows with its content');
        assert.ok(pageFlow.verticalOverflow < 20, 'page owns vertical scrolling');
        await fixture.pool.query(`INSERT INTO afisha (date,time,title,duration,type,description,original_time,template_id)
            VALUES ('2026-10-19','14:00','Іменинники',15,'greeting','','14:00',6),
                   ('2026-10-19','18:00','Іменинники',15,'greeting','','18:00',7)`);
        await display();
        assert.equal(await page.locator('.afisha-line-grid .afisha-type-birthday').count(), 2,
            'two recurring Іменинники events remain independently visible');
        await verifyFlagGeometry();
        const greetingId = (await fixture.pool.query("SELECT id FROM afisha WHERE title='Іменинники' AND time='14:00' AND date='2026-10-19'")).rows[0].id;
        const greeting = `.afisha-line-grid .afisha-type-birthday[data-afisha-id="${greetingId}"][data-birthday-slot="single"]`;
        assert.match(await page.locator(greeting).getAttribute('title'), /13:45–14:00 · Авто/);
        await page.locator(greeting).click();
        assert.equal(await page.locator('[data-birthday-form]').count(), 1, 'birthday has an independent time editor');
        await page.waitForFunction(() => !!document.activeElement.closest('.timeline-marketing-modal'));
        await page.keyboard.press('Escape');
        await page.locator('.timeline-marketing-modal').waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement.classList.contains('afisha-type-birthday')), true);
        await page.locator(greeting).click();
        await page.locator('[data-birthday-form] input[name="time"]').fill('15:20');
        await page.getByRole('button', { name: 'Зберегти час вручну' }).click();
        await page.locator('.timeline-marketing-modal').waitFor({ state: 'detached' });
        assert.deepEqual((await fixture.pool.query('SELECT time, mode FROM afisha_birthday_slots WHERE afisha_id=$1 AND slot_key=$2',
            [greetingId, 'single'])).rows[0], { time: '15:20', mode: 'manual' });
        assert.equal(await page.locator('.afisha-line-grid .afisha-type-birthday[data-birthday-slot="single"]:not([data-afisha-id="' + greetingId + '"])').getAttribute('title'),
            '18:00–18:15 · Авто');
        await page.locator(greeting).click();
        await page.getByRole('button', { name: 'Повернути автоматичний розклад' }).click();
        await page.locator('.timeline-marketing-modal').waitFor({ state: 'detached' });
        assert.equal((await fixture.pool.query('SELECT mode FROM afisha_birthday_slots WHERE afisha_id=$1 AND slot_key=$2',
            [greetingId, 'single'])).rows[0].mode, 'auto');
        const occurrenceFixture = (await fixture.pool.query(`INSERT INTO afisha(date,time,title,duration,type,line_id)
            VALUES('2026-10-19','12:00','Підміна вітання',15,'birthday','1') RETURNING id`)).rows[0];
        await fixture.pool.query(`INSERT INTO staff_substitutions(business_context,source_type,source_id,slot_key,state,work_date,source_snapshot)
            VALUES('event_genix','afisha',$1,'first:primary','completed','2026-10-19',$2)`,
        [String(occurrenceFixture.id),{replacementLineId:'2',time:'16:00'}]);
        await page.setViewportSize({ width:390, height:844 });
        await display();
        const firstOverride = page.locator(`.line-grid[data-line-id="2"] [data-afisha-id="${occurrenceFixture.id}"][data-birthday-slot="first"]`);
        await firstOverride.waitFor({state:'attached'});
        assert.equal(await page.locator(`.line-grid[data-line-id="1"] [data-afisha-id="${occurrenceFixture.id}"][data-birthday-slot="first"]`).count(),0);
        assert.equal(await page.locator(`.line-grid[data-line-id="1"] [data-afisha-id="${occurrenceFixture.id}"][data-birthday-slot="second"]`).count(),1);
        await firstOverride.click();
        await page.getByText('Аніматори: Аніматор 2',{exact:true}).waitFor();
        assert.equal(await page.locator('[data-birthday-form]').count(),0);
        await page.screenshot({ path:path.join(output,'afisha-occurrence-mobile.png') });
        await page.keyboard.press('Escape');
        if (process.env.AFISHA_OCCURRENCE_SMOKE === 'true') {
            console.log('PASS: the substituted occurrence renders only on the replacement lane and opens its read-only details at 390 px.');
            return;
        }
        await fixture.pool.query('DELETE FROM staff_substitutions WHERE source_id=$1',[String(occurrenceFixture.id)]);
        await fixture.pool.query('DELETE FROM afisha WHERE id=$1',[occurrenceFixture.id]);
        await page.setViewportSize({ width:1440,height:1000 });
        await display();
        const afishaFlag = '.afisha-line-grid .afisha-flag[data-afisha-id="1"]';
        await page.locator(afishaFlag).waitFor();
        assert.equal(await page.locator(afishaFlag).count(), 1);
        assert.equal(await page.locator('.afisha-on-line[data-afisha-id="1"]').count(), 1);
        const flag = page.locator(afishaFlag);
        await flag.click();
        await page.getByRole('button', { name: 'Перенести', exact: true }).click();
        await page.locator('.timeline-marketing-modal input[name="time"]').fill('14:15');
        await page.locator('.timeline-marketing-modal [data-move-form] button[type="submit"]').click();
        await page.waitForFunction(() => !document.querySelector('.timeline-marketing-modal'));
        assert.equal((await fixture.pool.query('SELECT time FROM afisha WHERE id=1')).rows[0].time, '14:15');
        await page.locator(afishaFlag).waitFor();
        const box = await page.locator(afishaFlag).boundingBox();
        const dragSave = page.waitForResponse(response => response.url().includes('/afisha/1/schedule') && response.ok());
        await page.mouse.move(box.x + 20, box.y + 14);
        await page.mouse.down();
        await page.mouse.move(box.x + 55, box.y + 14, { steps: 5 });
        await page.mouse.up();
        const dragResponse = await dragSave;
        assert.equal(await page.locator('.timeline-marketing-modal').count(), 0, 'drag must not open details');
        assert.notEqual((await fixture.pool.query('SELECT time FROM afisha WHERE id=1')).rows[0].time, '14:15',
            JSON.stringify(dragResponse.request().postDataJSON()));
        await page.locator('[data-toggle-marketing]').click();
        await page.locator('[data-add]').click();
        await page.locator('input[name="title"]').fill('Осінні канікули <тест>');
        await page.locator('textarea[name="description"]').fill('Інформаційна акція — ціни не змінюються');
        await page.locator('[data-week]').click();
        await page.locator('.timeline-marketing-modal button[type="submit"]').click();
        await page.locator('.promotion-label').waitFor();
        assert.equal((await fixture.pool.query('SELECT ends_on::text FROM timeline_promotions')).rows[0].ends_on, '2026-10-25');
        assert.ok(await page.locator('.line-grid[data-promotion-color="amber"]').count());
        await verifyFlagGeometry();
        await page.screenshot({ path: path.join(output, 'timeline-marketing-day.png'), fullPage: true });
        await display(true);
        await page.locator('[data-toggle-marketing]').click();
        await verifyFlagGeometry();
        assert.equal(await page.locator('.day-section').count(), 7);
        const weekAfishaFlag = '.mini-line-grid[data-line-id="afisha"] .afisha-flag[data-afisha-id="1"]';
        assert.equal(await page.locator(weekAfishaFlag).count(), 1);
        assert.equal(await page.locator('.mini-line-grid[data-line-id="1"] .afisha-flag[data-afisha-id="1"]').count(), 1);
        await page.locator('#timelineScroll').evaluate(el => { el.scrollLeft = 0; });
        const source = await page.locator(weekAfishaFlag).boundingBox();
        const target = await page.locator('.day-section[data-date="2026-10-20"] .day-section-header').boundingBox();
        await page.mouse.move(source.x + 20, source.y + 12);
        await page.mouse.down();
        await page.mouse.move(target.x + 130, target.y + 10, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        const moved = (await fixture.pool.query('SELECT date,line_id FROM afisha WHERE id=1')).rows[0];
        assert.equal(moved.date, '2026-10-20');
        assert.equal(moved.line_id, null);
        await page.locator('.day-section[data-date="2026-10-20"] ' + weekAfishaFlag).waitFor();
        // Keyboard is the deterministic alternative to resizing with a mouse.
        await page.locator('.promotion-handle[data-edge="end"]').focus();
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(250);
        assert.equal((await fixture.pool.query('SELECT ends_on::text FROM timeline_promotions')).rows[0].ends_on, '2026-10-24');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.edge), 'end', 'keyboard resize retains focus');
        await page.locator('[data-select]').click();
        const from = await page.locator('[data-date-index="1"]').boundingBox();
        const to = await page.locator('[data-date-index="2"]').boundingBox();
        await page.mouse.move(from.x + 10, from.y + 10); await page.mouse.down();
        await page.mouse.move(to.x + 10, to.y + 10, { steps: 5 }); await page.mouse.up();
        assert.equal(await page.locator('input[name="starts_on"]').inputValue(), '2026-10-20');
        assert.equal(await page.locator('input[name="ends_on"]').inputValue(), '2026-10-21');
        await page.locator('input[name="title"]').fill('Друга акція');
        await page.locator('.timeline-marketing-modal button[type="submit"]').click();
        await page.waitForTimeout(250);
        assert.ok(await page.locator('[data-promotion-color="overlap"]').count());
        const widthPerDay = (await page.locator('.timeline-promotion-dates').boundingBox()).width / 7;
        const secondBand = page.locator('.timeline-promotion-row').filter({ hasText: 'Друга акція' });
        const bandBox = await secondBand.locator('.promotion-label').boundingBox();
        await page.mouse.move(bandBox.x + 25, bandBox.y + 12); await page.mouse.down();
        await page.mouse.move(bandBox.x + 25 + widthPerDay, bandBox.y + 12, { steps: 5 }); await page.mouse.up();
        await page.waitForResponse(response => response.url().includes('/timeline/promotions?') && response.ok());
        let second = (await fixture.pool.query("SELECT starts_on::text,ends_on::text FROM timeline_promotions WHERE title='Друга акція'")).rows[0];
        assert.deepEqual(second, { starts_on: '2026-10-21', ends_on: '2026-10-22' });
        const handleBox = await secondBand.locator('[data-edge="end"]').boundingBox();
        await page.mouse.move(handleBox.x + 8, handleBox.y + 12); await page.mouse.down();
        await page.mouse.move(handleBox.x + 8 + widthPerDay, handleBox.y + 12, { steps: 5 }); await page.mouse.up();
        await page.waitForResponse(response => response.url().includes('/timeline/promotions?') && response.ok());
        second = (await fixture.pool.query("SELECT ends_on::text FROM timeline_promotions WHERE title='Друга акція'")).rows[0];
        assert.equal(second.ends_on, '2026-10-23');
        await page.screenshot({ path: path.join(output, 'timeline-marketing-week.png'), fullPage: true });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.AppState && window.__crmBusinessNavigationPending !== true && !document.getElementById('mainApp').classList.contains('hidden'));
        await display(true);
        await page.locator('[data-toggle-marketing]').click();
        assert.equal(await page.locator('.promotion-label').count(), 2, 'server persistence survives reload');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.promotion-label').first().click();
        await page.screenshot({ path: path.join(output, 'timeline-marketing-mobile.png'), fullPage: true });
        const modalBox = await page.locator('.timeline-marketing-dialog').boundingBox();
        assert.ok(modalBox.width <= 390 && modalBox.x >= 0);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.timeline-marketing-modal').count(), 0);
        assert.equal(await page.evaluate(() => document.activeElement.classList.contains('promotion-label')), true);
        const touch = await context.newCDPSession(page);
        await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
        await page.setViewportSize({ width: 320, height: 844 });
        assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
        const smallTargets = await page.locator('.timeline-promotions button').evaluateAll(buttons => buttons.map(button => {
            const rect = button.getBoundingClientRect();
            return { text: button.textContent, width: rect.width, height: rect.height };
        }).filter(rect => rect.width < 44 || rect.height < 44));
        assert.deepEqual(smallTargets, [], 'promotion touch controls remain at least 44px at 320px');
        const scrollBox = await page.locator('.timeline-promotion-scroll').boundingBox();
        assert.ok(scrollBox.x >= 0 && scrollBox.x + scrollBox.width <= 320, 'date strip scrolls inside the viewport');
        await page.setViewportSize({ width: 390, height: 844 });
        const touchFlag = page.locator(weekAfishaFlag);
        await touchFlag.scrollIntoViewIfNeeded();
        const touchBox = await touchFlag.boundingBox();
        const beforeTouch = (await fixture.pool.query('SELECT time FROM afisha WHERE id=1')).rows[0].time;
        const point = { x: Math.round(touchBox.x + 20), y: Math.round(touchBox.y + 14) };
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x + 40 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForResponse(response => response.url().includes('/afisha/1/schedule') && response.ok());
        assert.notEqual((await fixture.pool.query('SELECT time FROM afisha WHERE id=1')).rows[0].time, beforeTouch);
        assert.equal(await page.locator('.timeline-marketing-modal').count(), 0);
        await page.locator('.promotion-label').filter({ hasText: 'Друга акція' }).click();
        await page.locator('[data-archive]').click();
        await page.getByRole('button', { name: 'Архівувати', exact: true }).last().click();
        await page.waitForFunction(() => document.querySelectorAll('.promotion-label').length === 1);
        assert.equal((await fixture.pool.query("SELECT is_active FROM timeline_promotions WHERE title='Друга акція'")).rows[0].is_active, false);
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.evaluate(() => document.body.classList.add('dark-mode'));
        await display(true);
        await verifyFlagGeometry();
        await page.screenshot({ path: path.join(output, 'timeline-marketing-dark.png'), fullPage: true });
        const relevantErrors = errors.filter(message => /TimelineAfisha|TimelineMarketing|TimelinePromotions|assignedAfisha|promotions/.test(message));
        assert.deepEqual(relevantErrors, []);
        console.log('PASS: day/week flags and collision geometry, real SQL saves, mouse/touch drag, cross-day, promotion range selection, mouse move/resize, keyboard resize, overlap, reload, archive, mobile dialog and dark mode.');
        console.log('Screenshots: output/playwright/timeline-marketing-{day,week,mobile,dark}.png');
    } catch (error) {
        console.error('Browser errors:', errors);
        console.error('Diagnostics:', diagnostics.slice(-35));
        if (page) {
            console.error('Bootstrap:', await page.evaluate(() => ({ afisha: !!window.TimelineAfisha, marketing: !!window.TimelineMarketing,
                app: !!window.AppState, ready: window.isAuthenticatedRuntimeReady?.(), permission: window.getPermissionLifecycle?.(),
                pending: window.__crmBusinessNavigationPending, text: document.body.innerText.slice(0, 1600) })));
            await page.screenshot({ path: path.join(output, 'timeline-marketing-failure.png'), fullPage: true });
        }
        throw error;
    } finally {
        await context?.close();
        await browser?.close();
        await fixture.close();
    }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
