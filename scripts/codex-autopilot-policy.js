'use strict';

const ACTIONS = Object.freeze({
    DISABLE_HEARTBEAT: 'disable_heartbeat',
    NOOP_ACTIVE: 'noop_active',
    RESUME_GREEN: 'resume_green',
    RUN_YELLOW_PREPARE: 'run_yellow_prepare',
    STOP_DUPLICATE_WRITER: 'stop_duplicate_writer',
    STOP_RED: 'stop_red',
    WAIT_NATIVE: 'wait_native',
    WAIT_YELLOW_AUTHORIZATION: 'wait_yellow_authorization',
    CONTINUE_YELLOW: 'continue_yellow'
});

function completionGaps(scope = {}, evidence = {}) {
    const required = ['finalCode', 'requiredTests', 'remainingRisks'];
    if (scope.production === true) {
        required.push('exactShaCi', 'deployProof', 'liveQaEvidence', 'disposableQaStatus', 'cleanupOrTtl');
    }
    if (scope.ui === true) required.push('screenshotsOrReport');
    return required.filter(key => evidence[key] !== true);
}

function decideSupervisorAction(state) {
    const writerCount = Number(state?.writeLease?.writerCount || 0);
    if (writerCount > 1) return { action: ACTIONS.STOP_DUPLICATE_WRITER, reason: 'multiple writers share one branch/worktree' };

    const gaps = completionGaps(state?.scope, state?.evidence);
    if (state?.goalStatus === 'complete' && gaps.length === 0) {
        return { action: ACTIONS.DISABLE_HEARTBEAT, reason: 'goal acceptance evidence is complete' };
    }
    if (state?.redBlocker) return { action: ACTIONS.STOP_RED, reason: String(state.redBlocker) };
    if (state?.inFlightWait === true) return { action: ACTIONS.WAIT_NATIVE, reason: 'an existing command or external gate is in flight' };
    if (state?.taskRunning === true) return { action: ACTIONS.NOOP_ACTIVE, reason: 'task is already running' };

    if (state?.yellow?.required === true) {
        if (state.yellow.authorized === true && state.yellow.valid === true) {
            return { action: ACTIONS.CONTINUE_YELLOW, reason: 'bounded Yellow envelope is authorized and valid' };
        }
        if (state.yellow.valid === false) {
            return { action: ACTIONS.RUN_YELLOW_PREPARE, reason: 'previous Yellow envelope expired or drifted' };
        }
        if (state.yellow.prepared === true) {
            return { action: ACTIONS.WAIT_YELLOW_AUTHORIZATION, reason: 'one prepared Yellow block awaits authorization' };
        }
        return { action: ACTIONS.RUN_YELLOW_PREPARE, reason: 'production scope needs a read-only block manifest' };
    }

    return { action: ACTIONS.RESUME_GREEN, reason: gaps.length ? `acceptance evidence missing: ${gaps.join(', ')}` : 'next Green step is available' };
}

module.exports = { ACTIONS, completionGaps, decideSupervisorAction };
