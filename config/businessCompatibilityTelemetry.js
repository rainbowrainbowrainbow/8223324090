'use strict';

// Registry-owned coverage. A family is required only where that ingress exists
// for the business; adding an ingress requires adding it here and a focused
// instrumentation test in the same change.
const REQUIRED_ENTRY_FAMILIES = Object.freeze({
    event_genix: Object.freeze(['http', 'profile', 'service', 'websocket', 'alternate_auth', 'job', 'operator', 'public']),
    dar: Object.freeze(['http', 'profile', 'service', 'websocket', 'operator']),
    maysternya_doli: Object.freeze(['http', 'profile', 'service', 'websocket', 'provider', 'job', 'operator']),
    crm: Object.freeze(['http', 'profile', 'service', 'websocket', 'job', 'operator'])
});

module.exports = { REQUIRED_ENTRY_FAMILIES };
