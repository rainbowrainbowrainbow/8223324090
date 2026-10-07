'use strict';

// Registry ownership remains after expiry/cleanup. Test money must never
// reappear in working reports merely because a short-lived run has ended.
function businessBookingSql(alias = 'bookings') {
    if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new TypeError('Invalid booking SQL alias');
    return `NOT EXISTS (SELECT 1 FROM trusted_qa_run_entities finance_qa_booking
        JOIN finance_money_qa_runs finance_qa_run ON finance_qa_run.run_id = finance_qa_booking.run_id
        WHERE finance_qa_booking.entity_type = 'booking'
          AND finance_qa_booking.entity_id = ${alias}.id::text)`;
}

module.exports = { businessBookingSql };
