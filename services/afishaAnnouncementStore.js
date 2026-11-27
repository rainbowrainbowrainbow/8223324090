'use strict';

const { readOperationalTelegramFeatures, telegramAnnouncementRecipient } = require('./operationalTelegramFeatures');
const { randomUUID } = require('node:crypto');
const { validateAnnouncementRecipient, announcementRuleActivation } = require('./afishaAnnouncementRecipient');
const { validateGoogleChatWebhook } = require('./afishaAnnouncementGoogleChat');
const { encryptSecret, decryptSecret } = require('./omni-accounts');
const { automaticAnnouncementSlots } = require('./afishaAnnouncementSchedule');
const { renderAutomaticAnnouncement } = require('./afishaAnnouncementDelivery');
const { prepareAfishaPublication, verifyAfishaPublication, fingerprintFor } = require('./afishaAnnouncementPublication');
const { currentLayout, readLayout, monthlySlotKey } = require('./afishaPublicationLayout');
const { listCrmAnnouncementChannels } = require('./afishaAnnouncementCrmChat');
const { listTelegramDirectory, telegramAddressKey } = require('./telegramDirectory');
const { DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');

const failure = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const date = milliseconds => new Date(milliseconds);

function recipientFromRow(row) {
    return {
        ...row.config, id: row.id, active: row.active, version: row.version,
        businessContext: row.business_context, destinationKey: row.destination_key,
        webhookCiphertext: row.webhook_ciphertext
    };
}

function publicRecipient(recipient, now) {
    const { webhookCiphertext, destinationKey, businessContext, monthlyEnabledAt, dailyEnabledAt, connectedBy, ...fields } = recipient;
    return {
        ...fields, webhookConfigured: Boolean(webhookCiphertext),
        nextAt: automaticAnnouncementSlots(recipient, now).upcoming[0]?.scheduledAt ?? null
    };
}

async function inTransaction(pool, work) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function listRecipients(db, business, lock = false) {
    const result = await db.query(
        'SELECT * FROM afisha_announcement_recipients WHERE business_context = $1 ORDER BY id' + (lock ? ' FOR UPDATE' : ''),
        [business]
    );
    return result.rows.map(recipientFromRow);
}

async function getRecipient(db, business, id, lock = false) {
    if (!/^[1-9]\d{0,17}$/.test(String(id))) throw failure(404, 'Групу не знайдено');
    const result = await db.query(
        'SELECT * FROM afisha_announcement_recipients WHERE business_context = $1 AND id = $2' + (lock ? ' FOR UPDATE' : ''),
        [business, id]
    );
    if (!result.rows[0]) throw failure(404, 'Групу не знайдено');
    return recipientFromRow(result.rows[0]);
}

async function saveRecipient(pool, business, id, input, now = new Date(), actor = null) {
    const config = validateAnnouncementRecipient(input);
    try {
        return await inTransaction(pool, async db => {
            const previous = id == null ? null : await getRecipient(db, business, id, true);
            if (previous && (input.version !== previous.version || previous.platform !== config.platform)) {
                throw failure(409, 'Налаштування групи змінилися. Оновіть список.');
            }
            let webhook = previous?.webhookCiphertext || null;
            let destinationKey = previous?.destinationKey;
            if (config.platform === 'google_chat') {
                if (input.webhook != null && input.webhook !== '') {
                    const validated = validateGoogleChatWebhook(input.webhook);
                    webhook = encryptSecret(validated.url);
                    destinationKey = validated.destinationKey;
                }
                if (!webhook) throw failure(400, 'Вкажіть вебхук Google Chat');
            } else if (config.platform === 'telegram') {
                destinationKey = 'telegram:' + config.chatId + ':' + (config.threadId ?? 'general');
                if (actor && (business !== DEFAULT_BUSINESS_CONTEXT || (destinationKey !== previous?.destinationKey
                    && !(await listTelegramDirectory(db)).some(entry => entry.key === telegramAddressKey(config.chatId, config.threadId))))) {
                    throw failure(400, 'Оберіть групу або тему з каталогу Telegram');
                }
            } else {
                destinationKey = 'crm_chat:' + config.channelId;
                if (previous && destinationKey !== previous.destinationKey) throw failure(400, 'Підключіть іншу групу окремо');
                const [channel] = await listCrmAnnouncementChannels(db, business, actor, config.channelId);
                if (!channel) throw failure(403, 'Група CRM недоступна');
                config.name = channel.name;
            }
            const active = previous ? config.active : false;
            const activation = announcementRuleActivation({ ...config, active, destinationKey }, previous, now);
            const { active: requested, ...stored } = config;
            const params = [business, destinationKey, {
                ...stored, ...activation, connectedBy: config.platform === 'crm_chat' ? actor.id : undefined
            }, webhook, active];
            const result = previous
                ? await db.query(`UPDATE afisha_announcement_recipients
                    SET destination_key = $2, config = $3, webhook_ciphertext = $4, active = $5, version = version + 1
                    WHERE business_context = $1 AND id = $6 RETURNING *`, [...params, id])
                : await db.query(`INSERT INTO afisha_announcement_recipients
                    (business_context, destination_key, config, webhook_ciphertext, active)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (business_context, destination_key) DO NOTHING RETURNING *`, params);
            const row = result.rows[0] || (await db.query(`SELECT * FROM afisha_announcement_recipients
                WHERE business_context = $1 AND destination_key = $2`, [business, destinationKey])).rows[0];
            return publicRecipient(recipientFromRow(row), now);
        });
    } catch (error) {
        if (error.code === '23505') throw failure(409, 'Ця група або тема вже є в розсилці');
        throw error;
    }
}

async function history(db, business, id) {
    const result = await db.query(`SELECT slot_key, kind, part_number, status, text, updated_at AS at, code AS detail, is_photo
        FROM afisha_announcement_parts WHERE business_context = $1 AND recipient_id = $2
        ORDER BY id DESC LIMIT 50`, [business, id]);
    return result.rows.map(row => ({ ...row, status: row.status === 'claimed' ? 'pending' : row.status }));
}

const DELIVERY_STATUS_SQL = `CASE WHEN bool_and(p.status = 'sent') THEN 'sent'
    WHEN bool_or(p.status = 'uncertain') THEN CASE WHEN bool_or(p.status = 'sent') THEN 'partial' ELSE 'uncertain' END
    WHEN bool_or(p.status = 'retry') THEN 'retry'
    WHEN bool_or(p.status IN ('pending', 'claimed')) THEN 'pending'
    WHEN bool_or(p.status = 'sent') THEN 'partial'
    WHEN bool_or(p.status = 'failed') THEN 'failed' ELSE 'skipped' END`;

async function publicationJournal(db, business, id) {
    const { rows } = await db.query(`SELECT p.slot_key, p.kind,
            ${DELIVERY_STATUS_SQL} AS status, MAX(p.updated_at) AS at,
            jsonb_agg(jsonb_build_object('text', p.text, 'status', p.status, 'detail', p.code, 'is_photo', p.is_photo)
                ORDER BY p.part_number) AS parts
        FROM afisha_announcement_parts p WHERE p.business_context = $1 AND p.recipient_id = $2
        GROUP BY p.slot_key, p.kind, p.destination_key ORDER BY MAX(p.id) DESC LIMIT 50`, [business, id]);
    return rows;
}

async function enqueueParts(db, recipient, slot, parts, { layout, fingerprint, publisherId } = {}) {
    if (!parts.length) return 0;
    const photo = !!layout && recipient.platform === 'telegram';
    const hasLayout = !!layout && (photo || recipient.platform === 'crm_chat');
    const texts = photo ? ['', ...parts] : parts;
    const result = await db.query(`INSERT INTO afisha_announcement_parts
        (recipient_id, business_context, destination_key, slot_key, kind, part_number, text, available_at, expires_at,
         layout_id, publication_fingerprint, publisher_id, is_photo)
        SELECT $1, $2, $3, $4, $5, value.ordinality::integer, value.text, $6, $7,
            CASE WHEN value.ordinality = 1 THEN $9::bigint END, $10, $11, ($12::boolean AND value.ordinality = 1)
        FROM unnest($8::text[]) WITH ORDINALITY AS value(text, ordinality)
        WHERE NOT EXISTS (SELECT 1 FROM afisha_announcement_parts
            WHERE business_context = $2 AND destination_key = $3 AND slot_key = $4)
        ON CONFLICT (business_context, destination_key, slot_key, part_number) DO NOTHING`,
    [recipient.id, recipient.businessContext, recipient.destinationKey, slot.key, slot.kind,
        date(slot.scheduledAt), date(slot.expiresAt), texts, hasLayout ? layout.id : null, fingerprint ?? null, publisherId ?? null, photo]);
    return result.rowCount;
}

async function manualRecipients(db, business, actor, recipients, features) {
    const [crmChannels, directory] = await Promise.all([listCrmAnnouncementChannels(db, business, actor),
        business === DEFAULT_BUSINESS_CONTEXT && features.afishaAnnouncements ? listTelegramDirectory(db) : []]);
    const channels = new Map(crmChannels.map(channel => [channel.id, channel.name]));
    const telegram = new Map(directory.map(entry => [entry.key, entry]));
    return recipients.flatMap(recipient => {
        if (recipient.platform === 'telegram' && business === DEFAULT_BUSINESS_CONTEXT && features.afishaAnnouncements) {
            const entry = telegram.get(telegramAddressKey(recipient.chatId, recipient.threadId));
            const title = entry?.chatTitle;
            const topic = recipient.threadId ? entry?.threadTitle || ('Тема ' + recipient.threadId) : 'Загальний чат';
            return [{ ...recipient, name: title ? title + ' · ' + topic : recipient.name }];
        }
        if (recipient.platform === 'crm_chat' && channels.has(recipient.channelId)) {
            return [{ ...recipient, name: channels.get(recipient.channelId) }];
        }
        return [];
    });
}

async function publicationHistory(db, business, recipient, preview) {
    const { rows } = await db.query(`SELECT slot_key, max(publication_fingerprint) AS fingerprint,
            bool_and(status = 'sent') AS sent, max(id) AS last_id
        FROM afisha_announcement_parts
        WHERE business_context = $1 AND destination_key = $2
          AND (slot_key = ANY($3::text[]) OR starts_with(slot_key, $4))
        GROUP BY slot_key ORDER BY last_id DESC`,
    [business, recipient.destinationKey, [preview.key, preview.publicationKey], preview.key + ':revision:']);
    return rows;
}

async function publicationState(db, business, recipients, preview) {
    return Promise.all(recipients.map(async recipient => {
        const previous = await publicationHistory(db, business, recipient, preview);
        return { id: String(recipient.id), sent: previous.some(row => row.sent),
            updated: !!previous[0]?.sent && !previous.some(row => row.fingerprint === preview.contentFingerprint),
            blocked: !!previous[0] && !previous[0].sent };
    }));
}

async function publishAnnouncement(pool, business, token, now = new Date(), options = {}) {
    return inTransaction(pool, async db => {
        const recipients = await listRecipients(db, business, true);
        const features = await readOperationalTelegramFeatures(db);
        const manual = options.recipientIds !== undefined;
        const eligible = manual ? await manualRecipients(db, business, options.actor, recipients, features)
            : recipients.map(recipient => telegramAnnouncementRecipient(recipient, features));
        const preview = await verifyAfishaPublication(db, {
            business, token, recipients: eligible, recipientIds: options.recipientIds,
            publisherId: options.actor?.id, resend: options.resend
        });
        const ids = new Set(preview.recipients.map(recipient => recipient.id));
        const slot = { kind: 'publication', key: preview.key, scheduledAt: now.getTime(), expiresAt: now.getTime() + 86_400_000 };
        let queued = 0;
        for (const recipient of recipients.filter(item => ids.has(String(item.id)))) {
            if (manual) {
                const previous = await publicationHistory(db, business, recipient, preview);
                if (previous.length && (!options.resend || !previous[0].sent
                    || previous.some(row => row.fingerprint === preview.contentFingerprint))) continue;
                const key = previous.length ? preview.key + ':revision:' + preview.contentFingerprint : preview.key;
                queued += await enqueueParts(db, recipient, { ...slot, key }, preview.parts, {
                    layout: preview.layout, fingerprint: preview.contentFingerprint, publisherId: options.actor.id
                });
                continue;
            }
            const [, from, to] = preview.key.split(':');
            const month = monthlySlotKey(from, to);
            if (month && recipient.platform === 'telegram'
                && (await publicationHistory(db, business, recipient, { ...preview, key: month })).length) continue;
            await db.query(`DELETE FROM afisha_announcement_parts
                WHERE business_context = $1 AND destination_key = $2 AND slot_key = $3
                  AND status = 'skipped' AND code = 'publication_changed'`,
            [business, recipient.destinationKey, slot.key]);
            queued += await enqueueParts(db, recipient, slot, preview.parts);
        }
        return { queued };
    }).catch(error => {
        if (error.code === '40001') throw failure(409, 'Налаштування розсилки змінилися. Оновіть перегляд.');
        throw error;
    });
}

async function enqueueAutomaticAnnouncements(pool, now = new Date()) {
    const features = await readOperationalTelegramFeatures(pool);
    const result = await pool.query('SELECT * FROM afisha_announcement_recipients WHERE active ORDER BY id');
    for (const row of result.rows) {
        const candidate = telegramAnnouncementRecipient(recipientFromRow(row), features);
        if (!automaticAnnouncementSlots(candidate, now).due.length) continue;
        await inTransaction(pool, async db => {
            const current = await getRecipient(db, candidate.businessContext, candidate.id, true);
            const recipient = telegramAnnouncementRecipient(current, await readOperationalTelegramFeatures(db));
            for (const slot of automaticAnnouncementSlots(recipient, now).due) {
                const publicationKey = 'publication:' + slot.from + ':' + slot.to;
                const hasMonthlyLayout = slot.kind === 'monthly' && recipient.platform !== 'google_chat';
                const previous = await db.query(`SELECT 1 FROM afisha_announcement_parts
                    WHERE business_context = $1 AND destination_key = $2 AND slot_key = ANY($3::text[])
                    LIMIT 1`, [recipient.businessContext, recipient.destinationKey,
                    hasMonthlyLayout ? [slot.key, publicationKey] : [slot.key]]);
                if (previous.rowCount) continue;
                const parts = await renderAutomaticAnnouncement(db, recipient, slot);
                const layout = hasMonthlyLayout ? await currentLayout(db, recipient.businessContext, slot.from, slot.to) : null;
                await enqueueParts(db, recipient, slot, parts, {
                    layout, fingerprint: hasMonthlyLayout ? fingerprintFor(parts, layout) : null,
                    publisherId: recipient.platform === 'crm_chat' ? recipient.connectedBy : null
                });
            }
        });
    }
}

async function refreshUnsentAutomaticParts(db, part, recipient, time) {
    const params = [part.business_context, part.destination_key, part.slot_key];
    const { due, upcoming } = automaticAnnouncementSlots(recipient, date(time));
    const slot = due.find(item => item.key === part.slot_key);
    if (!slot) {
        const future = upcoming.find(item => item.key === part.slot_key);
        if (future) {
            await db.query(`UPDATE afisha_announcement_parts
                SET status = 'pending', attempt = 0, lease = NULL, lease_expires_at = NULL, available_at = $4
                WHERE business_context = $1 AND destination_key = $2 AND slot_key = $3
                  AND status IN ('pending', 'claimed')`, [...params, date(future.scheduledAt)]);
        } else {
            await db.query(`UPDATE afisha_announcement_parts
                SET status = 'skipped', code = 'delivery_unavailable', lease = NULL, lease_expires_at = NULL, updated_at = $4
                WHERE business_context = $1 AND destination_key = $2 AND slot_key = $3
                  AND status IN ('pending', 'claimed')`, [...params, date(time)]);
        }
        return null;
    }

    const texts = await renderAutomaticAnnouncement(db, recipient, slot);
    if (!texts.length) {
        await db.query(`UPDATE afisha_announcement_parts
            SET status = 'skipped', code = 'announcement_empty', lease = NULL, lease_expires_at = NULL, updated_at = $4
            WHERE business_context = $1 AND destination_key = $2 AND slot_key = $3
              AND status IN ('pending', 'claimed')`, [...params, date(time)]);
        return null;
    }
    await db.query('UPDATE afisha_announcement_parts SET text = $2 WHERE id = $1', [part.id, texts[0]]);
    // The first part is still claimed, so no subsequent part is eligible.
    // Replace only generated, never-dispatched tail rows with the refreshed copy.
    await db.query(`DELETE FROM afisha_announcement_parts
        WHERE business_context = $1 AND destination_key = $2 AND slot_key = $3
          AND part_number > 1 AND status = 'pending' AND attempt = 0`, params);
    if (texts.length > 1) {
        await db.query(`INSERT INTO afisha_announcement_parts
            (recipient_id, business_context, destination_key, slot_key, kind, part_number, text, available_at, expires_at, publisher_id)
            SELECT $4, $1, $2, $3, $5, value.ordinality::integer + 1, value.text, $6, $7, $9
            FROM unnest($8::text[]) WITH ORDINALITY AS value(text, ordinality)`,
        [...params, recipient.id, slot.kind, date(slot.scheduledAt), date(slot.expiresAt), texts.slice(1), part.publisher_id]);
    }
    return texts[0];
}

async function verifyUnsentPublication(db, part, time) {
    const [, from, to] = part.slot_key.split(':');
    const preview = await prepareAfishaPublication(db, { business: part.business_context, from, to, recipients: [] });
    const slot = [part.business_context, part.destination_key, part.slot_key];
    const saved = await db.query(`SELECT text FROM afisha_announcement_parts
        WHERE business_context = $1 AND destination_key = $2 AND slot_key = $3 ORDER BY part_number`, slot);
    if (saved.rows.length === preview.parts.length && saved.rows.every((row, index) => row.text === preview.parts[index])) {
        return part.text;
    }
    await db.query(`UPDATE afisha_announcement_parts
        SET status = 'skipped', code = 'publication_changed', lease = NULL, lease_expires_at = NULL, updated_at = $4
        WHERE business_context = $1 AND destination_key = $2 AND slot_key = $3
          AND status IN ('pending', 'claimed')`, [...slot, date(time)]);
    return null;
}

function createDeliveryStore(db) {
    return {
        async claimNextPart(now) {
            const features = await readOperationalTelegramFeatures(db);
            await db.query(`UPDATE afisha_announcement_parts SET status = 'uncertain', code = 'lease_expired',
                lease = NULL, lease_expires_at = NULL, updated_at = $1
                WHERE status = 'claimed' AND lease_expires_at <= $1`, [date(now)]);
            await db.query(`UPDATE afisha_announcement_parts AS p
                SET status = 'skipped', code = 'delivery_unavailable', updated_at = $1
                FROM afisha_announcement_recipients AS r
                WHERE r.id = p.recipient_id AND p.status IN ('pending', 'retry')
                  AND (p.expires_at <= $1 OR (NOT r.active AND NOT (p.kind = 'publication' AND p.publisher_id IS NOT NULL)) OR r.destination_key <> p.destination_key
                  OR (r.config->>'platform' = 'telegram' AND NOT $2::boolean)
                  OR (p.kind = 'publication' AND p.publisher_id IS NULL AND r.config->>'afishaMode' <> 'publication')
                  OR (p.kind = 'monthly' AND r.config->>'afishaMode' <> 'monthly')
                  OR (p.kind = 'daily' AND NOT ((r.config->>'eventsToday')::boolean OR (r.config->>'promotionsToday')::boolean))
                  OR EXISTS (SELECT 1 FROM afisha_announcement_parts AS earlier
                    WHERE earlier.business_context = p.business_context AND earlier.destination_key = p.destination_key
                      AND earlier.slot_key = p.slot_key AND earlier.part_number < p.part_number
                      AND earlier.status IN ('failed', 'uncertain', 'skipped')))`, [date(now), features.afishaAnnouncements]);
            return inTransaction(db, async client => {
                const lease = randomUUID();
                const result = await client.query(`WITH next AS (
                    SELECT p.id, r.config, r.webhook_ciphertext FROM afisha_announcement_parts AS p
                    JOIN afisha_announcement_recipients AS r
                      ON r.id = p.recipient_id AND r.destination_key = p.destination_key
                        AND (r.active OR (p.kind = 'publication' AND p.publisher_id IS NOT NULL))
                    WHERE p.status IN ('pending', 'retry') AND p.available_at <= $1 AND p.expires_at > $1
                      AND ($3::boolean OR r.config->>'platform' <> 'telegram')
                      AND (p.kind <> 'publication' OR p.publisher_id IS NOT NULL OR r.config->>'afishaMode' = 'publication')
                      AND (p.kind <> 'monthly' OR r.config->>'afishaMode' = 'monthly')
                      AND (p.kind <> 'daily' OR (r.config->>'eventsToday')::boolean OR (r.config->>'promotionsToday')::boolean)
                      AND NOT EXISTS (SELECT 1 FROM afisha_announcement_parts AS earlier
                        WHERE earlier.business_context = p.business_context AND earlier.destination_key = p.destination_key
                        AND earlier.slot_key = p.slot_key AND earlier.part_number < p.part_number AND earlier.status <> 'sent')
                    ORDER BY p.available_at, p.id
                    FOR UPDATE OF p, r SKIP LOCKED LIMIT 1
                )
                UPDATE afisha_announcement_parts AS p SET status = 'claimed', attempt = attempt + 1,
                    lease = $2, lease_expires_at = $1::timestamptz + INTERVAL '1 minute', updated_at = $1
                FROM next WHERE p.id = next.id
                RETURNING p.id, p.business_context, p.lease, p.attempt, p.expires_at, p.text,
                    p.recipient_id, p.destination_key, p.slot_key, p.kind, p.part_number, p.layout_id,
                    p.publication_fingerprint, p.publisher_id, p.is_photo, next.config, next.webhook_ciphertext`, [date(now), lease, features.afishaAnnouncements]);
                const part = result.rows[0];
                if (!part) return null;
                const recipient = telegramAnnouncementRecipient({
                    ...part.config, id: part.recipient_id, active: true, businessContext: part.business_context,
                    webhook: part.webhook_ciphertext ? decryptSecret(part.webhook_ciphertext) : null
                }, features);
                let text = part.text;
                if ((part.kind === 'daily' || (!part.publication_fingerprint && !part.publisher_id))
                    && part.part_number === 1 && part.attempt === 1) {
                    text = part.kind === 'publication'
                        ? await verifyUnsentPublication(client, part, now)
                        : await refreshUnsentAutomaticParts(client, part, recipient, now);
                }
                if (text === null) return null;
                const layout = part.layout_id ? await readLayout(client, part.business_context, part.layout_id) : null;
                return { id: part.id, lease: part.lease, attempt: part.attempt, text, expiresAt: part.expires_at.getTime(),
                    recipient, layout, isPhoto: part.is_photo, publisherId: part.publisher_id };
            });
        },
        async finishPart(id, lease, update) {
            await db.query(`UPDATE afisha_announcement_parts SET status = $3, code = $4, message_id = $5,
                available_at = COALESCE($6, available_at), lease = NULL, lease_expires_at = NULL, updated_at = NOW()
                WHERE id = $1 AND lease = $2 AND status = 'claimed'`,
            [id, lease, update.status, update.code ?? null, update.messageId ?? null,
                update.availableAt == null ? null : date(update.availableAt)]);
        }
    };
}

module.exports = {
    listRecipients, getRecipient, publicRecipient, saveRecipient, history, publicationJournal, DELIVERY_STATUS_SQL,
    publishAnnouncement, enqueueAutomaticAnnouncements, createDeliveryStore, manualRecipients, publicationState
};
