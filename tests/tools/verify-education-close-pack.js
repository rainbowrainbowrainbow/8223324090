'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateMatrix } = require('../helpers/education-close-evidence');
const contracts = require('../helpers/education-close-contracts.json');
function main(file = process.argv[2] || process.env.EDU_CLOSE_MATRIX || 'output/education-ready/close04/matrix.json') {
    try {
        const target = path.resolve(file), manifest = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
        const result = validateMatrix(manifest, path.dirname(target), contracts);
        console.log(JSON.stringify(result)); return 0;
    } catch (error) { console.error('FAIL_OR_BLOCKED_EVIDENCE: ' + error.message); return 1; }
}
if (require.main === module) process.exitCode = main();
module.exports = { main };
