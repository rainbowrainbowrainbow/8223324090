const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    getCustomerCommunicationContext,
    buildTimelineLink
} = require('../services/customerCommunicationHub');

function makePool(state) {
    return {
        async query(sql) {
            const text = String(sql).replace(/\s+/g, ' ');
            if (text.includes('SELECT * FROM customers WHERE id = $1')) {
                return { rows: state.customer ? [state.customer] : [] };
            }
            if (text.includes('FROM leads l')) {
                return { rows: state.lead ? [state.lead] : [] };
            }
            if (text.includes('FROM bookings')) {
                return { rows: state.bookings || [] };
            }
            if (text.includes('FROM communication_log cl')) {
                return { rows: state.crmLog || [] };
            }
            if (text.includes('WHERE c.customer_id = $1')) {
                return { rows: state.exactConversations || [] };
            }
            if (text.includes('c.customer_id IS NULL OR c.customer_id <> $1')) {
                return { rows: state.suggestedConversations || [] };
            }
            throw new Error(`Unexpected query: ${text}`);
        }
    };
}

describe('customer communication hub context', () => {
    it('prefers exact conversations and builds lead/booking handoffs', async () => {
        const context = await getCustomerCommunicationContext(701, {
            pool: makePool({
                customer: {
                    id: 701,
                    name: 'Exact Customer',
                    phone: '+380000000001',
                    lead_id: 501,
                    total_bookings: 1,
                    total_spent: 2500
                },
                lead: {
                    id: 501,
                    client_name: 'Exact Customer',
                    phone: '+380000000001',
                    pipeline_stage: 'contacted',
                    booking_id: 'BK-701',
                    assigned_name: 'Manager'
                },
                bookings: [{
                    id: 'BK-701',
                    date: '2099-05-12',
                    time: '12:30',
                    status: 'confirmed',
                    program_name: 'Birthday',
                    customer_id: 701
                }],
                crmLog: [{ id: 1, type: 'note', summary: 'Called', created_at: '2099-05-01T10:00:00Z' }],
                exactConversations: [{
                    id: 903,
                    channel: 'telegram',
                    customer_name: 'Exact Customer',
                    customer_phone: '+380000000001',
                    customer_id: 701,
                    status: 'open',
                    unread_count: 2,
                    last_message_at: '2099-05-02T09:00:00Z',
                    last_inbound_at: '2099-05-01T08:00:00Z',
                    last_outbound_at: '2099-05-02T09:00:00Z',
                    reply_expected: true,
                    awaiting_reply_since: '2099-05-02T09:00:00Z',
                    reply_expected_message_id: 1201,
                    reply_owner: 'Manager',
                    reply_owner_user_id: 501,
                    reply_sla_at: '2099-05-03T09:00:00Z',
                    reply_expected_delivery_status: 'delivered',
                    last_message: 'Hello'
                }]
            })
        });

        assert.equal(context.live.status, 'exact');
        assert.equal(context.live.primaryConversation.id, 903);
        assert.equal(context.live.primaryConversation.replyExpected, true);
        assert.equal(context.live.primaryConversation.waitingReply, true);
        assert.equal(context.live.primaryConversation.awaitingReplySince, '2099-05-02T09:00:00Z');
        assert.equal(context.live.primaryConversation.replyOwner, 'Manager');
        assert.equal(context.live.primaryConversation.replyOwnerUserId, 501);
        assert.equal(context.live.primaryConversation.replySlaState, 'on_track');
        assert.equal(context.links.omniExact, '/omni?conversation=903');
        assert.equal(context.links.omniSuggested, null);
        assert.equal(context.links.leadWorkspace, '/sales-funnel?lead=501');
        assert.equal(context.links.booking, '/?date=2099-05-12&highlight=BK-701');
        assert.equal(context.summary.crmLogCount, 1);
        assert.equal(context.sendPolicy.mode, 'navigation_only');
    });

    it('labels fallback conversation matches as suggested, not exact', async () => {
        const context = await getCustomerCommunicationContext(702, {
            pool: makePool({
                customer: {
                    id: 702,
                    name: 'Suggested Customer',
                    phone: '+380000000002',
                    lead_id: null
                },
                bookings: [],
                crmLog: [],
                exactConversations: [],
                suggestedConversations: [{
                    id: 904,
                    channel: 'viber',
                    customer_name: 'Suggested Customer',
                    customer_phone: '+380000000002',
                    customer_id: null,
                    status: 'open',
                    unread_count: 0
                }]
            })
        });

        assert.equal(context.live.status, 'suggested');
        assert.equal(context.live.primaryConversation.confidence, 'suggested');
        assert.equal(context.links.omniExact, null);
        assert.equal(context.links.omniSuggested, '/omni?conversation=904');
        assert.match(context.live.explanation, /не записано як точна CRM/i);
    });

    it('does not surface waiting reply after a later inbound cleared it', async () => {
        const context = await getCustomerCommunicationContext(706, {
            pool: makePool({
                customer: {
                    id: 706,
                    name: 'Cleared Reply Customer',
                    phone: '+380000000006'
                },
                bookings: [],
                crmLog: [],
                exactConversations: [{
                    id: 906,
                    channel: 'viber',
                    customer_name: 'Cleared Reply Customer',
                    customer_phone: '+380000000006',
                    customer_id: 706,
                    status: 'open',
                    unread_count: 1,
                    last_inbound_at: '2099-05-03T09:00:00Z',
                    last_outbound_at: '2099-05-02T09:00:00Z',
                    reply_expected: true,
                    awaiting_reply_since: '2099-05-02T09:00:00Z',
                    reply_expected_message_id: 1202,
                    reply_expected_delivery_status: 'delivered'
                }],
                suggestedConversations: []
            })
        });

        assert.equal(context.live.primaryConversation.replyExpected, true);
        assert.equal(context.live.primaryConversation.waitingReply, false);
    });

    it('keeps unavailable live context honest and falls back to Omni search only', async () => {
        const context = await getCustomerCommunicationContext(703, {
            pool: makePool({
                customer: {
                    id: 703,
                    name: 'No Conversation',
                    phone: '+380000000003'
                },
                bookings: [],
                crmLog: [],
                exactConversations: [],
                suggestedConversations: []
            })
        });

        assert.equal(context.live.status, 'unavailable');
        assert.equal(context.live.primaryConversation, null);
        assert.equal(context.links.omniExact, null);
        assert.equal(context.links.omniSuggested, null);
        assert.equal(context.links.omniSearch, '/omni?search=%2B380000000003');
    });

    it('marks inbound-only channels as not send-capable', async () => {
        const context = await getCustomerCommunicationContext(704, {
            pool: makePool({
                customer: {
                    id: 704,
                    name: 'Binotel Customer',
                    phone: '+380000000004'
                },
                bookings: [],
                crmLog: [],
                exactConversations: [{
                    id: 905,
                    channel: 'Binotel',
                    customer_name: 'Binotel Customer',
                    customer_phone: '+380000000004',
                    customer_id: 704,
                    status: 'open'
                }],
                suggestedConversations: []
            })
        });

        assert.equal(context.live.status, 'exact');
        assert.equal(context.live.primaryConversation.channel, 'binotel');
        assert.equal(context.live.primaryConversation.sendCapable, false);
        assert.match(context.live.primaryConversation.channelNote, /вхідних звернень/i);
    });

    it('wires customer hub UI for explicit waiting reply only', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const customersJs = fs.readFileSync(path.join(repoRoot, 'js/customers-page.js'), 'utf8');
        const customersHtml = fs.readFileSync(path.join(repoRoot, 'customers.html'), 'utf8');

        assert.match(customersJs, /conversation\.waitingReply/);
        assert.match(customersJs, /customerHubWaitingReply/);
        assert.match(customersJs, /replySlaState/);
        assert.match(customersHtml, /customer-hub-waiting-line/);
        assert.match(customersHtml, /customer-hub-pill\.waiting/);
    });

    it('builds timeline links from booking date and id', () => {
        assert.equal(
            buildTimelineLink({ id: 'BK 1', date: '2099-05-12T00:00:00.000Z' }),
            '/?date=2099-05-12&highlight=BK%201'
        );
    });
});
