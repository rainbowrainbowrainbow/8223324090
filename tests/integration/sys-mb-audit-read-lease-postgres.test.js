'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { plan, apply, retire, TABLES } = require('../../scripts/sys-mb-audit-read-lease.cjs');

test('real local PostgreSQL SELECT lease, denied writes, grant drift and retirement', {
    skip: process.env.SYS_MB_LOCAL_LEASE_PG !== '1'
}, async () => {
    assert.equal(process.platform, 'linux');
    assert.notEqual(process.env.NODE_ENV, 'production');
    for (const key of ['DATABASE_URL', 'RAILWAY_PROJECT_ID', 'TRUSTED_QA_OPERATOR_DATABASE_URL']) assert.ok(!process.env[key]);
    const suffix = crypto.randomBytes(6).toString('hex');
    const database = `sys_mb_recover_01_test_${suffix}`;
    const role = `sys_mb_read_test_${suffix}`;
    const connect = database => new Client({ host: '/var/run/postgresql', database, user: 'postgres', connectionTimeoutMillis: 5000 });
    const root = connect('postgres');
    let client, createdDb = false, createdRole = false;
    try {
        await root.connect();
        await root.query(`CREATE DATABASE "${database}"`); createdDb = true;
        await root.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`); createdRole = true;
        client = connect(database); await client.connect();
        for (const table of TABLES) await client.query(`CREATE TABLE public."${table}" (id int PRIMARY KEY)`);
        await client.query(`GRANT SELECT ON public.organizations TO "${role}"`);
        const before = await plan(client, role);
        assert.equal(before.added.length, 3);
        const receipt = await apply(client, role, before, () => {});
        const noOp = await apply(client, role, await plan(client, role), () => {});
        assert.deepEqual(noOp.added, []);
        await client.query(`SET ROLE "${role}"`);
        for (const table of TABLES) assert.equal((await client.query(`SELECT count(*) FROM public."${table}"`)).rows[0].count, '0');
        await assert.rejects(client.query('INSERT INTO public.businesses VALUES (1)'), { code: '42501' });
        await client.query('RESET ROLE');
        assert.equal(await retire(client, role, receipt), 'RETIRED');
        assert.equal(await retire(client, role, receipt), 'ALREADY_RETIRED');
        await client.query(`SET ROLE "${role}"`);
        await assert.rejects(client.query('SELECT * FROM public.businesses'), { code: '42501' });
        await client.query('SELECT * FROM public.organizations');
        await client.query('RESET ROLE');
        const stale = await plan(client, role);
        await client.query(`GRANT SELECT ON public.businesses TO "${role}"`);
        await assert.rejects(apply(client, role, stale, () => {}), /GRANT_STATE_DRIFT/);
        await client.query(`REVOKE SELECT ON public.businesses FROM "${role}"`);
        const clean = await plan(client, role);
        let persistCalls = 0;
        await assert.rejects(apply(client, role, clean, () => { if (++persistCalls === 2) throw Error('DISK_FAILURE_AFTER_GRANT'); }), /DISK_FAILURE/);
        assert.equal((await plan(client, role)).fingerprint, clean.fingerprint);
    } finally {
        await client?.end().catch(() => {});
        if (createdDb) await root.query(`DROP DATABASE "${database}"`);
        if (createdRole) await root.query(`DROP ROLE "${role}"`);
        await root.end();
    }
});
