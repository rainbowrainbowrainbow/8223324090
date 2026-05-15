const pkg = require('../package.json');

function getReleaseLabel() {
    return String(pkg.eventGenix?.releaseLabel || pkg.releaseLabel || '').trim();
}

function getReleaseMetadata() {
    return {
        success: true,
        version: pkg.version,
        releaseLabel: getReleaseLabel(),
        name: 'Event Genix',
        testMode: process.env.TEST_MODE === 'true'
    };
}

module.exports = {
    getReleaseLabel,
    getReleaseMetadata
};
