#!/usr/bin/env node
'use strict';

// Bounded operator: only the three owner-confirmed identities and this feature switch.
// No changes to users.telegram_chat_id, staff.telegram_id, passwords or CRM roles.
const { Pool } = require('pg');
const PILOT = [
    // users.name is the account display name; full names live in linked staff cards.
    { id: 4, username: 'Sergey', name: 'Сергій', telegramId: '674972415' },
    { id: 3, username: 'Natalia', name: 'Наталія', telegramId: '606680445' },
    { id: 13, username: 'Zhenya', name: 'Женя', telegramId: '622480549' }
];

async function applyPilot(client, { action, botUsername }) {
    const users = (await client.query('SELECT id,username,name,is_active FROM users WHERE id=ANY($1::int[]) ORDER BY id FOR SHARE', [PILOT.map(row=>row.id)])).rows;
    for (const expected of PILOT) {
        const actual = users.find(row=>Number(row.id)===expected.id);
        if (!actual || actual.username !== expected.username || actual.name !== expected.name || actual.is_active === false) {
            throw new Error(`Pilot identity mismatch at user ${expected.id}; no writes allowed`);
        }
    }
    const existing = (await client.query('SELECT * FROM telegram_crm_bindings WHERE user_id=ANY($1::int[]) ORDER BY user_id FOR UPDATE', [PILOT.map(row=>row.id)])).rows;
    if (action === 'seed') {
        if (!/^[A-Za-z0-9_]{5,32}$/.test(botUsername || '')) throw new Error('Exact Telegram bot username required');
        const config = (await client.query('SELECT bot_username FROM telegram_crm_settings WHERE singleton=true FOR UPDATE')).rows[0];
        if (config && config.bot_username !== botUsername) throw new Error('Configured bot identity differs; stop');
        for (const person of PILOT) {
            const prior = existing.find(row=>Number(row.user_id)===person.id);
            if (prior?.verified_at) continue; // Never reset a human-confirmed binding.
            if (prior?.proposed_telegram_id && String(prior.proposed_telegram_id)!==person.telegramId) throw new Error('Conflicting proposed identity; stop');
            await client.query(`INSERT INTO telegram_crm_bindings(user_id,pilot_enabled,proposed_telegram_id)
                VALUES($1,true,$2) ON CONFLICT(user_id) DO UPDATE SET pilot_enabled=true,proposed_telegram_id=excluded.proposed_telegram_id,updated_at=NOW()`,
            [person.id,person.telegramId]);
        }
        await client.query("INSERT INTO telegram_crm_settings(singleton,mode,bot_username) VALUES(true,'off',$1) ON CONFLICT(singleton) DO NOTHING", [botUsername]);
    } else if (['off','read','write'].includes(action)) {
        const config = (await client.query('SELECT mode FROM telegram_crm_settings WHERE singleton=true FOR UPDATE')).rows[0];
        if (!config) throw new Error('Seed the reviewed identities first');
        if (action === 'write' && config.mode !== 'read' && config.mode !== 'write') throw new Error('Read-only rollout must precede task creation');
        await client.query('UPDATE telegram_crm_settings SET mode=$1,updated_at=NOW() WHERE singleton=true',[action]);
    }
    const rows = (await client.query(`SELECT user_id,pilot_enabled,proposed_telegram_id::text,telegram_user_id::text,verified_at,version::text
        FROM telegram_crm_bindings WHERE user_id=ANY($1::int[]) ORDER BY user_id`, [PILOT.map(row=>row.id)])).rows;
    const config = (await client.query('SELECT mode,bot_username FROM telegram_crm_settings WHERE singleton=true')).rows[0] || null;
    return { action, configuration:config, bindings:rows };
}

async function main() {
    const args=process.argv.slice(2);
    const action=args.find(value=>/^(plan|seed|off|read|write)$/.test(value)) || 'plan';
    const botUsername=args.find(value=>value.startsWith('--bot='))?.slice(6);
    const apply=args.includes('--apply');
    if (action!=='plan' && !apply) throw new Error('Mutation requires --apply');
    const raw=process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
    if (!raw) throw new Error('Database environment required');
    const url=new URL(raw);
    const local=['127.0.0.1','localhost','::1'].includes(url.hostname);
    if (!local && (process.env.RAILWAY_PROJECT_ID!=='bc28b46c-d4bc-491c-893a-d8401c633668'
        || process.env.RAILWAY_ENVIRONMENT_ID!=='d9f9b984-d54d-4620-a8bf-c48882ad5158'
        || process.env.RAILWAY_SERVICE_ID!=='e2aa25d8-29bc-4cdb-99e7-4ebdf5fa5fe6')) {
        throw new Error('Unexpected production database identity');
    }
    const pool=new Pool({connectionString:raw,ssl:local?false:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:5000});
    const client=await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL statement_timeout='8s'");
        const result=await applyPilot(client,{action,botUsername});
        await client.query(apply?'COMMIT':'ROLLBACK');
        console.log(JSON.stringify(result,null,2));
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
    finally { client.release(); await pool.end(); }
}
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={PILOT,applyPilot};
