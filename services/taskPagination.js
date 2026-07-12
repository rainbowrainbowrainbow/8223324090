'use strict';

function buildTaskPaginationMetadata({ total = 0, page = 1, limit = 100, returned = 0 } = {}) {
    const normalizedTotal = Math.max(0, Number(total) || 0);
    const normalizedLimit = Math.max(1, Number(limit) || 1);
    const normalizedPage = Math.max(1, Number(page) || 1);
    const normalizedReturned = Math.max(0, Number(returned) || 0);
    const offset = (normalizedPage - 1) * normalizedLimit;
    return {
        total: normalizedTotal,
        page: normalizedPage,
        limit: normalizedLimit,
        offset,
        nextPage: normalizedPage + 1,
        hasMore: offset + normalizedReturned < normalizedTotal
    };
}

module.exports = { buildTaskPaginationMetadata };
