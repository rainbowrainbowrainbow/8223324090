'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const express = require('express');
const ExcelJS = require('exceljs');

let server;
let baseUrl;
let payrollServiceCache;

const blockedCode = 'PAYROLL_SIMULTANEOUS_ADDITIONAL_SNAPSHOT_INVALID';
const blockedMessage = 'Compensation snapshot потребує перевірки';

const report = {
    month: '2026-07',
    staff: [
        {
            staffId: 7,
            name: 'Payroll Ready QA',
            daysWorked: 1,
            hoursWorked: 9,
            baseAmount: 900,
            overtimeAmount: 0,
            grossAmount: 2600,
            deductionsAmount: 0,
            advancesAmount: 0,
            netAmount: 2600,
            professionRateSummary: [],
            reconciliation: { days: [] },
            payrollBlockingIssues: [],
            payrollTransparency: {
                physicalHours: 9,
                baseRoleHours: 9,
                additionalRoleHours: 8.5,
                additionalAmount: 1700,
                additionalRoles: [{
                    professionKey: 'hallkeeper',
                    minutes: 510,
                    hours: 8.5,
                    rate: 200,
                    rateSource: 'staff_profession_rates.hourly_rate',
                    multiplier: 1,
                    amount: 1700,
                    attendanceRef: 44,
                    segmentRef: 502,
                    roleRef: 702,
                    policyVersion: 'simultaneous-profession-pay-v1',
                    formula: '510 / 60 * 200 * 1',
                    status: 'ready',
                    blockerCode: null,
                    blockerMessage: null
                }]
            }
        },
        {
            staffId: 8,
            name: 'Payroll Blocked QA',
            daysWorked: 1,
            hoursWorked: 9,
            baseAmount: 900,
            overtimeAmount: 0,
            grossAmount: 900,
            deductionsAmount: 0,
            advancesAmount: 0,
            netAmount: 900,
            professionRateSummary: [],
            reconciliation: { days: [] },
            payrollBlockingIssues: [{
                code: blockedCode,
                message: blockedMessage,
                professionKey: 'hallkeeper',
                paidRoleMinutes: 510,
                date: '2026-07-22',
                attendanceRef: 45,
                segmentRef: 503,
                roleRef: 703
            }],
            payrollTransparency: {
                physicalHours: 9,
                baseRoleHours: 9,
                additionalRoleHours: 8.5,
                additionalAmount: 0,
                additionalRoles: [{
                    professionKey: 'hallkeeper',
                    minutes: 510,
                    hours: 8.5,
                    rate: null,
                    rateSource: null,
                    multiplier: 1,
                    amount: null,
                    attendanceRef: 45,
                    segmentRef: 503,
                    roleRef: 703,
                    policyVersion: 'simultaneous-profession-pay-v1',
                    workDate: '2026-07-22',
                    status: 'blocked',
                    blockerCode: blockedCode,
                    blockerMessage: blockedMessage
                }]
            }
        }
    ]
};

function csvRows(text) {
    const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    const headers = lines[0].split(';');
    return lines.slice(1).map(line => {
        const values = line.split(';');
        return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    });
}

function xlsxValue(sheet, rowNumber, header) {
    const columnNumber = sheet.getRow(1).values.findIndex(value => value === header);
    assert.ok(columnNumber > 0, `missing XLSX column ${header}`);
    return sheet.getRow(rowNumber).getCell(columnNumber).value;
}

before(async () => {
    const payrollServiceId = require.resolve('../services/payroll');
    const payrollRouteId = require.resolve('../routes/payroll');
    payrollServiceCache = require.cache[payrollServiceId];
    require.cache[payrollServiceId] = {
        id: payrollServiceId,
        filename: payrollServiceId,
        loaded: true,
        exports: {
            SCHEME_TYPES: ['hourly'],
            REPORT_STATUSES: ['draft'],
            getSalaryReport: async () => report,
            getPayrollWorkspace: async () => ({ month: report.month, staff: [], schemes: [], totals: {} }),
            getPayrollPreview: async () => report.staff[0],
            createPayrollScheme: async () => ({}),
            updatePayrollScheme: async () => ({}),
            generatePayrollReports: async () => ({ success: true, reports: [] }),
            updatePayrollReportStatus: async () => ({}),
            normalizePayrollMonth: value => value
        }
    };
    delete require.cache[payrollRouteId];
    const payrollRouter = require('../routes/payroll');

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.user = { id: 1, username: 'payroll-route-test', role: 'creator' };
        next();
    });
    app.use('/api/payroll', payrollRouter);
    await new Promise(resolve => {
        server = app.listen(0, '127.0.0.1', () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
});

after(async () => {
    if (server) {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    const payrollServiceId = require.resolve('../services/payroll');
    const payrollRouteId = require.resolve('../routes/payroll');
    if (payrollServiceCache) require.cache[payrollServiceId] = payrollServiceCache;
    else delete require.cache[payrollServiceId];
    delete require.cache[payrollRouteId];
});

test('CSV keeps ready and blocked additional payroll lines aligned with report breakdown', async () => {
    const response = await fetch(`${baseUrl}/api/payroll/export?month=2026-07`);
    assert.equal(response.status, 200);
    const rows = csvRows(await response.text());
    assert.equal(rows.length, 2);

    assert.deepEqual({
        physical: rows[0].physical_hours,
        base: rows[0].base_role_hours,
        additional: rows[0].additional_role_hours,
        rate: rows[0].additional_rate,
        multiplier: rows[0].additional_multiplier,
        amount: rows[0].additional_amount,
        status: rows[0].additional_line_status,
        blockerCode: rows[0].blocker_code
    }, {
        physical: '9',
        base: '9',
        additional: '8.5',
        rate: '200',
        multiplier: '1',
        amount: '1700',
        status: 'ready',
        blockerCode: ''
    });
    assert.equal(rows[1].additional_amount, '0');
    assert.equal(rows[1].additional_line_status, 'blocked');
    assert.equal(rows[1].blocker_code, blockedCode);
    assert.equal(rows[1].blocker_message, blockedMessage);
    assert.equal(rows[1].payroll_blocking_codes, blockedCode);
});

test('XLSX summary and additional-lines sheets expose the same blocker contract', async () => {
    const response = await fetch(`${baseUrl}/api/payroll/export-xlsx?month=2026-07`);
    assert.equal(response.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));

    const summary = workbook.getWorksheet('Payroll');
    const lines = workbook.getWorksheet('Additional lines');
    assert.ok(summary);
    assert.ok(lines);
    assert.equal(xlsxValue(summary, 2, 'physical_hours'), 9);
    assert.equal(xlsxValue(summary, 2, 'additional_amount'), 1700);
    assert.equal(xlsxValue(summary, 3, 'additional_line_status'), 'blocked');
    assert.equal(xlsxValue(summary, 3, 'blocker_code'), blockedCode);

    assert.equal(lines.rowCount, 3);
    assert.equal(xlsxValue(lines, 2, 'status'), 'ready');
    assert.equal(xlsxValue(lines, 2, 'additional_amount'), 1700);
    assert.equal(xlsxValue(lines, 3, 'status'), 'blocked');
    assert.equal(xlsxValue(lines, 3, 'additional_amount'), null);
    assert.equal(xlsxValue(lines, 3, 'blocker_code'), blockedCode);
    assert.equal(xlsxValue(lines, 3, 'blocker_message'), blockedMessage);
});
