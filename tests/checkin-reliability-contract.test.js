'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const security = fs.readFileSync(path.join(ROOT, 'middleware/security.js'), 'utf8');
const checkin = fs.readFileSync(path.join(ROOT, 'checkin.html'), 'utf8');

function section(source, start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.notEqual(from, -1, `missing ${start}`);
    assert.notEqual(to, -1, `missing ${end}`);
    return source.slice(from, to);
}

test('Check-in permits only the model CDN connection required by face-api', () => {
    const connectSource = security.match(/connect-src[^;']*(?:'[^']*'[^;]*)*/)?.[0] || security.match(/connect-src[^;]*/)?.[0] || '';
    assert.match(connectSource, /https:\/\/cdn\.jsdelivr\.net/, 'CSP permits the model CDN in connect-src');
    assert.doesNotMatch(connectSource, /connect-src\s+\*/, 'CSP does not open arbitrary model connections');
    assert.match(checkin, /https:\/\/cdn\.jsdelivr\.net\/npm\/face-api\.js/, 'face-api is loaded from the CSP-approved CDN');
});

test('Check-in exits model loading before camera or attendance work on CDN failure', () => {
    const models = section(checkin, 'async function loadModels()', 'async function loadDescriptors()');
    assert.match(models, /MODEL_LOAD_TIMEOUT_MS/, 'model loading is bounded by a timeout');
    assert.match(models, /withTimeout\(/, 'model loading uses the timeout boundary');
    assert.match(models, /faceapi\.nets\./, 'face-api model nets are loaded inside the boundary');
    assert.doesNotMatch(models, /getUserMedia|\/api\/staff\/(?:checkin|checkout)|face-descriptor/, 'model loader cannot start camera or mutate attendance');

    const initializationBeforeCamera = section(checkin, 'async function initializeCheckin()', 'var cameraReady = await startCamera()');
    assert.match(initializationBeforeCamera, /await loadModels\(\);/, 'models initialize before camera');
    assert.match(initializationBeforeCamera, /showInitializationError\(err, 'model'\);/, 'model failure has an explicit error state');
    assert.match(initializationBeforeCamera, /return;/, 'model failure stops initialization');
    assert.doesNotMatch(initializationBeforeCamera, /loadDescriptors\(|loadLog\(|detectLoop\(|performCheckin\(/, 'model failure cannot reach recognition or attendance mutation');
    assert.match(checkin, /id="retryCheckinInitBtn"/, 'a retry control is rendered');
    assert.match(checkin, /window\.retryCheckinInitialization = initializeCheckin;/, 'retry reuses the guarded initializer');
});