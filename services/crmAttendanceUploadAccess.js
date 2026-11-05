'use strict';
const { executionError } = require('./crmProviderExecution');

// A link delegates upload only. Never turn its bearer into an HTTP/JWT user or
// accept actor/role/context fields from the worker. Refresh the reviewer through
// the same membership, capability, module and ownership guards as the HR API.
async function resolveUploadReviewer(link, pool) {
    try {
        const { loadAuthenticatedUserAccess, canUseAction } = require('../middleware/auth');
        const { loadMembershipAccess, applyMembershipAccess } = require('./businessMembership');
        const { resolveBusinessScope, requireBusinessScope } = require('./businessContext');
        const { requireRequestBusinessModule } = require('./businessModuleRegistry');
        const user = await loadAuthenticatedUserAccess({ id:link.reviewer_user_id,
            sessionIssuedAt:new Date(link.created_at).valueOf(),
            sessionRevocationCutoff:Number(link.session_revocation_cutoff)
        }, { db:pool, requireFresh:true });
        const actor = applyMembershipAccess(user, await loadMembershipAccess(pool,user,'event_genix'));
        if (!canUseAction(actor,'hr.schedule.manage')) throw Error('Denied');
        const req = { user:actor, method:'POST', path:'/attendance/ocr/preview',
            originalUrl:'/api/hr/attendance/ocr/preview', baseUrl:'/api/hr',
            headers:{'x-business-context':'event_genix'}, body:{}, query:{} };
        const res = { status(){return this;}, json(){throw Error('Denied');}, set(){return this;} };
        const scope = resolveBusinessScope(req);
        if (scope.activeContext !== 'event_genix' || scope.canWrite === false
            || !requireBusinessScope(req,res,scope) || !requireRequestBusinessModule(req,res,scope)) throw Error('Denied');
        let allowed=false;
        await require('./parkHrPayrollAccess').requireParkHrPayrollAccess('hr',
            require('./legacyBusinessSurface').requireLegacyBusinessSurface('staff', {parkScheduleRouter:'hr'}),pool
        )(req,res,()=>{allowed=true;});
        if (!allowed) throw Error('Denied');
        return { actor, businessContext:'event_genix' };
    } catch {
        throw executionError('CRM_UPLOAD_LINK_UNAVAILABLE',403);
    }
}
module.exports={resolveUploadReviewer};
