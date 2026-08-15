#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HEADLESS = process.env.BANQUET_WS_BROWSER_SMOKE_HEADLESS !== 'false';
const WS_CLIENT_CODE = fs.readFileSync(path.join(ROOT, 'js', 'ws.js'), 'utf8');

function requirePlaywright() {
    try {
        return require('playwright');
    } catch (err) {
        const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
        for (const entry of pathEntries) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const nodeModulesDir = path.dirname(normalized);
            const packageDir = path.join(nodeModulesDir, 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw err;
    }
}

function createHarnessServer() {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><body><main id="app"></main></body></html>');
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
        });
    });
}

function closeServer(server) {
    return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
    });
}

async function installWsHarness(page, url) {
    await page.goto(url);
    await page.evaluate(() => {
        window.__banquetWsSmoke = {
            dateInvalidations: [],
            previewInvalidations: [],
            banquetEvents: [],
            renders: 0
        };
        window.AppState = { cachedLines: {}, cachedBookings: {} };
        window.TimelineBusinessContext = { current: () => ({ apiValue: 'event_genix' }) };
        window.invalidateTimelineDateCache = (date, options) => {
            window.__banquetWsSmoke.dateInvalidations.push({ date, options });
        };
        window.invalidateTimelineBanquetPreviewFreshness = options => {
            window.__banquetWsSmoke.previewInvalidations.push(options);
        };
        window.renderTimeline = () => {
            window.__banquetWsSmoke.renders += 1;
        };
        window.fetch = async () => ({ ok: true, json: async () => ({ total: 0 }) });
        window.addEventListener('ws:banquet', event => {
            window.__banquetWsSmoke.banquetEvents.push(event.detail);
        });

        class FakeWebSocket {
            static OPEN = 1;
            static CONNECTING = 0;
            constructor(url) {
                this.url = url;
                this.readyState = FakeWebSocket.CONNECTING;
                this.sent = [];
                window.__banquetWsSmoke.socket = this;
            }
            send(raw) {
                this.sent.push(JSON.parse(raw));
            }
            open() {
                this.readyState = FakeWebSocket.OPEN;
                if (typeof this.onopen === 'function') this.onopen();
            }
            receive(message) {
                if (typeof this.onmessage === 'function') this.onmessage({ data: JSON.stringify(message) });
            }
            close(code = 1000, reason = '') {
                this.readyState = 3;
                if (typeof this.onclose === 'function') this.onclose({ code, reason });
            }
        }
        window.WebSocket = FakeWebSocket;
        window.localStorage.setItem('pzp_token', 'test-token');
    });
    await page.addScriptTag({ content: WS_CLIENT_CODE });
    await page.evaluate(() => {
        window.ParkWS.connect();
        window.__banquetWsSmoke.socket.open();
        window.__banquetWsSmoke.socket.receive({
            type: 'auth:success',
            payload: { username: 'two-tab-smoke', connectedClients: 1 }
        });
    });
}

async function main() {
    const { chromium } = requirePlaywright();
    const { server, url } = await createHarnessServer();
    const browser = await chromium.launch({ headless: HEADLESS });
    try {
        const context = await browser.newContext();
        const firstTab = await context.newPage();
        const secondTab = await context.newPage();
        await Promise.all([installWsHarness(firstTab, url), installWsHarness(secondTab, url)]);

        const message = {
            type: 'banquet:booking-set-updated',
            payload: {
                groupId: 'BQ-BROWSER-TWO-TAB',
                date: '2026-08-19',
                affectedDates: ['2026-08-19'],
                affectedBookingIds: ['BK-BROWSER-PRIMARY', 'BK-BROWSER-ACTIVITY'],
                primaryBookingId: 'BK-BROWSER-PRIMARY',
                primaryBooking: { id: 'BK-BROWSER-PRIMARY', date: '2026-08-19' },
                businessContext: 'event_genix',
                updatedAt: '2026-08-19T12:00:00.000Z',
                operation: 'banquet_booking_set_update'
            }
        };

        await Promise.all([
            firstTab.evaluate(msg => window.__banquetWsSmoke.socket.receive(msg), message),
            secondTab.evaluate(msg => window.__banquetWsSmoke.socket.receive(msg), message)
        ]);
        await firstTab.waitForFunction(() => window.__banquetWsSmoke.renders === 1);
        await secondTab.waitForFunction(() => window.__banquetWsSmoke.renders === 1);

        const states = await Promise.all([
            firstTab.evaluate(() => window.__banquetWsSmoke),
            secondTab.evaluate(() => window.__banquetWsSmoke)
        ]);
        for (const state of states) {
            assert.deepEqual(state.dateInvalidations.map(item => item.date), ['2026-08-19']);
            assert.deepEqual(state.previewInvalidations, [{
                groupId: 'BQ-BROWSER-TWO-TAB',
                bookingIds: ['BK-BROWSER-PRIMARY', 'BK-BROWSER-ACTIVITY'],
                businessContext: 'event_genix'
            }]);
            assert.equal(state.banquetEvents.length, 1);
            assert.equal(state.banquetEvents[0].eventType, 'banquet:booking-set-updated');
        }
        await context.close();
        console.log('Banquet WS two-tab browser smoke passed');
    } finally {
        await browser.close();
        await closeServer(server);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
