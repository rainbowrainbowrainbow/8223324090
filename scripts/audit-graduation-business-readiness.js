#!/usr/bin/env node
'use strict';

const {
    auditGraduationBusinessSeedFiles,
    buildGraduationBusinessSeedSql,
    formatGraduationBusinessReadinessMarkdown
} = require('../services/graduationBusinessReadiness');

function argValue(name, fallback = null) {
    const prefix = `${name}=`;
    const pair = process.argv.find(arg => arg.startsWith(prefix));
    if (pair) return pair.slice(prefix.length);
    const index = process.argv.indexOf(name);
    if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
    return fallback;
}

function main() {
    const businessContext = argValue('--business-context', 'event_genix');
    const format = String(argValue('--format', 'markdown')).trim().toLowerCase();
    if (format === 'sql') {
        const { report, sql } = buildGraduationBusinessSeedSql({ businessContext });
        if (!sql) {
            process.stderr.write(formatGraduationBusinessReadinessMarkdown(report));
            process.exitCode = 1;
            return;
        }
        process.stdout.write(sql);
        process.exitCode = report.status === 'BLOCKED' ? 1 : 0;
        return;
    }
    const report = auditGraduationBusinessSeedFiles({ businessContext });
    if (format === 'json') {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
        process.stdout.write(formatGraduationBusinessReadinessMarkdown(report));
    }
    process.exitCode = report.status === 'BLOCKED' ? 1 : 0;
}

if (require.main === module) main();
