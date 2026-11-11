'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { requirePlaywright } = require('../tests/browser/timeline-room-summary-browser-smoke');

async function main() {
    const source = path.resolve(__dirname, '../docs/hr-crm-staff-guide.html');
    const output = path.resolve(process.argv[2] || path.join(__dirname, '../output/pdf/EventGenix-Staff-Guide-Anna-release-candidate.pdf'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const browser = await requirePlaywright().chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    try {
        const page = await browser.newPage();
        await page.goto(pathToFileURL(source).href);
        await page.pdf({ path: output, printBackground: true, preferCSSPageSize: true });
        process.stdout.write(`${output}\n`);
    } finally { await browser.close(); }
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
