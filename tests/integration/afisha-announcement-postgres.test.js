'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createFixture } = require('../helpers/timeline-marketing-fixture');

const prefix = '/api/afisha/announcements';

test('Afisha API, durable scheduling and both transports on disposable PostgreSQL', async t => {
    const fixture = await createFixture({ announcements: true });
    t.after(() => fixture.close());
    const { pool, request } = fixture;
    const { checkAfishaAnnouncements } = require('../../services/afishaAnnouncementWorker');
    const { deliverTelegramAnnouncement } = require('../../services/afishaAnnouncementTelegram');
    const { deliverGoogleChatAnnouncement } = require('../../services/afishaAnnouncementGoogleChat');
    const { createDeliveryStore } = require('../../services/afishaAnnouncementStore');
    const base = {
        name: 'Team', platform: 'telegram', active: true, afishaMode: 'publication',
        monthlyTime: '09:00', dailyTime: '08:00', eventsToday: false, promotionsToday: false
    };
    const fakeWebhook = 'https://chat.googleapis.com/v1/spaces/fixture/messages?key=test&token=test';
    const target = path => prefix + path + '?businessContext=event_genix';
    await pool.query(`INSERT INTO telegram_known_chats VALUES
        (-100111, 'General', 'group'), (-100222, 'Topic group', 'supergroup'), (123, 'Private', 'private'),
        (-100333, 'Daily', 'group'), (-100444, 'Monthly', 'group'), (-100555, 'Promotions', 'group')`);
    await pool.query("INSERT INTO telegram_known_threads VALUES (-100222, 22, 'Planning')");
    const add = async input => {
        const result = await request('POST', target('/recipients'), input);
        assert.equal(result.status, 201, JSON.stringify(result.body));
        assert.equal(result.body.recipient.active, false);
        const { id, version } = result.body.recipient;
        const enabled = await request('PUT', target('/recipients/' + id), { ...input, version });
        assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
        assert.equal(enabled.body.recipient.active, true);
        return enabled.body.recipient;
    };

    const one = await add({ ...base, name: 'General', chatId: '-100111', threadId: null });
    const two = await add({ ...base, name: 'Topic', chatId: '-100222', threadId: '22' });
    const three = await add({ ...base, name: 'Google', platform: 'google_chat', webhook: fakeWebhook });
    assert.equal(three.webhookConfigured, true);
    assert.equal(JSON.stringify(three).includes('token='), false);
    const saved = await pool.query('SELECT webhook_ciphertext FROM afisha_announcement_recipients WHERE id = $1', [three.id]);
    assert.ok(saved.rows[0].webhook_ciphertext.startsWith('egx:v1:'));
    assert.ok(!saved.rows[0].webhook_ciphertext.includes('chat.googleapis.com'));
    assert.equal((await request('POST', target('/recipients'), { ...base, chatId: '-100111' })).body.recipient.id, one.id);
    assert.equal((await request('GET', prefix + '/recipients?businessContext=dar')).body.recipients.length, 0);
    assert.equal((await request('GET', target('/recipients'), null, { 'x-fixture-role': 'denied' })).status, 403);

    await pool.query(`INSERT INTO settings (key, value) VALUES
        ('telegram_animator_chat_id', '-100222'), ('telegram_animator_thread_id', '22'),
        ('telegram_chat_id', '-100111'), ('telegram_thread_id', '33'),
        ('digest_time', '09:00'), ('digest_time_weekend', '10:00'), ('reminder_time', '20:00')`);
    const routes = await request('GET', target('/recipients'));
    assert.equal(routes.status, 200);
    assert.deepEqual(routes.body.routingPreview, [
        { feature: 'approval', botProfile: 'operational', chatId: '-100222', threadId: '22', matchingRecipient: 'Topic' },
        { feature: 'digest', botProfile: 'legacy_notifications', chatId: '-100111', threadId: '33', weekday: '09:00', weekend: '10:00' },
        { feature: 'reminder', botProfile: 'legacy_notifications', chatId: '-100111', threadId: '33', time: '20:00' }
    ]);
    assert.equal((await request('GET', prefix + '/recipients?businessContext=dar')).body.routingPreview.length, 0);

    assert.deepEqual(routes.body.telegramDirectory.map(item => item.key).sort(), ['-100111:', '-100222:', '-100222:22', '-100333:', '-100444:', '-100555:']);
    const configure = (feature, address) => request('PUT', target('/telegram-routes/' + feature), { target: address });
    assert.equal((await configure('digest', '-100111:22')).status, 400);
    assert.equal((await configure('digest', '-100222:22')).status, 200);
    assert.equal((await configure('approval', '-100111:')).status, 200);
    assert.equal((await configure('reminder', '-100222:')).status, 200);
    const configured = (await request('GET', target('/recipients'))).body;
    assert.deepEqual(configured.routeSelections, { approval: '-100111:', digest: '-100222:22', reminder: '-100222:' });
    assert.deepEqual(configured.routingPreview.map(route => [route.chatId, route.threadId]),
        [['-100111', null], ['-100222', '22'], ['-100222', null]]);
    for (const feature of ['approval', 'digest', 'reminder']) assert.equal((await configure(feature, null)).status, 200);
    assert.deepEqual((await request('GET', target('/recipients'))).body.routingPreview, routes.body.routingPreview);

    const beforeEnable = await request('POST', target('/preview'), { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual(beforeEnable.body.recipients.map(item => item.name), ['Google']);
    const enabledFeatures = await request('PUT', target('/telegram-features'), { animatorApprovals: true, afishaAnnouncements: true });
    assert.equal(enabledFeatures.status, 200, JSON.stringify(enabledFeatures.body));
    assert.equal(enabledFeatures.body.telegramFeatures.afishaAnnouncements, true);

    const promotion = await request('POST', '/api/timeline/promotions?businessContext=event_genix', {
        title: 'Осіння акція', description: 'Діє у парку', color_key: 'amber',
        starts_on: '2026-10-19', ends_on: '2026-10-25', is_active: true
    });
    assert.ok(promotion.status < 300, JSON.stringify(promotion.body));
    const created = await request('POST', '/api/afisha/timeline?businessContext=event_genix', {
        date: '2026-10-20', time: '14:00', duration: 60, type: 'event',
        title: 'Тестовий майстер-клас', description: 'Оголошення в групу', lineIds: []
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await pool.query(`INSERT INTO afisha_templates (is_active, date_from, date_to, recurrence_pattern, title, time, duration, type)
        VALUES (true, '2026-10-21', '2026-10-21', 'daily', 'Регулярна новинка', '10:00', 60, 'regular')`);
    await pool.query(`INSERT INTO afisha (date, time, title, duration, type)
        VALUES ('2026-10-20', '12:00', 'Приватний іменинник', 15, 'birthday')`);
    const firstPreview = await request('POST', target('/preview'), { from: '2026-10-01', to: '2026-10-31' });
    assert.equal(firstPreview.status, 200, JSON.stringify(firstPreview.body));
    assert.equal(firstPreview.body.recipients.length, 3);
    assert.match(firstPreview.body.parts[0], /Регулярна новинка/);
    assert.match(firstPreview.body.parts[0], /Осіння акція/);
    assert.doesNotMatch(firstPreview.body.parts[0], /Приватний іменинник/);
    await pool.query('UPDATE afisha SET time = $1 WHERE id = $2', ['15:00', created.body.item.id]);
    assert.equal((await request('POST', target('/publish'), { previewToken: firstPreview.body.previewToken })).status, 409);
    const preview = await request('POST', target('/preview'), { from: '2026-10-01', to: '2026-10-31' });
    const publishData = { previewToken: preview.body.previewToken };
    const duplicate = await Promise.all([request('POST', target('/publish'), publishData), request('POST', target('/publish'), publishData)]);
    assert.deepEqual(duplicate.map(result => result.status), [202, 202]);
    assert.equal(duplicate[0].body.queued + duplicate[1].body.queued, 3);

    const sent = [];
    const clock = () => new Date(Date.now() + 1000);
    const transports = {
        telegram: (recipient, text) => deliverTelegramAnnouncement(recipient, text, async (method, payload) => {
            assert.equal(method, 'sendMessage');
            sent.push([payload.chat_id, payload.message_thread_id ?? null, payload.text]);
            if (payload.message_thread_id) throw Object.assign(new Error('fixture timeout'), { code: 'ETIMEDOUT' });
            return { ok: true, result: { message_id: 1 } };
        }),
        google_chat: (recipient, text) => deliverGoogleChatAnnouncement(recipient, text, async (url, options) => {
            assert.equal(url, fakeWebhook);
            sent.push(['google_chat', null, JSON.parse(options.body).text]);
            return Response.json({ name: 'spaces/fixture/messages/1' });
        })
    };
    await Promise.all([checkAfishaAnnouncements({ database: pool, now: clock, transports }),
        checkAfishaAnnouncements({ database: pool, now: clock, transports })]);
    await checkAfishaAnnouncements({ database: pool, now: clock, transports });
    assert.equal(sent.length, 3);
    assert.ok(sent.every(entry => entry[2] === preview.body.parts[0]));
    assert.ok(sent.some(entry => entry[0] === '-100222' && entry[1] === '22'));
    for (const [recipient, state] of [[one, 'sent'], [two, 'uncertain'], [three, 'sent']]) {
        const result = await request('GET', target('/recipients/' + recipient.id + '/history'));
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.deliveries.map(entry => entry.status), [state]);
        assert.equal(JSON.stringify(result.body).includes('token='), false);
    }

    await pool.query(`INSERT INTO afisha (date, time, title, description, duration, type)
        VALUES ('2026-10-26', '12:00', 'Велика афіша', $1, 60, 'event')`, ['🎪'.repeat(2400)]);
    const partsPreview = await request('POST', target('/preview'), { from: '2026-10-26', to: '2026-10-26' });
    assert.equal(partsPreview.body.parts.length, 2);
    const multiPublish = await request('POST', target('/publish'), { previewToken: partsPreview.body.previewToken });
    assert.equal(multiPublish.body.queued, 6);
    await Promise.all([checkAfishaAnnouncements({ database: pool, now: clock, transports }),
        checkAfishaAnnouncements({ database: pool, now: clock, transports })]);
    await checkAfishaAnnouncements({ database: pool, now: clock, transports });
    for (const [recipient, expected] of [[one, ['sent', 'sent']], [two, ['uncertain', 'skipped']], [three, ['sent', 'sent']]]) {
        const result = await request('GET', target('/recipients/' + recipient.id + '/history'));
        assert.deepEqual(result.body.deliveries.filter(item => item.slot_key === 'publication:2026-10-26:2026-10-26')
            .sort((a, b) => a.part_number - b.part_number).map(item => item.status), expected);
    }
    assert.deepEqual(sent.filter(entry => entry[0] === 'google_chat').slice(1).map(entry => entry[2]), partsPreview.body.parts);

    const revisionDate = '2026-10-27';
    await pool.query("INSERT INTO afisha (date,time,title,duration,type) VALUES ($1,'12:00','Версія до правки',60,'event')", [revisionDate]);
    const previewRevision = () => request('POST', target('/preview'), { from: revisionDate, to: revisionDate });
    const publishRevision = async () => {
        const value = await previewRevision();
        return request('POST', target('/publish'), { previewToken: value.body.previewToken });
    };
    assert.equal((await publishRevision()).body.queued, 3);
    await pool.query("UPDATE afisha SET title = 'Версія після правки' WHERE date = $1", [revisionDate]);
    const sentBeforeRevision = sent.length;
    for (let run = 0; run < 3; run++) await checkAfishaAnnouncements({ database: pool, now: clock, transports });
    assert.equal(sent.length, sentBeforeRevision);
    const skippedPublication = await pool.query("SELECT code FROM afisha_announcement_parts WHERE status = 'skipped' AND slot_key = $1",
        ['publication:' + revisionDate + ':' + revisionDate]);
    assert.deepEqual(skippedPublication.rows, Array.from({ length: 3 }, () => ({ code: 'publication_changed' })));
    assert.equal((await publishRevision()).body.queued, 3);
    await checkAfishaAnnouncements({ database: pool, now: clock, transports });
    assert.equal(sent.length, sentBeforeRevision + 3);
    assert.ok(sent.slice(sentBeforeRevision).every(entry => entry[2].includes('Версія після правки')));

    await pool.query('UPDATE settings SET value = $1 WHERE key = $2',
        [JSON.stringify({ animatorApprovals: true, afishaAnnouncements: true, afishaEnabledAt: '2026-09-30T00:00:00Z' }),
            'operational_telegram_features']);

    const daily = await add({ ...base, name: 'Daily', chatId: '-100333', afishaMode: 'off', eventsToday: true });
    const monthly = await add({ ...base, name: 'Monthly', chatId: '-100444', afishaMode: 'monthly' });
    // Use a fixed business day in the disposable fixture, independent of the host clock.
    await pool.query(`UPDATE afisha_announcement_recipients SET config = config || $2::jsonb WHERE id = $1`,
        [daily.id, { dailyEnabledAt: '2026-09-30T00:00:00Z' }]);
    await pool.query(`UPDATE afisha_announcement_recipients SET config = config || $2::jsonb WHERE id = $1`,
        [monthly.id, { monthlyEnabledAt: '2026-09-30T00:00:00Z' }]);
    const yes = { telegram: async (recipient, text) => { sent.push([recipient.chatId, null, text]); return { status: 'sent' }; } };
    await checkAfishaAnnouncements({ database: pool, now: () => new Date('2026-10-01T07:00:00Z'), transports: yes });
    await checkAfishaAnnouncements({ database: pool, now: () => new Date('2026-10-20T06:00:00Z'), transports: yes });
    assert.ok(sent.find(entry => entry[0] === '-100444')[2].includes('Регулярна новинка'));
    assert.ok(sent.find(entry => entry[0] === '-100333')[2].includes('15:00'));
    assert.ok(!sent.find(entry => entry[0] === '-100333')[2].includes('Осіння акція'));

    const queuedAt = Date.parse('2026-10-22T06:00:00Z');
    const { enqueueAutomaticAnnouncements } = require('../../services/afishaAnnouncementStore');
    await pool.query("INSERT INTO afisha(date,time,title,duration,type) VALUES ('2026-10-22','14:00','Перенесений захід',60,'event')");
    await enqueueAutomaticAnnouncements(pool, new Date(queuedAt));
    await pool.query("UPDATE afisha SET date = '2026-10-23' WHERE title = 'Перенесений захід'");
    await checkAfishaAnnouncements({ database: pool, now: () => new Date(queuedAt + 1000), transports: yes });
    assert.ok(!sent.some(entry => entry[2].includes('Перенесений захід')));
    const skipped = await pool.query("SELECT status FROM afisha_announcement_parts WHERE slot_key = 'daily:2026-10-22'");
    assert.deepEqual(skipped.rows, [{ status: 'skipped' }]);

    const promoGroup = await add({ ...base, name: 'Promotions', chatId: '-100555', afishaMode: 'off', promotionsToday: true });
    await pool.query(`UPDATE afisha_announcement_recipients SET config = config || $2::jsonb WHERE id = $1`,
        [promoGroup.id, { dailyEnabledAt: '2026-09-30T00:00:00Z' }]);
    const archiveAt = Date.parse('2026-10-19T06:00:00Z');
    await enqueueAutomaticAnnouncements(pool, new Date(archiveAt));
    await pool.query("UPDATE timeline_promotions SET is_active = FALSE WHERE title = 'Осіння акція'");
    await checkAfishaAnnouncements({ database: pool, now: () => new Date(archiveAt + 1000), transports: yes });
    assert.ok(!sent.some(entry => entry[0] === '-100555'));
    const archived = await request('GET', target('/recipients/' + promoGroup.id + '/history'));
    assert.deepEqual(archived.body.deliveries.map(entry => entry.status), ['skipped']);

    const restartAt = Date.parse('2026-10-21T06:00:00Z');
    await enqueueAutomaticAnnouncements(pool, new Date(restartAt));
    const abandoned = await createDeliveryStore(pool).claimNextPart(restartAt);
    assert.ok(abandoned);
    await checkAfishaAnnouncements({ database: pool, now: () => new Date(restartAt + 61_000), transports: yes });
    const restarted = await pool.query('SELECT status, attempt FROM afisha_announcement_parts WHERE id = $1', [abandoned.id]);
    assert.deepEqual(restarted.rows[0], { status: 'uncertain', attempt: 1 });

    const pendingDate = '2026-10-28';
    await pool.query("INSERT INTO afisha (date,time,title,duration,type) VALUES ($1,'12:00','Перемикач бота',60,'event')", [pendingDate]);
    const pendingPreview = await request('POST', target('/preview'), { from: pendingDate, to: pendingDate });
    assert.equal((await request('POST', target('/publish'), { previewToken: pendingPreview.body.previewToken })).body.queued, 3);
    const off = await request('PUT', target('/telegram-features'), { animatorApprovals: true, afishaAnnouncements: false });
    assert.equal(off.status, 200);
    const before = sent.length;
    await checkAfishaAnnouncements({ database: pool, now: clock, transports });
    assert.deepEqual(sent.slice(before).map(entry => entry[0]), ['google_chat']);
    const records = await pool.query('SELECT status FROM afisha_announcement_parts WHERE slot_key = $1 ORDER BY id',
        ['publication:' + pendingDate + ':' + pendingDate]);
    assert.deepEqual(records.rows.map(row => row.status).sort(), ['sent', 'skipped', 'skipped']);

});
