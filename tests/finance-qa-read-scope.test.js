'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { businessBookingSql } = require('../services/financeQaReadScope');

test('financial QA report exclusion is tied to durable ownership rather than run activity', () => {
    const sql = businessBookingSql('b');
    assert.match(sql, /NOT EXISTS/);
    assert.match(sql, /JOIN finance_money_qa_runs/);
    assert.match(sql, /finance_qa_booking\.entity_type = 'booking'/);
    assert.match(sql, /finance_qa_booking\.entity_id = b\.id::text/);
    assert.doesNotMatch(sql, /expires_at|cleanup_state|state\s*=/);
});

test('report query aliases cannot inject a different SQL predicate', () => {
    assert.match(businessBookingSql(), /bookings\.id::text/);
    for (const alias of ['', 'b) OR TRUE --', 'b.id', 'bookings;DELETE', 'b\n WHERE true']) {
        assert.throws(() => businessBookingSql(alias), TypeError);
    }
});
