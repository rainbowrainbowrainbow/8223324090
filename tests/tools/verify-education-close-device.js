'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OUT, hash, verifyReport } = require('../../scripts/lib/education-close-device');
const root = path.join(OUT, 'evidence');
let result;
try {
    const read = file => JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8').replace(/^\uFEFF/, ''));
    result = verifyReport(read('operator-results.json'), read('manifest.json'), (file, device) => {
        assert.ok(['physical-device-screenshot', 'physical-device-video', 'physical-device-audio', 'operator-observation'].includes(file.kind));
        assert.equal(file.device, device.id); assert.ok(Number.isFinite(Date.parse(file.capturedAt)));
        assert.match(file.sha256 || '', /^[a-f0-9]{64}$/);
        const target = path.resolve(root, file.path || '');
        assert.ok(target.startsWith(root + path.sep)); assert.ok(fs.statSync(target).isFile());
        assert.ok(fs.realpathSync(target).startsWith(fs.realpathSync(root) + path.sep));
        assert.equal(hash(target), file.sha256);
    });
} catch (error) { result = { status: 'FAIL_EVIDENCE_INTEGRITY', exitCode: 1, error: error.message }; }
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'device-verification.json'), JSON.stringify(result, null, 2));
console.log(result.status + ' ' + JSON.stringify(result.counts || {}) + '; exit=' + result.exitCode);
process.exitCode = result.exitCode;
