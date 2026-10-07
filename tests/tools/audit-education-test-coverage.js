'use strict';
// Source inventory is evidence about test mechanisms, not a test verdict.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const prior = process.argv[2] ? path.resolve(process.argv[2]) : null;
const patterns = {
    fixedDelay: /waitForTimeout\(|setTimeout\(/,
    productHelperInvocation: /(?:EducationGroups\.(?:load|showGroup)|EducationAttendance\.(?:openBooking|runReport|loadLessons)|EducationScheduleWorkspace\.(?:load|setView)|CrmBusinessContext\.switchTo|editBooking|showBookingDetails)\(/,
    responseMock: /route\.fulfill\(|json:\s*\{|body:\s*JSON\.stringify/,
    realResponseBarrier: /route\.fetch\(|gate\.(?:released|entered)|releasePromise/,
    directDatabaseSetup: /INSERT INTO|UPDATE bookings|UPDATE education_attendance/,
    themeDomMutation: /classList\.toggle\('dark-mode'|dataset\.theme\s*=/,
    fixtureFallback: /if\s*\(!groupId\)|if\s*\(!lessonId\)|independentFixtureFallback/,
    weakReportShape: /child(?:ElementCount|ren\.length)|reportChildren/,
    independentSqlRead: /SELECT .*FROM|SELECT COUNT|SELECT count/,
    semanticControl: /getByRole\(|getByLabel\(/,
    selectorControl: /\.locator\(/,
    assertion: /assert\./
};
function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
    });
}
function inventory(source, sourceRoot) {
    return walk(path.join(sourceRoot, 'tests')).filter(file => /^education.*\.(?:js|cjs)$/.test(path.basename(file))).map(file => {
        const code = fs.readFileSync(file, 'utf8');
        const hits = {};
        for (const [name, pattern] of Object.entries(patterns)) hits[name] = code.split(/\r?\n/).flatMap((line, index) => pattern.test(line) ? [index + 1] : []);
        return { source, path: path.relative(sourceRoot, file).replace(/\\/g, '/'), sha256: crypto.createHash('sha256').update(code).digest('hex'), hits };
    });
}
const files = inventory('current-production-base-and-ready-harness', root);
if (prior) files.push(...inventory('previous-qa-evidence-source', prior));
const result = { generatedAt: new Date().toISOString(),
    warning: 'Hits require human interpretation: fulfillment can deliver real responses; timers can be bounded deadlines/polling, not sleeps.', files };
const target = path.join(root, 'output/education-ready/2026-10-03/test-source-inventory.json');
fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(result, null, 2));
console.log(`Education test source inventory: ${files.length} source entries (not executed tests).`);
