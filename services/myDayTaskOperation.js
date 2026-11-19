'use strict';

function parseMyDayTaskOperation(body, actor, kind) {
    if (body?.myDayOperationId === undefined) return null;
    const id = body.myDayOperationId;
    const version = Number(body.version);
    const actorId = Number(actor?.id);
    if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)
        || !Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(actorId) || actorId < 1) {
        throw Object.assign(new Error('Некоректний ідентифікатор або версія операції.'), { statusCode: 400, code: 'MY_DAY_OPERATION_INVALID' });
    }
    return { id, version, actorId, kind };
}

function isMyDayTaskOperationApplied(task, operation) {
    if (!operation) return false;
    const receipt = task?.control_meta?.myDayOperation;
    return receipt?.id === operation.id && receipt.actorId === operation.actorId
        && receipt.kind === operation.kind && receipt.version === operation.version;
}

function assertMyDayTaskOperationVersion(task, operation) {
    if (operation && Number(task.version || 1) !== operation.version) {
        throw Object.assign(new Error('Задачу було змінено іншим користувачем.'), { statusCode: 409, code: 'MY_DAY_OPERATION_STALE' });
    }
}

module.exports = { parseMyDayTaskOperation, isMyDayTaskOperationApplied, assertMyDayTaskOperationVersion };
