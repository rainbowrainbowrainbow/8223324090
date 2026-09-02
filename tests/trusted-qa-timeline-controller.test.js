'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    TimelineControllerError,
    assertStableBlueprint,
    buildBlueprint,
    cleanupConfirmation,
    execute,
    normalizeAuditRow,
    parseOptions,
    preflightAction,
    publicError,
    recoverExpiredRuns,
    sanitize,
    stableJson,
    writeSanitizedReport
} = require('../scripts/trusted-qa-timeline-controller');
const {
    MIN_COMPACT_IDENTITY_FONT_PX,
    THEMES,
    VIEWPORTS,
    ZOOMS,
    caseAcceptanceFailures
} = require('../scripts/trusted-qa-timeline-browser-matrix');

function auditRun(overrides = {}) {
    return normalizeAuditRow({
        databaseId: 28,
        runId: 'timeline-showcase-20260902-v1',
        state: 'active',
        source: 'trusted_timeline_showcase',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        cleanupAttempts: 0,
        exactEntityCount: 2,
        registeredBookingIds: ['qa-1', 'qa-2'],
        markedBookingIds: ['qa-1', 'qa-2'],
        activeMarkedBookingIds: ['qa-1', 'qa-2'],
        ...overrides
    });
}

function recoveryRuntime(runs) {
    const calls = [];
    return {
        calls,
        async audit() { return runs; },
        async markBlocked(run, reason) { calls.push(['blocked', run.runId, reason]); },
        async recover(run) {
            calls.push(['recover', run.runId]);
            return { processed: 1, runs: [{ runId: run.runId, status: 'cleaned', state: 'cleaned' }] };
        }
    };
}

test('expired active timeline showcase enters exact watchdog cleanup flow', async () => {
    const runtime = recoveryRuntime([auditRun()]);
    await recoverExpiredRuns(runtime);
    assert.deepEqual(runtime.calls, [['recover', 'timeline-showcase-20260902-v1']]);
});

test('cleaned run does not block the next controller run', async () => {
    const runtime = recoveryRuntime([auditRun({ state: 'cleaned' })]);
    await recoverExpiredRuns(runtime);
    assert.deepEqual(runtime.calls, []);
});

test('unexpired active run blocks the singleton controller with exact evidence', async () => {
    const runtime = recoveryRuntime([auditRun({ expiresAt: new Date(Date.now() + 60_000).toISOString() })]);
    await assert.rejects(
        recoverExpiredRuns(runtime),
        error => error instanceof TimelineControllerError
            && error.code === 'TIMELINE_CONTROLLER_ACTIVE_RUN'
            && error.details.runId === 'timeline-showcase-20260902-v1'
            && error.details.bookingIds.join(',') === 'qa-1,qa-2'
    );
});

test('blocked run reports the exact run, entities, and safe recovery command', async () => {
    const runtime = recoveryRuntime([auditRun({ state: 'blocked', blockerReason: 'marker drift qa-2' })]);
    await assert.rejects(
        recoverExpiredRuns(runtime),
        error => error.code === 'TIMELINE_CONTROLLER_BLOCKED_RUN'
            && error.details.runId === 'timeline-showcase-20260902-v1'
            && error.details.recoveryCommand.includes('--action status --run-id timeline-showcase-20260902-v1')
    );
});

test('registry mismatch marks the run blocked and never invokes cleanup', async () => {
    const runtime = recoveryRuntime([auditRun({ markedBookingIds: ['qa-1', 'unregistered-9'] })]);
    await assert.rejects(recoverExpiredRuns(runtime), error => error.code === 'TIMELINE_CONTROLLER_REGISTRY_MISMATCH');
    assert.equal(runtime.calls.some(call => call[0] === 'recover'), false);
    assert.equal(runtime.calls[0][0], 'blocked');
    assert.match(runtime.calls[0][2], /qa-2,unregistered-9|unregistered-9,qa-2/);
});

test('cleanup refuses an unregistered booking before the cleanup service can mutate it', async () => {
    const manifest = { runId: 'timeline-showcase-20260902-v1' };
    const runtime = {
        readManifest() { return manifest; },
        manifestHash() { return 'a'.repeat(64); },
        async audit() { return [auditRun({ markedBookingIds: ['qa-1', 'unregistered-9'] })]; },
        async cleanup() { throw new Error('cleanup must not be reached'); }
    };
    await assert.rejects(
        execute({
            action: 'cleanup',
            runId: manifest.runId,
            manifestFile: 'manifest.json',
            stateFile: 'state.json',
            tokenFile: 'token.txt',
            confirmation: cleanupConfirmation(manifest.runId, 'a'.repeat(64))
        }, runtime),
        error => error.code === 'TIMELINE_CONTROLLER_REGISTRY_MISMATCH'
    );
});

test('repeat cleanup is idempotent for the same exact registry-owned run', async () => {
    const manifest = { runId: 'timeline-showcase-20260902-v1' };
    let cleanupCalls = 0;
    const runtime = {
        cleanupConfirmation: 'CLEANUP_EXACT_TIMELINE_SHOWCASE',
        readManifest() { return manifest; },
        manifestHash() { return 'b'.repeat(64); },
        async audit() { return [auditRun({ state: cleanupCalls ? 'cleaned' : 'active' })]; },
        async cleanup() {
            cleanupCalls += 1;
            return { status: 'cleaned', idempotent: cleanupCalls > 1 };
        }
    };
    const options = {
        action: 'cleanup', runId: manifest.runId, manifestFile: 'manifest.json', stateFile: 'state.json', tokenFile: 'token.txt',
        confirmation: cleanupConfirmation(manifest.runId, 'b'.repeat(64))
    };
    assert.equal((await execute(options, runtime)).result.status, 'cleaned');
    assert.equal((await execute(options, runtime)).result.idempotent, true);
    assert.equal(cleanupCalls, 2);
});

test('controller enforces TTL 5-240 minutes', () => {
    const common = ['--action', 'run', '--date', '2026-09-02', '--release-sha', 'a'.repeat(40)];
    assert.equal(parseOptions([...common, '--ttl-minutes', '5']).ttlMinutes, 5);
    assert.equal(parseOptions([...common, '--ttl-minutes', '240']).ttlMinutes, 240);
    assert.throws(() => parseOptions([...common, '--ttl-minutes', '241']), error => error.code === 'TIMELINE_CONTROLLER_TTL_INVALID');
    assert.throws(() => parseOptions([...common, '--ttl-minutes', '4']), error => error.code === 'TIMELINE_CONTROLLER_TTL_INVALID');
});

test('controller accepts only an exact one-fixture canary limit', () => {
    const common = ['--action', 'run', '--date', '2026-09-03', '--release-sha', 'a'.repeat(40), '--animators', '1'];
    assert.equal(parseOptions([...common, '--fixture-limit', '1']).fixtureLimit, 1);
    assert.throws(() => parseOptions([...common, '--fixture-limit', '2']),
        error => error.code === 'TIMELINE_CONTROLLER_FIXTURE_LIMIT_INVALID');
    assert.throws(() => parseOptions([...common, '--fixture-limit', 'all']),
        error => error.code === 'TIMELINE_CONTROLLER_FIXTURE_LIMIT_INVALID');
});

test('sanitized stdout/report removes secrets, tokens, and database URLs', () => {
    const raw = {
        password: 'never-print',
        nested: { accessToken: 'secret-token', note: 'Bearer abc.def.ghi' },
        error: 'connect postgres://operator:password@db.internal/eventgenix'
    };
    const output = stableJson(sanitize(raw));
    assert.doesNotMatch(output, /never-print|secret-token|operator:password|abc\.def\.ghi/);
    assert.match(output, /\[redacted\]/);
});

test('Windows wrapper forces UTF-8 for Ukrainian controller arguments', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'trusted-qa-timeline-controller.ps1'), 'utf8');
    assert.match(source, /UTF8Encoding/);
    assert.match(source, /Console\]::OutputEncoding/);
    assert.match(source, /@ControllerArguments/);
    assert.match(source, /trusted-qa-timeline-controller\.js/);
});

test('controller produces a stable bounded blueprint for the same matrix', () => {
    const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'trusted-qa-timeline-showcase-2026-09-02.json'), 'utf8'));
    const options = {
        liveUrl: 'https://8223324090-production.up.railway.app',
        runId: 'timeline-showcase-stable-1',
        date: '2026-09-02',
        ttlMinutes: 60,
        animators: ['1', '2', '3', '4', '5']
    };
    const first = buildBlueprint(template, options);
    const second = buildBlueprint(template, options);
    assert.equal(assertStableBlueprint(first, second).length, 64);
    assert.equal(first.maxEntityCount, 36);
    assert.equal(first.bookingBlueprints.length, 28);
});

test('one-fixture canary deterministically selects one unlinked booking entity', () => {
    const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'trusted-qa-timeline-showcase-2026-09-02.json'), 'utf8'));
    const options = {
        liveUrl: 'https://8223324090-production.up.railway.app',
        runId: 'timeline-canary-stable-1',
        date: '2026-09-03',
        ttlMinutes: 15,
        animators: ['1'],
        fixtureLimit: 1
    };
    const first = buildBlueprint(template, options);
    const second = buildBlueprint(template, options);
    assert.equal(assertStableBlueprint(first, second).length, 64);
    assert.equal(first.maxEntityCount, 1);
    assert.equal(first.bookingBlueprints.length, 1);
    assert.equal(first.bookingBlueprints[0].secondAnimatorLineName, undefined);
});

test('preflight is read-only and validates one available canary fixture', async () => {
    let applyCalls = 0;
    const options = {
        liveUrl: 'https://8223324090-production.up.railway.app',
        runId: 'timeline-canary-preflight-1',
        date: '2026-09-02',
        ttlMinutes: 15,
        animators: ['1'],
        fixtureLimit: 1,
        releaseSha: 'a'.repeat(40),
        releaseBranch: 'codex/eventgenix-production',
        blueprintFile: path.join(__dirname, '..', 'config', 'trusted-qa-timeline-showcase-2026-09-02.json'),
        secretFile: 'unused-in-test'
    };
    const result = await preflightAction(options, {
        async audit() { return []; },
        readBlueprint(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); },
        async prepare(_blueprint, prepareOptions) {
            fs.writeFileSync(prepareOptions.outputFile, '{}');
            return { fixtureCount: 1, expectedEntityCount: 1, lineCount: 5, productCount: 27, collisionFree: true };
        },
        readManifest() { return { sourceCommit: options.releaseSha, sourceBranch: options.releaseBranch }; },
        async apply() { applyCalls += 1; }
    });
    assert.equal(result.success, true);
    assert.equal(result.action, 'preflight');
    assert.equal(result.expectedEntityCount, 1);
    assert.equal(applyCalls, 0);
});

test('preflight fails closed on any non-cleaned registry run without recovering it', async () => {
    let recoveryCalls = 0;
    const options = {
        runId: 'timeline-canary-preflight-blocked',
        date: '2026-09-02',
        ttlMinutes: 15,
        animators: ['1'],
        fixtureLimit: 1,
        releaseSha: 'a'.repeat(40),
        releaseBranch: 'codex/eventgenix-production',
        blueprintFile: path.join(__dirname, '..', 'config', 'trusted-qa-timeline-showcase-2026-09-02.json')
    };
    await assert.rejects(
        preflightAction(options, {
            async audit() { return [auditRun({ state: 'active' })]; },
            async recover() { recoveryCalls += 1; }
        }),
        error => error.code === 'TIMELINE_CONTROLLER_PREFLIGHT_BLOCKED'
    );
    assert.equal(recoveryCalls, 0);
});

test('browser reports stay sanitized when written to disk', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-controller-report-'));
    try {
        const file = writeSanitizedReport(directory, 'report.json', {
            browser: { cases: [{ viewport: 'mobile', screenshot: 'timeline-mobile.png' }] },
            token: 'must-not-appear',
            databaseUrl: 'postgres://must-not-appear'
        });
        const output = fs.readFileSync(file, 'utf8');
        assert.match(output, /timeline-mobile\.png/);
        assert.doesNotMatch(output, /must-not-appear/);
        assert.doesNotMatch(output, /postgres:/);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('responsive browser matrix changes zoom without requiring a visible desktop control', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'trusted-qa-timeline-browser-matrix.js'),
        'utf8'
    );
    assert.match(source, /page\.evaluate\(expected => \{/);
    assert.match(source, /button\.click\(\)/);
    assert.doesNotMatch(source, /locator\(`\.zoom-btn\[data-zoom=/);
    assert.match(source, /requestUrl\.origin !== base/);
    assert.match(source, /suppressedExternalWriteCount/);
    assert.deepEqual(THEMES, ['dark', 'light']);
    assert.equal(VIEWPORTS.length * ZOOMS.length * THEMES.length, 18);
    assert.match(source, /for \(const theme of THEMES\)/);
    assert.match(source, /pinataCharacterStackRequired = narrowPinata && zoomLevel >= 30/);
    assert.match(source, /pinataCharacterStackForbidden = narrowPinata && zoomLevel === 15/);
    assert.match(source, /\{ ids: bookingIds, zoomLevel: zoom \}/);
});

test('responsive browser matrix fails closed on unreadable or generic timeline identities', () => {
    assert.equal(MIN_COMPACT_IDENTITY_FONT_PX, 9);
    assert.deepEqual(caseAcceptanceFailures({
        tinyFontBookingIds: ['qa-pinata'],
        genericOnlyBookingIds: ['qa-show'],
        invalidPinataStackBookingIds: ['qa-pinata'],
        ambiguousCustomIdentityBookingIds: ['qa-custom'],
        categoryMismatchBookingIds: [],
        missingBookingIds: []
    }), [
        'tinyFontBookingIds:qa-pinata',
        'genericOnlyBookingIds:qa-show',
        'invalidPinataStackBookingIds:qa-pinata',
        'ambiguousCustomIdentityBookingIds:qa-custom'
    ]);
    assert.deepEqual(caseAcceptanceFailures({}), []);
});

test('status serializes PostgreSQL timestamp objects as ISO strings', () => {
    const run = normalizeAuditRow({
        databaseId: 31,
        runId: 'timeline-showcase-date-serialization',
        state: 'active',
        source: 'trusted_timeline_showcase',
        expiresAt: new Date('2026-09-01T20:00:00.000Z'),
        registeredBookingIds: [],
        markedBookingIds: []
    });
    assert.equal(run.expiresAt, '2026-09-01T20:00:00.000Z');
    assert.match(stableJson(run), /2026-09-01T20:00:00\.000Z/);
});

test('status separates immutable registry inventory from active booking postcondition', () => {
    const cleaned = normalizeAuditRow({
        databaseId: 34,
        runId: 'timeline-showcase-cleaned',
        state: 'cleaned',
        exactEntityCount: 1,
        registeredBookingIds: ['BK-QA-1'],
        markedBookingIds: ['BK-QA-1'],
        activeMarkedBookingIds: []
    });
    assert.equal(cleaned.exactEntityCount, 1);
    assert.equal(cleaned.activeBookingCount, 0);
    assert.equal(cleaned.ownershipComplete, true);

    const active = normalizeAuditRow({
        databaseId: 35,
        runId: 'timeline-showcase-active',
        state: 'active',
        exactEntityCount: 1,
        registeredBookingIds: ['BK-QA-2'],
        markedBookingIds: ['BK-QA-2'],
        activeMarkedBookingIds: ['BK-QA-2']
    });
    assert.equal(active.activeBookingCount, 1);
});

test('public errors never echo a protected value from details', () => {
    const error = new TimelineControllerError('safe failure', 'SAFE_FAILURE', { password: 'unsafe', bookingIds: ['qa-1'] });
    const output = JSON.stringify(publicError(error));
    assert.doesNotMatch(output, /unsafe/);
    assert.match(output, /qa-1/);
});
