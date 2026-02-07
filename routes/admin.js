/**
 * routes/admin.js — Super-admin endpoints (Sergey only)
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireSergey } = require('../middleware/auth');
const { clearTokenCache } = require('../services/telegram');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError, ForbiddenError, ConflictError } = require('../middleware/errors');

const router = express.Router();

// All admin routes require Sergey
router.use(requireSergey);

// --- Telegram Bot Token ---
router.get('/telegram-token', asyncHandler(async (req, res) => {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'telegram_bot_token'");
    const dbToken = result.rows[0]?.value || '';
    const envToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const active = dbToken || envToken;
    const masked = active ? active.slice(0, 8) + '...' + active.slice(-4) : '';
    res.json({ masked, source: dbToken ? 'db' : (envToken ? 'env' : 'none'), hasToken: !!active });
}));

router.post('/telegram-token', asyncHandler(async (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== 'string' || token.length < 10) {
        throw new ValidationError('Невалідний токен');
    }
    await pool.query(
        `INSERT INTO settings (key, value) VALUES ('telegram_bot_token', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
        [token.trim()]
    );
    clearTokenCache();
    res.json({ success: true });
}));

// --- User Management ---
router.get('/users', asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT id, username, role, name, created_at FROM users ORDER BY id');
    res.json(result.rows);
}));

router.post('/users', asyncHandler(async (req, res) => {
    const { username, password, role, name } = req.body;
    if (!username || !password || !role || !name) {
        throw new ValidationError('Всі поля обов\'язкові');
    }
    if (!['admin', 'user', 'viewer'].includes(role)) {
        throw new ValidationError('Невалідна роль');
    }
    if (password.length < 4) {
        throw new ValidationError('Пароль мінімум 4 символи');
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, role, name) VALUES ($1, $2, $3, $4) RETURNING id, username, role, name',
            [username.trim(), hash, role, name.trim()]
        );
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            throw new ConflictError('Користувач з таким логіном вже існує');
        }
        throw err;
    }
}));

router.put('/users/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { username, password, role, name } = req.body;
    if (!username || !role || !name) {
        throw new ValidationError('Ім\'я, логін та роль обов\'язкові');
    }
    const existing = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
    if (existing.rows[0]?.username === 'Sergey' && (username !== 'Sergey' || role !== 'admin')) {
        throw new ForbiddenError('Не можна змінити логін або роль суперадміна');
    }

    try {
        if (password && password.length >= 4) {
            const hash = await bcrypt.hash(password, 10);
            await pool.query(
                'UPDATE users SET username = $1, password_hash = $2, role = $3, name = $4 WHERE id = $5',
                [username.trim(), hash, role, name.trim(), id]
            );
        } else {
            await pool.query(
                'UPDATE users SET username = $1, role = $2, name = $3 WHERE id = $4',
                [username.trim(), role, name.trim(), id]
            );
        }
        res.json({ success: true });
    } catch (err) {
        if (err.code === '23505') {
            throw new ConflictError('Такий логін вже зайнятий');
        }
        throw err;
    }
}));

router.delete('/users/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
    if (existing.rows[0]?.username === 'Sergey') {
        throw new ForbiddenError('Не можна видалити суперадміна');
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
}));

module.exports = router;
