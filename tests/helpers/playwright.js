'use strict';
const fs = require('node:fs');
const path = require('node:path');
module.exports = function requirePlaywright() {
    try { return require('playwright'); }
    catch (error) {
        for (const entry of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
            const normalized = entry.replace(/[\\/]+$/, '');
            if (!/node_modules[\\/]?\.bin$/i.test(normalized)) continue;
            const packageDir = path.join(path.dirname(normalized), 'playwright');
            if (fs.existsSync(packageDir)) return require(packageDir);
        }
        throw error;
    }
};
