const { pool } = require('../db');

function costumePayload(body = {}) {
    return {
        name: String(body.name || '').trim(),
        category: String(body.category || 'general').trim() || 'general',
        size: String(body.size || '').trim(),
        condition: String(body.condition || 'good').trim() || 'good',
        assigned_to: body.assigned_to || null,
        notes: body.notes ? String(body.notes).trim() : null
    };
}

function validationError(message, statusCode = 400) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

async function listCostumes() {
    const result = await pool.query(`
        SELECT c.*, s.name AS assigned_name
        FROM costumes c
        LEFT JOIN staff s ON s.id = c.assigned_to
        ORDER BY c.name
    `);
    return result.rows;
}

async function createCostume(body = {}) {
    const costume = costumePayload(body);
    if (!costume.name) throw validationError('Потрібна назва');
    const result = await pool.query(
        `INSERT INTO costumes (name, category, size, condition, assigned_to, assigned_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
            costume.name,
            costume.category,
            costume.size,
            costume.condition,
            costume.assigned_to,
            costume.assigned_to ? new Date().toISOString() : null,
            costume.notes
        ]
    );
    return result.rows[0];
}

async function updateCostume(id, body = {}) {
    const { name, category, size, condition, assigned_to, notes } = body;
    const assignedVal = assigned_to !== undefined ? (assigned_to || null) : undefined;
    let sql;
    let params;
    if (assignedVal !== undefined) {
        sql = `UPDATE costumes SET
            name = COALESCE($1, name), category = COALESCE($2, category),
            size = COALESCE($3, size), condition = COALESCE($4, condition),
            assigned_to = $5, assigned_at = CASE WHEN $5::int IS NOT NULL THEN NOW() ELSE assigned_at END,
            notes = COALESCE($6, notes)
         WHERE id = $7 RETURNING *`;
        params = [name, category, size, condition, assignedVal, notes, id];
    } else {
        sql = `UPDATE costumes SET
            name = COALESCE($1, name), category = COALESCE($2, category),
            size = COALESCE($3, size), condition = COALESCE($4, condition),
            notes = COALESCE($5, notes)
         WHERE id = $6 RETURNING *`;
        params = [name, category, size, condition, notes, id];
    }
    const result = await pool.query(sql, params);
    if (result.rows.length === 0) throw validationError('Не знайдено', 404);
    return result.rows[0];
}

async function deleteCostume(id) {
    await pool.query('DELETE FROM costumes WHERE id = $1', [id]);
}

module.exports = {
    createCostume,
    deleteCostume,
    listCostumes,
    updateCostume
};
