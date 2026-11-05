'use strict';
const { executionError } = require('./crmProviderExecution');

function plannedScheduleRows(document) {
    if (!document || document.documentType !== 'planned_schedule') {
        throw executionError('CRM_OCR_DOCUMENT_TYPE_INVALID', 422);
    }
    if (!Array.isArray(document.rows) || document.rows.length > 100) {
        throw executionError('CRM_OCR_ROWS_INVALID', 422);
    }
    return document.rows;
}

module.exports = { plannedScheduleRows };
