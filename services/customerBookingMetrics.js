'use strict';

const { getVisibleBookingScope } = require('./bookingVisibility');
const { DEFAULT_BUSINESS_CONTEXT, pushBusinessScopeCondition } = require('./businessContext');
const { toPostgresDateOnly } = require('./postgresDateOnly');
const { resolveCapability } = require('./accountAccessPolicy');

function customerMetricsDate(now = new Date()) {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv' }).format(now);
}

function buildScopedBookingAggregateSql(user, params, alias = 'b', businessScope = DEFAULT_BUSINESS_CONTEXT, options = {}) {
    const businessSql = pushBusinessScopeCondition(params, businessScope, alias);
    const visibility = getVisibleBookingScope(user, params, alias);
    const today = `$${params.push(options.asOf || customerMetricsDate())}::date`;
    const customerSql = options.customerIds
        ? `AND ${alias}.customer_id = ANY($${params.push(options.customerIds)}::int[])` : '';
    const status = `LOWER(BTRIM(${alias}.status))`;
    // The canonical bookings schema stores calendar dates as VARCHAR(20).
    const bookingDate = `NULLIF(BTRIM(${alias}.date::text), '')::date`;
    const past = `${bookingDate} < ${today}`;
    const confirmedPast = `${status} = 'confirmed' AND ${past}`;
    const canViewRevenue = resolveCapability(user, 'view_revenue', { type: 'action' }).allowed;
    const bookingValue = canViewRevenue ? `COALESCE(SUM(${alias}.price) FILTER (WHERE ${alias}.price >= 0), 0)` : '0';
    const unpricedCount = canViewRevenue ? `COUNT(*) FILTER (WHERE ${alias}.price IS NULL OR ${alias}.price < 0)` : '0';
    const rfmValue = canViewRevenue ? `COALESCE(SUM(${alias}.price) FILTER (WHERE ${confirmedPast} AND ${alias}.price >= 0), 0)` : '0';
    return {
        visibility,
        sql: `SELECT ${alias}.customer_id,
            COUNT(*) AS booking_count,
            ${bookingValue} AS booking_spent,
            COUNT(*) FILTER (WHERE ${past}) AS past_bookings,
            COUNT(*) FILTER (WHERE ${bookingDate} >= ${today}) AS planned_bookings,
            COUNT(*) FILTER (WHERE ${bookingDate} IS NULL) AS undated_bookings,
            COUNT(*) FILTER (WHERE ${status} = 'preliminary') AS preliminary_bookings,
            ${unpricedCount} AS unpriced_bookings,
            MIN(${bookingDate}) FILTER (WHERE ${past}) AS real_first_visit,
            MAX(${bookingDate}) FILTER (WHERE ${past}) AS real_last_visit,
            MIN(${bookingDate}) FILTER (WHERE ${bookingDate} >= ${today}) AS next_booking_date,
            COUNT(*) FILTER (WHERE ${confirmedPast}) AS rfm_frequency,
            ${rfmValue} AS rfm_monetary,
            MAX(${bookingDate}) FILTER (WHERE ${confirmedPast}) AS rfm_last_visit,
            ${today} - MAX(${bookingDate}) FILTER (WHERE ${confirmedPast}) AS recency_days,
            ${today} AS metrics_as_of
        FROM bookings ${alias}
        WHERE ${status} IN ('confirmed', 'preliminary')
          AND NULLIF(BTRIM(${alias}.linked_to), '') IS NULL
          AND ${businessSql} ${visibility.sql} ${customerSql}
        GROUP BY ${alias}.customer_id`
    };
}

function customerMetricsProjectionSql(alias = 'b_agg') {
    return `COALESCE(${alias}.booking_count, 0) AS real_total_bookings,
        COALESCE(${alias}.booking_spent, 0) AS real_total_spent,
        COALESCE(${alias}.past_bookings, 0) AS past_bookings,
        COALESCE(${alias}.planned_bookings, 0) AS planned_bookings,
        COALESCE(${alias}.undated_bookings, 0) AS undated_bookings,
        COALESCE(${alias}.preliminary_bookings, 0) AS preliminary_bookings,
        COALESCE(${alias}.unpriced_bookings, 0) AS unpriced_bookings,
        ${alias}.real_first_visit::text AS real_first_visit,
        ${alias}.real_last_visit::text AS real_last_visit,
        ${alias}.next_booking_date::text AS next_booking_date,
        COALESCE(${alias}.rfm_frequency, 0) AS rfm_frequency,
        COALESCE(${alias}.rfm_monetary, 0) AS rfm_monetary,
        ${alias}.rfm_last_visit::text AS rfm_last_visit,
        ${alias}.recency_days, ${alias}.metrics_as_of::text AS metrics_as_of`;
}

function mapCustomerBookingMetrics(row = {}) {
    return {
        totalBookings: Number(row.real_total_bookings || 0),
        totalSpent: Number(row.real_total_spent || 0),
        pastBookings: Number(row.past_bookings || 0),
        plannedBookings: Number(row.planned_bookings || 0),
        undatedBookings: Number(row.undated_bookings || 0),
        preliminaryBookings: Number(row.preliminary_bookings || 0),
        unpricedBookings: Number(row.unpriced_bookings || 0),
        firstVisit: toPostgresDateOnly(row.real_first_visit),
        lastVisit: toPostgresDateOnly(row.real_last_visit),
        nextBookingDate: toPostgresDateOnly(row.next_booking_date),
        metricsAsOf: toPostgresDateOnly(row.metrics_as_of) || customerMetricsDate()
    };
}

async function loadCustomerBookingMetricRows(queryable, customerIds, user, businessScope) {
    if (!customerIds.length) return new Map();
    const params = [];
    const aggregate = buildScopedBookingAggregateSql(user, params, 'b', businessScope, { customerIds });
    const result = await queryable.query(`SELECT b_agg.customer_id, ${customerMetricsProjectionSql()}
        FROM (${aggregate.sql}) b_agg`, params);
    return new Map(result.rows.map(row => [Number(row.customer_id), row]));
}

function getPercentileScore(arr, value, inverted) {
    const sorted = [...arr].sort((a, b) => a - b);
    const percentile = sorted.indexOf(value) / Math.max(sorted.length - 1, 1);
    const score = inverted ? 1 - percentile : percentile;
    return score >= 0.8 ? 5 : score >= 0.6 ? 4 : score >= 0.4 ? 3 : score >= 0.2 ? 2 : 1;
}

function getRFMSegment(r, f, m) {
    if (r >= 4 && f >= 4) return 'champion';
    if (f >= 3 && m >= 3) return 'loyal';
    if (r >= 3 && f <= 2) return 'potential';
    if (r <= 2 && f >= 2) return 'at_risk';
    return (r + f + m) / 3 <= 2 ? 'lost' : 'potential';
}

function calculateRFMScores(customers) {
    const history = customers.filter(c => c.frequency > 0 && Number.isFinite(c.recencyDays) && c.recencyDays > 0);
    const recencies = history.map(c => c.recencyDays);
    const frequencies = history.map(c => c.frequency);
    const monetaries = history.map(c => c.monetary);
    const withHistory = new Set(history);
    return customers.map(c => {
        if (!withHistory.has(c)) return { ...c, rScore: null, fScore: null, mScore: null, rfmScore: null, rfmSegment: 'no_history' };
        const rScore = getPercentileScore(recencies, c.recencyDays, true);
        const fScore = getPercentileScore(frequencies, c.frequency, false);
        const mScore = getPercentileScore(monetaries, c.monetary, false);
        return { ...c, rScore, fScore, mScore, rfmScore: rScore + fScore + mScore, rfmSegment: getRFMSegment(rScore, fScore, mScore) };
    });
}

module.exports = { customerMetricsDate, buildScopedBookingAggregateSql, customerMetricsProjectionSql,
    mapCustomerBookingMetrics, loadCustomerBookingMetricRows, calculateRFMScores };
