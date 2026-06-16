const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseLeadId, attachLeadBookingLink, ensureLeadForBooking } = require('../services/leadBookingLink');

function isCustomerLeadUpdate(text) {
    return /UPDATE customers SET lead_id = COALESCE\(lead_id, \$1\)/i.test(text);
}

function isCustomerLinkUpsert(text) {
    return /INSERT INTO lead_customer_links \(business_context, lead_id, customer_id, link_type, source, metadata, updated_at\)/i.test(text);
}

describe('lead booking link repair', () => {
    it('parses only positive lead ids', () => {
        assert.equal(parseLeadId('501'), 501);
        assert.equal(parseLeadId(12), 12);
        assert.equal(parseLeadId('0'), null);
        assert.equal(parseLeadId('bad'), null);
    });

    it('writes leads.booking_id and preserves customer lead linkage through existing fields', async () => {
        const queries = [];
        const client = {
            query: async (sql, params = []) => {
                const text = String(sql).replace(/\s+/g, ' ').trim();
                queries.push({ text, params });
                if (/UPDATE leads SET booking_id = \$1/i.test(text)) {
                    return { rows: [{ id: params[1], booking_id: params[0], pipeline_stage: params[3], status: params[4] }], rowCount: 1 };
                }
                if (isCustomerLeadUpdate(text)) {
                    return { rows: [], rowCount: 1 };
                }
                if (isCustomerLinkUpsert(text)) {
                    return { rows: [], rowCount: 1 };
                }
                throw new Error(`Unexpected query: ${text}`);
            }
        };

        const result = await attachLeadBookingLink(client, {
            leadId: '501',
            bookingId: 'BK-2099-0001',
            customerId: '701'
        });

        assert.equal(result.attached, true);
        assert.equal(result.leadId, 501);
        assert.equal(result.bookingId, 'BK-2099-0001');
        assert.equal(result.pipelineStage, 'deposit_received');
        assert.equal(result.status, 'booked');
        assert.equal(result.customerLinked, true);
        assert.ok(queries.some(q =>
            /UPDATE leads SET booking_id = \$1/i.test(q.text)
            && q.params[0] === 'BK-2099-0001'
            && q.params[2] === 'event_genix'
            && q.params[3] === 'deposit_received'
            && q.params[4] === 'booked'
        ));
        const leadUpdate = queries.find(q => /UPDATE leads SET booking_id = \$1/i.test(q.text));
        assert.doesNotMatch(leadUpdate.text, /updated_at/i);
        assert.ok(queries.some(q =>
            isCustomerLeadUpdate(q.text)
            && q.params[0] === 501
            && q.params[2] === 'event_genix'
        ));
        assert.ok(queries.some(q =>
            isCustomerLinkUpsert(q.text)
            && q.params[0] === 'event_genix'
            && q.params[1] === 501
            && q.params[2] === 701
        ));
    });

    it('does not touch bookings created without lead context', async () => {
        const client = {
            query: async () => {
                throw new Error('query should not run without lead context');
            }
        };
        const result = await attachLeadBookingLink(client, { leadId: null, bookingId: 'BK-2099-0002', customerId: 701 });
        assert.equal(result.attached, false);
        assert.equal(result.reason, 'missing_context');
    });

    it('scopes lead/customer linkage to the passed business context', async () => {
        const queries = [];
        const client = {
            query: async (sql, params = []) => {
                const text = String(sql).replace(/\s+/g, ' ').trim();
                queries.push({ text, params });
                if (/UPDATE leads SET booking_id = \$1/i.test(text)) {
                    return { rows: [{ id: params[1], booking_id: params[0], pipeline_stage: params[3], status: params[4] }], rowCount: 1 };
                }
                return { rows: [], rowCount: 1 };
            }
        };

        await attachLeadBookingLink(client, {
            leadId: 9,
            bookingId: 'MD-1',
            customerId: 44,
            businessContext: 'maysternya_doli',
            bookingStatus: 'preliminary'
        });

        assert.equal(queries.length, 3);
        assert.ok(queries.every(q => q.params.includes('maysternya_doli')));
        assert.equal(queries[0].params[3], 'waiting');
        assert.equal(queries[0].params[4], 'booked');
    });

    it('creates a scoped lead for non-park booking CRM handoff', async () => {
        const queries = [];
        const client = {
            query: async (sql, params = []) => {
                const text = String(sql).replace(/\s+/g, ' ').trim();
                queries.push({ text, params });
                if (/SELECT id FROM leads WHERE/i.test(text)) {
                    return { rows: [], rowCount: 0 };
                }
                if (/INSERT INTO leads/i.test(text)) {
                    return { rows: [{ id: 77 }], rowCount: 1 };
                }
                if (isCustomerLeadUpdate(text)) {
                    return { rows: [], rowCount: 1 };
                }
                if (isCustomerLinkUpsert(text)) {
                    return { rows: [], rowCount: 1 };
                }
                throw new Error(`Unexpected query: ${text}`);
            }
        };

        const result = await ensureLeadForBooking(client, {
            booking: {
                id: 'BK-2099-0101',
                status: 'confirmed',
                date: '2099-05-23',
                time: '14:00',
                programId: 'md_full_consult_40',
                programName: 'Повна консультація',
                kidsCount: 1,
                customer: {
                    name: 'Тест МД',
                    phone: '+380991111111',
                    instagram: '@mdtest'
                }
            },
            customerId: 701,
            businessContext: 'maysternya_doli'
        });

        assert.equal(result.attached, true);
        assert.equal(result.created, true);
        assert.equal(result.leadId, 77);
        assert.equal(result.customerLinked, true);
        const insert = queries.find(q => /INSERT INTO leads/i.test(q.text));
        assert.ok(insert);
        assert.doesNotMatch(insert.text, /updated_at/i);
        assert.match(insert.text, /raw_payload, lead_type, status/i);
        assert.match(insert.text, /\$13::jsonb,'quality',\$14/i);
        assert.equal(insert.params[0], 'maysternya_doli');
        assert.equal(insert.params[5], 'booking');
        assert.equal(insert.params[6], 'booking');
        assert.equal(insert.params[7], 'BK-2099-0101');
        assert.equal(insert.params[13], 'booked');
        assert.equal(insert.params[14], 'deposit_received');
        assert.equal(insert.params[15], 'BK-2099-0101');
    });

    it('persists Maysternya bot booking contacts into lead metadata', async () => {
        const queries = [];
        const client = {
            query: async (sql, params = []) => {
                const text = String(sql).replace(/\s+/g, ' ').trim();
                queries.push({ text, params });
                if (/SELECT id FROM leads WHERE/i.test(text)) {
                    return { rows: [], rowCount: 0 };
                }
                if (/INSERT INTO leads/i.test(text)) {
                    return { rows: [{ id: 91 }], rowCount: 1 };
                }
                if (isCustomerLeadUpdate(text)) {
                    return { rows: [], rowCount: 1 };
                }
                if (isCustomerLinkUpsert(text)) {
                    return { rows: [], rowCount: 1 };
                }
                throw new Error(`Unexpected query: ${text}`);
            }
        };

        const result = await ensureLeadForBooking(client, {
            booking: {
                id: 'BK-2099-0103',
                externalId: 'telegram-booking-abc',
                status: 'confirmed',
                date: '2099-05-25',
                time: '16:00',
                programId: 'maysternya-paid-session',
                programName: 'Paid consultation',
                leadSource: 'maysternya_bot',
                sourceChannel: 'maysternya_bot',
                requestTopic: 'Natal chart',
                sessionType: 'PAID_SESSION',
                rawPayload: {
                    external_id: 'telegram-booking-abc',
                    customer: { email: 'client@example.com' }
                },
                customer: {
                    name: 'Bot Client',
                    phone: '+380501112233',
                    instagram: '@bot_client',
                    email: 'client@example.com',
                    whatsapp: '+380501112244',
                    telegramId: '123456789',
                    telegramUsername: '@botclient',
                    contactChannels: ['telegram', 'whatsapp', 'email']
                }
            },
            customerId: 703,
            businessContext: 'maysternya_doli'
        });

        assert.equal(result.attached, true);
        assert.equal(result.created, true);
        const lookup = queries.find(q => /SELECT id FROM leads WHERE/i.test(q.text));
        assert.ok(lookup);
        assert.equal(lookup.params[4], 'telegram-booking-abc');
        assert.equal(lookup.params[5], 'maysternya_bot');
        assert.equal(lookup.params[6], '123456789');

        const insert = queries.find(q => /INSERT INTO leads/i.test(q.text));
        assert.ok(insert);
        assert.doesNotMatch(insert.text, /updated_at/i);
        assert.match(insert.text, /telegram_id/i);
        assert.match(insert.text, /raw_payload/i);
        assert.match(insert.text, /raw_payload, lead_type, status/i);
        assert.equal(insert.params[0], 'maysternya_doli');
        assert.equal(insert.params[3], '123456789');
        assert.equal(insert.params[5], 'maysternya_bot');
        assert.equal(insert.params[6], 'maysternya_bot');
        assert.equal(insert.params[7], 'telegram-booking-abc');
        assert.equal(insert.params[13], 'new');
        assert.equal(insert.params[14], 'new');
        assert.match(insert.params[11], /Telegram: @botclient \/ ID 123456789/);
        assert.match(insert.params[11], /WhatsApp: \+380501112244/);
        assert.match(insert.params[11], /Email: client@example\.com/);
        const rawPayload = JSON.parse(insert.params[12]);
        assert.equal(rawPayload.email, 'client@example.com');
        assert.equal(rawPayload.whatsapp, '+380501112244');
        assert.deepEqual(rawPayload.contact_channels.slice(0, 3), ['telegram', 'whatsapp', 'email']);
        assert.equal(rawPayload.normalized.source_channel, 'maysternya_bot');
        assert.equal(rawPayload.normalized.crm_booking_id, 'BK-2099-0103');
        assert.equal(rawPayload.normalized.telegram_username, 'botclient');
    });

    it('reuses an existing scoped lead for booking CRM handoff', async () => {
        const queries = [];
        const client = {
            query: async (sql, params = []) => {
                const text = String(sql).replace(/\s+/g, ' ').trim();
                queries.push({ text, params });
                if (/SELECT id FROM leads WHERE/i.test(text)) {
                    return { rows: [{ id: 88 }], rowCount: 1 };
                }
                if (/UPDATE leads SET booking_id = COALESCE\(booking_id, \$1\)/i.test(text)) {
                    return { rows: [], rowCount: 1 };
                }
                if (isCustomerLeadUpdate(text)) {
                    return { rows: [], rowCount: 1 };
                }
                if (isCustomerLinkUpsert(text)) {
                    return { rows: [], rowCount: 1 };
                }
                throw new Error(`Unexpected query: ${text}`);
            }
        };

        const result = await ensureLeadForBooking(client, {
            booking: {
                id: 'BK-2099-0102',
                status: 'preliminary',
                date: '2099-05-24',
                customer: { name: 'Існуючий лід', phone: '+380992222222' }
            },
            customerId: 702,
            businessContext: 'maysternya_doli'
        });

        assert.equal(result.attached, true);
        assert.equal(result.created, false);
        assert.equal(result.leadId, 88);
        assert.ok(!queries.some(q => /INSERT INTO leads/i.test(q.text)));
        const leadUpdate = queries.find(q => /UPDATE leads SET booking_id = COALESCE\(booking_id, \$1\)/i.test(q.text));
        assert.ok(leadUpdate);
        assert.doesNotMatch(leadUpdate.text, /updated_at/i);
        assert.match(leadUpdate.text, /lead_type = COALESCE\(NULLIF\(lead_type, ''\), 'quality'\)/i);
        assert.ok(queries.some(q => /booking_id IS NULL/i.test(q.text)));
        assert.ok(queries.every(q => q.params.includes('maysternya_doli')));
    });

    it('does not reuse terminal leads by contact for Maysternya bot bookings', async () => {
        const queries = [];
        const client = {
            query: async (sql, params = []) => {
                const text = String(sql).replace(/\s+/g, ' ').trim();
                queries.push({ text, params });
                if (/SELECT id FROM leads WHERE/i.test(text)) {
                    return { rows: [], rowCount: 0 };
                }
                if (/INSERT INTO leads/i.test(text)) {
                    return { rows: [{ id: 92 }], rowCount: 1 };
                }
                if (isCustomerLeadUpdate(text) || isCustomerLinkUpsert(text)) {
                    return { rows: [], rowCount: 1 };
                }
                throw new Error(`Unexpected query: ${text}`);
            }
        };

        const result = await ensureLeadForBooking(client, {
            booking: {
                id: 'BK-2099-0104',
                externalId: 'telegram-booking-terminal-guard',
                status: 'confirmed',
                date: '2099-05-26',
                time: '12:00',
                leadSource: 'maysternya_bot',
                sourceChannel: 'maysternya_bot',
                customer: {
                    telegramId: '987654321',
                    telegramUsername: '@returning_client'
                }
            },
            customerId: 704,
            businessContext: 'maysternya_doli'
        });

        assert.equal(result.attached, true);
        assert.equal(result.created, true);
        assert.equal(result.leadId, 92);

        const lookup = queries.find(q => /SELECT id FROM leads WHERE/i.test(q.text));
        assert.ok(lookup);
        assert.match(lookup.text, /COALESCE\(status, 'new'\) NOT IN \('closed','lost','completed'\)/i);
        assert.match(lookup.text, /COALESCE\(pipeline_stage, 'new'\) NOT IN \('completed','closed','lost'\)/i);
        assert.match(lookup.text, /\$8::boolean = false/i);
        assert.equal(lookup.params[7], true);

        const insert = queries.find(q => /INSERT INTO leads/i.test(q.text));
        assert.equal(insert.params[13], 'new');
        assert.equal(insert.params[14], 'new');
    });
});
