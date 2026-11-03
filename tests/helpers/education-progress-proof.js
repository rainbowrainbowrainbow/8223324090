'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Keep every completed check for crash diagnostics. Full proofs are still
// required at UI-state checkpoints, on a failed check, and at suite completion.
// The journal never substitutes for the canonical final verification.json.
function createProgressProof(directory, evidence, io = fs) {
    const journal = path.join(directory, 'checks.ndjson');
    const proof = path.join(directory, 'verification.json');
    io.writeFileSync(journal, '', { flag: 'wx' });
    const counts = { snapshots: 0, snapshotBytes: 0, journalRows: 0, journalBytes: 0 };

    function checkpoint() {
        const text = JSON.stringify(evidence, null, 2);
        io.writeFileSync(proof, text);
        counts.snapshots++;
        counts.snapshotBytes += Buffer.byteLength(text);
    }

    function recordCheck(row) {
        const text = JSON.stringify(row) + '\n';
        io.appendFileSync(journal, text);
        counts.journalRows++;
        counts.journalBytes += Buffer.byteLength(text);
        if (row.status !== 'PASS') checkpoint();
    }

    return { recordCheck, checkpoint, metrics: () => ({ ...counts }) };
}

module.exports = { createProgressProof };
