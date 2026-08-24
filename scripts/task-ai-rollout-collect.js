#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const report = require('./task-ai-rollout-report');

function parseCollectorArgs(argv = []) {
    const options = {
        service: '',
        environment: 'production',
        deploymentId: '',
        deploymentStart: '',
        deploymentEnd: '',
        since: '24h',
        version: '',
        sha: '',
        stage: '',
        expectedRolloutPercent: '',
        promptVersion: '',
        schemaName: '',
        contractVersion: '',
        scope: 'single',
        businessContext: '',
        useDatabase: false,
        hours: report.DEFAULTS.hours,
        minProposals: report.DEFAULTS.minProposals,
        providerErrorRateMax: report.DEFAULTS.providerErrorRateMax,
        outputPrefix: ''
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = () => {
            index += 1;
            if (index >= argv.length) throw new Error(`${arg} requires a value.`);
            return argv[index];
        };
        if (arg === '--service') options.service = next();
        else if (arg === '--environment') options.environment = next();
        else if (arg === '--deployment-id') options.deploymentId = next();
        else if (arg === '--deployment-start') options.deploymentStart = next();
        else if (arg === '--deployment-end') options.deploymentEnd = next();
        else if (arg === '--since') options.since = next();
        else if (arg === '--version') options.version = next();
        else if (arg === '--sha') options.sha = next();
        else if (arg === '--stage') options.stage = next();
        else if (arg === '--expected-rollout-percent') options.expectedRolloutPercent = next();
        else if (arg === '--prompt-version') options.promptVersion = next();
        else if (arg === '--schema-name') options.schemaName = next();
        else if (arg === '--contract-version') options.contractVersion = next();
        else if (arg === '--scope') options.scope = next();
        else if (arg === '--business-context') options.businessContext = next();
        else if (arg === '--database') options.useDatabase = true;
        else if (arg === '--hours') options.hours = Number(next());
        else if (arg === '--min-proposals') options.minProposals = Number(next());
        else if (arg === '--provider-error-rate-max') options.providerErrorRateMax = Number(next());
        else if (arg === '--output-prefix') options.outputPrefix = next();
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unsupported argument: ${arg}`);
    }
    if (options.help) return options;
    if (!options.service) throw new Error('--service is required.');
    if (!options.deploymentId) throw new Error('--deployment-id is required.');
    if (!options.version) throw new Error('--version is required.');
    if (!/^[a-f0-9]{40}$/i.test(options.sha)) throw new Error('--sha must be an exact 40-character commit SHA.');
    if (!['single', 'bundle'].includes(options.scope)) throw new Error('--scope must be single or bundle.');
    return options;
}

function usage() {
    return [
        'Usage:',
        '  node scripts/task-ai-rollout-collect.js --service <service> --deployment-id <id> --version <version> --sha <40-char-sha> --stage <stage> --scope <single|bundle> [--database]',
        '',
        'The collector reads Railway deploy/HTTP logs into memory, emits only redacted report artifacts,',
        'and fails closed when non-empty input cannot be recognized. Raw logs are never written.'
    ].join('\n');
}

function railwayLogs(args, runner = spawnSync) {
    const railwayScript = process.platform === 'win32' && process.env.APPDATA
        ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@railway', 'cli', 'bin', 'railway.js')
        : '';
    const executable = railwayScript ? process.execPath : 'railway';
    const commandArgs = railwayScript ? [railwayScript, 'logs', ...args] : ['logs', ...args];
    const result = runner(executable, commandArgs, {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        windowsHide: true
    });
    if (result.error || result.status !== 0) {
        throw new Error(`Railway log collection failed (exit ${result.status ?? 'unknown'}). Raw output was not retained.`);
    }
    return String(result.stdout || '');
}

function collectRailwayEvidence(options, runner = spawnSync) {
    const common = [
        options.deploymentId,
        '--service', options.service,
        '--environment', options.environment,
        '--since', options.since,
        '--json'
    ];
    const telemetryText = railwayLogs([...common, '--filter', 'task_ai_draft_event'], runner);
    const httpTexts = Object.values(report.AI_HTTP_ROUTES).map(route => (
        railwayLogs([...common, '--http', '--path', route], runner)
    ));
    const defaults = {
        deploymentId: options.deploymentId,
        releaseVersion: options.version,
        releaseSha: options.sha
    };
    const parsed = [telemetryText, ...httpTexts].map(text => report.parseRolloutLogText(text, defaults));
    const combined = parsed.reduce((summary, item) => {
        summary.telemetryEvents.push(...item.telemetryEvents);
        summary.httpRequests.push(...item.httpRequests);
        summary.nonEmptyLines += item.nonEmptyLines;
        summary.recognizedLines += item.recognizedLines;
        return summary;
    }, { telemetryEvents: [], httpRequests: [], nonEmptyLines: 0, recognizedLines: 0 });
    return report.assertRecognizedInput(combined, 'Railway output');
}

function artifactPaths(options) {
    const root = path.resolve(__dirname, '..');
    const outputRoot = path.join(root, 'output', options.scope === 'bundle' ? 'task-ai-bundle-rollout' : 'task-ai-rollout');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = options.outputPrefix ? path.resolve(options.outputPrefix) : path.join(outputRoot, stamp);
    return { json: `${prefix}.json`, markdown: `${prefix}.md` };
}

async function run(options, dependencies = {}) {
    const collected = collectRailwayEvidence(options, dependencies.runner || spawnSync);
    const dbEvidence = options.useDatabase
        ? await report.collectDatabaseEvidence(options, dependencies.env || process.env)
        : { available: false, events: [], checks: null };
    const built = report.buildReport({
        logEvents: collected.telemetryEvents,
        httpRequests: collected.httpRequests,
        dbEvidence,
        options: { ...options, httpEvidenceAvailable: true, requireExactMetadata: true }
    });
    const paths = artifactPaths(options);
    report.writeReportArtifact(built, { ...options, output: paths.json, format: 'json' });
    report.writeReportArtifact(built, { ...options, output: paths.markdown, format: 'markdown' });
    return { report: built, artifacts: paths };
}

async function main() {
    const options = parseCollectorArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    const result = await run(options);
    process.stdout.write(`${JSON.stringify({
        verdict: result.report.verdict.status,
        verdictReason: result.report.verdict.reason,
        httpRequests: result.report.http.totalRequests,
        previewAttempts: result.report.telemetry.previewAttempts,
        artifacts: result.artifacts
    }, null, 2)}\n`);
    if (result.report.verdict.status !== 'pass') process.exitCode = 1;
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`Task AI rollout collection failed: ${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    artifactPaths,
    collectRailwayEvidence,
    parseCollectorArgs,
    railwayLogs,
    run
};
