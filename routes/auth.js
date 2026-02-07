/**
 * routes/auth.js — Login & token verification
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { loginRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/login', loginRateLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({ token, user: { username: user.username, role: user.role, name: user.name } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/verify', (req, res) => {
    // authenticateToken already ran via global middleware
    res.json({ user: { username: req.user.username, role: req.user.role, name: req.user.name } });
});

module.exports = router;
