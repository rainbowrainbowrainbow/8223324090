'use strict';

const express = require('express');
const { version: runtimeVersion } = require('../package.json');
const fs = require('node:fs');
const path = require('node:path');
const { REPOSITORY, VERSION, publishedEntry, escapeHtml, notesBody, renderEntry } = require('./release-changelog');

const PAGE_SIZE = 10;
const MARKDOWN_PATH = path.join(__dirname, '../CHANGELOG.md');
const CACHE_TTL = 5 * 60 * 1000;
const RETRY_DELAY = 60 * 1000;
// These candidates are retained in the repository archive with their original notes.
const FAILED_LEGACY_CANDIDATES = new Set(['0.83.76', '0.83.78', '0.83.80', '0.83.83', '0.83.85']);

function parseLegacyArchive(markup) {
    const headings = [...markup.matchAll(/<h4>v(\d+\.\d+(?:\.\d+)?)(?=\s|<)[\s\S]*?<\/h4>/g)];
    const entries = new Map();
    for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        const version = heading[1];
        if (FAILED_LEGACY_CANDIDATES.has(version)) continue;
        const next = headings[index + 1]?.index ?? markup.length;
        const closing = markup.indexOf('</div>', heading.index);
        const end = closing === -1 ? next : Math.min(next, closing);
        const body = markup.slice(heading.index + heading[0].length, end).trim();
        const year = heading[0].match(/\d{2}\.\d{2}\.(\d{4})/)?.[1];
        const existing = entries.get(version);
        if (!existing) entries.set(version, { version, year, heading: heading[0], bodies: new Set([body]) });
        else existing.bodies.add(body);
    }
    return [...entries.values()].map(({ version, year, heading, bodies }) => ({ version, year,
        html: '<section class="changelog-section">' + heading + [...bodies].join('\n') + '</section>'
    }));
}

function compareVersion(a, b) {
    const left = a.version.split('.').map(Number);
    const right = b.version.split('.').map(Number);
    return right[0] - left[0] || right[1] - left[1] || (right[2] || 0) - (left[2] || 0);
}

async function fetchPublishedEntries(fetchImpl) {
    const url = 'https://api.github.com/repos/' + REPOSITORY + '/releases?per_page=100&page=';
    const entries = new Map();
    // One cache refresh owns all pages, and preserves the last complete result on an upstream error.
    for (let page = 1; ; page += 1) {
        const response = await fetchImpl(url + page, {
            headers: { Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(2500)
        });
        if (!response.ok) throw new Error('Changelog provider returned HTTP ' + response.status);
        const releases = await response.json();
        if (!Array.isArray(releases)) throw new Error('Invalid changelog provider response');
        for (const release of releases) {
            const entry = publishedEntry(release);
            if (entry && !entries.has(entry.version)) {
                entries.set(entry.version, { ...entry, year: release.published_at.slice(0, 4) });
            }
        }
        if (releases.length < 100) return [...entries.values()].sort(compareVersion);
    }
}

function createCatalog({ fetchImpl = fetch, now = Date.now, readFile = fs.readFileSync } = {}) {
    const fastRefreshUntil = now() + 2 * 60 * 1000;
    let legacy;
    let legacyMarkdown;
    let legacyYears;
    let published = [];
    let nextRefresh = 0;
    let pending;

    async function data() {
        if (!legacy) legacy = parseLegacyArchive(readFile(path.join(__dirname, '../changelog-history.fragment'), 'utf8'));
        if (!pending && now() >= nextRefresh) {
            pending = fetchPublishedEntries(fetchImpl).then(entries => {
                published = entries;
                const currentListed = entries.some(entry => entry.version === runtimeVersion)
                    || legacy.some(entry => entry.version === runtimeVersion);
                nextRefresh = now() + (!currentListed && now() < fastRefreshUntil ? 15000 : CACHE_TTL);
            }).catch(() => {
                nextRefresh = now() + RETRY_DELAY;
            }).finally(() => {
                pending = undefined;
            });
        }
        await pending;
        return { legacy, published };
    }

    function readLegacyMarkdown() {
        if (legacyMarkdown === undefined) legacyMarkdown = readFile(MARKDOWN_PATH, 'utf8');
        return legacyMarkdown;
    }

    return async function list({ after, version, year, format, archive } = {}) {
        const { legacy, published } = await data();
        if (format === 'markdown') {
            const latest = published.map(entry => '## v' + entry.version + ' - ' + entry.label + '\n\n' + notesBody(entry));
            return ['# Журнал змін EventGenix CRM', ...latest, readLegacyMarkdown()].join('\n\n');
        }
        if (archive && !legacyYears) {
            legacyYears = new Map();
            for (const section of readLegacyMarkdown().split(/(?=^## v)/m)) {
                const archivedVersion = section.match(/^## v(\d+\.\d+(?:\.\d+)?)/)?.[1];
                const archivedYear = section.match(/\((?:\d{2}\.){2}(\d{4})\)/)?.[1];
                if (archivedVersion && archivedYear) legacyYears.set(archivedVersion, archivedYear);
            }
        }
        const deployed = new Set(published.map(entry => entry.version));
        const allEntries = published.concat(legacy.filter(entry => !deployed.has(entry.version)));
        const entryYear = entry => entry.year || legacyYears?.get(entry.version);
        const years = archive ? [...new Set(allEntries.map(entryYear).filter(Boolean))].sort().reverse() : [];
        const entries = year ? allEntries.filter(entry => entryYear(entry) === year) : allEntries;
        const index = entries.findIndex(entry => entry.version === (version || after));
        if ((after || version) && index < 0) return null;
        const start = version ? index : after ? index + 1 : 0;
        const page = entries.slice(start, start + (version ? 1 : PAGE_SIZE));
        return {
            html: page.map(entry => entry.html || renderEntry(entry)).join('\n'),
            years,
            next: !version && start + page.length < entries.length ? page.at(-1).version : null
        };
    };
}

function archivePage(page, version, year) {
    const history = page?.html.replace(/<(\/?)(h4)>/g, '<$1h2>');
    const error = '<p>Версію не знайдено. <a href="/changelog">До останніх випусків</a></p>';
    const older = page?.next ? '<p><a href="/changelog?after=' + page.next
        + (year ? '&amp;year=' + year : '') + '">Показати старіші</a></p>' : '';
    const yearLinks = page?.years.map(value => value === year
        ? '<strong>' + value + '</strong>'
        : '<a href="/changelog?year=' + value + '">' + value + '</a>').join(' ');
    return '<!doctype html><html lang="uk"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        + '<title>Архів змін — EventGenix CRM</title>'
        + '<style>:root{color-scheme:light dark}body{font:1rem/1.55 system-ui,sans-serif}main{max-width:48rem;margin:1.5rem auto;padding:0 1rem;overflow-wrap:anywhere}form{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem}form input,form button{min-height:44px;font:inherit;padding:0 .6rem;box-sizing:border-box}form input{width:10rem;max-width:100%}nav,.changelog-section{margin:1rem 0}.changelog-section{padding:0 0 .75rem;border-bottom:1px solid GrayText}</style></head><body><main>'
        + '<p><a href="/">До CRM</a></p><h1>Архів змін</h1>'
        + '<form action="/changelog"><label for="release-version">Номер версії</label> '
        + '<input id="release-version" name="version" placeholder="0.83.81" value="' + escapeHtml(version || '') + '" required> '
        + '<button type="submit">Знайти</button></form>'
        + (yearLinks ? '<nav aria-label="Роки випусків">' + yearLinks + '</nav>' : '')
        + (page ? (history || '<p>Випусків за цей рік немає.</p>') + older : error)
        + '<p><a href="/changelog/markdown">Журнал у Markdown</a></p></main></body></html>';
}

function createChangelogRouter(list = createCatalog()) {
    const router = express.Router();
    router.get(['/changelog', '/changelog/entries'], async (req, res, next) => {
        const after = req.query.after;
        const version = req.query.version;
        const year = req.query.year;
        const archive = req.path === '/changelog';
        const valid = value => value === undefined || (typeof value === 'string' && VERSION.test(value));
        try {
            const validYear = year === undefined || (archive && typeof year === 'string' && /^\d{4}$/.test(year));
            const page = valid(after) && valid(version) && validYear && !(version && (after || year))
                ? await list({ after, version, year, archive })
                : null;
            res.set('Cache-Control', 'public, max-age=15');
            res.status(page ? 200 : 404);
            if (req.path === '/changelog/entries') return res.json(page || { error: 'Release not found' });
            return res.type('html').send(archivePage(page, typeof version === 'string' ? version : '', validYear ? year : ''));
        } catch (error) {
            return next(error);
        }
    });
    router.get('/changelog/markdown', async (_req, res, next) => {
        try {
            res.set('Cache-Control', 'public, max-age=15');
            res.type('text/plain').send(await list({ format: 'markdown' }));
        } catch (error) {
            next(error);
        }
    });
    return router;
}

module.exports = { createCatalog, createChangelogRouter, parseLegacyArchive, fetchPublishedEntries };
