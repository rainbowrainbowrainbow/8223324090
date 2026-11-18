'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createParkWorkFixture } = require('../helpers/park-work-app-fixture');

test('actual authenticated Park Chat enforces channels, recipients, files and booking boundaries', async t => {
    const f = await createParkWorkFixture();
    const { db, root, actors: [a, b, manager], api, origin, headers, park, dar, org } = f;
    const legacyName = `synthetic-chat-legacy-${f.suffix}.txt`;
    const legacyPath = path.resolve(__dirname, '../../uploads/chat', legacyName);
    const prefix = '/api/chat';
    let privateChannel; let privateMessage; let fileUrl;
    const insertMessage = async (channelId, userId, content, metadata = {}) => (await db.query(`INSERT INTO chat_messages
        (channel_id, user_id, seq, content, metadata) VALUES ($1, $2, next_chat_seq($1), $3, $4::jsonb) RETURNING id`,
    [channelId, userId, content, JSON.stringify(metadata)])).rows[0].id;
    try {
        await t.test('private channel IDs cannot grant membership or bypass a removed channel ACL', async () => {
            const created = await api(root, 'POST', prefix + '/channels', { name: 'Synthetic-private-' + f.suffix });
            assert.equal(created.status, 201, JSON.stringify(created.data));
            privateChannel = created.data.id;
            privateMessage = await insertMessage(privateChannel, root.id, 'SYNTHETIC_PRIVATE_MESSAGE');
            assert.equal((await api(root, 'POST', `${prefix}/channels/${privateChannel}/members`, { userId: a.id })).status, 200);
            assert.equal((await api(a, 'GET', `${prefix}/channels/${privateChannel}/messages`)).status, 200);
            assert.equal((await api(b, 'GET', `${prefix}/channels/${privateChannel}/messages`)).status, 403);
            assert.equal((await api(b, 'POST', `${prefix}/channels/${privateChannel}/join`, {})).status, 403);
            const before = await api(a, 'GET', prefix + '/channels');
            assert.equal(before.status, 200);
            assert.equal(before.data.some(row => row.id === privateChannel), true);
            const ownMessage = await insertMessage(privateChannel, a.id, 'Synthetic own message');
            await db.query('DELETE FROM chat_channel_members WHERE channel_id = $1 AND user_id = $2', [privateChannel, a.id]);
            assert.equal((await api(a, 'GET', prefix + '/channels')).data.some(row => row.id === privateChannel), false);
            assert.equal((await api(a, 'GET', `${prefix}/channels/${privateChannel}/messages`)).status, 403);
            assert.equal((await api(a, 'PUT', `${prefix}/messages/${ownMessage}`, { content: 'Rejected edit' })).status, 403);
            assert.equal((await api(a, 'DELETE', `${prefix}/messages/${ownMessage}`)).status, 403);
            await db.query('INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2)', [privateChannel, a.id]);
        });

        await t.test('DMs and target lists require current Park access and keep third parties out', async () => {
            await db.query(`INSERT INTO business_memberships (organization_id, business_id, user_id, role)
                VALUES ($1, $2, $3, 'hr')`, [org.id, dar.id, manager.id]);
            await db.query('UPDATE business_memberships SET is_active = false WHERE business_id = $1 AND user_id = $2', [park.id, manager.id]);
            assert.equal((await api(a, 'POST', prefix + '/dm', { targetUserId: manager.id })).status, 403);
            assert.equal((await api(a, 'GET', prefix + '/users')).data.some(row => row.id === manager.id), false);
            assert.equal((await api(a, 'GET', `${prefix}/users/${manager.id}/profile`)).status, 404);
            assert.equal((await api(manager, 'GET', prefix + '/channels', undefined, 'dar')).status, 403);
            const dm = await api(a, 'POST', prefix + '/dm', { targetUserId: b.id });
            assert.equal(dm.status, 200, JSON.stringify(dm.data));
            assert.equal((await api(root, 'POST', `${prefix}/channels/${dm.data.id}/join`, {})).status, 403);
            assert.equal((await api(a, 'POST', `${prefix}/channels/${dm.data.id}/members`, { userId: root.id })).status, 403);
            assert.equal((await api(a, 'DELETE', `${prefix}/channels/${dm.data.id}/members/${b.id}`)).status, 403);
            assert.equal((await api(b, 'GET', `${prefix}/channels/${dm.data.id}/messages`)).status, 200);
            await db.query('INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2)', [dm.data.id, root.id]);
            assert.equal((await api(root, 'GET', `${prefix}/channels/${dm.data.id}/messages`)).status, 403, 'rogue historical membership cannot change a DM pair');
            assert.equal((await api(root, 'GET', prefix + '/channels')).data.some(row => row.id === dm.data.id), false);
            await db.query('DELETE FROM chat_channel_members WHERE channel_id = $1 AND user_id = $2', [dm.data.id, root.id]);
            const { rows: [assistant] } = await db.query(`INSERT INTO chat_channels
                (slug, name, type, linked_entity_type, linked_entity_id, created_by)
                VALUES ($1, 'Synthetic private assistant', 'assistant', 'assistant_dialog', $2, $2) RETURNING id`, ['assistant-' + f.suffix, a.id]);
            await db.query('INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)', [assistant.id, a.id, root.id]);
            assert.equal((await api(a, 'GET', `${prefix}/channels/${assistant.id}/messages`)).status, 200);
            assert.equal((await api(root, 'GET', `${prefix}/channels/${assistant.id}/messages`)).status, 403);
            assert.equal((await api(root, 'GET', prefix + '/channels')).data.some(row => row.id === assistant.id), false);
        });

        await t.test('scheduled content stays private until an authorized atomic publication with a new sequence', async () => {
            const now = new Date().toISOString();
            const insertQueued = async actor => (await db.query(`INSERT INTO chat_messages
                (channel_id, user_id, seq, content, is_scheduled, scheduled_at)
                VALUES ($1, $2, next_chat_seq($1), 'SYNTHETIC_QUEUED_CANARY', true, NOW() - INTERVAL '1 minute') RETURNING id, seq`,
            [privateChannel, actor.id])).rows[0];
            const allowed = await insertQueued(a);
            const secondAllowed = await insertQueued(a);
            const blocked = await insertQueued(b);
            for (const endpoint of [`/channels/${privateChannel}/messages`, `/channels/${privateChannel}/messages/after/0`, '/search?q=SYNTHETIC_QUEUED']) {
                const before = await api(a, 'GET', prefix + endpoint);
                assert.equal(before.status, 200);
                assert.equal(JSON.stringify(before.data).includes('SYNTHETIC_QUEUED_CANARY'), false);
            }
            const { claimDueScheduledChatMessages } = require('../../services/chatScheduledAccess');
            const claimed = await claimDueScheduledChatMessages(db, now, 20);
            assert.deepEqual(claimed.map(row => row.id).sort((x, y) => x - y), [allowed.id, secondAllowed.id]);
            assert.equal(claimed.every(row => row.seq > blocked.seq), true, 'publication gets unread sequences after newer messages');
            assert.equal(new Set(claimed.map(row => row.seq)).size, 2);
            assert.equal((await db.query('SELECT is_scheduled FROM chat_messages WHERE id = $1', [blocked.id])).rows[0].is_scheduled, true);
            const deniedAfterQueue = await insertQueued(a);
            await db.query("UPDATE business_memberships SET page_denylist = ARRAY['/chat'] WHERE business_id = $1 AND user_id = $2", [park.id, a.id]);
            assert.deepEqual(await claimDueScheduledChatMessages(db, new Date().toISOString(), 20), []);
            assert.equal((await db.query('SELECT is_scheduled FROM chat_messages WHERE id = $1', [deniedAfterQueue.id])).rows[0].is_scheduled, true);
            await db.query("UPDATE business_memberships SET page_denylist = '{}' WHERE business_id = $1 AND user_id = $2", [park.id, a.id]);
            const concurrent = await insertQueued(a);
            const batches = await Promise.all([claimDueScheduledChatMessages(db, new Date().toISOString(), 1),
                claimDueScheduledChatMessages(db, new Date().toISOString(), 1)]);
            assert.deepEqual(batches.flat().map(row => row.id).sort((x, y) => x - y), [deniedAfterQueue.id, concurrent.id]);
            assert.equal(new Set(batches.flat().map(row => row.seq)).size, 2);
        });

        await t.test('durable file bytes require the same live message/channel ACL on API and historical URLs', async () => {
            const body = new FormData();
            body.append('file', new Blob([Buffer.from('Synthetic durable file')], { type: 'image/png' }), 'synthetic.png');
            const uploaded = await fetch(`${origin}${prefix}/channels/${privateChannel}/upload`, { method: 'POST', headers: headers(a), body });
            assert.equal(uploaded.status, 201);
            const message = await uploaded.json();
            fileUrl = message.metadata?.file?.url || message.message?.metadata?.file?.url;
            assert.ok(fileUrl?.startsWith('/uploads/chat/'));
            for (const url of [fileUrl, fileUrl.replace('/uploads/chat/', prefix + '/uploads/')]) {
                const allowed = await fetch(origin + url, { headers: headers(a) });
                assert.equal(allowed.status, 200);
                assert.match(allowed.headers.get('cache-control'), /private.*no-store/);
                assert.equal(await allowed.text(), 'Synthetic durable file');
                const anonymous = await fetch(origin + url);
                assert.equal(anonymous.status, 401);
                assert.match(anonymous.headers.get('cache-control'), /no-store/);
                const denied = await fetch(origin + url, { headers: headers(b) });
                assert.ok([403, 404].includes(denied.status));
            }
            assert.equal((await api(a, 'POST', `${prefix}/channels/${privateChannel}/messages`, {
                content: 'Forged attachment', metadata: { file: { url: fileUrl } }
            })).status, 400);
        });

        await t.test('historical local files retain the first message owner and reject encoded static aliases', async () => {
            fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
            fs.writeFileSync(legacyPath, 'Synthetic historical file');
            const url = '/uploads/chat/' + legacyName;
            await insertMessage(privateChannel, root.id, 'Synthetic original upload', { file: { url, name: legacyName, type: 'file' } });
            const other = await api(b, 'POST', prefix + '/channels', { name: 'Synthetic-copy-' + f.suffix });
            assert.equal(other.status, 201);
            await insertMessage(other.data.id, b.id, 'Synthetic historical copied metadata', { file: { url, name: legacyName, type: 'file' } });
            assert.equal((await fetch(origin + url, { headers: headers(a) })).status, 200);
            assert.equal((await fetch(origin + url, { headers: headers(b) })).status, 404);
            assert.equal((await fetch(origin + url.replace('/uploads/chat/', '/uploads/%63hat/'), { headers: headers(a) })).status, 404);
            assert.equal((await fetch(origin + url.replace('/uploads/chat/', '/%75ploads/chat/'), { headers: headers(a) })).status, 404);
        });

        await t.test('foreign booking links/previews cannot bypass Chat ownership or expose finance/contact fields', async () => {
            const parkBooking = 'qa-chat-park-' + f.suffix;
            const foreignBooking = 'qa-chat-foreign-' + f.suffix;
            await db.query(`INSERT INTO timeline_resources (business_context, resource_id, type, name, metadata)
                VALUES ('event_genix', $1, 'room', 'Synthetic Chat room', '{"workArea":"game_zone"}')`, ['room-chat-' + f.suffix]);
            await db.query(`INSERT INTO bookings (id, date, time, line_id, business_context, label, program_name, price, created_by, room_resource_id, room)
                VALUES ($1, '2026-11-18', '12:00', 'qa-line', 'event_genix', 'Synthetic Park booking', 'Synthetic', 900, $3, $4, 'Synthetic Chat room'),
                       ($2, '2026-11-18', '13:00', 'qa-line', 'dar', 'PRIVATE_FOREIGN_BOOKING', 'Synthetic foreign', 950, $3, NULL, 'Synthetic foreign room')`,
            [parkBooking, foreignBooking, root.user.username, 'room-chat-' + f.suffix]);
            const zoneChannel = await api(root, 'POST', prefix + '/booking-channel', { bookingId: parkBooking });
            assert.equal(zoneChannel.status, 200);
            assert.equal((await api(root, 'POST', `${prefix}/channels/${zoneChannel.data.channel.id}/members`, { userId: b.id })).status, 200);
            assert.equal((await api(b, 'GET', `${prefix}/channels/${zoneChannel.data.channel.id}/messages`)).status, 200, 'instructor reads a classified zone with channel membership');
            await db.query("UPDATE business_memberships SET action_denylist = ARRAY['timeline.game_zones.view'] WHERE business_id = $1 AND user_id = $2", [park.id, b.id]);
            assert.equal((await api(b, 'GET', `${prefix}/channels/${zoneChannel.data.channel.id}/messages`)).status, 403);
            await db.query("UPDATE business_memberships SET action_denylist = '{}' WHERE business_id = $1 AND user_id = $2", [park.id, b.id]);
            assert.equal((await api(root, 'POST', prefix + '/booking-channel', { bookingId: foreignBooking })).status, 404);
            const { rows: [foreignChannel] } = await db.query(`INSERT INTO chat_channels (slug, name, type, linked_booking_id, created_by)
                VALUES ($1, 'Synthetic foreign linked channel', 'booking', $2, $3) RETURNING id`, ['foreign-' + f.suffix, foreignBooking, root.id]);
            await db.query('INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2)', [foreignChannel.id, root.id]);
            assert.equal((await api(root, 'GET', `${prefix}/channels/${foreignChannel.id}/messages`)).status, 403);
            assert.equal((await api(root, 'GET', prefix + '/channels')).data.some(row => row.id === foreignChannel.id), false);
            await insertMessage(privateChannel, root.id, 'Synthetic preview', { bookingPreview: {
                id: parkBooking, date: '2026-11-18', time: '12:00', label: 'Synthetic event', price: 'PRIVATE_FINANCE', phone: 'PRIVATE_CONTACT'
            } });
            await insertMessage(privateChannel, root.id, 'Synthetic foreign preview', { bookingPreview: { id: foreignBooking, label: 'PRIVATE_FOREIGN_PREVIEW' } });
            const messages = await api(root, 'GET', `${prefix}/channels/${privateChannel}/messages`);
            assert.equal(messages.status, 200);
            assert.equal(messages.data.some(row => row.metadata?.bookingPreview?.id === parkBooking), true);
            assert.equal(JSON.stringify(messages.data).includes('PRIVATE_FINANCE'), false);
            assert.equal(JSON.stringify(messages.data).includes('PRIVATE_CONTACT'), false);
            assert.equal(JSON.stringify(messages.data).includes('PRIVATE_FOREIGN_PREVIEW'), false);
            assert.ok(privateMessage);
        });

        await t.test('page denial, revoked membership, disabled module and aggregate scope fail closed for files and APIs', async () => {
            assert.equal((await api(a, 'GET', prefix + '/channels?businessScope=all')).status, 403);
            for (const [column, value, restore] of [['page_denylist', ['/chat'], []], ['is_active', false, true]]) {
                await db.query(`UPDATE business_memberships SET ${column} = $3 WHERE business_id = $1 AND user_id = $2`, [park.id, a.id, value]);
                assert.equal((await api(a, 'GET', prefix + '/channels')).status, 403);
                assert.equal((await fetch(origin + fileUrl, { headers: headers(a) })).status, 403);
                await db.query(`UPDATE business_memberships SET ${column} = $3 WHERE business_id = $1 AND user_id = $2`, [park.id, a.id, restore]);
            }
            await db.query("UPDATE businesses SET modules = '[\"training\"]' WHERE id = $1", [park.id]);
            assert.equal((await api(a, 'GET', prefix + '/channels')).status, 403);
            assert.equal((await fetch(origin + fileUrl, { headers: headers(a) })).status, 403);
        });
    } finally {
        if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
        await db.end();
    }
});
