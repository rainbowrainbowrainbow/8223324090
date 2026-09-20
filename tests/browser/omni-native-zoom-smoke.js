#!/usr/bin/env node
'use strict';

// Uses chrome.tabs.setZoom in a disposable Chromium profile. This is native
// tab zoom, not CSS scale, deviceScaleFactor, pinch emulation, or viewport-only QA.
process.env.OMNI_LAYOUT_ONLY = '1';
process.env.OMNI_NATIVE_ZOOM = '1';
require('./omni-completion.fixture.cjs');
