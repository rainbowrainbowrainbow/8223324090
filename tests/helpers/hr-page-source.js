'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Existing semantic/component tests inspect private workspace functions directly.
// Bundle the ACTUAL moved bodies eagerly in those harnesses; lazy download,
// initialization and failure behavior have their own production-source tests.
module.exports = function hrPageSemanticSource() {
    const root = path.resolve(__dirname, '../..');
    const core = fs.readFileSync(path.join(root, 'js/hr-page.js'), 'utf8').replace(/\r\n/g, '\n')
        .replace(/\/\/ HR_STRUCTURE_LOADER_START[\s\S]*?\/\/ HR_STRUCTURE_LOADER_END/, '');
    const chunk = fs.readFileSync(path.join(root, 'js/hr-structure-page.js'), 'utf8').replace(/\r\n/g, '\n');
    const body = chunk.split('// HR_STRUCTURE_IMPLEMENTATION_START')[1]
        .split('// HR_STRUCTURE_IMPLEMENTATION_END')[0];
    const events = chunk.slice(chunk.indexOf('for (const eventName of'), chunk.indexOf('\n        },\n        loadCompanyStructure'));
    return core + '\n' + body + '\n' + events;
};
