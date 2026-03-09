/**
 * js/profile-page.js — Profile & Gamification page (v22.2.0)
 *
 * Standalone page for user profile, achievements, inventory, shop, leaderboard.
 */
(function () {
    'use strict';

    const API = (typeof CONFIG !== 'undefined' && CONFIG.API_URL) || '/api';

    let token = localStorage.getItem('token');
    let currentUser = null;
    let profileData = null;
    let hobbies = [];

    // --- Auth ---
    function parseJWT(t) {
        try {
            return JSON.parse(atob(t.split('.')[1]));
        } catch { return null; }
    }

    function checkAuth() {
        if (!token) {
            window.location.href = '/?redirect=profile';
            return false;
        }
        const payload = parseJWT(token);
        if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
            localStorage.removeItem('token');
            window.location.href = '/?redirect=profile';
            return false;
        }
        currentUser = payload.username || payload.sub;
        return true;
    }

    // --- API helpers ---
    async function api(path, options = {}) {
        const res = await fetch(`${API}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...(options.headers || {})
            }
        });
        if (res.status === 401) {
            localStorage.removeItem('token');
            window.location.href = '/?redirect=profile';
            return null;
        }
        return res;
    }

    // --- Dark mode ---
    function initDarkMode() {
        const saved = localStorage.getItem('darkMode');
        if (saved === 'true' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    }

    // --- Profile URL ---
    function getViewUsername() {
        const params = new URLSearchParams(window.location.search);
        return params.get('user') || currentUser;
    }

    // --- Load profile ---
    async function loadProfile() {
        const username = getViewUsername();
        const isOwn = username === currentUser;

        const res = await api(`/gamification/profile/${username}`);
        if (!res || !res.ok) {
            document.getElementById('profileName').textContent = 'Помилка завантаження';
            return;
        }

        profileData = await res.json();
        const { profile, currency, achievements, inventory, equipped, streaks, level } = profileData;

        // Header
        document.getElementById('profileName').textContent = profile.display_name || username;
        document.getElementById('profileTitle').textContent = `${level.title} · Рівень ${level.level}`;
        document.getElementById('statLevel').textContent = level.level;
        document.getElementById('statCoins').textContent = currency?.coins || 0;
        document.getElementById('statAchievements').textContent = achievements.length;
        document.getElementById('statStreak').textContent = streaks?.current_streak || 0;

        // Avatar
        const avatarEl = document.getElementById('profileAvatar');
        if (profile.avatar_url) {
            avatarEl.innerHTML = `<img src="${escapeHtml(profile.avatar_url)}" alt="Avatar">`;
        } else {
            const initial = (profile.display_name || username).charAt(0).toUpperCase();
            avatarEl.innerHTML = `<span class="avatar-placeholder">${initial}</span>`;
        }

        // Equipped frame
        const equippedFrame = equipped.find(e => e.slot === 'frame');
        if (equippedFrame) {
            const frameClass = equippedFrame.rarity === 'epic' ? 'frame-diamond' : 'frame-gold';
            avatarEl.innerHTML += `<div class="avatar-frame ${frameClass}"></div>`;
        }

        // XP bar
        if (level.xpForNext) {
            const progress = level.xp - level.xpForCurrent;
            const needed = level.xpForNext - level.xpForCurrent;
            const pct = Math.min(100, (progress / needed) * 100);
            document.getElementById('xpBarFill').style.width = pct + '%';
            document.getElementById('xpLabelCurrent').textContent = `${level.xp} XP`;
            document.getElementById('xpLabelNext').textContent = `${level.xpForNext - level.xp} XP до "${level.nextTitle}"`;
        } else {
            document.getElementById('xpBarFill').style.width = '100%';
            document.getElementById('xpLabelCurrent').textContent = `${level.xp} XP`;
            document.getElementById('xpLabelNext').textContent = 'Максимальний рівень!';
        }

        // Settings form (only for own profile)
        if (isOwn) {
            document.getElementById('editDisplayName').value = profile.display_name || '';
            document.getElementById('editBio').value = profile.bio || '';
            document.getElementById('editPublic').checked = profile.is_public !== false;
            hobbies = profile.hobbies || [];
            renderHobbies();
        } else {
            // Hide settings tab for other profiles
            const settingsTab = document.querySelector('[data-tab="settings"]');
            if (settingsTab) settingsTab.style.display = 'none';
        }

        // Load achievements
        loadAchievements();
        renderInventory(inventory, equipped);
    }

    // --- Achievements ---
    async function loadAchievements() {
        const res = await api('/gamification/achievements');
        if (!res || !res.ok) return;

        const achievements = await res.json();
        const grid = document.getElementById('achievementsGrid');

        if (achievements.length === 0) {
            grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🏆</div><div class="empty-state-text">Ачивок поки немає</div></div>`;
            return;
        }

        grid.innerHTML = achievements.map(ach => {
            const isUnlocked = ach.unlocked;
            const cls = isUnlocked ? 'unlocked' : 'locked';
            const dateStr = ach.unlocked_at ? formatDate(ach.unlocked_at) : '';

            return `
                <div class="achievement-card ${cls}">
                    <div class="achievement-icon">${ach.icon}</div>
                    <div class="achievement-info">
                        <h3>${escapeHtml(ach.name)} <span class="rarity-badge rarity-${ach.rarity}">${rarityLabel(ach.rarity)}</span></h3>
                        <p>${escapeHtml(ach.description)}</p>
                        <div class="achievement-reward">🪙 ${ach.reward_value} монет</div>
                        ${dateStr ? `<div class="achievement-date">Отримано: ${dateStr}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // --- Inventory ---
    function renderInventory(inventory, equipped) {
        const grid = document.getElementById('inventoryGrid');

        if (!inventory || inventory.length === 0) {
            grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎒</div><div class="empty-state-text">Інвентар порожній. Купіть щось у магазині!</div></div>`;
            return;
        }

        const equippedIds = new Set((equipped || []).map(e => e.item_id));

        grid.innerHTML = inventory.map(item => {
            const isEquipped = equippedIds.has(item.item_id);
            return `
                <div class="inventory-item ${isEquipped ? 'equipped' : ''}" data-item-id="${item.item_id}" onclick="profilePage.toggleEquip(${item.item_id}, '${item.type}', ${isEquipped})">
                    <div class="inventory-item-icon">${item.icon}</div>
                    <div class="inventory-item-name">${escapeHtml(item.name)}</div>
                    <div class="inventory-item-type">${typeLabel(item.type)}</div>
                    <span class="rarity-badge rarity-${item.rarity}">${rarityLabel(item.rarity)}</span>
                </div>
            `;
        }).join('');
    }

    // --- Shop ---
    async function loadShop() {
        const res = await api('/gamification/shop');
        if (!res || !res.ok) return;

        const items = await res.json();
        const grid = document.getElementById('shopGrid');

        // Update coins balance in shop header
        const coinsEl = document.getElementById('shopCoinsBalance');
        if (profileData?.currency) {
            coinsEl.textContent = `🪙 ${profileData.currency.coins}`;
        }

        if (items.length === 0) {
            grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🛒</div><div class="empty-state-text">Магазин порожній</div></div>`;
            return;
        }

        grid.innerHTML = items.map(item => {
            const canAfford = profileData?.currency?.coins >= item.price_coins;
            const isOwned = item.owned;
            return `
                <div class="shop-card ${item.is_featured ? 'featured' : ''} ${isOwned ? 'owned' : ''}">
                    <div class="shop-icon">${item.icon}</div>
                    <div class="shop-name">${escapeHtml(item.name)}</div>
                    <div class="shop-desc">${escapeHtml(item.description)}</div>
                    ${item.item_rarity ? `<span class="rarity-badge rarity-${item.item_rarity}">${rarityLabel(item.item_rarity)}</span>` : ''}
                    <div class="shop-price">🪙 ${item.price_coins}</div>
                    ${item.price_display ? `<div class="shop-price-real">Цінність: ${escapeHtml(item.price_display)}</div>` : ''}
                    <button class="shop-buy-btn"
                        ${(!canAfford || isOwned) ? 'disabled' : ''}
                        onclick="profilePage.buyItem(${item.id})">
                        ${isOwned ? 'Вже маєте' : canAfford ? 'Купити' : 'Недостатньо монет'}
                    </button>
                </div>
            `;
        }).join('');
    }

    // --- Leaderboard ---
    async function loadLeaderboard(sortBy = 'xp') {
        const res = await api(`/gamification/leaderboard?sort=${sortBy}`);
        if (!res || !res.ok) return;

        const data = await res.json();
        const list = document.getElementById('leaderboardList');

        if (data.length === 0) {
            list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">Поки немає учасників</div></div>`;
            return;
        }

        const labelMap = { xp: 'XP', coins: 'Монети', achievements: 'Ачивки' };
        const valueKey = sortBy === 'coins' ? 'coins' : sortBy === 'achievements' ? 'achievement_count' : 'xp';

        list.innerHTML = data.map((user, i) => {
            const rank = i + 1;
            const rankClass = rank <= 3 ? `top-${rank}` : '';
            const isMe = user.username === currentUser;
            const initial = (user.display_name || user.username).charAt(0).toUpperCase();

            return `
                <div class="leaderboard-item ${isMe ? 'is-me' : ''}">
                    <div class="leaderboard-rank ${rankClass}">${rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}</div>
                    <div class="leaderboard-avatar">${initial}</div>
                    <div class="leaderboard-user">
                        <div class="leaderboard-name">${escapeHtml(user.display_name || user.username)}</div>
                        <div class="leaderboard-title-text">${escapeHtml(user.title || 'Новачок')} · Lv.${user.level || 1}</div>
                    </div>
                    <div class="leaderboard-score">
                        <div class="leaderboard-score-value">${user[valueKey] || 0}</div>
                        <div class="leaderboard-score-label">${labelMap[sortBy]}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // --- Coin History ---
    async function loadCoinHistory() {
        const res = await api('/gamification/coins/history');
        if (!res || !res.ok) return;

        const data = await res.json();
        const list = document.getElementById('coinHistoryList');

        if (!data.transactions || data.transactions.length === 0) {
            list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📜</div><div class="empty-state-text">Немає транзакцій</div></div>`;
            return;
        }

        list.innerHTML = data.transactions.map(tx => {
            const isPositive = tx.amount > 0;
            return `
                <div class="coin-history-item">
                    <div>
                        <div class="coin-reason">${escapeHtml(tx.reason || tx.type)}</div>
                        <div class="coin-date">${formatDate(tx.created_at)}</div>
                    </div>
                    <div class="coin-amount ${isPositive ? 'positive' : 'negative'}">
                        ${isPositive ? '+' : ''}${tx.amount} 🪙
                    </div>
                </div>
            `;
        }).join('');
    }

    // --- Actions ---
    async function buyItem(shopItemId) {
        if (!confirm('Підтвердити покупку?')) return;

        const res = await api('/gamification/shop/buy', {
            method: 'POST',
            body: JSON.stringify({ shopItemId })
        });

        if (!res) return;
        const data = await res.json();

        if (res.ok && data.success) {
            showToast(`Куплено: ${data.item}!`, 'success');
            await loadProfile();
            loadShop();
        } else {
            showToast(data.error || 'Помилка покупки', 'error');
        }
    }

    async function toggleEquip(itemId, type, isEquipped) {
        if (getViewUsername() !== currentUser) return;

        let res;
        if (isEquipped) {
            res = await api('/gamification/unequip', {
                method: 'POST',
                body: JSON.stringify({ slot: type })
            });
        } else {
            res = await api('/gamification/equip', {
                method: 'POST',
                body: JSON.stringify({ itemId })
            });
        }

        if (res && res.ok) {
            showToast(isEquipped ? 'Знято' : 'Одягнено!', 'success');
            await loadProfile();
        }
    }

    async function saveProfile() {
        const data = {
            display_name: document.getElementById('editDisplayName').value.trim(),
            bio: document.getElementById('editBio').value.trim(),
            hobbies: hobbies,
            is_public: document.getElementById('editPublic').checked
        };

        const res = await api('/gamification/profile', {
            method: 'PUT',
            body: JSON.stringify(data)
        });

        if (res && res.ok) {
            showToast('Профіль збережено!', 'success');
            await loadProfile();
        } else {
            showToast('Помилка збереження', 'error');
        }
    }

    // --- Hobbies ---
    function renderHobbies() {
        const container = document.getElementById('hobbiesTags');
        container.innerHTML = hobbies.map((h, i) => `
            <span class="hobby-tag">
                ${escapeHtml(h)}
                <span class="remove-hobby" onclick="profilePage.removeHobby(${i})">✕</span>
            </span>
        `).join('');
    }

    function addHobby() {
        const input = document.getElementById('hobbyInput');
        const val = input.value.trim();
        if (!val || hobbies.length >= 10) return;
        if (hobbies.includes(val)) return;
        hobbies.push(val);
        input.value = '';
        renderHobbies();
    }

    function removeHobby(index) {
        hobbies.splice(index, 1);
        renderHobbies();
    }

    // --- Tabs ---
    function initTabs() {
        // Main tabs
        document.getElementById('profileTabs').addEventListener('click', (e) => {
            const tab = e.target.closest('.profile-tab');
            if (!tab) return;

            const tabName = tab.dataset.tab;
            if (!tabName) return;

            // Update active tab
            document.querySelectorAll('#profileTabs .profile-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Show section
            document.querySelectorAll('.profile-section').forEach(s => s.classList.remove('active'));
            const section = document.getElementById(`section${capitalize(tabName)}`);
            if (section) section.classList.add('active');

            // Lazy load
            if (tabName === 'shop') loadShop();
            if (tabName === 'leaderboard') loadLeaderboard();
            if (tabName === 'history') loadCoinHistory();
        });

        // Leaderboard sort tabs
        document.getElementById('leaderboardTabs').addEventListener('click', (e) => {
            const tab = e.target.closest('.profile-tab');
            if (!tab || !tab.dataset.sort) return;

            document.querySelectorAll('#leaderboardTabs .profile-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            loadLeaderboard(tab.dataset.sort);
        });

        // Hobby add
        document.getElementById('addHobbyBtn').addEventListener('click', addHobby);
        document.getElementById('hobbyInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addHobby(); }
        });

        // Save profile
        document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
    }

    // --- Utils ---
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function rarityLabel(rarity) {
        const map = {
            common: 'Звичайна',
            uncommon: 'Незвичайна',
            rare: 'Рідкісна',
            epic: 'Епічна',
            legendary: 'Легендарна'
        };
        return map[rarity] || rarity;
    }

    function typeLabel(type) {
        const map = {
            background: 'Фон',
            frame: 'Рамка',
            hat: 'Головний убір',
            weapon: 'Зброя',
            shield: 'Щит',
            outfit: 'Одяг',
            effect: 'Ефект',
            badge: 'Бейдж'
        };
        return map[type] || type;
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
            padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;
            z-index: 10000; animation: fadeIn 0.2s ease;
            color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            background: ${type === 'success' ? '#059669' : type === 'error' ? '#dc2626' : '#6366f1'};
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    // --- Init ---
    function init() {
        initDarkMode();
        if (!checkAuth()) return;
        initTabs();
        loadProfile();

        // Auto-check achievements on page load
        api('/gamification/achievements/check', { method: 'POST' }).catch(() => {});
    }

    // Expose for inline handlers
    window.profilePage = {
        buyItem,
        toggleEquip,
        removeHobby,
        addHobby
    };

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
