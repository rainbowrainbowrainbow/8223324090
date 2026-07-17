const test = require('node:test');
const assert = require('node:assert/strict');

const {
    APPLY_CONFIRMATION,
    LEGACY_ROOM_ALIASES,
    classifyRoomValue,
    buildBackfillReport,
    applyBackfill
} = require('../scripts/backfill-room-resource-id');

const resources = [
    {
        resource_id: 'room-marvel',
        name: 'Marvel Prime',
        short_name: 'Marvel',
        metadata: { aliases: ['Old Marvel'] },
        is_active: true
    },
    {
        resource_id: 'room-retired',
        name: 'Retired Room',
        short_name: null,
        metadata: {},
        is_active: false
    }
];

test('room resource backfill classifier is deterministic and conservative', () => {
    assert.deepEqual(classifyRoomValue('Marvel Prime', resources), {
        category: 'exact_canonical_name',
        resourceId: 'room-marvel'
    });
    assert.deepEqual(classifyRoomValue('Marvel', resources), {
        category: 'short_name',
        resourceId: 'room-marvel'
    });
    assert.deepEqual(classifyRoomValue('Old Marvel', resources), {
        category: 'unique_alias',
        resourceId: 'room-marvel'
    });
    assert.deepEqual(classifyRoomValue('Retired Room', resources), {
        category: 'inactive_unique_resource',
        resourceId: 'room-retired'
    });
    assert.deepEqual(classifyRoomValue('На виніс', resources), {
        category: 'takeaway',
        resourceId: 'room-takeaway'
    });
    assert.equal(classifyRoomValue('Custom room', resources).category, 'unknown_or_custom');
    assert.equal(classifyRoomValue('Інше', resources).category, 'other_legacy');
    assert.equal(classifyRoomValue('??????', resources).category, 'mojibake');

    const ambiguous = [...resources, {
        resource_id: 'room-other',
        name: 'Other',
        metadata: { aliases: ['Old Marvel'] },
        is_active: true
    }];
    assert.equal(classifyRoomValue('Old Marvel', ambiguous).category, 'ambiguous_name_or_alias');
});

test('production legacy English aliases are explicit one-to-one mappings', () => {
    assert.deepEqual(LEGACY_ROOM_ALIASES, {
        'room-marvel': ['Marvel'],
        'room-ninja': ['Ninja'],
        'room-minecraft': ['Minecraft'],
        'room-monster-high': ['Monster High'],
        'room-elza': ['Elsa'],
        'room-rock': ['Rock'],
        'room-minion': ['Minion'],
        'room-pony': ['Pony'],
        'room-foodcourt': ['Food Court']
    });
});

test('room resource backfill dry-run reports technical IDs without customer fields', async () => {
    const tableRows = {
        bookings: [
            { id: 'BK-1', room: 'Old Marvel', room_resource_id: null, business_context: 'event_genix' },
            { id: 'BK-2', room: 'Custom room', room_resource_id: null, business_context: 'event_genix' }
        ],
        banquet_groups: [],
        booking_templates: [{ id: 1, room: 'Marvel', room_resource_id: null }],
        recurring_templates: [{ id: 2, room: 'На виніс', room_resource_id: null }]
    };
    const db = {
        query: async sql => {
            if (/FROM timeline_resources/i.test(sql)) return { rows: resources };
            const table = Object.keys(tableRows).find(name => new RegExp(`FROM ${name}\\b`, 'i').test(sql));
            if (table) return { rows: tableRows[table] };
            if (/FROM banquet_groups bg/i.test(sql)) return { rows: [] };
            throw new Error(`Unexpected query: ${sql}`);
        }
    };

    const report = await buildBackfillReport(db, 'event_genix');
    assert.equal(report.readOnly, true);
    assert.equal(report.piiIncluded, false);
    assert.equal(report.summary.safeBackfill, 3);
    assert.equal(report.summary.unresolved, 1);
    assert.deepEqual(report.plannedCatalogAliases, [{
        resourceId: 'room-marvel',
        aliasesToAdd: ['Marvel'],
        aliases: ['Old Marvel', 'Marvel']
    }]);
    assert.deepEqual(report.unresolvedTechnicalIds, [{
        table: 'bookings',
        id: 'BK-2',
        category: 'unknown_or_custom'
    }]);
    assert.equal(JSON.stringify(report).includes('customer'), false);
});

test('room resource backfill apply requires confirmation and exact dry-run count', async () => {
    const report = {
        businessContext: 'event_genix',
        plannedCatalogAliases: [{
            resourceId: 'room-marvel',
            aliasesToAdd: ['Marvel'],
            aliases: ['Marvel']
        }],
        tables: {
            bookings: { items: [{ table: 'bookings', id: 'BK-1', category: 'unique_alias', resourceId: 'room-marvel' }] },
            banquet_groups: { items: [] },
            booking_templates: { items: [] },
            recurring_templates: { items: [] }
        }
    };
    const calls = [];
    const client = {
        query: async (sql, params = []) => {
            calls.push({ sql, params });
            return { rows: [], rowCount: /^UPDATE/i.test(String(sql).trim()) ? 1 : 0 };
        },
        release() {}
    };
    const db = { connect: async () => client };

    await assert.rejects(
        applyBackfill(db, report, { expectedSafe: 1 }),
        /--confirm=BACKFILL_ROOM_RESOURCE_ID/
    );
    await assert.rejects(
        applyBackfill(db, report, { confirmation: APPLY_CONFIRMATION, expectedSafe: 2 }),
        /--expected-safe=1/
    );

    const result = await applyBackfill(db, report, {
        confirmation: APPLY_CONFIRMATION,
        expectedSafe: 1
    });
    assert.equal(result.updatedTotal, 1);
    assert.equal(result.catalogAliasesUpdated, 1);
    assert.deepEqual(calls.map(call => String(call.sql).trim().split(/\s+/)[0]), ['BEGIN', 'UPDATE', 'UPDATE', 'COMMIT']);
    assert.match(calls[1].sql, /UPDATE timeline_resources/);
    assert.deepEqual(calls[1].params, ['event_genix', 'room-marvel', '["Marvel"]']);
    assert.match(calls[2].sql, /room_resource_id IS NULL/);
    assert.match(calls[2].sql, /business_context/);
});
