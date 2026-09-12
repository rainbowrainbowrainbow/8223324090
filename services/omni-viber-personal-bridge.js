'use strict';

const crypto = require('crypto');
const { pool } = require('../db');
const { normalizeBusinessContext } = require('./businessContext');
const { createLogger } = require('../utils/logger');

const log = createLogger('OmniViberPersonalBridge');
const PROTOCOL_VERSION = '1.0';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REF_RE = /^(?:hmac:)?[0-9a-f]{64}$/;
const TERMINAL_COMMAND_STATES = new Set(['submitted_unconfirmed', 'unknown', 'rejected']);
const LEASE_SECONDS = 45;

class BridgeError extends Error {
  constructor(code, statusCode = 400) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function payloadHash(value) {
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

function uuid(value, code) {
  const normalized = String(value || '').toLowerCase();
  if (!UUID_RE.test(normalized)) throw new BridgeError(code);
  return normalized;
}

function positiveInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) throw new BridgeError(code);
  return value;
}

function positiveBigIntString(value, code) {
  const text = String(value || '');
  if (!/^[1-9]\d{0,18}$/.test(text) || BigInt(text) > 9223372036854775807n) throw new BridgeError(code);
  return text;
}

function bridgeScope(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new BridgeError('PAYLOAD_INVALID');
  if (payload.protocol_version !== PROTOCOL_VERSION) throw new BridgeError('PROTOCOL_VERSION_UNSUPPORTED', 409);
  const businessContext = normalizeBusinessContext(payload.business_context);
  if (businessContext !== payload.business_context) throw new BridgeError('BUSINESS_CONTEXT_INVALID');
  return {
    businessContext,
    bridgeId: uuid(payload.bridge_id, 'BRIDGE_ID_INVALID'),
    accountId: uuid(payload.account_id, 'ACCOUNT_ID_INVALID'),
    accountEpoch: positiveInteger(payload.account_epoch, 'ACCOUNT_EPOCH_INVALID'),
    runtimeId: uuid(payload.runtime_id, 'RUNTIME_ID_INVALID'),
  };
}

function tokenFromHeader(header) {
  const match = String(header || '').match(/^Bearer ([A-Za-z0-9_-]{24,256})$/);
  return match ? match[1] : '';
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function authenticate(runtime, authorization, scope) {
  const token = tokenFromHeader(authorization);
  if (!runtime || !safeEqual(token, runtime.bridgeToken)) throw new BridgeError('BRIDGE_AUTH_FAILED', 401);
  if (String(runtime.bridgeId || '').toLowerCase() !== scope.bridgeId
      || String(runtime.accountId || '').toLowerCase() !== scope.accountId
      || Number(runtime.accountEpoch) !== scope.accountEpoch) {
    throw new BridgeError('BRIDGE_SCOPE_MISMATCH', 403);
  }
}

function validateEvent(event, scope) {
  const required = ['protocol_version', 'type', 'bridge_id', 'account_id', 'account_epoch',
    'business_context', 'runtime_id', 'event_id', 'sequence', 'observed_at', 'chat_id',
    'binding_revision', 'identity', 'message'];
  const allowed = new Set([...required, 'peer_ref', 'evidence']);
  if (!event || typeof event !== 'object' || Array.isArray(event)
      || required.some(key => !Object.hasOwn(event, key))
      || Object.keys(event).some(key => !allowed.has(key))) throw new BridgeError('EVENT_SHAPE_INVALID');
  const nested = bridgeScope(event);
  if (stable(nested) !== stable(scope)) throw new BridgeError('EVENT_SCOPE_MISMATCH', 403);
  if (event.type !== 'message.observed') throw new BridgeError('EVENT_TYPE_UNSUPPORTED');
  const eventId = uuid(event.event_id, 'EVENT_ID_INVALID');
  const chatId = uuid(event.chat_id, 'CHAT_ID_INVALID');
  const sequence = positiveBigIntString(event.sequence, 'SEQUENCE_INVALID');
  const bindingRevision = positiveInteger(event.binding_revision, 'BINDING_REVISION_INVALID');
  const identityLevels = { verified: 'verified', verified_locator: 'verified', unresolved: 'unresolved', operator_bound: 'unresolved' };
  const identityLevel = identityLevels[event.identity?.level];
  const peerRef = event.identity?.peer_ref || event.peer_ref;
  if (!event.identity || !identityLevel || !REF_RE.test(String(peerRef || ''))
      || (event.identity.peer_ref && event.peer_ref && event.identity.peer_ref !== event.peer_ref)) throw new BridgeError('IDENTITY_INVALID');
  if (!event.message || !['inbound', 'outbound', 'unknown'].includes(event.message.direction)
      || !['crm_command', 'external_viber', 'unknown'].includes(event.message.origin)
      || typeof event.message.text !== 'string' || !event.message.text
      || event.message.text.length > 4000 || /[\0]/.test(event.message.text)
      || (event.message.content_type && event.message.content_type !== 'text')) throw new BridgeError('MESSAGE_INVALID');
  const observedAt = new Date(event.observed_at);
  if (!Number.isFinite(observedAt.getTime())) throw new BridgeError('OBSERVED_AT_INVALID');
  const displayName = typeof event.identity.display_name === 'string'
    ? event.identity.display_name.trim().slice(0, 255) : '';
  return { ...scope, eventId, chatId, sequence, bindingRevision, observedAt,
    identityLevel, peerRef, displayName,
    direction: event.message.direction, origin: event.message.origin, text: event.message.text };
}

function conversationExternalId(scope, chatId) {
  return `personal:${scope.bridgeId}:${chatId}`;
}

function createService(deps = {}) {
  const db = deps.pool || pool;
  const hub = () => deps.hub || require('./omni-hub');
  const now = deps.now || (() => new Date());
  const randomUUID = deps.randomUUID || crypto.randomUUID;

  async function assertActiveRuntime(scope) {
    const result = await db.query(
      `SELECT runtime_id,last_heartbeat_at FROM omni_viber_personal_bridge_runtime
        WHERE business_context=$1 AND bridge_id=$2 AND account_id=$3 AND account_epoch=$4`,
      [scope.businessContext, scope.bridgeId, scope.accountId, scope.accountEpoch]
    );
    const active = result.rows[0];
    if (!active || String(active.runtime_id || '').toLowerCase() !== scope.runtimeId) {
      throw new BridgeError('BRIDGE_RUNTIME_INACTIVE', 409);
    }
    return active;
  }

  async function heartbeat(payload, runtime, authorization) {
    const scope = bridgeScope(payload);
    authenticate(runtime, authorization, scope);
    const capabilities = payload.capabilities && typeof payload.capabilities === 'object' && !Array.isArray(payload.capabilities)
      ? payload.capabilities : {};
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [JSON.stringify(['viber-personal-runtime', scope.businessContext, scope.bridgeId])]);
      const current = await client.query(
        `SELECT runtime_id,last_heartbeat_at FROM omni_viber_personal_bridge_runtime
          WHERE business_context=$1 AND bridge_id=$2 FOR UPDATE`,
        [scope.businessContext, scope.bridgeId]
      );
      const active = current.rows[0];
      if (active?.runtime_id && String(active.runtime_id).toLowerCase() !== scope.runtimeId
          && active.last_heartbeat_at && now() - new Date(active.last_heartbeat_at) <= 90_000) {
        throw new BridgeError('BRIDGE_ALREADY_ACTIVE', 409);
      }
      await client.query(
        `INSERT INTO omni_viber_personal_bridge_runtime
         (business_context, bridge_id, account_id, account_epoch, runtime_id, capabilities, last_heartbeat_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW(),NOW())
       ON CONFLICT (business_context, bridge_id) DO UPDATE SET
         account_id=EXCLUDED.account_id, account_epoch=EXCLUDED.account_epoch,
         runtime_id=EXCLUDED.runtime_id, capabilities=EXCLUDED.capabilities,
         last_heartbeat_at=NOW(), last_error_code=NULL, updated_at=NOW()`,
      [scope.businessContext, scope.bridgeId, scope.accountId, scope.accountEpoch,
        scope.runtimeId, JSON.stringify(capabilities)]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return { protocol_version: PROTOCOL_VERSION, server_time: now().toISOString() };
  }

  async function processEvent(raw, scope) {
    const event = validateEvent(raw, scope);
    const hash = payloadHash(raw);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [JSON.stringify(['viber-personal-event', scope.businessContext, scope.bridgeId, event.eventId])]);
      const existing = await client.query(
        `SELECT payload_hash, status FROM omni_viber_personal_bridge_events
          WHERE business_context=$1 AND bridge_id=$2 AND event_id=$3`,
        [scope.businessContext, scope.bridgeId, event.eventId]
      );
      if (existing.rows[0] && existing.rows[0].payload_hash !== hash) throw new BridgeError('EVENT_ID_CONFLICT', 409);
      if (['processed', 'ignored'].includes(existing.rows[0]?.status)) {
        await client.query('COMMIT');
        return event.eventId;
      }
      await client.query(
        `INSERT INTO omni_viber_personal_bridge_events
           (business_context,bridge_id,event_id,account_id,account_epoch,runtime_id,sequence,chat_id,binding_revision,payload_hash,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'received')
         ON CONFLICT (business_context,bridge_id,event_id) DO UPDATE SET status='received',error_code=NULL`,
        [scope.businessContext, scope.bridgeId, event.eventId, scope.accountId, scope.accountEpoch,
          scope.runtimeId, event.sequence, event.chatId, event.bindingRevision, hash]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    try {
      let status = 'ignored';
      if (event.direction === 'inbound' && event.origin === 'external_viber') {
        const processed = await hub().processInboundMessage({
          channel: 'viber',
          externalId: conversationExternalId(scope, event.chatId),
          senderName: event.displayName || 'Viber contact',
          phone: null,
          content: event.text,
          contentType: 'text',
          mediaUrl: null,
          externalMessageId: `vpb:${scope.bridgeId}:${event.eventId}`,
          meta: { connectorType: 'viber_personal_bridge', bridgeId: scope.bridgeId,
            accountId: scope.accountId, accountEpoch: scope.accountEpoch, chatId: event.chatId,
            bindingRevision: event.bindingRevision, identityLevel: event.identityLevel,
            peerRef: event.peerRef, observedAt: event.observedAt.toISOString() },
        }, { businessContext: scope.businessContext });
        await db.query(
          `UPDATE conversations SET meta=COALESCE(meta,'{}'::jsonb)||$2::jsonb WHERE id=$1`,
          [processed.conversation.id, JSON.stringify({ connectorType: 'viber_personal_bridge',
            bridgeId: scope.bridgeId, accountId: scope.accountId, accountEpoch: scope.accountEpoch,
            chatId: event.chatId, bindingRevision: event.bindingRevision,
            identityLevel: event.identityLevel, peerRef: event.peerRef })]
        );
        status = 'processed';
      }
      await db.query(
        `UPDATE omni_viber_personal_bridge_events SET status=$4,processed_at=NOW(),error_code=NULL
          WHERE business_context=$1 AND bridge_id=$2 AND event_id=$3`,
        [scope.businessContext, scope.bridgeId, event.eventId, status]
      );
      await db.query(
        `UPDATE omni_viber_personal_bridge_runtime SET last_receive_at=NOW(),last_error_code=NULL,updated_at=NOW()
          WHERE business_context=$1 AND bridge_id=$2`, [scope.businessContext, scope.bridgeId]
      );
      return event.eventId;
    } catch (error) {
      await db.query(
        `UPDATE omni_viber_personal_bridge_events SET status='failed',error_code=$4
          WHERE business_context=$1 AND bridge_id=$2 AND event_id=$3`,
        [scope.businessContext, scope.bridgeId, event.eventId, 'PROCESSING_FAILED']
      ).catch(() => {});
      throw error;
    }
  }

  async function ingest(payload, runtime, authorization) {
    if (!payload || !Array.isArray(payload.events) || payload.events.length > 50) throw new BridgeError('BATCH_INVALID');
    const scope = bridgeScope({ ...payload, ...(payload.events[0] || {}) });
    authenticate(runtime, authorization, scope);
    await assertActiveRuntime(scope);
    const acked = [];
    for (const event of payload.events) acked.push(await processEvent(event, scope));
    return { protocol_version: PROTOCOL_VERSION, acked_event_ids: acked };
  }

  async function enqueue(conversation, messageId, text, clientRequestId) {
    const meta = conversation?.meta || {};
    if (conversation?.channel !== 'viber' || meta.connectorType !== 'viber_personal_bridge') return null;
    if (meta.identityLevel !== 'verified') throw new BridgeError('PEER_UNVERIFIED', 409);
    const commandId = randomUUID();
    const command = { command_id: commandId, client_request_id: clientRequestId || commandId,
      bridge_id: meta.bridgeId, account_id: meta.accountId, account_epoch: meta.accountEpoch,
      business_context: conversation.businessContext, chat_id: meta.chatId,
      binding_revision: meta.bindingRevision, text };
    const hash = payloadHash(command);
    await db.query(
      `INSERT INTO omni_viber_personal_bridge_commands
         (command_id,business_context,bridge_id,account_id,account_epoch,conversation_id,message_id,
          client_request_id,chat_id,binding_revision,text,payload_hash,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'queued')
       ON CONFLICT (message_id) DO NOTHING`,
      [commandId, conversation.businessContext, meta.bridgeId, meta.accountId, meta.accountEpoch,
        conversation.id, messageId, command.client_request_id, meta.chatId, meta.bindingRevision,
        text, hash]
    );
    const row = await db.query('SELECT command_id,status,payload_hash FROM omni_viber_personal_bridge_commands WHERE message_id=$1', [messageId]);
    if (!row.rows[0] || row.rows[0].payload_hash !== hash) throw new BridgeError('COMMAND_ID_CONFLICT', 409);
    return { queued: true, commandId: row.rows[0].command_id, status: row.rows[0].status };
  }

  async function assertSendCapable(conversation) {
    const meta = conversation?.meta || {};
    if (conversation?.channel !== 'viber' || meta.connectorType !== 'viber_personal_bridge') return false;
    if (meta.identityLevel !== 'verified') throw new BridgeError('PEER_UNVERIFIED', 409);
    const state = await db.query(
      `SELECT last_heartbeat_at FROM omni_viber_personal_bridge_runtime
        WHERE business_context=$1 AND bridge_id=$2 AND account_id=$3 AND account_epoch=$4`,
      [conversation.businessContext, meta.bridgeId, meta.accountId, meta.accountEpoch]
    );
    const heartbeat = state.rows[0]?.last_heartbeat_at ? new Date(state.rows[0].last_heartbeat_at) : null;
    if (!heartbeat || now() - heartbeat > 90_000) throw new BridgeError('BRIDGE_OFFLINE', 409);
    return true;
  }

  async function pull(payload, runtime, authorization) {
    const scope = bridgeScope(payload);
    authenticate(runtime, authorization, scope);
    await assertActiveRuntime(scope);
    const limit = Math.min(20, positiveInteger(payload.limit || 10, 'LIMIT_INVALID'));
    const result = await db.query(
      `WITH picked AS (
         SELECT command_id FROM omni_viber_personal_bridge_commands
          WHERE business_context=$1 AND bridge_id=$2 AND account_id=$3 AND account_epoch=$4
            AND (status='queued' OR (status='leased' AND lease_expires_at<NOW()))
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $6
       ) UPDATE omni_viber_personal_bridge_commands c SET status='leased',lease_runtime_id=$5,
           lease_expires_at=NOW()+INTERVAL '${LEASE_SECONDS} seconds',updated_at=NOW()
         FROM picked WHERE c.command_id=picked.command_id RETURNING c.*`,
      [scope.businessContext, scope.bridgeId, scope.accountId, scope.accountEpoch, scope.runtimeId, limit]
    );
    return { protocol_version: PROTOCOL_VERSION, commands: result.rows.map(row => ({
      protocol_version: PROTOCOL_VERSION, type: 'message.send', command_id: row.command_id,
      client_request_id: row.client_request_id, bridge_id: row.bridge_id,
      account_id: row.account_id, account_epoch: row.account_epoch,
      business_context: row.business_context, chat_id: row.chat_id,
      binding_revision: row.binding_revision, text: row.text,
    })) };
  }

  async function commandResult(commandId, payload, runtime, authorization) {
    const scope = bridgeScope(payload);
    authenticate(runtime, authorization, scope);
    await assertActiveRuntime(scope);
    commandId = uuid(commandId, 'COMMAND_ID_INVALID');
    const allowed = new Set(['dispatch_started', ...TERMINAL_COMMAND_STATES]);
    if (!allowed.has(payload.status)) throw new BridgeError('COMMAND_STATUS_INVALID');
    const client = await db.connect();
    let row;
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT * FROM omni_viber_personal_bridge_commands
          WHERE command_id=$1 AND business_context=$2 AND bridge_id=$3 AND account_id=$4 AND account_epoch=$5
          FOR UPDATE`,
        [commandId, scope.businessContext, scope.bridgeId, scope.accountId, scope.accountEpoch]
      );
      row = found.rows[0];
      if (!row) throw new BridgeError('COMMAND_NOT_FOUND', 404);
      if (TERMINAL_COMMAND_STATES.has(row.status)) {
        if (row.status !== payload.status || (row.error_code || null) !== (payload.error_code || null)) {
          throw new BridgeError('COMMAND_RESULT_CONFLICT', 409);
        }
      } else {
        if (String(row.lease_runtime_id || '').toLowerCase() !== scope.runtimeId) throw new BridgeError('COMMAND_LEASE_MISMATCH', 409);
        const transitions = {
          leased: new Set(['dispatch_started', 'rejected']),
          dispatch_started: new Set(['submitted_unconfirmed', 'unknown']),
        };
        if (!transitions[row.status]?.has(payload.status)) throw new BridgeError('COMMAND_TRANSITION_INVALID', 409);
        const updated = await client.query(
          `UPDATE omni_viber_personal_bridge_commands SET status=$2,error_code=$3,
              completed_at=CASE WHEN $2=ANY($4::text[]) THEN NOW() ELSE completed_at END,updated_at=NOW()
            WHERE command_id=$1 RETURNING *`,
          [commandId, payload.status, payload.error_code || null, [...TERMINAL_COMMAND_STATES]]
        );
        row = updated.rows[0];
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const truth = payload.status === 'submitted_unconfirmed'
      ? hub().buildSendTruth('provider_attempted', { channel: 'viber', providerAttempted: true,
        providerAccepted: true, providerReference: commandId,
        message: 'Viber Desktop прийняв команду; доставку адресату ще не підтверджено.' })
      : payload.status === 'rejected'
        ? hub().buildSendTruth('provider_failed_immediate', { channel: 'viber', providerAttempted: false,
          providerAccepted: false, providerReference: commandId, error: payload.error_code || 'BRIDGE_REJECTED' })
        : hub().buildSendTruth('provider_unknown', { channel: 'viber', providerAttempted: true,
          providerAccepted: null, providerReference: commandId, error: payload.error_code || 'BRIDGE_RESULT_UNKNOWN' });
    if (payload.status !== 'dispatch_started') await hub().saveMessageSendTruth(row.message_id, truth);
    return { protocol_version: PROTOCOL_VERSION, command_id: commandId, status: row.status };
  }

  async function status(runtime, businessContext) {
    const result = await db.query(
      `SELECT * FROM omni_viber_personal_bridge_runtime WHERE business_context=$1 AND bridge_id=$2`,
      [businessContext, runtime.bridgeId]
    );
    const row = result.rows[0];
    const heartbeat = row?.last_heartbeat_at ? new Date(row.last_heartbeat_at) : null;
    const online = Boolean(heartbeat && now() - heartbeat <= 90_000);
    return { online, lastHeartbeatAt: heartbeat?.toISOString() || null,
      lastReceiveAt: row?.last_receive_at ? new Date(row.last_receive_at).toISOString() : null,
      capabilities: row?.capabilities || {} };
  }

  return { heartbeat, ingest, enqueue, assertSendCapable, pull, commandResult, status };
}

module.exports = { PROTOCOL_VERSION, BridgeError, bridgeScope, authenticate, validateEvent,
  payloadHash, conversationExternalId, createService };
