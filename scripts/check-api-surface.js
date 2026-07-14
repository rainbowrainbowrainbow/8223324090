#!/usr/bin/env node
/**
 * API route surface ownership guard.
 *
 * This check keeps route files from becoming orphaned and makes broad /api
 * mounts explicit. It is intentionally structural; behavior remains covered by
 * focused route tests and route-smoke tests.
 */

const fs = require('fs');
const path = require('path');
const {
    GENERIC_API_ROUTE_MOUNTS,
    NESTED_API_ROUTE_MOUNTS,
    SERVER_LEVEL_API_ROUTES,
    SERVER_LEVEL_API_MOUNTS
} = require('../config/apiSurface');

const ROOT = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(ROOT, 'routes');
const SERVER_PATH = path.join(ROOT, 'server.js');
const DOC_PATH = path.join(ROOT, 'docs', 'API_SURFACE.md');
const failures = [];

function fail(message) {
    failures.push(message);
}

function normalizeRouteFile(routeName) {
    return `routes/${routeName}.js`;
}

function sorted(values) {
    return [...values].sort();
}

function keyFor(entry) {
    return `${entry.method || 'USE'} ${entry.path}`;
}

function compareSets(label, actual, expected) {
    const actualSorted = sorted(actual);
    const expectedSorted = sorted(expected);
    const missing = expectedSorted.filter(item => !actualSorted.includes(item));
    const extra = actualSorted.filter(item => !expectedSorted.includes(item));

    if (missing.length || extra.length) {
        fail(`${label} mismatch${missing.length ? `; missing: ${missing.join(', ')}` : ''}${extra.length ? `; extra: ${extra.join(', ')}` : ''}`);
    }
}

function parseStringLiteral(raw) {
    const value = raw.trim();
    const quote = value[0];
    if (!['"', "'", '`'].includes(quote)) return null;
    let result = '';
    let escaped = false;
    for (let idx = 1; idx < value.length; idx += 1) {
        const ch = value[idx];
        if (escaped) {
            result += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === quote) return result;
        result += ch;
    }
    return null;
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

function parseServer() {
    const server = fs.readFileSync(SERVER_PATH, 'utf8');
    const lines = server.split(/\r?\n/);
    const routeVars = new Map();
    const mounts = [];
    const serverApiRoutes = [];
    const serverApiMounts = [];

    lines.forEach((line, index) => {
        const lineNo = index + 1;
        let match = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\((['"`])\.\/routes\/([^'"`]+)\2\)/);
        if (match) {
            routeVars.set(match[1], normalizeRouteFile(match[3]));
        }
    });

    lines.forEach((line, index) => {
        const lineNo = index + 1;
        let match = line.match(/app\.use\((['"`])([^'"`]+)\1,\s*require\((['"`])\.\/routes\/([^'"`]+)\3\)/);
        if (match) {
            mounts.push({
                line: lineNo,
                mount: match[2],
                routeFile: normalizeRouteFile(match[4])
            });
            return;
        }

        const useCall = splitFirstCallArg(line, 'app.use');
        if (useCall) {
            const mount = parseStringLiteral(useCall.firstArg);
            const handlerVar = useCall.rest.match(/^\s*([A-Za-z_$][\w$]*)\s*\)?\s*;?\s*$/)?.[1];
            if (mount && handlerVar && routeVars.has(handlerVar)) {
                mounts.push({
                    line: lineNo,
                    mount,
                    routeFile: routeVars.get(handlerVar),
                    variable: handlerVar
                });
                return;
            }
            if (mount && mount.startsWith('/api-docs')) {
                serverApiMounts.push({ line: lineNo, method: 'USE', path: mount });
            }
        }

        for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
            const call = splitFirstCallArg(line, `app.${method}`);
            if (!call) continue;
            const routePath = parseStringLiteral(call.firstArg);
            if (routePath && routePath.startsWith('/api')) {
                serverApiRoutes.push({
                    line: lineNo,
                    method: method.toUpperCase(),
                    path: routePath
                });
            }
        }
    });

    return { mounts, serverApiRoutes, serverApiMounts };
}

const routeFiles = fs.readdirSync(ROUTES_DIR)
    .filter(name => name.endsWith('.js'))
    .map(name => `routes/${name}`)
    .sort();
const { mounts, serverApiRoutes, serverApiMounts } = parseServer();
const doc = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, 'utf8') : '';

if (!doc) fail('docs/API_SURFACE.md is required');

const mountedRouteFiles = new Set([
    ...mounts.map(mount => mount.routeFile),
    ...NESTED_API_ROUTE_MOUNTS.map(mount => mount.routeFile)
]);
compareSets('routes directory vs server.js route mounts', mountedRouteFiles, routeFiles);

for (const mount of mounts) {
    if (!routeFiles.includes(mount.routeFile)) {
        fail(`${mount.mount}: ${mount.routeFile} does not exist`);
    }
    if (!mount.mount.startsWith('/api')) {
        fail(`${mount.routeFile}: API route mount must start with /api, got ${mount.mount}`);
    }
    if (!doc.includes(`\`${mount.routeFile}\``)) {
        fail(`${mount.routeFile}: missing from docs/API_SURFACE.md`);
    }
    if (!doc.includes(`\`${mount.mount}\``)) {
        fail(`${mount.mount}: missing from docs/API_SURFACE.md`);
    }
}

const genericMounts = mounts
    .filter(mount => mount.mount === '/api')
    .map(mount => `${mount.mount} ${mount.routeFile}`);
const allowedGenericMounts = GENERIC_API_ROUTE_MOUNTS
    .map(mount => `${mount.mount} ${mount.routeFile}`);
compareSets('generic /api route mounts', genericMounts, allowedGenericMounts);

for (const mount of GENERIC_API_ROUTE_MOUNTS) {
    if (!mount.mount || !mount.routeFile || !mount.owner || !mount.reason) {
        fail(`generic API mount is incomplete: ${JSON.stringify(mount)}`);
        continue;
    }
    if (!routeFiles.includes(mount.routeFile)) {
        fail(`generic API mount ${mount.routeFile}: route file does not exist`);
    }
    if (!doc.includes(`\`${mount.routeFile}\``) || !doc.includes(`\`${mount.mount}\``)) {
        fail(`generic API mount ${mount.routeFile}: missing from docs/API_SURFACE.md`);
    }
}

for (const mount of NESTED_API_ROUTE_MOUNTS) {
    if (!mount.mount || !mount.routeFile || !mount.parentRouteFile || !mount.owner || !mount.reason) {
        fail(`nested API mount is incomplete: ${JSON.stringify(mount)}`);
        continue;
    }
    if (!routeFiles.includes(mount.routeFile)) {
        fail(`nested API mount ${mount.routeFile}: route file does not exist`);
    }
    if (!routeFiles.includes(mount.parentRouteFile)) {
        fail(`nested API mount ${mount.routeFile}: parent route file ${mount.parentRouteFile} does not exist`);
    }
    if (!mount.mount.startsWith('/api')) {
        fail(`nested API mount ${mount.routeFile}: mount must start with /api, got ${mount.mount}`);
    }
    if (!doc.includes(`\`${mount.routeFile}\``) || !doc.includes(`\`${mount.parentRouteFile}\``) || !doc.includes(`\`${mount.mount}\``)) {
        fail(`nested API mount ${mount.routeFile}: missing from docs/API_SURFACE.md`);
    }
}

compareSets(
    'server-level API routes',
    serverApiRoutes.map(keyFor),
    SERVER_LEVEL_API_ROUTES.map(keyFor)
);
compareSets(
    'server-level API mounts',
    serverApiMounts.map(keyFor),
    SERVER_LEVEL_API_MOUNTS.map(keyFor)
);

for (const entry of [...SERVER_LEVEL_API_ROUTES, ...SERVER_LEVEL_API_MOUNTS]) {
    if (!entry.method || !entry.path || !entry.owner || !entry.reason) {
        fail(`server-level API entry is incomplete: ${JSON.stringify(entry)}`);
        continue;
    }
    if (!doc.includes(`\`${entry.method} ${entry.path}\``)) {
        fail(`${entry.method} ${entry.path}: missing from docs/API_SURFACE.md`);
    }
}

if (failures.length) {
    console.error('API surface check failed:');
    failures.forEach(message => console.error(`- ${message}`));
    process.exit(1);
}

console.log(`API surface check passed: ${routeFiles.length} route files, ${mounts.length} direct route mounts, ${NESTED_API_ROUTE_MOUNTS.length} nested route mounts, ${serverApiRoutes.length} server-level API routes.`);
