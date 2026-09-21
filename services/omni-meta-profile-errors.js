'use strict';

// Provider messages can contain profile data or credentials. Expose only these codes.
function profileErrorCode(error) {
    if (error.code === 'ETIMEDOUT') return 'PROFILE_TIMEOUT';
    if (error.code === 'PROFILE_RESPONSE_TOO_LARGE') return 'PROFILE_RESPONSE_TOO_LARGE';
    const code = Number(error.fbErrorCode ?? error.igErrorCode);
    const subcode = Number(error.fbErrorSubcode ?? error.igErrorSubcode);
    if (code === 190) return 'PROFILE_TOKEN_INVALID';
    if (code === 100) return subcode === 33 ? 'PROFILE_OBJECT_UNAVAILABLE' : 'PROFILE_REQUEST_INVALID';
    if ([10, 200].includes(code) || error.statusCode === 403) return 'PROFILE_ACCESS_DENIED';
    return 'PROFILE_UNAVAILABLE';
}

module.exports = { profileErrorCode };
