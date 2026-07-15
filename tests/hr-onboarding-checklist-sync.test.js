'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, describe, it } = require('node:test');

function compactSql(sql) {
    return String(sql || '').replace(/\s+/g, ' ').trim();
}

let batchLoader = async () => ({ groups: [], byAssignment: {} });
let templateLoader = async (_db, professionKey) => ({
    profession: { key: professionKey },
    activeItems: [],
    archivedItems: []
});

const checklistModuleId = require.resolve('../services/professionChecklists');
const onboardingModuleId = require.resolve('../services/hrOnboarding');
const previousChecklistModule = require.cache[checklistModuleId];
const previousOnboardingModule = require.cache[onboardingModuleId];
require.cache[checklistModuleId] = {
    id: checklistModuleId,
    filename: checklistModuleId,
    loaded: true,
    exports: {
        loadProfessionChecklistProgressBatch(...args) {
            return batchLoader(...args);
        },
        loadProfessionChecklistTemplate(...args) {
            return templateLoader(...args);
        }
    }
};
delete require.cache[onboardingModuleId];

const {
    onboardingProgressMeta,
    syncProfessionOnboardingProgress,
    syncProfessionOnboardingProgressForProfession
} = require('../services/hrOnboarding');

after(() => {
    if (previousChecklistModule) require.cache[checklistModuleId] = previousChecklistModule;
    else delete require.cache[checklistModuleId];
    if (previousOnboardingModule) require.cache[onboardingModuleId] = previousOnboardingModule;
    else delete require.cache[onboardingModuleId];
});

function progressGroup(staffId, professionKey, total, completed) {
    return {
        staffId,
        professionKey,
        items: Array.from({ length: total }, (_, index) => ({
            id: index + 1,
            itemKey: `item_${index + 1}`,
            title: `Item ${index + 1}`,
            progress: index < completed ? {
                completed: true,
                completedAt: '2026-07-01T08:00:00.000Z',
                completedBy: 'test-actor',
                notes: null
            } : null
        })),
        orphanedProgress: [],
        summary: {
            total,
            completed,
            remaining: total - completed,
            percent: total > 0 ? Math.round((completed / total) * 100) : 0
        }
    };
}

describe('canonical profession checklist onboarding synchronization', () => {
    it('derives profession status from canonical readiness instead of stale persisted completion', () => {
        const reopened = onboardingProgressMeta({
            id: 10,
            staff_id: 7,
            profession_key: 'animator',
            status: 'completed',
            training_status: 'completed',
            completed_at: '2026-07-01T10:00:00.000Z',
            profession_readiness: { total: 2, completed: 1, items: [] }
        });
        assert.equal(reopened.status, 'in_progress');
        assert.equal(reopened.training_status, 'in_progress');
        assert.equal(reopened.completed_at, null);
        assert.equal(reopened.total_items, 2);
        assert.equal(reopened.completed_items, 1);

        const completed = onboardingProgressMeta({
            id: 11,
            staff_id: 7,
            profession_key: 'animator',
            status: 'in_progress',
            training_status: 'not_started',
            profession_readiness: { total: 2, completed: 2, items: [] }
        });
        assert.equal(completed.status, 'completed');
        assert.equal(completed.training_status, 'completed');

        const blocked = onboardingProgressMeta({
            id: 12,
            staff_id: 7,
            profession_key: 'animator',
            status: 'blocked',
            training_status: 'blocked',
            completed_at: '2026-07-01T10:00:00.000Z',
            profession_readiness: { total: 2, completed: 2, items: [] }
        });
        assert.equal(blocked.status, 'blocked');
        assert.equal(blocked.training_status, 'blocked');
        assert.equal(blocked.completed_at, null);
    });

    it('updates status and canonical counters for one staff onboarding row', async () => {
        const group = progressGroup(7, 'animator', 2, 1);
        batchLoader = async (_db, assignments, options) => {
            assert.deepEqual(assignments, [{ staffId: 7, professionKey: 'animator' }]);
            assert.deepEqual(options, { includeArchived: false, includeOrphaned: true });
            return { groups: [group], byAssignment: { '7:animator': group } };
        };
        templateLoader = async () => ({ activeItems: group.items, archivedItems: [] });
        const queries = [];
        const db = {
            async query(sql, params = []) {
                const text = compactSql(sql);
                queries.push({ text, params });
                if (/^SELECT \* FROM onboarding_progress WHERE staff_id = \$1 AND profession_key = \$2/.test(text)) {
                    return { rows: [{
                        id: 33,
                        staff_id: 7,
                        profession_key: 'animator',
                        status: 'completed',
                        training_status: 'completed',
                        completed_items: 2,
                        total_items: 2,
                        completed_at: '2026-07-01T10:00:00.000Z'
                    }] };
                }
                if (/^UPDATE onboarding_progress SET status = \$2::text/.test(text)) {
                    assert.deepEqual(params, [33, 'in_progress', 'in_progress', 2, 1]);
                    return { rows: [{
                        id: 33,
                        staff_id: 7,
                        profession_key: 'animator',
                        status: params[1],
                        training_status: params[2],
                        total_items: params[3],
                        completed_items: params[4],
                        completed_at: null
                    }] };
                }
                if (/^SELECT hp\.key AS profession_key/.test(text)) {
                    return { rows: [{
                        profession_key: 'animator',
                        profession_title: 'Animator',
                        profession_is_active: true,
                        is_primary: true,
                        assignment_status: 'active',
                        admission_status: 'approved',
                        internship_status: 'completed'
                    }] };
                }
                if (/^INSERT INTO hr_audit_log/.test(text)) return { rows: [], rowCount: 1 };
                throw new Error(`Unexpected query: ${text}`);
            }
        };

        const result = await syncProfessionOnboardingProgress(7, 'animator', { username: 'auditor' }, {
            db,
            lock: true,
            ipAddress: '127.0.0.1'
        });

        assert.equal(result.status, 'in_progress');
        assert.equal(result.training_status, 'in_progress');
        assert.equal(result.total_items, 2);
        assert.equal(result.completed_items, 1);
        const audit = queries.find(query => /^INSERT INTO hr_audit_log/.test(query.text));
        assert.equal(audit.params[0], 'profession_onboarding_reopened');
        const details = JSON.parse(audit.params[3]);
        assert.equal(details.before_status, 'completed');
        assert.equal(details.after_status, 'in_progress');
        assert.equal(details.total_items, 2);
        assert.equal(details.completed_items, 1);
    });

    it('batch-syncs latest rows in one checklist load, one update, and one transition audit insert', async () => {
        const rows = [
            {
                id: 41,
                staff_id: 1,
                profession_key: 'animator',
                status: 'completed',
                training_status: 'completed',
                total_items: 2,
                completed_items: 2,
                completed_at: '2026-07-01T10:00:00.000Z'
            },
            {
                id: 42,
                staff_id: 2,
                profession_key: 'animator',
                status: 'in_progress',
                training_status: 'in_progress',
                total_items: 2,
                completed_items: 1,
                completed_at: null
            },
            {
                id: 43,
                staff_id: 3,
                profession_key: 'animator',
                status: 'blocked',
                training_status: 'blocked',
                total_items: 0,
                completed_items: 0,
                completed_at: null
            }
        ];
        const groups = [
            progressGroup(1, 'animator', 2, 1),
            progressGroup(2, 'animator', 2, 2),
            progressGroup(3, 'animator', 2, 2)
        ];
        let checklistLoads = 0;
        batchLoader = async (_db, assignments, options) => {
            checklistLoads += 1;
            assert.deepEqual(assignments, [
                { staffId: 1, professionKey: 'animator' },
                { staffId: 2, professionKey: 'animator' },
                { staffId: 3, professionKey: 'animator' }
            ]);
            assert.deepEqual(options, { includeArchived: false, includeOrphaned: false });
            return {
                groups,
                byAssignment: Object.fromEntries(groups.map(group => [
                    `${group.staffId}:${group.professionKey}`,
                    group
                ]))
            };
        };
        const queries = [];
        const db = {
            async query(sql, params = []) {
                const text = compactSql(sql);
                queries.push({ text, params });
                if (/^WITH latest AS \(/.test(text)) return { rows };
                if (/^WITH requested AS \(.+UPDATE onboarding_progress progress/.test(text)) {
                    return { rows: [], rowCount: JSON.parse(params[0]).length };
                }
                if (/^WITH audit_rows AS \(.+INSERT INTO hr_audit_log/.test(text)) {
                    return { rows: [], rowCount: JSON.parse(params[0]).length };
                }
                throw new Error(`Unexpected query: ${text}`);
            }
        };

        const summary = await syncProfessionOnboardingProgressForProfession(
            'animator',
            { username: 'auditor' },
            { db, ipAddress: '127.0.0.1' }
        );

        assert.equal(checklistLoads, 1);
        assert.equal(summary.processedCount, 3);
        assert.equal(summary.updatedCount, 3);
        assert.deepEqual(summary.statusCounts, { completed: 1, inProgress: 1, blocked: 1 });
        assert.deepEqual(summary.transitionCounts, { completed: 1, reopened: 1 });
        assert.equal(summary.audit.completed_transition_count, 1);
        assert.equal(summary.audit.reopened_transition_count, 1);

        const update = queries.find(query => /^WITH requested AS \(/.test(query.text));
        const updateRows = JSON.parse(update.params[0]);
        assert.deepEqual(updateRows, [
            { id: 41, status: 'in_progress', training_status: 'in_progress', total_items: 2, completed_items: 1 },
            { id: 42, status: 'completed', training_status: 'completed', total_items: 2, completed_items: 2 },
            { id: 43, status: 'blocked', training_status: 'blocked', total_items: 2, completed_items: 2 }
        ]);

        const audit = queries.find(query => /^WITH audit_rows AS \(/.test(query.text));
        const auditRows = JSON.parse(audit.params[0]);
        assert.equal(auditRows.length, 2);
        assert.deepEqual(auditRows.map(row => row.action).sort(), [
            'profession_onboarding_completed',
            'profession_onboarding_reopened'
        ]);
        assert.equal(JSON.stringify(auditRows).includes('staff_name'), false);
        assert.equal(JSON.stringify(auditRows).includes('profession_title'), false);
        assert.equal(audit.params[1], 'auditor');
    });

    it('keeps existing profession assignment updates on canonical counts', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'hrOnboarding.js'), 'utf8');
        const branchStart = source.indexOf('} else {', source.indexOf('async function assignOnboardingResponsible'));
        const branchEnd = source.indexOf('\n        progress.profession_title', branchStart);
        const existingBranch = source.slice(branchStart, branchEnd);
        const assignmentFunction = source.slice(
            source.indexOf('async function assignOnboardingResponsible'),
            branchEnd
        );

        assert.match(assignmentFunction, /const professionReadiness = professionKey\s*\? await loadProfessionReadiness/);
        assert.match(assignmentFunction, /professionKey \? professionReadiness\.total : items\.length/);
        assert.match(assignmentFunction, /professionKey \? professionReadiness\.completed : 0/);
        assert.match(existingBranch, /const completed = professionKey\s*\? professionReadiness\.completed/);
        assert.match(existingBranch, /const total = professionKey\s*\? professionReadiness\.total/);
        assert.match(existingBranch, /completed_items = \$11/);
        assert.match(existingBranch, /WHEN profession_key IS NOT NULL THEN \$10/);
        assert.doesNotMatch(existingBranch, /const completed = professionKey\s*\? 0/);
        assert.doesNotMatch(existingBranch, /const total = professionKey\s*\? 0/);
    });
});
