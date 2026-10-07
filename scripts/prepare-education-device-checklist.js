'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {template,PRODUCT_FILES}=require('./lib/education-device-acceptance');
const root=path.resolve('output/education-ready/08C');const manifest=JSON.parse(fs.readFileSync(path.join(root,'device-manifest.json'),'utf8'));
const file=path.join(root,'operator-results.json');if(fs.existsSync(file))throw new Error('Existing operator evidence will not be overwritten');
const sourceHashes=Object.fromEntries(PRODUCT_FILES.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
fs.mkdirSync(path.join(root,'evidence'),{recursive:true});fs.writeFileSync(file,JSON.stringify(template({anchorDate:manifest.anchorDate,sourceHashes}),null,2));console.log('Physical evidence template created with42 BLOCKED_DEVICE results; no PASS fabricated.');
