/**
 * middleware/validate.js — Lightweight schema validation
 *
 * No external library needed. Defines reusable field rules
 * and a validate() middleware factory.
 *
 * Usage in routes:
 *   const { validate, rules } = require('../middleware/validate');
 *
 *   router.post('/', validate({
 *       date:   rules.date,         // required, YYYY-MM-DD
 *       time:   rules.time,         // required, HH:MM
 *       lineId: rules.required,     // just non-empty
 *       price:  rules.optional.number,  // optional, but if present must be number
 *   }), asyncHandler(async (req, res) => {
 *       // req.body is already validated here!
 *   }));
 */

const { ValidationError } = require('./errors');

// --- Field validators ---
// Each returns true if valid, or a string error message if invalid.

const fieldRules = {
    required: (val, field) => {
        if (val === undefined || val === null || val === '') {
            return `${field} — обов'язкове поле`;
        }
        return true;
    },

    date: (val, field) => {
        if (!val) return `${field} — обов'язкове поле`;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return `${field} — невірний формат (YYYY-MM-DD)`;
        return true;
    },

    time: (val, field) => {
        if (!val) return `${field} — обов'язкове поле`;
        if (!/^\d{2}:\d{2}$/.test(val)) return `${field} — невірний формат (HH:MM)`;
        return true;
    },

    id: (val, field) => {
        if (!val) return `${field} — обов'язкове поле`;
        if (typeof val !== 'string' && typeof val !== 'number') return `${field} — невірний тип`;
        if (String(val).length > 100) return `${field} — занадто довге (макс 100)`;
        return true;
    },

    settingKey: (val, field) => {
        if (!val) return `${field} — обов'язкове поле`;
        if (!/^[a-z_]{1,100}$/.test(val)) return `${field} — тільки a-z та _ (макс 100)`;
        return true;
    },

    number: (val, field) => {
        if (val === undefined || val === null || val === '') return `${field} — обов'язкове поле`;
        if (typeof val !== 'number' && isNaN(Number(val))) return `${field} — має бути числом`;
        return true;
    },

    // Optional wrappers — skip validation if field is missing
    optional: {
        date: (val, field) => {
            if (val === undefined || val === null || val === '') return true;
            return fieldRules.date(val, field);
        },
        time: (val, field) => {
            if (val === undefined || val === null || val === '') return true;
            return fieldRules.time(val, field);
        },
        number: (val, field) => {
            if (val === undefined || val === null || val === '') return true;
            return fieldRules.number(val, field);
        },
        string: (val, field) => {
            if (val === undefined || val === null || val === '') return true;
            if (typeof val !== 'string') return `${field} — має бути рядком`;
            return true;
        }
    }
};

/**
 * validate(schema, source) — middleware factory
 *
 * @param {Object} schema — { fieldName: validatorFn, ... }
 * @param {string} source — 'body' (default), 'params', or 'query'
 *
 * Runs all validators. If any fail, throws ValidationError
 * with ALL errors at once (not just the first one).
 */
function validate(schema, source = 'body') {
    return (req, res, next) => {
        const data = req[source];
        const errors = [];

        for (const [field, rule] of Object.entries(schema)) {
            const result = rule(data[field], field);
            if (result !== true) {
                errors.push(result);
            }
        }

        if (errors.length > 0) {
            throw new ValidationError(errors.join('; '));
        }

        next();
    };
}

module.exports = {
    validate,
    rules: fieldRules
};
