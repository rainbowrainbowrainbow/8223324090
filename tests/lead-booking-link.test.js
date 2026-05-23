const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseLeadId, attachLeadBookingLink, ensureLeadForBooking } = require('../services/leadBookingLink');

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
                    return { rows: [{ id: params[1], booking_id: params[0] }], rowCount: 1 };
                }
                if (/UPDATE customers SET lead_id = COALESCE\(lead_id, \$1\)/i.test(text)) {
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
        assert.equal(result.customerLinked, true);
        assert.ok(queries.some(q =>
            /UPDATE leads SET booking_id = \$1/i.test(q.text)
            && q.params[0] === 'BK-2099-0001'
            && q.params[2] === 'event_genix'
        ));
        assert.ok(queries.some(q =>
            /UPDATE customers SET lead_id = COALESCE\(lead_id, \$1\)/i.test(q.text)
            && q.params[0] === 501
            && q.params[2] === 'event_genix'
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
                    return { rows: [{ id: params[1], booking_id: params[0] }], rowCount: 1 };
                }
                return { rows: [], rowCount: 1 };
            }
        };

        await attachLeadBookingLink(client, {
            leadId: 9,
            bookingId: 'MD-1',
            customerId: 44,
            businessContext: 'maysternya_doli'
        });

        assert.equal(queries.length, 2);
        assert.ok(queries.every(q => q.params.includes('maysternya_doli')));
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
                if (/UPDATE customers SET lead_id = COALESCE\(lead_id, \$1\)/i.test(text)) {
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
        assert.equal(insert.params[0], 'maysternya_doli');
        assert.equal(insert.params[4], 'BK-2099-0101');
        assert.equal(insert.params[9], 'booked');
        assert.equal(insert.params[10], 'deposit_received');
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
                if (/UPDATE customers SET lead_id = COALESCE\(lead_id, \$1\)/i.test(text)) {
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
        assert.ok(queries.some(q => /booking_id IS NULL/i.test(q.text)));
        assert.ok(queries.every(q => q.params.includes('maysternya_doli')));
    });
});
