'use strict';

const { legacyDestination } = require('../js/task-links');

function taskLinkRedirect(req, res, next) {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    const destination = legacyDestination(req.originalUrl, 'http://localhost');
    if (!destination) return next();
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, destination);
}

module.exports = taskLinkRedirect;
