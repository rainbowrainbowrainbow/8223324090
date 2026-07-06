#!/usr/bin/env node
/**
 * scripts/version-sync.js - Single source of truth: package.json -> derived version markers.
 *
 * Usage:
 *   node scripts/version-sync.js              # Check mode
 *   node scripts/version-sync.js --fix        # Fix mode
 *   node scripts/version-sync.js --fix --bump patch --label "Release Label"
 *                                             # Bump package.json + release label + derived markers
 *
 * Synced/checked surfaces:
 *   1. package.json version + eventGenix.releaseLabel (source of truth)
 *   2. package-lock.json root package versions
 *   3. HTML/CSS/JS/image asset query strings in href/src attributes, quoted asset refs, and CSS @import refs
 *   4. first-screen release badge, tagline, and changelog button
 *   5. index.html latest changelog modal entry version + label
 *   6. CHANGELOG.md latest heading version + label
 *   7. sw.js CACHE_NAME and API_CACHE_NAME
 *   8. server.js inline versioned asset references
 *   9. /api/version static route contract uses services/release.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIX = process.argv.includes('--fix');
const BUMP = process.argv.indexOf('--bump');
const BUMP_TYPE = BUMP !== -1 ? process.argv[BUMP + 1] : null;
const LABEL_ARG = readReleaseLabelArg();

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let issues = 0;
let fixed = 0;

function abs(file) {
    return path.join(ROOT, file);
}

function exists(file) {
    return fs.existsSync(abs(file));
}

function read(file) {
    return fs.readFileSync(abs(file), 'utf-8');
}

function write(file, content) {
    fs.writeFileSync(abs(file), content, 'utf-8');
}

function readJson(file) {
    return JSON.parse(read(file));
}

function writeJson(file, value) {
    write(file, JSON.stringify(value, null, 2) + '\n');
}

function readArg(name) {
    const idx = process.argv.indexOf(name);
    if (idx === -1) return null;
    const value = process.argv[idx + 1];
    return value && !value.startsWith('--') ? value : null;
}

function readArgWords(name) {
    const idx = process.argv.indexOf(name);
    if (idx === -1) return null;

    const values = [];
    for (let i = idx + 1; i < process.argv.length; i += 1) {
        const value = process.argv[i];
        if (!value || value.startsWith('--')) break;
        values.push(value);
    }

    return values.length ? values.join(' ') : null;
}

function readTrailingReleaseLabel() {
    if (BUMP === -1 || !BUMP_TYPE) return null;

    const values = [];
    for (let i = BUMP + 2; i < process.argv.length; i += 1) {
        const value = process.argv[i];
        if (!value || value.startsWith('--')) continue;
        values.push(value);
    }

    return values.length ? values.join(' ') : null;
}

function readReleaseLabelArg() {
    return readArgWords('--label')
        || readArgWords('--release-label')
        || readTrailingReleaseLabel();
}

function htmlEscape(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function normalizeLabel(value) {
    return String(value || '').trim();
}

function getReleaseLabel(pkg) {
    return normalizeLabel(pkg.eventGenix?.releaseLabel || pkg.releaseLabel);
}

function report(file, what, actual, expected, fixable = true) {
    issues++;
    if (FIX && fixable) {
        fixed++;
        console.log(`  ${GREEN}FIXED${RESET}  ${file}: ${what} ${RED}${actual}${RESET} -> ${GREEN}${expected}${RESET}`);
    } else {
        console.log(`  ${RED}MISMATCH${RESET}  ${file}: ${what} is ${RED}${actual}${RESET}, expected ${GREEN}${expected}${RESET}`);
    }
}

function ok(file, what) {
    console.log(`  ${GREEN}OK${RESET}     ${file}: ${what}`);
}

function bumpVersion(version, type) {
    const parts = version.split('.').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) {
        throw new Error(`Cannot bump non-semver version: ${version}`);
    }

    const [major, minor, patch] = parts;
    if (type === 'patch') return `${major}.${minor}.${patch + 1}`;
    if (type === 'minor') return `${major}.${minor + 1}.0`;
    if (type === 'major') return `${major + 1}.0.0`;
    throw new Error(`Unknown bump type: ${type}. Use patch/minor/major`);
}

function syncAssetVersions(file, version) {
    if (!exists(file)) return;

    let content = read(file);
    const assetVersionRegex = /((?:href|src)=["'][^"']+\?v=|["'][^"']+\.(?:css|js|png|jpe?g|svg|webp|ico)\?v=)([\d.]+)(["'])/g;
    let wrong = 0;
    let total = 0;
    let firstWrong = null;

    content = content.replace(assetVersionRegex, (match, prefix, found, suffix) => {
        total++;
        if (found !== version) {
            wrong++;
            if (!firstWrong) firstWrong = found;
            return FIX ? `${prefix}${version}${suffix}` : match;
        }
        return match;
    });

    if (wrong > 0) {
        report(file, `${wrong} asset ?v= tags`, firstWrong, version);
        if (FIX) write(file, content);
    } else if (total > 0) {
        ok(file, 'asset ?v= tags');
    }
}

function syncCssImportVersions(file, version) {
    if (!exists(file)) return;

    let content = read(file);
    const cssImportRegex = /(@import\s+(?:url\(\s*)?["']?)([^"')\s;?]+\.css)(?:\?v=([^"')\s;]+))?(["']?\s*\)?\s*;)/g;
    let wrong = 0;
    let total = 0;
    let firstWrong = null;

    content = content.replace(cssImportRegex, (match, prefix, ref, found, suffix) => {
        total++;
        if (found !== version) {
            wrong++;
            if (!firstWrong) firstWrong = found || 'missing';
            return FIX ? `${prefix}${ref}?v=${version}${suffix}` : match;
        }
        return match;
    });

    if (wrong > 0) {
        report(file, `${wrong} CSS @import ?v= tags`, firstWrong, version);
        if (FIX) write(file, content);
    } else if (total > 0) {
        ok(file, 'CSS @import ?v= tags');
    }
}

function collectVersionedAssetFiles(dir = ROOT, files = []) {
    const skipDirs = new Set(['.git', 'node_modules']);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!skipDirs.has(entry.name)) collectVersionedAssetFiles(path.join(dir, entry.name), files);
            continue;
        }

        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        if (ext !== '.html' && ext !== '.js') continue;

        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(ROOT, fullPath).replace(/\\/g, '/');
        if (rel === 'scripts/version-sync.js') continue;
        files.push(rel);
    }
    return files.sort();
}

function syncPackageLock(version) {
    const file = 'package-lock.json';
    if (!exists(file)) return;

    const lock = readJson(file);
    let changed = false;

    if (lock.version !== version) {
        report(file, 'top-level version', lock.version, version);
        if (FIX) {
            lock.version = version;
            changed = true;
        }
    } else {
        ok(file, 'top-level version');
    }

    if (lock.packages && lock.packages[''] && lock.packages[''].version !== version) {
        report(file, 'root package version', lock.packages[''].version, version);
        if (FIX) {
            lock.packages[''].version = version;
            changed = true;
        }
    } else if (lock.packages && lock.packages['']) {
        ok(file, 'root package version');
    }

    if (FIX && changed) writeJson(file, lock);
}

function publicFirstScreenLabel(releaseLabel) {
    return normalizeLabel(releaseLabel).replace(/^CRM\s+\d+(?:\.\d+)?\s*:\s*/i, '');
}

function defaultReleaseDateLabel(date = new Date()) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

function buildDefaultChangelogModalSection(version, releaseLabel) {
    const title = releaseLabel || `Release v${version}`;
    const heading = `v${version}${releaseLabel ? ` вЂ” ${releaseLabel}` : ''}`;
    return `                <div class="changelog-section">
                    <h4>${htmlEscape(heading)}</h4>
                    <ul>
                        <li><b>${htmlEscape(title)}</b> вЂ” release marker, cache tags and visible version metadata were prepared automatically.</li>
                    </ul>
                </div>
`;
}

function buildDefaultMarkdownChangelogEntry(version, releaseLabel) {
    const title = releaseLabel || `Release v${version}`;
    return `## v${version} - ${title}

### Release / Versioning / (${defaultReleaseDateLabel()}) [codex]
- **${title}** - release marker, cache tags and visible version metadata were prepared automatically.

---

`;
}

function syncFirstScreenLabels(file, version, releaseLabel, { checkLatestModal = false, releaseLabelInText = false } = {}) {
    if (!exists(file)) return;

    let html = read(file);
    const displayLabel = releaseLabelInText ? publicFirstScreenLabel(releaseLabel) : '';
    const suffix = displayLabel ? ` — ${displayLabel}` : '';

    const releaseBadgeRegex = /<div class="login-release-badge"[^>]*>[^<]*<\/div>/;
    const releaseBadgeMatch = html.match(releaseBadgeRegex);
    if (releaseBadgeMatch) {
        const expectedText = releaseLabelInText ? version : `${version}${releaseLabel ? ` ${releaseLabel}` : ''}`;
        const expectedBadge = `<div class="login-release-badge" aria-label="Поточний реліз ${htmlEscape(expectedText)}">✨ ${htmlEscape(expectedText)}</div>`;
        if (releaseBadgeMatch[0] !== expectedBadge) {
            report(file, 'login release badge', releaseBadgeMatch[0], expectedBadge);
            if (FIX) html = html.replace(releaseBadgeRegex, expectedBadge);
        } else {
            ok(file, 'login release badge');
        }
    }

    const taglineRegex = /<p class="tagline">[^<]*<\/p>/;
    const taglineMatch = html.match(taglineRegex);
    if (taglineMatch) {
        const expectedTagline = `<p class="tagline">AI First CRM v${version}${htmlEscape(suffix)}</p>`;
        if (taglineMatch[0] !== expectedTagline) {
            report(file, 'tagline', taglineMatch[0], expectedTagline);
            if (FIX) html = html.replace(taglineRegex, expectedTagline);
        } else {
            ok(file, 'tagline');
        }
    }

    const changelogButtonRegex = /<button[^>]*id="changelogBtn"[^>]*>[^<]*<\/button>/;
    const buttonMatch = html.match(changelogButtonRegex);
    if (buttonMatch) {
        const expectedButtonText = `Що нового у v${version}`;
        const expectedButton = buttonMatch[0].replace(/>[^<]*<\/button>/, `>${htmlEscape(expectedButtonText)}</button>`);
        if (buttonMatch[0] !== expectedButton) {
            report(file, 'changelog button', buttonMatch[0], expectedButton);
            if (FIX) html = html.replace(changelogButtonRegex, expectedButton);
        } else {
            ok(file, 'changelog button');
        }
    }

    if (checkLatestModal) {
        const latestModalRegex = /(<div class="changelog-list">[\s\S]*?<h4>)([\s\S]*?)(<\/h4>)/;
        const latestModalMatch = html.match(latestModalRegex);
        if (latestModalMatch) {
            const expectedHeading = `v${version}${releaseLabel ? ` — ${releaseLabel}` : ''}`;
            const expectedHeadingHtml = htmlEscape(expectedHeading);
            if (latestModalMatch[2] !== expectedHeadingHtml) {
                report(file, 'latest changelog modal entry', latestModalMatch[2], expectedHeadingHtml);
                if (FIX) {
                    const actualVersion = latestModalMatch[2].match(/v([\d.]+)/)?.[1] || '';
                    if (actualVersion === version) {
                        html = html.replace(latestModalRegex, `$1${expectedHeadingHtml}$3`);
                    } else {
                        html = html.replace(
                            /(<div class="changelog-list">\s*)/,
                            `$1${buildDefaultChangelogModalSection(version, releaseLabel)}`
                        );
                    }
                }
            } else {
                ok(file, 'latest changelog modal entry');
            }
        }
    }

    if (FIX) write(file, html);
}

function checkMarkdownChangelog(version, releaseLabel) {
    const file = 'CHANGELOG.md';
    if (!exists(file)) return;

    let markdown = read(file);
    const latestHeading = markdown.match(/^## v([\d.]+)\s+[-—]\s+(.+)$/m);
    if (!latestHeading) {
        report(file, 'latest heading', 'missing', `v${version} - ${releaseLabel}`, false);
        return;
    }

    if (latestHeading[1] !== version) {
        report(file, 'latest heading version', latestHeading[1], version);
        if (FIX) {
            markdown = markdown.replace(
                /(---\r?\n\r?\n)/,
                `$1${buildDefaultMarkdownChangelogEntry(version, releaseLabel)}`
            );
            write(file, markdown);
            ok(file, 'latest heading label');
            return;
        }
    } else {
        ok(file, 'latest heading version');
    }

    const headingLabel = normalizeLabel(latestHeading[2].replace(/\s*\([^)]*\)\s*$/, ''));
    if (headingLabel !== releaseLabel) {
        report(file, 'latest heading label', latestHeading[2], releaseLabel);
        if (FIX) {
            markdown = markdown.replace(/^## v([\d.]+)\s+[-—]\s+(.+)$/m, `## v$1 - ${releaseLabel}`);
            write(file, markdown);
        }
    } else {
        ok(file, 'latest heading label');
    }
}

function checkApiVersionContract() {
    const routeFile = 'routes/settings.js';
    const serviceFile = 'services/release.js';
    if (!exists(routeFile) || !exists(serviceFile)) return;

    const route = read(routeFile);
    const service = read(serviceFile);
    if (!route.includes("require('../services/release')") || !route.includes('getReleaseMetadata()')) {
        report(routeFile, '/api/version release source', 'inline or missing', 'services/release.js getReleaseMetadata()', false);
    } else {
        ok(routeFile, '/api/version release source');
    }

    if (!service.includes("require('../package.json')") || !service.includes('releaseLabel')) {
        report(serviceFile, 'canonical package metadata', 'missing', 'package.json version + releaseLabel', false);
    } else {
        ok(serviceFile, 'canonical package metadata');
    }
}

function syncServiceWorker(version) {
    const file = 'sw.js';
    if (!exists(file)) return;

    let sw = read(file);
    const expectedCache = `event-genix-v${version}`;
    const expectedApiCache = `event-genix-api-v${version}`;

    const cacheMatch = sw.match(/CACHE_NAME = '([^']+)'/);
    if (cacheMatch && cacheMatch[1] !== expectedCache) {
        report(file, 'CACHE_NAME', cacheMatch[1], expectedCache);
        if (FIX) sw = sw.replace(/CACHE_NAME = '[^']+'/, `CACHE_NAME = '${expectedCache}'`);
    } else if (cacheMatch) {
        ok(file, 'CACHE_NAME');
    }

    const apiCacheMatch = sw.match(/API_CACHE_NAME = '([^']+)'/);
    if (apiCacheMatch && apiCacheMatch[1] !== expectedApiCache) {
        report(file, 'API_CACHE_NAME', apiCacheMatch[1], expectedApiCache);
        if (FIX) sw = sw.replace(/API_CACHE_NAME = '[^']+'/, `API_CACHE_NAME = '${expectedApiCache}'`);
    } else if (apiCacheMatch) {
        ok(file, 'API_CACHE_NAME');
    }

    if (FIX) write(file, sw);
}

let pkg = readJson('package.json');
let version = pkg.version;

try {
    let pkgChanged = false;
    if (BUMP_TYPE) {
        version = bumpVersion(version, BUMP_TYPE);
        pkg.version = version;
        pkgChanged = true;
        console.log(`${CYAN}Bumped${RESET} package.json -> ${BOLD}v${version}${RESET}\n`);
    }
    if (LABEL_ARG !== null) {
        pkg.eventGenix = pkg.eventGenix || {};
        pkg.eventGenix.releaseLabel = normalizeLabel(LABEL_ARG);
        pkgChanged = true;
        console.log(`${CYAN}Release label${RESET} package.json -> ${BOLD}${pkg.eventGenix.releaseLabel}${RESET}\n`);
    }
    if (pkgChanged) writeJson('package.json', pkg);
} catch (err) {
    console.error(`${RED}${err.message}${RESET}`);
    process.exit(1);
}

const releaseLabel = getReleaseLabel(pkg);
if (!releaseLabel) {
    report('package.json', 'eventGenix.releaseLabel', 'missing', 'non-empty release label', false);
} else {
    ok('package.json', 'eventGenix.releaseLabel');
}

console.log(`${BOLD}Version sync: v${version}${releaseLabel ? ` — ${releaseLabel}` : ''}${RESET} (source: package.json)\n`);

syncPackageLock(version);
syncAssetVersions('index.html', version);
syncFirstScreenLabels('index.html', version, releaseLabel, { checkLatestModal: true, releaseLabelInText: true });
syncFirstScreenLabels('dashboard.html', version, releaseLabel);
syncServiceWorker(version);
syncCssImportVersions('css/assistant-rail.css', version);
syncCssImportVersions('css/pages.css', version);
syncCssImportVersions('css/sidebar-aurora.css', version);

for (const file of collectVersionedAssetFiles()) {
    if (file !== 'index.html') syncAssetVersions(file, version);
}
checkMarkdownChangelog(version, releaseLabel);
checkApiVersionContract();

console.log('');
if (issues === 0) {
    console.log(`${GREEN}${BOLD}All version references are in sync!${RESET}`);
} else if (FIX && fixed === issues) {
    console.log(`${GREEN}${BOLD}Fixed ${fixed} issue(s).${RESET} Run ${CYAN}node scripts/version-sync.js${RESET} to verify.`);
} else if (FIX) {
    console.log(`${RED}${BOLD}Fixed ${fixed} issue(s), ${issues - fixed} issue(s) require manual updates.${RESET}`);
    process.exit(1);
} else {
    console.log(`${RED}${BOLD}Found ${issues} issue(s).${RESET} Run ${CYAN}node scripts/version-sync.js --fix${RESET} for fixable issues.`);
    process.exit(1);
}
