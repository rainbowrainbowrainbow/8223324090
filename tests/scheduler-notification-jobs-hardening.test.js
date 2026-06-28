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
        '../routes/afisha',
        '../services/backup',
        '../services/booking',
        '../services/bookingVisibility',
        '../services/businessContext',
        '../services/customerChildren',
        '../services/eventBus',
        '../services/kleshnya',
        '../services/pinataMode',
        '../services/scheduler',
        '../services/taskBusinessScope',
        '../services/taskScheduling',
        '../services/taskTaxonomy',
        '../services/telegram',
        '../services/templates',
        '../services/timelineBusinessScope',
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
        time: '09:00',
        chatId: 'ops-chat',
        sendThrows: false,
        sendResult: null,
        telegramRequestThrows: false,
        backupResult: { success: true },
        backupThrows: null,
        reminderThrows: null,
        queries: [],
        queryMocks: [],
        sends: [],
        telegramRequests: [],
        scheduledDeletes: [],
        chatLookups: 0,
        backupCalls: 0,
        defaultLineEnsures: [],
        afishaDistributionCalls: [],
        logs: [],
        publishedEvents: [],
        processReminderCalls: 0,
        processReminderThrows: null,
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
                throw new Error(`Unexpected scheduler notification query: ${text}`);
            }
            const mock = state.queryMocks[index];
            if (mock.once) state.queryMocks.splice(index, 1);
            return mock.handler(text, params);
        }
    };
}

function mockLastSent(key, value = null) {
    onQuery(`last_${key}`, (text, params) => (
        text === 'SELECT value FROM settings WHERE key = $1' && params[0] === `last_${key}`
    ), () => rows(value ? [{ value }] : []));
}

function mockSetLastSent(key) {
    onQuery(`set_last_${key}`, (text, params) => (
        text.startsWith('INSERT INTO settings (key, value) VALUES ($1, $2)') && params[0] === `last_${key}`
    ), () => rows([], 1));
}

function mockAfishaTemplates() {
    onQuery('afisha templates', queryIncludes('FROM afisha_templates', 'is_active = true'), () => rows([]));
}

function mockDigestSettings(settingRows) {
    onQuery('digest settings', queryIncludes("SELECT key, value FROM settings WHERE key IN ('digest_time'"), () => rows(settingRows));
}

function mockSingleSetting(key, value) {
    onQuery(`${key} setting`, text => text === `SELECT value FROM settings WHERE key = '${key}'`, () => rows(value ? [{ value }] : []));
}

function bookingRow(overrides = {}) {
    return {
        id: 101,
        date: state.date,
        time: '12:00',
        duration: 60,
        line_id: 'line-a',
        program_name: 'Birthday Quest',
        program_code: 'QUEST',
        label: 'Birthday Quest',
        category: 'quest',
        price: 2500,
        hosts: null,
        second_animator: null,
        room: 'Room A',
        linked_to: null,
        status: 'confirmed',
        kids_count: 10,
        group_name: 'Group',
        customer_name: 'Olena',
        customer_phone: '+380000000000',
        ...overrides
    };
}

function mockDigestBuildRows(bookings = [], afisha = []) {
    mockAfishaTemplates();
    onQuery('digest bookings', queryIncludes('FROM bookings b', 'ORDER BY b.time LIMIT 500'), () => rows(bookings));
    onQuery('digest afisha', queryIncludes('FROM afisha WHERE date = $1 ORDER BY time LIMIT 200'), () => rows(afisha));
    if (bookings.length > 0 || afisha.length > 0) {
        onQuery('digest lines', queryIncludes('FROM lines_by_date', 'ORDER BY id LIMIT 100'), () => rows([
            { id: 1, date: state.date, line_id: 'line-a', name: 'Line A', color: '#fff' }
        ]));
    }
}

function mockReminderBuildRows(bookings = [], afishaInitial = [], afishaFinal = []) {
    onQuery('tomorrow bookings', queryIncludes('FROM bookings b', 'ORDER BY b.time LIMIT 500'), () => rows(bookings));
    onQuery('tomorrow afisha initial', text => text === 'SELECT * FROM afisha WHERE date = $1 ORDER BY time', () => rows(afishaInitial));
    if (bookings.filter(row => !row.linked_to).length > 0 || afishaInitial.length > 0) {
        mockAfishaTemplates();
        onQuery('tomorrow afisha final', text => text === 'SELECT * FROM afisha WHERE date = $1 ORDER BY time', () => rows(afishaFinal));
        onQuery('tomorrow lines', queryIncludes('FROM lines_by_date', 'ORDER BY id'), () => rows([
            { id: 1, date: state.date, line_id: 'line-a', name: 'Line A', color: '#fff' }
        ]));
    }
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
            if (state.sendThrows) throw new Error('planned telegram send failure');
            return state.sendResult || { ok: true, result: { message_id: state.sends.length } };
        },
        getConfiguredChatId: async () => {
            state.chatLookups += 1;
            return state.chatId;
        },
        telegramRequest: async (method, body) => {
            state.telegramRequests.push({ method, body });
            if (state.telegramRequestThrows) throw new Error('planned telegram request failure');
            return { ok: true };
        },
        scheduleAutoDelete: async (chatId, messageId) => {
            state.scheduledDeletes.push({ chatId, messageId });
        }
    });
    installMock('../services/booking', {
        ensureDefaultLines: async date => state.defaultLineEnsures.push(date),
        getKyivDate: () => new Date(`${state.date}T${state.time}:00+03:00`),
        getKyivDateStr: () => state.date,
        getKyivTimeStr: () => state.time,
        timeToMinutes: value => {
            const [hours, minutes] = String(value || '00:00').split(':').map(Number);
            return hours * 60 + minutes;
        },
        minutesToTime: value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    });
    installMock('../services/backup', {
        sendBackupToTelegram: async () => {
            state.backupCalls += 1;
            if (state.backupThrows) throw state.backupThrows;
            return state.backupResult;
        }
    });
    installMock('../services/templates', { formatAfishaBlock: () => '' });
    installMock('../services/pinataMode', {
        CLIENT_PINATA_FILLER_LABEL: 'client',
        isClientOwnedPinataFiller: () => false
    });
    installMock('../services/bookingVisibility', {
        getVisibleBookingScope: () => ({ sql: '', scopeSource: 'full-role' }),
        canViewBooking: () => true
    });
    installMock('../services/taskTaxonomy', { createChecklistSubtasks: async () => {} });
    installMock('../services/taskScheduling', { processMissedSlots: async () => ({ processedCount: 0 }) });
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
        activeTaskBusinessContext: () => 'event_genix',
        pushTaskBusinessScopeCondition: () => 'TRUE'
    });
    installMock('../routes/afisha', {
        distributeAfishaForDate: async date => {
            state.afishaDistributionCalls.push(date);
            if (state.reminderThrows) throw state.reminderThrows;
        }
    });
    installMock('../services/eventBus', {
        publish: (eventName, payload, idempotencyKey) => {
            state.publishedEvents.push({ eventName, payload, idempotencyKey });
        }
    });
    installMock('../services/kleshnya', {
        processReminders: async () => {
            state.processReminderCalls += 1;
            if (state.processReminderThrows) throw state.processReminderThrows;
        }
    });
    return require('../services/scheduler');
}

describe('scheduler notification jobs hardening', () => {
    beforeEach(() => resetState());

    afterEach(() => {
        clearModules();
    });

    describe('checkAutoDigest', () => {
        it('does not send when digest time is not configured', async () => {
            mockDigestSettings([]);
            const scheduler = loadScheduler();

            await scheduler.checkAutoDigest();

            assert.equal(state.sends.length, 0);
            assert.equal(state.queries.length, 1);
        });

        it('sends the daily digest when due and eligible bookings exist', async () => {
            mockDigestSettings([{ key: 'digest_time_weekday', value: '09:00' }]);
            mockLastSent('digest');
            mockSetLastSent('digest');
            mockDigestBuildRows([bookingRow()]);
            const scheduler = loadScheduler();

            await scheduler.checkAutoDigest();

            assert.equal(state.sends.length, 1);
            assert.equal(state.sends[0].chatId, 'ops-chat');
            assert.match(state.sends[0].text, /Birthday Quest/);
            assert.deepEqual(state.scheduledDeletes, [{ chatId: 'ops-chat', messageId: 1 }]);
        });

        it('contains and logs digest Telegram send failures', async () => {
            resetState({ sendThrows: true });
            mockDigestSettings([{ key: 'digest_time_weekday', value: '09:00' }]);
            mockLastSent('digest');
            mockSetLastSent('digest');
            mockDigestBuildRows([], []);
            const scheduler = loadScheduler();

            await scheduler.checkAutoDigest();

            assert.equal(state.sends.length, 1);
            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'AutoDigest error'), true);
        });

        it('contains digest settings DB failures', async () => {
            onQuery('digest settings failure', queryIncludes("SELECT key, value FROM settings WHERE key IN"), () => {
                throw new Error('planned digest settings failure');
            });
            const scheduler = loadScheduler();

            await scheduler.checkAutoDigest();

            assert.equal(state.sends.length, 0);
            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'AutoDigest error'), true);
        });
    });

    describe('checkAutoReminder', () => {
        it('does not send when reminder time is not configured', async () => {
            mockSingleSetting('reminder_time', null);
            const scheduler = loadScheduler();

            await scheduler.checkAutoReminder();

            assert.equal(state.sends.length, 0);
            assert.equal(state.queries.length, 1);
        });

        it('sends the tomorrow reminder when due and eligible bookings exist', async () => {
            mockSingleSetting('reminder_time', '09:00');
            mockLastSent('reminder');
            mockSetLastSent('reminder');
            mockReminderBuildRows([bookingRow({ date: '2026-06-30' })]);
            const scheduler = loadScheduler();

            await scheduler.checkAutoReminder();

            assert.equal(state.sends.length, 1);
            assert.equal(state.sends[0].chatId, 'ops-chat');
            assert.match(state.sends[0].text, /Birthday Quest/);
            assert.deepEqual(state.scheduledDeletes, [{ chatId: 'ops-chat', messageId: 1 }]);
        });

        it('contains and logs reminder Telegram send failures', async () => {
            resetState({ sendThrows: true });
            mockSingleSetting('reminder_time', '09:00');
            mockLastSent('reminder');
            mockSetLastSent('reminder');
            mockReminderBuildRows([bookingRow({ date: '2026-06-30' })]);
            const scheduler = loadScheduler();

            await scheduler.checkAutoReminder();

            assert.equal(state.sends.length, 1);
            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'Reminder error: planned telegram send failure'), true);
        });

        it('contains reminder settings DB failures', async () => {
            onQuery('reminder settings failure', text => text === "SELECT value FROM settings WHERE key = 'reminder_time'", () => {
                throw new Error('planned reminder settings failure');
            });
            const scheduler = loadScheduler();

            await scheduler.checkAutoReminder();

            assert.equal(state.sends.length, 0);
            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'AutoReminder error'), true);
        });
    });

    describe('checkAutoBackup', () => {
        it('does not run backup when backup time is not due', async () => {
            resetState({ time: '09:00' });
            mockSingleSetting('backup_time', '03:00');
            const scheduler = loadScheduler();

            await scheduler.checkAutoBackup();

            assert.equal(state.backupCalls, 0);
            assert.equal(state.sends.length, 0);
        });

        it('sends an alert when a due backup reports failure', async () => {
            resetState({ time: '03:00', backupResult: { success: false, reason: 'archive_failed' } });
            mockSingleSetting('backup_time', '03:00');
            mockLastSent('backup');
            mockSetLastSent('backup');
            const scheduler = loadScheduler();

            await scheduler.checkAutoBackup();

            assert.equal(state.backupCalls, 1);
            assert.equal(state.sends.length, 1);
            assert.match(state.sends[0].text, /archive_failed/);
        });

        it('contains and logs backup alert send failures', async () => {
            resetState({ time: '03:00', backupResult: { success: false, reason: 'archive_failed' }, sendThrows: true });
            mockSingleSetting('backup_time', '03:00');
            mockLastSent('backup');
            mockSetLastSent('backup');
            const scheduler = loadScheduler();

            await scheduler.checkAutoBackup();

            assert.equal(state.backupCalls, 1);
            assert.equal(state.sends.length, 2);
            assert.equal(state.logs.some(entry => entry.level === 'error' && String(entry.args[0]).startsWith('Backup FAILED')), true);
            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'AutoBackup error'), true);
        });

        it('contains backup settings DB failures', async () => {
            resetState({ time: '03:00', chatId: null });
            onQuery('backup settings failure', text => text === "SELECT value FROM settings WHERE key = 'backup_time'", () => {
                throw new Error('planned backup settings failure');
            });
            const scheduler = loadScheduler();

            await scheduler.checkAutoBackup();

            assert.equal(state.backupCalls, 0);
            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'AutoBackup error'), true);
        });
    });

    describe('checkScheduledDeletions', () => {
        it('does not call Telegram when no deletions are due', async () => {
            onQuery('scheduled deletions empty', queryIncludes('FROM scheduled_deletions'), () => rows([]));
            const scheduler = loadScheduler();

            await scheduler.checkScheduledDeletions();

            assert.deepEqual(state.telegramRequests, []);
        });

        it('deletes due Telegram messages and removes scheduler rows', async () => {
            onQuery('scheduled deletions due', queryIncludes('FROM scheduled_deletions'), () => rows([
                { id: 7, chat_id: 'chat-7', message_id: 77 }
            ]));
            onQuery('scheduled deletion row delete', queryIncludes('DELETE FROM scheduled_deletions WHERE id = $1'), () => rows([], 1));
            const scheduler = loadScheduler();

            await scheduler.checkScheduledDeletions();

            assert.deepEqual(state.telegramRequests, [{
                method: 'deleteMessage',
                body: { chat_id: 'chat-7', message_id: 77 }
            }]);
            assert.equal(state.queries.some(query => query.text === 'DELETE FROM scheduled_deletions WHERE id = $1'), true);
        });

        it('contains Telegram delete failures and still removes scheduler rows', async () => {
            resetState({ telegramRequestThrows: true });
            onQuery('scheduled deletions due', queryIncludes('FROM scheduled_deletions'), () => rows([
                { id: 8, chat_id: 'chat-8', message_id: 88 }
            ]));
            onQuery('scheduled deletion row delete', queryIncludes('DELETE FROM scheduled_deletions WHERE id = $1'), () => rows([], 1));
            const scheduler = loadScheduler();

            await scheduler.checkScheduledDeletions();

            assert.equal(state.telegramRequests.length, 1);
            assert.equal(state.logs.some(entry => entry.level === 'error' && String(entry.args[0]).includes('AutoDelete: failed message 88')), true);
            assert.equal(state.queries.some(query => query.text === 'DELETE FROM scheduled_deletions WHERE id = $1'), true);
        });

        it('contains scheduled deletion DB failures', async () => {
            onQuery('scheduled deletions failure', queryIncludes('FROM scheduled_deletions'), () => {
                throw new Error('planned scheduled deletion select failure');
            });
            const scheduler = loadScheduler();

            await scheduler.checkScheduledDeletions();

            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'checkScheduledDeletions error'), true);
        });
    });

    describe('checkCertificateExpiry', () => {
        it('does not update certificates when expiry time is not due', async () => {
            resetState({ time: '00:09' });
            const scheduler = loadScheduler();

            await scheduler.checkCertificateExpiry();

            assert.equal(state.queries.length, 0);
        });

        it('expires eligible certificates without Telegram side effects', async () => {
            resetState({ time: '00:10' });
            onQuery('certificate expiry update', queryIncludes("UPDATE certificates SET status = 'expired'"), () => rows([
                { cert_code: 'CERT-1', display_value: 'Safety' }
            ], 1));
            const scheduler = loadScheduler();

            await scheduler.checkCertificateExpiry();

            assert.equal(state.sends.length, 0);
            assert.equal(state.logs.some(entry => entry.level === 'info' && String(entry.args[0]).includes('Certificates auto-expired: 1')), true);
        });

        it('contains certificate expiry DB failures', async () => {
            resetState({ time: '00:10' });
            onQuery('certificate expiry failure', queryIncludes("UPDATE certificates SET status = 'expired'"), () => {
                throw new Error('planned certificate expiry failure');
            });
            const scheduler = loadScheduler();

            await scheduler.checkCertificateExpiry();

            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'CertExpiry error'), true);
        });
    });

    describe('checkTaskReminders', () => {
        it('delegates to Kleshnya reminders without direct Telegram calls', async () => {
            const scheduler = loadScheduler();

            await scheduler.checkTaskReminders();

            assert.equal(state.processReminderCalls, 1);
            assert.equal(state.sends.length, 0);
        });

        it('contains task reminder delegate failures', async () => {
            resetState({ processReminderThrows: new Error('planned task reminder failure') });
            const scheduler = loadScheduler();

            await scheduler.checkTaskReminders();

            assert.equal(state.processReminderCalls, 1);
            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'TaskReminders error'), true);
        });

        it('silences missing-table task reminder failures', async () => {
            resetState({ processReminderThrows: new Error('relation reminders does not exist') });
            const scheduler = loadScheduler();

            await scheduler.checkTaskReminders();

            assert.equal(state.processReminderCalls, 1);
            assert.equal(state.logs.some(entry => entry.level === 'error'), false);
        });
    });

    describe('checkUpcomingBookings', () => {
        it('does not send when no upcoming bookings are eligible', async () => {
            resetState({ time: '11:00' });
            mockLastSent('upcoming_bookings');
            mockSetLastSent('upcoming_bookings');
            onQuery('upcoming empty', queryIncludes('FROM bookings b', "CURRENT_DATE + INTERVAL '3 days'"), () => rows([]));
            const scheduler = loadScheduler();

            await scheduler.checkUpcomingBookings();

            assert.equal(state.sends.length, 0);
        });

        it('sends upcoming booking reminders when rows are eligible', async () => {
            resetState({ time: '11:00' });
            mockLastSent('upcoming_bookings');
            mockSetLastSent('upcoming_bookings');
            onQuery('upcoming rows', queryIncludes('FROM bookings b', "CURRENT_DATE + INTERVAL '3 days'"), () => rows([
                bookingRow({ id: 501, label: 'Three Day Party', time: '15:00', room: 'Room B' })
            ]));
            const scheduler = loadScheduler();

            await scheduler.checkUpcomingBookings();

            assert.equal(state.sends.length, 1);
            assert.equal(state.sends[0].chatId, 'ops-chat');
            assert.match(state.sends[0].text, /Three Day Party/);
        });

        it('contains upcoming booking Telegram send failures', async () => {
            resetState({ time: '11:00', sendThrows: true });
            mockLastSent('upcoming_bookings');
            mockSetLastSent('upcoming_bookings');
            onQuery('upcoming rows', queryIncludes('FROM bookings b', "CURRENT_DATE + INTERVAL '3 days'"), () => rows([
                bookingRow({ id: 502, label: 'Failing Party' })
            ]));
            const scheduler = loadScheduler();

            await scheduler.checkUpcomingBookings();

            assert.equal(state.sends.length, 1);
            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'UpcomingBookings error'), true);
        });

        it('contains upcoming booking DB failures', async () => {
            resetState({ time: '11:00' });
            mockLastSent('upcoming_bookings');
            mockSetLastSent('upcoming_bookings');
            onQuery('upcoming failure', queryIncludes('FROM bookings b', "CURRENT_DATE + INTERVAL '3 days'"), () => {
                throw new Error('planned upcoming booking query failure');
            });
            const scheduler = loadScheduler();

            await scheduler.checkUpcomingBookings();

            assert.equal(state.sends.length, 0);
            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'UpcomingBookings error'), true);
        });
    });

    describe('checkSLABreach', () => {
        it('does not send when no tickets breached SLA', async () => {
            onQuery('sla empty', queryIncludes('FROM support_tickets st'), () => rows([]));
            const scheduler = loadScheduler();

            await scheduler.checkSLABreach();

            assert.equal(state.sends.length, 0);
            assert.equal(state.publishedEvents.length, 0);
        });

        it('marks breached tickets, sends Telegram alert, and publishes an event', async () => {
            onQuery('sla rows', queryIncludes('FROM support_tickets st'), () => rows([
                {
                    id: 9,
                    ticket_number: 'T-9',
                    subject: 'Late reply',
                    priority: 'high',
                    category: 'support',
                    assigned_to: null,
                    sla_resolve_minutes: 30,
                    created_at: new Date(Date.now() - 60 * 60000).toISOString()
                }
            ]));
            onQuery('sla update', queryIncludes('UPDATE support_tickets SET sla_breached = true'), () => rows([], 1));
            onQuery('sla rule', queryIncludes('FROM sla_rules'), () => rows([{ escalation_to: 'director' }]));
            const scheduler = loadScheduler();

            await scheduler.checkSLABreach();

            assert.equal(state.sends.length, 1);
            assert.match(state.sends[0].text, /T-9/);
            assert.deepEqual(state.publishedEvents.map(event => event.eventName), ['ticket.sla_breached']);
        });

        it('contains SLA Telegram send failures', async () => {
            resetState({ sendThrows: true });
            onQuery('sla rows', queryIncludes('FROM support_tickets st'), () => rows([
                {
                    id: 10,
                    ticket_number: 'T-10',
                    subject: 'Late reply',
                    priority: 'high',
                    category: 'support',
                    assigned_to: null,
                    sla_resolve_minutes: 30,
                    created_at: new Date(Date.now() - 60 * 60000).toISOString()
                }
            ]));
            onQuery('sla update', queryIncludes('UPDATE support_tickets SET sla_breached = true'), () => rows([], 1));
            onQuery('sla rule', queryIncludes('FROM sla_rules'), () => rows([{ escalation_to: 'director' }]));
            const scheduler = loadScheduler();

            await scheduler.checkSLABreach();

            assert.equal(state.sends.length, 1);
            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'checkSLABreach error'), true);
        });

        it('contains SLA DB failures', async () => {
            onQuery('sla failure', queryIncludes('FROM support_tickets st'), () => {
                throw new Error('planned SLA select failure');
            });
            const scheduler = loadScheduler();

            await scheduler.checkSLABreach();

            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'checkSLABreach error'), true);
        });
    });

    describe('checkScheduledAnnouncements', () => {
        it('does not log announcement activation rows when none are due', async () => {
            onQuery('announcements empty', queryIncludes('UPDATE announcements SET status ='), () => rows([]));
            const scheduler = loadScheduler();

            await scheduler.checkScheduledAnnouncements();

            assert.equal(state.queries.length, 1);
            assert.equal(state.sends.length, 0);
        });

        it('activates due announcements and writes music log entries', async () => {
            onQuery('announcements due', queryIncludes('UPDATE announcements SET status ='), () => rows([
                { id: 21, title: 'Morning Promo' },
                { id: 22, title: 'Evening Promo' }
            ], 2));
            onQuery('announcement music log 1', queryIncludes('INSERT INTO music_log'), () => rows([], 1));
            onQuery('announcement music log 2', queryIncludes('INSERT INTO music_log'), () => rows([], 1));
            const scheduler = loadScheduler();

            await scheduler.checkScheduledAnnouncements();

            assert.equal(state.queries.filter(query => query.text.includes('INSERT INTO music_log')).length, 2);
            assert.equal(state.sends.length, 0);
        });

        it('contains scheduled announcement DB failures', async () => {
            onQuery('announcements failure', queryIncludes('UPDATE announcements SET status ='), () => {
                throw new Error('planned announcement update failure');
            });
            const scheduler = loadScheduler();

            await scheduler.checkScheduledAnnouncements();

            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'checkScheduledAnnouncements error'), true);
        });
    });

    describe('checkCertExpiryReminders', () => {
        it('does not query certifications when reminder time is not due', async () => {
            resetState({ time: '09:14' });
            const scheduler = loadScheduler();

            await scheduler.checkCertExpiryReminders();

            assert.equal(state.queries.length, 0);
            assert.equal(state.sends.length, 0);
        });

        it('does not send when no certifications are expiring', async () => {
            resetState({ time: '09:15' });
            mockLastSent('cert_expiry_reminder');
            mockSetLastSent('cert_expiry_reminder');
            onQuery('cert reminder empty', queryIncludes('FROM staff_certifications sc'), () => rows([]));
            const scheduler = loadScheduler();

            await scheduler.checkCertExpiryReminders();

            assert.equal(state.sends.length, 0);
        });

        it('sends certification expiry reminders when rows are eligible', async () => {
            resetState({ time: '09:15' });
            mockLastSent('cert_expiry_reminder');
            mockSetLastSent('cert_expiry_reminder');
            onQuery('cert reminder rows', queryIncludes('FROM staff_certifications sc'), () => rows([
                {
                    id: 31,
                    cert_name: 'Safety',
                    expires_at: '2026-07-01',
                    status: 'active',
                    business_context: 'event_genix',
                    staff_name: 'Animator One',
                    staff_id: 5
                }
            ]));
            onQuery('cert expired update', queryIncludes("UPDATE staff_certifications SET status = 'expired'"), () => rows([], 0));
            const scheduler = loadScheduler();

            await scheduler.checkCertExpiryReminders();

            assert.equal(state.sends.length, 1);
            assert.equal(state.sends[0].chatId, 'ops-chat');
            assert.match(state.sends[0].text, /Animator One/);
            assert.match(state.sends[0].text, /Safety/);
        });

        it('contains certification expiry Telegram send failures', async () => {
            resetState({ time: '09:15', sendThrows: true });
            mockLastSent('cert_expiry_reminder');
            mockSetLastSent('cert_expiry_reminder');
            onQuery('cert reminder rows', queryIncludes('FROM staff_certifications sc'), () => rows([
                {
                    id: 32,
                    cert_name: 'Safety',
                    expires_at: '2026-07-01',
                    status: 'active',
                    business_context: 'event_genix',
                    staff_name: 'Animator One',
                    staff_id: 5
                }
            ]));
            onQuery('cert expired update', queryIncludes("UPDATE staff_certifications SET status = 'expired'"), () => rows([], 0));
            const scheduler = loadScheduler();

            await scheduler.checkCertExpiryReminders();

            assert.equal(state.sends.length, 1);
            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'checkCertExpiryReminders error'), true);
        });

        it('contains certification expiry DB failures', async () => {
            resetState({ time: '09:15' });
            mockLastSent('cert_expiry_reminder');
            mockSetLastSent('cert_expiry_reminder');
            onQuery('cert reminder failure', queryIncludes('FROM staff_certifications sc'), () => {
                throw new Error('planned cert reminder query failure');
            });
            const scheduler = loadScheduler();

            await scheduler.checkCertExpiryReminders();

            assert.equal(state.sends.length, 0);
            assert.equal(state.logs.some(entry => entry.level === 'error' && entry.args[0] === 'checkCertExpiryReminders error'), true);
        });
    });
});
