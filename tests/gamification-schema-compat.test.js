'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('gamification achievements support username/key and user_id/achievement_id schemas', () => {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'gamification.js'), 'utf8');

    assert.match(source, /function getUserAchievementSchema/);
    assert.match(source, /mode: 'username_key'/);
    assert.match(source, /mode: 'user_id'/);
    assert.match(source, /JOIN users achievement_user ON achievement_user\.id = ua\.user_id/);
    assert.match(source, /ua\.achievement_id = ac\.id/);
    assert.match(source, /ON CONFLICT \(user_id, achievement_id\) DO NOTHING/);
    assert.match(source, /ON CONFLICT \(username, achievement_key\) DO NOTHING/);
});
