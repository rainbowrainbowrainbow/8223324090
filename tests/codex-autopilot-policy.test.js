'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ACTIONS, completionGaps, decideSupervisorAction } = require('../scripts/codex-autopilot-policy');
const { SCENARIOS } = require('../scripts/codex-autopilot-dry-run');

test('Green and idle incomplete goals resume the next safe step', () => {
    assert.equal(decideSupervisorAction(SCENARIOS.green).action, ACTIONS.RESUME_GREEN);
    assert.equal(decideSupervisorAction(SCENARIOS.idle).action, ACTIONS.RESUME_GREEN);
});

test('an active task is observed without duplicate work', () => {
    const state = { ...SCENARIOS.green, taskRunning: true };
    assert.equal(decideSupervisorAction(state).action, ACTIONS.NOOP_ACTIVE);
});

test('an in-flight CI, deploy, browser, or command uses the native wait path', () => {
    const state = { ...SCENARIOS.green, inFlightWait: true };
    assert.equal(decideSupervisorAction(state).action, ACTIONS.WAIT_NATIVE);
});

test('Yellow emits one gate and continues only an authorized valid envelope', () => {
    assert.equal(decideSupervisorAction(SCENARIOS.yellow).action, ACTIONS.WAIT_YELLOW_AUTHORIZATION);
    const authorized = {
        ...SCENARIOS.yellow,
        yellow: { required: true, prepared: true, authorized: true, valid: true }
    };
    assert.equal(decideSupervisorAction(authorized).action, ACTIONS.CONTINUE_YELLOW);
    const expired = { ...authorized, yellow: { ...authorized.yellow, valid: false } };
    assert.equal(decideSupervisorAction(expired).action, ACTIONS.RUN_YELLOW_PREPARE);
});

test('Red stops with an exact blocker', () => {
    const decision = decideSupervisorAction(SCENARIOS.red);
    assert.equal(decision.action, ACTIONS.STOP_RED);
    assert.match(decision.reason, /secrets/);
});

test('completed Goal disables heartbeat only with all scope evidence', () => {
    assert.equal(decideSupervisorAction(SCENARIOS.complete).action, ACTIONS.DISABLE_HEARTBEAT);
    const incomplete = { ...SCENARIOS.complete, scope: { production: true } };
    assert.equal(decideSupervisorAction(incomplete).action, ACTIONS.RESUME_GREEN);
    assert.deepEqual(completionGaps({ production: true, ui: true }, {}), [
        'finalCode', 'requiredTests', 'remainingRisks', 'exactShaCi', 'deployProof',
        'liveQaEvidence', 'disposableQaStatus', 'cleanupOrTtl', 'screenshotsOrReport'
    ]);
});

test('two writers on one branch/worktree fail closed', () => {
    const state = { ...SCENARIOS.green, writeLease: { writerCount: 2 } };
    assert.equal(decideSupervisorAction(state).action, ACTIONS.STOP_DUPLICATE_WRITER);
});

test('repository includes durable Goal and heartbeat launch templates', () => {
    const root = path.resolve(__dirname, '..');
    const goal = fs.readFileSync(path.join(root, 'docs/templates/CODEX_EVENTGENIX_AUTOPILOT_GOAL.md'), 'utf8');
    const heartbeat = fs.readFileSync(path.join(root, 'docs/templates/CODEX_EVENTGENIX_HEARTBEAT.md'), 'utf8');
    assert.match(goal, /\$eventgenix-production-autopilot/);
    assert.match(goal, /Acceptance criteria/);
    assert.match(heartbeat, /15 minutes/);
    assert.match(heartbeat, /Disable this heartbeat/);
    assert.doesNotMatch(`${goal}\n${heartbeat}`, /DATABASE_URL|password\s*=|Bearer\s+/i);
});
