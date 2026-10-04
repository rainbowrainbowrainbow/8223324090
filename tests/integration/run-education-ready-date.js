'use strict';
process.env.EDU_READY_STAGE = '08B';
process.env.EDU_READY_SUITE ||= 'date';
require('./run-education-ready-design');
