'use strict';

const DIRECTION_VALUES = new Set(['incoming', 'outgoing', 'unknown']);
const STATUS_VALUES = new Set(['ringing', 'answered', 'missed', 'completed', 'unknown']);
const SOURCE_VALUES = new Set(['provider_history', 'webhook']);

class BinotelCallMappingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BinotelCallMappingError';
    this.code = code;
  }
}

function nullableText(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object') throw new BinotelCallMappingError('BINOTEL_CALL_MALFORMED', 'Binotel call text field must be scalar');
  return String(value);
}

function nullableSeconds(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new BinotelCallMappingError('BINOTEL_CALL_MALFORMED', `Binotel ${field} must be a non-negative number or null`);
  }
  return value;
}

function nullableIsoDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BinotelCallMappingError('BINOTEL_CALL_MALFORMED', `Binotel ${field} must be a valid date or null`);
  }
  return parsed.toISOString();
}

function callId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw new BinotelCallMappingError(
    'BINOTEL_CALL_ID_INVALID',
    'Binotel callId must be a non-empty string or a safe integer; unsafe numeric IDs must arrive as strings'
  );
}

function enumValue(value, allowed) {
  const normalized = String(value || 'unknown').toLowerCase();
  return allowed.has(normalized) ? normalized : 'unknown';
}

function mapCanonicalBinotelCall(input, scope = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BinotelCallMappingError('BINOTEL_CALL_MALFORMED', 'Binotel call must be an object');
  }
  const businessContext = nullableText(scope.businessContext);
  if (!businessContext) {
    throw new BinotelCallMappingError('BINOTEL_BUSINESS_CONTEXT_REQUIRED', 'Binotel call mapping requires an explicit business context');
  }
  const source = enumValue(scope.source || input.source || 'provider_history', SOURCE_VALUES);
  const record = input.recording && typeof input.recording === 'object' ? input.recording : {};
  const agent = input.agent && typeof input.agent === 'object' ? input.agent : {};
  const customer = input.customer && typeof input.customer === 'object' ? input.customer : {};

  return {
    provider: 'binotel',
    businessContext,
    accountId: nullableText(scope.accountId),
    callId: callId(input.callId),
    direction: enumValue(input.direction, DIRECTION_VALUES),
    status: enumValue(input.status, STATUS_VALUES),
    customerPhone: nullableText(input.customerPhone),
    companyPhone: nullableText(input.companyPhone),
    agent: {
      internalNumber: nullableText(agent.internalNumber),
      name: nullableText(agent.name),
      group: nullableText(agent.group),
    },
    startedAt: nullableIsoDate(input.startedAt, 'startedAt'),
    answeredAt: nullableIsoDate(input.answeredAt, 'answeredAt'),
    endedAt: nullableIsoDate(input.endedAt, 'endedAt'),
    waitingSeconds: nullableSeconds(input.waitingSeconds, 'waitingSeconds'),
    talkSeconds: nullableSeconds(input.talkSeconds, 'talkSeconds'),
    recording: {
      available: record.available === true,
      callRecordId: nullableText(record.callRecordId),
    },
    customer: {
      id: nullableText(customer.id),
      name: nullableText(customer.name),
    },
    source,
    capability: enumValue(input.capability || 'unverified', new Set(['confirmed', 'unverified', 'unsupported'])),
  };
}

module.exports = {
  BinotelCallMappingError,
  mapCanonicalBinotelCall,
};
