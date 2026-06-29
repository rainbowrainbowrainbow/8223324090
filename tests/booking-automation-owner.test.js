const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

function cacheModule(modulePath, exports) {
    const originalCacheEntry = require.cache[modulePath];
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        children: [],
        paths: module.paths,
        exports
    };
    return () => {
        if (originalCacheEntry) {
            require.cache[modulePath] = originalCacheEntry;
        } else {
            delete require.cache[modulePath];
        }
    };
}

function installDbMock() {
    const calls = [];
    const dbPath = require.resolve('../db');
    const restore = cacheModule(dbPath, {
        pool: {
            query: async (sql) => {
                calls.push({ sql: String(sql) });
                if (/SELECT \* FROM automation_rules WHERE is_active = true/i.test(String(sql))) {
                    return { rows: installDbMock.rules };
                }
                return { rows: [] };
            }
        }
    });
    return { calls, restore };
}
installDbMock.rules = [];

function installKleshnyaMock() {
    const calls = [];
    const kleshnyaPath = require.resolve('../services/kleshnya');
    const restore = cacheModule(kleshnyaPath, {
        createTask: async (payload) => {
            calls.push(payload);
            return { id: calls.length, ...payload };
        }
    });
    return { calls, restore };
}

function installTelegramMock() {
    const telegramPath = require.resolve('../services/telegram');
    return cacheModule(telegramPath, {
        telegramRequest: async () => ({ ok: true }),
        getConfiguredChatId: async () => null,
        sendTelegramMessage: async () => ({ ok: true })
    });
}

function loadBookingAutomation() {
    delete require.cache[require.resolve('../services/bookingAutomation')];
    return require('../services/bookingAutomation');
}

function makeRule(action) {
    return {
        id: 1001,
        name: 'Owner forwarding rule',
        trigger_type: 'booking_create',
        trigger_condition: { product_ids: ['maysternya-program'] },
        actions: [action],
        days_before: 1
    };
}

function makeBooking(overrides = {}) {
    return {
        id: 501,
        date: '2099-05-20',
        time: '14:00',
        programId: 'maysternya-program',
        businessContext: 'maysternya_doli',
        createdBy: 'automation-test',
        ...overrides
    };
}

describe('booking automation create_task owner forwarding', () => {
    let restoreDb;
    let restoreTelegram;
    let kleshnya;
    let bookingAutomation;

    beforeEach(() => {
        installDbMock.rules = [];
        const db = installDbMock();
        restoreDb = db.restore;
        restoreTelegram = installTelegramMock();
        kleshnya = installKleshnyaMock();
        bookingAutomation = loadBookingAutomation();
    });

    afterEach(() => {
        delete require.cache[require.resolve('../services/bookingAutomation')];
        kleshnya.restore();
        restoreTelegram();
        restoreDb();
    });

    it('keeps existing create_task payload backward compatible without owner fields', async () => {
        installDbMock.rules = [makeRule({
            type: 'create_task',
            title: 'Prepare booking {date}',
            priority: 'normal',
            category: 'purchase'
        })];

        await bookingAutomation.processBookingAutomation(makeBooking());

        assert.equal(kleshnya.calls.length, 1);
        assert.deepEqual(kleshnya.calls[0], {
            title: 'Prepare booking 2099-05-20',
            date: '2099-05-19',
            status: 'todo',
            priority: 'normal',
            category: 'purchase',
            created_by: 'automation-test',
            type: 'auto_complete',
            source_type: 'booking',
            source_id: '501',
            businessContext: 'maysternya_doli',
            duplicateMode: 'skip'
        });
    });

    it('passes typed owner and business fields for Maysternya/Oleksandr actions', async () => {
        installDbMock.rules = [makeRule({
            type: 'create_task',
            title: 'Підготувати персональну задачу для {date}',
            businessContext: 'maysternya_doli',
            owner_user_id: 18,
            assigned_to: 'Олександр',
            owner: 'Олександр',
            task_type: 'human',
            visibility: 'team',
            deadline: '2099-05-20T13:00:00+03:00'
        })];

        await bookingAutomation.processBookingAutomation(makeBooking());

        assert.equal(kleshnya.calls.length, 1);
        assert.equal(kleshnya.calls[0].businessContext, 'maysternya_doli');
        assert.equal(kleshnya.calls[0].owner_user_id, 18);
        assert.equal(kleshnya.calls[0].assigned_to, 'Олександр');
        assert.equal(kleshnya.calls[0].owner, 'Олександр');
        assert.equal(kleshnya.calls[0].task_type, 'human');
        assert.equal(kleshnya.calls[0].visibility, 'team');
        assert.equal(kleshnya.calls[0].deadline, '2099-05-20T13:00:00+03:00');
    });

    it('omits unsafe owner_user_id values instead of passing strings through', async () => {
        installDbMock.rules = [makeRule({
            type: 'create_task',
            title: 'Invalid owner id task',
            owner_user_id: '18; DROP TABLE users',
            assigned_to: 'Олександр',
            owner: 'Олександр'
        })];

        await bookingAutomation.processBookingAutomation(makeBooking());

        assert.equal(kleshnya.calls.length, 1);
        assert.equal(Object.hasOwn(kleshnya.calls[0], 'owner_user_id'), false);
        assert.equal(kleshnya.calls[0].assigned_to, 'Олександр');
        assert.equal(kleshnya.calls[0].owner, 'Олександр');
    });
});
