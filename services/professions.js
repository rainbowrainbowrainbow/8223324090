'use strict';

function parseJsonArray(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Array.isArray(value.items) ? value.items : fallback;
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : fallback;
        } catch {
            return fallback;
        }
    }
    return trimmed
        .split(/[\n,;]+/)
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeProfessionKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_:-]/g, '')
        .slice(0, 64);
}

function normalizeProfessionKeyArray(value, options = {}) {
    const exclude = new Set((options.exclude || []).map(normalizeProfessionKey).filter(Boolean));
    const seen = new Set();
    const result = [];
    for (const item of parseJsonArray(value, [])) {
        const key = normalizeProfessionKey(item);
        if (!key || exclude.has(key) || seen.has(key)) continue;
        seen.add(key);
        result.push(key);
    }
    return result;
}

function normalizeSecondaryProfessions(value, primaryKey = '') {
    return normalizeProfessionKeyArray(value, { exclude: [primaryKey] });
}

function parseTextList(value, limit = 24) {
    return parseJsonArray(value, [])
        .map(item => String(item || '').replace(/\u0000/g, '').trim())
        .filter(Boolean)
        .slice(0, limit);
}

function normalizeProfessionCatalogRow(row = {}) {
    return {
        id: row.id,
        key: normalizeProfessionKey(row.key),
        title: row.title || row.key || '',
        department: row.department || '',
        short_info: row.short_info || row.shortInfo || '',
        shortInfo: row.short_info || row.shortInfo || '',
        responsibilities: parseTextList(row.responsibilities, 16),
        checklist: parseTextList(row.checklist, 24),
        color: row.color || null,
        sort_order: Number(row.sort_order ?? row.sortOrder ?? 100),
        sortOrder: Number(row.sort_order ?? row.sortOrder ?? 100),
        is_active: row.is_active !== false,
        isActive: row.is_active !== false
    };
}

function validateProfessionKeys(keys, activeKeys) {
    const keySet = activeKeys instanceof Set ? activeKeys : new Set(activeKeys || []);
    return (keys || []).filter(key => !keySet.has(key));
}

module.exports = {
    parseJsonArray,
    parseTextList,
    normalizeProfessionKey,
    normalizeProfessionKeyArray,
    normalizeSecondaryProfessions,
    normalizeProfessionCatalogRow,
    validateProfessionKeys
};
