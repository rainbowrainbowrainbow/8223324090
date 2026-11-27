'use strict';

const { createHash } = require('node:crypto');
const { loadAnnouncementItems, formatAnnouncement } = require('./afishaAnnouncementContent');
const { currentLayout, monthlySlotKey } = require('./afishaPublicationLayout');

const TOKEN_PATTERN = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2}):[a-f0-9]{64}$/;
const stalePreview = () => Object.assign(new Error('Афіша або отримувачі змінилися. Оновіть перегляд.'), { statusCode: 409 });

const fingerprintFor = (parts, layout) => createHash('sha256').update(JSON.stringify([parts, layout?.checksum ?? null])).digest('hex');

async function prepareAfishaPublication(pool, { business, from, to, recipients, recipientIds, resend = false, publisherId }) {
    const items = await loadAnnouncementItems(pool, business, from, to);
    const title = 'Афіша та акції · ' + (from === to ? from : from + ' — ' + to);
    const parts = formatAnnouncement(title, items);
    const selected = recipientIds === undefined ? null : new Set(recipientIds);
    const targets = recipients
        .filter(recipient => selected ? selected.has(String(recipient.id))
            : recipient.platform !== 'crm_chat' && recipient.active && recipient.afishaMode === 'publication')
        .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'))
        .map(recipient => ({
            id: String(recipient.id),
            name: recipient.name,
            platform: recipient.platform,
            destinationKey: recipient.destinationKey,
            version: recipient.version
        }));
    if (selected && targets.length !== selected.size) throw stalePreview();
    const layout = selected ? await currentLayout(pool, business, from, to) : null;
    const contentFingerprint = fingerprintFor(parts, layout);
    const fingerprint = createHash('sha256').update(JSON.stringify([business, from, to, targets,
        contentFingerprint, layout?.id, resend, publisherId])).digest('hex');
    const publicationKey = 'publication:' + from + ':' + to;

    return {
        // This is an optimistic concurrency check, never authentication.
        // The publishing endpoint must rebuild it using authorized live data.
        previewToken: parts.length && targets.length ? from + ':' + to + ':' + fingerprint : null,
        recipients: targets.map(({ id, name, platform }) => ({ id, name, platform })),
        parts,
        key: selected ? monthlySlotKey(from, to) || publicationKey : publicationKey,
        publicationKey,
        layout,
        contentFingerprint
    };
}

async function verifyAfishaPublication(pool, { token, ...options }) {
    const match = typeof token === 'string' && TOKEN_PATTERN.exec(token);
    if (!match) throw stalePreview();
    const [, from, to] = match;
    const preview = await prepareAfishaPublication(pool, { ...options, from, to });
    if (preview.previewToken !== token) throw stalePreview();
    return preview;
}

module.exports = { prepareAfishaPublication, verifyAfishaPublication, fingerprintFor };
