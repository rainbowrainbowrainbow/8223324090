/**
 * minigame-match3.js — Match-3 minigame with Special Pieces (Park themed)
 * v22.7.0
 */

// ==========================================
// CONSTANTS
// ==========================================
const BOARD_SIZE = 8;
const GAME_TIME = 60;
const MAX_COINS = 50;
const PIECES = [
    { id: 'dino',    emoji: '🦕' },
    { id: 'balloon', emoji: '🎈' },
    { id: 'cake',    emoji: '🎂' },
    { id: 'mask',    emoji: '🎭' },
    { id: 'star',    emoji: '⭐' },
    { id: 'tent',    emoji: '🎪' },
];

const SPECIAL_TYPES = {
    bomb:      { emoji: '💣', bonus: 20, label: 'Бомба' },
    lightning: { emoji: '⚡', bonus: 40, label: 'Блискавка' },
    rainbow:   { emoji: '🌟', bonus: 60, label: 'Зірка' }
};

// ==========================================
// STATE
// ==========================================
let board = [];
let selected = null;
let gameActive = false;
let timeLeft = GAME_TIME;
let totalScore = 0;
let coinsEarned = 0;
let comboCount = 0;
let timerInterval = null;
let animating = false;
let gameStatus = null;
let lastSwap = null; // { row, col } — where the player swapped to

// ==========================================
// UTILITIES
// ==========================================
function randomPiece() {
    return { ...PIECES[Math.floor(Math.random() * PIECES.length)], special: null };
}

function hasMatchAt(b, row, col, piece) {
    if (col >= 2 && b[row][col - 1]?.id === piece.id && b[row][col - 2]?.id === piece.id) return true;
    if (row >= 2 && b[row - 1]?.[col]?.id === piece.id && b[row - 2]?.[col]?.id === piece.id) return true;
    return false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ==========================================
// BOARD LOGIC
// ==========================================
function createBoard() {
    const b = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        b[r] = [];
        for (let c = 0; c < BOARD_SIZE; c++) {
            let piece;
            let attempts = 0;
            do {
                piece = randomPiece();
                attempts++;
            } while (hasMatchAt(b, r, c, piece) && attempts < 50);
            b[r][c] = piece;
        }
    }
    return b;
}

/**
 * Find all matches on the board, returned as groups.
 * Each group: { cells: [{row, col}], length, direction: 'h'|'v' }
 */
function findMatchGroups(b) {
    const groups = [];

    // Horizontal matches
    for (let r = 0; r < BOARD_SIZE; r++) {
        let c = 0;
        while (c <= BOARD_SIZE - 3) {
            if (b[r][c] && b[r][c].id) {
                const id = b[r][c].id;
                let end = c;
                while (end + 1 < BOARD_SIZE && b[r][end + 1]?.id === id) end++;
                const len = end - c + 1;
                if (len >= 3) {
                    const cells = [];
                    for (let i = c; i <= end; i++) cells.push({ row: r, col: i });
                    groups.push({ cells, length: len, direction: 'h' });
                }
                c = end + 1;
            } else {
                c++;
            }
        }
    }

    // Vertical matches
    for (let c = 0; c < BOARD_SIZE; c++) {
        let r = 0;
        while (r <= BOARD_SIZE - 3) {
            if (b[r][c] && b[r][c].id) {
                const id = b[r][c].id;
                let end = r;
                while (end + 1 < BOARD_SIZE && b[end + 1]?.[c]?.id === id) end++;
                const len = end - r + 1;
                if (len >= 3) {
                    const cells = [];
                    for (let i = r; i <= end; i++) cells.push({ row: i, col: c });
                    groups.push({ cells, length: len, direction: 'v' });
                }
                r = end + 1;
            } else {
                r++;
            }
        }
    }

    return groups;
}

/**
 * Detect L/T shapes: two groups (one horizontal, one vertical) sharing a cell.
 * Returns array of { cells (merged unique), intersectionCell }
 */
function detectLTShapes(groups) {
    const ltShapes = [];
    const usedGroups = new Set();

    for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
            if (groups[i].direction === groups[j].direction) continue;
            // Find shared cells
            const setA = new Set(groups[i].cells.map(c => `${c.row},${c.col}`));
            let intersection = null;
            for (const cell of groups[j].cells) {
                if (setA.has(`${cell.row},${cell.col}`)) {
                    intersection = cell;
                    break;
                }
            }
            if (intersection) {
                const allCellKeys = new Set();
                const allCells = [];
                for (const c of [...groups[i].cells, ...groups[j].cells]) {
                    const key = `${c.row},${c.col}`;
                    if (!allCellKeys.has(key)) {
                        allCellKeys.add(key);
                        allCells.push(c);
                    }
                }
                ltShapes.push({ cells: allCells, intersectionCell: intersection, groupI: i, groupJ: j });
                usedGroups.add(i);
                usedGroups.add(j);
            }
        }
    }

    return { ltShapes, usedGroups };
}

/**
 * Determine what special pieces to create from match groups.
 * Returns array of { row, col, type: 'bomb'|'lightning'|'rainbow', id (piece type) }
 */
function determineSpecials(groups, swapTarget) {
    const specials = [];
    const { ltShapes, usedGroups } = detectLTShapes(groups);

    // L/T shapes → rainbow star at intersection
    for (const lt of ltShapes) {
        const pos = lt.intersectionCell;
        specials.push({
            row: pos.row, col: pos.col,
            type: 'rainbow',
            id: board[pos.row][pos.col]?.id || 'star'
        });
    }

    // Remaining groups (not part of L/T)
    for (let i = 0; i < groups.length; i++) {
        if (usedGroups.has(i)) continue;
        const g = groups[i];
        if (g.length >= 5) {
            // Lightning
            const pos = pickSpecialPosition(g.cells, swapTarget);
            specials.push({ row: pos.row, col: pos.col, type: 'lightning', id: board[pos.row][pos.col]?.id || 'star' });
        } else if (g.length === 4) {
            // Bomb
            const pos = pickSpecialPosition(g.cells, swapTarget);
            specials.push({ row: pos.row, col: pos.col, type: 'bomb', id: board[pos.row][pos.col]?.id || 'star' });
        }
    }

    return specials;
}

/**
 * Pick position for special piece — prefer swap target if it's in the match, else lowest cell.
 */
function pickSpecialPosition(cells, swapTarget) {
    if (swapTarget) {
        for (const c of cells) {
            if (c.row === swapTarget.row && c.col === swapTarget.col) return c;
        }
    }
    // Fallback: lowest cell (highest row index)
    let best = cells[0];
    for (const c of cells) {
        if (c.row > best.row) best = c;
    }
    return best;
}

/**
 * Activate special pieces that are in the matched set.
 * Returns expanded set of cells to remove + bonus score.
 */
function activateSpecials(b, matchedCells) {
    const toRemove = new Set(matchedCells.map(c => `${c.row},${c.col}`));
    let bonusScore = 0;
    const activatedSpecials = []; // for animation tracking
    let iterations = 0;

    let changed = true;
    while (changed && iterations < 10) {
        changed = false;
        iterations++;
        for (const key of [...toRemove]) {
            const [r, c] = key.split(',').map(Number);
            const piece = b[r]?.[c];
            if (!piece || !piece.special) continue;

            const specialType = piece.special;
            piece.special = null; // consume it
            bonusScore += SPECIAL_TYPES[specialType]?.bonus || 0;
            activatedSpecials.push({ row: r, col: c, type: specialType });

            if (specialType === 'bomb') {
                // 3x3 area
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
                            const k = `${nr},${nc}`;
                            if (!toRemove.has(k)) { toRemove.add(k); changed = true; }
                        }
                    }
                }
            } else if (specialType === 'lightning') {
                // Entire row
                for (let col = 0; col < BOARD_SIZE; col++) {
                    const k = `${r},${col}`;
                    if (!toRemove.has(k)) { toRemove.add(k); changed = true; }
                }
            } else if (specialType === 'rainbow') {
                // Find the piece type to clear — use the id stored on the rainbow
                // or the id of the piece it was matched with
                let targetId = piece.id;
                // Check neighbors for a matched non-special piece
                for (const nk of toRemove) {
                    const [nr, nc] = nk.split(',').map(Number);
                    const np = b[nr]?.[nc];
                    if (np && np.id !== targetId && !np.special) {
                        targetId = np.id;
                        break;
                    }
                }
                // Clear all pieces of that type
                for (let rr = 0; rr < BOARD_SIZE; rr++) {
                    for (let cc = 0; cc < BOARD_SIZE; cc++) {
                        if (b[rr][cc]?.id === targetId) {
                            const k = `${rr},${cc}`;
                            if (!toRemove.has(k)) { toRemove.add(k); changed = true; }
                        }
                    }
                }
            }
        }
    }

    const cells = Array.from(toRemove).map(s => {
        const [r, c] = s.split(',').map(Number);
        return { row: r, col: c };
    });

    return { cells, bonusScore, activatedSpecials };
}

function removeMatches(b, cells) {
    for (const c of cells) {
        b[c.row][c.col] = null;
    }
}

function applyGravity(b) {
    const fallen = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
        let writeRow = BOARD_SIZE - 1;
        for (let r = BOARD_SIZE - 1; r >= 0; r--) {
            if (b[r][c]) {
                if (r !== writeRow) {
                    b[writeRow][c] = b[r][c];
                    b[r][c] = null;
                    fallen.push({ row: writeRow, col: c });
                }
                writeRow--;
            }
        }
        for (let r = writeRow; r >= 0; r--) {
            b[r][c] = randomPiece();
            fallen.push({ row: r, col: c });
        }
    }
    return fallen;
}

function scoreMatches(matchedCount) {
    if (matchedCount <= 0) return 0;
    if (matchedCount === 3) return 5;
    if (matchedCount === 4) return 15;
    if (matchedCount >= 5) return 30;
    return matchedCount * 3;
}

function hasValidMoves(b) {
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (c + 1 < BOARD_SIZE) {
                swap(b, r, c, r, c + 1);
                if (findMatchGroups(b).length > 0) { swap(b, r, c, r, c + 1); return true; }
                swap(b, r, c, r, c + 1);
            }
            if (r + 1 < BOARD_SIZE) {
                swap(b, r, c, r + 1, c);
                if (findMatchGroups(b).length > 0) { swap(b, r, c, r + 1, c); return true; }
                swap(b, r, c, r + 1, c);
            }
        }
    }
    return false;
}

function swap(b, r1, c1, r2, c2) {
    const tmp = b[r1][c1];
    b[r1][c1] = b[r2][c2];
    b[r2][c2] = tmp;
}

// ==========================================
// GAME FLOW
// ==========================================
async function processCascade() {
    animating = true;
    let cascadeScore = 0;
    comboCount = 0;

    while (true) {
        const groups = findMatchGroups(board);
        if (groups.length === 0) break;

        comboCount++;
        const multiplier = Math.min(0.5 + comboCount * 0.5, 3);

        // Collect all matched cells
        const allMatchedSet = new Set();
        const allMatched = [];
        for (const g of groups) {
            for (const c of g.cells) {
                const key = `${c.row},${c.col}`;
                if (!allMatchedSet.has(key)) {
                    allMatchedSet.add(key);
                    allMatched.push(c);
                }
            }
        }

        // Determine special pieces to create BEFORE removing
        const specials = determineSpecials(groups, lastSwap);

        // Activate any existing specials in the match zone
        const activation = activateSpecials(board, allMatched);
        const toRemove = activation.cells;
        const bonusScore = activation.bonusScore;

        // Base score from matched count + bonus from specials
        const baseScore = scoreMatches(allMatched.length);
        const roundScore = Math.round((baseScore + bonusScore) * multiplier);
        cascadeScore += roundScore;

        // Show combo popup
        if (comboCount > 1) {
            showComboPopup(comboCount, multiplier);
        }

        // Animate special activations
        if (activation.activatedSpecials.length > 0) {
            renderBoard([], false, activation.activatedSpecials);
            await sleep(200);
        }

        // Animate matched/destroyed cells
        renderBoard(toRemove);
        await sleep(300);

        // Remove all matched cells
        removeMatches(board, toRemove);
        renderBoard();
        await sleep(100);

        // Place special pieces AFTER removal (they survive the match)
        for (const sp of specials) {
            // Only place if the cell was emptied
            if (!board[sp.row][sp.col]) {
                board[sp.row][sp.col] = { id: sp.id, emoji: PIECES.find(p => p.id === sp.id)?.emoji || '⭐', special: sp.type };
            }
        }

        applyGravity(board);
        renderBoard([], true);
        await sleep(200);

        // Reset lastSwap after first cascade iteration
        lastSwap = null;
    }

    totalScore += cascadeScore;
    coinsEarned = Math.min(Math.floor(totalScore / 10), MAX_COINS);
    comboCount = 0;
    animating = false;

    if (!hasValidMoves(board)) {
        board = createBoard();
    }

    renderBoard();
    updateHeader();
}

async function handleCellClick(row, col) {
    if (!gameActive || animating) return;

    if (!selected) {
        selected = { row, col };
        renderBoard();
        return;
    }

    const dr = Math.abs(selected.row - row);
    const dc = Math.abs(selected.col - col);

    if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
        swap(board, selected.row, selected.col, row, col);

        const groups = findMatchGroups(board);
        if (groups.length > 0) {
            lastSwap = { row, col };
            selected = null;
            await processCascade();
        } else {
            swap(board, selected.row, selected.col, row, col);
            selected = null;
            renderBoard();
        }
    } else {
        selected = { row, col };
        renderBoard();
    }
}

// ==========================================
// TIMER
// ==========================================
function startTimer() {
    timeLeft = GAME_TIME;
    timerInterval = setInterval(() => {
        timeLeft--;
        updateHeader();
        if (timeLeft <= 0) {
            endGame();
        }
    }, 1000);
}

async function endGame() {
    gameActive = false;
    clearInterval(timerInterval);
    renderGameOver();

    try {
        const r = await fetch('/api/minigame/complete', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ score: totalScore, coins_earned: coinsEarned })
        });
        const data = await r.json();
        if (data.error) console.warn('Minigame submit:', data.error);
    } catch (e) {
        console.error('Minigame submit error', e);
    }
}

// ==========================================
// RENDER
// ==========================================
function renderBoard(matchedCells = [], falling = false, activatedSpecials = []) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;

    const matchSet = new Set(matchedCells.map(m => `${m.row},${m.col}`));
    const specialActivationMap = {};
    for (const sp of activatedSpecials) {
        specialActivationMap[`${sp.row},${sp.col}`] = sp.type;
    }

    let html = '';
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            const isSelected = selected && selected.row === r && selected.col === c;
            const isMatched = matchSet.has(`${r},${c}`);
            const activationType = specialActivationMap[`${r},${c}`];
            const classes = ['game-cell'];

            if (isSelected) classes.push('selected');
            if (isMatched) classes.push('matched');
            if (falling) classes.push('falling');

            // Special piece classes
            if (piece?.special) {
                classes.push(`special-${piece.special}`);
            }

            // Special activation animation
            if (activationType === 'bomb') classes.push('exploding');
            if (activationType === 'lightning') classes.push('zapping');
            if (activationType === 'rainbow') classes.push('rainbow-clear');

            let content = piece?.emoji || '';
            // Show special indicator overlay
            if (piece?.special && SPECIAL_TYPES[piece.special]) {
                content += `<span class="special-indicator">${SPECIAL_TYPES[piece.special].emoji}</span>`;
            }

            html += `<div class="${classes.join(' ')}" data-row="${r}" data-col="${c}">${content}</div>`;
        }
    }

    boardEl.innerHTML = html;

    boardEl.querySelectorAll('.game-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            handleCellClick(parseInt(cell.dataset.row), parseInt(cell.dataset.col));
        });
    });
}

function showComboPopup(combo, multiplier) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;

    const popup = document.createElement('div');
    popup.className = 'combo-popup';
    const size = Math.min(32 + combo * 4, 48);
    popup.style.fontSize = size + 'px';
    popup.textContent = `x${multiplier.toFixed(1)}!`;
    boardEl.style.position = 'relative';
    boardEl.appendChild(popup);

    setTimeout(() => popup.remove(), 900);
}

function updateHeader() {
    const timerEl = document.getElementById('gameTimer');
    const scoreEl = document.getElementById('gameScore');
    const coinsEl = document.getElementById('gameCoins');
    const comboEl = document.getElementById('gameCombo');

    if (timerEl) {
        const m = Math.floor(timeLeft / 60);
        const s = timeLeft % 60;
        timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        timerEl.className = 'game-timer' + (timeLeft <= 10 ? ' warning' : '');
    }
    if (scoreEl) scoreEl.textContent = totalScore;
    if (coinsEl) coinsEl.textContent = `${coinsEarned}/${MAX_COINS}`;
    if (comboEl) {
        if (comboCount > 1) {
            comboEl.textContent = `Combo x${(0.5 + comboCount * 0.5).toFixed(1)}`;
            comboEl.className = 'game-combo active';
        } else {
            comboEl.textContent = '';
            comboEl.className = 'game-combo';
        }
    }
}

function renderGameOver() {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;

    const stars = totalScore >= 300 ? '3' : totalScore >= 150 ? '2' : totalScore >= 50 ? '1' : '0';
    const starsDisplay = stars === '3' ? '⭐⭐⭐' : stars === '2' ? '⭐⭐' : stars === '1' ? '⭐' : '';

    boardEl.innerHTML += `
    <div class="game-overlay">
        <h2>Час вийшов!</h2>
        ${starsDisplay ? `<div class="final-stars">${starsDisplay}</div>` : ''}
        <div class="final-score-label">Рахунок</div>
        <div class="final-score">${totalScore}</div>
        <div class="final-coins">+${coinsEarned} монет 💰</div>
        <button class="game-start-btn" onclick="location.reload()">🔄 Ще раз</button>
    </div>`;
}

// ==========================================
// INIT
// ==========================================
async function initGamePage() {
    if (localStorage.getItem('pzp_dark_mode') === 'true') document.body.classList.add('dark-mode');
    const token = localStorage.getItem('pzp_token');
    if (!token) { window.location.href = '/'; return; }

    try {
        const r = await fetch('/api/minigame/status', { headers: getAuthHeaders(false) });
        if (handleAuthError(r)) return;
        gameStatus = await r.json();
    } catch (e) {
        console.error('Status error', e);
    }

    renderGameUI();
}

function renderGameUI() {
    const canPlay = gameStatus?.canPlay !== false;
    const cooldown = gameStatus?.cooldownLeft || 0;
    const todayGames = gameStatus?.todayGames || 0;
    const bestScore = gameStatus?.bestScore || 0;

    document.getElementById('mainApp').innerHTML = `
    <div class="game-page">
        <div style="margin-bottom:16px">
            <a href="/profile" style="color:var(--primary);text-decoration:none;font-weight:600">← Профіль</a>
        </div>

        <div class="game-header">
            <div class="game-title">🎮 3 в ряд</div>
            <div id="gameScore" class="game-score">0</div>
            <div id="gameTimer" class="game-timer">1:00</div>
            <div id="gameCoins" class="game-coins-display">💰 <span id="gameCoinsValue">0/${MAX_COINS}</span></div>
        </div>

        <div class="game-specials-legend">
            <span title="4 в ряд">💣 4</span>
            <span title="5+ в ряд">⚡ 5+</span>
            <span title="L/T форма">🌟 L/T</span>
        </div>

        <div id="gameBoard" class="game-board" style="position:relative;min-height:300px">
            ${!canPlay ? `
                <div class="game-cooldown">
                    ${cooldown > 0
                        ? `<p>Кулдаун...</p><div class="game-cooldown-timer" id="cooldownTimer">${Math.floor(cooldown / 60)}:${(cooldown % 60).toString().padStart(2, '0')}</div>`
                        : `<p>Повернись завтра! 🦕</p><p>Ти вже зіграв ${todayGames}/${gameStatus?.maxDaily || 5} ігор сьогодні</p>`
                    }
                </div>
            ` : `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;gap:16px">
                    <p style="font-size:48px">🎮</p>
                    <p style="color:var(--gray-500)">З'єднуй 3+ однакових елементи</p>
                    <div class="game-hints">
                        <p>💣 Зібери <b>4 в ряд</b> → Бомба (вибух 3×3)</p>
                        <p>⚡ Зібери <b>5 в ряд</b> → Блискавка (весь рядок)</p>
                        <p>🌟 Зібери <b>L або T</b> → Зірка (всі такого типу)</p>
                    </div>
                    <button class="game-start-btn" onclick="startGame()">▶️ Почати гру</button>
                </div>
            `}
        </div>

        <div id="gameCombo" class="game-combo"></div>

        <div class="game-footer">
            <div class="game-best">Рекорд: ${bestScore} 🏆</div>
            <div style="color:var(--gray-500);font-size:var(--font-sm)">Ігор сьогодні: ${todayGames}/${gameStatus?.maxDaily || 5}</div>
        </div>
    </div>`;

    if (cooldown > 0) {
        let left = cooldown;
        const interval = setInterval(() => {
            left--;
            const el = document.getElementById('cooldownTimer');
            if (el) el.textContent = `${Math.floor(left / 60)}:${(left % 60).toString().padStart(2, '0')}`;
            if (left <= 0) { clearInterval(interval); location.reload(); }
        }, 1000);
    }
}

function startGame() {
    board = createBoard();
    selected = null;
    totalScore = 0;
    coinsEarned = 0;
    comboCount = 0;
    lastSwap = null;
    gameActive = true;
    renderBoard();
    updateHeader();
    startTimer();
}

document.addEventListener('DOMContentLoaded', initGamePage);
