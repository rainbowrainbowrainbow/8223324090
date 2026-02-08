/**
 * routes/auth.js — Login & token verification
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
        const { username } = req.body;
        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }

        // v6.0: Temporary test mode — passwordless login with full admin access
        const testUser = { username: username.trim() || 'User1', role: 'admin', name: username.trim() || 'User1' };
        const token = jwt.sign(
            { id: 'test-user', username: testUser.username, role: testUser.role, name: testUser.name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ token, user: testUser });
    } catch (err) {
        log.error('Login error', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/verify', authenticateToken, (req, res) => {
    res.json({ user: { username: req.user.username, role: req.user.role, name: req.user.name } });
});

module.exports = router;
