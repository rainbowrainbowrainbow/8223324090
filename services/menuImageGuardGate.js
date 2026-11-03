'use strict';

const LOCK = 'eventgenix:menu-image-guard-cutover:v1';
let activeLegacyRequests = 0;

function gateError(code) { return Object.assign(new Error(code), { code }); }

// Bound checked-out sessions so legacy provider calls cannot exhaust the pool.
// The shared session lock lasts until the legacy request finishes. An activated
// guard marker is never reset by the application.
async function withLegacyMenuGuard(pool, work) {
    if (activeLegacyRequests >= 4) throw gateError('MENU_PAID_LEGACY_BUSY');
    activeLegacyRequests++;
    let client, locked = false, releaseError;
    try {
        client = await pool.connect();
        const lock = await client.query('SELECT pg_try_advisory_lock_shared(hashtext($1)) AS locked', [LOCK]);
        locked = lock.rows[0]?.locked === true;
        if (!locked) throw gateError('MENU_PAID_GUARD_TRANSITION');
        const table = await client.query("SELECT to_regclass('menu_image_guard_activation') AS name");
        if (table.rows[0]?.name) {
            const marker = await client.query('SELECT 1 FROM menu_image_guard_activation WHERE singleton=TRUE');
            if (marker.rowCount) throw gateError('MENU_PAID_GUARD_DISABLED');
        }
        return await work();
    } finally {
        try {
            if (locked) await client.query('SELECT pg_advisory_unlock_shared(hashtext($1))', [LOCK]);
        } catch (error) { releaseError = error; throw error; }
        finally { if (client) client.release(releaseError); activeLegacyRequests--; }
    }
}

async function activateMenuGuard(pool) {
    const client = await pool.connect();
    let locked = false, releaseError;
    try {
        const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [LOCK]);
        locked = lock.rows[0]?.locked === true;
        if (!locked) throw gateError('MENU_PAID_GUARD_TRANSITION');
        const marker = await client.query('SELECT 1 FROM menu_image_guard_activation WHERE singleton=TRUE');
        if (!marker.rowCount) {
            // A legacy KIE create call may have returned while its task continues.
            // An age threshold is not evidence that the paid work is finished.
            const pending = await client.query(`SELECT EXISTS (
                SELECT 1 FROM products WHERE ai_card_draft #>> '{imageStudio,status}' = 'generating'
            ) AS pending`);
            if (pending.rows[0]?.pending === true) throw gateError('MENU_PAID_LEGACY_PENDING');
            await client.query('INSERT INTO menu_image_guard_activation (singleton) VALUES (TRUE) ON CONFLICT DO NOTHING');
        }
    } finally {
        try {
            if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK]);
        } catch (error) { releaseError = error; throw error; }
        finally { client.release(releaseError); }
    }
}

module.exports = { withLegacyMenuGuard, activateMenuGuard };
