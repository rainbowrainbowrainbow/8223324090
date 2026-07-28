const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const payrollSource = fs.readFileSync(path.join(ROOT, 'services', 'payroll.js'), 'utf8');

function readFunctionSource(name) {
    const start = payrollSource.indexOf(`async function ${name}`);
    assert.notEqual(start, -1, `missing ${name}`);
    const next = payrollSource.slice(start + 1).search(/\nasync function /);
    return payrollSource.slice(start, next === -1 ? payrollSource.length : start + 1 + next);
}

function buildFetchAdjustments(pool) {
    const fetchAdjustmentsSource = readFunctionSource('fetchAdjustments');
    return new Function('pool', 'log', `
        const PAYROLL_ADJUSTMENTS_UNAVAILABLE = 'PAYROLL_ADJUSTMENTS_UNAVAILABLE';
        const PAYROLL_ADJUSTMENTS_UNAVAILABLE_MESSAGE = 'Не вдалося достовірно прочитати коригування зарплати';
        const PAYROLL_ZRS_TYPE = 'zrs';
        const LEGACY_ZRS_TYPE = 'advance';
        function toNumber(value, fallback = 0) {
            const num = Number(value);
            return Number.isFinite(num) ? num : fallback;
        }
        function normalizePayrollAdjustmentType(value) {
            const type = String(value || '').trim().toLowerCase();
            return type === LEGACY_ZRS_TYPE ? PAYROLL_ZRS_TYPE : type;
        }
        function payrollAdjustmentsUnavailableError(cause) {
            const err = new Error(PAYROLL_ADJUSTMENTS_UNAVAILABLE_MESSAGE);
            err.status = 503;
            err.statusCode = 503;
            err.code = PAYROLL_ADJUSTMENTS_UNAVAILABLE;
            err.cause = cause;
            return err;
        }
        ${fetchAdjustmentsSource}
        return fetchAdjustments;
    `)(pool, { error() {} });
}

test('fetchAdjustments returns an empty map for a valid month without adjustments', async () => {
    const queries = [];
    const fetchAdjustments = buildFetchAdjustments({
        async query(text, params) {
            queries.push({ text, params });
            return { rows: [] };
        }
    });

    const result = await fetchAdjustments('2026-05');

    assert.equal(result instanceof Map, true);
    assert.equal(result.size, 0);
    assert.match(queries[0].text, /COALESCE\(status, 'applied'\) = 'applied'/);
    assert.deepEqual(queries[0].params, ['2026-05']);
});

test('fetchAdjustments aggregates only rows returned by the applied-status query', async () => {
    const fetchAdjustments = buildFetchAdjustments({
        async query() {
            return {
                rows: [
                    { staff_id: 7, type: 'advance', total: '100' },
                    { staff_id: 7, type: 'bonus', total: '25' }
                ]
            };
        }
    });

    const result = await fetchAdjustments('2026-05');

    assert.deepEqual(result.get(7), {
        bonus: 25,
        kpi_bonus: 0,
        tip: 0,
        deduction: 0,
        penalty: 0,
        zrs: 100,
        advance: 0
    });
});

test('fetchAdjustments fails closed when salary_adjustments cannot be read', async () => {
    const cause = new Error('connection lost');
    cause.code = 'ECONNRESET';
    const fetchAdjustments = buildFetchAdjustments({
        async query() {
            throw cause;
        }
    });

    await assert.rejects(
        () => fetchAdjustments('2026-05'),
        error => error.code === 'PAYROLL_ADJUSTMENTS_UNAVAILABLE'
            && error.statusCode === 503
            && error.cause === cause
    );
});

test('payroll adjustment source no longer contains legacy schema fallback to empty payroll', () => {
    assert.doesNotMatch(payrollSource, /readAdjustments\(false\)/);
    assert.doesNotMatch(payrollSource, /salary_adjustments query failed:[\s\S]{0,200}return new Map\(\)/);
    assert.match(payrollSource, /PAYROLL_ADJUSTMENTS_UNAVAILABLE/);
});
