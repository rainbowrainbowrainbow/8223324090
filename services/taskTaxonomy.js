/**
 * services/taskTaxonomy.js — shared Tasks taxonomy and operation pack templates.
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

const OPERATION_TASK_TEMPLATES = {
    hall_prep_base: {
        label: 'Підготовка залу',
        subcategory: 'hall_prep',
        owner_role: 'operations',
        sla_minutes: 60
    },
    kitchen_base: {
        label: 'Кухня',
        subcategory: 'kitchen',
        owner_role: 'kitchen',
        sla_minutes: 60
    },
    cake_base: {
        label: 'Торт',
        subcategory: 'cakes',
        owner_role: 'confectioner',
        sla_minutes: 30
    },
    cake_decor_base: {
        label: 'Прикраси',
        subcategory: 'cake_decor',
        owner_role: 'decorator',
        sla_minutes: 20
    },
    purchase_base: {
        label: 'Закупка',
        subcategory: 'purchase',
        owner_role: 'procurement',
        sla_minutes: 90
    }
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

function getOperationTaskTemplate(key) {
    return Object.hasOwn(OPERATION_TASK_TEMPLATES, key) ? OPERATION_TASK_TEMPLATES[key] : null;
}

module.exports = {
    TASK_CATEGORY_TREE,
    TOP_LEVEL_ORDER,
    VALID_TASK_CATEGORIES,
    VALID_TASK_SUBCATEGORIES,
    CATEGORY_SUBCATEGORIES,
    PACK_STATUSES,
    SOURCE_ENTITY_TYPES,
    OPERATION_TASK_TEMPLATES,
    ORDER_OPERATION_PRESETS,
    normalizeTaskCategory,
    normalizeTaskSubcategory,
    normalizePackStatus,
    normalizeSourceEntityType,
    normalizeSourceEntityId,
    normalizeUuid,
    normalizeOwnerRole,
    normalizeSlaMinutes,
    getOperationTaskTemplate
};
