'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    MAX_TRUSTED_QA_BOOKING_FIXTURES,
    TrustedQaRunError,
    assertRunMatchesRequest,
    createTrustedQaRun,
    normalizeTrustedQaAuthorizationManifest,
    normalizeTrustedQaBookingFixtures,
    prepareTrustedQaBookingInput,
    sha256
} = require('../services/trustedQaRuns');

function bookingFixture(overrides = {}) {
    return {
        requestId: 'fixture-request-1',
        programId: 'program-1',
        lineId: 'animator-1',
        roomResourceId: 'takeaway-1',
        room: 'Takeaway',
        date: '2026-08-29',
        time: '12:00',
        duration: 60,
        status: 'confirmed',
        programCode: 'P1',
        programName: 'Program One',
        label: 'P1(60)',
        category: 'animation',
        hosts: 1,
        pinataMode: 'none',
        ...overrides
    };
}

function authorizationEnvelope() {
    return {
        endpoints: ['POST /api/bookings'],
        bookingFixtures: [
            bookingFixture(),
            bookingFixture({
                requestId: 'fixture-request-2',
                programId: 'program-2',
                productId: 'program-2',
                lineId: 'animator-2',
                secondAnimatorLineId: 'animator-3',
                secondAnimator: 'Animator Three',
                time: '13:00',
                duration: 90,
                programCode: 'P2',
                programName: 'Program Two',
                label: 'P2(90)',
                category: 'quest',
                hosts: 2,
                pinataMode: 'park',
                pinataNumber: '7'
            })
        ]
    };
}

function run(overrides = {}) {
    return {
        id: 41,
        run_id: 'qa-fixtures-41',
        token_hash: sha256('fixture-token'),
        source: 'trusted_qa',
        test_customer_marker: 'qa-fixtures-41:customer:101',
        business_context: 'event_genix',
        operator_user_id: 7,
        required_operator_user_id: 7,
        required_user_id: 7,
        required_customer_id: '101',
        required_program_id: 'program-1',
        required_product_id: 'program-1',
        required_room_resource_id: 'takeaway-1',
        required_line_id: 'animator-1',
        allowed_date: '2026-08-29',
        allowed_start_time: '12:00:00',
        allowed_end_time: '20:00:00',
        allowed_endpoints: authorizationEnvelope(),
        max_entity_count: 10,
        state: 'active',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        ...overrides
    };
}

function req(requestId = 'fixture-request-1', options = {}) {
    const token = options.token === undefined ? 'fixture-token' : options.token;
    const body = options.body || {};
    return {
        method: 'POST',
        path: '/api/bookings',
        baseUrl: '',
        user: { id: 7 },
        body,
        get(name) {
            const normalized = String(name).toLowerCase();
            if (normalized === 'x-qa-run-token') return token;
            if (normalized === 'x-qa-run-request-id') return requestId;
            return '';
        }
    };
}

function booking(overrides = {}) {
    return {
        customerId: 101,
        programId: 'program-1',
        lineId: 'animator-1',
        roomResourceId: 'takeaway-1',
        room: 'Takeaway',
        date: '2026-08-29',
        time: '12:00',
        duration: 60,
        status: 'confirmed',
        programCode: 'P1',
        programName: 'Program One',
        label: 'P1(60)',
        category: 'animation',
        hosts: 1,
        pinataMode: 'none',
        ...overrides
    };
}

test('fixture envelope authorizes exact request-bound combinations and permits a repeated takeaway carrier', () => {
    assert.deepEqual(
        assertRunMatchesRequest(run(), req('fixture-request-1'), booking(), 'event_genix'),
        {
            endpointKey: 'POST /api/bookings',
            bookingFixtureKey: 'fixture-request-1'
        }
    );
    assert.deepEqual(
        assertRunMatchesRequest(
            run(),
            req('fixture-request-2'),
            booking({
                programId: 'program-2',
                productId: 'program-2',
                lineId: 'animator-2',
                secondAnimatorLineId: 'animator-3',
                secondAnimator: 'Animator Three',
                roomResourceId: 'takeaway-1',
                time: '13:00',
                duration: 90,
                programCode: 'P2',
                programName: 'Program Two',
                label: 'P2(90)',
                category: 'quest',
                hosts: 2,
                pinataMode: 'park',
                pinataNumber: '7'
            }),
            'event_genix'
        ),
        {
            endpointKey: 'POST /api/bookings',
            bookingFixtureKey: 'fixture-request-2'
        }
    );
});

test('fixture envelope rejects cross-combinations, unknown request ids, and second-animator drift', () => {
    assert.throws(
        () => assertRunMatchesRequest(
            run(),
            req('fixture-request-1'),
            booking({ lineId: 'animator-2' }),
            'event_genix'
        ),
        error => error instanceof TrustedQaRunError && error.code === 'QA_RUN_LINE_MISMATCH'
    );
    assert.throws(
        () => assertRunMatchesRequest(run(), req('not-in-manifest'), booking(), 'event_genix'),
        error => error instanceof TrustedQaRunError && error.code === 'QA_RUN_FIXTURE_NOT_ALLOWED'
    );
    assert.throws(
        () => assertRunMatchesRequest(
            run(),
            req('fixture-request-1'),
            booking({ secondAnimatorLineId: 'animator-3' }),
            'event_genix'
        ),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_SECOND_ANIMATOR_LINE_MISMATCH'
    );
    assert.throws(
        () => assertRunMatchesRequest(
            run(),
            req('fixture-request-1'),
            booking({ secondAnimator: 'Unexpected Animator' }),
            'event_genix'
        ),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_FIXTURE_MISMATCH'
            && error.details.field === 'secondAnimator'
    );
    assert.throws(
        () => assertRunMatchesRequest(
            run(),
            req('fixture-request-2'),
            booking({
                programId: 'program-2',
                productId: 'program-2',
                lineId: 'animator-2',
                roomResourceId: 'takeaway-1',
                time: '13:00',
                duration: 90
            }),
            'event_genix'
        ),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_SECOND_ANIMATOR_LINE_MISMATCH'
    );
});

test('fixture envelope rejects tampered display snapshots and unsafe booking payload extras', () => {
    assert.throws(
        () => assertRunMatchesRequest(
            run(),
            req('fixture-request-1'),
            booking({ programName: 'Tampered display name' }),
            'event_genix'
        ),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_FIXTURE_MISMATCH'
            && error.details.field === 'programName'
    );
    assert.throws(
        () => assertRunMatchesRequest(
            run(),
            req('fixture-request-1'),
            booking({ room: 'Tampered room' }),
            'event_genix'
        ),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_FIXTURE_MISMATCH'
            && error.details.field === 'room'
    );
    assert.throws(
        () => assertRunMatchesRequest(
            run(),
            req('fixture-request-2'),
            booking({
                programId: 'program-2',
                productId: 'program-2',
                lineId: 'animator-2',
                secondAnimatorLineId: 'animator-3',
                secondAnimator: 'Tampered Animator',
                roomResourceId: 'takeaway-1',
                time: '13:00',
                duration: 90,
                programCode: 'P2',
                programName: 'Program Two',
                label: 'P2(90)',
                category: 'quest',
                hosts: 2,
                pinataMode: 'park',
                pinataNumber: '7'
            }),
            'event_genix'
        ),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_FIXTURE_MISMATCH'
            && error.details.field === 'secondAnimator'
    );
    for (const unsafePayload of [
        { id: 'BK-CLIENT-CONTROLLED' },
        { linkedTo: 'BK-REAL' },
        { banquetContext: null },
        { customer: { name: 'Client supplied' } },
        { bookingPackage: {} },
        { banquetMenu: '' },
        { paymentMethod: 'cash' },
        { deposit: null },
        { ticketQuantities: [] },
        { certificateCode: 'CERT-REAL' },
        { serviceEvents: [] },
        { programBasePrice: 100 },
        { createdBy: 'spoofed-operator' },
        { extraData: {} },
        {
            extraData: {
                disposableQa: { bookingFixtureKey: 'fixture-request-1' }
            }
        }
    ]) {
        assert.throws(
            () => assertRunMatchesRequest(
                run(),
                req('fixture-request-1'),
                booking(unsafePayload),
                'event_genix'
            ),
            error => error instanceof TrustedQaRunError
                && error.code === 'QA_RUN_FIXTURE_UNSAFE_PAYLOAD'
        );
    }
    for (const body of [
        { qaRunToken: 'must-not-be-in-body' },
        { qa_run_token: 'must-not-be-in-body' },
        { qaRunRequestId: 'fixture-request-1' },
        { qa_run_request_id: 'fixture-request-1' },
        { serviceEvents: [] },
        { programBasePrice: 100 }
    ]) {
        assert.throws(
            () => assertRunMatchesRequest(
                run(),
                { ...req('fixture-request-1'), body },
                booking(),
                'event_genix'
            ),
            error => error instanceof TrustedQaRunError
                && error.code === 'QA_RUN_FIXTURE_UNSAFE_PAYLOAD'
        );
    }
});

test('fixture mode requires the canonical token and request id headers', () => {
    const disposableAliasOnly = {
        ...req('fixture-request-1'),
        get(name) {
            const normalized = String(name).toLowerCase();
            if (normalized === 'x-disposable-qa-token') return 'fixture-token';
            if (normalized === 'x-qa-run-request-id') return 'fixture-request-1';
            return '';
        }
    };
    assert.throws(
        () => assertRunMatchesRequest(run(), disposableAliasOnly, booking(), 'event_genix'),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_FIXTURE_HEADERS_REQUIRED'
            && error.details.missingHeaders.includes('X-QA-Run-Token')
    );

    const bodyRequestIdOnly = {
        ...req('', { body: { qaRunRequestId: 'fixture-request-1' } }),
        get(name) {
            if (String(name).toLowerCase() === 'x-qa-run-token') return 'fixture-token';
            return '';
        }
    };
    assert.throws(
        () => assertRunMatchesRequest(run(), bodyRequestIdOnly, booking(), 'event_genix'),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_FIXTURE_HEADERS_REQUIRED'
            && error.details.missingHeaders.includes('X-QA-Run-Request-Id')
    );

    assert.throws(
        () => assertRunMatchesRequest(
            run(),
            req('fixture-request-1', { token: 'wrong-header-token' }),
            booking(),
            'event_genix'
        ),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_FIXTURE_TOKEN_MISMATCH'
    );
});

test('fixture manifest normalization is canonical, bounded, and rejects duplicate request ids', () => {
    const normalized = normalizeTrustedQaAuthorizationManifest(JSON.stringify(authorizationEnvelope()), {
        maxFixtures: 10
    });
    assert.deepEqual(normalized.endpoints, ['POST /api/bookings']);
    assert.deepEqual(
        normalized.bookingFixtures.map(fixture => fixture.requestId),
        ['fixture-request-1', 'fixture-request-2']
    );

    assert.throws(
        () => normalizeTrustedQaBookingFixtures([
            bookingFixture(),
            bookingFixture({ programId: 'program-2' })
        ]),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_FIXTURE_MANIFEST_INVALID'
    );
    assert.throws(
        () => normalizeTrustedQaBookingFixtures(
            Array.from(
                { length: MAX_TRUSTED_QA_BOOKING_FIXTURES + 1 },
                (_, index) => bookingFixture({ requestId: `fixture-${index}` })
            )
        ),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_FIXTURE_MANIFEST_INVALID'
    );
    assert.throws(
        () => normalizeTrustedQaAuthorizationManifest({
            ...authorizationEnvelope(),
            unvalidatedConstraint: true
        }),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_FIXTURE_MANIFEST_INVALID'
    );
    for (const endpoints of [
        ['POST /api/bookings/full'],
        ['POST /api/bookings*'],
        ['POST /api/bookings', 'POST /api/bookings/full']
    ]) {
        assert.throws(
            () => normalizeTrustedQaAuthorizationManifest({
                ...authorizationEnvelope(),
                endpoints
            }),
            error => error instanceof TrustedQaRunError
                && error.code === 'QA_RUN_FIXTURE_MANIFEST_INVALID'
        );
    }
    assert.throws(
        () => normalizeTrustedQaBookingFixtures([
            bookingFixture({ programId: { untrusted: 'shape' } })
        ]),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_FIXTURE_MANIFEST_INVALID'
    );
    assert.throws(
        () => normalizeTrustedQaBookingFixtures([
            bookingFixture({ hosts: 0 })
        ]),
        error => error instanceof TrustedQaRunError
            && error.code === 'QA_RUN_FIXTURE_MANIFEST_INVALID'
    );
    for (const invalidFixture of [
        bookingFixture({ room: 'x'.repeat(101) }),
        bookingFixture({ secondAnimator: 'x'.repeat(101) })
    ]) {
        assert.throws(
            () => normalizeTrustedQaBookingFixtures([invalidFixture]),
            error => error instanceof TrustedQaRunError
                && error.code === 'QA_RUN_FIXTURE_MANIFEST_INVALID'
        );
    }
});

test('legacy endpoint arrays retain exact scalar run constraints', () => {
    const legacyRun = run({
        allowed_endpoints: ['POST /api/bookings']
    });
    assert.deepEqual(
        assertRunMatchesRequest(legacyRun, req(), booking(), 'event_genix'),
        { endpointKey: 'POST /api/bookings' }
    );
    assert.deepEqual(
        assertRunMatchesRequest(
            legacyRun,
            {
                method: 'POST',
                path: '/api/bookings',
                baseUrl: '',
                user: { id: 7 },
                body: {
                    qaRunToken: 'legacy-body-token',
                    qaRunRequestId: 'legacy-body-request'
                },
                get() { return ''; }
            },
            booking(),
            'event_genix'
        ),
        { endpointKey: 'POST /api/bookings' }
    );
    assert.throws(
        () => assertRunMatchesRequest(
            legacyRun,
            req(),
            booking({ programId: 'program-2' }),
            'event_genix'
        ),
        error => error instanceof TrustedQaRunError && error.code === 'QA_RUN_PROGRAM_MISMATCH'
    );
});

test('successful fixture authorization attaches a durable server-issued fixture key', async () => {
    const trustedRun = run({ token_hash: sha256('fixture-token') });
    const queryable = {
        async query(sql) {
            if (/SELECT \*\s+FROM trusted_qa_runs/.test(sql)) {
                return { rows: [trustedRun], rowCount: 1 };
            }
            if (/INSERT INTO trusted_qa_run_token_uses/.test(sql)) {
                return { rows: [{ id: 1 }], rowCount: 1 };
            }
            if (/UPDATE trusted_qa_runs/.test(sql)) {
                return { rows: [trustedRun], rowCount: 1 };
            }
            throw new Error(`Unexpected fixture marker query: ${sql}`);
        }
    };
    const payload = booking();
    const request = req('fixture-request-1', { body: payload });

    const context = await prepareTrustedQaBookingInput(
        queryable,
        request,
        payload,
        'event_genix'
    );

    assert.equal(context.bookingFixtureKey, 'fixture-request-1');
    assert.equal(context.marker.bookingFixtureKey, 'fixture-request-1');
    assert.equal(payload.extraData.disposableQa.bookingFixtureKey, 'fixture-request-1');
    assert.equal(payload.extraData.disposableQa.source, 'trusted_qa');
});

test('createTrustedQaRun stores the validated fixture envelope in existing JSONB authorization', async () => {
    let insertParams = null;
    const queryable = {
        async query(sql, params) {
            assert.match(sql, /INSERT INTO trusted_qa_runs/);
            insertParams = params;
            return { rows: [{ id: 41, run_id: params[0] }], rowCount: 1 };
        }
    };
    await createTrustedQaRun(queryable, {
        token: 'server-only-token',
        allowedEndpoints: ['POST /api/bookings'],
        bookingFixtures: authorizationEnvelope().bookingFixtures,
        maxEntityCount: 10
    });

    const stored = JSON.parse(insertParams[6]);
    assert.deepEqual(stored.endpoints, ['POST /api/bookings']);
    assert.equal(stored.bookingFixtures.length, 2);
    assert.equal(stored.bookingFixtures[0].room, 'Takeaway');
    assert.equal(stored.bookingFixtures[1].secondAnimatorLineId, 'animator-3');
    assert.equal(stored.bookingFixtures[1].secondAnimator, 'Animator Three');
    assert.equal(insertParams.includes('server-only-token'), false, 'raw server token must never enter SQL params');
});
