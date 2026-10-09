'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inventory, assertInventory } = require('../../tests/helpers/education-close-evidence');
const { template, evaluate, DEVICES, CASES } = require('./education-device-acceptance');
const { allowedWrite } = require('./education-device-gateway');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'output/education-ready/close05');
const OWNER = 'EDU-CLOSE-05-v1';
const DB = 'eventgenix_education_close_devices';
const APP_PORT = 3015, LAN_PORT = 3016;
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function writePolicy(method, pathname) {
    const normalized = pathname.replace(/\/+$/, '');
    // Existing customer+child creation is the only additional write path. No account/provider writes.
    return allowedWrite(method, pathname) || method === 'POST' && normalized === '/api/customers';
}
function createTemplate(manifest) {
    const report = template({ anchorDate: manifest.anchorDate, sourceHashes: manifest.sourceHashes });
    Object.assign(report, { task: 'EDU-CLOSE-05', attemptId: manifest.attemptId, harnessHashes: manifest.harnessHashes,
        manifestHash: hash(path.join(OUT, 'manifest.json')), independentReports: manifest.dataset.expectedReports });
    for (const device of report.devices) for (const item of device.checks) {
        item.observedAt = null;
        if (item.id === 'D02') item.expected = 'Create a new teacher, first-assign to a new group; create fictional representative+child through Customers UI; enroll and reload. Record child birthday UI/API/SQL mismatch if reproduced; no API repair.';
        if (item.id === 'D06') item.expected = 'Statuses/clear/frozen roster/history; A and B open same lesson, A saves, B stale save409 with draft retained; explicit refresh/reapply. Record both authors/time and confirm A mark unchanged.';
        if (item.id === 'D01') item.expected += ' Include schedule first-cabinet label at09:30, narrow/landscape tab access and Save. Known overlap is not waived.';
        if (item.id === 'D07') item.expected += ' Use exact historical range and totals in manifest before mutations; future report is time-dependent.';
    }
    return report;
}
function verifyReport(report, manifest, verifyEvidence) {
    assert.equal(report.task, 'EDU-CLOSE-05');
    assert.equal(report.classification, 'PHYSICAL_DEVICE_ACCEPTANCE');
    assert.equal(report.attemptId, manifest.attemptId);
    assert.equal(report.anchorDate, manifest.anchorDate);
    assert.equal(report.manifestHash, hash(path.join(OUT, 'manifest.json')));
    assertInventory(manifest, ROOT);
    assert.deepEqual(report.sourceHashes, manifest.sourceHashes);
    assert.deepEqual(report.harnessHashes, manifest.harnessHashes);
    assert.deepEqual(report.devices.map(row => row.id).sort(), DEVICES.map(row => row.id).sort());
    for (const device of report.devices) {
        assert.deepEqual(device.checks.map(row => row.id).sort(), CASES.map(row => row[0]).sort());
        for (const item of device.checks) if (['PASS', 'FAIL'].includes(item.status)) {
            assert.ok(Number.isFinite(Date.parse(item.observedAt)), 'Per-case observation time required');
            assert.ok(Date.parse(item.observedAt) >= Date.parse(manifest.preparedAt), 'Historical device evidence');
            assert.ok(item.actual?.trim() && item.steps?.trim() && item.evidence?.length, 'Detailed result and evidence required');
            for (const file of item.evidence) verifyEvidence(file, device);
        }
    }
    return evaluate(report, verifyEvidence);
}
module.exports = { ROOT, OUT, OWNER, DB, APP_PORT, LAN_PORT, hash, inventory, writePolicy, createTemplate, verifyReport };
