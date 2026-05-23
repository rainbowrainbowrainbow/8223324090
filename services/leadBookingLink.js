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

function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function bookingLeadStage(booking) {
  return String(booking?.status || '').toLowerCase() === 'preliminary'
    ? 'waiting'
    : 'deposit_received';
}

function bookingLeadStatus(stage) {
  return stage === 'waiting' || stage === 'deposit_received' ? 'booked' : 'new';
}

function bookingLeadClientName(booking) {
  return cleanText(
    booking?.customer?.name
    || booking?.customerName
    || booking?.groupName
    || booking?.label
    || booking?.programName
    || 'Клієнт',
    200
  );
}

function bookingLeadNotes(booking) {
  const parts = [
    booking?.programName || booking?.programCode || booking?.label
      ? `Бронювання: ${booking.programName || booking.programCode || booking.label}`
      : null,
    booking?.date || booking?.time ? `Дата/час: ${[booking.date, booking.time].filter(Boolean).join(' ')}` : null,
    booking?.room ? `Кімната: ${booking.room}` : null,
    booking?.notes ? `Нотатки: ${booking.notes}` : null,
  ].filter(Boolean);
  return cleanText(parts.join('\n'), 1500);
}

async function linkCustomerToLead(client, { leadId, customerId, businessContext }) {
  const numericCustomerId = Number.parseInt(customerId, 10);
  if (!Number.isInteger(numericCustomerId) || numericCustomerId <= 0 || !leadId) return false;
  const result = await client.query(
    `UPDATE customers
     SET lead_id = COALESCE(lead_id, $1),
         source = COALESCE(NULLIF(source, ''), 'booking'),
         updated_at = NOW()
     WHERE id = $2
       AND COALESCE(business_context, $3) = $3`,
    [leadId, numericCustomerId, businessContext]
  );
  return result.rowCount > 0;
}

async function ensureLeadForBooking(client, { booking, customerId, businessContext = DEFAULT_BUSINESS_CONTEXT }) {
  const context = normalizeBusinessContext(businessContext);
  const bookingId = booking?.id ? String(booking.id) : '';
  const customer = booking?.customer || {};
  const phone = cleanText(customer.phone || booking?.phone, 50);
  const instagram = cleanText(customer.instagram || booking?.instagram, 100);
  const clientName = bookingLeadClientName(booking);

  if (!bookingId || (!clientName && !phone && !instagram && !customerId)) {
    return { attached: false, reason: 'missing_context' };
  }

  const stage = bookingLeadStage(booking);
  const status = bookingLeadStatus(stage);
  const programId = cleanText(booking?.programId || booking?.program_id, 50);
  const notes = bookingLeadNotes(booking);
  const childrenCount = Number.parseInt(booking?.kidsCount || booking?.childrenCount || booking?.children_count, 10);
  const safeChildrenCount = Number.isInteger(childrenCount) && childrenCount >= 0 ? childrenCount : null;

  const lookupParams = [context, bookingId, phone, instagram].filter(value => value !== undefined);
  const lookup = await client.query(
    `SELECT id
     FROM leads
     WHERE COALESCE(business_context, $1) = $1
       AND status NOT IN ('closed','lost')
       AND (
            booking_id = $2
            OR (
              booking_id IS NULL
              AND (
                ($3::text IS NOT NULL AND phone = $3)
                OR ($4::text IS NOT NULL AND instagram = $4)
              )
            )
       )
     ORDER BY
       CASE WHEN booking_id = $2 THEN 0 ELSE 1 END,
       id DESC
     LIMIT 1`,
    lookupParams
  );

  let leadId = parseLeadId(lookup.rows[0]?.id);
  let created = false;

  if (leadId) {
    await client.query(
      `UPDATE leads
       SET booking_id = COALESCE(booking_id, $1),
           client_name = COALESCE(NULLIF(client_name, ''), $2),
           phone = COALESCE(NULLIF(phone, ''), $3),
           instagram = COALESCE(NULLIF(instagram, ''), $4),
           program_id = COALESCE(program_id, $5),
           event_date = COALESCE(event_date, $6::date),
           children_count = COALESCE(children_count, $7),
           source = COALESCE(NULLIF(source, ''), 'booking'),
           source_channel = COALESCE(NULLIF(source_channel, ''), 'booking'),
           pipeline_stage = CASE
             WHEN COALESCE(pipeline_stage, 'new') IN ('new','contacted','info_sent','deal') THEN $8
             ELSE pipeline_stage
           END,
           status = CASE
             WHEN COALESCE(status, 'new') IN ('new','contact','proposal') THEN $9
             ELSE status
           END,
           booked_at = COALESCE(booked_at, NOW()),
           notes = CASE
             WHEN $10::text IS NULL OR $10::text = '' THEN notes
             WHEN notes IS NULL OR notes = '' THEN $10
             WHEN POSITION($1 IN notes) > 0 THEN notes
             ELSE notes || E'\n' || $10
           END,
           updated_at = NOW()
       WHERE id = $11
         AND COALESCE(business_context, $12) = $12`,
      [bookingId, clientName, phone, instagram, programId, booking?.date || null, safeChildrenCount,
       stage, status, notes, leadId, context]
    );
  } else {
    const inserted = await client.query(
      `INSERT INTO leads
         (business_context, client_name, phone, instagram, source, source_channel,
          external_id, program_id, event_date, children_count, notes, status,
          pipeline_stage, booking_id, booked_at)
       VALUES ($1,$2,$3,$4,'booking','booking',$5,$6,$7,$8,$9,$10,$11,$5,NOW())
       ON CONFLICT (business_context, source_channel, external_id)
         WHERE external_id IS NOT NULL DO UPDATE SET
           booking_id = EXCLUDED.booking_id,
           updated_at = NOW()
       RETURNING id`,
      [context, clientName, phone, instagram, bookingId, programId,
       booking?.date || null, safeChildrenCount, notes, status, stage]
    );
    leadId = parseLeadId(inserted.rows[0]?.id);
    created = Boolean(leadId);
  }

  const customerLinked = await linkCustomerToLead(client, { leadId, customerId, businessContext: context });
  return {
    attached: Boolean(leadId),
    created,
    leadId,
    bookingId,
    customerId: Number.parseInt(customerId, 10) || null,
    customerLinked,
    businessContext: context,
  };
}

module.exports = {
  parseLeadId,
  attachLeadBookingLink,
  ensureLeadForBooking,
};
