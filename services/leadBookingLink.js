'use strict';

const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');
const { transitionLeadStage } = require('./leadStageTransition');

function parseLeadId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function upsertLeadCustomerLink(client, { leadId, customerId, businessContext, source = 'booking_handoff' }) {
  const parsedLeadId = parseLeadId(leadId);
  const numericCustomerId = Number.parseInt(customerId, 10);
  if (!parsedLeadId || !Number.isInteger(numericCustomerId) || numericCustomerId <= 0) return false;
  const result = await client.query(
    `INSERT INTO lead_customer_links (business_context, lead_id, customer_id, link_type, source, metadata, updated_at)
     VALUES ($1, $2, $3, 'booking_customer', $4, $5::jsonb, NOW())
     ON CONFLICT (business_context, lead_id, customer_id, link_type) DO UPDATE SET
       source = COALESCE(EXCLUDED.source, lead_customer_links.source),
       metadata = COALESCE(lead_customer_links.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
       updated_at = NOW()`,
    [businessContext, parsedLeadId, numericCustomerId, source, JSON.stringify({ source: 'leadBookingLink' })]
  );
  return result.rowCount > 0;
}

async function attachLeadBookingLink(client, { leadId, bookingId, customerId, businessContext = DEFAULT_BUSINESS_CONTEXT, bookingStatus = null }) {
  const parsedLeadId = parseLeadId(leadId);
  const resolvedBookingId = bookingId ? String(bookingId) : '';
  const context = normalizeBusinessContext(businessContext);
  if (!parsedLeadId || !resolvedBookingId) {
    return { attached: false, reason: 'missing_context' };
  }
  const stage = bookingLeadStage({ status: bookingStatus || 'confirmed' });
  const allowedFromStages = new Set(['new', 'contacted', 'info_sent', 'deal', 'waiting']);

  let transition;
  try {
    transition = await transitionLeadStage(client, {
      leadId: parsedLeadId,
      businessContext: context,
      targetStage: stage,
      bookingId: resolvedBookingId,
      allowedFromStages,
      source: 'leadBookingLink.attach'
    });
  } catch (err) {
    if (err?.code === 'lead_not_found' || err?.statusCode === 404) {
      return { attached: false, reason: 'lead_not_found', leadId: parsedLeadId };
    }
    throw err;
  }
  const updatedLead = transition.updatedLead;

  if (!updatedLead?.id) {
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
    const linkInserted = await upsertLeadCustomerLink(client, {
      leadId: parsedLeadId,
      customerId: numericCustomerId,
      businessContext: context,
      source: 'booking_attach'
    });
    customerLinked = customerLinked || linkInserted;
  }

  return {
    attached: true,
    leadId: parsedLeadId,
    bookingId: resolvedBookingId,
    pipelineStage: updatedLead.pipeline_stage || stage,
    status: updatedLead.status || bookingLeadStatus(updatedLead.pipeline_stage || stage),
    stageChanged: Boolean(transition.changed),
    enteredDepositStage: Boolean(transition.enteredDepositStage),
    customerId: Number.isInteger(numericCustomerId) && numericCustomerId > 0 ? numericCustomerId : null,
    customerLinked,
  };
}

function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseTextList(value) {
  if (Array.isArray(value)) {
    return value.map(item => cleanText(item, 80)).filter(Boolean);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(item => cleanText(item, 80)).filter(Boolean);
    } catch {}
    return value.split(/[,;]+/).map(item => cleanText(item, 80)).filter(Boolean);
  }
  return [];
}

function normalizeTelegramId(value) {
  const text = cleanText(value, 20);
  if (!text || !/^\d{1,19}$/.test(text)) return null;
  try {
    return BigInt(text) <= 9223372036854775807n ? text : null;
  } catch {
    return null;
  }
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, item]) => {
      if (item === undefined || item === null || item === '') return false;
      if (Array.isArray(item)) return item.length > 0;
      if (typeof item === 'object') return Object.keys(item).length > 0;
      return true;
    })
  );
}

function uniqueTextList(values, limit = 12) {
  const seen = new Set();
  const items = [];
  for (const value of values.flatMap(parseTextList)) {
    const normalized = cleanText(value, 80);
    const key = normalized ? normalized.toLowerCase() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
    if (items.length >= limit) break;
  }
  return items;
}

const LEAD_STAGE_TO_STATUS = {
  new: 'new',
  contacted: 'contact',
  info_sent: 'contact',
  deal: 'proposal',
  deposit_received: 'booked',
  waiting: 'booked',
  completed: 'completed',
  closed: 'completed',
  lost: 'lost',
};

const VALID_LEAD_PIPELINE_STAGES = new Set(Object.keys(LEAD_STAGE_TO_STATUS));

function bookingLeadStage(booking) {
  const explicitStage = cleanText(booking?.leadPipelineStage || booking?.lead_pipeline_stage, 50);
  if (explicitStage && VALID_LEAD_PIPELINE_STAGES.has(explicitStage)) return explicitStage;
  const sourceChannel = cleanText(
    booking?.sourceChannel
    || booking?.source_channel
    || booking?.leadSourceChannel
    || booking?.lead_source_channel,
    50
  );
  if (sourceChannel === 'maysternya_bot') return 'new';
  return String(booking?.status || '').toLowerCase() === 'preliminary'
    ? 'waiting'
    : 'deposit_received';
}

function bookingLeadStatus(stage) {
  return LEAD_STAGE_TO_STATUS[stage] || 'new';
}

function bookingHasBanquetSignal(booking) {
  if (!booking || typeof booking !== 'object') return false;
  const category = cleanText(
    booking.category
    || booking.bookingCategory
    || booking.booking_category,
    50
  );
  if (category && category.toLowerCase() === 'banquet') return true;

  const extra = parseJsonObject(booking.extraData || booking.extra_data);
  const packageData = parseJsonObject(
    booking.bookingPackage
    || booking.booking_package
    || extra.bookingPackage
    || extra.booking_package
  );
  return Boolean(
    booking.banquetGuests || booking.banquet_guests
    || booking.banquetAdults || booking.banquet_adults
    || booking.banquetTables || booking.banquet_tables
    || booking.banquetMenu || booking.banquet_menu
    || packageData.banquetGuests || packageData.guestCount
    || packageData.adults || packageData.tables
    || packageData.menuPositions || packageData.serviceEvents
  );
}

function bookingLeadDateTimeNotes(booking) {
  const hasDate = Boolean(booking?.date);
  const hasTime = Boolean(booking?.time);
  if (!hasDate && !hasTime) return null;
  if (!bookingHasBanquetSignal(booking)) {
    return `Дата/час: ${[booking.date, booking.time].filter(Boolean).join(' ')}`;
  }
  return [
    hasDate ? `Дата банкету: ${booking.date}` : null,
    hasTime ? `Прихід гостей: ${booking.time}` : null,
  ].filter(Boolean).join('\n');
}

function bookingLeadClientName(booking) {
  return cleanText(
    booking?.customer?.name
    || booking?.customer?.fullName
    || booking?.customer?.full_name
    || booking?.customerName
    || booking?.groupName
    || booking?.label
    || booking?.customer?.telegramUsername
    || booking?.customer?.telegram_username
    || booking?.telegramUsername
    || booking?.telegram_username
    || booking?.customer?.phone
    || booking?.customer?.whatsapp
    || booking?.programName
    || 'Клієнт',
    200
  );
}

function bookingLeadNotes(booking, meta = {}) {
  const parts = [
    booking?.id ? `Booking ID: ${booking.id}` : null,
    meta.requestTopic ? `Topic: ${meta.requestTopic}` : null,
    meta.sessionType ? `Session: ${meta.sessionType}` : null,
    meta.telegramUsername || meta.telegramId
      ? `Telegram: ${[meta.telegramUsername ? `@${meta.telegramUsername}` : null, meta.telegramId ? `ID ${meta.telegramId}` : null].filter(Boolean).join(' / ')}`
      : null,
    meta.whatsapp ? `WhatsApp: ${meta.whatsapp}` : null,
    meta.email ? `Email: ${meta.email}` : null,
    meta.contactChannels?.length ? `Contact channels: ${meta.contactChannels.join(', ')}` : null,
    booking?.programName || booking?.programCode || booking?.label
      ? `Бронювання: ${booking.programName || booking.programCode || booking.label}`
      : null,
    bookingLeadDateTimeNotes(booking),
    booking?.room ? `Кімната: ${booking.room}` : null,
    booking?.notes ? `Нотатки: ${booking.notes}` : null,
  ].filter(Boolean);
  return cleanText(parts.join('\n'), 1500);
}

function bookingLeadSource(booking) {
  return cleanText(booking?.leadSource || booking?.lead_source, 50) || 'booking';
}

function bookingLeadSourceChannel(booking, source) {
  return cleanText(
    booking?.sourceChannel
    || booking?.source_channel
    || booking?.leadSourceChannel
    || booking?.lead_source_channel,
    50
  ) || source || 'booking';
}

function bookingLeadExternalId(booking, bookingId) {
  return cleanText(
    booking?.externalId
    || booking?.external_id
    || booking?.leadExternalId
    || booking?.lead_external_id
    || bookingId,
    200
  );
}

function bookingLeadContactMeta(booking, customer, { phone, instagram }) {
  const telegramId = normalizeTelegramId(
    customer.telegramId
    || customer.telegram_id
    || booking?.telegramId
    || booking?.telegram_id
    || booking?.telegram?.id
  );
  const telegramUsername = cleanText(
    customer.telegramUsername
    || customer.telegram_username
    || booking?.telegramUsername
    || booking?.telegram_username
    || booking?.telegram?.username,
    100
  );
  const whatsapp = cleanText(customer.whatsapp || customer.whatsapp_phone || booking?.whatsapp || booking?.whatsapp_phone, 50);
  const email = cleanText(customer.email || customer.contact_email || booking?.email || booking?.contact_email, 200);
  const requestTopic = cleanText(
    booking?.requestTopic
    || booking?.request_topic
    || customer.requestTopic
    || customer.request_topic,
    200
  );
  const sessionType = cleanText(
    booking?.sessionType
    || booking?.session_type
    || customer.sessionType
    || customer.session_type,
    120
  );
  const contactChannels = uniqueTextList([
    customer.contactChannels,
    customer.contact_channels,
    booking?.contactChannels,
    booking?.contact_channels,
    telegramId || telegramUsername ? ['telegram'] : [],
    whatsapp ? ['whatsapp'] : [],
    phone ? ['phone'] : [],
    instagram ? ['instagram'] : [],
    email ? ['email'] : []
  ]);
  return {
    telegramId,
    telegramUsername: telegramUsername ? telegramUsername.replace(/^@+/, '') : null,
    whatsapp,
    email,
    requestTopic,
    sessionType,
    contactChannels,
    message: cleanText(customer.message || booking?.message || booking?.notes, 1000)
  };
}

function bookingLeadRawPayload(booking, meta) {
  const customer = booking?.customer || {};
  const original = parseJsonObject(booking?.rawPayload || booking?.raw_payload || customer.rawPayload || customer.raw_payload);
  const originalNormalized = parseJsonObject(original.normalized);
  const topLevel = compactObject({
    external_id: meta.externalId,
    booking_id: meta.bookingId,
    bookingId: meta.bookingId,
    phone: meta.phone,
    instagram: meta.instagram,
    telegram_id: meta.telegramId,
    telegram_username: meta.telegramUsername,
    whatsapp: meta.whatsapp,
    email: meta.email,
    contact_channels: meta.contactChannels,
    request_topic: meta.requestTopic,
    session_type: meta.sessionType,
    message: meta.message,
    booking_date: booking?.date || null,
    booking_time: booking?.time || null
  });
  const normalized = compactObject({
    ...originalNormalized,
    source_channel: meta.sourceChannel,
    crm_booking_id: meta.bookingId,
    external_id: meta.externalId,
    telegram_id: meta.telegramId,
    telegram_username: meta.telegramUsername,
    whatsapp: meta.whatsapp,
    contact_channels: meta.contactChannels,
    request_topic: meta.requestTopic,
    session_type: meta.sessionType,
    booking_date: booking?.date || null,
    booking_time: booking?.time || null
  });
  if (!Object.keys(original).length && !Object.keys(topLevel).length && !Object.keys(normalized).length) {
    return null;
  }
  return compactObject({
    ...original,
    ...topLevel,
    normalized
  });
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
  const linkInserted = await upsertLeadCustomerLink(client, { leadId, customerId: numericCustomerId, businessContext });
  return result.rowCount > 0 || linkInserted;
}

async function ensureLeadForBooking(client, { booking, customerId, businessContext = DEFAULT_BUSINESS_CONTEXT }) {
  const context = normalizeBusinessContext(businessContext);
  const bookingId = booking?.id ? String(booking.id) : '';
  const customer = booking?.customer || {};
  const phone = cleanText(customer.phone || booking?.phone || customer.whatsapp || booking?.whatsapp, 50);
  const instagram = cleanText(customer.instagram || booking?.instagram, 100);
  const clientName = bookingLeadClientName(booking);
  const source = bookingLeadSource(booking);
  const sourceChannel = bookingLeadSourceChannel(booking, source);
  const externalId = bookingLeadExternalId(booking, bookingId);
  const contactMeta = bookingLeadContactMeta(booking, customer, { phone, instagram });
  const restrictContactReuse = sourceChannel === 'maysternya_bot';

  if (!bookingId || (!clientName && !phone && !instagram && !contactMeta.telegramId && !contactMeta.telegramUsername && !contactMeta.whatsapp && !contactMeta.email && !customerId)) {
    return { attached: false, reason: 'missing_context' };
  }

  const stage = bookingLeadStage(booking);
  const status = bookingLeadStatus(stage);
  const programId = cleanText(booking?.programId || booking?.program_id, 50);
  const notes = bookingLeadNotes(booking, contactMeta);
  const childrenCount = Number.parseInt(booking?.kidsCount || booking?.childrenCount || booking?.children_count, 10);
  const safeChildrenCount = Number.isInteger(childrenCount) && childrenCount >= 0 ? childrenCount : null;
  const rawPayload = bookingLeadRawPayload(booking, {
    ...contactMeta,
    bookingId,
    externalId,
    sourceChannel,
    phone,
    instagram
  });
  const rawPayloadJson = rawPayload ? JSON.stringify(rawPayload) : null;

  const lookup = await client.query(
    `SELECT id
     FROM leads
     WHERE COALESCE(business_context, $1) = $1
       AND (
            booking_id = $2
            OR (
              COALESCE(status, 'new') NOT IN ('closed','lost','completed')
              AND COALESCE(pipeline_stage, 'new') NOT IN ('completed','closed','lost')
              AND (
                (
                  $5::text IS NOT NULL
                  AND external_id = $5
                  AND COALESCE(source_channel, '') = $6
                )
                OR (
                  $8::boolean = false
                  AND (
                    ($7::bigint IS NOT NULL AND telegram_id = $7::bigint)
                    OR (
                      booking_id IS NULL
                      AND (
                        ($3::text IS NOT NULL AND phone = $3)
                        OR ($4::text IS NOT NULL AND instagram = $4)
                      )
                    )
                  )
                )
              )
            )
       )
     ORDER BY
       CASE WHEN booking_id = $2 THEN 0 ELSE 1 END,
       id DESC
     LIMIT 1`,
    [context, bookingId, phone, instagram, externalId, sourceChannel, contactMeta.telegramId, restrictContactReuse]
  );

  let leadId = parseLeadId(lookup.rows[0]?.id);
  let created = false;

  if (leadId) {
    await client.query(
      `UPDATE leads
       SET booking_id = COALESCE(booking_id, $1),
           client_name = COALESCE(NULLIF(client_name, ''), $2),
           phone = COALESCE(NULLIF(phone, ''), $3),
           telegram_id = COALESCE(telegram_id, $4::bigint),
           instagram = COALESCE(NULLIF(instagram, ''), $5),
           source = COALESCE(NULLIF(source, ''), $6),
           source_channel = COALESCE(NULLIF(source_channel, ''), $7),
           external_id = COALESCE(NULLIF(external_id, ''), $8),
           program_id = COALESCE(program_id, $9),
           event_date = COALESCE(event_date, $10::date),
           children_count = COALESCE(children_count, $11),
           lead_type = COALESCE(NULLIF(lead_type, ''), 'quality'),
           pipeline_stage = CASE
             WHEN COALESCE(pipeline_stage, 'new') IN ('new','contacted','info_sent','deal','waiting') THEN $12
             ELSE pipeline_stage
           END,
           status = CASE
             WHEN COALESCE(status, 'new') IN ('new','contact','proposal') THEN $13
             ELSE status
           END,
           booked_at = COALESCE(booked_at, NOW()),
           notes = CASE
             WHEN $14::text IS NULL OR $14::text = '' THEN notes
             WHEN notes IS NULL OR notes = '' THEN $14
             WHEN POSITION($1 IN notes) > 0 THEN notes
             ELSE notes || E'\n' || $14
           END,
           raw_payload = CASE
             WHEN $15::jsonb IS NULL THEN raw_payload
             ELSE COALESCE(raw_payload, '{}'::jsonb) || $15::jsonb
           END
       WHERE id = $16
         AND COALESCE(business_context, $17) = $17`,
      [bookingId, clientName, phone, contactMeta.telegramId, instagram, source, sourceChannel, externalId,
       programId, booking?.date || null, safeChildrenCount, stage, status, notes, rawPayloadJson, leadId, context]
    );
  } else {
    const inserted = await client.query(
      `INSERT INTO leads
         (business_context, client_name, phone, telegram_id, instagram, source, source_channel,
          external_id, program_id, event_date, children_count, notes, raw_payload, lead_type, status,
          pipeline_stage, booking_id, booked_at)
       VALUES ($1,$2,$3,$4::bigint,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,'quality',$14,$15,$16,NOW())
       ON CONFLICT (business_context, source_channel, external_id)
         WHERE external_id IS NOT NULL DO UPDATE SET
           booking_id = COALESCE(leads.booking_id, EXCLUDED.booking_id),
           client_name = COALESCE(NULLIF(leads.client_name, ''), EXCLUDED.client_name),
           phone = COALESCE(NULLIF(leads.phone, ''), EXCLUDED.phone),
           telegram_id = COALESCE(leads.telegram_id, EXCLUDED.telegram_id),
           instagram = COALESCE(NULLIF(leads.instagram, ''), EXCLUDED.instagram),
           program_id = COALESCE(leads.program_id, EXCLUDED.program_id),
           event_date = COALESCE(leads.event_date, EXCLUDED.event_date),
           children_count = COALESCE(leads.children_count, EXCLUDED.children_count),
           lead_type = COALESCE(NULLIF(leads.lead_type, ''), EXCLUDED.lead_type),
           notes = CASE
             WHEN EXCLUDED.notes IS NULL OR EXCLUDED.notes = '' THEN leads.notes
             WHEN leads.notes IS NULL OR leads.notes = '' THEN EXCLUDED.notes
             WHEN POSITION(EXCLUDED.booking_id IN leads.notes) > 0 THEN leads.notes
             ELSE leads.notes || E'\n' || EXCLUDED.notes
           END,
           raw_payload = COALESCE(leads.raw_payload, '{}'::jsonb) || COALESCE(EXCLUDED.raw_payload, '{}'::jsonb)
       RETURNING id`,
      [context, clientName, phone, contactMeta.telegramId, instagram, source, sourceChannel, externalId,
       programId, booking?.date || null, safeChildrenCount, notes, rawPayloadJson, status, stage, bookingId]
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
  upsertLeadCustomerLink,
};
