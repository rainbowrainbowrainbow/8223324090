const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

function createUiCheckContext({ root }) {
    let passed = 0;
    let failed = 0;

    function check(label, condition) {
        if (condition) {
            passed += 1;
        } else {
            failed += 1;
            console.log(`  ❌ ${label}`);
        }
    }

    function fileText(filename) {
        return fs.readFileSync(path.join(root, filename), 'utf8');
    }

    function cssTextWithImports(filename, seen = new Set()) {
        const normalized = filename.replace(/\\/g, '/');
        if (seen.has(normalized)) return '';
        seen.add(normalized);

        const css = fileText(normalized);
        const dir = path.posix.dirname(normalized);
        const imports = [];
        const importPattern = /@import\s+(?:url\()?["']?([^"')]+\.css(?:\?[^"')]+)?)["']?\)?\s*;?/g;
        let match;

        while ((match = importPattern.exec(css)) !== null) {
            const rawRef = match[1].split('?')[0].replace(/^\/+/, '');
            const imported = rawRef.startsWith('css/')
                ? rawRef
                : path.posix.normalize(path.posix.join(dir, rawRef));
            imports.push(cssTextWithImports(imported, seen));
        }

        return [css, ...imports].filter(Boolean).join('\n');
    }

    function cssRuleText(css, selector) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
        return match ? match[1] : '';
    }

    function cssRuleIncludingSelectorText(css, selector) {
        const normalizedSelector = String(selector || '').trim().replace(/\s+/g, ' ');
        let rule = '';
        for (const match of css.matchAll(/([^{}]+)\{([\s\S]*?)\}/g)) {
            const selectors = match[1].split(',').map(item => item.trim().replace(/\s+/g, ' '));
            if (selectors.includes(normalizedSelector)) rule = match[2];
        }
        return rule;
    }

    function cssAtRuleBlock(css, atRulePrefix) {
        const start = css.indexOf(atRulePrefix);
        if (start === -1) return '';
        const open = css.indexOf('{', start);
        if (open === -1) return '';
        let depth = 0;
        for (let i = open; i < css.length; i += 1) {
            if (css[i] === '{') depth += 1;
            if (css[i] === '}') depth -= 1;
            if (depth === 0) return css.slice(open + 1, i);
        }
        return '';
    }

    function hrSurfaceText() {
        return `${fileText('hr.html')}\n${fileText('css/hr-page.css')}`;
    }

    function htmlContains(filename, text) {
        if (filename === 'hr.html') return hrSurfaceText().includes(text);
        return fileText(filename).includes(text);
    }

    function checkPage(filename, checks) {
        const filepath = path.join(root, filename);
        if (!fs.existsSync(filepath)) {
            console.log(`⚠️  ${filename} not found`);
            return;
        }
        const html = fs.readFileSync(filepath, 'utf8');
        const dom = new JSDOM(html, { url: `http://localhost:3000/${filename.replace('.html', '')}`, runScripts: 'outside-only' });
        const doc = dom.window.document;
        console.log(`\n📄 ${filename}`);
        checks(doc, html);
        dom.window.close();
    }

    function checkJSFile(filename) {
        const filepath = path.join(root, filename);
        if (!fs.existsSync(filepath)) {
            console.log(`⚠️  ${filename} not found`);
            return '';
        }
        const code = fs.readFileSync(filepath, 'utf8');
        console.log(`\n📜 ${filename}`);

        try {
            new Function(code);
            check('Syntax valid', true);
        } catch (e) {
            check(`Syntax valid (${e.message})`, false);
        }

        const badAssignments = code.match(/\?\.\w+\s*=[^=]/g);
        check('No ?.prop = assignments', !badAssignments || badAssignments.length === 0);
        check('No <script> in JS', !code.includes('<script>'));

        return code;
    }

    function getHtmlScripts(html) {
        return [...html.matchAll(/<script\s+src=["']([^"']+)["']/g)]
            .map(match => match[1].split('?')[0]);
    }

    function scriptIndex(scripts, expected) {
        return scripts.findIndex(src => src === expected || src.endsWith(`/${expected}`));
    }

    function htmlScriptLoadsBefore(htmlFile, dependency, consumer) {
        const scripts = getHtmlScripts(fileText(htmlFile));
        const dependencyIndex = scriptIndex(scripts, dependency);
        const consumerIndex = scriptIndex(scripts, consumer);
        return dependencyIndex >= 0 && consumerIndex >= 0 && dependencyIndex < consumerIndex;
    }

    function getInlineScripts(html) {
        return [...html.matchAll(/<script(?!\s+src)[^>]*>([\s\S]*?)<\/script>/g)]
            .map(match => match[1]);
    }

    function walkFiles(dir, matcher) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries.flatMap(entry => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return walkFiles(full, matcher);
            return matcher(full) ? [full] : [];
        });
    }

    function sourceBlock(source, startToken, endToken) {
        const start = source.indexOf(startToken);
        if (start < 0) return '';
        const end = source.indexOf(endToken, start + startToken.length);
        return end > start ? source.slice(start, end) : source.slice(start);
    }

    return {
        JSDOM,
        ROOT: root,
        check,
        fileText,
        cssTextWithImports,
        cssRuleText,
        cssRuleIncludingSelectorText,
        cssAtRuleBlock,
        hrSurfaceText,
        htmlContains,
        checkPage,
        checkJSFile,
        getHtmlScripts,
        scriptIndex,
        htmlScriptLoadsBefore,
        getInlineScripts,
        walkFiles,
        sourceBlock,
        results: () => ({ passed, failed })
    };
}

module.exports = {
    createUiCheckContext
};
