const { pool: defaultPool } = require('../db');
const {
    booleanValue,
    deriveReplySlaState,
    isActiveWaitingReply
} = require('./replySla');
const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');

const INBOUND_ONLY_CHANNELS = new Set(['binotel']);

function normalizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function toDateOnly(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 10);
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    return String(value).slice(0, 10);
}

function mapCustomer(row) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        phone: row.phone || null,
        instagram: row.instagram || null,
        businessContext: normalizeBusinessContext(row.business_context),
        childName: row.child_name || null,
        source: row.source || null,
        leadId: row.lead_id || null,
        totalBookings: row.total_bookings || 0,
        totalSpent: row.total_spent || 0,
        firstVisit: row.first_visit || null,
        lastVisit: row.last_visit || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    };
}

async function fetchCustomerRow(db, id, options = {}) {
    const businessContext = normalizeBusinessContext(options.businessContext);

    const customerResult = await db.query(
        `SELECT * FROM customers
         WHERE id = $1 AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
         LIMIT 1`,
        [id, businessContext]
    );
    return customerResult.rows[0] || null;
}

function mapLead(row) {
    if (!row) return null;
    return {
        id: row.id,
        clientName: row.client_name,
        phone: row.phone || null,
        pipelineStage: row.pipeline_stage || null,
        status: row.status || null,
        bookingId: row.booking_id || null,
        eventDate: row.event_date || null,
        assignedName: row.assigned_name || null
    };
}

function mapBooking(row) {
    if (!row) return null;
    return {
        id: row.id,
        date: row.date,
        time: row.time || null,
        status: row.status || null,
        programName: row.program_name || null,
        programCode: row.program_code || null,
        label: row.label || null,
        room: row.room || null,
        price: row.price || null,
        customerId: row.customer_id || null
    };
}

function mapConversation(row, confidence) {
    if (!row) return null;
    const channel = String(row.channel || 'unknown').toLowerCase();
    return {
        id: row.id,
        channel,
        customerName: row.customer_name || null,
        customerPhone: row.customer_phone || null,
        customerId: row.customer_id || null,
        status: row.status || null,
        assignedTo: row.assigned_to || null,
        unreadCount: row.unread_count || 0,
        lastMessageAt: row.last_message_at || null,
        lastInboundAt: row.last_inbound_at || null,
        lastOutboundAt: row.last_outbound_at || null,
        replyExpected: booleanValue(row.reply_expected),
        awaitingReplySince: row.awaiting_reply_since || null,
        replyExpectedMessageId: row.reply_expected_message_id || null,
        replyOwner: row.reply_owner || null,
        replyOwnerUserId: row.reply_owner_user_id || null,
        replySlaAt: row.reply_sla_at || null,
        replySlaState: deriveReplySlaState(row),
        waitingReply: isActiveWaitingReply(row),
        replyDeliveryStatus: row.reply_expected_delivery_status || null,
        lastMessage: row.last_message || null,
        confidence,
        sendCapable: !INBOUND_ONLY_CHANNELS.has(channel),
        channelNote: INBOUND_ONLY_CHANNELS.has(channel)
            ? 'Канал тільки для вхідних звернень: відкривайте історію, але не очікуйте відправку з CRM.'
            : null
    };
}

function mapCommunication(row) {
    if (!row) return null;
    return {
        id: row.id,
        type: row.type,
        direction: row.direction || null,
        summary: row.summary || '',
        createdByName: row.created_by_name || null,
        createdAt: row.created_at || null
    };
}

function buildTimelineLink(booking) {
    if (!booking?.id || !booking?.date) return null;
    return `/?date=${encodeURIComponent(toDateOnly(booking.date))}&highlight=${encodeURIComponent(booking.id)}`;
}

function pickPrimaryBooking(bookings) {
    if (!Array.isArray(bookings) || bookings.length === 0) return null;
    const today = toDateOnly(new Date());
    const active = bookings.filter(b => b.status !== 'cancelled');
    const upcoming = active
        .filter(b => toDateOnly(b.date) >= today)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || '').localeCompare(String(b.time || '')));
    return upcoming[0] || active[0] || bookings[0] || null;
}

function buildSearchValue(customer) {
    return customer.phone || customer.name || customer.instagram || '';
}

// Read only persisted relationships. Lead primary/origin flags belong to the lead,
// and must never select a primary conversation for the entire customer.
function confirmedCustomerConversationSql(customerAlias = 'p', conversationAlias = 'c') {
    return `(${conversationAlias}.customer_id = ${customerAlias}.id OR (
        ${conversationAlias}.customer_id IS NULL AND EXISTS (
            SELECT 1 FROM lead_conversation_links lcl
            JOIN leads l ON l.id = lcl.lead_id
              AND COALESCE(l.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = COALESCE(${customerAlias}.business_context, '${DEFAULT_BUSINESS_CONTEXT}')
            WHERE lcl.conversation_id = ${conversationAlias}.id
              AND lcl.business_context = COALESCE(${customerAlias}.business_context, '${DEFAULT_BUSINESS_CONTEXT}')
              AND (l.id = ${customerAlias}.lead_id OR EXISTS (
                  SELECT 1 FROM lead_customer_links customer_link
                  WHERE customer_link.lead_id = l.id AND customer_link.customer_id = ${customerAlias}.id
                    AND customer_link.business_context = lcl.business_context
              ))
        )
    ))`;
}

function uniqueConversations(conversations = []) {
    return [...new Map(conversations.map(conversation => [Number(conversation.id), conversation])).values()];
}

function buildCustomerOmniNavigation(customer, conversations = []) {
    const confirmed = uniqueConversations(conversations);
    const businessContext = normalizeBusinessContext(customer.businessContext || customer.business_context);
    const contextQuery = `businessContext=${encodeURIComponent(businessContext)}`;
    const search = buildSearchValue(customer);
    return {
        action: confirmed.length === 1 ? 'open' : confirmed.length > 1 ? 'choose' : 'search',
        exactConversationCount: confirmed.length,
        conversations: confirmed.map(({ id, channel, status }) => ({ id: Number(id), channel, status })),
        links: {
            omniExact: confirmed.length === 1 ? `/omni?conversation=${encodeURIComponent(confirmed[0].id)}&${contextQuery}` : null,
            omniChoose: confirmed.length > 1 ? `/customers?open=${encodeURIComponent(customer.id)}&${contextQuery}` : null,
            omniSuggested: null,
            omniSearch: search ? `/omni?search=${encodeURIComponent(search)}&${contextQuery}` : null
        }
    };
}

async function getCustomerOmniSummaries(customers = [], options = {}) {
    const summaries = new Map();
    if (!customers.length) return summaries;
    const db = options.pool || defaultPool;
    const ids = customers.map(customer => Number(customer.id));
    const result = await db.query(`
        SELECT p.id AS navigation_customer_id, c.id, c.channel, c.status
        FROM customers p
        JOIN conversations c
          ON COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = COALESCE(p.business_context, '${DEFAULT_BUSINESS_CONTEXT}')
         AND ${confirmedCustomerConversationSql()}
        WHERE p.id = ANY($1::int[])
        ORDER BY p.id, c.last_message_at DESC NULLS LAST, c.updated_at DESC, c.id DESC
    `, [ids]);
    const byCustomer = new Map();
    for (const row of result.rows) {
        const id = Number(row.navigation_customer_id);
        if (!byCustomer.has(id)) byCustomer.set(id, []);
        byCustomer.get(id).push(row);
    }
    for (const customer of customers) {
        summaries.set(Number(customer.id), buildCustomerOmniNavigation(customer, byCustomer.get(Number(customer.id)) || []));
    }
    return summaries;
}

function buildContextLinks({ customer, lead, primaryBooking, live }) {
    const phoneDigits = normalizeDigits(customer.phone);
    const tel = customer.phone ? `tel:${String(customer.phone).replace(/[^+\d]/g, '')}` : null;
    const telegramExternal = phoneDigits ? `https://t.me/${phoneDigits}` : null;

    return {
        call: tel,
        telegramExternal,
        ...buildCustomerOmniNavigation(customer, live.exactConversations).links,
        leadWorkspace: lead?.id ? `/sales-funnel?lead=${encodeURIComponent(lead.id)}` : null,
        booking: primaryBooking ? buildTimelineLink(primaryBooking) : null
    };
}

async function getCustomerCommunicationContext(customerId, options = {}) {
    const db = options.pool || defaultPool;
    const businessContext = normalizeBusinessContext(options.businessContext);
    const id = Number.parseInt(customerId, 10);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Invalid customer id');
    }

    const customer = mapCustomer(await fetchCustomerRow(db, id, options));
    if (!customer) return null;

    let lead = null;
    if (customer.leadId) {
        const leadResult = await db.query(`
            SELECT l.*, u.name AS assigned_name
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            WHERE l.id = $1
              AND COALESCE(l.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
            LIMIT 1
        `, [customer.leadId, businessContext]);
        lead = mapLead(leadResult.rows[0]);
    }

    const bookingsResult = await db.query(`
        SELECT id, date, time, status, program_name, program_code, label, room, price, customer_id
        FROM bookings
        WHERE customer_id = $1
          AND COALESCE(business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
          AND NULLIF(linked_to, '') IS NULL
        ORDER BY date DESC NULLS LAST, time DESC NULLS LAST
        LIMIT 12
    `, [id, businessContext]);
    const bookings = bookingsResult.rows.map(mapBooking);
    const primaryBooking = pickPrimaryBooking(bookings);

    const logResult = await db.query(`
        SELECT cl.*, u.name AS created_by_name
        FROM communication_log cl
        LEFT JOIN users u ON cl.created_by = u.id
        WHERE cl.customer_id = $1
        ORDER BY cl.created_at DESC
        LIMIT 8
    `, [id]);
    const crmLog = logResult.rows.map(mapCommunication);

    const exactConversationsResult = await db.query(`
        SELECT c.id, c.channel, c.customer_name, c.customer_phone, c.customer_id, c.status,
               c.assigned_to, c.unread_count, c.last_message_at, c.updated_at,
               c.last_inbound_at, c.last_outbound_at,
               c.reply_expected, c.awaiting_reply_since, c.reply_expected_message_id,
               c.reply_owner, c.reply_owner_user_id, c.reply_sla_at,
               expected_msg.delivery_status AS reply_expected_delivery_status,
               m.content AS last_message
        FROM conversations c
        JOIN customers p ON p.id = $1
          AND COALESCE(p.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
        LEFT JOIN conversation_messages expected_msg ON expected_msg.id = c.reply_expected_message_id
          AND expected_msg.conversation_id = c.id
        LEFT JOIN LATERAL (
            SELECT content
            FROM conversation_messages
            WHERE conversation_id = c.id
            ORDER BY created_at DESC
            LIMIT 1
        ) m ON true
        WHERE ${confirmedCustomerConversationSql()}
          AND COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2
        ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
    `, [id, businessContext]);
    const exactConversations = uniqueConversations(exactConversationsResult.rows.map(row => mapConversation(row, 'exact')));

    const phoneDigits = normalizeDigits(customer.phone);
    const namePattern = customer.name ? `%${customer.name}%` : '';
    let suggestedConversations = [];
    if (phoneDigits || namePattern) {
        const suggestedResult = await db.query(`
            SELECT c.id, c.channel, c.customer_name, c.customer_phone, c.customer_id, c.status,
                   c.assigned_to, c.unread_count, c.last_message_at, c.updated_at,
                   c.last_inbound_at, c.last_outbound_at,
                   c.reply_expected, c.awaiting_reply_since, c.reply_expected_message_id,
                   c.reply_owner, c.reply_owner_user_id, c.reply_sla_at,
                   expected_msg.delivery_status AS reply_expected_delivery_status,
                   m.content AS last_message
            FROM conversations c
            LEFT JOIN conversation_messages expected_msg ON expected_msg.id = c.reply_expected_message_id
              AND expected_msg.conversation_id = c.id
            LEFT JOIN LATERAL (
                SELECT content
                FROM conversation_messages
                WHERE conversation_id = c.id
                ORDER BY created_at DESC
                LIMIT 1
            ) m ON true
            WHERE (c.customer_id IS NULL OR c.customer_id <> $1)
              AND NOT (c.id = ANY($5::int[]))
              AND COALESCE(c.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $4
              AND (
                  ($2 <> '' AND regexp_replace(COALESCE(c.customer_phone, ''), '\\D', '', 'g') = $2)
                  OR ($3 <> '' AND c.customer_name ILIKE $3)
              )
            ORDER BY
                CASE
                    WHEN $2 <> '' AND regexp_replace(COALESCE(c.customer_phone, ''), '\\D', '', 'g') = $2 THEN 0
                    ELSE 1
                END,
                c.last_message_at DESC NULLS LAST,
                c.updated_at DESC
            LIMIT 5
        `, [id, phoneDigits, namePattern, businessContext, exactConversations.map(conversation => conversation.id)]);
        const exactIds = new Set(exactConversations.map(conversation => Number(conversation.id)));
        suggestedConversations = uniqueConversations(suggestedResult.rows.map(row => mapConversation(row, 'suggested')))
            .filter(conversation => !exactIds.has(Number(conversation.id)));
    }

    const liveStatus = exactConversations.length
        ? 'exact'
        : (suggestedConversations.length ? 'suggested' : 'unavailable');
    const live = {
        status: liveStatus,
        exactConversations,
        suggestedConversations,
        primaryConversation: exactConversations.length === 1 ? exactConversations[0] : null,
        explanation: liveStatus === 'exact'
            ? 'Є підтверджений зв’язок клієнта або його лідів із Omni. Якщо діалогів кілька, оберіть потрібний.'
            : liveStatus === 'suggested'
                ? 'Є ймовірна Omni-розмова за телефоном або ім’ям. Це не записано як точна CRM-прив’язка.'
                : 'Точної живої Omni-розмови для клієнта не знайдено.'
    };
    const links = buildContextLinks({ customer, lead, primaryBooking, live });

    return {
        customer,
        lead,
        bookings,
        primaryBooking,
        crmLog,
        live,
        links,
        summary: {
            communicationConfidence: liveStatus,
            exactConversationCount: exactConversations.length,
            suggestedConversationCount: suggestedConversations.length,
            crmLogCount: crmLog.length,
            bookingCount: bookings.length,
            hasLeadWorkspace: Boolean(lead?.id)
        },
        sendPolicy: {
            mode: 'navigation_only',
            message: 'Цей хаб відкриває контекст і канали, але не підтверджує доставку повідомлень напряму з картки клієнта.'
        }
    };
}

module.exports = {
    getCustomerCommunicationContext,
    getCustomerOmniSummaries,
    buildCustomerOmniNavigation,
    normalizeDigits,
    buildTimelineLink,
    INBOUND_ONLY_CHANNELS
};
