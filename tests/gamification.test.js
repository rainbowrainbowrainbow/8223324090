/**
 * tests/gamification.test.js — Gamification API Tests (Quiz, Streaks, Room, Boss, Minigame)
 * Run: node --test tests/gamification.test.js
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { authRequest } = require('./helpers');

// ==========================================
// QUIZ
// ==========================================
describe('Quiz', () => {
    it('GET /api/quiz/status — returns quiz availability', async () => {
        const res = await authRequest('GET', '/api/quiz/status');
        assert.equal(res.status, 200);
        assert.ok('canPlay' in res.data, 'Should have canPlay');
        assert.ok('cooldownLeft' in res.data, 'Should have cooldownLeft');
        assert.ok('todayGames' in res.data, 'Should have todayGames');
        assert.ok('maxDaily' in res.data, 'Should have maxDaily');
        assert.ok('questionsPerGame' in res.data, 'Should have questionsPerGame');
    });

    it('GET /api/quiz/leaderboard — returns leaderboard', async () => {
        const res = await authRequest('GET', '/api/quiz/leaderboard?period=alltime');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Leaderboard should be an array');
    });

    it('GET /api/quiz/questions — admin lists questions', async () => {
        const res = await authRequest('GET', '/api/quiz/questions');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Questions should be an array');
        if (res.data.length > 0) {
            assert.ok(res.data[0].question, 'Question should have question text');
            assert.ok(res.data[0].answers, 'Question should have answers');
        }
    });

    it('POST /api/quiz/start — starts a quiz session', async () => {
        const res = await authRequest('POST', '/api/quiz/start');
        // May succeed or fail with cooldown/limit — both are valid
        assert.ok([200, 429, 400].includes(res.status), `Expected 200, 429, or 400, got ${res.status}`);
        if (res.status === 200) {
            assert.ok(res.data.sessionId, 'Should have sessionId');
            assert.ok(Array.isArray(res.data.questions), 'Should have questions array');
            assert.equal(res.data.questions.length, 5, 'Should have 5 questions');
            // Verify correct_index is NOT sent to client (anti-cheat)
            for (const q of res.data.questions) {
                assert.ok(!('correct_index' in q), 'Should NOT expose correct_index');
                assert.ok(Array.isArray(q.answers), 'Each question should have answers array');
            }
        }
    });

    it('POST /api/quiz/complete — rejects invalid session', async () => {
        const res = await authRequest('POST', '/api/quiz/complete', {
            sessionId: 999999,
            answers: []
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/quiz/complete — rejects missing data', async () => {
        const res = await authRequest('POST', '/api/quiz/complete', {});
        assert.equal(res.status, 400);
    });
});

// ==========================================
// STREAKS
// ==========================================
describe('Streaks', () => {
    it('GET /api/streaks — returns all streak types', async () => {
        const res = await authRequest('GET', '/api/streaks');
        assert.equal(res.status, 200);
        const streakTypes = ['minigame', 'task', 'booking', 'quiz', 'login'];
        for (const type of streakTypes) {
            assert.ok(type in res.data, `Should have ${type} streak`);
            assert.ok('current' in res.data[type], `${type} should have current`);
            assert.ok('best' in res.data[type], `${type} should have best`);
            assert.ok('activeToday' in res.data[type], `${type} should have activeToday`);
            assert.ok('label' in res.data[type], `${type} should have label`);
        }
    });

    it('GET /api/streaks/leaderboard — returns leaderboard by type', async () => {
        const res = await authRequest('GET', '/api/streaks/leaderboard?type=login');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Leaderboard should be an array');
        if (res.data.length > 0) {
            assert.ok('userId' in res.data[0], 'Entry should have userId');
            assert.ok('current' in res.data[0], 'Entry should have current');
            assert.ok('best' in res.data[0], 'Entry should have best');
        }
    });

    it('GET /api/streaks/leaderboard — works for all types', async () => {
        for (const type of ['minigame', 'task', 'quiz', 'booking']) {
            const res = await authRequest('GET', `/api/streaks/leaderboard?type=${type}`);
            assert.equal(res.status, 200, `Leaderboard for ${type} should return 200`);
            assert.ok(Array.isArray(res.data), `Leaderboard for ${type} should be an array`);
        }
    });
});

// ==========================================
// ROOM
// ==========================================
describe('Room', () => {
    it('GET /api/room — returns own room (auto-create)', async () => {
        const res = await authRequest('GET', '/api/room');
        assert.equal(res.status, 200);
        assert.ok('userId' in res.data, 'Should have userId');
        assert.ok('layout' in res.data, 'Should have layout');
        assert.ok('mood' in res.data, 'Should have mood');
        assert.ok('visitorCount' in res.data, 'Should have visitorCount');
        assert.ok(Array.isArray(res.data.furniture), 'Should have furniture array');
    });

    it('GET /api/room/:userId — visit own room', async () => {
        const myRoom = await authRequest('GET', '/api/room');
        const userId = myRoom.data.userId;
        const res = await authRequest('GET', `/api/room/${userId}`);
        assert.equal(res.status, 200);
        assert.ok('ownerName' in res.data, 'Visit should have ownerName');
        assert.ok('layout' in res.data, 'Visit should have layout');
    });

    it('GET /api/room/:userId — invalid userId', async () => {
        const res = await authRequest('GET', '/api/room/abc');
        assert.equal(res.status, 400);
    });

    it('GET /api/room/:userId — nonexistent user', async () => {
        const res = await authRequest('GET', '/api/room/999999');
        assert.equal(res.status, 404);
    });

    it('PUT /api/room/decorate — set mood', async () => {
        const res = await authRequest('PUT', '/api/room/decorate', { mood: 'excited' });
        assert.equal(res.status, 200);
        assert.ok(res.data.success, 'Should succeed');
    });

    it('PUT /api/room/decorate — invalid mood ignored', async () => {
        const res = await authRequest('PUT', '/api/room/decorate', { mood: 'invalid_mood' });
        assert.equal(res.status, 400); // nothing changed
    });

    it('PUT /api/room/decorate — empty body rejected', async () => {
        const res = await authRequest('PUT', '/api/room/decorate', {});
        assert.equal(res.status, 400);
    });

    it('PUT /api/room/move — missing fields rejected', async () => {
        const res = await authRequest('PUT', '/api/room/move', { item_id: 1 });
        assert.equal(res.status, 400);
    });

    it('PUT /api/room/move — out of bounds rejected', async () => {
        const res = await authRequest('PUT', '/api/room/move', { item_id: 1, row: 10, col: 0 });
        assert.equal(res.status, 400);
    });

    it('GET /api/room/visitors/list — returns visitors', async () => {
        const res = await authRequest('GET', '/api/room/visitors/list');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Visitors should be an array');
    });
});

// ==========================================
// MINIGAME
// ==========================================
describe('Minigame', () => {
    it('GET /api/minigame/status — returns game availability', async () => {
        const res = await authRequest('GET', '/api/minigame/status');
        assert.equal(res.status, 200);
        assert.ok('canPlay' in res.data, 'Should have canPlay');
        assert.ok('cooldownLeft' in res.data, 'Should have cooldownLeft');
        assert.ok('todayGames' in res.data, 'Should have todayGames');
        assert.ok('maxDaily' in res.data, 'Should have maxDaily');
        assert.ok('bestScore' in res.data, 'Should have bestScore');
    });

    it('GET /api/minigame/daily-records — returns daily records', async () => {
        const res = await authRequest('GET', '/api/minigame/daily-records');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.top3), 'Should have top3 array');
        assert.ok('myBestToday' in res.data, 'Should have myBestToday');
        assert.ok('myBestAllTime' in res.data, 'Should have myBestAllTime');
    });

    it('GET /api/minigame/boss — returns boss round status', async () => {
        const res = await authRequest('GET', '/api/minigame/boss');
        assert.equal(res.status, 200);
        assert.ok('isBossDay' in res.data, 'Should have isBossDay');
        assert.ok('weekStart' in res.data, 'Should have weekStart');
        assert.ok('targetScore' in res.data, 'Should have targetScore');
        assert.ok('played' in res.data, 'Should have played');
    });

    it('POST /api/minigame/complete — rejects missing data', async () => {
        const res = await authRequest('POST', '/api/minigame/complete', {});
        assert.equal(res.status, 400);
    });

    it('POST /api/minigame/complete — rejects non-number score', async () => {
        const res = await authRequest('POST', '/api/minigame/complete', {
            score: 'not_a_number',
            coins_earned: 10
        });
        assert.equal(res.status, 400);
    });

    it('POST /api/minigame/boss/complete — rejects missing score', async () => {
        const res = await authRequest('POST', '/api/minigame/boss/complete', {});
        assert.equal(res.status, 400);
    });
});

// ==========================================
// WALLET (gamification economy)
// ==========================================
describe('Wallet', () => {
    it('GET /api/wallet — returns wallet info', async () => {
        const res = await authRequest('GET', '/api/wallet');
        assert.equal(res.status, 200);
        assert.ok('coins' in res.data, 'Should have coins');
    });

    it('GET /api/wallet/history — returns paginated transaction history', async () => {
        const res = await authRequest('GET', '/api/wallet/history');
        assert.equal(res.status, 200);
        assert.ok('transactions' in res.data, 'Should have transactions key');
        assert.ok(Array.isArray(res.data.transactions), 'Transactions should be an array');
        assert.ok('total' in res.data, 'Should have total count');
    });
});

// ==========================================
// QUESTS
// ==========================================
describe('Quests', () => {
    it('GET /api/quests/daily — returns daily quests', async () => {
        const res = await authRequest('GET', '/api/quests/daily');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data.quests), 'Should have quests array');
        assert.ok('date' in res.data, 'Should have date');
    });
});

// ==========================================
// ACHIEVEMENTS
// ==========================================
describe('Achievements', () => {
    it('GET /api/achievements — returns achievements list', async () => {
        const res = await authRequest('GET', '/api/achievements');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Achievements should be an array');
        if (res.data.length > 0) {
            assert.ok('code' in res.data[0], 'Achievement should have code');
            assert.ok('name' in res.data[0], 'Achievement should have name');
            assert.ok('rarity' in res.data[0], 'Achievement should have rarity');
        }
    });

    it('GET /api/achievements/catalog — returns achievements catalog', async () => {
        const res = await authRequest('GET', '/api/achievements/catalog');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Catalog should be an array');
    });

    it('POST /api/achievements/check — checks and awards achievements', async () => {
        const res = await authRequest('POST', '/api/achievements/check');
        assert.equal(res.status, 200);
        assert.ok('awarded' in res.data, 'Should have awarded');
        assert.ok('count' in res.data, 'Should have count');
    });
});

// ==========================================
// SHOP
// ==========================================
describe('Shop', () => {
    it('GET /api/shop — returns shop items', async () => {
        const res = await authRequest('GET', '/api/shop');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Shop should return an array');
    });

    it('GET /api/shop/inventory — returns user inventory', async () => {
        const res = await authRequest('GET', '/api/shop/inventory');
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.data), 'Inventory should be an array');
    });
});
