const GUARDED_SCHEDULER_JOBS = [
    { name: 'checkAutoDigest', functionName: 'checkAutoDigest', sourceFile: 'services/scheduler.js', owner: 'bookings', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'settings', 'bookings'] },
    { name: 'checkAutoReminder', functionName: 'checkAutoReminder', sourceFile: 'services/scheduler.js', owner: 'bookings', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'settings', 'bookings'] },
    { name: 'checkAutoBackup', functionName: 'checkAutoBackup', sourceFile: 'services/scheduler.js', owner: 'backup', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'settings'] },
    { name: 'checkRecurringTasks', functionName: 'checkRecurringTasks', sourceFile: 'services/scheduler.js', owner: 'tasks', interval: '60000', dedup: 'daily', sideEffects: ['database'] },
    { name: 'checkRecurringAfisha', functionName: 'checkRecurringAfisha', sourceFile: 'services/scheduler.js', owner: 'afisha', interval: '60000', dedup: 'daily', sideEffects: ['database'] },
    { name: 'checkScheduledDeletions', functionName: 'checkScheduledDeletions', sourceFile: 'services/scheduler.js', owner: 'telegram', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'] },
    { name: 'checkCertificateExpiry', functionName: 'checkCertificateExpiry', sourceFile: 'services/scheduler.js', owner: 'certificates', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'] },
    { name: 'checkTaskReminders', functionName: 'checkTaskReminders', sourceFile: 'services/scheduler.js', owner: 'tasks', interval: '60000', dedup: 'hourly', sideEffects: ['telegram', 'database'] },
    { name: 'checkReplyAutoEscalations', functionName: 'checkReplyAutoEscalations', sourceFile: 'services/scheduler.js', owner: 'tasks', interval: '60000', dedup: 'hourly', sideEffects: ['database'], tests: ['tests/reply-escalation.test.js'] },
    { name: 'checkWorkDayTriggers', functionName: 'checkWorkDayTriggers', sourceFile: 'services/scheduler.js', owner: 'staff', interval: '60000', dedup: 'daily', sideEffects: ['database'] },
    { name: 'checkMonthlyPointsReset', functionName: 'checkMonthlyPointsReset', sourceFile: 'services/scheduler.js', owner: 'gamification', interval: '60000', dedup: 'daily', sideEffects: ['database'] },
    { name: 'checkHrAutoClose', functionName: 'checkHrAutoClose', sourceFile: 'services/hr.js', owner: 'hr', interval: '60000', dedup: 'daily', sideEffects: ['database'] },
    { name: 'checkHrNoShow', functionName: 'checkHrNoShow', sourceFile: 'services/hr.js', owner: 'hr', interval: '60000', dedup: 'daily', sideEffects: ['database'] },
    { name: 'checkStreakUpdates', functionName: 'checkStreakUpdates', sourceFile: 'services/scheduler.js', owner: 'gamification', interval: '60000', dedup: 'daily', sideEffects: ['database'] },
    { name: 'checkBirthdayGreetings', functionName: 'checkBirthdayGreetings', sourceFile: 'services/scheduler.js', owner: 'customers', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'] },
    { name: 'checkBirthdayReminders', functionName: 'checkBirthdayReminders', sourceFile: 'services/scheduler.js', owner: 'customers', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'] },
    { name: 'checkDormantCustomers', functionName: 'checkDormantCustomers', sourceFile: 'services/scheduler.js', owner: 'customers', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'] },
    { name: 'checkUpcomingBookings', functionName: 'checkUpcomingBookings', sourceFile: 'services/scheduler.js', owner: 'bookings', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'] },
    { name: 'checkEventQueue', functionName: 'checkEventQueue', sourceFile: 'services/scheduler.js', owner: 'event-queue', interval: '60000', dedup: null, sideEffects: ['database', 'events'], tests: ['tests/event-queue.test.js'] },
    { name: 'checkSLABreach', functionName: 'checkSLABreach', sourceFile: 'services/scheduler.js', owner: 'sla', interval: '60000', dedup: 'hourly', sideEffects: ['telegram', 'database'] },
    { name: 'checkScheduledAnnouncements', functionName: 'checkScheduledAnnouncements', sourceFile: 'services/scheduler.js', owner: 'announcements', interval: '60000', dedup: 'hourly', sideEffects: ['telegram', 'database'] },
    { name: 'checkTaskOverdue', functionName: 'checkTaskOverdue', sourceFile: 'services/scheduler.js', owner: 'tasks', interval: '60000', dedup: 'hourly', sideEffects: ['database'] },
    { name: 'checkCustomerRetention', functionName: 'checkCustomerRetention', sourceFile: 'services/scheduler.js', owner: 'customers', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'] },
    { name: 'checkAutoReport', functionName: 'checkAutoReport', sourceFile: 'services/scheduler.js', owner: 'reports', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'] },
    { name: 'checkHotLeads', functionName: 'checkHotLeads', sourceFile: 'services/scheduler.js', owner: 'leads', interval: '60000', dedup: 'hourly', sideEffects: ['telegram', 'database'] },
    { name: 'checkScheduledChatMessages', functionName: 'checkScheduledChatMessages', sourceFile: 'services/scheduler.js', owner: 'chat', interval: '30000', dedup: null, sideEffects: ['websocket', 'database'], tests: ['tests/scheduled-chat-dispatch.test.js'] },
    { name: 'checkExpiredChatMessages', functionName: 'checkExpiredChatMessages', sourceFile: 'services/scheduler.js', owner: 'chat', interval: '60000', dedup: null, sideEffects: ['websocket', 'database'] },
    { name: 'checkAutoReviewRequests', functionName: 'checkAutoReviewRequests', sourceFile: 'services/scheduler.js', owner: 'reviews', interval: '60000', dedup: 'hourly', sideEffects: ['telegram', 'database'] },
    { name: 'checkTeamPulseReminder', functionName: 'checkTeamPulseReminder', sourceFile: 'services/scheduler.js', owner: 'team-pulse', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'] },
    { name: 'checkAutoOrdering', functionName: 'checkAutoOrdering', sourceFile: 'services/scheduler.js', owner: 'warehouse', interval: '60000', dedup: 'hourly', sideEffects: ['telegram', 'database'], tests: ['tests/telegram-callbacks.test.js'] },
    { name: 'checkBookingPushReminders', functionName: 'checkBookingPushReminders', sourceFile: 'services/scheduler.js', owner: 'bookings', interval: '60000', dedup: 'daily-default', sideEffects: ['telegram', 'database'], risk: 'guardScheduler currently defaults this every-minute-looking job to daily; keep visible until a runtime fix has focused notification tests.' },
    { name: 'checkCertExpiryReminders', functionName: 'checkCertExpiryReminders', sourceFile: 'services/scheduler.js', owner: 'staff', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'] },
    { name: 'checkStaleCatalogImages', functionName: 'checkStaleCatalogImages', sourceFile: 'services/scheduler.js', owner: 'catalogs', interval: '60000', dedup: 'daily', sideEffects: ['storage', 'database'] },
    { name: 'checkChatDailyDigest', functionName: 'checkChatDailyDigest', sourceFile: 'services/scheduler.js', owner: 'chat', interval: '60000', dedup: 'daily', sideEffects: ['chat', 'database'] },
    { name: 'checkRecurringAnnouncements', functionName: 'checkRecurringAnnouncements', sourceFile: 'services/scheduler.js', owner: 'announcements', interval: '60000', dedup: null, sideEffects: ['telegram', 'database'] },
    { name: 'checkEventPipeline', functionName: 'checkEventPipeline', sourceFile: 'services/scheduler.js', owner: 'events', interval: '60000', dedup: '5min', sideEffects: ['database', 'events'] },
    { name: 'checkNpsFollowUp', functionName: 'checkNpsFollowUp', sourceFile: 'services/scheduler.js', owner: 'customers', interval: '60000', dedup: 'hourly', sideEffects: ['telegram', 'database'] },
    { name: 'checkCleaningTasks', functionName: 'checkCleaningTasks', sourceFile: 'services/scheduler.js', owner: 'tasks', interval: '60000', dedup: '5min', sideEffects: ['database'] },
    { name: 'checkGraduationOpsAutomation', functionName: 'checkGraduationOpsAutomation', sourceFile: 'services/scheduler.js', owner: 'graduation', interval: '60000', dedup: 'hourly', sideEffects: ['telegram', 'database'], tests: ['tests/graduation-ops-automation.test.js'] },
    { name: 'checkTrainingPrompts', functionName: 'checkTrainingPrompts', sourceFile: 'server.js:inline', owner: 'training', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'], tests: ['tests/training.test.js'] },
    { name: 'checkTrainingSummary', functionName: 'checkTrainingSummary', sourceFile: 'server.js:inline', owner: 'training', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'], tests: ['tests/training.test.js'] },
    { name: 'checkGuardianReports', functionName: 'checkGuardianReports', sourceFile: 'server.js:inline', owner: 'guardian', interval: '60000', dedup: 'daily', sideEffects: ['telegram', 'database'], tests: ['tests/guardian-ops.test.js'] },
    { name: 'flushGuardianLearn', functionName: 'flushGuardianLearn', sourceFile: 'server.js:inline', owner: 'guardian', interval: '5 * 60 * 1000', dedup: null, sideEffects: ['database', 'ai'], tests: ['tests/guardian-convergence.test.js'] },
    { name: 'syncAgentActivities', functionName: 'syncAgentActivities', sourceFile: 'server.js:inline', owner: 'agent-tracker', interval: '30 * 60 * 1000', dedup: 'hourly', sideEffects: ['filesystem', 'database'] },
    { name: 'cleanupOutbox', functionName: 'cleanupOutbox', sourceFile: 'services/eventBus.js', owner: 'event-bus', interval: '60000', dedup: 'daily', sideEffects: ['database'], tests: ['tests/event-queue.test.js'] },
    { name: 'cleanupRefreshTokens', functionName: 'cleanupRefreshTokens', sourceFile: 'middleware/auth.js', owner: 'auth', interval: '60000', dedup: 'daily', sideEffects: ['database'] }
];

const RAW_SCHEDULER_INTERVALS = [
    { name: 'openclawBridgeStaleMessages', kind: 'setInterval', sourceFile: 'server.js', functionName: 'processStaleMessages', interval: '30000', owner: 'kleshnya', fragment: 'processStaleMessages(generateChatResponse, addChatMessage, getChatHistory, sendToUsername)' },
    { name: 'cleanupKleshnyaMessages', kind: 'setInterval', sourceFile: 'server.js', functionName: 'cleanupKleshnyaMessages', interval: '30 * 60 * 1000', owner: 'kleshnya', fragment: 'setInterval(cleanupKleshnyaMessages, 30 * 60 * 1000)' },
    { name: 'telegramRetryQueue', kind: 'setInterval', sourceFile: 'server.js', functionName: 'processRetryQueue', interval: '30000', owner: 'telegram', fragment: 'processRetryQueue().catch' },
    { name: 'eventBusProcessOutbox', kind: 'setInterval', sourceFile: 'server.js', functionName: 'processOutbox', interval: '5000', owner: 'event-bus', fragment: 'await processOutbox();' },
    { name: 'marketingPublishScheduled', kind: 'setInterval', sourceFile: 'server.js', functionName: 'publishScheduled', interval: '5 * 60 * 1000', owner: 'marketing', fragment: 'await publishScheduled();' },
    { name: 'marketingWeeklyPlan', kind: 'setInterval', sourceFile: 'server.js', functionName: 'generateWeeklyPlan', interval: '60 * 1000', owner: 'marketing', fragment: 'await generateWeeklyPlan' },
    { name: 'dashboardAlertBroadcaster', kind: 'starter', sourceFile: 'server.js', functionName: 'startAlertBroadcaster', interval: '60000', owner: 'dashboard', fragment: 'startAlertBroadcaster(60000)' },
    { name: 'taskLifecycleStartup', kind: 'setTimeout', sourceFile: 'server.js', functionName: 'runTaskLifecycle', interval: '30000', owner: 'tasks', fragment: 'setTimeout(() => runTaskLifecycle().catch(() => {}), 30000)' },
    { name: 'taskLifecycleDaily', kind: 'setInterval', sourceFile: 'server.js', functionName: 'runTaskLifecycle', interval: '24 * 60 * 60 * 1000', owner: 'tasks', fragment: 'setInterval(() => runTaskLifecycle().catch(() => {}), 24 * 60 * 60 * 1000)' }
];

const SCHEDULER_SURFACE_DOC = 'docs/SCHEDULER_SURFACE.md';

module.exports = {
    GUARDED_SCHEDULER_JOBS,
    RAW_SCHEDULER_INTERVALS,
    SCHEDULER_SURFACE_DOC
};
