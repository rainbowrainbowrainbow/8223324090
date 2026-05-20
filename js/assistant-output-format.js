/**
 * Safe, limited assistant output formatter.
 *
 * Contract:
 * - escape raw text first;
 * - support only controlled bold emphasis from **text**;
 * - render lists only in readable/history mode;
 * - never pass model text through as raw HTML.
 */
(function (root) {
    'use strict';

    function normalizeText(value) {
        return String(value ?? '').replace(/\r\n?/g, '\n');
    }

    function escapeHtml(value) {
        return normalizeText(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function applyInlineFormattingToEscaped(escaped) {
        return String(escaped || '').replace(/\*\*([^\n]+?)\*\*/g, (match, content) => {
            const label = String(content || '').trim();
            if (!label) return match;
            return `<strong class="assistant-output-strong">${label}</strong>`;
        });
    }

    function stripMarkdownMarkers(value) {
        return normalizeText(value)
            .replace(/\*\*([^\n]+?)\*\*/g, '$1')
            .replace(/^\s*(?:[-*\u2022]\s+|\d+[.)]\s+)/gm, '')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function compactInlineSource(value) {
        return stripMarkdownMarkers(value)
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .join(' \u00b7 ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatInline(value) {
        const source = normalizeText(value)
            .split('\n')
            .map(line => line.trim().replace(/^\s*(?:[-*\u2022]\s+|\d+[.)]\s+)/, ''))
            .filter(Boolean)
            .join(' \u00b7 ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!source) return '';
        return applyInlineFormattingToEscaped(escapeHtml(source));
    }

    function formatInlineLine(value) {
        return applyInlineFormattingToEscaped(escapeHtml(value).trim());
    }

    function listTypeForLine(line) {
        if (/^\s*(?:[-*\u2022])\s+/.test(line)) return 'ul';
        if (/^\s*\d+[.)]\s+/.test(line)) return 'ol';
        return '';
    }

    function listItemText(line) {
        return line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, '').trim();
    }

    function formatParagraph(lines) {
        const html = lines.map(formatInlineLine).filter(Boolean).join('<br>');
        return html ? `<p class="assistant-output-paragraph">${html}</p>` : '';
    }

    function formatList(type, items) {
        const safeType = type === 'ol' ? 'ol' : 'ul';
        const html = items.map(item => `<li>${formatInlineLine(item)}</li>`).join('');
        return html ? `<${safeType} class="assistant-output-list">${html}</${safeType}>` : '';
    }

    function formatReadable(value) {
        const lines = normalizeText(value).split('\n');
        const blocks = [];
        let paragraph = [];
        let listType = '';
        let listItems = [];

        function flushParagraph() {
            if (!paragraph.length) return;
            const block = formatParagraph(paragraph);
            if (block) blocks.push(block);
            paragraph = [];
        }

        function flushList() {
            if (!listItems.length) return;
            const block = formatList(listType, listItems);
            if (block) blocks.push(block);
            listType = '';
            listItems = [];
        }

        lines.forEach(rawLine => {
            const line = String(rawLine || '').trim();
            if (!line) {
                flushParagraph();
                flushList();
                return;
            }

            const detectedListType = listTypeForLine(line);
            if (detectedListType) {
                flushParagraph();
                if (listType && listType !== detectedListType) flushList();
                listType = detectedListType;
                listItems.push(listItemText(line));
                return;
            }

            flushList();
            paragraph.push(line);
        });

        flushParagraph();
        flushList();

        if (!blocks.length) return '';
        return `<div class="assistant-output-readable">${blocks.join('')}</div>`;
    }

    const api = {
        escapeHtml,
        formatInline,
        formatReadable,
        toDisplayText: compactInlineSource,
        stripMarkdownMarkers
    };

    root.CrmAssistantOutputFormat = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
