const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let state;

const ROOT = path.join(__dirname, '..');

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../services/scheduler',
        '../services/telegram',
        '../services/booking',
        '../services/bookingVisibility',
        '../services/timelineBusinessScope',
        '../services/backup',
        '../services/templates'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function compact(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function timeText() {
    return `${String(state.hour).padStart(2, '0')}:${String(state.minute).padStart(2, '0')}`;
}

function resetState(overrides = {}) {
    state = {
        date: '2026-06-28',
        hour: 12,
        minute: 0,
        fallbackChatId: 'fallback-chat',
        bookings: [{
            id: 42,
            booking_number: 42,
            time_start: '12:30',
            program_name: 'Laser Quest',
            hosts: 10,
            second_animator: null
        }],
        staff: [
            { id: 10, name: 'Host One', telegram_id: 'host-chat' }
        ],
        bookingQueries: [],
        staffQueries: [],
        sentMessages: [],
        configuredChatLookups: 0,
        visibilityChecks: [],
        canViewBooking: () => true,
        ...overrides
    };
}

function createFakePool() {
    return {
        async query(sql, params = []) {
            const text = compact(sql);

            if (/FROM bookings b/i.test(text) && /b\.time = \$2/i.test(text)) {
                state.bookingQueries.push({ text, params });
                return {
                    rows: state.bookings.map(row => ({ ...row })),
                    rowCount: state.bookings.length
                };
            }

            if (/SELECT id, name, telegram_id FROM staff WHERE id = ANY\(\$1\)/i.test(text)) {
                const ids = params[0].map(value => String(value));
                state.staffQueries.push({ text, params });
                const rows = state.staff
                    .filter(row => ids.includes(String(row.id)))
                    .map(row => ({ ...row }));
                return { rows, rowCount: rows.length };
            }

            throw new Error(`Unexpected query in booking push reminders test: ${text}`);
        }
    };
}

function loadScheduler() {
    clearModules();
    installMock('../db', { pool: createFakePool() });
    installMock('../services/telegram', {
        sendTelegramMessage: async (chatId, text, options) => {
            state.sentMessages.push({ chatId, text, options });
            return { ok: true, result: { message_id: state.sentMessages.length } };
        },
        getConfiguredChatId: async () => {
            state.configuredChatLookups += 1;
            return state.fallbackChatId;
        },
        telegramRequest: async () => ({ ok: true }),
        scheduleAutoDelete: async () => {}
    });
    installMock('../services/booking', {
        ensureDefaultLines: async () => {},
        getKyivDate: () => ({
            getHours: () => state.hour,
            getMinutes: () => state.minute
        }),
        getKyivDateStr: () => state.date,
        getKyivTimeStr: () => timeText(),
        timeToMinutes: () => 0,
        minutesToTime: () => '00:00'
    });
    installMock('../services/bookingVisibility', {
        getVisibleBookingScope: () => ({ sql: 'AND TRUE', condition: 'TRUE' }),
        canViewBooking: (user, booking) => {
            state.visibilityChecks.push({ user, booking });
            return state.canViewBooking(user, booking);
        }
    });
    installMock('../services/timelineBusinessScope', {
        DEFAULT_TIMELINE_CONTEXT: 'event_genix',
        pushDefaultTimelineBusinessContext: () => 'TRUE'
    });
    installMock('../services/backup', { sendBackupToTelegram: async () => ({ ok: true }) });
    installMock('../services/templates', { formatAfishaBlock: () => '' });
    return require('../services/scheduler');
}

describe('booking push reminders scheduler', () => {
    beforeEach(() => {
        resetState();
    });

    afterEach(() => {
        clearModules();
    });

    it('sends a reminder for a booking due in 30 minutes to staff telegram id', async () => {
        const scheduler = loadScheduler();

        await scheduler.checkBookingPushReminders();

        assert.equal(state.bookingQueries.length, 1);
        assert.deepEqual(state.bookingQueries[0].params, ['2026-06-28', '12:30']);
        assert.equal(state.sentMessages.length, 1);
        assert.equal(state.sentMessages[0].chatId, 'host-chat');
        assert.match(state.sentMessages[0].text, /42/);
        assert.match(state.sentMessages[0].text, /Laser Quest/);
        assert.match(state.sentMessages[0].text, /12:30/);
    });

    it('uses configured chat fallback when staff telegram id is missing', async () => {
        resetState({
            staff: [{ id: 10, name: 'Host One', telegram_id: null }],
            fallbackChatId: 'fallback-room'
        });
        const scheduler = loadScheduler();

        await scheduler.checkBookingPushReminders();

        assert.equal(state.configuredChatLookups, 1);
        assert.equal(state.sentMessages.length, 1);
        assert.equal(state.sentMessages[0].chatId, 'fallback-room');
    });

    it('includes numeric second animator in the staff query and sends both reminders', async () => {
        resetState({
            bookings: [{
                id: 43,
                booking_number: 43,
                time_start: '12:30',
                program_name: 'Birthday Show',
                hosts: 10,
                second_animator: '20'
            }],
            staff: [
                { id: 10, name: 'Host One', telegram_id: 'host-chat' },
                { id: 20, name: 'Second Host', telegram_id: 'second-chat' }
            ]
        });
        const scheduler = loadScheduler();

        await scheduler.checkBookingPushReminders();

        assert.deepEqual(state.staffQueries[0].params[0], [10, 20]);
        assert.deepEqual(state.sentMessages.map(call => call.chatId), ['host-chat', 'second-chat']);
    });

    it('ignores non-numeric second animator values', async () => {
        resetState({
            bookings: [{
                id: 44,
                booking_number: 44,
                time_start: '12:30',
                program_name: 'Quest',
                hosts: 10,
                second_animator: 'assistant-name'
            }],
            staff: [
                { id: 10, name: 'Host One', telegram_id: 'host-chat' },
                { id: 20, name: 'Second Host', telegram_id: 'second-chat' }
            ]
        });
        const scheduler = loadScheduler();

        await scheduler.checkBookingPushReminders();

        assert.deepEqual(state.staffQueries[0].params[0], [10]);
        assert.deepEqual(state.sentMessages.map(call => call.chatId), ['host-chat']);
    });

    it('does not look up chat config or send when no due bookings exist', async () => {
        resetState({ bookings: [] });
        const scheduler = loadScheduler();

        await scheduler.checkBookingPushReminders();

        assert.equal(state.bookingQueries.length, 1);
        assert.equal(state.configuredChatLookups, 0);
        assert.equal(state.staffQueries.length, 0);
        assert.equal(state.sentMessages.length, 0);
    });

    it('does not mark a minute as sent when configured chat is missing', async () => {
        resetState({
            fallbackChatId: null,
            staff: [{ id: 10, name: 'Host One', telegram_id: null }]
        });
        const scheduler = loadScheduler();

        await scheduler.checkBookingPushReminders();

        assert.equal(state.sentMessages.length, 0);

        state.fallbackChatId = 'fallback-room';
        await scheduler.checkBookingPushReminders();

        assert.equal(state.bookingQueries.length, 2);
        assert.equal(state.sentMessages.length, 1);
        assert.equal(state.sentMessages[0].chatId, 'fallback-room');
    });

    it('does not duplicate sends during the same minute in one process', async () => {
        const scheduler = loadScheduler();

        await scheduler.checkBookingPushReminders();
        await scheduler.checkBookingPushReminders();

        assert.equal(state.bookingQueries.length, 1);
        assert.equal(state.sentMessages.length, 1);
    });

    it('evaluates the next minute independently', async () => {
        const scheduler = loadScheduler();

        await scheduler.checkBookingPushReminders();
        state.minute = 1;
        state.bookings = [{
            id: 45,
            booking_number: 45,
            time_start: '12:31',
            program_name: 'Next Minute',
            hosts: 10,
            second_animator: null
        }];

        await scheduler.checkBookingPushReminders();

        assert.equal(state.bookingQueries.length, 2);
        assert.deepEqual(state.bookingQueries[1].params, ['2026-06-28', '12:31']);
        assert.equal(state.sentMessages.length, 2);
        assert.match(state.sentMessages[1].text, /Next Minute/);
    });

    it('registers booking push reminders with explicit no-dedup scheduler behavior', () => {
        const serverSource = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

        assert.ok(serverSource.includes(
            "guardScheduler('checkBookingPushReminders', checkBookingPushReminders, { dedup: null })"
        ));
        assert.equal(
            serverSource.includes("guardScheduler('checkBookingPushReminders', checkBookingPushReminders), 60000"),
            false
        );
    });
});
