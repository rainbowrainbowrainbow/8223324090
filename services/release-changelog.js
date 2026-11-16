'use strict';

const REPOSITORY = 'rainbowrainbowrainbow/8223324090';
const TAG_PREFIX = 'crm-changelog-v';
const VERSION = /^\d+\.\d+(?:\.\d+)?$/;
const SHA = /^[a-f0-9]{40}$/;
const RECORD = /<!-- eventgenix-release ([A-Za-z0-9_-]+) -->\s*$/;

function notesBody(entry) {
    const notes = entry.notes.length
        ? entry.notes.map(note => '- **' + note.title + '** — ' + note.text).join('\n')
        : 'Оновлення CRM.';
    return notes;
}

function releaseBody(entry) {
    const metadata = Buffer.from(JSON.stringify(entry)).toString('base64url');
    return [notesBody(entry), '', '<!-- eventgenix-release ' + metadata + ' -->'].join('\n');
}

function publishedEntry(release) {
    if (!release || release.draft || release.prerelease || !release.published_at
        || !release.tag_name?.startsWith(TAG_PREFIX)) return null;

    const match = typeof release.body === 'string' && release.body.match(RECORD);
    if (!match) return null;
    try {
        const entry = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
        if (!VERSION.test(entry.version) || !SHA.test(entry.sha) || entry.sha !== release.target_commitish
            || release.tag_name !== TAG_PREFIX + entry.version || typeof entry.label !== 'string'
            || !entry.label || !Array.isArray(entry.notes)
            || !entry.notes.every(note => typeof note?.title === 'string' && typeof note?.text === 'string')) return null;
        return entry;
    } catch {
        return null;
    }
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function renderEntry(entry) {
    const notes = entry.notes.length
        ? entry.notes.map(note => '<li><b>' + escapeHtml(note.title) + '</b> — ' + escapeHtml(note.text) + '</li>').join('')
        : '<li>Оновлення CRM.</li>';
    return '<section class="changelog-section" id="v' + entry.version + '"><h4>v' + entry.version
        + ' — ' + escapeHtml(entry.label) + '</h4><ul>' + notes + '</ul></section>';
}

module.exports = { REPOSITORY, TAG_PREFIX, VERSION, SHA, notesBody, releaseBody, publishedEntry, escapeHtml, renderEntry };
