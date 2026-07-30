const STAFF_DISPLAY_GROUPS = Object.freeze([
    { key: 'animators', label: '\u0410\u043d\u0456\u043c\u0430\u0442\u043e\u0440\u0438', order: 10 },
    { key: 'trampoline', label: '\u0411\u0430\u0442\u0443\u0442\u0438\u0441\u0442\u0438', order: 20 },
    { key: 'reception', label: '\u0420\u0435\u0446\u0435\u043f\u0446\u0456\u044f', order: 30 },
    { key: 'admin', label: 'Адміністрація', order: 40 },
    { key: 'cafe', label: 'Кафе', order: 50 },
    { key: 'tech', label: 'Технічний відділ', order: 60 },
    { key: 'cleaning', label: 'Прибирання / сервіс', order: 70 }
]);

const STAFF_DISPLAY_GROUP_BY_KEY = Object.freeze(Object.fromEntries(
    STAFF_DISPLAY_GROUPS.map(group => [group.key, group])
));

const STAFF_DISPLAY_GROUP_KEYS = new Set(STAFF_DISPLAY_GROUPS.map(group => group.key));
const STAFF_DISPLAY_RECEPTION_ROLE_KEYS = new Set(['reception', 'manager', 'senior_manager']);

const STAFF_SCHEDULE_CATEGORY_CONTRACT_VERSION = 1;
const STAFF_SCHEDULE_SUBGROUPS = Object.freeze({
    animators: Object.freeze([
        Object.freeze({ key: 'animators', label: '\u0410\u043d\u0456\u043c\u0430\u0442\u043e\u0440\u0438', icon: 'drama', professionKeys: Object.freeze(['animator', 'host']) })
    ]),
    trampoline: Object.freeze([
        Object.freeze({ key: 'trampoline', label: '\u0411\u0430\u0442\u0443\u0442\u0438\u0441\u0442\u0438', icon: 'activity', professionKeys: Object.freeze(['trampoline_instructor', 'senior_instructor', 'instructor', 'senior_trampoline']) })
    ]),
    reception: Object.freeze([
        Object.freeze({ key: 'reception', label: '\u0420\u0435\u0446\u0435\u043f\u0446\u0456\u044f', icon: 'bell', professionKeys: Object.freeze(['reception']) }),
        Object.freeze({ key: 'managers', label: '\u041c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\u0438', icon: 'briefcase', professionKeys: Object.freeze(['manager', 'senior_manager']) })
    ]),
    admin: Object.freeze([
        Object.freeze({ key: 'leadership', label: '\u041a\u0435\u0440\u0456\u0432\u043d\u0438\u043a\u0438', icon: 'crown', professionKeys: Object.freeze(['director', 'vice_director', 'deputy_director', 'art_director', 'top_manager']) }),
        Object.freeze({ key: 'administrators', label: '\u0410\u0434\u043c\u0456\u043d\u0456\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0438', icon: 'clipboard', professionKeys: Object.freeze(['admin', 'administrator']) }),
        Object.freeze({ key: 'accountants', label: '\u0411\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438', icon: 'coins', professionKeys: Object.freeze(['accountant']) }),
        Object.freeze({ key: 'hr', label: 'HR', icon: 'users', professionKeys: Object.freeze(['hr']) })
    ]),
    cafe: Object.freeze([
        Object.freeze({ key: 'kitchen', label: '\u041a\u0443\u0445\u043d\u044f', icon: 'chef', professionKeys: Object.freeze(['cook', 'head_cook', 'head_chef']) }),
        Object.freeze({ key: 'pizzaiolo', label: '\u041f\u0456\u0446\u0430\u0439\u043e\u043b\u043e', icon: 'pizza', professionKeys: Object.freeze(['pizzaiolo']) }),
        Object.freeze({ key: 'barista', label: '\u0411\u0430\u0440\u0438\u0441\u0442\u0430', icon: 'coffee', professionKeys: Object.freeze(['barista', 'bartender']) }),
        Object.freeze({ key: 'waiters', label: '\u041e\u0444\u0456\u0446\u0456\u0430\u043d\u0442\u0438', icon: 'utensils', professionKeys: Object.freeze(['waiter']) }),
        Object.freeze({ key: 'dishwash', label: '\u041c\u0438\u0439\u043a\u0430', icon: 'sparkles', professionKeys: Object.freeze(['dishwasher', 'dishwash']) }),
        Object.freeze({ key: 'pastry', label: '\u041a\u043e\u043d\u0434\u0438\u0442\u0435\u0440\u0441\u044c\u043a\u0438\u0439 \u0446\u0435\u0445', icon: 'chef', professionKeys: Object.freeze(['pastry_chef', 'confectioner', 'pastry_assistant', 'head_pastry', 'pastry_team', 'pastry_wash']) })
    ]),
    tech: Object.freeze([
        Object.freeze({ key: 'security', label: '\u041e\u0445\u043e\u0440\u043e\u043d\u0430', icon: 'shield', professionKeys: Object.freeze(['security']) }),
        Object.freeze({ key: 'technical_service', label: '\u0422\u0435\u0445\u043d\u0456\u0447\u043d\u0430 \u0441\u043b\u0443\u0436\u0431\u0430', icon: 'wrench', professionKeys: Object.freeze(['maintenance', 'technical_director', 'tech_director', 'technician', 'tech', 'it_specialist', 'facilities']) })
    ]),
    cleaning: Object.freeze([
        Object.freeze({ key: 'cleaners', label: '\u041f\u0440\u0438\u0431\u0438\u0440\u0430\u043b\u044c\u043d\u0438\u043a\u0438', icon: 'sparkles', professionKeys: Object.freeze(['cleaner', 'cleaning']) }),
        Object.freeze({ key: 'wardrobe', label: '\u0413\u0430\u0440\u0434\u0435\u0440\u043e\u0431', icon: 'briefcase', professionKeys: Object.freeze(['wardrobe']) })
    ])
});

const STAFF_PROFESSION_CATEGORY_RULES = Object.freeze(Object.fromEntries(
    Object.entries(STAFF_SCHEDULE_SUBGROUPS).flatMap(([displayGroup, subGroups]) => (
        subGroups.flatMap(subGroup => subGroup.professionKeys.map(professionKey => [
            professionKey,
            Object.freeze({
                professionKey,
                displayGroup,
                subgroupKey: subGroup.key,
                subgroupLabel: subGroup.label
            })
        ]))
    ))
));

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
    wardrobe: 'cleaning',
    cleaning: 'cleaning',
    facilities: 'tech'
});

const STAFF_COMPANY_STRUCTURE_SCHEMA_VERSION = 1;
const STAFF_COMPANY_STRUCTURE_NODE_LIMIT = 60;
const STAFF_COMPANY_STRUCTURE_ALLOWED_TONES = new Set(['gold', 'blue', 'purple', 'violet']);
const STAFF_COMPANY_STRUCTURE_ALLOWED_LANES = new Set(['root', 'deputy', 'leadership', 'operations', 'support']);

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

function sanitizeStaffCompanyStructureString(value, limit) {
    return String(value || '').replace(/\u0000/g, '').trim().slice(0, limit);
}

function normalizeStaffCompanyStructureNodeRef(value) {
    const raw = sanitizeStaffCompanyStructureString(value, 64);
    if (!raw) return null;
    return raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_{2,}/g, '_').slice(0, 64) || null;
}

function normalizeStaffCompanyStructureNodeId(value, fallback, usedIds) {
    const base = normalizeStaffCompanyStructureNodeRef(value) || normalizeStaffCompanyStructureNodeRef(fallback) || fallback;
    let id = base;
    const suffixBase = (base || fallback || 'node').slice(0, 58);
    let suffix = 2;
    while (usedIds.has(id)) {
        id = `${suffixBase}_${suffix}`.slice(0, 64);
        suffix += 1;
    }
    usedIds.add(id);
    return id;
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

function normalizeStaffCompanyStructureNodes(nodes) {
    if (!Array.isArray(nodes)) return [];
    const usedIds = new Set();
    const normalized = nodes.slice(0, STAFF_COMPANY_STRUCTURE_NODE_LIMIT).map((node, index) => {
        const source = node && typeof node === 'object' ? node : {};
        const id = normalizeStaffCompanyStructureNodeId(source.id, `node_${index + 1}`, usedIds);
        const tone = STAFF_COMPANY_STRUCTURE_ALLOWED_TONES.has(source.tone) ? source.tone : 'blue';
        const lane = STAFF_COMPANY_STRUCTURE_ALLOWED_LANES.has(source.lane) ? source.lane : 'leadership';
        const order = Number.isFinite(Number(source.order)) ? Number(source.order) : index;
        const x = Number.isFinite(Number(source.x)) ? Math.max(0, Math.min(5000, Number(source.x))) : null;
        const y = Number.isFinite(Number(source.y)) ? Math.max(0, Math.min(5000, Number(source.y))) : null;
        return {
            id,
            title: sanitizeStaffCompanyStructureString(source.title, 80) || 'Роль',
            description: sanitizeStaffCompanyStructureString(source.description, 1200),
            tone,
            lane,
            parentId: normalizeStaffCompanyStructureNodeRef(source.parentId),
            stack: sanitizeStaffCompanyStructureString(source.stack, 64) || null,
            order,
            x,
            y,
            meta: sanitizeStaffCompanyStructureString(source.meta, 80) || null,
            displayGroup: staffStructureDisplayGroupKey({ ...source, id }) || null,
            collapsed: source.collapsed === true,
            archived: source.archived === true
        };
    });
    const ids = new Set(normalized.map(node => node.id));
    const byId = new Map(normalized.map(node => [node.id, node]));
    return normalized.map(node => {
        let parentId = node.parentId && ids.has(node.parentId) && node.parentId !== node.id ? node.parentId : null;
        const visited = new Set([node.id]);
        let cursor = parentId;
        while (cursor) {
            if (visited.has(cursor)) {
                parentId = null;
                break;
            }
            visited.add(cursor);
            cursor = byId.get(cursor)?.parentId || null;
        }
        return {
            ...node,
            parentId
        };
    });
}

function normalizeStaffCompanyStructurePayload(value) {
    let source = value && typeof value === 'object' ? value : {};
    if (typeof value === 'string') {
        try {
            source = JSON.parse(value);
        } catch {
            source = { instructions: value };
        }
    }
    return {
        schemaVersion: STAFF_COMPANY_STRUCTURE_SCHEMA_VERSION,
        structure: sanitizeStaffCompanyStructureString(source.structure || source.structure_text, 20000),
        instructions: sanitizeStaffCompanyStructureString(source.instructions || source.instructions_text, 20000),
        nodes: normalizeStaffCompanyStructureNodes(source.nodes),
        updatedBy: source.updatedBy || null,
        updatedAt: source.updatedAt || null
    };
}

function normalizeStaffSecondaryProfessionKeys(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string'
            ? (() => {
                try {
                    const parsed = JSON.parse(value);
                    return Array.isArray(parsed) ? parsed : value.split(/[\n,;]+/);
                } catch {
                    return value.split(/[\n,;]+/);
                }
            })()
            : []);
    const seen = new Set();
    const keys = [];
    for (const item of source) {
        const key = normalizeStaffDisplayToken(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
    }
    return keys;
}

function staffDisplayGroupContextFromCompanyStructure(value = {}, options = {}) {
    const companyStructure = normalizeStaffCompanyStructurePayload(value);
    const structureNodeById = new Map(companyStructure.nodes.map(node => [node.id, node]));
    const professionStructureNodeByKey = new Map();
    const professions = Array.isArray(options.professions || options.professionRows)
        ? (options.professions || options.professionRows)
        : [];
    for (const profession of professions) {
        const key = normalizeStaffDisplayToken(profession?.key || profession?.profession_key || profession?.professionKey);
        const nodeId = normalizeStaffCompanyStructureNodeRef(
            profession?.structure_node_id
            || profession?.structureNodeId
            || profession?.company_structure_node_id
            || profession?.companyStructureNodeId
        );
        const node = nodeId ? structureNodeById.get(nodeId) : null;
        if (key && node) professionStructureNodeByKey.set(key, node);
    }
    return {
        companyStructure,
        structureNodeById,
        professionStructureNodeByKey
    };
}

async function loadStaffDisplayGroupContext(db) {
    if (!db || typeof db.query !== 'function') {
        return staffDisplayGroupContextFromCompanyStructure({});
    }
    const structureResult = await db.query("SELECT value FROM settings WHERE key = 'hr_company_structure'");
    let professionRows = [];
    try {
        const professionResult = await db.query(
            `SELECT key, structure_node_id
             FROM hr_professions
             WHERE structure_node_id IS NOT NULL
               AND COALESCE(is_active, true) = true`
        );
        professionRows = professionResult.rows || [];
    } catch (err) {
        if (err?.code !== '42P01' && !/does not exist/i.test(String(err?.message || ''))) throw err;
    }
    return staffDisplayGroupContextFromCompanyStructure(structureResult.rows?.[0]?.value || {}, {
        professions: professionRows
    });
}

function staffStructureNodeForDisplayGroup(staff = {}, context = {}) {
    const nodeId = normalizeStaffCompanyStructureNodeRef(staff.company_structure_node_id || staff.companyStructureNodeId);
    return nodeId ? context.structureNodeById?.get(nodeId) || null : null;
}

function staffProfessionStructureNodeForDisplayGroup(staff = {}, context = {}) {
    const keys = [
        normalizeStaffDisplayToken(staff.role_type || staff.roleType),
        ...normalizeStaffSecondaryProfessionKeys(staff.secondary_professions || staff.secondaryProfessions)
    ].filter(Boolean);
    for (const key of keys) {
        const node = context.professionStructureNodeByKey?.get(key);
        if (node) return node;
    }
    return null;
}

function staffProfessionCategoryRule(value) {
    const professionKey = normalizeStaffDisplayToken(value);
    return STAFF_PROFESSION_CATEGORY_RULES[professionKey] || null;
}

function staffCategoryProfessionKeys(staff = {}) {
    const primary = normalizeStaffDisplayToken(staff.role_type || staff.roleType);
    const secondary = normalizeStaffSecondaryProfessionKeys(staff.secondary_professions || staff.secondaryProfessions);
    const seen = new Set();
    return [primary, ...secondary].filter(key => key && !seen.has(key) && seen.add(key));
}

function resolveStaffDisplayGroup(staff = {}, options = {}) {
    const explicitStaffGroup = normalizeStaffDisplayGroupKey(staff.display_group || staff.displayGroup);
    if (explicitStaffGroup && options.preferExisting !== false) return explicitStaffGroup;

    const primaryProfessionRule = staffProfessionCategoryRule(staff.role_type || staff.roleType);
    if (primaryProfessionRule) return primaryProfessionRule.displayGroup;

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

function staffScheduleCategoryMemberships(staff = {}, options = {}) {
    const canonicalGroup = normalizeStaffDisplayGroupKey(options.canonicalGroup)
        || resolveStaffDisplayGroup(staff, options);
    const memberships = [];
    const seen = new Set();

    for (const professionKey of staffCategoryProfessionKeys(staff)) {
        const rule = staffProfessionCategoryRule(professionKey);
        if (!rule) continue;
        const identity = `${rule.displayGroup}:${professionKey}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        memberships.push({
            professionKey,
            displayGroup: rule.displayGroup,
            displayGroupLabel: staffDisplayGroupLabel(rule.displayGroup),
            subgroupKey: rule.subgroupKey,
            subgroupLabel: rule.subgroupLabel,
            source: professionKey === normalizeStaffDisplayToken(staff.role_type || staff.roleType)
                ? 'primary_profession'
                : 'secondary_profession'
        });
    }

    if (!memberships.some(item => item.displayGroup === canonicalGroup)) {
        memberships.unshift({
            professionKey: normalizeStaffDisplayToken(staff.role_type || staff.roleType),
            displayGroup: canonicalGroup,
            displayGroupLabel: staffDisplayGroupLabel(canonicalGroup),
            subgroupKey: '',
            subgroupLabel: '',
            source: 'canonical_fallback'
        });
    }

    return memberships;
}

function staffDisplayGroupLabel(key) {
    const normalized = normalizeStaffDisplayGroupKey(key);
    return STAFF_DISPLAY_GROUP_BY_KEY[normalized]?.label || normalized || '';
}

function listStaffDisplayGroups() {
    return STAFF_DISPLAY_GROUPS.map(group => ({ ...group }));
}

function listStaffScheduleCategoryContract() {
    const subGroups = Object.fromEntries(
        Object.entries(STAFF_SCHEDULE_SUBGROUPS).map(([displayGroup, groups]) => [
            displayGroup,
            groups.map(group => ({
                key: group.key,
                label: group.label,
                icon: group.icon,
                professionKeys: [...group.professionKeys]
            }))
        ])
    );
    const professionRules = Object.fromEntries(
        Object.entries(STAFF_PROFESSION_CATEGORY_RULES).map(([professionKey, rule]) => [
            professionKey,
            { ...rule }
        ])
    );
    return {
        version: STAFF_SCHEDULE_CATEGORY_CONTRACT_VERSION,
        groups: listStaffDisplayGroups(),
        subGroups,
        professionRules
    };
}

function decorateStaffWithDisplayGroup(staff = {}, options = {}) {
    const context = options.displayGroupContext || options.staffDisplayGroupContext || options.context || {};
    const resolutionOptions = {
        ...options,
        structureNode: options.structureNode || options.companyStructureNode || staffStructureNodeForDisplayGroup(staff, context),
        professionStructureNode: options.professionStructureNode || staffProfessionStructureNodeForDisplayGroup(staff, context)
    };
    const group = resolveStaffDisplayGroup(staff, resolutionOptions);
    const label = staffDisplayGroupLabel(group);
    const memberships = staffScheduleCategoryMemberships(staff, {
        ...resolutionOptions,
        canonicalGroup: group
    });
    const displayGroups = [...new Set([group, ...memberships.map(item => item.displayGroup)].filter(Boolean))];
    const canonicalMembership = memberships.find(item => item.displayGroup === group) || null;
    return {
        ...staff,
        display_group: group,
        display_group_label: label,
        display_groups: displayGroups,
        display_subgroup: canonicalMembership?.subgroupKey || '',
        display_subgroup_label: canonicalMembership?.subgroupLabel || '',
        schedule_category_memberships: memberships,
        displayGroup: group,
        displayGroupLabel: label,
        displayGroups,
        displaySubgroup: canonicalMembership?.subgroupKey || '',
        displaySubgroupLabel: canonicalMembership?.subgroupLabel || '',
        scheduleCategoryMemberships: memberships
    };
}

function decorateStaffRowsWithDisplayGroups(rows = [], options = {}) {
    return (Array.isArray(rows) ? rows : []).map(row => decorateStaffWithDisplayGroup(row, options));
}

function buildStaffDisplayGroupOptions(rows = [], options = {}) {
    const context = options.displayGroupContext || options.staffDisplayGroupContext || options.context || {};
    const counts = new Map();
    for (const row of (Array.isArray(rows) ? rows : [])) {
        const decorated = decorateStaffWithDisplayGroup(row, {
            ...options,
            displayGroupContext: context
        });
        for (const group of decorated.display_groups) {
            counts.set(group, (counts.get(group) || 0) + 1);
        }
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
    STAFF_PROFESSION_CATEGORY_RULES,
    STAFF_SCHEDULE_CATEGORY_CONTRACT_VERSION,
    STAFF_SCHEDULE_SUBGROUPS,
    STAFF_COMPANY_STRUCTURE_SCHEMA_VERSION,
    COMPANY_STRUCTURE_DISPLAY_GROUP_DEFAULTS,
    buildStaffDisplayGroupOptions,
    decorateStaffRowsWithDisplayGroups,
    decorateStaffWithDisplayGroup,
    listStaffDisplayGroups,
    listStaffScheduleCategoryContract,
    loadStaffDisplayGroupContext,
    normalizeStaffCompanyStructureNodeRef,
    normalizeStaffCompanyStructurePayload,
    normalizeStaffDisplayGroupKey,
    resolveStaffDisplayGroup,
    staffProfessionCategoryRule,
    staffScheduleCategoryMemberships,
    staffDisplayGroupContextFromCompanyStructure,
    staffDisplayGroupLabel,
    staffProfessionStructureNodeForDisplayGroup,
    staffStructureNodeForDisplayGroup,
    staffStructureDisplayGroupKey
};
