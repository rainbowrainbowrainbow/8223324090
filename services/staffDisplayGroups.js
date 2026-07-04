const STAFF_DISPLAY_GROUPS = Object.freeze([
    { key: 'animators', label: 'Аніматори', order: 10 },
    { key: 'trampoline', label: 'Батутисти', order: 20 },
    { key: 'reception', label: 'Рецепшен', order: 30 },
    { key: 'admin', label: 'Адміністрація', order: 40 },
    { key: 'cafe', label: 'Кафе', order: 50 },
    { key: 'tech', label: 'Технічний відділ', order: 60 },
    { key: 'cleaning', label: 'Прибирання', order: 70 }
]);

const STAFF_DISPLAY_GROUP_BY_KEY = Object.freeze(Object.fromEntries(
    STAFF_DISPLAY_GROUPS.map(group => [group.key, group])
));

const STAFF_DISPLAY_GROUP_KEYS = new Set(STAFF_DISPLAY_GROUPS.map(group => group.key));
const STAFF_DISPLAY_RECEPTION_ROLE_KEYS = new Set(['reception', 'manager', 'senior_manager']);

const COMPANY_STRUCTURE_DISPLAY_GROUP_DEFAULTS = Object.freeze({
    director: 'admin',
    deputy_director: 'admin',
    top_manager: 'admin',
    managers: 'reception',
    hr: 'admin',
    accountant: 'admin',
    art_director: 'admin',
    admins: 'admin',
    marketer: 'admin',
    it_specialist: 'tech',
    senior_trampoline: 'trampoline',
    trampoline_instructors: 'trampoline',
    animators: 'animators',
    waiters: 'cafe',
    barista: 'cafe',
    reception: 'reception',
    chef: 'cafe',
    cooks: 'cafe',
    dishwash: 'cafe',
    pastry_chef: 'cafe',
    pastry_team: 'cafe',
    pastry_wash: 'cafe',
    technical_staff: 'tech',
    wardrobe: 'tech',
    cleaning: 'cleaning',
    facilities: 'tech'
});

function normalizeStaffDisplayToken(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_:-]/g, '')
        .slice(0, 80);
}

function normalizeStaffDisplayGroupKey(value) {
    const key = normalizeStaffDisplayToken(value);
    return STAFF_DISPLAY_GROUP_KEYS.has(key) ? key : '';
}

function staffStructureDisplayGroupKey(node = {}) {
    if (!node || typeof node !== 'object') return '';
    const explicit = normalizeStaffDisplayGroupKey(
        node.display_group
        || node.displayGroup
        || node.staff_display_group
        || node.staffDisplayGroup
        || node.operational_group
        || node.operationalGroup
    );
    if (explicit) return explicit;
    const nodeId = normalizeStaffDisplayToken(node.id);
    return COMPANY_STRUCTURE_DISPLAY_GROUP_DEFAULTS[nodeId] || '';
}

function resolveStaffDisplayGroup(staff = {}, options = {}) {
    const explicitStaffGroup = normalizeStaffDisplayGroupKey(staff.display_group || staff.displayGroup);
    if (explicitStaffGroup && options.preferExisting !== false) return explicitStaffGroup;

    const structureGroup = staffStructureDisplayGroupKey(options.structureNode || options.companyStructureNode);
    if (structureGroup) return structureGroup;

    const professionStructureGroup = staffStructureDisplayGroupKey(options.professionStructureNode);
    if (professionStructureGroup) return professionStructureGroup;

    const roleKey = normalizeStaffDisplayToken(staff.role_type || staff.roleType);
    if (STAFF_DISPLAY_RECEPTION_ROLE_KEYS.has(roleKey)) return 'reception';

    const departmentKey = normalizeStaffDisplayToken(staff.department);
    if (departmentKey === 'security') return 'tech';
    if (STAFF_DISPLAY_GROUP_KEYS.has(departmentKey)) return departmentKey;
    return 'admin';
}

function staffDisplayGroupLabel(key) {
    const normalized = normalizeStaffDisplayGroupKey(key);
    return STAFF_DISPLAY_GROUP_BY_KEY[normalized]?.label || normalized || '';
}

function listStaffDisplayGroups() {
    return STAFF_DISPLAY_GROUPS.map(group => ({ ...group }));
}

function decorateStaffWithDisplayGroup(staff = {}, options = {}) {
    const group = resolveStaffDisplayGroup(staff, options);
    const label = staffDisplayGroupLabel(group);
    return {
        ...staff,
        display_group: group,
        display_group_label: label,
        displayGroup: group,
        displayGroupLabel: label
    };
}

function decorateStaffRowsWithDisplayGroups(rows = [], options = {}) {
    return (Array.isArray(rows) ? rows : []).map(row => decorateStaffWithDisplayGroup(row, options));
}

function buildStaffDisplayGroupOptions(rows = [], options = {}) {
    const counts = new Map();
    for (const row of (Array.isArray(rows) ? rows : [])) {
        const group = resolveStaffDisplayGroup(row, options);
        counts.set(group, (counts.get(group) || 0) + 1);
    }
    return listStaffDisplayGroups().map(group => ({
        ...group,
        count: counts.get(group.key) || 0
    }));
}

module.exports = {
    STAFF_DISPLAY_GROUPS,
    STAFF_DISPLAY_GROUP_KEYS,
    STAFF_DISPLAY_RECEPTION_ROLE_KEYS,
    COMPANY_STRUCTURE_DISPLAY_GROUP_DEFAULTS,
    buildStaffDisplayGroupOptions,
    decorateStaffRowsWithDisplayGroups,
    decorateStaffWithDisplayGroup,
    listStaffDisplayGroups,
    normalizeStaffDisplayGroupKey,
    resolveStaffDisplayGroup,
    staffDisplayGroupLabel,
    staffStructureDisplayGroupKey
};
