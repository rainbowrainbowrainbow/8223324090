/**
 * services/taskTaxonomy.js — shared Tasks taxonomy and checklist pack helpers.
 */

const TASK_CATEGORY_TREE = {
    event: { label: 'Івенти', color: '#E65100' },
    purchase: { label: 'Закупівлі', color: '#2E7D32' },
    orders: {
        label: 'Замовлення',
        color: '#DC2626',
        children: {
            kitchen: { label: 'Кухня', color: '#EA580C' },
            confectionery: { label: 'Кондитерка', color: '#C026D3' },
            cakes: { label: 'Торти', color: '#A21CAF', parent: 'confectionery' },
            cake_decor: { label: 'Прикраси', color: '#7C3AED', parent: 'confectionery' }
        }
    },
    admin: { label: 'Адмін', color: '#1565C0' },
    trampoline: { label: 'Батути', color: '#7B1FA2' },
    personal: { label: 'Особисті', color: '#455A64' },
    improvement: { label: 'Покращення', color: '#0891B2' },
    checklist: {
        label: 'Чек-листи',
        color: '#C026D3',
        children: {
            hall_prep: { label: 'Підготовка залу', color: '#7C3AED' },
            kitchen: { label: 'Кухня', color: '#EA580C' },
            cakes: { label: 'Торт', color: '#A21CAF' },
            cake_decor: { label: 'Прикраси', color: '#6D28D9' },
            purchase: { label: 'Закупка', color: '#2E7D32' }
        }
    },
    operational: { label: 'Операційні', color: '#16A34A' },
    maintenance: { label: 'Технічні', color: '#64748B' }
};

const TOP_LEVEL_ORDER = ['event', 'purchase', 'orders', 'admin', 'trampoline', 'personal', 'improvement', 'checklist'];
const LEGACY_TASK_CATEGORIES = ['operational', 'maintenance'];
const VALID_TASK_CATEGORIES = [...TOP_LEVEL_ORDER, ...LEGACY_TASK_CATEGORIES];

const CATEGORY_SUBCATEGORIES = {
    orders: ['kitchen', 'confectionery', 'cakes', 'cake_decor'],
    checklist: ['hall_prep', 'kitchen', 'cakes', 'cake_decor', 'purchase']
};

const VALID_TASK_SUBCATEGORIES = Array.from(new Set(Object.values(CATEGORY_SUBCATEGORIES).flat()));
const PACK_STATUSES = ['draft', 'confirmed', 'in_production', 'ready', 'issued', 'cancelled'];
const SOURCE_ENTITY_TYPES = ['booking', 'order', 'lead', 'customer'];

const CHECKLIST_TEMPLATE_PACKS = {
    hall_prep_base: {
        label: 'Підготовка залу',
        subcategory: 'hall_prep',
        title: 'Чек-лист підготовки залу',
        owner_role: 'operations',
        sla_minutes: 60,
        items: [
            { title: 'Перевірити чистоту залу', sort_order: 10 },
            { title: 'Підготувати столи та зони посадки', sort_order: 20 },
            { title: 'Перевірити реквізит і декор', sort_order: 30 },
            { title: 'Увімкнути музику та техніку', sort_order: 40 },
            { title: 'Підтвердити готовність до гостей', sort_order: 50 }
        ]
    },
    kitchen_base: {
        label: 'Кухня',
        subcategory: 'kitchen',
        title: 'Чек-лист видачі кухні',
        owner_role: 'kitchen',
        sla_minutes: 60,
        items: [
            { title: 'Підтвердити меню замовлення', sort_order: 10 },
            { title: 'Перевірити закупку продуктів', sort_order: 20 },
            { title: 'Передати кухні таймінг видачі', sort_order: 30 },
            { title: 'Підготувати сервірування', sort_order: 40 },
            { title: 'Підтвердити видачу кухні', sort_order: 50 }
        ]
    },
    cake_base: {
        label: 'Торт',
        subcategory: 'cakes',
        title: 'Чек-лист торта',
        owner_role: 'confectioner',
        sla_minutes: 30,
        items: [
            { title: 'Узгодити дизайн', sort_order: 10 },
            { title: 'Підтвердити начинку', sort_order: 20 },
            { title: 'Передати в кондитерку', sort_order: 30 },
            { title: 'Перевірити декор', sort_order: 40 },
            { title: 'Підготувати до видачі', sort_order: 50 }
        ]
    },
    cake_decor_base: {
        label: 'Прикраси',
        subcategory: 'cake_decor',
        title: 'Чек-лист прикрас на торт',
        owner_role: 'decorator',
        sla_minutes: 20,
        items: [
            { title: 'Погодити тему прикрас', sort_order: 10 },
            { title: 'Замовити топер і цифру', sort_order: 20 },
            { title: 'Перевірити колір і напис', sort_order: 30 },
            { title: 'Передати декор до торта', sort_order: 40 },
            { title: 'Підтвердити фінальний вигляд', sort_order: 50 }
        ]
    },
    purchase_base: {
        label: 'Закупка',
        subcategory: 'purchase',
        title: 'Чек-лист закупки',
        owner_role: 'procurement',
        sla_minutes: 90,
        items: [
            { title: 'Зібрати список позицій', sort_order: 10 },
            { title: 'Підтвердити бюджет', sort_order: 20 },
            { title: 'Оформити закупку', sort_order: 30 },
            { title: 'Перевірити доставку', sort_order: 40 },
            { title: 'Закрити закупку в задачах', sort_order: 50 }
        ]
    }
};

const CHECKLIST_TEMPLATE_BY_SUBCATEGORY = {
    hall_prep: 'hall_prep_base',
    kitchen: 'kitchen_base',
    cakes: 'cake_base',
    cake_decor: 'cake_decor_base',
    purchase: 'purchase_base'
};

const ORDER_OPERATION_PRESETS = {
    hall_prep_basic: {
        label: 'Підготовка залу',
        title: 'Підготовка залу',
        bundle: [{ templateKey: 'hall_prep_base' }]
    },
    kitchen_basic: {
        label: 'Кухня',
        title: 'Кухня',
        bundle: [{ templateKey: 'kitchen_base' }]
    },
    cake_basic: {
        label: 'Торт',
        title: 'Торт',
        bundle: [{ templateKey: 'cake_base' }]
    },
    cake_with_decor: {
        label: 'Торт + прикраси',
        title: 'Торт + прикраси',
        bundle: [
            { templateKey: 'cake_base' },
            { templateKey: 'cake_decor_base' }
        ],
        dependencies: [
            { taskTemplateKey: 'cake_decor_base', dependsOnTemplateKey: 'cake_base' }
        ]
    },
    purchase_basic: {
        label: 'Закупка',
        title: 'Закупка',
        bundle: [{ templateKey: 'purchase_base' }]
    }
};

function normalizeTaskCategory(category, fallback = 'admin') {
    const raw = String(category || '').trim();
    if (VALID_TASK_CATEGORIES.includes(raw)) return raw;
    return fallback;
}

function normalizeTaskSubcategory(category, subcategory) {
    const raw = String(subcategory || '').trim();
    const normalizedCategory = normalizeTaskCategory(category, 'admin');
    const allowed = CATEGORY_SUBCATEGORIES[normalizedCategory] || [];
    return allowed.includes(raw) ? raw : null;
}

function normalizePackStatus(status, fallback = null) {
    const raw = String(status || '').trim();
    if (PACK_STATUSES.includes(raw)) return raw;
    return fallback;
}

function normalizeChecklistTemplateKey(key, subcategory = null) {
    const raw = String(key || '').trim();
    if (CHECKLIST_TEMPLATE_PACKS[raw]) return raw;
    const bySubcategory = CHECKLIST_TEMPLATE_BY_SUBCATEGORY[String(subcategory || '').trim()];
    return bySubcategory || null;
}

function normalizeSourceEntityType(value) {
    const raw = String(value || '').trim();
    return SOURCE_ENTITY_TYPES.includes(raw) ? raw : null;
}

function normalizeSourceEntityId(value) {
    if (value === undefined || value === null || value === '') return null;
    return String(value).trim().slice(0, 120) || null;
}

function normalizeUuid(value) {
    const raw = String(value || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

function normalizeOwnerRole(value) {
    const raw = String(value || '').trim();
    return /^[a-z0-9_:-]{1,64}$/i.test(raw) ? raw : null;
}

function normalizeSlaMinutes(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 10080 ? parsed : null;
}

function getChecklistTemplate(key) {
    return CHECKLIST_TEMPLATE_PACKS[normalizeChecklistTemplateKey(key)] || null;
}

async function createChecklistSubtasks(dbPool, taskId, templateKey) {
    const template = getChecklistTemplate(templateKey);
    if (!template || !template.items.length) return [];
    const values = [];
    const placeholders = template.items.map((item, index) => {
        const offset = index * 4;
        values.push(taskId, item.title, item.sort_order);
        values.push('template');
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
    });
    const result = await dbPool.query(
        `INSERT INTO task_subtasks (task_id, title, sort_order, source_type)
         VALUES ${placeholders.join(', ')}
         RETURNING *`,
        values
    );
    return result.rows;
}

module.exports = {
    TASK_CATEGORY_TREE,
    TOP_LEVEL_ORDER,
    VALID_TASK_CATEGORIES,
    VALID_TASK_SUBCATEGORIES,
    CATEGORY_SUBCATEGORIES,
    PACK_STATUSES,
    SOURCE_ENTITY_TYPES,
    CHECKLIST_TEMPLATE_PACKS,
    ORDER_OPERATION_PRESETS,
    normalizeTaskCategory,
    normalizeTaskSubcategory,
    normalizePackStatus,
    normalizeChecklistTemplateKey,
    normalizeSourceEntityType,
    normalizeSourceEntityId,
    normalizeUuid,
    normalizeOwnerRole,
    normalizeSlaMinutes,
    getChecklistTemplate,
    createChecklistSubtasks
};
