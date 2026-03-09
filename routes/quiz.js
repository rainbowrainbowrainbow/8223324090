/**
 * routes/quiz.js — Quiz Minigame API
 * v22.10.0
 *
 * Endpoints:
 *   GET  /api/quiz/status     — can I play? cooldown, daily count
 *   POST /api/quiz/start      — get 5 random questions for a session
 *   POST /api/quiz/answer     — submit answer for current question
 *   POST /api/quiz/complete   — finish session, get rewards
 *   GET  /api/quiz/leaderboard — top quiz players today/all-time
 *   GET  /api/quiz/questions   — admin: list all questions
 *   POST /api/quiz/questions   — admin: create question
 *   PUT  /api/quiz/questions/:id — admin: update question
 *   DELETE /api/quiz/questions/:id — admin: deactivate question
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireRole, ANY_ROLE } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');
const log = createLogger('Quiz');

const { updateQuestProgress } = require('./quests');
const { updateStreak } = require('./streaks');

const QUESTIONS_PER_GAME = 5;
const TIME_PER_QUESTION_MS = 15000; // 15s per question
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const MAX_DAILY = 3;
const MAX_COINS_PER_GAME = 75;

// GET /api/quiz/status — can I play?
router.get('/status', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const last = await pool.query(
            "SELECT played_at FROM quiz_sessions WHERE user_id = $1 AND completed = true ORDER BY played_at DESC LIMIT 1",
            [req.user.id]
        );
        const today = await pool.query(
            "SELECT COUNT(*) FROM quiz_sessions WHERE user_id = $1 AND completed = true AND played_at >= CURRENT_DATE",
            [req.user.id]
        );
        const best = await pool.query(
            "SELECT MAX(correct_count) as best_correct, MAX(coins_earned) as best_coins FROM quiz_sessions WHERE user_id = $1 AND completed = true",
            [req.user.id]
        );
        const totalGames = await pool.query(
            "SELECT COUNT(*) FROM quiz_sessions WHERE user_id = $1 AND completed = true",
            [req.user.id]
        );

        const lastPlayed = last.rows[0]?.played_at;
        const todayCount = parseInt(today.rows[0].count);
        const cooldownLeft = lastPlayed ? Math.max(0, COOLDOWN_MS - (Date.now() - new Date(lastPlayed).getTime())) : 0;
        const canPlay = todayCount < MAX_DAILY && cooldownLeft === 0;

        res.json({
            canPlay,
            cooldownLeft: Math.ceil(cooldownLeft / 1000),
            todayGames: todayCount,
            maxDaily: MAX_DAILY,
            bestCorrect: best.rows[0]?.best_correct || 0,
            bestCoins: best.rows[0]?.best_coins || 0,
            totalGames: parseInt(totalGames.rows[0].count),
            questionsPerGame: QUESTIONS_PER_GAME
        });
    } catch (err) {
        log.error('Quiz status error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/quiz/start — start a new quiz session
router.post('/start', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        // Check cooldown
        const last = await pool.query(
            "SELECT played_at FROM quiz_sessions WHERE user_id = $1 AND completed = true ORDER BY played_at DESC LIMIT 1",
            [req.user.id]
        );
        if (last.rows.length > 0) {
            const elapsed = Date.now() - new Date(last.rows[0].played_at).getTime();
            if (elapsed < COOLDOWN_MS) {
                return res.status(429).json({ error: 'Кулдаун ще не закінчився' });
            }
        }

        const today = await pool.query(
            "SELECT COUNT(*) FROM quiz_sessions WHERE user_id = $1 AND completed = true AND played_at >= CURRENT_DATE",
            [req.user.id]
        );
        if (parseInt(today.rows[0].count) >= MAX_DAILY) {
            return res.status(429).json({ error: 'Повернись завтра! Ліміт вікторин вичерпано' });
        }

        // Check for incomplete session
        const incomplete = await pool.query(
            "SELECT id FROM quiz_sessions WHERE user_id = $1 AND completed = false ORDER BY played_at DESC LIMIT 1",
            [req.user.id]
        );
        if (incomplete.rows.length > 0) {
            // Mark old incomplete sessions as completed with 0
            await pool.query(
                "UPDATE quiz_sessions SET completed = true WHERE user_id = $1 AND completed = false",
                [req.user.id]
            );
        }

        // Pick random questions (mix of difficulties)
        const questions = await pool.query(`
            SELECT id, question, answers, category, difficulty, reward_coins, explanation
            FROM quiz_questions
            WHERE is_active = true
            ORDER BY RANDOM()
            LIMIT $1
        `, [QUESTIONS_PER_GAME]);

        if (questions.rows.length < QUESTIONS_PER_GAME) {
            return res.status(400).json({ error: 'Недостатньо питань у базі' });
        }

        // Create session
        const session = await pool.query(
            'INSERT INTO quiz_sessions (user_id, questions_count) VALUES ($1, $2) RETURNING id',
            [req.user.id, questions.rows.length]
        );

        // Don't send correct_index to client — anti-cheat
        const clientQuestions = questions.rows.map(q => ({
            id: q.id,
            question: q.question,
            answers: q.answers.map(a => a.text),
            category: q.category,
            difficulty: q.difficulty,
            rewardCoins: q.reward_coins
        }));

        res.json({
            sessionId: session.rows[0].id,
            questions: clientQuestions,
            timePerQuestion: TIME_PER_QUESTION_MS / 1000
        });
    } catch (err) {
        log.error('Quiz start error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/quiz/complete — submit all answers and finish
router.post('/complete', requireRole(...ANY_ROLE), async (req, res) => {
    const { sessionId, answers } = req.body;
    // answers: [{questionId, answerIndex, timeMs}]
    if (!sessionId || !Array.isArray(answers)) {
        return res.status(400).json({ error: 'sessionId та answers обов\'язкові' });
    }

    try {
        // Verify session belongs to user and not completed
        const session = await pool.query(
            'SELECT * FROM quiz_sessions WHERE id = $1 AND user_id = $2 AND completed = false',
            [sessionId, req.user.id]
        );
        if (session.rows.length === 0) {
            return res.status(400).json({ error: 'Сесію не знайдено або вже завершено' });
        }

        // Validate answers server-side — batch fetch all questions at once
        const questionIds = answers.map(a => a.questionId).filter(id => typeof id === 'number');
        if (questionIds.length === 0) {
            return res.status(400).json({ error: 'Немає відповідей' });
        }
        const questionsResult = await pool.query(
            'SELECT id, correct_index, reward_coins, explanation, answers FROM quiz_questions WHERE id = ANY($1)',
            [questionIds]
        );
        const questionsMap = {};
        for (const q of questionsResult.rows) questionsMap[q.id] = q;

        let correctCount = 0;
        let totalCoins = 0;
        const results = [];

        for (const ans of answers) {
            const question = questionsMap[ans.questionId];
            if (!question) continue;

            const isCorrect = ans.answerIndex === question.correct_index;
            if (isCorrect) {
                correctCount++;
                // Bonus for speed: <5s = full, <10s = 80%, <15s = 60%
                const timeMs = Math.max(0, Math.min(ans.timeMs || TIME_PER_QUESTION_MS, TIME_PER_QUESTION_MS));
                let speedBonus = 1.0;
                if (timeMs < 5000) speedBonus = 1.0;
                else if (timeMs < 10000) speedBonus = 0.8;
                else speedBonus = 0.6;
                totalCoins += Math.round(question.reward_coins * speedBonus);
            }

            results.push({
                questionId: question.id,
                correct: isCorrect,
                correctIndex: question.correct_index,
                explanation: question.explanation
            });
        }

        // Cap coins
        totalCoins = Math.min(totalCoins, MAX_COINS_PER_GAME);

        // Update session + award coins in a transaction
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `UPDATE quiz_sessions SET
                    correct_count = $1, coins_earned = $2, answers = $3, completed = true
                WHERE id = $4`,
                [correctCount, totalCoins, JSON.stringify(results), sessionId]
            );
            if (totalCoins > 0) {
                await client.query(
                    'UPDATE game_wallets SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE user_id = $2',
                    [totalCoins, req.user.id]
                );
                await client.query(
                    'INSERT INTO coin_transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                    [req.user.id, totalCoins, 'quiz', `Вікторина: ${correctCount}/${answers.length} правильних (+${totalCoins} монет)`]
                );
            }
            await client.query('COMMIT');
        } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
        } finally {
            client.release();
        }

        // Track quest progress
        updateQuestProgress(req.user.id, 'play_quiz').catch(() => {});

        // Update quiz streak
        updateStreak(req.user.id, 'quiz').catch(() => {});

        // Perfect score achievement check
        const isPerfect = correctCount === QUESTIONS_PER_GAME;

        res.json({
            success: true,
            correctCount,
            totalQuestions: answers.length,
            coinsEarned: totalCoins,
            results,
            isPerfect
        });
    } catch (err) {
        log.error('Quiz complete error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/quiz/leaderboard — top quiz players
router.get('/leaderboard', requireRole(...ANY_ROLE), async (req, res) => {
    try {
        const period = req.query.period || 'today'; // today, week, alltime

        let dateFilter = "AND qs.played_at >= CURRENT_DATE";
        if (period === 'week') dateFilter = "AND qs.played_at >= CURRENT_DATE - INTERVAL '7 days'";
        else if (period === 'alltime') dateFilter = '';

        const leaders = await pool.query(`
            SELECT
                u.id, u.name, u.username,
                COUNT(qs.id) as games_played,
                SUM(qs.correct_count) as total_correct,
                SUM(qs.coins_earned) as total_coins,
                MAX(qs.correct_count) as best_score,
                ROUND(AVG(qs.correct_count)::numeric, 1) as avg_correct
            FROM quiz_sessions qs
            JOIN users u ON u.id = qs.user_id
            WHERE qs.completed = true ${dateFilter}
            GROUP BY u.id, u.name, u.username
            ORDER BY total_correct DESC, total_coins DESC
            LIMIT 20
        `);

        res.json(leaders.rows.map(l => ({
            userId: l.id,
            name: l.name || l.username,
            gamesPlayed: parseInt(l.games_played),
            totalCorrect: parseInt(l.total_correct),
            totalCoins: parseInt(l.total_coins),
            bestScore: l.best_score,
            avgCorrect: parseFloat(l.avg_correct)
        })));
    } catch (err) {
        log.error('Quiz leaderboard error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// ADMIN: Question management
// ============================================

// GET /api/quiz/questions — list all
router.get('/questions', requireRole('admin', 'creator'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM quiz_questions ORDER BY category, id'
        );
        res.json(rows);
    } catch (err) {
        log.error('List quiz questions error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/quiz/questions — create
router.post('/questions', requireRole('admin', 'creator'), async (req, res) => {
    const { question, answers, correct_index, category, difficulty, reward_coins, explanation } = req.body;
    if (!question || !answers || correct_index === undefined) {
        return res.status(400).json({ error: 'question, answers, correct_index обов\'язкові' });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO quiz_questions (question, answers, correct_index, category, difficulty, reward_coins, explanation)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [question, JSON.stringify(answers), correct_index, category || 'park', difficulty || 'normal', reward_coins || 10, explanation]
        );
        res.json(rows[0]);
    } catch (err) {
        log.error('Create quiz question error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/quiz/questions/:id — update
router.put('/questions/:id', requireRole('admin', 'creator'), async (req, res) => {
    const { question, answers, correct_index, category, difficulty, reward_coins, explanation, is_active } = req.body;
    try {
        const updates = [];
        const values = [];
        let idx = 1;

        if (question !== undefined) { updates.push(`question = $${idx++}`); values.push(question); }
        if (answers !== undefined) { updates.push(`answers = $${idx++}`); values.push(JSON.stringify(answers)); }
        if (correct_index !== undefined) { updates.push(`correct_index = $${idx++}`); values.push(correct_index); }
        if (category !== undefined) { updates.push(`category = $${idx++}`); values.push(category); }
        if (difficulty !== undefined) { updates.push(`difficulty = $${idx++}`); values.push(difficulty); }
        if (reward_coins !== undefined) { updates.push(`reward_coins = $${idx++}`); values.push(reward_coins); }
        if (explanation !== undefined) { updates.push(`explanation = $${idx++}`); values.push(explanation); }
        if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); values.push(is_active); }

        if (updates.length === 0) return res.status(400).json({ error: 'Нічого не змінено' });

        values.push(parseInt(req.params.id));
        const { rows } = await pool.query(
            `UPDATE quiz_questions SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
            values
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Питання не знайдено' });
        res.json(rows[0]);
    } catch (err) {
        log.error('Update quiz question error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/quiz/questions/:id — soft delete
router.delete('/questions/:id', requireRole('admin', 'creator'), async (req, res) => {
    try {
        await pool.query('UPDATE quiz_questions SET is_active = false WHERE id = $1', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (err) {
        log.error('Delete quiz question error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
