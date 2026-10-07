'use strict';

class FixtureBlocked extends Error {
    constructor(message) { super(message); this.name = 'FixtureBlocked'; }
}

function createResults() {
    const results = [];
    async function check(id, name, action, { dependsOn = [] } = {}) {
        const blocked = dependsOn.filter(dependency => results.find(row => row.id === dependency)?.status !== 'PASS');
        if (blocked.length) {
            results.push({ id, name, status: 'BLOCKED_DEPENDENCY', dependsOn: blocked });
            return;
        }
        try {
            const detail = await action();
            results.push({ id, name, status: 'PASS', detail });
        } catch (error) {
            results.push({ id, name, status: error instanceof FixtureBlocked ? 'BLOCKED_FIXTURE' : 'FAIL', error: error.message });
        }
    }
    // An incomplete suite must never have the same exit status as verified success.
    function exitCode() { return results.length && results.every(row => row.status === 'PASS') ? 0 : 1; }
    return { results, check, exitCode };
}

module.exports = { FixtureBlocked, createResults };
