/**
 * middleware/auth.js — Authentication & authorization middleware
 *
 * SRP: перевірка JWT токенів та ролей. Не знає про роути чи БД-запити.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
if (!process.env.JWT_SECRET) {
    console.warn('[Security] JWT_SECRET not set in environment! Sessions will be lost on restart.');
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
}

function requireSergey(req, res, next) {
    if (!req.user || req.user.username !== 'Sergey') {
        return res.status(403).json({ error: 'Доступ лише для суперадміна' });
    }
    next();
}

module.exports = { JWT_SECRET, authenticateToken, requireSergey };
