const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/omni-hub',
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

function loadHubWithQuery(query) {
    clearModules();
    installMock('../db', { pool: { query } });
    installMock('../services/kleshnya-chat', { generateChatResponse: async () => '' });
    installMock('../services/websocket', { getWSS: () => ({ clients: [] }) });
    installMock('../services/telegram', { sendTelegramMessage: async () => ({ success: true }) });
    installMock('../services/omni-viber', { sendViber: async () => ({ success: true }) });
    installMock('../services/omni-sms', { sendSMS: async () => ({ success: true }) });
    installMock('../services/omni-facebook', { sendFacebook: async () => ({ success: true }) });
    installMock('../services/omni-instagram', { sendInstagram: async () => ({ success: true }) });
    return require('../services/omni-hub');
}

describe('Omni Case Link v1', () => {
    afterEach(clearModules);

    it('resolves exact CRM context from durable customer and lead ids', async () => {
        const hub = loadHubWithQuery(async (sql, params = []) => {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            if (/SELECT \* FROM conversations WHERE id = \$1 LIMIT 1/i.test(text)) {
                return { rows: [{ id: params[0], channel: 'telegram', external_id: 'tg-1', customer_name: 'Exact Customer', customer_phone: '+380000000001', customer_id: 701, status: 'open', meta: {} }] };
            }
            if (/SELECT \* FROM customers WHERE id = \$1 LIMIT 1/i.test(text)) {
                return { rows: [{ id: 701, name: 'Exact Customer', phone: '+380000000001', lead_id: 501, total_bookings: 1, total_spent: 2500 }] };
            }
            if (/FROM leads l LEFT JOIN users u ON l\.assigned_to = u\.id WHERE l\.id = \$1 LIMIT 1/i.test(text)) {
                return { rows: [{ id: 501, client_name: 'Exact Customer', phone: '+380000000001', pipeline_stage: 'contacted', status: 'contact', booking_id: 'BK-2099-0001', assigned_name: 'Manager' }] };
            }
            if (/SELECT \* FROM bookings WHERE id = \$1 LIMIT 1/i.test(text)) {
                return { rows: [{ id: 'BK-2099-0001', date: '2099-05-12', time: '14:00', status: 'confirmed', customer_id: 701, program_name: 'Quest' }] };
            }
            if (/FROM bookings WHERE customer_id = \$1/i.test(text)) {
                return { rows: [{ id: 'BK-2099-0001', date: '2099-05-12', time: '14:00', status: 'confirmed', customer_id: 701, program_name: 'Quest' }] };
            }
            throw new Error(`Unexpected query: ${text}`);
        });

        const context = await hub.resolveConversationContext(903);
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
            if (/SELECT \* FROM conversations WHERE id = \$1 LIMIT 1/i.test(text)) {
                return { rows: [{ id: params[0], channel: 'viber', external_id: 'vb-1', customer_name: 'Suggested Customer', customer_phone: '+380000000002', customer_id: null, status: 'open', meta: {} }] };
            }
            if (/FROM customers WHERE \(\$1 <> '' AND regexp_replace/i.test(text)) {
                return { rows: [{ id: 702, name: 'Suggested Customer', phone: '+380000000002', lead_id: 502 }] };
            }
            if (/FROM leads l LEFT JOIN users u ON l\.assigned_to = u\.id WHERE l\.id = \$1 LIMIT 1/i.test(text)) {
                return { rows: [{ id: 502, client_name: 'Suggested Customer', phone: '+380000000002', pipeline_stage: 'new', status: 'new', booking_id: 'BK-2099-0002' }] };
            }
            if (/SELECT \* FROM bookings WHERE id = \$1 LIMIT 1/i.test(text)) {
                return { rows: [{ id: 'BK-2099-0002', date: '2099-06-01', time: '12:00', status: 'confirmed', customer_id: 702, program_name: 'Show' }] };
            }
            throw new Error(`Unexpected query: ${text}`);
        });

        const context = await hub.resolveConversationContext(904);
        assert.equal(context.confidence, 'suggested');
        assert.equal(context.exact.customer, null);
        assert.equal(context.links.leadWorkspace, null);
        assert.equal(context.suggestions.customer.id, 702);
        assert.equal(context.suggestions.lead.id, 502);
        assert.equal(context.suggestedLinks.leadWorkspace, '/sales-funnel?lead=502');
    });

    it('wires exact Omni URL state and lead workspace exact handoff in static UI', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const omniHtml = fs.readFileSync(path.join(repoRoot, 'omni.html'), 'utf8');
        const leadsPage = fs.readFileSync(path.join(repoRoot, 'js', 'leads-page.js'), 'utf8');

        assert.match(omniHtml, /params\.get\('conversation'\)/);
        assert.match(omniHtml, /selectConversationFromQuery/);
        assert.match(omniHtml, /\/conversations\/' \+ convId \+ '\/context/);
        assert.match(leadsPage, /\/omni\?conversation=/);
        assert.match(leadsPage, /leadOmniHref/);
    });
});
