/**
 * middleware/auth.js — JWT authentication + Role-based access control
 * v22.0.0: Expanded role system — 25 roles with hierarchy and access matrix
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

// v22.0.0: Role hierarchy — 25 roles (higher index = more permissions)
const ROLE_HIERARCHY = [
    'waiter',            // 0
    'dishwasher',        // 1
    'maintenance',       // 2
    'cleaning',          // 3
    'wardrobe',          // 4
    'barista',           // 5
    'reception',         // 6
    'animator',          // 7
    'pastry_chef',       // 8
    'head_pastry',       // 9
    'cook',              // 10
    'head_chef',         // 11
    'instructor',        // 12
    'senior_instructor', // 13
    'admin',             // 14
    'hr',                // 15
    'it_specialist',     // 16
    'marketer',          // 17
    'art_director',      // 18
    'accountant',        // 19
    'manager',           // 20
    'senior_manager',    // 21
    'vice_director',     // 22
    'director',          // 23
    'creator'            // 24
];

const ROLE_LEVEL = {};
ROLE_HIERARCHY.forEach((role, idx) => { ROLE_LEVEL[role] = idx; });

// v22.0.0: Page access matrix — all roles, merged pages (/leads→/customers, /designs→/art)
const ALL_STAFF = ROLE_HIERARCHY.filter(r => r !== 'waiter');
const MANAGEMENT_UP = ['creator', 'director', 'vice_director', 'senior_manager'];
const MANAGER_UP = [...MANAGEMENT_UP, 'manager'];
const ADMIN_UP = [...MANAGER_UP, 'accountant', 'art_director', 'marketer', 'it_specialist', 'hr', 'admin'];
const PAGE_ACCESS = {
    '/dashboard': ROLE_HIERARCHY,  // Everyone
    '/':          ALL_STAFF,
    '/tasks':     ALL_STAFF,
    '/center':    MANAGER_UP,
    '/art':       [...MANAGER_UP, 'art_director', 'marketer'],
    '/graduation': [...MANAGER_UP, 'admin', 'art_director', 'marketer'],
    '/customers': [...ADMIN_UP, 'reception'],
    '/staff':     [...MANAGER_UP, 'hr'],
    '/warehouse': [...MANAGER_UP, 'admin'],
    '/training':  [...MANAGER_UP, 'senior_instructor', 'instructor'],
    '/settings':  ['creator', 'director'],
    '/demo':      MANAGER_UP,
    '/programs':  [...ADMIN_UP, 'senior_instructor'],
    '/hr':        [...MANAGER_UP, 'hr'],
    '/chat':      ALL_STAFF,
    '/finance':   ['creator', 'director', 'accountant'],
    '/analytics': MANAGER_UP,
    '/status':    MANAGER_UP,
    '/sound':     [...MANAGER_UP, 'art_director'],
};

// v22.0.0: Action permissions matrix for timeline
const ACTION_PERMISSIONS = {
    create_booking:  [...ADMIN_UP, 'reception'],
    edit_booking:    [...ADMIN_UP, 'reception'],
    cancel_booking:  MANAGER_UP,
    delete_booking:  ['creator', 'director'],
    view_all:        ADMIN_UP,
    view_own:        ['senior_instructor', 'instructor', 'animator', 'reception'],
    manage_users:    ['creator', 'director'],
    view_revenue:    [...MANAGER_UP, 'accountant'],
    manage_settings: ['creator', 'director'],
    export_data:     MANAGER_UP,
    manage_staff:    [...MANAGER_UP, 'hr'],
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
            if (!authenticateToken._activityCache) {
                authenticateToken._activityCache = new Map();
                // Cleanup stale entries every 10 minutes
                authenticateToken._activityCleanup = setInterval(() => {
                    const cutoff = Date.now() - 120000;
                    for (const [k, v] of authenticateToken._activityCache) {
                        if (v < cutoff) authenticateToken._activityCache.delete(k);
                    }
                }, 600000);
                if (authenticateToken._activityCleanup.unref) authenticateToken._activityCleanup.unref();
            }
            if (!authenticateToken._activityCache.has(cacheKey) || now - authenticateToken._activityCache.get(cacheKey) > 60000) {
                authenticateToken._activityCache.set(cacheKey, now);
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

// v22.0.0: Legacy role mapping — old roles expand to new ones for backward compat
const LEGACY_ROLE_MAP = {
    'admin': ADMIN_UP,
    'user': [...ADMIN_UP, 'senior_instructor', 'instructor'],
    'manager': MANAGER_UP,
    'viewer': ['animator', 'waiter', 'instructor', 'reception', 'barista', 'wardrobe', 'cleaning', 'maintenance', 'dishwasher'],
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

// Convenience: all roles that can access gamification features
const ANY_ROLE = ROLE_HIERARCHY;

module.exports = {
    JWT_SECRET,
    authenticateToken,
    requireRole,
    requireMinRole,
    requireAction,
    ROLE_HIERARCHY,
    ROLE_LEVEL,
    PAGE_ACCESS,
    ACTION_PERMISSIONS,
    ANY_ROLE
};
