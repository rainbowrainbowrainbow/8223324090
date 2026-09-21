'use strict';

const { BinotelCapabilityError, createBinotelClient } = require('./binotel-client');

const VIEWS = new Set(['all', 'incoming', 'outgoing', 'missed', 'agent', 'number']);
const STATUSES = new Set(['ringing', 'answered', 'missed', 'completed', 'unknown']);
const KYIV_TIME_ZONE = 'Europe/Kyiv';
const MAX_RANGE_DAYS = 31;
const MAX_LIMIT = 100;

class BinotelJournalValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BinotelJournalValidationError';
    this.code = 'BINOTEL_JOURNAL_QUERY_INVALID';
    this.statusCode = 400;
  }
}

function dateParts(value, name) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new BinotelJournalValidationError(`${name} must be an ISO calendar date`);
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new BinotelJournalValidationError(`${name} is not a valid calendar date`);
  }
  return { year, month, day };
}

function kyivOffsetMilliseconds(instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: KYIV_TIME_ZONE,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(instant));
  const offset = parts.find(part => part.type === 'timeZoneName')?.value || '';
  const match = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) throw new BinotelJournalValidationError('Europe/Kyiv offset is unavailable');
  const sign = match[1] === '+' ? 1 : -1;
  return sign * ((Number(match[2]) * 60 + Number(match[3])) * 60 * 1000);
}

function kyivMidnightUtc(parts) {
  const localUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  let instant = localUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = localUtc - kyivOffsetMilliseconds(instant);
    if (next === instant) return new Date(next).toISOString();
    instant = next;
  }
  return new Date(instant).toISOString();
}

function nextCalendarDay(parts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function optionalFilter(value, name, maxLength = 80) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!text || text.length > maxLength) throw new BinotelJournalValidationError(`${name} is invalid`);
  return text;
}

function normalizeJournalQuery(query = {}) {
  const view = String(query.view || 'all').trim().toLowerCase();
  if (!VIEWS.has(view)) throw new BinotelJournalValidationError('view is invalid');
  const from = dateParts(query.startDate, 'startDate');
  const to = dateParts(query.endDate, 'endDate');
  const startAt = kyivMidnightUtc(from);
  const endAt = kyivMidnightUtc(nextCalendarDay(to));
  if (new Date(endAt) <= new Date(startAt)) throw new BinotelJournalValidationError('endDate must not precede startDate');
  if ((new Date(endAt) - new Date(startAt)) / 86_400_000 > MAX_RANGE_DAYS + 1) {
    throw new BinotelJournalValidationError(`date range may not exceed ${MAX_RANGE_DAYS} local days`);
  }
  const rawLimit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIMIT) {
    throw new BinotelJournalValidationError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  const status = optionalFilter(query.status, 'status', 32);
  if (status && !STATUSES.has(status)) throw new BinotelJournalValidationError('status is invalid');
  return Object.freeze({
    view,
    startDate: String(query.startDate),
    endDate: String(query.endDate),
    startAt,
    endAt,
    agent: optionalFilter(query.agent, 'agent'),
    companyNumber: optionalFilter(query.companyNumber, 'companyNumber'),
    customerNumber: optionalFilter(query.customerNumber, 'customerNumber'),
    status,
    cursor: optionalFilter(query.cursor, 'cursor', 256),
    limit: rawLimit,
  });
}

function assertJournalResult(result) {
  if (!result || !Array.isArray(result.calls) || typeof result.complete !== 'boolean') {
    const error = new Error('Binotel provider response is malformed');
    error.code = 'BINOTEL_PROVIDER_RESPONSE_MALFORMED';
    error.statusCode = 502;
    throw error;
  }
  return result;
}

function summarize(calls) {
  const knownWaiting = calls.filter(call => Number.isFinite(call.waitingSeconds));
  const knownTalk = calls.filter(call => Number.isFinite(call.talkSeconds));
  return {
    total: calls.length,
    incoming: calls.filter(call => call.direction === 'incoming').length,
    outgoing: calls.filter(call => call.direction === 'outgoing').length,
    missed: calls.filter(call => call.status === 'missed').length,
    averageWaitingSeconds: knownWaiting.length ? knownWaiting.reduce((sum, call) => sum + call.waitingSeconds, 0) / knownWaiting.length : null,
    averageTalkSeconds: knownTalk.length ? knownTalk.reduce((sum, call) => sum + call.talkSeconds, 0) / knownTalk.length : null,
  };
}

function createBinotelJournal(options = {}) {
  const clientFactory = options.clientFactory || (() => createBinotelClient());

  async function calls(scope, rawQuery) {
    const businessContext = String(scope?.businessContext || '').trim();
    if (!businessContext) throw new BinotelCapabilityError('BINOTEL_BUSINESS_CONTEXT_REQUIRED', 'Binotel journal requires an explicit business context');
    const query = normalizeJournalQuery(rawQuery);
    const client = clientFactory();
    let result;
    if (query.view === 'missed') result = await client.listLostCalls({ businessContext, query });
    else if (query.view === 'agent' && query.agent) result = await client.listCallsByAgent({ businessContext, query });
    else if (query.view === 'number' && (query.companyNumber || query.customerNumber)) result = await client.listCallsByNumber({ businessContext, query });
    else result = await client.listCalls({ businessContext, query });
    const normalized = assertJournalResult(result);
    return {
      businessContext,
      data: normalized.calls,
      page: { cursor: normalized.cursor || null, limit: query.limit, complete: normalized.complete },
      freshness: normalized.freshness || 'provider',
      capabilities: normalized.capabilities || { historical: 'confirmed' },
      query,
    };
  }

  async function summary(scope, rawQuery) {
    const result = await calls(scope, { ...rawQuery, limit: MAX_LIMIT, cursor: null });
    return {
      businessContext: result.businessContext,
      data: result.page.complete ? summarize(result.data) : null,
      completeness: result.page.complete ? 'complete' : 'partial',
      capabilities: result.capabilities,
      query: result.query,
    };
  }

  async function live(scope) {
    const businessContext = String(scope?.businessContext || '').trim();
    if (!businessContext) throw new BinotelCapabilityError('BINOTEL_BUSINESS_CONTEXT_REQUIRED', 'Binotel journal requires an explicit business context');
    const result = assertJournalResult(await clientFactory().listLiveCalls({ businessContext }));
    return { businessContext, data: result.calls, freshness: result.freshness || 'provider', capabilities: result.capabilities || { live: 'confirmed' } };
  }

  async function queues(scope) {
    const businessContext = String(scope?.businessContext || '').trim();
    if (!businessContext) throw new BinotelCapabilityError('BINOTEL_BUSINESS_CONTEXT_REQUIRED', 'Binotel journal requires an explicit business context');
    throw new BinotelCapabilityError(
      'BINOTEL_QUEUE_CAPABILITY_UNAVAILABLE',
      'Binotel queue monitoring is unavailable until an account-specific provider contract is confirmed',
      { businessContext, capability: 'unsupported_capability' }
    );
  }

  return Object.freeze({ calls, summary, live, queues });
}

module.exports = { BinotelJournalValidationError, createBinotelJournal, normalizeJournalQuery, summarize };
