#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const imagesDir = path.join(root, 'images', 'kitchen-menu');
const manifestPath = path.join(root, 'js', 'kitchen-menu-images.js');
const menuMigrationPath = path.join(root, 'db', 'migrations', '220_kitchen_menu_2026_catalog.sql');
const cakesMigrationPath = path.join(root, 'db', 'migrations', '201_kitchen_cakes_catalog.sql');
const allowedExt = new Set(['.webp', '.png', '.jpg', '.jpeg', '.avif']);

function slug(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9а-яіїєґ]+/giu, '-')
        .replace(/^-+|-+$/g, '');
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function readText(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function unescapeSql(value) {
    return String(value || '').replace(/''/g, "'");
}

function parseProducts() {
    const products = [];
    const menuText = readText(menuMigrationPath);
    const menuRegex = /\('(menu_2026[^']*)',\s*'([^']+)',\s*'((?:''|[^'])*)',\s*'((?:''|[^'])*)'/g;
    let match;
    while ((match = menuRegex.exec(menuText))) {
        products.push({
            id: match[1],
            code: match[2],
            name: unescapeSql(match[3]),
            section: unescapeSql(match[4])
        });
    }

    const cakesText = readText(cakesMigrationPath);
    const cakesRegex = /\('(cake_[^']+)',\s*'([^']+)',\s*'((?:''|[^'])*)',/g;
    while ((match = cakesRegex.exec(cakesText))) {
        products.push({
            id: match[1],
            code: match[2],
            name: unescapeSql(match[3]),
            section: 'Торти'
        });
    }
    return products;
}

function listImageFiles() {
    if (!fs.existsSync(imagesDir)) return [];
    const files = [];
    function walk(dir, prefix = '') {
        fs.readdirSync(dir, { withFileTypes: true })
            .forEach(entry => {
                const fullPath = path.join(dir, entry.name);
                const relative = prefix ? path.posix.join(prefix, entry.name) : entry.name;
                if (entry.isDirectory()) {
                    walk(fullPath, relative);
                    return;
                }
                if (entry.isFile() && allowedExt.has(path.extname(entry.name).toLowerCase())) {
                    files.push(relative);
                }
            });
    }
    walk(imagesDir);
    return files.sort((a, b) => a.localeCompare(b, 'uk'));
}

function productAliases(product) {
    const name = slug(product.name);
    const aliases = [
        slug(product.code),
        slug(product.id),
        name,
        name.replace(/^піца-/, ''),
        name.replace(/^салат-/, '')
    ];
    if (name.startsWith('сік-')) aliases.push('сік');
    if (name.startsWith('кока-кола-')) aliases.push(name.replace(/^кока-кола-/, 'кола-'));
    if (name.includes('ребра') && name.includes('барбекю')) aliases.push('ребра-bbq', 'ребра-барбекю');
    return unique(aliases);
}

function imageFileAliases(fileName) {
    const base = slug(path.basename(fileName, path.extname(fileName)));
    return unique([
        base,
        base.replace(/^\d+-/, ''),
        base.replace(/^menu-\d+-/, ''),
        base.replace(/^cake-\d+-/, '')
    ]);
}

function matchProductForFile(fileName, products) {
    const fileAliases = imageFileAliases(fileName);
    return products.find(product => {
        const aliases = productAliases(product);
        return aliases.some(alias => fileAliases.some(fileAlias => fileAlias === alias || fileAlias.startsWith(`${alias}-`)));
    });
}

function buildManifest(products, files) {
    const byCode = {};
    const byId = {};
    const unmatched = [];

    files.forEach(fileName => {
        const product = matchProductForFile(fileName, products);
        if (!product) {
            unmatched.push(fileName);
            return;
        }
        const value = fileName.replace(/\\/g, '/');
        byCode[product.code] = value;
        byId[product.id] = value;
    });

    return { byId, byCode, unmatched };
}

function objectLiteral(obj, indent = 8) {
    const entries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b, 'uk'));
    if (!entries.length) return '';
    const pad = ' '.repeat(indent);
    return entries
        .map(([key, value]) => `${pad}${JSON.stringify(key)}: ${JSON.stringify(value)}`)
        .join(',\n');
}

function renderManifest(manifest) {
    const byId = objectLiteral(manifest.byId);
    const byCode = objectLiteral(manifest.byCode);
    return `window.KITCHEN_MENU_IMAGES = Object.freeze({\n`
        + `    basePath: '/images/kitchen-menu/',\n`
        + `    byId: Object.freeze({\n${byId}${byId ? '\n' : ''}    }),\n`
        + `    byCode: Object.freeze({\n${byCode}${byCode ? '\n' : ''}    }),\n`
        + `    byName: Object.freeze({\n`
        + `    })\n`
        + `});\n`;
}

function main() {
    const products = parseProducts();
    const files = listImageFiles();
    const manifest = buildManifest(products, files);
    fs.writeFileSync(manifestPath, renderManifest(manifest), 'utf8');

    console.log(`Kitchen menu images: ${Object.keys(manifest.byCode).length} matched, ${manifest.unmatched.length} unmatched.`);
    if (manifest.unmatched.length) {
        console.log('Unmatched files:');
        manifest.unmatched.forEach(file => console.log(`- ${file}`));
    }
}

main();
