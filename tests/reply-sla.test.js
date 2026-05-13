const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    REPLY_SLA_STATES,
    deriveReplySlaState,
    isActiveWaitingReply
} = require('../services/replySla');

const BASE_WAITING = {
    reply_expected: true,
    awaiting_reply_since: '2026-05-13T09:00:00.000Z',
    last_inbound_at: '2026-05-13T08:00:00.000Z',
    reply_expected_delivery_status: 'delivered'
};

describe('reply SLA severity', () => {
    it('derives states only for active waiting reply with a valid SLA timestamp', () => {
        const now = '2026-05-13T10:00:00.000Z';

        assert.equal(isActiveWaitingReply(BASE_WAITING), true);
        assert.equal(deriveReplySlaState({ ...BASE_WAITING }, { now }), REPLY_SLA_STATES.NONE);
        assert.equal(
            deriveReplySlaState({ ...BASE_WAITING, reply_sla_at: '2026-05-13T18:00:00.000Z' }, { now }),
            REPLY_SLA_STATES.ON_TRACK
        );
        assert.equal(
            deriveReplySlaState({ ...BASE_WAITING, reply_sla_at: '2026-05-13T13:30:00.000Z' }, { now }),
            REPLY_SLA_STATES.DUE_SOON
        );
        assert.equal(
            deriveReplySlaState({ ...BASE_WAITING, reply_sla_at: '2026-05-13T09:59:00.000Z' }, { now }),
            REPLY_SLA_STATES.OVERDUE
        );
    });

    it('does not create severity for cleared or invalidated waiting reply', () => {
        const now = '2026-05-13T10:00:00.000Z';
        const replySlaAt = '2026-05-13T09:59:00.000Z';

        assert.equal(
            deriveReplySlaState({ ...BASE_WAITING, reply_expected: false, reply_sla_at: replySlaAt }, { now }),
            REPLY_SLA_STATES.NONE
        );
        assert.equal(
            deriveReplySlaState({ ...BASE_WAITING, last_inbound_at: '2026-05-13T09:30:00.000Z', reply_sla_at: replySlaAt }, { now }),
            REPLY_SLA_STATES.NONE
        );
        assert.equal(
            deriveReplySlaState({ ...BASE_WAITING, reply_expected_delivery_status: 'later_failed', reply_sla_at: replySlaAt }, { now }),
            REPLY_SLA_STATES.NONE
        );
    });
});
