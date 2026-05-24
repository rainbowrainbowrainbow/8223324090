const test = require('node:test');
const assert = require('node:assert/strict');
const { errorResponseMetadata } = require('../middleware/errorResponseMetadata');

function runMiddleware({ statusCode, body, requestId = 'req-test-1' }) {
    let jsonPayload = null;
    const req = { headers: { 'x-request-id': requestId } };
    const res = {
        statusCode,
        getHeader(name) {
            return name.toLowerCase() === 'x-request-id' ? requestId : undefined;
        },
        json(payload) {
            jsonPayload = payload;
            return payload;
        }
    };

    errorResponseMetadata(req, res, () => {});
    res.json(body);
    return jsonPayload;
}

test('500 JSON API responses include requestId and success=false', () => {
    const payload = runMiddleware({
        statusCode: 500,
        body: { error: 'Internal server error' },
        requestId: 'abc123'
    });

    assert.deepEqual(payload, {
        error: 'Internal server error',
        requestId: 'abc123',
        success: false
    });
});

test('non-error JSON responses are not rewritten', () => {
    const payload = runMiddleware({
        statusCode: 400,
        body: { error: 'Bad request' },
        requestId: 'abc123'
    });

    assert.deepEqual(payload, { error: 'Bad request' });
});
