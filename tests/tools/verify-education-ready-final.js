'use strict';
// Historical count/latest-file heuristics cannot certify current code.
// Explicit v2 matrix selects exact attempts; this validates software only, never release GO.
process.exitCode = require('./verify-education-close-pack').main();
