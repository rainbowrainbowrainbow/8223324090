/**
 * routes/training.js — Staff Trainer API (v20.4.0)
 * Weekly training prompts, materials review, stats
 */
const router = require('express').Router();
const { pool } = require('../db');
const { requireMinRole } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Training');

// Auto-categorize training input by keywords
function categorizeContent(text) {
    const lower = (text || '').toLowerCase();
    if (/квест|анімат|гр[аиу]|свято|програм/.test(lower)) return 'Аніматори';
    if (/оплат|кас[аиу]|чек|рахун/.test(lower)) return 'Адміністрація';
    if (/безпек|пожеж|евакуац|травм/.test(lower)) return 'Безпека';
    if (/клієнт|батьк|сервіс|обслугов/.test(lower)) return 'Сервіс';
    if (/продаж|дзвін|скрипт|апсейл/.test(lower)) return 'Продажі';
    return 'Загальне';
}

// GET /api/training/weekly-pending — pending responses for a week
router.get('/weekly-pending', requireMinRole('manager'), async (req, res) => {
    try {
        const week = parseInt(req.query.week) || getISOWeek(new Date());
        const year = parseInt(req.query.year) || new Date().getFullYear();

        const result = await pool.query(
            `SELECT i.*, s.name as current_staff_name, s.department
             FROM staff_training_inputs i
             LEFT JOIN staff s ON s.id = i.staff_id
             WHERE i.week_number = $1 AND i.year = $2
             ORDER BY i.status ASC, i.created_at DESC`,
            [week, year]
        );

        res.json({ inputs: result.rows, week, year });
    } catch (err) {
        log.error('weekly-pending error', err);
        res.status(500).json({ error: 'Помилка завантаження' });
    }
});

// POST /api/training/review — batch approve/reject
router.post('/review', requireMinRole('manager'), async (req, res) => {
    const { decisions, reviewed_by_telegram_id } = req.body;
    if (!decisions || !Array.isArray(decisions) || decisions.length === 0) {
        return res.status(400).json({ error: 'Потрібен масив decisions' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let approved = 0, rejected = 0;

        for (const d of decisions) {
            if (!d.id || !d.action) continue;

            if (d.action === 'approve') {
                // Get the input
                const inputRes = await client.query(
                    'SELECT * FROM staff_training_inputs WHERE id = $1 AND status = $2',
                    [d.id, 'pending']
                );
                if (inputRes.rows.length === 0) continue;
                const input = inputRes.rows[0];

                const category = d.category || categorizeContent(input.content);
                const title = d.title || input.content.substring(0, 100);

                // Create training material
                await client.query(
                    `INSERT INTO training_materials
                     (category, title, content, source_input_id, source_staff_id, source_staff_name, week_number, year, approved_by_telegram_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [category, title, input.content, input.id, input.staff_id, input.staff_name,
                     input.week_number, input.year, reviewed_by_telegram_id || null]
                );

                // Mark input as approved
                await client.query(
                    'UPDATE staff_training_inputs SET status = $1, approved_at = NOW() WHERE id = $2',
                    ['approved', d.id]
                );
                approved++;

            } else if (d.action === 'reject') {
                await client.query(
                    'UPDATE staff_training_inputs SET status = $1, rejected_at = NOW() WHERE id = $2',
                    ['rejected', d.id]
                );
                rejected++;

            } else if (d.action === 'duplicate') {
                await client.query(
                    'UPDATE staff_training_inputs SET status = $1 WHERE id = $2',
                    ['duplicate', d.id]
                );
                rejected++;
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, approved, rejected });
    } catch (err) {
        await client.query('ROLLBACK');
        log.error('review error', err);
        res.status(500).json({ error: 'Помилка обробки рішень' });
    } finally {
        client.release();
    }
});

// POST /api/training/submit — save a training response from staff
router.post('/submit', async (req, res) => {
    const { staff_id, telegram_id, content } = req.body;
    if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Потрібен текст відповіді' });
    }

    try {
        const now = new Date();
        const week = getISOWeek(now);
        const year = now.getFullYear();

        // Get staff name
        let staffName = 'Невідомий';
        if (staff_id) {
            const staffRes = await pool.query('SELECT name FROM staff WHERE id = $1', [staff_id]);
            if (staffRes.rows.length > 0) staffName = staffRes.rows[0].name;
        }

        const result = await pool.query(
            `INSERT INTO staff_training_inputs (staff_id, staff_name, telegram_id, content, week_number, year)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [staff_id || null, staffName, telegram_id || null, content.trim(), week, year]
        );

        // Mark prompt as responded
        if (staff_id) {
            await pool.query(
                `UPDATE training_prompts_sent SET responded = true, responded_at = NOW()
                 WHERE staff_id = $1 AND week_number = $2 AND year = $3`,
                [staff_id, week, year]
            );
        }

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        log.error('submit error', err);
        res.status(500).json({ error: 'Помилка збереження' });
    }
});

// GET /api/training/materials — list approved training materials
router.get('/materials', async (req, res) => {
    try {
        const { category, page = 1, limit = 20 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const params = [];
        let where = 'WHERE m.is_active = true';

        if (category && category !== 'all') {
            params.push(category);
            where += ` AND m.category = $${params.length}`;
        }

        params.push(parseInt(limit), offset);
        const dataQuery = `SELECT m.* FROM training_materials m ${where}
            ORDER BY m.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

        const countParams = params.slice(0, -2);
        const countQuery = `SELECT COUNT(*) FROM training_materials m ${where}`;

        const [data, count] = await Promise.all([
            pool.query(dataQuery, params),
            pool.query(countQuery, countParams)
        ]);

        res.json({
            materials: data.rows,
            total: parseInt(count.rows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (err) {
        log.error('materials error', err);
        res.status(500).json({ error: 'Помилка завантаження матеріалів' });
    }
});

// POST /api/training/send-weekly-prompt — manually trigger weekly prompt (for testing)
router.post('/send-weekly-prompt', requireMinRole('manager'), async (req, res) => {
    try {
        const { sendWeeklyTrainingPrompts } = require('../services/training');
        const sent = await sendWeeklyTrainingPrompts();
        res.json({ success: true, sent });
    } catch (err) {
        log.error('send-weekly-prompt error', err);
        res.status(500).json({ error: 'Помилка відправки' });
    }
});

// GET /api/training/stats — training statistics
router.get('/stats', async (req, res) => {
    try {
        const [totalMaterials, thisWeek, topContributors, categories] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM training_materials WHERE is_active = true'),
            pool.query(
                `SELECT COUNT(*) FROM staff_training_inputs
                 WHERE year = $1 AND week_number = $2`,
                [new Date().getFullYear(), getISOWeek(new Date())]
            ),
            pool.query(
                `SELECT source_staff_name as name, COUNT(*) as count
                 FROM training_materials WHERE is_active = true AND source_staff_name IS NOT NULL
                 GROUP BY source_staff_name ORDER BY count DESC LIMIT 5`
            ),
            pool.query(
                `SELECT category, COUNT(*) as count
                 FROM training_materials WHERE is_active = true
                 GROUP BY category ORDER BY count DESC`
            )
        ]);

        res.json({
            totalMaterials: parseInt(totalMaterials.rows[0].count),
            thisWeekInputs: parseInt(thisWeek.rows[0].count),
            topContributors: topContributors.rows,
            categories: categories.rows
        });
    } catch (err) {
        log.error('stats error', err);
        res.status(500).json({ error: 'Помилка статистики' });
    }
});

// ═══════════════════════════════════════════
// Knowledge Base endpoints (v25.0.0)
// ═══════════════════════════════════════════

// GET /api/training/knowledge-base — list articles
router.get('/knowledge-base', async (req, res) => {
    try {
        const { role, category, difficulty } = req.query;
        const params = [];
        let where = 'WHERE kb.is_active = true';

        if (role && role !== 'all') {
            params.push(role);
            where += ` AND (kb.role = $${params.length} OR kb.role = 'all')`;
        }
        if (category && category !== 'all') {
            params.push(category);
            where += ` AND kb.category = $${params.length}`;
        }
        if (difficulty && difficulty !== 'all') {
            params.push(difficulty);
            where += ` AND kb.difficulty = $${params.length}`;
        }

        const staffId = req.user?.id || null;
        const result = await pool.query(
            `SELECT kb.*,
                    (SELECT COUNT(*) FROM training_tests t WHERE t.article_id = kb.id AND t.is_active = true) as test_count
             ${staffId ? `, (SELECT completed_at FROM knowledge_base_progress kbp WHERE kbp.article_id = kb.id AND kbp.staff_id = ${parseInt(staffId)}) as user_completed_at` : ''}
             FROM knowledge_base kb ${where}
             ORDER BY kb.sort_order, kb.created_at DESC`,
            params
        );

        res.json({ articles: result.rows });
    } catch (err) {
        log.error('knowledge-base list error', err);
        res.status(500).json({ error: 'Помилка завантаження бази знань' });
    }
});

// GET /api/training/knowledge-base/:id — single article
router.get('/knowledge-base/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT kb.*,
                    (SELECT COUNT(*) FROM knowledge_base_progress WHERE article_id = kb.id AND completed_at IS NOT NULL) as total_reads
             FROM knowledge_base kb WHERE kb.id = $1 AND kb.is_active = true`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Статтю не знайдено' });

        res.json(result.rows[0]);
    } catch (err) {
        log.error('knowledge-base get error', err);
        res.status(500).json({ error: 'Помилка' });
    }
});

// POST /api/training/knowledge-base/:id/mark-read — mark article as read
router.post('/knowledge-base/:id/mark-read', async (req, res) => {
    try {
        const articleId = req.params.id;
        const staffId = req.user?.id;
        if (!staffId) return res.status(401).json({ error: 'Потрібна авторизація' });

        await pool.query(
            `INSERT INTO knowledge_base_progress (staff_id, article_id, completed_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (staff_id, article_id) DO UPDATE SET completed_at = NOW()`,
            [staffId, articleId]
        );

        // Check badges
        await checkTrainingBadges(staffId);

        res.json({ success: true });
    } catch (err) {
        log.error('mark-read error', err);
        res.status(500).json({ error: 'Помилка' });
    }
});

// GET /api/training/tests/:articleId — get test for article
router.get('/tests/:articleId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, article_id, title, description, questions, passing_score, time_limit_seconds FROM training_tests WHERE article_id = $1 AND is_active = true',
            [req.params.articleId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Тест не знайдено' });

        const test = result.rows[0];
        // Strip correct answers for client
        const safeQuestions = test.questions.map(q => ({
            question: q.question,
            options: q.options
        }));

        res.json({ ...test, questions: safeQuestions, questionCount: test.questions.length });
    } catch (err) {
        log.error('get test error', err);
        res.status(500).json({ error: 'Помилка завантаження тесту' });
    }
});

// GET /api/training/tests-list — all available tests
router.get('/tests-list', async (req, res) => {
    try {
        const staffId = req.user?.id;
        const result = await pool.query(
            `SELECT t.id, t.article_id, t.title, t.description, t.passing_score, t.time_limit_seconds,
                    kb.title as article_title, kb.icon as article_icon, kb.category, kb.role,
                    jsonb_array_length(t.questions) as question_count
             ${staffId ? `, (SELECT MAX(score) FROM training_test_results WHERE test_id = t.id AND staff_id = ${parseInt(staffId)}) as best_score,
                (SELECT passed FROM training_test_results WHERE test_id = t.id AND staff_id = ${parseInt(staffId)} ORDER BY completed_at DESC LIMIT 1) as last_passed` : ''}
             FROM training_tests t
             JOIN knowledge_base kb ON kb.id = t.article_id
             WHERE t.is_active = true AND kb.is_active = true
             ORDER BY kb.sort_order, t.id`
        );

        const tests = result.rows;

        res.json({ tests });
    } catch (err) {
        log.error('tests-list error', err);
        res.status(500).json({ error: 'Помилка' });
    }
});

// POST /api/training/tests/:testId/submit — submit test answers
router.post('/tests/:testId/submit', async (req, res) => {
    try {
        const staffId = req.user?.id;
        if (!staffId) return res.status(401).json({ error: 'Потрібна авторизація' });

        const { answers, timeSpent } = req.body;
        if (!answers || !Array.isArray(answers)) return res.status(400).json({ error: 'Потрібні відповіді' });

        // Get test with correct answers
        const testRes = await pool.query('SELECT * FROM training_tests WHERE id = $1', [req.params.testId]);
        if (testRes.rows.length === 0) return res.status(404).json({ error: 'Тест не знайдено' });

        const test = testRes.rows[0];
        const questions = test.questions;

        // Grade
        let correct = 0;
        const results = questions.map((q, i) => {
            const userAnswer = answers[i] !== undefined ? answers[i] : -1;
            const isCorrect = userAnswer === q.correct;
            if (isCorrect) correct++;
            return { question: q.question, userAnswer, correct: q.correct, isCorrect, explanation: q.explanation };
        });

        const score = Math.round((correct / questions.length) * 100);
        const passed = score >= test.passing_score;

        // Save result
        await pool.query(
            `INSERT INTO training_test_results (test_id, staff_id, score, answers, time_spent_seconds, passed)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [test.id, staffId, score, JSON.stringify(results), timeSpent || null, passed]
        );

        // Check badges
        await checkTrainingBadges(staffId);

        res.json({ score, passed, correct, total: questions.length, results, passingScore: test.passing_score });
    } catch (err) {
        log.error('test submit error', err);
        res.status(500).json({ error: 'Помилка' });
    }
});

// GET /api/training/progress — personal progress
router.get('/progress', async (req, res) => {
    try {
        const staffId = req.user?.id;
        if (!staffId) return res.status(401).json({ error: 'Потрібна авторизація' });

        const [totalArticles, readArticles, testResults, badges] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM knowledge_base WHERE is_active = true'),
            pool.query('SELECT COUNT(*) FROM knowledge_base_progress WHERE staff_id = $1 AND completed_at IS NOT NULL', [staffId]),
            pool.query(
                `SELECT tr.*, t.title as test_title, t.passing_score
                 FROM training_test_results tr
                 JOIN training_tests t ON t.id = tr.test_id
                 WHERE tr.staff_id = $1
                 ORDER BY tr.completed_at DESC LIMIT 20`,
                [staffId]
            ),
            pool.query('SELECT * FROM training_badges WHERE staff_id = $1 ORDER BY earned_at DESC', [staffId])
        ]);

        // Weekly activity (last 4 weeks)
        const activity = await pool.query(
            `SELECT
                DATE_TRUNC('week', completed_at) as week,
                COUNT(*) as reads
             FROM knowledge_base_progress
             WHERE staff_id = $1 AND completed_at > NOW() - INTERVAL '28 days'
             GROUP BY DATE_TRUNC('week', completed_at)
             ORDER BY week`,
            [staffId]
        );

        res.json({
            totalArticles: parseInt(totalArticles.rows[0].count),
            readArticles: parseInt(readArticles.rows[0].count),
            testResults: testResults.rows,
            badges: badges.rows,
            weeklyActivity: activity.rows
        });
    } catch (err) {
        log.error('progress error', err);
        res.status(500).json({ error: 'Помилка' });
    }
});

// GET /api/training/leaderboard — top staff by training
router.get('/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.id, s.name, s.department, s.role_type,
                    COUNT(DISTINCT kbp.article_id) as articles_read,
                    COALESCE(AVG(tr.score), 0) as avg_score,
                    COUNT(DISTINCT CASE WHEN tr.passed THEN tr.test_id END) as tests_passed,
                    COUNT(DISTINCT tb.id) as badge_count,
                    (COUNT(DISTINCT kbp.article_id) * 10 + COALESCE(AVG(tr.score), 0) + COUNT(DISTINCT CASE WHEN tr.passed THEN tr.test_id END) * 20) as total_points
             FROM staff s
             LEFT JOIN knowledge_base_progress kbp ON kbp.staff_id = s.id AND kbp.completed_at IS NOT NULL
             LEFT JOIN training_test_results tr ON tr.staff_id = s.id
             LEFT JOIN training_badges tb ON tb.staff_id = s.id
             WHERE s.is_active = true
             GROUP BY s.id, s.name, s.department, s.role_type
             HAVING COUNT(DISTINCT kbp.article_id) > 0 OR COUNT(tr.id) > 0
             ORDER BY total_points DESC
             LIMIT 10`
        );

        res.json({ leaderboard: result.rows });
    } catch (err) {
        log.error('leaderboard error', err);
        res.status(500).json({ error: 'Помилка' });
    }
});

// GET /api/training/overview-stats — overview for the training page header
router.get('/overview-stats', async (req, res) => {
    try {
        const staffId = req.user?.id;
        const [totalArticles, totalTests, readByUser, passedByUser] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM knowledge_base WHERE is_active = true'),
            pool.query('SELECT COUNT(*) FROM training_tests WHERE is_active = true'),
            staffId ? pool.query('SELECT COUNT(*) FROM knowledge_base_progress WHERE staff_id = $1 AND completed_at IS NOT NULL', [staffId]) : { rows: [{ count: 0 }] },
            staffId ? pool.query('SELECT COUNT(DISTINCT test_id) FROM training_test_results WHERE staff_id = $1 AND passed = true', [staffId]) : { rows: [{ count: 0 }] }
        ]);

        res.json({
            totalArticles: parseInt(totalArticles.rows[0].count),
            totalTests: parseInt(totalTests.rows[0].count),
            readByUser: parseInt(readByUser.rows[0].count),
            passedByUser: parseInt(passedByUser.rows[0].count)
        });
    } catch (err) {
        log.error('overview-stats error', err);
        res.status(500).json({ error: 'Помилка' });
    }
});

// Badge checker
async function checkTrainingBadges(staffId) {
    try {
        const [readCount, testResults] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM knowledge_base_progress WHERE staff_id = $1 AND completed_at IS NOT NULL', [staffId]),
            pool.query('SELECT score, passed FROM training_test_results WHERE staff_id = $1', [staffId])
        ]);

        const reads = parseInt(readCount.rows[0].count);
        const badges = [];

        if (reads >= 1) badges.push({ type: 'first_read', name: 'Перший крок', icon: '📖' });
        if (reads >= 5) badges.push({ type: 'speed_reader', name: 'Книжковий черв\'як', icon: '🐛' });
        if (reads >= 10) badges.push({ type: 'all_materials', name: 'Всезнайко', icon: '🧠' });

        const passed = testResults.rows.filter(r => r.passed).length;
        if (passed >= 1) badges.push({ type: 'quiz_master', name: 'Першій тест', icon: '✅' });
        if (passed >= 3) badges.push({ type: 'streak_3', name: 'Тест-страйк', icon: '🔥' });

        const perfect = testResults.rows.filter(r => r.score === 100).length;
        if (perfect >= 1) badges.push({ type: 'perfect_score', name: 'Ідеальний результат', icon: '💯' });

        for (const b of badges) {
            await pool.query(
                `INSERT INTO training_badges (staff_id, badge_type, badge_name, badge_icon)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (staff_id, badge_type) DO NOTHING`,
                [staffId, b.type, b.name, b.icon]
            );
        }
    } catch (err) {
        log.error('badge check error', err);
    }
}

// Helper: ISO week number
function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

module.exports = router;
