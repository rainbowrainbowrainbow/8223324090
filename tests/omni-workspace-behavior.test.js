const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'omni.html'), 'utf8');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function conversation(id, channel = 'telegram') {
    return { id, channel, customerName: 'Customer ' + id, externalId: 'external-' + id, meta: {}, sendCapable: true };
}

function message(id, conversationId = 1) {
    return { id, conversationId, content: 'Message ' + id, direction: 'inbound', createdAt: new Date(Date.UTC(2026, 0, 1, 0, id)).toISOString() };
}

function harness(t, records = [conversation(1), conversation(2)]) {
    const dom = new JSDOM(html, { url: 'https://crm.example/omni', runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const { window } = dom;
    let context = 'event_genix';
    window.CrmBusinessContext = { current: () => context };
    window.apiVerifyToken = () => new Promise(() => {});
    const script = Array.from(window.document.scripts).find(node => node.textContent.includes('OmniClaw Page —')).textContent;
    const exports = `window.__omniTest = {
        loadConversations, loadMessages, loadOmniAccounts, loadCaseContext, reloadOmniForBusinessContext,
        selectConversation, sendMessage, closeConversation, clearConversationSelection, renderMessages,
        runAccountAction, setOmniMode, refreshOmniWorkspace, analyzeLeadAssistant,
        request: api,
        setApi(fn) { api = fn; },
        setRecords(value) { conversations = value; conversationTotal = value.length; renderConversations(); },
        state() { return { currentConvId, conversations, conversationTotal, messageHistory, messageTotal,
            accounts: omniAccounts, analysis: leadAssistantState.analysis, selectedDraftKey, messagesLoading }; }
    };`;
    const end = script.lastIndexOf('})();');
    vm.runInContext(script.slice(0, end) + exports + script.slice(end), dom.getInternalVMContext());
    const app = window.__omniTest;
    const defaultApi = async requestPath => {
        if (requestPath.startsWith('/conversations?')) return { success: true, data: { conversations: records, total: records.length } };
        if (requestPath.includes('/messages?')) return { success: true, data: { messages: [], total: 0 } };
        if (requestPath.endsWith('/context')) return { success: true, data: null };
        if (requestPath === '/accounts') return { success: true, accounts: [] };
        return { success: true, data: {} };
    };
    app.setApi(defaultApi);
    app.setRecords(records);
    return {
        app, window, document: window.document, defaultApi,
        setContext(value) { context = value; },
        async flush() { await new Promise(resolve => setImmediate(resolve)); }
    };
}

test('forbidden requests preserve the authenticated session', async t => {
    const h = harness(t);
    h.window.localStorage.setItem('pzp_token', 'fixture-session');
    h.window.fetch = async () => ({ status: 403, ok: false, json: async () => ({ success: false, error: 'Forbidden' }) });
    assert.equal((await h.app.request('/accounts')).success, false);
    assert.equal(h.window.localStorage.getItem('pzp_token'), 'fixture-session');
    assert.equal(h.window.location.pathname, '/omni');
});

test('send hashing preserves the clicked recipient, business and reply expectation across navigation', async t => {
    const h = harness(t); const hash = deferred(); const sent = [];
    Object.defineProperty(h.window.crypto, 'subtle', { value: { digest: () => hash.promise } });
    h.window.TextEncoder = TextEncoder;
    h.app.setApi(async (path, options) => { if (path.endsWith('/send')) { sent.push({ path, options }); return { success: true, data: {} }; } return h.defaultApi(path); });
    h.app.selectConversation(1); await h.flush();
    h.document.getElementById('omniInput').value = 'First business';
    h.document.getElementById('omniReplyExpected').checked = true;
    const pending = h.app.sendMessage();
    h.setContext('dar'); h.app.selectConversation(2);
    h.document.getElementById('omniReplyExpected').checked = false;
    hash.resolve(new Uint8Array(32).buffer); await pending;
    assert.equal(sent[0].path, '/conversations/1/send');
    assert.equal(sent[0].options.requestBusinessContext, 'event_genix');
    assert.equal(JSON.parse(sent[0].options.body).reply_expected, true);
});

test('send retries retain the request identifier until acknowledged', async t => {
    const h = harness(t); const sent = [];
    h.app.setApi(async (path, options) => {
        if (path.endsWith('/send')) { sent.push(JSON.parse(options.body)); return { success: sent.length > 1, data: {} }; }
        return h.defaultApi(path);
    });
    h.app.selectConversation(1); await h.flush();
    h.document.getElementById('omniInput').value = 'Retry fixture';
    await h.app.sendMessage(); await h.app.sendMessage();
    assert.match(sent[0].client_request_id, /^[a-f0-9]{40}$/);
    assert.equal(sent[0].client_request_id, sent[1].client_request_id);
});

test('attachments are accessible without exposing Telegram credentials or unsafe URLs', async t => {
    const h = harness(t); h.app.selectConversation(1); await h.flush();
    h.app.renderMessages([{ ...message(1), mediaUrl: 'telegram-file-id', contentType: 'image' }]);
    assert.ok(h.document.querySelector('[data-omni-attachment="1"]'));
    h.app.setRecords([conversation(2, 'facebook')]); h.app.selectConversation(2); await h.flush();
    h.app.renderMessages([{ ...message(2), meta: { attachments: [{ url: 'https://cdn.example/a.jpg' }, { url: 'javascript:alert(1)' }, { url: 'https://cdn.example/b.jpg' }] } }]);
    assert.equal(h.document.querySelectorAll('#omniMessages a').length, 2);
    assert.equal(h.document.querySelector('#omniMessages a').rel, 'noopener noreferrer');
});

test('status filter participates in requests and reset restores the full list', async t => {
    const h = harness(t); const calls = [];
    h.app.setApi(async path => { calls.push(path); return h.defaultApi(path); });
    const filter = h.document.getElementById('omniStatusFilter'); filter.value = 'closed'; filter.dispatchEvent(new h.window.Event('change'));
    await h.flush(); assert.ok(calls.some(path => path.includes('status=closed')));
    const closed = { ...conversation(1), status: 'closed' }; h.app.setRecords([closed]); h.app.selectConversation(1);
    assert.equal(h.document.getElementById('omniCloseConv').textContent, 'Відкрити знову');
});

test('opening visible history clears only the acknowledged unread boundary', async t => {
    const h = harness(t, [{ ...conversation(1), unreadCount: 3 }]); const calls = [];
    h.app.setApi(async (path, options) => {
        if (path.includes('/messages?')) return { success: true, data: { messages: [message(2), message(3)], total: 3 } };
        if (path.endsWith('/read')) { calls.push(JSON.parse(options.body)); return { success: true, data: { unreadCount: 1 } }; }
        return h.defaultApi(path);
    });
    h.app.selectConversation(1); await h.flush();
    assert.deepEqual(calls, [{ through_message_id: 3 }]);
    assert.equal(h.app.state().conversations[0].unreadCount, 1);
});

test('rapid channel changes keep the latest filter response', async t => {
    const h = harness(t);
    const telegram = deferred();
    const all = deferred();
    h.app.setApi(requestPath => requestPath.includes('channel=telegram') ? telegram.promise : all.promise);
    h.document.querySelector('[data-channel="telegram"]').click();
    h.document.querySelector('[data-channel="all"]').click();
    all.resolve({ success: true, data: { conversations: [conversation(2, 'viber')], total: 1 } });
    await h.flush();
    telegram.resolve({ success: true, data: { conversations: [conversation(1)], total: 1 } });
    await h.flush();
    assert.equal(h.app.state().conversations[0].id, 2);
    assert.equal(h.document.querySelector('.omni-channel-btn.active').dataset.channel, 'all');
});

test('late history and context responses cannot replace a different selected chat', async t => {
    const h = harness(t);
    const firstHistory = deferred();
    const secondHistory = deferred();
    const firstContext = deferred();
    h.app.setApi(requestPath => {
        if (requestPath.startsWith('/conversations/1/messages')) return firstHistory.promise;
        if (requestPath.startsWith('/conversations/2/messages')) return secondHistory.promise;
        if (requestPath === '/conversations/1/context') return firstContext.promise;
        return h.defaultApi(requestPath);
    });
    h.app.selectConversation(1);
    h.app.selectConversation(2);
    secondHistory.resolve({ success: true, data: { messages: [message(20, 2)], total: 1 } });
    await h.flush();
    firstHistory.resolve({ success: true, data: { messages: [message(10)], total: 1 } });
    firstContext.resolve({ success: true, data: { confidence: 'exact', conversation: conversation(1) } });
    await h.flush();
    assert.equal(h.document.getElementById('omniChatName').textContent, 'Customer 2');
    assert.match(h.document.getElementById('omniMessages').textContent, /Message 20/);
    assert.doesNotMatch(h.document.getElementById('omniMessages').textContent, /Message 10/);
    assert.match(h.document.getElementById('omniCaseContext').textContent, /CRM-контекст недоступний/);
});

test('drafts and pending send completion stay with their original conversation', async t => {
    const h = harness(t);
    h.app.selectConversation(1);
    await h.flush();
    const input = h.document.getElementById('omniInput');
    input.value = 'First draft';
    h.app.selectConversation(2);
    assert.equal(input.value, '');
    input.value = 'Second draft';
    h.app.selectConversation(1);
    assert.equal(input.value, 'First draft');
    const send = deferred();
    let sentPath;
    h.app.setApi((requestPath, options) => {
        if (options?.method === 'POST') { sentPath = requestPath; return send.promise; }
        return h.defaultApi(requestPath);
    });
    const pending = h.app.sendMessage();
    h.app.selectConversation(2);
    assert.equal(input.value, 'Second draft');
    assert.equal(input.disabled, false);
    send.resolve({ success: true, sendTruth: { status: 'provider_attempted' } });
    await pending;
    assert.equal(sentPath, '/conversations/1/send');
    assert.equal(h.app.state().currentConvId, 2);
    assert.equal(input.value, 'Second draft');
    h.app.selectConversation(1);
    assert.equal(input.value, '');
});

test('failed close keeps the selected chat and draft with a visible error', async t => {
    const h = harness(t);
    h.app.selectConversation(1);
    await h.flush();
    h.document.getElementById('omniInput').value = 'Unsent draft';
    h.app.setApi(async () => ({ success: false, error: 'Server unavailable' }));
    await h.app.closeConversation();
    assert.equal(h.app.state().currentConvId, 1);
    assert.equal(h.document.getElementById('omniChatHeader').style.display, 'flex');
    assert.equal(h.document.getElementById('omniInput').value, 'Unsent draft');
    assert.match(h.document.getElementById('omniSendTruth').textContent, /Server unavailable/);
});

test('history begins with newest 100 and loads older records without duplication', async t => {
    const h = harness(t);
    const all = Array.from({ length: 105 }, (_, index) => message(index + 1));
    const requests = [];
    h.app.setApi(requestPath => {
        if (!requestPath.includes('/messages?')) return h.defaultApi(requestPath);
        const url = new URL(requestPath, 'https://crm.example');
        requests.push(url.searchParams);
        const end = all.length - Number(url.searchParams.get('offset'));
        return Promise.resolve({ success: true, data: { messages: all.slice(Math.max(0, end - 100), end), total: all.length } });
    });
    h.app.selectConversation(1);
    await h.flush();
    assert.equal(h.app.state().messageHistory[0].id, 6);
    assert.equal(h.app.state().messageHistory.at(-1).id, 105);
    assert.equal(requests[0].get('latest'), 'true');
    h.document.querySelector('[data-omni-history="older"]').click();
    await h.flush();
    assert.equal(requests[1].get('offset'), '100');
    assert.equal(h.app.state().messageHistory.length, 105);
    assert.equal(h.app.state().messageHistory[0].id, 1);
    assert.equal(h.document.querySelector('[data-omni-history="older"]'), null);
});

test('polling updates open history without scrolling away from an older message', async t => {
    const h = harness(t);
    let page = [message(1), message(2)];
    h.app.setApi(requestPath => requestPath.includes('/messages?')
        ? Promise.resolve({ success: true, data: { messages: page, total: page.length } })
        : h.defaultApi(requestPath));
    h.app.selectConversation(1);
    await h.flush();
    const messages = h.document.getElementById('omniMessages');
    Object.defineProperty(messages, 'scrollHeight', { configurable: true, get: () => h.app.state().messageHistory.length * 200 });
    Object.defineProperty(messages, 'clientHeight', { value: 100 });
    messages.scrollTop = 50;
    page = [message(1), message(2), message(3)];
    await h.app.refreshOmniWorkspace();
    assert.equal(h.app.state().messageHistory.at(-1).id, 3);
    assert.equal(messages.scrollTop, 50);
});

test('list pagination reaches conversations after the first 100', async t => {
    const records = Array.from({ length: 105 }, (_, index) => conversation(index + 1));
    const h = harness(t, records);
    h.app.setApi(requestPath => {
        if (!requestPath.startsWith('/conversations?')) return h.defaultApi(requestPath);
        const offset = Number(new URL(requestPath, 'https://crm.example').searchParams.get('offset'));
        return Promise.resolve({ success: true, data: { conversations: records.slice(offset, offset + 100), total: records.length } });
    });
    await h.app.loadConversations();
    assert.equal(h.app.state().conversations.length, 100);
    h.document.querySelector('[data-omni-conversations-more]').click();
    await h.flush();
    assert.equal(h.app.state().conversations.length, 105);
    assert.equal(h.document.querySelector('[data-omni-conversations-more]'), null);
});

test('channel checks report their result outside the hidden chat feedback', async t => {
    const h = harness(t);
    h.app.setOmniMode('channels');
    h.app.setApi(async () => ({ success: false, error: 'Provider unavailable' }));
    const button = h.document.createElement('button');
    await h.app.runAccountAction('viber', 'test', button);
    const feedback = h.document.getElementById('omniChannelActionFeedback');
    assert.equal(feedback.hidden, false);
    assert.equal(feedback.textContent, 'Provider unavailable');
    assert.equal(button.disabled, false);
});

test('refresh resets the contiguous page when new arrivals shift it, then more reaches every record', async t => {
    let records = Array.from({ length: 105 }, (_, index) => conversation(index + 1));
    const h = harness(t, records);
    h.app.setApi(requestPath => {
        if (!requestPath.startsWith('/conversations?')) return h.defaultApi(requestPath);
        const offset = Number(new URL(requestPath, 'https://crm.example').searchParams.get('offset'));
        return Promise.resolve({ success: true, data: { conversations: records.slice(offset, offset + 100), total: records.length } });
    });
    await h.app.loadConversations();
    await h.app.loadConversations({ append: true });
    records = [conversation(106), { ...records[0], customerName: 'Updated name' }].concat(records.slice(1));
    await h.app.loadConversations();
    assert.equal(h.app.state().conversations.length, 100);
    assert.equal(h.app.state().conversations[0].id, 106);
    assert.equal(h.app.state().conversations.find(conv => conv.id === 1).customerName, 'Updated name');
    h.document.querySelector('[data-omni-conversations-more]').click();
    await h.flush();
    assert.equal(h.app.state().conversations.length, 106);
    assert.ok(h.app.state().conversations.find(conv => conv.id === 100));
});

test('overlapping refresh ticks do not duplicate in-flight requests', async t => {
    const h = harness(t);
    const accounts = deferred();
    let accountRequests = 0;
    h.app.setApi(requestPath => {
        if (requestPath === '/accounts') { accountRequests++; return accounts.promise; }
        return h.defaultApi(requestPath);
    });
    const pending = h.app.refreshOmniWorkspace();
    await h.app.refreshOmniWorkspace();
    assert.equal(accountRequests, 1);
    accounts.resolve({ success: true, accounts: [] });
    await pending;
});

test('business switch rejects old accounts/history and separates drafts', async t => {
    const h = harness(t);
    h.app.selectConversation(1);
    await h.flush();
    h.document.getElementById('omniInput').value = 'Park draft';
    const staleAccounts = deferred();
    let first = true;
    h.app.setApi(requestPath => {
        if (requestPath === '/accounts' && first) { first = false; return staleAccounts.promise; }
        return h.defaultApi(requestPath);
    });
    const pending = h.app.loadOmniAccounts();
    h.setContext('dar');
    await h.app.reloadOmniForBusinessContext();
    staleAccounts.resolve({ success: true, accounts: [{ channel: 'telegram', accountName: 'Stale account' }] });
    await pending;
    assert.equal(h.app.state().accounts.length, 0);
    h.app.selectConversation(1);
    assert.equal(h.document.getElementById('omniInput').value, '');
});

test('filter excluding a selected chat clears it safely and preserves its draft', async t => {
    const h = harness(t);
    await h.app.loadConversations();
    h.app.selectConversation(1);
    h.document.getElementById('omniInput').value = 'Keep this draft';
    h.app.setApi(requestPath => requestPath.includes('channel=viber')
        ? Promise.resolve({ success: true, data: { conversations: [], total: 0 } })
        : h.defaultApi(requestPath));
    h.document.querySelector('[data-channel="viber"]').click();
    await h.flush();
    assert.equal(h.app.state().currentConvId, null);
    assert.equal(h.document.getElementById('omniInputArea').style.display, 'none');
    h.document.querySelector('[data-channel="all"]').click();
    await h.flush();
    h.app.selectConversation(1);
    assert.equal(h.document.getElementById('omniInput').value, 'Keep this draft');
});

test('keyboard selection and back restore an accessible list', async t => {
    const h = harness(t);
    h.document.querySelector('.omni-conv-item').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(h.app.state().currentConvId, 1);
    assert.equal(h.document.getElementById('omniContainer').classList.contains('has-conversation'), true);
    h.document.getElementById('omniBackToList').click();
    assert.equal(h.app.state().currentConvId, null);
    assert.equal(h.document.activeElement.dataset.id, '1');
    h.app.selectConversation(2);
    h.window.history.replaceState({}, '', '/omni');
    h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
    assert.equal(h.app.state().currentConvId, null);
});

test('stale AI analysis is discarded after switching conversations', async t => {
    const h = harness(t);
    const analysis = deferred();
    h.app.setApi(requestPath => requestPath.endsWith('/lead-assistant/analyze') ? analysis.promise : h.defaultApi(requestPath));
    h.app.selectConversation(1);
    const pending = h.app.analyzeLeadAssistant();
    h.app.selectConversation(2);
    analysis.resolve({ success: true, analysis: { summary: 'Wrong customer result' } });
    await pending;
    assert.equal(h.app.state().analysis, null);
});

test('history failure exposes retry and does not display the previous customer history', async t => {
    const h = harness(t);
    h.app.selectConversation(1);
    await h.flush();
    h.app.renderMessages([message(1)]);
    h.app.setApi(requestPath => requestPath.includes('/messages?')
        ? Promise.resolve({ success: false, error: 'History offline' }) : h.defaultApi(requestPath));
    h.app.selectConversation(2);
    await h.flush();
    assert.equal(h.document.getElementById('omniMessages').textContent, '');
    assert.match(h.document.getElementById('omniHistoryControls').textContent, /History offline/);
    assert.ok(h.document.querySelector('[data-omni-history="retry"]'));
});
