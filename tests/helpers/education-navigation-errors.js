'use strict';

function isCancelledWebkitLifecycleFetch({ engine, base, error, at, transitions, failures }) {
    if (engine !== 'webkit' || error.name !== 'Fetch API cannot load http') return false;
    const localApi = `/${base.replace(/^http:\/\//, '')}/api/`;
    if (!error.message.startsWith(localApi) || !error.message.endsWith(' due to access control checks.')) return false;
    const near = timestamp => Math.abs(timestamp - at) <= 5000;
    return transitions.some(near) && failures.some(failure => failure.error === 'Load request cancelled' && near(failure.at));
}

module.exports = { isCancelledWebkitLifecycleFetch };
