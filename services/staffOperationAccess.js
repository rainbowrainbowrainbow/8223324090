'use strict';

const { resolveCapability } = require('./accountAccessPolicy');

function resolveStaffOperation(user, operation) {
    const delegated = resolveCapability(user, operation, { type: 'action' });
    if (delegated.source === 'explicit_deny') return null;
    if (resolveCapability(user, 'hr.staff.manage', { type: 'action' }).allowed) {
        return 'hr.staff.manage';
    }
    return delegated.allowed ? operation : null;
}

module.exports = { resolveStaffOperation };
