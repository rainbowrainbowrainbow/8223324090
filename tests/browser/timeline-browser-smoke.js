#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');

const BUSINESS_CONTEXT = process.env.TIMELINE_BROWSER_SMOKE_BUSINESS_CONTEXT || 'event_genix';
const DEFAULT_ROOM = process.env.TIMELINE_BROWSER_SMOKE_ROOM || 'Растішка';
const RUN_ID = `task37-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const TARGET_URL = process.argv.find(arg => /^https?:\/\//i.test(arg))
    || process.env.TIMELINE_BROWSER_SMOKE_URL
    || process.env.TEST_URL
    || process.env.LIVE_SMOKE_URL;
const HEADLESS = process.env.TIMELINE_BROWSER_SMOKE_HEADLESS !== 'false';
const CLEANUP = process.env.TIMELINE_BROWSER_SMOKE_CLEANUP !== 'false';
const ALLOW_NON_LOCAL = process.env.TIMELINE_BROWSER_SMOKE_ALLOW_PRODUCTION === 'true';

function fail(message) {
    console.error(`Timeline browser smoke failed: ${message}`);
    process.exit(1);
}

function normalizeBase(url) {
    try {
        return new URL(url).origin;
    } catch {
        fail(`invalid URL "${url || ''}"`);
    }
}

function isLocalBase(base) {
    const host = new URL(base).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(host);
}

function futureDate(days = 35) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
}

function datePlus(dateText, days) {
    const date = new Date(`${dateText}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function authHeader(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function scopedPath(path, params = {}) {
    const url = new URL(path, 'http://local');
    if (!url.searchParams.has('businessContext')) {
        url.searchParams.set('businessContext', BUSINESS_CONTEXT);
    }
    Object.entries(params || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    return `${url.pathname}${url.search}`;
}

async function readBody(res) {
    const text = await res.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return text;
    }
}

async function fetchJson(base, path, options = {}) {
    const res = await fetch(`${base}${path}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...authHeader(options.token)
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await readBody(res);
    if (!res.ok) {
        const detail = body?.error || body?.message || body?.code || (typeof body === 'string' ? body : '') || `HTTP ${res.status}`;
        throw new Error(`${path} returned ${res.status}: ${detail}`);
    }
    return body;
}

async function login(base) {
    const envToken = process.env.TIMELINE_BROWSER_SMOKE_TOKEN || process.env.LIVE_SMOKE_TOKEN;
    if (envToken) {
        const verified = await fetchJson(base, '/api/auth/verify', { token: envToken });
        return { token: envToken, user: verified.user || verified };
    }
    const username = process.env.TIMELINE_BROWSER_SMOKE_USER || process.env.LIVE_SMOKE_USER || process.env.TEST_USER;
    const password = process.env.TIMELINE_BROWSER_SMOKE_PASS || process.env.LIVE_SMOKE_PASS || process.env.TEST_PASS;
    if (!username || !password) {
        fail('set TIMELINE_BROWSER_SMOKE_TOKEN or TIMELINE_BROWSER_SMOKE_USER/TIMELINE_BROWSER_SMOKE_PASS');
    }
    const body = await fetchJson(base, '/api/auth/login', {
        method: 'POST',
        body: { username, password }
    });
    const token = body.accessToken || body.token;
    if (!token) throw new Error('/api/auth/login did not return access token');
    return { token, refreshToken: body.refreshToken || '', refreshExpiresAt: body.refreshExpiresAt || '', user: body.user };
}

async function createCustomer(base, token, label) {
    return fetchJson(base, scopedPath('/api/customers'), {
        method: 'POST',
        token,
        body: {
            businessContext: BUSINESS_CONTEXT,
            name: `Task37 ${label} ${RUN_ID}`,
            phone: `+38099${String(Date.now()).slice(-7)}`,
            childName: `Child ${label}`,
            source: 'other',
            notes: `timeline browser smoke ${RUN_ID}`
        }
    });
}

async function loadLines(base, token, date, timelineView) {
    const rows = await fetchJson(base, scopedPath(`/api/lines/${encodeURIComponent(date)}`, { timelineView }), { token });
    assert.ok(Array.isArray(rows), `/api/lines/${date} returns array`);
    return rows;
}

async function firstAnimatorLine(base, token, date) {
    const lines = await loadLines(base, token, date, 'animators');
    const line = lines.find(item => String(item.id || '') !== 'afisha' && String(item.id || '') !== 'banquet-service');
    assert.ok(line, 'animator line exists for browser smoke');
    return line;
}

function bookingPayload(base = {}) {
    return {
        businessContext: BUSINESS_CONTEXT,
        status: 'confirmed',
        duration: 60,
        price: 0,
        category: 'animation',
        programCode: 'TASK37',
        label: `Task37 ${RUN_ID}`,
        notes: `timeline browser smoke ${RUN_ID}`,
        ...base
    };
}

function kitchenPackage(servingTime = '14:00') {
    return {
        schemaVersion: 2,
        source: 'timeline_browser_smoke',
        menuPositions: [{
            productId: `task37-menu-${RUN_ID}`,
            title: 'Task37 menu',
            quantity: 1,
            unitPrice: 100,
            subtotal: 100,
            kitchenType: 'menu',
            servingUnit: 'portion',
            servingTime
        }],
        serviceEvents: [{
            type: 'room_setup',
            title: 'Task37 setup',
            time: servingTime
        }],
        programBasePrice: 0,
        positionsSubtotal: 100,
        finalTotal: 100
    };
}

async function createBooking(base, token, body) {
    const result = await fetchJson(base, scopedPath('/api/bookings'), { method: 'POST', token, body });
    assert.equal(result.success, true, 'booking create success');
    assert.ok(result.booking?.id, 'booking create returns booking id');
    return result.booking;
}

async function deleteBooking(base, token, bookingId) {
    if (!bookingId) return;
    await fetchJson(base, scopedPath(`/api/bookings/${encodeURIComponent(bookingId)}`), {
        method: 'DELETE',
        token
    }).catch(err => console.warn(`cleanup booking ${bookingId} failed: ${err.message}`));
}

async function deleteCustomer(base, token, customerId) {
    if (!customerId) return;
    await fetchJson(base, scopedPath(`/api/customers/${encodeURIComponent(customerId)}`), {
        method: 'DELETE',
        token
    }).catch(err => console.warn(`cleanup customer ${customerId} failed: ${err.message}`));
}

async function banquetSnapshot(base, token, bookingId) {
    return fetchJson(base, scopedPath(`/api/banquets/by-booking/${encodeURIComponent(bookingId)}`), { token });
}

function groupId(snapshot = {}) {
    return String(snapshot.groupId || snapshot.group?.id || '').trim();
}

async function openAuthenticatedPage(browser, base, session) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.addInitScript(({ token, refreshToken, refreshExpiresAt, user }) => {
        localStorage.setItem('pzp_token', token);
        localStorage.setItem('pzp_access_token', token);
        if (refreshToken) localStorage.setItem('pzp_refresh_token', refreshToken);
        if (refreshExpiresAt) localStorage.setItem('pzp_refresh_expires_at', String(refreshExpiresAt));
        if (user) localStorage.setItem('pzp_current_user', JSON.stringify(user));
        localStorage.setItem('pzp_dark_mode', 'true');
    }, session);
    const page = await context.newPage();
    page.setDefaultTimeout(Number(process.env.TIMELINE_BROWSER_SMOKE_TIMEOUT_MS || 20000));
    await page.goto(`${base}/?businessContext=${encodeURIComponent(BUSINESS_CONTEXT)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const appVisible = document.getElementById('mainApp') && !document.getElementById('mainApp').classList.contains('hidden');
        return appVisible && window.AppState && window.TimelineView && typeof openBookingPanel === 'function';
    });
    return { context, page };
}

async function renderTimelineView(page, date, view) {
    await page.evaluate(async ({ date, view }) => {
        AppState.selectedDate = new Date(`${date}T00:00:00`);
        const input = document.getElementById('timelineDate');
        if (input) input.value = date;
        if (typeof setTimelineDateInUrl === 'function') setTimelineDateInUrl(date);
        if (window.TimelineView?.set) await window.TimelineView.set(view, { render: false });
        if (typeof renderTimeline === 'function') await renderTimeline();
    }, { date, view });
    await page.waitForTimeout(100);
}

async function openRoomDrawer(page, date, room, time) {
    await renderTimelineView(page, date, 'rooms');
    return page.evaluate(async ({ room, time }) => {
        const lines = await getLinesForDate(AppState.selectedDate);
        const line = lines.find(item => {
            const values = [item.id, item.resourceId, item.resource_id, item.name, item.shortName, item.short_name];
            return values.some(value => String(value || '') === room || (typeof sameBookingRoom === 'function' && sameBookingRoom(value, room)));
        });
        if (!line) {
            return { ok: false, error: `room line not found: ${room}`, lines: lines.map(item => ({ id: item.id, name: item.name })) };
        }
        const opened = await openBookingPanel(time, line.id || line.name);
        await new Promise(resolve => setTimeout(resolve, 250));
        const select = document.getElementById('bookingBanquetGroupSelect');
        const hint = document.getElementById('bookingBanquetGroupHint');
        return {
            ok: opened === true,
            panelVisible: !document.getElementById('bookingPanel')?.classList.contains('hidden'),
            selectorText: select?.textContent || '',
            selectorValue: select?.value || '',
            hintText: hint?.textContent || '',
            customerId: document.getElementById('selectedCustomerId')?.value || '',
            guests: document.getElementById('banquetGuests')?.value || ''
        };
    }, { room, time });
}

function assertBridgeSelector(result, label) {
    assert.equal(result.ok, true, `${label}: drawer opens`);
    assert.equal(result.panelVisible, true, `${label}: drawer visible`);
    const combined = `${result.selectorText || ''} ${result.hintText || ''}`.replace(/\s+/g, ' ').trim();
    assert.ok(!/^Без прив.?язки$/i.test(combined), `${label}: selector is not only "Без прив'язки"`);
    assert.doesNotMatch(combined, /Банкетів цього клієнта на дату не знайдено/i, `${label}: no false empty-candidates hint`);
    assert.match(combined, /(Створити банкет|Банкет буде створено|Прив.?язано|Банкет)/i, `${label}: selector exposes virtual or existing banquet state`);
}

async function fillKitchenAndSubmit(page, sourceBookingId) {
    const responsePromise = page.waitForResponse(response =>
        response.url().includes('/api/banquets/from-source/member-booking')
        && response.request().method() === 'POST'
    );
    await page.evaluate(() => {
        const guests = document.getElementById('banquetGuests');
        if (guests && !guests.value) guests.value = '4';
        if (typeof setBookingMenuPositions === 'function') {
            setBookingMenuPositions([{
                productId: 'task37-ui-menu',
                title: 'Task37 UI menu',
                quantity: 1,
                unitPrice: 100,
                subtotal: 100,
                kitchenType: 'menu',
                servingUnit: 'portion',
                servingTime: '14:00'
            }]);
        }
        if (typeof setBookingServiceEvents === 'function') {
            setBookingServiceEvents([{ type: 'room_setup', title: 'Task37 setup', time: '13:45' }], { render: true });
        }
        document.getElementById('bookingNotes').value = 'Task37 kitchen browser smoke';
        document.getElementById('bookingForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const response = await responsePromise;
    const body = await response.json();
    assert.equal(response.ok(), true, 'source activity -> kitchen endpoint returns ok');
    assert.equal(body.success, true, 'source activity -> kitchen response success');
    assert.equal(String(body.group?.primaryBookingId || body.banquetGroup?.group?.primaryBookingId || body.banquetGroup?.group?.primary_booking_id || sourceBookingId), String(sourceBookingId));
    return body.booking || body.memberBooking || body.banquetGroup?.bookings?.kitchen?.[0];
}

async function openActiveBanquetEmptyCellDrawer(page, date, room, time, snapshot) {
    await renderTimelineView(page, date, 'rooms');
    return page.evaluate(async ({ room, time, snapshot }) => {
        const groupId = String(snapshot?.groupId || snapshot?.group?.id || '').trim();
        const primary = snapshot?.bookings?.primary || {};
        const kitchen = Array.isArray(snapshot?.bookings?.kitchen) ? snapshot.bookings.kitchen[0] : null;
        const packageSource = kitchen || primary;
        const bookingPackage = packageSource?.extraData?.bookingPackage
            || packageSource?.extra_data?.bookingPackage
            || packageSource?.extraData?.booking_package
            || packageSource?.extra_data?.booking_package
            || {};
        const summary = {
            groupId,
            snapshot,
            primaryBooking: primary,
            carrierBooking: packageSource || primary,
            groupName: snapshot?.group?.groupName || snapshot?.group?.group_name || primary.groupName || primary.group_name || primary.label || '',
            customerId: snapshot?.group?.customerId || snapshot?.group?.customer_id || primary.customerId || primary.customer_id || null,
            customerName: primary.customerName || primary.customer_name || '',
            room,
            date,
            kidsCount: primary.kidsCount || primary.kids_count || packageSource?.banquetGuests || packageSource?.banquet_guests || null,
            banquetGuests: packageSource?.banquetGuests || packageSource?.banquet_guests || primary.kidsCount || primary.kids_count || null,
            banquetAdults: packageSource?.banquetAdults || packageSource?.banquet_adults || null,
            banquetTables: packageSource?.banquetTables || packageSource?.banquet_tables || null,
            menuCount: Array.isArray(bookingPackage.menuPositions) ? bookingPackage.menuPositions.length : 0,
            packageSnapshot: {
                sourceBookingId: packageSource?.id || primary.id || null,
                menuPositions: Array.isArray(bookingPackage.menuPositions) ? bookingPackage.menuPositions : [],
                serviceEvents: Array.isArray(bookingPackage.serviceEvents) ? bookingPackage.serviceEvents : [],
                banquetMenu: packageSource?.banquetMenu || packageSource?.banquet_menu || '',
                finalTotal: bookingPackage.finalTotal ?? null,
                source: 'timeline_browser_smoke'
            }
        };
        if (typeof showTimelineBanquetInspector !== 'function') {
            return { ok: false, error: 'showTimelineBanquetInspector unavailable' };
        }
        showTimelineBanquetInspector(null, summary, { dataset: { bookingId: packageSource?.id || primary.id || '' } });
        const lines = await getLinesForDate(AppState.selectedDate);
        const line = lines.find(item => {
            const values = [item.id, item.resourceId, item.resource_id, item.name, item.shortName, item.short_name];
            return values.some(value => String(value || '') === room || (typeof sameBookingRoom === 'function' && sameBookingRoom(value, room)));
        });
        if (!line) return { ok: false, error: `room line not found: ${room}` };
        const lineId = String(line.id || line.name || '').trim();
        const cell = Array.from(document.querySelectorAll('.grid-cell[data-time][data-line]'))
            .find(node => String(node.dataset.line || '') === lineId && String(node.dataset.time || '') === time);
        if (!cell) return { ok: false, error: `empty cell not found: ${lineId} ${time}` };
        await selectCell(cell);
        await new Promise(resolve => setTimeout(resolve, 250));
        const banner = document.querySelector('.booking-active-banquet-context');
        const standalone = document.querySelector('[data-booking-standalone-override]');
        return {
            ok: true,
            activeContext: typeof getTimelineActiveBanquetContext === 'function' ? getTimelineActiveBanquetContext() : null,
            selectedGroupId: BookingDrawerState.selectedBanquetGroupId || '',
            activeBanquetIntent: BookingDrawerState.activeBanquetIntent || '',
            roleIntent: BookingDrawerState.activeBanquetRoleIntent || '',
            bannerText: banner?.textContent || '',
            hasStandaloneOverride: Boolean(standalone),
            panelVisible: !document.getElementById('bookingPanel')?.classList.contains('hidden'),
            guests: document.getElementById('banquetGuests')?.value || ''
        };
    }, { room, time, snapshot });
}

async function submitActiveBanquetMemberFromEmptyCell(page, groupId) {
    const genericBookingRequests = [];
    const requestHandler = request => {
        if (request.method() !== 'POST') return;
        const pathname = new URL(request.url()).pathname;
        if (pathname === '/api/bookings' || pathname === '/api/bookings/full') {
            genericBookingRequests.push(request.url());
        }
    };
    page.on('request', requestHandler);
    const responsePromise = page.waitForResponse(response =>
        response.url().includes(`/api/banquets/${encodeURIComponent(groupId)}/member-booking`)
        && response.request().method() === 'POST'
    );
    await page.evaluate(() => {
        if (typeof setBookingKitchenEnabled === 'function') setBookingKitchenEnabled(true, { markDirty: true });
        const guests = document.getElementById('banquetGuests');
        if (guests) guests.value = guests.value || '4';
        if (typeof setBookingMenuPositions === 'function') {
            setBookingMenuPositions([{
                productId: 'task37-empty-cell-menu',
                title: 'Task37 empty cell menu',
                quantity: 1,
                unitPrice: 120,
                subtotal: 120,
                kitchenType: 'menu',
                servingUnit: 'portion',
                servingTime: '17:30'
            }]);
        }
        document.getElementById('bookingNotes').value = 'Task37 active inspector empty cell smoke';
        document.getElementById('bookingForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const response = await responsePromise;
    page.off('request', requestHandler);
    const body = await response.json();
    assert.equal(response.ok(), true, 'active inspector -> empty cell member endpoint returns ok');
    assert.equal(body.success, true, 'active inspector -> empty cell response success');
    assert.deepEqual(genericBookingRequests, [], 'active inspector -> empty cell does not use generic booking endpoints');
    return body.booking || body.memberBooking || body.banquetGroup?.bookings?.kitchen?.[0];
}

async function chooseFirstActivityProgram(page) {
    return page.evaluate(async () => {
        if (typeof getProducts === 'function') await getProducts();
        const products = typeof getProductsSync === 'function' ? getProductsSync() : [];
        const program = products.find(item =>
            item
            && item.isActive !== false
            && item.domain !== 'kitchen'
            && item.category !== 'kitchen'
            && Number(item.duration || 0) > 0
            && Number(item.hosts || 1) <= 1
            && !item.isCustom
        );
        if (!program) return null;
        if (typeof setSelectedActivityPrograms === 'function') {
            setSelectedActivityPrograms([program.id], { markDirty: true, renderSummary: true, renderPackage: true });
        } else if (typeof selectProgram === 'function') {
            selectProgram(program.id);
        } else {
            document.getElementById('selectedProgram').value = program.id;
        }
        const kids = document.getElementById('kidsCountInput');
        if (kids) kids.value = '4';
        if (typeof updateBookingSubmitState === 'function') updateBookingSubmitState();
        const select = document.getElementById('bookingBanquetGroupSelect');
        const hint = document.getElementById('bookingBanquetGroupHint');
        return {
            id: program.id,
            label: program.name || program.label || program.code || program.id,
            selectorText: select?.textContent || '',
            selectorValue: select?.value || '',
            hintText: hint?.textContent || '',
            panelVisible: !document.getElementById('bookingPanel')?.classList.contains('hidden')
        };
    });
}

async function openActivityFromKitchenSource(page, date, kitchenId) {
    await renderTimelineView(page, date, 'rooms');
    return page.evaluate(async ({ kitchenId }) => {
        const bookings = await getBookingsForDate(AppState.selectedDate, { force: true });
        if (!bookings.find(item => String(item.id) === String(kitchenId))) {
            return { ok: false, error: 'source kitchen booking not in room bookings cache' };
        }
        await openRoomBookingAnimationBridge(kitchenId);
        await new Promise(resolve => setTimeout(resolve, 250));
        const select = document.getElementById('bookingBanquetGroupSelect');
        const hint = document.getElementById('bookingBanquetGroupHint');
        return {
            ok: !document.getElementById('bookingPanel')?.classList.contains('hidden'),
            panelVisible: !document.getElementById('bookingPanel')?.classList.contains('hidden'),
            selectorText: select?.textContent || '',
            selectorValue: select?.value || '',
            hintText: hint?.textContent || ''
        };
    }, { kitchenId });
}

async function submitActivityFromKitchen(page) {
    const responsePromise = page.waitForResponse(response =>
        response.url().includes('/api/banquets/from-source/activity-booking')
        && response.request().method() === 'POST'
    );
    await page.evaluate(() => {
        document.getElementById('bookingNotes').value = 'Task37 activity browser smoke';
        document.getElementById('bookingForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const response = await responsePromise;
    const body = await response.json();
    assert.equal(response.ok(), true, 'source kitchen -> activity endpoint returns ok');
    assert.equal(body.success, true, 'source kitchen -> activity response success');
    return body.booking || body.activityBooking || body.mainBooking;
}

async function assertRoomMarkerVisible(page, bookingId) {
    await page.waitForFunction(id => {
        const escaped = CSS.escape(String(id));
        return Boolean(
            document.querySelector(`.timeline-room-service-marker[data-booking-id="${escaped}"]`)
            || Array.from(document.querySelectorAll('.timeline-room-service-marker[data-booking-ids]')).some(node =>
                String(node.dataset.bookingIds || '').split(/\s+/).includes(String(id))
            )
            || document.querySelector(`.booking-block[data-booking-id="${escaped}"]`)
        );
    }, bookingId);
}

async function assertKitchenHiddenFromAnimator(page, kitchenId) {
    await renderTimelineView(page, await page.evaluate(() => document.getElementById('timelineDate')?.value), 'animators');
    const visible = await page.evaluate(id => {
        const escaped = CSS.escape(String(id));
        return Boolean(
            document.querySelector(`.timeline-room-service-marker[data-booking-id="${escaped}"]`)
            || document.querySelector(`.booking-block[data-booking-id="${escaped}"]:not(.status-hidden)`)
        );
    }, kitchenId);
    assert.equal(visible, false, 'kitchen is not rendered as normal animator block');
}

async function assertBookingBlockVisible(page, bookingId) {
    await page.waitForFunction(id => {
        const escaped = CSS.escape(String(id));
        return Boolean(document.querySelector(`.booking-block[data-booking-id="${escaped}"]:not(.status-hidden)`));
    }, bookingId);
}

async function assertTimelineHeaderAnd15MinuteGeometry(page, date, bookingId) {
    const desktopViewports = [
        { width: 2048, height: 1152 },
        { width: 1920, height: 1080 },
        { width: 1536, height: 864 }
    ];
    const readZoomState = () => page.evaluate(() => {
        const key = typeof timelineStorageKey === 'function' ? timelineStorageKey('zoom_level') : 'pzp_zoom_level';
        const buttons = Array.from(document.querySelectorAll('.timeline-header-filters .zoom-btn')).map(btn => ({
            zoom: btn.dataset.zoom,
            active: btn.classList.contains('active'),
            pressed: btn.getAttribute('aria-pressed')
        }));
        return {
            configCellMinutes: Number(CONFIG?.TIMELINE?.CELL_MINUTES),
            appZoomLevel: Number(AppState?.zoomLevel),
            savedZoom: localStorage.getItem(key),
            activeZoom: buttons.find(btn => btn.active)?.zoom || '',
            buttons
        };
    });
    const assertZoomLevel = async (level, label) => {
        const expected = String(level);
        await page.locator(`.timeline-header-filters .zoom-btn[data-zoom="${expected}"]`).click();
        await page.waitForFunction(zoom => {
            const zoomButton = document.querySelector(`.timeline-header-filters .zoom-btn[data-zoom="${zoom}"]`);
            return Number(CONFIG?.TIMELINE?.CELL_MINUTES) === Number(zoom)
                && Number(AppState?.zoomLevel) === Number(zoom)
                && zoomButton?.classList.contains('active')
                && zoomButton?.getAttribute('aria-pressed') === 'true';
        }, expected);
        const state = await readZoomState();
        assert.equal(state.configCellMinutes, level, `${label}: CONFIG.TIMELINE.CELL_MINUTES is ${level}`);
        assert.equal(state.appZoomLevel, level, `${label}: AppState.zoomLevel is ${level}`);
        assert.equal(state.savedZoom, expected, `${label}: saved zoom preference is ${expected}`);
        assert.equal(state.activeZoom, expected, `${label}: active zoom button is ${expected}`);
        for (const button of state.buttons) {
            assert.equal(button.pressed, button.zoom === expected ? 'true' : 'false', `${label}: aria-pressed for ${button.zoom}`);
            assert.equal(button.active, button.zoom === expected, `${label}: active class for ${button.zoom}`);
        }
    };

    await page.setViewportSize({ width: 2048, height: 1152 });
    await page.evaluate(() => {
        if (typeof AppState !== 'undefined') AppState.compactMode = true;
        localStorage.setItem('pzp_compact_mode', 'true');
        document.body?.classList?.add('timeline-compact-mode');
        document.documentElement?.classList?.add('timeline-compact-mode');
    });
    await renderTimelineView(page, date, 'animators');
    await assertZoomLevel(30, '30-minute zoom switch');
    await assertZoomLevel(60, '60-minute zoom switch');
    await assertZoomLevel(15, '15-minute zoom switch');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const appVisible = document.getElementById('mainApp') && !document.getElementById('mainApp').classList.contains('hidden');
        return appVisible && window.AppState && window.TimelineView && typeof renderTimeline === 'function';
    });
    await renderTimelineView(page, date, 'animators');
    const reloadedZoom = await readZoomState();
    assert.equal(reloadedZoom.configCellMinutes, 15, 'saved 15-minute zoom survives reload in CONFIG');
    assert.equal(reloadedZoom.appZoomLevel, 15, 'saved 15-minute zoom survives reload in AppState');
    assert.equal(reloadedZoom.savedZoom, '15', 'saved 15-minute zoom remains in localStorage after reload');
    assert.equal(reloadedZoom.activeZoom, '15', 'saved 15-minute zoom button remains active after reload');
    for (const button of reloadedZoom.buttons) {
        assert.equal(button.pressed, button.zoom === '15' ? 'true' : 'false', `reload: aria-pressed for ${button.zoom}`);
        assert.equal(button.active, button.zoom === '15', `reload: active class for ${button.zoom}`);
    }
    await assertBookingBlockVisible(page, bookingId);

    const readMetrics = () => page.evaluate(id => {
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const visibleRect = (selector) => {
            const el = document.querySelector(selector);
            const rect = el?.getBoundingClientRect?.();
            const style = el ? getComputedStyle(el) : null;
            return {
                selector,
                exists: Boolean(el),
                visible: Boolean(
                    el
                    && rect
                    && rect.width > 0
                    && rect.height > 0
                    && style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && rect.left >= -1
                    && rect.right <= viewportWidth + 1
                ),
                width: rect ? Math.round(rect.width * 100) / 100 : 0,
                height: rect ? Math.round(rect.height * 100) / 100 : 0,
                top: rect ? Math.round(rect.top * 100) / 100 : 0,
                bottom: rect ? Math.round(rect.bottom * 100) / 100 : 0,
                left: rect ? Math.round(rect.left * 100) / 100 : 0,
                right: rect ? Math.round(rect.right * 100) / 100 : 0
            };
        };
        const anyVisible = (selector) => Array.from(document.querySelectorAll(selector)).some(el => {
            const rect = el.getBoundingClientRect?.();
            const style = getComputedStyle(el);
            return Boolean(
                rect
                && rect.width > 0
                && rect.height > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden'
            );
        });
        const criticalSelectors = [
            '.timeline-header-filters',
            '.timeline-header-filters .status-filter-controls',
            '.timeline-header-filters #periodSelector',
            '.timeline-header-filters [data-timeline-type-selector]',
            '.timeline-header-filters .zoom-controls',
            '.header .timeline-header-actions #logoutBtn'
        ];
        const critical = criticalSelectors.map(visibleRect);
        const hiddenControls = critical.filter(item => !item.visible);
        const filters = document.querySelector('.timeline-header-filters');
        const actions = document.querySelector('.header .timeline-header-actions');
        const logout = document.querySelector('.header .timeline-header-actions #logoutBtn');
        const settings = document.querySelector('.header .timeline-header-actions #timelineConstructorBtn');
        const filtersRect = filters?.getBoundingClientRect?.();
        const actionsRect = actions?.getBoundingClientRect?.();
        const logoutRect = logout?.getBoundingClientRect?.();
        const settingsRect = settings?.getBoundingClientRect?.();
        const settingsStyle = settings ? getComputedStyle(settings) : null;
        const settingsVisible = Boolean(
            settings
            && settingsRect
            && settingsRect.width > 0
            && settingsRect.height > 0
            && settingsStyle?.display !== 'none'
            && settingsStyle?.visibility !== 'hidden'
            && settingsRect.left >= -1
            && settingsRect.right <= viewportWidth + 1
        );
        const settingsAllowed = Boolean(window.TimelineBusinessContext?.canUseAction?.('settings', window.AppState?.currentUser || null));
        const filterOverflowX = filters ? Math.max(0, filters.scrollWidth - filters.clientWidth) : Number.NaN;
        const bodyOverflowX = Math.max(0, document.documentElement.scrollWidth - viewportWidth);
        const cell = document.querySelector('.line-grid .grid-cell');
        const block = document.querySelector(`.booking-block[data-booking-id="${CSS.escape(String(id))}"]:not(.status-hidden)`);
        return {
            viewportWidth,
            hiddenControls,
            searchVisible: anyVisible('.timeline-dashboard-page .header .btn-search, .timeline-dashboard-page .header #globalHeaderSearchBtn'),
            compactToggleVisible: anyVisible('#compactModeToggle, .timeline-header-filters .timeline-compact-toggle, .timeline-compact-toggle'),
            filterLabelVisible: anyVisible('.timeline-header-filters-label, .timeline-header-filter-icon--sliders'),
            filterOverflowX,
            bodyOverflowX,
            configCellMinutes: Number(CONFIG?.TIMELINE?.CELL_MINUTES),
            activeZoom: document.querySelector('.timeline-header-filters .zoom-btn.active')?.dataset.zoom || '',
            actionsRightGap: actionsRect ? Math.round((viewportWidth - actionsRect.right) * 100) / 100 : Number.NaN,
            actionsLeft: actionsRect ? Math.round(actionsRect.left * 100) / 100 : Number.NaN,
            filtersRight: filtersRect ? Math.round(filtersRect.right * 100) / 100 : Number.NaN,
            settingsAllowed,
            settingsVisible,
            settingsLeft: settingsRect ? Math.round(settingsRect.left * 100) / 100 : Number.NaN,
            settingsRight: settingsRect ? Math.round(settingsRect.right * 100) / 100 : Number.NaN,
            settingsTop: settingsRect ? Math.round(settingsRect.top * 100) / 100 : Number.NaN,
            settingsWidth: settingsRect ? Math.round(settingsRect.width * 100) / 100 : 0,
            logoutTop: logoutRect ? Math.round(logoutRect.top * 100) / 100 : Number.NaN,
            logoutLeft: logoutRect ? Math.round(logoutRect.left * 100) / 100 : Number.NaN,
            logoutWidth: logoutRect ? Math.round(logoutRect.width * 100) / 100 : Number.NaN,
            compactState: Boolean(AppState?.compactMode),
            compactStorage: localStorage.getItem('pzp_compact_mode'),
            htmlCompactClass: document.documentElement.classList.contains('timeline-compact-mode'),
            bodyCompactClass: document.body?.classList?.contains('timeline-compact-mode') || false,
            containerCompactClass: document.querySelector('.timeline-container')?.classList?.contains('compact') || false,
            timelineDensity: document.documentElement.style.getPropertyValue('--timeline-density'),
            fitScreen: document.querySelector('.timeline-container')?.dataset?.fitScreen || '',
            cellWidth: cell ? cell.getBoundingClientRect().width : 0,
            bookingWidth: block ? block.getBoundingClientRect().width : 0,
            bookingLeft: block ? block.getBoundingClientRect().left : 0
        };
    }, bookingId);

    for (const viewport of desktopViewports) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(() => document.querySelector('.timeline-header-filters')?.getBoundingClientRect?.().width > 0);
        const metrics = await readMetrics();
        const label = `${viewport.width}x${viewport.height}`;

        assert.deepEqual(metrics.hiddenControls, [], `timeline header critical controls visible at ${label}: ${JSON.stringify(metrics.hiddenControls)}`);
        assert.equal(metrics.searchVisible, false, `timeline header search button is not visible at ${label}`);
        assert.equal(metrics.compactToggleVisible, false, `timeline compact toggle is not visible at ${label}`);
        assert.equal(metrics.filterLabelVisible, false, `timeline filter label/sliders control is not visible at ${label}`);
        assert.ok(metrics.filterOverflowX <= 2, `timeline header filters do not need desktop horizontal scroll at ${label}: ${metrics.filterOverflowX}`);
        assert.ok(metrics.bodyOverflowX <= 2, `timeline page does not create uncontrolled horizontal overflow at ${label}: ${metrics.bodyOverflowX}`);
        assert.ok(metrics.actionsRightGap >= 0 && metrics.actionsRightGap <= 96, `logout action zone stays pinned to the right at ${label}: ${metrics.actionsRightGap}px`);
        assert.ok(metrics.actionsLeft >= metrics.filtersRight - 4, `logout action zone stays visually separated after filters at ${label}: ${metrics.actionsLeft}px vs ${metrics.filtersRight}px`);
        assert.ok(metrics.logoutTop >= 0 && metrics.logoutTop <= 120, `logout stays in the top header row at ${label}: ${metrics.logoutTop}px`);
        assert.ok(metrics.logoutWidth >= 72, `logout button stays visibly highlighted at ${label}: ${metrics.logoutWidth}px`);
        if (metrics.settingsAllowed) {
            assert.equal(metrics.settingsVisible, true, `settings gear is visible for settings-capable user at ${label}`);
            assert.ok(metrics.settingsWidth >= 32, `settings gear keeps usable hit target at ${label}: ${metrics.settingsWidth}px`);
            assert.ok(metrics.settingsRight <= metrics.logoutLeft + 1, `settings gear stays before logout at ${label}: ${metrics.settingsRight}px vs ${metrics.logoutLeft}px`);
            assert.ok(Math.abs(metrics.settingsTop - metrics.logoutTop) <= 16, `settings gear stays near logout vertically at ${label}: ${metrics.settingsTop}px vs ${metrics.logoutTop}px`);
            assert.ok(metrics.logoutLeft - metrics.settingsRight <= 18, `settings gear stays close to logout at ${label}: ${metrics.logoutLeft - metrics.settingsRight}px`);
        }
        assert.equal(metrics.configCellMinutes, 15, `15-minute zoom updates CONFIG.TIMELINE.CELL_MINUTES at ${label}`);
        assert.equal(metrics.activeZoom, '15', `15-minute zoom button is active after click at ${label}`);
        assert.equal(metrics.compactState, false, `legacy compact preference is ignored after render at ${label}`);
        assert.equal(metrics.compactStorage, null, `legacy compact preference is removed at ${label}`);
        assert.equal(metrics.htmlCompactClass, false, `html compact class is not applied at ${label}`);
        assert.equal(metrics.bodyCompactClass, false, `body compact class is not applied at ${label}`);
        assert.equal(metrics.containerCompactClass, false, `timeline container compact class is not applied at ${label}`);
        assert.equal(metrics.timelineDensity, 'regular', `timeline density remains regular at ${label}`);
        assert.equal(metrics.fitScreen, 'scroll', `timeline keeps normal scroll layout instead of compact fit-screen at ${label}`);
        assert.ok(metrics.cellWidth >= 48, `15-minute desktop grid cell stays readable at ${label}: ${metrics.cellWidth}px`);
        assert.ok(metrics.bookingWidth >= 150, `15-minute 60-minute booking block stays readable at ${label}: ${metrics.bookingWidth}px`);
    }
}

async function runRevealAction(page, date, kitchenId) {
    await renderTimelineView(page, date, 'rooms');
    await page.evaluate(async id => {
        await showBookingDetails(id);
        if (window.TimelineView?.set) await window.TimelineView.set('animators', { render: false });
    }, kitchenId);
    await page.getByRole('button', { name: /Показати в кімнатах/i }).click();
    await page.waitForFunction(() => window.TimelineView?.current?.() === 'rooms');
    await assertRoomMarkerVisible(page, kitchenId);
}

async function run() {
    if (!TARGET_URL) fail('provide URL argument or TIMELINE_BROWSER_SMOKE_URL/TEST_URL');
    const base = normalizeBase(TARGET_URL);
    if (!isLocalBase(base) && !ALLOW_NON_LOCAL) {
        fail(`refusing non-local browser smoke for ${base}; set TIMELINE_BROWSER_SMOKE_ALLOW_PRODUCTION=true for an explicitly approved protected run`);
    }

    let playwright;
    try {
        playwright = require('playwright');
    } catch (err) {
        fail(`Playwright is not available. Run through: npx --yes --package playwright node tests/browser/timeline-browser-smoke.js ${base}`);
    }

    const session = await login(base);
    const token = session.token;
    const date = process.env.TIMELINE_BROWSER_SMOKE_DATE || futureDate();
    const secondDate = datePlus(date, 1);
    const room = DEFAULT_ROOM;
    const createdBookingIds = [];
    const createdCustomerIds = [];

    const browser = await playwright.chromium.launch({ headless: HEADLESS });
    let context;
    let page;
    try {
        const animator = await firstAnimatorLine(base, token, date);
        const customerA = await createCustomer(base, token, 'activity-first');
        const customerB = await createCustomer(base, token, 'kitchen-first');
        createdCustomerIds.push(customerA.id, customerB.id);

        const activity = await createBooking(base, token, bookingPayload({
            date,
            time: '13:00',
            lineId: animator.id,
            lineName: animator.name,
            room,
            label: `Task37 activity first ${RUN_ID}`,
            programCode: 'TASK37-ACT',
            category: 'animation',
            duration: 60,
            price: 1000,
            customerId: customerA.id,
            customerName: customerA.name,
            customerPhone: customerA.phone,
            childName: customerA.childName,
            kidsCount: 4
        }));
        createdBookingIds.push(activity.id);

        ({ context, page } = await openAuthenticatedPage(browser, base, session));
        await assertTimelineHeaderAnd15MinuteGeometry(page, date, activity.id);

        const activityFirstDrawer = await openRoomDrawer(page, date, room, '13:00');
        assertBridgeSelector(activityFirstDrawer, 'activity first -> kitchen');
        const kitchenFromActivity = await fillKitchenAndSubmit(page, activity.id);
        assert.ok(kitchenFromActivity?.id, 'kitchen booking created from activity source');
        createdBookingIds.push(kitchenFromActivity.id);
        const activitySnapshot = await banquetSnapshot(base, token, activity.id);
        assert.ok(groupId(activitySnapshot), 'activity-first banquet group exists');
        assert.equal(String(activitySnapshot.bookings?.primary?.id || activitySnapshot.group?.primaryBookingId), String(activity.id));
        const activityGroupId = groupId(activitySnapshot);

        await renderTimelineView(page, date, 'rooms');
        await assertRoomMarkerVisible(page, kitchenFromActivity.id);
        await assertKitchenHiddenFromAnimator(page, kitchenFromActivity.id);
        await renderTimelineView(page, date, 'animators');
        await assertBookingBlockVisible(page, activity.id);
        await runRevealAction(page, date, kitchenFromActivity.id);

        await renderTimelineView(page, secondDate, 'rooms');
        await renderTimelineView(page, date, 'rooms');
        await assertRoomMarkerVisible(page, kitchenFromActivity.id);

        const emptyCellDrawer = await openActiveBanquetEmptyCellDrawer(page, date, room, '17:00', activitySnapshot);
        assert.equal(emptyCellDrawer.ok, true, `active inspector -> empty cell opens drawer: ${emptyCellDrawer.error || ''}`);
        assert.equal(emptyCellDrawer.panelVisible, true, 'active inspector -> empty cell drawer visible');
        assert.equal(String(emptyCellDrawer.activeContext?.groupId || emptyCellDrawer.selectedGroupId), activityGroupId, 'active inspector context keeps the banquet group');
        assert.equal(emptyCellDrawer.activeBanquetIntent, 'add_to_existing', 'empty cell drawer has add-to-existing intent');
        assert.ok(emptyCellDrawer.hasStandaloneOverride, 'empty cell drawer exposes explicit standalone override');
        assert.ok(String(emptyCellDrawer.bannerText || '').trim(), 'empty cell drawer shows active banquet banner');
        const emptyCellKitchen = await submitActiveBanquetMemberFromEmptyCell(page, activityGroupId);
        assert.ok(emptyCellKitchen?.id, 'active inspector empty-cell kitchen booking created');
        createdBookingIds.push(emptyCellKitchen.id);
        const emptyCellSnapshot = await banquetSnapshot(base, token, emptyCellKitchen.id);
        assert.equal(groupId(emptyCellSnapshot), activityGroupId, 'empty cell grouped save reloads inside the same banquet group');
        await renderTimelineView(page, date, 'rooms');
        await assertRoomMarkerVisible(page, emptyCellKitchen.id);

        const reused = await fetchJson(base, scopedPath('/api/banquets/from-source/member-booking'), {
            method: 'POST',
            token,
            body: {
                sourceBookingId: activity.id,
                role: 'kitchen',
                booking: bookingPayload({
                    date,
                    time: '15:00',
                    lineId: 'banquet-service',
                    room,
                    label: `Task37 reuse kitchen ${RUN_ID}`,
                    category: 'banquet',
                    duration: 60,
                    customerId: customerA.id,
                    customerName: customerA.name,
                    banquetGuests: 4,
                    bookingPackage: kitchenPackage('15:30')
                })
            }
        });
        assert.equal(reused.success, true, 'existing group reuse create succeeds');
        assert.equal(reused.createdGroup, false, 'existing group reuse does not create duplicate group');
        createdBookingIds.push(reused.booking?.id);
        const reuseSnapshot = await banquetSnapshot(base, token, reused.booking.id);
        assert.equal(groupId(reuseSnapshot), groupId(activitySnapshot), 'existing group id reused');

        const kitchenFirst = await createBooking(base, token, bookingPayload({
            date,
            time: '16:00',
            lineId: 'banquet-service',
            room,
            label: `Task37 kitchen first ${RUN_ID}`,
            category: 'banquet',
            duration: 90,
            price: 100,
            customerId: customerB.id,
            customerName: customerB.name,
            customerPhone: customerB.phone,
            childName: customerB.childName,
            banquetGuests: 5,
            bookingPackage: kitchenPackage('16:30')
        }));
        createdBookingIds.push(kitchenFirst.id);

        await renderTimelineView(page, date, 'rooms');
        await assertRoomMarkerVisible(page, kitchenFirst.id);
        const kitchenFirstDrawer = await openActivityFromKitchenSource(page, date, kitchenFirst.id);
        assertBridgeSelector(kitchenFirstDrawer, 'kitchen first -> activity');
        const program = await chooseFirstActivityProgram(page);
        assert.ok(program?.id, 'activity program selected for kitchen-first bridge');
        const activityFromKitchen = await submitActivityFromKitchen(page);
        assert.ok(activityFromKitchen?.id, 'activity booking created from kitchen source');
        createdBookingIds.push(activityFromKitchen.id);
        const kitchenSnapshot = await banquetSnapshot(base, token, kitchenFirst.id);
        assert.ok(groupId(kitchenSnapshot), 'kitchen-first banquet group exists');

        await renderTimelineView(page, date, 'rooms');
        await assertRoomMarkerVisible(page, kitchenFirst.id);
        await renderTimelineView(page, date, 'animators');
        await assertBookingBlockVisible(page, activityFromKitchen.id);
        const kitchenFirstAnimatorVisible = await page.evaluate(id => {
            const escaped = CSS.escape(String(id));
            return Boolean(document.querySelector(`.booking-block[data-booking-id="${escaped}"]:not(.status-hidden)`));
        }, kitchenFirst.id);
        assert.equal(kitchenFirstAnimatorVisible, false, 'kitchen-first kitchen stays hidden from animator timeline');

        console.log(`Timeline browser smoke OK: ${base} date=${date} room=${room}`);
        console.log(`  OK activity first -> kitchen after, group ${groupId(activitySnapshot)}`);
        console.log(`  OK kitchen first -> activity after, group ${groupId(kitchenSnapshot)}`);
        console.log('  OK existing group reuse, visibility, reveal action, and cache view/date switch');
    } finally {
        await context?.close().catch(() => {});
        await browser.close().catch(() => {});
        if (CLEANUP) {
            for (const id of [...createdBookingIds].reverse().filter(Boolean)) {
                await deleteBooking(base, token, id);
            }
            for (const id of [...createdCustomerIds].reverse().filter(Boolean)) {
                await deleteCustomer(base, token, id);
            }
        } else {
            console.warn(`TIMELINE_BROWSER_SMOKE_CLEANUP=false; created booking ids: ${createdBookingIds.filter(Boolean).join(', ')}`);
        }
    }
}

run().catch(err => fail(err?.stack || err?.message || String(err)));
