'use strict';

const { pool } = require('../db');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');

const MAX_SOURCE_LENGTH = 80;

function linkError(message, statusCode = 400, code = 'LEAD_CONVERSATION_LINK_INVALID') {
    const error = new Error(message);
    error.status = statusCode;
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function positiveId(value, label) {
    const id = Number.parseInt(value, 10);
    if (!Number.isInteger(id) || id <= 0) {
        throw linkError(`Некоректний ${label}`, 400, 'LEAD_CONVERSATION_LINK_INVALID_ID');
    }
    return id;
}

function optionalPositiveId(value, label) {
    if (value === undefined || value === null || value === '') return null;
    return positiveId(value, label);
}

function normalizedBusinessContext(value) {
    return normalizeBusinessContext(value || DEFAULT_BUSINESS_CONTEXT) || DEFAULT_BUSINESS_CONTEXT;
}

function normalizedSource(value) {
    const source = String(value || 'manual').trim();
    if (!source || source.length > MAX_SOURCE_LENGTH) {
        throw linkError('Некоректне походження зв’язку', 400, 'LEAD_CONVERSATION_LINK_INVALID_SOURCE');
    }
    return source;
}

function normalizedMetadata(value) {
    if (value === undefined || value === null) return {};
    if (Array.isArray(value) || typeof value !== 'object') {
        throw linkError('Метадані зв’язку мають бути об’єктом', 400, 'LEAD_CONVERSATION_LINK_INVALID_METADATA');
    }
    return value;
}

function mapLink(row) {
    if (!row) return null;
    return {
        id: row.id,
        businessContext: row.business_context,
        leadId: row.lead_id,
        conversationId: row.conversation_id,
        isOrigin: row.is_origin === true,
        isPrimary: row.is_primary === true,
        source: row.source,
        metadata: row.metadata || {},
        createdBy: row.created_by || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        channel: row.channel || null,
        conversationStatus: row.conversation_status || null,
        lastMessageAt: row.last_message_at || null,
        customerName: row.customer_name || null,
        customerPhone: row.customer_phone || null,
        customerId: row.customer_id || null,
        assignedTo: row.assigned_to || null,
        unreadCount: row.unread_count || 0,
        lastInboundAt: row.last_inbound_at || null,
        lastOutboundAt: row.last_outbound_at || null,
        replyExpected: row.reply_expected === true,
        awaitingReplySince: row.awaiting_reply_since || null,
        replyExpectedMessageId: row.reply_expected_message_id || null,
        replyOwner: row.reply_owner || null,
        replyOwnerUserId: row.reply_owner_user_id || null,
        replySlaAt: row.reply_sla_at || null,
        replyDeliveryStatus: row.reply_expected_delivery_status || null,
        lastMessage: row.last_message || null,
    };
}

async function inTransaction(options, callback) {
    if (options.client) return callback(options.client);
    const db = options.db || pool;
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function lockLeadConversationLinks(client, businessContext, leadId) {
    await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
        [`lead_conversation_links:${businessContext}:${leadId}`]
    );
}

async function assertScopedLeadAndConversation(client, { businessContext, leadId, conversationId }) {
    const result = await client.query(
        `SELECT l.id AS lead_id, c.id AS conversation_id
           FROM leads l
           JOIN conversations c ON c.id = $3
          WHERE l.id = $2
            AND l.business_context = $1
            AND c.business_context = $1
          FOR KEY SHARE OF l, c`,
        [businessContext, leadId, conversationId]
    );
    if (!result.rows[0]) {
        throw linkError('Лід або розмова недоступні в цьому бізнесі', 404, 'LEAD_CONVERSATION_LINK_NOT_FOUND');
    }
}

async function findScopedLinkForUpdate(client, { businessContext, leadId, conversationId }) {
    const result = await client.query(
        `SELECT *
           FROM lead_conversation_links
          WHERE business_context = $1
            AND lead_id = $2
            AND conversation_id = $3
          FOR UPDATE`,
        [businessContext, leadId, conversationId]
    );
    if (!result.rows[0]) {
        throw linkError('Підтверджений зв’язок ліда з розмовою не знайдено', 404, 'LEAD_CONVERSATION_LINK_NOT_FOUND');
    }
    return result.rows[0];
}

async function markSingleLinkFlag(client, { businessContext, leadId, conversationId, column }) {
    await client.query(
        `UPDATE lead_conversation_links
            SET ${column} = FALSE,
                updated_at = NOW()
          WHERE business_context = $1
            AND lead_id = $2
            AND ${column} = TRUE
            AND conversation_id <> $3`,
        [businessContext, leadId, conversationId]
    );
    const result = await client.query(
        `UPDATE lead_conversation_links
            SET ${column} = TRUE,
                updated_at = NOW()
          WHERE business_context = $1
            AND lead_id = $2
            AND conversation_id = $3
          RETURNING *`,
        [businessContext, leadId, conversationId]
    );
    if (!result.rows[0]) {
        throw linkError('Підтверджений зв’язок ліда з розмовою не знайдено', 404, 'LEAD_CONVERSATION_LINK_NOT_FOUND');
    }
    return result.rows[0];
}

function normalizeLinkInput(input = {}) {
    return {
        businessContext: normalizedBusinessContext(input.businessContext || input.business_context),
        leadId: positiveId(input.leadId ?? input.lead_id, 'ID ліда'),
        conversationId: positiveId(input.conversationId ?? input.conversation_id, 'ID розмови'),
        source: normalizedSource(input.source),
        metadata: normalizedMetadata(input.metadata),
        createdBy: optionalPositiveId(input.createdBy ?? input.created_by, 'ID користувача'),
        isOrigin: input.isOrigin === true || input.is_origin === true,
        isPrimary: input.isPrimary === true || input.is_primary === true,
    };
}

/**
 * Create or reuse a confirmed lead-to-conversation link.
 *
 * The operation owns a transaction unless a caller passes options.client from
 * its existing transaction. Per-lead advisory locking makes concurrent primary
 * or origin selections deterministic and preserves the one-flag invariants.
 */
async function linkLeadConversation(input = {}, options = {}) {
    const link = normalizeLinkInput(input);
    return inTransaction(options, async client => {
        await lockLeadConversationLinks(client, link.businessContext, link.leadId);
        await assertScopedLeadAndConversation(client, link);
        const inserted = await client.query(
            `INSERT INTO lead_conversation_links
                (business_context, lead_id, conversation_id, source, metadata, created_by)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)
             ON CONFLICT (business_context, lead_id, conversation_id) DO UPDATE
                SET metadata = COALESCE(lead_conversation_links.metadata, '{}'::jsonb)
                               || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
                    updated_at = NOW()
             RETURNING *`,
            [
                link.businessContext,
                link.leadId,
                link.conversationId,
                link.source,
                JSON.stringify(link.metadata),
                link.createdBy,
            ]
        );
        let row = inserted.rows[0];
        if (link.isOrigin) {
            row = await markSingleLinkFlag(client, { ...link, column: 'is_origin' });
        }
        if (link.isPrimary) {
            row = await markSingleLinkFlag(client, { ...link, column: 'is_primary' });
        }
        return mapLink(row);
    });
}

async function setLeadPrimaryConversation(input = {}, options = {}) {
    const link = normalizeLinkInput({ ...input, source: input.source || 'manual' });
    return inTransaction(options, async client => {
        await lockLeadConversationLinks(client, link.businessContext, link.leadId);
        await assertScopedLeadAndConversation(client, link);
        await findScopedLinkForUpdate(client, link);
        return mapLink(await markSingleLinkFlag(client, { ...link, column: 'is_primary' }));
    });
}

async function listLeadConversationLinks(input = {}, options = {}) {
    const businessContext = normalizedBusinessContext(input.businessContext || input.business_context);
    const leadId = positiveId(input.leadId ?? input.lead_id, 'ID ліда');
    const db = options.db || pool;
    const result = await db.query(
        `SELECT lcl.*, c.channel, c.status AS conversation_status, c.last_message_at, c.customer_name,
                c.customer_phone, c.customer_id, c.assigned_to, c.unread_count,
                c.last_inbound_at, c.last_outbound_at,
                c.reply_expected, c.awaiting_reply_since, c.reply_expected_message_id,
                c.reply_owner, c.reply_owner_user_id, c.reply_sla_at,
                expected_msg.delivery_status AS reply_expected_delivery_status,
                last_message.content AS last_message
           FROM lead_conversation_links lcl
           JOIN conversations c ON c.id = lcl.conversation_id
           LEFT JOIN conversation_messages expected_msg ON expected_msg.id = c.reply_expected_message_id
             AND expected_msg.conversation_id = c.id
           LEFT JOIN LATERAL (
             SELECT content
               FROM conversation_messages
              WHERE conversation_id = c.id
              ORDER BY created_at DESC, id DESC
              LIMIT 1
           ) last_message ON true
          WHERE lcl.business_context = $1
            AND lcl.lead_id = $2
            AND c.business_context = $1
          ORDER BY lcl.is_primary DESC, lcl.is_origin DESC, lcl.updated_at DESC, lcl.id DESC`,
        [businessContext, leadId]
    );
    return result.rows.map(mapLink);
}

async function listConversationLeadLinks(input = {}, options = {}) {
    const businessContext = normalizedBusinessContext(input.businessContext || input.business_context);
    const conversationId = positiveId(input.conversationId ?? input.conversation_id, 'ID розмови');
    const db = options.db || pool;
    const result = await db.query(
        `SELECT lcl.*, l.client_name, l.pipeline_stage
           FROM lead_conversation_links lcl
           JOIN leads l ON l.id = lcl.lead_id
          WHERE lcl.business_context = $1
            AND lcl.conversation_id = $2
            AND l.business_context = $1
          ORDER BY lcl.is_primary DESC, lcl.is_origin DESC, lcl.updated_at DESC, lcl.id DESC`,
        [businessContext, conversationId]
    );
    return result.rows.map(row => ({
        ...mapLink(row),
        clientName: row.client_name || null,
        pipelineStage: row.pipeline_stage || null,
    }));
}

module.exports = {
    linkLeadConversation,
    setLeadPrimaryConversation,
    listLeadConversationLinks,
    listConversationLeadLinks,
    mapLink,
};
