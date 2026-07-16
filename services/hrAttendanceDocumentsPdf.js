'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { CONTRACT_VERSION } = require('./hrAttendanceDocuments');

const ROOT_DIR = path.resolve(__dirname, '..');
const FONT_DIR = path.join(ROOT_DIR, 'assets', 'fonts');
const FONT_PATHS = Object.freeze({
    regular: path.join(FONT_DIR, 'Nunito.ttf'),
    bold: path.join(FONT_DIR, 'Nunito-Bold.ttf'),
    black: path.join(FONT_DIR, 'Nunito-Black.ttf')
});
const MM = 72 / 25.4;
const COLORS = Object.freeze({
    header: '#212429',
    dailyMeta: '#F0F0F0',
    monthlyMeta: '#F6F6F6',
    category: '#E8E8E8',
    zebra: '#F9F9F9',
    inactiveDay: '#EEEEEE',
    paper: '#FFFFFF',
    ink: '#000000'
});
const DAILY_LAYOUT = Object.freeze({
    pageSize: 'A4',
    pageLayout: 'portrait',
    margin: 4.7 * MM,
    topMargin: 3 * MM,
    headerHeight: 7.4 * MM,
    metaHeight: 6.2 * MM,
    headerGap: 2 * MM,
    bodyGap: 1.4 * MM,
    categoryHeight: 4.3 * MM,
    employeeHeight: 10.9 * MM,
    footerSafe: 6.4 * MM,
    timeBoxWidth: 11.3 * MM,
    timeBoxHeight: 7.4 * MM
});
const MONTH_LAYOUT = Object.freeze({
    pageSize: 'A4',
    pageLayout: 'landscape',
    margin: 4.7 * MM,
    topMargin: 3 * MM,
    headerHeight: 7.9 * MM,
    metaHeight: 5.4 * MM,
    legendHeight: 6.9 * MM,
    headerGap: 1.8 * MM,
    blockGap: 1.4 * MM,
    tableHeaderHeight: 6.2 * MM,
    categoryHeight: 2.9 * MM,
    employeeHeight: 7.3 * MM,
    nameWidth: 59.8 * MM,
    markSquare: 4.7 * MM,
    footerSafe: 6.4 * MM
});
const PAGE_DIMENSIONS = Object.freeze({
    portrait: Object.freeze({ width: 595.28, height: 841.89 }),
    landscape: Object.freeze({ width: 841.89, height: 595.28 })
});
const GEAR_PATH = `
M46,4 L54,4 L56,16 C59,16.5 62,17.5 64.5,19 L74,11 L80,17
L72,27 C73.8,29.5 75.2,32.3 76,35.2 L88,34 L90,42 L78.5,46
C78.8,49 78.8,51 78.5,54 L90,58 L88,66 L76,64.8
C75.2,67.7 73.8,70.5 72,73 L80,83 L74,89 L64.5,81
C62,82.5 59,83.5 56,84 L54,96 L46,96 L44,84
C41,83.5 38,82.5 35.5,81 L26,89 L20,83 L28,73
C26.2,70.5 24.8,67.7 24,64.8 L12,66 L10,58 L21.5,54
C21.2,51 21.2,49 21.5,46 L10,42 L12,34 L24,35.2
C24.8,32.3 26.2,29.5 28,27 L20,17 L26,11 L35.5,19
C38,17.5 41,16.5 44,16 Z`;

function pdfError(message, code = 'HR_ATTENDANCE_DOCUMENT_PDF_ERROR', statusCode = 500, details = undefined) {
    const err = new Error(message);
    err.code = code;
    err.statusCode = statusCode;
    if (details !== undefined) err.details = details;
    return err;
}

function resolveFonts() {
    const missing = Object.entries(FONT_PATHS).filter(([, filePath]) => !fs.existsSync(filePath));
    if (missing.length) {
        throw pdfError('PDF font with Cyrillic support is not available', 'pdf_font_missing', 500, missing.map(([key]) => key));
    }
    return FONT_PATHS;
}

function registerFonts(doc) {
    const fonts = resolveFonts();
    doc.registerFont('FormRegular', fonts.regular);
    doc.registerFont('FormBold', fonts.bold);
    doc.registerFont('FormBlack', fonts.black);
}

function bodyGeometry(templateId) {
    if (templateId === 'arrival_inout') {
        const page = PAGE_DIMENSIONS.portrait;
        const top = DAILY_LAYOUT.topMargin
            + DAILY_LAYOUT.headerHeight
            + DAILY_LAYOUT.headerGap
            + DAILY_LAYOUT.metaHeight
            + DAILY_LAYOUT.bodyGap;
        const bottom = page.height - DAILY_LAYOUT.footerSafe;
        return { top, bottom, capacity: bottom - top, page };
    }
    const page = PAGE_DIMENSIONS.landscape;
    const top = MONTH_LAYOUT.topMargin
        + MONTH_LAYOUT.headerHeight
        + MONTH_LAYOUT.headerGap
        + MONTH_LAYOUT.metaHeight
        + MONTH_LAYOUT.blockGap
        + MONTH_LAYOUT.legendHeight
        + MONTH_LAYOUT.blockGap;
    const bottom = page.height - MONTH_LAYOUT.footerSafe;
    return {
        top,
        bottom,
        capacity: bottom - top - MONTH_LAYOUT.tableHeaderHeight,
        page
    };
}

function segmentHeight(templateId, employeeCount) {
    const layout = templateId === 'arrival_inout' ? DAILY_LAYOUT : MONTH_LAYOUT;
    return layout.categoryHeight + (layout.employeeHeight * employeeCount);
}

function newPlanPage(templateId, lane = null) {
    return { templateId, lane, segments: [], usedHeight: 0 };
}

function paginateCategory(page, pages, category, templateId, capacity, lane) {
    const layout = templateId === 'arrival_inout' ? DAILY_LAYOUT : MONTH_LAYOUT;
    const employees = category.employees || [];
    const wholeHeight = segmentHeight(templateId, employees.length);
    const remaining = capacity - page.usedHeight;

    if (wholeHeight <= remaining) {
        page.segments.push({ category, employees, startIndex: 0, continued: false });
        page.usedHeight += wholeHeight;
        return page;
    }

    if (wholeHeight <= capacity && page.segments.length) {
        page = newPlanPage(templateId, lane);
        pages.push(page);
        page.segments.push({ category, employees, startIndex: 0, continued: false });
        page.usedHeight = wholeHeight;
        return page;
    }

    if (!employees.length) {
        if (page.segments.length) {
            page = newPlanPage(templateId, lane);
            pages.push(page);
        }
        page.segments.push({ category, employees: [], startIndex: 0, continued: false });
        page.usedHeight = layout.categoryHeight;
        return page;
    }

    let startIndex = 0;
    let continued = false;
    while (startIndex < employees.length) {
        let available = capacity - page.usedHeight;
        let fit = Math.floor((available - layout.categoryHeight) / layout.employeeHeight);
        if (fit < 1) {
            page = newPlanPage(templateId, lane);
            pages.push(page);
            available = capacity;
            fit = Math.floor((available - layout.categoryHeight) / layout.employeeHeight);
        }
        if (fit < 1) throw pdfError('Page cannot fit one employee row', 'HR_ATTENDANCE_DOCUMENT_LAYOUT_ERROR');
        const chunk = employees.slice(startIndex, startIndex + fit);
        page.segments.push({ category, employees: chunk, startIndex, continued });
        page.usedHeight += segmentHeight(templateId, chunk.length);
        startIndex += chunk.length;
        continued = true;
        if (startIndex < employees.length) {
            page = newPlanPage(templateId, lane);
            pages.push(page);
        }
    }
    return page;
}

function paginateHrAttendanceDocument(snapshot) {
    const templateId = snapshot?.templateId;
    if (!['arrival_inout', 'month_grid'].includes(templateId)) {
        throw pdfError('Unsupported attendance document template', 'HR_ATTENDANCE_DOCUMENT_INVALID_SNAPSHOT', 400);
    }
    const { capacity } = bodyGeometry(templateId);
    const pages = [];
    let page = newPlanPage(templateId, templateId === 'month_grid' ? null : 1);
    pages.push(page);

    let currentLane = null;
    for (const category of snapshot.categories || []) {
        const lane = templateId === 'month_grid' ? Number(category.monthlyPage) || 1 : 1;
        if (templateId === 'month_grid' && currentLane !== null && lane !== currentLane && page.segments.length) {
            page = newPlanPage(templateId, lane);
            pages.push(page);
        }
        currentLane = lane;
        if (templateId === 'month_grid' && page.lane === null) page.lane = lane;
        page = paginateCategory(page, pages, category, templateId, capacity, lane);
    }
    if (pages.length > 1 && pages[pages.length - 1].segments.length === 0) pages.pop();
    return Object.freeze(pages.map(item => Object.freeze({
        ...item,
        segments: Object.freeze(item.segments.map(segment => Object.freeze(segment)))
    })));
}

function setStroke(doc, width = 0.55, color = COLORS.ink) {
    doc.lineWidth(width).strokeColor(color);
}

function drawGear(doc, x, y, size) {
    const scale = size / 100;
    doc.save().translate(x, y).scale(scale);
    doc.path(GEAR_PATH).lineWidth(5).strokeColor('#FFFFFF').stroke();
    doc.circle(50, 50, 26).lineWidth(4).stroke('#FFFFFF');
    doc.circle(50, 50, 11).lineWidth(4).stroke('#FFFFFF');
    doc.restore();
}

function drawTextFit(doc, text, options) {
    const value = String(text || '');
    const font = options.font || 'FormBold';
    const maxSize = Number(options.maxSize);
    const minSize = Number(options.minSize ?? maxSize);
    const step = Number(options.step || 0.5);
    let size = maxSize;
    doc.font(font);
    while (size >= minSize) {
        doc.fontSize(size);
        if (doc.widthOfString(value) <= options.width) break;
        size -= step;
    }
    if (size < minSize) {
        throw pdfError(
            `Text does not fit: ${options.field || 'text'}`,
            'HR_ATTENDANCE_DOCUMENT_TEXT_OVERFLOW',
            400,
            { field: options.field || 'text', categoryId: options.categoryId || null }
        );
    }
    doc.fillColor(options.color || COLORS.ink).text(value, options.x, options.y, {
        width: options.width,
        height: options.height,
        align: options.align || 'left',
        lineBreak: false,
        ellipsis: false
    });
    return size;
}

function drawHeader(doc, snapshot, pageNumber, pageCount, page) {
    const layout = snapshot.templateId === 'arrival_inout' ? DAILY_LAYOUT : MONTH_LAYOUT;
    const x = layout.margin;
    const y = layout.topMargin;
    const width = page.width - (layout.margin * 2);
    const height = layout.headerHeight;
    doc.roundedRect(x, y, width, height, 2.5).fill(COLORS.header);
    const gearSize = height - 5;
    drawGear(doc, x + 6, y + 2.5, gearSize);
    doc.fillColor('#FFFFFF').font('FormBold').fontSize(6.8)
        .text('CRM Event Genix', x + gearSize + 11, y + 4.2, { width: 100, lineBreak: false });
    doc.font('FormRegular').fontSize(3.8)
        .text('CRM, яка працює разом із вами', x + gearSize + 11, y + 12.3, { width: 110, lineBreak: false });
    const counterWidth = 42;
    drawTextFit(doc, snapshot.settings.texts.title, {
        x: x + 145,
        y: y + 2.6,
        width: width - 290,
        height: height - 4,
        font: 'FormBlack',
        maxSize: snapshot.settings.fontPreset.values.title,
        minSize: 12,
        align: 'center',
        color: '#FFFFFF',
        field: 'title'
    });
    doc.font('FormBold').fontSize(5.6).fillColor('#FFFFFF')
        .text(`P${pageNumber}/${pageCount}`, x + width - counterWidth - 5, y + 6.5, {
            width: counterWidth,
            align: 'right',
            lineBreak: false
        });
}

function drawBox(doc, x, y, width, height, fill) {
    doc.roundedRect(x, y, width, height, 1.8).fillAndStroke(fill, COLORS.ink);
}

function drawMetaText(doc, label, value, x, y, width, height, fontSize) {
    const text = value ? `${label}: ${value}` : label;
    drawTextFit(doc, text, {
        x: x + 4,
        y: y + Math.max(2, (height - fontSize) / 2 - 1),
        width: width - 8,
        height: height - 3,
        font: 'FormBold',
        maxSize: fontSize,
        minSize: Math.max(6, fontSize - 2),
        field: label
    });
}

function drawDailyMeta(doc, snapshot, page) {
    const x = DAILY_LAYOUT.margin;
    const y = DAILY_LAYOUT.topMargin + DAILY_LAYOUT.headerHeight + DAILY_LAYOUT.headerGap;
    const width = page.width - (x * 2);
    const gap = 4;
    const widths = [(width - gap * 2) * 0.29, (width - gap * 2) * 0.31, (width - gap * 2) * 0.40];
    const [year, month, day] = snapshot.settings.documentDate.split('-');
    const dateText = `ДАТА: ${day} / ${month} / ${year}`;
    let cursor = x;
    drawBox(doc, cursor, y, widths[0], DAILY_LAYOUT.metaHeight, COLORS.dailyMeta);
    drawMetaText(doc, dateText, '', cursor, y, widths[0], DAILY_LAYOUT.metaHeight, snapshot.settings.fontPreset.values.meta);
    cursor += widths[0] + gap;
    drawBox(doc, cursor, y, widths[1], DAILY_LAYOUT.metaHeight, COLORS.dailyMeta);
    drawMetaText(doc, snapshot.settings.texts.locationLabel, snapshot.settings.locationShift, cursor, y, widths[1], DAILY_LAYOUT.metaHeight, snapshot.settings.fontPreset.values.meta);
    cursor += widths[1] + gap;
    drawBox(doc, cursor, y, widths[2], DAILY_LAYOUT.metaHeight, COLORS.dailyMeta);
    drawMetaText(doc, snapshot.settings.texts.markedByLabel, snapshot.settings.markedBy, cursor, y, widths[2], DAILY_LAYOUT.metaHeight, snapshot.settings.fontPreset.values.meta);
}

function drawMonthMeta(doc, snapshot, page) {
    const x = MONTH_LAYOUT.margin;
    const y = MONTH_LAYOUT.topMargin + MONTH_LAYOUT.headerHeight + MONTH_LAYOUT.headerGap;
    const width = page.width - (x * 2);
    const gap = 4;
    const usable = width - (gap * 3);
    const widths = [usable * 0.155, usable * 0.205, usable * 0.205, usable * 0.435];
    const [year, month] = snapshot.settings.month.split('-');
    const cells = [
        [`Місяць: ${month}  Рік: ${year}`, ''],
        [snapshot.settings.texts.locationLabel, snapshot.settings.locationShift],
        [snapshot.settings.texts.markedByLabel, snapshot.settings.markedBy],
        [snapshot.settings.texts.monthlyInstruction, '']
    ];
    let cursor = x;
    widths.forEach((cellWidth, index) => {
        drawBox(doc, cursor, y, cellWidth, MONTH_LAYOUT.metaHeight, COLORS.monthlyMeta);
        drawMetaText(doc, cells[index][0], cells[index][1], cursor, y, cellWidth, MONTH_LAYOUT.metaHeight, snapshot.settings.fontPreset.values.meta);
        cursor += cellWidth + gap;
    });
    return y + MONTH_LAYOUT.metaHeight + MONTH_LAYOUT.blockGap;
}

function drawLegendSymbol(doc, type, x, y, size) {
    doc.rect(x, y, size, size).fillAndStroke(COLORS.paper, COLORS.ink);
    doc.save().rect(x, y, size, size).clip();
    setStroke(doc, 0.55);
    if (type === 'worked') {
        for (let offset = -size; offset < size * 2; offset += 3) {
            doc.moveTo(x + offset, y + size).lineTo(x + offset + size, y).stroke();
        }
    } else if (type === 'absent') {
        doc.moveTo(x + 1, y + 1).lineTo(x + size - 1, y + size - 1).stroke();
        doc.moveTo(x + size - 1, y + 1).lineTo(x + 1, y + size - 1).stroke();
    } else if (type === 'dayoff') {
        for (let offset = 3; offset < size; offset += 3) {
            doc.moveTo(x + 1, y + offset).lineTo(x + size - 1, y + offset).stroke();
        }
    }
    doc.restore();
}

function drawMonthLegend(doc, snapshot, page, y) {
    const x = MONTH_LAYOUT.margin;
    const width = page.width - (x * 2);
    drawBox(doc, x, y, width, MONTH_LAYOUT.legendHeight, COLORS.paper);
    doc.font('FormBold').fontSize(snapshot.settings.fontPreset.values.monthlyLegend).fillColor(COLORS.ink)
        .text('Легенда заштриховки:', x + 4, y + 5, { width: 105, lineBreak: false });
    const items = [
        ['empty', 'порожньо'],
        ['worked', 'працював'],
        ['absent', 'не вийшов'],
        ['dayoff', 'вихідний']
    ];
    const start = x + 115;
    const itemWidth = (width - 120) / items.length;
    items.forEach(([type, label], index) => {
        const itemX = start + (index * itemWidth);
        drawLegendSymbol(doc, type, itemX, y + 3.5, 10);
        doc.font('FormRegular').fontSize(snapshot.settings.fontPreset.values.monthlyLegend - 1).fillColor(COLORS.ink)
            .text(label, itemX + 14, y + 5, { width: itemWidth - 16, lineBreak: false });
    });
}

function categoryLabel(segment) {
    const suffix = segment.continued ? ' — продовження' : '';
    return `${segment.category.label}${suffix} (${segment.category.count})`;
}

function drawDailyTime(doc, label, time, x, y, width, rowHeight, snapshot) {
    const labelWidth = 45;
    const boxWidth = DAILY_LAYOUT.timeBoxWidth;
    const boxHeight = DAILY_LAYOUT.timeBoxHeight;
    const boxY = y + ((rowHeight - boxHeight) / 2);
    drawTextFit(doc, label, {
        x,
        y: y + ((rowHeight - snapshot.settings.fontPreset.values.dailyTimeLabel) / 2) - 1,
        width: labelWidth,
        height: rowHeight,
        font: 'FormBold',
        maxSize: snapshot.settings.fontPreset.values.dailyTimeLabel,
        minSize: 8,
        align: 'right',
        field: label
    });
    const firstX = x + labelWidth + 4;
    const secondX = firstX + boxWidth + 13;
    doc.rect(firstX, boxY, boxWidth, boxHeight).fillAndStroke(COLORS.paper, COLORS.ink);
    doc.rect(secondX, boxY, boxWidth, boxHeight).fillAndStroke(COLORS.paper, COLORS.ink);
    doc.font('FormBlack').fontSize(11).fillColor(COLORS.ink)
        .text(':', firstX + boxWidth + 3, boxY + 4, { width: 7, align: 'center', lineBreak: false });
    if (time) {
        const [hours, minutes] = String(time).split(':');
        doc.font('FormBold').fontSize(12)
            .text(hours || '', firstX, boxY + 4, { width: boxWidth, align: 'center', lineBreak: false })
            .text(minutes || '', secondX, boxY + 4, { width: boxWidth, align: 'center', lineBreak: false });
    }
}

function drawDailyBody(doc, snapshot, planPage, page) {
    const geometry = bodyGeometry(snapshot.templateId);
    const x = DAILY_LAYOUT.margin;
    const width = page.width - (x * 2);
    let y = geometry.top;
    for (const segment of planPage.segments) {
        doc.rect(x, y, width, DAILY_LAYOUT.categoryHeight).fillAndStroke(COLORS.category, COLORS.ink);
        drawTextFit(doc, categoryLabel(segment), {
            x: x + 3,
            y: y + 1.2,
            width: width - 6,
            height: DAILY_LAYOUT.categoryHeight - 2,
            font: 'FormBold',
            maxSize: snapshot.settings.fontPreset.values.dailyCategory,
            minSize: 6.5,
            field: 'categoryLabel',
            categoryId: segment.category.id
        });
        y += DAILY_LAYOUT.categoryHeight;
        segment.employees.forEach((employee, index) => {
            const globalIndex = segment.startIndex + index;
            doc.rect(x, y, width, DAILY_LAYOUT.employeeHeight)
                .fillAndStroke(globalIndex % 2 ? COLORS.zebra : COLORS.paper, COLORS.ink);
            drawTextFit(doc, employee.name, {
                x: x + 4,
                y: y + 7,
                width: 245,
                height: DAILY_LAYOUT.employeeHeight - 8,
                font: 'FormBlack',
                maxSize: snapshot.settings.fontPreset.values.dailyEmployee,
                minSize: 12,
                field: 'employeeName',
                categoryId: segment.category.id
            });
            drawDailyTime(doc, 'Прихід', employee.attendance?.clockIn, x + 250, y, 145, DAILY_LAYOUT.employeeHeight, snapshot);
            drawDailyTime(doc, 'Уход', employee.attendance?.clockOut, x + 385, y, 145, DAILY_LAYOUT.employeeHeight, snapshot);
            y += DAILY_LAYOUT.employeeHeight;
        });
    }
}

function drawMonthTableHeader(doc, snapshot, page, y) {
    const x = MONTH_LAYOUT.margin;
    const width = page.width - (x * 2);
    const dayWidth = (width - MONTH_LAYOUT.nameWidth) / 31;
    doc.rect(x, y, MONTH_LAYOUT.nameWidth, MONTH_LAYOUT.tableHeaderHeight).fillAndStroke(COLORS.category, COLORS.ink);
    doc.font('FormBold').fontSize(snapshot.settings.fontPreset.values.monthlyDayHeader).fillColor(COLORS.ink)
        .text('ПІБ / роль', x + 3, y + 5, { width: MONTH_LAYOUT.nameWidth - 6, lineBreak: false });
    for (let day = 1; day <= 31; day += 1) {
        const dayX = x + MONTH_LAYOUT.nameWidth + ((day - 1) * dayWidth);
        const inactive = day > snapshot.daysInMonth;
        doc.rect(dayX, y, dayWidth, MONTH_LAYOUT.tableHeaderHeight)
            .fillAndStroke(inactive ? COLORS.inactiveDay : COLORS.category, COLORS.ink);
        doc.font('FormBold').fontSize(snapshot.settings.fontPreset.values.monthlyDayHeader).fillColor(COLORS.ink)
            .text(String(day), dayX, y + 5, { width: dayWidth, align: 'center', lineBreak: false });
    }
    drawWeeklySeparators(doc, x, y, MONTH_LAYOUT.tableHeaderHeight, dayWidth);
    return { x, width, dayWidth };
}

function drawWeeklySeparators(doc, x, y, height, dayWidth) {
    setStroke(doc, 1.3);
    for (const day of [7, 14, 21, 28]) {
        const lineX = x + MONTH_LAYOUT.nameWidth + (day * dayWidth);
        doc.moveTo(lineX, y).lineTo(lineX, y + height).stroke();
    }
    setStroke(doc);
}

function drawMonthEmployeeRow(doc, snapshot, employee, rowIndex, page, y, grid) {
    const fill = rowIndex % 2 ? COLORS.zebra : COLORS.paper;
    doc.rect(grid.x, y, MONTH_LAYOUT.nameWidth, MONTH_LAYOUT.employeeHeight).fillAndStroke(fill, COLORS.ink);
    drawTextFit(doc, employee.name, {
        x: grid.x + 3,
        y: y + 5,
        width: MONTH_LAYOUT.nameWidth - 6,
        height: MONTH_LAYOUT.employeeHeight - 5,
        font: 'FormBold',
        maxSize: snapshot.settings.fontPreset.values.monthlyEmployee,
        minSize: 7,
        field: 'employeeName'
    });
    for (let day = 1; day <= 31; day += 1) {
        const dayX = grid.x + MONTH_LAYOUT.nameWidth + ((day - 1) * grid.dayWidth);
        const inactive = day > snapshot.daysInMonth;
        doc.rect(dayX, y, grid.dayWidth, MONTH_LAYOUT.employeeHeight)
            .fillAndStroke(inactive ? COLORS.inactiveDay : fill, COLORS.ink);
        if (!inactive) {
            const square = MONTH_LAYOUT.markSquare;
            doc.rect(
                dayX + ((grid.dayWidth - square) / 2),
                y + ((MONTH_LAYOUT.employeeHeight - square) / 2),
                square,
                square
            ).stroke(COLORS.ink);
        }
    }
    drawWeeklySeparators(doc, grid.x, y, MONTH_LAYOUT.employeeHeight, grid.dayWidth);
}

function drawMonthBody(doc, snapshot, planPage, page) {
    const geometry = bodyGeometry(snapshot.templateId);
    let y = geometry.top;
    const grid = drawMonthTableHeader(doc, snapshot, page, y);
    y += MONTH_LAYOUT.tableHeaderHeight;
    for (const segment of planPage.segments) {
        doc.rect(grid.x, y, grid.width, MONTH_LAYOUT.categoryHeight).fillAndStroke(COLORS.category, COLORS.ink);
        drawTextFit(doc, categoryLabel(segment), {
            x: grid.x + 3,
            y: y + 0.3,
            width: grid.width - 6,
            height: MONTH_LAYOUT.categoryHeight,
            font: 'FormBold',
            maxSize: snapshot.settings.fontPreset.values.monthlyCategory,
            minSize: 5,
            field: 'categoryLabel',
            categoryId: segment.category.id
        });
        y += MONTH_LAYOUT.categoryHeight;
        segment.employees.forEach((employee, index) => {
            drawMonthEmployeeRow(doc, snapshot, employee, segment.startIndex + index, page, y, grid);
            y += MONTH_LAYOUT.employeeHeight;
        });
    }
}

function drawFooter(doc, snapshot, pageNumber, pageCount, page) {
    const layout = snapshot.templateId === 'arrival_inout' ? DAILY_LAYOUT : MONTH_LAYOUT;
    const x = layout.margin;
    const width = page.width - (x * 2);
    const y = page.height - 12;
    const suffix = snapshot.templateId === 'month_grid' ? ` • P${pageNumber}/${pageCount}` : '';
    drawTextFit(doc, `${snapshot.settings.texts.footerNote}${suffix}`, {
        x,
        y,
        width,
        height: 8,
        font: 'FormRegular',
        maxSize: snapshot.settings.fontPreset.values.footer,
        minSize: 4,
        field: 'footerNote'
    });
}

function drawPage(doc, snapshot, planPage, pageNumber, pageCount) {
    const page = snapshot.templateId === 'arrival_inout' ? PAGE_DIMENSIONS.portrait : PAGE_DIMENSIONS.landscape;
    doc.rect(0, 0, page.width, page.height).fill(COLORS.paper);
    drawHeader(doc, snapshot, pageNumber, pageCount, page);
    if (snapshot.templateId === 'arrival_inout') {
        drawDailyMeta(doc, snapshot, page);
        drawDailyBody(doc, snapshot, planPage, page);
    } else {
        const legendY = drawMonthMeta(doc, snapshot, page);
        drawMonthLegend(doc, snapshot, page, legendY);
        drawMonthBody(doc, snapshot, planPage, page);
    }
    drawFooter(doc, snapshot, pageNumber, pageCount, page);
}

function hrAttendanceDocumentPdfFilename(snapshot) {
    return snapshot.templateId === 'arrival_inout'
        ? `arrival_inout_${snapshot.settings.documentDate}.pdf`
        : `month_grid_${snapshot.settings.month}.pdf`;
}

async function buildHrAttendanceDocumentPdfBuffer(snapshot) {
    if (!snapshot || snapshot.contractVersion !== CONTRACT_VERSION) {
        throw pdfError('Invalid attendance document snapshot', 'HR_ATTENDANCE_DOCUMENT_INVALID_SNAPSHOT', 400);
    }
    const pages = paginateHrAttendanceDocument(snapshot);
    const deterministicMetadataDate = new Date(`${snapshot.rosterDate}T00:00:00.000Z`);
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            autoFirstPage: false,
            compress: true,
            margin: 0,
            info: {
                Title: snapshot.templateId === 'arrival_inout'
                    ? `Arrival sheet ${snapshot.settings.documentDate}`
                    : `Monthly grid ${snapshot.settings.month}`,
                Creator: 'Event Genix CRM',
                Producer: `Event Genix HR Forms ${CONTRACT_VERSION}`,
                CreationDate: deterministicMetadataDate,
                ModDate: deterministicMetadataDate
            }
        });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        try {
            registerFonts(doc);
            pages.forEach((planPage, index) => {
                doc.addPage({
                    size: 'A4',
                    layout: snapshot.templateId === 'arrival_inout' ? 'portrait' : 'landscape',
                    margin: 0
                });
                drawPage(doc, snapshot, planPage, index + 1, pages.length);
            });
            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = {
    COLORS,
    DAILY_LAYOUT,
    MONTH_LAYOUT,
    buildHrAttendanceDocumentPdfBuffer,
    hrAttendanceDocumentPdfFilename,
    paginateHrAttendanceDocument,
    resolveFonts
};
