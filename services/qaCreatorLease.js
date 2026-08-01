'use strict';

// A QA creator lease never changes users.role. The current role is overlaid only
// while the lease stored on the account is both present and unexpired.
const QA_CREATOR_ROLE = 'creator';
const MIN_QA_CREATOR_LEASE_SECONDS = 5 * 60;
const MAX_QA_CREATOR_LEASE_SECONDS = 20 * 60;

function normalizeQaCreatorLeaseDuration(value) {
    const seconds = Number(value);
    if (!Number.isInteger(seconds)
        || seconds < MIN_QA_CREATOR_LEASE_SECONDS
        || seconds > MAX_QA_CREATOR_LEASE_SECONDS) {
        const error = new Error('Некоректна тривалість тимчасової QA-ролі');
        error.statusCode = 400;
        error.code = 'QA_CREATOR_LEASE_DURATION_INVALID';
        throw error;
    }
    return seconds;
}

function normalizeLeaseId(value) {
    const normalized = String(value || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
        ? normalized
        : null;
}

function applyQaCreatorLease(user, lease) {
    if (!user || !lease?.qa_creator_lease_id || !lease?.qa_creator_lease_expires_at) return user;
    return {
        ...user,
        role: QA_CREATOR_ROLE,
        qa_creator_lease_id: lease.qa_creator_lease_id,
        qa_creator_lease_expires_at: lease.qa_creator_lease_expires_at,
        qaCreatorLeaseId: lease.qa_creator_lease_id,
        qaCreatorLeaseExpiresAt: lease.qa_creator_lease_expires_at
    };
}

async function resolveActiveQaCreatorLease(user, db, options = {}) {
    const userId = Number(user?.id || user?.userId || user?.sub);
    if (!Number.isInteger(userId) || userId <= 0) return user;

    const expectedLeaseId = normalizeLeaseId(options.expectedLeaseId);
    const params = [userId];
    const expectedLeaseClause = expectedLeaseId
        ? (params.push(expectedLeaseId), ' AND qa_creator_lease_id = $2::uuid')
        : '';
    const result = await db.query(
        `SELECT qa_creator_lease_id::text AS qa_creator_lease_id, qa_creator_lease_expires_at
         FROM users
         WHERE id = $1
           AND qa_creator_lease_id IS NOT NULL
           AND qa_creator_lease_expires_at > NOW()${expectedLeaseClause}`,
        params
    );
    return applyQaCreatorLease(user, result.rows[0]);
}

function isQaLeaseCandidate(user = {}) {
    return /(?:qa|test|codex|smoke|verifier)/i.test(`${user.username || ''} ${user.name || ''}`);
}

module.exports = {
    QA_CREATOR_ROLE,
    MIN_QA_CREATOR_LEASE_SECONDS,
    MAX_QA_CREATOR_LEASE_SECONDS,
    normalizeQaCreatorLeaseDuration,
    normalizeLeaseId,
    applyQaCreatorLease,
    resolveActiveQaCreatorLease,
    isQaLeaseCandidate
};
