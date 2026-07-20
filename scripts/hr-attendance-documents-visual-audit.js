#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FONT_PRESET } = require('../services/hrAttendanceDocuments');
const { buildHrAttendanceDocumentPdfBuffer } = require('../services/hrAttendanceDocumentsPdf');
const { referenceSnapshot } = require('../tests/fixtures/hrAttendanceDocumentsV27');

const DPI = 300;
const PX_PER_MM = DPI / 25.4;
const REFERENCE_SHA256 = Object.freeze({
    arrival: 'D5EAA28FA20EBD0EE85746B77B3DC26F7B72A8DD0DA78251762372F34D26C7F1',
    month: '1FCB67736ACDCAD2BB097F9F0A7117632D148D443B8A1C1C6A5B875E92BC6391'
});
const BASELINES = Object.freeze({
    arrival: Object.freeze({
        pageWidthMm: 210,
        pageHeightMm: 297,
        marginXmm: 4.7,
        marginYmm: 3,
        headerHeightMm: 7.4,
        categoryHeightMm: 4.3,
        employeeHeightMm: 10.9
    }),
    month: Object.freeze({
        pageWidthMm: 297,
        pageHeightMm: 210,
        marginXmm: 4.7,
        marginYmm: 3,
        headerHeightMm: 7.9,
        tableHeaderHeightMm: 6.2,
        categoryHeightMm: 2.9,
        employeeHeightMm: 7.3,
        nameWidthMm: 59.8,
        dayWidthMm: 7.35
    })
});
const METRIC_TOLERANCE_MM = Object.freeze({
    pageWidthMm: 0.15,
    pageHeightMm: 0.15,
    marginXmm: 0.5,
    marginYmm: 0.5,
    headerHeightMm: 0.5,
    tableHeaderHeightMm: 0.5,
    categoryHeightMm: 0.5,
    employeeHeightMm: 0.5,
    nameWidthMm: 0.5,
    dayWidthMm: 0.5
});

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const key = argv[index];
        if (!key.startsWith('--')) continue;
        result[key.slice(2)] = argv[index + 1];
        index += 1;
    }
    return result;
}

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function maxFontPreset() {
    return Object.fromEntries(Object.entries(FONT_PRESET).map(([key, contract]) => [key, contract.max]));
}

function unwrapWindowsCommand(filePath, depth = 0) {
    if (depth > 3 || !/\.(?:cmd|bat)$/i.test(filePath) || !fs.existsSync(filePath)) return filePath;
    const source = fs.readFileSync(filePath, 'utf8');
    const targetMatch = source.match(/%(?:~dp0|SCRIPT_DIR%)([^"\r\n]*pdftoppm\.(?:exe|cmd))/i);
    if (!targetMatch) return filePath;
    const target = path.resolve(path.dirname(filePath), targetMatch[1]);
    return unwrapWindowsCommand(target, depth + 1);
}

function runPdftoppm(executable, pdfPath, prefix) {
    let resolvedExecutable = executable;
    if (process.platform === 'win32' && !path.extname(executable)) {
        const located = spawnSync('where.exe', [executable], { encoding: 'utf8', windowsHide: true });
        resolvedExecutable = String(located.stdout || '').split(/\r?\n/).find(Boolean) || executable;
    }
    if (process.platform === 'win32') resolvedExecutable = unwrapWindowsCommand(resolvedExecutable);
    const result = spawnSync(resolvedExecutable, [
        '-f', '1', '-singlefile', '-r', String(DPI), '-gray', pdfPath, prefix
    ], {
        encoding: 'utf8',
        windowsHide: true,
        shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(resolvedExecutable)
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`pdftoppm failed for ${path.basename(pdfPath)}: ${result.stderr || result.stdout || result.status}`);
    }
    const pgmPath = `${prefix}.pgm`;
    if (!fs.existsSync(pgmPath)) throw new Error(`pdftoppm did not create ${pgmPath}`);
    return pgmPath;
}

function readPgm(filePath) {
    const buffer = fs.readFileSync(filePath);
    let offset = 0;
    const token = () => {
        while (offset < buffer.length) {
            const value = buffer[offset];
            if (value === 35) {
                while (offset < buffer.length && buffer[offset] !== 10) offset += 1;
            } else if (value <= 32) offset += 1;
            else break;
        }
        const start = offset;
        while (offset < buffer.length && buffer[offset] > 32 && buffer[offset] !== 35) offset += 1;
        return buffer.subarray(start, offset).toString('ascii');
    };
    const magic = token();
    const width = Number(token());
    const height = Number(token());
    const max = Number(token());
    while (offset < buffer.length && buffer[offset] <= 32) offset += 1;
    if (magic !== 'P5' || max !== 255 || !width || !height) throw new Error(`Unsupported PGM: ${filePath}`);
    const pixels = buffer.subarray(offset);
    if (pixels.length !== width * height) {
        throw new Error(`PGM pixel count mismatch for ${filePath}: ${pixels.length} != ${width * height}`);
    }
    return { width, height, pixels };
}

function groups(values) {
    const result = [];
    for (const value of values) {
        const current = result[result.length - 1];
        if (!current || value > current.end + 1) result.push({ start: value, end: value });
        else current.end = value;
    }
    return result.map(group => ({ ...group, center: (group.start + group.end) / 2 }));
}

function rowDarkCount(image, y, xStart = 0, xEnd = image.width) {
    let count = 0;
    const base = y * image.width;
    for (let x = xStart; x < xEnd; x += 1) {
        if (image.pixels[base + x] < 110) count += 1;
    }
    return count;
}

function columnDarkCount(image, x, yStart, yEnd) {
    let count = 0;
    for (let y = yStart; y < yEnd; y += 1) {
        if (image.pixels[(y * image.width) + x] < 110) count += 1;
    }
    return count;
}

function headerGeometry(image) {
    const candidates = [];
    const maxY = Math.min(image.height, Math.round(35 * PX_PER_MM));
    for (let y = 0; y < maxY; y += 1) {
        if (rowDarkCount(image, y) > image.width * 0.55) candidates.push(y);
    }
    const header = groups(candidates)[0];
    if (!header) throw new Error('Dark header was not detected');
    const y = Math.round(header.center);
    const base = y * image.width;
    let left = 0;
    let right = image.width - 1;
    while (left < image.width && image.pixels[base + left] >= 110) left += 1;
    while (right > left && image.pixels[base + right] >= 110) right -= 1;
    return {
        marginXmm: left / PX_PER_MM,
        marginYmm: header.start / PX_PER_MM,
        headerHeightMm: (header.end - header.start + 1) / PX_PER_MM
    };
}

function horizontalLines(image, startMm) {
    const margin = Math.round(4.7 * PX_PER_MM);
    const xStart = Math.max(0, margin - 3);
    const xEnd = Math.min(image.width, image.width - margin + 3);
    const span = xEnd - xStart;
    const candidates = [];
    for (let y = Math.round(startMm * PX_PER_MM); y < image.height - margin; y += 1) {
        if (rowDarkCount(image, y, xStart, xEnd) > span * 0.72) candidates.push(y);
    }
    return groups(candidates).map(group => group.center);
}

function closestMedian(differences, expectedMm) {
    const expectedPx = expectedMm * PX_PER_MM;
    const near = differences.filter(value => Math.abs(value - expectedPx) <= 8);
    if (!near.length) return null;
    near.sort((left, right) => left - right);
    const middle = Math.floor(near.length / 2);
    const value = near.length % 2 ? near[middle] : (near[middle - 1] + near[middle]) / 2;
    return value / PX_PER_MM;
}

function monthVerticalGeometry(image, horizontalCenters) {
    const yStart = Math.max(0, Math.ceil((horizontalCenters[0] || (29 * PX_PER_MM)) + 2));
    const yEnd = Math.min(image.height, Math.floor((horizontalCenters[1] || (35 * PX_PER_MM)) - 2));
    const height = yEnd - yStart;
    const candidates = [];
    for (let x = 0; x < image.width; x += 1) {
        if (columnDarkCount(image, x, yStart, yEnd) > height * 0.72) candidates.push(x);
    }
    const centers = groups(candidates).map(group => group.center);
    if (centers.length < 20) throw new Error(`Monthly grid detected only ${centers.length} vertical boundaries`);
    const first = centers[0];
    const nameBoundaryIndex = centers.findIndex(value => (value - first) > 45 * PX_PER_MM);
    if (nameBoundaryIndex < 1) throw new Error('Monthly name-column boundary was not detected');
    const gridCenters = centers.slice(nameBoundaryIndex);
    const dayDifferences = gridCenters.slice(1).map((value, index) => value - gridCenters[index]);
    const dayWidthMm = closestMedian(dayDifferences, BASELINES.month.dayWidthMm);
    if (dayWidthMm == null) throw new Error('Monthly day-column width was not detected');
    return {
        nameWidthMm: (centers[nameBoundaryIndex] - first) / PX_PER_MM,
        dayWidthMm
    };
}

function measure(image, template) {
    const header = headerGeometry(image);
    const metrics = {
        pageWidthMm: image.width / PX_PER_MM,
        pageHeightMm: image.height / PX_PER_MM,
        ...header
    };
    if (template === 'arrival') {
        const lines = horizontalLines(image, 20);
        const differences = lines.slice(1).map((value, index) => value - lines[index]);
        metrics.categoryHeightMm = closestMedian(differences, BASELINES.arrival.categoryHeightMm);
        metrics.employeeHeightMm = closestMedian(differences, BASELINES.arrival.employeeHeightMm);
    } else {
        const lines = horizontalLines(image, 27);
        const differences = lines.slice(1).map((value, index) => value - lines[index]);
        metrics.tableHeaderHeightMm = closestMedian(differences, BASELINES.month.tableHeaderHeightMm);
        metrics.categoryHeightMm = closestMedian(differences, BASELINES.month.categoryHeightMm);
        metrics.employeeHeightMm = closestMedian(differences, BASELINES.month.employeeHeightMm);
        Object.assign(metrics, monthVerticalGeometry(image, lines));
    }
    return Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value == null ? null : Number(value.toFixed(3))]));
}

function compareMetrics(actual, expected, label, toleranceScale = 1) {
    const checks = [];
    for (const [metric, expectedValue] of Object.entries(expected)) {
        const actualValue = actual[metric];
        const tolerance = (METRIC_TOLERANCE_MM[metric] || 0.5) * toleranceScale;
        const delta = actualValue == null ? null : Math.abs(actualValue - expectedValue);
        checks.push({
            label,
            metric,
            actual: actualValue,
            expected: expectedValue,
            tolerance,
            delta: delta == null ? null : Number(delta.toFixed(3)),
            passed: delta != null && delta <= tolerance
        });
    }
    return checks;
}

function pageCount(buffer) {
    return (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
}

function markdownReport(report) {
    const lines = [
        '# HR attendance documents v27 visual audit',
        '',
        `Generated: ${report.generatedAt}`,
        '',
        `Result: **${report.passed ? 'PASS' : 'FAIL'}**`,
        '',
        '| Check | Actual mm | Expected mm | Tolerance mm | Result |',
        '| --- | ---: | ---: | ---: | --- |'
    ];
    report.checks.forEach(check => {
        lines.push(`| ${check.label}.${check.metric} | ${check.actual ?? 'n/a'} | ${check.expected} | +/-${check.tolerance} | ${check.passed ? 'PASS' : 'FAIL'} |`);
    });
    lines.push('', report.mode === 'generated-only'
        ? 'Generated-only mode uses anonymized fixtures and committed geometry tolerances; no employee data or reference PDF is required.'
        : 'References are local-only and are identified by SHA-256; no source PDF or employee name is copied into this report.', '');
    return lines.join('\n');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const generatedOnly = args['generated-only'] === 'true'
        || process.env.HR_ATTENDANCE_VISUAL_GENERATED_ONLY === 'true';
    const arrivalReferenceInput = args['reference-arrival'] || process.env.HR_ATTENDANCE_REFERENCE_ARRIVAL || '';
    const monthReferenceInput = args['reference-month'] || process.env.HR_ATTENDANCE_REFERENCE_MONTH || '';
    const referenceArrival = arrivalReferenceInput ? path.resolve(arrivalReferenceInput) : null;
    const referenceMonth = monthReferenceInput ? path.resolve(monthReferenceInput) : null;
    if (!generatedOnly && !arrivalReferenceInput) {
        throw new Error('Provide --reference-arrival or HR_ATTENDANCE_REFERENCE_ARRIVAL');
    }
    if (!generatedOnly && !monthReferenceInput) {
        throw new Error('Provide --reference-month or HR_ATTENDANCE_REFERENCE_MONTH');
    }
    const pdftoppm = args.pdftoppm || process.env.PDFTOPPM_PATH || 'pdftoppm';
    const outputDir = path.resolve(args['output-dir'] || path.join('output', 'pdf'));
    fs.mkdirSync(outputDir, { recursive: true });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eventgenix-hr-v27-'));

    try {
        const referenceHashes = generatedOnly ? {} : {
            arrival: sha256(referenceArrival),
            month: sha256(referenceMonth)
        };
        if (!generatedOnly) {
            for (const key of Object.keys(REFERENCE_SHA256)) {
                if (referenceHashes[key] !== REFERENCE_SHA256[key]) {
                    throw new Error(`${key} reference SHA-256 mismatch: ${referenceHashes[key]}`);
                }
            }
        }

        const snapshots = {
            arrival: referenceSnapshot('arrival_inout'),
            month: referenceSnapshot('month_grid'),
            arrivalMaxFont: referenceSnapshot('arrival_inout', { fontPreset: maxFontPreset() }),
            monthMaxFont: referenceSnapshot('month_grid', { fontPreset: maxFontPreset() })
        };
        const buffers = {};
        for (const [key, snapshot] of Object.entries(snapshots)) {
            buffers[key] = await buildHrAttendanceDocumentPdfBuffer(snapshot);
        }
        const outputFiles = {
            arrival: path.join(outputDir, 'event-genix-v27-arrival-anonymized.pdf'),
            month: path.join(outputDir, 'event-genix-v27-month-anonymized.pdf'),
            arrivalMaxFont: path.join(outputDir, 'event-genix-v27-arrival-max-font.pdf'),
            monthMaxFont: path.join(outputDir, 'event-genix-v27-month-max-font.pdf')
        };
        for (const [key, filePath] of Object.entries(outputFiles)) fs.writeFileSync(filePath, buffers[key]);

        const renderInputs = {
            arrival: outputFiles.arrival,
            month: outputFiles.month,
            arrivalMaxFont: outputFiles.arrivalMaxFont,
            monthMaxFont: outputFiles.monthMaxFont
        };
        if (!generatedOnly) {
            renderInputs.referenceArrival = referenceArrival;
            renderInputs.referenceMonth = referenceMonth;
        }
        const images = {};
        for (const [key, pdfPath] of Object.entries(renderInputs)) {
            images[key] = readPgm(runPdftoppm(pdftoppm, pdfPath, path.join(tempDir, key)));
        }
        const measurements = {
            arrival: measure(images.arrival, 'arrival'),
            month: measure(images.month, 'month'),
            arrivalMaxFont: measure(images.arrivalMaxFont, 'arrival'),
            monthMaxFont: measure(images.monthMaxFont, 'month')
        };
        if (!generatedOnly) {
            measurements.referenceArrival = measure(images.referenceArrival, 'arrival');
            measurements.referenceMonth = measure(images.referenceMonth, 'month');
        }
        const checks = [
            ...compareMetrics(measurements.arrival, BASELINES.arrival, 'arrival.baseline'),
            ...compareMetrics(measurements.month, BASELINES.month, 'month.baseline'),
            ...compareMetrics(measurements.arrivalMaxFont, measurements.arrival, 'arrival.maxFont'),
            ...compareMetrics(measurements.monthMaxFont, measurements.month, 'month.maxFont')
        ];
        if (!generatedOnly) {
            checks.push(
                ...compareMetrics(measurements.arrival, measurements.referenceArrival, 'arrival.reference'),
                ...compareMetrics(measurements.month, measurements.referenceMonth, 'month.reference')
            );
        }
        const pageCounts = {
            arrival: pageCount(buffers.arrival),
            month: pageCount(buffers.month),
            arrivalMaxFont: pageCount(buffers.arrivalMaxFont),
            monthMaxFont: pageCount(buffers.monthMaxFont)
        };
        const pageCountPassed = pageCounts.arrival === 3 && pageCounts.month === 3
            && pageCounts.arrivalMaxFont === 3 && pageCounts.monthMaxFont === 3;
        const report = {
            generatedAt: new Date().toISOString(),
            mode: generatedOnly ? 'generated-only' : 'reference',
            dpi: DPI,
            toleranceMm: METRIC_TOLERANCE_MM,
            referenceHashes,
            pageCounts,
            measurements,
            checks,
            passed: pageCountPassed && checks.every(check => check.passed),
            outputFiles: Object.fromEntries(Object.entries(outputFiles).map(([key, filePath]) => [key, path.relative(process.cwd(), filePath)]))
        };
        fs.writeFileSync(path.join(outputDir, 'hr-attendance-v27-visual-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
        fs.writeFileSync(path.join(outputDir, 'hr-attendance-v27-visual-audit.md'), markdownReport(report));
        console.log(`HR attendance visual audit: ${report.passed ? 'PASS' : 'FAIL'}`);
        console.log(`Report: ${path.join(outputDir, 'hr-attendance-v27-visual-audit.md')}`);
        if (!report.passed) process.exitCode = 1;
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

main().catch(error => {
    console.error(`HR attendance visual audit failed: ${error.message}`);
    process.exitCode = 1;
});
