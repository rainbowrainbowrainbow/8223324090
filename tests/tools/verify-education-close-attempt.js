'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateAttempt } = require('../helpers/education-close-evidence');
const contracts = require('../helpers/education-close-contracts.json');
try {
    const directory = path.resolve(process.argv[2] || '');
    const record = JSON.parse(fs.readFileSync(path.join(directory, 'record.json'), 'utf8'));
    const contract = contracts[record.suite];
    if (!contract) throw new Error('Unknown required suite');
    console.log(JSON.stringify(validateAttempt(record, directory, contract)));
} catch (error) { console.error('FAIL: ' + error.message); process.exitCode = 1; }
