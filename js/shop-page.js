/**
 * shop-page.js — Shop page
 * v22.4.0
 */

let shopItems = [];
let shopInventory = [];
let shopWallet = null;
let activeCategory = 'all';

const CATEGORY_TABS = [
    { id: 'all', label: 'Все' },
    { id: 'background', label: '🖼️ Фони' },
    { id: 'hat', label: '🎩 Капелюхи' },
    { id: 'outfit', label: '👕 Одяг' },
    { id: 'weapon', label: '⚔️ Зброя' },
    { id: 'frame', label: '🖼️ Рамки' },
    { id: 'coupon', label: '🎫 Купони' }
];

const RARITY_LABELS = { common: 'Звичайний', uncommon: 'Незвичайний', rare: 'Рідкісний', epic: 'Епічний', legendary: 'Легендарний' };

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function shopApiGet(path) {
    try {
        const r = await fetch(`/api${path}`, { headers: getAuthHeaders(false) });
        if (handleAuthError(r)) return null;
        if (!r.ok) return null;
        return await r.json();
    } catch (e) { console.error('Shop API GET', path, e); return null; }
}

async function shopApiPost(path, body) {
    try {
        const r = await fetch(`/api${path}`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(body) });
        if (handleAuthError(r)) return null;
        return await r.json();
    } catch (e) { console.error('Shop API POST', path, e); return null; }
}

async function initShopPage() {
    if (localStorage.getItem('pzp_dark_mode') === 'true') document.body.classList.add('dark-mode');
    const token = localStorage.getItem('pzp_token');
    if (!token) { window.location.href = '/'; return; }

    const [items, inventory, wallet] = await Promise.all([
        shopApiGet('/shop'),
        shopApiGet('/inventory'),
        shopApiGet('/wallet')
    ]);
    shopItems = items || [];
    shopInventory = inventory || [];
    shopWallet = wallet;
    renderShop();
}

function renderShop() {
    const ownedCodes = new Set(shopInventory.map(i => i.code));
    const filtered = activeCategory === 'all' ? shopItems : shopItems.filter(i => i.category === activeCategory);

    const tabsHtml = CATEGORY_TABS.map(t =>
        `<button class="shop-tab ${activeCategory === t.id ? 'active' : ''}" onclick="setCategory('${t.id}')">${t.label}</button>`
    ).join('');

    const cardsHtml = filtered.map(item => {
        const owned = ownedCodes.has(item.code);
        const canAfford = shopWallet && shopWallet.coins >= item.priceCoins;
        const emoji = { background: '🖼️', weapon: '⚔️', hat: '🎩', outfit: '👕', frame: '🖼️', coupon: '🎫' }[item.category] || '📦';

        return `
        <div class="shop-card ${owned ? 'owned' : ''}">
            <div class="shop-card-icon">${emoji}</div>
            <div class="shop-card-name">${escapeHtml(item.name)}</div>
            <div class="shop-card-desc">${escapeHtml(item.description)}</div>
            <span class="rarity-badge ${item.rarity}">${RARITY_LABELS[item.rarity] || item.rarity}</span>
            <div class="shop-card-price ${item.priceCoins === 0 ? 'free' : ''}">${item.priceCoins === 0 ? 'Безкоштовно' : `💰 ${item.priceCoins}`}</div>
            ${item.isReal ? `<div class="shop-card-real">Реальний приз: ${escapeHtml(item.realValue)}</div>` : ''}
            ${owned
                ? '<button class="shop-buy-btn" disabled>✅ У вас є</button>'
                : `<button class="shop-buy-btn" ${!canAfford ? 'disabled' : ''} onclick="buyItem(${item.id}, this.dataset.name)" data-name="${escapeHtml(item.name)}">${canAfford ? '🛒 Купити' : '🔒 Замало монет'}</button>`
            }
        </div>`;
    }).join('');

    document.getElementById('mainApp')?.innerHTML = `
    <div class="shop-page">
        <div style="margin-bottom:16px">
            <a href="/profile" style="color:var(--primary);text-decoration:none;font-weight:600">← Профіль</a>
        </div>
        <div class="shop-header">
            <h1>🛒 Магазин</h1>
            <div class="shop-balance"><span class="coin-icon">💰</span> ${(shopWallet?.coins || 0).toLocaleString('uk-UA')} монет</div>
        </div>
        <div class="shop-tabs">${tabsHtml}</div>
        <div class="shop-grid">${cardsHtml}</div>
    </div>`;
}

function setCategory(cat) {
    activeCategory = cat;
    renderShop();
}

async function buyItem(itemId, itemName) {
    const ok = await confirmModal(`Купити "${itemName}"?`, { okText: 'Купити', type: 'success' });
    if (!ok) return;

    const result = await shopApiPost('/shop/buy', { item_id: itemId });
    if (result?.success) {
        // Purchase animation
        showPurchaseEffect(itemName);
        // Reload
        const [inventory, wallet] = await Promise.all([shopApiGet('/inventory'), shopApiGet('/wallet')]);
        shopInventory = inventory || [];
        shopWallet = wallet;
        renderShop();
    } else {
        showNotification(result?.error || 'Помилка покупки', 'error');
    }
}

function showPurchaseEffect(itemName) {
    // Success notification
    showNotification(`✅ Куплено: ${itemName}`, 'success');

    // Confetti-like particle burst
    const container = document.createElement('div');
    container.className = 'purchase-effect';
    container.innerHTML = Array.from({ length: 12 }, () => {
        const emoji = ['✨', '🎉', '💰', '⭐', '🪙'][Math.floor(Math.random() * 5)];
        const x = (Math.random() - 0.5) * 200;
        const y = -(Math.random() * 150 + 50);
        const r = Math.random() * 360;
        return `<span class="purchase-particle" style="--x:${x}px;--y:${y}px;--r:${r}deg">${emoji}</span>`;
    }).join('');
    document.body.appendChild(container);
    setTimeout(() => container.remove(), 1200);

    // Sound effect (Web Audio API — short blip)
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        // Play a pleasant ascending tone
        osc.frequency.setValueAtTime(523, ctx.currentTime);      // C5
        osc.frequency.setValueAtTime(659, ctx.currentTime + 0.08); // E5
        osc.frequency.setValueAtTime(784, ctx.currentTime + 0.16); // G5
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
    } catch (e) { /* audio not supported */ }
}

document.addEventListener('DOMContentLoaded', initShopPage);
