/**
 * middleware/auth.js — JWT authentication + Role-based access control
 * v20.1.0: Expanded role system — 10 roles with hierarchy and access matrix
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Auth');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
if (!process.env.JWT_SECRET) {
    log.warn('JWT_SECRET not set in environment! Sessions will be lost on restart. Set JWT_SECRET env variable.');
}

// v20.1.0: Role hierarchy (higher index = more permissions)
const ROLE_HIERARCHY = [
    'waiter',            // 0
    'animator',          // 1
    'instructor',        // 2
    'senior_instructor', // 3
    'admin',             // 4
    'manager',           // 5
    'senior_manager',    // 6
    'vice_director',     // 7
    'director',          // 8
    'creator'            // 9
];

const ROLE_LEVEL = {};
ROLE_HIERARCHY.forEach((role, idx) => { ROLE_LEVEL[role] = idx; });

// Page access matrix — which roles can access each page
const PAGE_ACCESS = {
    '/':          ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin', 'senior_instructor', 'instructor', 'animator'],
    '/tasks':     ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin', 'senior_instructor', 'instructor', 'animator'],
    '/center':    ['creator', 'director', 'vice_director', 'senior_manager'],
    '/art':       ['creator', 'director', 'vice_director', 'senior_manager'],
    '/customers': ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin'],
    '/staff':     ['creator', 'director', 'vice_director', 'senior_manager'],
    '/warehouse': ['creator', 'director', 'vice_director', 'senior_manager'],
    '/designs':   ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin'],
    '/training':  ['creator', 'director', 'vice_director', 'senior_manager', 'manager'],
    '/settings':  ['creator', 'director'],
    '/demo':      ['creator', 'director', 'vice_director', 'senior_manager', 'manager'],
    '/programs':  ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin', 'senior_instructor'],
    '/hr':        ['creator', 'director', 'vice_director', 'senior_manager'],
    '/chat':      ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin', 'senior_instructor', 'instructor', 'animator'],
    '/finance':   ['creator', 'director'],
    '/analytics': ['creator', 'director', 'vice_director', 'senior_manager'],
    '/status':    ['creator', 'director', 'vice_director', 'senior_manager'],
};

// Action permissions matrix for timeline
const ACTION_PERMISSIONS = {
    create_booking:  ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin'],
    edit_booking:    ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin'],
    cancel_booking:  ['creator', 'director', 'vice_director', 'senior_manager', 'manager'],
    delete_booking:  ['creator', 'director'],
    view_all:        ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin'],
    view_own:        ['senior_instructor', 'instructor', 'animator'],
    manage_users:    ['creator', 'director'],
    view_revenue:    ['creator', 'director', 'vice_director', 'senior_manager'],
    manage_settings: ['creator', 'director'],
    export_data:     ['creator', 'director', 'vice_director', 'senior_manager'],
    manage_staff:    ['creator', 'director', 'vice_director', 'senior_manager'],
};

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;

        // v19.1: Update employee activity (fire-and-forget, throttled to 1/min per user)
        if (user.id) {
            const cacheKey = `activity_${user.id}`;
            const now = Date.now();
            if (!authenticateToken._activityCache) authenticateToken._activityCache = {};
            if (!authenticateToken._activityCache[cacheKey] || now - authenticateToken._activityCache[cacheKey] > 60000) {
                authenticateToken._activityCache[cacheKey] = now;
                pool.query(
                    'UPDATE employee_profiles SET last_activity_at = NOW() WHERE user_id = $1',
                    [user.id]
                ).catch(() => {});
            }
        }

        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
}

// v20.1.0: Legacy role mapping — old roles expand to new ones for backward compat
const LEGACY_ROLE_MAP = {
    'admin': ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin'],
    'user': ['creator', 'director', 'vice_director', 'senior_manager', 'manager', 'admin', 'senior_instructor', 'instructor'],
    'manager': ['creator', 'director', 'vice_director', 'senior_manager', 'manager'],
    'viewer': ['animator', 'waiter', 'instructor'],
};

// v20.1.0: Check if user has one of the specified roles (with legacy expansion)
function requireRole(...roles) {
    // Expand legacy role names to new role system
    const expandedRoles = new Set();
    for (const role of roles) {
        if (LEGACY_ROLE_MAP[role]) {
            LEGACY_ROLE_MAP[role].forEach(r => expandedRoles.add(r));
        }
        expandedRoles.add(role);
    }

    return (req, res, next) => {
        if (!req.user || !expandedRoles.has(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

// v20.1.0: Check if user role is at least minRole in the hierarchy
function requireMinRole(minRole) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        const userLevel = ROLE_LEVEL[req.user.role];
        const minLevel = ROLE_LEVEL[minRole];
        if (userLevel === undefined || minLevel === undefined || userLevel < minLevel) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

// v20.1.0: Check if user can perform a specific action
function requireAction(action) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Authentication required' });
        const allowed = ACTION_PERMISSIONS[action];
        if (!allowed || !allowed.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        next();
    };
}

module.exports = {
    JWT_SECRET,
    authenticateToken,
    requireRole,
    requireMinRole,
    requireAction,
    ROLE_HIERARCHY,
    ROLE_LEVEL,
    PAGE_ACCESS,
    ACTION_PERMISSIONS
};
