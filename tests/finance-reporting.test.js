'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getForecastPeriod, shiftCalendarDate, buildForecastSummary,
    buildHistoricalAverage } = require('../utils/financeReporting');

test('forecast uses the Kyiv calendar date and an inclusive horizon', () => {
    const now = new Date('2026-12-31T22:30:00Z');
    assert.deepEqual(getForecastPeriod('7', now), { from: '2027-01-01', to: '2027-01-07', days: 7 });
    assert.deepEqual(getForecastPeriod(undefined, now), { from: '2027-01-01', to: '2027-01-30', days: 30 });
    assert.deepEqual(getForecastPeriod('90', now), { from: '2027-01-01', to: '2027-03-31', days: 90 });
});

test('forecast rejects malformed and out-of-bound horizons instead of silently substituting 30 days', () => {
    for (const value of ['', '0', '1', '6', '91', '-7', '7.1', '7abc', '1e2', ' 7 ', ['7'], {}, null, 7]) {
        assert.throws(() => getForecastPeriod(value), error => error.status === 400
            && error.code === 'finance_forecast_days_invalid', String(value));
    }
});

test('calendar date arithmetic is stable over leap days and daylight saving transitions', () => {
    assert.equal(shiftCalendarDate('2028-02-28', 2), '2028-03-01');
    assert.deepEqual(getForecastPeriod('7', new Date('2026-03-28T23:30:00Z')),
        { from: '2026-03-29', to: '2026-04-04', days: 7 });
    assert.deepEqual(getForecastPeriod('7', new Date('2026-10-24T22:30:00Z')),
        { from: '2026-10-25', to: '2026-10-31', days: 7 });
});

test('daily and weekly projections include zero days and reconcile separate booking and payment amounts', () => {
    const report = buildForecastSummary([
        { date: '2026-10-11', booking_count: 3, expected_revenue: 3000,
            expected_outstanding: 1600, recorded_paid: 1600, unpaid_booking_count: 2 },
        { date: '2026-10-12', booking_count: 1, expected_revenue: 500,
            expected_outstanding: 0, recorded_paid: 0, unpaid_booking_count: 0 },
        { date: '2026-10-18', booking_count: 1, expected_revenue: 9999,
            expected_outstanding: 9999, recorded_paid: 0, unpaid_booking_count: 1 }
    ], { from: '2026-10-11', to: '2026-10-17', days: 7 });
    assert.equal(report.daily.length, 7);
    assert.deepEqual(report.daily.at(-1), { date: '2026-10-17', expected_revenue: 0,
        expected_outstanding: 0, recorded_paid: 0, booking_count: 0, unpaid_booking_count: 0 });
    assert.deepEqual(report.totals, { expectedRevenue: 3500, expectedOutstanding: 1600,
        recordedPaid: 1600, bookingCount: 4, unpaidBookingCount: 2 });
    assert.deepEqual(report.weekly.map(row => [row.week_start, row.booking_count, row.expected_revenue,
        row.expected_outstanding]), [['2026-10-05', 3, 3000, 1600], ['2026-10-12', 1, 500, 0]]);
    assert.equal(report.weekly.reduce((sum, row) => sum + row.expected_outstanding, 0), report.totals.expectedOutstanding);
});

test('empty forecasts return real zeros for every day and week', () => {
    const report = buildForecastSummary([], { from: '2026-10-05', to: '2026-10-11', days: 7 });
    assert.equal(report.daily.length, 7);
    assert.equal(report.weekly.length, 1);
    assert.equal(report.weekly[0].week_start, '2026-10-05');
    assert.deepEqual(report.totals, { expectedRevenue: 0, expectedOutstanding: 0,
        recordedPaid: 0, bookingCount: 0, unpaidBookingCount: 0 });
});

test('historical averages count all 90 calendar days, including 12 empty Mondays', () => {
    const history = buildHistoricalAverage([{ date: '2026-01-05', expected_revenue: 1300, booking_count: 13 }],
        { from: '2026-01-01', to: '2026-03-31', days: 90 });
    assert.equal(history.length, 7);
    assert.equal(history.reduce((sum, row) => sum + row.calendar_day_count, 0), 90);
    assert.deepEqual(history.find(row => row.dow === 1), { dow: 1, avg_revenue: 100,
        avg_count: 1, calendar_day_count: 13 });
    assert.ok(history.filter(row => row.dow !== 1).every(row => row.avg_revenue === 0 && row.avg_count === 0));
});
