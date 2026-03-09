/**
 * minigame-match3.js — Match-3 minigame (Park themed)
 * v22.4.0
 */

// ==========================================
// CONSTANTS
// ==========================================
const BOARD_SIZE = 8;
const GAME_TIME = 60;
const PIECES = [
    { id: 'dino',    emoji: '🦕' },
    { id: 'balloon', emoji: '🎈' },
    { id: 'cake',    emoji: '🎂' },
    { id: 'mask',    emoji: '🎭' },
    { id: 'star',    emoji: '⭐' },
    { id: 'tent',    emoji: '🎪' },
];

// ==========================================
// STATE
// ==========================================
let board = [];
let selected = null; // { row, col }
let gameActive = false;
let timeLeft = GAME_TIME;
let coinsEarned = 0;
let comboCount = 0;
let timerInterval = null;
let animating = false;
let gameStatus = null;

// ==========================================
// UTILITIES
// ==========================================
function randomPiece() {
    return { ...PIECES[Math.floor(Math.random() * PIECES.length)] };
}

function hasMatchAt(b, row, col, piece) {
    // Check horizontal
    if (col >= 2 && b[row][col - 1]?.id === piece.id && b[row][col - 2]?.id === piece.id) return true;
    // Check vertical
    if (row >= 2 && b[row - 1]?.[col]?.id === piece.id && b[row - 2]?.[col]?.id === piece.id) return true;
    return false;
}

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

function findMatches(b) {
    const matched = new Set();

    // Horizontal
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c <= BOARD_SIZE - 3; c++) {
            if (b[r][c] && b[r][c + 1] && b[r][c + 2] &&
                b[r][c].id === b[r][c + 1].id && b[r][c].id === b[r][c + 2].id) {
                let end = c + 2;
                while (end + 1 < BOARD_SIZE && b[r][end + 1]?.id === b[r][c].id) end++;
                for (let i = c; i <= end; i++) matched.add(`${r},${i}`);
                c = end;
            }
        }
    }

    // Vertical
    for (let c = 0; c < BOARD_SIZE; c++) {
        for (let r = 0; r <= BOARD_SIZE - 3; r++) {
            if (b[r][c] && b[r + 1][c] && b[r + 2][c] &&
                b[r][c].id === b[r + 1][c].id && b[r][c].id === b[r + 2][c].id) {
                let end = r + 2;
                while (end + 1 < BOARD_SIZE && b[end + 1]?.[c]?.id === b[r][c].id) end++;
                for (let i = r; i <= end; i++) matched.add(`${i},${c}`);
                r = end;
            }
        }
    }

    return Array.from(matched).map(s => {
        const [r, c] = s.split(',').map(Number);
        return { row: r, col: c };
    });
}

function removeMatches(b, matches) {
    for (const m of matches) {
        b[m.row][m.col] = null;
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
        // Fill empty top cells
        for (let r = writeRow; r >= 0; r--) {
            b[r][c] = randomPiece();
            fallen.push({ row: r, col: c });
        }
    }
    return fallen;
}

function scoreMatches(matches) {
    // Group matches by connected regions
    const len = matches.length;
    if (len <= 0) return 0;
    // Simple scoring based on match count
    if (len === 3) return 5;
    if (len === 4) return 15;
    if (len >= 5) return 30;
    return len * 3;
}

function hasValidMoves(b) {
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            // Try swap right
            if (c + 1 < BOARD_SIZE) {
                swap(b, r, c, r, c + 1);
                if (findMatches(b).length > 0) { swap(b, r, c, r, c + 1); return true; }
                swap(b, r, c, r, c + 1);
            }
            // Try swap down
            if (r + 1 < BOARD_SIZE) {
                swap(b, r, c, r + 1, c);
                if (findMatches(b).length > 0) { swap(b, r, c, r + 1, c); return true; }
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
    let totalScore = 0;
    comboCount = 0;

    while (true) {
        const matches = findMatches(board);
        if (matches.length === 0) break;

        comboCount++;
        const multiplier = Math.min(0.5 + comboCount * 0.5, 3);
        const score = Math.round(scoreMatches(matches) * multiplier);
        totalScore += score;

        // Animate matched cells
        renderBoard(matches);
        await sleep(300);

        removeMatches(board, matches);
        renderBoard();
        await sleep(100);

        applyGravity(board);
        renderBoard([], true);
        await sleep(200);
    }

    coinsEarned = Math.min(coinsEarned + totalScore, 50);
    comboCount = 0;
    animating = false;

    // If no valid moves, reshuffle
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
        // Valid adjacent swap
        swap(board, selected.row, selected.col, row, col);

        const matches = findMatches(board);
        if (matches.length > 0) {
            selected = null;
            await processCascade();
        } else {
            // Swap back
            swap(board, selected.row, selected.col, row, col);
            selected = null;
            renderBoard();
        }
    } else {
        selected = { row, col };
        renderBoard();
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

    // Submit score
    try {
        const r = await fetch('/api/minigame/complete', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ score: coinsEarned * 10, coins_earned: coinsEarned })
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
function renderBoard(matchedCells = [], falling = false) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;

    const matchSet = new Set(matchedCells.map(m => `${m.row},${m.col}`));
    let html = '';

    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            const isSelected = selected && selected.row === r && selected.col === c;
            const isMatched = matchSet.has(`${r},${c}`);
            const classes = ['game-cell'];
            if (isSelected) classes.push('selected');
            if (isMatched) classes.push('matched');
            if (falling) classes.push('falling');

            html += `<div class="${classes.join(' ')}" data-row="${r}" data-col="${c}">${piece?.emoji || ''}</div>`;
        }
    }

    boardEl.innerHTML = html;

    // Attach click listeners
    boardEl.querySelectorAll('.game-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            handleCellClick(parseInt(cell.dataset.row), parseInt(cell.dataset.col));
        });
    });
}

function updateHeader() {
    const timerEl = document.getElementById('gameTimer');
    const coinsEl = document.getElementById('gameCoins');
    const comboEl = document.getElementById('gameCombo');

    if (timerEl) {
        const m = Math.floor(timeLeft / 60);
        const s = timeLeft % 60;
        timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
        timerEl.className = 'game-timer' + (timeLeft <= 10 ? ' warning' : '');
    }
    if (coinsEl) coinsEl.textContent = `💰 ${coinsEarned}`;
    if (comboEl) {
        if (comboCount > 1) {
            comboEl.textContent = `Combo x${(0.5 + comboCount * 0.5).toFixed(1)} 🔥`;
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
    boardEl.innerHTML += `
    <div class="game-overlay">
        <h2>Час вийшов!</h2>
        <div class="final-score">${coinsEarned}</div>
        <div class="final-coins">монет зароблено 💰</div>
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

    // Check status
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
            <div id="gameTimer" class="game-timer">1:00</div>
            <div id="gameCoins" class="game-coins">💰 0</div>
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
                    <button class="game-start-btn" onclick="startGame()">▶️ Почати гру</button>
                </div>
            `}
        </div>

        <div id="gameCombo" class="game-combo"></div>

        <div class="game-footer">
            <div class="game-best">Рекорд: ${bestScore} 💰</div>
            <div style="color:var(--gray-500);font-size:var(--font-sm)">Ігор сьогодні: ${todayGames}/${gameStatus?.maxDaily || 5}</div>
        </div>
    </div>`;

    // Cooldown timer
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
    coinsEarned = 0;
    comboCount = 0;
    gameActive = true;
    renderBoard();
    updateHeader();
    startTimer();
}

document.addEventListener('DOMContentLoaded', initGamePage);
