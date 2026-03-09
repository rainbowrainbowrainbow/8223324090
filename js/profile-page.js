/**
 * profile-page.js — Profile + Character + Inventory + Achievements + Notes
 * v22.4.0
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
const CATEGORY_EMOJIS = { background: '🖼️', weapon: '⚔️', hat: '🎩', outfit: '👕', frame: '🖼️', coupon: '🎫' };
const NOTE_COLORS = ['#fef3c7', '#dcfce7', '#dbeafe', '#fce7f3', '#f3e8ff', '#e0e7ff'];

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
        isOwnProfile ? apiGet('/notes') : null
    ]);

    profileData = results[0];
    walletData = results[1];
    myInventory = results[2] || [];
    myAchievements = results[3] || [];
    myNotes = results[4] || [];
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

    // Background emoji mapping
    const bgMap = { bg_park: '🌳', bg_dino: '🦕', bg_neon: '💜', bg_space: '🌌', bg_gold: '✨' };
    const hatMap = { hat_dino: '🦕', hat_crown: '👑', hat_chef: '👨‍🍳' };
    const bodyMap = { out_animator: '🎭', out_pirate: '🏴‍☠️', out_space: '🚀' };
    const weaponMap = { wp_sword: '⚔️', wp_laser: '🔦', wp_dino_bone: '🦴', wp_trident: '🔱' };

    const bgEmoji = equipped.background ? (bgMap[equipped.background.code] || '🖼️') : '🌳';
    const hatEmoji = equipped.head ? (hatMap[equipped.head.code] || '🎩') : '';
    const bodyEmoji = equipped.body ? (bodyMap[equipped.body.code] || '👕') : '';
    const weaponEmoji = equipped.hand ? (weaponMap[equipped.hand.code] || '⚔️') : '';
    const frameRarity = equipped.frame?.rarity || '';

    // Avatar letter
    const avatarLetter = (p.displayName || p.username || '?')[0].toUpperCase();

    const completedAch = myAchievements.filter(a => a.completed);
    const totalAch = myAchievements.filter(a => !a.isSecret || a.completed).length;

    let html = `
    <div class="profile-page">
        <div style="margin-bottom:16px">
            <a href="/" style="color:var(--primary);text-decoration:none;font-weight:600">← Назад</a>
        </div>

        <div class="profile-header">
            <!-- Character Display -->
            <div class="character-display">
                <div class="character-bg">${escapeHtml(bgEmoji)}</div>
                <div class="character-avatar">${escapeHtml(avatarLetter)}</div>
                ${hatEmoji ? `<div class="character-hat">${escapeHtml(hatEmoji)}</div>` : ''}
                ${bodyEmoji ? `<div class="character-body">${escapeHtml(bodyEmoji)}</div>` : ''}
                ${weaponEmoji ? `<div class="character-weapon">${escapeHtml(weaponEmoji)}</div>` : ''}
                ${frameRarity ? `<div class="character-frame" data-rarity="${escapeHtml(frameRarity)}"></div>` : ''}
                <div class="character-name">${escapeHtml(p.displayName || p.username)}</div>
            </div>

            <!-- Profile Info -->
            <div class="profile-info">
                <h1>${escapeHtml(p.displayName || p.username)}</h1>
                <div class="profile-role">${escapeHtml(p.role)}</div>
                ${p.bio ? `<div class="profile-bio">${escapeHtml(p.bio)}</div>` : ''}

                <div class="profile-stats">
                    <div class="profile-stat">
                        <div class="profile-stat-value">💰 ${formatCoins(isOwnProfile ? walletData?.coins : p.coins)}</div>
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
                    <a href="/shop" class="shop-buy-btn" style="text-decoration:none">🛒 Магазин</a>
                    <a href="/game" class="shop-buy-btn" style="text-decoration:none;background:#22c55e">🎮 Міні-гра</a>
                </div>` : ''}
            </div>
        </div>

        ${isOwnProfile ? renderInventory() : ''}
        ${renderAchievements()}
        ${isOwnProfile ? renderNotes() : ''}
    </div>`;

    document.getElementById('mainApp').innerHTML = html;
    attachProfileListeners();
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

    // Check for new achievements
    apiPost('/achievements/check', {});
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
