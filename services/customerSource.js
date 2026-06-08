const CUSTOMER_SOURCE_LABELS = Object.freeze({
    telegram: 'Telegram',
    facebook: 'Facebook',
    instagram: 'Instagram',
    viber: 'Viber',
    tiktok: 'TikTok',
    turbo: 'Turbo',
    bnderoga: 'BnD',
    google: 'Google',
    recommendation: 'За рекомендацією',
    repeat: 'Повторне звернення',
    maysternya_site: 'Сайт Майстерні',
    maysternya_bot: 'Бот Майстерні',
    manual: 'Ручне внесення',
    lead: 'Лід',
    other: 'Інше',
    unknown: 'Не вказано'
});

const CUSTOMER_SOURCE_ALIASES = Object.freeze({
    unknown: ['', 'unknown', 'null', 'undefined', 'не вказано', 'невідомо', 'невідоме джерело'],
    telegram: ['telegram', 'tg', 'телеграм'],
    facebook: ['facebook', 'fb', 'фейсбук'],
    instagram: ['instagram', 'insta', 'ig', 'інстаграм'],
    viber: ['viber', 'вайбер'],
    tiktok: ['tiktok', 'tik tok', 'тік ток', 'тікток'],
    turbo: ['turbo', 'турбо'],
    bnderoga: ['bnderoga', 'bnd', 'бендерога'],
    google: ['google', 'гугл'],
    recommendation: ['recommendation', 'recommend', 'referral', 'рекомендація', 'за рекомендацією', 'рекомендовано'],
    repeat: ['repeat', 'returning', 'повторний', 'повторне звернення', 'повторне', 'постійний'],
    maysternya_site: ['maysternya_site', 'maysternya site', 'сайт майстерні', 'майстерня сайт'],
    maysternya_bot: ['maysternya_bot', 'maysternya bot', 'бот майстерні', 'майстерня бот'],
    manual: ['manual', 'operator', 'ручний', 'ручне внесення', 'вручну'],
    lead: ['lead', 'лід', 'з ліда'],
    other: ['other', 'інше', 'інший', 'інше джерело']
});

const SOURCE_BY_ALIAS = new Map(
    Object.entries(CUSTOMER_SOURCE_ALIASES).flatMap(([source, aliases]) =>
        aliases.map(alias => [alias, source])
    )
);

function cleanSource(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function sourceLookupKey(value) {
    return cleanSource(value).toLowerCase();
}

function normalizeCustomerSource(value, options = {}) {
    const { unknownAsNull = true } = options;
    const key = sourceLookupKey(value);
    const source = SOURCE_BY_ALIAS.get(key) || (CUSTOMER_SOURCE_LABELS[key] ? key : 'other');
    if (source === 'unknown') return unknownAsNull ? null : 'unknown';
    return source;
}

function getCustomerSourceLabel(value) {
    const source = normalizeCustomerSource(value, { unknownAsNull: false });
    return CUSTOMER_SOURCE_LABELS[source] || CUSTOMER_SOURCE_LABELS.other;
}

function getCustomerSourceAliases(value) {
    const source = normalizeCustomerSource(value, { unknownAsNull: false }) || 'unknown';
    return CUSTOMER_SOURCE_ALIASES[source] || [source];
}

function quoteSql(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function customerSourceSqlExpression(column = 'source') {
    const trimmed = `LOWER(TRIM(COALESCE(${column}, '')))`;
    const clauses = Object.entries(CUSTOMER_SOURCE_ALIASES)
        .map(([source, aliases]) => `WHEN ${trimmed} IN (${aliases.map(quoteSql).join(', ')}) THEN ${quoteSql(source)}`);
    return `(CASE ${clauses.join(' ')} WHEN ${trimmed} = '' THEN 'unknown' ELSE 'other' END)`;
}

module.exports = {
    CUSTOMER_SOURCE_LABELS,
    CUSTOMER_SOURCE_ALIASES,
    normalizeCustomerSource,
    getCustomerSourceLabel,
    getCustomerSourceAliases,
    customerSourceSqlExpression
};
