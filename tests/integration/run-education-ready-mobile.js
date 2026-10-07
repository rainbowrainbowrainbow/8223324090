'use strict';
// Reuse the exact owned disposable DB lock/reset/outbound/manual-retention guard.
process.env.EDU_READY_STAGE = '07';
process.env.EDU_READY_SUITE ||= 'mobile';
process.env.EDU_MOBILE_PHASE ||= 'after';
require('./run-education-ready-design');
