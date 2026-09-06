const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const serverPath = path.join(__dirname, '..', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');

function findMatchingBrace(text, openBraceIndex) {
    let depth = 0;
    let quote = null;
    let templateExpressionDepth = 0;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = openBraceIndex; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];

        if (lineComment) {
            if (char === '\n') lineComment = false;
            continue;
        }

        if (blockComment) {
            if (char === '*' && next === '/') {
                blockComment = false;
                index += 1;
            }
            continue;
        }

        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }

            if (char === '\\') {
                escaped = true;
                continue;
            }

            if (quote === '`' && char === '$' && next === '{') {
                templateExpressionDepth += 1;
                index += 1;
                continue;
            }

            if (quote === '`' && templateExpressionDepth > 0) {
                if (char === '{') templateExpressionDepth += 1;
                if (char === '}') templateExpressionDepth -= 1;
                continue;
            }

            if (char === quote) quote = null;
            continue;
        }

        if (char === '/' && next === '/') {
            lineComment = true;
            index += 1;
            continue;
        }

        if (char === '/' && next === '*') {
            blockComment = true;
            index += 1;
            continue;
        }

        if (char === '"' || char === '\'' || char === '`') {
            quote = char;
            continue;
        }

        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }

    throw new Error('Matching brace was not found');
}

function extractFunctionDeclaration(name) {
    const marker = `async function ${name}`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `${name} declaration should exist in server.js`);
    const openBrace = source.indexOf('{', start);
    const closeBrace = findMatchingBrace(source, openBrace);
    return source.slice(start, closeBrace + 1);
}

function extractStartupCallbackBody() {
    const marker = 'server = app.listen(PORT, async () =>';
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, 'server.js should register async app.listen startup callback');
    const openBrace = source.indexOf('{', start);
    const closeBrace = findMatchingBrace(source, openBrace);
    return source.slice(openBrace + 1, closeBrace);
}

function evaluateSkipFlag(env) {
    const match = source.match(/const SKIP_TELEGRAM_BOT_STARTUP_CONFIG = ([^;]+);/);
    assert.ok(match, 'server.js should define SKIP_TELEGRAM_BOT_STARTUP_CONFIG');
    return vm.runInNewContext(match[1], { process: { env } });
}

function makeModule(moduleName, exportsMap, calls) {
    return new Proxy(exportsMap, {
        get(target, property) {
            if (typeof property === 'symbol') return target[property];
            if (Object.prototype.hasOwnProperty.call(target, property)) {
                calls.push({ name: 'import', args: [moduleName, property] });
                return target[property];
            }
            throw new Error(`Unexpected import ${moduleName}.${property}`);
        },
    });
}

async function runStartup({ flagValue, omniMode = 'owner-false' } = {}) {
    const env = {
        RAILWAY_PUBLIC_DOMAIN: 'crm.example.test',
        TELEGRAM_BOT_TOKEN: 'legacy-token',
        TELEGRAM_DEFAULT_CHAT_ID: 'telegram-chat',
        REPORT_BOT_TOKEN: 'report-token',
    };

    if (flagValue !== undefined) {
        env.SKIP_TELEGRAM_BOT_STARTUP_CONFIG = flagValue;
    }

    const calls = [];
    const logs = [];
    const schedulerIntervals = [];
    const schedulerRegistrations = [];

    const record = (name, implementation) => {
        const fn = (...args) => {
            calls.push({ name, args });
            if (implementation) return implementation(...args);
            return Promise.resolve();
        };
        fn._mockName = name;
        return fn;
    };

    const logMethod = level => (...args) => {
        logs.push({ level, message: String(args[0]), args });
        calls.push({ name: level, args });
    };

    const fakeRequire = moduleName => {
        calls.push({ name: 'require', args: [moduleName] });

        switch (moduleName) {
            case './services/omni-accounts':
                return makeModule(moduleName, {
                    isTelegramInboxConnectionUsingToken: record('isTelegramInboxConnectionUsingToken', () => {
                        if (omniMode === 'lookup-rejection') {
                            return Promise.reject(new Error('mock ownership lookup rejection'));
                        }
                        return Promise.resolve(omniMode === 'owner-token');
                    }),
                    hasActiveTelegramInboxConnection: record('hasActiveTelegramInboxConnection', () => (
                        Promise.resolve(omniMode === 'owner-active')
                    )),
                }, calls);
            case './services/bot':
                return makeModule(moduleName, {
                    registerBotCommands: record('registerBotCommands'),
                }, calls);
            case './services/report-bot':
                return makeModule(moduleName, {
                    registerReportBotCommands: record('registerReportBotCommands'),
                }, calls);
            case './services/chat-bot':
                return makeModule(moduleName, {
                    ensureBotMemberships: record('ensureBotMemberships'),
                }, calls);
            case './services/guardian':
                return makeModule(moduleName, {
                    ensureGuardianMemberships: record('ensureGuardianMemberships'),
                    runDailyReports: record('runDailyReports'),
                    flushLearnBatch: record('flushLearnBatch'),
                }, calls);
            case './services/kleshnya-chat':
                return makeModule(moduleName, {
                    generateChatResponse: record('generateChatResponse'),
                }, calls);
            case './services/kleshnya-greeting':
                return makeModule(moduleName, {
                    dispatchScheduledGreetings: record('dispatchScheduledGreetings'),
                    getChatHistory: record('getChatHistory'),
                    addChatMessage: record('addChatMessage'),
                }, calls);
            case './services/websocket':
                return makeModule(moduleName, {
                    sendToUsername: record('sendToUsername'),
                }, calls);
            case './services/booking':
                return makeModule(moduleName, {
                    getKyivTimeStr: record('getKyivTimeStr', () => '00:00'),
                    getKyivDate: record('getKyivDate', () => new Date('2026-09-06T00:00:00Z')),
                }, calls);
            case './services/eventBus':
                return makeModule(moduleName, {
                    processOutbox: record('processOutbox'),
                    cleanupOutbox: record('cleanupOutbox'),
                }, calls);
            case './services/trustedQaRuns':
                return makeModule(moduleName, {
                    runTrustedQaCleanupWatchdog: record('runTrustedQaCleanupWatchdog'),
                }, calls);
            case './middleware/auth':
                return makeModule(moduleName, {
                    cleanupRefreshTokens: record('cleanupRefreshTokens'),
                }, calls);
            case './lib/marketing-agent':
                return makeModule(moduleName, {
                    runMarketingScheduledPublish: record('runMarketingScheduledPublish'),
                    runMarketingWeeklyPlanScheduler: record('runMarketingWeeklyPlanScheduler', () => (
                        Promise.resolve({ skipped: true })
                    )),
                }, calls);
            case './routes/dashboard':
                return makeModule(moduleName, {
                    startAlertBroadcaster: record('startAlertBroadcaster'),
                }, calls);
            case './services/taskLifecycle':
                return makeModule(moduleName, {
                    runTaskLifecycle: record('runTaskLifecycle'),
                }, calls);
            case './db':
                return makeModule(moduleName, {
                    pool: { query: record('pool.query') },
                }, calls);
            default:
                throw new Error(`Unexpected require in startup test: ${moduleName}`);
        }
    };

    const stubFunctionNames = [
        'getConfiguredChatId',
        'ensureWebhook',
        'ensureReportBotWebhook',
        'processRetryQueue',
        'checkAutoDigest',
        'checkAutoReminder',
        'checkAutoBackup',
        'checkRecurringTasks',
        'checkRecurringAfisha',
        'checkScheduledDeletions',
        'checkCertificateExpiry',
        'checkTaskReminders',
        'checkReplyAutoEscalations',
        'checkWorkDayTriggers',
        'checkMonthlyPointsReset',
        'checkStreakUpdates',
        'checkBirthdayGreetings',
        'checkBirthdayReminders',
        'checkDormantCustomers',
        'checkUpcomingBookings',
        'checkEventQueue',
        'checkSLABreach',
        'checkScheduledAnnouncements',
        'checkTaskOverdue',
        'checkCustomerRetention',
        'checkAutoReport',
        'checkHotLeads',
        'checkScheduledChatMessages',
        'checkExpiredChatMessages',
        'checkAutoReviewRequests',
        'checkTeamPulseReminder',
        'checkAutoOrdering',
        'checkBookingPushReminders',
        'checkCertExpiryReminders',
        'checkStaleCatalogImages',
        'checkChatDailyDigest',
        'checkRecurringAnnouncements',
        'checkEventPipeline',
        'checkNpsFollowUp',
        'checkCleaningTasks',
        'checkGraduationOpsAutomation',
        'checkAttendanceReviewTasks',
        'checkHrAttendancePrintAutomations',
        'checkHrAutoClose',
        'checkHrNoShow',
        'checkBirthdayTagSync',
        'cleanupKleshnyaMessages',
        'runCheckboxReadinessProbeScheduler',
        'processPaymentOutboxJobs',
        'syncAgentActivities',
        'initWebSocket',
        'sendWeeklyTrainingPrompts',
        'sendWeeklySummaryToDirector',
    ];

    const context = {
        console: {
            log: logMethod('console.log'),
            warn: logMethod('console.warn'),
            error: logMethod('console.error'),
        },
        log: {
            info: logMethod('log.info'),
            warn: logMethod('log.warn'),
            error: logMethod('log.error'),
        },
        process: { env },
        require: fakeRequire,
        PORT: 3000,
        TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_DEFAULT_CHAT_ID: env.TELEGRAM_DEFAULT_CHAT_ID,
        REPORT_BOT_TOKEN: env.REPORT_BOT_TOKEN,
        OPENCLAW_BRIDGE: false,
        BACKUP_RECOVERY_MODE: false,
        BACKUP_OUTBOUND_HOLD: false,
        SKIP_TELEGRAM_BOT_STARTUP_CONFIG: evaluateSkipFlag(env),
        HERMES_JOB_RESULT_JSON_LIMIT: '1mb',
        schedulerIntervals,
        server: { mocked: true },
        Date,
        setInterval: (fn, intervalMs) => {
            assert.equal(typeof fn, 'function', `setInterval callback must be a function for ${intervalMs}`);
            calls.push({ name: 'setInterval', args: [fn._mockName || fn.name || 'anonymous', intervalMs] });
            return { fn, intervalMs };
        },
        setTimeout: (fn, timeoutMs) => {
            assert.equal(typeof fn, 'function', `setTimeout callback must be a function for ${timeoutMs}`);
            calls.push({ name: 'setTimeout', args: [fn._mockName || fn.name || 'anonymous', timeoutMs] });
            return { fn, timeoutMs };
        },
        guardScheduler: (name, fn, options) => {
            assert.equal(typeof fn, 'function', `guardScheduler ${name} callback must be a function`);
            schedulerRegistrations.push({ name, fnName: fn._mockName || fn.name || 'anonymous', options });
            calls.push({ name: 'guardScheduler', args: [name, fn._mockName || fn.name || 'anonymous', options] });
            const guarded = async () => fn();
            guarded._mockName = `guarded:${name}`;
            return guarded;
        },
        runAtKyivTimeOrUntilSettingDone: (time, settingKey, fn) => {
            assert.equal(typeof fn, 'function', `runAtKyivTimeOrUntilSettingDone callback must be a function for ${settingKey}`);
            calls.push({ name: 'runAtKyivTimeOrUntilSettingDone', args: [time, settingKey, fn._mockName || fn.name || 'anonymous'] });
            const gated = async () => fn();
            gated._mockName = `gated:${settingKey}`;
            return gated;
        },
    };

    for (const name of stubFunctionNames) {
        context[name] = record(name);
    }

    const code = `
        ${extractFunctionDeclaration('telegramInboxOwnsGlobalBotToken')}
        (async () => {
            ${extractStartupCallbackBody()}
        })()
    `;

    await vm.runInNewContext(code, context, { filename: 'server.js:startup-callback' });
    await Promise.resolve();

    return {
        calls,
        logs,
        schedulerRegistrations,
        schedulerIntervals,
        skipped: context.SKIP_TELEGRAM_BOT_STARTUP_CONFIG,
    };
}

function names(result, name) {
    return result.calls.filter(call => call.name === name);
}

function hasCall(result, name) {
    return result.calls.some(call => call.name === name);
}

function hasRequire(result, moduleName) {
    return result.calls.some(call => call.name === 'require' && call.args[0] === moduleName);
}

function assertNoUnexpectedWarningsOrErrors(result, allowedWarningStarts = []) {
    const warningsAndErrors = result.logs.filter(entry => (
        entry.level.endsWith('.warn') || entry.level.endsWith('.error')
    ));
    const unexpected = warningsAndErrors.filter(entry => {
        if (entry.level.endsWith('.error')) return true;
        return !allowedWarningStarts.some(prefix => entry.message.startsWith(prefix));
    });

    assert.deepEqual(unexpected, []);
}

test('absent and false flags keep legacy startup bot configuration when Omni does not own the token', async () => {
    for (const flagValue of [undefined, 'false']) {
        const result = await runStartup({ flagValue, omniMode: 'owner-false' });

        assert.equal(result.skipped, false);
        assert.ok(hasRequire(result, './services/omni-accounts'));
        assert.ok(hasCall(result, 'isTelegramInboxConnectionUsingToken'));
        assert.ok(hasCall(result, 'hasActiveTelegramInboxConnection'));
        assert.ok(hasCall(result, 'ensureWebhook'), 'legacy webhook setup should run');
        assert.ok(hasCall(result, 'registerBotCommands'), 'legacy bot command registration should run');
        assertNoUnexpectedWarningsOrErrors(result);
    }
});

test('Omni ownership true keeps the existing no-legacy-webhook branch without skip', async () => {
    const result = await runStartup({ omniMode: 'owner-token' });

    assert.equal(result.skipped, false);
    assert.ok(hasRequire(result, './services/omni-accounts'));
    assert.ok(hasCall(result, 'isTelegramInboxConnectionUsingToken'));
    assert.equal(hasCall(result, 'hasActiveTelegramInboxConnection'), false, 'token ownership should short-circuit active inbox lookup');
    assert.equal(hasCall(result, 'ensureWebhook'), false, 'legacy webhook setup should be skipped when Omni owns the token');
    assert.ok(hasCall(result, 'registerBotCommands'));
    assertNoUnexpectedWarningsOrErrors(result, [
        'Skipping legacy Telegram webhook auto-setup because the same bot token is bound as Omni Telegram inbox',
    ]);
});

test('true flag skips ownership lookup, legacy webhook setup, and legacy bot commands', async () => {
    const result = await runStartup({ flagValue: 'true', omniMode: 'owner-false' });

    assert.equal(result.skipped, true);
    assert.equal(hasRequire(result, './services/omni-accounts'), false);
    assert.equal(hasCall(result, 'isTelegramInboxConnectionUsingToken'), false);
    assert.equal(hasCall(result, 'hasActiveTelegramInboxConnection'), false);
    assert.equal(hasCall(result, 'ensureWebhook'), false);
    assert.equal(hasCall(result, 'registerBotCommands'), false);
    assertNoUnexpectedWarningsOrErrors(result, [
        'Skipping legacy Telegram webhook auto-setup because SKIP_TELEGRAM_BOT_STARTUP_CONFIG=true',
        'Skipping Telegram bot command menu registration because SKIP_TELEGRAM_BOT_STARTUP_CONFIG=true',
    ]);
});

test('lookup rejection keeps legacy fallback without skip and is not called with skip', async () => {
    const withoutSkip = await runStartup({ omniMode: 'lookup-rejection' });

    assert.ok(hasRequire(withoutSkip, './services/omni-accounts'));
    assert.ok(hasCall(withoutSkip, 'isTelegramInboxConnectionUsingToken'));
    assert.equal(hasCall(withoutSkip, 'hasActiveTelegramInboxConnection'), false);
    assert.ok(hasCall(withoutSkip, 'ensureWebhook'), 'lookup rejection should fall back to legacy webhook setup');
    assert.ok(hasCall(withoutSkip, 'registerBotCommands'));
    assertNoUnexpectedWarningsOrErrors(withoutSkip, [
        'Could not check Omni Telegram inbox webhook ownership',
    ]);

    const withSkip = await runStartup({ flagValue: 'true', omniMode: 'lookup-rejection' });

    assert.equal(hasRequire(withSkip, './services/omni-accounts'), false);
    assert.equal(hasCall(withSkip, 'isTelegramInboxConnectionUsingToken'), false);
    assert.equal(hasCall(withSkip, 'ensureWebhook'), false);
    assert.equal(hasCall(withSkip, 'registerBotCommands'), false);
    assertNoUnexpectedWarningsOrErrors(withSkip, [
        'Skipping legacy Telegram webhook auto-setup because SKIP_TELEGRAM_BOT_STARTUP_CONFIG=true',
        'Skipping Telegram bot command menu registration because SKIP_TELEGRAM_BOT_STARTUP_CONFIG=true',
    ]);
});

test('skip keeps report bot, memberships, websocket, alert broadcaster, and background registrations', async () => {
    const result = await runStartup({ flagValue: 'true' });

    assert.ok(hasCall(result, 'ensureReportBotWebhook'));
    assert.ok(hasCall(result, 'registerReportBotCommands'));
    assert.ok(hasCall(result, 'ensureBotMemberships'));
    assert.ok(hasCall(result, 'ensureGuardianMemberships'));
    assert.deepEqual(names(result, 'initWebSocket')[0].args, [{ mocked: true }]);
    assert.deepEqual(names(result, 'startAlertBroadcaster')[0].args, [60000]);

    const lifecycleRegistration = result.schedulerRegistrations.find(item => item.name === 'runTaskLifecycle');
    assert.ok(lifecycleRegistration);
    assert.equal(lifecycleRegistration.fnName, 'runTaskLifecycle');
    assert.ok(result.calls.some(call => call.name === 'setTimeout' && call.args[0] === 'anonymous' && call.args[1] === 30000));
    assert.ok(result.calls.some(call => call.name === 'setInterval' && call.args[0] === 'guarded:runTaskLifecycle'));

    assert.ok(result.schedulerRegistrations.some(item => item.name === 'checkAutoDigest' && item.fnName === 'checkAutoDigest'));
    assert.ok(result.schedulerRegistrations.some(item => item.name === 'checkTaskReminders' && item.fnName === 'checkTaskReminders'));
    assert.ok(result.schedulerRegistrations.some(item => item.name === 'runCheckboxReadinessProbeScheduler' && item.fnName === 'runCheckboxReadinessProbeScheduler'));
    assert.ok(result.schedulerRegistrations.some(item => item.name === 'processPaymentOutboxJobs' && item.fnName === 'processPaymentOutboxJobs'));
    assert.ok(result.schedulerRegistrations.some(item => item.name === 'runTrustedQaCleanupWatchdog' && item.fnName === 'runTrustedQaCleanupWatchdog'));
    assert.ok(result.schedulerRegistrations.some(item => item.name === 'cleanupOutbox' && item.fnName === 'cleanupOutbox'));
    assert.ok(result.schedulerRegistrations.some(item => item.name === 'cleanupRefreshTokens' && item.fnName === 'cleanupRefreshTokens'));

    assert.ok(hasRequire(result, './services/eventBus'));
    assert.ok(hasRequire(result, './services/trustedQaRuns'));
    assert.ok(hasRequire(result, './middleware/auth'));
    assert.ok(hasRequire(result, './lib/marketing-agent'));
    assert.ok(hasRequire(result, './routes/dashboard'));
    assert.ok(hasRequire(result, './services/taskLifecycle'));
    assertNoUnexpectedWarningsOrErrors(result, [
        'Skipping legacy Telegram webhook auto-setup because SKIP_TELEGRAM_BOT_STARTUP_CONFIG=true',
        'Skipping Telegram bot command menu registration because SKIP_TELEGRAM_BOT_STARTUP_CONFIG=true',
    ]);
});

test('repeated isolated startup with skip has the same guarded behavior', async () => {
    const first = await runStartup({ flagValue: 'true' });
    const second = await runStartup({ flagValue: 'true' });

    for (const result of [first, second]) {
        assert.equal(result.skipped, true);
        assert.equal(hasRequire(result, './services/omni-accounts'), false);
        assert.equal(hasCall(result, 'ensureWebhook'), false);
        assert.equal(hasCall(result, 'registerBotCommands'), false);
        assert.ok(hasCall(result, 'initWebSocket'));
        assert.ok(hasCall(result, 'registerReportBotCommands'));
        assert.ok(result.schedulerRegistrations.some(item => item.name === 'runTaskLifecycle' && item.fnName === 'runTaskLifecycle'));
        assertNoUnexpectedWarningsOrErrors(result, [
            'Skipping legacy Telegram webhook auto-setup because SKIP_TELEGRAM_BOT_STARTUP_CONFIG=true',
            'Skipping Telegram bot command menu registration because SKIP_TELEGRAM_BOT_STARTUP_CONFIG=true',
        ]);
    }
});
