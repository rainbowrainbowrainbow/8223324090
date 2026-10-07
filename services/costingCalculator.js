'use strict';

const REVENUE_BASES = new Set(['execution', 'hour', 'participant', 'unit']);
const COST_BASES = new Set([...REVENUE_BASES, 'percent']);
const PERCENT_BASES = new Set(['revenue', 'base_direct_cost']);
const MAX_DB_AMOUNT = 9223372036854775807n;

class CostingInputError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CostingInputError';
        this.status = 400;
    }
}

function minor(value, field) {
    const text = String(value ?? '');
    if (!/^(0|[1-9]\d{0,14})$/.test(text)) throw new CostingInputError(`${field} must be a non-negative integer amount in minor units`);
    return BigInt(text);
}

function count(value, field, max = 1000000) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > max) throw new CostingInputError(`${field} must be an integer from 0 to ${max}`);
    return number;
}

function roundDivide(numerator, denominator) {
    if (denominator <= 0n) throw new CostingInputError('Invalid calculation denominator');
    const sign = numerator < 0n ? -1n : 1n;
    const absolute = numerator < 0n ? -numerator : numerator;
    return sign * ((absolute + denominator / 2n) / denominator);
}

function normalizeVersion(input = {}) {
    const revenueBasis = String(input.revenueBasis || 'execution');
    if (!REVENUE_BASES.has(revenueBasis)) throw new CostingInputError('Unsupported revenue basis');
    const revenueRateMinor = minor(input.revenueRateMinor, 'revenueRateMinor').toString();
    if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 50) {
        throw new CostingInputError('Enter 1–50 direct cost lines');
    }
    const codes = new Set();
    const lines = input.lines.map((raw, index) => {
        const code = String(raw?.code || `line_${index + 1}`).trim().toLowerCase();
        const label = String(raw?.label || '').trim();
        const basis = String(raw?.basis || '');
        if (!/^[a-z0-9_]{1,40}$/.test(code) || codes.has(code)) throw new CostingInputError('Cost line codes must be unique');
        if (!label || label.length > 120) throw new CostingInputError('Each cost line needs a label of up to 120 characters');
        if (!COST_BASES.has(basis)) throw new CostingInputError(`Unsupported cost basis: ${basis}`);
        codes.add(code);
        if (basis === 'percent') {
            const percentBps = count(raw.percentBps, 'percentBps', 10000);
            const percentBase = String(raw.percentBase || '');
            if (!PERCENT_BASES.has(percentBase)) throw new CostingInputError('Percentage line needs an explicit revenue or base direct cost base');
            return { code, label, basis, percentBps, percentBase };
        }
        return { code, label, basis, rateMinor: minor(raw.rateMinor, `lines[${index}].rateMinor`).toString() };
    });
    return { revenueBasis, revenueRateMinor, lines };
}

function normalizeInputs(input = {}) {
    const rawQuantities = input.lineQuantities || {};
    if (!rawQuantities || typeof rawQuantities !== 'object' || Array.isArray(rawQuantities)) throw new CostingInputError('lineQuantities must be an object');
    const lineQuantities = {};
    for (const [code, value] of Object.entries(rawQuantities)) {
        if (!/^[a-z0-9_]{1,40}$/.test(code)) throw new CostingInputError('Invalid cost line quantity code');
        lineQuantities[code] = count(value, `lineQuantities.${code}`);
    }
    return {
        participants: count(input.participants ?? 0, 'participants'),
        paidParticipants: count(input.paidParticipants ?? input.participants ?? 0, 'paidParticipants'),
        durationMinutes: count(input.durationMinutes ?? 0, 'durationMinutes', 100000),
        units: count(input.units ?? 0, 'units'),
        discountBps: count(input.discountBps ?? 0, 'discountBps', 10000),
        discountMinor: minor(input.discountMinor ?? '0', 'discountMinor').toString(),
        lineQuantities,
        ...(input.revenueOverrideMinor === undefined || input.revenueOverrideMinor === null || input.revenueOverrideMinor === ''
            ? {} : { revenueOverrideMinor: minor(input.revenueOverrideMinor, 'revenueOverrideMinor').toString() })
    };
}

function scaledAmount(rate, basis, inputs, code = null, forRevenue = false) {
    if (basis === 'execution') return rate;
    if (basis === 'hour') return roundDivide(rate * BigInt(inputs.durationMinutes), 60n);
    if (basis === 'participant') return rate * BigInt(forRevenue ? inputs.paidParticipants : inputs.participants);
    if (basis === 'unit') return rate * BigInt(code && inputs.lineQuantities[code] !== undefined ? inputs.lineQuantities[code] : inputs.units);
    throw new CostingInputError('Unsupported calculation basis');
}

function calculateCore(version, inputs) {
    const grossRevenue = inputs.revenueOverrideMinor === undefined
        ? scaledAmount(BigInt(version.revenueRateMinor), version.revenueBasis, inputs, null, true)
        : BigInt(inputs.revenueOverrideMinor);
    const revenue = grossRevenue - roundDivide(grossRevenue * BigInt(inputs.discountBps), 10000n) - BigInt(inputs.discountMinor);
    if (revenue < 0n) throw new CostingInputError('Discount cannot exceed gross revenue');
    const baseLines = version.lines.filter(line => line.basis !== 'percent').map(line => ({
        code: line.code, label: line.label, basis: line.basis,
        classification: line.basis === 'execution' ? 'fixed' : 'variable',
        amountMinor: scaledAmount(BigInt(line.rateMinor), line.basis, inputs, line.code).toString()
    }));
    const baseDirectCost = baseLines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    const percentLines = version.lines.filter(line => line.basis === 'percent').map(line => {
        const base = line.percentBase === 'revenue' ? revenue : baseDirectCost;
        return {
            code: line.code, label: line.label, basis: line.basis,
            percentBase: line.percentBase, percentBps: line.percentBps,
            classification: 'variable',
            amountMinor: roundDivide(base * BigInt(line.percentBps), 10000n).toString()
        };
    });
    const linesByCode = new Map([...baseLines, ...percentLines].map(line => [line.code, line]));
    const lines = version.lines.map(line => linesByCode.get(line.code));
    const directCost = lines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    const contribution = revenue - directCost;
    if (revenue > MAX_DB_AMOUNT || directCost > MAX_DB_AMOUNT || contribution < -MAX_DB_AMOUNT || contribution > MAX_DB_AMOUNT ||
        lines.some(line => BigInt(line.amountMinor) > MAX_DB_AMOUNT)) {
        throw new CostingInputError('Calculation exceeds the supported money range');
    }
    const margin = revenue > 0n ? roundDivide(contribution * 10000n, revenue) : null;
    if (margin !== null && (margin < -2147483648n || margin > 2147483647n)) {
        throw new CostingInputError('Margin exceeds the supported range');
    }
    return {
        grossRevenueMinor: grossRevenue.toString(), revenueMinor: revenue.toString(), directCostMinor: directCost.toString(),
        contributionMinor: contribution.toString(),
        marginBps: margin === null ? null : Number(margin),
        lines
    };
}

function calculatePlan(versionInput, input = {}) {
    const version = normalizeVersion(versionInput);
    const inputs = normalizeInputs(input);
    if (inputs.paidParticipants > inputs.participants) {
        throw new CostingInputError('paidParticipants cannot exceed participants');
    }
    const result = calculateCore(version, inputs);
    let breakEvenParticipants = null;
    if (version.revenueBasis === 'participant' && inputs.revenueOverrideMinor === undefined) {
        for (let participants = 0; participants <= 1000; participants += 1) {
            let candidate;
            try {
                candidate = calculateCore(version, { ...inputs, participants, paidParticipants: participants });
            } catch (error) {
                // A fixed discount can exceed the revenue at low attendance even when the actual plan is valid.
                if (error instanceof CostingInputError && error.message === 'Discount cannot exceed gross revenue') continue;
                throw error;
            }
            if (BigInt(candidate.contributionMinor) >= 0n) {
                breakEvenParticipants = participants;
                break;
            }
        }
    }
    return { version, inputs, ...result, breakEvenParticipants };
}

module.exports = { CostingInputError, normalizeVersion, normalizeInputs, calculatePlan };
