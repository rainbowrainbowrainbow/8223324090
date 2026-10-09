'use strict';

const DAY_MS = 86400000;

function shiftCalendarDate(date, days) {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function getForecastPeriod(value, now = new Date()) {
    const days = value === undefined ? 30 : Number(value);
    if ((value !== undefined && (typeof value !== 'string' || !/^\d+$/.test(value)))
        || !Number.isInteger(days) || days < 7 || days > 90) {
        const error = new Error('Горизонт прогнозу має бути цілим числом від 7 до 90 днів.');
        error.status = 400;
        error.code = 'finance_forecast_days_invalid';
        throw error;
    }
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const part = type => parts.find(item => item.type === type).value;
    const from = `${part('year')}-${part('month')}-${part('day')}`;
    return { from, to: shiftCalendarDate(from, days - 1), days };
}

function buildForecastSummary(rows, period) {
    const byDate = new Map(rows.map(row => [row.date, row]));
    const daily = [];
    const weeks = new Map();
    const totals = { expectedRevenue: 0, expectedOutstanding: 0, recordedPaid: 0,
        bookingCount: 0, unpaidBookingCount: 0 };
    const fields = { expected_revenue: 'expectedRevenue', expected_outstanding: 'expectedOutstanding',
        recorded_paid: 'recordedPaid', booking_count: 'bookingCount', unpaid_booking_count: 'unpaidBookingCount' };
    for (let day = 0; day < period.days; day++) {
        const date = shiftCalendarDate(period.from, day);
        const source = byDate.get(date) || {};
        const row = { date };
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
        const weekStart = shiftCalendarDate(date, 1 - weekday);
        if (!weeks.has(weekStart)) weeks.set(weekStart, { week_start: weekStart,
            booking_count: 0, expected_revenue: 0, expected_outstanding: 0, recorded_paid: 0, unpaid_booking_count: 0 });
        const week = weeks.get(weekStart);
        for (const [field, totalField] of Object.entries(fields)) {
            row[field] = Number(source[field] || 0);
            week[field] += row[field];
            totals[totalField] += row[field];
        }
        daily.push(row);
    }
    return { daily, weekly: [...weeks.values()], totals };
}

function buildHistoricalAverage(rows, period) {
    const byDate = new Map(rows.map(row => [row.date, row]));
    const weekdays = Array.from({ length: 7 }, (_, dow) => ({ dow, revenue: 0, count: 0, calendar_day_count: 0 }));
    for (let day = 0; day < period.days; day++) {
        const date = shiftCalendarDate(period.from, day);
        const weekday = weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];
        const row = byDate.get(date) || {};
        weekday.revenue += Number(row.expected_revenue || 0);
        weekday.count += Number(row.booking_count || 0);
        weekday.calendar_day_count++;
    }
    return weekdays.map(row => ({ dow: row.dow,
        avg_revenue: Math.round(row.revenue / row.calendar_day_count),
        avg_count: Math.round(row.count / row.calendar_day_count * 100) / 100,
        calendar_day_count: row.calendar_day_count }));
}

module.exports = { shiftCalendarDate, getForecastPeriod, buildForecastSummary, buildHistoricalAverage };
