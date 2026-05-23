'use strict';

const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');

function parseLeadId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function attachLeadBookingLink(client, { leadId, bookingId, customerId, businessContext = DEFAULT_BUSINESS_CONTEXT }) {
  const parsedLeadId = parseLeadId(leadId);
  const resolvedBookingId = bookingId ? String(bookingId) : '';
  const context = normalizeBusinessContext(businessContext);
  if (!parsedLeadId || !resolvedBookingId) {
    return { attached: false, reason: 'missing_context' };
  }

  const leadResult = await client.query(
    `UPDATE leads
     SET booking_id = $1,
         updated_at = NOW()
     WHERE id = $2
       AND COALESCE(business_context, $3) = $3
     RETURNING id, booking_id`,
    [resolvedBookingId, parsedLeadId, context]
  );

  if (!leadResult.rows.length) {
    return { attached: false, reason: 'lead_not_found', leadId: parsedLeadId };
  }

  let customerLinked = false;
  const numericCustomerId = Number.parseInt(customerId, 10);
  if (Number.isInteger(numericCustomerId) && numericCustomerId > 0) {
    const customerResult = await client.query(
      `UPDATE customers
       SET lead_id = COALESCE(lead_id, $1),
           source = COALESCE(NULLIF(source, ''), 'lead'),
           updated_at = NOW()
       WHERE id = $2
         AND COALESCE(business_context, $3) = $3`,
      [parsedLeadId, numericCustomerId, context]
    );
    customerLinked = customerResult.rowCount > 0;
  }

  return {
    attached: true,
    leadId: parsedLeadId,
    bookingId: resolvedBookingId,
    customerId: Number.isInteger(numericCustomerId) && numericCustomerId > 0 ? numericCustomerId : null,
    customerLinked,
  };
}

module.exports = {
  parseLeadId,
  attachLeadBookingLink,
};
