const LOGIN_IDENTITY_WHERE_SQL = `
    (
        LOWER(u.username) = $1
        OR EXISTS (
            SELECT 1
            FROM unnest(COALESCE(u.login_aliases, '{}'::text[])) AS login_alias
            WHERE LOWER(TRIM(login_alias)) = $1
        )
    )
`;

function normalizeLoginIdentifier(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeLoginAliases(aliases = []) {
    if (!Array.isArray(aliases)) return [];
    const seen = new Set();
    const normalized = [];
    aliases.forEach(alias => {
        const value = String(alias || '').trim();
        if (!value) return;
        const key = value.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        normalized.push(value);
    });
    return normalized;
}

module.exports = {
    LOGIN_IDENTITY_WHERE_SQL,
    normalizeLoginIdentifier,
    normalizeLoginAliases
};
