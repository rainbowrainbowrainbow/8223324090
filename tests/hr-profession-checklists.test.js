'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
    archiveProfessionChecklistItem,
    classifyChecklistProgress,
    createProfessionChecklistItem,
    generateChecklistItemKey,
    loadProfessionChecklistDashboard,
    loadProfessionChecklistProgressBatch,
    normalizeChecklistItemKey,
    normalizeChecklistItemTitle,
    normalizeChecklistReorderKeys,
    normalizeDashboardFilters,
    renameProfessionChecklistItem,
    reorderProfessionChecklistItems,
    toggleStaffProfessionChecklistProgress
} = require('../services/professionChecklists');

function compactSql(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
}

function clone(value) {
    return value == null ? value : structuredClone(value);
}

function itemRow(item) {
    return {
        id: item.id,
        profession_id: item.profession_id,
        item_key: item.item_key,
        title: item.title,
        sort_order: item.sort_order,
        is_active: item.is_active,
        legacy_position: item.legacy_position ?? null,
        created_by: item.created_by ?? null,
        updated_by: item.updated_by ?? null,
        created_at: item.created_at ?? '2026-07-01T08:00:00.000Z',
        updated_at: item.updated_at ?? '2026-07-01T08:00:00.000Z'
    };
}

function progressRow(progress) {
    if (!progress) return null;
    return {
        progress_id: progress.id,
        staff_id: progress.staff_id,
        profession_key: progress.profession_key,
        progress_checklist_item_id: progress.checklist_item_id,
        progress_checklist_key: progress.checklist_key,
        legacy_checklist_key: progress.legacy_checklist_key ?? null,
        progress_title: progress.title,
        completed_at: progress.completed_at,
        completed_by: progress.completed_by,
        notes: progress.notes,
        progress_created_at: progress.created_at,
        progress_updated_at: progress.updated_at
    };
}

function createChecklistDb() {
    const state = {
        profession: {
            id: 10,
            key: 'animator',
            title: 'Animator',
            department: 'Entertainment',
            is_active: true
        },
        staff: new Map([
            [1, { id: 1, name: 'Test Worker', is_active: true }]
        ]),
        assignments: new Map([
            ['1:animator', {
                id: 70,
                staff_id: 1,
                profession_key: 'animator',
                is_primary: true,
                status: 'active',
                admission_status: 'approved',
                internship_status: 'completed'
            }]
        ]),
        items: [
            {
                id: 101,
                profession_id: 10,
                item_key: 'chk_first',
                title: 'First item',
                sort_order: 10,
                is_active: true,
                legacy_position: 1,
                created_by: 'migration',
                updated_by: 'migration'
            },
            {
                id: 102,
                profession_id: 10,
                item_key: 'chk_second',
                title: 'Second item',
                sort_order: 20,
                is_active: true,
                legacy_position: 2,
                created_by: 'migration',
                updated_by: 'migration'
            }
        ],
        progress: [
            {
                id: 900,
                staff_id: 1,
                profession_key: 'animator',
                checklist_item_id: 101,
                checklist_key: 'chk_first',
                legacy_checklist_key: 'item_1',
                title: 'First item',
                completed_at: '2026-07-01T09:00:00.000Z',
                completed_by: 'migration-user',
                notes: 'Historical note',
                created_at: '2026-07-01T08:00:00.000Z',
                updated_at: '2026-07-01T09:00:00.000Z'
            }
        ],
        mirror: ['First item', 'Second item'],
        course: null,
        lectures: new Map(),
        nextItemId: 103,
        nextProgressId: 901,
        queries: []
    };

    function sortedItems(includeArchived = true) {
        return state.items
            .filter(item => includeArchived || item.is_active)
            .slice()
            .sort((left, right) => {
                if (left.is_active !== right.is_active) return left.is_active ? -1 : 1;
                return left.sort_order - right.sort_order || left.id - right.id;
            });
    }

    const db = {
        state,
        async query(sql, params = []) {
            const text = compactSql(sql);
            state.queries.push({ text, params: clone(params) });

            if (/^SELECT id, key, title, department, is_active FROM hr_professions WHERE key = \$1/.test(text)) {
                const row = String(params[0]) === state.profession.key ? state.profession : null;
                return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
            }
            if (/^SELECT id, key, title, department, is_active FROM hr_professions WHERE id = \$1/.test(text)) {
                const row = Number(params[0]) === state.profession.id ? state.profession : null;
                return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
            }
            if (/^SELECT id, profession_id, item_key, title, sort_order, is_active, legacy_position, created_by, updated_by, created_at, updated_at FROM hr_profession_checklist_items WHERE profession_id = \$1 AND \(\$2::boolean OR is_active = true\)/.test(text)) {
                const rows = sortedItems(Boolean(params[1])).map(itemRow);
                return { rows, rowCount: rows.length };
            }
            if (/^SELECT id, profession_id, item_key, title, sort_order, is_active, legacy_position, created_by, updated_by, created_at, updated_at FROM hr_profession_checklist_items WHERE profession_id = \$1 AND item_key = \$2/.test(text)) {
                const item = state.items.find(candidate => (
                    candidate.profession_id === Number(params[0])
                    && candidate.item_key === String(params[1])
                ));
                return { rows: item ? [itemRow(item)] : [], rowCount: item ? 1 : 0 };
            }
            if (/^SELECT id, profession_id, item_key, title, sort_order, is_active, legacy_position, created_by, updated_by, created_at, updated_at FROM hr_profession_checklist_items WHERE profession_id = \$1 AND LOWER\(BTRIM\(title\)\) = LOWER\(BTRIM\(\$2\)\)/.test(text)) {
                const rows = state.items
                    .filter(candidate => candidate.profession_id === Number(params[0])
                        && candidate.title.trim().toLowerCase() === String(params[1]).trim().toLowerCase())
                    .map(itemRow);
                return { rows, rowCount: rows.length };
            }
            if (/^INSERT INTO hr_profession_checklist_items /.test(text)) {
                const item = {
                    id: state.nextItemId++,
                    profession_id: Number(params[0]),
                    item_key: String(params[1]),
                    title: String(params[2]),
                    sort_order: Number(params[3]),
                    is_active: true,
                    legacy_position: null,
                    created_by: params[4] ?? null,
                    updated_by: params[4] ?? null
                };
                state.items.push(item);
                return { rows: [itemRow(item)], rowCount: 1 };
            }
            if (/^UPDATE hr_profession_checklist_items item SET sort_order = ordering\.sort_order/.test(text)) {
                const keys = params[1];
                const orders = params[2];
                const rows = [];
                keys.forEach((key, index) => {
                    const item = state.items.find(candidate => (
                        candidate.profession_id === Number(params[0])
                        && candidate.item_key === key
                        && candidate.is_active
                    ));
                    if (!item) return;
                    item.sort_order = Number(orders[index]);
                    item.updated_by = params[3] ?? null;
                    rows.push(itemRow(item));
                });
                return { rows, rowCount: rows.length };
            }
            if (/^UPDATE hr_profession_checklist_items SET title = \$3/.test(text)) {
                const item = state.items.find(candidate => (
                    candidate.profession_id === Number(params[0])
                    && candidate.item_key === String(params[1])
                ));
                if (!item) return { rows: [], rowCount: 0 };
                item.title = String(params[2]);
                item.updated_by = params[3] ?? null;
                return { rows: [itemRow(item)], rowCount: 1 };
            }
            if (/^SELECT COUNT\(\*\)::integer AS progress_records, COUNT\(\*\) FILTER \(WHERE completed_at IS NOT NULL\)::integer AS completed_records/.test(text)) {
                const rows = state.progress.filter(progress => progress.checklist_item_id === Number(params[0]));
                return {
                    rows: [{
                        progress_records: rows.length,
                        completed_records: rows.filter(progress => progress.completed_at).length,
                        affected_staff: new Set(rows.map(progress => progress.staff_id)).size
                    }],
                    rowCount: 1
                };
            }
            if (/^UPDATE hr_profession_checklist_items SET is_active = false/.test(text)) {
                const item = state.items.find(candidate => (
                    candidate.profession_id === Number(params[0])
                    && candidate.item_key === String(params[1])
                ));
                if (!item) return { rows: [], rowCount: 0 };
                item.is_active = false;
                item.updated_by = params[2] ?? null;
                return { rows: [itemRow(item)], rowCount: 1 };
            }
            if (/^UPDATE hr_professions profession SET checklist = COALESCE/.test(text)) {
                state.mirror = sortedItems(false).map(item => item.title);
                return {
                    rows: [{ checklist: clone(state.mirror), updated_at: '2026-07-02T10:00:00.000Z' }],
                    rowCount: 1
                };
            }
            if (/^SELECT COUNT\(\*\)::integer AS total_count, COUNT\(\*\) FILTER \(WHERE is_active = true\)::integer AS active_count FROM hr_profession_checklist_items/.test(text)) {
                return {
                    rows: [{
                        total_count: state.items.length,
                        active_count: state.items.filter(item => item.is_active).length
                    }],
                    rowCount: 1
                };
            }
            if (/^INSERT INTO training_courses /.test(text)) {
                state.course = {
                    id: 500,
                    title: params[0],
                    profession_key: params[3],
                    lectures_count: Number(params[4]),
                    estimated_hours: Number(params[5]),
                    is_active: Boolean(params[6])
                };
                return { rows: [clone(state.course)], rowCount: 1 };
            }
            if (/^UPDATE training_courses SET title = \$2/.test(text)) {
                if (!state.course) return { rows: [], rowCount: 0 };
                state.course.title = params[1];
                state.course.lectures_count = 0;
                state.course.estimated_hours = 0;
                state.course.is_active = false;
                return { rows: [clone(state.course)], rowCount: 1 };
            }
            if (/^INSERT INTO training_course_lectures /.test(text)) {
                for (const item of state.items) {
                    state.lectures.set(item.id, {
                        checklist_item_id: item.id,
                        checklist_key: item.item_key,
                        title: item.title,
                        sort_order: item.sort_order,
                        is_published: item.is_active && state.profession.is_active
                    });
                }
                return {
                    rows: state.items.map((item, index) => ({ id: 700 + index })),
                    rowCount: state.items.length
                };
            }
            if (/^UPDATE training_course_lectures lecture SET is_published = false/.test(text)) {
                return { rows: [], rowCount: 0 };
            }
            if (/^SELECT id, name, is_active FROM staff WHERE id = \$1/.test(text)) {
                const staff = state.staff.get(Number(params[0]));
                return { rows: staff ? [clone(staff)] : [], rowCount: staff ? 1 : 0 };
            }
            if (/^SELECT id, staff_id, profession_key, is_primary, status, admission_status, internship_status FROM staff_role_assignments/.test(text)) {
                const assignment = state.assignments.get(`${Number(params[0])}:${String(params[1])}`);
                return { rows: assignment ? [clone(assignment)] : [], rowCount: assignment ? 1 : 0 };
            }
            if (/^SELECT id AS progress_id, staff_id, profession_key, checklist_item_id AS progress_checklist_item_id/.test(text)) {
                const progress = state.progress.find(candidate => (
                    candidate.staff_id === Number(params[0])
                    && candidate.checklist_item_id === Number(params[1])
                ));
                return { rows: progress ? [progressRow(progress)] : [], rowCount: progress ? 1 : 0 };
            }
            if (/^INSERT INTO hr_staff_profession_checklist_progress /.test(text)) {
                let progress = state.progress.find(candidate => (
                    candidate.staff_id === Number(params[0])
                    && candidate.checklist_item_id === Number(params[3])
                ));
                if (!progress) {
                    progress = {
                        id: state.nextProgressId++,
                        staff_id: Number(params[0]),
                        created_at: '2026-07-02T10:00:00.000Z'
                    };
                    state.progress.push(progress);
                }
                progress.profession_key = String(params[1]);
                progress.checklist_key = String(params[2]);
                progress.checklist_item_id = Number(params[3]);
                progress.title = String(params[4]);
                progress.completed_at = params[5] ? (progress.completed_at || '2026-07-02T10:00:00.000Z') : null;
                progress.completed_by = params[5] ? (params[6] ?? null) : null;
                progress.notes = params[7] ?? null;
                progress.updated_at = '2026-07-02T10:00:00.000Z';
                return { rows: [progressRow(progress)], rowCount: 1 };
            }
            if (/^WITH requested AS \( SELECT staff_id, profession_key FROM jsonb_to_recordset/.test(text)
                && text.includes('JOIN hr_profession_checklist_items item ON item.profession_id = profession.id')) {
                const assignments = JSON.parse(params[0]);
                const includeArchived = Boolean(params[1]);
                const rows = [];
                for (const assignment of assignments) {
                    if (assignment.profession_key !== state.profession.key) continue;
                    for (const item of sortedItems(includeArchived)) {
                        const progress = state.progress.find(candidate => (
                            candidate.staff_id === Number(assignment.staff_id)
                            && candidate.checklist_item_id === item.id
                        ));
                        rows.push({
                            staff_id: Number(assignment.staff_id),
                            profession_id: state.profession.id,
                            profession_key: state.profession.key,
                            profession_title: state.profession.title,
                            department: state.profession.department,
                            profession_is_active: state.profession.is_active,
                            item_id: item.id,
                            item_key: item.item_key,
                            item_title: item.title,
                            sort_order: item.sort_order,
                            item_is_active: item.is_active,
                            legacy_position: item.legacy_position,
                            ...progressRow(progress)
                        });
                    }
                }
                return { rows, rowCount: rows.length };
            }
            if (/^WITH requested AS \( SELECT staff_id, profession_key FROM jsonb_to_recordset/.test(text)
                && text.includes('JOIN hr_staff_profession_checklist_progress progress')) {
                const assignments = JSON.parse(params[0]);
                const requested = new Set(assignments.map(row => `${row.staff_id}:${row.profession_key}`));
                const rows = state.progress.filter(progress => {
                    if (!requested.has(`${progress.staff_id}:${progress.profession_key}`)) return false;
                    const item = state.items.find(candidate => candidate.id === progress.checklist_item_id);
                    return !item || item.profession_id !== state.profession.id;
                }).map(progressRow);
                return { rows, rowCount: rows.length };
            }
            throw new Error(`Unexpected query: ${text}`);
        }
    };

    return db;
}

describe('profession checklist primitives', () => {
    it('generates stable immutable-looking keys and rejects invalid key/title input', () => {
        const first = generateChecklistItemKey('same-entropy');
        const repeated = generateChecklistItemKey('same-entropy');
        const second = generateChecklistItemKey('different-entropy');

        assert.equal(first, repeated);
        assert.notEqual(first, second);
        assert.match(first, /^chk_[a-f0-9]{32}$/);
        assert.equal(normalizeChecklistItemKey('CHK_valid_1'), 'chk_valid_1');
        assert.equal(normalizeChecklistItemTitle('  Safety rules  '), 'Safety rules');

        assert.throws(
            () => normalizeChecklistItemKey('invalid key'),
            error => error.code === 'PROFESSION_CHECKLIST_INVALID_ITEM_KEY' && error.statusCode === 400
        );
        assert.throws(
            () => normalizeChecklistItemTitle(' \u0000 '),
            error => error.code === 'PROFESSION_CHECKLIST_TITLE_REQUIRED'
        );
        assert.throws(
            () => normalizeChecklistItemTitle('x'.repeat(501)),
            error => error.code === 'PROFESSION_CHECKLIST_TITLE_TOO_LONG'
        );
        assert.throws(
            () => normalizeChecklistReorderKeys(['chk_first', 'chk_first']),
            error => error.code === 'PROFESSION_CHECKLIST_REORDER_DUPLICATE'
        );
    });
});

describe('profession checklist template mutations', () => {
    it('keeps item identity and historical progress through create, rename, reorder and archive', async () => {
        const db = createChecklistDb();
        const originalProgress = clone(db.state.progress[0]);

        const created = await createProfessionChecklistItem(db, 'animator', {
            title: 'Inserted item',
            position: 1
        }, {
            actor: 'qa-user',
            keyGenerator: () => 'chk_created'
        });
        assert.equal(created.item.itemKey, 'chk_created');
        assert.deepEqual(
            db.state.items.filter(item => item.is_active).sort((a, b) => a.sort_order - b.sort_order).map(item => item.item_key),
            ['chk_first', 'chk_created', 'chk_second']
        );
        assert.deepEqual(db.state.progress[0], originalProgress, 'create must not rewrite existing progress');

        const renamed = await renameProfessionChecklistItem(
            db,
            'animator',
            'chk_first',
            { title: 'Renamed first item' },
            { actor: 'qa-user' }
        );
        assert.equal(renamed.item.id, 101);
        assert.equal(renamed.item.itemKey, 'chk_first');
        assert.equal(renamed.item.title, 'Renamed first item');
        assert.deepEqual(db.state.progress[0], originalProgress, 'rename must preserve the progress snapshot');

        const reordered = await reorderProfessionChecklistItems(
            db,
            'animator',
            ['chk_second', 'chk_first', 'chk_created'],
            { actor: 'qa-user' }
        );
        assert.equal(reordered.changed, true);
        assert.deepEqual(reordered.items.map(item => item.itemKey), [
            'chk_second',
            'chk_first',
            'chk_created'
        ]);
        assert.equal(db.state.items.find(item => item.id === 101).item_key, 'chk_first');
        assert.deepEqual(db.state.progress[0], originalProgress, 'reorder must not move completion to another item');

        const archived = await archiveProfessionChecklistItem(
            db,
            'animator',
            'chk_first',
            { actor: 'qa-user' }
        );
        assert.equal(archived.item.id, 101);
        assert.equal(archived.item.itemKey, 'chk_first');
        assert.equal(archived.item.isActive, false);
        assert.deepEqual(archived.impact, {
            progressRecords: 1,
            completedRecords: 1,
            affectedStaff: 1
        });
        assert.deepEqual(db.state.progress[0], originalProgress, 'archive must retain completion history');

        const batch = await loadProfessionChecklistProgressBatch(db, [
            { staffId: 1, professionKey: 'animator' }
        ], { includeArchived: true, includeOrphaned: false });
        const group = batch.byAssignment['1:animator'];
        assert.equal(group.archivedItems.length, 1);
        assert.equal(group.archivedItems[0].itemKey, 'chk_first');
        assert.equal(group.archivedItems[0].progress.completed, true);
        assert.equal(group.archivedItems[0].progress.notes, 'Historical note');

        assert.deepEqual(db.state.mirror, ['Second item', 'Inserted item']);
        assert.equal(db.state.lectures.get(101).checklist_key, 'chk_first');
        assert.equal(db.state.lectures.get(101).title, 'Renamed first item');
        assert.equal(db.state.lectures.get(101).is_published, false);
        assert.equal(db.state.lectures.get(102).sort_order, 10);
    });

    it('rejects incomplete or foreign reorder sets without modifying identity', async () => {
        const db = createChecklistDb();
        const before = clone(db.state.items);

        await assert.rejects(
            reorderProfessionChecklistItems(db, 'animator', ['chk_first'], { actor: 'qa-user' }),
            error => error.code === 'PROFESSION_CHECKLIST_REORDER_SET_MISMATCH'
        );
        assert.deepEqual(db.state.items, before);
    });
});

describe('profession checklist progress', () => {
    it('validates the staff/profession/item target and stores the canonical item title', async () => {
        const db = createChecklistDb();
        db.state.progress.length = 0;

        const saved = await toggleStaffProfessionChecklistProgress(db, {
            staffId: 1,
            professionKey: 'animator',
            itemKey: 'chk_first',
            title: 'Client supplied title must be ignored',
            completed: true,
            notes: 'Ready'
        }, { actor: { username: 'hr-manager' } });

        assert.equal(saved.progress.checklistItemId, 101);
        assert.equal(saved.progress.checklistKey, 'chk_first');
        assert.equal(saved.progress.title, 'First item');
        assert.equal(saved.progress.completed, true);
        assert.equal(saved.progress.completedBy, 'hr-manager');
        assert.equal(saved.progress.notes, 'Ready');

        const longActor = 'a'.repeat(90);
        const savedWithSchemaSafeActor = await toggleStaffProfessionChecklistProgress(db, {
            staffId: 1,
            professionKey: 'animator',
            itemKey: 'chk_first',
            completed: true,
            notes: 'Ready'
        }, { actor: longActor });
        assert.equal(savedWithSchemaSafeActor.progress.completedBy, 'a'.repeat(80));

        await assert.rejects(
            toggleStaffProfessionChecklistProgress(db, {
                staffId: 1,
                professionKey: 'animator',
                itemKey: 'chk_foreign',
                completed: true
            }, { actor: 'hr-manager' }),
            error => error.code === 'PROFESSION_CHECKLIST_ITEM_NOT_FOUND'
        );

        db.state.assignments.delete('1:animator');
        await assert.rejects(
            toggleStaffProfessionChecklistProgress(db, {
                staffId: 1,
                professionKey: 'animator',
                itemKey: 'chk_second',
                completed: true
            }, { actor: 'hr-manager' }),
            error => error.code === 'PROFESSION_CHECKLIST_PROFESSION_NOT_ASSIGNED'
        );
    });

    it('does not allow toggling an archived item but keeps its previously saved history', async () => {
        const db = createChecklistDb();
        await archiveProfessionChecklistItem(db, 'animator', 'chk_first', { actor: 'qa-user' });
        const history = clone(db.state.progress[0]);

        await assert.rejects(
            toggleStaffProfessionChecklistProgress(db, {
                staffId: 1,
                professionKey: 'animator',
                itemKey: 'chk_first',
                completed: false
            }, { actor: 'qa-user' }),
            error => error.code === 'PROFESSION_CHECKLIST_ITEM_ARCHIVED'
        );
        assert.deepEqual(db.state.progress[0], history);
    });

    it('resolves legacy item_N writes only through one exact canonical title match', async () => {
        const db = createChecklistDb();

        const saved = await toggleStaffProfessionChecklistProgress(db, {
            staffId: 1,
            professionKey: 'animator',
            itemKey: 'item_2',
            itemTitle: 'Second item',
            completed: true
        }, { actor: 'legacy-client' });

        assert.equal(saved.progress.checklistItemId, 102);
        assert.equal(saved.progress.checklistKey, 'chk_second');
        assert.equal(saved.progress.title, 'Second item');

        db.state.items.push({
            id: 103,
            profession_id: 10,
            item_key: 'chk_second_duplicate',
            title: 'Second item',
            sort_order: 30,
            is_active: true,
            legacy_position: null
        });
        await assert.rejects(
            toggleStaffProfessionChecklistProgress(db, {
                staffId: 1,
                professionKey: 'animator',
                itemKey: 'item_2',
                itemTitle: 'Second item',
                completed: true
            }, { actor: 'legacy-client' }),
            error => error.code === 'PROFESSION_CHECKLIST_LEGACY_ITEM_AMBIGUOUS'
        );
    });
});

describe('profession checklist aggregate reads', () => {
    it('loads any number of assignment progress groups with a fixed query count', async () => {
        const db = createChecklistDb();
        const assignments = Array.from({ length: 50 }, (_, index) => ({
            staffId: index + 1,
            professionKey: 'animator'
        }));

        const result = await loadProfessionChecklistProgressBatch(db, assignments, {
            includeArchived: true,
            includeOrphaned: true
        });
        assert.equal(result.groups.length, 50);
        assert.equal(db.state.queries.length, 2, 'batch loader must use one canonical and one orphan query');
        assert.equal(result.byAssignment['50:animator'].items.length, 2);
        assert.equal(result.byAssignment['50:animator'].archivedItems.length, 0);

        const emptyDb = createChecklistDb();
        const empty = await loadProfessionChecklistProgressBatch(emptyDb, []);
        assert.deepEqual(empty, { groups: [], byAssignment: {} });
        assert.equal(emptyDb.state.queries.length, 0);
    });

    it('normalizes dashboard filters and classifies template progress consistently', async () => {
        assert.deepEqual(classifyChecklistProgress(0, 0), {
            status: 'without_template', total: 0, completed: 0, remaining: 0, percent: 0
        });
        assert.equal(classifyChecklistProgress(4, 0).status, 'not_started');
        assert.deepEqual(classifyChecklistProgress(4, 1), {
            status: 'in_progress', total: 4, completed: 1, remaining: 3, percent: 25
        });
        assert.equal(classifyChecklistProgress(4, 9).status, 'completed');

        const normalized = normalizeDashboardFilters({
            profession: 'Animator,barista,animator',
            department: ['Entertainment', 'Kitchen', 'Entertainment'],
            staff: '2,1,2',
            status: 'IN_PROGRESS,completed',
            assignmentStatus: 'ACTIVE',
            includeInactiveProfessions: 'true',
            includeInactiveStaff: 'false',
            search: '  Test\u0000 Worker  ',
            limit: 9999,
            offset: 7
        });
        assert.deepEqual(normalized.professionKeys, ['animator', 'barista']);
        assert.deepEqual(normalized.departments, ['Entertainment', 'Kitchen']);
        assert.deepEqual(normalized.staffIds, [2, 1]);
        assert.deepEqual(normalized.statuses, ['in_progress', 'completed']);
        assert.deepEqual(normalized.assignmentStatuses, ['active']);
        assert.equal(normalized.includeInactiveProfessions, true);
        assert.equal(normalized.includeInactiveStaff, false);
        assert.equal(normalized.search, 'Test Worker');
        assert.equal(normalized.searchPattern, '%Test Worker%');
        assert.equal(normalized.limit, 500);
        assert.equal(normalized.offset, 7);
        assert.throws(
            () => normalizeDashboardFilters({ status: 'unknown' }),
            error => error.code === 'PROFESSION_CHECKLIST_INVALID_DASHBOARD_STATUS'
        );
        assert.throws(
            () => normalizeDashboardFilters({ limit: '1.5' }),
            error => error.code === 'PROFESSION_CHECKLIST_INVALID_PAGINATION'
                && error.details?.field === 'limit'
        );

        const calls = [];
        const dashboardDb = {
            async query(sql) {
                const text = compactSql(sql);
                calls.push(text);
                if (text.includes('WITH item_counts AS')) {
                    return {
                        rows: [{
                            id: 10,
                            key: 'animator',
                            title: 'Animator',
                            department: 'Entertainment',
                            is_active: true,
                            active_items: 4,
                            archived_items: 1,
                            assigned_staff: 3,
                            orphaned_progress: 2
                        }]
                    };
                }
                if (text.includes('WITH classified AS')) {
                    return {
                        rows: [{
                            assignment_id: 70,
                            staff_id: 1,
                            staff_name: 'Test Worker',
                            staff_is_active: true,
                            assignment_status: 'active',
                            is_primary: true,
                            admission_status: 'approved',
                            internship_status: 'completed',
                            profession_id: 10,
                            profession_key: 'animator',
                            profession_title: 'Animator',
                            department: 'Entertainment',
                            total_items: 4,
                            completed_items: 1,
                            checklist_status: 'in_progress',
                            filtered_total: 3,
                            selected_total: 3,
                            without_template_total: 0,
                            not_started_total: 1,
                            in_progress_total: 1,
                            completed_total: 1
                        }]
                    };
                }
                if (text.includes("item.is_active = false")) {
                    return {
                        rows: [{
                            progress_id: 900,
                            staff_id: 1,
                            staff_name: 'Test Worker',
                            staff_is_active: true,
                            profession_key: 'animator',
                            profession_title: 'Animator',
                            department: 'Entertainment',
                            progress_checklist_item_id: 101,
                            progress_checklist_key: 'chk_archived',
                            progress_title: 'Archived item',
                            completed_at: '2026-07-01T09:00:00.000Z',
                            item_key: 'chk_archived',
                            item_title: 'Archived item',
                            filtered_total: 1
                        }]
                    };
                }
                if (text.includes('progress.checklist_item_id IS NULL')) {
                    return {
                        rows: [{
                            progress_id: 901,
                            staff_id: 1,
                            staff_name: 'Test Worker',
                            staff_is_active: true,
                            profession_key: 'animator',
                            profession_title: 'Animator',
                            department: 'Entertainment',
                            progress_checklist_item_id: null,
                            progress_checklist_key: 'item_7',
                            progress_title: 'Legacy item',
                            issue_reason: 'legacy_key_not_unambiguously_reconciled',
                            candidate_item_keys: [],
                            filtered_total: 1
                        }]
                    };
                }
                throw new Error(`Unexpected dashboard query: ${text}`);
            }
        };

        const dashboard = await loadProfessionChecklistDashboard(dashboardDb, {
            includeInactiveStaff: false,
            search: 'Test Worker'
        });
        assert.equal(calls.length, 7);
        assert.match(calls[0], /\(\$3::integer\[\] IS NULL AND \$6::text\[\] IS NULL\) OR COALESCE\(assignment_counts\.assigned_staff, 0\) > 0/);
        assert.match(calls[0], /EXISTS \( SELECT 1 FROM staff_role_assignments search_assignment JOIN staff search_member/);
        assert.match(calls[0], /search_member\.name ILIKE \$7/);
        assert.match(calls[2], /checklist_status = ANY\(\$8::text\[\]\).*AS selected_total/);
        assert.deepEqual(dashboard.summary, {
            without_template: 0,
            not_started: 1,
            in_progress: 1,
            completed: 1,
            archived: 1,
            orphaned: 1
        });
        assert.equal(dashboard.assignments[0].status, 'in_progress');
        assert.equal(dashboard.assignments[0].percent, 25);
        assert.equal(dashboard.archived[0].status, 'archived');
        assert.equal(dashboard.orphaned[0].status, 'orphaned');
        assert.equal(dashboard.filters.includeInactiveStaff, false);
        assert.equal(dashboard.filters.searchPattern, '%Test Worker%');
        assert.equal(dashboard.pagination.semantics, 'independent_feeds');
        assert.deepEqual(dashboard.pagination.assignments, {
            limit: 200,
            offset: 0,
            total: 3,
            returned: 1
        });
        assert.equal(dashboard.pagination.archived.total, 1);
        assert.equal(dashboard.pagination.orphaned.total, 1);
    });
});
