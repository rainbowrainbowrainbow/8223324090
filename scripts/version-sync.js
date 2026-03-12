#!/usr/bin/env node
/**
 * scripts/version-sync.js — Single source of truth: package.json → everywhere
 *
 * Usage:
 *   node scripts/version-sync.js              # Check mode — reports mismatches
 *   node scripts/version-sync.js --fix        # Fix mode — updates all files
 *   node scripts/version-sync.js --bump patch # Bump + fix (patch/minor/major)
 *
 * What it syncs:
 *   1. package.json          → version (source of truth)
 *   2. index.html            → all ?v=X.X.X on CSS/JS tags
 *   3. index.html            → tagline text
 *   4. index.html            → changelog button text
 *   5. sw.js                 → CACHE_NAME + API_CACHE_NAME
 *   6. All standalone .html  → ?v=X.X.X on CSS/JS tags
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIX = process.argv.includes('--fix');
const BUMP = process.argv.indexOf('--bump');
const BUMP_TYPE = BUMP !== -1 ? process.argv[BUMP + 1] : null;

// ═══ Colors ═══
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let issues = 0;
let fixed = 0;

function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf-8');
}

function write(file, content) {
    fs.writeFileSync(path.join(ROOT, file), content, 'utf-8');
}

function report(file, what, actual, expected) {
    issues++;
    if (FIX) {
        console.log(`  ${GREEN}FIXED${RESET}  ${file}: ${what} ${RED}${actual}${RESET} → ${GREEN}${expected}${RESET}`);
        fixed++;
    } else {
        console.log(`  ${RED}MISMATCH${RESET}  ${file}: ${what} is ${RED}${actual}${RESET}, expected ${GREEN}${expected}${RESET}`);
    }
}

function ok(file, what) {
    console.log(`  ${GREEN}OK${RESET}     ${file}: ${what}`);
}

// ═══ 1. Read / bump package.json version ═══
const pkgPath = 'package.json';
let pkg = JSON.parse(read(pkgPath));
let version = pkg.version;

if (BUMP_TYPE) {
    const [major, minor, patch] = version.split('.').map(Number);
    if (BUMP_TYPE === 'patch') version = `${major}.${minor}.${patch + 1}`;
    else if (BUMP_TYPE === 'minor') version = `${major}.${minor + 1}.0`;
    else if (BUMP_TYPE === 'major') version = `${major + 1}.0.0`;
    else {
        console.error(`${RED}Unknown bump type: ${BUMP_TYPE}. Use patch/minor/major${RESET}`);
        process.exit(1);
    }
    pkg.version = version;
    write(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`${CYAN}Bumped${RESET} package.json → ${BOLD}v${version}${RESET}\n`);
}

console.log(`${BOLD}Version sync: v${version}${RESET} (source: package.json)\n`);

// ═══ 2. index.html — cache busters ?v=X.X.X ═══
let indexHtml = read('index.html');
const vTagRegex = /\?v=[\d.]+/g;
const vTags = indexHtml.match(vTagRegex) || [];
const wrongTags = vTags.filter(t => t !== `?v=${version}`);

if (wrongTags.length > 0) {
    report('index.html', `${wrongTags.length}/${vTags.length} ?v= tags`, wrongTags[0], `?v=${version}`);
    if (FIX) {
        indexHtml = indexHtml.replace(vTagRegex, `?v=${version}`);
    }
} else if (vTags.length > 0) {
    ok('index.html', `${vTags.length} ?v= tags all correct`);
}

// ═══ 3. index.html — tagline ═══
const taglineRegex = /(<p class="tagline">AI First CRM v)([\d.]+)( —[^<]*<\/p>)/;
const taglineMatch = indexHtml.match(taglineRegex);
if (taglineMatch) {
    if (taglineMatch[2] !== version) {
        report('index.html', 'tagline version', taglineMatch[2], version);
        if (FIX) {
            indexHtml = indexHtml.replace(taglineRegex, `$1${version}$3`);
        }
    } else {
        ok('index.html', 'tagline version');
    }
}

// ═══ 4. index.html — changelog button ═══
const changelogBtnRegex = /(Що нового у v)([\d.]+)/;
const changelogMatch = indexHtml.match(changelogBtnRegex);
if (changelogMatch) {
    if (changelogMatch[2] !== version) {
        report('index.html', 'changelog button', changelogMatch[2], version);
        if (FIX) {
            indexHtml = indexHtml.replace(changelogBtnRegex, `$1${version}`);
        }
    } else {
        ok('index.html', 'changelog button');
    }
}

if (FIX) write('index.html', indexHtml);

// ═══ 5. sw.js — CACHE_NAME ═══
const swPath = 'sw.js';
if (fs.existsSync(path.join(ROOT, swPath))) {
    let sw = read(swPath);
    const majorVersion = version.split('.')[0];
    const expectedCache = `event-genix-v${majorVersion}`;
    const expectedApiCache = `event-genix-api-v${majorVersion}`;

    const cacheMatch = sw.match(/CACHE_NAME = '([^']+)'/);
    const apiCacheMatch = sw.match(/API_CACHE_NAME = '([^']+)'/);

    if (cacheMatch && cacheMatch[1] !== expectedCache) {
        report('sw.js', 'CACHE_NAME', cacheMatch[1], expectedCache);
        if (FIX) sw = sw.replace(/CACHE_NAME = '[^']+'/, `CACHE_NAME = '${expectedCache}'`);
    } else if (cacheMatch) {
        ok('sw.js', 'CACHE_NAME');
    }

    if (apiCacheMatch && apiCacheMatch[1] !== expectedApiCache) {
        report('sw.js', 'API_CACHE_NAME', apiCacheMatch[1], expectedApiCache);
        if (FIX) sw = sw.replace(/API_CACHE_NAME = '[^']+'/, `API_CACHE_NAME = '${expectedApiCache}'`);
    } else if (apiCacheMatch) {
        ok('sw.js', 'API_CACHE_NAME');
    }

    if (FIX) write(swPath, sw);
}

// ═══ 6. Standalone HTML pages — ?v= tags ═══
const standalonePages = fs.readdirSync(ROOT)
    .filter(f => f.endsWith('.html') && f !== 'index.html')
    .filter(f => !fs.statSync(path.join(ROOT, f)).isDirectory());

for (const page of standalonePages) {
    let html = read(page);
    const pageTags = html.match(vTagRegex) || [];
    const pageWrong = pageTags.filter(t => t !== `?v=${version}`);
    if (pageWrong.length > 0) {
        report(page, `${pageWrong.length} ?v= tags`, pageWrong[0], `?v=${version}`);
        if (FIX) {
            html = html.replace(vTagRegex, `?v=${version}`);
            write(page, html);
        }
    }
}

// ═══ Summary ═══
console.log('');
if (issues === 0) {
    console.log(`${GREEN}${BOLD}All version references are in sync!${RESET}`);
} else if (FIX) {
    console.log(`${GREEN}${BOLD}Fixed ${fixed} issue(s).${RESET} Run ${CYAN}node scripts/version-sync.js${RESET} to verify.`);
} else {
    console.log(`${RED}${BOLD}Found ${issues} issue(s).${RESET} Run ${CYAN}node scripts/version-sync.js --fix${RESET} to auto-fix.`);
    process.exit(1);
}
