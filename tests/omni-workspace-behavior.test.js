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
        openLeadAssistantPanel, createLeadFromDraft, fillLeadDraftFromAi,
        accountNeedsAttention, renderOmniAccountsAlarm,
        updateConversationField, syncConversationControls,
        request: api,
        setApi(fn) { api = fn; },
        setRecords(value) { conversations = value; conversationTotal = value.length; renderConversations(); },
        state() { return { currentConvId, conversations, conversationTotal, messageHistory, messageTotal,
            accounts: omniAccounts, analysis: leadAssistantState.analysis, leadMode: leadAssistantState.mode,
            leadDrafts: Array.from(leadDrafts.entries()), selectedDraftKey, messagesLoading }; }
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

test('an inbound failure requires attention even when sending still works', t => {
    const h = harness(t);
    assert.equal(h.app.accountNeedsAttention({ channel: 'telegram', connected: true, sendCapable: true, receiveCapable: false }), true);
    assert.equal(h.app.accountNeedsAttention({ channel: 'sms', connected: true, sendCapable: true, receiveCapable: false }), false);
});

test('search typing rejects an older response immediately and clear keeps the channel filter', async t => {
    const h = harness(t);
    const pending = deferred();
    const requests = [];
    h.app.setApi(async requestPath => { requests.push(requestPath); return pending.promise; });
    const previous = h.app.loadConversations();
    const search = h.document.getElementById('omniSearch');
    search.value = 'New query';
    search.dispatchEvent(new h.window.Event('input'));
    pending.resolve({ success: true, data: { conversations: [conversation(99)], total: 1 } });
    await previous;
    assert.notEqual(h.app.state().conversations[0]?.id, 99);
    h.app.setApi(h.defaultApi);
    h.document.querySelector('[data-channel="telegram"]').click();
    await h.flush();
    h.app.setApi(async requestPath => { requests.push(requestPath); return h.defaultApi(requestPath); });
    h.document.getElementById('omniClearSearch').click();
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(search.value, '');
    assert.equal(h.document.getElementById('omniClearSearch').hidden, true);
    assert.ok(requests.at(-1).includes('channel=telegram'));
    assert.ok(!requests.at(-1).includes('search='));
});

test('IME confirmation and Shift+Enter do not send a draft', async t => {
    const h = harness(t);
    h.app.selectConversation(1);
    await h.flush();
    let sends = 0;
    h.app.setApi(async requestPath => { if (requestPath.endsWith('/send')) sends++; return h.defaultApi(requestPath); });
    const input = h.document.getElementById('omniInput');
    input.value = 'Draft being composed';
    input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    await h.flush();
    assert.equal(sends, 0);
    assert.equal(input.value, 'Draft being composed');
});

test('manager refresh updates open status and assignee without replacing a draft', async t => {
    let record = { ...conversation(1), status: 'open', assignedTo: 'first' };
    const h = harness(t, [record]);
    h.app.setApi(async requestPath => requestPath === '/operators'
        ? { success: true, data: [{ username: 'first', label: 'First' }, { username: 'second', label: 'Second' }] }
        : requestPath.startsWith('/conversations?') ? { success: true, data: { conversations: [record], total: 1 } }
        : h.defaultApi(requestPath));
    h.app.selectConversation(1); await h.flush();
    h.document.getElementById('omniInput').value = 'Preserve draft';
    record = { ...record, status: 'closed', assignedTo: 'second' };
    await h.app.loadConversations();
    assert.equal(h.document.getElementById('omniConversationStatus').value, 'closed');
    assert.equal(h.document.getElementById('omniAssignee').value, 'second');
    assert.equal(h.document.getElementById('omniInput').value, 'Preserve draft');
});

test('a focused manager control retains its original expectation and a conflict shows the current record', async t => {
    let record = { ...conversation(1), status: 'open' }; let patch;
    const h = harness(t, [record]);
    h.app.setApi(async (requestPath, options) => {
        if (options?.method === 'PATCH') {
            patch = JSON.parse(options.body);
            return { success: false, code: 'OMNI_CONVERSATION_CONFLICT', error: 'Changed by another manager', data: record };
        }
        if (requestPath.startsWith('/conversations?')) return { success: true, data: { conversations: [record], total: 1 } };
        return h.defaultApi(requestPath);
    });
    h.app.selectConversation(1); await h.flush();
    const control = h.document.getElementById('omniConversationStatus');
    control.focus();
    record = { ...record, status: 'closed' }; await h.app.loadConversations();
    assert.equal(control.value, 'open');
    control.value = 'pending'; await h.app.updateConversationField(control, 'status');
    assert.equal(patch.expected.status, 'open');
    assert.equal(control.value, 'closed');
    assert.match(h.document.querySelector('.omni-send-truth').textContent, /Changed by another manager/);
});

test('forbidden requests preserve the authenticated session', async t => {
    const h = harness(t);
    h.window.localStorage.setItem('pzp_token', 'fixture-session');
    h.window.fetch = async () => ({ status: 403, ok: false, json: async () => ({ success: false, error: 'Forbidden' }) });
    assert.equal((await h.app.request('/accounts')).success, false);
    assert.equal(h.window.localStorage.getItem('pzp_token'), 'fixture-session');
    assert.equal(h.window.location.pathname, '/omni');
});

test('unknown delivery can be reconciled without invoking send and manual notes are escaped', async t => {
    const h = harness(t); const writes = [];
    h.app.selectConversation(1); await h.flush();
    h.app.setApi(async (requestPath, options) => {
        if (options?.method === 'POST') { writes.push(requestPath); return { success: true, data: { nextAction: 'Still unknown' } }; }
        return h.defaultApi(requestPath);
    });
    h.app.renderMessages([{ ...message(1), direction: 'outbound', deliveryStatus: 'unknown',
        meta: { manualVerification: { outcome: 'unresolved', note: '<img src=x onerror=alert(1)>', by: 'Manager' } } }]);
    assert.equal(h.document.querySelector('.omni-delivery-review img'), null);
    h.document.querySelector('[data-delivery-reconcile]').click(); await h.flush();
    assert.deepEqual(writes, ['/messages/1/reconcile']);
    assert.match(h.document.querySelector('.omni-send-truth').textContent, /Still unknown/);
});

test('Meta comments require an explicit public or private target and retain the clicked mode', async t => {
    const h = harness(t, [{ ...conversation(1, 'facebook'), externalId: 'comment:123' }]);
    h.app.selectConversation(1); await h.flush();
    h.app.renderMessages([{ ...message(12), meta: { eventType: 'comment', commentId: '123', postUrl: 'https://www.facebook.com/12_34' } }]);
    assert.equal(h.document.querySelector('#omniSendBtn').disabled, true);
    assert.equal(h.document.querySelector('#omniChooseFile').disabled, true);
    let sent;
    h.app.setApi(async (path, options) => {
        if (path.endsWith('/send')) { sent = JSON.parse(options.body); return { success: true, data: {} }; }
        return h.defaultApi(path);
    });
    h.document.querySelector('[data-comment-reply="public_comment"]').click();
    assert.match(h.document.querySelector('#omniReplyTarget').textContent, /публічною/);
    h.document.querySelector('#omniInput').value = 'Explicit public fixture'; await h.app.sendMessage();
    assert.equal(sent.reply_mode, 'public_comment'); assert.equal(sent.reply_to_message_id, 12);
});

test('normally accepted Telegram messages do not repeat an unavailable delivery-check action', async t => {
    const h = harness(t); h.app.selectConversation(1); await h.flush();
    h.app.renderMessages([{ ...message(1), direction: 'outbound', deliveryStatus: 'accepted' }]);
    assert.equal(h.document.querySelector('[data-delivery-reconcile]'), null);
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
    const requests = [];
    h.app.setApi(requestPath => {
        requests.push(requestPath);
        return requestPath.includes('channel=viber') || requestPath.includes('channel=whatsapp')
            ? Promise.resolve({ success: true, data: { conversations: [], total: 0 } })
            : h.defaultApi(requestPath);
    });
    assert.ok(h.document.querySelector('[data-channel="whatsapp"]'));
    h.document.querySelector('[data-channel="whatsapp"]').click();
    await h.flush();
    assert.ok(requests.some(requestPath => requestPath.includes('channel=whatsapp')));
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

test('manual lead draft opens without starting AI analysis', async t => {
    const h = harness(t);
    const requests = [];
    h.app.setApi((requestPath, options) => {
        requests.push({ requestPath, method: options?.method || 'GET' });
        return h.defaultApi(requestPath);
    });
    h.app.selectConversation(1);
    await h.flush();
    await h.app.openLeadAssistantPanel('draft');
    assert.equal(h.app.state().leadMode, 'draft');
    assert.equal(h.document.getElementById('omniLeadDraftClientName').value, 'Customer 1');
    assert.equal(h.document.getElementById('omniLeadAssistantSettingsPanel').hidden, true);
    assert.equal(requests.some(item => item.requestPath.endsWith('/lead-assistant/analyze')), false);
    assert.equal(requests.some(item => item.requestPath === '/lead-assistant/settings'), false);
    assert.equal(requests.some(item => item.requestPath.endsWith('/lead-assistant/create-lead')), false);
});

test('AI draft fill previews chat data without creating a lead or overwriting manual edits', async t => {
    const h = harness(t);
    const requests = [];
    h.app.setApi(async (requestPath, options) => {
        requests.push({ requestPath, options });
        if (requestPath.endsWith('/lead-assistant/preview-draft')) {
            return {
                success: true,
                preview: {
                    provider: { name: 'openai_direct', model: 'gpt-test', status: 'ok' },
                    draft: {
                        clientName: 'AI Name',
                        phone: '+380501112233',
                        instagram: null,
                        eventType: 'birthday',
                        eventDate: '2026-06-14',
                        childrenCount: 12,
                        adultsCount: null,
                        childAge: 8,
                        programPreferences: 'квест',
                        notes: 'Клієнт хоче квест.'
                    },
                    evidence: {},
                    missing: ['adultsCount'],
                    conflicts: [],
                    confidence: { overall: 0.8 },
                    snapshot: { window: { newestMessageId: 22 } }
                }
            };
        }
        return h.defaultApi(requestPath, options);
    });
    h.app.selectConversation(1);
    await h.flush();
    await h.app.openLeadAssistantPanel('draft');
    h.document.getElementById('omniLeadDraftClientName').value = 'Manual Manager Name';
    await h.app.fillLeadDraftFromAi();

    assert.equal(h.document.getElementById('omniLeadDraftClientName').value, 'Manual Manager Name');
    assert.equal(h.document.getElementById('omniLeadDraftPhone').value, '+380501112233');
    assert.equal(h.document.getElementById('omniLeadDraftEventDate').value, '2026-06-14');
    assert.equal(h.document.getElementById('omniLeadDraftChildrenCount').value, '12');
    assert.ok(requests.some(item => item.requestPath === '/conversations/1/lead-assistant/preview-draft'));
    assert.equal(requests.some(item => item.requestPath.endsWith('/lead-assistant/analyze')), false);
    assert.equal(requests.some(item => item.requestPath.endsWith('/lead-assistant/create-lead')), false);
    assert.match(h.document.getElementById('omniLeadAssistantContent').textContent, /AI заповнення з чату/);
});

test('stale AI draft preview is ignored after switching chats', async t => {
    const h = harness(t);
    const preview = deferred();
    h.app.setApi((requestPath, options) => requestPath.endsWith('/lead-assistant/preview-draft')
        ? preview.promise
        : h.defaultApi(requestPath, options));
    h.app.selectConversation(1);
    await h.flush();
    await h.app.openLeadAssistantPanel('draft');
    const pending = h.app.fillLeadDraftFromAi();
    h.app.selectConversation(2);
    preview.resolve({
        success: true,
        preview: {
            draft: { phone: '+380501112233', eventDate: '2026-06-14' },
            missing: [],
            conflicts: [],
            provider: { model: 'gpt-test' }
        }
    });
    await pending;
    assert.equal(h.app.state().currentConvId, 2);
    assert.equal(h.app.state().leadDrafts.some(([, draft]) => draft.phone === '+380501112233'), false);
});

test('manual lead draft creates a lead from reviewed fields without analysis payload', async t => {
    const h = harness(t);
    let sent;
    h.app.setApi(async (requestPath, options) => {
        if (requestPath.endsWith('/lead-assistant/create-lead')) {
            sent = { requestPath, options, body: JSON.parse(options.body) };
            return { success: true, created: true, lead: { id: 501 } };
        }
        return h.defaultApi(requestPath);
    });
    h.app.selectConversation(1);
    await h.flush();
    await h.app.openLeadAssistantPanel('draft');
    h.document.getElementById('omniLeadDraftClientName').value = 'Nataly Fedorova';
    h.document.getElementById('omniLeadDraftPhone').value = '+380501112233';
    h.document.getElementById('omniLeadDraftEventType').value = 'День народження';
    h.document.getElementById('omniLeadDraftChildrenCount').value = '12';
    await h.app.createLeadFromDraft();
    assert.equal(sent.requestPath, '/conversations/1/lead-assistant/create-lead');
    assert.equal(sent.options.requestBusinessContext, 'event_genix');
    assert.equal(sent.body.analysis, undefined);
    assert.equal(sent.body.draft.clientName, 'Nataly Fedorova');
    assert.equal(sent.body.draft.childrenCount, 12);
    assert.equal(h.document.getElementById('omniCreateLead').textContent, 'Відкрити лід');
    assert.equal(h.app.state().conversations[0].meta.lead_id, 501);
});

test('stale manual lead creation result is ignored after switching chats', async t => {
    const h = harness(t);
    const create = deferred();
    h.app.setApi((requestPath, options) => requestPath.endsWith('/lead-assistant/create-lead')
        ? create.promise
        : h.defaultApi(requestPath, options));
    h.app.selectConversation(1);
    await h.flush();
    await h.app.openLeadAssistantPanel('draft');
    const pending = h.app.createLeadFromDraft();
    h.app.selectConversation(2);
    create.resolve({ success: true, created: true, lead: { id: 777 } });
    await pending;
    assert.equal(h.app.state().currentConvId, 2);
    assert.equal(h.document.getElementById('omniCreateLead').textContent, 'Створити лід');
    assert.equal(h.app.state().conversations[1].meta.lead_id, undefined);
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
