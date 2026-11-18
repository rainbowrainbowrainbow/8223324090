'use strict';

const path = require('node:path');
const { canUseParkWorkModule } = require('./parkWorkModuleAccess');
const { getVisibleBookingScope } = require('./bookingVisibility');
const { loadGameZoneResourceIds } = require('./gameZoneAccess');
const { canViewTimelinePage } = require('./timelineContext');
const { userBusinessModuleState } = require('./businessModuleRegistry');
const { normalizeChatUploadRequestPath, publicChatUploadUrl } = require('./chatUploadStorage');

const PREVIEW_FIELDS = new Set(['id', 'date', 'time', 'programName', 'label', 'status']);

function bookingVisibilitySql(user, params) {
    if (!canViewTimelinePage(user, 'event_genix')
        || !userBusinessModuleState(user, 'event_genix', 'timeline').available) return 'AND 1 = 0';
    const own = getVisibleBookingScope(user, params, 'b');
    const zones = user.gameZoneResourceIds || [];
    if (!zones.length) return own.sql;
    params.push(zones);
    return `AND (${own.condition} OR b.room_resource_id = ANY($${params.length}::text[]))`;
}

// Chat previews are coordination cards. Finance/contact details stay behind the
// canonical booking API rather than a message copied to every channel member.
function shapeChatBookingPreviews(value, visibleIds = null) {
    if (Array.isArray(value)) return value.map(item => shapeChatBookingPreviews(item, visibleIds));
    if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
    const result = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
        if (key === 'bookingPreview') {
            if (!item || typeof item !== 'object' || Array.isArray(item)
                || (visibleIds && !visibleIds.has(String(item.id)))) continue;
            result[key] = Object.fromEntries(Object.entries(item).filter(([field, entry]) => PREVIEW_FIELDS.has(field)
                && ['string', 'number', 'boolean'].includes(typeof entry)));
        } else if (key === 'metadata' && typeof item === 'string') {
            try { result[key] = JSON.stringify(shapeChatBookingPreviews(JSON.parse(item), visibleIds)); }
            catch { result[key] = null; }
        } else result[key] = shapeChatBookingPreviews(item, visibleIds);
    }
    return result;
}

async function projectParkChatResponse(db, user, value) {
    const ids = new Set();
    function collect(item) {
        if (!item || typeof item !== 'object' || item instanceof Date || Buffer.isBuffer(item)) return;
        for (const [key, entry] of Object.entries(item)) {
            if (key === 'bookingPreview' && entry && ['string', 'number'].includes(typeof entry.id)
                && String(entry.id).length <= 128 && ids.size < 200) ids.add(String(entry.id));
            else if (key === 'metadata' && typeof entry === 'string') {
                try { collect(JSON.parse(entry)); } catch { /* Invalid historical metadata carries no preview. */ }
            } else if (entry && typeof entry === 'object') collect(entry);
        }
    }
    collect(value);
    if (!ids.size) return shapeChatBookingPreviews(value, new Set());
    const actor = { ...user, gameZoneResourceIds: await loadGameZoneResourceIds(db, user, 'event_genix') };
    const params = [[...ids]];
    const visibility = bookingVisibilitySql(actor, params);
    const result = canUseParkWorkModule(user, 'chat') ? await db.query(`SELECT b.id FROM bookings b
        WHERE b.id = ANY($1::text[]) AND b.business_context = 'event_genix' ${visibility}`, params) : { rows: [] };
    return shapeChatBookingPreviews(value, new Set(result.rows.map(row => String(row.id))));
}

function positiveId(value) {
    if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function hasParkChatPrivateIdentity(channel, userId) {
    const id = positiveId(userId);
    if (!id) return false;
    if (channel.is_dm === true || channel.type === 'dm') {
        const ids = channel.dm_user_ids;
        if (!Array.isArray(ids) || ids.length !== 2 || ids.some(value => !positiveId(value))
            || Number(ids[0]) === Number(ids[1]) || !ids.some(value => Number(value) === id)) return false;
    }
    if (channel.type === 'assistant' || channel.linked_entity_type === 'assistant_dialog') {
        if (channel.linked_booking_id || (channel.linked_entity_type && channel.linked_entity_type !== 'assistant_dialog')) return false;
        const owner = channel.linked_entity_type === 'assistant_dialog' ? positiveId(channel.linked_entity_id) : positiveId(channel.created_by);
        if (owner !== id || (channel.created_by != null && positiveId(channel.created_by) !== id)) return false;
    }
    return true;
}

async function canReadParkChatBooking(db, user, bookingId) {
    if (!canUseParkWorkModule(user, 'chat') || !['string', 'number'].includes(typeof bookingId)
        || !String(bookingId).trim()) return false;
    const actor = { ...user, gameZoneResourceIds: await loadGameZoneResourceIds(db, user, 'event_genix') };
    const params = [String(bookingId)];
    const visibility = bookingVisibilitySql(actor, params);
    const result = await db.query(`SELECT b.id FROM bookings b WHERE b.id = $1
        AND b.business_context = 'event_genix' ${visibility}`, params);
    return result.rows.length === 1;
}

async function canReadParkChatChannel(db, user, channelId) {
    const id = positiveId(channelId);
    if (!id || !canUseParkWorkModule(user, 'chat')) return false;
    const result = await db.query(`SELECT c.id, c.type, c.is_dm, c.dm_user_ids, c.created_by,
        c.linked_booking_id, c.linked_entity_type, c.linked_entity_id
        FROM chat_channels c JOIN chat_channel_members member ON member.channel_id = c.id
        WHERE c.id = $1 AND member.user_id = $2 AND COALESCE(c.is_archived, false) = false`, [id, user.id]);
    if (result.rows.length !== 1) return false;
    const channel = result.rows[0];
    if (!hasParkChatPrivateIdentity(channel, user.id)) return false;
    const links = [channel.linked_booking_id, channel.linked_entity_type === 'booking' ? channel.linked_entity_id : null]
        .filter(value => value !== null && value !== undefined && String(value).trim()).map(String);
    if (new Set(links).size > 1 || (channel.type === 'booking' && links.length === 0)) return false;
    return links.length === 0 || canReadParkChatBooking(db, user, links[0]);
}

async function loadReadableParkChatChannelIds(db, user) {
    if (!canUseParkWorkModule(user, 'chat')) return new Set();
    const actor = { ...user, gameZoneResourceIds: await loadGameZoneResourceIds(db, user, 'event_genix') };
    const params = [user.id];
    const visibility = bookingVisibilitySql(actor, params);
    const result = await db.query(`SELECT c.id FROM chat_channels c
        JOIN chat_channel_members member ON member.channel_id = c.id AND member.user_id = $1
        CROSS JOIN LATERAL (SELECT NULLIF(btrim(c.linked_booking_id::text), '') AS booking_id,
            CASE WHEN c.linked_entity_type = 'booking' THEN NULLIF(btrim(c.linked_entity_id::text), '') END AS entity_id) links
        WHERE COALESCE(c.is_archived, false) = false
          AND ((COALESCE(c.is_dm, false) = false AND c.type IS DISTINCT FROM 'dm')
            OR (array_length(c.dm_user_ids, 1) = 2 AND c.dm_user_ids[1] <> c.dm_user_ids[2] AND $1 = ANY(c.dm_user_ids)))
          AND ((c.type IS DISTINCT FROM 'assistant' AND c.linked_entity_type IS DISTINCT FROM 'assistant_dialog')
            OR (c.linked_booking_id IS NULL AND (c.linked_entity_type IS NULL OR c.linked_entity_type = 'assistant_dialog')
                AND CASE WHEN c.linked_entity_type = 'assistant_dialog' THEN c.linked_entity_id::text ELSE c.created_by::text END = $1::text
                AND (c.created_by IS NULL OR c.created_by = $1)))
          AND (
            (links.booking_id IS NULL AND links.entity_id IS NULL AND c.type IS DISTINCT FROM 'booking')
            OR ((links.booking_id IS NOT NULL OR links.entity_id IS NOT NULL)
                AND (links.booking_id IS NULL OR links.entity_id IS NULL OR links.booking_id = links.entity_id)
                AND EXISTS (SELECT 1 FROM bookings b WHERE b.id = COALESCE(links.booking_id, links.entity_id)
                    AND b.business_context = 'event_genix' ${visibility})))`, params);
    return new Set(result.rows.map(row => Number(row.id)));
}

// A path or a storage-key channel segment is never proof of file ownership.
// Both current blobs and historical local files need a live message reference.
async function canReadParkChatUpload(db, user, requestPath) {
    const key = normalizeChatUploadRequestPath(requestPath);
    if (!key || !canUseParkWorkModule(user, 'chat')) return false;
    const urls = [...new Set([publicChatUploadUrl(key), '/uploads/chat/' + key])];
    const blobs = await db.query('SELECT channel_id, message_id FROM chat_upload_blobs WHERE storage_key = $1 LIMIT 2', [key]);
    if (blobs.rows.length > 1) return false;
    const blob = blobs.rows[0];
    if (blob && (!positiveId(blob.message_id) || !positiveId(blob.channel_id))) return false;
    const result = blob
        ? await db.query(`SELECT channel_id, deleted_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) AS available
            FROM chat_messages WHERE id = $1 AND channel_id = $2`, [blob.message_id, blob.channel_id])
        : await db.query(`SELECT channel_id, deleted_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()) AS available
            FROM chat_messages
            WHERE split_part(split_part(metadata->'file'->>'url', '?', 1), '#', 1) = ANY($1::text[])
            ORDER BY id LIMIT 1`, [urls]);
    // Never let a later copied/forged reference transfer a historical file's ACL.
    const owner = result.rows[0];
    return owner?.available === true && canReadParkChatChannel(db, user, owner.channel_id);
}

function requireParkChatUpload(db, logger = null) {
    return async (req, res, next) => {
        try {
            const key = req.path.replace(/^\/+/, '');
            if (!await canReadParkChatUpload(db, req.user, key)) {
                return res.status(404).json({ error: 'chat_upload_not_found' });
            }
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
            return next();
        } catch {
            logger?.warn?.('Chat upload authorization unavailable');
            return res.status(503).json({ error: 'chat_upload_unavailable' });
        }
    };
}

function rejectNoncanonicalChatUploadPaths(req, res, next) {
    let decoded;
    try { decoded = decodeURIComponent(req.path); } catch { return res.status(404).end(); }
    const normalized = path.posix.normalize(decoded.replace(/\\/g, '/')).toLowerCase();
    if ((normalized === '/uploads/chat' || normalized.startsWith('/uploads/chat/'))
        && !/^\/uploads\/chat(?:\/|$)/i.test(req.path)) return res.status(404).end();
    return next();
}

function privateChatUploadHeaders(req, res, next) {
    if (/^\/(?:uploads\/chat|api\/(?:v1\/)?chat\/uploads)(?:\/|$)/i.test(req.path)) {
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.vary('Authorization');
        res.vary('X-Business-Context');
    }
    next();
}

module.exports = { positiveId, hasParkChatPrivateIdentity, canReadParkChatBooking, canReadParkChatChannel, loadReadableParkChatChannelIds,
    canReadParkChatUpload, requireParkChatUpload, rejectNoncanonicalChatUploadPaths,
    privateChatUploadHeaders, shapeChatBookingPreviews, projectParkChatResponse };
