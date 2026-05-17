/**
 * routes/quests.js — Daily Quests + Titles API
 * v22.5.0
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, ANY_ROLE } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Quests');

/**
 * Pick 3 quests for today using deterministic seed (date + userId).
 * Excludes the meta-quest (complete_all_quests) which is always added as 4th.
 */
function getTodayQuestIds(allQuests, userId) {
    const today = new Date().toISOString().split('T')[0];
    const seed = hashCode(today + '-' + userId);
    const regular = allQuests.filter(q => q.quest_type !== 'meta_quest');
    const picked = [];
    const used = new Set();
    for (let i = 0; i < 3 && i < regular.length; i++) {
        let idx = Math.abs((seed + i * 7919) % regular.length);
        let attempts = 0;
        while (used.has(idx) && attempts < regular.length) { idx = (idx + 1) % regular.length; attempts++; }
        used.add(idx);
        picked.push(regular[idx].id);
    }
    return picked;
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return hash;
}

// GET /api/quests/daily — today's quests with progress
router.get('/daily', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const allQuests = await pool.query('SELECT * FROM daily_quests ORDER BY id LIMIT 200');
        const todayIds = getTodayQuestIds(allQuests.rows, req.user.id);
        const metaQuest = allQuests.rows.find(q => q.quest_type === 'meta_quest');
        const questIds = metaQuest ? [...todayIds, metaQuest.id] : todayIds;

        // Ensure user_daily_quests rows exist for today
        const today = new Date().toISOString().split('T')[0];
        for (const qid of questIds) {
            await pool.query(
                'INSERT INTO user_daily_quests (user_id, quest_id, date) VALUES ($1, $2, $3) ON CONFLICT (user_id, quest_id, date) DO NOTHING',
                [req.user.id, qid, today]
            );
        }

        const progress = await pool.query(
            'SELECT * FROM user_daily_quests WHERE user_id = $1 AND date = $2',
            [req.user.id, today]
        );

        const progressMap = {};
        for (const p of progress.rows) progressMap[p.quest_id] = p;

        const quests = questIds.map(qid => {
            const q = allQuests.rows.find(r => r.id === qid);
            const p = progressMap[qid] || {};
            return {
                id: q.id,
                code: q.code,
                title: q.title,
                description: q.description,
                targetValue: q.target_value,
                rewardCoins: q.reward_coins,
                questType: q.quest_type,
                progress: p.progress || 0,
                completed: p.completed || false,
                claimed: p.claimed || false
            };
        });

        res.json({ quests, date: today });
    } catch (err) {
        log.error('Get daily quests error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/quests/claim/:questId — claim reward
router.post('/claim/:questId', requireRole(...ANY_ROLE), async (req, res) => {
    const questId = parseInt(req.params.questId);
    if (!questId) return res.status(400).json({ error: 'Невірний questId' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const today = new Date().toISOString().split('T')[0];

        const uq = await client.query(
            'SELECT * FROM user_daily_quests WHERE user_id = $1 AND quest_id = $2 AND date = $3 FOR UPDATE',
            [req.user.id, questId, today]
        );

        if (uq.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Квест не знайдено' });
        }

        const quest = uq.rows[0];
        if (!quest.completed) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Квест ще не виконано' });
        }
        if (quest.claimed) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Нагорода вже отримана' });
        }

        // Get reward amount
        const qDef = await client.query('SELECT * FROM daily_quests WHERE id = $1 LIMIT 1', [questId]);
        if (qDef.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Квест не знайдено' });
        }
        const reward = qDef.rows[0].reward_coins;

        // Award coins
        await client.query(
            'UPDATE game_wallets SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE user_id = $2',
            [reward, req.user.id]
        );
        await client.query(
            'INSERT INTO coin_transactions (user_id, amount, type, description, reference_id) VALUES ($1, $2, $3, $4, $5)',
            [req.user.id, reward, 'quest', `Квест: ${qDef.rows[0].title}`, questId]
        );

        // Mark claimed
        await client.query(
            'UPDATE user_daily_quests SET claimed = true WHERE user_id = $1 AND quest_id = $2 AND date = $3',
            [req.user.id, questId, today]
        );

        await client.query('COMMIT');
        res.json({ success: true, reward, questTitle: qDef.rows[0].title });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Claim quest error', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/quests/progress — update quest progress (internal hook)
async function updateQuestProgress(userId, questType, increment = 1) {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Find matching quest for today
        const result = await pool.query(`
            UPDATE user_daily_quests SET
                progress = LEAST(progress + $1, (SELECT target_value FROM daily_quests WHERE id = quest_id)),
                completed = (progress + $1 >= (SELECT target_value FROM daily_quests WHERE id = quest_id))
            WHERE user_id = $2 AND date = $3 AND quest_id IN (
                SELECT dq.id FROM daily_quests dq WHERE dq.quest_type = $4
            ) AND NOT claimed
            RETURNING quest_id, progress, completed
        `, [increment, userId, today, questType]);

        // Check meta-quest (all 3 regular quests completed)
        if (result.rows.length > 0 && result.rows[0].completed) {
            const allCompleted = await pool.query(`
                SELECT COUNT(*) as done FROM user_daily_quests
                WHERE user_id = $1 AND date = $2 AND completed = true
                AND quest_id IN (SELECT id FROM daily_quests WHERE quest_type != 'meta_quest')
            `, [userId, today]);

            if (parseInt(allCompleted.rows[0].done) >= 3) {
                await pool.query(`
                    UPDATE user_daily_quests SET progress = 3, completed = true
                    WHERE user_id = $1 AND date = $2 AND quest_id IN (
                        SELECT id FROM daily_quests WHERE quest_type = 'meta_quest'
                    ) AND NOT claimed
                `, [userId, today]);
            }
        }
    } catch (err) {
        log.error('Update quest progress error', err);
    }
}

// --- Titles API ---

// GET /api/quests/titles — all titles + user's earned titles
router.get('/titles', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const [definitions, earned, profile] = await Promise.all([
            pool.query('SELECT * FROM title_definitions ORDER BY id LIMIT 500'),
            pool.query('SELECT title_code, earned_at FROM user_titles WHERE user_id = $1', [req.user.id]),
            pool.query('SELECT active_title FROM user_profiles_extended WHERE user_id = $1', [req.user.id])
        ]);

        const earnedMap = {};
        for (const t of earned.rows) earnedMap[t.title_code] = t.earned_at;

        res.json({
            titles: definitions.rows.map(t => ({
                code: t.code, name: t.name, description: t.description,
                conditionType: t.condition_type, conditionValue: t.condition_value,
                rarity: t.rarity, icon: t.icon,
                earned: !!earnedMap[t.code], earnedAt: earnedMap[t.code] || null
            })),
            activeTitle: profile.rows[0]?.active_title || null
        });
    } catch (err) {
        log.error('Get titles error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/quests/titles/set — set active title
router.put('/titles/set', requireRole(...ANY_ROLE), async (req, res) => {
    const { title_code } = req.body;

    try {
        if (title_code) {
            // Verify user has earned this title
            const earned = await pool.query(
                'SELECT 1 FROM user_titles WHERE user_id = $1 AND title_code = $2',
                [req.user.id, title_code]
            );
            if (earned.rows.length === 0) return res.status(400).json({ error: 'Титул не розблоковано' });
        }

        await pool.query(
            'UPDATE user_profiles_extended SET active_title = $1, updated_at = NOW() WHERE user_id = $2',
            [title_code || null, req.user.id]
        );

        res.json({ success: true });
    } catch (err) {
        log.error('Set title error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Check and award titles based on conditions
async function checkTitles(userId) {
    try {
        const [definitions, earned] = await Promise.all([
            pool.query('SELECT * FROM title_definitions LIMIT 500'),
            pool.query('SELECT title_code FROM user_titles WHERE user_id = $1', [userId])
        ]);

        const earnedSet = new Set(earned.rows.map(r => r.title_code));
        const newTitles = [];

        for (const title of definitions.rows) {
            if (earnedSet.has(title.code)) continue;

            let qualifies = false;
            switch (title.condition_type) {
                case 'registration':
                    qualifies = true; // always qualifies
                    break;
                case 'tasks_completed': {
                    const r = await pool.query("SELECT COUNT(*) FROM tasks WHERE assigned_to = $1 AND status = 'done'", [userId]);
                    qualifies = parseInt(r.rows[0].count) >= title.condition_value;
                    break;
                }
                case 'items_owned': {
                    const r = await pool.query('SELECT COUNT(*) FROM user_inventory WHERE user_id = $1', [userId]);
                    qualifies = parseInt(r.rows[0].count) >= title.condition_value;
                    break;
                }
                case 'total_earned': {
                    const r = await pool.query('SELECT total_earned FROM game_wallets WHERE user_id = $1', [userId]);
                    qualifies = r.rows[0] && r.rows[0].total_earned >= title.condition_value;
                    break;
                }
                case 'games_played': {
                    const r = await pool.query('SELECT COUNT(*) FROM minigame_sessions WHERE user_id = $1', [userId]);
                    qualifies = parseInt(r.rows[0].count) >= title.condition_value;
                    break;
                }
                case 'room_items': {
                    const r = await pool.query("SELECT COUNT(*) FROM user_inventory ui JOIN shop_items si ON si.id = ui.item_id WHERE ui.user_id = $1 AND si.category = 'furniture'", [userId]);
                    qualifies = parseInt(r.rows[0].count) >= title.condition_value;
                    break;
                }
                case 'days_active': {
                    const r = await pool.query('SELECT created_at FROM users WHERE id = $1', [userId]);
                    if (r.rows[0]) {
                        const days = Math.floor((Date.now() - new Date(r.rows[0].created_at).getTime()) / 86400000);
                        qualifies = days >= title.condition_value;
                    }
                    break;
                }
                case 'leaderboard_top': {
                    const r = await pool.query('SELECT user_id FROM game_wallets ORDER BY total_earned DESC LIMIT 1');
                    qualifies = r.rows[0] && r.rows[0].user_id === userId;
                    break;
                }
                // messages_sent and early_checkins tracked externally
            }

            if (qualifies) {
                await pool.query(
                    'INSERT INTO user_titles (user_id, title_code) VALUES ($1, $2) ON CONFLICT (user_id, title_code) DO NOTHING',
                    [userId, title.code]
                );
                newTitles.push({ code: title.code, name: title.name, icon: title.icon, rarity: title.rarity });
            }
        }

        return newTitles;
    } catch (err) {
        log.error('Check titles error', err);
        return [];
    }
}

// POST /api/quests/check-titles — check and award new titles
router.post('/check-titles', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const newTitles = await checkTitles(req.user.id);
        res.json({ newTitles });
    } catch (err) {
        log.error('Check titles endpoint error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
module.exports.updateQuestProgress = updateQuestProgress;
module.exports.checkTitles = checkTitles;
