const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readCssWithImports(file, seen = new Set()) {
    const normalized = file.replace(/\\/g, '/');
    if (seen.has(normalized)) return '';
    seen.add(normalized);

    const css = fs.readFileSync(path.join(ROOT, normalized), 'utf8');
    const dir = path.posix.dirname(normalized);
    const imports = [];
    const importPattern = /@import\s+(?:url\()?["']?([^"')]+\.css(?:\?[^"')]+)?)["']?\)?\s*;?/g;
    let match;

    while ((match = importPattern.exec(css)) !== null) {
        const rawRef = match[1].split('?')[0].replace(/^\/+/, '');
        const imported = rawRef.startsWith('css/')
            ? rawRef
            : path.posix.normalize(path.posix.join(dir, rawRef));
        imports.push(readCssWithImports(imported, seen));
    }

    return [css, ...imports].filter(Boolean).join('\n');
}

test('task decomposition milestones use the canonical achievements route', () => {
    const route = fs.readFileSync(path.join(ROOT, 'routes', 'achievements.js'), 'utf8');
    const migration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '213_task_decomposition_achievements.sql'), 'utf8');

    assert.match(route, /FROM task_subtasks/);
    assert.match(route, /buildTaskOwnerMatch/);
    assert.match(route, /completed_parent_tasks/);
    assert.match(route, /completed_subtasks/);
    assert.match(route, /tasks_completed:\s*tasksR\.rows\[0\]\?\.cnt/);
    assert.match(route, /COUNT\(\*\) FILTER \(WHERE is_done = true\)::int AS done/);
    assert.match(route, /decomposed_tasks_completed/);
    assert.match(route, /ai_decomposed_tasks_completed/);
    assert.match(route, /template_decomposed_tasks_completed/);
    assert.match(route, /subtasks_completed/);

    for (const code of [
        'task_10_done',
        'task_decompose_5',
        'task_decompose_5_done',
        'subtask_10_done',
        'task_ai_decompose_done',
        'task_template_done'
    ]) {
        assert.match(migration, new RegExp(code));
    }
    assert.match(migration, /INSERT INTO achievements/);
    assert.match(migration, /ON CONFLICT \(code\) DO UPDATE/);
});

test('achievement completion winner and coin award share one transaction', () => {
    const route = fs.readFileSync(path.join(ROOT, 'routes', 'achievements.js'), 'utf8');
    const atomicStart = route.indexOf('async function completeAchievementAndAward');
    const routeStart = route.indexOf('// GET /api/achievements', atomicStart);
    assert.ok(atomicStart >= 0 && routeStart > atomicStart);
    const atomic = route.slice(atomicStart, routeStart);

    assert.match(atomic, /await pool\.connect\(\)/);
    assert.match(atomic, /client\.query\('BEGIN'\)/);
    assert.match(atomic, /ON CONFLICT \(user_id, achievement_id\) DO UPDATE SET/);
    assert.match(atomic, /WHERE NOT COALESCE\(user_achievements\.completed, false\)/);
    assert.match(atomic, /RETURNING id/);
    assert.match(atomic, /completion\.rowCount !== 1/);
    assert.match(atomic, /awardAchievementCoins\(userId, username, achievement, client\)/);
    assert.match(atomic, /client\.query\('COMMIT'\)/);
    assert.match(atomic, /client\.query\('ROLLBACK'\)/);
});

test('profile keeps the existing achievements tab instead of a separate productivity panel', () => {
    const profileCode = fs.readFileSync(path.join(ROOT, 'js', 'profile-page.js'), 'utf8');
    const profileCss = readCssWithImports('css/pages.css');

    assert.match(profileCode, /function renderAchievements/);
    assert.match(profileCode, /apiGet\('\/achievements'\)/);
    assert.doesNotMatch(profileCode, /renderCabinetProductivitySurface/);
    assert.doesNotMatch(profileCode, /\/tasks\/productivity/);
    assert.doesNotMatch(profileCss, /cabinet-productivity-surface/);
});

function loadTitleCheckHarness(definitions, options = {}) {
    const queries = [];
    const inserted = [];
    const pool = {
        async query(sql, params = []) {
            const text = String(sql).replace(/\s+/g, ' ').trim();
            queries.push({ text, params });
            if (/^SELECT \* FROM title_definitions LIMIT 500$/i.test(text)) {
                return { rows: definitions, rowCount: definitions.length };
            }
            if (/^SELECT title_code FROM user_titles WHERE user_id = \$1$/i.test(text)) {
                return { rows: options.earned || [], rowCount: (options.earned || []).length };
            }
            if (/^SELECT COUNT\(\*\) FROM tasks t/i.test(text)) {
                return { rows: [{ count: String(options.tasksCompleted || 0) }], rowCount: 1 };
            }
            if (/^SELECT COUNT\(\*\) FROM user_inventory WHERE/i.test(text)) {
                return { rows: [{ count: String(options.itemsOwned || 0) }], rowCount: 1 };
            }
            if (/^SELECT total_earned FROM game_wallets WHERE/i.test(text)) {
                return { rows: [{ total_earned: options.totalEarned || 0 }], rowCount: 1 };
            }
            if (/^SELECT COUNT\(\*\) FROM minigame_sessions/i.test(text)) {
                return { rows: [{ count: String(options.gamesPlayed || 0) }], rowCount: 1 };
            }
            if (/^SELECT COUNT\(\*\) FROM user_inventory ui JOIN shop_items/i.test(text)) {
                return { rows: [{ count: String(options.roomItems || 0) }], rowCount: 1 };
            }
            if (/^SELECT created_at FROM users/i.test(text)) {
                return { rows: [{ created_at: options.createdAt || new Date() }], rowCount: 1 };
            }
            if (/^SELECT user_id FROM game_wallets ORDER BY/i.test(text)) {
                return { rows: [{ user_id: options.leaderUserId || null }], rowCount: 1 };
            }
            if (/^INSERT INTO user_titles/i.test(text)) {
                inserted.push(params[1]);
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected title-check query: ${text}`);
        }
    };
    const dbPath = require.resolve('../db');
    const authPath = require.resolve('../middleware/auth');
    const routePath = require.resolve('../routes/quests');
    const previous = new Map([
        [dbPath, require.cache[dbPath]],
        [authPath, require.cache[authPath]],
        [routePath, require.cache[routePath]]
    ]);
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } };
    require.cache[authPath] = {
        id: authPath,
        filename: authPath,
        loaded: true,
        exports: { requireRole: () => (_req, _res, next) => next(), ANY_ROLE: ['manager'] }
    };
    delete require.cache[routePath];
    const quests = require('../routes/quests');
    return {
        checkTitles: quests.checkTitles,
        queries,
        inserted,
        cleanup() {
            for (const [id, entry] of previous) {
                if (entry) require.cache[id] = entry;
                else delete require.cache[id];
            }
        }
    };
}

test('title checks keep read query count constant for N=1/10/100 unearned titles', async () => {
    const counts = [];
    for (const size of [1, 10, 100]) {
        const definitions = Array.from({ length: size }, (_, index) => ({
            code: `tasks-${size}-${index}`,
            name: `Tasks ${size}-${index}`,
            icon: 'T',
            rarity: 'common',
            condition_type: 'tasks_completed',
            condition_value: 999
        }));
        const harness = loadTitleCheckHarness(definitions);
        try {
            assert.deepEqual(await harness.checkTitles(42), []);
            counts.push(harness.queries.filter(query => /^SELECT /i.test(query.text)).length);
        } finally {
            harness.cleanup();
        }
    }
    assert.deepEqual(counts, [3, 3, 3]);
});

test('batched title criteria preserve every existing qualification contract', async () => {
    const definitions = [
        ['registration', 1],
        ['tasks_completed', 3],
        ['items_owned', 2],
        ['total_earned', 100],
        ['games_played', 4],
        ['room_items', 1],
        ['days_active', 2],
        ['leaderboard_top', 1]
    ].map(([type, value]) => ({
        code: `title-${type}`,
        name: type,
        icon: 'T',
        rarity: 'common',
        condition_type: type,
        condition_value: value
    }));
    const harness = loadTitleCheckHarness(definitions, {
        tasksCompleted: 3,
        itemsOwned: 2,
        totalEarned: 100,
        gamesPlayed: 4,
        roomItems: 1,
        createdAt: new Date(Date.now() - 3 * 86400000),
        leaderUserId: 42
    });
    try {
        const titles = await harness.checkTitles(42);
        assert.deepEqual(Array.from(titles, title => title.code), definitions.map(title => title.code));
        assert.deepEqual(harness.inserted, definitions.map(title => title.code));
        assert.equal(harness.queries.filter(query => /^SELECT /i.test(query.text)).length, 9);
    } finally {
        harness.cleanup();
    }
});
