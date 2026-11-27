'use strict';

const { validateDate } = require('./booking');
const { shouldTemplateRunOnDate } = require('./afishaRecurrence');
const { listPromotions } = require('./timelinePromotions');

const MAX_RANGE_DAYS = 31;
const PART_LIMIT = 3500;
const PUBLIC_EVENT_TYPES = new Set(['event', 'regular']);

function datesInRange(from, to) {
    if (!validateDate(from) || !validateDate(to) || from > to) {
        throw Object.assign(new Error('Оберіть коректний період'), { statusCode: 400 });
    }
    const dates = [];
    for (const day = new Date(from + 'T12:00:00Z'); day.toISOString().slice(0, 10) <= to; day.setUTCDate(day.getUTCDate() + 1)) {
        if (dates.length === MAX_RANGE_DAYS) {
            throw Object.assign(new Error('Виберіть період до 31 дня'), { statusCode: 400 });
        }
        dates.push(day.toISOString().slice(0, 10));
    }
    return dates;
}

async function loadAnnouncementItems(pool, business, from, to, { events = true, promotions = true, startsOnly = false } = {}) {
    const dates = datesInRange(from, to);
    const readAfisha = events && business === 'event_genix';
    const stored = readAfisha
        ? await pool.query('SELECT id, date, time, title, description, type, template_id, promotion_id FROM afisha WHERE date BETWEEN $1 AND $2', [from, to])
        : { rows: [] };
    const templates = readAfisha
        ? await pool.query('SELECT id, time, title, description, type, recurrence_pattern, recurrence_days, date_from, date_to FROM afisha_templates WHERE is_active')
        : { rows: [] };
    const activePromotions = promotions ? await listPromotions(pool, business, from, to) : [];
    const materialized = new Set(stored.rows.filter(row => row.template_id).map(row => row.template_id + ':' + row.date));
    const projected = dates.flatMap(date => templates.rows
        .filter(template => PUBLIC_EVENT_TYPES.has(template.type) && !materialized.has(template.id + ':' + date) && shouldTemplateRunOnDate(template, date))
        .map(template => ({ ...template, id: 'template-' + template.id + '-' + date, date })));
    const afisha = [...stored.rows.filter(row => PUBLIC_EVENT_TYPES.has(row.type)), ...projected]
        .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
            || a.title.localeCompare(b.title, 'uk') || String(a.id).localeCompare(String(b.id), 'en'));
    return { afisha, promotions: activePromotions.filter(promotion => !startsOnly || promotion.starts_on >= from) };
}

function formatAnnouncement(title, { afisha, promotions }) {
    const promotionIds = new Set(promotions.map(promotion => String(promotion.id)));
    const linked = Map.groupBy(afisha.filter(event => promotionIds.has(String(event.promotion_id))), event => String(event.promotion_id));
    const formatEvent = event => [
        event.date + ' о ' + event.time.slice(0, 5) + ' — ' + event.title,
        event.description?.trim()
    ].filter(Boolean).join('\n');

    const sections = [
        ...promotions.map(promotion => [
            'Акція · ' + promotion.title,
            promotion.starts_on === promotion.ends_on ? promotion.starts_on : promotion.starts_on + ' — ' + promotion.ends_on,
            promotion.description?.trim(),
            ...(linked.get(String(promotion.id)) || []).map(formatEvent)
        ].filter(Boolean).join('\n')),
        ...afisha.filter(event => !promotionIds.has(String(event.promotion_id))).map(formatEvent)
    ];
    const parts = [];
    // Split by code point when a single section exceeds the platform budget.
    // Reserve room for the title on every part.
    const budget = PART_LIMIT - title.length - 2;
    let body = '';
    for (const section of sections) {
        const padding = body ? '\n\n' : '';
        if (body && body.length + padding.length + section.length > budget) {
            parts.push(title + '\n\n' + body);
            body = '';
        }
        if (section.length <= budget) {
            body += (body ? '\n\n' : '') + section;
            continue;
        }
        for (const character of section) {
            if (body.length + character.length > budget) {
                parts.push(title + '\n\n' + body);
                body = '';
            }
            body += character;
        }
    }
    if (body) parts.push(title + '\n\n' + body);
    return parts;
}

module.exports = { loadAnnouncementItems, formatAnnouncement };
