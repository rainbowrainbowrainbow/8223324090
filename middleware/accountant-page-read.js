'use strict';

const { normalizeRoleList, resolveCapability } = require('../services/accountAccessPolicy');

// Reuse the effective page policy for operational read routes with legacy role gates.
function allowAccountantPageRead(page, existingGuard) {
    return (req, res, next) => {
        if (['GET', 'HEAD'].includes(req.method) && normalizeRoleList(req.user).includes('accountant')) {
            if (resolveCapability(req.user, page, { type: 'page' }).allowed) return next();
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
        return existingGuard(req, res, next);
    };
}

module.exports = { allowAccountantPageRead };
