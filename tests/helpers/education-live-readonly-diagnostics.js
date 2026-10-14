'use strict';

const LEGACY_STAFF_PROBE_QUERY = 'educationQaProbe=legacy-staff-access';

function isExplicitLegacyStaffProbe(url, expectedOrigin) {
    return Boolean(url && url.origin === expectedOrigin && url.pathname === '/api/staff'
        && url.searchParams.get('educationQaProbe') === 'legacy-staff-access');
}

function classifyLiveFailure(result, stage, kind, item, text = '') {
    const held = result.blockedWrites.some(row => row.path === item.path && row.stage === stage);
    let classification = 'UNCLASSIFIED_FAILURE';
    let cause = 'Needs investigation';
    let impact = 'Cannot certify affected surface';
    if (held) {
        classification = 'POLICY_WRITE_HOLD';
        cause = 'Business write blocked by this read-only harness';
        impact = 'No production failure or synchronization PASS inferred';
    } else if (['http', 'console'].includes(kind) && item.status === 429) {
        classification = 'SERVER_RATE_LIMIT_REJECTION';
        cause = 'Server request budget rejected this read';
        impact = 'Attempt fails; mandatory read not certified; respect Retry-After before a fresh attempt';
        if (kind === 'http') result.failedChecks.push({ id: 'live-rate-limit-rejection', status: 'FAIL', stage,
            path: item.path, retryAfterSeconds: item.retryAfterSeconds });
    } else if (['http', 'console'].includes(kind) && item.path === '/api/staff' && item.status === 403
        && item.explicitLegacyStaffProbe === true && stage === 'dar-groups'
        && (kind === 'console' || item.method === 'GET')) {
        classification = 'EXPECTED_ACCESS_DENIAL';
        cause = 'Explicit legacy staff probe denied in education';
        impact = 'Education picker uses scoped teacher endpoint';
    } else if (kind === 'request' && item.error === 'net::ERR_ABORTED') {
        classification = 'NAVIGATION_ABORT';
        cause = 'Read-only navigation cancelled pending request';
        impact = 'Terminal surface asserted separately';
    } else if (['request', 'console'].includes(kind) && item.external) {
        classification = 'POLICY_OUTBOUND_HOLD';
        cause = 'Cross-origin request blocked by harness';
        impact = 'Not production failure or sync proof';
    } else if (kind === 'console' && /websocket|reconnect|socket/i.test(text)) {
        classification = 'POLICY_SOCKET_HOLD';
        cause = 'Read-only harness closes sockets';
        impact = 'No live synchronization claim';
    }
    const diagnostic = { stage, kind, ...item, role: result.role || 'unknown',
        business: stage.startsWith('park') ? 'event_genix' : stage.startsWith('dar-') ? 'dar' : 'unknown',
        classification, cause, impact };
    result.diagnostics.push(diagnostic);
    return diagnostic;
}

module.exports = { LEGACY_STAFF_PROBE_QUERY, isExplicitLegacyStaffProbe, classifyLiveFailure };
