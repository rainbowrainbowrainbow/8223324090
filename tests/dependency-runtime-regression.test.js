'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const ExcelJS = require('exceljs');

for (const scenario of ['compressed-json', 'late-upload-filter']) {
    test(`dependency process survives ${scenario} and serves a subsequent request`, () => {
        const result = spawnSync(process.execPath, [
            path.join(__dirname, 'fixtures/dependency-process-regression.cjs'),
            scenario, require.resolve('express'), require.resolve('multer')
        ], { encoding: 'utf8', timeout: 10000, windowsHide: true });
        assert.ifError(result.error);
        assert.equal(result.signal, null);
        assert.equal(result.status, 0, result.stderr || result.stdout);
    });
}

test('updated archive chain preserves streaming Excel workbook contents and formulas', async () => {
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    const ended = new Promise((resolve, reject) => { stream.on('end', resolve); stream.on('error', reject); });
    const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: true });
    const sheet = writer.addWorksheet('Synthetic schedule');
    sheet.columns = [{ header: 'Resource', key: 'resource', width: 25 }, { header: 'Hours', key: 'hours', width: 12 }];
    sheet.addRow({ resource: 'Synthetic animator', hours: 3 }).commit();
    sheet.addRow({ resource: 'Synthetic room', hours: 5 }).commit();
    sheet.addRow(['Total', { formula: 'SUM(B2:B3)', result: 8 }]).commit();
    await writer.commit();
    await ended;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks));
    const restored = workbook.getWorksheet('Synthetic schedule');
    assert.equal(restored.getCell('A2').value, 'Synthetic animator');
    assert.equal(restored.getCell('B3').value, 5);
    assert.deepEqual(restored.getCell('B4').value, { formula: 'SUM(B2:B3)', result: 8 });
    assert.equal(restored.rowCount, 4);
});

test('ExcelJS archive glob includes matching files and excludes ignored paths with the patched matcher', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eventgenix-archive-regression-'));
    t.after(async () => {
        const resolved = path.resolve(directory);
        assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
        assert.ok(path.basename(resolved).startsWith('eventgenix-archive-regression-'));
        await fs.rm(resolved, { recursive: true });
    });
    await fs.mkdir(path.join(directory, 'nested'));
    await fs.writeFile(path.join(directory, 'root.txt'), 'Synthetic root');
    await fs.writeFile(path.join(directory, 'nested', 'included.txt'), 'Synthetic nested');
    await fs.writeFile(path.join(directory, 'nested', 'ignored.txt'), 'Excluded');
    await fs.writeFile(path.join(directory, 'other.json'), '{}');
    // Resolve through ExcelJS so this covers its actual overridden archive tree.
    const archiveModule = require.resolve('archiver', { paths: [path.dirname(require.resolve('exceljs'))] });
    const createArchive = require(archiveModule);
    const archiveUtils = require(require.resolve('archiver-utils', { paths: [path.dirname(archiveModule)] }));
    assert.deepEqual(archiveUtils.file.expand({ cwd: directory }, ['**/*.txt', '!**/ignored.txt']).sort(),
        [path.join('nested', 'included.txt'), 'root.txt']);
    const archive = createArchive('zip');
    const chunks = [];
    const completed = new Promise((resolve, reject) => {
        archive.on('data', chunk => chunks.push(chunk));
        archive.on('error', reject);
        archive.on('warning', reject);
        archive.on('end', resolve);
    });
    archive.glob('**/*.txt', { cwd: directory, ignore: ['**/ignored.txt'] });
    await archive.finalize();
    await completed;
    const unzipper = require(require.resolve('unzipper', { paths: [path.dirname(require.resolve('exceljs'))] }));
    const zip = await unzipper.Open.buffer(Buffer.concat(chunks));
    assert.deepEqual(zip.files.map(file => file.path).sort(), ['nested/included.txt', 'root.txt']);
    assert.equal((await zip.files.find(file => file.path === 'nested/included.txt').buffer()).toString(), 'Synthetic nested');
});
