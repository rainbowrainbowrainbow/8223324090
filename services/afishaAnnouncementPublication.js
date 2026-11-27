'use strict';

const { createHash } = require('node:crypto');
const { loadAnnouncementItems, formatAnnouncement } = require('./afishaAnnouncementContent');

const TOKEN_PATTERN = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2}):[a-f0-9]{64}$/;
const stalePreview = () => Object.assign(new Error('Афіша або отримувачі змінилися. Оновіть перегляд.'), { statusCode: 409 });

async function prepareAfishaPublication(pool, { business, from, to, recipients }) {
    const items = await loadAnnouncementItems(pool, business, from, to);
    const title = 'Афіша та акції · ' + (from === to ? from : from + ' — ' + to);
    const parts = formatAnnouncement(title, items);
    const targets = recipients
        .filter(recipient => recipient.active && recipient.afishaMode === 'publication')
        .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'))
        .map(recipient => ({
            id: String(recipient.id),
            name: recipient.name,
            platform: recipient.platform,
            destinationKey: recipient.destinationKey,
            version: recipient.version
        }));
    const fingerprint = createHash('sha256').update(JSON.stringify([business, from, to, targets, parts])).digest('hex');

    return {
        // This is an optimistic concurrency check, never authentication.
        // The publishing endpoint must rebuild it using authorized live data.
        previewToken: parts.length && targets.length ? from + ':' + to + ':' + fingerprint : null,
        recipients: targets.map(({ id, name, platform }) => ({ id, name, platform })),
        parts,
        key: 'publication:' + from + ':' + to
    };
}

async function verifyAfishaPublication(pool, { business, token, recipients }) {
    const match = typeof token === 'string' && TOKEN_PATTERN.exec(token);
    if (!match) throw stalePreview();
    const [, from, to] = match;
    const preview = await prepareAfishaPublication(pool, { business, from, to, recipients });
    if (preview.previewToken !== token) throw stalePreview();
    return preview;
}

module.exports = { prepareAfishaPublication, verifyAfishaPublication };
