'use strict';

const crypto = require('crypto');
const { pool, generateBookingNumber } = require('../db');
const {
  validateDate,
  validateTime,
  timeToMinutes,
  minutesToTime,
  mapBookingRow,
  normalizeBookingStatus,
  lockBookingConflictResources,
  checkServerConflicts,
  checkServerDuplicate,
  checkRoomConflict
} = require('./booking');
const { insertHistory } = require('./historyLog');
const { ensureLeadForBooking } = require('./leadBookingLink');
const { broadcastBookingEvent } = require('./websocket');
const { publishInTransaction, publish } = require('./eventBus');
const {
  findTimelineResource,
  findTimelineResourceByName,
  getTimelineDisplaySettings,
  resourceTypeForDisplayMode
} = require('./timelineResources');
const { normalizeCustomerSource } = require('./customerSource');
const { createLogger } = require('../utils/logger');

const MAYSTERNYA_CONTEXT = 'maysternya_doli';
const MAYSTERNYA_BOT_SOURCE = 'maysternya_bot';
const MAYSTERNYA_DEFAULT_WORKDAY_START = '10:00';
const MAYSTERNYA_DEFAULT_WORKDAY_END = '20:00';
const MAYSTERNYA_DEFAULT_SLOT_STEP_MINUTES = 15;
const MAYSTERNYA_MAX_AVAILABILITY_DAYS = 45;
const log = createLogger('MaysternyaBookingWebhook');

function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function firstClean(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function firstCleanMax(maxLength, ...values) {
  for (const value of values) {
    const text = cleanText(value, maxLength);
    if (text) return text;
  }
  return null;
}

function cleanDateOnly(value) {
  const text = cleanText(value, 10);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanDateInput(...values) {
  for (const value of values) {
    const text = cleanDateOnly(value);
    if (text) return text;
  }
  return null;
}

function cleanPhoneLike(value, maxLength = 50) {
  const text = cleanText(value, maxLength);
  return text && /\d{5,}/.test(text.replace(/[^\d]/g, '')) ? text : null;
}

function cleanEmailLike(value, maxLength = 200) {
  const text = cleanText(value, maxLength);
  return text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
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
    return value.map(item => cleanText(item, 80)).filter(Boolean).slice(0, 12);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(item => cleanText(item, 80)).filter(Boolean).slice(0, 12);
    } catch {}
    return value.split(/[,;]+/).map(item => cleanText(item, 80)).filter(Boolean).slice(0, 12);
  }
  return [];
}

function uniqueTextList(values, limit = 12) {
  const seen = new Set();
  const items = [];
  for (const value of values.flatMap(parseTextList)) {
    const text = cleanText(value, 80);
    const key = text ? text.toLowerCase() : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(text);
    if (items.length >= limit) break;
  }
  return items;
}

function parsePositiveNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInteger(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseStrictPositiveInteger(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function truthyWebhookValue(value) {
  if (Array.isArray(value)) return value.some(item => truthyWebhookValue(item));
  const text = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on', 'dryrun', 'dry-run', 'test'].includes(text);
}

function isMaysternyaBookingDryRun(req) {
  return truthyWebhookValue(req?.query?.dryRun)
    || truthyWebhookValue(req?.query?.dry_run)
    || truthyWebhookValue(req?.query?.test)
    || truthyWebhookValue(req?.body?.dryRun)
    || truthyWebhookValue(req?.body?.dry_run)
    || truthyWebhookValue(req?.body?.testMode)
    || truthyWebhookValue(req?.body?.test)
    || truthyWebhookValue(req?.headers?.['x-crm-dry-run']);
}

function collectMissingFields(booking) {
  const missing = [];
  if (!booking.externalId) missing.push('external_id');
  if (!booking.date) missing.push('date');
  if (!booking.time) missing.push('time');
  if (!booking.duration) missing.push('duration');
  if (!booking.resourceId && !booking.resourceName) missing.push('resource_id');
  if (!booking.programId && !booking.programCode && !booking.programName) missing.push('program');
  if (!booking.customer.name && !booking.customer.phone && !booking.telegram.id && !booking.telegram.username) missing.push('customer');
  return missing;
}

function normalizeMaysternyaBookingPayload(body = {}) {
  const payload = parseJsonObject(body.payload || body.data || body.record);
  const booking = parseJsonObject(body.booking || payload.booking || payload.appointment || payload.session);
  const customer = parseJsonObject(
    body.customer || body.client || payload.customer || payload.client || booking.customer || booking.client
  );
  const contact = parseJsonObject(
    body.contact || payload.contact || customer.contact || booking.contact
  );
  const telegram = parseJsonObject(
    body.telegram || payload.telegram || customer.telegram || contact.telegram || booking.telegram
  );
  const program = parseJsonObject(
    body.program || body.service || payload.program || payload.service || booking.program || booking.service
  );

  const externalId = firstClean(
    body.external_id,
    body.externalId,
    payload.external_id,
    payload.externalId,
    booking.external_id,
    booking.externalId,
    booking.id
  );
  const date = firstClean(
    body.date,
    body.booking_date,
    body.bookingDate,
    payload.date,
    payload.booking_date,
    payload.bookingDate,
    booking.date,
    booking.booking_date,
    booking.bookingDate
  );
  const time = firstClean(
    body.time,
    body.booking_time,
    body.bookingTime,
    payload.time,
    payload.booking_time,
    payload.bookingTime,
    booking.time,
    booking.booking_time,
    booking.bookingTime
  );
  const resourceId = firstCleanMax(100,
    body.resource_id,
    body.resourceId,
    body.lineId,
    body.line_id,
    payload.resource_id,
    payload.resourceId,
    payload.lineId,
    payload.line_id,
    booking.resource_id,
    booking.resourceId,
    booking.lineId,
    booking.line_id
  );
  const resourceName = firstCleanMax(120,
    body.resource_name,
    body.resourceName,
    body.lineName,
    body.line_name,
    payload.resource_name,
    payload.resourceName,
    payload.lineName,
    payload.line_name,
    booking.resource_name,
    booking.resourceName,
    booking.lineName,
    booking.line_name
  );
  const programName = firstCleanMax(100,
    body.programName,
    body.program_name,
    body.service_name,
    body.service,
    payload.programName,
    payload.program_name,
    payload.service_name,
    payload.service,
    booking.programName,
    booking.program_name,
    booking.service_name,
    booking.service,
    program.name,
    program.title
  );
  const programCode = firstCleanMax(20,
    body.programCode,
    body.program_code,
    payload.programCode,
    payload.program_code,
    booking.programCode,
    booking.program_code,
    program.code
  );
  const programId = firstCleanMax(50,
    body.programId,
    body.program_id,
    payload.programId,
    payload.program_id,
    booking.programId,
    booking.program_id,
    program.id
  );
  const telegramId = firstClean(
    body.telegram_id,
    body.telegramId,
    payload.telegram_id,
    payload.telegramId,
    customer.telegram_id,
    customer.telegramId,
    telegram.id,
    telegram.user_id
  );
  const telegramUsername = firstClean(
    body.telegram_username,
    body.telegramUsername,
    payload.telegram_username,
    payload.telegramUsername,
    customer.telegram_username,
    customer.telegramUsername,
    telegram.username
  );
  const contactValue = firstClean(contact.value, contact.contact_value, contact.contactValue);
  const contactValuePhone = cleanPhoneLike(contactValue, 30);
  const contactValueEmail = cleanEmailLike(contactValue, 200);
  const customerPhone = firstCleanMax(30,
    body.phone,
    body.phone_number,
    body.phoneNumber,
    payload.phone,
    payload.phone_number,
    payload.phoneNumber,
    customer.phone,
    customer.phone_number,
    customer.phoneNumber,
    contact.phone,
    contact.phone_number,
    contact.phoneNumber,
    contactValuePhone
  );
  const customerEmail = firstCleanMax(200,
    body.email,
    body.contact_email,
    body.contactEmail,
    payload.email,
    payload.contact_email,
    payload.contactEmail,
    customer.email,
    customer.contact_email,
    customer.contactEmail,
    contact.email,
    contact.contact_email,
    contact.contactEmail,
    contactValueEmail
  );
  const customerWhatsapp = firstCleanMax(50,
    body.whatsapp,
    body.whatsapp_phone,
    body.whatsappPhone,
    payload.whatsapp,
    payload.whatsapp_phone,
    payload.whatsappPhone,
    customer.whatsapp,
    customer.whatsapp_phone,
    customer.whatsappPhone,
    contact.whatsapp,
    contact.whatsapp_phone,
    contact.whatsappPhone
  );
  const contactPreference = firstCleanMax(50,
    body.contact_preference,
    body.contactPreference,
    payload.contact_preference,
    payload.contactPreference,
    customer.contact_preference,
    customer.contactPreference,
    contact.preference,
    contact.channel,
    contact.type
  );
  const contactChannels = uniqueTextList([
    body.contact_channels,
    body.contactChannels,
    payload.contact_channels,
    payload.contactChannels,
    customer.contact_channels,
    customer.contactChannels,
    contact.channels,
    contact.channel ? [contact.channel] : [],
    telegramId || telegramUsername ? ['telegram'] : [],
    customerWhatsapp ? ['whatsapp'] : [],
    customerPhone ? ['phone'] : [],
    customerEmail ? ['email'] : [],
    body.instagram || payload.instagram || customer.instagram ? ['instagram'] : []
  ]);

  return {
    externalId,
    date,
    time,
    duration: parsePositiveInteger(
      firstClean(body.duration, payload.duration, booking.duration, program.duration),
      null
    ),
    resourceId,
    resourceName,
    programId,
    programCode,
    programName,
    requestTopic: firstCleanMax(200, body.request_topic, body.requestTopic, payload.request_topic, payload.requestTopic, booking.request_topic, booking.requestTopic, program.request_topic, program.requestTopic, programName),
    sessionType: firstCleanMax(120, body.session_type, body.sessionType, payload.session_type, payload.sessionType, booking.session_type, booking.sessionType, program.session_type, program.sessionType, program.category, programCode, programName),
    category: firstCleanMax(50, body.category, payload.category, booking.category, program.category) || 'maysternya',
    price: parsePositiveNumber(firstClean(body.price, body.amount, payload.price, payload.amount, booking.price, booking.amount, program.price), 0),
    room: firstCleanMax(100, body.room, payload.room, booking.room) || null,
    notes: firstClean(body.notes, body.message, body.comment, payload.notes, payload.message, payload.comment, booking.notes, booking.message),
    paymentMethod: firstCleanMax(30, body.payment_method, body.paymentMethod, payload.payment_method, payload.paymentMethod, booking.payment_method, booking.paymentMethod),
    kidsCount: parsePositiveInteger(firstClean(body.kidsCount, body.kids_count, payload.kidsCount, payload.kids_count, booking.kidsCount, booking.kids_count), null),
    groupName: firstCleanMax(100, body.groupName, body.group_name, payload.groupName, payload.group_name, booking.groupName, booking.group_name),
    status: normalizeBookingStatus(firstClean(body.status, payload.status, booking.status), 'confirmed') || 'confirmed',
    skipNotification: body.skipNotification ?? body.skip_notification ?? payload.skipNotification ?? payload.skip_notification ?? booking.skipNotification ?? booking.skip_notification ?? false,
    customer: {
      name: firstCleanMax(200, body.name, body.client_name, body.clientName, payload.name, payload.client_name, payload.clientName, customer.name, customer.full_name, customer.fullName),
      phone: customerPhone,
      instagram: firstCleanMax(100, body.instagram, payload.instagram, customer.instagram),
      email: customerEmail,
      whatsapp: customerWhatsapp,
      contactPreference,
      contactChannels,
      childName: firstCleanMax(200, body.childName, body.child_name, payload.childName, payload.child_name, customer.childName, customer.child_name),
      childBirthday: cleanDateOnly(firstClean(body.childBirthday, body.child_birthday, payload.childBirthday, payload.child_birthday, customer.childBirthday, customer.child_birthday)),
      source: MAYSTERNYA_BOT_SOURCE
    },
    telegram: {
      id: telegramId,
      username: telegramUsername ? String(telegramUsername).replace(/^@+/, '') : null
    },
    rawPayload: body
  };
}

function maysternyaBookingValidationError(booking) {
  const missingFields = collectMissingFields(booking);
  if (missingFields.length) {
    return { statusCode: 400, code: 'missing_fields', message: 'Missing required booking fields', missingFields };
  }
  if (!validateDate(booking.date)) {
    return { statusCode: 400, code: 'invalid_date', message: 'Invalid date', missingFields: ['date'] };
  }
  if (!validateTime(booking.time)) {
    return { statusCode: 400, code: 'invalid_time', message: 'Invalid time', missingFields: ['time'] };
  }
  if (!Number.isInteger(booking.duration) || booking.duration <= 0 || booking.duration > 1440) {
    return { statusCode: 400, code: 'invalid_duration', message: 'Invalid duration', missingFields: ['duration'] };
  }
  if (!booking.status || booking.status !== 'confirmed') {
    return { statusCode: 400, code: 'invalid_status', message: 'Maysternya bot bookings must be confirmed', missingFields: ['status'] };
  }
  return null;
}

function normalizeMaysternyaBusinessContext(value) {
  const context = cleanText(value, 64) || MAYSTERNYA_CONTEXT;
  return context === MAYSTERNYA_CONTEXT ? MAYSTERNYA_CONTEXT : null;
}

function normalizeMaysternyaAvailabilityPayload(body = {}) {
  const payload = parseJsonObject(body.payload || body.data || body.request);
  const resource = parseJsonObject(body.resource || payload.resource);
  const businessContext = normalizeMaysternyaBusinessContext(
    body.business_context
    || body.businessContext
    || payload.business_context
    || payload.businessContext
  );

  return {
    businessContext,
    dateFrom: cleanDateInput(
      body.date_from,
      body.dateFrom,
      payload.date_from,
      payload.dateFrom,
      body.date,
      payload.date
    ),
    dateTo: cleanDateInput(
      body.date_to,
      body.dateTo,
      payload.date_to,
      payload.dateTo,
      body.date,
      payload.date
    ),
    duration: parseStrictPositiveInteger(firstClean(body.duration, payload.duration), null),
    resourceId: firstCleanMax(100,
      body.resource_id,
      body.resourceId,
      body.lineId,
      body.line_id,
      payload.resource_id,
      payload.resourceId,
      payload.lineId,
      payload.line_id,
      resource.id,
      resource.resource_id,
      resource.resourceId
    ),
    resourceName: firstCleanMax(120,
      body.resource_name,
      body.resourceName,
      body.lineName,
      body.line_name,
      payload.resource_name,
      payload.resourceName,
      payload.lineName,
      payload.line_name,
      resource.name,
      resource.resource_name,
      resource.resourceName
    ),
    timezone: firstCleanMax(80, body.timezone, payload.timezone) || 'Europe/Kyiv',
    stepMinutes: parseStrictPositiveInteger(
      firstClean(body.step_minutes, body.stepMinutes, body.slot_step, body.slotStep, payload.step_minutes, payload.stepMinutes),
      MAYSTERNYA_DEFAULT_SLOT_STEP_MINUTES
    )
  };
}

function dateToUtcDay(value) {
  if (!validateDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function dateRangeInclusive(dateFrom, dateTo) {
  const start = dateToUtcDay(dateFrom);
  const end = dateToUtcDay(dateTo);
  if (!start || !end || start > end) return null;
  const dates = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(formatUtcDate(cursor));
    if (dates.length > MAYSTERNYA_MAX_AVAILABILITY_DAYS) return null;
  }
  return dates;
}

function maysternyaAvailabilityValidationError(payload) {
  const missingFields = [];
  if (!payload.businessContext) {
    return {
      statusCode: 400,
      code: 'unsupported_business_context',
      message: 'Maysternya availability supports only maysternya_doli business_context',
      missingFields: ['business_context']
    };
  }
  if (!payload.dateFrom) missingFields.push('date_from');
  if (!payload.dateTo) missingFields.push('date_to');
  if (!payload.duration) missingFields.push('duration');
  if (!payload.resourceId && !payload.resourceName) missingFields.push('resource_id');
  if (missingFields.length) {
    return { statusCode: 400, code: 'missing_fields', message: 'Missing required availability fields', missingFields };
  }
  if (!validateDate(payload.dateFrom)) {
    return { statusCode: 400, code: 'invalid_date_from', message: 'Invalid date_from', missingFields: ['date_from'] };
  }
  if (!validateDate(payload.dateTo)) {
    return { statusCode: 400, code: 'invalid_date_to', message: 'Invalid date_to', missingFields: ['date_to'] };
  }
  const dates = dateRangeInclusive(payload.dateFrom, payload.dateTo);
  if (!dates) {
    return {
      statusCode: 400,
      code: 'invalid_date_range',
      message: `date range must be ordered and no longer than ${MAYSTERNYA_MAX_AVAILABILITY_DAYS} days`,
      missingFields: ['date_from', 'date_to']
    };
  }
  if (!Number.isInteger(payload.duration) || payload.duration <= 0 || payload.duration > 1440) {
    return { statusCode: 400, code: 'invalid_duration', message: 'Invalid duration', missingFields: ['duration'] };
  }
  if (!Number.isInteger(payload.stepMinutes) || payload.stepMinutes <= 0 || payload.stepMinutes > 240) {
    return { statusCode: 400, code: 'invalid_step', message: 'Invalid slot step', missingFields: ['step_minutes'] };
  }
  return null;
}

async function resolveMaysternyaResource(client, booking) {
  const settings = await getTimelineDisplaySettings(client, MAYSTERNYA_CONTEXT);
  const resourceType = resourceTypeForDisplayMode(settings.mode, settings) || 'specialist';
  let resource = null;
  if (booking.resourceId) {
    resource = await findTimelineResource(client, MAYSTERNYA_CONTEXT, booking.resourceId, { type: resourceType });
  }
  if (!resource && booking.resourceName) {
    resource = await findTimelineResourceByName(client, MAYSTERNYA_CONTEXT, booking.resourceName, { type: resourceType });
  }
  return { resource, resourceType };
}

async function findExistingMaysternyaBotBooking(queryable, externalId) {
  const result = await queryable.query(
    `SELECT *
       FROM bookings
      WHERE COALESCE(business_context, 'event_genix') = $1
        AND COALESCE(extra_data->>'externalId', extra_data->'maysternyaBot'->>'externalId') = $2
        AND LOWER(COALESCE(NULLIF(BTRIM(status), ''), 'confirmed')) != 'cancelled'
      LIMIT 1`,
    [MAYSTERNYA_CONTEXT, externalId]
  );
  return result.rows[0] || null;
}

async function lockMaysternyaExternalId(client, externalId) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    ['maysternya_bot_booking', externalId]
  );
}

async function resolveOrCreateMaysternyaCustomer(client, booking) {
  const customer = booking.customer || {};
  if (!customer.name && !customer.phone && !booking.telegram.id && !booking.telegram.username) return null;
  if (customer.phone) {
    const existing = await client.query(
      "SELECT id FROM customers WHERE phone = $1 AND COALESCE(business_context, 'event_genix') = $2 LIMIT 1",
      [customer.phone, MAYSTERNYA_CONTEXT]
    );
    if (existing.rows[0]?.id) return existing.rows[0].id;
  }
  const name = customer.name || (booking.telegram.username ? `@${booking.telegram.username}` : null) || customer.phone || booking.externalId;
  const result = await client.query(
    `INSERT INTO customers (business_context, name, phone, instagram, child_name, child_birthday, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      MAYSTERNYA_CONTEXT,
      name,
      customer.phone || null,
      customer.instagram || (booking.telegram.username ? `@${booking.telegram.username}` : null),
      customer.childName || null,
      customer.childBirthday || null,
      normalizeCustomerSource(customer.source)
    ]
  );
  return result.rows[0]?.id || null;
}

function buildBookingExtraData(booking, resource) {
  return {
    source: MAYSTERNYA_BOT_SOURCE,
    externalId: booking.externalId,
    telegram: booking.telegram,
    rawPayload: booking.rawPayload,
    timelineIdentity: {
      businessContext: MAYSTERNYA_CONTEXT,
      resourceId: resource.resourceId,
      lineId: resource.resourceId,
      resourceType: resource.type,
      resourceName: resource.name,
      lineName: resource.name,
      source: 'maysternya_bot'
    },
    maysternyaBot: {
      externalId: booking.externalId,
      receivedAt: new Date().toISOString()
    }
  };
}

function bookingResponse(row, resource, { created = true, dryRun = false, leadLink = null } = {}) {
  const normalizedRow = normalizeBookingRow(row);
  const mapped = normalizedRow ? mapBookingRow(normalizedRow) : null;
  if (mapped && resource) {
    mapped.lineName = resource.name;
    mapped.resourceId = resource.resourceId;
    mapped.resourceType = resource.type;
  }
  return {
    success: true,
    ok: true,
    businessContext: MAYSTERNYA_CONTEXT,
    created,
    dryRun,
    resourceId: resource?.resourceId || mapped?.resourceId || mapped?.lineId || null,
    resourceName: resource?.name || mapped?.lineName || mapped?.room || null,
    bookingId: mapped?.id || row?.id || null,
    leadId: leadLink?.leadId || null,
    leadCreated: leadLink ? Boolean(leadLink.created) : false,
    customerLinked: leadLink ? Boolean(leadLink.customerLinked) : false,
    lead: leadLink ? {
      id: leadLink.leadId || null,
      created: Boolean(leadLink.created),
      attached: Boolean(leadLink.attached),
      customerId: leadLink.customerId || null,
      customerLinked: Boolean(leadLink.customerLinked)
    } : null,
    booking: mapped
  };
}

function normalizeBookingRow(row) {
  if (!row || typeof row !== 'object') return row || null;
  if (typeof row.extra_data !== 'string') return row;
  try {
    return { ...row, extra_data: JSON.parse(row.extra_data) };
  } catch {
    return { ...row, extra_data: null };
  }
}

async function validateMaysternyaBookingAvailability(client, booking, resource, options = {}) {
  const candidate = {
    businessContext: MAYSTERNYA_CONTEXT,
    date: booking.date,
    lineId: resource.resourceId,
    room: booking.room || resource.name,
    time: booking.time,
    duration: booking.duration
  };
  if (options.lock !== false) {
    await lockBookingConflictResources(client, [candidate], MAYSTERNYA_CONTEXT);
  }
  const lineConflict = await checkServerConflicts(
    client,
    candidate.date,
    candidate.lineId,
    candidate.time,
    candidate.duration,
    null,
    MAYSTERNYA_CONTEXT
  );
  if (lineConflict.overlap) {
    return {
      statusCode: 409,
      code: 'booking_time_conflict',
      message: `Time is already booked: ${lineConflict.conflictWith?.label || lineConflict.conflictWith?.program_code || lineConflict.conflictWith?.id}`,
      conflictBookingId: lineConflict.conflictWith?.id || null
    };
  }
  const duplicate = await checkServerDuplicate(
    client,
    candidate.date,
    booking.programId || booking.programCode || booking.programName,
    candidate.time,
    candidate.duration,
    null,
    MAYSTERNYA_CONTEXT
  );
  if (duplicate) {
    return {
      statusCode: 409,
      code: 'booking_duplicate',
      message: 'This program is already booked in this time window',
      conflictBookingId: duplicate.id || null
    };
  }
  const roomConflict = await checkRoomConflict(
    client,
    candidate.date,
    candidate.room,
    candidate.time,
    candidate.duration,
    null,
    MAYSTERNYA_CONTEXT
  );
  if (roomConflict) {
    return {
      statusCode: 409,
      code: 'booking_room_conflict',
      message: `Room is already booked: ${roomConflict.label || roomConflict.program_code || roomConflict.id}`,
      conflictBookingId: roomConflict.id || null
    };
  }
  return null;
}

function availabilitySlotFromError({ date, time, resource }, error) {
  return {
    date,
    time,
    available: false,
    resourceId: resource.resourceId,
    resourceName: resource.name,
    reason: error?.code || 'unavailable',
    conflictBookingId: error?.conflictBookingId || null
  };
}

async function createMaysternyaAvailabilityResponse(body = {}) {
  const payload = normalizeMaysternyaAvailabilityPayload(body);
  const validation = maysternyaAvailabilityValidationError(payload);
  if (validation) return { error: validation };

  const dates = dateRangeInclusive(payload.dateFrom, payload.dateTo);
  const client = await pool.connect();
  try {
    const { resource } = await resolveMaysternyaResource(client, {
      resourceId: payload.resourceId,
      resourceName: payload.resourceName
    });
    if (!resource) {
      return {
        error: {
          statusCode: 400,
          code: 'booking_line_not_visible',
          message: 'Timeline resource is not visible for Maysternya Doli'
        }
      };
    }

    const workdayStart = timeToMinutes(MAYSTERNYA_DEFAULT_WORKDAY_START);
    const workdayEnd = timeToMinutes(MAYSTERNYA_DEFAULT_WORKDAY_END);
    const latestStart = workdayEnd - payload.duration;
    const slots = [];
    const days = [];

    for (const date of dates) {
      const daySlots = [];
      for (let minutes = workdayStart; minutes <= latestStart; minutes += payload.stepMinutes) {
        const time = minutesToTime(minutes);
        const booking = {
          date,
          time,
          duration: payload.duration,
          resourceId: resource.resourceId,
          resourceName: resource.name,
          room: resource.name
        };
        const availabilityError = await validateMaysternyaBookingAvailability(client, booking, resource, { lock: false });
        const slot = availabilityError
          ? availabilitySlotFromError({ date, time, resource }, availabilityError)
          : {
              date,
              time,
              available: true,
              resourceId: resource.resourceId,
              resourceName: resource.name,
              reason: null,
              conflictBookingId: null
            };
        slots.push(slot);
        daySlots.push(slot);
      }
      days.push({ date, slots: daySlots });
    }

    return {
      response: {
        success: true,
        ok: true,
        businessContext: MAYSTERNYA_CONTEXT,
        dateFrom: payload.dateFrom,
        dateTo: payload.dateTo,
        duration: payload.duration,
        timezone: payload.timezone,
        stepMinutes: payload.stepMinutes,
        resourceId: resource.resourceId,
        resourceName: resource.name,
        slots,
        days
      }
    };
  } finally {
    client.release();
  }
}

async function publishBookingCreatedInTransaction(client, payload, idempotencyKey) {
  if (typeof publishInTransaction === 'function') {
    await publishInTransaction(client, 'booking.created', payload, 'booking', payload.booking_id, idempotencyKey);
    return;
  }
  publish('booking.created', payload, idempotencyKey);
}

function maysternyaBookingEventKey(externalId) {
  const raw = `maysternya_bot_booking_${String(externalId || '').trim()}`;
  if (raw.length <= 200) return raw;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
  return `${raw.slice(0, 160)}_${hash}`.slice(0, 200);
}

async function runOptionalMaysternyaBookingStep(client, label, step) {
  await client.query('SAVEPOINT maysternya_booking_optional_step');
  try {
    const result = await step();
    await client.query('RELEASE SAVEPOINT maysternya_booking_optional_step');
    return result;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT maysternya_booking_optional_step')
      .catch(rbErr => log.error(`Rollback to optional Maysternya booking savepoint failed (${label})`, rbErr));
    await client.query('RELEASE SAVEPOINT maysternya_booking_optional_step')
      .catch(relErr => log.error(`Release optional Maysternya booking savepoint failed (${label})`, relErr));
    log.warn(`${label} failed (non-critical): ${err.message}`);
    return null;
  }
}

function mapMaysternyaBookingForLead(booking, bookingId, { programId, programName } = {}) {
  return {
    id: bookingId,
    externalId: booking.externalId,
    status: 'confirmed',
    date: booking.date,
    time: booking.time,
    programId: programId || booking.programId || booking.programCode || null,
    programName: programName || booking.programName || booking.programCode || booking.programId || null,
    leadSource: MAYSTERNYA_BOT_SOURCE,
    sourceChannel: MAYSTERNYA_BOT_SOURCE,
    requestTopic: booking.requestTopic,
    sessionType: booking.sessionType,
    kidsCount: booking.kidsCount,
    customer: booking.customer,
    phone: booking.customer.phone,
    instagram: booking.customer.instagram,
    telegramId: booking.telegram.id,
    telegramUsername: booking.telegram.username,
    whatsapp: booking.customer.whatsapp,
    email: booking.customer.email,
    contactChannels: booking.customer.contactChannels,
    rawPayload: booking.rawPayload,
    notes: booking.notes
  };
}

async function ensureMaysternyaBookingLead(client, { booking, row, customerId, programId = null, programName = null }) {
  const bookingId = row?.id ? String(row.id) : '';
  if (!bookingId) {
    const err = new Error('Maysternya booking lead handoff missing booking id');
    err.statusCode = 500;
    err.code = 'booking_lead_missing_booking_id';
    throw err;
  }

  let resolvedCustomerId = customerId || row?.customer_id || null;
  if (!resolvedCustomerId) {
    resolvedCustomerId = await resolveOrCreateMaysternyaCustomer(client, booking);
    if (resolvedCustomerId) {
      await client.query(
        `UPDATE bookings
            SET customer_id = COALESCE(customer_id, $1),
                updated_at = NOW()
          WHERE id = $2
            AND COALESCE(business_context, 'event_genix') = $3`,
        [resolvedCustomerId, bookingId, MAYSTERNYA_CONTEXT]
      );
    }
  }

  let leadLink;
  try {
    leadLink = await ensureLeadForBooking(client, {
      booking: mapMaysternyaBookingForLead(booking, bookingId, { programId, programName }),
      customerId: resolvedCustomerId,
      businessContext: MAYSTERNYA_CONTEXT
    });
  } catch (err) {
    err.statusCode = err.statusCode || 500;
    err.code = err.code || 'booking_lead_handoff_failed';
    err.publicMessage = 'Maysternya booking lead handoff failed';
    throw err;
  }

  if (!leadLink?.attached || !leadLink?.leadId) {
    const err = new Error(`Maysternya booking lead was not created or attached (${leadLink?.reason || 'unknown'})`);
    err.statusCode = 500;
    err.code = 'booking_lead_handoff_failed';
    throw err;
  }

  return leadLink;
}

async function createMaysternyaBotBooking(body = {}, options = {}) {
  const booking = normalizeMaysternyaBookingPayload(body);
  const validation = maysternyaBookingValidationError(booking);
  if (validation) return { error: validation };

  const existing = await findExistingMaysternyaBotBooking(pool, booking.externalId);
  if (existing) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const leadLink = await ensureMaysternyaBookingLead(client, {
        booking,
        row: existing,
        customerId: existing.customer_id || null,
        programId: existing.program_id || booking.programId || booking.programCode || null,
        programName: existing.program_name || booking.programName || null
      });
      await client.query('COMMIT');
      return { response: bookingResponse(existing, null, { created: false, dryRun: false, leadLink }) };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockMaysternyaExternalId(client, booking.externalId);
    const existingAfterLock = await findExistingMaysternyaBotBooking(client, booking.externalId);
    if (existingAfterLock) {
      const leadLink = await ensureMaysternyaBookingLead(client, {
        booking,
        row: existingAfterLock,
        customerId: existingAfterLock.customer_id || null,
        programId: existingAfterLock.program_id || booking.programId || booking.programCode || null,
        programName: existingAfterLock.program_name || booking.programName || null
      });
      await client.query('COMMIT');
      return { response: bookingResponse(existingAfterLock, null, { created: false, dryRun: false, leadLink }) };
    }
    const { resource } = await resolveMaysternyaResource(client, booking);
    if (!resource) {
      await client.query('ROLLBACK');
      return {
        error: {
          statusCode: 400,
          code: 'booking_line_not_visible',
          message: 'Timeline resource is not visible for Maysternya Doli'
        }
      };
    }

    const availabilityError = await validateMaysternyaBookingAvailability(client, booking, resource);
    if (availabilityError) {
      await client.query('ROLLBACK');
      return { error: availabilityError };
    }

    if (options.dryRun) {
      await client.query('ROLLBACK');
      return {
        response: {
          success: true,
          ok: true,
          businessContext: MAYSTERNYA_CONTEXT,
          dryRun: true,
          created: false,
          resourceId: resource.resourceId,
          resourceName: resource.name,
          booking: null,
          preview: {
            externalId: booking.externalId,
            date: booking.date,
            time: booking.time,
            duration: booking.duration,
            resourceId: resource.resourceId,
            resourceName: resource.name,
            programId: booking.programId || null,
            programCode: booking.programCode || null,
            programName: booking.programName || null,
            customer: booking.customer,
            telegram: booking.telegram
          }
        }
      };
    }

    const customerId = await resolveOrCreateMaysternyaCustomer(client, booking);
    const id = await generateBookingNumber(client);
    const lineId = resource.resourceId;
    const room = booking.room || resource.name;
    const extraData = buildBookingExtraData(booking, resource);
    const programName = booking.programName || booking.programCode || booking.programId || 'Майстерня долі';
    const programCode = booking.programCode || booking.programId || 'MD';
    const programId = booking.programId || programCode;
    const label = cleanText(`${programName}${booking.duration ? ` (${booking.duration})` : ''}`, 100);
    const groupName = cleanText(booking.groupName || booking.customer.name || booking.externalId, 100);

    const insert = await client.query(
      `INSERT INTO bookings
         (id, business_context, date, time, line_id, program_id, program_code, label,
          program_name, category, duration, price, hosts, second_animator, pinata_filler,
          pinata_mode, pinata_number, pinata_filler_number, client_pinata_service_price,
          client_pinata_service_note, costume, room, notes, created_by, linked_to, status,
          kids_count, group_name, extra_data, skip_notification, customer_id, payment_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)
       RETURNING *`,
      [
        id,
        MAYSTERNYA_CONTEXT,
        booking.date,
        booking.time,
        lineId,
        programId,
        programCode,
        label,
        programName,
        booking.category,
        booking.duration,
        booking.price,
        1,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        room,
        booking.notes,
        MAYSTERNYA_BOT_SOURCE,
        null,
        'confirmed',
        booking.kidsCount,
        groupName,
        JSON.stringify(extraData),
        Boolean(booking.skipNotification),
        customerId,
        booking.paymentMethod || null
      ]
    );
    const row = insert.rows[0];

    if (customerId) {
      await client.query(
        `UPDATE customers SET
            first_visit = LEAST(COALESCE(first_visit, $1::date), $1::date),
            updated_at = NOW()
         WHERE id = $2 AND COALESCE(business_context, 'event_genix') = $3`,
        [booking.date, customerId, MAYSTERNYA_CONTEXT]
      );
    }

    const leadLink = await ensureMaysternyaBookingLead(client, {
      booking,
      row,
      customerId,
      programId,
      programName
    });

    await runOptionalMaysternyaBookingStep(client, 'Maysternya booking history', async () => {
      await insertHistory(client, {
        businessContext: MAYSTERNYA_CONTEXT,
        action: 'create',
        username: MAYSTERNYA_BOT_SOURCE,
        data: {
          ...mapBookingRow(row),
          source: MAYSTERNYA_BOT_SOURCE,
          externalId: booking.externalId
        }
      });
    });

    await runOptionalMaysternyaBookingStep(client, 'Maysternya booking event outbox', async () => {
      await publishBookingCreatedInTransaction(
        client,
        {
          booking_id: id,
          business_context: MAYSTERNYA_CONTEXT,
          date: booking.date,
          time: booking.time,
          room,
          program_code: programCode,
          program_name: programName,
          status: 'confirmed',
          price: booking.price || 0,
          kids_count: booking.kidsCount,
          created_by: MAYSTERNYA_BOT_SOURCE,
          source: MAYSTERNYA_BOT_SOURCE,
          external_id: booking.externalId
        },
        maysternyaBookingEventKey(booking.externalId)
      );
    });

    const commit = await client.query('COMMIT');
    if (String(commit?.command || 'COMMIT').toUpperCase() !== 'COMMIT') {
      const err = new Error('Maysternya bot booking transaction was not committed');
      err.statusCode = 500;
      err.code = 'booking_commit_not_verified';
      throw err;
    }

    const response = bookingResponse(row, resource, { created: true, dryRun: false, leadLink });
    try {
      broadcastBookingEvent('booking:created', response.booking, null, { businessContext: MAYSTERNYA_CONTEXT });
    } catch (err) {
      log.warn(`Maysternya booking broadcast failed (non-critical): ${err.message}`);
    }
    return { response };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  MAYSTERNYA_BOT_SOURCE,
  MAYSTERNYA_CONTEXT,
  createMaysternyaBotBooking,
  createMaysternyaAvailabilityResponse,
  isMaysternyaBookingDryRun,
  normalizeMaysternyaBookingPayload,
  normalizeMaysternyaAvailabilityPayload
};
