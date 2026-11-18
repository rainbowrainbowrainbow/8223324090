#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { Client } = require('pg');
const { resolveEnvironment } = require('./trusted-qa-baseline-access-run');
const { prepareClassificationPlan, describeClassificationPlan, executeClassificationPlan } = require('../services/gameZoneClassification');
const guard = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
async function main(argv = process.argv.slice(2), env = process.env) {
    const { values } = parseArgs({ args: argv, options: { mode: { type:'string', default:'plan' },
        'release-sha': { type:'string' }, 'plan-file': { type:'string' }, 'approved-hash': { type:'string' },
        confirm: { type:'string' }, local: { type:'boolean' } } });
    guard(['plan','apply','rollback'].includes(values.mode), 'GAME_ZONE_CLASSIFICATION_ARGUMENT_INVALID');
    const target = resolveEnvironment(values, env);
    let description;
    if (values.mode !== 'plan') {
        guard(path.isAbsolute(values['plan-file'] || ''), 'GAME_ZONE_CLASSIFICATION_PLAN_REQUIRED');
        description = describeClassificationPlan(JSON.parse(fs.readFileSync(values['plan-file'],'utf8').replace(/^\uFEFF/,'')));
        guard(description.planHash === values['approved-hash'] && values.confirm === (values.mode === 'rollback'
            ? 'ROLLBACK_EXACT_GAME_ZONE_CLASSIFICATION' : 'APPLY_EXACT_GAME_ZONE_CLASSIFICATION'), 'GAME_ZONE_CLASSIFICATION_APPROVAL_REQUIRED');
        if (!values.local) {
            const response = await fetch(target.origin + '/api/version', { redirect:'error', signal:AbortSignal.timeout(15000) });
            guard(response.ok, 'GAME_ZONE_CLASSIFICATION_VERSION_UNAVAILABLE');
            const live = await response.json();
            guard(live.commitSha === description.plan.releaseSha && live.sourceBranch === 'codex/eventgenix-production'
                && live.deploymentMetadata?.complete === true, 'GAME_ZONE_CLASSIFICATION_RELEASE_DRIFT');
        }
    }
    const db = new Client({ connectionString:target.connectionString, connectionTimeoutMillis:8000,
        statement_timeout:15000, ...(values.local ? { ssl:false } : {}) });
    await db.connect();
    try {
        await db.query(values.mode === 'plan' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
        await db.query("SET LOCAL lock_timeout='5s'");
        const result = values.mode === 'plan' ? { ...await prepareClassificationPlan(db, values['release-sha']), readOnly:true }
            : await executeClassificationPlan(db, description.plan, values['approved-hash'], { rollback:values.mode === 'rollback' });
        await db.query(values.mode === 'plan' ? 'ROLLBACK' : 'COMMIT');
        return result;
    } catch (error) { await db.query('ROLLBACK').catch(()=>{}); throw error; }
    finally { await db.end(); }
}
if (require.main === module) main().then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error(/^[A-Z0-9_]{1,90}$/.test(error.code||'') ? error.code : 'GAME_ZONE_CLASSIFICATION_FAILED'); process.exitCode=1;
});
module.exports = { main };
