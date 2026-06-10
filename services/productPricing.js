const { DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(value) {
    if (!DATE_ONLY_RE.test(String(value || ''))) return false;
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function normalizePriceDate(value) {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }
    const raw = String(value).trim();
    if (!raw) return null;
    if (DATE_ONLY_RE.test(raw)) return isValidDateOnly(raw) ? raw : null;
    const isoPrefix = raw.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (isoPrefix) return isValidDateOnly(isoPrefix[1]) ? isoPrefix[1] : null;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    return null;
}

function toMoney(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.round(n * 100) / 100;
}

function dateOnly(value) {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    const raw = String(value).trim();
    if (!raw) return null;
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

function buildProductPriceJoin(priceDatePlaceholder = null) {
    const queryDate = priceDatePlaceholder ? `${priceDatePlaceholder}::date` : null;
    const currentRuleWhere = queryDate
        ? `pr.product_id = p.id
           AND (pr.effective_from IS NULL OR pr.effective_from <= ${queryDate})`
        : 'pr.product_id = p.id';
    const currentRuleOrder = queryDate
        ? 'pr.effective_from DESC NULLS LAST, pr.updated_at DESC NULLS LAST, pr.id DESC'
        : 'pr.updated_at DESC NULLS LAST, pr.id DESC';
    const nextRuleJoin = queryDate
        ? `LEFT JOIN LATERAL (
        SELECT code, name, value, unit, category, effective_from, updated_at, updated_by
        FROM price_rules pr
        WHERE pr.product_id = p.id
          AND pr.effective_from IS NOT NULL
          AND pr.effective_from > ${queryDate}
        ORDER BY pr.effective_from ASC, pr.updated_at DESC NULLS LAST, pr.id DESC
        LIMIT 1
    ) next_pr ON true`
        : `LEFT JOIN LATERAL (
        SELECT code, name, value, unit, category, effective_from, updated_at, updated_by
        FROM price_rules pr
        WHERE false
        LIMIT 1
    ) next_pr ON true`;

    return `
    SELECT p.*,
           ${queryDate ? `${queryDate}` : 'NULL::date'} AS price_query_date,
           pr.code AS price_rule_code,
           pr.name AS price_rule_name,
           pr.value AS price_rule_value,
           pr.unit AS price_rule_unit,
           pr.category AS price_rule_category,
           pr.effective_from AS price_rule_effective_from,
           pr.updated_at AS price_rule_updated_at,
           pr.updated_by AS price_rule_updated_by,
           next_pr.code AS next_price_rule_code,
           next_pr.name AS next_price_rule_name,
           next_pr.value AS next_price_rule_value,
           next_pr.unit AS next_price_rule_unit,
           next_pr.category AS next_price_rule_category,
           next_pr.effective_from AS next_price_rule_effective_from,
           next_pr.updated_at AS next_price_rule_updated_at,
           next_pr.updated_by AS next_price_rule_updated_by,
           COALESCE(psr_stats.tech_card_ingredient_count, 0) AS tech_card_ingredient_count,
           COALESCE(psr_stats.tech_card_linked_ingredient_count, 0) AS tech_card_linked_ingredient_count
    FROM products p
    LEFT JOIN LATERAL (
        SELECT code, name, value, unit, category, effective_from, updated_at, updated_by
        FROM price_rules pr
        WHERE ${currentRuleWhere}
        ORDER BY ${currentRuleOrder}
        LIMIT 1
    ) pr ON true
    ${nextRuleJoin}
    LEFT JOIN LATERAL (
        SELECT
            COUNT(*)::int AS tech_card_ingredient_count,
            COUNT(*) FILTER (WHERE psr.stock_id IS NOT NULL)::int AS tech_card_linked_ingredient_count
        FROM product_stock_requirements psr
        WHERE psr.product_id = p.id
    ) psr_stats ON true
`;
}

function mapProductPriceFields(row = {}, options = {}) {
    const hasCenterPrice = row.price_rule_code && row.price_rule_value !== null && row.price_rule_value !== undefined;
    const legacyPrice = row.price === null || row.price === undefined ? null : Number(row.price);
    const centerPrice = hasCenterPrice ? Number(row.price_rule_value) : null;
    const priceDate = normalizePriceDate(options.priceDate || row.price_query_date);
    const nextPrice = row.next_price_rule_value === null || row.next_price_rule_value === undefined
        ? null
        : Number(row.next_price_rule_value);
    return {
        price: hasCenterPrice ? centerPrice : legacyPrice,
        legacyPrice,
        priceSource: hasCenterPrice ? 'price_rules' : 'products',
        priceCode: row.price_rule_code || null,
        priceName: row.price_rule_name || null,
        priceUnit: row.price_rule_unit || null,
        priceCategory: row.price_rule_category || null,
        priceRuleEffectiveFrom: dateOnly(row.price_rule_effective_from),
        effectivePriceDate: priceDate,
        priceUpdatedAt: row.price_rule_updated_at || row.updated_at,
        priceUpdatedBy: row.price_rule_updated_by || row.updated_by,
        nextPrice,
        nextPriceCode: row.next_price_rule_code || null,
        nextPriceName: row.next_price_rule_name || null,
        nextPriceUnit: row.next_price_rule_unit || null,
        nextPriceCategory: row.next_price_rule_category || null,
        nextPriceFrom: dateOnly(row.next_price_rule_effective_from),
        nextPriceUpdatedAt: row.next_price_rule_updated_at || null,
        nextPriceUpdatedBy: row.next_price_rule_updated_by || null
    };
}

async function resolveProductEffectivePrice(queryable, productId, options = {}) {
    const safeProductId = productId === undefined || productId === null ? '' : String(productId).trim();
    const priceDate = normalizePriceDate(options.priceDate);
    const businessContext = options.businessContext || DEFAULT_BUSINESS_CONTEXT;
    if (!safeProductId || !priceDate || !queryable || typeof queryable.query !== 'function') return null;

    const result = await queryable.query(
        `${buildProductPriceJoin('$2')}
         WHERE p.id = $1 AND COALESCE(p.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $3
         LIMIT 1`,
        [safeProductId, priceDate, businessContext]
    );
    const row = result.rows[0];
    if (!row) return null;
    const priceFields = mapProductPriceFields(row, { priceDate });
    return {
        productId: row.id,
        businessContext: row.business_context || DEFAULT_BUSINESS_CONTEXT,
        isPerChild: row.is_per_child === true,
        priceDate,
        ...priceFields
    };
}

function ensureExtraDataObject(booking) {
    if (!booking) return {};
    if (booking.extraData && typeof booking.extraData === 'object' && !Array.isArray(booking.extraData)) return booking.extraData;
    if (booking.extra_data && typeof booking.extra_data === 'object' && !Array.isArray(booking.extra_data)) {
        booking.extraData = booking.extra_data;
        return booking.extraData;
    }
    const raw = typeof booking.extraData === 'string' ? booking.extraData : booking.extra_data;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                booking.extraData = parsed;
                return booking.extraData;
            }
        } catch {}
    }
    booking.extraData = {};
    return booking.extraData;
}

function shouldSkipEffectivePrice(booking = {}) {
    if (!booking.programId && !booking.program_id) return true;
    const pinataMode = String(booking.pinataMode || booking.pinata_mode || '').trim().toLowerCase();
    const category = String(booking.category || '').trim().toLowerCase();
    if (pinataMode === 'client') return true;
    if (pinataMode === 'none' && category === 'pinata') return true;
    return false;
}

async function applyEffectiveBookingPrice(queryable, booking, options = {}) {
    if (!booking || shouldSkipEffectivePrice(booking)) return null;
    const programId = booking.programId || booking.program_id;
    const priceDate = normalizePriceDate(booking.date || options.priceDate);
    const resolved = await resolveProductEffectivePrice(queryable, programId, {
        priceDate,
        businessContext: options.businessContext || booking.businessContext || booking.business_context || DEFAULT_BUSINESS_CONTEXT
    });
    if (!resolved || resolved.price === null || resolved.price === undefined) return null;

    const kidsCount = Number(booking.kidsCount ?? booking.kids_count ?? 0);
    const unitPrice = toMoney(resolved.price);
    const programBasePrice = resolved.isPerChild && kidsCount > 0
        ? toMoney(unitPrice * kidsCount)
        : unitPrice;
    const extra = ensureExtraDataObject(booking);
    const bookingPackage = extra.bookingPackage && typeof extra.bookingPackage === 'object'
        ? extra.bookingPackage
        : null;
    const positionsSubtotal = bookingPackage ? toMoney(bookingPackage.positionsSubtotal) : 0;
    const finalPrice = toMoney(programBasePrice + positionsSubtotal);

    if (bookingPackage) {
        bookingPackage.programBasePrice = programBasePrice;
        bookingPackage.positionsSubtotal = positionsSubtotal;
        bookingPackage.finalTotal = finalPrice;
        bookingPackage.priceDate = priceDate;
    }
    booking.programBasePrice = programBasePrice;
    booking.price = finalPrice;
    extra.priceSnapshot = {
        productId: String(resolved.productId || programId),
        priceCode: resolved.priceCode || null,
        price: unitPrice,
        finalPrice,
        priceDate,
        source: resolved.priceSource || 'products',
        effectiveFrom: resolved.priceRuleEffectiveFrom || null,
        nextPrice: resolved.nextPrice,
        nextPriceFrom: resolved.nextPriceFrom
    };
    return extra.priceSnapshot;
}

function refreshMultiActivityPriceTotals(bookings = []) {
    const items = bookings.filter(Boolean);
    if (items.length < 2) return;
    const totalPrice = toMoney(items.reduce((sum, booking) => sum + Number(booking.price || 0), 0));
    for (const booking of items) {
        const extra = ensureExtraDataObject(booking);
        if (extra.multiActivity && typeof extra.multiActivity === 'object') {
            extra.multiActivity.totalPrice = totalPrice;
        }
    }
}

module.exports = {
    normalizePriceDate,
    buildProductPriceJoin,
    mapProductPriceFields,
    resolveProductEffectivePrice,
    applyEffectiveBookingPrice,
    refreshMultiActivityPriceTotals
};
