#!/usr/bin/env node
/**
 * Runtime baseline guard.
 *
 * Event Genix is pinned to Node 22.x / npm 10.x so local verification and
 * Railway builds exercise the same supported major versions.
 */

const REQUIRED_NODE_MAJOR = 22;
const REQUIRED_NPM_MAJOR = 10;
const fs = require('fs');
const path = require('path');

function major(version) {
    const match = String(version || '').match(/^v?(\d+)\./);
    return match ? Number(match[1]) : null;
}

function npmVersionFromUserAgent(userAgent) {
    const match = String(userAgent || '').match(/\bnpm\/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
}

function npmVersionFromExecPath(execPath) {
    if (!execPath) return null;

    const packagePath = path.resolve(path.dirname(execPath), '..', 'package.json');
    try {
        return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version || null;
    } catch (err) {
        return null;
    }
}

const nodeVersion = process.versions.node;
const nodeMajor = major(nodeVersion);
const npmVersion = npmVersionFromExecPath(process.env.npm_execpath) ||
    npmVersionFromUserAgent(process.env.npm_config_user_agent);
const npmMajor = npmVersion ? major(npmVersion) : null;
const failures = [];

if (nodeMajor !== REQUIRED_NODE_MAJOR) {
    failures.push(`Node ${nodeVersion} detected, expected Node ${REQUIRED_NODE_MAJOR}.x`);
}

if (npmVersion && npmMajor !== REQUIRED_NPM_MAJOR) {
    failures.push(`npm ${npmVersion} detected, expected npm ${REQUIRED_NPM_MAJOR}.x`);
}

if (!npmVersion && process.env.npm_lifecycle_event) {
    failures.push('npm version could not be detected from npm_config_user_agent');
}

if (failures.length > 0) {
    console.error('Runtime baseline check failed:');
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    console.error('\nUse Node 22.x with npm 10.x before running verification or deploy commands.');
    process.exit(1);
}

const npmLabel = npmVersion ? ` / npm ${npmVersion}` : '';
console.log(`Runtime baseline check passed: Node ${nodeVersion}${npmLabel}.`);
