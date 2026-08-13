'use strict';

const { listTaxonomy } = require('./myDayTaxonomy');
const { syncMyDayImpactCatalog } = require('./myDayStarterKit');

async function loadMyDayImpactCatalog(pool, userId, options = {}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const sync = await syncMyDayImpactCatalog(client, userId);
        const impacts = await listTaxonomy(client, userId, 'impacts', {
            includeArchived: options.includeArchived === true
        });
        await client.query('COMMIT');
        return { impacts, sync };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    loadMyDayAiImpactCatalog: loadMyDayImpactCatalog,
    loadMyDayImpactCatalog
};
