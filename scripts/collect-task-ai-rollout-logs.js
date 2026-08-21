#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
    buildReport,
    collectDatabaseEvidence,
    parseTelemetryLogText,
    writeReportArtifact
} = require('./task-ai-rollout-report');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv = []) {
    const options = {
        project: '',
        service: '',
        environment: 'production',
        deploymentId: '',
        lines: '2000',
        since: '',
        until: '',
        filter: 'task_ai_draft_event',
        format: 'json',
        output: '',
        useDatabase: false,
        stage: '',
        version: '',
        sha: '',
        promptVersion: '',
        contractVersion: '',
        expectedRolloutPercent: '',
        businessContext: '',
        hours: 24,
        minProposals: 30,
        providerErrorRateMax: 0.05
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = () => {
            index += 1;
            if (index >= argv.length) throw new Error(`${arg} requires a value.`);
            return argv[index];
        };
        if (arg === '--project') options.project = next();
        else if (arg === '--service') options.service = next();
        else if (arg === '--environment') options.environment = next();
        else if (arg === '--deployment-id') options.deploymentId = next();
        else if (arg === '--lines') options.lines = next();
        else if (arg === '--since') options.since = next();
        else if (arg === '--until') options.until = next();
        else if (arg === '--filter') options.filter = next();
        else if (arg === '--format') options.format = next();
        else if (arg === '--output') options.output = next();
        else if (arg === '--database') options.useDatabase = true;
        else if (arg === '--stage') options.stage = next();
        else if (arg === '--version') options.version = next();
        else if (arg === '--sha') options.sha = next();
        else if (arg === '--prompt-version') options.promptVersion = next();
        else if (arg === '--contract-version') options.contractVersion = next();
        else if (arg === '--expected-rollout-percent') options.expectedRolloutPercent = next();
        else if (arg === '--business-context') options.businessContext = next();
        else if (arg === '--hours') options.hours = Number(next());
        else if (arg === '--min-proposals') options.minProposals = Number(next());
        else if (arg === '--provider-error-rate-max') options.providerErrorRateMax = Number(next());
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unsupported argument: ${arg}`);
    }
    if (!options.service) throw new Error('--service is required.');
    if (!options.environment) throw new Error('--environment is required.');
    if (!['json', 'markdown'].includes(options.format)) throw new Error('--format must be json or markdown.');
    return options;
}

function usage() {
    return [
        'Usage:',
        '  node scripts/collect-task-ai-rollout-logs.js --service 8223324090 --environment production --version 0.81.11 --sha <sha> --stage 20 --expected-rollout-percent 20',
        '',
        'Safety:',
        '  Fetches Railway logs into memory and passes only parsed sanitized task_ai_draft_event rows to the report builder.',
        '  Does not write raw logs. Fails closed when telemetry cannot be recognized.'
    ].join('\n');
}

function buildRailwayLogsArgs(options = {}) {
    const args = ['logs', '--json', '--service', options.service, '--environment', options.environment];
    if (options.project) args.push('--project', options.project);
    if (options.deploymentId) args.push(options.deploymentId);
    if (options.lines) args.push('--lines', String(options.lines));
    if (options.since) args.push('--since', options.since);
    if (options.until) args.push('--until', options.until);
    if (options.filter) args.push('--filter', options.filter);
    return args;
}

function fetchRailwayLogs(options = {}) {
    const args = buildRailwayLogsArgs(options);
    const result = spawnSync('railway', args, {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 25 * 1024 * 1024,
        windowsHide: true
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        const stderr = String(result.stderr || '').trim().slice(0, 800);
        throw new Error(`railway logs failed with status ${result.status}: ${stderr}`);
    }
    return String(result.stdout || '');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    const rawLogText = fetchRailwayLogs(options);
    const logEvents = parseTelemetryLogText(rawLogText);
    if (!logEvents.length) throw new Error('No recognizable task_ai_draft_event telemetry was found in Railway logs.');
    const dbEvidence = options.useDatabase
        ? await collectDatabaseEvidence(options)
        : { available: false, events: [], checks: null };
    const report = buildReport({ logEvents, dbEvidence, options });
    const artifactPath = writeReportArtifact(report, options);
    process.stdout.write(`${JSON.stringify({
        verdict: report.verdict.status,
        artifact: path.relative(ROOT, artifactPath),
        recognizedLogEvents: logEvents.length,
        exactFilteredEvents: report.sources.exactFilteredEvents,
        successfulProposals: report.telemetry.successfulProposals,
        providerPreviewAttempts: report.telemetry.providerPreviewAttempts,
        missingEvidence: report.verdict.missingEvidence
    }, null, 2)}\n`);
    if (!report.sources.exactFilteredEvents || report.verdict.status !== 'pass') process.exitCode = 1;
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`Task AI rollout log collector failed: ${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    buildRailwayLogsArgs,
    fetchRailwayLogs,
    parseArgs
};
