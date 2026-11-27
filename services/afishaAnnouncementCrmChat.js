'use strict';

const { DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');
const { canUseParkWorkModule, loadParkWorkParticipants } = require('./parkWorkModuleAccess');
const { resolveCapability } = require('./accountAccessPolicy');

// The existing messenger is owned by the Park business. Only ordinary
// team channels are eligible, using the same active membership as the chat UI.
async function listCrmAnnouncementChannels(db, business, actor, channelId = null, lock = false) {
    if (business !== DEFAULT_BUSINESS_CONTEXT || !canUseParkWorkModule(actor, 'chat')) return [];
    const { rows } = await db.query(`SELECT c.id, c.name FROM chat_channels c
        JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = $1
        WHERE COALESCE(c.is_dm, false) = false AND COALESCE(c.is_archived, false) = false
          AND COALESCE(c.type, 'general') IN ('general', 'group')
          AND c.linked_booking_id IS NULL AND c.linked_entity_type IS NULL
          AND ($2::integer IS NULL OR c.id = $2)
        ORDER BY c.name, c.id${lock ? ' FOR UPDATE OF c FOR SHARE OF m' : ''}`, [actor.id, channelId]);
    return rows;
}

async function deliverCrmAnnouncement(db, recipient, text, { layout, publisherId }) {
    const { sendFileMessageWithUpload } = require('./chatService');
    const { broadcastToChannel } = require('./websocket');
    const denied = () => Object.assign(new Error('CRM channel unavailable'), { code: 'crm_channel_unavailable' });
    if (!Number.isInteger(publisherId) || publisherId <= 0) return { status: 'failed', code: 'crm_channel_unavailable' };
    const file = layout ? {
        originalname: layout.content_type === 'image/png' ? 'afisha.png' : 'afisha.jpg',
        mimetype: layout.content_type, size: layout.content.length, buffer: layout.content
    } : null;
    try {
        const result = await sendFileMessageWithUpload(recipient.channelId, publisherId, text, file ? 'image' : 'text', file ? {
            file: { name: file.originalname, size: file.size, type: 'image' }
        } : null, { file }, {
            database: db,
            authorize: async client => {
                const actors = await loadParkWorkParticipants(client, 'chat', [publisherId]);
                const actor = actors.get(publisherId);
                if (!actor || !resolveCapability(actor, 'manage_settings', { type: 'action' }).allowed
                    || !(await listCrmAnnouncementChannels(client, recipient.businessContext, actor, recipient.channelId, true)).length) {
                    throw denied();
                }
            }
        });
        void broadcastToChannel(recipient.channelId, 'chat:message', {
            channelId: recipient.channelId, message: result.message
        }, String(publisherId)).catch(() => {});
        return { status: 'sent', messageId: result.message.id };
    } catch (error) {
        if (error.code === 'crm_channel_unavailable') return { status: 'failed', code: error.code };
        throw error;
    }
}

module.exports = { listCrmAnnouncementChannels, deliverCrmAnnouncement };
