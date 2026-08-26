const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let state;

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    [
        '../db',
        '../middleware/auth',
        '../routes/afisha',
        '../services/backup',
        '../services/booking',
        '../services/bookingVisibility',
        '../services/businessContext',
        '../services/chatService',
        '../services/customerChildren',
        '../services/eventBus',
        '../services/kleshnya',
        '../services/music-delivery',
        '../services/pinataMode',
        '../services/scheduler',
        '../services/schedulerGuard',
        '../services/taskAutomationPolicy',
        '../services/taskBusinessScope',
        '../services/taskScheduling',
        '../services/taskTaxonomy',
        '../services/telegram',
        '../services/templates',
        '../services/timelineBusinessScope',
        '../services/websocket',
        '../utils/logger'
    ].forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function compact(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function rows(items = [], rowCount = items.length) {
    return { rows: items.map(item => ({ ...item })), rowCount };
}

function resetState(overrides = {}) {
    state = {
        date: '2026-06-29',
        time: '12:34',
        kyivDate: new Date('2026-06-29T12:34:00+03:00'),
        chatId: 'ops-chat',
        queries: [],
        queryMocks: [],
        sends: [],
        broadcasts: [],
        publishedEvents: [],
        createdTasks: [],
        checklistSubtasks: [],
        afishaDistributionCalls: [],
        deliveredAnnouncements: [],
        logs: [],
        resetMonthlyPointsCalls: 0,
        ...overrides
    };
}

function onQuery(name, matcher, handler, options = {}) {
    state.queryMocks.push({
        name,
        matcher,
        handler,
        once: options.once !== false
    });
}

function queryIncludes(...needles) {
    return text => needles.every(needle => text.includes(needle));
}

function createFakePool() {
    return {
        async query(sql, params = []) {
            const text = compact(sql);
            state.queries.push({ text, params });
            const index = state.queryMocks.findIndex(mock => mock.matcher(text, params));
            if (index === -1) {
                throw new Error(`Unexpected scheduler static job query: ${text}`);
            }
            const mock = state.queryMocks[index];
            if (mock.once) state.queryMocks.splice(index, 1);
            return mock.handler(text, params);
        }
    };
}

function mockLastSent(key, value = null, options = {}) {
    onQuery(`last_${key}`, (text, params) => (
        text === 'SELECT value FROM settings WHERE key = $1' && params[0] === `last_${key}`
    ), () => rows(value ? [{ value }] : []), options);
}

function mockSetLastSent(key, options = {}) {
    onQuery(`set_last_${key}`, (text, params) => (
        text.startsWith('INSERT INTO settings (key, value) VALUES ($1, $2)') && params[0] === `last_${key}`
    ), () => rows([], 1), options);
}

function loadScheduler() {
    clearModules();
    installMock('../db', { pool: createFakePool() });
    installMock('../utils/logger', {
        createLogger: name => ({
            info: (...args) => state.logs.push({ level: 'info', name, args }),
            warn: (...args) => state.logs.push({ level: 'warn', name, args }),
            error: (...args) => state.logs.push({ level: 'error', name, args })
        })
    });
    installMock('../services/telegram', {
        sendTelegramMessage: async (chatId, text, options) => {
            state.sends.push({ chatId, text, options });
            return { ok: true, result: { message_id: state.sends.length } };
        },
        getConfiguredChatId: async () => state.chatId,
        telegramRequest: async () => ({ ok: true }),
        scheduleAutoDelete: async () => {}
    });
    installMock('../services/booking', {
        ensureDefaultLines: async () => {},
        getKyivDate: () => state.kyivDate,
        getKyivDateStr: () => state.date,
        getKyivTimeStr: () => state.time,
        timeToMinutes: value => {
            const [hours, minutes] = String(value || '00:00').split(':').map(Number);
            return hours * 60 + minutes;
        },
        minutesToTime: value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    });
    installMock('../services/backup', { sendBackupToTelegram: async () => ({ success: true }) });
    installMock('../services/templates', { formatAfishaBlock: () => '' });
    installMock('../services/pinataMode', {
        CLIENT_PINATA_FILLER_LABEL: 'client',
        isClientOwnedPinataFiller: () => false
    });
    installMock('../services/bookingVisibility', {
        getVisibleBookingScope: () => ({ sql: '', scopeSource: 'scheduler-test' }),
        canViewBooking: () => true
    });
    installMock('../services/taskTaxonomy', {
        createChecklistSubtasks: async (pool, taskId, key) => state.checklistSubtasks.push({ taskId, key })
    });
    installMock('../services/taskScheduling', {
        processMissedSlots: async () => ({ processedCount: 0 })
    });
    installMock('../services/timelineBusinessScope', {
        DEFAULT_TIMELINE_CONTEXT: 'event_genix',
        pushDefaultTimelineBusinessContext: () => 'TRUE'
    });
    installMock('../services/businessContext', {
        DEFAULT_BUSINESS_CONTEXT: 'event_genix',
        pushBusinessContextCondition: () => 'TRUE'
    });
    installMock('../services/customerChildren', { isCustomerChildrenStorageMissing: () => false });
    installMock('../services/taskBusinessScope', {
        DEFAULT_TASK_BUSINESS_CONTEXT: 'event_genix',
        activeTaskBusinessContext: value => value || 'event_genix',
        pushTaskBusinessScopeCondition: () => 'TRUE'
    });
    installMock('../routes/afisha', {
        distributeAfishaForDate: async date => state.afishaDistributionCalls.push(date)
    });
    installMock('../services/eventBus', {
        publish: async (eventName, payload, idempotencyKey) => {
            state.publishedEvents.push({ eventName, payload, idempotencyKey });
        }
    });
    installMock('../services/kleshnya', {
        createTask: async task => {
            state.createdTasks.push(task);
            return { id: 900 + state.createdTasks.length, ...task };
        },
        resetMonthlyPoints: async () => {
            state.resetMonthlyPointsCalls += 1;
        },
        processReminders: async () => {}
    });
    installMock('../services/taskAutomationPolicy', {
        buildMachineTaskControlMetaPatch: (source, meta) => ({ source, ...meta })
    });
    installMock('../services/websocket', {
        broadcastToChannel: (channelId, eventName, payload) => {
            state.broadcasts.push({ channelId, eventName, payload });
        }
    });
    installMock('../services/chatService', {
        mapMessageRow: row => ({ id: row.id, text: row.text || '' })
    });
    installMock('../services/music-delivery', {
        isCronDue: () => true,
        deliverAnnouncement: async ann => {
            state.deliveredAnnouncements.push(ann.id);
            return { success: false, mode: 'test', detail: 'planned failure' };
        }
    });
    installMock('../services/schedulerGuard', {
        skipSchedulerTracking: () => ({ skipSchedulerTracking: true })
    });
    return require('../services/scheduler');
}

describe('static-only scheduler job behavior coverage', () => {
    beforeEach(() => resetState());
    afterEach(() => clearModules());

    it('time-gated jobs do not touch DB, Telegram, or services outside their scheduler window', async () => {
        const scheduler = loadScheduler();

        for (const jobName of [
            'checkRecurringTasks',
            'checkRecurringAfisha',
            'checkWorkDayTriggers',
            'checkMonthlyPointsReset',
            'checkStreakUpdates',
            'checkBirthdayGreetings',
            'checkBirthdayReminders',
            'checkDormantCustomers',
            'checkCustomerRetention',
            'checkHotLeads',
            'checkTeamPulseReminder',
            'checkStaleCatalogImages',
            'checkChatDailyDigest'
        ]) {
            await scheduler[jobName]();
        }

        assert.equal(state.queries.length, 0);
        assert.equal(state.sends.length, 0);
        assert.equal(state.broadcasts.length, 0);
        assert.equal(state.createdTasks.length, 0);
        assert.equal(state.resetMonthlyPointsCalls, 0);
    });

    it('recurring task creation records its daily marker before creation and skips a duplicate tick', async () => {
        resetState({ time: '00:05', kyivDate: new Date('2026-06-29T00:05:00+03:00') });
        mockLastSent('recurring');
        mockSetLastSent('recurring');
        onQuery('active task templates', queryIncludes('FROM task_templates', 'WHERE is_active = true'), () => rows([
            {
                id: 41,
                title: 'Open shift checklist',
                description: 'Routine',
                priority: 'normal',
                assigned_to: 'director',
                recurrence_pattern: 'daily',
                category: 'routine',
                default_task_kind: 'checklist',
                checklist_template_key: 'opening',
                business_context: 'event_genix'
            }
        ]));
        const scheduler = loadScheduler();

        await scheduler.checkRecurringTasks();
        await scheduler.checkRecurringTasks();

        assert.equal(state.createdTasks.length, 1);
        assert.equal(state.createdTasks[0].duplicateMode, 'skip');
        assert.equal(state.createdTasks[0].control_meta.source, 'recurring_task_template');
        assert.equal(state.checklistSubtasks.length, 1);
        assert.equal(state.queries.filter(query => query.text.includes('FROM task_templates')).length, 1);
    });

    it('birthday greetings send once per process after the persistent marker is written', async () => {
        resetState({ time: '09:00', kyivDate: new Date('2026-06-29T09:00:00+03:00') });
        mockLastSent('birthday_greeting');
        mockSetLastSent('birthday_greeting');
        onQuery('birthday customer rows', queryIncludes('WITH birthday_sources AS', 'FROM customers c'), () => rows([
            {
                id: 7,
                name: 'Test Parent',
                phone: '+380000000000',
                child_name: 'Test Child',
                child_birthday: '2020-06-29',
                total_bookings: 3,
                total_spent: 1200
            }
        ]));
        const scheduler = loadScheduler();

        await scheduler.checkBirthdayGreetings();
        await scheduler.checkBirthdayGreetings();

        assert.equal(state.sends.length, 1);
        assert.match(state.sends[0].text, /ДНІ НАРОДЖЕННЯ СЬОГОДНІ/);
        assert.equal(state.queries.filter(query => query.text.includes('WITH birthday_sources AS')).length, 1);
    });

    it('customer retention publishes one idempotent event per candidate and skips a duplicate tick', async () => {
        resetState({ time: '09:00', kyivDate: new Date('2026-06-29T09:00:00+03:00') });
        onQuery('retention candidates', queryIncludes('FROM customers c', 'customer_retention_log'), () => rows([
            {
                id: 77,
                name: 'Dormant Parent',
                phone: '+380000000001',
                days_since: 75,
                business_context: 'event_genix'
            }
        ]));
        onQuery('retention log insert', queryIncludes('INSERT INTO customer_retention_log'), () => rows([], 1));
        const scheduler = loadScheduler();

        await scheduler.checkCustomerRetention();
        await scheduler.checkCustomerRetention();

        assert.equal(state.publishedEvents.length, 1);
        assert.equal(state.publishedEvents[0].eventName, 'customer.retention');
        assert.equal(state.publishedEvents[0].idempotencyKey, 'retention_77_2026-06-29');
        assert.equal(state.queries.filter(query => query.text.includes('INSERT INTO customer_retention_log')).length, 1);
    });

    it('auto-report exits after settings when no destination chat is configured', async () => {
        onQuery('auto report settings', text => text === "SELECT key, value FROM settings WHERE key IN ('auto_report_time', 'auto_report_chat_id')", () => rows([
            { key: 'auto_report_time', value: '20:00' }
        ]));
        const scheduler = loadScheduler();

        await scheduler.checkAutoReport();

        assert.equal(state.sends.length, 0);
        assert.equal(state.queries.length, 1);
    });

    it('expired chat cleanup updates each claimed row once and broadcasts only deleted messages', async () => {
        onQuery('expired chat rows', queryIncludes('FROM chat_messages', 'expires_at IS NOT NULL'), () => rows([
            { id: 101, channel_id: 'general' }
        ]));
        onQuery('expired chat update', queryIncludes('UPDATE chat_messages SET deleted_at = NOW()'), () => rows([], 1));
        onQuery('expired chat rows second tick', queryIncludes('FROM chat_messages', 'expires_at IS NOT NULL'), () => rows([]));
        const scheduler = loadScheduler();

        await scheduler.checkExpiredChatMessages();
        await scheduler.checkExpiredChatMessages();

        assert.equal(state.broadcasts.length, 1);
        assert.deepEqual(state.broadcasts[0], {
            channelId: 'general',
            eventName: 'chat:delete',
            payload: { channelId: 'general', messageId: 101 }
        });
        assert.equal(state.queries.filter(query => query.text.startsWith('UPDATE chat_messages SET deleted_at')).length, 1);
    });

    it('polling-style jobs with no eligible rows do not create side effects', async () => {
        for (const [name, setup] of [
            ['checkAutoReviewRequests', () => {
                onQuery('nps detractors empty', queryIncludes('FROM event_reviews er', 'er.nps_score BETWEEN 0 AND 6'), () => rows([]));
                onQuery('nps promoters empty', queryIncludes('FROM event_reviews er', 'er.nps_score >= 9'), () => rows([]));
            }],
            ['checkRecurringAnnouncements', () => {
                onQuery('recurring announcements empty', queryIncludes('FROM announcements', "schedule_type = 'recurring'"), () => rows([]));
            }],
            ['checkEventPipeline', () => {
                onQuery('event pipeline t24 empty', queryIncludes('booking_pipeline bp', "bp.stage = 't24_sent'"), () => rows([]));
                onQuery('event pipeline day of empty', queryIncludes('booking_pipeline bp', "bp.stage = 'day_of_prep'"), () => rows([]));
                onQuery('event pipeline completed empty', queryIncludes('booking_pipeline bp', "bp.stage = 'completed'"), () => rows([]));
            }],
            ['checkNpsFollowUp', () => {
                onQuery('follow-up detractors empty', queryIncludes('FROM event_reviews er', 'er.nps_score BETWEEN 0 AND 6'), () => rows([]));
                onQuery('follow-up promoters empty', queryIncludes('FROM event_reviews er', 'er.nps_score >= 9'), () => rows([]));
            }],
            ['checkCleaningTasks', () => {
                onQuery('cleaning empty', queryIncludes('FROM bookings b', 'LEFT JOIN cleaning_tasks'), () => rows([]));
            }]
        ]) {
            resetState();
            setup();
            const scheduler = loadScheduler();
            await scheduler[name]();
            assert.equal(state.sends.length, 0, `${name} must not send Telegram without eligible rows`);
            assert.equal(state.broadcasts.length, 0, `${name} must not broadcast without eligible rows`);
            assert.equal(state.publishedEvents.length, 0, `${name} must not publish events without eligible rows`);
        }
    });

    it('event pipeline publishes a T-24 event with a durable idempotency key and does not duplicate the next empty tick', async () => {
        onQuery('event pipeline t24 row', queryIncludes('booking_pipeline bp', "bp.stage = 't24_sent'"), () => rows([
            { id: 301, label: 'Tomorrow party', time: '13:00', program_name: 'Quest', room: 'A', customer_phone: '+380000000002', telegram_chat_id: '123456789' }
        ]));
        onQuery('event pipeline t24 insert', queryIncludes('INSERT INTO booking_pipeline', 't24_sent'), () => rows([], 1));
        onQuery('event pipeline day of empty', queryIncludes('booking_pipeline bp', "bp.stage = 'day_of_prep'"), () => rows([]));
        onQuery('event pipeline completed empty', queryIncludes('booking_pipeline bp', "bp.stage = 'completed'"), () => rows([]));
        onQuery('event pipeline t24 empty second tick', queryIncludes('booking_pipeline bp', "bp.stage = 't24_sent'"), () => rows([]));
        onQuery('event pipeline day of empty second tick', queryIncludes('booking_pipeline bp', "bp.stage = 'day_of_prep'"), () => rows([]));
        onQuery('event pipeline completed empty second tick', queryIncludes('booking_pipeline bp', "bp.stage = 'completed'"), () => rows([]));
        const scheduler = loadScheduler();

        await scheduler.checkEventPipeline();
        await scheduler.checkEventPipeline();

        assert.equal(state.publishedEvents.length, 1);
        assert.equal(state.publishedEvents[0].eventName, 'booking.t24');
        assert.match(state.publishedEvents[0].idempotencyKey, /^t24_301_/);
        assert.equal(state.queries.filter(query => query.text.includes('INSERT INTO booking_pipeline')).length, 1);
    });

    it('recurring announcement delivery failure is persisted as failed, not success', async () => {
        onQuery('recurring announcement row', queryIncludes('FROM announcements', "schedule_type = 'recurring'"), () => rows([
            { id: 55, repeat_cron: '* * * * *', last_played_at: null }
        ]));
        onQuery('announcement failed update', queryIncludes('UPDATE announcements SET played_count=played_count+1'), (text, params) => {
            assert.equal(params[0], 'failed');
            return rows([], 1);
        });
        onQuery('announcement log insert', queryIncludes('INSERT INTO music_log'), () => rows([], 1));
        const scheduler = loadScheduler();

        await scheduler.checkRecurringAnnouncements();

        assert.equal(state.deliveredAnnouncements.length, 1);
        assert.equal(state.queries.some(query => query.params[0] === 'success'), false);
    });

    it('cleaning task scheduler relies on the database unique path and does not create a second row on an empty follow-up tick', async () => {
        onQuery('cleaning row', queryIncludes('FROM bookings b', 'LEFT JOIN cleaning_tasks'), () => rows([
            { id: 409, room: 'Room B', time: '10:00', duration: 90, program_name: 'Quest', label: 'Quest' }
        ]));
        onQuery('cleaning insert', queryIncludes('INSERT INTO cleaning_tasks', 'ON CONFLICT DO NOTHING'), () => rows([], 1));
        onQuery('cleaning empty second tick', queryIncludes('FROM bookings b', 'LEFT JOIN cleaning_tasks'), () => rows([]));
        const scheduler = loadScheduler();

        await scheduler.checkCleaningTasks();
        await scheduler.checkCleaningTasks();

        assert.equal(state.queries.filter(query => query.text.includes('INSERT INTO cleaning_tasks')).length, 1);
    });
});

describe('auth scheduler cleanup behavior', () => {
    beforeEach(() => resetState());
    afterEach(() => clearModules());

    it('cleanupRefreshTokens deletes only expired or long-revoked refresh tokens', async () => {
        onQuery('refresh token cleanup', queryIncludes('DELETE FROM refresh_tokens', "revoked_at < NOW() - INTERVAL '7 days'", "expires_at < NOW() - INTERVAL '7 days'"), () => rows([{ id: 1 }, { id: 2 }], 2));
        clearModules();
        installMock('../db', { pool: createFakePool() });
        const { cleanupRefreshTokens } = require('../middleware/auth');

        const removed = await cleanupRefreshTokens();

        assert.equal(removed, 2);
        assert.equal(state.queries.length, 1);
    });
});
