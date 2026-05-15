/**
 * Lightweight local .env loader.
 *
 * Production platforms should still provide secrets through real environment
 * variables. This only makes local desktop/dev runs pick up untracked .env
 * files before services read process.env.
 */
const fs = require('fs');
const path = require('path');

function stripQuotes(value) {
    const text = String(value || '').trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        return text.slice(1, -1);
    }
    return text;
}

function parseEnvLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) return null;

    const key = trimmed.slice(0, eq).trim();
    const value = stripQuotes(trimmed.slice(eq + 1));
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
    return { key, value };
}

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
        const parsed = parseEnvLine(line);
        if (!parsed) continue;
        if (process.env[parsed.key] === undefined) {
            process.env[parsed.key] = parsed.value;
        }
    }
    return true;
}

function loadLocalEnv(rootDir = process.cwd()) {
    const candidates = ['.env', '.env.local'];
    for (const name of candidates) {
        loadEnvFile(path.join(rootDir, name));
    }
}

module.exports = { loadLocalEnv, parseEnvLine };
