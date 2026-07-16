'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const {
    MAX_DATES,
    MAX_STAFF_ROWS,
    safeWorksheetName,
    buildStaffScheduleWorkbookBuffer
} = require('../services/staffScheduleWorkbook');

function workbookPayload(overrides = {}) {
    return {
        period: {
            from: '2026-07-01',
            to: '2026-07-02',
            label: '1 липня — 2 липня 2026',
            generatedAt: '16.07.2026, 18:30:00'
        },
        dates: [
            { date: '2026-07-01', day: '1', weekday: 'Ср' },
            { date: '2026-07-02', day: '2', weekday: 'Чт' }
        ],
        sheets: [
            {
                name: 'Reception',
                label: 'Рецепшен',
                rows: [{
                    staffId: 101,
                    department: 'reception',
                    departmentLabel: 'Рецепшен',
                    subGroupLabel: 'Менеджери',
                    employee: 'Працівник Reception',
                    role: 'Менеджер',
                    cells: [
                        { status: 'working', text: '09:00-18:00 · Менеджер\nРазом: 8 год' },
                        { status: 'dayoff', text: 'Вихідний' }
                    ]
                }]
            },
            {
                name: 'Admin',
                label: 'Адміністрація',
                rows: [{
                    staffId: 202,
                    department: 'admin',
                    departmentLabel: 'Адміністрація',
                    subGroupLabel: '',
                    employee: 'Працівник Admin',
                    role: 'Адміністратор',
                    cells: [
                        { status: 'remote', text: '10:00-19:00 · Адміністратор' },
                        { status: 'sick', text: 'Лікарняний' }
                    ]
                }]
            }
        ],
        ...overrides
    };
}

test('staff schedule export creates real worksheets with department-owned rows', async () => {
    const { buffer, filename } = await buildStaffScheduleWorkbookBuffer(workbookPayload());
    assert.equal(filename, 'grafik_2026-07-01_2026-07-02.xlsx');
    assert.ok(buffer.subarray(0, 2).equals(Buffer.from('PK')), 'xlsx must be a ZIP-based Office workbook');

    const parsed = new ExcelJS.Workbook();
    await parsed.xlsx.load(buffer);
    assert.deepEqual(parsed.worksheets.map(sheet => sheet.name), ['Reception', 'Admin']);

    const reception = parsed.getWorksheet('Reception');
    const admin = parsed.getWorksheet('Admin');
    assert.equal(reception.getColumn(1).hidden, true, 'staff IDs stay available for QA but hidden from users');
    assert.equal(reception.getColumn(2).hidden, true, 'department keys stay available for QA but hidden from users');
    assert.equal(reception.getCell('A4').value, 101);
    assert.equal(reception.getCell('B4').value, 'reception');
    assert.equal(reception.getCell('E4').value, 'Працівник Reception');
    assert.match(String(reception.getCell('G4').value), /09:00-18:00/);
    assert.equal(reception.getCell('A5').value, null, 'admin row must not leak into Reception');
    assert.equal(admin.getCell('A4').value, 202);
    assert.equal(admin.getCell('B4').value, 'admin');
    assert.equal(admin.getCell('E4').value, 'Працівник Admin');
    assert.equal(admin.getCell('A5').value, null, 'Reception row must not leak into Admin');
});

test('staff schedule worksheet names are Excel-safe, bounded, and unique', () => {
    const used = new Set();
    const first = safeWorksheetName("'Reception/Admin:Very*Long?Department[North]'", used);
    const second = safeWorksheetName("'Reception/Admin:Very*Long?Department[North]'", used);
    assert.ok(first.length <= 31);
    assert.ok(second.length <= 31);
    assert.doesNotMatch(first, /[\\/?*\[\]:]/);
    assert.notEqual(first.toLowerCase(), second.toLowerCase());
    assert.doesNotMatch(first, /^'|'$/);
});

test('staff schedule workbook rejects oversized or inconsistent payloads', async () => {
    const tooManyDates = Array.from({ length: MAX_DATES + 1 }, (_, index) => ({
        date: `2026-07-${String(index + 1).padStart(2, '0')}`,
        day: String(index + 1),
        weekday: 'День'
    }));
    await assert.rejects(
        buildStaffScheduleWorkbookBuffer(workbookPayload({ dates: tooManyDates })),
        /Кількість дат/
    );

    const rows = Array.from({ length: MAX_STAFF_ROWS + 1 }, (_, index) => ({
        staffId: index + 1,
        employee: `Працівник ${index + 1}`,
        cells: [{ status: 'unset', text: '' }, { status: 'unset', text: '' }]
    }));
    const oversized = workbookPayload();
    oversized.sheets = [{ name: 'All', label: 'Усі', rows }];
    await assert.rejects(buildStaffScheduleWorkbookBuffer(oversized), /не може містити більше/);

    const inconsistent = workbookPayload();
    inconsistent.sheets[0].rows[0].cells.pop();
    await assert.rejects(buildStaffScheduleWorkbookBuffer(inconsistent), /не відповідає періоду/);
});
