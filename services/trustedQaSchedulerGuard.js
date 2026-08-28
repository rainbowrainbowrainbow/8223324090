'use strict';

const ACTIVE_TRUSTED_QA_RUN_STATES = Object.freeze([
    'active',
    'cleanup_pending',
    'blocked'
]);

const ACTIVE_TRUSTED_QA_ENTITY_STATES = Object.freeze([
    'active',
    'cleanup_pending',
    'blocked'
]);

function sqlStringList(values) {
    return values.map(value => `'${String(value).replaceAll("'", "''")}'`).join(', ');
}

function trustedQaRegisteredBookingExclusionSql(bookingAlias = 'b') {
    const alias = String(bookingAlias || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
        throw new TypeError('Trusted QA booking alias must be a safe SQL identifier');
    }

    return `NOT EXISTS (
        SELECT 1
        FROM trusted_qa_run_entities trusted_qa_entity
        INNER JOIN trusted_qa_runs trusted_qa_run
            ON trusted_qa_run.id = trusted_qa_entity.run_id
        WHERE trusted_qa_entity.entity_type = 'booking'
          AND trusted_qa_entity.entity_id = ${alias}.id::text
          AND trusted_qa_entity.cleanup_state IN (${sqlStringList(ACTIVE_TRUSTED_QA_ENTITY_STATES)})
          AND trusted_qa_run.state IN (${sqlStringList(ACTIVE_TRUSTED_QA_RUN_STATES)})
    )`;
}

module.exports = {
    ACTIVE_TRUSTED_QA_ENTITY_STATES,
    ACTIVE_TRUSTED_QA_RUN_STATES,
    trustedQaRegisteredBookingExclusionSql
};
