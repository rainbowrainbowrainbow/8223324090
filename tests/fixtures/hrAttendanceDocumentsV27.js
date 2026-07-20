'use strict';

const {
    PRINT_CATEGORY_DEFINITIONS,
    buildHrAttendanceDocumentSnapshotFromRows,
    normalizeDocumentRequest
} = require('../../services/hrAttendanceDocuments');

const REFERENCE_COUNTS = Object.freeze({
    art_director: 1,
    leader: 2,
    bartender: 1,
    wardrobe: 2,
    cleaning: 1,
    hall_hostess: 3,
    trampoline: 7,
    animator: 3,
    tech_director: 1,
    hr: 1,
    admin: 2,
    accountant: 2,
    sales_manager: 2,
    top_manager: 1,
    cook: 5,
    pastry_shop: 2,
    pizzaiolo: 1,
    waiter: 5,
    dishwasher: 1,
    security: 1
});

const FIXTURE_ROLE = Object.freeze({
    art_director: ['art_director', 'Арт-директор'],
    leader: ['director', 'Керівник'],
    bartender: ['bartender', 'Бармен'],
    wardrobe: ['wardrobe', 'Гардеробниця'],
    cleaning: ['cleaner', 'Прибирання'],
    hall_hostess: ['cleaning', 'Хозяюшка залу'],
    trampoline: ['trampoline_instructor', 'Батутист'],
    animator: ['animator', 'Аніматор'],
    tech_director: ['it_specialist', 'Технічний директор'],
    hr: ['hr', 'HR-менеджер'],
    admin: ['admin', 'Адміністратор'],
    accountant: ['accountant', 'Бухгалтер'],
    sales_manager: ['manager', 'Менеджер з продажу'],
    top_manager: ['senior_manager', 'Топ-менеджер'],
    cook: ['cook', 'Кухар'],
    pastry_shop: ['pastry_chef', 'Кондитерський цех'],
    pizzaiolo: ['pizzaiolo', 'Піцейола'],
    waiter: ['waiter', 'Офіціант'],
    dishwasher: ['dishwasher', 'Мийниця'],
    security: ['security', 'Охоронець']
});

function referenceRequest(templateId, overrides = {}) {
    return {
        templateId,
        documentDate: templateId === 'arrival_inout' ? '2026-07-16' : undefined,
        month: templateId === 'month_grid' ? '2026-07' : undefined,
        categoryIds: PRINT_CATEGORY_DEFINITIONS.map(item => item.id),
        dailyMode: 'manual_blank',
        rosterMode: 'all_eligible',
        ...overrides
    };
}

function anonymizedReferenceRows() {
    const rows = [];
    let id = 1000;
    for (const definition of PRINT_CATEGORY_DEFINITIONS) {
        const count = REFERENCE_COUNTS[definition.id];
        const [roleType, position] = FIXTURE_ROLE[definition.id];
        for (let index = 0; index < count; index += 1) {
            id += 1;
            const suffix = index % 3 === 0
                ? 'Короткий'
                : (index % 3 === 1 ? 'Середньодовгий' : 'Довгий-Анонімізований');
            rows.push({
                id,
                name: `Працівник ${String(id).slice(-3)} ${suffix}`,
                display_name: null,
                role_type: roleType,
                secondary_professions: [],
                position,
                excel_department: position,
                unique_person_key: `fixture-${id}`,
                user_id: null
            });
        }
    }
    return rows;
}

function referenceSnapshot(templateId, overrides = {}, rows = {}) {
    return buildHrAttendanceDocumentSnapshotFromRows(
        normalizeDocumentRequest(referenceRequest(templateId, overrides)),
        { staffRows: anonymizedReferenceRows(), assignmentRows: [], ...rows },
        { now: new Date('2026-07-16T12:00:00.000Z') }
    );
}

module.exports = {
    REFERENCE_COUNTS,
    anonymizedReferenceRows,
    referenceRequest,
    referenceSnapshot
};
