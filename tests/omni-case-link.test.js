const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function assertBusinessScope(sql, params, context) {
    const column = sql.includes('FROM leads l') ? 'l.business_context' : 'business_context';
    assert.ok(sql.includes(`COALESCE(${column}, 'event_genix') = $${params.length}`));
    assert.equal(params.at(-1), context);
}

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/omni-hub',
        '../services/leadConversationLinks',
        '../services/kleshnya-chat',
        '../services/websocket',
        '../services/telegram',
        '../services/omni-viber',
        '../services/omni-sms',
        '../services/omni-facebook',
        '../services/omni-instagram'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function loadHubWithQuery(query, confirmedLinks = []) {
    clearModules();
    installMock('../db', { pool: { query } });
    installMock('../services/kleshnya-chat', { generateChatResponse: async () => '' });
    installMock('../services/websocket', { broadcastBusinessEvent: async () => 0 });
    installMock('../services/telegram', { sendTelegramMessage: async () => ({ success: true }) });
    installMock('../services/omni-viber', { sendViber: async () => ({ success: true }) });
    installMock('../services/omni-sms', { sendSMS: async () => ({ success: true }) });
    installMock('../services/omni-facebook', { sendFacebook: async () => ({ success: true }) });
    installMock('../services/omni-instagram', { sendInstagram: async () => ({ success: true }) });
    installMock('../services/leadConversationLinks', { listConversationLeadLinks: async () => confirmedLinks });
    return require('../services/omni-hub');
}

describe('Omni Case Link v1', () => {
    afterEach(clearModules);

    it('resolves exact CRM context from durable customer and lead ids', async () => {
        const hub = loadHubWithQuery(async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            assertBusinessScope(text, params, 'maysternya_doli');
            if (/SELECT \* FROM conversations WHERE id = \$1 /i.test(text)) {
                return { rows: [{ id: params[0], business_context: 'maysternya_doli', channel: 'telegram', external_id: 'tg-1', customer_name: 'Exact Customer', customer_phone: '+380000000001', customer_id: 701, status: 'open', meta: {} }] };
            }
            if (/SELECT \* FROM customers WHERE id = \$1 /i.test(text)) {
                return { rows: [{ id: 701, name: 'Exact Customer', phone: '+380000000001', lead_id: 501, total_bookings: 1, total_spent: 2500 }] };
            }
            if (/FROM leads l LEFT JOIN users u ON l\.assigned_to = u\.id WHERE l\.id = \$1 /i.test(text)) {
                return { rows: [{ id: 501, client_name: 'Exact Customer', phone: '+380000000001', pipeline_stage: 'contacted', status: 'contact', booking_id: 'BK-2099-0001', assigned_name: 'Manager' }] };
            }
            if (/SELECT \* FROM bookings WHERE id = \$1 /i.test(text)) {
                return { rows: [{ id: 'BK-2099-0001', date: '2099-05-12', time: '14:00', status: 'confirmed', customer_id: 701, program_name: 'Quest' }] };
            }
            if (/FROM bookings WHERE customer_id = \$1/i.test(text)) {
                return { rows: [{ id: 'BK-2099-0001', date: '2099-05-12', time: '14:00', status: 'confirmed', customer_id: 701, program_name: 'Quest' }] };
            }
            throw new Error(`Unexpected query: ${text}`);
        });

        const context = await hub.resolveConversationContext(903, { businessContext: 'maysternya_doli' });
        assert.equal(context.confidence, 'exact');
        assert.equal(context.exact.customer.id, 701);
        assert.equal(context.exact.lead.id, 501);
        assert.equal(context.exact.booking.id, 'BK-2099-0001');
        assert.equal(context.links.leadWorkspace, '/sales-funnel?lead=501');
        assert.equal(context.links.customer, '/customers?open=701');
        assert.equal(context.links.booking, '/?date=2099-05-12&highlight=BK-2099-0001');
    });

    it('keeps phone/name matches as suggested context, not exact CRM truth', async () => {
        const hub = loadHubWithQuery(async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            assertBusinessScope(text, params, 'maysternya_doli');
            if (/SELECT \* FROM conversations WHERE id = \$1 /i.test(text)) {
                return { rows: [{ id: params[0], business_context: 'maysternya_doli', channel: 'viber', external_id: 'vb-1', customer_name: 'Suggested Customer', customer_phone: '+380000000002', customer_id: null, status: 'open', meta: {} }] };
            }
            if (/FROM customers WHERE COALESCE\(business_context/i.test(text)) {
                assert.match(text, /\(\$1 <> '' AND regexp_replace/);
                return { rows: [{ id: 702, name: 'Suggested Customer', phone: '+380000000002', lead_id: 502 }] };
            }
            if (/FROM leads l LEFT JOIN users u ON l\.assigned_to = u\.id WHERE l\.id = \$1 /i.test(text)) {
                return { rows: [{ id: 502, client_name: 'Suggested Customer', phone: '+380000000002', pipeline_stage: 'new', status: 'new', booking_id: 'BK-2099-0002' }] };
            }
            if (/SELECT \* FROM bookings WHERE id = \$1 /i.test(text)) {
                return { rows: [{ id: 'BK-2099-0002', date: '2099-06-01', time: '12:00', status: 'confirmed', customer_id: 702, program_name: 'Show' }] };
            }
            throw new Error(`Unexpected query: ${text}`);
        });

        const context = await hub.resolveConversationContext(904, { businessContext: 'maysternya_doli' });
        assert.equal(context.confidence, 'suggested');
        assert.equal(context.exact.customer, null);
        assert.equal(context.links.leadWorkspace, null);
        assert.equal(context.suggestions.customer.id, 702);
        assert.equal(context.suggestions.lead.id, 502);
        assert.equal(context.suggestedLinks.leadWorkspace, '/sales-funnel?lead=502');
    });

    it('returns every canonical lead linked to a conversation without trusting its latest legacy meta lead', async () => {
        const hub = loadHubWithQuery(async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            assertBusinessScope(text, params, 'maysternya_doli');
            if (/SELECT \* FROM conversations WHERE id = \$1 /i.test(text)) {
                return {
                    rows: [{
                        id: params[0], business_context: 'maysternya_doli', channel: 'instagram', external_id: 'ig-1',
                        customer_name: '', customer_phone: '', customer_id: null, status: 'open', meta: { lead_id: 999 }
                    }]
                };
            }
            if (/FROM leads l LEFT JOIN users u ON l\.assigned_to = u\.id WHERE l\.id = \$1 /i.test(text)) {
                return { rows: [{ id: params[0], client_name: `Lead ${params[0]}`, pipeline_stage: 'new', status: 'new', booking_id: null }] };
            }
            throw new Error(`Unexpected query: ${text}`);
        }, [
            { id: 71, leadId: 501, isOrigin: true, isPrimary: true, source: 'omni_lead_manual' },
            { id: 72, leadId: 502, isOrigin: false, isPrimary: false, source: 'lead_workspace_manual' },
        ]);

        const context = await hub.resolveConversationContext(905, { businessContext: 'maysternya_doli' });
        assert.deepEqual(context.confirmed.leads.map(item => item.lead.id), [501, 502]);
        assert.equal(context.exact.lead.id, 501);
        assert.ok(context.reasons.includes('lead_conversation_links'));
        assert.equal(context.reasons.includes('conversation.meta.lead_id'), false);
    });

    it('wires exact Omni URL state and lead workspace exact handoff in static UI', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const omniHtml = fs.readFileSync(path.join(repoRoot, 'omni.html'), 'utf8');
        const leadsPage = fs.readFileSync(path.join(repoRoot, 'js', 'leads-page.js'), 'utf8');

        assert.match(omniHtml, /params\.get\('conversation'\)/);
        assert.match(omniHtml, /selectConversationFromQuery/);
        assert.match(omniHtml, /\/conversations\/' \+ convId \+ '\/context/);
        const linkContext = {
            URL,
            window: { location: { origin: 'https://crm.example.test' } },
            leadContextFromRecord: lead => lead.businessContext,
            leadBusinessContext: () => 'event_genix',
        };
        vm.createContext(linkContext);
        vm.runInContext(leadsPage.slice(leadsPage.indexOf('function leadCrmContextHref('), leadsPage.indexOf('function leadContactLinks(')), linkContext);
        const href = linkContext.leadOmniHref({
            lead: { businessContext: 'maysternya_doli' },
            conversationContext: { confirmedLinks: [{ id: 903, confidence: 'confirmed', available: true }] }
        }, { id: 903 });
        const url = new URL(href, 'https://crm.example.test');
        assert.equal(url.pathname, '/omni');
        assert.equal(url.searchParams.get('conversation'), '903');
        assert.equal(url.searchParams.get('businessContext'), 'maysternya_doli');
        assert.match(leadsPage, /leadOmniHref/);
        assert.match(leadsPage, /leadConversationOpenLabel/);
        assert.match(leadsPage, /Прив’язати діалог/);
        assert.match(leadsPage, /makeLeadConversationPrimary/);
        assert.match(leadsPage, /\/api\/omni\/conversations\?/);
        assert.match(leadsPage, /waitingReplyConversation/);
        assert.match(leadsPage, /workspaceBadge\(waitingReplyText\(waitingConversation\), 'waiting'\)/);
        assert.match(leadsPage, /manager-action-strip-note waiting/);
    });

    it('renders confirmed Omni lead links as manager-selectable entries', () => {
        const omniHtml = fs.readFileSync(path.resolve(__dirname, '..', 'omni.html'), 'utf8');
        assert.match(omniHtml, /context\.confirmed\?\.leads/);
        assert.match(omniHtml, /omni-case-confirmed-lead/);
        assert.match(omniHtml, /Відкрити звернення/);
    });
});
