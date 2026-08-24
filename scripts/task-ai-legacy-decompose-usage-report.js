#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
    aggregateLegacyAiDraftDeprecationUsage,
    sanitizeTelemetryEvent
} = require('../services/taskAiDraftTelemetry');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'output', 'task-ai-legacy-decompose');
const EVENT_MESSAGE = 'task_ai_draft_event';
const LEGACY_ROUTE = '/api/tasks/decompose-draft';
const DEFAULT_WINDOWS = Object.freeze([
    { label: '24h', since: '24h', hours: 24 },
    { label: '7d', since: '168h', hours: 168 },
    { label: '30d', since: '720h', hours: 720 }
]);
const VERDICT_REASONS = Object.freeze({
    READY_FOR_REMOVAL_CONFIRMATION: 'READY_FOR_REMOVAL_CONFIRMATION',
    HOLD_REMOVAL: 'HOLD_REMOVAL',
    DOCUMENTED_CONSUMER: 'DOCUMENTED_CONSUMER',
    TELEMETRY_GAP: 'TELEMETRY_GAP',
    INVALID_ARTIFACT_METADATA: 'INVALID_ARTIFACT_METADATA'
});

function parseArgs(argv = []) {
    const options = {
        service: '',
        environment: 'production',
        deploymentId: '',
        deploymentStart: '',
        deploymentEnd: '',
        version: '',
        sha: '',
        sourceBranch: '',
        eventsFile: '',
        stdin: false,
        outputPrefix: '',
        windows: DEFAULT_WINDOWS.map(item => ({ ...item })),
        help: false
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
        else if (arg === '--version') options.version = next();
        else if (arg === '--sha') options.sha = next();
        else if (arg === '--source-branch') options.sourceBranch = next();
        else if (arg === '--events-file') options.eventsFile = next();
        else if (arg === '--stdin') options.stdin = true;
        else if (arg === '--output-prefix') options.outputPrefix = next();
        else if (arg === '--windows') options.windows = parseWindowList(next());
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error(`Unsupported argument: ${arg}`);
    }
    if (options.help) return options;
    const metadataIssues = exactMetadataIssues(options);
    if (metadataIssues.length) {
        const error = new Error(`Invalid legacy usage artifact metadata: ${metadataIssues.join('; ')}`);
        error.metadataIssues = metadataIssues;
        throw error;
    }
    if (!options.stdin && !options.eventsFile && !options.service) {
        throw new Error('--service is required unless --stdin or --events-file is used.');
    }
    return options;
}

function usage() {
    return [
        'Usage:',
        '  node scripts/task-ai-legacy-decompose-usage-report.js --service <service> --deployment-id <id> --version <version> --sha <40-char-sha> --deployment-start <iso>',
        '',
        'The report reads Railway logs in memory, writes only redacted JSON/Markdown artifacts,',
        'and never stores raw logs or task text.'
    ].join('\n');
}

function parseWindowList(value = '') {
    const windows = String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map(label => {
            const match = label.match(/^(\d+)(h|d)$/i);
            if (!match) throw new Error(`Unsupported window: ${label}`);
            const amount = Number(match[1]);
            const unit = match[2].toLowerCase();
            const hours = unit === 'd' ? amount * 24 : amount;
            return { label, since: `${hours}h`, hours };
        });
    if (!windows.length) throw new Error('--windows must contain at least one window.');
    return windows;
}

function safeDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function exactMetadataIssues(options = {}) {
    const issues = [];
    const required = [
        ['version', 'release version'],
        ['sha', 'release SHA'],
        ['deploymentId', 'deployment ID']
    ];
    for (const [key, label] of required) {
        if (!String(options[key] || '').trim()) issues.push(`missing ${label}`);
    }
    if (options.sha && !/^[a-f0-9]{40}$/i.test(String(options.sha))) {
        issues.push('release SHA must be an exact 40-character commit SHA');
    }
    if (options.deploymentStart && !safeDate(options.deploymentStart)) {
        issues.push('deployment start must be an ISO timestamp');
    }
    if (options.deploymentEnd && !safeDate(options.deploymentEnd)) {
        issues.push('deployment end must be an ISO timestamp');
    }
    return issues;
}

function parseJsonLine(line) {
    try { return JSON.parse(line); } catch { return null; }
}

function observedAtFrom(row = {}, envelope = {}) {
    return safeDate(row.ts || row.time || row.timestamp || envelope.observedAt)?.toISOString() || null;
}

function legacyEventFromStructuredLog(row = {}, envelope = {}) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return { recognized: false, event: null };
    const source = row.data || row.event || null;
    const isEvent = (row.msg === EVENT_MESSAGE || row.message === EVENT_MESSAGE) && source;
    if (isEvent) {
        const event = sanitizeTelemetryEvent({
            ...source,
            requestId: source.requestId || row.requestId || row.reqId || envelope.requestId || envelope.reqId || '',
            deploymentId: source.deploymentId || row.deploymentId || envelope.deploymentId || '',
            releaseVersion: source.releaseVersion || row.releaseVersion || envelope.releaseVersion || '',
            releaseSha: source.releaseSha || row.releaseSha || envelope.releaseSha || ''
        });
        return {
            recognized: true,
            event: event.type === 'deprecation' && event.route === LEGACY_ROUTE
                ? { observedAt: observedAtFrom(row, envelope), source: 'logs', event }
                : null
        };
    }
    if (typeof row.message === 'string') {
        const nested = parseJsonLine(row.message.trim());
        if (nested && nested !== row) {
            return legacyEventFromStructuredLog(nested, {
                ...envelope,
                observedAt: row.timestamp || row.ts || row.time || envelope.observedAt || null,
                deploymentId: row.deploymentId || envelope.deploymentId || '',
                releaseVersion: row.releaseVersion || envelope.releaseVersion || '',
                releaseSha: row.releaseSha || envelope.releaseSha || ''
            });
        }
    }
    return { recognized: false, event: null };
}

function normalizeHttpPath(value) {
    return String(value || '').trim().split('?')[0] === LEGACY_ROUTE ? LEGACY_ROUTE : '';
}

function legacyHttpFromStructuredLog(row = {}, envelope = {}) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const pathValue = normalizeHttpPath(row.path || row.requestPath || row.url);
    if (!pathValue) return null;
    const method = String(row.method || '').trim().toUpperCase();
    if (method !== 'POST') return null;
    const status = Number(row.httpStatus ?? row.status ?? row.statusCode);
    return {
        observedAt: safeDate(row.timestamp || row.ts || row.time || envelope.observedAt)?.toISOString() || null,
        source: 'http',
        requestId: String(row.requestId || row.reqId || envelope.requestId || '').trim().slice(0, 120),
        deploymentId: String(row.deploymentId || envelope.deploymentId || '').trim().slice(0, 80),
        method,
        path: LEGACY_ROUTE,
        status: Number.isFinite(status) ? status : null
    };
}

function parsePrettyLine(line, defaults = {}) {
    const markerIndex = line.indexOf(EVENT_MESSAGE);
    if (markerIndex < 0) return { recognized: false, event: null };
    const jsonStart = line.indexOf('{', markerIndex + EVENT_MESSAGE.length);
    if (jsonStart < 0) return { recognized: true, event: null };
    const source = parseJsonLine(line.slice(jsonStart));
    if (!source) return { recognized: true, event: null };
    const event = sanitizeTelemetryEvent({
        ...source,
        deploymentId: source.deploymentId || defaults.deploymentId || '',
        releaseVersion: source.releaseVersion || defaults.releaseVersion || '',
        releaseSha: source.releaseSha || defaults.releaseSha || ''
    });
    return {
        recognized: true,
        event: event.type === 'deprecation' && event.route === LEGACY_ROUTE
            ? { observedAt: null, source: 'logs', event }
            : null
    };
}

function parseLogText(text = '', defaults = {}) {
    const legacyEvents = [];
    const httpRequests = [];
    let nonEmptyLines = 0;
    let recognizedLines = 0;
    for (const line of String(text || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        nonEmptyLines += 1;
        const asJson = parseJsonLine(trimmed);
        const rows = Array.isArray(asJson) ? asJson : [asJson];
        let recognized = false;
        for (const row of rows) {
            const http = legacyHttpFromStructuredLog(row, defaults);
            const eventResult = legacyEventFromStructuredLog(row, defaults);
            if (http) {
                httpRequests.push(http);
                recognized = true;
            }
            if (eventResult.recognized) recognized = true;
            if (eventResult.event) legacyEvents.push(eventResult.event);
        }
        if (!recognized) {
            const pretty = parsePrettyLine(trimmed, defaults);
            if (pretty.recognized) recognized = true;
            if (pretty.event) legacyEvents.push(pretty.event);
        }
        if (recognized) recognizedLines += 1;
    }
    return { legacyEvents, httpRequests, nonEmptyLines, recognizedLines };
}

function assertRecognizedInput(input = {}, label = 'Input') {
    if (Number(input.nonEmptyLines || 0) > 0 && Number(input.recognizedLines || 0) === 0) {
        throw new Error(`${label} contained data but no recognized Task AI legacy telemetry or HTTP request records.`);
    }
    return input;
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

function collectWindow(options, window, runner = spawnSync) {
    const common = [
        options.deploymentId,
        '--service', options.service,
        '--environment', options.environment,
        '--since', window.since,
        '--json'
    ];
    const defaults = {
        deploymentId: options.deploymentId,
        releaseVersion: options.version,
        releaseSha: options.sha
    };
    const telemetryText = railwayLogs([...common, '--filter', EVENT_MESSAGE], runner);
    const httpText = railwayLogs([...common, '--http', '--path', LEGACY_ROUTE], runner);
    const combined = [telemetryText, httpText]
        .map(text => parseLogText(text, defaults))
        .reduce((summary, item) => {
            summary.legacyEvents.push(...item.legacyEvents);
            summary.httpRequests.push(...item.httpRequests);
            summary.nonEmptyLines += item.nonEmptyLines;
            summary.recognizedLines += item.recognizedLines;
            return summary;
        }, { legacyEvents: [], httpRequests: [], nonEmptyLines: 0, recognizedLines: 0 });
    return assertRecognizedInput(combined, `Railway ${window.label} output`);
}

function loadInput(options = {}) {
    const defaults = {
        deploymentId: options.deploymentId,
        releaseVersion: options.version,
        releaseSha: options.sha
    };
    const inputs = [];
    if (options.eventsFile) inputs.push(parseLogText(fs.readFileSync(path.resolve(options.eventsFile), 'utf8'), defaults));
    if (options.stdin) inputs.push(parseLogText(fs.readFileSync(0, 'utf8'), defaults));
    return inputs.reduce((summary, item) => {
        summary.legacyEvents.push(...item.legacyEvents);
        summary.httpRequests.push(...item.httpRequests);
        summary.nonEmptyLines += item.nonEmptyLines;
        summary.recognizedLines += item.recognizedLines;
        return summary;
    }, { legacyEvents: [], httpRequests: [], nonEmptyLines: 0, recognizedLines: 0 });
}

function windowCompleteness(options = {}, window = {}) {
    const start = safeDate(options.deploymentStart);
    const end = safeDate(options.deploymentEnd) || new Date();
    if (!start) return { complete: false, observedHours: 0, reason: 'deployment_start_missing' };
    const observedHours = Math.max(0, (end - start) / 3_600_000);
    return {
        complete: observedHours >= window.hours,
        observedHours: Math.round(observedHours * 10) / 10,
        reason: observedHours >= window.hours ? 'complete' : 'deployment_window_too_short'
    };
}

function summarizeHttp(requests = []) {
    const byStatusClass = {};
    for (const request of requests) {
        const statusClass = Number.isFinite(request.status) ? `${Math.floor(request.status / 100)}xx` : 'unknown';
        byStatusClass[statusClass] = (byStatusClass[statusClass] || 0) + 1;
    }
    return { totalRequests: requests.length, byStatusClass };
}

function buildWindowReport(options = {}, window = {}, input = {}) {
    const events = (input.legacyEvents || []).map(item => sanitizeTelemetryEvent(item.event || item));
    const usage = aggregateLegacyAiDraftDeprecationUsage(events);
    const http = summarizeHttp(input.httpRequests || []);
    const completeness = windowCompleteness(options, window);
    const telemetryGap = http.totalRequests > 0 && usage.totalEvents === 0;
    let reason = VERDICT_REASONS.HOLD_REMOVAL;
    if (telemetryGap) reason = VERDICT_REASONS.TELEMETRY_GAP;
    else if (usage.realUsageRequests > 0) reason = VERDICT_REASONS.DOCUMENTED_CONSUMER;
    else if (window.label === '30d' && completeness.complete && usage.realUsageRequests === 0) {
        reason = VERDICT_REASONS.READY_FOR_REMOVAL_CONFIRMATION;
    }
    return {
        label: window.label,
        since: window.since,
        requiredHours: window.hours,
        completeness,
        sources: {
            httpRequests: http.totalRequests,
            legacyTelemetryEvents: usage.totalEvents,
            recognizedLines: input.recognizedLines || 0,
            nonEmptyLines: input.nonEmptyLines || 0
        },
        http,
        usage,
        verdictReason: reason
    };
}

function buildReport(options = {}, windowInputs = []) {
    const metadataIssues = exactMetadataIssues(options);
    const windows = options.windows || DEFAULT_WINDOWS;
    const windowReports = windows.map((window, index) => buildWindowReport(options, window, windowInputs[index] || {}));
    let verdictReason = VERDICT_REASONS.HOLD_REMOVAL;
    if (metadataIssues.length) verdictReason = VERDICT_REASONS.INVALID_ARTIFACT_METADATA;
    else if (windowReports.some(item => item.verdictReason === VERDICT_REASONS.TELEMETRY_GAP)) verdictReason = VERDICT_REASONS.TELEMETRY_GAP;
    else if (windowReports.some(item => item.verdictReason === VERDICT_REASONS.DOCUMENTED_CONSUMER)) verdictReason = VERDICT_REASONS.DOCUMENTED_CONSUMER;
    else if (windowReports.some(item => item.verdictReason === VERDICT_REASONS.READY_FOR_REMOVAL_CONFIRMATION)) {
        verdictReason = VERDICT_REASONS.READY_FOR_REMOVAL_CONFIRMATION;
    }
    return {
        generatedAt: new Date().toISOString(),
        report: 'task_ai_legacy_decompose_usage',
        contentPolicy: 'sanitized metadata only; task content and secrets are excluded',
        release: {
            version: String(options.version || '').trim() || null,
            sha: String(options.sha || '').trim() || null,
            sourceBranch: String(options.sourceBranch || '').trim() || null,
            deploymentId: String(options.deploymentId || '').trim() || null,
            deploymentStart: safeDate(options.deploymentStart)?.toISOString() || null,
            deploymentEnd: safeDate(options.deploymentEnd)?.toISOString() || null
        },
        endpoint: LEGACY_ROUTE,
        windows: windowReports,
        verdict: {
            status: verdictReason === VERDICT_REASONS.READY_FOR_REMOVAL_CONFIRMATION ? 'ready_for_confirmation' : 'hold',
            reason: verdictReason,
            metadataIssues,
            removalAllowedWithoutConfirmation: false
        }
    };
}

function reportMarkdown(report = {}) {
    return [
        '# Legacy task AI decomposition usage report',
        '',
        `- generatedAt: \`${report.generatedAt}\``,
        `- version/SHA: \`${report.release?.version || 'unknown'}\` / \`${report.release?.sha || 'unknown'}\``,
        `- source/deployment: \`${report.release?.sourceBranch || 'unknown'}\` / \`${report.release?.deploymentId || 'unknown'}\``,
        `- endpoint: \`${report.endpoint}\``,
        `- verdict: \`${report.verdict?.status || 'hold'}\``,
        `- verdict reason: \`${report.verdict?.reason || VERDICT_REASONS.HOLD_REMOVAL}\``,
        `- removal requires confirmation: \`${report.verdict?.removalAllowedWithoutConfirmation === false}\``,
        '',
        '## Windows',
        '',
        ...(report.windows || []).map(item => [
            `### ${item.label}`,
            '',
            `- complete: \`${item.completeness?.complete === true}\` (${item.completeness?.reason || 'unknown'}, observed ${item.completeness?.observedHours || 0}h / required ${item.requiredHours}h)`,
            `- HTTP calls: ${item.sources?.httpRequests || 0}`,
            `- legacy telemetry events: ${item.sources?.legacyTelemetryEvents || 0}`,
            `- real usage requests: ${item.usage?.realUsageRequests || 0}`,
            `- QA events excluded: ${item.usage?.qaEvents || 0}`,
            `- verdict reason: \`${item.verdictReason}\``,
            ''
        ].join('\n')),
        '## Metadata issues',
        '',
        ...((report.verdict?.metadataIssues || []).length ? report.verdict.metadataIssues.map(item => `- ${item}`) : ['- none']),
        ''
    ].join('\n');
}

function artifactPaths(options = {}) {
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = options.outputPrefix ? path.resolve(options.outputPrefix) : path.join(OUTPUT_ROOT, stamp);
    return { json: `${prefix}.json`, markdown: `${prefix}.md` };
}

function writeArtifacts(report, options = {}) {
    const paths = artifactPaths(options);
    fs.mkdirSync(path.dirname(paths.json), { recursive: true });
    fs.writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(paths.markdown, reportMarkdown(report), 'utf8');
    return paths;
}

async function run(options = {}, dependencies = {}) {
    const windows = options.windows || DEFAULT_WINDOWS;
    const inputs = options.stdin || options.eventsFile
        ? [assertRecognizedInput(loadInput(options))]
        : windows.map(window => collectWindow(options, window, dependencies.runner || spawnSync));
    const report = buildReport(options, inputs);
    const artifacts = writeArtifacts(report, options);
    return { report, artifacts };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    const result = await run(options);
    process.stdout.write(`${JSON.stringify({
        verdict: result.report.verdict.status,
        verdictReason: result.report.verdict.reason,
        artifacts: result.artifacts
    }, null, 2)}\n`);
    if (result.report.verdict.status !== 'ready_for_confirmation') process.exitCode = 1;
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`Legacy decompose usage report failed: ${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULT_WINDOWS,
    LEGACY_ROUTE,
    VERDICT_REASONS,
    assertRecognizedInput,
    buildReport,
    parseArgs,
    parseLogText,
    parseWindowList,
    reportMarkdown,
    run,
    windowCompleteness
};
