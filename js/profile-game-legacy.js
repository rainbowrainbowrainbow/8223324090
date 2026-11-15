/* Full edition profile game renderers. This source is not loaded by the park build. */
function renderInventory() {
    if (profileTabLock('inventory')) return renderProfileComingSoon('inventory');
    const items = myInventory || [];

    if (items.length === 0) {
        return `<div class="inventory-empty-state" style="text-align:center;padding:48px 20px">
            <div style="font-size:16px;font-weight:700;color:var(--gray-700);margin-bottom:4px">Інвентар порожній</div>
            <div style="font-size:13px;color:var(--gray-400)">Купуй предмети в магазині або отримуй за ачивки</div>
            <button onclick="switchTab('shop')" style="margin-top:16px;padding:10px 24px;border:none;border-radius:10px;background:var(--primary);color:#fff;font-weight:700;cursor:pointer;font-family:inherit">🛒 Перейти в магазин</button>
        </div>`;
    }

    const cardsHtml = items.map(item => {
        const emoji = CATEGORY_EMOJIS[item.category] || '📦';
        const rarityColor = { common: '#9ca3af', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b' }[item.rarity] || '#9ca3af';
        return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--gray-50,#f9fafb);border-radius:12px;border-left:4px solid ${rarityColor}">
            <div style="font-size:28px;flex-shrink:0">${escapeHtml(emoji)}</div>
            <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:700;color:var(--gray-800)">${escapeHtml(item.name)}</div>
                <div style="font-size:12px;color:var(--gray-400)">${RARITY_LABELS[item.rarity] || item.rarity}${item.quantity > 1 ? ' · x' + item.quantity : ''}</div>
            </div>
            ${item.isEquipped ? '<span style="padding:4px 10px;border-radius:6px;background:var(--primary);color:#fff;font-size:11px;font-weight:700">Одягнено</span>' : ''}
        </div>`;
    }).join('');

    return `<div style="margin-top:16px">
        <h3 style="margin-bottom:12px">Інвентар (${items.length})</h3>
        <div style="display:flex;flex-direction:column;gap:8px">${cardsHtml}</div>
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
        `<button class="profile-secondary-tab ${achCatFilter === c.id ? 'active' : ''}"
                 onclick="setAchCat('${c.id}')">${c.label}</button>`
    ).join('');

    let cardsHtml = filtered.map(a => {
        const pct = a.target > 1 ? Math.min(100, Math.round((a.progress / a.target) * 100)) : (a.completed ? 100 : 0);
        const rewardState = a.completed
            ? '<span class="achievement-state achievement-state--claimed">Нагороду зараховано</span>'
            : (a.progress > 0
                ? '<span class="achievement-state achievement-state--progress">У процесі</span>'
                : '<span class="achievement-state achievement-state--locked">Заблоковано</span>');
        return `
        <div class="achievement-card ${a.completed ? 'completed unlocked' : ''} ${!a.completed && a.progress === 0 ? 'locked' : ''}">
            <div class="achievement-icon">${a.icon}</div>
            <div class="achievement-info">
                <h3>${escapeHtml(a.name)} <span class="rarity-badge rarity-${a.rarity}">${RARITY_LABELS[a.rarity] || a.rarity}</span></h3>
                <p>${escapeHtml(a.description)}</p>
                <div class="achievement-reward">+${a.rewardCoins} 💰 ${rewardState}</div>
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
        <div class="profile-secondary-tabs">${tabsHtml}</div>
        <div class="achievements-grid">${cardsHtml}</div>
    </div>`;
}

function renderDailyPreview() {
    if (!questsData?.quests || questsData.quests.length === 0) return '';
    const unclaimed = questsData.quests.filter(q => q.completed && !q.claimed).length;
    const done = questsData.quests.filter(q => q.completed).length;
    const total = questsData.quests.length;
    const totalCoins = questsData.quests.reduce((s, q) => s + (q.rewardCoins || 0), 0);
    const earnedCoins = questsData.quests.filter(q => q.claimed).reduce((s, q) => s + (q.rewardCoins || 0), 0);

    // Show first 3 incomplete quests as preview
    const preview = questsData.quests.filter(q => !q.claimed).slice(0, 3);
    const previewHtml = preview.map(q => {
        const icon = QUEST_ICONS[q.questType] || '📋';
        const pct = q.targetValue > 0 ? Math.min(100, Math.round((q.progress / q.targetValue) * 100)) : 0;
        const canClaim = q.completed && !q.claimed;
        const pending = isRewardClaimPending('quest', q.id);
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;${canClaim || pending ? 'opacity:1' : ''}">
            <span style="font-size:18px;flex-shrink:0">${icon}</span>
            <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;color:var(--gray-700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(q.title)}</div>
                <div style="height:4px;background:var(--gray-200);border-radius:2px;margin-top:3px;overflow:hidden">
                    <div style="height:100%;width:${pct}%;background:${canClaim ? '#22c55e' : 'var(--primary)'};border-radius:2px;transition:width 0.4s"></div>
                </div>
            </div>
            <span style="font-size:11px;color:var(--gray-400);flex-shrink:0">${q.progress}/${q.targetValue}</span>
            ${canClaim || pending ? renderRewardClaimButton('quest', q.id, 'Забрати', { stopPropagation: true, compact: true }) : ''}
        </div>`;
    }).join('');

    return `
    <div style="margin-bottom:16px;padding:16px;background:var(--gray-50,#f9fafb);border-radius:12px;border:1px solid var(--gray-100,#f3f4f6)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="margin:0;font-size:15px;font-weight:700">📋 Щоденні завдання</h3>
            <div style="display:flex;gap:12px;align-items:center">
                <span style="font-size:12px;color:var(--gray-400)">💰 ${earnedCoins}/${totalCoins}</span>
                <span style="font-size:13px;font-weight:700;color:var(--primary)">${done}/${total}</span>
            </div>
        </div>
        <div style="height:6px;background:var(--gray-200);border-radius:3px;overflow:hidden;margin-bottom:10px">
            <div style="height:100%;width:${total > 0 ? Math.round(done/total*100) : 0}%;background:var(--primary);border-radius:3px;transition:width 0.4s"></div>
        </div>
        ${unclaimed > 0 ? `<div style="color:#22c55e;font-size:13px;font-weight:600;margin-bottom:8px;animation:badge-pulse 1.5s infinite">🎁 ${unclaimed} нагород готові до збору!</div>` : ''}
        ${previewHtml}
        ${questsData.quests.length > 3 ? `<button onclick="switchTab('quests')" style="margin-top:8px;width:100%;padding:8px 16px;border:none;border-radius:8px;background:var(--primary);color:#fff;font-weight:600;cursor:pointer;font-family:inherit;font-size:13px">Всі завдання →</button>` : ''}
    </div>`;
}

function renderQuests() {
    if (profileTabLock('quests')) return renderProfileComingSoon('quests');
    if (!questsData?.quests) return '<div style="text-align:center;padding:40px;color:var(--gray-500)">Квести завантажуються...</div>';

    const quests = questsData.quests;
    let html = '<div class="quests-container" style="margin-top:16px">';
    html += '<h3>Щоденні квести</h3>';

    for (const q of quests) {
        const icon = QUEST_ICONS[q.questType] || '📋';
        const pct = q.targetValue > 0 ? Math.min(100, Math.round((q.progress / q.targetValue) * 100)) : 0;
        const canClaim = q.completed && !q.claimed;
        const pending = isRewardClaimPending('quest', q.id);

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
                ${canClaim || pending ? renderRewardClaimButton('quest', q.id, 'Забрати') : ''}
                ${q.claimed ? '<span class="reward-state-badge reward-state-badge--claimed">Отримано</span>' : ''}
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
    if (profileTabLock('shop')) return;
    const data = await apiGet('/gamification/shop');
    shopItems = data || [];
}

function renderShopTab() {
    if (profileTabLock('shop')) return renderProfileComingSoon('shop');
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
    if (profileTabLock('shop')) {
        if (typeof showNotification === 'function') showNotification('Магазин поки закритий для цієї ролі', 'warning');
        return;
    }
    if (!await confirmModal(`Купити "${itemName}"?`, { okText: 'Купити', cancelText: 'Скасувати' })) return;
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
    <div class="profile-secondary-tabs">
        <button class="profile-secondary-tab ${leaderboardMode === 'overall' ? 'active' : ''}"
                onclick="setLeaderboardMode('overall')">🏅 Загальний</button>
        <button class="profile-secondary-tab ${leaderboardMode === 'monthly' ? 'active' : ''}"
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
        `<button class="profile-secondary-tab ${leaderboardSort === s.id ? 'active' : ''}"
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
        <div class="profile-secondary-tabs">${tabsHtml}</div>
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
        `<button class="profile-secondary-tab ${monthlyCategory === c.id ? 'active' : ''}"
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
        <div class="profile-secondary-tabs">${catTabs}</div>
        ${listHtml}
    </div>`;
}

async function refreshProfileRewardSurfaces(options = {}) {
    const {
        reloadAchievements = false,
        reloadQuests = true,
        reloadWallet = true,
        reloadSeason = false,
        reloadProfile = false
    } = options;

    if (reloadProfile && currentUserId) {
        profileData = await apiGet(isOwnProfile ? '/auth/profile' : `/auth/profile/${currentUserId}`);
    }
    if (reloadAchievements) myAchievements = await apiGet('/achievements') || [];
    if (reloadQuests && isOwnProfile) questsData = await apiGet('/quests/daily');
    if (reloadWallet && isOwnProfile) walletData = await apiGet('/wallet');
    if (reloadSeason && isOwnProfile) {
        seasonalQuests = null;
        await loadSeasonalQuests();
    }

    renderProfile();
}

function profileAutoRewardContextKey() {
    const user = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser : {};
    let sessionGeneration = '';
    try {
        sessionGeneration = localStorage.getItem('pzp_auth_session_generation') || '';
    } catch {}
    return JSON.stringify({
        userId: String(user.id ?? user.userId ?? currentUserId ?? ''),
        username: String(user.username || ''),
        sessionGeneration
    });
}

function isProfileAutoRewardContextCurrent(contextKey) {
    return isOwnProfile && profileAutoRewardContextKey() === contextKey;
}

function checkProfileAutoRewards(options = {}) {
    if (!isOwnProfile) return Promise.resolve();
    const force = options.force === true;
    const contextKey = profileAutoRewardContextKey();
    const pending = profileAutoRewardChecksPending.get(contextKey);
    if (pending) return pending;
    if (!force && profileAutoRewardCheckCompletedKey === contextKey) return Promise.resolve();

    const request = (async () => {
        try {
            const result = await apiPost('/achievements/check', {});
            if (!isProfileAutoRewardContextCurrent(contextKey)) return { stale: true };
            await apiPost('/quests/check-titles', {});
            if (!isProfileAutoRewardContextCurrent(contextKey)) return { stale: true };
            profileAutoRewardCheckCompletedKey = contextKey;
            const awardedCount = result?.count || result?.awarded?.length || 0;
            if (awardedCount > 0) {
                if (typeof showNotification === 'function') {
                    showNotification(`🎉 Нові досягнення: ${awardedCount}. Нагороду зараховано`, 'success');
                }
                await refreshProfileRewardSurfaces({
                    reloadAchievements: true,
                    reloadQuests: false,
                    reloadWallet: true
                });
            }
            return { success: true };
        } catch (error) {
            console.warn('Profile auto reward check failed', error);
            return { success: false };
        } finally {
            if (profileAutoRewardChecksPending.get(contextKey) === request) {
                profileAutoRewardChecksPending.delete(contextKey);
            }
        }
    })();
    profileAutoRewardChecksPending.set(contextKey, request);
    return request;
}
