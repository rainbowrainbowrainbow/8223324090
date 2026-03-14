/**
 * profile-page.js — Profile + Character + Inventory + Achievements + Shop + Leaderboard + Room + Quests + Titles
 * v25.2.0 — Unified tab system (removed old System A)
 */

// ==========================================
// STATE
// ==========================================
let profileData = null;
let myInventory = [];
let myAchievements = [];
let myNotes = [];
let walletData = null;
let currentUserId = null;
let isOwnProfile = true;
let roomData = null;
let questsData = null;
let titlesData = null;
let shopItems = [];
let leaderboardData = null;
let achCatFilter = 'all';
let leaderboardSort = 'xp';
let activeTab = 'profile';

// v30.8.0 — Gamification v3 state
let seasonalQuests = null;
let teamsData = null;
let challengesData = null;
let referralData = null;
let monthlyLeaderboard = null;
let monthlyCategory = 'overall';
let monthlyYear = new Date().getFullYear();
let monthlyMonth = new Date().getMonth() + 1;
let leaderboardMode = 'overall'; // 'overall' or 'monthly'

// ==========================================
// UTILITIES
// ==========================================
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatCoins(n) { return (n || 0).toLocaleString('uk-UA'); }

const RARITY_LABELS = { common: 'Звичайний', uncommon: 'Незвичайний', rare: 'Рідкісний', epic: 'Епічний', legendary: 'Легендарний' };
const CATEGORY_EMOJIS = { background: '🖼️', weapon: '⚔️', hat: '🎩', outfit: '👕', frame: '🖼️', coupon: '🎫', effect: '✨', wallpaper: '🏠', floor: '🟫', furniture: '🪑' };
const NOTE_COLORS = ['#fef3c7', '#dcfce7', '#dbeafe', '#fce7f3', '#f3e8ff', '#e0e7ff'];
const FURNITURE_EMOJIS = { furn_desk: '🖥️', furn_plant: '🪴', furn_trophy: '🏆', furn_arcade: '🎮', furn_dino_statue: '🦕' };
const MOOD_EMOJIS = { happy: '😊', working: '💼', tired: '😴', excited: '🤩', chill: '😎' };
const QUEST_ICONS = { complete_tasks: '✅', create_booking: '📋', play_minigame: '🎮', visit_room: '🏠', send_message: '💬', early_login: '🌅', mark_shift: '⏰', meta_quest: '⭐' };

// ==========================================
// API
// ==========================================
async function apiGet(path) {
    try {
        const r = await fetch(`/api${path}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(r)) return null;
        if (!r.ok) return null;
        return await r.json();
    } catch (e) { console.error('API GET', path, e); return null; }
}

async function apiPost(path, body) {
    try {
        const r = await fetch(`/api${path}`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body) });
        if (handleAuthError(r)) return null;
        return await r.json();
    } catch (e) { console.error('API POST', path, e); return null; }
}

async function apiPut(path, body) {
    try {
        const r = await fetch(`/api${path}`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify(body) });
        if (handleAuthError(r)) return null;
        return await r.json();
    } catch (e) { console.error('API PUT', path, e); return null; }
}

async function apiDelete(path) {
    try {
        const r = await fetch(`/api${path}`, { method: 'DELETE', headers: getAuthHeaders(false) });
        if (handleAuthError(r)) return null;
        return await r.json();
    } catch (e) { console.error('API DELETE', path, e); return null; }
}

// ==========================================
// PAGE INIT
// ==========================================
async function initProfilePage() {
    // Dark mode
    if (localStorage.getItem('pzp_dark_mode') === 'true') {
        document.body.classList.add('dark-mode');
    }

    const token = localStorage.getItem('pzp_token');
    if (!token) { window.location.href = '/'; return; }

    // Get current user
    try {
        const r = await fetch('/api/auth/verify', { headers: getAuthHeaders(false) });
        if (!r.ok) { window.location.href = '/'; return; }
        const user = await r.json();
        currentUserId = user.id;
    } catch (e) { window.location.href = '/'; return; }

    // Check URL for user ID
    const params = new URLSearchParams(window.location.search);
    const viewUserId = parseInt(params.get('id')) || currentUserId;
    isOwnProfile = viewUserId === currentUserId;

    // Load data
    await loadProfileData(viewUserId);
    renderProfile();
}

async function loadProfileData(userId) {
    const results = await Promise.all([
        apiGet(`/profile/${userId}`),
        isOwnProfile ? apiGet('/wallet') : null,
        isOwnProfile ? apiGet('/inventory') : null,
        apiGet('/achievements'),
        isOwnProfile ? apiGet('/notes') : null,
        isOwnProfile ? apiGet('/room') : apiGet(`/room/${userId}`),
        isOwnProfile ? apiGet('/quests/daily') : null,
        isOwnProfile ? apiGet('/quests/titles') : null
    ]);

    profileData = results[0];
    walletData = results[1];
    myInventory = results[2] || [];
    myAchievements = results[3] || [];
    myNotes = results[4] || [];
    roomData = results[5];
    questsData = results[6];
    titlesData = results[7];
}

// ==========================================
// RENDER
// ==========================================
function renderProfile() {
    if (!profileData) {
        document.getElementById('mainApp').innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray-500)">Профіль не знайдено</div>';
        return;
    }

    const p = profileData;
    const equipped = p.equipped || {};

    // Emoji mappings
    const bgMap = { bg_park: '🌳', bg_dino: '🦕', bg_neon: '💜', bg_space: '🌌', bg_gold: '✨' };
    const hatMap = { hat_dino: '🦕', hat_crown: '👑', hat_chef: '👨‍🍳' };
    const bodyMap = { out_animator: '🎭', out_pirate: '🏴‍☠️', out_space: '🚀' };
    const weaponMap = { wp_sword: '⚔️', wp_laser: '🔦', wp_dino_bone: '🦴', wp_trident: '🔱' };

    const bgEmoji = equipped.background ? (bgMap[equipped.background.code] || '🖼️') : '🌳';
    const hatEmoji = equipped.head ? (hatMap[equipped.head.code] || '🎩') : '';
    const bodyEmoji = equipped.body ? (bodyMap[equipped.body.code] || '👕') : '';
    const weaponEmoji = equipped.hand ? (weaponMap[equipped.hand.code] || '⚔️') : '';
    const frameRarity = equipped.frame?.rarity || '';
    const effectCode = equipped.effect?.code || '';

    const avatarLetter = (p.displayName || p.username || '?')[0].toUpperCase();
    const completedAch = myAchievements.filter(a => a.completed);
    const totalAch = myAchievements.filter(a => !a.isSecret || a.completed).length;

    // Active title
    const activeTitleDef = titlesData?.titles?.find(t => t.code === titlesData.activeTitle);
    const titleHtml = activeTitleDef
        ? `<span class="title-badge rarity-${activeTitleDef.rarity}">${activeTitleDef.icon} ${escapeHtml(activeTitleDef.name)}</span>`
        : '';

    let html = `
    <div class="profile-page">
        <div style="margin-bottom:16px">
            <a href="/" style="color:var(--primary);text-decoration:none;font-weight:600">\u2190 Назад</a>
        </div>

        <div class="profile-header">
            <div class="character-display">
                <div class="character-bg">${escapeHtml(bgEmoji)}</div>
                <div class="character-avatar">${escapeHtml(avatarLetter)}</div>
                ${hatEmoji ? `<div class="character-hat">${escapeHtml(hatEmoji)}</div>` : ''}
                ${bodyEmoji ? `<div class="character-body">${escapeHtml(bodyEmoji)}</div>` : ''}
                ${weaponEmoji ? `<div class="character-weapon">${escapeHtml(weaponEmoji)}</div>` : ''}
                ${frameRarity ? `<div class="character-frame" data-rarity="${escapeHtml(frameRarity)}"></div>` : ''}
                ${effectCode ? `<div class="character-effect effect-${escapeHtml(effectCode.replace('fx_', ''))}"></div>` : ''}
                <div class="character-name">${escapeHtml(p.displayName || p.username)} ${titleHtml}</div>
            </div>

            <div class="profile-info">
                <h1>${escapeHtml(p.displayName || p.username)}</h1>
                ${titleHtml ? `<div style="margin:-4px 0 8px">${titleHtml}</div>` : ''}
                <div class="profile-role">${escapeHtml(p.role)}</div>
                ${p.bio ? `<div class="profile-bio">${escapeHtml(p.bio)}</div>` : ''}

                <div class="profile-stats">
                    <div class="profile-stat">
                        <div class="profile-stat-value">\ud83d\udcb0 ${formatCoins(isOwnProfile ? walletData?.coins : p.coins)}</div>
                        <div class="profile-stat-label">Монети</div>
                    </div>
                    <div class="profile-stat">
                        <div class="profile-stat-value">${completedAch.length}/${totalAch}</div>
                        <div class="profile-stat-label">Ачивки</div>
                    </div>
                    <div class="profile-stat">
                        <div class="profile-stat-value">${p.profileViews || 0}</div>
                        <div class="profile-stat-label">Перегляди</div>
                    </div>
                </div>

                ${isOwnProfile ? `
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <a href="/shop" class="shop-buy-btn" style="text-decoration:none">\ud83d\uded2 Магазин</a>
                    <a href="/game" class="shop-buy-btn" style="text-decoration:none;background:#22c55e">\ud83c\udfae Міні-гра</a>
                </div>` : ''}
            </div>
        </div>

        <!-- TABS -->
        <div class="profile-tabs" style="margin:16px 0 0">
            <button class="profile-tab ${activeTab === 'profile' ? 'active' : ''}" onclick="switchTab('profile')">👤 Профіль</button>
            <button class="profile-tab ${activeTab === 'achievements' ? 'active' : ''}" onclick="switchTab('achievements')">🏆 Ачивки</button>
            ${isOwnProfile ? `<button class="profile-tab ${activeTab === 'inventory' ? 'active' : ''}" onclick="switchTab('inventory')">🎒 Інвентар</button>` : ''}
            ${isOwnProfile ? `<button class="profile-tab ${activeTab === 'shop' ? 'active' : ''}" onclick="switchTab('shop')">🛒 Магазин</button>` : ''}
            <button class="profile-tab ${activeTab === 'leaderboard' ? 'active' : ''}" onclick="switchTab('leaderboard')">📊 Рейтинг</button>
            <button class="profile-tab ${activeTab === 'room' ? 'active' : ''}" onclick="switchTab('room')">🏠 Кімната</button>
            ${isOwnProfile ? `<button class="profile-tab ${activeTab === 'quests' ? 'active' : ''}" onclick="switchTab('quests')">✅ Квести</button>` : ''}
            <button class="profile-tab ${activeTab === 'season' ? 'active' : ''}" onclick="switchTab('season')">🏔️ Сезон</button>
            <button class="profile-tab ${activeTab === 'teams' ? 'active' : ''}" onclick="switchTab('teams')">⚡ Команди</button>
            ${isOwnProfile ? `<button class="profile-tab ${activeTab === 'referral' ? 'active' : ''}" onclick="switchTab('referral')">🤝 Реферали</button>` : ''}
        </div>

        <div id="tabContent">
            ${renderTabContent()}
        </div>
    </div>`;

    document.getElementById('mainApp').innerHTML = html;
    attachProfileListeners();
}

async function switchTab(tab) {
    activeTab = tab;

    // Lazy load data for tabs that need it
    if (tab === 'shop' && shopItems.length === 0) await loadShopItems();
    if (tab === 'leaderboard' && !leaderboardData) await loadLeaderboard();
    if (tab === 'season' && !seasonalQuests) await loadSeasonalQuests();
    if (tab === 'teams' && !teamsData) await loadTeamsData();
    if (tab === 'referral' && !referralData) await loadReferralData();

    const tabContent = document.getElementById('tabContent');
    if (tabContent) {
        tabContent.innerHTML = renderTabContent();
        attachProfileListeners();
    }
    // Update tab buttons
    document.querySelectorAll('.profile-tab').forEach(btn => {
        const tabName = btn.getAttribute('onclick')?.match(/switchTab\('(\w+)'\)/)?.[1];
        btn.classList.toggle('active', tabName === tab);
    });
}

function renderTabContent() {
    switch (activeTab) {
        case 'achievements': return renderAchievements();
        case 'inventory': return renderInventory();
        case 'shop': return renderShopTab();
        case 'leaderboard': return renderLeaderboardTab();
        case 'room': return renderRoom();
        case 'quests': return renderQuests();
        case 'titles': return renderTitles();
        case 'season': return renderSeasonTab();
        case 'teams': return renderTeamsTab();
        case 'referral': return renderReferralTab();
        default: return `
            ${isOwnProfile ? renderStreakWidget() : ''}
            ${isOwnProfile ? renderLevelProgress() : ''}
            ${isOwnProfile ? renderNotes() : ''}
        `;
    }
}

// ==========================================
// INVENTORY
// ==========================================
function renderInventory() {
    const SLOTS = 18; // 6x3
    const items = myInventory.slice(0, SLOTS);
    let slotsHtml = '';

    for (let i = 0; i < SLOTS; i++) {
        const item = items[i];
        if (item) {
            const emoji = CATEGORY_EMOJIS[item.category] || '📦';
            slotsHtml += `
            <div class="inventory-slot ${item.isEquipped ? 'equipped' : ''} rarity-${item.rarity}"
                 title="${escapeHtml(item.name)} (${RARITY_LABELS[item.rarity] || item.rarity})"
                 data-item-id="${item.itemId}" data-slot="${item.equipSlot || ''}">
                ${escapeHtml(emoji)}
                ${item.quantity > 1 ? `<span class="qty-badge">x${item.quantity}</span>` : ''}
            </div>`;
        } else {
            slotsHtml += '<div class="inventory-slot empty">⬜</div>';
        }
    }

    return `
    <div class="inventory-section">
        <h3>🎒 Інвентар</h3>
        <div class="inventory-grid">${slotsHtml}</div>
    </div>`;
}

// ==========================================
// ACHIEVEMENTS (with category filter)
// ==========================================
const ACH_CATEGORIES = [
    { id: 'all', label: 'Всі' },
    { id: 'work', label: '🔨 Робота' },
    { id: 'minigame', label: '🎮 Ігри' },
    { id: 'quiz', label: '📊 Квізи' },
    { id: 'social', label: '💬 Соціальні' },
    { id: 'streaks', label: '🔥 Стріки' },
    { id: 'special', label: '⭐ Особливі' },
];

function setAchCat(cat) {
    achCatFilter = cat;
    switchTab('achievements');
}

function renderAchievements() {
    const visible = myAchievements.filter(a => !a.isSecret || a.completed);
    const filtered = achCatFilter === 'all' ? visible : visible.filter(a => a.category === achCatFilter);

    const tabsHtml = ACH_CATEGORIES.map(c =>
        `<button class="profile-tab ${achCatFilter === c.id ? 'active' : ''}" style="font-size:13px;padding:6px 14px"
                 onclick="setAchCat('${c.id}')">${c.label}</button>`
    ).join('');

    let cardsHtml = filtered.map(a => {
        const pct = a.target > 1 ? Math.min(100, Math.round((a.progress / a.target) * 100)) : (a.completed ? 100 : 0);
        return `
        <div class="achievement-card ${a.completed ? 'completed unlocked' : ''} ${!a.completed && a.progress === 0 ? 'locked' : ''}">
            <div class="achievement-icon">${a.icon}</div>
            <div class="achievement-info">
                <h3>${escapeHtml(a.name)} <span class="rarity-badge rarity-${a.rarity}">${RARITY_LABELS[a.rarity] || a.rarity}</span></h3>
                <p>${escapeHtml(a.description)}</p>
                <div class="achievement-reward">+${a.rewardCoins} 💰</div>
                ${a.target > 1 ? `
                <div class="achievement-progress" style="height:6px;background:var(--gray-200);border-radius:3px;margin-top:6px">
                    <div class="achievement-progress-fill" style="width:${pct}%;height:100%;border-radius:3px;background:var(--primary);transition:width 0.4s"></div>
                </div>
                <div style="font-size:11px;color:var(--gray-400);margin-top:2px">${a.progress}/${a.target}</div>
                ` : ''}
            </div>
        </div>`;
    }).join('');

    if (!cardsHtml) cardsHtml = '<div class="empty-state"><div class="empty-state-icon">🏆</div><div class="empty-state-text">Немає ачивок в цій категорії</div></div>';

    return `
    <div class="achievements-section" style="margin-top:16px">
        <h3 style="margin-bottom:12px">🏆 Ачивки (${visible.filter(a => a.completed).length}/${visible.length})</h3>
        <div class="profile-tabs" style="margin-bottom:14px">${tabsHtml}</div>
        <div class="achievements-grid">${cardsHtml}</div>
    </div>`;
}

// ==========================================
// NOTES
// ==========================================
function renderNotes() {
    const sorted = [...myNotes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    let notesHtml = sorted.map(n => `
    <div class="note-card" style="background:${escapeHtml(n.color)}" data-note-id="${n.id}">
        ${n.pinned ? '<div class="note-pin">📌</div>' : ''}
        ${n.title ? `<div class="note-title">${escapeHtml(n.title)}</div>` : ''}
        <div class="note-content">${escapeHtml(n.content)}</div>
        <div class="note-date">${formatDate(n.updatedAt || n.createdAt)}</div>
        <div class="note-actions">
            <button class="note-action-btn" onclick="pinNote(${n.id})" title="${n.pinned ? 'Відкріпити' : 'Закріпити'}">📌</button>
            <button class="note-action-btn" onclick="deleteNote(${n.id})" title="Видалити">🗑️</button>
        </div>
    </div>`).join('');

    return `
    <div class="notes-section">
        <h3>📝 Нотатки</h3>
        <div class="notes-grid">
            ${notesHtml}
            <button class="add-note-btn" onclick="showAddNote()">+ Нова нотатка</button>
        </div>
    </div>`;
}

// ==========================================
// ROOM
// ==========================================
function renderRoom() {
    if (!roomData) return '<div style="text-align:center;padding:40px;color:var(--gray-500)">Кімната завантажується...</div>';

    const ROWS = 6, COLS = 8;
    const layout = roomData.layout || {};
    const wallCode = roomData.wallpaper?.code || 'wall_default';
    const floorCode = roomData.floor?.code || 'floor_wood';
    const mood = roomData.mood || 'happy';

    // Place furniture on grid
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    // Place avatar in center
    grid[2][3] = { type: 'avatar' };

    // Place items from layout
    for (const [itemId, pos] of Object.entries(layout)) {
        const r = parseInt(pos.row), c = parseInt(pos.col);
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS && !grid[r][c]) {
            const item = roomData.furniture?.find(f => String(f.itemId) === String(itemId));
            if (item) grid[r][c] = { type: 'item', ...item, itemId };
        }
    }

    // Auto-place unplaced furniture
    const placedIds = new Set(Object.keys(layout));
    const unplaced = (roomData.furniture || []).filter(f => !placedIds.has(String(f.itemId)));
    for (const item of unplaced) {
        let placed = false;
        for (let r = 0; r < ROWS && !placed; r++) {
            for (let c = 0; c < COLS && !placed; c++) {
                if (!grid[r][c]) {
                    grid[r][c] = { type: 'item', ...item };
                    placed = true;
                }
            }
        }
    }

    let cellsHtml = '';
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = grid[r][c];
            if (cell?.type === 'avatar') {
                const avatarLetter = (profileData?.displayName || profileData?.username || '?')[0].toUpperCase();
                cellsHtml += `<div class="room-cell avatar-cell" style="grid-row:${r + 1};grid-column:${c + 1}">${avatarLetter}</div>`;
            } else if (cell?.type === 'item') {
                const emoji = FURNITURE_EMOJIS[cell.code] || '📦';
                cellsHtml += `
                <div class="room-cell has-item rarity-${cell.rarity || 'common'}"
                     style="grid-row:${r + 1};grid-column:${c + 1}"
                     data-room-item="${cell.itemId || ''}" data-row="${r}" data-col="${c}">
                    ${emoji}
                    <div class="room-item-tooltip">${escapeHtml(cell.name)}</div>
                </div>`;
            } else {
                cellsHtml += `<div class="room-cell" style="grid-row:${r + 1};grid-column:${c + 1}"></div>`;
            }
        }
    }

    const moodEmoji = MOOD_EMOJIS[mood] || '😊';

    return `
    <div style="margin-top:16px">
        <div class="room-container">
            <div class="room-scene">
                <div class="room-wallpaper ${escapeHtml(wallCode)}"></div>
                <div class="room-floor ${escapeHtml(floorCode)}"></div>
                ${cellsHtml}
            </div>
            <div class="room-info">
                <div class="room-mood">${moodEmoji} ${escapeHtml(mood)}</div>
                <div class="room-visitors">\ud83d\udc41 ${roomData.visitorCount || 0} відвідувачів</div>
            </div>
        </div>
        ${isOwnProfile ? `
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;justify-content:center">
            <select id="moodSelect" style="padding:6px 10px;border-radius:var(--radius-sm);border:1px solid var(--gray-300);font-size:13px">
                <option value="happy" ${mood === 'happy' ? 'selected' : ''}>😊 Щасливий</option>
                <option value="working" ${mood === 'working' ? 'selected' : ''}>💼 Працює</option>
                <option value="tired" ${mood === 'tired' ? 'selected' : ''}>😴 Втомлений</option>
                <option value="excited" ${mood === 'excited' ? 'selected' : ''}>🤩 Збуджений</option>
                <option value="chill" ${mood === 'chill' ? 'selected' : ''}>😎 Чіл</option>
            </select>
            <button onclick="updateMood()" class="shop-buy-btn" style="font-size:12px;padding:6px 12px">Змінити настрій</button>
        </div>` : ''}
    </div>`;
}

// ==========================================
// QUESTS
// ==========================================
function renderQuests() {
    if (!questsData?.quests) return '<div style="text-align:center;padding:40px;color:var(--gray-500)">Квести завантажуються...</div>';

    const quests = questsData.quests;
    let html = '<div class="quests-container" style="margin-top:16px">';
    html += '<h3>Щоденні квести</h3>';

    for (const q of quests) {
        const icon = QUEST_ICONS[q.questType] || '📋';
        const pct = q.targetValue > 0 ? Math.min(100, Math.round((q.progress / q.targetValue) * 100)) : 0;
        const canClaim = q.completed && !q.claimed;

        html += `
        <div class="quest-card ${q.completed ? 'completed' : ''} ${q.claimed ? 'claimed' : ''}">
            <div class="quest-icon">${icon}</div>
            <div class="quest-info">
                <div class="quest-title">${escapeHtml(q.title)}</div>
                <div class="quest-desc">${escapeHtml(q.description)} (${q.progress}/${q.targetValue})</div>
                <div class="quest-progress-bar"><div class="quest-progress-fill" style="width:${pct}%"></div></div>
            </div>
            <div style="text-align:right">
                <div class="quest-reward">+${q.rewardCoins} \ud83d\udcb0</div>
                ${canClaim ? `<button class="quest-claim-btn" onclick="claimQuest(${q.id})">Забрати</button>` : ''}
                ${q.claimed ? '<span style="font-size:11px;color:var(--primary)">Отримано</span>' : ''}
            </div>
        </div>`;
    }

    html += '</div>';
    return html;
}

// ==========================================
// TITLES
// ==========================================
function renderTitles() {
    if (!titlesData?.titles) return '<div style="text-align:center;padding:40px;color:var(--gray-500)">Титули завантажуються...</div>';

    let html = '<div style="margin-top:16px"><h3>Титули</h3>';
    html += '<div class="titles-grid">';

    for (const t of titlesData.titles) {
        const isActive = titlesData.activeTitle === t.code;
        html += `
        <div class="title-card ${t.earned ? '' : 'locked'} ${isActive ? 'active' : ''}"
             ${t.earned ? `onclick="setTitle('${escapeHtml(t.code)}')"` : ''}>
            <div class="title-card-icon">${t.icon}</div>
            <div>
                <div class="title-card-name">${escapeHtml(t.name)} <span class="rarity-badge ${t.rarity}">${RARITY_LABELS[t.rarity]}</span></div>
                <div class="title-card-desc">${escapeHtml(t.description)}</div>
                ${!t.earned ? `<div style="font-size:10px;color:var(--gray-400);margin-top:2px">${escapeHtml(t.conditionType)}: ${t.conditionValue}</div>` : ''}
            </div>
        </div>`;
    }

    html += '</div>';
    if (titlesData.activeTitle) {
        html += `<button onclick="setTitle('')" style="margin-top:8px;padding:4px 12px;font-size:12px;border:1px solid var(--gray-300);border-radius:var(--radius-sm);background:none;cursor:pointer;color:var(--gray-500)">Зняти титул</button>`;
    }
    html += '</div>';
    return html;
}

// ==========================================
// SHOP TAB
// ==========================================
async function loadShopItems() {
    const data = await apiGet('/gamification/shop');
    shopItems = data || [];
}

function renderShopTab() {
    if (!shopItems.length) return '<div class="empty-state"><div class="empty-state-icon">🛒</div><div class="empty-state-text">Магазин порожній</div></div>';

    const ownedCodes = new Set((myInventory || []).map(i => i.code));
    const coins = walletData?.coins || 0;

    let cardsHtml = shopItems.map(item => {
        const owned = ownedCodes.has(item.code);
        const canAfford = coins >= (item.priceCoins || item.price_coins || 0);
        const price = item.priceCoins || item.price_coins || 0;
        const emoji = CATEGORY_EMOJIS[item.category] || '📦';

        return `
        <div class="shop-card ${owned ? 'owned' : ''}" ${item.featured ? 'style="border-color:#fbbf24"' : ''}>
            <div class="shop-icon">${emoji}</div>
            <div class="shop-name">${escapeHtml(item.name)}</div>
            ${item.description ? `<div class="shop-desc">${escapeHtml(item.description)}</div>` : ''}
            <span class="rarity-badge rarity-${item.rarity}">${RARITY_LABELS[item.rarity] || item.rarity}</span>
            <div class="shop-price" style="margin-top:8px">${price === 0 ? 'Безкоштовно' : `💰 ${formatCoins(price)}`}</div>
            ${owned
                ? '<button class="shop-buy-btn" disabled>✅ У вас є</button>'
                : `<button class="shop-buy-btn" ${!canAfford ? 'disabled' : ''} onclick="buyItem(${item.id},'${escapeHtml(item.name).replace(/'/g, "\\'")}')">
                    ${canAfford ? '🛒 Купити' : '🔒 Замало монет'}
                   </button>`
            }
        </div>`;
    }).join('');

    return `
    <div style="margin-top:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3>🛒 Магазин</h3>
            <span class="coins-balance">🪙 ${formatCoins(coins)}</span>
        </div>
        <div class="shop-grid">${cardsHtml}</div>
    </div>`;
}

async function buyItem(itemId, itemName) {
    if (!confirm(`Купити "${itemName}"?`)) return;
    const result = await apiPost('/gamification/shop/buy', { itemId });
    if (result?.success) {
        if (typeof showNotification === 'function') showNotification(`Придбано: ${itemName}!`, 'success');
        // Refresh data
        walletData = await apiGet('/wallet');
        myInventory = await apiGet('/inventory') || [];
        await loadShopItems();
        switchTab('shop');
    } else {
        if (typeof showNotification === 'function') showNotification(result?.error || 'Помилка покупки', 'error');
    }
}

// ==========================================
// LEADERBOARD TAB
// ==========================================
async function loadLeaderboard() {
    leaderboardData = await apiGet(`/gamification/leaderboard?sort=${leaderboardSort}`);
}

function setLeaderboardSort(sort) {
    leaderboardSort = sort;
    leaderboardData = null;
    switchTab('leaderboard');
}

function renderLeaderboardTab() {
    // Mode toggle: Overall vs Monthly
    const modeHtml = `
    <div style="display:flex;gap:4px;margin-bottom:12px">
        <button class="profile-tab ${leaderboardMode === 'overall' ? 'active' : ''}" style="font-size:13px;padding:6px 14px"
                onclick="setLeaderboardMode('overall')">🏅 Загальний</button>
        <button class="profile-tab ${leaderboardMode === 'monthly' ? 'active' : ''}" style="font-size:13px;padding:6px 14px"
                onclick="setLeaderboardMode('monthly')">📅 Щомісячний</button>
    </div>`;

    if (leaderboardMode === 'monthly') {
        return modeHtml + renderMonthlyLeaderboard();
    }

    if (!leaderboardData) return modeHtml + '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">Завантаження рейтингу...</div></div>';

    const list = Array.isArray(leaderboardData) ? leaderboardData : (leaderboardData.leaderboard || []);
    if (!list.length) return modeHtml + '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">Рейтинг поки порожній</div></div>';

    const sortTabs = [
        { id: 'xp', label: 'За XP' },
        { id: 'coins', label: 'За монети' },
        { id: 'achievements', label: 'За ачивки' }
    ];

    const tabsHtml = sortTabs.map(s =>
        `<button class="profile-tab ${leaderboardSort === s.id ? 'active' : ''}" style="font-size:13px;padding:6px 14px"
                 onclick="setLeaderboardSort('${s.id}')">${s.label}</button>`
    ).join('');

    const rankIcons = ['🥇', '🥈', '🥉'];
    const listHtml = list.map((u, i) => {
        const isMe = u.id === currentUserId || u.userId === currentUserId;
        const avatarLetter = (u.displayName || u.username || '?')[0].toUpperCase();
        const scoreValue = leaderboardSort === 'coins' ? formatCoins(u.coins) :
                          leaderboardSort === 'achievements' ? (u.achievementsCount || u.achievements || 0) :
                          formatCoins(u.xp || 0);
        const scoreLabel = leaderboardSort === 'coins' ? 'монет' :
                          leaderboardSort === 'achievements' ? 'ачивок' : 'XP';

        return `
        <div class="leaderboard-item ${isMe ? 'is-me' : ''}">
            <div class="leaderboard-rank ${i < 3 ? `top-${i + 1}` : ''}">${rankIcons[i] || (i + 1)}</div>
            <div class="leaderboard-avatar">${avatarLetter}</div>
            <div class="leaderboard-user">
                <div class="leaderboard-name">${escapeHtml(u.displayName || u.username)}</div>
                <div class="leaderboard-title-text">${escapeHtml(u.activeTitle || u.role || '')}</div>
            </div>
            <div class="leaderboard-score">
                <div class="leaderboard-score-value">${scoreValue}</div>
                <div class="leaderboard-score-label">${scoreLabel}</div>
            </div>
        </div>`;
    }).join('');

    return `
    <div style="margin-top:16px">
        <h3 style="margin-bottom:12px">📊 Рейтинг</h3>
        ${modeHtml}
        <div class="profile-tabs" style="margin-bottom:14px">${tabsHtml}</div>
        <div class="leaderboard-list">${listHtml}</div>
    </div>`;
}

function renderMonthlyLeaderboard() {
    const months = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
    const categories = [
        { id: 'overall', label: 'Загальний' },
        { id: 'bookings', label: 'Бронювання' },
        { id: 'tasks', label: 'Задачі' },
        { id: 'xp', label: 'XP' },
        { id: 'coins', label: 'Монети' }
    ];

    const catTabs = categories.map(c =>
        `<button class="profile-tab ${monthlyCategory === c.id ? 'active' : ''}" style="font-size:12px;padding:5px 12px"
                 onclick="setMonthlyFilter('${c.id}')">${c.label}</button>`
    ).join('');

    let listHtml = '';
    const data = monthlyLeaderboard;
    const list = data?.leaderboard || [];

    if (list.length === 0) {
        listHtml = '<div class="empty-state" style="padding:20px"><div class="empty-state-text">Немає даних за цей місяць. Рейтинг оновлюється автоматично.</div></div>';
    } else {
        const rankIcons = ['🥇', '🥈', '🥉'];
        listHtml = `<div class="leaderboard-list">${list.map((u, i) => `
            <div class="leaderboard-item">
                <div class="leaderboard-rank ${i < 3 ? `top-${i + 1}` : ''}">${rankIcons[i] || u.rank || (i + 1)}</div>
                <div class="leaderboard-avatar">${(u.display_name || u.username || '?')[0].toUpperCase()}</div>
                <div class="leaderboard-user">
                    <div class="leaderboard-name">${escapeHtml(u.display_name || u.username)}</div>
                    <div class="leaderboard-title-text">${escapeHtml(u.title || '')}</div>
                </div>
                <div class="leaderboard-score">
                    <div class="leaderboard-score-value">${formatCoins(u.score)}</div>
                    <div class="leaderboard-score-label">${monthlyCategory}</div>
                </div>
            </div>
        `).join('')}</div>`;
    }

    return `
    <div style="margin-top:8px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <h4>📅 ${months[monthlyMonth - 1]} ${monthlyYear}</h4>
        </div>
        <div class="profile-tabs" style="margin-bottom:14px">${catTabs}</div>
        ${listHtml}
    </div>`;

// ==========================================
// MINI AVATAR (for chat)
// ==========================================
function renderMiniAvatar(equipped, name) {
    const letter = (name || '?')[0].toUpperCase();
    const hatMap = { hat_dino: '🦕', hat_crown: '👑', hat_chef: '👨‍🍳' };
    const hatEmoji = equipped?.head ? (hatMap[equipped.head.code] || '') : '';
    const frameRarity = equipped?.frame?.rarity || '';
    const effectCode = equipped?.effect?.code || '';

    return `
    <div class="chat-avatar-mini">
        <div class="mini-initial">${escapeHtml(letter)}</div>
        ${hatEmoji ? `<div class="mini-hat">${hatEmoji}</div>` : ''}
        ${frameRarity ? `<div class="mini-frame rarity-${escapeHtml(frameRarity)}"></div>` : ''}
        ${effectCode ? `<div class="mini-effect effect-${escapeHtml(effectCode.replace('fx_', ''))}"></div>` : ''}
    </div>`;
}

// ==========================================
// ACTIONS
// ==========================================
function attachProfileListeners() {
    // Inventory slot click — equip/unequip
    document.querySelectorAll('.inventory-slot[data-item-id]').forEach(slot => {
        slot.addEventListener('click', async () => {
            const itemId = parseInt(slot.dataset.itemId);
            const equipSlot = slot.dataset.slot;
            if (!equipSlot) return; // coupons etc

            const item = myInventory.find(i => i.itemId === itemId);
            if (!item) return;

            if (item.isEquipped) {
                await apiPut('/profile/unequip', { slot: equipSlot });
            } else {
                await apiPut('/profile/equip', { item_id: itemId, slot: equipSlot });
            }
            await loadProfileData(currentUserId);
            renderProfile();
        });
    });

    // Check for new achievements and titles
    apiPost('/achievements/check', {});
    if (isOwnProfile) apiPost('/quests/check-titles', {});
}

async function claimQuest(questId) {
    const result = await apiPost(`/quests/claim/${questId}`);
    if (result?.success) {
        questsData = await apiGet('/quests/daily');
        walletData = await apiGet('/wallet');
        const tabContent = document.getElementById('tabContent');
        if (tabContent && activeTab === 'quests') tabContent.innerHTML = renderTabContent();
    }
}

async function setTitle(titleCode) {
    await apiPut('/quests/titles/set', { title_code: titleCode || null });
    titlesData = await apiGet('/quests/titles');
    renderProfile();
}

async function updateMood() {
    const select = document.getElementById('moodSelect');
    if (!select) return;
    await apiPut('/room/decorate', { mood: select.value });
    roomData = await apiGet('/room');
    const tabContent = document.getElementById('tabContent');
    if (tabContent && activeTab === 'room') tabContent.innerHTML = renderTabContent();
}

async function showAddNote() {
    const title = prompt('Заголовок нотатки:');
    if (title === null) return;
    const content = prompt('Текст:');
    if (content === null) return;
    const color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)];

    const result = await apiPost('/notes', { title, content, color });
    if (result && result.id) {
        myNotes.push(result);
        renderProfile();
    }
}

async function deleteNote(id) {
    if (!await confirmModal('Видалити нотатку?', { type: 'danger', okText: 'Видалити' })) return;
    await apiDelete(`/notes/${id}`);
    myNotes = myNotes.filter(n => n.id !== id);
    renderProfile();
}

async function pinNote(id) {
    const result = await apiPut(`/notes/${id}/pin`, {});
    if (result?.success !== undefined) {
        const note = myNotes.find(n => n.id === id);
        if (note) note.pinned = result.pinned;
        renderProfile();
    }
}

// ==========================================
// LEVEL PROGRESS (v30.8.0)
// ==========================================
function renderLevelProgress() {
    const p = profileData;
    if (!p) return '';

    const level = p.level || 1;
    const xp = p.xp || 0;
    const title = p.title || 'Новачок';
    const xpForCurrent = p.xpForCurrent || 0;
    const xpForNext = p.xpForNext;
    const isMaxLevel = !xpForNext;

    const pct = isMaxLevel ? 100 : Math.min(100, Math.round(((xp - xpForCurrent) / (xpForNext - xpForCurrent)) * 100));
    const xpNeeded = isMaxLevel ? 'MAX' : `${formatCoins(xp - xpForCurrent)} / ${formatCoins(xpForNext - xpForCurrent)}`;

    return `
    <div class="level-progress-card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
            <div class="level-badge-lg" data-level="${level}">
                <span class="level-number">${level}</span>
            </div>
            <div style="flex:1">
                <div style="font-weight:800;font-size:16px;color:var(--gray-800)">${escapeHtml(title)}</div>
                <div style="font-size:12px;color:var(--gray-400)">Рівень ${level}${xpForNext ? ` → ${p.nextTitle || ''}` : ' (МАКС)'}</div>
            </div>
            <div style="text-align:right">
                <div style="font-weight:800;font-size:18px;color:var(--primary)">${formatCoins(xp)}</div>
                <div style="font-size:11px;color:var(--gray-400)">XP</div>
            </div>
        </div>
        <div class="xp-progress-bar">
            <div class="xp-progress-fill" style="width:${pct}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px">
            <span style="font-size:11px;color:var(--gray-400)">${xpNeeded} XP</span>
            <span style="font-size:11px;color:var(--gray-400)">${pct}%</span>
        </div>
    </div>`;
}

// ==========================================
// STREAK WIDGET (v30.8.0)
// ==========================================
function renderStreakWidget() {
    const streaks = profileData?.streaks || {};
    const currentStreak = streaks.current_streak || streaks.currentStreak || 0;
    const longestStreak = streaks.longest_streak || streaks.longestStreak || 0;

    const milestones = [3, 7, 14, 30, 60, 100];
    const nextMilestone = milestones.find(m => m > currentStreak) || 100;
    const pct = Math.min(100, Math.round((currentStreak / nextMilestone) * 100));

    const last30 = [];
    for (let i = 29; i >= 0; i--) {
        const active = i < currentStreak;
        last30.push(`<div class="streak-day ${active ? 'active' : ''}" title="${active ? '🔥' : '⬜'}"></div>`);
    }

    return `
    <div class="streak-section" style="margin-bottom:16px">
        <div class="streak-widget">
            <div class="streak-card">
                <div class="streak-icon">🔥</div>
                <div class="streak-value">${currentStreak}</div>
                <div class="streak-label">Поточний streak</div>
            </div>
            <div class="streak-card">
                <div class="streak-icon">🏅</div>
                <div class="streak-value">${longestStreak}</div>
                <div class="streak-label">Рекорд</div>
            </div>
            <div class="streak-card">
                <div class="streak-icon">🎯</div>
                <div class="streak-value">${nextMilestone}</div>
                <div class="streak-label">Наступна мета</div>
                <div class="streak-milestone-bar" style="margin-top:6px">
                    <div class="streak-milestone-fill" style="width:${pct}%"></div>
                </div>
            </div>
        </div>
        <div class="streak-roadmap">
            ${milestones.map(m => `
                <div class="streak-milestone ${currentStreak >= m ? 'reached' : ''} ${m === nextMilestone ? 'next' : ''}">
                    <div class="milestone-dot">${currentStreak >= m ? '✅' : m}</div>
                    <div class="milestone-label">${m}д</div>
                </div>
            `).join('<div class="milestone-line"></div>')}
        </div>
        <div class="streak-heatmap" style="margin-top:10px">
            <div style="font-size:11px;color:var(--gray-400);margin-bottom:4px">Останні 30 днів:</div>
            <div class="heatmap-grid">${last30.join('')}</div>
        </div>
        <div style="margin-top:8px;text-align:center">
            <button class="streak-freeze-btn" onclick="buyStreakFreeze()">❄️ Заморозити streak (50 🪙)</button>
        </div>
    </div>`;
}

async function buyStreakFreeze() {
    if (!confirm('Заморозити streak за 50 монет? (1 раз/тиждень)')) return;
    const result = await apiPost('/gamification/streak/freeze');
    if (result?.success) {
        if (typeof showNotification === 'function') showNotification('❄️ Streak заморожено!', 'success');
        walletData = await apiGet('/wallet');
        renderProfile();
    } else {
        if (typeof showNotification === 'function') showNotification(result?.error || 'Помилка', 'error');
    }
}

// ==========================================
// SEASONAL QUESTS TAB (v30.8.0)
// ==========================================
async function loadSeasonalQuests() {
    seasonalQuests = await apiGet('/gamification/seasons');
    // Also check progress
    await apiPost('/gamification/seasons/check');
    seasonalQuests = await apiGet('/gamification/seasons');
}

function renderSeasonTab() {
    if (!seasonalQuests) return '<div class="empty-state"><div class="empty-state-icon">🏔️</div><div class="empty-state-text">Завантаження сезонних квестів...</div></div>';

    const quests = Array.isArray(seasonalQuests) ? seasonalQuests : [];
    if (quests.length === 0) {
        return '<div class="empty-state"><div class="empty-state-icon">🏔️</div><div class="empty-state-text">Наразі немає активних сезонних квестів</div></div>';
    }

    const season = quests[0]?.season || 'spring';
    const seasonNames = { winter: '❄️ Зимовий сезон', spring: '🌸 Весняний сезон', summer: '☀️ Літній сезон', autumn: '🍂 Осінній сезон' };
    const seasonColors = { winter: '#60a5fa', spring: '#34d399', summer: '#fbbf24', autumn: '#f97316' };

    const endDate = quests[0]?.end_date;
    const daysLeft = endDate ? Math.max(0, Math.ceil((new Date(endDate) - new Date()) / 86400000)) : 0;

    let cardsHtml = quests.map(q => {
        const progress = q.progress || 0;
        const target = q.target_value;
        const pct = Math.min(100, Math.round((progress / target) * 100));
        const completed = q.completed;
        const claimed = q.claimed;
        const canClaim = completed && !claimed;

        return `
        <div class="season-quest-card ${completed ? 'completed' : ''} ${claimed ? 'claimed' : ''}">
            <div class="season-quest-icon">${q.icon || '🏔️'}</div>
            <div class="season-quest-info">
                <h4>${escapeHtml(q.title)}</h4>
                <p>${escapeHtml(q.description)}</p>
                <div class="season-quest-progress">
                    <div class="season-quest-bar"><div class="season-quest-fill" style="width:${pct}%;background:${seasonColors[season] || '#6366f1'}"></div></div>
                    <span>${progress}/${target}</span>
                </div>
                <div class="season-quest-reward">
                    ${q.reward_coins ? `🪙 ${q.reward_coins}` : ''} ${q.reward_xp ? `⚡ ${q.reward_xp} XP` : ''}
                    ${q.reward_title ? `🏷️ "${escapeHtml(q.reward_title)}"` : ''}
                </div>
            </div>
            <div>
                ${canClaim ? `<button class="quest-claim-btn" onclick="claimSeasonQuest(${q.id})">Забрати!</button>` : ''}
                ${claimed ? '<span style="color:var(--primary);font-size:12px;font-weight:700">✅ Отримано</span>' : ''}
            </div>
        </div>`;
    }).join('');

    return `
    <div style="margin-top:16px">
        <div class="season-banner" style="background:linear-gradient(135deg,${seasonColors[season] || '#6366f1'},${seasonColors[season] || '#6366f1'}99);color:white;border-radius:var(--radius-md);padding:20px;margin-bottom:16px;text-align:center">
            <h3 style="margin:0 0 4px;font-size:20px">${seasonNames[season] || season}</h3>
            <div style="font-size:13px;opacity:0.9">Залишилось ${daysLeft} днів</div>
        </div>
        ${cardsHtml}
    </div>`;
}

async function claimSeasonQuest(questId) {
    const result = await apiPost(`/gamification/seasons/${questId}/claim`);
    if (result?.success) {
        if (typeof showNotification === 'function') showNotification(`🎉 Отримано: +${result.coins || 0} 🪙`, 'success');
        if (result.title && typeof AchievementPopup !== 'undefined') {
            AchievementPopup.show({ name: result.title, description: 'Новий титул за сезонний квест!', icon: '🏷️', rarity: 'epic', reward_coins: result.coins });
        }
        seasonalQuests = null;
        walletData = await apiGet('/wallet');
        switchTab('season');
    } else {
        if (typeof showNotification === 'function') showNotification(result?.error || 'Помилка', 'error');
    }
}

// ==========================================
// TEAMS & CHALLENGES TAB (v30.8.0)
// ==========================================
async function loadTeamsData() {
    const [teams, challenges] = await Promise.all([
        apiGet('/gamification/teams'),
        apiGet('/gamification/challenges')
    ]);
    teamsData = teams;
    challengesData = Array.isArray(challenges) ? challenges : [];
}

function renderTeamsTab() {
    if (!teamsData) return '<div class="empty-state"><div class="empty-state-icon">⚡</div><div class="empty-state-text">Завантаження команд...</div></div>';

    const teams = teamsData.teams || [];
    const userTeamId = teamsData.userTeamId;
    const challenges = challengesData || [];

    let teamsHtml = teams.map(t => {
        const isMyTeam = t.id === userTeamId;
        const memberAvatars = (t.members || []).slice(0, 5).map(m =>
            `<div class="team-member-avatar" title="${escapeHtml(m.display_name || m.username)}">${(m.display_name || m.username || '?')[0].toUpperCase()}</div>`
        ).join('');

        return `
        <div class="team-card ${isMyTeam ? 'my-team' : ''}" style="border-left:4px solid ${t.color || '#6366f1'}">
            <div class="team-header">
                <span class="team-icon">${t.icon || '⚡'}</span>
                <span class="team-name">${escapeHtml(t.name)}</span>
                <span class="team-count">${t.member_count || t.members?.length || 0} чол.</span>
            </div>
            <div class="team-members">${memberAvatars}${(t.members?.length || 0) > 5 ? `<span style="font-size:11px;color:var(--gray-400)">+${t.members.length - 5}</span>` : ''}</div>
            <div style="margin-top:8px">
                ${isMyTeam
                    ? `<button class="team-btn leave" onclick="leaveMyTeam()">Вийти</button>`
                    : (!userTeamId ? `<button class="team-btn join" onclick="joinTeamById(${t.id})">Приєднатися</button>` : '')}
                ${isMyTeam ? '<span style="font-size:12px;color:var(--primary);font-weight:700">Ваша команда</span>' : ''}
            </div>
        </div>`;
    }).join('');

    let challengesHtml = '';
    if (challenges.length > 0) {
        challengesHtml = `<h3 style="margin:20px 0 12px">🏆 Активні челенджі</h3>`;
        for (const ch of challenges) {
            const daysLeft = Math.max(0, Math.ceil((new Date(ch.end_date) - new Date()) / 86400000));
            const teamScores = (ch.teams || []).sort((a, b) => b.score - a.score);

            let scoresHtml = teamScores.map((ts, i) => {
                const pct = ch.target_value > 0 ? Math.min(100, Math.round((ts.score / ch.target_value) * 100)) : 0;
                const isMyTeamScore = ts.team_id === userTeamId;
                const rankIcons = ['🥇', '🥈', '🥉'];
                return `
                <div class="challenge-team-score ${isMyTeamScore ? 'my-team' : ''}">
                    <span class="challenge-rank">${rankIcons[i] || (i + 1)}</span>
                    <span class="challenge-team-name">${ts.team_icon || ''} ${escapeHtml(ts.team_name)}</span>
                    <div class="challenge-score-bar" style="flex:1"><div class="challenge-score-fill" style="width:${pct}%;background:${ts.team_color || '#6366f1'}"></div></div>
                    <span class="challenge-score-num">${ts.score}/${ch.target_value}</span>
                </div>`;
            }).join('');

            challengesHtml += `
            <div class="challenge-card">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                    <h4>${ch.icon || '🏆'} ${escapeHtml(ch.title)}</h4>
                    <span style="font-size:12px;color:var(--gray-400)">${daysLeft} днів</span>
                </div>
                ${ch.description ? `<p style="font-size:13px;color:var(--gray-500);margin-bottom:10px">${escapeHtml(ch.description)}</p>` : ''}
                <div class="challenge-scores">${scoresHtml}</div>
                <div style="font-size:12px;color:var(--gray-400);margin-top:8px">
                    Нагорода: ${ch.reward_coins_per_member} 🪙 + ${ch.reward_xp_per_member} XP на учасника
                </div>
            </div>`;
        }
    }

    return `
    <div style="margin-top:16px">
        <h3 style="margin-bottom:12px">⚡ Команди</h3>
        <div class="teams-grid">${teamsHtml}</div>
        ${challengesHtml}
    </div>`;
}

async function joinTeamById(teamId) {
    const result = await apiPost(`/gamification/teams/${teamId}/join`);
    if (result?.success) {
        if (typeof showNotification === 'function') showNotification(`⚡ Ви приєдналися до команди!`, 'success');
        teamsData = null;
        switchTab('teams');
    } else {
        if (typeof showNotification === 'function') showNotification(result?.error || 'Помилка', 'error');
    }
}

async function leaveMyTeam() {
    if (!confirm('Вийти з команди?')) return;
    const result = await apiPost('/gamification/teams/leave');
    if (result?.success) {
        if (typeof showNotification === 'function') showNotification('Ви вийшли з команди', 'success');
        teamsData = null;
        switchTab('teams');
    } else {
        if (typeof showNotification === 'function') showNotification(result?.error || 'Помилка', 'error');
    }
}

// ==========================================
// REFERRAL TAB (v30.8.0)
// ==========================================
async function loadReferralData() {
    referralData = await apiGet('/gamification/referral');
}

function renderReferralTab() {
    if (!referralData) return '<div class="empty-state"><div class="empty-state-icon">🤝</div><div class="empty-state-text">Завантаження...</div></div>';

    const code = referralData.code || '';
    const referrals = referralData.referrals || [];
    const totalReferred = referralData.totalReferred || 0;
    const totalRewarded = referralData.totalRewarded || 0;
    const totalCoins = referralData.totalCoinsEarned || 0;

    // Milestone progress
    const milestones = [
        { target: 5, label: 'Рекрутер 🤝', reward: '1000 🪙' },
        { target: 10, label: 'HR-Менеджер 👔', reward: '2500 🪙 + предмет' }
    ];

    let milestonesHtml = milestones.map(m => {
        const pct = Math.min(100, Math.round((totalRewarded / m.target) * 100));
        return `
        <div class="referral-milestone ${totalRewarded >= m.target ? 'reached' : ''}">
            <div class="referral-milestone-label">${escapeHtml(m.label)}</div>
            <div class="referral-milestone-bar"><div class="referral-milestone-fill" style="width:${pct}%"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--gray-400)">
                <span>${totalRewarded}/${m.target}</span>
                <span>${m.reward}</span>
            </div>
        </div>`;
    }).join('');

    let referralsHtml = referrals.length > 0
        ? referrals.map(r => `
            <div class="referral-row">
                <span class="referral-user">👤 ${escapeHtml(r.referred_username || '—')}</span>
                <span class="referral-status ${r.status}">${r.status === 'rewarded' ? '✅ Нагороджено' : r.status === 'active' ? '⏳ Активний' : '📋 Очікує'}</span>
                <span class="referral-date">${formatDate(r.created_at)}</span>
            </div>`).join('')
        : '<div class="empty-state" style="padding:20px"><div class="empty-state-text">Поки немає рефералів. Поділіться кодом!</div></div>';

    return `
    <div style="margin-top:16px">
        <h3 style="margin-bottom:16px">🤝 Реферальна програма</h3>

        <div class="referral-code-card">
            <div style="font-size:13px;color:var(--gray-500);margin-bottom:6px">Ваш реферальний код:</div>
            <div style="display:flex;gap:8px;align-items:center">
                <div class="referral-code-display">${escapeHtml(code)}</div>
                <button class="referral-copy-btn" onclick="copyReferralCode('${escapeHtml(code)}')">📋 Копіювати</button>
            </div>
            <div style="font-size:12px;color:var(--gray-400);margin-top:8px">
                Ви отримаєте <strong>500 🪙</strong> коли реферал створить перше бронювання.
                Реферал отримує <strong>200 🪙</strong> при реєстрації.
            </div>
        </div>

        <div class="referral-stats" style="margin:16px 0">
            <div class="referral-stat-card">
                <div class="referral-stat-value">${totalReferred}</div>
                <div class="referral-stat-label">Запрошено</div>
            </div>
            <div class="referral-stat-card">
                <div class="referral-stat-value">${totalRewarded}</div>
                <div class="referral-stat-label">Активних</div>
            </div>
            <div class="referral-stat-card">
                <div class="referral-stat-value">${formatCoins(totalCoins)} 🪙</div>
                <div class="referral-stat-label">Зароблено</div>
            </div>
        </div>

        <div style="margin-bottom:16px">
            <h4 style="margin-bottom:8px">🎯 Досягнення</h4>
            ${milestonesHtml}
        </div>

        <h4 style="margin-bottom:8px">📋 Мої реферали</h4>
        <div class="referral-list">${referralsHtml}</div>
    </div>`;
}

function copyReferralCode(code) {
    navigator.clipboard.writeText(code).then(() => {
        if (typeof showNotification === 'function') showNotification('📋 Код скопійовано!', 'success');
    }).catch(() => {
        // Fallback
        const input = document.createElement('input');
        input.value = code;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
        if (typeof showNotification === 'function') showNotification('📋 Код скопійовано!', 'success');
    });
}

// ==========================================
// MONTHLY LEADERBOARD EXTENSION (v30.8.0)
// ==========================================
function setLeaderboardMode(mode) {
    leaderboardMode = mode;
    if (mode === 'monthly' && !monthlyLeaderboard) {
        loadMonthlyLeaderboard().then(() => switchTab('leaderboard'));
        return;
    }
    switchTab('leaderboard');
}

async function loadMonthlyLeaderboard() {
    monthlyLeaderboard = await apiGet(`/gamification/leaderboard/monthly?year=${monthlyYear}&month=${monthlyMonth}&category=${monthlyCategory}`);
}

function setMonthlyFilter(category) {
    monthlyCategory = category;
    monthlyLeaderboard = null;
    loadMonthlyLeaderboard().then(() => switchTab('leaderboard'));
}

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', initProfilePage);
