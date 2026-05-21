const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

test('dashboard board has direct manipulation, pan, and geometry endpoint contracts', () => {
    const pageJs = read('js/dashboard-page.js');
    const css = read('css/dashboard.css');

    assert.match(pageJs, /function canStartDirectBoardDrag/);
    assert.match(pageJs, /function isBoardDragBlockedTarget/);
    assert.match(pageJs, /function beginBoardPan/);
    assert.match(pageJs, /function shouldStartBoardPan/);
    assert.match(pageJs, /data-board-line-endpoint="start"/);
    assert.match(pageJs, /function beginBoardLineEndpointDrag/);
    assert.match(pageJs, /function beginBoardConnectorEndpointDrag/);
    assert.match(pageJs, /function findNearestBoardAnchor/);
    assert.match(pageJs, /if \(item\.type === 'widget' \|\| item\.type === 'note' \|\| item\.type === 'text'\) return false/);
    assert.match(css, /\.dashboard-board-shell\.is-panning/);
    assert.match(css, /\.dashboard-board-item\.thin-geometry/);
    assert.match(css, /\.board-line-endpoint/);
    assert.match(css, /\.board-connector-endpoint/);
    assert.match(css, /box-shadow: 0 0 0 1px var\(--workspace-selection-ring/);
});
