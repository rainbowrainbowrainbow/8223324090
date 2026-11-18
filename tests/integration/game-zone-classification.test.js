'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { assertSafeTestDatabaseUrl } = require('../../scripts/test-db-safety');
const { PAIRS, prepareClassificationPlan, executeClassificationPlan } = require('../../services/gameZoneClassification');

test('exact fifteen-row classification and rollback preserve metadata and abort atomically on drift', async () => {
    assert.equal(process.env.ISOLATED_TEST_DATABASE_VERIFIED_BY_RUNNER,'true');
    assert.equal(assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL).isLocal,true);
    const pool = new Pool({connectionString:process.env.TEST_DATABASE_URL,ssl:false});
    const db = await pool.connect();
    try {
        // A private temporary table isolates this data-fix test from the app's
        // real fixture resources, even inside the disposable database.
        await db.query(`CREATE TEMP TABLE timeline_resources(id int PRIMARY KEY,resource_id text,business_context text,
            type text,is_active boolean,metadata jsonb)`);
        for(const pair of PAIRS) await db.query(`INSERT INTO timeline_resources VALUES($1,$2,'event_genix','room',true,'{"keep":{"value":7}}')`,[pair.id,pair.resourceId]);
        const {plan,planHash}=await prepareClassificationPlan(db,'a'.repeat(40));
        const transaction=async fn=>{await db.query('BEGIN');try{const value=await fn();await db.query('COMMIT');return value;}
            catch(error){await db.query('ROLLBACK');throw error;}};
        await db.query("UPDATE timeline_resources SET is_active=false WHERE id=22");
        await assert.rejects(transaction(()=>executeClassificationPlan(db,plan,planHash)),{code:'GAME_ZONE_CLASSIFICATION_DRIFT'});
        assert.equal((await db.query("SELECT id FROM timeline_resources WHERE metadata ? 'workArea'")).rowCount,0);
        await db.query('UPDATE timeline_resources SET is_active=true WHERE id=22');
        assert.equal((await transaction(()=>executeClassificationPlan(db,plan,planHash))).resourceCount,15);
        assert.equal((await db.query("SELECT id FROM timeline_resources WHERE metadata->>'workArea'='game_zone' AND metadata->'keep'=$1::jsonb",[JSON.stringify({value:7})])).rowCount,15);
        await assert.rejects(transaction(()=>executeClassificationPlan(db,plan,planHash)),{code:'GAME_ZONE_CLASSIFICATION_DRIFT'});
        await db.query("UPDATE timeline_resources SET metadata=jsonb_set(metadata,'{keep,value}','8') WHERE id=22");
        await assert.rejects(transaction(()=>executeClassificationPlan(db,plan,planHash,{rollback:true})),{code:'GAME_ZONE_CLASSIFICATION_DRIFT'});
        assert.equal((await db.query("SELECT id FROM timeline_resources WHERE metadata->>'workArea'='game_zone'")).rowCount,15);
        await db.query("UPDATE timeline_resources SET metadata=jsonb_set(metadata,'{keep,value}','7') WHERE id=22");
        assert.equal((await transaction(()=>executeClassificationPlan(db,plan,planHash,{rollback:true}))).resourceCount,15);
        assert.equal((await db.query("SELECT id FROM timeline_resources WHERE metadata ? 'workArea'")).rowCount,0);
    } finally { db.release(); await pool.end(); }
});
