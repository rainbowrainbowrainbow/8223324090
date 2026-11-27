'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createFixture } = require('../helpers/timeline-marketing-fixture');

const october = { from: '2026-10-01', to: '2026-10-31' };
const november = { from: '2026-11-01', to: '2026-11-30' };
const prefix = '/api/afisha/announcements';
const target = (path, filters = {}) => prefix + path + '?' + new URLSearchParams({ businessContext: 'event_genix', ...filters });
const fixtureEvent = 'Майстерня паперових ліхтарів';
const importText = '2026-10-19;16:20;45;' + fixtureEvent + '\n2026-10-21;17:30;60;Осіннє читання';

test('confirmed Afisha publication, private CRM attachment and shared monthly slot', async t => {
    let now = new Date('2026-10-19T10:00:00Z');
    const fixture = await createFixture({ announcements: true, crmChat: true, now: () => now });
    t.after(() => fixture.close());
    const { pool, request } = fixture;
    const { deliverCrmAnnouncement } = require('../../services/afishaAnnouncementCrmChat');
    const { deliverTelegramAnnouncement } = require('../../services/afishaAnnouncementTelegram');
    const { enqueueAutomaticAnnouncements } = require('../../services/afishaAnnouncementStore');
    const { checkAfishaAnnouncements } = require('../../services/afishaAnnouncementWorker');
    const png = colour => require('sharp')({ create: { width: 6, height: 8, channels: 3, background: colour } }).png().toBuffer();
    const firstImage = await png('#235511');
    const secondImage = await png('#228833');
    const base = { active: true, afishaMode: 'monthly', monthlyTime: '10:00', dailyTime: '08:00',
        eventsToday: true, promotionsToday: true };
    const add = async config => {
        const result = await request('POST', target('/recipients'), { ...base, ...config });
        assert.equal(result.status, 201, JSON.stringify(result.body));
        assert.equal(result.body.recipient.active, false);
        return result.body.recipient;
    };
    const update = async (recipient, config) => {
        const result = await request('PUT', target('/recipients/' + recipient.id), { ...recipient, ...config });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        return result.body.recipient;
    };
    const save = (period, buffer, mime = 'image/png') => {
        const body = new FormData();
        body.append('from', period.from);
        body.append('to', period.to);
        body.append('layout', new Blob([buffer], { type: mime }), mime === 'image/png' ? 'afisha.png' : 'afisha.jpg');
        return request('PUT', target('/layout'), body);
    };
    const preview = async (period, ids, resend = false) => {
        const result = await request('POST', target('/preview'), { ...period, recipientIds: ids, resend });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        return result.body;
    };
    const publish = (view, ids, resend = false) => request('POST', target('/publish'),
        { previewToken: view.previewToken, recipientIds: ids, resend });
    const journal = async recipient => {
        const response = await request('GET', target('/recipients/' + recipient.id + '/history'));
        assert.equal(response.status, 200, JSON.stringify(response.body));
        return response.body.journal;
    };
    const partCount = async () => Number((await pool.query('SELECT count(*) FROM afisha_announcement_parts')).rows[0].count);
    const calls = [];
    let failNextTelegramText = false;
    const transports = {
        telegram: (recipient, text, part) => deliverTelegramAnnouncement(recipient, text, { ...part,
            sendPhoto: async (target, layout) => {
                calls.push({ type: 'photo', address: target.chatId, topic: target.threadId, content: layout.content });
                return { ok: true, result: { message_id: 1 } };
            },
            request: async (method, payload) => {
                assert.equal(method, 'sendMessage');
                calls.push({ type: 'text', address: payload.chat_id, topic: payload.message_thread_id, text: payload.text });
                if (failNextTelegramText) {
                    failNextTelegramText = false;
                    throw Object.assign(new Error('unconfirmed test send'), { code: 'ETIMEDOUT' });
                }
                return { ok: true, result: { message_id: 2 } };
            }
        }),
        crm_chat: (recipient, text, part) => deliverCrmAnnouncement(pool, recipient, text, part)
    };
    const drain = async () => {
        for (let n = 0; n < 3; n++) await checkAfishaAnnouncements({ database: pool, now: () => now, transports });
    };

    await pool.query(`INSERT INTO telegram_known_chats VALUES
        (-100701, 'ParkRozvag', 'group'), (-100702, 'Друга група', 'supergroup');
        INSERT INTO telegram_known_threads VALUES (-100702, 8, 'Події');
        INSERT INTO settings (key, value) VALUES
            ('operational_telegram_features', '{"animatorApprovals":true,"afishaAnnouncements":true,"afishaEnabledAt":"2026-09-20T00:00:00Z"}'),
            ('telegram_directory_approval', '-100702:8'), ('telegram_directory_digest', '-100702:'), ('telegram_directory_reminder', '-100701:'),
            ('telegram_animator_chat_id', '-100702'), ('telegram_animator_thread_id', '8');`);
    const getRoutes = async () => (await pool.query("SELECT key, value FROM settings WHERE key LIKE 'telegram_directory_%' ORDER BY key")).rows;
    const routing = await getRoutes();
    const park = await update(await add({ name: 'ParkRozvag', platform: 'telegram', chatId: '-100701' }), { active: true });
    const second = await update(await add({ name: 'Друга група', platform: 'telegram', chatId: '-100702', threadId: '8' }),
        { active: true, eventsToday: false, promotionsToday: false });
    const { rows: channels } = await pool.query(`INSERT INTO chat_channels (slug, name, type, is_dm, is_archived) VALUES
        ('afisha-team', '#Афіша команди', 'general', false, false), ('afisha-dm', 'Приватний', 'dm', true, false),
        ('afisha-old', 'Архівний', 'general', false, true), ('afisha-other', 'Чужий', 'general', false, false)
        RETURNING id, slug`);
    const [channel, dm, archived, other] = channels.map(row => row.id);
    await pool.query(`INSERT INTO chat_channel_members (channel_id, user_id)
        SELECT allowed.id, allowed.actor FROM unnest($1::int[], $2::int[]) allowed(id, actor)`,
    [[channel, channel, dm, archived, other], [1, 2, 1, 1, 3]]);
    const crm = await add({ name: 'Команда', platform: 'crm_chat', channelId: channel,
        afishaMode: 'off', eventsToday: false, promotionsToday: false });
    assert.equal((await add({ name: 'Дублікат', platform: 'crm_chat', channelId: channel })).id, crm.id);
    assert.deepEqual(await getRoutes(), routing);
    const options = await request('GET', target('/recipients'));
    assert.deepEqual(options.body.crmChannels.map(row => row.id), [channel]);
    for (const channelId of [dm, archived, other]) {
        const denied = await request('POST', target('/recipients'), { ...base, name: 'Недоступно', platform: 'crm_chat', channelId });
        assert.equal(denied.status, 403);
    }

    const initialIds = [park.id, crm.id];
    const unused = { from: '2026-10-22', to: '2026-10-22' };
    const jpeg = await require('sharp')(firstImage).jpeg().toBuffer();
    assert.equal((await save(unused, jpeg)).status, 400);
    assert.equal((await save(unused, Buffer.alloc(5 * 1024 * 1024 + 1))).status, 400);
    assert.equal((await save(unused, jpeg, 'image/jpeg')).body.layout.contentType, 'image/jpeg');
    assert.equal(await partCount(), 0);
    if (process.env.AFISHA_PUBLICATION_BROWSER === '1') {
        const { publishPosterInBrowser } = require('../browser/afisha-publication-browser-flow');
        await publishPosterInBrowser({ fixture, initialIds, importText, fixtureEvent, firstImage, partCount });
    } else {
        const req = '/api/afisha/timeline/import?businessContext=event_genix';
        const draft = { month: '2026-10', date: '2026-10-19', text: importText };
        const checked = await request('POST', req, { ...draft, commit: false });
        assert.equal(checked.body.items.length, 2, JSON.stringify(checked.body));
        const imported = await request('POST', req, { ...draft, commit: true });
        assert.equal(imported.body.created, 2, JSON.stringify(imported.body));
        assert.equal((await save(october, Buffer.from('not a PNG'))).status, 400);
        const saved = await save(october, firstImage);
        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        assert.equal((await request('GET', target('/publication-options', october))).body.layout.id, saved.body.layout.id);
        assert.equal(await partCount(), 0);
        const view = await preview(october, initialIds);
        assert.equal(view.recipients.length, 2);
        assert.match(view.parts[0], new RegExp('2026-10-19 о 16:20 — ' + fixtureEvent));
        assert.equal((await publish(view, [crm.id])).status, 409);
        const requests = await Promise.all([publish(view, initialIds), publish(view, initialIds)]);
        assert.equal(requests.reduce((sum, response) => sum + response.body.queued, 0), 3);
    }
    assert.equal(await partCount(), 3);
    // The pending publication owns the confirmed revision after later artwork and schedule changes.
    assert.equal((await save(october, secondImage)).status, 200);
    await pool.query("UPDATE afisha SET time = '18:00' WHERE title = $1", [fixtureEvent]);
    await drain();
    assert.deepEqual(calls.map(call => call.type), ['photo', 'text']);
    assert.deepEqual(calls[0].content, firstImage);
    assert.equal(calls[0].topic, null);
    assert.match(calls[1].text, /16:20/);
    assert.equal((await journal(park))[0].status, 'sent');
    assert.equal((await journal(crm))[0].kind, 'publication');
    assert.equal((await journal(crm))[0].status, 'sent');
    const member = { 'x-fixture-user': '2' };
    const outsider = { 'x-fixture-user': '3' };
    const list = await request('GET', '/api/chat/channels?accessProbe=1', null, member);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.find(item => item.id === channel).unreadCount, 1);
    const thread = await request('GET', '/api/chat/channels/' + channel + '/messages', null, member);
    assert.equal(thread.status, 200, JSON.stringify(thread.body));
    const [message] = thread.body;
    assert.match(message.content, /16:20/);
    const url = message.metadata.file.url;
    assert.equal((await request('GET', url, null, outsider)).status, 404);
    const picture = await request('GET', url, null, member);
    assert.equal(picture.status, 200);
    assert.equal(picture.contentType, 'image/png');
    assert.deepEqual(picture.body, firstImage);
    if (process.env.AFISHA_PUBLICATION_BROWSER === '1') {
        const { readPosterInBrowser } = require('../browser/afisha-publication-browser-flow');
        await readPosterInBrowser({ fixture, channel, fixtureEvent, attachmentUrl: url });
    }
    const newView = await preview(october, [crm.id]);
    assert.deepEqual(newView.deliveryState, [{ id: crm.id, sent: true, updated: true, blocked: false }]);
    assert.equal((await publish(newView, [crm.id])).body.queued, 0);
    const resend = await preview(october, [crm.id], true);
    assert.equal((await publish(resend, [crm.id], true)).body.queued, 1);
    await drain();
    assert.equal(calls.length, 2);

    const textOnly = { from: '2026-10-19', to: '2026-10-20' };
    const textView = await preview(textOnly, [crm.id]);
    assert.equal(textView.layout, null);
    assert.equal((await publish(textView, [crm.id])).body.queued, 1);
    await drain();
    const textJournal = (await journal(crm)).find(entry => entry.slot_key === 'publication:2026-10-19:2026-10-20');
    assert.equal(textJournal.status, 'sent');
    assert.equal(textJournal.parts[0].is_photo, false);
    assert.equal(calls.length, 2);

    const oneDay = { from: '2026-10-21', to: '2026-10-21' };
    const crmOnly = await preview(oneDay, [crm.id]);
    assert.equal(crmOnly.layout, null);
    assert.equal((await publish(crmOnly, [crm.id])).body.queued, 1);
    await pool.query('DELETE FROM chat_channel_members WHERE channel_id = $1 AND user_id = 1', [channel]);
    await drain();
    assert.equal((await journal(crm))[0].parts[0].detail, 'crm_channel_unavailable');
    assert.equal(calls.length, 2);
    await pool.query('INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, 1)', [channel]);
    const archiveDay = { from: '2026-10-19', to: '2026-10-19' };
    assert.equal((await publish(await preview(archiveDay, [crm.id]), [crm.id])).body.queued, 1);
    await pool.query('UPDATE chat_channels SET is_archived = true WHERE id = $1', [channel]);
    await drain();
    assert.equal((await journal(crm))[0].status, 'failed');
    assert.equal((await request('GET', url, null, member)).status, 404);

    await pool.query(`INSERT INTO afisha (date, time, title, type, duration) VALUES
        ('2026-11-01', '12:00', 'Подія листопада', 'event', 60),
        ('2026-12-01', '12:00', 'Подія грудня', 'event', 60)`);
    assert.equal((await save(november, firstImage)).status, 200);
    now = new Date('2026-10-31T12:00:00Z');
    assert.equal((await publish(await preview(november, [park.id]), [park.id])).body.queued, 2);
    await drain();
    now = new Date('2026-11-01T08:00:00Z'); // 10:00 Europe/Kyiv.
    await drain();
    const novemberRows = await pool.query(`SELECT destination_key, kind, count(*)::int AS parts
        FROM afisha_announcement_parts WHERE slot_key = 'monthly:2026-11-01'
        GROUP BY destination_key, kind ORDER BY destination_key`);
    assert.deepEqual(novemberRows.rows.map(row => [row.destination_key, row.kind, row.parts]),
        [['telegram:-100701:general', 'publication', 2], ['telegram:-100702:8', 'monthly', 2]]);
    assert.equal((await journal(second))[0].kind, 'monthly');
    const parkDaily = (await journal(park)).find(entry => entry.slot_key === 'daily:2026-11-01');
    assert.equal(parkDaily.parts.length, 1);
    assert.equal(parkDaily.parts[0].is_photo, false);

    const december = { from: '2026-12-01', to: '2026-12-31' };
    now = new Date('2026-12-01T08:00:00Z');
    const decemberView = await preview(december, [park.id]);
    await Promise.all([publish(decemberView, [park.id]), publish(decemberView, [park.id]), enqueueAutomaticAnnouncements(pool, now)]);
    await drain();
    assert.equal((await journal(park)).filter(entry => entry.slot_key === 'monthly:2026-12-01').length, 1);
    assert.equal(calls.filter(call => call.address === '-100701' && call.text?.startsWith('Афіша та акції · 2026-12-01')).length, 1);
    const jan = { from: '2027-01-01', to: '2027-01-01' };
    await pool.query("INSERT INTO afisha (date, time, title, type, duration) VALUES ('2027-01-01', '12:00', 'Новорічний тест', 'event', 60)");
    assert.equal((await save(jan, firstImage)).status, 200);
    const stale = await preview(jan, [park.id]);
    assert.equal((await save(jan, secondImage)).status, 200);
    assert.equal((await publish(stale, [park.id])).status, 409);
    const confirmed = await preview(jan, [park.id]);
    assert.equal((await publish(confirmed, [park.id])).body.queued, 2);
    const beforePartial = calls.length;
    failNextTelegramText = true;
    await drain();
    const partial = (await journal(park)).find(entry => entry.slot_key === 'publication:2027-01-01:2027-01-01');
    assert.equal(partial.status, 'partial');
    assert.deepEqual(partial.parts.map(part => part.status), ['sent', 'uncertain']);
    assert.equal(calls.length - beforePartial, 2);
    await drain();
    assert.equal(calls.length - beforePartial, 2);
    assert.deepEqual(await getRoutes(), routing);
});
