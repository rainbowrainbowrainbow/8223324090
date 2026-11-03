'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'browser/education-ready-async-browser.js'), 'utf8');
const marker = 'for(const lateError of [false,true])await check(`today-A-B-A';
const releaseMarker = "await bounded(newest.promise,'Latest date A response');";
const waitMarker = "await page.waitForFunction(()=>window.EducationScheduleWorkspace.state.date==='2026-10-02'";
assert.ok(source.includes(marker), 'Source-bound Today response scenario must exist');
const scenario = source.slice(source.indexOf(marker));
const setup = scenario.slice(scenario.indexOf('const rows='), scenario.indexOf('\n        try{'));
const release = scenario.slice(scenario.indexOf(releaseMarker) + releaseMarker.length, scenario.indexOf(waitMarker));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

for (const lateError of [false, true]) {
    test(`Today fixture releases late current responses and retains old ${lateError ? 'errors' : 'successes'}`, async () => {
        let handler;
        const page = { route: async (_pattern, callback) => { handler = callback; } };
        // Execute the actual interception callback and release statement, rather
        // than a copy of the browser fixture's timing behavior.
        const fixture = await new AsyncFunction('page', 'deferred', 'lateError', `${setup};
            return {rows,setStage(value){stage=value},releaseCurrent(){${release}},
                releaseAll(){phaseGates.old.resolve();phaseGates.new.resolve();}};`)(page, deferred, lateError);
        const fulfilled = [];
        const fetches = { old: deferred(), first: deferred(), late: deferred() };
        const route = name => ({ fetch: () => fetches[name].promise, fulfill: async value => { fulfilled.push({ name, value }); } });
        const oldRequest = handler(route('old'));
        fixture.setStage('new');
        const firstRequest = handler(route('first'));
        fetches.first.resolve({ body: 'fresh' }); await flush();
        fixture.releaseCurrent(); await flush();
        // This request is not in rows when the current phase is released.
        const lateRequest = handler(route('late'));
        fetches.late.resolve({ body: 'fresh' }); await flush();
        // The old request's fetch crosses the navigation boundary as well.
        fetches.old.resolve({ body: 'stale' }); await flush();
        const beforeOldRelease = fulfilled.slice();
        fixture.releaseAll(); await Promise.all([oldRequest, firstRequest, lateRequest]);
        assert.deepEqual(beforeOldRelease.map(row => row.name).sort(), ['first', 'late']);
        assert.ok(beforeOldRelease.every(row => row.value.response.body === 'fresh'));
        assert.equal(fixture.rows.find(row => row.response.body === 'stale').stage, 'old');
        assert.equal(fulfilled.find(row => row.name === 'old').value.status, lateError ? 503 : undefined);
    });
}
