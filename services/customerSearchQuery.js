'use strict';

const { getVisibleBookingScope } = require('./bookingVisibility');
const {
    DEFAULT_BUSINESS_CONTEXT,
    pushBusinessContextCondition,
    pushBusinessScopeCondition
} = require('./businessContext');

function customerChildrenSearchSql(patternRef, alias = 'c') {
    return `EXISTS (
        SELECT 1
        FROM customer_children cc_search
        WHERE cc_search.customer_id = ${alias}.id
          AND cc_search.business_context = COALESCE(${alias}.business_context, '${DEFAULT_BUSINESS_CONTEXT}')
          AND cc_search.name ILIKE ${patternRef}
    )`;
}

function customerScopeCondition(params, businessScope, alias = '') {
    return pushBusinessScopeCondition(params, businessScope || DEFAULT_BUSINESS_CONTEXT, alias);
}

function buildScopedBookingAggregateSql(user, params, alias = 'b', businessScope = DEFAULT_BUSINESS_CONTEXT) {
    const businessSql = customerScopeCondition(params, businessScope, alias);
    const visibility = getVisibleBookingScope(user, params, alias);
    return {
        visibility,
        sql: `
            SELECT ${alias}.customer_id,
                   COUNT(*) AS booking_count,
                   COALESCE(SUM(${alias}.price), 0) AS booking_spent,
                   MIN(${alias}.date) AS real_first_visit,
                   MAX(${alias}.date) AS real_last_visit
            FROM bookings ${alias}
            WHERE ${alias}.status != 'cancelled'
              AND ${businessSql}
              ${visibility.sql}
            GROUP BY ${alias}.customer_id
        `
    };
}

function buildCustomerSearchQuery({
    query,
    businessContext = DEFAULT_BUSINESS_CONTEXT,
    user = null,
    includeSocialIdentities = true,
    limit = 20
} = {}) {
    const q = String(query || '').trim();
    if (q.length < 2) {
        return null;
    }

    const pattern = `%${q}%`;
    const phoneDigits = q.replace(/\D/g, '');
    const instagramHandle = q.replace(/^@+/, '').trim();
    const params = [pattern];
    const normalizedPhoneSql = phoneDigits.length >= 2
        ? ` OR regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') ILIKE $${params.push(`%${phoneDigits}%`)}`
        : '';
    const instagramHandleSql = instagramHandle && instagramHandle !== q
        ? ` OR c.instagram ILIKE $${params.push(`%${instagramHandle}%`)}`
        : '';
    const bookingAgg = buildScopedBookingAggregateSql(user, params, 'b', businessContext);
    const socialIdentitySearch = includeSocialIdentities
        ? ' OR c.social_identities::text ILIKE $1'
        : '';
    const childrenSearch = ` OR ${customerChildrenSearchSql('$1', 'c')}`;
    const contextSql = pushBusinessContextCondition(params, businessContext, 'c');
    const boundedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    return {
        q,
        params,
        sql: `SELECT c.id, c.name, c.phone, c.instagram, c.child_name, c.child_birthday,
                    c.source, c.total_bookings,
                    COALESCE(b_agg.booking_count, 0) AS real_total_bookings,
                    COALESCE(b_agg.booking_spent, 0) AS real_total_spent,
                    b_agg.real_last_visit
             FROM customers c
             LEFT JOIN (${bookingAgg.sql}) b_agg ON b_agg.customer_id = c.id
             WHERE ${contextSql}
               AND (c.name ILIKE $1 OR c.phone ILIKE $1 OR c.instagram ILIKE $1 OR c.child_name ILIKE $1${childrenSearch}${normalizedPhoneSql}${instagramHandleSql}${socialIdentitySearch})
             ORDER BY b_agg.real_last_visit DESC NULLS LAST
             LIMIT ${boundedLimit}`
    };
}

module.exports = {
    buildCustomerSearchQuery,
    buildScopedBookingAggregateSql,
    customerChildrenSearchSql
};
