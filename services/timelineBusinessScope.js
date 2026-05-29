const {
    DEFAULT_TIMELINE_CONTEXT,
    normalizeTimelineContext
} = require('./timelineContext');

function timelineBusinessContextSql(alias = '', placeholder = '$1') {
    const column = alias ? `${alias}.business_context` : 'business_context';
    return `COALESCE(${column}, '${DEFAULT_TIMELINE_CONTEXT}') = ${placeholder}`;
}

function pushTimelineBusinessContext(params, alias = '', context = DEFAULT_TIMELINE_CONTEXT) {
    params.push(normalizeTimelineContext(context));
    return timelineBusinessContextSql(alias, `$${params.length}`);
}

function pushDefaultTimelineBusinessContext(params, alias = '') {
    return pushTimelineBusinessContext(params, alias, DEFAULT_TIMELINE_CONTEXT);
}

function timelineBusinessContextJoinSql(leftAlias, rightAlias) {
    return `COALESCE(${leftAlias}.business_context, '${DEFAULT_TIMELINE_CONTEXT}') = COALESCE(${rightAlias}.business_context, '${DEFAULT_TIMELINE_CONTEXT}')`;
}

module.exports = {
    DEFAULT_TIMELINE_CONTEXT,
    normalizeTimelineContext,
    timelineBusinessContextSql,
    timelineBusinessContextJoinSql,
    pushTimelineBusinessContext,
    pushDefaultTimelineBusinessContext
};
