#!/usr/bin/env node
'use strict';
// Run the real page scripts and controls; mutations are intercepted by the fixture.
process.env.OMNI_LAYOUT_ONLY = '1';
require('./omni-completion.fixture.cjs');
