const { pool } = require('../db');
const { DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');

const STAFF_RESOURCE_KINDS = new Set(['warehouse_stock', 'costume', 'custom']);
const STAFF_RESOURCE_STATUSES = new Set(['issued', 'returned', 'lost', 'written_off']);
const STAFF_RESOURCE_HISTORY_STATUSES = ['returned', 'lost', 'written_off'];

function cleanStaffResourceText(value, limit = 1000) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).replace(/\u0000/g, '').trim();
    return normalized ? normalized.slice(0, limit) : null;
}

function cleanStaffResourceDate(value) {
    const normalized = cleanStaffResourceText(value, 20);
    return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}

function serviceError(message, statusCode = 500) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function normalizeStaffResourceKind(value) {
    const kind = cleanStaffResourceText(value, 64) || 'custom';
    return STAFF_RESOURCE_KINDS.has(kind) ? kind : 'custom';
}

function normalizeStaffResourceListFilter(options = {}) {
    const requestedStatus = cleanStaffResourceText(options.status, 32);
    if (requestedStatus) {
        if (!STAFF_RESOURCE_STATUSES.has(requestedStatus)) {
            throw serviceError('Непідтримуваний статус ресурсу', 400);
        }
        return { view: 'status', statuses: [requestedStatus] };
    }

    const requestedView = cleanStaffResourceText(options.view, 32);
    if (requestedView && !['active', 'history', 'all'].includes(requestedView)) {
        throw serviceError('Непідтримуваний фільтр ресурсів', 400);
    }
    const view = requestedView || (options.includeReturned === true ? 'all' : 'active');
    if (view === 'active') return { view, statuses: ['issued'] };
    if (view === 'history') return { view, statuses: STAFF_RESOURCE_HISTORY_STATUSES };
    return { view: 'all', statuses: null };
}
function staffResourceAssignmentMeta(row) {
    if (!row) return null;
    return {
        id: row.id,
        staff_id: row.staff_id,
        resource_kind: row.resource_kind,
        warehouse_stock_id: row.warehouse_stock_id,
        costume_id: row.costume_id,
        warehouse_stock_name: row.warehouse_stock_name || null,
        costume_name: row.costume_name || null,
        title: row.title,
        quantity: Number(row.quantity || 0),
        issued_at: row.issued_at,
        due_return_at: row.due_return_at,
        returned_at: row.returned_at,
        status: row.status,
        notes: row.notes,
        issued_by: row.issued_by,
        returned_by: row.returned_by,
        warehouse_issue_movement_id: row.warehouse_issue_movement_id || null,
        warehouse_return_movement_id: row.warehouse_return_movement_id || null,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

async function loadStaffResourceStaff(staffId, db = pool, { lock = false } = {}) {
    const result = await db.query(
        `SELECT id, name, is_active, hr_pool_status, blacklist_reason, notes
         FROM staff
         WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
        [staffId]
    );
    return result.rows[0] || null;
}

async function listStaffResources(staffId, options = {}, db = pool) {
    const filter = normalizeStaffResourceListFilter(options);
    let sql = `SELECT sra.*, ws.name AS warehouse_stock_name, c.name AS costume_name
               FROM staff_resource_assignments sra
               LEFT JOIN warehouse_stock ws ON ws.id = sra.warehouse_stock_id
               LEFT JOIN costumes c ON c.id = sra.costume_id
               WHERE sra.staff_id = $1`;
    const params = [staffId];
    if (filter.statuses) {
        params.push(filter.statuses);
        sql += ` AND sra.status = ANY($2::text[])`;
    }
    sql += ` ORDER BY sra.status = 'issued' DESC, sra.due_return_at ASC NULLS LAST, sra.created_at DESC`;
    const result = await db.query(sql, params);
    return result.rows.map(staffResourceAssignmentMeta);
}

async function listStaffResourceOptions(options = {}, db = pool) {
    const kind = normalizeStaffResourceKind(options.kind);
    const query = cleanStaffResourceText(options.q || options.search, 80);
    const limit = Math.max(1, Math.min(80, Number(options.limit || 50)));

    if (kind === 'warehouse_stock') {
        const businessContext = options.businessContext || DEFAULT_BUSINESS_CONTEXT;
        const params = [businessContext];
        const conditions = [
            `COALESCE(ws.business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $1`,
            'ws.is_active = true'
        ];
        if (query) {
            params.push(`%${query}%`);
            conditions.push(`(
                ws.name ILIKE $${params.length}
                OR COALESCE(ws.category, '') ILIKE $${params.length}
                OR COALESCE(ws.sku, '') ILIKE $${params.length}
                OR COALESCE(wl.name, '') ILIKE $${params.length}
            )`);
        }
        params.push(limit);
        const result = await db.query(
            `SELECT ws.id, ws.name, ws.category, ws.quantity, ws.unit, ws.owner,
                    ws.location_id, wl.name AS location_name
             FROM warehouse_stock ws
             LEFT JOIN warehouse_locations wl ON wl.id = ws.location_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY ws.quantity > 0 DESC, wl.sort_order NULLS LAST, ws.category, ws.name
             LIMIT $${params.length}`,
            params
        );
        return {
            kind,
            data: result.rows.map(row => ({
                id: row.id,
                kind,
                label: row.name,
                subtitle: [row.category, row.location_name, `${Number(row.quantity || 0)} ${row.unit || 'шт'}`].filter(Boolean).join(' · '),
                category: row.category,
                quantity: Number(row.quantity || 0),
                unit: row.unit || 'шт',
                owner: row.owner || 'park',
                location_id: row.location_id,
                location_name: row.location_name
            }))
        };
    }

    if (kind === 'costume') {
        const params = [];
        const conditions = [`COALESCE(c.condition, 'good') <> 'retired'`];
        if (query) {
            params.push(`%${query}%`);
            conditions.push(`(
                c.name ILIKE $${params.length}
                OR COALESCE(c.category, '') ILIKE $${params.length}
                OR COALESCE(c.size, '') ILIKE $${params.length}
                OR COALESCE(c.condition, '') ILIKE $${params.length}
                OR COALESCE(s.name, '') ILIKE $${params.length}
            )`);
        }
        params.push(limit);
        const result = await db.query(
            `SELECT c.id, c.name, c.category, c.size, c.condition, c.assigned_to, s.name AS assigned_name
             FROM costumes c
             LEFT JOIN staff s ON s.id = c.assigned_to
             ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
             ORDER BY c.assigned_to IS NULL DESC, c.name
             LIMIT $${params.length}`,
            params
        );
        return {
            kind,
            data: result.rows.map(row => ({
                id: row.id,
                kind,
                label: row.name,
                subtitle: [row.category, row.size, row.condition, row.assigned_name ? `закріплено: ${row.assigned_name}` : 'вільний'].filter(Boolean).join(' · '),
                category: row.category,
                size: row.size,
                condition: row.condition,
                assigned_to: row.assigned_to,
                assigned_name: row.assigned_name,
                is_available: !row.assigned_to
            }))
        };
    }

    return { kind: 'custom', data: [] };
}

async function issueStaffResource(staffId, body = {}, options = {}, dbPool = pool) {
    const client = await dbPool.connect();
    let began = false;
    try {
        const resourceKind = normalizeStaffResourceKind(body.resource_kind || body.resourceKind);
        const warehouseStockId = resourceKind === 'warehouse_stock' ? numberOrNull(body.warehouse_stock_id || body.warehouseStockId) : null;
        const costumeId = resourceKind === 'costume' ? numberOrNull(body.costume_id || body.costumeId) : null;
        const requestedQuantity = numberOrNull(body.quantity);
        const quantity = requestedQuantity === null ? 1 : requestedQuantity;
        const issuedAt = cleanStaffResourceDate(body.issued_at || body.issuedAt) || options.today;
        const dueReturnAt = cleanStaffResourceDate(body.due_return_at || body.dueReturnAt);
        const notes = cleanStaffResourceText(body.notes, 2000);
        const actor = options.actor || null;
        const businessContext = options.businessContext || DEFAULT_BUSINESS_CONTEXT;
        let title = cleanStaffResourceText(body.title, 160);

        await client.query('BEGIN');
        began = true;
        const staff = await loadStaffResourceStaff(staffId, client, { lock: true });
        if (!staff) throw serviceError('Співробітника не знайдено', 404);
        if (resourceKind === 'warehouse_stock' && !warehouseStockId) {
            throw serviceError('Виберіть складську позицію', 400);
        }
        if (resourceKind === 'costume' && !costumeId) {
            throw serviceError('Виберіть костюм', 400);
        }
        if (quantity <= 0) {
            throw serviceError('Кількість має бути більшою за нуль', 400);
        }
        if (resourceKind === 'warehouse_stock' && !Number.isInteger(quantity)) {
            throw serviceError('Кількість складського ресурсу має бути цілим числом', 400);
        }

        let warehouseStock = null;
        if (warehouseStockId) {
            const stock = await client.query(
                `SELECT id, name, quantity, unit, location_id, business_context
                 FROM warehouse_stock
                 WHERE id = $1
                   AND is_active = true
                   AND COALESCE(business_context, $2) = $3
                 FOR UPDATE`,
                [warehouseStockId, DEFAULT_BUSINESS_CONTEXT, businessContext]
            );
            warehouseStock = stock.rows[0] || null;
            if (!warehouseStock) throw serviceError('Складську позицію не знайдено', 404);
            if (Number(warehouseStock.quantity || 0) < quantity) {
                throw serviceError(`Недостатньо на складі: доступно ${Number(warehouseStock.quantity || 0)} ${warehouseStock.unit || 'шт.'}`, 409);
            }
            if (!title) title = warehouseStock.name || null;
        }

        let costume = null;
        if (costumeId) {
            const costumeResult = await client.query('SELECT name, assigned_to FROM costumes WHERE id = $1 FOR UPDATE', [costumeId]);
            costume = costumeResult.rows[0] || null;
            if (!costume) throw serviceError('Костюм не знайдено', 404);
            const assignedTo = Number(costume.assigned_to || 0);
            if (assignedTo && assignedTo !== Number(staffId)) {
                throw serviceError('Костюм вже закріплено за іншим співробітником', 409);
            }
            const trackedAssignment = await client.query(
                `SELECT id, staff_id, status
                 FROM staff_resource_assignments
                 WHERE costume_id = $1 AND status IN ('issued', 'lost')
                 ORDER BY id DESC
                 LIMIT 1
                 FOR UPDATE`,
                [costumeId]
            );
            if (trackedAssignment.rows[0]) {
                throw serviceError('Костюм уже має активну або втрачену видачу', 409);
            }
            if (!title) title = costume.name || null;
        }

        if (!title) throw serviceError('Назва ресурсу обовʼязкова', 400);

        const result = await client.query(
            `INSERT INTO staff_resource_assignments
                (staff_id, resource_kind, warehouse_stock_id, costume_id, title, quantity,
                 issued_at, due_return_at, notes, issued_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING *`,
            [staffId, resourceKind, warehouseStockId, costumeId, title, quantity, issuedAt, dueReturnAt, notes, actor]
        );
        let assignment = result.rows[0];

        if (warehouseStockId && warehouseStock) {
            const reason = `HR-видача співробітнику: ${staff.name || `#${staffId}`}`;
            await client.query(
                `UPDATE warehouse_stock
                 SET quantity = quantity - $1, updated_at = NOW(), updated_by = $2
                 WHERE id = $3`,
                [quantity, actor, warehouseStockId]
            );
            await client.query(
                `INSERT INTO warehouse_history (stock_id, change, reason, created_by, business_context)
                 VALUES ($1, $2, $3, $4, $5)`,
                [warehouseStockId, -quantity, reason, actor, businessContext]
            );
            const movement = await client.query(
                `INSERT INTO warehouse_stock_movements (
                    warehouse_stock_id, movement_type, from_location_id, to_location_id,
                    quantity, reason, created_by, business_context
                 )
                 VALUES ($1, 'issue', $2, NULL, $3, $4, $5, $6)
                 RETURNING id`,
                [warehouseStockId, warehouseStock.location_id || null, quantity, reason, actor, businessContext]
            );
            const linked = await client.query(
                `UPDATE staff_resource_assignments
                 SET warehouse_issue_movement_id = $2, updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [assignment.id, movement.rows[0].id]
            );
            assignment = linked.rows[0];
            assignment.warehouse_stock_name = warehouseStock.name;
        }

        if (costumeId) {
            await client.query(
                `UPDATE costumes
                 SET assigned_to = $2, assigned_at = NOW()
                 WHERE id = $1 AND (assigned_to IS NULL OR assigned_to = $2)`,
                [costumeId, staffId]
            );
            assignment.costume_name = costume?.name || null;
        }

        await client.query('COMMIT');
        began = false;
        return {
            row: assignment,
            data: staffResourceAssignmentMeta(assignment),
            audit: {
                assignment_id: assignment.id,
                resource_kind: resourceKind,
                warehouse_stock_id: warehouseStockId,
                costume_id: costumeId,
                warehouse_issue_movement_id: assignment.warehouse_issue_movement_id || null,
                quantity,
                title,
                due_return_at: dueReturnAt
            }
        };
    } catch (err) {
        if (began) await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function transitionStaffResource(staffId, assignmentId, targetStatus, body = {}, options = {}, dbPool = pool) {
    const client = await dbPool.connect();
    let began = false;
    try {
        if (!STAFF_RESOURCE_HISTORY_STATUSES.includes(targetStatus)) {
            throw serviceError('Непідтримуваний кінцевий статус ресурсу', 400);
        }
        const completedAt = cleanStaffResourceDate(
            body.completed_at || body.completedAt || body.returned_at || body.returnedAt
        ) || options.today;
        const actor = options.actor || null;
        await client.query('BEGIN');
        began = true;
        const assignmentResult = await client.query(
            `SELECT sra.*, ws.name AS warehouse_stock_name, ws.location_id AS warehouse_location_id,
                    ws.business_context AS warehouse_business_context, c.name AS costume_name
             FROM staff_resource_assignments sra
             LEFT JOIN warehouse_stock ws ON ws.id = sra.warehouse_stock_id
             LEFT JOIN costumes c ON c.id = sra.costume_id
             WHERE sra.id = $1 AND sra.staff_id = $2
             FOR UPDATE OF sra`,
            [assignmentId, staffId]
        );
        const existing = assignmentResult.rows[0] || null;
        if (!existing) throw serviceError('Ресурс не знайдено', 404);
        if (existing.status !== 'issued') {
            if (existing.status === targetStatus) {
                await client.query('COMMIT');
                began = false;
                return {
                    row: existing,
                    data: staffResourceAssignmentMeta(existing),
                    idempotent: true,
                    audit: null
                };
            }
            throw serviceError('Ресурс уже має інший кінцевий статус', 409);
        }

        let returnMovementId = null;
        if (targetStatus === 'returned' && existing.warehouse_stock_id) {
            const stock = await client.query(
                `SELECT id, location_id, business_context
                 FROM warehouse_stock
                 WHERE id = $1
                 FOR UPDATE`,
                [existing.warehouse_stock_id]
            );
            if (stock.rows[0]) {
                const stockRow = stock.rows[0];
                const businessContext = stockRow.business_context || DEFAULT_BUSINESS_CONTEXT;
                const reason = `HR-повернення від співробітника #${staffId}`;
                await client.query(
                    `UPDATE warehouse_stock
                     SET quantity = quantity + $1, updated_at = NOW(), updated_by = $2
                     WHERE id = $3`,
                    [existing.quantity, actor, existing.warehouse_stock_id]
                );
                await client.query(
                    `INSERT INTO warehouse_history (stock_id, change, reason, created_by, business_context)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [existing.warehouse_stock_id, existing.quantity, reason, actor, businessContext]
                );
                const movement = await client.query(
                    `INSERT INTO warehouse_stock_movements (
                        warehouse_stock_id, movement_type, from_location_id, to_location_id,
                        quantity, reason, created_by, business_context
                     )
                     VALUES ($1, 'return', NULL, $2, $3, $4, $5, $6)
                     RETURNING id`,
                    [existing.warehouse_stock_id, stockRow.location_id || null, existing.quantity, reason, actor, businessContext]
                );
                returnMovementId = movement.rows[0].id;
            }
        }

        const result = await client.query(
            `UPDATE staff_resource_assignments
             SET status = $3,
                 returned_at = $4,
                 returned_by = $5,
                 warehouse_return_movement_id = $6,
                 updated_at = NOW()
             WHERE id = $1 AND staff_id = $2
             RETURNING *`,
            [assignmentId, staffId, targetStatus, completedAt, actor, returnMovementId]
        );
        if (result.rows[0].costume_id && targetStatus === 'returned') {
            await client.query(
                `UPDATE costumes
                 SET assigned_to = NULL, assigned_at = NULL
                 WHERE id = $1 AND assigned_to = $2`,
                [result.rows[0].costume_id, staffId]
            );
        }
        if (result.rows[0].costume_id && targetStatus === 'lost') {
            const costumeUpdate = await client.query(
                `UPDATE costumes
                 SET assigned_to = $2, assigned_at = COALESCE(assigned_at, NOW())
                 WHERE id = $1 AND (assigned_to IS NULL OR assigned_to = $2)`,
                [result.rows[0].costume_id, staffId]
            );
            if (costumeUpdate.rowCount === 0) {
                throw serviceError('Костюм уже закріплений за іншим працівником', 409);
            }
        }
        if (result.rows[0].costume_id && targetStatus === 'written_off') {
            const costumeUpdate = await client.query(
                `UPDATE costumes
                 SET condition = 'retired', assigned_to = NULL, assigned_at = NULL
                 WHERE id = $1 AND (assigned_to IS NULL OR assigned_to = $2)`,
                [result.rows[0].costume_id, staffId]
            );
            if (costumeUpdate.rowCount === 0) {
                throw serviceError('Костюм уже закріплений за іншим працівником', 409);
            }
        }
        await client.query('COMMIT');
        began = false;
        const assignment = {
            ...result.rows[0],
            warehouse_stock_name: existing.warehouse_stock_name || null,
            costume_name: existing.costume_name || null
        };
        return {
            row: assignment,
            data: staffResourceAssignmentMeta(assignment),
            idempotent: false,
            audit: {
                assignment_id: result.rows[0].id,
                title: result.rows[0].title,
                previous_status: 'issued',
                status: targetStatus,
                warehouse_stock_id: result.rows[0].warehouse_stock_id || null,
                costume_id: result.rows[0].costume_id || null,
                warehouse_return_movement_id: returnMovementId,
                completed_at: completedAt,
                stock_effect: result.rows[0].warehouse_stock_id
                    ? (targetStatus === 'returned' ? 'returned_to_stock' : 'stock_not_restored')
                    : 'not_applicable',
                costume_effect: result.rows[0].costume_id
                    ? (targetStatus === 'returned'
                        ? 'released'
                        : targetStatus === 'written_off'
                            ? 'retired'
                            : 'kept_unavailable')
                    : 'not_applicable'
            }
        };
    } catch (err) {
        if (began) await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

async function returnStaffResource(staffId, assignmentId, body = {}, options = {}, dbPool = pool) {
    return transitionStaffResource(staffId, assignmentId, 'returned', body, options, dbPool);
}

module.exports = {
    issueStaffResource,
    listStaffResourceOptions,
    listStaffResources,
    normalizeStaffResourceKind,
    normalizeStaffResourceListFilter,
    returnStaffResource,
    staffResourceAssignmentMeta,
    transitionStaffResource
};
