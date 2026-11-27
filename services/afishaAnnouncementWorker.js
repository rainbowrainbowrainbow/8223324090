'use strict';

const { pool } = require('../db');
const { createDeliveryStore, enqueueAutomaticAnnouncements } = require('./afishaAnnouncementStore');
const { runAfishaDeliveryBatch } = require('./afishaAnnouncementDelivery');
const { deliverTelegramAnnouncement } = require('./afishaAnnouncementTelegram');
const { deliverGoogleChatAnnouncement } = require('./afishaAnnouncementGoogleChat');

async function checkAfishaAnnouncements({
    database = pool, now = () => new Date(),
    transports = { telegram: deliverTelegramAnnouncement, google_chat: deliverGoogleChatAnnouncement }
} = {}) {
    await enqueueAutomaticAnnouncements(database, now());
    return runAfishaDeliveryBatch({ store: createDeliveryStore(database), transports, now: () => now().getTime() });
}

module.exports = { checkAfishaAnnouncements };
