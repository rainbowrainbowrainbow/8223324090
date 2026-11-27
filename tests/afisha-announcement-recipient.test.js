'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateAnnouncementRecipient, announcementRuleActivation } = require('../services/afishaAnnouncementRecipient');

const input = {
    name: '  Команда парку ', platform: 'telegram', active: false, chatId: '-100234', threadId: '22',
    afishaMode: 'monthly', monthlyTime: '09:00', dailyTime: '08:30', eventsToday: true, promotionsToday: false
};

test('recipient validation keeps explicit topics and rejects private chats and malformed times', () => {
    assert.deepEqual(validateAnnouncementRecipient(input), { ...input, name: 'Команда парку' });
    assert.equal(validateAnnouncementRecipient({ ...input, threadId: null }).threadId, null);
    for (const bad of [{ chatId: '22' }, { chatId: '-01' }, { threadId: -3 }, { threadId: '001' },
        { monthlyTime: '24:00' }, { active: 'false' }, { afishaMode: 'custom' }]) {
        assert.throws(() => validateAnnouncementRecipient({ ...input, ...bad }), { statusCode: 400 });
    }
});

test('Google Chat recipient settings exclude unrelated data and any webhook from the public fields', () => {
    const config = validateAnnouncementRecipient({ ...input, platform: 'google_chat', webhook: 'private', businessContext: 'client supplied' });
    assert.equal(config.platform, 'google_chat');
    assert.equal(Object.hasOwn(config, 'chatId'), false);
    assert.equal(Object.hasOwn(config, 'webhook'), false);
    assert.equal(Object.hasOwn(config, 'businessContext'), false);
});

test('activation date survives a rename and resets independently when a schedule or destination changes', () => {
    const previous = { ...input, active: true, destinationKey: 'telegram:-100234:22',
        monthlyEnabledAt: '2026-10-01T09:00:00Z', dailyEnabledAt: '2026-10-20T08:00:00Z' };
    const now = '2026-11-27T07:15:00Z';
    assert.deepEqual(announcementRuleActivation({ ...previous, name: 'New name', dailyTime: '09:00' }, previous, now),
        { monthlyEnabledAt: previous.monthlyEnabledAt, dailyEnabledAt: now });
    assert.deepEqual(announcementRuleActivation({ ...previous, destinationKey: 'telegram:-100234:23' }, previous, now),
        { monthlyEnabledAt: now, dailyEnabledAt: now });
    assert.deepEqual(announcementRuleActivation({ ...previous, active: false }, previous, now),
        { monthlyEnabledAt: null, dailyEnabledAt: null });
});
