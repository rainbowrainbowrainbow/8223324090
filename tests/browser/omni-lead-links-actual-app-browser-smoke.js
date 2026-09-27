#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { checkLeadEditorModes } = require('./lead-editor-mode-fixtures');
const { checkLeadEditorNavigation } = require('./lead-editor-navigation-fixtures');
const { checkOmniWorkspaceNavigation } = require('./omni-workspace-navigation-fixtures');
const { checkLeadCommunicationSelection } = require('./lead-communication-selection-fixtures');
const {
    assertSafeIsolatedTestUrl,
    assertSafeTestDatabaseUrl
} = require('../../scripts/test-db-safety');

const TARGET_URL = String(process.env.TEST_URL || '').trim();
const DATABASE_URL = String(process.env.OMNI_LINKS_BROWSER_DATABASE_URL || '').trim();
const ENABLED = process.env.RUN_OMNI_LEAD_LINKS_BROWSER === 'true';
const HEADLESS = process.env.OMNI_LEAD_LINKS_BROWSER_HEADLESS !== 'false';
const TIMEOUT_MS = Number(process.env.OMNI_LEAD_LINKS_BROWSER_TIMEOUT_MS) || 45_000;
const RUN_ID = `omni-links-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
const OUTPUT_DIR = path.join(__dirname, '../../output/playwright/omni-lead-links');

function requireIsolatedTarget() {
    assert.equal(ENABLED, true, 'set RUN_OMNI_LEAD_LINKS_BROWSER=true');
    assert.equal(process.env.REQUIRE_ISOLATED_TEST_TARGET, 'true');
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER, 'true');
    assert.ok(TARGET_URL, 'TEST_URL is required');
    assertSafeIsolatedTestUrl(TARGET_URL);
    assert.ok(DATABASE_URL, 'OMNI_LINKS_BROWSER_DATABASE_URL is required');
    assert.notEqual(DATABASE_URL, String(process.env.DATABASE_URL || '').trim(), 'production-style DATABASE_URL fallback is forbidden');
    assertSafeTestDatabaseUrl(DATABASE_URL, process.env);
    assert.ok(process.env.TEST_USER, 'TEST_USER is required');
    assert.ok(process.env.TEST_PASS, 'TEST_PASS is required');
}

function requirePlaywright() {
    try { return require('playwright'); } catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
}

function parseBody(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
}

async function api(routePath, options = {}) {
    const response = await fetch(new URL(routePath, TARGET_URL), {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const body = parseBody(await response.text());
    if (!response.ok) {
        throw new Error(`${options.method || 'GET'} ${routePath} returned ${response.status}: ${body?.error || body?.message || ''}`);
    }
    return body;
}

async function login() {
    const body = await api('/api/auth/login', {
        method: 'POST',
        body: { username: process.env.TEST_USER, password: process.env.TEST_PASS }
    });
    const token = body.accessToken || body.token;
    assert.ok(token, '/api/auth/login returns token');
    assert.ok(body.user?.id, '/api/auth/login returns user');
    return {
        token,
        refreshToken: body.refreshToken || '',
        refreshExpiresAt: body.refreshExpiresAt || '',
        user: body.user
    };
}

function storageState(session) {
    return {
        cookies: [],
        origins: [{
            origin: new URL(TARGET_URL).origin,
            localStorage: [
                { name: 'pzp_token', value: session.token },
                { name: 'pzp_access_token', value: session.token },
                { name: 'pzp_refresh_token', value: session.refreshToken },
                { name: 'pzp_refresh_expires_at', value: String(session.refreshExpiresAt || '') },
                { name: 'pzp_current_user', value: JSON.stringify(session.user) },
                { name: 'pzp_crm_business_context', value: 'event_genix' },
                { name: 'pzp_dark_mode', value: 'false' }
            ]
        }]
    };
}

async function seedFixture(pool) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const origin = (await client.query(
            `INSERT INTO conversations (
                channel, external_id, customer_name, customer_phone, status,
                last_message_at, unread_count, meta, business_context
             ) VALUES ('instagram', $1, $2, $3, 'open', NOW() - INTERVAL '2 hours', 0, '{}'::jsonb, 'event_genix')
             RETURNING id`,
            [`fixture-instagram-${RUN_ID}`, `Legacy Instagram ${RUN_ID}`, '+380000000001']
        )).rows[0];
        const manual = (await client.query(
            `INSERT INTO conversations (
                channel, external_id, customer_name, customer_phone, status,
                last_message_at, unread_count, meta, business_context
             ) VALUES ('telegram', $1, $2, $3, 'open', NOW() - INTERVAL '1 hour', 0, '{}'::jsonb, 'event_genix')
             RETURNING id`,
            [`fixture-telegram-${RUN_ID}`, `Manual Telegram ${RUN_ID}`, '+380000000002']
        )).rows[0];
        const lead = (await client.query(
            `INSERT INTO leads (
                client_name, phone, status, source_channel, external_id, raw_payload, business_context
             ) VALUES ($1, $2, 'new', 'instagram', $3, $4::jsonb, 'event_genix')
             RETURNING id`,
            [`Legacy lead ${RUN_ID}`, '+380999999999', `omni_conv_${origin.id}`, JSON.stringify({ conversationId: origin.id })]
        )).rows[0];
        await client.query(
            `INSERT INTO lead_event_preferences (lead_id, business_context, preferred_date, children_count, adults_count, notes)
             VALUES ($1, 'event_genix', '2099-05-12', 3, 4, 'Preserve isolated preference note')`,
            [lead.id]
        );
        await client.query(
            `UPDATE conversations
                SET meta = jsonb_build_object('lead_id', $2::int, 'leadIds', jsonb_build_array($2::int))
              WHERE id = $1`,
            [origin.id, lead.id]
        );
        await client.query(
            `INSERT INTO conversation_messages (conversation_id, direction, sender_name, content, content_type, created_at)
             VALUES
                ($1, 'inbound', $3, 'Legacy Instagram fixture message', 'text', NOW() - INTERVAL '2 hours'),
                ($2, 'inbound', $4, 'Manual Telegram fixture message', 'text', NOW() - INTERVAL '1 hour')`,
            [origin.id, manual.id, `Legacy Instagram ${RUN_ID}`, `Manual Telegram ${RUN_ID}`]
        );
        await client.query('COMMIT');
        return { leadId: lead.id, originConversationId: origin.id, manualConversationId: manual.id };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function waitForWorkspace(page, leadId, leadName = `Legacy lead ${RUN_ID}`) {
    await page.waitForFunction(({ expectedLeadId, expectedName }) => {
        const panel = document.getElementById('leadWorkspace');
        return panel
            && panel.getAttribute('aria-hidden') === 'false'
            && !panel.hidden
            && document.getElementById('leadWorkspaceBody')?.innerText.includes(expectedName)
            && new URL(location.href).searchParams.get('lead') === String(expectedLeadId);
    }, { expectedLeadId: leadId, expectedName: leadName }, { timeout: TIMEOUT_MS });
}

async function rowWithText(page, text) {
    const row = page.locator('#leadWorkspaceBody .workspace-conversation-row').filter({ hasText: text }).first();
    await row.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
    return row;
}

async function assertWorkspaceLayout(page, label) {
    const layout = await page.locator('#leadWorkspace').evaluate(async panel => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const hero = panel.querySelector('.workspace-hero');
        const parseColor = value => {
            const match = String(value).match(/^rgba?\(([^)]+)\)$/);
            if (!match) throw new Error(`Unsupported computed tab color: ${value}`);
            const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
            return [...parts.slice(0, 3), parts[3] ?? 1];
        };
        const composite = (front, back) => {
            const alpha = front[3] + back[3] * (1 - front[3]);
            if (alpha === 0) return [0, 0, 0, 0];
            return [0, 1, 2].map(index => (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha).concat(alpha);
        };
        const luminance = color => color.slice(0, 3)
            .map(channel => channel / 255)
            .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
            .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
        const tabs = [...panel.querySelectorAll('#leadWorkspaceTabs [role="tab"]')].map(tab => {
            let background = [0, 0, 0, 0];
            let opacity = 1;
            for (let node = tab; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                opacity *= Number(style.opacity);
                if (background[3] >= 1) continue;
                if (style.backgroundImage !== 'none') throw new Error(`Tab contrast requires a flat resolved background: ${tab.dataset.workspaceTab}`);
                background = composite(background, parseColor(style.backgroundColor));
            }
            background = composite(background, [255, 255, 255, 1]);
            const style = getComputedStyle(tab);
            const foreground = composite(parseColor(style.color), background);
            const light = luminance(foreground);
            const dark = luminance(background);
            return {
                tab: tab.dataset.workspaceTab,
                selected: tab.getAttribute('aria-selected') === 'true',
                foreground, background, opacity,
                visible: style.display !== 'none' && style.visibility === 'visible',
                contrast: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05)
            };
        });
        return {
            viewport: { width: innerWidth, height: innerHeight },
            panel: panel.getBoundingClientRect().toJSON(),
            hero: hero.getBoundingClientRect().toJSON(),
            heroContentHeight: hero.scrollHeight,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            tabs
        };
    });
    assert.ok(layout.panel.top >= -1 && layout.panel.bottom <= layout.viewport.height + 1,
        `${label}: workspace is clipped vertically: ${JSON.stringify(layout)}`);
    assert.ok(layout.panel.height > layout.viewport.height * 0.7 && layout.panel.bottom >= layout.viewport.height - 24,
        `${label}: workspace must use the available screen height: ${JSON.stringify(layout)}`);
    assert.ok(layout.hero.height + 1 >= layout.heroContentHeight,
        `${label}: lead identity/actions are clipped inside the hero: ${JSON.stringify(layout)}`);
    assert.ok(layout.panel.left >= -1 && layout.panel.right <= layout.viewport.width + 1 && layout.pageOverflow <= 1,
        `${label}: workspace is clipped horizontally: ${JSON.stringify(layout)}`);
    assert.equal(layout.tabs.length, 4, `${label}: all four workspace tabs are rendered`);
    assert.equal(layout.tabs.filter(tab => tab.selected).length, 1, `${label}: exactly one tab is selected`);
    for (const tab of layout.tabs) {
        assert.ok(tab.visible && tab.opacity >= 0.99, `${label}: tab text is hidden or faded: ${JSON.stringify(tab)}`);
        assert.ok(tab.contrast >= 4.5,
            `${label}: ${tab.selected ? 'selected' : 'unselected'} ${tab.tab} tab text contrast is below 4.5: ${JSON.stringify(tab)}`);
    }
    return layout;
}

async function withDarkTheme(page, action) {
    const original = await page.evaluate(() => {
        const state = {
            bodyDark: document.body.classList.contains('dark-mode'),
            nightAuto: document.body.classList.contains('night-auto'),
            theme: document.documentElement.getAttribute('data-theme'),
            colorScheme: document.documentElement.style.colorScheme,
            appDark: typeof AppState !== 'undefined' ? AppState.darkMode : null
        };
        if (typeof applyCrmThemeMode !== 'function') throw new Error('Shared CRM theme helper is unavailable');
        applyCrmThemeMode(true, false);
        return state;
    });
    try {
        await action();
    } finally {
        await page.evaluate(state => {
            applyCrmThemeMode(state.bodyDark || state.theme === 'dark', false);
            document.body.classList.toggle('dark-mode', state.bodyDark);
            document.body.classList.toggle('night-auto', state.nightAuto);
            if (state.theme === null) document.documentElement.removeAttribute('data-theme');
            else document.documentElement.setAttribute('data-theme', state.theme);
            document.documentElement.style.colorScheme = state.colorScheme;
            if (typeof AppState !== 'undefined') AppState.darkMode = state.appDark;
        }, original);
    }
}

async function captureDarkDetails(page, filename, label) {
    await withDarkTheme(page, async () => {
        await assertWorkspaceLayout(page, label);
        await page.screenshot({ path: path.join(OUTPUT_DIR, filename), fullPage: false });
    });
}

async function assertEditorAppearance(page, label) {
    const controls = await page.locator('#leadEditorForm').evaluate(async form => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        // Measure the settled theme; shared form controls animate their colors.
        const transitions = form.getAnimations({ subtree: true }).filter(animation =>
            Number.isFinite(animation.effect?.getComputedTiming().endTime));
        await Promise.allSettled(transitions.map(animation => animation.finished));
        const parseColor = value => {
            const match = String(value).match(/^rgba?\(([^)]+)\)$/);
            if (!match) throw new Error(`Unsupported editor color: ${value}`);
            const values = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
            return [...values.slice(0, 3), values[3] ?? 1];
        };
        const composite = (front, back) => {
            const alpha = front[3] + back[3] * (1 - front[3]);
            if (!alpha) return [0, 0, 0, 0];
            return [0, 1, 2].map(index => (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha).concat(alpha);
        };
        const luminance = color => color.slice(0, 3).map(channel => channel / 255)
            .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
            .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
        return [...form.querySelectorAll('input,select,textarea')].filter(control => control.getClientRects().length && !control.disabled).map(control => {
            const style = getComputedStyle(control);
            let background = [0, 0, 0, 0];
            for (let node = control; node && background[3] < 1; node = node.parentElement) {
                background = composite(background, parseColor(getComputedStyle(node).backgroundColor));
            }
            background = composite(background, [255, 255, 255, 1]);
            const foreground = composite(parseColor(style.color), background);
            const fg = luminance(foreground), bg = luminance(background);
            return {
                id: control.id || control.dataset.celebrantField,
                select: control.tagName === 'SELECT', foreground, background,
                contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
                backgroundImage: style.backgroundImage,
                sizes: style.backgroundSize.split(',').map(value => value.trim()),
                repeats: style.backgroundRepeat.split(',').map(value => value.trim())
            };
        });
    });
    assert.ok(controls.some(control => control.select), `${label}: editor selects are visible`);
    for (const control of controls) {
        assert.ok(control.contrast >= 4.5, `${label}: input text must retain 4.5 contrast: ${JSON.stringify(control)}`);
        if (!control.select) continue;
        assert.match(control.backgroundImage, /linear-gradient/, `${label}: ${control.id} retains its shared dropdown arrow`);
        assert.equal(control.sizes.length, 2, `${label}: ${control.id} uses the two shared arrow layers`);
        for (const size of control.sizes) {
            const dimensions = size.split(/\s+/);
            assert.equal(dimensions.length, 2);
            assert.ok(dimensions.every(value => /^\d+(\.\d+)?px$/.test(value) && Number.parseFloat(value) > 0 && Number.parseFloat(value) <= 16),
                `${label}: arrow layers must stay small rather than cover the select: ${JSON.stringify(control)}`);
        }
        assert.ok(control.repeats.every(value => value === 'no-repeat'), `${label}: select arrows must not repeat: ${JSON.stringify(control)}`);
    }
}

async function assertLinkState(pool, fixture) {
    const rows = (await pool.query(
        `SELECT conversation_id, is_origin, is_primary, source
           FROM lead_conversation_links
          WHERE business_context = 'event_genix' AND lead_id = $1
          ORDER BY conversation_id`,
        [fixture.leadId]
    )).rows;
    assert.deepEqual(rows, [
        {
            conversation_id: fixture.originConversationId,
            is_origin: true,
            is_primary: false,
            source: 'omni_legacy_transition'
        },
        {
            conversation_id: fixture.manualConversationId,
            is_origin: false,
            is_primary: true,
            source: 'lead_workspace_manual'
        }
    ]);
}

async function checkEmbeddedEditor(page, pool, fixture) {
    const detailsTab = page.locator('#leadWorkspaceTabs [data-workspace-tab="details"]');
    const communicationsTab = page.locator('#leadWorkspaceTabs [data-workspace-tab="communications"]');
    const editor = page.locator('#leadWorkspaceEditorHost #leadEditorForm');
    const patches = [];
    const trackPatch = request => {
        if (request.method() === 'PATCH' && new URL(request.url()).pathname === `/api/leads/${fixture.leadId}`) {
            patches.push(request.postDataJSON());
        }
    };
    page.on('request', trackPatch);
    try {
        await detailsTab.click();
        await page.locator('#leadWorkspacePanel-details').getByRole('button', { name: 'Редагувати', exact: true }).click();
        await editor.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        assert.equal(await page.locator('#leadEditorForm').count(), 1, 'create and edit share exactly one form');
        assert.equal(await page.locator('#leadModal.active').count(), 0, 'editing stays inside the lead workspace');
        const draft = `Edited isolated lead note ${RUN_ID}`;
        await page.locator('#leadNotes').fill(draft);
        await communicationsTab.click();
        await detailsTab.click();
        assert.equal(await page.locator('#leadNotes').inputValue(), draft, 'tabs preserve the active editor draft');
        await assertEditorAppearance(page, 'light desktop editor');
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'desktop-inline-lead-editor.png'), fullPage: false });
        await withDarkTheme(page, async () => {
            await assertEditorAppearance(page, 'dark desktop editor');
            await page.screenshot({ path: path.join(OUTPUT_DIR, 'dark-desktop-inline-lead-editor.png'), fullPage: false });
        });
        const saved = page.waitForResponse(res => res.request().method() === 'PATCH'
            && new URL(res.url()).pathname === `/api/leads/${fixture.leadId}`);
        await page.locator('#leadModalSave').evaluate(button => { button.click(); button.click(); });
        assert.equal((await saved).ok(), true);
        await editor.waitFor({ state: 'detached', timeout: TIMEOUT_MS });
        assert.equal(patches.length, 1, 'two save clicks produce one mutation');
        assert.equal(patches[0].notes, draft);
        for (const key of ['eventPreference', 'celebrants', 'source', 'phone', 'pipeline_stage', 'lead_type']) {
            assert.equal(Object.hasOwn(patches[0], key), false, `unchanged ${key} is omitted from the real PATCH`);
        }
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, fixture.leadId);
        assert.ok((await page.locator('#leadWorkspacePanel-details').innerText()).includes(draft), 'saved edit survives reload');
        await page.locator('#leadWorkspacePanel-details').getByRole('button', { name: 'Редагувати', exact: true }).click();
        await editor.waitFor({ state: 'visible' });
        await page.locator('#leadAdultsCount').fill('12');
        const guestsSaved = page.waitForResponse(res => res.request().method() === 'PATCH'
            && new URL(res.url()).pathname === `/api/leads/${fixture.leadId}`);
        await page.locator('#leadModalSave').click();
        assert.equal((await guestsSaved).ok(), true);
        await editor.waitFor({ state: 'detached', timeout: TIMEOUT_MS });
        const persisted = (await pool.query(
            `SELECT l.notes, l.source_channel, l.external_id, p.adults_count, p.children_count, p.notes AS preference_notes
               FROM leads l JOIN lead_event_preferences p ON p.lead_id = l.id AND p.business_context = l.business_context
              WHERE l.id = $1 AND l.business_context = 'event_genix'`, [fixture.leadId]
        )).rows[0];
        assert.equal(persisted.notes, draft);
        assert.equal(persisted.source_channel, 'instagram');
        assert.equal(persisted.external_id, `omni_conv_${fixture.originConversationId}`);
        assert.equal(persisted.adults_count, 12);
        assert.equal(persisted.children_count, 3);
        assert.equal(persisted.preference_notes, 'Preserve isolated preference note');
        await communicationsTab.click();
    } finally {
        page.off('request', trackPatch);
    }
}

async function checkSharedCreateForm(page, pool, fixture, expectedApiFailures) {
    await page.locator('#leadWorkspaceClose').click();
    await page.locator('#addLeadBtn').click();
    await page.locator('#leadModal.active #leadEditorForm').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#leadEditorForm').count(), 1);
    assert.equal(await page.locator('#leadCreateEditorHost #leadEditorForm').count(), 1);
    const name = `Created isolated lead ${RUN_ID}`;
    await page.locator('#leadName').fill(name);
    await page.locator('#leadPhone').fill('+380000000003');
    await page.locator('#leadEventDate').fill('2099-06-15');
    await page.locator('#leadChildrenCount').fill('2');
    await page.locator('#leadAdultsCount').fill('5');
    await page.locator('#leadNotes').fill('Created through shared editor');
    const createPath = url => url.origin === new URL(TARGET_URL).origin && url.pathname === '/api/leads';
    let createPostCount = 0;
    let releaseCreateResponse;
    const responseGate = new Promise(resolve => { releaseCreateResponse = resolve; });
    let resolveRealCreate;
    let rejectRealCreate;
    const realCreateReady = new Promise((resolve, reject) => { resolveRealCreate = resolve; rejectRealCreate = reject; });
    realCreateReady.catch(() => {});
    const holdTimeout = setTimeout(() => rejectRealCreate(new Error('Real create response did not arrive in time')), TIMEOUT_MS);
    const holdCreateResponse = async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        createPostCount += 1;
        try {
            const response = await route.fetch();
            resolveRealCreate(response);
            await responseGate;
            await route.fulfill({ response });
        } catch (error) {
            rejectRealCreate(error);
            throw error;
        }
    };
    await page.route(createPath, holdCreateResponse);
    let res;
    try {
        const browserResponse = page.waitForResponse(response => response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/leads', { timeout: TIMEOUT_MS });
        browserResponse.catch(() => {});
        await page.locator('#leadModalSave').click();
        const realResponse = await realCreateReady;
        clearTimeout(holdTimeout);
        assert.equal(realResponse.ok(), true, 'the held response comes from a successful real API create');
        assert.equal(await page.locator('#leadModalSave').isDisabled(), true, 'Save is disabled while the real create response is pending');
        assert.equal(await page.locator('#leadEditorForm').getAttribute('aria-busy'), 'true');
        // The native second click is blocked by disabled. Also deliver a queued
        // click to the real handler to exercise its in-flight guard independently.
        await page.locator('#leadModalSave').evaluate(button => {
            button.click();
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(createPostCount, 1, 'repeated create submit while pending emits exactly one POST');
        assert.equal((await pool.query(`SELECT COUNT(*)::int AS count FROM leads WHERE client_name=$1 AND business_context='event_genix'`, [name])).rows[0].count, 1,
            'the real API persisted one lead while the browser response remains held');
        releaseCreateResponse();
        res = await browserResponse;
    } catch (error) {
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'create-submit-failure.png'), fullPage: false });
        const state = await page.evaluate(() => ({
            disabled: document.getElementById('leadModalSave')?.disabled,
            busy: document.getElementById('leadEditorForm')?.getAttribute('aria-busy'),
            invalid: Array.from(document.querySelectorAll('#leadEditorForm :invalid')).map(node => ({ id: node.id, message: node.validationMessage })),
            visibleDialogs: Array.from(document.querySelectorAll('[role="dialog"],.confirm-overlay,.lead-reason-modal')).filter(node => node.getBoundingClientRect().height > 0).map(node => node.innerText),
            notifications: Array.from(document.querySelectorAll('.toast,.notification')).map(node => node.innerText)
        }));
        throw new Error(`Isolated create submit failed: ${JSON.stringify(state)}`, { cause: error });
    } finally {
        clearTimeout(holdTimeout);
        releaseCreateResponse();
        await page.unroute(createPath, holdCreateResponse);
    }
    assert.equal(res.ok(), true);
    const created = await res.json();
    const leadId = Number(created.lead?.id);
    assert.ok(Number.isInteger(leadId) && leadId > 0);
    await page.locator('#leadModal.active').waitFor({ state: 'detached', timeout: TIMEOUT_MS });
    const count = (await pool.query(`SELECT COUNT(*)::int AS count FROM leads WHERE client_name = $1 AND business_context = 'event_genix'`, [name])).rows[0].count;
    assert.equal(count, 1);
    assert.equal(createPostCount, 1, 'one create POST and one lead remain after releasing the real response');
    process.stdout.write('[omni-ui4] pending create blocks repeat submit: one real POST and one database lead\n');
    // The filtered list intentionally excludes the lead; editing must resolve its ID.
    await page.goto(`${TARGET_URL}/sales-funnel?lead=${leadId}&leadTab=details&search=not-listed-${RUN_ID}`, { waitUntil: 'domcontentloaded' });
    await waitForWorkspace(page, leadId, name);
    await page.locator('#leadWorkspacePanel-details').getByRole('button', { name: 'Редагувати', exact: true }).click();
    await page.locator('#leadWorkspaceEditorHost #leadEditorForm').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#leadName').inputValue(), name);
    await page.locator('#leadNotes').fill('Edited by direct ID outside the filtered list');
    await page.locator('#leadPhone').fill('+380000000004');
    await page.locator('#leadInstagram').fill('isolated_editor_fixture');
    await page.locator('#leadSource').selectOption('recommendation');
    await page.locator('#leadEventDate').fill('2099-06-16');
    await page.locator('#leadPipelineStage').selectOption('contacted');
    const assignedTo = await page.locator('#leadAssignedTo option').evaluateAll(options => options.find(option => Number(option.value) > 0)?.value);
    assert.ok(assignedTo, 'isolated fixture provides an existing assignee');
    await page.locator('#leadAssignedTo').selectOption(assignedTo);
    const childRows = page.locator('#leadCelebrantsRows [data-celebrant-row]');
    await childRows.first().locator('[data-celebrant-field="name"]').fill('Isolated child one');
    await childRows.first().locator('[data-celebrant-field="birthday"]').fill('2091-06-16');
    await childRows.first().locator('[data-celebrant-field="age"]').fill('8');
    await childRows.first().locator('[data-celebrant-field="notes"]').fill('First child fixture note');
    await page.locator('[data-celebrants-action="add"][data-target="leadCelebrants"]').click();
    await childRows.nth(1).locator('[data-celebrant-field="name"]').fill('Isolated child two');
    await childRows.nth(1).locator('[data-celebrant-field="birthday"]').fill('2093-06-16');
    await childRows.nth(1).locator('[data-celebrant-field="age"]').fill('6');
    const leadPath = `/api/leads/${leadId}`;
    const patchMatcher = url => new URL(url).pathname === leadPath;
    // Exercise the real API's validation, as if an assignee became invalid since load.
    expectedApiFailures.push({ method: 'PATCH', pathname: leadPath, status: 400, remaining: 1 });
    await page.route(patchMatcher, route => route.request().method() === 'PATCH'
        ? route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), assigned_to: -1 }) })
        : route.continue());
    const validation = page.waitForResponse(result => result.request().method() === 'PATCH' && new URL(result.url()).pathname === leadPath);
    await page.locator('#leadModalSave').click();
    assert.equal((await validation).status(), 400);
    await page.waitForFunction(() => !document.getElementById('leadModalSave')?.disabled);
    assert.equal(await page.locator('#leadNotes').inputValue(), 'Edited by direct ID outside the filtered list');
    assert.equal(await page.locator('#leadWorkspaceEditorHost #leadEditorForm').count(), 1);
    await page.unroute(patchMatcher);
    await page.route(patchMatcher, route => route.request().method() === 'PATCH' ? route.abort('connectionfailed') : route.continue());
    const networkFailure = page.waitForEvent('requestfailed', { predicate: request => request.method() === 'PATCH' && new URL(request.url()).pathname === leadPath });
    await page.locator('#leadModalSave').click();
    await networkFailure;
    await page.waitForFunction(() => !document.getElementById('leadModalSave')?.disabled);
    assert.equal(await page.locator('#leadNotes').inputValue(), 'Edited by direct ID outside the filtered list');
    assert.equal((await pool.query('SELECT notes FROM leads WHERE id = $1', [leadId])).rows[0].notes, 'Created through shared editor', 'failed attempts do not write the draft');
    await page.unroute(patchMatcher);
    const saved = page.waitForResponse(result => result.request().method() === 'PATCH'
        && new URL(result.url()).pathname === `/api/leads/${leadId}`);
    await page.locator('#leadModalSave').click();
    assert.equal((await saved).ok(), true);
    await page.locator('#leadWorkspaceEditorHost #leadEditorForm').waitFor({ state: 'detached', timeout: TIMEOUT_MS });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForWorkspace(page, leadId, name);
    assert.ok((await page.locator('#leadWorkspacePanel-details').innerText()).includes('Edited by direct ID outside the filtered list'));
    const persisted = (await pool.query(
        `SELECT l.notes, l.phone, l.instagram, l.source, l.assigned_to, l.pipeline_stage, l.celebrants,
                p.preferred_date::text, p.children_count, p.adults_count FROM leads l
         JOIN lead_event_preferences p ON p.lead_id = l.id AND p.business_context = l.business_context
         WHERE l.id = $1 AND l.business_context = 'event_genix'`, [leadId]
    )).rows[0];
    assert.equal(persisted.children_count, 2);
    assert.equal(persisted.adults_count, 5);
    assert.equal(persisted.notes, 'Edited by direct ID outside the filtered list');
    assert.equal(persisted.phone, '+380000000004');
    assert.equal(persisted.instagram, 'isolated_editor_fixture');
    assert.equal(persisted.source, 'recommendation');
    assert.equal(persisted.assigned_to, Number(assignedTo));
    assert.equal(persisted.pipeline_stage, 'contacted');
    assert.equal(persisted.preferred_date, '2099-06-16');
    assert.equal(persisted.celebrants.length, 2);
    assert.equal(persisted.celebrants[0].name, 'Isolated child one');
    assert.equal(persisted.celebrants[0].notes, 'First child fixture note');
    assert.equal(persisted.celebrants[1].birthday, '2093-06-16');
    await page.locator('#leadWorkspacePanel-details').getByRole('button', { name: 'Редагувати', exact: true }).click();
    await page.locator('#leadWorkspaceEditorHost #leadEditorForm').waitFor({ state: 'visible' });
    await page.locator('#leadLeadType').selectOption('informational');
    await page.locator('#leadModalSave').click();
    await page.locator('#lostReasonModal.active').waitFor({ state: 'visible' });
    await page.locator('#lostReasonSelect').selectOption('На майбутнє');
    const typeSaved = page.waitForResponse(result => result.request().method() === 'PATCH' && new URL(result.url()).pathname === leadPath);
    await page.locator('#lostReasonModal').getByRole('button', { name: 'Зберегти', exact: true }).click();
    assert.equal((await typeSaved).ok(), true);
    await page.locator('#leadWorkspaceEditorHost #leadEditorForm').waitFor({ state: 'detached', timeout: TIMEOUT_MS });
    const classified = (await pool.query('SELECT lead_type, lost_reason FROM leads WHERE id = $1', [leadId])).rows[0];
    assert.equal(classified.lead_type, 'informational');
    assert.match(classified.lost_reason, /На майбутнє/);
    await checkMobileEditor(page, pool, leadId, name);
    await page.goto(`${TARGET_URL}/sales-funnel?lead=${fixture.leadId}&leadTab=communications`, { waitUntil: 'domcontentloaded' });
    await waitForWorkspace(page, fixture.leadId);
}

async function checkMobileEditor(page, pool, leadId, name) {
    for (const height of [844, 420]) {
        await page.setViewportSize({ width: 390, height });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, leadId, name);
        await page.locator('#leadWorkspaceTabs [data-workspace-tab="details"]').click();
        await page.locator('#leadWorkspacePanel-details').getByRole('button', { name: 'Редагувати', exact: true }).click();
        await page.locator('#leadWorkspaceEditorHost #leadEditorForm').waitFor({ state: 'visible' });
        if (height === 844) {
            await page.locator('#leadName').scrollIntoViewIfNeeded();
            await assertEditorAppearance(page, 'light mobile editor');
            await page.screenshot({ path: path.join(OUTPUT_DIR, 'mobile-inline-lead-editor-top.png'), fullPage: false });
            await withDarkTheme(page, async () => {
                await assertEditorAppearance(page, 'dark mobile editor');
                await page.screenshot({ path: path.join(OUTPUT_DIR, 'dark-mobile-inline-lead-editor-top.png'), fullPage: false });
            });
        }
        await page.locator('#leadNotes').fill(`Discard mobile ${height}`);
        await page.locator('#leadModalSave').scrollIntoViewIfNeeded();
        const bounds = await page.evaluate(() => {
            const rect = id => {
                const r = document.getElementById(id).getBoundingClientRect();
                return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
            };
            return { viewport: { width: innerWidth, height: innerHeight }, card: rect('leadWorkspace'), save: rect('leadModalSave'), cancel: rect('leadModalCancel') };
        });
        for (const [key, rect] of Object.entries(bounds).filter(([key]) => key !== 'viewport')) {
            assert.ok(rect.left >= -1 && rect.right <= 391, `${height}px ${key} fits the viewport width: ${JSON.stringify(bounds)}`);
        }
        for (const key of ['save', 'cancel']) {
            assert.ok(bounds[key].top >= 0 && bounds[key].bottom <= height + 1 && bounds[key].height >= 44, `${height}px ${key} remains reachable: ${JSON.stringify(bounds)}`);
        }
        await page.locator('#leadModalCancel').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'leadModalSave', 'keyboard reaches Save from Cancel');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'leadModalCancel');
        await page.screenshot({ path: path.join(OUTPUT_DIR, `mobile-${height}-inline-lead-editor.png`), fullPage: false });
        await page.keyboard.press('Enter');
        await page.locator('.confirm-overlay').waitFor({ state: 'visible' });
        await page.locator('.confirm-overlay').getByRole('button', { name: 'Повернутись', exact: true }).click();
        assert.equal(await page.locator('#leadNotes').inputValue(), `Discard mobile ${height}`);
        await page.locator('#leadModalCancel').click();
        await page.locator('.confirm-overlay').getByRole('button', { name: 'Закрити без збереження', exact: true }).click();
        await page.locator('#leadWorkspaceEditorHost #leadEditorForm').waitFor({ state: 'detached' });
        assert.equal((await pool.query('SELECT notes FROM leads WHERE id = $1', [leadId])).rows[0].notes, 'Edited by direct ID outside the filtered list');
    }
    await page.setViewportSize({ width: 1366, height: 900 });
}

async function main() {
    requireIsolatedTarget();
    const { chromium } = requirePlaywright();
    const pool = new Pool({ connectionString: DATABASE_URL, max: 4, connectionTimeoutMillis: 10_000 });
    const fixture = await seedFixture(pool);
    const session = await login();
    const browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
        serviceWorkers: 'block',
        storageState: storageState(session)
    });
    await context.route('https://www.clarity.ms/**', route => route.fulfill({ status: 204, body: '' }));
    await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 204, body: '' }));
    await context.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 204, body: '' }));
    const page = await context.newPage();
    const criticalFailures = [];
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const expectedApiFailures = [];
    const linkRequests = [];
    const leadMutations = [];
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.origin === new URL(TARGET_URL).origin
            && /^\/api\/(leads|customers|omni)\b/.test(url.pathname)
            && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
            leadMutations.push(`${request.method()} ${url.pathname}`);
        }
        if (request.method() === 'POST' && url.pathname === `/api/leads/${fixture.leadId}/conversation-links`) {
            linkRequests.push(url.pathname);
        }
    });
    page.on('response', response => {
        if (response.status() < 400) return;
        const url = new URL(response.url());
        if (url.origin !== new URL(TARGET_URL).origin) return;
        if (/^\/api\/(leads|omni|auth)\b/.test(url.pathname)) {
            const expected = expectedApiFailures.find(item => item.remaining > 0 && item.method === response.request().method()
                && item.pathname === url.pathname && item.status === response.status());
            if (expected) { expected.remaining -= 1; return; }
            criticalFailures.push(`${response.request().method()} ${url.pathname} returned ${response.status()}`);
        }
    });

    try {
        await page.goto(`${TARGET_URL}/sales-funnel`, { waitUntil: 'domcontentloaded' });
        const leadRow = page.locator(`#leadsTableBody [data-lead-id="${fixture.leadId}"]`);
        await leadRow.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        assert.equal(await leadRow.getByRole('button', { name: /^(Кейс|Деталі)$/ }).count(), 0,
            'the list does not expose competing Case and Details entry points');
        await leadRow.getByRole('button', { name: 'Відкрити лід', exact: true }).click();
        await waitForWorkspace(page, fixture.leadId);

        const overviewTab = page.locator('#leadWorkspaceTabs [data-workspace-tab="overview"]');
        const detailsTab = page.locator('#leadWorkspaceTabs [data-workspace-tab="details"]');
        const communicationsTab = page.locator('#leadWorkspaceTabs [data-workspace-tab="communications"]');
        await overviewTab.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        assert.equal(await overviewTab.getAttribute('aria-selected'), 'true');
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        await assertWorkspaceLayout(page, 'desktop overview');
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'desktop-lead-overview.png'), fullPage: false });
        await page.locator('#leadWorkspaceClose').focus();
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.getElementById('leadWorkspace').contains(document.activeElement)
            && document.activeElement.id !== 'leadWorkspaceClose'), true, 'reverse Tab stays within the lead workspace');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'leadWorkspaceClose', 'Tab wraps back to the close control');
        await overviewTab.focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.activeElement?.dataset.workspaceTab === 'details');
        await page.keyboard.press('Enter');
        await page.locator('#leadWorkspacePanel-details').waitFor({ state: 'visible' });
        assert.equal(await detailsTab.getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('#leadWorkspacePanel-details input, #leadWorkspacePanel-details textarea, #leadWorkspacePanel-details select').count(), 0,
            'Details is a read-only viewer until editing is explicitly requested');
        await captureDarkDetails(page, 'dark-desktop-lead-details.png', 'dark desktop details');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, fixture.leadId);
        await detailsTab.click();
        await page.locator('#leadWorkspacePanel-details').waitFor({ state: 'visible' });
        await page.evaluate(() => {
            document.getElementById('leadWorkspace').scrollTop = 0;
            document.getElementById('leadWorkspaceBody').scrollTop = 0;
        });
        await assertWorkspaceLayout(page, 'mobile details');
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'mobile-lead-details.png'), fullPage: false });
        await captureDarkDetails(page, 'dark-mobile-lead-details.png', 'dark mobile details');
        await page.setViewportSize({ width: 1366, height: 900 });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, fixture.leadId);
        await communicationsTab.click();
        await page.locator('#leadWorkspacePanel-communications').waitFor({ state: 'visible' });
        assert.equal(new URL(page.url()).searchParams.get('leadTab'), 'communications');
        assert.deepEqual(leadMutations, [], 'opening a lead and switching tabs must not mutate leads, customers, or conversations');
        await checkEmbeddedEditor(page, pool, fixture);
        await checkSharedCreateForm(page, pool, fixture, expectedApiFailures);
        await checkLeadEditorModes({ page, pool, targetUrl: TARGET_URL, runId: RUN_ID, timeoutMs: TIMEOUT_MS, waitForWorkspace });
        await checkLeadEditorNavigation({ page, pool, targetUrl: TARGET_URL, runId: RUN_ID, timeoutMs: TIMEOUT_MS, waitForWorkspace, fixture });

        const originRow = await rowWithText(page, `Legacy Instagram ${RUN_ID}`);
        assert.match(await originRow.innerText(), /Instagram/);
        assert.match(await originRow.innerText(), /Джерело ліда/);
        assert.match(await originRow.innerText(), /Основний/);
        const instagramLink = page.getByRole('link', { name: 'Відкрити Instagram', exact: true }).first();
        const instagramHref = new URL(await instagramLink.getAttribute('href'), page.url());
        assert.equal(instagramHref.searchParams.get('businessContext'), 'event_genix', 'the handoff explicitly selects the source business');
        assert.equal(instagramHref.searchParams.get('conversation'), String(fixture.originConversationId));
        await instagramLink.click();
        await page.locator('#omniChatName').filter({ hasText: `Legacy Instagram ${RUN_ID}` }).waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        const openedConversation = new URL(page.url());
        assert.equal(openedConversation.pathname, '/omni');
        assert.equal(openedConversation.searchParams.get('conversation'), String(fixture.originConversationId));
        // Omni's getOmniBusinessContext delegates to this shared runtime. api.js
        // removes the default-business query parameter when canonicalizing scope.
        const activeOmniContext = await page.evaluate(() => window.CrmBusinessContext.current());
        assert.equal(activeOmniContext, 'event_genix', 'Omni uses the explicitly requested business after navigation');
        assert.ok([null, activeOmniContext].includes(openedConversation.searchParams.get('businessContext')),
            'only canonical omission of the verified default business is accepted');
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, fixture.leadId);
        assert.equal(await communicationsTab.getAttribute('aria-selected'), 'true', 'returning from the actual Instagram link restores Communications');
        await page.locator('#leadWorkspacePanel-communications').waitFor({ state: 'visible' });

        await page.getByRole('button', { name: 'Прив’язати діалог', exact: true }).last().click();
        await page.locator('#leadConversationLinkModal.active').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.locator('#leadConversationSearch').fill(`Manual Telegram ${RUN_ID}`);
        await page.waitForResponse(response => new URL(response.url()).pathname === '/api/omni/conversations' && response.ok());
        await page.locator('#leadConversationSelect').selectOption(String(fixture.manualConversationId));
        await page.locator('#leadConversationLinkSubmit').evaluate(button => {
            button.click();
            button.click();
        });
        await page.waitForFunction(expected => document.getElementById('leadWorkspaceBody')?.innerText.includes(expected), `Manual Telegram ${RUN_ID}`, { timeout: TIMEOUT_MS });
        assert.equal(linkRequests.length, 1, 'repeated submit emits one manual-link request');

        await detailsTab.click();
        await page.locator('#leadWorkspacePanel-details').getByRole('button', { name: 'Редагувати', exact: true }).click();
        await page.locator('#leadWorkspaceEditorHost #leadEditorForm').waitFor({ state: 'visible' });
        await page.locator('#leadNotes').fill('Draft survives a primary-conversation refresh');
        await communicationsTab.click();

        const manualRow = await rowWithText(page, `Manual Telegram ${RUN_ID}`);
        assert.doesNotMatch(await manualRow.innerText(), /Основний/);
        const makePrimaryResponse = page.waitForResponse(response => {
            const url = new URL(response.url());
            return response.request().method() === 'POST'
                && url.pathname === `/api/leads/${fixture.leadId}/conversation-links/${fixture.manualConversationId}/make-primary`;
        }, { timeout: TIMEOUT_MS });
        await manualRow.getByRole('button', { name: 'Зробити основним', exact: true }).click();
        assert.equal((await makePrimaryResponse).ok(), true, 'make-primary API succeeds');
        await page.waitForFunction(expected => {
            const rows = Array.from(document.querySelectorAll('#leadWorkspaceBody .workspace-conversation-row'));
            return rows.some(row => row.innerText.includes(expected) && row.innerText.includes('Основний'));
        }, `Manual Telegram ${RUN_ID}`, { timeout: TIMEOUT_MS });

        await detailsTab.click();
        assert.equal(await page.locator('#leadNotes').inputValue(), 'Draft survives a primary-conversation refresh');
        assert.equal(await page.locator('#leadWorkspaceEditorHost #leadEditorForm').count(), 1);
        await page.locator('#leadModalCancel').click();
        await page.locator('.confirm-overlay').getByRole('button', { name: 'Закрити без збереження', exact: true }).click();
        await page.locator('#leadWorkspaceEditorHost #leadEditorForm').waitFor({ state: 'detached' });
        await communicationsTab.click();

        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, fixture.leadId);
        assert.equal(await communicationsTab.getAttribute('aria-selected'), 'true', 'reload preserves the selected tab');
        await page.locator('#leadWorkspacePanel-communications').waitFor({ state: 'visible' });
        assert.match(await (await rowWithText(page, `Legacy Instagram ${RUN_ID}`)).innerText(), /Джерело ліда/);
        assert.doesNotMatch(await (await rowWithText(page, `Legacy Instagram ${RUN_ID}`)).innerText(), /Основний/);
        assert.match(await (await rowWithText(page, `Manual Telegram ${RUN_ID}`)).innerText(), /Основний/);
        await assertLinkState(pool, fixture);
        const beforeContactEdit = (await pool.query('SELECT external_id, source_channel, raw_payload FROM leads WHERE id = $1', [fixture.leadId])).rows[0];

        await detailsTab.click();
        await page.locator('#leadWorkspacePanel-details').getByRole('button', { name: 'Редагувати', exact: true }).click();
        await page.locator('#leadWorkspaceEditorHost #leadEditorForm').waitFor({ state: 'visible' });
        await page.locator('#leadNotes').fill('Edit after canonical links were confirmed');
        await page.locator('#leadPhone').fill('+380000000005');
        const canonicalEdit = page.waitForResponse(result => result.request().method() === 'PATCH'
            && new URL(result.url()).pathname === `/api/leads/${fixture.leadId}`);
        await page.locator('#leadModalSave').click();
        assert.equal((await canonicalEdit).ok(), true);
        await page.locator('#leadWorkspaceEditorHost #leadEditorForm').waitFor({ state: 'detached' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForWorkspace(page, fixture.leadId);
        await assertLinkState(pool, fixture);
        const afterContactEdit = (await pool.query('SELECT external_id, source_channel, raw_payload FROM leads WHERE id = $1', [fixture.leadId])).rows[0];
        assert.deepEqual(afterContactEdit, beforeContactEdit, 'contact edits preserve legacy source evidence as well as canonical origin/primary');
        assert.equal((await pool.query('SELECT phone FROM leads WHERE id = $1', [fixture.leadId])).rows[0].phone, '+380000000005');
        await communicationsTab.click();

        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'desktop-lead-links.png'), fullPage: false });

        const filteredDirectUrl = `${TARGET_URL}/omni?conversation=${fixture.manualConversationId}&channel=instagram&status=closed&search=no-match-${RUN_ID}`;
        await page.goto(filteredDirectUrl, { waitUntil: 'domcontentloaded' });
        await page.locator('#omniChatName').filter({ hasText: `Manual Telegram ${RUN_ID}` }).waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        assert.equal(await page.locator('#omniChannelSelect').inputValue(), 'instagram');
        assert.equal(await page.locator('#omniStatusSelect').inputValue(), 'closed');
        assert.equal(await page.locator('#omniSearch').inputValue(), `no-match-${RUN_ID}`);
        assert.equal(new URL(page.url()).searchParams.get('conversation'), String(fixture.manualConversationId));

        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('#omniChatName').filter({ hasText: `Manual Telegram ${RUN_ID}` }).waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        await page.locator('#omniMobileBack').waitFor({ state: 'visible', timeout: TIMEOUT_MS });
        const mobileLayout = await page.locator('#omniContainer').evaluate(node => ({
            view: node.getAttribute('data-mobile-view'),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        }));
        assert.equal(mobileLayout.view, 'conversation');
        assert.ok(mobileLayout.overflow <= 1, `mobile Omni viewport overflows: ${JSON.stringify(mobileLayout)}`);
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'mobile-direct-open.png'), fullPage: true });
        await page.locator('#omniMobileBack').click();
        await page.waitForFunction(() => document.getElementById('omniContainer')?.getAttribute('data-mobile-view') === 'list');
        await page.locator(`.omni-conv-item[data-id="${fixture.manualConversationId}"]`).waitFor({ state: 'visible', timeout: TIMEOUT_MS });

        const omniNavigation = await checkOmniWorkspaceNavigation({ page, pool, targetUrl: TARGET_URL, runId: RUN_ID,
            timeoutMs: TIMEOUT_MS, outputDir: OUTPUT_DIR, fixture, expectedApiFailures, waitForWorkspace });
        const communicationSelection = await checkLeadCommunicationSelection({ page, pool, targetUrl: TARGET_URL, runId: RUN_ID,
            timeoutMs: TIMEOUT_MS, outputDir: OUTPUT_DIR, waitForWorkspace });
        assert.deepEqual(criticalFailures, [], `unexpected critical API failures: ${criticalFailures.join('; ')}`);
        assert.deepEqual(pageErrors, [], 'no unhandled browser errors');
        assert.ok(expectedApiFailures.every(item => item.remaining === 0), 'each declared validation response was actually exercised');
        process.stdout.write(JSON.stringify({
            success: true,
            leadId: fixture.leadId,
            originConversationId: fixture.originConversationId,
            primaryConversationId: fixture.manualConversationId,
            omniNavigation: { success: omniNavigation.success, viewports: omniNavigation.viewports, backendOmniWrites: omniNavigation.backendOmniWrites },
            communicationSelection,
            screenshots: ['desktop-lead-overview.png', 'dark-desktop-lead-details.png', 'mobile-lead-details.png', 'dark-mobile-lead-details.png', 'desktop-inline-lead-editor.png', 'dark-desktop-inline-lead-editor.png', 'mobile-inline-lead-editor-top.png', 'dark-mobile-inline-lead-editor-top.png', 'mobile-844-inline-lead-editor.png', 'mobile-420-inline-lead-editor.png', 'desktop-lead-links.png', 'mobile-direct-open.png']
        }) + '\n');
    } finally {
        await browser.close().catch(() => {});
        await pool.end().catch(() => {});
    }
}

main().catch(error => {
    process.stderr.write(`[omni-lead-links-browser] ${error.stack || error.message}\n`);
    process.exitCode = 1;
});
