/**
 * utils/sanitize.js — Input sanitization (v42.4)
 *
 * Strip HTML tags from user input to prevent stored XSS.
 * Use on all text fields before saving to DB.
 */

function stripTags(str) {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/<[^>]*>/g, '');
}

function sanitizeObject(obj, fields) {
    if (!obj || typeof obj !== 'object') return obj;
    const result = { ...obj };
    for (const field of fields) {
        if (result[field] && typeof result[field] === 'string') {
            result[field] = stripTags(result[field]);
        }
    }
    return result;
}

function sanitizeArray(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr.map(item => typeof item === 'string' ? stripTags(item) : item);
}

module.exports = { stripTags, sanitizeObject, sanitizeArray };
