'use strict';

const ExcelJS = require('exceljs');

const MAX_SHEETS = 20;
const MAX_DATES = 31;
const MAX_STAFF_ROWS = 500;
const MAX_CELL_TEXT = 2000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_STATUS_RE = /^[a-z0-9_-]{1,32}$/i;

const STATUS_FILLS = Object.freeze({
    working: 'DCFCE7',
    remote: 'E0E7FF',
    dayoff: 'F1F5F9',
    day_off: 'F1F5F9',
    vacation: 'DBEAFE',
    sick: 'FEE2E2',
    unset: 'FFFFFF'
});

function workbookInputError(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

function boundedText(value, maxLength, label) {
    const text = String(value ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    if (text.length > maxLength) {
        throw workbookInputError(`${label} перевищує допустиму довжину`);
    }
    return text;
}

function validIsoDate(value, label) {
    const text = String(value || '').trim();
    if (!ISO_DATE_RE.test(text)) throw workbookInputError(`${label} має бути у форматі YYYY-MM-DD`);
    const date = new Date(`${text}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
        throw workbookInputError(`${label} містить некоректну дату`);
    }
    return text;
}

function safeWorksheetName(label = '', usedNames = new Set()) {
    const cleaned = String(label || '')
        .replace(/[\\/?*\[\]:]/g, ' ')
        .replace(/^'+|'+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const base = (cleaned || 'Графік').slice(0, 31) || 'Графік';
    let name = base;
    let counter = 2;
    while (usedNames.has(name.toLowerCase())) {
        const suffix = ` ${counter++}`;
        name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    }
    usedNames.add(name.toLowerCase());
    return name;
}

function normalizeStaffScheduleWorkbookPayload(payload = {}) {
    const period = payload && typeof payload.period === 'object' ? payload.period : {};
    const from = validIsoDate(period.from, 'Початок періоду');
    const to = validIsoDate(period.to, 'Кінець періоду');
    if (to < from) throw workbookInputError('Кінець періоду не може бути раніше початку');

    const inputDates = Array.isArray(payload.dates) ? payload.dates : [];
    if (!inputDates.length || inputDates.length > MAX_DATES) {
        throw workbookInputError(`Кількість дат має бути від 1 до ${MAX_DATES}`);
    }
    const dates = inputDates.map((item, index) => ({
        date: validIsoDate(item?.date, `Дата ${index + 1}`),
        day: boundedText(item?.day, 4, `Номер дня ${index + 1}`),
        weekday: boundedText(item?.weekday, 16, `День тижня ${index + 1}`)
    }));
    if (dates[0].date !== from || dates[dates.length - 1].date !== to) {
        throw workbookInputError('Дати workbook не відповідають заявленому періоду');
    }
    for (let index = 1; index < dates.length; index += 1) {
        if (dates[index].date <= dates[index - 1].date) {
            throw workbookInputError('Дати workbook мають бути у зростаючому порядку');
        }
    }

    const inputSheets = Array.isArray(payload.sheets) ? payload.sheets : [];
    if (!inputSheets.length || inputSheets.length > MAX_SHEETS) {
        throw workbookInputError(`Кількість аркушів має бути від 1 до ${MAX_SHEETS}`);
    }

    const usedNames = new Set();
    let totalRows = 0;
    const sheets = inputSheets.map((sheet, sheetIndex) => {
        const label = boundedText(sheet?.label || sheet?.name || `Відділ ${sheetIndex + 1}`, 120, `Назва відділу ${sheetIndex + 1}`);
        const name = safeWorksheetName(sheet?.name || label, usedNames);
        const inputRows = Array.isArray(sheet?.rows) ? sheet.rows : [];
        totalRows += inputRows.length;
        if (totalRows > MAX_STAFF_ROWS) {
            throw workbookInputError(`Workbook не може містити більше ${MAX_STAFF_ROWS} працівників`);
        }
        const rows = inputRows.map((row, rowIndex) => {
            const staffId = Number(row?.staffId);
            if (!Number.isSafeInteger(staffId) || staffId <= 0) {
                throw workbookInputError(`Некоректний staffId у рядку ${rowIndex + 1} аркуша ${name}`);
            }
            const inputCells = Array.isArray(row?.cells) ? row.cells : [];
            if (inputCells.length !== dates.length) {
                throw workbookInputError(`Кількість комірок у рядку ${rowIndex + 1} аркуша ${name} не відповідає періоду`);
            }
            return {
                staffId,
                department: boundedText(row?.department || '', 80, 'Відділ'),
                departmentLabel: boundedText(row?.departmentLabel || label, 120, 'Назва відділу'),
                subGroupLabel: boundedText(row?.subGroupLabel || '', 120, 'Назва підгрупи'),
                employee: boundedText(row?.employee || '', 200, 'Імʼя працівника'),
                role: boundedText(row?.role || '', 200, 'Посада'),
                cells: inputCells.map((cell, cellIndex) => {
                    const status = String(cell?.status || 'unset').trim().toLowerCase();
                    if (!SAFE_STATUS_RE.test(status)) {
                        throw workbookInputError(`Некоректний статус у комірці ${cellIndex + 1} рядка ${rowIndex + 1}`);
                    }
                    return {
                        status,
                        text: boundedText(cell?.text || '', MAX_CELL_TEXT, 'Текст зміни')
                    };
                })
            };
        });
        return { name, label, rows };
    });

    return {
        period: {
            from,
            to,
            label: boundedText(period.label || `${from} — ${to}`, 160, 'Назва періоду'),
            generatedAt: boundedText(period.generatedAt || '', 80, 'Час створення')
        },
        dates,
        sheets
    };
}

function styleHeaderRow(row) {
    row.height = 34;
    row.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
    });
}

function buildStaffScheduleWorkbook(payload = {}) {
    const normalized = normalizeStaffScheduleWorkbookPayload(payload);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Event Genix CRM';
    workbook.created = new Date();
    workbook.modified = new Date();

    for (const sheet of normalized.sheets) {
        const worksheet = workbook.addWorksheet(sheet.name, {
            views: [{ state: 'frozen', xSplit: 6, ySplit: 3 }]
        });
        const lastColumn = 6 + normalized.dates.length;
        worksheet.pageSetup = {
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }
        };
        worksheet.properties.defaultRowHeight = 22;
        worksheet.mergeCells(1, 1, 1, lastColumn);
        worksheet.getCell(1, 1).value = `Графік роботи · ${sheet.label}`;
        worksheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: 'FF0F172A' } };
        worksheet.getCell(1, 1).alignment = { vertical: 'middle' };
        worksheet.getRow(1).height = 28;

        worksheet.mergeCells(2, 1, 2, lastColumn);
        worksheet.getCell(2, 1).value = `Період: ${normalized.period.label}${normalized.period.generatedAt ? ` · Згенеровано: ${normalized.period.generatedAt}` : ''}`;
        worksheet.getCell(2, 1).font = { size: 10, color: { argb: 'FF475569' } };

        const header = worksheet.addRow([
            'Staff ID',
            'Department key',
            'Відділ',
            'Підгрупа',
            'Співробітник',
            'Посада',
            ...normalized.dates.map(date => `${date.day}\n${date.weekday}`)
        ]);
        styleHeaderRow(header);
        worksheet.getColumn(1).hidden = true;
        worksheet.getColumn(2).hidden = true;
        worksheet.getColumn(1).width = 12;
        worksheet.getColumn(2).width = 18;
        worksheet.getColumn(3).width = 18;
        worksheet.getColumn(4).width = 20;
        worksheet.getColumn(5).width = 28;
        worksheet.getColumn(6).width = 24;
        for (let column = 7; column <= lastColumn; column += 1) worksheet.getColumn(column).width = 22;

        if (!sheet.rows.length) {
            const row = worksheet.addRow(['', '', 'Немає співробітників у поточному фільтрі']);
            worksheet.mergeCells(row.number, 3, row.number, lastColumn);
            row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
            row.getCell(3).font = { italic: true, color: { argb: 'FF64748B' } };
        } else {
            for (const item of sheet.rows) {
                const row = worksheet.addRow([
                    item.staffId,
                    item.department,
                    item.departmentLabel,
                    item.subGroupLabel,
                    item.employee,
                    item.role,
                    ...item.cells.map(cell => cell.text)
                ]);
                const maxLines = Math.max(1, ...item.cells.map(cell => String(cell.text || '').split('\n').length));
                row.height = Math.min(90, Math.max(24, 15 * maxLines));
                row.eachCell((cell, columnNumber) => {
                    cell.numFmt = '@';
                    cell.alignment = {
                        horizontal: columnNumber >= 7 ? 'center' : 'left',
                        vertical: 'middle',
                        wrapText: true
                    };
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
                    };
                });
                item.cells.forEach((cell, index) => {
                    const worksheetCell = row.getCell(7 + index);
                    const fill = STATUS_FILLS[cell.status] || STATUS_FILLS.unset;
                    worksheetCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${fill}` } };
                    if (cell.status === 'working' || cell.status === 'remote') worksheetCell.font = { bold: true };
                });
            }
        }

        worksheet.autoFilter = { from: { row: 3, column: 3 }, to: { row: 3, column: lastColumn } };
        worksheet.pageSetup.printArea = `C1:${worksheet.getColumn(lastColumn).letter}${Math.max(4, worksheet.rowCount)}`;
    }

    return { workbook, normalized };
}

async function buildStaffScheduleWorkbookBuffer(payload = {}) {
    const { workbook, normalized } = buildStaffScheduleWorkbook(payload);
    const value = await workbook.xlsx.writeBuffer();
    return {
        buffer: Buffer.from(value),
        filename: `grafik_${normalized.period.from}_${normalized.period.to}.xlsx`,
        normalized
    };
}

module.exports = {
    MAX_DATES,
    MAX_SHEETS,
    MAX_STAFF_ROWS,
    safeWorksheetName,
    normalizeStaffScheduleWorkbookPayload,
    buildStaffScheduleWorkbook,
    buildStaffScheduleWorkbookBuffer
};
