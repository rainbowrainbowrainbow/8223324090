'use strict';

const { validateDate } = require('./booking');
const { createHash } = require('node:crypto');
const { validateChatUploadFile } = require('./chatUploadStorage');

const MAX_LAYOUT_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;
const invalid = message => Object.assign(new Error(message), { statusCode: 400 });

function validatePeriod(from, to) {
    if (!validateDate(from) || !validateDate(to) || from > to || Date.parse(to) - Date.parse(from) > 30 * 86_400_000) {
        throw invalid('Виберіть період від 1 до 31 дня.');
    }
}

function monthlySlotKey(from, to) {
    if (!from.endsWith('-01')) return null;
    const end = new Date(from + 'T12:00:00Z');
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    return end.toISOString().slice(0, 10) === to ? 'monthly:' + from : null;
}

async function currentLayout(db, business, from, to) {
    validatePeriod(from, to);
    const { rows } = await db.query(`SELECT id, checksum, content_type FROM afisha_publication_layouts
        WHERE business_context = $1 AND date_from = $2 AND date_to = $3 ORDER BY id DESC LIMIT 1`, [business, from, to]);
    return rows[0] || null;
}

async function readLayout(db, business, id) {
    const { rows } = await db.query('SELECT content, content_type FROM afisha_publication_layouts WHERE business_context = $1 AND id = $2', [business, id]);
    return rows[0] || null;
}

async function saveLayout(db, business, from, to, file) {
    validatePeriod(from, to);
    if (!file?.size || file.size > MAX_LAYOUT_BYTES) throw invalid('Виберіть PNG або JPG розміром до 5 МБ.');
    let policy;
    try {
        policy = validateChatUploadFile(file);
        const expected = { 'image/png': 'png', 'image/jpeg': 'jpeg' }[policy.contentType];
        if (!expected) throw new Error('format');
        const image = require('sharp')(file.buffer, { limitInputPixels: MAX_PIXELS, failOn: 'warning' });
        const { format, width, height, pages } = await image.metadata();
        if (format !== expected || (pages || 1) !== 1 || width + height > 10000 || Math.max(width, height) > 20 * Math.min(width, height)) {
            throw new Error('dimensions');
        }
        await image.stats();
    } catch {
        throw invalid('Виберіть справний PNG або JPG з допустимими розмірами.');
    }
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const current = await currentLayout(db, business, from, to);
    if (current?.checksum === checksum) return current;
    const { rows } = await db.query(`INSERT INTO afisha_publication_layouts
        (business_context, date_from, date_to, content_type, content, checksum) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, checksum, content_type`, [business, from, to, policy.contentType, file.buffer, checksum]);
    return rows[0];
}

module.exports = { MAX_LAYOUT_BYTES, validatePeriod, monthlySlotKey, currentLayout, readLayout, saveLayout };
