'use strict';
// Compatibility entrypoint: no implicit latest-proof selection or hardware deferral.
// Release acceptance must separately assess HR/protected UX/physical-device blockers.
process.exitCode = require('./verify-education-close-pack').main();
