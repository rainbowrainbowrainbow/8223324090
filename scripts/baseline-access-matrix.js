#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROLE_HIERARCHY, PAGE_PERMISSIONS, ACTION_PERMISSIONS } = require('../config/permissionRegistry');
const { resolveCapability } = require('../services/accountAccessPolicy');
const { comparePreset } = require('../services/baselineAccessAudit');
const baseline = require('../docs/access-baseline/production-083120.json');
const { getPermissions } = require('../config/roles');
const oldAllTasks = new Set(['creator', 'director', 'vice_director', 'senior_manager', 'accountant', 'it_specialist']);
const oldTeamTasks = new Set(['manager', 'art_director', 'marketer', 'hr', 'head_chef', 'head_pastry']);

const matrix = ROLE_HIERARCHY.map(role => ({ role,
    recordScopes: {
        business: 'active_membership',
        tasks: { before: oldAllTasks.has(role) ? 'all' : oldTeamTasks.has(role) ? 'department_label' : 'own',
            after: getPermissions({ role }).taskVisibility === 'department' ? 'staff_structure_node' : getPermissions({ role }).taskVisibility },
        booking: { before: (baseline.actions.view_all || []).includes(role) ? 'business' : 'assignment_or_legacy_match',
            after: resolveCapability({ role }, 'view_all').allowed ? 'business' : 'assignment_or_legacy_match' },
        scheduleWrite: { before: (baseline.actions['hr.schedule.manage'] || []).includes(role) ? 'business' : 'none',
            after: resolveCapability({ role }, 'hr.schedule.manage').allowed
            ? resolveCapability({ role }, 'hr.schedule.scope.business').allowed ? 'business' : 'staff_structure_node'
            : 'none' }
    },
    pages: PAGE_PERMISSIONS.filter(entry => !entry.deprecated).map(entry => ({ page: entry.key,
        before: (baseline.pages[entry.key] || []).includes(role), after: resolveCapability({ role }, entry.key).allowed })),
    actions: ACTION_PERMISSIONS.filter(entry => !entry.deprecated).map(entry => ({ action: entry.key,
        before: (baseline.actions[entry.key] || []).includes(role), after: resolveCapability({ role }, entry.key).allowed })),
    changes: comparePreset({ role })
}));

const yes = value => value ? 'yes' : 'no';
const rows = matrix.map(row => {
    const action = key => row.actions.find(entry => entry.action === key)?.after;
    return `| ${row.role} | ${row.pages.filter(entry => entry.after).map(entry => entry.page).join(', ')} | ${yes(action('bookings.details.view'))} / ${yes(action('bookings.contacts.view'))} / ${yes(action('view_revenue'))} | ${yes(action('create_booking'))} / ${yes(action('edit_booking'))} / ${yes(action('delete_booking'))} / ${yes(action('export_data'))} | Tasks: ${row.recordScopes.tasks.before} → ${row.recordScopes.tasks.after}; booking: ${row.recordScopes.booking.before} → ${row.recordScopes.booking.after}; schedule write: ${row.recordScopes.scheduleWrite.before} → ${row.recordScopes.scheduleWrite.after} | ${row.changes.map(change => `${change.after ? '+' : '-'}${change.capability}`).join(', ')} |`;
});
const markdown = `# Baseline access preset matrix (candidate, not release proof)

Baseline: production 0.83.120, ${baseline.sha}. Generated from the current registry.
All 26 roles receive Profile/My Day, Tasks, Chat, Afisha, Training and Staff schedule.
Explicit denials override both primary/additional role presets and personal grants.
Membership-required businesses fail closed without an active membership.

Columns describe presets. They do not bypass API record scopes or grant membership.
Booking read scope remains business + durable staff assignment/explicit operational scope;
the existing shared animator timeline is a read surface. Instructor game-zone and team
responsibility mappings are dependencies tracked in STATE.md and are not implemented by a page grant.
Schedule coordination excludes absence reasons, notes, audit history and compensation;
personnel and payroll capabilities remain separate.

The baseline booking GET DTO had no shared contact/working-field projection. New
field capabilities therefore describe field restrictions on an already-visible
record, not new record grants. Page presets remain separate from actual business
module availability; unmigrated Chat/Training and scoped responsibility links
must be assessed independently in account readiness and the actual-app report.

| Role | Page presets | Working details / contacts / revenue | Create / edit / cancel / export | Record scope before → candidate | Registry preset changes |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

The JSON companion contains every current and candidate page/action decision, including unchanged entries.
Cancellation uses the existing delete_booking capability; deprecated cancel_booking grants nothing.
Field access does not grant record access. Personal exceptions are retained, never migrated automatically.
`;
const root = path.resolve(__dirname, '../docs/access-baseline');
fs.writeFileSync(path.join(root, 'matrix.json'), JSON.stringify({ baselineSha: baseline.sha, roles: matrix }, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'MATRIX.md'), markdown);
