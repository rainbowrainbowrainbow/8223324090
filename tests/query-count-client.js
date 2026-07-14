'use strict';

function compactSql(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function classifyQuery(sql) {
    if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) return 'transaction';
    if (/^(INSERT|UPDATE|DELETE)\b/i.test(sql)) return 'persistence';
    if (/\bFROM staff s\b/i.test(sql) && /secondary_professions/i.test(sql)) return 'profession_card_load';
    if (/\bFROM hr_shifts hs\b/i.test(sql) && /hr_shift_segments/i.test(sql)) return 'plan_load';
    if (/\bFROM staff_schedule ss\b/i.test(sql) && /UNNEST\(/i.test(sql)) return 'schedule_mirror_load';
    if (/\bFOR (UPDATE|SHARE)\b/i.test(sql)) return 'locking';
    return 'read';
}

function normalizeBudget(value) {
    if (Number.isInteger(value)) return { min: value, max: value };
    return {
        min: Number.isInteger(value?.min) ? value.min : 0,
        max: Number.isInteger(value?.max) ? value.max : Number.POSITIVE_INFINITY
    };
}

class QueryCountClient {
    constructor(responder = async () => ({ rows: [], rowCount: 0 })) {
        this.responder = responder;
        this.calls = [];
        this.currentPhase = 'unscoped';
    }

    async query(queryConfig, values) {
        const text = compactSql(typeof queryConfig === 'string' ? queryConfig : queryConfig?.text);
        const params = values ?? (typeof queryConfig === 'object' ? queryConfig.values : undefined) ?? [];
        const call = {
            index: this.calls.length + 1,
            phase: this.currentPhase,
            category: classifyQuery(text),
            sql: text
        };
        this.calls.push(call);
        return this.responder({ text, params, call });
    }

    async inPhase(phase, callback) {
        const previous = this.currentPhase;
        this.currentPhase = phase;
        try {
            return await callback();
        } finally {
            this.currentPhase = previous;
        }
    }

    count(field, value) {
        return this.calls.filter(call => call[field] === value).length;
    }

    assertBudgets({ phases = {}, categories = {} } = {}) {
        const failures = [];
        const excess = [];
        for (const [phase, rawBudget] of Object.entries(phases)) {
            const budget = normalizeBudget(rawBudget);
            const matching = this.calls.filter(call => call.phase === phase);
            if (matching.length < budget.min || matching.length > budget.max) {
                failures.push(`phase ${phase}: expected ${budget.min}-${budget.max}, actual ${matching.length}`);
                if (matching.length > budget.max) excess.push(...matching.slice(budget.max));
            }
        }
        for (const [category, rawBudget] of Object.entries(categories)) {
            const budget = normalizeBudget(rawBudget);
            const matching = this.calls.filter(call => call.category === category);
            if (matching.length < budget.min || matching.length > budget.max) {
                failures.push(`category ${category}: expected ${budget.min}-${budget.max}, actual ${matching.length}`);
                if (matching.length > budget.max) excess.push(...matching.slice(budget.max));
            }
        }
        if (!failures.length) return;
        const uniqueExcess = [...new Map(excess.map(call => [call.index, call])).values()];
        const queryList = uniqueExcess.length
            ? `\nExcess queries:\n${uniqueExcess.map(call => (
                `#${call.index} [${call.phase}/${call.category}] ${call.sql.slice(0, 240)}`
            )).join('\n')}`
            : '';
        throw new Error(`Query budget failed:\n${failures.join('\n')}${queryList}`);
    }
}

module.exports = {
    QueryCountClient,
    classifyQuery,
    compactSql
};
