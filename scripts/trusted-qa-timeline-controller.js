'use strict';

const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BLUEPRINT = path.join(ROOT, 'config', 'trusted-qa-timeline-showcase-2026-09-02.json');
const DEFAULT_SECRET_FILE = path.join(os.homedir(), '.eventgenix', 'codex-crm-secrets.ps1');
const ALLOWED_BRANCH = 'codex/eventgenix-production';
const ALLOWED_HOSTS = new Set(['8223324090-production.up.railway.app']);
const CONTROLLER_SOURCE = 'trusted_timeline_showcase';
const LEGACY_SOURCE = 'trusted_qa';
const CLEANUP_CONFIRMATION_PREFIX = 'CLEANUP_EXACT_TIMELINE_QA';
const SENSITIVE_KEY = /(password|pass|secret|token|database.?url|authorization|cookie)/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const ANIMATOR_PATTERN = /^[1-5]$/;

class TimelineControllerError extends Error {
    constructor(message, code = 'TIMELINE_CONTROLLER_FAILED', details = {}) {
        super(message);
        this.name = 'TimelineControllerError';
        this.code = code;
        this.details = details;
    }
}

function fail(condition, message, code, details = {}) {
    if (!condition) throw new TimelineControllerError(message, code, details);
}

function cleanText(value, max = 300) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function argValue(args, name, fallback = null) {
    const inline = args.find(arg => arg.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function sanitize(value, key = '') {
    if (SENSITIVE_KEY.test(key)) return '[redacted]';
    if (Array.isArray(value)) return value.map(item => sanitize(item));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
            entryKey,
            sanitize(entryValue, entryKey)
        ]));
    }
    if (typeof value === 'string') {
        return value
            .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
            .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted-database-url]');
    }
    return value;
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableJson(value) {
    return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function parseAnimators(value = '1,2,3,4,5') {
    const animators = [...new Set(String(value).split(',').map(item => item.trim()).filter(Boolean))];
    fail(animators.length > 0 && animators.every(item => ANIMATOR_PATTERN.test(item)),
        'Animators must be a comma-separated subset of 1,2,3,4,5', 'TIMELINE_CONTROLLER_ANIMATORS_INVALID');
    return animators.sort((left, right) => Number(left) - Number(right));
}

function normalizeLiveUrl(value) {
    let url;
    try { url = new URL(String(value || '')); } catch {}
    fail(url && url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) && (!url.pathname || url.pathname === '/'),
        'Live URL is outside the trusted EventGenix allowlist', 'TIMELINE_CONTROLLER_LIVE_URL_INVALID');
    return url.origin;
}

function validateDate(value) {
    const text = cleanText(value, 10);
    const date = new Date(`${text}T00:00:00.000Z`);
    fail(DATE_PATTERN.test(text) && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === text,
        'Date must be a real YYYY-MM-DD value', 'TIMELINE_CONTROLLER_DATE_INVALID');
    return text;
}

function validateTtl(value) {
    const ttl = Number(value);
    fail(Number.isInteger(ttl) && ttl >= 5 && ttl <= 240,
        'TTL must be an integer from 5 to 240 minutes', 'TIMELINE_CONTROLLER_TTL_INVALID');
    return ttl;
}

function safeRunId(value, date) {
    const generated = `timeline-showcase-${date.replaceAll('-', '')}-${Date.now().toString(36)}`;
    const runId = cleanText(value || generated, 100);
    fail(/^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/.test(runId),
        'Run ID must contain only safe characters and be 8-100 characters', 'TIMELINE_CONTROLLER_RUN_ID_INVALID');
    return runId;
}

function isTimelineShowcaseRun(run = {}) {
    return run.source === CONTROLLER_SOURCE
        || (run.source === LEGACY_SOURCE && /^timeline-showcase-/i.test(run.runId || run.run_id || ''));
}

function cleanupConfirmation(runId, manifestHash) {
    return `${CLEANUP_CONFIRMATION_PREFIX}:${runId}:${String(manifestHash || '').slice(0, 12)}`;
}

function buildBlueprint(template, options) {
    const animatorNames = new Set(options.animators.map(number => `Аніматор ${number}`));
    const fixtures = (template.bookingBlueprints || []).filter(fixture => (
        animatorNames.has(fixture.lineName)
        && (!fixture.secondAnimatorLineName || animatorNames.has(fixture.secondAnimatorLineName))
    ));
    fail(fixtures.length > 0, 'Animator selection produced an empty fixture set', 'TIMELINE_CONTROLLER_FIXTURES_EMPTY');
    const entityCount = fixtures.length + fixtures.filter(fixture => fixture.secondAnimatorLineName).length;
    return {
        liveUrl: options.liveUrl,
        runId: options.runId,
        businessContext: 'event_genix',
        testAccountId: template.testAccountId,
        customerId: template.customerId,
        timeWindow: { date: options.date, from: '12:00', to: '20:00' },
        ttlMinutes: options.ttlMinutes,
        maxEntityCount: entityCount,
        bookingBlueprints: fixtures
    };
}

function assertStableBlueprint(first, second) {
    const left = stableJson(first);
    const right = stableJson(second);
    fail(left === right, 'Generated timeline blueprint is not stable', 'TIMELINE_CONTROLLER_BLUEPRINT_UNSTABLE');
    return sha256(left);
}

function parseSecretAssignments(source) {
    const values = Object.create(null);
    const pattern = /^\s*\$env:([A-Z][A-Z0-9_]*)\s*=\s*(['"])(.*?)\2\s*$/gm;
    for (const match of String(source || '').matchAll(pattern)) values[match[1]] = match[3];
    return values;
}

function loadOperatorEnvironment(secretFile = DEFAULT_SECRET_FILE, env = process.env) {
    fail(fs.existsSync(secretFile), 'EventGenix QA secret file is unavailable', 'TIMELINE_CONTROLLER_SECRET_FILE_MISSING');
    const values = parseSecretAssignments(fs.readFileSync(secretFile, 'utf8'));
    const operatorUrl = env.TRUSTED_QA_OPERATOR_DATABASE_URL || values.TRUSTED_QA_OPERATOR_DATABASE_URL;
    fail(Boolean(operatorUrl), 'TRUSTED_QA_OPERATOR_DATABASE_URL is unavailable', 'TIMELINE_CONTROLLER_OPERATOR_DATABASE_URL_MISSING');
    fail(!env.DATABASE_URL || env.DATABASE_URL === operatorUrl,
        'DATABASE_URL differs from TRUSTED_QA_OPERATOR_DATABASE_URL', 'TIMELINE_CONTROLLER_DATABASE_URL_MISMATCH');
    env.TRUSTED_QA_OPERATOR_DATABASE_URL = operatorUrl;
    env.DATABASE_URL = operatorUrl;
    for (const key of ['LIVE_SMOKE_URL', 'LIVE_SMOKE_USER', 'LIVE_SMOKE_PASS', 'LIVE_CREATOR_USER', 'LIVE_CREATOR_PASS']) {
        if (!env[key] && values[key]) env[key] = values[key];
    }
    return { loaded: true };
}

function normalizeAuditRow(row = {}) {
    const registeredSource = Array.isArray(row.registeredBookingIds) ? row.registeredBookingIds : row.bookingIds;
    const registered = Array.isArray(registeredSource) ? registeredSource.map(String).sort() : [];
    const marked = Array.isArray(row.markedBookingIds) ? row.markedBookingIds.map(String).sort() : [];
    const mismatchIds = [...new Set([...registered.filter(id => !marked.includes(id)), ...marked.filter(id => !registered.includes(id))])].sort();
    const rawExpiresAt = row.expiresAt ?? row.expires_at ?? null;
    const expiresAt = rawExpiresAt instanceof Date
        ? rawExpiresAt.toISOString()
        : (rawExpiresAt ? String(rawExpiresAt) : null);
    return {
        databaseId: Number(row.databaseId ?? row.id),
        runId: cleanText(row.runId ?? row.run_id, 100),
        state: cleanText(row.state, 30),
        source: cleanText(row.source, 100),
        expiresAt,
        cleanupAttempts: Number(row.cleanupAttempts ?? row.cleanup_attempts ?? 0),
        exactEntityCount: Number(row.exactEntityCount ?? row.entity_count ?? registered.length),
        bookingIds: registered,
        markedBookingIds: marked,
        ownershipComplete: mismatchIds.length === 0,
        mismatchEntityIds: mismatchIds,
        blockerReason: cleanText(row.blockerReason ?? row.blocked_reason ?? row.cleanup_last_error, 500) || null
    };
}

function publicRunStatus(row) {
    const run = normalizeAuditRow(row);
    const recoveryCommand = run.state === 'blocked'
        ? `npm run qa:timeline:controller -- --action status --run-id ${run.runId}`
        : null;
    return sanitize({
        runId: run.runId,
        databaseId: run.databaseId,
        state: run.state,
        source: run.source,
        expiresAt: run.expiresAt,
        cleanupAttempts: run.cleanupAttempts,
        exactEntityCount: run.exactEntityCount,
        bookingIds: run.bookingIds,
        blockerReason: run.blockerReason,
        ownershipComplete: run.ownershipComplete,
        mismatchEntityIds: run.mismatchEntityIds,
        recoveryCommand
    });
}

function defaultOutputDirectory(runId) {
    return path.join(os.tmpdir(), 'eventgenix-trusted-qa-reports', runId);
}

function ensureOutputDirectory(directory) {
    const target = path.resolve(directory);
    fs.mkdirSync(target, { recursive: true });
    return target;
}

function writeSanitizedReport(outputDirectory, name, report) {
    const file = path.join(outputDirectory, name);
    fs.writeFileSync(file, stableJson(sanitize(report)), { encoding: 'utf8', flag: 'w' });
    return file;
}

function defaultRuntime() {
    loadOperatorEnvironment();
    const { pool } = require('../db');
    const trusted = require('../services/trustedQaRuns');
    const showcase = require('./trusted-qa-timeline-showcase');
    return {
        async audit(runId = null) {
            const result = await pool.query(
                `SELECT r.id AS "databaseId", r.run_id AS "runId", r.state, r.source,
                        r.expires_at AS "expiresAt", COALESCE(r.cleanup_attempts, 0) AS "cleanupAttempts",
                        r.blocked_reason AS "blockerReason",
                        COUNT(e.id)::int AS "exactEntityCount",
                        COALESCE(ARRAY_AGG(e.entity_id ORDER BY e.entity_id)
                            FILTER (WHERE e.entity_type = 'booking'), ARRAY[]::text[]) AS "registeredBookingIds"
                   FROM trusted_qa_runs r
                   LEFT JOIN trusted_qa_run_entities e ON e.run_id = r.id
                  WHERE ($1::text IS NULL OR r.run_id = $1)
                  GROUP BY r.id
                  ORDER BY r.id DESC
                  LIMIT 50`,
                [runId]
            );
            const runs = [];
            for (const row of result.rows || []) {
                const marked = await pool.query(
                    `SELECT id::text
                       FROM bookings
                      WHERE COALESCE(extra_data #>> '{disposableQa,runId}', '') = $1
                        AND COALESCE(NULLIF(BTRIM(business_context), ''), 'event_genix') = 'event_genix'
                      ORDER BY id::text`,
                    [row.runId]
                );
                runs.push(normalizeAuditRow({ ...row, markedBookingIds: marked.rows.map(item => String(item.id)) }));
            }
            return runs;
        },
        async markBlocked(run, reason) {
            return trusted.markTrustedQaRunBlocked(pool, run.databaseId, reason);
        },
        async recover(run) {
            return trusted.runTrustedQaCleanupWatchdog({
                runDatabaseId: run.databaseId,
                allowedSources: [run.source],
                limit: 1
            });
        },
        prepare: showcase.prepareShowcase,
        apply: showcase.applyShowcase,
        verify: showcase.verifyShowcase,
        cleanup: showcase.cleanupShowcase,
        readManifest: showcase.readManifest,
        readBlueprint: showcase.readPreparationBlueprint,
        manifestHash: showcase.manifestHash,
        applyConfirmation: showcase.APPLY_CONFIRMATION,
        cleanupConfirmation: showcase.CLEANUP_CONFIRMATION,
        async browserMatrix(options) {
            const script = path.join(ROOT, 'scripts', 'trusted-qa-timeline-browser-matrix.js');
            const result = childProcess.spawnSync(process.execPath, [script,
                '--live-url', options.liveUrl,
                '--date', options.date,
                '--run-id', options.runId,
                '--state-file', options.stateFile,
                '--output-dir', options.outputDirectory,
                '--secret-file', options.secretFile
            ], { encoding: 'utf8', windowsHide: true, env: process.env });
            fail(result.status === 0, 'Timeline browser matrix failed', 'TIMELINE_CONTROLLER_BROWSER_FAILED', {
                exitCode: result.status,
                stderr: cleanText(result.stderr, 1000)
            });
            return JSON.parse(result.stdout);
        },
        async close() { await pool.end().catch(() => {}); }
    };
}

async function statusAction(options, runtime) {
    const runs = await runtime.audit(options.runId || null);
    return { success: true, action: 'status', runs: runs.map(publicRunStatus) };
}

async function recoverExpiredRuns(runtime, now = new Date()) {
    const runs = await runtime.audit(null);
    for (const run of runs) {
        if (run.state === 'cleaned') continue;
        if (run.state === 'blocked') {
            throw new TimelineControllerError('A blocked Trusted QA run requires exact operator recovery',
                'TIMELINE_CONTROLLER_BLOCKED_RUN', publicRunStatus(run));
        }
        const expired = run.expiresAt && new Date(run.expiresAt).valueOf() <= now.valueOf();
        if (run.state === 'active' && !expired) {
            throw new TimelineControllerError('An unexpired Trusted QA run blocks the singleton timeline controller',
                'TIMELINE_CONTROLLER_ACTIVE_RUN', publicRunStatus(run));
        }
        if (!['active', 'cleanup_pending'].includes(run.state)) continue;
        fail(isTimelineShowcaseRun(run), 'A non-showcase Trusted QA run requires its own operator workflow',
            'TIMELINE_CONTROLLER_FOREIGN_RUN', publicRunStatus(run));
        if (!run.ownershipComplete) {
            const reason = `registry ownership mismatch for run ${run.runId}; entity IDs: ${run.mismatchEntityIds.join(',')}`;
            await runtime.markBlocked(run, reason);
            throw new TimelineControllerError('Expired run was blocked because registry ownership is incomplete',
                'TIMELINE_CONTROLLER_REGISTRY_MISMATCH', { ...publicRunStatus(run), blockerReason: reason });
        }
        const recovery = await runtime.recover(run);
        const result = recovery.runs?.find(item => item.runId === run.runId);
        fail(result?.status === 'cleaned', 'Expired run exact cleanup did not complete',
            'TIMELINE_CONTROLLER_STALE_RECOVERY_FAILED', { ...publicRunStatus(run), recovery: sanitize(result || recovery) });
    }
}

async function runAction(options, runtime) {
    await recoverExpiredRuns(runtime);
    const template = JSON.parse(fs.readFileSync(options.blueprintFile, 'utf8'));
    const blueprint = buildBlueprint(template, options);
    assertStableBlueprint(blueprint, buildBlueprint(template, options));
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-timeline-controller-'));
    const outputDirectory = ensureOutputDirectory(options.outputDirectory);
    const blueprintFile = path.join(tempDirectory, 'blueprint.json');
    const manifestFile = path.join(tempDirectory, 'manifest.json');
    const stateFile = path.join(tempDirectory, 'state.json');
    const tokenFile = path.join(tempDirectory, 'token.txt');
    fs.writeFileSync(blueprintFile, stableJson(blueprint), { encoding: 'utf8', flag: 'wx' });
    try {
        const normalizedBlueprint = runtime.readBlueprint(blueprintFile);
        const prepared = await runtime.prepare(normalizedBlueprint, {
            outputFile: manifestFile,
            secretFile: options.secretFile
        });
        const manifest = runtime.readManifest(manifestFile);
        fail(manifest.sourceCommit === options.releaseSha && manifest.sourceBranch === options.releaseBranch,
            'Prepared manifest release identity differs from the requested exact SHA/branch',
            'TIMELINE_CONTROLLER_RELEASE_IDENTITY_MISMATCH', {
                expectedCommit: options.releaseSha,
                expectedBranch: options.releaseBranch,
                actualCommit: manifest.sourceCommit,
                actualBranch: manifest.sourceBranch
            });
        const hash = runtime.manifestHash(manifest);
        const applied = await runtime.apply(manifest, {
            confirm: runtime.applyConfirmation,
            approvedHash: hash,
            stateFile,
            tokenFile,
            secretFile: options.secretFile
        });
        const verified = await runtime.verify(manifest, { stateFile, secretFile: options.secretFile });
        const browser = await runtime.browserMatrix({
            liveUrl: options.liveUrl,
            date: options.date,
            runId: options.runId,
            stateFile,
            outputDirectory,
            secretFile: options.secretFile
        });
        const report = sanitize({
            success: true,
            action: 'run',
            runId: options.runId,
            manifestHash: hash,
            prepared,
            applied,
            verified,
            browser,
            expiresAt: applied.expiresAt,
            cleanupPolicy: 'watchdog_exact_registry_after_ttl',
            operatorFiles: { manifestFile, stateFile },
            cleanupCommand: `npm run qa:timeline:controller -- --action cleanup --run-id ${options.runId} --manifest-file "${manifestFile}" --state-file "${stateFile}" --confirmation ${cleanupConfirmation(options.runId, hash)}`
        });
        report.reportFile = writeSanitizedReport(outputDirectory, 'timeline-qa-report.json', report);
        return report;
    } catch (error) {
        writeSanitizedReport(outputDirectory, 'timeline-qa-failure.json', {
            success: false,
            runId: options.runId,
            code: error.code || 'TIMELINE_CONTROLLER_FAILED',
            message: cleanText(error.message, 500),
            details: error.details || undefined
        });
        throw error;
    }
}

async function verifyAction(options, runtime) {
    const manifest = runtime.readManifest(options.manifestFile);
    fail(manifest.runId === options.runId, 'Verify run ID differs from manifest', 'TIMELINE_CONTROLLER_VERIFY_RUN_MISMATCH');
    const result = await runtime.verify(manifest, { stateFile: options.stateFile, secretFile: options.secretFile });
    return sanitize({ success: true, action: 'verify', ...result });
}

async function cleanupAction(options, runtime) {
    const manifest = runtime.readManifest(options.manifestFile);
    const hash = runtime.manifestHash(manifest);
    fail(manifest.runId === options.runId, 'Cleanup run ID differs from manifest', 'TIMELINE_CONTROLLER_CLEANUP_RUN_MISMATCH');
    fail(options.confirmation === cleanupConfirmation(options.runId, hash),
        'Cleanup requires the exact run-bound confirmation token', 'TIMELINE_CONTROLLER_CLEANUP_CONFIRMATION_REQUIRED');
    const before = (await runtime.audit(options.runId))[0];
    fail(Boolean(before) && isTimelineShowcaseRun(before), 'Cleanup run is not registry-owned by timeline showcase',
        'TIMELINE_CONTROLLER_CLEANUP_OWNERSHIP_REQUIRED');
    fail(before.ownershipComplete, 'Cleanup registry ownership proof failed',
        'TIMELINE_CONTROLLER_REGISTRY_MISMATCH', publicRunStatus(before));
    let tokenFile = options.tokenFile;
    if (!tokenFile && options.stateFile && fs.existsSync(options.stateFile)) {
        const state = JSON.parse(fs.readFileSync(options.stateFile, 'utf8'));
        tokenFile = state.tokenFile ? path.resolve(state.tokenFile) : null;
    }
    fail(Boolean(tokenFile), 'Cleanup state does not provide its run-bound token file',
        'TIMELINE_CONTROLLER_TOKEN_FILE_REQUIRED');
    const result = await runtime.cleanup(manifest, {
        confirm: runtime.cleanupConfirmation,
        approvedHash: hash,
        stateFile: options.stateFile,
        tokenFile
    });
    const after = (await runtime.audit(options.runId))[0] || before;
    return sanitize({ success: true, action: 'cleanup', result, inventory: publicRunStatus(after) });
}

function parseOptions(argv) {
    const args = [...argv];
    const positionalAction = args[0] && !args[0].startsWith('-') ? args[0] : null;
    const action = cleanText(argValue(args, '--action', positionalAction || 'status'), 20).toLowerCase();
    fail(['status', 'run', 'verify', 'cleanup'].includes(action), 'Unsupported controller action', 'TIMELINE_CONTROLLER_ACTION_INVALID');
    const dateValue = argValue(args, '--date');
    const date = dateValue ? validateDate(dateValue) : null;
    const releaseBranch = cleanText(argValue(args, '--release-branch', ALLOWED_BRANCH), 200);
    fail(releaseBranch === ALLOWED_BRANCH, 'Release branch must be codex/eventgenix-production', 'TIMELINE_CONTROLLER_BRANCH_INVALID');
    const releaseSha = cleanText(argValue(args, '--release-sha'), 40).toLowerCase();
    if (action === 'run') fail(SHA_PATTERN.test(releaseSha), 'Run requires an exact 40-character release SHA', 'TIMELINE_CONTROLLER_SHA_INVALID');
    if (action === 'run') fail(Boolean(date), 'Run requires --date YYYY-MM-DD', 'TIMELINE_CONTROLLER_DATE_REQUIRED');
    const runIdValue = argValue(args, '--run-id');
    const runId = action === 'run' ? safeRunId(runIdValue, date) : cleanText(runIdValue, 100);
    if (['verify', 'cleanup'].includes(action)) fail(Boolean(runId), `${action} requires --run-id`, 'TIMELINE_CONTROLLER_RUN_ID_REQUIRED');
    const liveValue = argValue(args, '--live-url', 'https://8223324090-production.up.railway.app');
    return {
        action,
        date,
        ttlMinutes: action === 'run' ? validateTtl(argValue(args, '--ttl-minutes', '60')) : null,
        animators: parseAnimators(argValue(args, '--animators', '1,2,3,4,5')),
        releaseSha,
        releaseBranch,
        liveUrl: normalizeLiveUrl(liveValue),
        runId,
        blueprintFile: path.resolve(argValue(args, '--blueprint-file', DEFAULT_BLUEPRINT)),
        outputDirectory: path.resolve(argValue(args, '--output-dir', defaultOutputDirectory(runId || 'status'))),
        manifestFile: argValue(args, '--manifest-file') ? path.resolve(argValue(args, '--manifest-file')) : null,
        stateFile: argValue(args, '--state-file') ? path.resolve(argValue(args, '--state-file')) : null,
        tokenFile: argValue(args, '--token-file') ? path.resolve(argValue(args, '--token-file')) : null,
        confirmation: argValue(args, '--confirmation'),
        secretFile: path.resolve(argValue(args, '--secret-file', DEFAULT_SECRET_FILE))
    };
}

async function execute(options, runtime = null) {
    const activeRuntime = runtime || defaultRuntime();
    try {
        if (options.action === 'status') return await statusAction(options, activeRuntime);
        if (options.action === 'run') return await runAction(options, activeRuntime);
        if (options.action === 'verify') return await verifyAction(options, activeRuntime);
        return await cleanupAction(options, activeRuntime);
    } finally {
        if (!runtime) await activeRuntime.close();
    }
}

function publicError(error) {
    return sanitize({
        success: false,
        code: error?.code || 'TIMELINE_CONTROLLER_FAILED',
        message: cleanText(error?.message || 'Timeline controller failed', 500),
        details: error?.details || undefined
    });
}

async function main() {
    const options = parseOptions(process.argv.slice(2));
    if (!process.env.TRUSTED_QA_OPERATOR_DATABASE_URL) loadOperatorEnvironment(options.secretFile);
    return execute(options);
}

if (require.main === module) {
    main()
        .then(result => process.stdout.write(stableJson(sanitize(result))))
        .catch(error => {
            process.stderr.write(stableJson(publicError(error)));
            process.exitCode = 1;
        });
}

module.exports = {
    ALLOWED_BRANCH,
    CLEANUP_CONFIRMATION_PREFIX,
    CONTROLLER_SOURCE,
    TimelineControllerError,
    assertStableBlueprint,
    buildBlueprint,
    cleanupConfirmation,
    execute,
    isTimelineShowcaseRun,
    loadOperatorEnvironment,
    normalizeAuditRow,
    parseAnimators,
    parseOptions,
    publicError,
    publicRunStatus,
    recoverExpiredRuns,
    sanitize,
    stableJson,
    statusAction,
    validateTtl,
    writeSanitizedReport
};
