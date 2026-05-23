const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseLeadId, attachLeadBookingLink } = require('../services/leadBookingLink');

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
});
