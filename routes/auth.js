/**
 * routes/auth.js — Login & token verification
 *
 * LLM HINT: This handles user authentication with bcrypt password verification.
 * Users are stored in the `users` table (seeded in db/index.js).
 * Test user: admin / admin123 (role: admin).
 * Seeded users: Vitalina, Dasha, Natalia (admin), Sergey (admin), Animator (viewer).
 * JWT token expires in 24h. Role is embedded in token payload.
 */
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { JWT_SECRET, authenticateToken } = require('../middleware/auth');
const { createLogger } = require('../utils/logger');

const log = createLogger('Auth');

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Введіть ім\'я та пароль' });
        }

        const result = await pool.query(
            'SELECT id, username, password_hash, role, name FROM users WHERE username = $1',
            [username.trim()]
        );

        if (result.rows.length === 0) {
            log.warn(`Login failed: unknown user "${username}"`);
            return res.status(401).json({ error: 'Невірний логін або пароль' });
        }

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            log.warn(`Login failed: wrong password for "${username}"`);
            return res.status(401).json({ error: 'Невірний логін або пароль' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        log.info(`User "${username}" logged in (role: ${user.role})`);
        res.json({ token, user: { username: user.username, role: user.role, name: user.name } });
    } catch (err) {
        log.error('Login error', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/verify', authenticateToken, (req, res) => {
    res.json({ user: { username: req.user.username, role: req.user.role, name: req.user.name } });
});

module.exports = router;
