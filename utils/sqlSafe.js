/**
 * utils/sqlSafe.js — SQL safety utilities (v38.4.0)
 *
 * Prevents SQL injection for dynamic identifiers (column names, ORDER BY, table names)
 * that cannot use parameterized queries ($1, $2).
 *
 * All VALUES should still use parameterized queries — this is ONLY for identifiers.
 */

/**
 * Validate and return a safe ORDER BY clause from an allowlist.
 * @param {string} userInput - User-supplied sort key
 * @param {Object<string, string>} allowedSorts - Map of allowed key → SQL ORDER BY clause
 * @param {string} defaultSort - Default ORDER BY clause if input not in allowlist
 * @returns {string} Safe ORDER BY clause
 */
function safeOrderBy(userInput, allowedSorts, defaultSort) {
    return allowedSorts[userInput] || defaultSort;
}

/**
 * Validate a table name against a hardcoded allowlist.
 * @param {string} tableName - Table name to validate
 * @param {Set<string>|string[]} allowedTables - Set or array of allowed table names
 * @returns {string} Quoted table name
 * @throws {Error} If table name not in allowlist
 */
function safeTableName(tableName, allowedTables) {
    const allowed = allowedTables instanceof Set ? allowedTables : new Set(allowedTables);
    if (!allowed.has(tableName)) {
        throw new Error(`Table "${tableName}" not in allowlist`);
    }
    // Double-quote for safety (handles reserved words)
    return `"${tableName}"`;
}

/**
 * Build safe SET clause for UPDATE from a field definition map.
 * Returns { setClause, params, nextIdx } or null if no fields to update.
 *
 * @param {Object} fieldDefs - Map of { fieldName: { column: 'db_column', value: any } }
 * @param {number} startIdx - Starting parameter index ($N)
 * @returns {{ sets: string[], params: any[], nextIdx: number } | null}
 *
 * Example:
 *   const result = safeSets({
 *     title:  { column: 'title',  value: req.body.title },
 *     status: { column: 'status', value: req.body.status }
 *   }, 1);
 *   // result.sets = ['title = $1', 'status = $2']
 *   // result.params = ['My Title', 'active']
 */
function safeSets(fieldDefs, startIdx = 1) {
    const sets = [];
    const params = [];
    let idx = startIdx;

    for (const [, def] of Object.entries(fieldDefs)) {
        if (def.value !== undefined) {
            sets.push(`${def.column} = $${idx++}`);
            params.push(def.value);
        }
    }

    if (sets.length === 0) return null;
    return { sets, params, nextIdx: idx };
}

module.exports = { safeOrderBy, safeTableName, safeSets };
