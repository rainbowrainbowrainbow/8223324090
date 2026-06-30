const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Kleshnya createTask has a soft Hermes notification_outbox hook', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/kleshnya.js'), 'utf8');
  assert.match(source, /emitTaskCreatedNotificationOutboxEvent/);
  assert.match(source, /async function createTask\(data, options = \{\}\)/);
  assert.match(source, /owner_user_id: Number\.isInteger\(ownerUserId\)/);
  assert.match(source, /skipHermesOutbox/);
  assert.match(source, /\.catch\(err => log\.error\(`Hermes notification_outbox error/);
});
