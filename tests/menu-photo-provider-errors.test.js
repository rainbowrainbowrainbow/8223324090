const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    generateMenuImageWithOpenAI,
    menuImagePublicError,
    menuImageFailureDiagnostic
} = require('../services/menuPhotoGeneration');

const originalFetch = global.fetch;
const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
});

async function providerFailure(status, providerError, headers = {}) {
    process.env.OPENAI_API_KEY = 'test-only-key';
    global.fetch = async () => new Response(JSON.stringify({ error: providerError }), { status, headers });
    try {
        await generateMenuImageWithOpenAI({ prompt: 'Test menu photo' });
        assert.fail('Expected provider rejection');
    } catch (err) {
        return err;
    }
}

test('transient 429 returns a bounded cooldown and safe request ID without provider message', async () => {
    const err = await providerFailure(429, {
        code: 'rate_limit_exceeded',
        type: 'rate_limit_error',
        message: 'PRIVATE_PROVIDER_MESSAGE'
    }, { 'Retry-After': '17', 'x-request-id': 'req_test-123' });

    assert.equal(err.message.includes('PRIVATE_PROVIDER_MESSAGE'), false);
    assert.deepEqual(menuImagePublicError(err), {
        status: 429,
        code: 'menu_image_generation_rate_limited',
        error: 'Menu image generation is temporarily rate limited',
        retryable: true,
        retryAfterSeconds: 17,
        requestId: 'req_test-123'
    });
    assert.deepEqual(menuImageFailureDiagnostic(err), {
        providerStatus: 429,
        providerCode: 'rate_limit_exceeded',
        providerType: 'rate_limit_error',
        requestId: 'req_test-123',
        retryAfterSeconds: 17,
        publicCode: 'menu_image_generation_rate_limited',
        retryable: true
    });
    assert.equal(JSON.stringify(menuImageFailureDiagnostic(err)).includes('PRIVATE_PROVIDER_MESSAGE'), false);
});

test('quota, credits, spend, and usage failures never offer a timed retry', async () => {
    for (const code of [
        'insufficient_quota',
        'credit_balance_exhausted',
        'organization_spend_limit_exceeded',
        'project_spend_limit_exceeded',
        'organization_usage_limit_exceeded'
    ]) {
        const err = await providerFailure(429, {
            code,
            type: 'insufficient_quota',
            message: 'PRIVATE_BILLING_MESSAGE'
        }, { 'Retry-After': '60' });
        const publicError = menuImagePublicError(err);
        assert.equal(publicError.code, 'menu_image_generation_quota_exceeded', code);
        assert.equal(publicError.status, 429, code);
        assert.equal(publicError.retryable, false, code);
        assert.equal(publicError.retryAfterSeconds, null, code);
        assert.equal(err.retryAfterSeconds, null, code);
        assert.equal(JSON.stringify(publicError).includes('PRIVATE_BILLING_MESSAGE'), false);
    }
});

test('unknown 429 code stays nonretryable even when type says rate_limit_error', async () => {
    const err = await providerFailure(429, {
        code: 'unrecognized_429',
        type: 'rate_limit_error',
        message: 'PRIVATE_UNKNOWN_MESSAGE'
    }, { 'Retry-After': '17', 'x-request-id': 'req_good/untrusted' });

    assert.equal(err.providerCode, null);
    assert.deepEqual(menuImagePublicError(err), {
        status: 429,
        code: 'menu_image_generation_provider_rejected',
        error: 'Menu image generation was rejected by the provider',
        retryable: false,
        retryAfterSeconds: null,
        requestId: null
    });
    assert.equal(menuImageFailureDiagnostic(err).providerType, 'rate_limit_error');
    assert.equal(JSON.stringify(err).includes('PRIVATE_UNKNOWN_MESSAGE'), false);
});

test('rate limit type alone is used only when the provider omitted the code', async () => {
    const err = await providerFailure(429, { type: 'rate_limit_error' }, { 'Retry-After': '2.5' });
    assert.equal(menuImagePublicError(err).code, 'menu_image_generation_rate_limited');
    assert.equal(menuImagePublicError(err).retryAfterSeconds, 3);
});

test('access failures are separated from rate limits and hide provider text', async () => {
    const err = await providerFailure(403, {
        code: 'permission_denied',
        type: 'permission_error',
        message: 'PRIVATE_ACCESS_MESSAGE'
    });
    const publicError = menuImagePublicError(err);
    assert.equal(publicError.status, 503);
    assert.equal(publicError.code, 'menu_image_generation_unavailable');
    assert.equal(publicError.retryable, false);
    assert.equal(publicError.error.includes('PRIVATE_ACCESS_MESSAGE'), false);
});

test('overload is retryable while unknown provider failures are not', async () => {
    const overloaded = await providerFailure(503, {
        code: 'server_is_overloaded',
        type: 'service_unavailable_error'
    }, { 'Retry-After': '12' });
    assert.equal(menuImagePublicError(overloaded).code, 'menu_image_generation_temporarily_unavailable');
    assert.equal(menuImagePublicError(overloaded).retryAfterSeconds, 12);

    const unknown = await providerFailure(500, { code: 'unrecognized_error' });
    assert.equal(menuImagePublicError(unknown).code, 'menu_image_generation_failed');
    assert.equal(menuImagePublicError(unknown).retryable, false);
    assert.equal(menuImageFailureDiagnostic(unknown).providerCode, null);
});

test('malformed Retry-After and request ID values are discarded', async () => {
    const err = await providerFailure(429, { code: 'slow_down', type: 'rate_limit_error' }, {
        'Retry-After': '999999',
        'x-request-id': 'x'.repeat(129)
    });
    assert.equal(menuImagePublicError(err).retryAfterSeconds, null);
    assert.equal(menuImagePublicError(err).requestId, null);
});

test('non-JSON provider rejection never enters the error, response, or diagnostic', async () => {
    process.env.OPENAI_API_KEY = 'test-only-key';
    global.fetch = async () => new Response('PRIVATE_UPSTREAM_BODY', { status: 429 });
    await assert.rejects(
        generateMenuImageWithOpenAI({ prompt: 'Test menu photo' }),
        err => {
            assert.equal(menuImagePublicError(err).code, 'menu_image_generation_provider_rejected');
            assert.equal(err.message.includes('PRIVATE_UPSTREAM_BODY'), false);
            assert.equal(JSON.stringify(menuImagePublicError(err)).includes('PRIVATE_UPSTREAM_BODY'), false);
            assert.equal(JSON.stringify(menuImageFailureDiagnostic(err)).includes('PRIVATE_UPSTREAM_BODY'), false);
            return true;
        }
    );
});

test('successful image response keeps the existing draft source contract', async () => {
    process.env.OPENAI_API_KEY = 'test-only-key';
    global.fetch = async () => new Response(JSON.stringify({ data: [{ b64_json: 'cG5n' }] }), { status: 200 });
    const result = await generateMenuImageWithOpenAI({ prompt: 'Test menu photo', size: '1024x1024' });
    assert.equal(result.sourceUrl, 'data:image/png;base64,cG5n');
    assert.equal(result.provider, 'openai');
    assert.equal(result.size, '1024x1024');
});

test('missing local API configuration keeps the existing public code', async () => {
    delete process.env.OPENAI_API_KEY;
    global.fetch = async () => assert.fail('fetch must not run without an API key');
    await assert.rejects(
        generateMenuImageWithOpenAI({ prompt: 'Test menu photo' }),
        err => {
            assert.deepEqual(menuImagePublicError(err), {
                status: 503,
                code: 'openai_not_configured',
                error: 'OPENAI_API_KEY is not configured',
                retryable: false,
                retryAfterSeconds: null,
                requestId: null
            });
            return true;
        }
    );
});
