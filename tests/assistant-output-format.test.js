const test = require('node:test');
const assert = require('node:assert/strict');

const formatter = require('../js/assistant-output-format.js');

test('assistant formatter renders inline bold without raw markdown markers', () => {
    const html = formatter.formatInline('Головне: **перевірити задачі** сьогодні');

    assert.match(html, /<strong class="assistant-output-strong">перевірити задачі<\/strong>/);
    assert.doesNotMatch(html, /\*\*/);
});

test('assistant formatter escapes html-like input before formatting', () => {
    const html = formatter.formatInline('Не виконувати <img src=x onerror=alert(1)> **безпечно**');

    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /<strong class="assistant-output-strong">безпечно<\/strong>/);
    assert.doesNotMatch(html, /<img/i);
});

test('assistant formatter renders readable paragraphs and lists safely', () => {
    const html = formatter.formatReadable([
        'Перший абзац з **акцентом**.',
        '',
        '- один',
        '- два <script>alert(1)</script>',
        '',
        '1. перший крок',
        '2. другий крок'
    ].join('\n'));

    assert.match(html, /assistant-output-readable/);
    assert.match(html, /<p class="assistant-output-paragraph">/);
    assert.match(html, /<ul class="assistant-output-list">/);
    assert.match(html, /<ol class="assistant-output-list">/);
    assert.match(html, /<strong class="assistant-output-strong">акцентом<\/strong>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script/i);
});

test('assistant formatter keeps ticker mode inline-only', () => {
    const html = formatter.formatInline('- **ризик**\n- наступна дія');
    const displayText = formatter.toDisplayText('- **ризик**\n- наступна дія');

    assert.doesNotMatch(html, /<(ul|ol|li)\b/i);
    assert.match(html, /<strong class="assistant-output-strong">ризик<\/strong>/);
    assert.equal(displayText, 'ризик · наступна дія');
});
