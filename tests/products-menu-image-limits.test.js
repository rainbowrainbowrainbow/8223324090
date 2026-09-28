const { test } = require('node:test');
const assert = require('node:assert/strict');

const router = require('../routes/products');

function routeLimiter(path) {
    const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods.post)?.route;
    assert.ok(route, `POST ${path} must exist`);
    return route.stack[0].handle;
}

function request(limiter, ip) {
    const result = { nextCalled: false, status: null, body: null, headers: {} };
    const response = {
        setHeader(name, value) {
            result.headers[name] = value;
            return this;
        },
        status(status) {
            result.status = status;
            return this;
        },
        json(body) {
            result.body = body;
            return this;
        }
    };
    limiter({ method: 'POST', ip }, response, () => { result.nextCalled = true; });
    return result;
}

test('draft and generate alias share the four-request generation budget', () => {
    const draft = routeLimiter('/:id/menu-image/draft');
    const generate = routeLimiter('/:id/menu-image/generate');
    assert.strictEqual(draft, generate);

    const ip = 'menu-image-generation-test';
    for (const limiter of [draft, generate, draft, generate]) {
        assert.equal(request(limiter, ip).nextCalled, true);
    }

    const blocked = request(draft, ip);
    assert.equal(blocked.nextCalled, false);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, 'product_menu_image_generation_rate_limited');
    assert.equal(blocked.body.retryable, true);
    assert.ok(blocked.body.retryAfterSeconds >= 1);
    assert.equal(blocked.headers['Retry-After'], String(blocked.body.retryAfterSeconds));
});

test('external draft, apply, and reject share a separate guarded review budget', () => {
    const generation = routeLimiter('/:id/menu-image/draft');
    const externalDraft = routeLimiter('/:id/menu-image/external-draft');
    const apply = routeLimiter('/:id/menu-image/apply');
    const reject = routeLimiter('/:id/menu-image/reject');
    assert.strictEqual(externalDraft, apply);
    assert.strictEqual(apply, reject);
    assert.notStrictEqual(generation, externalDraft);

    const ip = 'menu-image-review-test';
    for (const limiter of [externalDraft, apply, reject, apply]) {
        assert.equal(request(limiter, ip).nextCalled, true);
    }
    const blocked = request(reject, ip);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, 'product_menu_image_review_rate_limited');

    assert.equal(request(generation, ip).nextCalled, true);
});

test('a full generation budget does not block review actions', () => {
    const generation = routeLimiter('/:id/menu-image/draft');
    const apply = routeLimiter('/:id/menu-image/apply');
    const ip = 'menu-image-independent-test';

    for (let index = 0; index < 4; index++) {
        assert.equal(request(generation, ip).nextCalled, true);
    }
    assert.equal(request(generation, ip).status, 429);
    assert.equal(request(apply, ip).nextCalled, true);
});
