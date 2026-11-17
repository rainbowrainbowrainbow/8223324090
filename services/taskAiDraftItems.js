const DRAFT_ITEM_SOURCES = new Set(['manual', 'template', 'ai', 'system']);

function compactText(value, max) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Retain the draft wire format for signed previews from older clients.
function normalizeDraftItems(items, options = {}) {
    if (!Array.isArray(items)) return [];
    const sourceType = options.sourceType || 'ai';
    const maxItems = Math.max(2, Math.min(12, Number.parseInt(options.maxItems, 10) || 8));
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const raw = item && typeof item === 'object' ? item : { title: item };
        const title = compactText(String(raw.title || raw.name || '').trim().slice(0, 500), 160);
        const key = title.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, '').replace(/\s+/g, ' ').trim();
        if (key.length < 3 || seen.has(key)) continue;
        seen.add(key);
        const source = String(raw.source_type ?? raw.sourceType ?? sourceType).trim().toLowerCase();
        result.push({ title, is_done: false, sort_order: result.length, source_type: DRAFT_ITEM_SOURCES.has(source) ? source : sourceType });
        if (result.length >= maxItems) break;
    }
    return result;
}

module.exports = { normalizeDraftItems };
