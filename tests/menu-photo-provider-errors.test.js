const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    generateMenuImageWithOpenAI,
    menuImagePublicError,
    menuImageFailureDiagnostic,
    resolveMenuImageGenerator,
    buildMenuImagePrompt,
    startMenuImageWithKie,
    pollMenuImageWithKie
} = require('../services/menuPhotoGeneration');
const {
    isBurgerMenuProduct, readBurgerBlueprint, saveBurgerBlueprint, publicBurgerBlueprintUrl
} = require('../services/menuImageBlueprint');

const originalFetch = global.fetch;
const originalApiKey = process.env.OPENAI_API_KEY;
const originalKieKey = process.env.KIE_API_KEY;

afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalKieKey === undefined) delete process.env.KIE_API_KEY;
    else process.env.KIE_API_KEY = originalKieKey;
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
        provider: null,
        providerCode: 'rate_limit_exceeded',
        providerType: 'rate_limit_error',
        requestId: 'req_test-123',
        retryAfterSeconds: 17,
        publicCode: 'menu_image_generation_rate_limited',
        retryable: true
    });
    assert.equal(JSON.stringify(menuImageFailureDiagnostic(err)).includes('PRIVATE_PROVIDER_MESSAGE'), false);
});

test('menu photo generator selection is allowlisted and defaults existing API callers to OpenAI', () => {
    assert.equal(resolveMenuImageGenerator().provider, 'openai');
    assert.deepEqual(resolveMenuImageGenerator('kie/nano-banana-2'), {
        provider: 'kie', model: 'nano-banana-2'
    });
    assert.deepEqual(resolveMenuImageGenerator('kie/nano-banana-pro'), {
        provider: 'kie', model: 'nano-banana-pro'
    });
    assert.throws(() => resolveMenuImageGenerator('kie/arbitrary-model'), err => err.code === 'menu_image_generator_invalid');
});

test('Kie starts one asynchronous image task with the selected model and aspect ratio', async () => {
    process.env.KIE_API_KEY = 'synthetic-test-key';
    const requests = [];
    global.fetch = async (url, options) => {
        requests.push({ url, options });
        return new Response(JSON.stringify({ code: 200, data: { taskId: 'task_123' } }), { status: 200 });
    };
    const started = await startMenuImageWithKie({ prompt: 'A burger', size: '1536x1024', model: 'nano-banana-2' });
    assert.equal(started.taskId, 'task_123');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.kie.ai/api/v1/jobs/createTask');
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.model, 'nano-banana-2');
    assert.equal(body.input.aspect_ratio, '3:2');
    assert.equal(body.input.output_format, 'png');
    assert.equal(body.input.prompt, 'A burger');
});

test('Kie uses the saved burger reference once, while the product prompt changes the filling', async () => {
    process.env.KIE_API_KEY = 'synthetic-test-key';
    const referenceImageUrl = 'https://crm.example.com/uploads/catalog-images/items/burger.png';
    const requests = [];
    global.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ code: 200, data: { taskId: 'task_ref_123' } }), { status: 200 });
    };
    const blueprint = { imageUrl: '/uploads/catalog-images/items/burger.png', instructions: 'Same plate and camera.' };
    const prompt = buildMenuImagePrompt({ name: 'Chicken burger', menu_section: 'Burgers', ingredients: 'chicken, lettuce' }, { blueprint });
    await startMenuImageWithKie({ prompt, size: '1536x1024', model: 'nano-banana-2', referenceImageUrl });
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].input.image_input, [referenceImageUrl]);
    assert.match(requests[0].input.prompt, /chicken, lettuce/);
    assert.match(requests[0].input.prompt, /Same plate and camera/);
});

test('burger blueprint is isolated per business and only accepts a saved CRM image', async () => {
    const values = new Map();
    const query = { async query(sql, params) {
        if (sql.startsWith('SELECT')) return { rows: values.has(params[0]) ? [{ value: values.get(params[0]) }] : [] };
        values.set(params[0], params[1]);
        return { rowCount: 1 };
    } };
    const product = { id: 'burger-1', name: 'Бургер курячий', icon_url: '/uploads/catalog-images/items/burger.jpg' };
    assert.equal(isBurgerMenuProduct(product), true);
    const saved = await saveBurgerBlueprint('event_genix', product, 'current', 'Same plate, fries and ketchup.', query);
    assert.equal(saved.imageUrl, product.icon_url);
    assert.equal((await readBurgerBlueprint('event_genix', query)).instructions, saved.instructions);
    assert.equal(await readBurgerBlueprint('other_business', query), null);
    const originalPublicBase = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'https://crm.example.com';
    assert.equal(publicBurgerBlueprintUrl(saved), 'https://crm.example.com/uploads/catalog-images/items/burger.jpg');
    if (originalPublicBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = originalPublicBase;
    await assert.rejects(saveBurgerBlueprint('event_genix', { ...product, icon_url: 'https://elsewhere.test/a.jpg' },
        'current', saved.instructions, query), err => err.code === 'menu_image_blueprint_image_invalid');
});

test('Kie polling reports pending and completed jobs without another generation request', async () => {
    process.env.KIE_API_KEY = 'synthetic-test-key';
    const urls = [];
    global.fetch = async url => {
        urls.push(url);
        const data = urls.length === 1 ? { state: 'generating' } : {
            state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://tempfileb.aiquickdraw.com/food.png'] })
        };
        return new Response(JSON.stringify({ code: 200, data }), { status: 200 });
    };
    assert.equal((await pollMenuImageWithKie('task_123')).status, 'generating');
    const ready = await pollMenuImageWithKie('task_123');
    assert.equal(ready.status, 'ready');
    assert.equal(ready.sourceUrl, 'https://tempfileb.aiquickdraw.com/food.png');
    assert.ok(urls.every(url => url.includes('/recordInfo?taskId=task_123')));
});

test('Kie missing key, credits, and rate limit return distinct safe errors', async () => {
    delete process.env.KIE_API_KEY;
    global.fetch = async () => assert.fail('No provider call without Kie key');
    await assert.rejects(startMenuImageWithKie({ prompt: 'Food', model: 'nano-banana-2' }), err => {
        assert.equal(menuImagePublicError(err).code, 'menu_image_generation_unavailable');
        return true;
    });
    process.env.KIE_API_KEY = 'synthetic-test-key';
    for (const [status, expected, retryable] of [
        [402, 'menu_image_generation_quota_exceeded', false],
        [429, 'menu_image_generation_rate_limited', true]
    ]) {
        global.fetch = async () => new Response(JSON.stringify({ code: status, msg: 'PRIVATE_PROVIDER_MESSAGE' }), {
            status, headers: { 'Retry-After': '12' }
        });
        await assert.rejects(startMenuImageWithKie({ prompt: 'Food', model: 'nano-banana-2' }), err => {
            const publicError = menuImagePublicError(err);
            assert.equal(publicError.code, expected);
            assert.equal(publicError.retryable, retryable);
            assert.equal(JSON.stringify(publicError).includes('PRIVATE_PROVIDER_MESSAGE'), false);
            return true;
        });
    }
});

test('Kie 429 without retry metadata does not promise a temporary cooldown', async () => {
    process.env.KIE_API_KEY = 'synthetic-test-key';
    global.fetch = async () => new Response(JSON.stringify({ code: 429, msg: 'PRIVATE_PROVIDER_MESSAGE' }), { status: 429 });
    await assert.rejects(startMenuImageWithKie({ prompt: 'Food', model: 'nano-banana-2' }), err => {
        const result = menuImagePublicError(err);
        assert.equal(result.code, 'menu_image_generation_provider_rejected');
        assert.equal(result.retryable, false);
        assert.equal(JSON.stringify(result).includes('PRIVATE_PROVIDER_MESSAGE'), false);
        return true;
    });
});

test('Kie task failure code 402 is a quota failure without an automatic retry', async () => {
    process.env.KIE_API_KEY = 'synthetic-test-key';
    global.fetch = async () => new Response(JSON.stringify({
        code: 200,
        data: { state: 'fail', failCode: '402', failMsg: 'PRIVATE_PROVIDER_MESSAGE' }
    }), { status: 200 });
    const result = await pollMenuImageWithKie('task_credits');
    assert.equal(result.status, 'failed');
    assert.equal(result.error.providerCode, '402');
    assert.equal(result.error.providerTaskId, 'task_credits');
    const publicError = menuImagePublicError(result.error);
    assert.equal(publicError.code, 'menu_image_generation_quota_exceeded');
    assert.equal(publicError.retryable, false);
    assert.equal(JSON.stringify(publicError).includes('PRIVATE_PROVIDER_MESSAGE'), false);
});

test('Kie task failures retain only a bounded code and task ID, never the provider message', async () => {
    process.env.KIE_API_KEY = 'synthetic-test-key';
    global.fetch = async () => new Response(JSON.stringify({
        code: 200,
        data: { state: 'fail', failCode: 'INPUT_IMAGE_FAILED', failMsg: 'PRIVATE_PROVIDER_MESSAGE' }
    }), { status: 200 });
    const result = await pollMenuImageWithKie('task_reference_123');
    assert.equal(result.status, 'failed');
    assert.equal(menuImagePublicError(result.error).code, 'menu_image_generation_failed');
    assert.equal(result.error.providerCode, 'INPUT_IMAGE_FAILED');
    assert.equal(result.error.providerTaskId, 'task_reference_123');
    const diagnostic = menuImageFailureDiagnostic(result.error);
    assert.equal(diagnostic.providerCode, 'INPUT_IMAGE_FAILED');
    assert.equal(diagnostic.providerTaskId, 'task_reference_123');
    assert.equal(JSON.stringify(diagnostic).includes('PRIVATE_PROVIDER_MESSAGE'), false);

    global.fetch = async () => new Response(JSON.stringify({
        code: 200,
        data: { state: 'fail', failCode: 'PRIVATE URL https://example.test/key', failMsg: 'PRIVATE_PROVIDER_MESSAGE' }
    }), { status: 200 });
    const unsafe = await pollMenuImageWithKie('task_reference_456');
    assert.equal(menuImageFailureDiagnostic(unsafe.error).providerCode, null);
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
