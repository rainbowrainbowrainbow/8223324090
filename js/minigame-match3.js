/**
 * minigame-match3.js — Match-3 Mystic Edition (Park themed)
 * v22.11.0 — Tarot cards, variable boards, boss variety, random events, epic animations
 */

// ==========================================
// TAROT CARDS — Pre-game modifier selection
// ==========================================
const TAROT_CARDS = [
    { id: 'tiny',       emoji: '🔮', name: 'Мініатюра',     desc: 'Поле 7×7 — компактний хаос', color: '#8b5cf6', effect: { boardSize: 7 } },
    { id: 'normal',     emoji: '⚖️', name: 'Баланс',        desc: 'Класичне поле 9×9',          color: '#6b7280', effect: { boardSize: 9 } },
    { id: 'mega',       emoji: '🏰', name: 'Колосеум',      desc: 'Поле 11×11 — епічний масштаб', color: '#dc2626', effect: { boardSize: 11 } },
    { id: 'time_lord',  emoji: '⏳', name: 'Володар часу',   desc: '+40 секунд до гри',          color: '#0891b2', effect: { extraTime: 40 } },
    { id: 'speed',      emoji: '⚡', name: 'Блискавка',      desc: '45 секунд, але x2 очки',     color: '#eab308', effect: { time: 45, scoreMultiplier: 2 } },
    { id: 'ice_storm',  emoji: '🧊', name: 'Крижана буря',  desc: '25% поля у кризі',           color: '#38bdf8', effect: { frozenPercent: 0.25 } },
    { id: 'no_ice',     emoji: '☀️', name: 'Спека',          desc: 'Жодного льоду!',             color: '#f97316', effect: { frozenPercent: 0, noFrozenSpawn: true } },
    { id: 'treasure',   emoji: '💎', name: 'Скарби',         desc: 'Спецблоки з 3 в ряд!',       color: '#a855f7', effect: { easySpecials: true } },
    { id: 'chaos',      emoji: '🌪️', name: 'Хаос',          desc: '9 типів фігурок',            color: '#ef4444', effect: { extraPieces: true } },
    { id: 'focus',      emoji: '🎯', name: 'Фокус',         desc: 'Лише 5 типів — легше!',      color: '#22c55e', effect: { fewerPieces: true } },
    { id: 'gold_rush',  emoji: '💰', name: 'Золота лихоманка', desc: 'x2 монети',               color: '#f59e0b', effect: { coinMultiplier: 2 } },
    { id: 'volcano',    emoji: '🌋', name: 'Вулкан',        desc: 'Вибухи кожні 12 сек!',       color: '#dc2626', effect: { volcanoInterval: 12 } },
    { id: 'ghost',      emoji: '👻', name: 'Привиди',       desc: '15% фігурок приховані',       color: '#6366f1', effect: { ghostPercent: 0.15 } },
    { id: 'minefield',  emoji: '💣', name: 'Мінне поле',    desc: 'Випадкові бомби на старті',   color: '#b91c1c', effect: { startBombs: 6 } },
    { id: 'gravity',    emoji: '🪐', name: 'Гравітація',    desc: 'Фігурки падають вбік!',       color: '#7c3aed', effect: { sideGravity: true } },
    { id: 'double_up',  emoji: '🎲', name: 'Подвійний куш', desc: 'x1.5 очки, x0.5 часу',       color: '#ec4899', effect: { scoreMultiplier: 1.5, timeMultiplier: 0.5 } },
];

// ==========================================
// BOSS TYPES
// ==========================================
const BOSS_TYPES = [
    {
        id: 'frost_king',   name: '❄️ Крижаний Король',  color: '#38bdf8',
        desc: 'Заморожує 3 клітинки кожні 10 сек',
        target: 250, time: 90,
        mechanic: 'freeze_timer', interval: 10, freezeCount: 3
    },
    {
        id: 'lava_beast',   name: '🔥 Лавовий Звір',     color: '#ef4444',
        desc: 'Знищує нижній ряд кожні 15 сек',
        target: 280, time: 90,
        mechanic: 'destroy_row', interval: 15
    },
    {
        id: 'shadow_lord',  name: '👁️ Тіньовий Лорд',    color: '#6366f1',
        desc: 'Приховує 20% фігурок, набери 200 щоб перемогти',
        target: 200, time: 80,
        mechanic: 'ghost_tiles', ghostPercent: 0.2
    },
    {
        id: 'time_eater',   name: '⏰ Пожирач Часу',     color: '#a855f7',
        desc: 'Кожне невдале переміщення -5 сек!',
        target: 220, time: 75,
        mechanic: 'time_penalty', penalty: 5
    },
    {
        id: 'chaos_dragon', name: '🐉 Дракон Хаосу',     color: '#dc2626',
        desc: 'Перемішує 10 клітинок кожні 8 сек',
        target: 300, time: 95,
        mechanic: 'shuffle_timer', interval: 8, shuffleCount: 10
    }
];

// ==========================================
// RANDOM MID-GAME EVENTS
// ==========================================
const RANDOM_EVENTS = [
    { id: 'meteor',      emoji: '☄️', name: 'Метеорит!',       desc: 'Вибух 5×5 в центрі!',          duration: 0, effect: 'meteor_strike' },
    { id: 'freeze_wave', emoji: '🌊', name: 'Крижана хвиля',   desc: 'Ряд замерзає!',                 duration: 0, effect: 'freeze_row' },
    { id: 'rainbow_rain',emoji: '🌈', name: 'Веселковий дощ',  desc: 'Усі фігурки одного типу зникають', duration: 0, effect: 'clear_type' },
    { id: 'time_bonus',  emoji: '⏰', name: 'Бонус часу!',     desc: '+10 секунд',                    duration: 0, effect: 'add_time' },
    { id: 'shuffle',     emoji: '🎰', name: 'Перемішування!',  desc: 'Дошка перемішується',            duration: 0, effect: 'shuffle_board' },
    { id: 'bomb_rain',   emoji: '💣', name: 'Дощ бомб!',       desc: '3 випадкові бомби на дошці',     duration: 0, effect: 'spawn_bombs' },
    { id: 'score_frenzy',emoji: '🤑', name: 'Шаленство очок!', desc: 'x3 очки на 10 секунд',          duration: 10, effect: 'score_boost' },
    { id: 'slow_mo',     emoji: '🐌', name: 'Уповільнення',    desc: 'Таймер на паузі 5 сек',          duration: 5, effect: 'pause_timer' },
];

// ==========================================
// CONSTANTS
// ==========================================
let BOARD_COLS = 9;
let BOARD_ROWS = 9;
const BASE_GAME_TIME = 75;
let GAME_TIME = BASE_GAME_TIME;
const MAX_COINS = 50;

const ASSET_PATH = 'assets/match3/';
const BASE_PIECES = [
    { id: 'dino',    emoji: '🦕', img: ASSET_PATH + 'dino.png' },
    { id: 'balloon', emoji: '🎈', img: ASSET_PATH + 'balloon.png' },
    { id: 'cake',    emoji: '🎂', img: ASSET_PATH + 'cake.png' },
    { id: 'mask',    emoji: '🎭', img: ASSET_PATH + 'mask.png' },
    { id: 'star',    emoji: '⭐', img: ASSET_PATH + 'star.png' },
    { id: 'tent',    emoji: '🎪', img: ASSET_PATH + 'tent.png' },
    { id: 'clown',   emoji: '🤡', img: ASSET_PATH + 'clown.png' },
];
const EXTRA_PIECES = [
    { id: 'rocket',  emoji: '🚀', img: ASSET_PATH + 'rocket.png' },
    { id: 'gem',     emoji: '💎', img: ASSET_PATH + 'gem.png' },
];

let PIECES = [...BASE_PIECES];

const SPECIAL_TYPES = {
    bomb:      { emoji: '💣', img: ASSET_PATH + 'bomb.png', bonus: 20, label: 'Бомба', desc: '3×3 вибух' },
    lightning: { emoji: '⚡', img: ASSET_PATH + 'lightning.png', bonus: 40, label: 'Блискавка', desc: 'весь рядок' },
    cross:     { emoji: '✦', img: ASSET_PATH + 'cross.png', bonus: 50, label: 'Хрест', desc: 'рядок + стовпець' },
    rainbow:   { emoji: '🌈', img: ASSET_PATH + 'rainbow.png', bonus: 60, label: 'Веселка', desc: 'всі такого типу' }
};

const COMBO_LEVELS = [
    null,
    { label: '', color: '' },
    { label: 'x1.0!', color: '#f59e0b', emoji: '🔥', shake: 1, particles: 4 },
    { label: 'x1.5!', color: '#ef4444', emoji: '💥', shake: 2, particles: 8 },
    { label: 'x2.0!', color: '#a855f7', emoji: '🌟', shake: 3, particles: 14, flash: 'purple' },
    { label: 'x2.5!', color: '#3b82f6', emoji: '⚡', shake: 4, particles: 20, flash: 'blue' },
    { label: 'x3.0!!', color: '#ef4444', emoji: '🔥🌈🔥', shake: 6, particles: 30, flash: 'rainbow', mega: true },
];

let FROZEN_SPAWN_CHANCE = 0.06;

// ==========================================
// STATE
// ==========================================
let board = [];
let frozenMap = [];
let ghostMap = [];
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
let activeBoss = null;
let bossInterval = null;
let activeModifier = null;
let scoreMultiplier = 1;
let coinMultiplier = 1;
let eventScoreBoost = 1;
let timerPaused = false;
let eventTimers = [];
let nextEventTime = 0;
let failedSwaps = 0;

const BOSS_TIME = 90;
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

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ==========================================
// BOARD LOGIC
// ==========================================
function createBoard() {
    const b = [];
    frozenMap = [];
    ghostMap = [];
    const frozenPercent = activeModifier?.effect?.frozenPercent ?? 0.08;
    const ghostPercent = activeModifier?.effect?.ghostPercent || (activeBoss?.mechanic === 'ghost_tiles' ? activeBoss.ghostPercent : 0);

    for (let r = 0; r < BOARD_ROWS; r++) {
        b[r] = [];
        frozenMap[r] = [];
        ghostMap[r] = [];
        for (let c = 0; c < BOARD_COLS; c++) {
            let piece, attempts = 0;
            do { piece = randomPiece(); attempts++; } while (hasMatchAt(b, r, c, piece) && attempts < 50);
            b[r][c] = piece;
            frozenMap[r][c] = 0;
            ghostMap[r][c] = Math.random() < ghostPercent;
        }
    }

    // Seed frozen tiles
    if (frozenPercent > 0 && !activeModifier?.effect?.noFrozenSpawn) {
        let frozenCount = 0;
        const maxFrozen = Math.floor(BOARD_ROWS * BOARD_COLS * frozenPercent);
        while (frozenCount < maxFrozen) {
            const r = Math.floor(Math.random() * BOARD_ROWS);
            const c = Math.floor(Math.random() * BOARD_COLS);
            if (frozenMap[r][c] === 0) {
                frozenMap[r][c] = 2;
                frozenCount++;
            }
        }
    }

    // Start bombs from modifier
    if (activeModifier?.effect?.startBombs) {
        let placed = 0;
        while (placed < activeModifier.effect.startBombs) {
            const r = Math.floor(Math.random() * BOARD_ROWS);
            const c = Math.floor(Math.random() * BOARD_COLS);
            if (!b[r][c].special) {
                b[r][c].special = 'bomb';
                placed++;
            }
        }
    }

    return b;
}

function findMatchGroups(b) {
    const groups = [];
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
    const easySpecials = activeModifier?.effect?.easySpecials;

    for (const lt of ltShapes) {
        const pos = lt.intersectionCell;
        specials.push({ row: pos.row, col: pos.col, type: 'rainbow', id: board[pos.row][pos.col]?.id || 'star' });
    }

    for (let i = 0; i < groups.length; i++) {
        if (usedGroups.has(i)) continue;
        const g = groups[i];
        if (g.length >= 6) {
            const pos = pickSpecialPosition(g.cells, swapTarget);
            specials.push({ row: pos.row, col: pos.col, type: 'cross', id: board[pos.row][pos.col]?.id || 'star' });
        } else if (g.length >= 5) {
            const pos = pickSpecialPosition(g.cells, swapTarget);
            specials.push({ row: pos.row, col: pos.col, type: 'lightning', id: board[pos.row][pos.col]?.id || 'star' });
        } else if (g.length === 4) {
            const pos = pickSpecialPosition(g.cells, swapTarget);
            specials.push({ row: pos.row, col: pos.col, type: 'bomb', id: board[pos.row][pos.col]?.id || 'star' });
        } else if (g.length === 3 && easySpecials) {
            // Easy specials: 30% chance to get a bomb from 3-match
            if (Math.random() < 0.3) {
                const pos = pickSpecialPosition(g.cells, swapTarget);
                specials.push({ row: pos.row, col: pos.col, type: 'bomb', id: board[pos.row][pos.col]?.id || 'star' });
            }
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
        if (frozenMap[c.row][c.col] > 0) {
            frozenMap[c.row][c.col]--;
            if (frozenMap[c.row][c.col] > 0) continue;
        }
        b[c.row][c.col] = null;
        ghostMap[c.row][c.col] = false;
    }
}

function applyGravity(b) {
    const fallen = [];
    const noFrozenSpawn = activeModifier?.effect?.noFrozenSpawn;

    if (activeModifier?.effect?.sideGravity) {
        // Side gravity: pieces fall LEFT instead of down
        for (let r = 0; r < BOARD_ROWS; r++) {
            let writeCol = 0;
            for (let c = 0; c < BOARD_COLS; c++) {
                if (b[r][c]) {
                    if (c !== writeCol) {
                        b[r][writeCol] = b[r][c];
                        frozenMap[r][writeCol] = frozenMap[r][c];
                        ghostMap[r][writeCol] = ghostMap[r][c];
                        b[r][c] = null;
                        frozenMap[r][c] = 0;
                        ghostMap[r][c] = false;
                        fallen.push({ row: r, col: writeCol });
                    }
                    writeCol++;
                }
            }
            for (let c = writeCol; c < BOARD_COLS; c++) {
                b[r][c] = randomPiece();
                frozenMap[r][c] = 0;
                ghostMap[r][c] = false;
                if (!noFrozenSpawn && Math.random() < FROZEN_SPAWN_CHANCE) frozenMap[r][c] = 2;
                fallen.push({ row: r, col: c });
            }
        }
        return fallen;
    }

    for (let c = 0; c < BOARD_COLS; c++) {
        let writeRow = BOARD_ROWS - 1;
        for (let r = BOARD_ROWS - 1; r >= 0; r--) {
            if (b[r][c]) {
                if (r !== writeRow) {
                    b[writeRow][c] = b[r][c];
                    frozenMap[writeRow][c] = frozenMap[r][c];
                    ghostMap[writeRow][c] = ghostMap[r][c];
                    b[r][c] = null;
                    frozenMap[r][c] = 0;
                    ghostMap[r][c] = false;
                    fallen.push({ row: writeRow, col: c });
                }
                writeRow--;
            }
        }
        for (let r = writeRow; r >= 0; r--) {
            b[r][c] = randomPiece();
            frozenMap[r][c] = 0;
            ghostMap[r][c] = false;
            if (!noFrozenSpawn && Math.random() < FROZEN_SPAWN_CHANCE) frozenMap[r][c] = 2;
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
// RANDOM EVENTS (mid-game)
// ==========================================
function scheduleNextEvent() {
    if (!gameActive) return;
    nextEventTime = timeLeft - (12 + Math.floor(Math.random() * 10)); // every 12-22 seconds
}

function checkForRandomEvent() {
    if (!gameActive || animating || isBossMode) return;
    if (timeLeft <= nextEventTime && nextEventTime > 5) {
        triggerRandomEvent();
        scheduleNextEvent();
    }
}

async function triggerRandomEvent() {
    const event = RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
    showEventBanner(event);

    switch (event.effect) {
        case 'meteor_strike': {
            const cr = Math.floor(BOARD_ROWS / 2);
            const cc = Math.floor(BOARD_COLS / 2);
            const toRemove = [];
            for (let dr = -2; dr <= 2; dr++) {
                for (let dc = -2; dc <= 2; dc++) {
                    const nr = cr + dr, nc = cc + dc;
                    if (nr >= 0 && nr < BOARD_ROWS && nc >= 0 && nc < BOARD_COLS) {
                        toRemove.push({ row: nr, col: nc });
                    }
                }
            }
            animating = true;
            renderBoard(toRemove);
            spawnMeteorEffect(cr, cc);
            screenShake(5);
            await sleep(400);
            removeMatches(board, toRemove);
            applyGravity(board);
            renderBoard([], true);
            await sleep(200);
            animating = false;
            if (gameActive) await processCascade();
            break;
        }
        case 'freeze_row': {
            const r = Math.floor(Math.random() * BOARD_ROWS);
            for (let c = 0; c < BOARD_COLS; c++) frozenMap[r][c] = 2;
            renderBoard();
            break;
        }
        case 'clear_type': {
            const typeIdx = Math.floor(Math.random() * PIECES.length);
            const targetId = PIECES[typeIdx].id;
            const toRemove = [];
            for (let r = 0; r < BOARD_ROWS; r++) {
                for (let c = 0; c < BOARD_COLS; c++) {
                    if (board[r][c]?.id === targetId) toRemove.push({ row: r, col: c });
                }
            }
            animating = true;
            renderBoard(toRemove);
            await sleep(350);
            removeMatches(board, toRemove);
            totalScore += toRemove.length * 2;
            applyGravity(board);
            renderBoard([], true);
            await sleep(200);
            animating = false;
            updateHeader();
            if (gameActive) await processCascade();
            break;
        }
        case 'add_time':
            timeLeft += 10;
            updateHeader();
            break;
        case 'shuffle_board': {
            const allPieces = [];
            for (let r = 0; r < BOARD_ROWS; r++) {
                for (let c = 0; c < BOARD_COLS; c++) {
                    if (board[r][c]) allPieces.push(board[r][c]);
                }
            }
            const shuffled = shuffleArray(allPieces);
            let idx = 0;
            for (let r = 0; r < BOARD_ROWS; r++) {
                for (let c = 0; c < BOARD_COLS; c++) {
                    if (board[r][c]) board[r][c] = shuffled[idx++];
                }
            }
            renderBoard([], true);
            break;
        }
        case 'spawn_bombs': {
            let placed = 0;
            while (placed < 3) {
                const r = Math.floor(Math.random() * BOARD_ROWS);
                const c = Math.floor(Math.random() * BOARD_COLS);
                if (board[r][c] && !board[r][c].special) {
                    board[r][c].special = 'bomb';
                    placed++;
                }
            }
            renderBoard();
            break;
        }
        case 'score_boost':
            eventScoreBoost = 3;
            setTimeout(() => { eventScoreBoost = 1; }, event.duration * 1000);
            break;
        case 'pause_timer':
            timerPaused = true;
            setTimeout(() => { timerPaused = false; }, event.duration * 1000);
            break;
    }
}

function showEventBanner(event) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;
    const banner = document.createElement('div');
    banner.className = 'event-banner';
    banner.innerHTML = `<span class="event-emoji">${event.emoji}</span><span class="event-text"><b>${event.name}</b><br>${event.desc}</span>`;
    boardEl.appendChild(banner);
    setTimeout(() => banner.remove(), 2500);
}

function spawnMeteorEffect(row, col) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;
    const meteor = document.createElement('div');
    meteor.className = 'meteor-effect';
    const cell = boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (!cell) return;
    const rect = cell.getBoundingClientRect();
    const boardRect = boardEl.getBoundingClientRect();
    meteor.style.left = (rect.left - boardRect.left + rect.width / 2) + 'px';
    meteor.style.top = (rect.top - boardRect.top + rect.height / 2) + 'px';
    boardEl.appendChild(meteor);
    setTimeout(() => meteor.remove(), 800);
}

// ==========================================
// BOSS MECHANICS
// ==========================================
function startBossMechanic() {
    if (!activeBoss) return;
    const b = activeBoss;

    if (b.mechanic === 'freeze_timer') {
        bossInterval = setInterval(() => {
            if (!gameActive) return;
            let frozen = 0;
            while (frozen < b.freezeCount) {
                const r = Math.floor(Math.random() * BOARD_ROWS);
                const c = Math.floor(Math.random() * BOARD_COLS);
                if (frozenMap[r][c] === 0) {
                    frozenMap[r][c] = 2;
                    frozen++;
                }
            }
            showEventBanner({ emoji: '❄️', name: 'Крижаний Король', desc: `Заморозив ${b.freezeCount} клітинки!` });
            renderBoard();
        }, b.interval * 1000);
    } else if (b.mechanic === 'destroy_row') {
        bossInterval = setInterval(() => {
            if (!gameActive || animating) return;
            const lastRow = BOARD_ROWS - 1;
            for (let c = 0; c < BOARD_COLS; c++) board[lastRow][c] = null;
            showEventBanner({ emoji: '🔥', name: 'Лавовий Звір', desc: 'Знищив нижній ряд!' });
            applyGravity(board);
            renderBoard([], true);
        }, b.interval * 1000);
    } else if (b.mechanic === 'shuffle_timer') {
        bossInterval = setInterval(() => {
            if (!gameActive || animating) return;
            let shuffled = 0;
            while (shuffled < b.shuffleCount) {
                const r1 = Math.floor(Math.random() * BOARD_ROWS);
                const c1 = Math.floor(Math.random() * BOARD_COLS);
                const r2 = Math.floor(Math.random() * BOARD_ROWS);
                const c2 = Math.floor(Math.random() * BOARD_COLS);
                if (board[r1][c1] && board[r2][c2]) {
                    swapCells(board, r1, c1, r2, c2);
                    shuffled++;
                }
            }
            showEventBanner({ emoji: '🐉', name: 'Дракон Хаосу', desc: 'Перемішав клітинки!' });
            renderBoard([], true);
        }, b.interval * 1000);
    }
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
        p.style.cssText = `left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;background:${color || '#f59e0b'};--dx:${dx}px;--dy:${dy}px;`;
        boardEl.appendChild(p);
        setTimeout(() => p.remove(), 700);
    }
}

function spawnExplosionParticles(row, col, type) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;
    const cell = boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (!cell) return;
    const colors = { bomb: '#ef4444', lightning: '#eab308', cross: '#3b82f6', rainbow: '#a855f7' };
    spawnParticles(type === 'cross' ? 24 : type === 'rainbow' ? 20 : 12, cell, colors[type] || '#f59e0b');
}

function screenShake(intensity) {
    const page = document.querySelector('.game-page');
    if (!page) return;
    page.style.animation = 'none';
    page.offsetHeight;
    page.style.animation = `screen-shake ${0.15 + intensity * 0.05}s ease`;
    page.style.setProperty('--shake-px', (intensity * 2) + 'px');
}

function screenFlash(color) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;
    const flash = document.createElement('div');
    flash.className = 'screen-flash';
    if (color === 'rainbow') flash.classList.add('rainbow-flash');
    else flash.style.background = color || 'rgba(255,255,255,0.3)';
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
        const roundScore = Math.round((baseScore + bonusScore) * multiplier * scoreMultiplier * eventScoreBoost);
        cascadeScore += roundScore;

        if (comboCount >= 2) {
            const level = Math.min(comboCount, COMBO_LEVELS.length - 1);
            const cfg = COMBO_LEVELS[level];
            if (cfg) {
                showComboPopup(comboCount, multiplier, cfg);
                if (cfg.shake) screenShake(cfg.shake);
                if (cfg.flash) screenFlash(cfg.flash === 'rainbow' ? 'rainbow' : cfg.flash === 'purple' ? 'rgba(168,85,247,0.25)' : 'rgba(59,130,246,0.25)');
            }
        }

        if (activation.activatedSpecials.length > 0) {
            renderBoard([], false, activation.activatedSpecials);
            for (const sp of activation.activatedSpecials) {
                spawnExplosionParticles(sp.row, sp.col, sp.type);
                // v38.9.0: Show bonus banner for each special
                const spDef = SPECIAL_TYPES[sp.type];
                if (spDef) showBonusBanner(spDef.emoji, `${spDef.label}: ${spDef.desc}!`);
            }
            await sleep(250);
        }

        renderBoard(toRemove);
        // Add combo-level animation classes
        if (comboCount >= 2) {
            const boardEl = document.getElementById('gameBoard');
            if (boardEl) {
                const comboClass = comboCount >= 5 ? 'combo-epic' : comboCount >= 3 ? 'combo-spin' : 'combo-enhanced';
                toRemove.forEach(m => {
                    const cell = boardEl.querySelector(`[data-row="${m.row}"][data-col="${m.col}"]`);
                    if (cell) cell.classList.add(comboClass);
                });
            }
        }
        await sleep(280);
        removeMatches(board, toRemove);
        renderBoard();
        await sleep(80);

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
    const maxCoins = MAX_COINS * coinMultiplier;
    coinsEarned = Math.min(Math.floor(totalScore / 10), maxCoins);
    comboCount = 0;
    animating = false;

    if (!gameActive) { endGame(); return; }
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
            failedSwaps++;
            // Boss: time penalty on failed swap
            if (activeBoss?.mechanic === 'time_penalty') {
                timeLeft = Math.max(1, timeLeft - activeBoss.penalty);
                showEventBanner({ emoji: '⏰', name: 'Пожирач Часу', desc: `-${activeBoss.penalty} секунд!` });
                updateHeader();
            }
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
    timerInterval = setInterval(() => {
        if (timerPaused) return;
        timeLeft--;
        updateHeader();
        checkForRandomEvent();

        // Volcano modifier: random explosion
        if (activeModifier?.effect?.volcanoInterval) {
            if (timeLeft > 0 && timeLeft % activeModifier.effect.volcanoInterval === 0 && !animating) {
                const r = Math.floor(Math.random() * BOARD_ROWS);
                const c = Math.floor(Math.random() * BOARD_COLS);
                const toRemove = [];
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < BOARD_ROWS && nc >= 0 && nc < BOARD_COLS) toRemove.push({ row: nr, col: nc });
                    }
                }
                showEventBanner({ emoji: '🌋', name: 'Вулкан!', desc: 'Вибух!' });
                screenShake(3);
                removeMatches(board, toRemove);
                applyGravity(board);
                renderBoard([], true);
            }
        }

        if (timeLeft <= 0) endGame();
    }, 1000);
}

async function endGame() {
    gameActive = false;
    clearInterval(timerInterval);
    if (bossInterval) { clearInterval(bossInterval); bossInterval = null; }
    eventTimers.forEach(t => clearTimeout(t));
    eventTimers = [];

    if (animating) return;
    renderGameOver();

    try {
        if (isBossMode) {
            const r = await apiFetchWithAuthRetry('/api/minigame/boss/complete', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ score: totalScore })
            });
            const data = await r.json();
            if (data.error) console.warn('Boss submit:', data.error);
        } else {
            const r = await apiFetchWithAuthRetry('/api/minigame/complete', {
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

    // Update grid columns for variable board size
    boardEl.style.gridTemplateColumns = `repeat(${BOARD_COLS}, 1fr)`;

    let html = '';
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const piece = board[r][c];
            const isSelected = selected && selected.row === r && selected.col === c;
            const isMatched = matchSet.has(`${r},${c}`);
            const activationType = specialActivationMap[`${r},${c}`];
            const frozen = frozenMap[r]?.[c] || 0;
            const isGhost = ghostMap[r]?.[c] || false;
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
            if (isGhost) classes.push('ghost-tile');

            let content = '';
            if (isGhost) {
                content = '❓';
            } else if (piece?.img) {
                content = `<img src="${piece.img}" class="piece-img" alt="${piece.id}" onerror="this.replaceWith(document.createTextNode('${piece.emoji}'))">`;
            } else {
                content = piece?.emoji || '';
            }
            if (piece?.special && SPECIAL_TYPES[piece.special] && !isGhost) {
                const sp = SPECIAL_TYPES[piece.special];
                content += sp.img 
                    ? `<span class="special-indicator"><img src="${sp.img}" class="special-img" onerror="this.replaceWith(document.createTextNode('${sp.emoji}'))"></span>`
                    : `<span class="special-indicator">${sp.emoji}</span>`;
            }
            if (frozen > 0) {
                content += `<span class="ice-overlay">${frozen === 2 ? '❄️' : '💧'}</span>`;
            }

            const pieceId = piece?.id || '';
            const specialAttr = piece?.special ? ` data-special="${piece.special}" data-special-label="${SPECIAL_TYPES[piece.special]?.label || ''}: ${SPECIAL_TYPES[piece.special]?.desc || ''}"` : '';
            html += `<div class="${classes.join(' ')}" data-row="${r}" data-col="${c}" data-piece-id="${pieceId}"${specialAttr}>${content}</div>`;
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

    if (cfg.particles) {
        const center = boardEl.querySelector(`[data-row="${Math.floor(BOARD_ROWS/2)}"][data-col="${Math.floor(BOARD_COLS/2)}"]`);
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
        timerEl.className = 'game-timer' + (timeLeft <= 10 ? ' warning' : '') + (timerPaused ? ' paused' : '');
    }
    if (scoreEl) scoreEl.textContent = totalScore;
    if (coinsEl) coinsEl.textContent = `${coinsEarned}/${MAX_COINS * coinMultiplier}`;
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

    // Boss HP bar
    if (isBossMode && activeBoss) {
        const hpBar = document.getElementById('bossHpBar');
        if (hpBar) {
            const pct = Math.min((totalScore / activeBoss.target) * 100, 100);
            hpBar.style.width = pct + '%';
            hpBar.style.background = pct >= 100 ? '#22c55e' : activeBoss.color;
        }
        const hpText = document.getElementById('bossHpText');
        if (hpText) hpText.textContent = `${totalScore} / ${activeBoss.target}`;
    }
}

function renderGameOverActions() {
    return `
        <div class="go-actions">
            <button class="game-btn game-btn-primary go-action-primary" onclick="location.reload()">🔄 Ще раз</button>
            <button class="game-btn game-btn-overlay-secondary" onclick="location.href='/profile'">👤 Профіль</button>
            <button class="game-btn game-btn-overlay-secondary" onclick="location.href='/room'">🏠 Кімната</button>
        </div>
    `;
}

function renderGameOver() {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;

    if (isBossMode && activeBoss) {
        const won = totalScore >= activeBoss.target;
        const bossCoins = won ? Math.min(Math.floor(totalScore / 10) * 3, 150) : 0;

        boardEl.innerHTML += `
        <div class="game-overlay ${won ? 'victory' : 'defeat'}">
            <div class="go-particles"></div>
            <h2 class="go-title">${won ? '🏆 Перемога!' : '💀 Не вдалось...'}</h2>
            <div class="go-boss-name">${activeBoss.name}</div>
            <div class="go-score-ring ${won ? 'won' : ''}">
                <span class="go-score-value">${totalScore}</span>
                <span class="go-score-target">/ ${activeBoss.target}</span>
            </div>
            ${won ? `<div class="go-coins-earned">+${bossCoins} монет 💰 <span class="go-multiplier">x3!</span></div>` : '<div class="go-hint">Спробуй наступної неділі</div>'}
            ${maxCombo >= 3 ? `<div class="go-combo">Макс. комбо: x${Math.min(0.5 + maxCombo * 0.5, 3).toFixed(1)} 🔥</div>` : ''}
            ${renderGameOverActions()}
        </div>`;
        return;
    }

    const stars = totalScore >= 400 ? 3 : totalScore >= 200 ? 2 : totalScore >= 80 ? 1 : 0;

    boardEl.innerHTML += `
    <div class="game-overlay ${stars >= 3 ? 'epic-victory' : ''}">
        <div class="go-particles"></div>
        <h2 class="go-title">🎉 Час вийшов!</h2>
        <div class="go-stars">
            ${[0,1,2].map(i => `<span class="go-star ${i < stars ? 'filled' : ''}" style="animation-delay:${i * 0.15}s">${i < stars ? '⭐' : '☆'}</span>`).join('')}
        </div>
        ${activeModifier ? `<div class="go-modifier">${activeModifier.emoji} ${activeModifier.name}</div>` : ''}
        <div class="go-score-ring">
            <span class="go-score-value">${totalScore}</span>
        </div>
        <div class="go-coins-earned">+${coinsEarned} монет 💰</div>
        ${maxCombo >= 3 ? `<div class="go-combo">Макс. комбо: x${Math.min(0.5 + maxCombo * 0.5, 3).toFixed(1)} 🔥</div>` : ''}
        ${renderGameOverActions()}
    </div>`;
}

// ==========================================
// TAROT CARD SELECTION UI
// ==========================================
function drawTarotCards() {
    const shuffled = shuffleArray(TAROT_CARDS);
    return shuffled.slice(0, 3);
}

function renderTarotSelection(cards) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;

    boardEl.innerHTML = `
    <div class="tarot-selection">
        <div class="tarot-header">
            <div class="tarot-glow"></div>
            <h2 class="tarot-title">🔮 Обери свою долю</h2>
            <p class="tarot-subtitle">Кожна карта змінює правила гри</p>
        </div>
        <div class="tarot-cards">
            ${cards.map((card, i) => `
                <div class="tarot-card" data-index="${i}" style="--card-color:${card.color};animation-delay:${i * 0.12}s">
                    <div class="tarot-card-inner">
                        <div class="tarot-card-front">
                            <div class="tarot-card-glow"></div>
                            <div class="tarot-emoji">${card.emoji}</div>
                            <div class="tarot-name">${card.name}</div>
                            <div class="tarot-desc">${card.desc}</div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
        <button class="game-btn game-btn-ghost tarot-skip" onclick="startGameWithModifier(null)">
            Без модифікатора →
        </button>
    </div>`;

    boardEl.querySelectorAll('.tarot-card').forEach((el, i) => {
        el.addEventListener('click', () => {
            el.classList.add('tarot-chosen');
            boardEl.querySelectorAll('.tarot-card').forEach((other, j) => {
                if (j !== i) other.classList.add('tarot-dismissed');
            });
            setTimeout(() => startGameWithModifier(cards[i]), 600);
        });
    });
}

function startGameWithModifier(modifier) {
    activeModifier = modifier;
    scoreMultiplier = modifier?.effect?.scoreMultiplier || 1;
    coinMultiplier = modifier?.effect?.coinMultiplier || 1;
    eventScoreBoost = 1;
    timerPaused = false;
    failedSwaps = 0;

    // Apply board size
    const size = modifier?.effect?.boardSize || 9;
    BOARD_COLS = size;
    BOARD_ROWS = size;

    // Apply pieces
    if (modifier?.effect?.extraPieces) {
        PIECES = [...BASE_PIECES, ...EXTRA_PIECES];
    } else if (modifier?.effect?.fewerPieces) {
        PIECES = BASE_PIECES.slice(0, 5);
    } else {
        PIECES = [...BASE_PIECES];
    }

    // Apply frozen spawn
    if (modifier?.effect?.noFrozenSpawn) FROZEN_SPAWN_CHANCE = 0;
    else FROZEN_SPAWN_CHANCE = 0.06;

    // Apply time
    if (modifier?.effect?.time) {
        GAME_TIME = modifier.effect.time;
    } else if (modifier?.effect?.extraTime) {
        GAME_TIME = BASE_GAME_TIME + modifier.effect.extraTime;
    } else if (modifier?.effect?.timeMultiplier) {
        GAME_TIME = Math.round(BASE_GAME_TIME * modifier.effect.timeMultiplier);
    } else {
        GAME_TIME = BASE_GAME_TIME;
    }

    isBossMode = false;
    activeBoss = null;
    board = createBoard();
    selected = null;
    totalScore = 0;
    coinsEarned = 0;
    comboCount = 0;
    maxCombo = 0;
    lastSwap = null;
    gameActive = true;
    gamePausedByUser = false;
    timeLeft = GAME_TIME;
    nextEventTime = 0;
    // Show pause button
    const pauseBtn = document.getElementById('gamePauseBtn');
    if (pauseBtn) pauseBtn.style.display = '';

    renderBoard();
    updateHeader();
    startTimer();
    scheduleNextEvent();

    // Show active modifier indicator
    if (modifier) {
        const headerEl = document.querySelector('.game-header');
        if (headerEl) {
            const badge = document.createElement('div');
            badge.className = 'modifier-badge';
            badge.style.setProperty('--mod-color', modifier.color);
            badge.innerHTML = `${modifier.emoji}`;
            badge.title = `${modifier.name}: ${modifier.desc}`;
            headerEl.appendChild(badge);
        }
    }
}

// ==========================================
// INIT
// ==========================================
async function initGamePage() {
    if (localStorage.getItem('pzp_dark_mode') !== 'false') {
        document.body.classList.add('dark-mode');
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.style.colorScheme = 'dark';
    }
    const user = await apiVerifyToken();
    if (!user) { window.location.href = '/'; return; }
    if (typeof AppState !== 'undefined') AppState.currentUser = user;

    try {
        const [statusRes, recordsRes, bossRes] = await Promise.all([
            apiFetchWithAuthRetry('/api/minigame/status', { headers: getAuthHeaders(false) }),
            apiFetchWithAuthRetry('/api/minigame/daily-records', { headers: getAuthHeaders(false) }),
            apiFetchWithAuthRetry('/api/minigame/boss', { headers: getAuthHeaders(false) })
        ]);
        if (handleAuthError(statusRes)) return;
        gameStatus = await statusRes.json();
        if (recordsRes.ok) dailyRecords = await recordsRes.json();
        if (bossRes.ok) bossStatus = await bossRes.json();
    } catch (e) {
        console.error('Status error', e);
    }
    renderGameUI();
    if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
    else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
}

function renderGameUI() {
    const canPlay = gameStatus?.canPlay !== false;
    const cooldown = gameStatus?.cooldownLeft || 0;
    const todayGames = gameStatus?.todayGames || 0;
    const bestScore = gameStatus?.bestScore || 0;

    document.getElementById('mainApp').innerHTML = `
    <div class="game-page">
        <div class="game-topbar">
            <a href="/profile" class="game-back-link">← Назад</a>
            <div class="game-topbar-right">
                <span class="game-best-badge">🏆 ${bestScore}</span>
                <span class="game-plays-badge">${todayGames}/${gameStatus?.maxDaily || 5}</span>
            </div>
        </div>

        <div class="game-header">
            <div class="game-title">🎮 3 в ряд</div>
            <div id="gameScore" class="game-score">0</div>
            <div id="gameTimer" class="game-timer">—:——</div>
            <div class="game-coins-display">💰 <span id="gameCoinsValue">0/${MAX_COINS}</span></div>
            <button type="button" class="game-pause-btn" id="gamePauseBtn" title="Пауза" style="display:none" onclick="Match3.togglePause()">⏸</button>
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
                    <button class="game-btn game-btn-secondary" style="margin-top:16px;font-size:var(--font-sm);padding:8px 16px" onclick="resetMinigame()">🔄 Скинути кулдаун</button>
                </div>
            ` : `
                <div class="game-start-screen">
                    <div class="start-orb">
                        <div class="start-orb-ring"></div>
                        <span class="start-orb-icon">🎮</span>
                    </div>
                    <h3>Mystic Edition</h3>
                    <p class="start-subtitle">Обери карту долі · Рандомні події · Епічні боси</p>
                    <div class="game-feature-chips">
                        <span class="feature-chip">🔮 Карти Таро</span>
                        <span class="feature-chip">☄️ Рандомні події</span>
                        <span class="feature-chip">👹 5 типів босів</span>
                        <span class="feature-chip">🪐 Різні розміри</span>
                    </div>
                    <button class="game-btn game-btn-primary pulse" onclick="showTarotSelection()">▶️ Почати гру</button>
                </div>
            `}
        </div>

        <div id="gameCombo" class="game-combo"></div>

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

function showTarotSelection() {
    const cards = drawTarotCards();
    renderTarotSelection(cards);
}

// v38.9.0: Pause toggle
let gamePausedByUser = false;
function togglePause() {
    if (!gameActive) return;
    gamePausedByUser = !gamePausedByUser;
    timerPaused = gamePausedByUser;
    const btn = document.getElementById('gamePauseBtn');
    if (btn) btn.textContent = gamePausedByUser ? '▶' : '⏸';
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;
    // Remove existing overlay
    const existing = boardEl.querySelector('.game-paused-overlay');
    if (existing) existing.remove();
    if (gamePausedByUser) {
        const overlay = document.createElement('div');
        overlay.className = 'game-paused-overlay';
        overlay.innerHTML = '<div class="pause-icon">⏸</div><div class="pause-text">ПАУЗА</div><button type="button" class="resume-btn" onclick="togglePause()">Продовжити</button>';
        boardEl.appendChild(overlay);
    }
}
// Expose globally for onclick
window.togglePause = togglePause;
window.Match3 = { togglePause };

// v38.9.0: Bonus banner — animated notification
function showBonusBanner(emoji, text) {
    const boardEl = document.getElementById('gameBoard');
    if (!boardEl) return;
    const banner = document.createElement('div');
    banner.className = 'bonus-banner';
    banner.innerHTML = `<span class="bonus-emoji">${emoji}</span> ${text}`;
    boardEl.appendChild(banner);
    setTimeout(() => banner.remove(), 2200);
}

function startGame() {
    showTarotSelection();
}

function renderDailyRecords() {
    if (!dailyRecords) return '';
    const top3 = dailyRecords.top3 || [];
    const medals = ['🥇', '🥈', '🥉'];

    return `
    <div class="game-card" style="margin-top:16px">
        <div class="game-card-title">📊 Рекорди дня</div>
        ${top3.length === 0 ? '<div class="game-card-empty">Ще ніхто не грав сьогодні</div>' : ''}
        ${top3.map((r, i) => `
            <div class="game-record-row">
                <span class="record-medal">${medals[i]}</span>
                <span class="record-name">${r.name}</span>
                <span class="record-score">${r.score}</span>
                <span class="record-coins">💰${r.coins}</span>
            </div>
        `).join('')}
        <div class="game-card-footer">
            Сьогодні: <b>${dailyRecords.myBestToday || '—'}</b>
            · Рекорд: <b>${dailyRecords.myBestAllTime || '—'}</b>
        </div>
    </div>`;
}

function renderBossRound() {
    if (!bossStatus) return '';
    const { isBossDay, played, completed, score, coinsEarned: bossCoins, targetScore } = bossStatus;

    // Pick this week's boss (deterministic by week)
    const weekIdx = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)) % BOSS_TYPES.length;
    const boss = BOSS_TYPES[weekIdx];

    if (!isBossDay && !played) {
        return `
        <div class="game-card boss-card" style="margin-top:12px">
            <div class="game-card-title">${boss.name}</div>
            <div class="boss-preview">${boss.desc}</div>
            <div class="boss-schedule">Доступний щонеділі · ${boss.time} секунд · Нагорода x3</div>
        </div>`;
    }

    if (played) {
        return `
        <div class="game-card boss-card ${completed ? 'boss-won' : 'boss-lost'}" style="margin-top:12px">
            <div class="game-card-title">${boss.name} ${completed ? '✅' : '❌'}</div>
            <div class="boss-result">
                Рахунок: <b>${score}</b> / ${targetScore || boss.target}
                ${bossCoins > 0 ? ` · +${bossCoins} монет 💰` : ''}
            </div>
        </div>`;
    }

    return `
    <div class="game-card boss-card boss-available" style="margin-top:12px">
        <div class="boss-alert-glow"></div>
        <div class="game-card-title" style="color:${boss.color}">${boss.name}</div>
        <div class="boss-preview">${boss.desc}</div>
        <div class="boss-target">Набери ${boss.target}+ очок за ${boss.time} секунд · Нагорода x3</div>
        <button class="game-btn game-btn-danger" onclick="startBossRound()">
            ⚔️ Почати бос-раунд
        </button>
    </div>`;
}

function startBossRound() {
    const weekIdx = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)) % BOSS_TYPES.length;
    activeBoss = BOSS_TYPES[weekIdx];
    isBossMode = true;
    activeModifier = null;
    scoreMultiplier = 1;
    coinMultiplier = 1;
    eventScoreBoost = 1;
    timerPaused = false;
    failedSwaps = 0;

    BOARD_COLS = 9;
    BOARD_ROWS = 9;
    PIECES = [...BASE_PIECES];
    FROZEN_SPAWN_CHANCE = 0.06;

    board = createBoard();
    selected = null;
    totalScore = 0;
    coinsEarned = 0;
    comboCount = 0;
    maxCombo = 0;
    lastSwap = null;
    gameActive = true;
    timeLeft = activeBoss.time;

    // Boss HP bar in header
    const headerEl = document.querySelector('.game-header');
    if (headerEl) {
        const bossHp = document.createElement('div');
        bossHp.className = 'boss-hp-wrapper';
        bossHp.innerHTML = `
            <div class="boss-hp-label">${activeBoss.name}</div>
            <div class="boss-hp-track"><div class="boss-hp-bar" id="bossHpBar" style="width:0%;background:${activeBoss.color}"></div></div>
            <div class="boss-hp-text" id="bossHpText">0 / ${activeBoss.target}</div>
        `;
        headerEl.after(bossHp);
    }

    renderBoard();
    updateHeader();
    startTimer();
    startBossMechanic();
}

async function resetMinigame() {
    try {
        const r = await apiFetchWithAuthRetry('/api/minigame/reset', { method: 'POST', headers: getAuthHeaders() });
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
