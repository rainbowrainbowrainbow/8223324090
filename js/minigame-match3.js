/**
 * minigame-match3.js — Match-3 Epic Edition (Park themed)
 * v22.10.0 — 9x9 board, frozen tiles, cross special, epic combo system, daily records, boss round
 */

// ==========================================
// CONSTANTS
// ==========================================
const BOARD_COLS = 9;
const BOARD_ROWS = 9;
const GAME_TIME = 75; // more time for bigger board
const MAX_COINS = 50;
const PIECES = [
    { id: 'dino',    emoji: '🦕' },
    { id: 'balloon', emoji: '🎈' },
    { id: 'cake',    emoji: '🎂' },
    { id: 'mask',    emoji: '🎭' },
    { id: 'star',    emoji: '⭐' },
    { id: 'tent',    emoji: '🎪' },
    { id: 'clown',   emoji: '🤡' },
];

const SPECIAL_TYPES = {
    bomb:      { emoji: '💣', bonus: 20, label: 'Бомба', desc: '3×3 вибух' },
    lightning: { emoji: '⚡', bonus: 40, label: 'Блискавка', desc: 'весь рядок' },
    cross:     { emoji: '✦', bonus: 50, label: 'Хрест', desc: 'рядок + стовпець' },
    rainbow:   { emoji: '🌈', bonus: 60, label: 'Веселка', desc: 'всі такого типу' }
};

// Combo level config: different effects per level
const COMBO_LEVELS = [
    null, // 0
    { label: '', color: '' }, // combo 1 = no popup
    { label: 'x1.0!', color: '#f59e0b', emoji: '🔥', shake: 1, particles: 4 },
    { label: 'x1.5!', color: '#ef4444', emoji: '💥', shake: 2, particles: 8 },
    { label: 'x2.0!', color: '#a855f7', emoji: '🌟', shake: 3, particles: 14, flash: 'purple' },
    { label: 'x2.5!', color: '#3b82f6', emoji: '⚡', shake: 4, particles: 20, flash: 'blue' },
    { label: 'x3.0!!', color: '#ef4444', emoji: '🔥🌈🔥', shake: 6, particles: 30, flash: 'rainbow', mega: true },
];

const FROZEN_SPAWN_CHANCE = 0.06; // 6% chance per new falling piece

// ==========================================
// STATE
// ==========================================
let board = [];
let frozenMap = []; // frozenMap[r][c] = hits remaining (0=not frozen, 1=cracked, 2=solid)
let selected = null;
let gameActive = false;
let timeLeft = GAME_TIME;
let totalScore = 0;
let coinsEarned = 0;
let comboCount = 0;
let maxCombo = 0;
let timerInterval = null;
let animating = false;
let gameStatus = null;
let lastSwap = null;
let dailyRecords = null;
let bossStatus = null;
let isBossMode = false;

const BOSS_TIME = 90; // Boss round: 90 seconds
const BOSS_COIN_MULTIPLIER = 3;

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
    frozenMap = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
        b[r] = [];
        frozenMap[r] = [];
        for (let c = 0; c < BOARD_COLS; c++) {
            let piece, attempts = 0;
            do { piece = randomPiece(); attempts++; } while (hasMatchAt(b, r, c, piece) && attempts < 50);
            b[r][c] = piece;
            frozenMap[r][c] = 0;
        }
    }
    // Seed some frozen tiles
    let frozenCount = 0;
    const maxFrozen = Math.floor(BOARD_ROWS * BOARD_COLS * 0.08);
    while (frozenCount < maxFrozen) {
        const r = Math.floor(Math.random() * BOARD_ROWS);
        const c = Math.floor(Math.random() * BOARD_COLS);
        if (frozenMap[r][c] === 0) {
            frozenMap[r][c] = 2; // solid ice
            frozenCount++;
        }
    }
    return b;
}

function findMatchGroups(b) {
    const groups = [];
    // Horizontal
    for (let r = 0; r < BOARD_ROWS; r++) {
        let c = 0;
        while (c <= BOARD_COLS - 3) {
            if (b[r][c] && b[r][c].id) {
                const id = b[r][c].id;
                let end = c;
                while (end + 1 < BOARD_COLS && b[r][end + 1]?.id === id) end++;
                if (end - c + 1 >= 3) {
                    const cells = [];
                    for (let i = c; i <= end; i++) cells.push({ row: r, col: i });
                    groups.push({ cells, length: end - c + 1, direction: 'h' });
                }
                c = end + 1;
            } else c++;
        }
    }
    // Vertical
    for (let c = 0; c < BOARD_COLS; c++) {
        let r = 0;
        while (r <= BOARD_ROWS - 3) {
            if (b[r][c] && b[r][c].id) {
                const id = b[r][c].id;
                let end = r;
                while (end + 1 < BOARD_ROWS && b[end + 1]?.[c]?.id === id) end++;
                if (end - r + 1 >= 3) {
                    const cells = [];
                    for (let i = r; i <= end; i++) cells.push({ row: i, col: c });
                    groups.push({ cells, length: end - r + 1, direction: 'v' });
                }
                r = end + 1;
            } else r++;
        }
    }
    return groups;
}

function detectLTShapes(groups) {
    const ltShapes = [];
    const usedGroups = new Set();
    for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
            if (groups[i].direction === groups[j].direction) continue;
            const setA = new Set(groups[i].cells.map(c => `${c.row},${c.col}`));
            let intersection = null;
            for (const cell of groups[j].cells) {
                if (setA.has(`${cell.row},${cell.col}`)) { intersection = cell; break; }
            }
            if (intersection) {
                const allCellKeys = new Set();
                const allCells = [];
                for (const c of [...groups[i].cells, ...groups[j].cells]) {
                    const key = `${c.row},${c.col}`;
                    if (!allCellKeys.has(key)) { allCellKeys.add(key); allCells.push(c); }
                }
                ltShapes.push({ cells: allCells, intersectionCell: intersection, groupI: i, groupJ: j });
                usedGroups.add(i);
                usedGroups.add(j);
            }
        }
    }
    return { ltShapes, usedGroups };
}

function determineSpecials(groups, swapTarget) {
    const specials = [];
    const { ltShapes, usedGroups } = detectLTShapes(groups);

    // L/T shapes → rainbow
    for (const lt of ltShapes) {
        const pos = lt.intersectionCell;
        specials.push({ row: pos.row, col: pos.col, type: 'rainbow', id: board[pos.row][pos.col]?.id || 'star' });
    }

    // Remaining groups
    for (let i = 0; i < groups.length; i++) {
        if (usedGroups.has(i)) continue;
        const g = groups[i];
        if (g.length >= 6) {
            // 6+ → cross (epic)
            const pos = pickSpecialPosition(g.cells, swapTarget);
            specials.push({ row: pos.row, col: pos.col, type: 'cross', id: board[pos.row][pos.col]?.id || 'star' });
        } else if (g.length >= 5) {
            const pos = pickSpecialPosition(g.cells, swapTarget);
            specials.push({ row: pos.row, col: pos.col, type: 'lightning', id: board[pos.row][pos.col]?.id || 'star' });
        } else if (g.length === 4) {
            const pos = pickSpecialPosition(g.cells, swapTarget);
            specials.push({ row: pos.row, col: pos.col, type: 'bomb', id: board[pos.row][pos.col]?.id || 'star' });
        }
    }
    return specials;
}

function pickSpecialPosition(cells, swapTarget) {
    if (swapTarget) {
        for (const c of cells) {
            if (c.row === swapTarget.row && c.col === swapTarget.col) return c;
        }
    }
    let best = cells[0];
    for (const c of cells) { if (c.row > best.row) best = c; }
    return best;
}

function activateSpecials(b, matchedCells) {
    const toRemove = new Set(matchedCells.map(c => `${c.row},${c.col}`));
    let bonusScore = 0;
    const activatedSpecials = [];
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
            piece.special = null;
            bonusScore += SPECIAL_TYPES[specialType]?.bonus || 0;
            activatedSpecials.push({ row: r, col: c, type: specialType });

            if (specialType === 'bomb') {
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < BOARD_ROWS && nc >= 0 && nc < BOARD_COLS) {
                            const k = `${nr},${nc}`;
                            if (!toRemove.has(k)) { toRemove.add(k); changed = true; }
                        }
                    }
                }
            } else if (specialType === 'lightning') {
                for (let col = 0; col < BOARD_COLS; col++) {
                    const k = `${r},${col}`;
                    if (!toRemove.has(k)) { toRemove.add(k); changed = true; }
                }
            } else if (specialType === 'cross') {
                // Clear entire row + entire column
                for (let col = 0; col < BOARD_COLS; col++) {
                    const k = `${r},${col}`;
                    if (!toRemove.has(k)) { toRemove.add(k); changed = true; }
                }
                for (let row = 0; row < BOARD_ROWS; row++) {
                    const k = `${row},${c}`;
                    if (!toRemove.has(k)) { toRemove.add(k); changed = true; }
                }
            } else if (specialType === 'rainbow') {
                let targetId = piece.id;
                for (const nk of toRemove) {
                    const [nr, nc] = nk.split(',').map(Number);
                    const np = b[nr]?.[nc];
                    if (np && np.id !== targetId && !np.special) { targetId = np.id; break; }
                }
                for (let rr = 0; rr < BOARD_ROWS; rr++) {
                    for (let cc = 0; cc < BOARD_COLS; cc++) {
                        if (b[rr][cc]?.id === targetId) {
                            const k = `${rr},${cc}`;
                            if (!toRemove.has(k)) { toRemove.add(k); changed = true; }
                        }
                    }
                }
            }
        }
    }

    const cells = Array.from(toRemove).map(s => { const [r, c] = s.split(',').map(Number); return { row: r, col: c }; });
    return { cells, bonusScore, activatedSpecials };
}

function removeMatches(b, cells) {
    for (const c of cells) {
        // Handle frozen tiles: damage ice instead of removing piece
        if (frozenMap[c.row][c.col] > 0) {
            frozenMap[c.row][c.col]--;
            if (frozenMap[c.row][c.col] > 0) continue; // ice not fully broken yet
        }
        b[c.row][c.col] = null;
    }
}

function applyGravity(b) {
    const fallen = [];
    for (let c = 0; c < BOARD_COLS; c++) {
        let writeRow = BOARD_ROWS - 1;
        for (let r = BOARD_ROWS - 1; r >= 0; r--) {
            if (b[r][c]) {
                if (r !== writeRow) {
                    b[writeRow][c] = b[r][c];
                    // Move frozen state too
                    frozenMap[writeRow][c] = frozenMap[r][c];
                    b[r][c] = null;
                    frozenMap[r][c] = 0;
                    fallen.push({ row: writeRow, col: c });
                }
                writeRow--;
            }
        }
        for (let r = writeRow; r >= 0; r--) {
            const piece = randomPiece();
            b[r][c] = piece;
            frozenMap[r][c] = 0;
            // Random chance to spawn frozen
            if (Math.random() < FROZEN_SPAWN_CHANCE) {
                frozenMap[r][c] = 2;
            }
            fallen.push({ row: r, col: c });
        }
    }
    return fallen;
}

function scoreMatches(matchedCount) {
    if (matchedCount <= 0) return 0;
    if (matchedCount === 3) return 5;
    if (matchedCount === 4) return 15;
    if (matchedCount === 5) return 30;
    if (matchedCount >= 6) return 50;
    return matchedCount * 3;
}

function hasValidMoves(b) {
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            if (c + 1 < BOARD_COLS) {
                swapCells(b, r, c, r, c + 1);
                if (findMatchGroups(b).length > 0) { swapCells(b, r, c, r, c + 1); return true; }
                swapCells(b, r, c, r, c + 1);
            }
            if (r + 1 < BOARD_ROWS) {
                swapCells(b, r, c, r + 1, c);
                if (findMatchGroups(b).length > 0) { swapCells(b, r, c, r + 1, c); return true; }
                swapCells(b, r, c, r + 1, c);
            }
        }
    }
    return false;
}

function swapCells(b, r1, c1, r2, c2) {
    const tmp = b[r1][c1]; b[r1][c1] = b[r2][c2]; b[r2][c2] = tmp;
}

// ==========================================
// PARTICLES & EFFECTS
// ==========================================
function spawnParticles(count, centerEl, color) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl || !centerEl) return;
    const rect = centerEl.getBoundingClientRect();
    const boardRect = boardEl.getBoundingClientRect();
    const cx = rect.left - boardRect.left + rect.width / 2;
    const cy = rect.top - boardRect.top + rect.height / 2;

    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
        const dist = 40 + Math.random() * 80;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        const size = 4 + Math.random() * 6;
        p.style.cssText = `
            left: ${cx}px; top: ${cy}px;
            width: ${size}px; height: ${size}px;
            background: ${color || '#f59e0b'};
            --dx: ${dx}px; --dy: ${dy}px;
        `;
        boardEl.appendChild(p);
        setTimeout(() => p.remove(), 700);
    }
}

function spawnExplosionParticles(row, col, type) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;
    const cell = boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (!cell) return;

    const colors = {
        bomb: '#ef4444',
        lightning: '#eab308',
        cross: '#3b82f6',
        rainbow: '#a855f7'
    };
    spawnParticles(type === 'cross' ? 24 : type === 'rainbow' ? 20 : 12, cell, colors[type] || '#f59e0b');
}

function screenShake(intensity) {
    const page = document.querySelector('.game-page');
    if (!page) return;
    page.style.animation = 'none';
    page.offsetHeight; // reflow
    page.style.animation = `screen-shake ${0.15 + intensity * 0.05}s ease`;
    page.style.setProperty('--shake-px', (intensity * 2) + 'px');
}

function screenFlash(color) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;
    const flash = document.createElement('div');
    flash.className = 'screen-flash';
    if (color === 'rainbow') {
        flash.classList.add('rainbow-flash');
    } else {
        flash.style.background = color || 'rgba(255,255,255,0.3)';
    }
    boardEl.appendChild(flash);
    setTimeout(() => flash.remove(), 400);
}

// ==========================================
// GAME FLOW
// ==========================================
async function processCascade() {
    animating = true;
    let cascadeScore = 0;
    comboCount = 0;

    while (gameActive) {
        const groups = findMatchGroups(board);
        if (groups.length === 0) break;

        comboCount++;
        if (comboCount > maxCombo) maxCombo = comboCount;
        const multiplier = Math.min(0.5 + comboCount * 0.5, 3);

        const allMatchedSet = new Set();
        const allMatched = [];
        for (const g of groups) {
            for (const c of g.cells) {
                const key = `${c.row},${c.col}`;
                if (!allMatchedSet.has(key)) { allMatchedSet.add(key); allMatched.push(c); }
            }
        }

        const specials = determineSpecials(groups, lastSwap);
        const activation = activateSpecials(board, allMatched);
        const toRemove = activation.cells;
        const bonusScore = activation.bonusScore;

        const baseScore = scoreMatches(allMatched.length);
        const roundScore = Math.round((baseScore + bonusScore) * multiplier);
        cascadeScore += roundScore;

        // Epic combo effects
        if (comboCount >= 2) {
            const level = Math.min(comboCount, COMBO_LEVELS.length - 1);
            const cfg = COMBO_LEVELS[level];
            if (cfg) {
                showComboPopup(comboCount, multiplier, cfg);
                if (cfg.shake) screenShake(cfg.shake);
                if (cfg.flash) screenFlash(cfg.flash === 'rainbow' ? 'rainbow' : cfg.flash === 'purple' ? 'rgba(168,85,247,0.25)' : 'rgba(59,130,246,0.25)');
            }
        }

        // Animate special activations
        if (activation.activatedSpecials.length > 0) {
            renderBoard([], false, activation.activatedSpecials);
            for (const sp of activation.activatedSpecials) {
                spawnExplosionParticles(sp.row, sp.col, sp.type);
            }
            await sleep(250);
        }

        // Animate matched
        renderBoard(toRemove);
        await sleep(280);

        // Remove
        removeMatches(board, toRemove);
        renderBoard();
        await sleep(80);

        // Place specials
        for (const sp of specials) {
            if (!board[sp.row][sp.col]) {
                board[sp.row][sp.col] = { id: sp.id, emoji: PIECES.find(p => p.id === sp.id)?.emoji || '⭐', special: sp.type };
                frozenMap[sp.row][sp.col] = 0;
            }
        }

        applyGravity(board);
        renderBoard([], true);
        await sleep(180);

        lastSwap = null;
    }

    totalScore += cascadeScore;
    coinsEarned = Math.min(Math.floor(totalScore / 10), MAX_COINS);
    comboCount = 0;
    animating = false;

    // If timer ran out during cascade, show game over now
    if (!gameActive) {
        endGame();
        return;
    }

    if (!hasValidMoves(board)) board = createBoard();

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
        swapCells(board, selected.row, selected.col, row, col);
        const groups = findMatchGroups(board);
        if (groups.length > 0) {
            lastSwap = { row, col };
            selected = null;
            await processCascade();
        } else {
            swapCells(board, selected.row, selected.col, row, col);
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
        if (timeLeft <= 0) endGame();
    }, 1000);
}

async function endGame() {
    gameActive = false;
    clearInterval(timerInterval);

    // If cascade is still running, it will call endGame when done
    if (animating) return;

    renderGameOver();

    try {
        if (isBossMode) {
            const r = await fetch('/api/minigame/boss/complete', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ score: totalScore })
            });
            const data = await r.json();
            if (data.error) console.warn('Boss submit:', data.error);
        } else {
            const r = await fetch('/api/minigame/complete', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ score: totalScore, coins_earned: coinsEarned })
            });
            const data = await r.json();
            if (data.error) console.warn('Minigame submit:', data.error);
        }
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
    for (const sp of activatedSpecials) specialActivationMap[`${sp.row},${sp.col}`] = sp.type;

    let html = '';
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const piece = board[r][c];
            const isSelected = selected && selected.row === r && selected.col === c;
            const isMatched = matchSet.has(`${r},${c}`);
            const activationType = specialActivationMap[`${r},${c}`];
            const frozen = frozenMap[r]?.[c] || 0;
            const classes = ['game-cell'];

            if (isSelected) classes.push('selected');
            if (isMatched) classes.push('matched');
            if (falling) classes.push('falling');
            if (piece?.special) classes.push(`special-${piece.special}`);
            if (activationType === 'bomb') classes.push('exploding');
            if (activationType === 'lightning') classes.push('zapping');
            if (activationType === 'cross') classes.push('cross-blasting');
            if (activationType === 'rainbow') classes.push('rainbow-clear');
            if (frozen === 2) classes.push('frozen-solid');
            if (frozen === 1) classes.push('frozen-cracked');

            let content = piece?.emoji || '';
            if (piece?.special && SPECIAL_TYPES[piece.special]) {
                content += `<span class="special-indicator">${SPECIAL_TYPES[piece.special].emoji}</span>`;
            }
            if (frozen > 0) {
                content += `<span class="ice-overlay">${frozen === 2 ? '❄️' : '💧'}</span>`;
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

function showComboPopup(combo, multiplier, cfg) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;

    const popup = document.createElement('div');
    popup.className = 'combo-popup';
    if (cfg.mega) popup.classList.add('mega');
    const size = Math.min(36 + combo * 6, 64);
    popup.style.fontSize = size + 'px';
    popup.style.color = cfg.color;
    popup.innerHTML = `<span class="combo-emoji">${cfg.emoji}</span> ${cfg.label}`;
    boardEl.appendChild(popup);
    setTimeout(() => popup.remove(), 1200);

    // Spawn combo particles around the board center
    if (cfg.particles) {
        const center = boardEl.querySelector(`[data-row="4"][data-col="4"]`);
        if (center) spawnParticles(cfg.particles, center, cfg.color);
    }
}

function updateHeader() {
    const timerEl = document.getElementById('gameTimer');
    const scoreEl = document.getElementById('gameScore');
    const coinsEl = document.getElementById('gameCoinsValue');
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
            const mult = Math.min(0.5 + comboCount * 0.5, 3);
            comboEl.textContent = `Combo x${mult.toFixed(1)}`;
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

    if (isBossMode) {
        const TARGET = 300;
        const won = totalScore >= TARGET;
        const bossCoins = won ? Math.min(Math.floor(totalScore / 10) * 3, 150) : 0;

        boardEl.innerHTML += `
        <div class="game-overlay">
            <h2>${won ? '🏆 Перемога!' : '💀 Не вдалось...'}</h2>
            <div class="final-score-label" style="color:${won ? '#16a34a' : '#dc2626'}">Бос-раунд</div>
            <div class="final-score">${totalScore} / ${TARGET}</div>
            ${won ? `<div class="final-coins">+${bossCoins} монет 💰 (x3!)</div>` : '<div style="color:var(--gray-400)">Спробуй наступної неділі</div>'}
            ${maxCombo >= 3 ? `<div class="final-combo">Макс. комбо: x${Math.min(0.5 + maxCombo * 0.5, 3).toFixed(1)} 🔥</div>` : ''}
            <button class="game-start-btn" onclick="location.reload()">🔄 Назад</button>
        </div>`;
        return;
    }

    const stars = totalScore >= 400 ? 3 : totalScore >= 200 ? 2 : totalScore >= 80 ? 1 : 0;
    const starsArr = [];
    for (let i = 0; i < 3; i++) starsArr.push(i < stars ? '⭐' : '☆');

    boardEl.innerHTML += `
    <div class="game-overlay">
        <h2>🎉 Час вийшов!</h2>
        <div class="final-stars">${starsArr.join(' ')}</div>
        <div class="final-score-label">Рахунок</div>
        <div class="final-score">${totalScore}</div>
        <div class="final-coins">+${coinsEarned} монет 💰</div>
        ${maxCombo >= 3 ? `<div class="final-combo">Макс. комбо: x${Math.min(0.5 + maxCombo * 0.5, 3).toFixed(1)} 🔥</div>` : ''}
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
        const [statusRes, recordsRes, bossRes] = await Promise.all([
            fetch('/api/minigame/status', { headers: getAuthHeaders(false) }),
            fetch('/api/minigame/daily-records', { headers: getAuthHeaders(false) }),
            fetch('/api/minigame/boss', { headers: getAuthHeaders(false) })
        ]);
        if (handleAuthError(statusRes)) return;
        gameStatus = await statusRes.json();
        if (recordsRes.ok) dailyRecords = await recordsRes.json();
        if (bossRes.ok) bossStatus = await bossRes.json();
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
        <div style="margin-bottom:12px">
            <a href="/profile" class="game-back-link">← Назад</a>
        </div>

        <div class="game-header">
            <div class="game-title">🎮 3 в ряд</div>
            <div id="gameScore" class="game-score">0</div>
            <div id="gameTimer" class="game-timer">1:15</div>
            <div class="game-coins-display">💰 <span id="gameCoinsValue">0/${MAX_COINS}</span></div>
        </div>

        <div class="game-specials-legend">
            <span title="4 в ряд → Бомба 3×3">💣 4</span>
            <span title="5 в ряд → Блискавка (рядок)">⚡ 5</span>
            <span title="6+ в ряд → Хрест (рядок+стовпець)">✦ 6+</span>
            <span title="L/T форма → Веселка (всі такого типу)">🌈 L/T</span>
            <span title="Крижані клітинки — вдар двічі щоб зламати">❄️ Лід</span>
        </div>

        <div id="gameBoard" class="game-board" style="position:relative">
            ${!canPlay ? `
                <div class="game-cooldown">
                    ${cooldown > 0
                        ? `<p>Кулдаун...</p><div class="game-cooldown-timer" id="cooldownTimer">${Math.floor(cooldown / 60)}:${(cooldown % 60).toString().padStart(2, '0')}</div>`
                        : `<p>Повернись завтра! 🦕</p><p>Ти вже зіграв ${todayGames}/${gameStatus?.maxDaily || 5} ігор сьогодні</p>`
                    }
                    <button class="game-start-btn" style="margin-top:16px;font-size:var(--font-sm);padding:8px 16px" onclick="resetMinigame()">🔄 Скинути кулдаун</button>
                </div>
            ` : `
                <div class="game-start-screen">
                    <div class="start-icon">🎮</div>
                    <h3>3 в ряд — Epic Edition</h3>
                    <p class="start-subtitle">9×9 поле · 7 типів · 4 спецблоки · Крижані клітинки</p>
                    <div class="game-hints">
                        <div class="hint-row"><span class="hint-icon">💣</span> <b>4 в ряд</b> — Бомба (вибух 3×3)</div>
                        <div class="hint-row"><span class="hint-icon">⚡</span> <b>5 в ряд</b> — Блискавка (весь рядок)</div>
                        <div class="hint-row"><span class="hint-icon">✦</span> <b>6+ в ряд</b> — Хрест (рядок + стовпець)</div>
                        <div class="hint-row"><span class="hint-icon">🌈</span> <b>L або T</b> — Веселка (всі такого типу)</div>
                        <div class="hint-row"><span class="hint-icon">❄️</span> <b>Лід</b> — вдар двічі щоб зламати!</div>
                    </div>
                    <button class="game-start-btn pulse" onclick="startGame()">▶️ Почати гру</button>
                </div>
            `}
        </div>

        <div id="gameCombo" class="game-combo"></div>

        <div class="game-footer">
            <div class="game-best">Рекорд: ${bestScore} 🏆</div>
            <div style="color:var(--gray-500);font-size:var(--font-sm)">Ігор: ${todayGames}/${gameStatus?.maxDaily || 5}</div>
        </div>

        ${renderDailyRecords()}
        ${renderBossRound()}
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

function renderDailyRecords() {
    if (!dailyRecords) return '';
    const top3 = dailyRecords.top3 || [];
    const medals = ['🥇', '🥈', '🥉'];

    return `
    <div style="margin-top:16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px">
        <div style="font-weight:700;margin-bottom:8px">📊 Рекорди дня</div>
        ${top3.length === 0 ? '<div style="color:var(--gray-400);font-size:var(--font-sm)">Ще ніхто не грав сьогодні</div>' : ''}
        ${top3.map((r, i) => `
            <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:var(--font-sm)">
                <span style="font-size:1.1rem">${medals[i]}</span>
                <span style="flex:1;font-weight:${i === 0 ? '700' : '500'}">${r.name}</span>
                <span style="font-weight:700;color:var(--primary)">${r.score}</span>
                <span style="color:var(--gray-400)">💰${r.coins}</span>
            </div>
        `).join('')}
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:var(--font-sm);color:var(--gray-500)">
            Твій рекорд сьогодні: <b style="color:var(--gray-700)">${dailyRecords.myBestToday || '—'}</b>
            · Абсолютний: <b style="color:var(--gray-700)">${dailyRecords.myBestAllTime || '—'}</b>
        </div>
    </div>`;
}

function renderBossRound() {
    if (!bossStatus) return '';

    const { isBossDay, played, completed, score, coinsEarned: bossCoins, targetScore } = bossStatus;

    if (!isBossDay && !played) {
        return `
        <div style="margin-top:12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px">
            <div style="font-weight:700">👹 Бос-раунд</div>
            <div style="color:var(--gray-500);font-size:var(--font-sm);margin-top:4px">
                Доступний щонеділі · 90 секунд · Нагорода x3
            </div>
        </div>`;
    }

    if (played) {
        return `
        <div style="margin-top:12px;background:${completed ? 'rgba(22,163,106,0.08)' : 'rgba(220,38,38,0.08)'};border:1px solid ${completed ? '#16a34a' : '#dc2626'};border-radius:12px;padding:14px">
            <div style="font-weight:700">👹 Бос-раунд ${completed ? '✅ Перемога!' : '❌ Не вдалось'}</div>
            <div style="font-size:var(--font-sm);margin-top:4px">
                Рахунок: <b>${score}</b> / ${targetScore}
                ${bossCoins > 0 ? ` · +${bossCoins} монет 💰` : ''}
            </div>
        </div>`;
    }

    return `
    <div style="margin-top:12px;background:rgba(239,68,68,0.08);border:2px solid #ef4444;border-radius:12px;padding:14px">
        <div style="font-weight:700;color:#ef4444">👹 БОС-РАУНД СЬОГОДНІ!</div>
        <div style="font-size:var(--font-sm);margin-top:4px;color:var(--gray-600)">
            Набери ${targetScore || 300}+ очок за 90 секунд · Нагорода x3
        </div>
        <button class="game-start-btn" style="margin-top:10px;background:#ef4444;font-size:0.9rem;padding:10px 20px" onclick="startBossRound()">
            ⚔️ Почати бос-раунд
        </button>
    </div>`;
}

function startGame() {
    isBossMode = false;
    board = createBoard();
    selected = null;
    totalScore = 0;
    coinsEarned = 0;
    comboCount = 0;
    maxCombo = 0;
    lastSwap = null;
    gameActive = true;
    renderBoard();
    updateHeader();
    startTimer();
}

function startBossRound() {
    isBossMode = true;
    board = createBoard();
    selected = null;
    totalScore = 0;
    coinsEarned = 0;
    comboCount = 0;
    maxCombo = 0;
    lastSwap = null;
    gameActive = true;
    timeLeft = BOSS_TIME;
    renderBoard();
    updateHeader();

    // Boss timer (uses BOSS_TIME)
    timerInterval = setInterval(() => {
        timeLeft--;
        updateHeader();
        if (timeLeft <= 0) endGame();
    }, 1000);
}

async function resetMinigame() {
    try {
        const r = await fetch('/api/minigame/reset', { method: 'POST', headers: getAuthHeaders() });
        const data = await r.json();
        if (data.success) location.reload();
        else showNotification(data.error || 'Помилка скидання', 'error');
    } catch (e) {
        showNotification('Помилка: ' + e.message, 'error');
    }
}

function showNotification(msg, type) {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;top:16px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;z-index:9999;background:${type === 'error' ? '#fee2e2' : '#dcfce7'};color:${type === 'error' ? '#dc2626' : '#16a34a'};box-shadow:0 4px 12px rgba(0,0,0,0.1)`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', initGamePage);
