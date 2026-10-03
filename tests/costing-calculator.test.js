'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePlan, CostingInputError } = require('../services/costingCalculator');

test('group lesson separates paid places from material consumers and finds break-even occupancy', () => {
    const result = calculatePlan({
        revenueBasis: 'participant', revenueRateMinor: '30000', lines: [
            { code: 'teacher', label: 'Викладач', basis: 'hour', rateMinor: '25000' },
            { code: 'materials', label: 'Матеріали', basis: 'participant', rateMinor: '4000' },
            { code: 'room', label: 'Зал', basis: 'execution', rateMinor: '15000' },
            { code: 'commission', label: 'Комісія', basis: 'percent', percentBps: 500, percentBase: 'revenue' }
        ]
    }, { paidParticipants: 8, participants: 10, durationMinutes: 120, discountBps: 1000 });
    assert.equal(result.grossRevenueMinor, '240000');
    assert.equal(result.revenueMinor, '216000');
    assert.equal(result.directCostMinor, '115800');
    assert.equal(result.contributionMinor, '100200');
    assert.equal(result.marginBps, 4639);
    assert.equal(result.breakEvenParticipants, 4);
    assert.deepEqual(result.lines.map(line => line.amountMinor), ['50000', '40000', '15000', '10800']);
});

test('room rental uses precise 3.5 hour price, fixed discount and percentage of net revenue', () => {
    const result = calculatePlan({ revenueBasis: 'hour', revenueRateMinor: '60000', lines: [
        { code: 'cleaning', label: 'Прибирання', basis: 'execution', rateMinor: '18000' },
        { code: 'host', label: 'Адміністратор, план', basis: 'execution', rateMinor: '28000' },
        { code: 'materials', label: 'Матеріали', basis: 'execution', rateMinor: '18000' },
        { code: 'commission', label: 'Комісія', basis: 'percent', percentBps: 400, percentBase: 'revenue' }
    ] }, { durationMinutes: 210, discountMinor: '10000' });
    assert.equal(result.revenueMinor, '200000');
    assert.equal(result.directCostMinor, '72000');
    assert.equal(result.contributionMinor, '128000');
    assert.equal(result.marginBps, 6400);
});

test('agency order uses separate quantities per direct cost and referral on discounted revenue', () => {
    const result = calculatePlan({ revenueBasis: 'execution', revenueRateMinor: '1000000', lines: [
        { code: 'venue', label: 'Локація', basis: 'execution', rateMinor: '200000' },
        { code: 'equipment', label: 'Техніка', basis: 'unit', rateMinor: '35000' },
        { code: 'labor', label: 'Праця', basis: 'unit', rateMinor: '20000' },
        { code: 'contractor', label: 'Підрядник', basis: 'unit', rateMinor: '60000' },
        { code: 'referral', label: 'Реферальна комісія', basis: 'percent', percentBps: 1000, percentBase: 'revenue' }
    ] }, { discountMinor: '50000', lineQuantities: { equipment: 4, labor: 6, contractor: 2 } });
    assert.equal(result.revenueMinor, '950000');
    assert.equal(result.directCostMinor, '675000');
    assert.equal(result.contributionMinor, '275000');
    assert.equal(result.marginBps, 2895);
});

test('money stays in integer minor units; each percentage line rounds half up once', () => {
    const result = calculatePlan({ revenueBasis: 'execution', revenueRateMinor: '1999', lines: [
        { code: 'units', label: 'Три одиниці', basis: 'unit', rateMinor: '10' },
        { code: 'share', label: '12,5%', basis: 'percent', percentBps: 1250, percentBase: 'revenue' }
    ] }, { lineQuantities: { units: 3 } });
    assert.deepEqual(result.lines.map(line => line.amountMinor), ['30', '250']);
    assert.equal(result.directCostMinor, '280');
});

test('zero revenue exposes a loss without a misleading margin or percent cycle', () => {
    const result = calculatePlan({ revenueBasis: 'execution', revenueRateMinor: '0', lines: [
        { code: 'fixed', label: 'Фіксовані', basis: 'execution', rateMinor: '20000' }
    ] });
    assert.equal(result.contributionMinor, '-20000');
    assert.equal(result.marginBps, null);
    assert.throws(() => calculatePlan({ revenueBasis: 'execution', revenueRateMinor: '100', lines: [
        { code: 'cycle', label: 'Цикл', basis: 'percent', percentBps: 1000, percentBase: 'total_direct_cost' }
    ] }), CostingInputError);
});

test('fixed discount does not break low-attendance break-even search', () => {
    const version = { revenueBasis: 'participant', revenueRateMinor: '10000', lines: [
        { code: 'fixed', label: 'Зал', basis: 'execution', rateMinor: '15000' }
    ] };
    const result = calculatePlan(version, { participants: 3, paidParticipants: 3, discountMinor: '5000' });
    assert.equal(result.contributionMinor, '10000');
    assert.equal(result.breakEvenParticipants, 2);
    assert.throws(() => calculatePlan(version, { participants: 2, paidParticipants: 3 }),
        error => error instanceof CostingInputError && /cannot exceed/.test(error.message));
});
