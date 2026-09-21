'use strict';

const { BinotelCallMappingError } = require('./binotel-call-mapper');

const ACTIVE_STATUS = new Set(['unknown', 'ringing', 'answered']);
const FINAL_STATUS = new Set(['missed', 'completed']);

function lifecycleTime(call) {
  for (const value of [call.endedAt, call.answeredAt, call.startedAt]) {
    if (value) return new Date(value).getTime();
  }
  return null;
}

function sameIdentity(left, right) {
  return left && right
    && left.provider === 'binotel'
    && right.provider === 'binotel'
    && left.businessContext === right.businessContext
    && typeof left.accountId === 'string' && left.accountId.trim().length > 0
    && typeof right.accountId === 'string' && right.accountId.trim().length > 0
    && left.accountId === right.accountId
    && left.callId === right.callId;
}

function assertSameIdentity(current, incoming) {
  if (!sameIdentity(current, incoming)) {
    throw new BinotelCallMappingError(
      'BINOTEL_CALL_IDENTITY_MISMATCH',
      'Binotel lifecycle events may only merge within one provider, business, account and call identity'
    );
  }
}

function isOlderActiveEvent(current, incoming) {
  if (!FINAL_STATUS.has(current.status) || !ACTIVE_STATUS.has(incoming.status)) return false;
  const currentTime = lifecycleTime(current);
  const incomingTime = lifecycleTime(incoming);
  return incomingTime === null || currentTime === null || incomingTime <= currentTime;
}

function chooseStatus(current, incoming) {
  if (isOlderActiveEvent(current, incoming)) return current.status;
  return incoming.status;
}

function laterKnownValue(currentValue, incomingValue) {
  return incomingValue === null || incomingValue === undefined ? currentValue : incomingValue;
}

function earliestKnownTime(currentValue, incomingValue) {
  if (!currentValue) return incomingValue || null;
  if (!incomingValue) return currentValue;
  return new Date(incomingValue).getTime() < new Date(currentValue).getTime() ? incomingValue : currentValue;
}

function latestKnownTime(currentValue, incomingValue) {
  if (!currentValue) return incomingValue || null;
  if (!incomingValue) return currentValue;
  return new Date(incomingValue).getTime() > new Date(currentValue).getTime() ? incomingValue : currentValue;
}

function maximumKnownNumber(currentValue, incomingValue) {
  if (incomingValue === null || incomingValue === undefined) return currentValue;
  if (currentValue === null || currentValue === undefined) return incomingValue;
  return Math.max(currentValue, incomingValue);
}

function mergeRecording(current, incoming) {
  const currentRecord = current.recording || {};
  const incomingRecord = incoming.recording || {};
  return {
    available: currentRecord.available === true || incomingRecord.available === true,
    callRecordId: laterKnownValue(currentRecord.callRecordId || null, incomingRecord.callRecordId || null),
  };
}

function mergeBinotelCallLifecycle(current, incoming) {
  if (!current) return incoming;
  assertSameIdentity(current, incoming);

  return {
    ...current,
    status: chooseStatus(current, incoming),
    direction: incoming.direction === 'unknown' ? current.direction : incoming.direction,
    customerPhone: laterKnownValue(current.customerPhone, incoming.customerPhone),
    companyPhone: laterKnownValue(current.companyPhone, incoming.companyPhone),
    agent: {
      internalNumber: laterKnownValue(current.agent?.internalNumber, incoming.agent?.internalNumber),
      name: laterKnownValue(current.agent?.name, incoming.agent?.name),
      group: laterKnownValue(current.agent?.group, incoming.agent?.group),
    },
    startedAt: earliestKnownTime(current.startedAt, incoming.startedAt),
    answeredAt: earliestKnownTime(current.answeredAt, incoming.answeredAt),
    endedAt: latestKnownTime(current.endedAt, incoming.endedAt),
    waitingSeconds: maximumKnownNumber(current.waitingSeconds, incoming.waitingSeconds),
    talkSeconds: maximumKnownNumber(current.talkSeconds, incoming.talkSeconds),
    recording: mergeRecording(current, incoming),
    customer: {
      id: laterKnownValue(current.customer?.id, incoming.customer?.id),
      name: laterKnownValue(current.customer?.name, incoming.customer?.name),
    },
    source: incoming.source,
    capability: incoming.capability,
  };
}

module.exports = { mergeBinotelCallLifecycle, sameIdentity };
