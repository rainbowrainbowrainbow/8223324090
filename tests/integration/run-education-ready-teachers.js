'use strict';
process.env.EDU_READY_STAGE = '08A';
process.env.EDU_READY_SUITE ||= 'teachers';
require('./run-education-ready-design');
