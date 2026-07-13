const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const wsClientCode = fs.readFileSync(path.join(__dirname, '..', 'js', 'ws.js'), 'utf8');

class FakeWebSocket {
    static OPEN = 1;
    static CONNECTING = 0;
    static instances = [];

    constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.sent = [];
        FakeWebSocket.instances.push(this);
    }

    send(raw) {
        this.sent.push(JSON.parse(raw));
    }

    open() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
    }

    receive(message) {
        this.onmessage?.({ data: JSON.stringify(message) });
    }

    close(code = 1000, reason = '') {
        this.readyState = 3;
        this.onclose?.({ code, reason });
    }
}

function messagesOfType(socket, type) {
    return socket.sent.filter(message => message.type === type);
}

test('ParkWS diffs date subscriptions and restores them after reconnect', () => {
    FakeWebSocket.instances = [];
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'http://localhost/',
        runScripts: 'outside-only'
    });
    const { window } = dom;
    window.WebSocket = FakeWebSocket;
    window.fetch = async () => ({ ok: true, json: async () => ({ total: 0 }) });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    window.localStorage.setItem('pzp_token', 'test-token');
    window.eval(wsClientCode);

    window.ParkWS.setSubscribedDates(['2026-07-20', '2026-07-21', 'invalid']);
    window.ParkWS.connect();
    const first = FakeWebSocket.instances[0];
    first.open();
    assert.deepEqual(messagesOfType(first, 'auth'), [{ type: 'auth', token: 'test-token' }]);
    first.receive({ type: 'auth:success', payload: { username: 'test', connectedClients: 1 } });
    assert.deepEqual(messagesOfType(first, 'JOIN_DATE').map(message => message.date), [
        '2026-07-20',
        '2026-07-21'
    ]);

    window.ParkWS.setSubscribedDates(['2026-07-21', '2026-07-22']);
    assert.deepEqual(messagesOfType(first, 'LEAVE_DATE').map(message => message.date), ['2026-07-20']);
    assert.deepEqual(messagesOfType(first, 'JOIN_DATE').map(message => message.date), [
        '2026-07-20',
        '2026-07-21',
        '2026-07-22'
    ]);

    first.close(1006, 'network');
    window.ParkWS.connect();
    const second = FakeWebSocket.instances[1];
    second.open();
    second.receive({ type: 'auth:success', payload: { username: 'test', connectedClients: 1 } });
    assert.deepEqual(messagesOfType(second, 'JOIN_DATE').map(message => message.date), [
        '2026-07-21',
        '2026-07-22'
    ]);

    window.ParkWS.disconnect();
    dom.window.close();
});

test('roster update invalidates only the scoped lines cache date', () => {
    FakeWebSocket.instances = [];
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'http://localhost/',
        runScripts: 'outside-only'
    });
    const { window } = dom;
    window.WebSocket = FakeWebSocket;
    window.fetch = async () => ({ ok: true, json: async () => ({ total: 0 }) });
    window.AppState = { cachedLines: {}, cachedBookings: {} };
    window.TimelineBusinessContext = { current: () => ({ apiValue: 'event_genix' }) };
    const invalidations = [];
    window.invalidateTimelineDateCache = (date, options) => invalidations.push({ date, options });
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    window.localStorage.setItem('pzp_token', 'test-token');
    window.eval(wsClientCode);

    window.ParkWS.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: 'auth:success', payload: { username: 'test', connectedClients: 1 } });
    socket.receive({
        type: 'timeline:roster-updated',
        payload: {
            date: '2026-07-21',
            businessContext: 'event_genix',
            eventType: 'timeline:roster-updated'
        }
    });

    assert.equal(invalidations.length, 1);
    assert.equal(invalidations[0].date, '2026-07-21');
    assert.equal(invalidations[0].options.bookings, false);
    window.ParkWS.disconnect();
    dom.window.close();
});
