/**
 * profile-page.js — Profile + Character + Inventory + Achievements + Notes + Room + Quests + Titles
 * v22.5.0
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
let activeTab = 'profile';

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
        <div class="shop-tabs" style="margin:16px 0 0">
            <button class="shop-tab ${activeTab === 'profile' ? 'active' : ''}" onclick="switchTab('profile')">Профіль</button>
            <button class="shop-tab ${activeTab === 'room' ? 'active' : ''}" onclick="switchTab('room')">Кімната</button>
            ${isOwnProfile ? `<button class="shop-tab ${activeTab === 'quests' ? 'active' : ''}" onclick="switchTab('quests')">Квести</button>` : ''}
            ${isOwnProfile ? `<button class="shop-tab ${activeTab === 'titles' ? 'active' : ''}" onclick="switchTab('titles')">Титули</button>` : ''}
        </div>

        <div id="tabContent">
            ${renderTabContent()}
        </div>
    </div>`;

    document.getElementById('mainApp').innerHTML = html;
    attachProfileListeners();
}

function switchTab(tab) {
    activeTab = tab;
    const tabContent = document.getElementById('tabContent');
    if (tabContent) {
        tabContent.innerHTML = renderTabContent();
        attachProfileListeners();
    }
    // Update tab buttons
    document.querySelectorAll('.shop-tab').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.trim() === {
            profile: 'Профіль', room: 'Кімната', quests: 'Квести', titles: 'Титули'
        }[tab]);
    });
}

function renderTabContent() {
    switch (activeTab) {
        case 'room': return renderRoom();
        case 'quests': return renderQuests();
        case 'titles': return renderTitles();
        default: return `
            ${isOwnProfile ? renderInventory() : ''}
            ${renderAchievements()}
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
// ACHIEVEMENTS
// ==========================================
function renderAchievements() {
    const visible = myAchievements.filter(a => !a.isSecret || a.completed);
    let cardsHtml = visible.map(a => {
        const pct = a.target > 1 ? Math.min(100, Math.round((a.progress / a.target) * 100)) : (a.completed ? 100 : 0);
        return `
        <div class="achievement-card ${a.completed ? 'completed' : ''} ${!a.completed && a.progress === 0 ? 'locked' : ''}">
            <div class="achievement-icon">${a.icon}</div>
            <div class="achievement-info">
                <div class="achievement-name">${escapeHtml(a.name)} <span class="rarity-badge ${a.rarity}">${RARITY_LABELS[a.rarity] || a.rarity}</span></div>
                <div class="achievement-desc">${escapeHtml(a.description)}</div>
                <div class="achievement-reward">+${a.rewardCoins} 💰</div>
                ${a.target > 1 ? `
                <div class="achievement-progress">
                    <div class="achievement-progress-fill" style="width:${pct}%"></div>
                </div>
                <div style="font-size:11px;color:var(--gray-400);margin-top:2px">${a.progress}/${a.target}</div>
                ` : ''}
            </div>
        </div>`;
    }).join('');

    return `
    <div class="achievements-section">
        <h3>🏆 Ачивки (${visible.filter(a => a.completed).length}/${visible.length})</h3>
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
    if (!confirm('Видалити нотатку?')) return;
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
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', initProfilePage);
