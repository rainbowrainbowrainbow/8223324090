'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createTelegramCrmIdentity, equalHash, publicBinding, secretHash, telegramId, transaction } = require('../services/telegramCrmIdentity');
const { PILOT, applyPilot } = require('../scripts/telegram-crm-pilot');

test('bot switch is compare-and-set and never rewrites human bindings', async () => {
    const writes=[];
    let current='SecondBrainEvent_bot';
    const client={query:async(sql,args)=>{
        if(sql.startsWith('SELECT id,username,name,is_active')) return {rows:PILOT};
        if(sql.startsWith('UPDATE')) {
            writes.push(sql);
            if(args[1]!==current) return {rowCount:0,rows:[]};
            current=args[0]; return {rowCount:1,rows:[{bot_username:current}]};
        }
        return {rows:sql.includes('telegram_crm_settings')?[{mode:'write',bot_username:current}]:[]};
    }};
    const result=await applyPilot(client,{action:'switch-bot',expectedBot:current,botUsername:'d1wdd_bot'});
    assert.equal(result.configuration.bot_username,'d1wdd_bot');
    assert.equal(writes.length,1);
    assert.ok(writes[0].startsWith('UPDATE telegram_crm_settings SET bot_username='));
    await assert.rejects(applyPilot(client,{action:'switch-bot',expectedBot:'SecondBrainEvent_bot',botUsername:'d1wdd_bot'}),/drift/);
    await assert.rejects(applyPilot(client,{action:'switch-bot',expectedBot:'d1wdd_bot',botUsername:'unknown_bot'}),/reviewed/);
});

test('profile returns validated current bot without changing the human binding', async () => {
    for (const botUsername of ['d1wdd_bot', 'SecondBrainEvent_bot', 'evil.example/x', null]) {
        const queries=[];
        const identity=createTelegramCrmIdentity({pool:{query:async(sql)=>{
            queries.push(sql);
            return {rows:sql.includes('telegram_crm_settings')
                ? [{mode:'write',bot_username:botUsername}]
                : [{telegram_user_id:'674972415',verified_at:'2026-11-14',version:'2',pilot_enabled:true}]};
        }}});
        const result=await identity.status({id:4});
        assert.equal(result.botUsername, /^[A-Za-z0-9_]{5,32}$/.test(botUsername||'') ? botUsername : null);
        assert.equal(result.status,'connected');
        assert.equal(result.version,'2');
        assert.ok(queries.every(sql=>sql.startsWith('SELECT')));
    }
});

test('Telegram IDs do not accept coercion, SQL input, truncated or unsafe numbers', () => {
    assert.equal(telegramId(674972415), '674972415');
    assert.equal(telegramId('4503599627370495'), '4503599627370495');
    for (const bad of ['', null, 0, -1, '01', '1e5', '1.9', '12x', ' 12', '1 OR 1=1', '4503599627370496']) {
        assert.throws(() => telegramId(bad), { code: 'TELEGRAM_ID_INVALID' });
    }
});

test('browser proofs and link tokens are bounded and compared safely', () => {
    const digest = secretHash('a'.repeat(43));
    assert.equal(equalHash(digest, digest), true);
    assert.equal(equalHash(digest, secretHash('b'.repeat(43))), false);
    assert.equal(equalHash(digest, 'short'), false);
    for (const bad of [null, {}, '', 'a'.repeat(42), ' '.repeat(43)]) assert.throws(() => secretHash(bad));
});

test('preassigned identities never appear connected and internal fields are omitted', () => {
    const result = publicBinding({ proposed_telegram_id: '674972415', pilot_enabled: true, version: '4', password_hash: 'secret' });
    assert.equal(result.status, 'preassigned');
    assert.equal(result.telegramId, null);
    assert.equal(result.version, '4');
    assert.equal('password_hash' in result, false);
});

test('a unique identity conflict rolls back and releases the client with a safe error', async () => {
    const calls = [];
    const client = { query: async sql => calls.push(sql), release: () => calls.push('release') };
    await assert.rejects(transaction({ connect: async () => client }, async () => {
        throw Object.assign(new Error('sensitive raw constraint'), { code: '23505', constraint: 'telegram_crm_bindings_telegram_user_id_key' });
    }), { code: 'TELEGRAM_ALREADY_LINKED', statusCode: 409 });
    assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'release']);
    assert.equal(calls.includes('COMMIT'), false);
});

test('unrelated uniqueness errors are not mislabeled as identity conflicts', async () => {
    const client = { query: async()=>{}, release:()=>{} };
    await assert.rejects(transaction({connect:async()=>client},async()=>{
        throw Object.assign(new Error('other'),{code:'23505',constraint:'tasks_unique'});
    }), {code:'23505',constraint:'tasks_unique'});
});
