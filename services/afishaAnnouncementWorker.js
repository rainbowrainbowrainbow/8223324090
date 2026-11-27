'use strict';

const { pool } = require('../db');
const { createDeliveryStore, enqueueAutomaticAnnouncements } = require('./afishaAnnouncementStore');
const { runAfishaDeliveryBatch } = require('./afishaAnnouncementDelivery');
const { deliverTelegramAnnouncement } = require('./afishaAnnouncementTelegram');
const { deliverGoogleChatAnnouncement } = require('./afishaAnnouncementGoogleChat');
const { deliverCrmAnnouncement } = require('./afishaAnnouncementCrmChat');

async function checkAfishaAnnouncements({
    database = pool, now = () => new Date(),
    transports = {
        telegram: deliverTelegramAnnouncement,
        google_chat: (recipient, text) => deliverGoogleChatAnnouncement(recipient, text),
        crm_chat: (recipient, text, part) => deliverCrmAnnouncement(database, recipient, text, part)
    }
} = {}) {
    await enqueueAutomaticAnnouncements(database, now());
    return runAfishaDeliveryBatch({ store: createDeliveryStore(database), transports, now: () => now().getTime() });
}

module.exports = { checkAfishaAnnouncements };
