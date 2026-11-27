'use strict';

const { formatAnnouncement, loadAnnouncementItems } = require('./afishaAnnouncementContent');
const { deliverTelegramAnnouncement } = require('./afishaAnnouncementTelegram');

const RETRY_DELAY_SECONDS = [30, 120, 480];

async function renderAutomaticAnnouncement(pool, recipient, slot) {
    const daily = slot.kind === 'daily';
    const items = await loadAnnouncementItems(pool, recipient.businessContext, slot.from, slot.to, daily
        ? { events: recipient.eventsToday, promotions: recipient.promotionsToday, startsOnly: true }
        : undefined);
    const title = daily
        ? 'Події та акції дня · ' + slot.from
        : 'Афіша та акції · ' + slot.from + ' — ' + slot.to;
    return formatAnnouncement(title, items);
}

function deliveryUpdate(part, outcome, now) {
    if (outcome.status === 'sent') {
        return { status: 'sent', messageId: outcome.messageId ?? null };
    }
    if (outcome.status === 'retry') {
        const delay = RETRY_DELAY_SECONDS[part.attempt - 1];
        const providerDelay = Number.isSafeInteger(outcome.retryAfterSeconds) ? outcome.retryAfterSeconds : 0;
        const availableAt = now + Math.max(delay ?? 0, providerDelay) * 1_000;
        return delay && availableAt < part.expiresAt
            ? { status: 'retry', code: outcome.code, availableAt }
            : { status: 'failed', code: outcome.code };
    }
    if (outcome.status === 'failed') return { status: 'failed', code: outcome.code };
    return { status: 'uncertain', code: outcome.code ?? 'delivery_unconfirmed' };
}

async function runAfishaDeliveryBatch({
    store, transports = { telegram: deliverTelegramAnnouncement }, now = Date.now, limit = 5
}) {
    let processed = 0;
    while (processed < limit) {
        // The store claims a single due part atomically and excludes subsequent
        // parts until their predecessors were confirmed sent.
        const part = await store.claimNextPart(now());
        if (!part) break;
        if (now() >= part.expiresAt) {
            await store.finishPart(part.id, part.lease, { status: 'skipped', code: 'delivery_expired' });
            processed++;
            continue;
        }
        const transport = Object.hasOwn(transports, part.recipient.platform) ? transports[part.recipient.platform] : null;
        let outcome = { status: 'failed', code: 'transport_unavailable' };
        if (transport) {
            try {
                outcome = await transport(part.recipient, part.text);
            } catch {
                outcome = { status: 'uncertain', code: 'delivery_unconfirmed' };
            }
        }
        // The lease identifies the claim. If saving fails after a provider
        // call, its expiry must only reconcile to an uncertain outcome.
        await store.finishPart(part.id, part.lease, deliveryUpdate(part, outcome, now()));
        processed++;
    }
    return processed;
}

module.exports = { renderAutomaticAnnouncement, runAfishaDeliveryBatch };
