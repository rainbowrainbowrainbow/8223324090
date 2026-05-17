/**
 * routes/contractors.js — Contractor CRUD + Leo v2: Ratings, Ghost Rate, Escalations (v18.4)
 */
const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { sendTelegramMessage } = require('../services/telegram');
const { createLogger } = require('../utils/logger');

const { authenticateToken, requireRole } = require('../middleware/auth');
const log = createLogger('Contractors');

// RBAC: Contractors — authentication + management only
router.use(authenticateToken);
router.use(requireRole('creator', 'director', 'vice_director', 'senior_manager', 'manager'));

// GET /api/contractors — list all contractors with stats
router.get('/', async (req, res) => {
    try {
        const { category, active, q } = req.query;
        let query = 'SELECT * FROM contractors';
        const conditions = [];
        const params = [];
        if (category) {
            params.push(category);
            conditions.push(`category = $${params.length}`);
        }
        if (active !== undefined) {
            params.push(active === 'true');
            conditions.push(`is_active = $${params.length}`);
        }
        if (q) {
            params.push(`%${q}%`);
            conditions.push(`(name ILIKE $${params.length} OR COALESCE(phone, '') ILIKE $${params.length} OR COALESCE(telegram_username, '') ILIKE $${params.length} OR COALESCE(notes, '') ILIKE $${params.length})`);
        }
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY is_active DESC, is_preferred DESC, COALESCE(reliability_score, avg_reliability, 0) DESC, name';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        log.error('List contractors error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/contractors/leaderboard — top contractors by rating
router.get('/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, specialty, category, avg_reliability, avg_quality,
                    avg_response_minutes, ghost_rate, total_tasks, completed_tasks
             FROM contractors
             WHERE is_active = true AND total_tasks > 0
             ORDER BY avg_reliability DESC, avg_quality DESC, ghost_rate ASC
             LIMIT 20`
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Leaderboard error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/contractors/overview — Leo v2 dashboard stats
router.get('/overview', async (req, res) => {
    try {
        const [contractors, tasks, escalations, ratings] = await Promise.all([
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE is_active) as active_count,
                COUNT(*) as total_count,
                AVG(avg_reliability) FILTER (WHERE total_tasks > 0) as avg_reliability,
                AVG(avg_quality) FILTER (WHERE total_tasks > 0) as avg_quality,
                AVG(ghost_rate) FILTER (WHERE total_tasks > 0) as avg_ghost_rate
             FROM contractors`),
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE status = 'assigned') as assigned,
                COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE status = 'overdue') as overdue,
                COUNT(*) as total
             FROM contractor_tasks`),
            pool.query(`SELECT
                COUNT(*) FILTER (WHERE status = 'open') as open_count,
                COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
                COUNT(*) as total
             FROM contractor_escalations`),
            pool.query(`SELECT
                COUNT(*) as total,
                AVG(reliability_score) as avg_reliability,
                AVG(quality_score) as avg_quality,
                COUNT(*) FILTER (WHERE was_ghost) as ghost_count
             FROM contractor_ratings`)
        ]);

        res.json({
            contractors: contractors.rows[0],
            tasks: tasks.rows[0],
            escalations: escalations.rows[0],
            ratings: ratings.rows[0]
        });
    } catch (err) {
        log.error('Overview error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/contractors/:id — single contractor with full stats
// GET /api/contractors/:id/order-context - machine-readable contact + ordering draft
router.get('/:id/order-context', async (req, res) => {
    try {
        const { stockItemId, procurementItemId } = req.query;
        const contractorResult = await pool.query('SELECT * FROM contractors WHERE id = $1', [req.params.id]);
        if (!contractorResult.rowCount) {
            return res.status(404).json({ success: false, error: 'Contractor not found' });
        }

        let stockItem = null;
        let procurementItem = null;
        let link = null;

        if (stockItemId) {
            const stockRes = await pool.query(`
                SELECT ws.*, wl.name AS location_name
                FROM warehouse_stock ws
                LEFT JOIN warehouse_locations wl ON wl.id = ws.location_id
                WHERE ws.id = $1
            `, [stockItemId]);
            stockItem = stockRes.rows[0] || null;
        }

        if (procurementItemId) {
            const procRes = await pool.query(`
                SELECT pi.*, pl.title AS list_title, wl.name AS target_location_name
                FROM procurement_items pi
                JOIN procurement_lists pl ON pl.id = pi.list_id
                LEFT JOIN warehouse_locations wl ON wl.id = pl.target_location_id
                WHERE pi.id = $1
            `, [procurementItemId]);
            procurementItem = procRes.rows[0] || null;
            if (!stockItem && (procurementItem?.warehouse_stock_id || procurementItem?.stock_id)) {
                const stockRes = await pool.query(`
                    SELECT ws.*, wl.name AS location_name
                    FROM warehouse_stock ws
                    LEFT JOIN warehouse_locations wl ON wl.id = ws.location_id
                    WHERE ws.id = $1
                `, [procurementItem.warehouse_stock_id || procurementItem.stock_id]);
                stockItem = stockRes.rows[0] || null;
            }
        }

        if (stockItem) {
            const linkRes = await pool.query(`
                SELECT *
                FROM contractor_stock_links
                WHERE contractor_id = $1 AND warehouse_stock_id = $2
            `, [req.params.id, stockItem.id]);
            link = linkRes.rows[0] || null;
        }

        const c = contractorResult.rows[0];
        const targetName = procurementItem?.name || stockItem?.name || 'позиція';
        const targetQty = procurementItem?.quantity ? `${procurementItem.quantity} ${procurementItem.unit || ''}`.trim() : '';
        const locationText = procurementItem?.target_location_name || stockItem?.location_name || '';
        const intro = c.intro_context || 'Вітаю! Пише команда Event Genix.';
        const firstTemplate = c.first_message_template || 'Підкажіть, будь ласка, чи можете прийняти замовлення по позиції: {{item}}.';
        const repeatTemplate = c.repeat_order_template || 'Вітаю! Хочемо повторити замовлення: {{item}} {{quantity}}.';
        const vars = { item: targetName, quantity: targetQty, location: locationText, contractor: c.name };
        const fill = (text) => String(text || '').replace(/\{\{(item|quantity|location|contractor)\}\}/g, (_, key) => vars[key] || '');

        const firstMessageDraft = [intro, fill(firstTemplate), targetQty ? `Кількість: ${targetQty}` : '', locationText ? `Склад: ${locationText}` : '']
            .filter(Boolean)
            .join('\n\n');

        res.json({
            success: true,
            contractor: {
                id: c.id,
                name: c.name,
                category: c.category,
                phone: c.phone,
                telegramUsername: c.telegram_username,
                telegramChatId: c.telegram_chat_id,
                preferredChannel: c.preferred_channel || 'phone',
                orderingNotes: c.ordering_notes || c.notes || null,
                reliabilityScore: c.reliability_score || c.avg_reliability || 0,
                leadTimeDays: c.lead_time_days || link?.lead_time_days || null,
                lastOrderPrice: c.last_order_price || link?.last_price || null,
                lastOrderedAt: c.last_ordered_at || null
            },
            stockItem,
            procurementItem,
            contractorStockLink: link,
            firstMessageDraft,
            repeatOrderDraft: fill(repeatTemplate),
            missingContact: !c.phone && !c.telegram_username && !c.telegram_chat_id,
            warnings: (!c.phone && !c.telegram_username && !c.telegram_chat_id) ? ['missing_contact'] : []
        });
    } catch (err) {
        log.error('Order context error', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM contractors WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Підрядника не знайдено' });
        }

        // Get recent ratings
        const ratings = await pool.query(
            `SELECT * FROM contractor_ratings WHERE contractor_id = $1 ORDER BY created_at DESC LIMIT 10`,
            [req.params.id]
        );

        // Get recent tasks
        const tasks = await pool.query(
            `SELECT * FROM contractor_tasks WHERE contractor_id = $1 ORDER BY assigned_at DESC LIMIT 10`,
            [req.params.id]
        );

        // Get open escalations
        const escalations = await pool.query(
            `SELECT * FROM contractor_escalations WHERE contractor_id = $1 AND status = 'open' ORDER BY created_at DESC`,
            [req.params.id]
        );

        res.json({
            ...result.rows[0],
            recent_ratings: ratings.rows,
            recent_tasks: tasks.rows,
            open_escalations: escalations.rows
        });
    } catch (err) {
        log.error('Get contractor error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/contractors — create contractor
router.post('/', async (req, res) => {
    try {
        const {
            name, specialty, telegram_chat_id, telegram_username, phone, notes, category, sla_response_minutes,
            preferredChannel, firstMessageTemplate, repeatOrderTemplate, introContext,
            orderingNotes, isPreferred, reliabilityScore, priceNote, leadTimeDays, minimumOrderNote
        } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: "Ім'я підрядника обов'язкове" });
        }

        const inviteToken = 'ctr_' + crypto.randomBytes(8).toString('hex');

        const result = await pool.query(
            `INSERT INTO contractors (
                name, specialty, telegram_chat_id, telegram_username, invite_token, phone, notes,
                category, sla_response_minutes, preferred_channel, first_message_template,
                repeat_order_template, intro_context, ordering_notes, is_preferred,
                reliability_score, price_note, lead_time_days, minimum_order_note
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
             RETURNING *`,
            [
                name.trim(),
                JSON.stringify(specialty || []),
                telegram_chat_id || null,
                telegram_username || null,
                inviteToken,
                phone || null,
                notes || null,
                category || 'general',
                sla_response_minutes || 120,
                preferredChannel || 'phone',
                firstMessageTemplate || null,
                repeatOrderTemplate || null,
                introContext || null,
                orderingNotes || null,
                isPreferred === true,
                Number(reliabilityScore || 0),
                priceNote || null,
                leadTimeDays || null,
                minimumOrderNote || null
            ]
        );

        log.info(`Contractor created: ${name} (id: ${result.rows[0].id})`);
        res.json({ success: true, contractor: result.rows[0] });
    } catch (err) {
        log.error('Create contractor error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/contractors/:id — update contractor
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name, specialty, telegram_chat_id, telegram_username, phone, notes, is_active, category, sla_response_minutes,
            preferredChannel, firstMessageTemplate, repeatOrderTemplate, introContext,
            orderingNotes, isPreferred, reliabilityScore, priceNote, leadTimeDays, minimumOrderNote
        } = req.body;

        const result = await pool.query(
            `UPDATE contractors SET name=$1, specialty=$2, telegram_chat_id=$3, telegram_username=$4,
             phone=$5, notes=$6, is_active=$7, category=$8, sla_response_minutes=$9,
             preferred_channel=$10, first_message_template=$11, repeat_order_template=$12,
             intro_context=$13, ordering_notes=$14, is_preferred=$15,
             reliability_score=$16, price_note=$17, lead_time_days=$18,
             minimum_order_note=$19, updated_at=NOW()
             WHERE id=$20 RETURNING *`,
            [
                name, JSON.stringify(specialty || []),
                telegram_chat_id || null, telegram_username || null,
                phone || null, notes || null,
                is_active !== false, category || 'general',
                sla_response_minutes || 120,
                preferredChannel || 'phone',
                firstMessageTemplate || null,
                repeatOrderTemplate || null,
                introContext || null,
                orderingNotes || null,
                isPreferred === true,
                Number(reliabilityScore || 0),
                priceNote || null,
                leadTimeDays || null,
                minimumOrderNote || null,
                id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Підрядника не знайдено' });
        }

        log.info(`Contractor updated: ${name} (id: ${id})`);
        res.json({ success: true, contractor: result.rows[0] });
    } catch (err) {
        log.error('Update contractor error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/contractors/:id — delete contractor
router.delete('/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM contractors WHERE id = $1', [req.params.id]);
        log.info(`Contractor deleted: id=${req.params.id}`);
        res.json({ success: true });
    } catch (err) {
        log.error('Delete contractor error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/contractors/:id/regenerate-invite — regenerate invite token
router.post('/:id/regenerate-invite', async (req, res) => {
    try {
        const newToken = 'ctr_' + crypto.randomBytes(8).toString('hex');
        const result = await pool.query(
            'UPDATE contractors SET invite_token = $1 WHERE id = $2 RETURNING invite_token',
            [newToken, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Підрядника не знайдено' });
        }
        res.json({ success: true, invite_token: newToken });
    } catch (err) {
        log.error('Regenerate invite error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/contractors/:id/test-message — send test message to contractor
router.post('/:id/test-message', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM contractors WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Підрядника не знайдено' });
        }
        const contractor = result.rows[0];
        if (!contractor.telegram_chat_id) {
            return res.status(400).json({ error: 'Telegram не підключено' });
        }

        const text = `🔔 <b>Тестове повідомлення</b>\n\n`
            + `Привіт, ${contractor.name}! Це тестове повідомлення від Event Genix.\n`
            + `Ваш зв'язок працює коректно ✅`;

        const tgResult = await sendTelegramMessage(contractor.telegram_chat_id, text, { parse_mode: 'HTML' });
        if (tgResult && tgResult.ok) {
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Помилка відправки повідомлення' });
        }
    } catch (err) {
        log.error('Test message error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/contractors/notifications/recent — recent contractor notifications
router.get('/notifications/recent', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT cn.*, c.name as contractor_name
             FROM contractor_notifications cn
             JOIN contractors c ON cn.contractor_id = c.id
             ORDER BY cn.created_at DESC LIMIT 50`
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Recent notifications error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Leo v2: Task Management
// ============================================

// GET /api/contractors/:id/tasks — contractor tasks
router.get('/:id/tasks', async (req, res) => {
    try {
        const { status } = req.query;
        let query = 'SELECT * FROM contractor_tasks WHERE contractor_id = $1';
        const params = [req.params.id];
        if (status) {
            params.push(status);
            query += ` AND status = $${params.length}`;
        }
        query += ' ORDER BY assigned_at DESC LIMIT 50';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        log.error('Get contractor tasks error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/contractors/:id/tasks — assign task to contractor
router.post('/:id/tasks', async (req, res) => {
    try {
        const { title, description, task_type, booking_id, deadline } = req.body;
        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Назва завдання обов\'язкова' });
        }

        const result = await pool.query(
            `INSERT INTO contractor_tasks (contractor_id, title, description, task_type, booking_id, deadline, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [req.params.id, title.trim(), description || null, task_type || 'general',
             booking_id || null, deadline || null, req.user?.username || 'system']
        );

        // Update contractor total_tasks count
        await pool.query(
            'UPDATE contractors SET total_tasks = total_tasks + 1 WHERE id = $1',
            [req.params.id]
        );

        log.info(`Task assigned to contractor ${req.params.id}: ${title}`);
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        log.error('Assign task error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/contractors/tasks/:taskId/status — update task status
router.put('/tasks/:taskId/status', async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['assigned', 'acknowledged', 'in_progress', 'completed', 'cancelled', 'overdue'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Невірний статус. Допустимі: ${validStatuses.join(', ')}` });
        }

        const timestamps = {};
        if (status === 'acknowledged') timestamps.acknowledged_at = 'NOW()';
        if (status === 'completed') timestamps.completed_at = 'NOW()';

        let setClause = 'status = $1';
        if (timestamps.acknowledged_at) setClause += ', acknowledged_at = NOW()';
        if (timestamps.completed_at) setClause += ', completed_at = NOW()';

        const result = await pool.query(
            `UPDATE contractor_tasks SET ${setClause} WHERE id = $2 RETURNING *`,
            [status, req.params.taskId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Завдання не знайдено' });
        }

        // If completed, update contractor completed_tasks
        if (status === 'completed') {
            await pool.query(
                'UPDATE contractors SET completed_tasks = completed_tasks + 1 WHERE id = $1',
                [result.rows[0].contractor_id]
            );
        }

        // Auto-escalation: if task becomes overdue, create escalation
        if (status === 'overdue') {
            await pool.query(
                `INSERT INTO contractor_escalations (contractor_id, task_id, reason, description, severity)
                 VALUES ($1, $2, 'overdue', 'Завдання прострочене', 'high')`,
                [result.rows[0].contractor_id, req.params.taskId]
            );
        }

        log.info(`Task ${req.params.taskId} status -> ${status}`);
        res.json({ success: true, task: result.rows[0] });
    } catch (err) {
        log.error('Update task status error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Leo v2: Ratings
// ============================================

// POST /api/contractors/:id/rate — rate a contractor (per-task or general)
router.post('/:id/rate', async (req, res) => {
    try {
        const { task_id, response_time_minutes, reliability_score, quality_score, was_ghost, comment } = req.body;

        if (!reliability_score && !quality_score && !was_ghost) {
            return res.status(400).json({ error: 'Потрібна хоча б одна оцінка' });
        }

        const result = await pool.query(
            `INSERT INTO contractor_ratings (contractor_id, task_id, response_time_minutes, reliability_score, quality_score, was_ghost, comment, rated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                req.params.id, task_id || null,
                response_time_minutes || null,
                reliability_score || null, quality_score || null,
                was_ghost || false, comment || null,
                req.user?.username || 'system'
            ]
        );

        // Recalculate aggregated stats
        await recalculateContractorStats(req.params.id);

        log.info(`Contractor ${req.params.id} rated: reliability=${reliability_score}, quality=${quality_score}, ghost=${was_ghost}`);
        res.json({ success: true, rating: result.rows[0] });
    } catch (err) {
        log.error('Rate contractor error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/contractors/:id/ratings — contractor rating history
router.get('/:id/ratings', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT cr.*, ct.title as task_title
             FROM contractor_ratings cr
             LEFT JOIN contractor_tasks ct ON cr.task_id = ct.id
             WHERE cr.contractor_id = $1
             ORDER BY cr.created_at DESC LIMIT 50`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Get ratings error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Leo v2: Escalations
// ============================================

// POST /api/contractors/:id/escalations — create escalation
router.post('/:id/escalations', async (req, res) => {
    try {
        const { task_id, reason, description, severity } = req.body;
        const validReasons = ['no_response', 'late_delivery', 'quality_issue', 'overdue', 'ghosting', 'other'];
        if (!reason || !validReasons.includes(reason)) {
            return res.status(400).json({ error: `Невірна причина. Допустимі: ${validReasons.join(', ')}` });
        }

        const result = await pool.query(
            `INSERT INTO contractor_escalations (contractor_id, task_id, reason, description, severity)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [req.params.id, task_id || null, reason, description || null, severity || 'medium']
        );

        // If ghosting — auto-mark was_ghost in rating
        if (reason === 'ghosting' && task_id) {
            await pool.query(
                `INSERT INTO contractor_ratings (contractor_id, task_id, was_ghost, comment, rated_by)
                 VALUES ($1, $2, true, 'Auto: ghosting escalation', 'system')`,
                [req.params.id, task_id]
            );
            await recalculateContractorStats(req.params.id);
        }

        log.info(`Escalation created for contractor ${req.params.id}: ${reason}`);
        res.json({ success: true, escalation: result.rows[0] });
    } catch (err) {
        log.error('Create escalation error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/contractors/:id/escalations — contractor escalations
router.get('/:id/escalations', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ce.*, ct.title as task_title
             FROM contractor_escalations ce
             LEFT JOIN contractor_tasks ct ON ce.task_id = ct.id
             WHERE ce.contractor_id = $1
             ORDER BY ce.created_at DESC LIMIT 50`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        log.error('Get escalations error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/contractors/escalations/:escId/resolve — resolve escalation
router.put('/escalations/:escId/resolve', async (req, res) => {
    try {
        const { resolution_notes } = req.body;
        const result = await pool.query(
            `UPDATE contractor_escalations
             SET status = 'resolved', resolved_at = NOW(), resolved_by = $1, resolution_notes = $2
             WHERE id = $3 RETURNING *`,
            [req.user?.username || 'system', resolution_notes || null, req.params.escId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Ескалацію не знайдено' });
        }

        log.info(`Escalation ${req.params.escId} resolved`);
        res.json({ success: true, escalation: result.rows[0] });
    } catch (err) {
        log.error('Resolve escalation error', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================
// Helper: Recalculate contractor aggregate stats
// ============================================
async function recalculateContractorStats(contractorId) {
    try {
        const stats = await pool.query(
            `SELECT
                AVG(response_time_minutes) as avg_response,
                AVG(reliability_score) as avg_reliability,
                AVG(quality_score) as avg_quality,
                COUNT(*) FILTER (WHERE was_ghost) as ghost_count,
                COUNT(*) as total_ratings
             FROM contractor_ratings WHERE contractor_id = $1`,
            [contractorId]
        );
        const s = stats.rows[0];
        const ghostRate = s.total_ratings > 0 ? ((s.ghost_count / s.total_ratings) * 100) : 0;

        await pool.query(
            `UPDATE contractors SET
                avg_response_minutes = COALESCE($1, 0),
                avg_reliability = COALESCE($2, 0),
                avg_quality = COALESCE($3, 0),
                ghost_rate = $4,
                last_rated_at = NOW()
             WHERE id = $5`,
            [s.avg_response, s.avg_reliability, s.avg_quality, ghostRate, contractorId]
        );
    } catch (err) {
        log.error('Recalculate stats error', err);
    }
}

module.exports = router;
