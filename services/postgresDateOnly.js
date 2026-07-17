'use strict';

function toPostgresDateOnly(value) {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        const year = String(value.getFullYear()).padStart(4, '0');
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

module.exports = { toPostgresDateOnly };
