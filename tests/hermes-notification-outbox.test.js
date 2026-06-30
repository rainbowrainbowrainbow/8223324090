const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('minimal Hermes route exposes notification_outbox endpoints and auth gate', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/hermes.js'), 'utf8');
  assert.match(source, /notification-outbox/);
  assert.match(source, /claimNotificationOutboxEvent/);
  assert.match(source, /ackNotificationOutboxEvent/);
  assert.match(source, /failNotificationOutboxEvent/);
  assert.match(source, /HERMES_API_KEY/);
});

test('server mounts Hermes notification_outbox route before settings fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(source, /app\.use\('\/api\/hermes', require\('\.\/routes\/hermes'\)\)/);
  assert.match(source, /req\.path\.startsWith\('\/hermes\/notification-outbox'\)/);
});
