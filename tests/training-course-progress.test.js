const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const MOCKED_MODULES = [
    '../db',
    '../middleware/auth',
    '../utils/logger',
    '../services/professionChecklists',
    '../services/hrOnboarding',
    '../routes/training'
];

function installMock(modulePath, exports) {
    const id = require.resolve(modulePath);
    require.cache[id] = { id, filename: id, loaded: true, exports };
}

function clearModules() {
    MOCKED_MODULES.forEach(modulePath => {
        try { delete require.cache[require.resolve(modulePath)]; } catch {}
    });
}

function compactSql(sql) {
    return String(sql || '').replace(/\s+/g, ' ').trim();
}

function normalizeProgress(row = {}) {
    const id = row.progress_id ?? row.id;
    if (id === null || id === undefined) return null;
    const completedAt = row.completed_at || null;
    return {
        id: Number(id),
        staffId: Number(row.staff_id),
        professionKey: row.profession_key,
        checklistItemId: Number(row.progress_checklist_item_id ?? row.checklist_item_id),
        checklistKey: row.progress_checklist_key ?? row.checklist_key,
        title: row.progress_title ?? row.title ?? '',
        completed: Boolean(completedAt),
        completedAt,
        completed_at: completedAt,
        completedBy: row.completed_by || null,
        completed_by: row.completed_by || null,
        notes: row.notes || null
    };
}

async function withTrainingApp(options, run) {
    clearModules();
    const calls = {
        poolQueries: [],
        clientQueries: [],
        toggle: [],
        validate: [],
        onboarding: [],
        released: 0
    };
    const poolQuery = async (sql, params = []) => {
        const query = compactSql(sql);
        calls.poolQueries.push({ sql: query, params });
        if (options.poolQuery) return options.poolQuery(query, params, calls);
        return { rows: [] };
    };
    const client = {
        query: async (sql, params = []) => {
            const query = compactSql(sql);
            calls.clientQueries.push({ sql: query, params });
            if (options.clientQuery) return options.clientQuery(query, params, calls);
            return { rows: [] };
        },
        release: () => { calls.released += 1; }
    };
    const pool = {
        query: poolQuery,
        connect: async () => client
    };
    installMock('../db', { pool });
    installMock('../middleware/auth', {
        authenticateToken: (req, _res, next) => {
            req.user = {
                id: Number(req.headers['x-test-user-id'] || 99),
                username: String(req.headers['x-test-username'] || 'hr-reviewer'),
                role: String(req.headers['x-test-role'] || 'hr')
            };
            next();
        },
        requireMinRole: () => (_req, _res, next) => next(),
        canUseAction: (_user, action) => action === 'training.manage' && options.canManageStaff !== false
    });
    installMock('../utils/logger', {
        createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {} })
    });
    installMock('../services/professionChecklists', {
        isProfessionChecklistError: error => error?.isProfessionChecklistError === true,
        normalizeChecklistProgressRow: normalizeProgress,
        validateStaffProfessionChecklistTarget: async (...args) => {
            calls.validate.push(args);
            if (options.validate) return options.validate(...args);
            return {
                staff: { id: 7, name: 'Linked Staff', isActive: true },
                profession: { id: 3, key: 'animator', isActive: true },
                item: { id: 501, itemKey: 'chk_stable', title: 'Stable item', isActive: true },
                assignment: { id: 4, status: 'active' }
            };
        },
        toggleStaffProfessionChecklistProgress: async (...args) => {
            calls.toggle.push(args);
            if (options.toggle) return options.toggle(...args);
            return {
                changed: true,
                after: {
                    id: 70,
                    staffId: 7,
                    professionKey: 'animator',
                    checklistItemId: 501,
                    checklistKey: 'chk_stable',
                    completed: true,
                    completedAt: '2026-07-16T10:00:00.000Z',
                    completedBy: 'hr-reviewer',
                    notes: null
                }
            };
        }
    });
    installMock('../services/hrOnboarding', {
        syncProfessionOnboardingProgress: async (...args) => {
            calls.onboarding.push(args);
            if (options.onboarding) return options.onboarding(...args);
            return { status: 'in_progress', completed_items: 1, total_items: 2 };
        }
    });

    const app = express();
    app.use(express.json());
    app.use('/api/training', require('../routes/training'));
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const request = async (method, path, body, headers = {}) => {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: { 'content-type': 'application/json', ...headers },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await response.text();
        return { status: response.status, data: text ? JSON.parse(text) : null };
    };

    try {
        await run({ request, calls, client });
    } finally {
        await new Promise(resolve => server.close(resolve));
        clearModules();
    }
}

test('course list uses canonical published item progress for profession seeds and legacy enrollment for manual courses', async () => {
    await withTrainingApp({
        poolQuery: async (sql, params) => {
            if (sql.includes('FROM employee_profiles profile')) {
                assert.deepEqual(params, [99]);
                return { rows: [{ staff_id: 7, name: 'Linked Staff', is_active: true }] };
            }
            if (sql.includes('FROM training_courses course') && sql.includes('instructor.name')) {
                assert.deepEqual(params, [7, 'hr_profession_seed']);
                return { rows: [
                    { id: 10, source: 'hr_profession_seed', profession_key: 'animator', title: 'Seed', current_lecture: null },
                    { id: 20, source: 'manual', title: 'Manual', current_lecture: 1, completed_at: null }
                ] };
            }
            if (sql.includes('SELECT course.id AS course_id')) {
                assert.match(sql, /lecture\.is_published = true/);
                assert.match(sql, /item\.is_active = true/);
                assert.match(sql, /progress\.checklist_item_id = item\.id/);
                assert.deepEqual(params, [7, 'hr_profession_seed']);
                return { rows: [
                    { course_id: 10, published_total: 4, canonical_total: 2, canonical_completed: 1 },
                    { course_id: 20, published_total: 2, canonical_total: 0, canonical_completed: 0 }
                ] };
            }
            throw new Error(`Unexpected pool query: ${sql}`);
        }
    }, async ({ request }) => {
        const response = await request('GET', '/api/training/courses');
        assert.equal(response.status, 200, JSON.stringify(response.data));
        const seed = response.data.courses.find(course => course.id === 10);
        const manual = response.data.courses.find(course => course.id === 20);
        assert.equal(seed.progress_mode, 'canonical_checklist');
        assert.equal(seed.current_lecture, null);
        assert.equal(seed.total_lectures, 2);
        assert.equal(seed.completed_lectures, 1);
        assert.equal(seed.canonical_staff_id, 7);
        assert.equal(manual.progress_mode, 'legacy_enrollment');
        assert.equal(manual.total_lectures, 2);
        assert.equal(manual.current_lecture, 1);
    });
});

test('course detail excludes unpublished and archived seed lectures and never exposes seed enrollment', async () => {
    await withTrainingApp({
        poolQuery: async (sql, params) => {
            if (sql === 'SELECT * FROM training_courses WHERE id = $1') {
                return { rows: [{ id: 10, source: 'hr_profession_seed', profession_key: 'animator', is_active: true }] };
            }
            if (sql.includes('FROM employee_profiles profile')) {
                return { rows: [{ staff_id: 7, name: 'Linked Staff', is_active: true }] };
            }
            if (sql.includes('FROM training_course_lectures lecture') && sql.includes('progress.completed_at')) {
                assert.match(sql, /item\.is_active = true/);
                assert.match(sql, /lecture\.is_published = true/);
                assert.match(sql, /progress\.checklist_item_id = item\.id/);
                assert.deepEqual(params, ['10', 'animator', 7]);
                return { rows: [{
                    id: 101,
                    course_id: 10,
                    sort_order: 20,
                    checklist_item_id: 501,
                    checklist_key: 'chk_stable',
                    completed_at: '2026-07-16T10:00:00.000Z'
                }] };
            }
            throw new Error(`Unexpected pool query: ${sql}`);
        }
    }, async ({ request }) => {
        const response = await request('GET', '/api/training/courses/10');
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.equal(response.data.enrollment, null);
        assert.equal(response.data.course.progress_mode, 'canonical_checklist');
        assert.equal(response.data.course.total_lectures, 1);
        assert.equal(response.data.course.completed_lectures, 1);
        assert.equal(response.data.lectures[0].checklist_item_id, 501);
    });
});

test('seed completion keeps stable checklist identity after reorder and synchronizes onboarding in the same transaction', async () => {
    await withTrainingApp({
        clientQuery: async (sql, params) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.includes('FROM training_courses') && sql.includes('profession_key')) {
                return { rows: [{ id: 10, source: 'hr_profession_seed', profession_key: 'animator', is_active: true }] };
            }
            if (sql.includes('SELECT lecture.id, lecture.checklist_item_id')) {
                assert.match(sql, /lecture\.is_published = true/);
                assert.match(sql, /item\.is_active = true/);
                assert.doesNotMatch(sql, /sort_order/);
                return { rows: [{
                    id: 101,
                    checklist_item_id: 501,
                    item_key: 'chk_stable',
                    title: 'Stable item',
                    sort_order: 20,
                    profession_key: 'animator'
                }] };
            }
            if (sql.includes('FROM employee_profiles profile')) {
                return { rows: [{ staff_id: 7, name: 'Linked Staff', is_active: true }] };
            }
            if (sql.includes('FROM hr_staff_profession_checklist_progress') && sql.includes('FOR UPDATE')) {
                return { rows: [] };
            }
            if (sql.includes('SELECT COUNT(item.id)::integer AS total_items')) {
                return { rows: [{ total_items: 2, completed_items: 1 }] };
            }
            if (sql.includes('INSERT INTO hr_audit_log')) return { rows: [] };
            throw new Error(`Unexpected client query: ${sql}`);
        }
    }, async ({ request, calls, client }) => {
        const response = await request('POST', '/api/training/courses/10/lectures/101/complete');
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.equal(response.data.progressMode, 'canonical_checklist');
        assert.equal(response.data.checklistItemId, 501);
        assert.equal(response.data.courseCompleted, false);
        assert.equal(calls.validate.length, 1);
        assert.equal(calls.validate[0][0], client);
        assert.deepEqual(calls.validate[0][1], {
            staffId: 7,
            professionKey: 'animator',
            itemKey: 'chk_stable'
        });
        assert.equal(calls.toggle.length, 1);
        assert.equal(calls.toggle[0][0], client);
        assert.equal(calls.toggle[0][1].staffId, 7);
        assert.equal(calls.toggle[0][1].itemKey, 'chk_stable');
        assert.equal(calls.onboarding.length, 1);
        assert.equal(calls.onboarding[0][3].db, client);
        assert.equal(calls.clientQueries.some(call => call.sql.includes('training_course_enrollment')), false);
        assert.equal(calls.clientQueries.at(-1).sql, 'COMMIT');
    });
});

test('seed completion rolls back canonical progress when onboarding synchronization fails', async () => {
    await withTrainingApp({
        onboarding: async () => { throw new Error('forced onboarding sync failure'); },
        clientQuery: async sql => {
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.includes('FROM training_courses') && sql.includes('profession_key')) {
                return { rows: [{ id: 10, source: 'hr_profession_seed', profession_key: 'animator', is_active: true }] };
            }
            if (sql.includes('FROM employee_profiles profile')) {
                return { rows: [{ staff_id: 7, name: 'Linked Staff', is_active: true }] };
            }
            if (sql.includes('SELECT lecture.id, lecture.checklist_item_id')) {
                return { rows: [{ id: 101, checklist_item_id: 501, item_key: 'chk_stable', title: 'Stable item' }] };
            }
            if (sql.includes('FROM hr_staff_profession_checklist_progress') && sql.includes('FOR UPDATE')) {
                return { rows: [] };
            }
            throw new Error(`Unexpected client query: ${sql}`);
        }
    }, async ({ request, calls }) => {
        const response = await request('POST', '/api/training/courses/10/lectures/101/complete');
        assert.equal(response.status, 500, JSON.stringify(response.data));
        assert.equal(calls.toggle.length, 1);
        assert.equal(calls.onboarding.length, 1);
        assert.equal(calls.clientQueries.some(call => call.sql === 'COMMIT'), false);
        assert.equal(calls.clientQueries.at(-1).sql, 'ROLLBACK');
    });
});

test('repeated seed completion preserves original completion actor and notes', async () => {
    await withTrainingApp({
        clientQuery: async sql => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.includes('FROM training_courses') && sql.includes('profession_key')) {
                return { rows: [{ id: 10, source: 'hr_profession_seed', profession_key: 'animator', is_active: true }] };
            }
            if (sql.includes('SELECT lecture.id, lecture.checklist_item_id')) {
                return { rows: [{ id: 101, checklist_item_id: 501, item_key: 'chk_stable', title: 'Stable item' }] };
            }
            if (sql.includes('FROM employee_profiles profile')) {
                return { rows: [{ staff_id: 7, name: 'Linked Staff', is_active: true }] };
            }
            if (sql.includes('FROM hr_staff_profession_checklist_progress') && sql.includes('FOR UPDATE')) {
                return { rows: [{
                    progress_id: 70,
                    staff_id: 7,
                    profession_key: 'animator',
                    progress_checklist_item_id: 501,
                    progress_checklist_key: 'chk_stable',
                    progress_title: 'Stable item',
                    completed_at: '2026-07-15T09:00:00.000Z',
                    completed_by: 'original-hr',
                    notes: 'Keep this HR note'
                }] };
            }
            if (sql.includes('SELECT COUNT(item.id)::integer AS total_items')) {
                return { rows: [{ total_items: 1, completed_items: 1 }] };
            }
            throw new Error(`Unexpected client query: ${sql}`);
        }
    }, async ({ request, calls }) => {
        const response = await request('POST', '/api/training/courses/10/lectures/101/complete');
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.equal(calls.toggle.length, 0);
        assert.equal(response.data.progress.completedBy, 'original-hr');
        assert.equal(response.data.progress.notes, 'Keep this HR note');
        assert.equal(response.data.courseCompleted, true);
        assert.equal(calls.onboarding.length, 1);
    });
});

test('seed completion is read-only without training.manage capability', async () => {
    await withTrainingApp({
        canManageStaff: false,
        clientQuery: async sql => {
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.includes('FROM training_courses')) {
                return { rows: [{ id: 10, source: 'hr_profession_seed', profession_key: 'animator', is_active: true }] };
            }
            throw new Error(`Unexpected client query: ${sql}`);
        }
    }, async ({ request, calls }) => {
        const response = await request('POST', '/api/training/courses/10/lectures/101/complete');
        assert.equal(response.status, 403, JSON.stringify(response.data));
        assert.equal(response.data.code, 'PROFESSION_CHECKLIST_READ_ONLY');
        assert.equal(calls.toggle.length, 0);
        assert.equal(calls.onboarding.length, 0);
        assert.equal(calls.clientQueries.at(-1).sql, 'ROLLBACK');
    });
});

test('manual enrollment maps CRM user 99 to linked staff 7 without user-id fallback', async () => {
    await withTrainingApp({
        poolQuery: async (sql, params) => {
            if (sql === 'SELECT id, source, is_active FROM training_courses WHERE id = $1') {
                return { rows: [{ id: 20, source: 'manual', is_active: true }] };
            }
            if (sql.includes('FROM employee_profiles profile')) {
                assert.deepEqual(params, [99]);
                return { rows: [{ staff_id: 7, name: 'Linked Staff', is_active: true }] };
            }
            if (sql.startsWith('INSERT INTO training_course_enrollment')) {
                assert.deepEqual(params, ['20', 7]);
                return { rows: [{ id: 80, course_id: 20, staff_id: 7 }] };
            }
            throw new Error(`Unexpected pool query: ${sql}`);
        }
    }, async ({ request }) => {
        const response = await request('POST', '/api/training/courses/20/enroll');
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.equal(response.data.enrolled, true);
        assert.equal(response.data.staffId, 7);
    });
});

test('manual enrollment rejects a missing staff link without creating enrollment', async () => {
    await withTrainingApp({
        poolQuery: async sql => {
            if (sql === 'SELECT id, source, is_active FROM training_courses WHERE id = $1') {
                return { rows: [{ id: 20, source: 'manual', is_active: true }] };
            }
            if (sql.includes('FROM employee_profiles profile')) return { rows: [] };
            throw new Error(`Unexpected pool query: ${sql}`);
        }
    }, async ({ request, calls }) => {
        const response = await request('POST', '/api/training/courses/20/enroll');
        assert.equal(response.status, 409, JSON.stringify(response.data));
        assert.equal(response.data.code, 'TRAINING_STAFF_LINK_REQUIRED');
        assert.equal(calls.poolQueries.some(call => call.sql.startsWith('INSERT INTO training_course_enrollment')), false);
    });
});

test('manual enrollment rejects a linked but inactive staff profile', async () => {
    await withTrainingApp({
        poolQuery: async sql => {
            if (sql === 'SELECT id, source, is_active FROM training_courses WHERE id = $1') {
                return { rows: [{ id: 20, source: 'manual', is_active: true }] };
            }
            if (sql.includes('FROM employee_profiles profile')) {
                return { rows: [{ staff_id: 7, name: 'Archived Staff', is_active: false }] };
            }
            throw new Error(`Unexpected pool query: ${sql}`);
        }
    }, async ({ request, calls }) => {
        const response = await request('POST', '/api/training/courses/20/enroll');
        assert.equal(response.status, 409, JSON.stringify(response.data));
        assert.equal(response.data.code, 'TRAINING_STAFF_INACTIVE');
        assert.equal(calls.poolQueries.some(call => call.sql.startsWith('INSERT INTO training_course_enrollment')), false);
    });
});

test('manual completion rejects an ambiguous staff link and rolls back', async () => {
    await withTrainingApp({
        clientQuery: async sql => {
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.includes('FROM training_courses')) {
                return { rows: [{ id: 20, source: 'manual', is_active: true }] };
            }
            if (sql.includes('FROM employee_profiles profile')) {
                return { rows: [
                    { staff_id: 7, name: 'First', is_active: true },
                    { staff_id: 8, name: 'Second', is_active: true }
                ] };
            }
            throw new Error(`Unexpected client query: ${sql}`);
        }
    }, async ({ request, calls }) => {
        const response = await request('POST', '/api/training/courses/20/lectures/202/complete');
        assert.equal(response.status, 409, JSON.stringify(response.data));
        assert.equal(response.data.code, 'TRAINING_STAFF_LINK_AMBIGUOUS');
        assert.equal(calls.clientQueries.some(call => call.sql.startsWith('WITH published AS')), false);
        assert.equal(calls.clientQueries.at(-1).sql, 'ROLLBACK');
    });
});

test('completion rejects a linked but inactive staff profile', async () => {
    await withTrainingApp({
        clientQuery: async sql => {
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.includes('FROM training_courses')) {
                return { rows: [{ id: 20, source: 'manual', is_active: true }] };
            }
            if (sql.includes('FROM employee_profiles profile')) {
                return { rows: [{ staff_id: 7, name: 'Archived Staff', is_active: false }] };
            }
            throw new Error(`Unexpected client query: ${sql}`);
        }
    }, async ({ request, calls }) => {
        const response = await request('POST', '/api/training/courses/20/lectures/202/complete');
        assert.equal(response.status, 409, JSON.stringify(response.data));
        assert.equal(response.data.code, 'TRAINING_STAFF_INACTIVE');
        assert.equal(calls.clientQueries.at(-1).sql, 'ROLLBACK');
    });
});

test('manual completion derives a contiguous ordinal from published lecture IDs and upserts enrollment', async () => {
    await withTrainingApp({
        clientQuery: async (sql, params) => {
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.includes('FROM training_courses')) {
                return { rows: [{ id: 20, source: 'manual', profession_key: null, is_active: true }] };
            }
            if (sql.includes('FROM employee_profiles profile')) {
                return { rows: [{ staff_id: 7, name: 'Linked Staff', is_active: true }] };
            }
            if (sql.startsWith('WITH published AS')) {
                assert.match(sql, /ROW_NUMBER\(\) OVER \(ORDER BY lecture\.sort_order, lecture\.id\)::integer AS ordinal/);
                assert.match(sql, /lecture\.is_published = true/);
                assert.match(sql, /ON CONFLICT \(course_id, staff_id\) DO UPDATE/);
                assert.deepEqual(params, ['20', '202', 7]);
                return { rows: [{
                    current_lecture: 1,
                    completed_at: null,
                    ordinal: 1,
                    total: 2
                }] };
            }
            throw new Error(`Unexpected client query: ${sql}`);
        }
    }, async ({ request, calls }) => {
        const response = await request('POST', '/api/training/courses/20/lectures/202/complete');
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.equal(response.data.progressMode, 'legacy_enrollment');
        assert.equal(response.data.currentLecture, 1);
        assert.equal(response.data.completedLectureOrdinal, 1);
        assert.equal(response.data.totalLectures, 2);
        assert.equal(response.data.courseCompleted, false);
        assert.equal(calls.toggle.length, 0);
        assert.equal(calls.clientQueries.at(-1).sql, 'COMMIT');
    });
});

test('unpublished manual lecture cannot be completed and transaction is rolled back', async () => {
    await withTrainingApp({
        clientQuery: async sql => {
            if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.includes('FROM training_courses')) {
                return { rows: [{ id: 20, source: 'manual', is_active: true }] };
            }
            if (sql.includes('FROM employee_profiles profile')) {
                return { rows: [{ staff_id: 7, name: 'Linked Staff', is_active: true }] };
            }
            if (sql.startsWith('WITH published AS')) return { rows: [] };
            throw new Error(`Unexpected client query: ${sql}`);
        }
    }, async ({ request, calls }) => {
        const response = await request('POST', '/api/training/courses/20/lectures/999/complete');
        assert.equal(response.status, 404, JSON.stringify(response.data));
        assert.equal(response.data.code, 'TRAINING_LECTURE_NOT_PUBLISHED');
        assert.equal(calls.clientQueries.at(-1).sql, 'ROLLBACK');
    });
});
