'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    ADMISSION_CONTEXTS,
    TICKET_AUDIENCE_CODES,
    TICKET_DAY_TYPES,
    TICKET_MIGRATION_NUMBER,
    TICKET_ROLE_FLOORS,
    TICKET_TARIFF_EFFECTIVE_FROM,
    TICKET_TIMEZONE,
    canQuoteTickets,
    canReadTicketTariffCatalog,
    canWriteTicketTariffs,
    isTicketTariffContractEffective,
    resolveAdmissionContext,
    resolveAppliedTariff,
    ticketAvailability,
    ticketDayType
} = require('../services/ticketTariffContract');

const ROOT = path.join(__dirname, '..');

function reservedEvidence(overrides = {}) {
    return {
        booking: {
            id: 'BK-CONTRACT-1',
            business_context: 'event_genix',
            room: 'Untrusted room display text',
            room_resource_id: 'room-yellow-table',
            banquet_tables: 0,
            deposit: 0,
            payment_status: 'unpaid',
            banquet_menu: '',
            admission_context: 'standard'
        },
        banquetMembership: {
            booking_id: 'BK-CONTRACT-1',
            group_id: 'BQ-CONTRACT-1',
            business_context: 'event_genix'
        },
        banquetGroup: {
            id: 'BQ-CONTRACT-1',
            business_context: 'event_genix',
            status: 'active'
        },
        roomResource: {
            resource_id: 'room-yellow-table',
            business_context: 'event_genix',
            type: 'room',
            is_active: true
        },
        ...overrides
    };
}

test('ticket contract fixes migration, effective date, timezone, contexts, and role floors', () => {
    assert.equal(TICKET_MIGRATION_NUMBER, 300);
    assert.equal(TICKET_TARIFF_EFFECTIVE_FROM, '2026-07-14');
    assert.equal(TICKET_TIMEZONE, 'Europe/Kyiv');
    assert.deepEqual(Object.values(ADMISSION_CONTEXTS).sort(), ['reserved_table_room', 'standard']);
    assert.deepEqual(TICKET_ROLE_FLOORS, {
        CATALOG_READ: 'manager',
        TARIFF_WRITE: 'senior_manager'
    });
});

test('reserved_table_room requires matching active banquet and physical room evidence', () => {
    assert.equal(resolveAdmissionContext(reservedEvidence()), ADMISSION_CONTEXTS.RESERVED_TABLE_ROOM);

    const cases = [
        reservedEvidence({ banquetMembership: null }),
        reservedEvidence({ banquetGroup: { id: 'BQ-CONTRACT-1', business_context: 'event_genix', status: 'cancelled' } }),
        reservedEvidence({ roomResource: null }),
        reservedEvidence({ roomResource: { resource_id: 'room-yellow-table', business_context: 'event_genix', type: 'room', is_active: false } }),
        reservedEvidence({ roomResource: { resource_id: 'room-yellow-table', business_context: 'dar', type: 'room', is_active: true } }),
        reservedEvidence({ roomResource: { resource_id: 'room-other', business_context: 'event_genix', type: 'room', is_active: true } }),
        reservedEvidence({ roomResource: { resource_id: 'room-yellow-table', business_context: 'event_genix', type: 'cabinet', is_active: true } })
    ];

    for (const evidence of cases) {
        assert.equal(resolveAdmissionContext(evidence), ADMISSION_CONTEXTS.STANDARD);
    }
});

test('takeaway and untrusted commercial fields never unlock reserved tariff context', () => {
    const evidence = reservedEvidence();
    evidence.booking.room = 'Жовтий стіл';
    evidence.booking.room_resource_id = 'room-takeaway';
    evidence.booking.banquet_tables = 99;
    evidence.booking.deposit = 5000;
    evidence.booking.payment_status = 'paid';
    evidence.booking.minimum_menu = 10000;
    evidence.booking.admission_context = 'reserved_table_room';
    evidence.roomResource = {
        resource_id: 'room-takeaway',
        business_context: 'event_genix',
        type: 'room',
        is_active: true
    };

    assert.equal(resolveAdmissionContext(evidence), ADMISSION_CONTEXTS.STANDARD);
});

test('weekend is Saturday and Sunday, and under_3 weekend admission is unavailable', () => {
    assert.equal(ticketDayType('2026-07-17'), TICKET_DAY_TYPES.WEEKDAY);
    assert.equal(ticketDayType('2026-07-18'), TICKET_DAY_TYPES.WEEKEND);
    assert.equal(ticketDayType('2026-07-19'), TICKET_DAY_TYPES.WEEKEND);
    assert.equal(ticketDayType('2026-07-20'), TICKET_DAY_TYPES.WEEKDAY);

    assert.deepEqual(ticketAvailability({
        visitDate: '2026-07-18',
        audienceCode: TICKET_AUDIENCE_CODES.UNDER_3
    }), {
        available: false,
        dayType: 'weekend',
        reason: 'under_3_weekend_unavailable'
    });
    assert.equal(ticketAvailability({ visitDate: '2026-07-17', audienceCode: 'under_3' }).available, true);
    assert.equal(ticketAvailability({ visitDate: '2026-07-18', audienceCode: 'child' }).available, true);
});

test('tariff contract is effective from 2026-07-14 and validates date-only input', () => {
    assert.equal(isTicketTariffContractEffective('2026-07-13'), false);
    assert.equal(isTicketTariffContractEffective('2026-07-14'), true);
    assert.equal(isTicketTariffContractEffective('2026-07-18'), true);
    assert.equal(isTicketTariffContractEffective('2026-02-30'), false);
    assert.throws(() => ticketDayType('2026-02-30'), error => error.code === 'TICKET_DATE_INVALID');
});

test('special ticket tariffs replace the base and never stack', () => {
    const baseTariff = { code: 'base', amount: 400 };
    const specialTariff = { code: 'special', amount: 250 };

    assert.deepEqual(resolveAppliedTariff({ baseTariff }), { tariff: baseTariff, source: 'base' });
    assert.deepEqual(resolveAppliedTariff({ baseTariff, specialTariffs: [specialTariff] }), {
        tariff: specialTariff,
        source: 'special_replacement'
    });
    assert.throws(
        () => resolveAppliedTariff({ baseTariff, specialTariffs: [specialTariff, { code: 'other', amount: 200 }] }),
        error => error.code === 'TICKET_SPECIAL_TARIFF_AMBIGUOUS'
    );
    assert.throws(
        () => resolveAppliedTariff({ baseTariff: null, specialTariffs: [] }),
        error => error.code === 'TICKET_TARIFF_UNAVAILABLE'
    );
});

test('ticket access follows manager, senior_manager, and booking edit contracts', () => {
    assert.equal(canReadTicketTariffCatalog({ role: 'manager' }), true);
    assert.equal(canReadTicketTariffCatalog({ role: 'senior_manager' }), true);
    assert.equal(canReadTicketTariffCatalog({ role: 'admin' }), false);

    assert.equal(canWriteTicketTariffs({ role: 'manager' }), false);
    assert.equal(canWriteTicketTariffs({ role: 'senior_manager' }), true);
    assert.equal(canWriteTicketTariffs({ role: 'director' }), true);

    const booking = { id: 'BK-CONTRACT-1' };
    assert.equal(canQuoteTickets({ role: 'reception' }, booking), true);
    assert.equal(canQuoteTickets({ role: 'manager' }, booking), true);
    assert.equal(canQuoteTickets({ role: 'manager', action_denylist: ['edit_booking'] }, booking), false);
    assert.equal(canQuoteTickets({ role: 'animator' }, booking), false);
});

test('migration 300 is free after the merged room-resource foundation', () => {
    const migrationNumbers = fs.readdirSync(path.join(ROOT, 'db', 'migrations'))
        .map(file => Number.parseInt(/^([0-9]+)_/.exec(file)?.[1] || '', 10))
        .filter(Number.isInteger);
    assert.equal(Math.max(...migrationNumbers), 299);
    assert.equal(migrationNumbers.includes(TICKET_MIGRATION_NUMBER), false);

    const roomMigration = fs.readFileSync(
        path.join(ROOT, 'db', 'migrations', '296_room_resource_id_schema.sql'),
        'utf8'
    );
    for (const table of ['bookings', 'banquet_groups', 'booking_templates', 'recurring_templates']) {
        assert.match(roomMigration, new RegExp(`ALTER TABLE ${table}[\\s\\S]*ADD COLUMN IF NOT EXISTS room_resource_id`));
    }
});
