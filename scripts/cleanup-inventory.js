#!/usr/bin/env node
/**
 * Cleanup inventory for Event Genix.
 *
 * This is intentionally read-only and conservative. It does not decide what is
 * dead code; it shows the current repo shape so cleanup packs can be scoped
 * with evidence.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TRACKED_DIRS = [
    'routes',
    'services',
    'js',
    'css',
    'tests',
    path.join('db', 'migrations'),
    'landing',
    'docs'
];
const ACTIVE_ROOT_DOCS = new Set([
    'AGENTS.md',
    'CHANGELOG.md',
    'DB_MIGRATION_GOVERNANCE.md',
    'README.md'
]);

function readText(file) {
    return fs.readFileSync(file, 'utf8');
}

function loadTrackedFiles() {
    const output = execFileSync('git', ['ls-files', '-z'], {
        cwd: ROOT,
        encoding: 'buffer'
    });
    return output
        .toString('utf8')
        .split('\0')
        .filter(Boolean)
        .map(file => file.replace(/\\/g, '/'))
        .sort((a, b) => a.localeCompare(b));
}

function lineCount(file) {
    const text = readText(file);
    if (!text) return 0;
    return text.split(/\r?\n/).length;
}

function hasTrackedPrefix(trackedFiles, dir) {
    const prefix = `${dir.replace(/\\/g, '/')}/`;
    return trackedFiles.some(file => file.startsWith(prefix));
}

function trackedFilesInDir(trackedFiles, dir) {
    const prefix = `${dir.replace(/\\/g, '/')}/`;
    return trackedFiles.filter(file => file.startsWith(prefix));
}

function dirSnapshot(trackedFiles) {
    return TRACKED_DIRS
        .filter(dir => hasTrackedPrefix(trackedFiles, dir))
        .map(dir => {
            const files = trackedFilesInDir(trackedFiles, dir);
            const bytes = files.reduce((sum, file) => {
                const abs = path.join(ROOT, file);
                if (!fs.existsSync(abs)) return sum;
                return sum + fs.statSync(abs).size;
            }, 0);
            return {
                dir: dir.replace(/\\/g, '/'),
                files: files.length,
                kb: Number((bytes / 1024).toFixed(1))
            };
        });
}

function largestFiles(trackedFiles, limit = 25) {
    return trackedFiles
        .filter(file => /\.(js|html|css)$/.test(file))
        .map(file => ({ path: file, lines: lineCount(path.join(ROOT, file)) }))
        .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
        .slice(0, limit);
}

function parseServerMounts() {
    const file = path.join(ROOT, 'server.js');
    const lines = readText(file).split(/\r?\n/);
    const apiMounts = [];
    const pageRoutes = [];
    const routeRequires = new Set();

    lines.forEach((line, index) => {
        const lineNo = index + 1;
        let match = line.match(/app\.use\((['"`])([^'"`]+)\1,\s*require\((['"`])\.\/routes\/([^'"`]+)\3\)/);
        if (match) {
            const routeFile = `routes/${match[4]}.js`;
            apiMounts.push({ line: lineNo, mount: match[2], file: routeFile });
            routeRequires.add(routeFile);
            return;
        }

        match = line.match(/require\((['"`])\.\/routes\/([^'"`]+)\1\)/);
        if (match) {
            routeRequires.add(`routes/${match[2]}.js`);
        }

        const getCall = splitFirstCallArg(line, 'app.get');
        if (getCall) {
            const routeExpr = getCall.firstArg.trim();
            const handler = getCall.rest.trim();
            if (!routeExpr.startsWith("'*'") && !routeExpr.startsWith('`*`')) {
                pageRoutes.push({
                    line: lineNo,
                    route: routeExpr,
                    handler: handler.length > 90 ? `${handler.slice(0, 87)}...` : handler
                });
            }
        }
    });

    return { apiMounts, pageRoutes, routeRequires };
}

function splitFirstCallArg(line, callName) {
    const callIndex = line.indexOf(`${callName}(`);
    if (callIndex === -1) return null;

    const start = callIndex + callName.length + 1;
    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let idx = start; idx < line.length; idx += 1) {
        const ch = line[idx];

        if (quote) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === quote) quote = null;
            continue;
        }

        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            continue;
        }
        if (ch === '[' || ch === '(' || ch === '{') {
            depth += 1;
            continue;
        }
        if (ch === ']' || ch === ')' || ch === '}') {
            depth -= 1;
            continue;
        }
        if (ch === ',' && depth === 0) {
            return {
                firstArg: line.slice(start, idx),
                rest: line.slice(idx + 1)
            };
        }
    }

    return null;
}

function routeFilesNotMounted(routeRequires, trackedFiles) {
    return trackedFiles
        .filter(file => /^routes\/[^/]+\.js$/.test(file))
        .filter(file => !routeRequires.has(file))
        .sort();
}

function rootHtmlFiles(trackedFiles) {
    const server = readText(path.join(ROOT, 'server.js'));
    return trackedFiles
        .filter(name => /^[^/]+\.html$/.test(name))
        .sort()
        .map(name => {
            const hasNamedSend = server.includes(`'${name}'`) || server.includes(`"${name}"`);
            return {
                file: name,
                exposure: hasNamedSend ? 'direct route or explicit reference' : 'root static fallback'
            };
        });
}

function docsSnapshot(trackedFiles) {
    const rootDocs = trackedFiles
        .filter(name => /^[^/]+\.md$/.test(name))
        .sort()
        .map(name => ({
            file: name,
            status: ACTIVE_ROOT_DOCS.has(name) ? 'active root doc' : 'review/archive candidate'
        }));
    const docs = trackedFiles
        .filter(file => /^docs\/.+\.md$/.test(file))
        .sort();
    return { rootDocs, docs };
}

function migrationSnapshot(trackedFiles) {
    const dir = path.join(ROOT, 'db', 'migrations');
    if (!fs.existsSync(dir)) return null;

    const files = trackedFiles
        .filter(file => /^db\/migrations\/[^/]+\.sql$/.test(file))
        .map(file => path.basename(file))
        .sort();
    const numbers = files
        .map(name => {
            const match = name.match(/^(\d+)_/);
            return match ? Number(match[1]) : null;
        })
        .filter(num => Number.isInteger(num));
    const counts = new Map();
    numbers.forEach(num => counts.set(num, (counts.get(num) || 0) + 1));
    const duplicates = [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([num]) => String(num).padStart(3, '0'));
    const max = numbers.length ? Math.max(...numbers) : null;
    const gaps = [];
    if (max !== null) {
        for (let num = 1; num <= max; num += 1) {
            if (!counts.has(num)) gaps.push(String(num).padStart(3, '0'));
        }
    }

    return { files: files.length, highest: max, duplicates, gaps };
}

function table(rows, columns) {
    if (!rows.length) return '_None._\n';
    const header = `| ${columns.map(c => c.title).join(' | ')} |`;
    const sep = `| ${columns.map(() => '---').join(' | ')} |`;
    const body = rows.map(row => `| ${columns.map(c => tableCell(row[c.key])).join(' | ')} |`);
    return `${[header, sep, ...body].join('\n')}\n`;
}

function tableCell(value) {
    return String(value ?? '')
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, ' ');
}

function renderMarkdown(data) {
    const out = [];
    out.push('# Event Genix Cleanup Inventory');
    out.push('');
    out.push(`Generated: ${new Date().toISOString()}`);
    out.push('');
    out.push('## Directory Snapshot');
    out.push('');
    out.push(table(data.dirs, [
        { key: 'dir', title: 'Directory' },
        { key: 'files', title: 'Files' },
        { key: 'kb', title: 'KB' }
    ]));
    out.push('## Largest JS/HTML/CSS Files');
    out.push('');
    out.push(table(data.largestFiles, [
        { key: 'lines', title: 'Lines' },
        { key: 'path', title: 'Path' }
    ]));
    out.push('## API Mounts From server.js');
    out.push('');
    out.push(table(data.apiMounts, [
        { key: 'line', title: 'Line' },
        { key: 'mount', title: 'Mount' },
        { key: 'file', title: 'Route File' }
    ]));
    out.push('## Page Routes From server.js');
    out.push('');
    out.push(table(data.pageRoutes, [
        { key: 'line', title: 'Line' },
        { key: 'route', title: 'Route Expression' },
        { key: 'handler', title: 'Handler Start' }
    ]));
    out.push('## Route Files Not Directly Mounted In server.js');
    out.push('');
    out.push(data.unmountedRouteFiles.length
        ? data.unmountedRouteFiles.map(file => `- ${file}`).join('\n')
        : '_None._');
    out.push('');
    out.push('These files may still be required indirectly. Treat this as an audit queue, not a delete list.');
    out.push('');
    out.push('## Root HTML Exposure');
    out.push('');
    out.push(table(data.rootHtml, [
        { key: 'file', title: 'File' },
        { key: 'exposure', title: 'Exposure' }
    ]));
    out.push('## Root Markdown Docs');
    out.push('');
    out.push(table(data.docs.rootDocs, [
        { key: 'file', title: 'File' },
        { key: 'status', title: 'Status' }
    ]));
    out.push('## Docs Folder Markdown');
    out.push('');
    out.push(data.docs.docs.length ? data.docs.docs.map(file => `- ${file}`).join('\n') : '_None._');
    out.push('');
    out.push('## Migration Snapshot');
    out.push('');
    if (data.migrations) {
        out.push(`- Files: ${data.migrations.files}`);
        out.push(`- Highest number: ${String(data.migrations.highest).padStart(3, '0')}`);
        out.push(`- Duplicate numbers: ${data.migrations.duplicates.join(', ') || 'none'}`);
        out.push(`- Numbering gaps: ${data.migrations.gaps.join(', ') || 'none'}`);
    } else {
        out.push('_No migration directory found._');
    }
    out.push('');
    return `${out.join('\n')}\n`;
}

function buildInventory({ trackedFiles = loadTrackedFiles() } = {}) {
    const { apiMounts, pageRoutes, routeRequires } = parseServerMounts();
    return {
        dirs: dirSnapshot(trackedFiles),
        largestFiles: largestFiles(trackedFiles),
        apiMounts,
        pageRoutes,
        unmountedRouteFiles: routeFilesNotMounted(routeRequires, trackedFiles),
        rootHtml: rootHtmlFiles(trackedFiles),
        docs: docsSnapshot(trackedFiles),
        migrations: migrationSnapshot(trackedFiles)
    };
}

function main(argv = process.argv) {
    const inventory = buildInventory();

    if (argv.includes('--json')) {
        console.log(JSON.stringify(inventory, null, 2));
    } else {
        console.log(renderMarkdown(inventory));
    }
}

if (require.main === module) main();

module.exports = {
    buildInventory,
    loadTrackedFiles,
    renderMarkdown
};
