'use strict';

const { spawnSync } = require('node:child_process');
const { REPOSITORY, TAG_PREFIX, VERSION, SHA, releaseBody, publishedEntry } = require('../services/release-changelog');

function gitHubRequest(endpoint, payload) {
    const args = ['api', '--hostname', 'github.com', 'repos/' + REPOSITORY + endpoint];
    if (payload) args.push('--method', 'POST', '--input', '-');
    const result = spawnSync('gh', args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        input: payload ? JSON.stringify(payload) : undefined
    });
    if (result.error) throw result.error;
    if (result.status === 0) return JSON.parse(result.stdout);
    if (!payload && /\(HTTP 404\)/.test(result.stderr)) return null;
    throw new Error('GitHub changelog request failed (exit ' + result.status + ')');
}

async function publishReleaseNotes({ entry, live, sourceBranch, request = gitHubRequest }) {
    if (!VERSION.test(entry.version) || !SHA.test(entry.sha)
        || live.version !== entry.version || live.commitSha !== entry.sha
        || live.sourceBranch !== sourceBranch || live.deploymentMetadata?.complete !== true) {
        throw new Error('Changelog publication requires exact verified live production version and SHA');
    }
    const tag = TAG_PREFIX + entry.version;
    const body = releaseBody(entry);
    const endpoint = '/releases/tags/' + tag;
    const tagEndpoint = '/git/ref/tags/' + tag;
    async function checkRelease(release) {
        const existing = publishedEntry(release);
        const ref = await request(tagEndpoint);
        if (!existing || release.body !== body || ref?.object?.type !== 'commit' || ref.object.sha !== entry.sha) {
            throw new Error('GitHub changelog tag or release is already bound to different content');
        }
        return { version: entry.version, sha: entry.sha, url: release.html_url };
    }

    const existing = await request(endpoint);
    if (existing) return checkRelease(existing);
    const ref = await request(tagEndpoint);
    if (ref && (ref.object?.type !== 'commit' || ref.object.sha !== entry.sha)) {
        throw new Error('GitHub changelog tag is already bound to a different commit');
    }
    let created;
    try {
        created = await request('/releases', {
            tag_name: tag,
            target_commitish: entry.sha,
            name: 'v' + entry.version + ' — ' + entry.label,
            body,
            draft: false,
            prerelease: false,
            make_latest: 'false'
        });
    } catch (error) {
        created = await request(endpoint);
        if (!created) throw error;
    }
    return checkRelease(created);
}

module.exports = { publishReleaseNotes };
