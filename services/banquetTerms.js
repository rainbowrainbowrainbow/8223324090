'use strict';

const BANQUET_TERMS_PRICE_RULE_CODES = Object.freeze({
    ownCakeFee: 'banquet_own_cake_fee',
    corkFee: 'banquet_cork_fee',
    menuCorrectionDeadlineDays: 'banquet_menu_correction_deadline_days',
    dateChangeDeadlineDays: 'banquet_date_change_deadline_days'
});

const BANQUET_TERMS_PRICE_RULE_CODE_LIST = Object.freeze(Object.values(BANQUET_TERMS_PRICE_RULE_CODES));

function normalizePriceRuleMap(priceRules = []) {
    if (priceRules && typeof priceRules === 'object' && !Array.isArray(priceRules)) {
        return new Map(Object.entries(priceRules));
    }
    return new Map((Array.isArray(priceRules) ? priceRules : [])
        .map(rule => [String(rule?.code || '').trim(), rule])
        .filter(([code]) => code));
}

function numericRuleValue(rule) {
    const value = Number(rule?.value);
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 100) / 100;
}

function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
}

function renderBanquetTermsFromPriceRules(priceRules = []) {
    const rules = normalizePriceRuleMap(priceRules);
    const values = {};
    const missingCodes = [];

    for (const [key, code] of Object.entries(BANQUET_TERMS_PRICE_RULE_CODES)) {
        const value = numericRuleValue(rules.get(code));
        if (value === null) {
            missingCodes.push(code);
        } else {
            values[key] = formatNumber(value);
        }
    }

    if (missingCodes.length) {
        return {
            title: 'Умови банкету',
            items: [],
            source: 'price_rules',
            missingCodes
        };
    }

    return {
        title: 'Умови банкету',
        items: [
            'Заборонено приносити їжу/напої/торт.',
            `Сума завдатку не повертається. Свій торт - ${values.ownCakeFee}грн. Cork Fee – ${values.corkFee}грн.`,
            `Корегування меню здійснюється максимум за ${values.menuCorrectionDeadlineDays} доби. Зміна дати за ${values.dateChangeDeadlineDays} діб.`,
            'Винагорода офіціантів вітається, але завжди залишається на ваш розсуд.'
        ],
        source: 'price_rules',
        missingCodes: []
    };
}

function extraDataObjectOf(booking = {}) {
    const extra = booking.extraData ?? booking.extra_data;
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) return extra;
    if (typeof extra === 'string' && extra.trim()) {
        try {
            const parsed = JSON.parse(extra);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function hasSnapshotTerms(extra = {}) {
    const candidates = [extra.banquetTerms, extra.banquet_terms, extra.terms];
    return candidates.some(value => {
        if (Array.isArray(value)) return value.some(item => String(item || '').trim());
        return Boolean(String(value || '').trim());
    });
}

function hasArrayItems(value) {
    return Array.isArray(value) && value.length > 0;
}

function bookingPackageOf(booking = {}, extra = extraDataObjectOf(booking)) {
    return booking.bookingPackage
        || booking.booking_package
        || extra.bookingPackage
        || extra.booking_package
        || {};
}

function bookingNeedsBanquetTermsSnapshot(booking = {}) {
    const extra = extraDataObjectOf(booking);
    if (hasSnapshotTerms(extra)) return false;
    const workspace = extra.bookingWorkspace || extra.booking_workspace || {};
    const bookingPackage = bookingPackageOf(booking, extra);
    const category = String(booking.category || booking.category_id || '').trim().toLowerCase();
    const programCode = String(booking.programCode || booking.program_code || '').trim().toUpperCase();
    const scenario = String(workspace.scenario || booking.scenario || '').trim().toLowerCase();

    return category === 'banquet'
        || category === 'kitchen'
        || programCode === 'KITCHEN'
        || scenario === 'kitchen_only'
        || scenario === 'event_kitchen'
        || hasArrayItems(bookingPackage.menuPositions || bookingPackage.menu_positions)
        || hasArrayItems(bookingPackage.serviceEvents || bookingPackage.service_events)
        || Boolean(String(booking.banquetMenu || booking.banquet_menu || '').trim())
        || booking.banquetGuests != null
        || booking.banquet_guests != null
        || booking.banquetAdults != null
        || booking.banquet_adults != null
        || booking.banquetTables != null
        || booking.banquet_tables != null;
}

async function loadBanquetTermsDefaults(queryable) {
    if (!queryable || typeof queryable.query !== 'function') {
        return renderBanquetTermsFromPriceRules([]);
    }
    const result = await queryable.query(
        `SELECT code, name, value, unit, category, description
           FROM price_rules
          WHERE code = ANY($1::text[])`,
        [BANQUET_TERMS_PRICE_RULE_CODE_LIST]
    );
    return renderBanquetTermsFromPriceRules(result.rows);
}

async function snapshotBanquetTermsForBooking(queryable, booking = {}) {
    if (!bookingNeedsBanquetTermsSnapshot(booking)) {
        return { applied: false, reason: 'not_banquet_or_existing_terms' };
    }
    const defaults = await loadBanquetTermsDefaults(queryable);
    if (!Array.isArray(defaults.items) || !defaults.items.length) {
        return {
            applied: false,
            reason: 'missing_price_rules',
            missingCodes: defaults.missingCodes || []
        };
    }

    const extra = extraDataObjectOf(booking);
    extra.banquetTerms = defaults.items;
    extra.banquetTermsSnapshot = {
        title: defaults.title,
        source: defaults.source || 'price_rules',
        priceRuleCodes: BANQUET_TERMS_PRICE_RULE_CODE_LIST,
        capturedAt: new Date().toISOString()
    };
    booking.extraData = extra;
    return { applied: true, terms: defaults };
}

module.exports = {
    BANQUET_TERMS_PRICE_RULE_CODES,
    BANQUET_TERMS_PRICE_RULE_CODE_LIST,
    renderBanquetTermsFromPriceRules,
    loadBanquetTermsDefaults,
    bookingNeedsBanquetTermsSnapshot,
    snapshotBanquetTermsForBooking
};
