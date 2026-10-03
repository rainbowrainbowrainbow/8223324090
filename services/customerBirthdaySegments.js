const BIRTHDAY_TAG_KEY = 'birthday';
const BIRTHDAY_TAG_LABEL = 'Іменинник';
const BIRTHDAY_TAG_COLOR = '#EC4899';


const BIRTHDAY_MONTH_NAMES = Object.freeze([
    'січня',
    'лютого',
    'березня',
    'квітня',
    'травня',
    'червня',
    'липня',
    'серпня',
    'вересня',
    'жовтня',
    'листопада',
    'грудня'
]);

function padMonth(month) {
    return String(month).padStart(2, '0');
}

const BIRTHDAY_MONTH_KEYS = Object.freeze(
    BIRTHDAY_MONTH_NAMES.map((_, index) => `birthday_month_${padMonth(index + 1)}`)
);
const BIRTHDAY_SYSTEM_TAG_KEYS = Object.freeze([BIRTHDAY_TAG_KEY, ...BIRTHDAY_MONTH_KEYS]);

const BIRTHDAY_TAG_LABELS = Object.freeze({
    [BIRTHDAY_TAG_KEY]: BIRTHDAY_TAG_LABEL,
    ...Object.fromEntries(BIRTHDAY_MONTH_KEYS.map((key, index) => [
        key,
        `Іменинники ${BIRTHDAY_MONTH_NAMES[index]}`
    ]))
});

const BIRTHDAY_TAG_COLORS = Object.freeze({
    [BIRTHDAY_TAG_KEY]: BIRTHDAY_TAG_COLOR,
    ...Object.fromEntries(BIRTHDAY_MONTH_KEYS.map(key => [key, BIRTHDAY_TAG_COLOR]))
});

function normalizeBirthdayMonth(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.getUTCMonth() + 1;
    }

    if (Number.isInteger(value)) {
        return value >= 1 && value <= 12 ? value : null;
    }

    const text = String(value || '').trim();
    if (!text) return null;

    const keyMatch = text.match(/^birthday_month_(\d{2})$/);
    if (keyMatch) {
        const month = Number.parseInt(keyMatch[1], 10);
        return month >= 1 && month <= 12 ? month : null;
    }

    const dateMatch = text.match(/^\d{4}-(\d{2})-\d{2}/);
    if (dateMatch) {
        const month = Number.parseInt(dateMatch[1], 10);
        return month >= 1 && month <= 12 ? month : null;
    }

    return null;
}

function birthdayMonthKey(date) {
    const month = normalizeBirthdayMonth(date);
    return month ? `birthday_month_${padMonth(month)}` : null;
}

function birthdayMonthLabel(month) {
    const key = birthdayMonthKey(month);
    return key ? BIRTHDAY_TAG_LABELS[key] : null;
}

function birthdaySystemTag(key) {
    if (!key || !BIRTHDAY_TAG_LABELS[key]) return null;
    return {
        source: 'system',
        systemKey: key,
        tag: BIRTHDAY_TAG_LABELS[key],
        color: BIRTHDAY_TAG_COLORS[key] || BIRTHDAY_TAG_COLOR
    };
}

function birthdaySystemTagsForDate(childBirthday) {
    const monthKey = birthdayMonthKey(childBirthday);
    if (!monthKey) return [];
    return [
        birthdaySystemTag(BIRTHDAY_TAG_KEY),
        birthdaySystemTag(monthKey)
    ].filter(Boolean);
}

// The presence of canonical records also blocks the legacy fallback when every
// record is superseded or has no birthday. Clearing a date must stay cleared.
function birthdayChildrenSql(customerAlias = 'c') {
    const context = `COALESCE(${customerAlias}.business_context, 'event_genix')`;
    return `SELECT cc.id, cc.name, cc.birthday, cc.sort_order
        FROM customer_children cc
        WHERE cc.customer_id = ${customerAlias}.id
          AND cc.business_context = ${context}
          AND ${activeBirthdayChildSql('cc')}
          AND cc.birthday IS NOT NULL
        UNION ALL
        SELECT NULL::integer, ${customerAlias}.child_name, ${customerAlias}.child_birthday, 0
        WHERE ${customerAlias}.child_birthday IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM customer_children history
              WHERE history.customer_id = ${customerAlias}.id
                AND history.business_context = ${context}
          )`;
}

function activeBirthdayChildSql(alias = 'cc') {
    return `(COALESCE(${alias}.source_payload #>> '{manual_review,superseded}',
                     ${alias}.source_payload #>> '{manualReview,superseded}', 'false') <> 'true'
        AND COALESCE(${alias}.source_payload #>> '{manual_review,status}',
                     ${alias}.source_payload #>> '{manualReview,status}', '') <> 'superseded')`;
}

function birthdaySelection(tags = []) {
    const keys = (Array.isArray(tags) ? tags : [tags]).map(value => {
        const text = String(value || '').trim();
        return BIRTHDAY_SYSTEM_TAG_KEYS.find(key => key === text || BIRTHDAY_TAG_LABELS[key] === text);
    }).filter(Boolean);
    if (!keys.length) return null;
    return { months: keys.includes(BIRTHDAY_TAG_KEY) ? [] : [...new Set(keys.map(normalizeBirthdayMonth))] };
}

function birthdayMonthConditionSql(selection, alias = 'bd') {
    return selection.months.length
        ? `EXTRACT(MONTH FROM ${alias}.birthday)::integer = ANY(ARRAY[${selection.months.join(',')}]::integer[])`
        : 'TRUE';
}

// Both list and preview use this predicate, including the existing OR behavior
// when the caller selects multiple tags. Month values come only from the taxonomy.
function customerBirthdayTagFilterSql(tags, params, customerAlias = 'c') {
    const values = (Array.isArray(tags) ? tags : [tags]).filter(Boolean);
    const selection = birthdaySelection(values);
    const manual = values.filter(value => !birthdaySelection([value]));
    const predicates = [];
    if (manual.length) {
        params.push(manual);
        predicates.push(`${customerAlias}.id IN (SELECT customer_id FROM customer_tags WHERE tag = ANY($${params.length}::text[]))`);
    }
    if (selection) predicates.push('birthday_segment.child_count > 0');
    const join = selection ? `LEFT JOIN LATERAL (
        SELECT COUNT(*)::integer AS child_count
        FROM (${birthdayChildrenSql(customerAlias)}) bd
        WHERE ${birthdayMonthConditionSql(selection)}
    ) birthday_segment ON TRUE` : '';
    return { selection, join, condition: predicates.length ? `(${predicates.join(' OR ')})` : '' };
}

function selectedBirthdayChildren(children = [], selection, businessContext = null) {
    return children.filter(child => {
        const review = child.manualReview || child.sourcePayload?.manual_review || child.sourcePayload?.manualReview || {};
        if (child.superseded || review.superseded === true || review.status === 'superseded') return false;
        if (businessContext && (child.businessContext || child.business_context || 'event_genix') !== businessContext) return false;
        const month = normalizeBirthdayMonth(child.birthday);
        return month && (!selection || !selection.months.length || selection.months.includes(month));
    });
}

function birthdaySystemTagsForChildren(children = []) {
    const byKey = new Map();
    for (const child of selectedBirthdayChildren(children, null)) {
        for (const tag of birthdaySystemTagsForDate(child.birthday)) byKey.set(tag.systemKey, tag);
    }
    return [...byKey.values()];
}

function currentCustomerBirthdayTags(tags = [], children = []) {
    const current = tags.filter(tag => !(tag.source === 'system' || tag.system)
        || (!BIRTHDAY_SYSTEM_TAG_KEYS.includes(tag.systemKey || tag.system_key)
            && !Object.values(BIRTHDAY_TAG_LABELS).includes(tag.tag)));
    for (const tag of birthdaySystemTagsForChildren(children)) {
        if (!current.some(existing => existing.tag === tag.tag)) current.push(tag);
    }
    return current;
}

module.exports = {
    BIRTHDAY_TAG_KEY, BIRTHDAY_TAG_LABEL, BIRTHDAY_TAG_COLOR,
    BIRTHDAY_MONTH_KEYS, BIRTHDAY_SYSTEM_TAG_KEYS, BIRTHDAY_TAG_LABELS, BIRTHDAY_TAG_COLORS,
    birthdayMonthKey, birthdayMonthLabel, birthdaySystemTagsForDate, birthdaySystemTagsForChildren,
    birthdaySystemTag, birthdayChildrenSql, activeBirthdayChildSql,
    birthdaySelection, customerBirthdayTagFilterSql, selectedBirthdayChildren, currentCustomerBirthdayTags
};

