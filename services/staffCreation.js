'use strict';

const { normalizeSecondaryProfessions } = require('./professions');

async function insertStaffRecord(db, {
    name, department, position, phone, hireDate, primaryProfession, secondaryProfessions,
    color, telegramUsername, address, structureNodeId, hourlyRate = 0, rateUnit = 'hour'
}) {
    const secondary = normalizeSecondaryProfessions(secondaryProfessions, primaryProfession);
    const { rows } = await db.query(
        `INSERT INTO staff (name, department, position, phone, hire_date, role_type, secondary_professions,
            color, telegram_username, address, company_structure_node_id, hourly_rate, rate_unit)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [name, department, position, phone || null, hireDate || null, primaryProfession || null, JSON.stringify(secondary),
            color || null, telegramUsername || null, address || null, structureNodeId || null, hourlyRate, rateUnit]
    );
    return rows[0];
}

module.exports = { insertStaffRecord };
