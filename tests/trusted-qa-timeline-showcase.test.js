'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    APPLY_CONFIRMATION,
    TimelineShowcaseError,
    applyShowcase,
    assertCheckoutFacts,
    assertExactRegistryRows,
    assertNoUnrelatedCustomerBookings,
    assertOwnedTokenFile,
    assertPersistedLineIds,
    assertRunEnvelope,
    assertTrustedReadback,
    buildBookingPayload,
    compilePreparedManifest,
    exactFixtureEnvelope,
    initialState,
    manifestHash,
    normalizeManifest,
    normalizePreparationBlueprint,
    prepareShowcase,
    resolveExactQaCustomerId
} = require('../scripts/trusted-qa-timeline-showcase');

function rawFixture(overrides = {}) {
    return {
        key: 'quest-one',
        programId: 'quest-1',
        lineId: 'animator-1',
        lineName: 'Аніматор 1',
        date: '2026-08-29',
        time: '12:00',
        duration: 60,
        status: 'confirmed',
        programCode: 'Q1',
        programName: 'Quest One',
        label: 'Quest One',
        category: 'quest',
        hosts: 1,
        pinataMode: 'none',
        ...overrides
    };
}

function rawManifest(overrides = {}) {
    return {
        sourceCommit: 'a'.repeat(40),
        sourceBranch: 'codex/eventgenix-production',
        liveUrl: 'https://eventgenix.example.test/path-is-ignored',
        runId: 'timeline-showcase-20260829',
        businessContext: 'event_genix',
        testAccountId: 48,
        operatorUserId: 48,
        customerId: 219,
        timeWindow: { date: '2026-08-29', from: '12:00', to: '20:00' },
        ttlMinutes: 60,
        bookingFixtures: [
            rawFixture(),
            rawFixture({
                key: 'show-two',
                programId: 'show-2',
                lineId: 'animator-2',
                lineName: 'Аніматор 2',
                time: '13:00',
                duration: 30,
                programCode: 'S2',
                programName: 'Show Two',
                label: 'Show Two',
                category: 'show'
            })
        ],
        ...overrides
    };
}

function normalizedManifest(overrides = {}) {
    return normalizeManifest(rawManifest(overrides));
}

function rawBlueprint(overrides = {}) {
    return {
        liveUrl: 'https://eventgenix.example.test',
        runId: 'timeline-showcase-prepare-20260829',
        testAccountId: 48,
        customerId: 219,
        date: '2026-08-29',
        timeWindow: { date: '2026-08-29', from: '12:00', to: '20:00' },
        bookingBlueprints: [
            { key: 'quest-one', productId: 'quest-1', lineName: 'Аніматор 1', time: '12:00' },
            { key: 'show-two', productId: 'show-2', lineName: 'Аніматор 2', time: '13:00' }
        ],
        ...overrides
    };
}

function preparationCatalog(overrides = {}) {
    return {
        release: {
            commit: 'b'.repeat(40),
            branch: 'codex/eventgenix-production'
        },
        lineByName: {
            'Аніматор 1': { id: 'animator-1', name: 'Аніматор 1', assignmentAllowed: true },
            'Аніматор 2': { id: 'animator-2', name: 'Аніматор 2', assignmentAllowed: true },
            'Аніматор 3': { id: 'animator-3', name: 'Аніматор 3', assignmentAllowed: true },
            'Аніматор 4': { id: 'animator-4', name: 'Аніматор 4', assignmentAllowed: true },
            'Аніматор 5': { id: 'animator-5', name: 'Аніматор 5', assignmentAllowed: true }
        },
        productById: {
            'quest-1': { id: 'quest-1', code: 'Q1', name: 'Quest One', label: 'Quest One', category: 'quest', duration: 60, hosts: 1, isActive: true },
            'show-2': { id: 'show-2', code: 'S2', name: 'Show Two', label: 'Show Two', category: 'show', duration: 30, hosts: 1, isActive: true }
        },
        ...overrides
    };
}

function fakePreparationRuntime() {
    const calls = [];
    return {
        calls,
        async authenticatePreparation() {
            calls.push('authenticatePreparation');
            return { accessToken: 'not-returned', user: { id: 48, role: 'creator' } };
        },
        async preparationCatalog() {
            calls.push('preparationCatalog');
            return preparationCatalog();
        },
        async resolvePreparationCustomer() {
            calls.push('resolvePreparationCustomer');
            return { testAccountId: 48, customerId: 219 };
        },
        async livePreflight(manifest) {
            calls.push('livePreflight');
            return {
                lineCount: new Set(manifest.bookingFixtures.flatMap(fixture => [fixture.lineId, fixture.secondAnimatorLineId].filter(Boolean))).size,
                productCount: new Set(manifest.bookingFixtures.map(fixture => fixture.productId)).size
            };
        },
        async databasePreflight() {
            calls.push('databasePreflight');
            return { collisionFree: true };
        },
        async createRun() {
            calls.push('UNSAFE:createRun');
            throw new Error('prepare must not create a run');
        },
        async createFixture() {
            calls.push('UNSAFE:createFixture');
            throw new Error('prepare must not create a fixture');
        },
        async cleanupRun() {
            calls.push('UNSAFE:cleanupRun');
            throw new Error('prepare must not clean up');
        }
    };
}

function fakeRun(manifest, token = 'server-issued-token-value-for-unit-test') {
    return {
        id: 901,
        run_id: manifest.runId,
        token_hash: crypto.createHash('sha256').update(token).digest('hex'),
        source: 'trusted_timeline_showcase',
        business_context: manifest.businessContext,
        operator_user_id: manifest.operatorUserId,
        required_operator_user_id: manifest.operatorUserId,
        required_user_id: manifest.testAccountId,
        required_customer_id: manifest.customerId,
        required_program_id: null,
        required_product_id: null,
        required_room_resource_id: null,
        required_line_id: null,
        test_customer_marker: `${manifest.runId}:customer:${manifest.customerId}`,
        allowed_date: manifest.timeWindow.date,
        allowed_start_time: `${manifest.timeWindow.from}:00`,
        allowed_end_time: `${manifest.timeWindow.to}:00`,
        max_entity_count: manifest.expectedEntityCount,
        state: 'active',
        expires_at: new Date(Date.now() + (manifest.ttlMinutes * 60_000)).toISOString(),
        allowed_endpoints: {
            endpoints: manifest.allowedEndpoints,
            bookingFixtures: manifest.bookingFixtures.map(exactFixtureEnvelope)
        }
    };
}

function temporaryOperatorFiles() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-showcase-runner-'));
    return {
        directory,
        stateFile: path.join(directory, 'state.json'),
        tokenFile: path.join(directory, 'token.txt'),
        cleanup() {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    };
}

function fakeCatalog(manifest) {
    const products = {};
    const lines = {};
    for (const fixture of manifest.bookingFixtures) {
        products[fixture.productId] = {
            id: fixture.productId,
            code: fixture.booking.programCode,
            name: fixture.booking.programName,
            label: fixture.booking.label,
            category: fixture.booking.category,
            duration: fixture.duration,
            hosts: fixture.booking.hosts
        };
        lines[fixture.lineId] = { id: fixture.lineId, name: fixture.lineName };
        if (fixture.secondAnimatorLineId) {
            lines[fixture.secondAnimatorLineId] = {
                id: fixture.secondAnimatorLineId,
                name: fixture.secondAnimator
            };
        }
    }
    return {
        products,
        lines,
        rooms: {
            'room-takeaway': {
                id: 'room-takeaway',
                resourceId: 'room-takeaway',
                name: 'На виніс',
                metadata: { takeaway: true }
            }
        }
    };
}

function fakeRuntime(options = {}) {
    const calls = [];
    const recovered = new Map();
    let run = options.existingRun || null;
    let createIndex = 0;
    const runtime = {
        calls,
        recovered,
        async assertLocalCheckout() {
            calls.push('assertLocalCheckout');
            return { clean: true };
        },
        async authenticate(manifest) {
            calls.push('authenticate');
            return { accessToken: 'access-token-not-persisted', user: { id: manifest.testAccountId } };
        },
        async livePreflight(manifest) {
            calls.push('livePreflight');
            return {
                release: { commit: manifest.sourceCommit, branch: manifest.sourceBranch },
                userId: manifest.testAccountId,
                lineCount: 3,
                roomCount: 1,
                productCount: manifest.bookingFixtures.length,
                visibleExistingBookingCount: 0,
                catalog: fakeCatalog(manifest)
            };
        },
        async databasePreflight() {
            calls.push('databasePreflight');
            return { collisionFree: true };
        },
        async lookupRun() {
            calls.push('lookupRun');
            return run;
        },
        async createRun(manifest, tokenFile) {
            calls.push('createRun');
            const token = 'server-issued-token-value-for-unit-test';
            fs.writeFileSync(tokenFile, token, { flag: 'wx' });
            run = fakeRun(manifest, token);
            Object.assign(run, {
                id: 901,
                allowed_endpoints: {
                    endpoints: manifest.allowedEndpoints,
                    bookingFixtures: manifest.bookingFixtures.map(exactFixtureEnvelope)
                }
            });
            return { run, token };
        },
        async resumeRun(manifest, state, tokenFile) {
            calls.push('resumeRun');
            if (options.resumeError) throw options.resumeError;
            assert.equal(fs.readFileSync(tokenFile, 'utf8'), 'server-issued-token-value-for-unit-test');
            assert.equal(Number(state.runDatabaseId), Number(run.id));
            return { run, token: 'server-issued-token-value-for-unit-test' };
        },
        async recoverFixture(manifest, fixture) {
            calls.push(`recover:${fixture.key}`);
            return recovered.get(fixture.key) || null;
        },
        async createFixture(manifest, fixture) {
            calls.push(`create:${fixture.key}`);
            createIndex += 1;
            if (options.failFixtureKey === fixture.key) {
                throw new TimelineShowcaseError('simulated fixture transport failure', 'SIMULATED_FIXTURE_FAILURE');
            }
            const bookingIds = [`BK-2099-${String(createIndex).padStart(4, '0')}`];
            if (fixture.secondAnimatorLineId) bookingIds.push(`BK-2099-${String(createIndex + 100).padStart(4, '0')}`);
            const value = { primaryBookingId: bookingIds[0], bookingIds: bookingIds.sort() };
            recovered.set(fixture.key, value);
            return value;
        },
        async verifyBatch(manifest, state) {
            calls.push('verifyBatch');
            return {
                fixtureCount: manifest.bookingFixtures.length,
                bookingCount: state.fixtures.flatMap(item => item.bookingIds).length
            };
        },
        async cleanupRun() {
            calls.push('cleanupRun');
            if (options.cleanupFails) {
                throw new TimelineShowcaseError('simulated cleanup failure', 'SIMULATED_CLEANUP_FAILURE');
            }
            if (run) run.state = 'cleaned';
            return { status: 'cleaned', state: 'cleaned' };
        },
        async scheduleCleanupRecovery() {
            calls.push('scheduleCleanupRecovery');
            return { state: 'cleanup_pending' };
        }
    };
    return runtime;
}

test('showcase manifest canonicalizes exact fixtures and enforces the exact entity bound', () => {
    const first = normalizedManifest();
    const second = normalizedManifest({
        bookingFixtures: [
            rawFixture({ requestId: first.bookingFixtures[0].requestId }),
            rawFixture({
                key: 'show-two',
                requestId: first.bookingFixtures[1].requestId,
                programId: 'show-2',
                lineId: 'animator-2',
                lineName: 'Аніматор 2',
                time: '13:00',
                duration: 30,
                programCode: 'S2',
                programName: 'Show Two',
                label: 'Show Two',
                category: 'show'
            })
        ]
    });

    assert.equal(first.liveUrl, 'https://eventgenix.example.test');
    assert.equal(first.carrierResource.resourceId, 'room-takeaway');
    assert.equal(first.expectedEntityCount, 2);
    assert.equal(first.maxEntityCount, first.expectedEntityCount);
    assert.equal(manifestHash(first), manifestHash(second));
    assert.match(first.bookingFixtures[0].requestId, /^timeline-showcase-20260829:01:/);
});

test('showcase manifest fails closed on unsafe carrier and internal line collisions', () => {
    assert.throws(
        () => normalizedManifest({ resourcePolicy: 'explicit_rooms', roomResourceId: 'room-marvel', room: 'Marvel' }),
        error => error.code === 'SHOWCASE_RESOURCE_POLICY_INVALID'
    );
    assert.throws(
        () => normalizedManifest({
            bookingFixtures: [
                rawFixture(),
                rawFixture({
                    key: 'overlap',
                    programId: 'show-2',
                    lineId: 'animator-1',
                    time: '12:30',
                    duration: 30,
                    programCode: 'S2',
                    programName: 'Show Two',
                    label: 'Show Two',
                    category: 'show'
                })
            ]
        }),
        error => error.code === 'SHOWCASE_FIXTURE_LINE_COLLISION'
    );
    assert.throws(
        () => normalizedManifest({ maxEntityCount: 100 }),
        error => error.code === 'SHOWCASE_ENTITY_BOUND_INVALID'
    );
});

test('prepare compiler derives exact live snapshots and fails on missing line or product', () => {
    const blueprint = normalizePreparationBlueprint(rawBlueprint());
    const manifest = compilePreparedManifest(blueprint, preparationCatalog(), {
        testAccountId: 48,
        customerId: 219
    });
    assert.equal(manifest.sourceCommit, 'b'.repeat(40));
    assert.equal(manifest.bookingFixtures[0].lineName, 'Аніматор 1');
    assert.equal(manifest.bookingFixtures[0].duration, 60);
    assert.equal(manifest.bookingFixtures[0].booking.hosts, 1);
    assert.equal(manifest.bookingFixtures[0].booking.programName, 'Quest One');

    const datedBlueprint = normalizePreparationBlueprint(rawBlueprint({
        date: '2026-09-02',
        timeWindow: { date: '2026-09-02', from: '12:00', to: '20:00' },
        bookingBlueprints: [
            { key: 'quest-five', productId: 'quest-1', lineName: 'Аніматор 5', time: '12:00' }
        ]
    }));
    const datedManifest = compilePreparedManifest(datedBlueprint, preparationCatalog(), {
        testAccountId: 48,
        customerId: 219
    });
    assert.equal(datedManifest.timeWindow.date, '2026-09-02');
    assert.equal(datedManifest.bookingFixtures[0].date, '2026-09-02');
    assert.equal(datedManifest.bookingFixtures[0].lineName, 'Аніматор 5');

    const missingLineCatalog = preparationCatalog();
    delete missingLineCatalog.lineByName['Аніматор 1'];
    assert.throws(
        () => compilePreparedManifest(blueprint, missingLineCatalog, { testAccountId: 48, customerId: 219 }),
        error => error.code === 'SHOWCASE_PREPARE_LINE_MISSING'
    );
    const missingProductCatalog = preparationCatalog();
    delete missingProductCatalog.productById['quest-1'];
    assert.throws(
        () => compilePreparedManifest(blueprint, missingProductCatalog, { testAccountId: 48, customerId: 219 }),
        error => error.code === 'SHOWCASE_PREPARE_PRODUCT_MISSING'
    );
});

test('approved 2026-08-29 blueprint normalizes to the exact 22-slot / 25-entity boundary', () => {
    const blueprintPath = path.join(__dirname, '..', 'config', 'trusted-qa-timeline-showcase-2026-08-29.json');
    const blueprint = normalizePreparationBlueprint(JSON.parse(fs.readFileSync(blueprintPath, 'utf8')));
    assert.equal(blueprint.date, '2026-08-29');
    assert.deepEqual(blueprint.timeWindow, { date: '2026-08-29', from: '12:00', to: '20:00' });
    assert.equal(blueprint.testAccountId, 4);
    assert.equal(blueprint.customerId, 219);
    assert.equal(blueprint.bookingBlueprints.length, 22);
    assert.equal(blueprint.maxEntityCount, 25);
    assert.equal(blueprint.bookingBlueprints.filter(fixture => fixture.secondAnimatorLineName).length, 3);
    assert.equal(blueprint.bookingBlueprints.length
        + blueprint.bookingBlueprints.filter(fixture => fixture.secondAnimatorLineName).length, 25);
    assert.deepEqual(
        [...new Set(blueprint.bookingBlueprints.flatMap(fixture => [fixture.lineName, fixture.secondAnimatorLineName].filter(Boolean)))].sort(),
        ['Аніматор 1', 'Аніматор 2', 'Аніматор 3']
    );
});

test('approved 2026-09-02 blueprint covers all quest SKUs and five animator lines within the exact graph bound', () => {
    const blueprintPath = path.join(__dirname, '..', 'config', 'trusted-qa-timeline-showcase-2026-09-02.json');
    const blueprint = normalizePreparationBlueprint(JSON.parse(fs.readFileSync(blueprintPath, 'utf8')));
    assert.equal(blueprint.date, '2026-09-02');
    assert.deepEqual(blueprint.timeWindow, { date: '2026-09-02', from: '12:00', to: '20:00' });
    assert.equal(blueprint.ttlMinutes, 60);
    assert.equal(blueprint.bookingBlueprints.length, 28);
    assert.equal(blueprint.maxEntityCount, 36);
    assert.equal(blueprint.bookingBlueprints.filter(fixture => fixture.secondAnimatorLineName).length, 8);
    assert.equal(blueprint.bookingBlueprints.length
        + blueprint.bookingBlueprints.filter(fixture => fixture.secondAnimatorLineName).length, 36);
    assert.deepEqual(
        [...new Set(blueprint.bookingBlueprints.flatMap(fixture => [fixture.lineName, fixture.secondAnimatorLineName].filter(Boolean)))].sort(),
        ['Аніматор 1', 'Аніматор 2', 'Аніматор 3', 'Аніматор 4', 'Аніматор 5']
    );
    assert.deepEqual(
        blueprint.bookingBlueprints
            .map(fixture => fixture.productId)
            .filter(productId => /^kv\d+$/.test(productId))
            .sort((left, right) => Number(left.slice(2)) - Number(right.slice(2))),
        ['kv1', 'kv4', 'kv5', 'kv6', 'kv7', 'kv8', 'kv9', 'kv10', 'kv11']
    );
    const productIds = blueprint.bookingBlueprints.map(fixture => fixture.productId);
    for (const expectedProductSet of [
        ['bubble', 'dry_ice', 'football', 'mafia', 'neon_bubble', 'paper'],
        ['anim60', 'anim120'],
        ['photo60', 'photo_magnets'],
        ['mk_cookie', 'mk_cupcake', 'mk_ecobag', 'mk_thermomosaic', 'mk_tshirt'],
        ['custom']
    ]) {
        assert.deepEqual(
            expectedProductSet.filter(productId => productIds.includes(productId)).sort(),
            expectedProductSet.slice().sort()
        );
    }
    assert.deepEqual(
        [...new Set(blueprint.bookingBlueprints.map(fixture => fixture.duration))].sort((left, right) => left - right),
        [15, 30, 40, 45, 60, 75, 90, 120]
    );
    assert.deepEqual(
        blueprint.bookingBlueprints
            .filter(fixture => fixture.productId === 'pinata' || fixture.productId === 'pinata_custom')
            .map(fixture => ({
                key: fixture.key,
                productId: fixture.productId,
                pinataMode: fixture.pinataMode,
                pinataNumber: fixture.pinataNumber || null
            })),
        [
            { key: 'a2-client-pinata', productId: 'pinata', pinataMode: 'client', pinataNumber: null },
            { key: 'a4-park-pinata', productId: 'pinata', pinataMode: 'park', pinataNumber: '501' },
            { key: 'a4-custom-pinata', productId: 'pinata_custom', pinataMode: 'park', pinataNumber: null }
        ]
    );

    const intervalsByLine = new Map();
    const minutes = value => {
        const [hours, mins] = value.split(':').map(Number);
        return (hours * 60) + mins;
    };
    for (const fixture of blueprint.bookingBlueprints) {
        const interval = {
            key: fixture.key,
            start: minutes(fixture.time),
            end: minutes(fixture.time) + fixture.duration
        };
        assert.ok(interval.start >= minutes(blueprint.timeWindow.from));
        assert.ok(interval.end <= minutes(blueprint.timeWindow.to));
        for (const lineName of [fixture.lineName, fixture.secondAnimatorLineName].filter(Boolean)) {
            if (!intervalsByLine.has(lineName)) intervalsByLine.set(lineName, []);
            intervalsByLine.get(lineName).push(interval);
        }
    }
    for (const intervals of intervalsByLine.values()) {
        intervals.sort((left, right) => left.start - right.start);
        for (let index = 1; index < intervals.length; index += 1) {
            assert.ok(intervals[index - 1].end <= intervals[index].start,
                `${intervals[index - 1].key} overlaps ${intervals[index].key}`);
        }
    }
});

test('prepare accepts any exact date but keeps the trusted line allowlist and 12:00-20:00 safety window', () => {
    assert.throws(
        () => normalizePreparationBlueprint(rawBlueprint({
            date: '2026-09-02',
            timeWindow: { date: '2026-09-03', from: '12:00', to: '20:00' }
        })),
        error => error.code === 'SHOWCASE_PREPARE_WINDOW_INVALID'
    );
    assert.throws(
        () => normalizePreparationBlueprint(rawBlueprint({
            date: '2026-09-02',
            timeWindow: { date: '2026-09-02', from: '11:00', to: '20:00' }
        })),
        error => error.code === 'SHOWCASE_PREPARE_WINDOW_INVALID'
    );
    assert.equal(normalizePreparationBlueprint(rawBlueprint({
        date: '2026-09-03',
        timeWindow: { date: '2026-09-03', from: '12:00', to: '20:00' }
    })).date, '2026-09-03');
    assert.throws(
        () => normalizePreparationBlueprint(rawBlueprint({
            date: 'not-a-date',
            timeWindow: { date: '2026-09-02', from: '12:00', to: '20:00' }
        })),
        error => error.code === 'SHOWCASE_PREPARE_WINDOW_INVALID'
    );
    assert.throws(
        () => normalizePreparationBlueprint(rawBlueprint({
            date: '2026-09-02',
            timeWindow: { date: 'not-a-date', from: '12:00', to: '20:00' }
        })),
        error => error.code === 'SHOWCASE_PREPARE_WINDOW_INVALID'
    );
    assert.throws(
        () => normalizePreparationBlueprint(rawBlueprint({
            bookingBlueprints: [
                { key: 'outside-trusted-line-six', productId: 'quest-1', lineName: 'Аніматор 6', time: '12:00' }
            ]
        })),
        error => error.code === 'SHOWCASE_PREPARE_LINE_NAME_INVALID'
    );
});

test('prepare customer selection fails closed on ambiguity', () => {
    assert.equal(resolveExactQaCustomerId([{ id: 219 }]), 219);
    assert.throws(
        () => resolveExactQaCustomerId([{ id: 219 }, { id: 220 }]),
        error => error.code === 'SHOWCASE_PREPARE_CUSTOMER_AMBIGUOUS'
    );
    assert.throws(
        () => resolveExactQaCustomerId([], 219),
        error => error.code === 'SHOWCASE_PREPARE_CUSTOMER_UNAVAILABLE'
    );
    assert.throws(
        () => normalizePreparationBlueprint(rawBlueprint({ testAccountId: undefined })),
        error => error.code === 'SHOWCASE_PREPARE_TEST_ACCOUNT_ID_REQUIRED'
    );
    assert.throws(
        () => normalizePreparationBlueprint(rawBlueprint({ customerId: 220 })),
        error => error.code === 'SHOWCASE_PREPARE_CUSTOMER_ID_INVALID'
    );
});

test('prepare writes one exact manifest outside the repo without invoking mutations', async () => {
    const files = temporaryOperatorFiles();
    try {
        const outputFile = path.join(files.directory, 'exact-manifest.json');
        const runtime = fakePreparationRuntime();
        const result = await prepareShowcase(
            normalizePreparationBlueprint(rawBlueprint()),
            { outputFile },
            runtime
        );
        const prepared = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
        assert.equal(result.manifestHash, manifestHash(prepared));
        assert.equal(result.fixtureCount, 2);
        assert.equal(result.expectedEntityCount, 2);
        assert.deepEqual(runtime.calls, [
            'authenticatePreparation',
            'preparationCatalog',
            'resolvePreparationCustomer',
            'livePreflight',
            'databasePreflight'
        ]);
        assert.equal(runtime.calls.some(call => call.startsWith('UNSAFE:')), false);
        const serialized = fs.readFileSync(outputFile, 'utf8');
        assert.doesNotMatch(serialized, /access-token|password|qaRunToken|server-issued-token/i);

        const secondRuntime = fakePreparationRuntime();
        await assert.rejects(
            prepareShowcase(normalizePreparationBlueprint(rawBlueprint()), { outputFile }, secondRuntime),
            error => error.code === 'SHOWCASE_PREPARE_OUTPUT_EXISTS'
        );
        assert.deepEqual(secondRuntime.calls, []);
    } finally {
        files.cleanup();
    }
});

test('prepare rejects a repository output path before any live or database call', async () => {
    const runtime = fakePreparationRuntime();
    await assert.rejects(
        prepareShowcase(normalizePreparationBlueprint(rawBlueprint()), {
            outputFile: path.join(__dirname, 'unsafe-prepared-manifest.json')
        }, runtime),
        error => error.code === 'SHOWCASE_OPERATOR_PATH_IN_REPOSITORY'
    );
    assert.deepEqual(runtime.calls, []);
});

test('checkout, persisted-line, and exact registry boundaries fail closed on drift', () => {
    const manifest = normalizedManifest();
    assert.deepEqual(assertCheckoutFacts({
        commit: manifest.sourceCommit,
        branch: manifest.sourceBranch,
        dirty: ''
    }, manifest), { commit: manifest.sourceCommit, branch: manifest.sourceBranch, clean: true });
    assert.throws(
        () => assertCheckoutFacts({ commit: manifest.sourceCommit, branch: manifest.sourceBranch, dirty: ' M routes/bookings.js' }, manifest),
        error => error.code === 'SHOWCASE_LOCAL_CHECKOUT_DIRTY'
    );
    assert.equal(assertPersistedLineIds(['animator-1'], [{ line_id: 'animator-1' }]), true);
    assert.throws(
        () => assertPersistedLineIds(['animator-1', 'animator-2'], [{ line_id: 'animator-1' }]),
        error => error.code === 'SHOWCASE_DB_PERSISTED_LINE_MISSING'
    );
    assert.equal(assertNoUnrelatedCustomerBookings([]), true);
    assert.throws(
        () => assertNoUnrelatedCustomerBookings([{ id: 'REAL-BOOKING' }]),
        error => error.code === 'SHOWCASE_DB_CUSTOMER_ACTIVE_BOOKING_BLOCKER'
    );
    const state = initialState(manifest, manifestHash(manifest), 'C:\\outside\\token.txt');
    state.fixtures[0].bookingIds = ['BK-1'];
    state.fixtures[1].bookingIds = ['BK-2'];
    assert.deepEqual(assertExactRegistryRows([
        { entity_type: 'booking', entity_id: 'BK-1', cleanup_state: 'active' },
        { entity_type: 'booking', entity_id: 'BK-2', cleanup_state: 'active' }
    ], manifest, state), { entityCount: 2, entityTypes: ['booking'] });
    assert.throws(
        () => assertExactRegistryRows([
            { entity_type: 'booking', entity_id: 'BK-1', cleanup_state: 'active' },
            { entity_type: 'booking_banquet_link', entity_id: 'BK-2', cleanup_state: 'active' }
        ], manifest, state),
        error => error.code === 'SHOWCASE_REGISTRY_BOUNDARY_DRIFT'
    );
});

test('exact authorization envelope includes display snapshot and readback requires server fixture key', () => {
    const manifest = normalizedManifest();
    const fixture = manifest.bookingFixtures[0];
    const exact = exactFixtureEnvelope(fixture);
    assert.deepEqual(exact, {
        requestId: fixture.requestId,
        programId: 'quest-1',
        productId: 'quest-1',
        lineId: 'animator-1',
        roomResourceId: 'room-takeaway',
        room: 'На виніс',
        date: '2026-08-29',
        time: '12:00',
        duration: 60,
        status: 'confirmed',
        programCode: 'Q1',
        programName: 'Quest One',
        label: 'Quest One',
        category: 'quest',
        hosts: 1,
        pinataMode: 'none'
    });
    const run = fakeRun(manifest);
    run.allowed_endpoints.bookingFixtures.reverse();
    assertRunEnvelope(run, manifest);
    assertRunEnvelope({ ...run, allowed_date: new Date(2026, 7, 29) }, manifest);
    assert.throws(
        () => assertRunEnvelope({ ...run, required_customer_id: null }, manifest),
        error => error.code === 'SHOWCASE_RUN_ACCOUNT_BOUNDARY_MISMATCH'
    );
    assert.throws(
        () => assertRunEnvelope({ ...run, required_product_id: 'quest-1' }, manifest),
        error => error.code === 'SHOWCASE_RUN_SCALAR_ALLOWLIST_PRESENT'
    );

    const booking = {
        id: 'BK-2099-1001',
        date: fixture.date,
        time: fixture.time,
        duration: fixture.duration,
        lineId: fixture.lineId,
        programId: fixture.programId,
        programCode: fixture.booking.programCode,
        programName: fixture.booking.programName,
        label: fixture.booking.label,
        category: fixture.booking.category,
        hosts: fixture.booking.hosts,
        pinataMode: fixture.booking.pinataMode,
        room: fixture.room,
        roomResourceId: fixture.roomResourceId,
        status: fixture.status,
        extraData: {
            disposableQa: {
                source: 'trusted_timeline_showcase',
                runId: manifest.runId,
                bookingFixtureKey: fixture.requestId
            }
        }
    };
    assert.equal(assertTrustedReadback(booking, fixture, manifest), booking.id);
    assert.throws(
        () => assertTrustedReadback({
            ...booking,
            extraData: { disposableQa: { ...booking.extraData.disposableQa, bookingFixtureKey: 'another-request' } }
        }, fixture, manifest),
        error => error.code === 'SHOWCASE_READBACK_RECOVERY_MARKER_MISMATCH'
    );
});

test('booking payload is minimal and carries no client marker or unsafe business fields', () => {
    const manifest = normalizedManifest();
    const fixture = manifest.bookingFixtures[0];
    const payload = buildBookingPayload(manifest, fixture, { catalog: fakeCatalog(manifest) }, manifestHash(manifest));
    assert.equal(payload.customerId, manifest.customerId);
    assert.equal(payload.roomResourceId, 'room-takeaway');
    assert.equal(payload.room, 'На виніс');
    for (const forbidden of [
        'id', 'linkedTo', 'customer', 'createdBy', 'extraData', 'skipNotification',
        'qaRunToken', 'lineName', 'banquetContext', 'bookingPackage', 'paymentMethod', 'certificateCode'
    ]) {
        assert.equal(Object.prototype.hasOwnProperty.call(payload, forbidden), false, forbidden);
    }
});

test('linked readback must match the exact second line and the complete fixture snapshot', () => {
    const manifest = normalizedManifest({
        bookingFixtures: [rawFixture({
            secondAnimatorLineId: 'animator-3',
            secondAnimator: 'Аніматор 3',
            hosts: 2
        })]
    });
    const fixture = manifest.bookingFixtures[0];
    const linked = {
        id: 'BK-2099-1002',
        linkedTo: 'BK-2099-1001',
        date: fixture.date,
        time: fixture.time,
        duration: fixture.duration,
        lineId: fixture.secondAnimatorLineId,
        programId: fixture.programId,
        programCode: fixture.booking.programCode,
        programName: fixture.booking.programName,
        label: fixture.booking.label,
        category: fixture.booking.category,
        hosts: fixture.booking.hosts,
        pinataMode: fixture.booking.pinataMode,
        secondAnimator: fixture.secondAnimator,
        room: fixture.room,
        roomResourceId: fixture.roomResourceId,
        status: fixture.status,
        extraData: {
            disposableQa: {
                source: 'trusted_timeline_showcase',
                runId: manifest.runId,
                bookingFixtureKey: fixture.requestId
            }
        }
    };
    assert.equal(assertTrustedReadback(linked, fixture, manifest, { linked: true }), linked.id);
    assert.throws(
        () => assertTrustedReadback({ ...linked, lineId: fixture.lineId }, fixture, manifest, { linked: true }),
        error => error.code === 'SHOWCASE_READBACK_FIXTURE_MISMATCH'
    );
    assert.throws(
        () => assertTrustedReadback({ ...linked, duration: fixture.duration + 1 }, fixture, manifest, { linked: true }),
        error => error.code === 'SHOWCASE_READBACK_FIXTURE_MISMATCH'
    );
});

test('apply persists each verified fixture and resumes without replaying mutations', async () => {
    const files = temporaryOperatorFiles();
    try {
        const manifest = normalizedManifest();
        const runtime = fakeRuntime();
        const options = {
            confirm: APPLY_CONFIRMATION,
            approvedHash: manifestHash(manifest),
            stateFile: files.stateFile,
            tokenFile: files.tokenFile
        };
        const first = await applyShowcase(manifest, options, runtime);
        assert.equal(first.phase, 'showcase_active');
        assert.equal(first.fixtureCount, 2);
        assert.equal(first.bookingCount, 2);
        assert.deepEqual(runtime.calls.filter(call => call.startsWith('create:')), ['create:quest-one', 'create:show-two']);

        const second = await applyShowcase(manifest, options, runtime);
        assert.equal(second.phase, 'showcase_active');
        assert.equal(runtime.calls.filter(call => call === 'resumeRun').length, 1);
        assert.deepEqual(runtime.calls.filter(call => call.startsWith('create:')), ['create:quest-one', 'create:show-two']);
        const state = JSON.parse(fs.readFileSync(files.stateFile, 'utf8'));
        assert.equal(state.fixtures.every(item => item.status === 'verified'), true);
        assert.equal(Object.prototype.hasOwnProperty.call(state, 'token'), false);
        assert.equal(fs.readFileSync(files.tokenFile, 'utf8'), 'server-issued-token-value-for-unit-test');
    } finally {
        files.cleanup();
    }
});

test('orphan token without a matching DB run is never removed or reused', async () => {
    const files = temporaryOperatorFiles();
    try {
        const manifest = normalizedManifest();
        const hash = manifestHash(manifest);
        const state = initialState(manifest, hash, files.tokenFile);
        state.phase = 'run_creation_pending';
        fs.writeFileSync(files.stateFile, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
        fs.writeFileSync(files.tokenFile, 'unowned-token-file-must-survive', { flag: 'wx' });
        const runtime = fakeRuntime();
        await assert.rejects(
            applyShowcase(manifest, {
                confirm: APPLY_CONFIRMATION,
                approvedHash: hash,
                stateFile: files.stateFile,
                tokenFile: files.tokenFile
            }, runtime),
            error => error.code === 'SHOWCASE_TOKEN_FILE_UNOWNED'
        );
        assert.equal(fs.readFileSync(files.tokenFile, 'utf8'), 'unowned-token-file-must-survive');
        assert.equal(runtime.calls.includes('createRun'), false);
        assert.equal(runtime.calls.includes('cleanupRun'), false);
    } finally {
        files.cleanup();
    }
});

test('token cleanup ownership requires the explicit file SHA-256 to match the DB run', () => {
    const files = temporaryOperatorFiles();
    try {
        const manifest = normalizedManifest();
        const token = 'server-issued-token-value-for-unit-test';
        const run = fakeRun(manifest, token);
        fs.writeFileSync(files.tokenFile, token, { flag: 'wx' });
        assert.equal(assertOwnedTokenFile(files.tokenFile, run), true);
        fs.writeFileSync(files.tokenFile, 'unrelated-local-file', { flag: 'w' });
        assert.throws(
            () => assertOwnedTokenFile(files.tokenFile, run),
            error => error.code === 'SHOWCASE_TOKEN_FILE_OWNERSHIP_MISMATCH'
        );
        assert.equal(fs.readFileSync(files.tokenFile, 'utf8'), 'unrelated-local-file');
    } finally {
        files.cleanup();
    }
});

test('a DB run committed before token-file publication is recovered by exact cleanup', async () => {
    const files = temporaryOperatorFiles();
    try {
        const manifest = normalizedManifest();
        const hash = manifestHash(manifest);
        const state = initialState(manifest, hash, files.tokenFile);
        state.phase = 'run_creation_pending';
        fs.writeFileSync(files.stateFile, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
        const runtime = fakeRuntime({
            existingRun: fakeRun(manifest),
            resumeError: new TimelineShowcaseError(
                'simulated crash window after COMMIT and before token write',
                'SHOWCASE_RECOVERY_TOKEN_FILE_MISSING'
            )
        });
        await assert.rejects(
            applyShowcase(manifest, {
                confirm: APPLY_CONFIRMATION,
                approvedHash: hash,
                stateFile: files.stateFile,
                tokenFile: files.tokenFile
            }, runtime),
            error => error.code === 'SHOWCASE_RECOVERY_TOKEN_FILE_MISSING'
        );
        assert.equal(runtime.calls.includes('cleanupRun'), true);
        const recoveredState = JSON.parse(fs.readFileSync(files.stateFile, 'utf8'));
        assert.equal(recoveredState.phase, 'cleaned_after_failure');
        assert.equal(recoveredState.runDatabaseId, 901);
        assert.equal(fs.existsSync(files.tokenFile), false);
    } finally {
        files.cleanup();
    }
});

test('partial fixture failure triggers exact cleanup and leaves a recovery audit state', async () => {
    const files = temporaryOperatorFiles();
    try {
        const manifest = normalizedManifest();
        const runtime = fakeRuntime({ failFixtureKey: 'show-two' });
        await assert.rejects(
            applyShowcase(manifest, {
                confirm: APPLY_CONFIRMATION,
                approvedHash: manifestHash(manifest),
                stateFile: files.stateFile,
                tokenFile: files.tokenFile
            }, runtime),
            error => error.code === 'SIMULATED_FIXTURE_FAILURE'
        );
        assert.equal(runtime.calls.includes('cleanupRun'), true);
        const state = JSON.parse(fs.readFileSync(files.stateFile, 'utf8'));
        assert.equal(state.phase, 'cleaned_after_failure');
        assert.equal(state.cleanup.status, 'cleaned');
        assert.equal(state.fixtures[0].status, 'verified');
        assert.equal(state.fixtures[1].status, 'failed');
        assert.equal(fs.existsSync(files.tokenFile), false);
    } finally {
        files.cleanup();
    }
});

test('cleanup failure marks the exact run cleanup_pending for watchdog recovery', async () => {
    const files = temporaryOperatorFiles();
    try {
        const manifest = normalizedManifest();
        const runtime = fakeRuntime({ failFixtureKey: 'show-two', cleanupFails: true });
        await assert.rejects(
            applyShowcase(manifest, {
                confirm: APPLY_CONFIRMATION,
                approvedHash: manifestHash(manifest),
                stateFile: files.stateFile,
                tokenFile: files.tokenFile
            }, runtime),
            error => error instanceof AggregateError
        );
        assert.equal(runtime.calls.includes('scheduleCleanupRecovery'), true);
        const state = JSON.parse(fs.readFileSync(files.stateFile, 'utf8'));
        assert.equal(state.phase, 'cleanup_pending');
        assert.equal(state.cleanup.errorCode, 'SIMULATED_CLEANUP_FAILURE');
        assert.equal(fs.existsSync(files.tokenFile), true, 'token remains available for explicit recovery');
    } finally {
        files.cleanup();
    }
});

test('showcase source sends token only by header with one request and idempotency ID', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'trusted-qa-timeline-showcase.js'), 'utf8');
    assert.match(source, /'X-QA-Run-Token': options\.qaToken/);
    assert.match(source, /'X-QA-Run-Request-Id': options\.requestId/);
    assert.match(source, /'Idempotency-Key': options\.requestId/);
    assert.match(source, /scopedRoute\(`\/api\/lines\/\$\{encodeURIComponent\(blueprint\.date\)\}`/);
    assert.match(source, /const attempts = method === 'GET' \? MAX_HTTP_READ_RETRIES : 1/);
    assert.match(source, /state IN \('active', 'cleanup_pending', 'blocked'\)/);
    assert.match(source, /SHOWCASE_DB_CUSTOMER_ACTIVE_BOOKING_BLOCKER/);
    assert.doesNotMatch(source, /LIKE '%test%'|LIKE '%smoke%'/);
    assert.doesNotMatch(source, /body:\s*\{[^}]*qaRunToken/s);
    const createRunSource = source.slice(
        source.indexOf('async function createExactRun'),
        source.indexOf('async function lookupRun')
    );
    assert.ok(createRunSource.indexOf("await client.query('COMMIT')")
        < createRunSource.indexOf('fs.writeFileSync(tokenFile, created.token'));
});

// Keep controller lifecycle contracts in the default unit baseline without
// duplicating the repository's intentionally explicit test:unit file list.
require('./trusted-qa-timeline-controller.test');
