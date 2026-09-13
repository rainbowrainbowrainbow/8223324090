'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {joinedMemberships,sourcePolicy}=require('../scripts/sys-mb-recovery-review.cjs');
test('snapshot join excludes deactivated organizations and memberships and foreign businesses',()=>{
    const s={organizations:[{id:'1',status:'active'},{id:'2',status:'inactive'}],
        businesses:[{id:'11',organization_id:'1',status:'active',context_key:'event_genix'},{id:'22',organization_id:'2',status:'active'}],
        organization_memberships:[{organization_id:'1',user_id:7,is_active:true},{organization_id:'2',user_id:7,is_active:true}],
        business_memberships:[{organization_id:'1',business_id:'11',user_id:7,is_active:true,is_default:true},
            {organization_id:'2',business_id:'22',user_id:7,is_active:true},{organization_id:'1',business_id:'11',user_id:8,is_active:true}]};
    assert.equal(joinedMemberships(s,7).length,1);
    s.business_memberships[0].is_active=false;
    assert.equal(joinedMemberships(s,7).length,0);
});
test('exact deployed auth payload preserves the non-switch-role restriction despite assigned contexts',()=>{
    const p=sourcePolicy('4214598e263057b1cb1524d7fb84f328031d288d');
    const u=p.payload({id:1,role:'senior_manager',business_contexts:['event_genix','dar','maysternya_doli','crm'],default_business_context:'event_genix'});
    assert.deepEqual(u.businessContexts,['event_genix']);
    assert.equal(p.context.canAccessBusinessContext(u,'crm'),false);
    const director=p.capabilities.buildCapabilitySnapshot({role:'director'});
    const creator=p.capabilities.buildCapabilitySnapshot({role:'creator'});
    assert.equal(director.pages['/maysternya-doli'],false);
    assert.equal(creator.pages['/maysternya-doli'],true);
    assert.equal(Object.keys(p.hashes).length,5);
});
