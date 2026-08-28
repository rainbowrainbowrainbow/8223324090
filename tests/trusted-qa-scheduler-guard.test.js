'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    ACTIVE_TRUSTED_QA_ENTITY_STATES,
    ACTIVE_TRUSTED_QA_RUN_STATES,
    trustedQaRegisteredBookingExclusionSql
} = require('../services/trustedQaSchedulerGuard');

test('trusted QA scheduler guard uses the authoritative active run registry', () => {
    const sql = trustedQaRegisteredBookingExclusionSql('booking');

    assert.match(sql, /FROM trusted_qa_run_entities trusted_qa_entity/);
    assert.match(sql, /INNER JOIN trusted_qa_runs trusted_qa_run/);
    assert.match(sql, /trusted_qa_entity\.entity_id = booking\.id::text/);
    assert.match(sql, /trusted_qa_entity\.entity_type = 'booking'/);
    for (const state of ACTIVE_TRUSTED_QA_ENTITY_STATES) {
        assert.match(sql, new RegExp(`trusted_qa_entity\\.cleanup_state IN \\([^)]*'${state}'`));
    }
    for (const state of ACTIVE_TRUSTED_QA_RUN_STATES) {
        assert.match(sql, new RegExp(`trusted_qa_run\\.state IN \\([^)]*'${state}'`));
    }
    assert.doesNotMatch(sql, /skip_notification|extra_data|disposableQa/);
});

test('trusted QA scheduler guard rejects unsafe SQL aliases', () => {
    assert.throws(
        () => trustedQaRegisteredBookingExclusionSql('b; DROP TABLE bookings'),
        /safe SQL identifier/
    );
});
