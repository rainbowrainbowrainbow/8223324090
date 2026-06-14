'use strict';

const crypto = require('crypto');
const { pool, generateBookingNumber } = require('../db');
const {
  validateDate,
  validateTime,
  mapBookingRow,
  normalizeBookingStatus,
  lockBookingConflictResources,
  checkServerConflicts,
  checkServerDuplicate,
  checkRoomConflict
} = require('./booking');
const { insertHistory } = require('./historyLog');
const { ensureLeadForBooking } = require('./leadBookingLink');
const { broadcast } = require('./websocket');
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

function parsePositiveNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parsePositiveInteger(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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
  const telegram = parseJsonObject(
    body.telegram || payload.telegram || customer.telegram || booking.telegram
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
      phone: firstCleanMax(30, body.phone, payload.phone, customer.phone, customer.phone_number, customer.phoneNumber),
      instagram: firstCleanMax(100, body.instagram, payload.instagram, customer.instagram),
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

function bookingResponse(row, resource, { created = true, dryRun = false } = {}) {
  const mapped = row ? mapBookingRow(row) : null;
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
    bookingId: mapped?.id || row?.id || null,
    booking: mapped
  };
}

async function validateMaysternyaBookingAvailability(client, booking, resource) {
  const candidate = {
    businessContext: MAYSTERNYA_CONTEXT,
    date: booking.date,
    lineId: resource.resourceId,
    room: booking.room || resource.name,
    time: booking.time,
    duration: booking.duration
  };
  await lockBookingConflictResources(client, [candidate], MAYSTERNYA_CONTEXT);
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

async function createMaysternyaBotBooking(body = {}, options = {}) {
  const booking = normalizeMaysternyaBookingPayload(body);
  const validation = maysternyaBookingValidationError(booking);
  if (validation) return { error: validation };

  const existing = await findExistingMaysternyaBotBooking(pool, booking.externalId);
  if (existing) {
    return { response: bookingResponse(existing, null, { created: false, dryRun: false }) };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockMaysternyaExternalId(client, booking.externalId);
    const existingAfterLock = await findExistingMaysternyaBotBooking(client, booking.externalId);
    if (existingAfterLock) {
      await client.query('ROLLBACK');
      return { response: bookingResponse(existingAfterLock, null, { created: false, dryRun: false }) };
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

    const mappedForLead = {
      id,
      status: 'confirmed',
      date: booking.date,
      time: booking.time,
      programId,
      programName,
      kidsCount: booking.kidsCount,
      customer: booking.customer,
      phone: booking.customer.phone,
      instagram: booking.customer.instagram,
      notes: booking.notes
    };
    await runOptionalMaysternyaBookingStep(client, 'Maysternya booking lead handoff', async () => {
      await ensureLeadForBooking(client, {
        booking: mappedForLead,
        customerId,
        businessContext: MAYSTERNYA_CONTEXT
      });
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

    const response = bookingResponse(row, resource, { created: true, dryRun: false });
    broadcast('booking:created', response.booking, null, booking.date);
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
  isMaysternyaBookingDryRun,
  normalizeMaysternyaBookingPayload
};
