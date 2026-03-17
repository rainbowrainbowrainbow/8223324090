/**
 * js/achievement-popup.js — Achievement Unlock Popup with Confetti (v30.8.0)
 *
 * Usage:
 *   AchievementPopup.show({ name, description, icon, rarity, reward_coins, reward_xp });
 *   AchievementPopup.showLevelUp({ oldLevel, newLevel, title });
 *   AchievementPopup.showXPGain(amount);
 *   AchievementPopup.showStreakMilestone(days, coins);
 */
const AchievementPopup = (() => {
    const queue = [];
    let isShowing = false;

    const RARITY_COLORS = {
        common: { bg: '#6b7280', glow: 'rgba(107,114,128,0.4)', label: 'Звичайне' },
        uncommon: { bg: '#22c55e', glow: 'rgba(34,197,94,0.4)', label: 'Незвичайне' },
        rare: { bg: '#3b82f6', glow: 'rgba(59,130,246,0.4)', label: 'Рідкісне' },
        epic: { bg: '#a855f7', glow: 'rgba(168,85,247,0.4)', label: 'Епічне' },
        legendary: { bg: '#f59e0b', glow: 'rgba(245,158,11,0.5)', label: 'Легендарне' }
    };

    const RARITY_STARS = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };

    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'achievement-overlay';
        overlay.innerHTML = `
            <canvas class="achievement-confetti" id="achievementConfetti"></canvas>
            <div class="achievement-modal" id="achievementModal">
                <div class="achievement-header">✨ НОВА АЧИВКА! ✨</div>
                <div class="achievement-icon" id="achIcon"></div>
                <div class="achievement-name" id="achName"></div>
                <div class="achievement-desc" id="achDesc"></div>
                <div class="achievement-rarity" id="achRarity"></div>
                <div class="achievement-reward" id="achReward"></div>
                <button class="achievement-btn" id="achBtn">Чудово! 🎉</button>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    }

    function show(achievement) {
        queue.push({ type: 'achievement', data: achievement });
        processQueue();
    }

    function showLevelUp(levelData) {
        queue.push({ type: 'levelup', data: levelData });
        processQueue();
    }

    function showXPGain(amount) {
        const toast = document.createElement('div');
        toast.className = 'xp-gain-toast';
        toast.textContent = `+${amount} XP`;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('xp-gain-visible'));
        setTimeout(() => {
            toast.classList.add('xp-gain-exit');
            setTimeout(() => toast.remove(), 500);
        }, 2000);
    }

    function showStreakMilestone(days, coins) {
        queue.push({ type: 'streak', data: { days, coins } });
        processQueue();
    }

    function showQuestComplete(questTitle, coins) {
        const toast = document.createElement('div');
        toast.className = 'quest-complete-toast';
        toast.innerHTML = `✅ Квест виконано: <strong>${questTitle}</strong> — +${coins} 🪙`;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('quest-toast-visible'));
        setTimeout(() => {
            toast.classList.add('quest-toast-exit');
            setTimeout(() => toast.remove(), 500);
        }, 4000);
    }

    function processQueue() {
        if (isShowing || queue.length === 0) return;
        isShowing = true;

        const item = queue.shift();
        const overlay = createOverlay();

        const modal = overlay.querySelector('#achievementModal');
        const header = overlay.querySelector('.achievement-header');
        const icon = overlay.querySelector('#achIcon');
        const name = overlay.querySelector('#achName');
        const desc = overlay.querySelector('#achDesc');
        const rarity = overlay.querySelector('#achRarity');
        const reward = overlay.querySelector('#achReward');
        const btn = overlay.querySelector('#achBtn');

        if (item.type === 'achievement') {
            const ach = item.data;
            const r = RARITY_COLORS[ach.rarity] || RARITY_COLORS.common;
            const stars = '★'.repeat(RARITY_STARS[ach.rarity] || 1);

            header.textContent = '✨ НОВА АЧИВКА! ✨';
            icon.textContent = ach.icon || '🏆';
            name.textContent = ach.name || 'Досягнення';
            desc.textContent = ach.description || '';
            rarity.innerHTML = `<span class="rarity-stars">${stars}</span> ${r.label}`;
            rarity.style.color = r.bg;
            modal.style.borderColor = r.bg;
            modal.style.boxShadow = `0 0 40px ${r.glow}`;

            const rewards = [];
            if (ach.reward_coins) rewards.push(`+${ach.reward_coins} 🪙`);
            if (ach.reward_xp) rewards.push(`+${ach.reward_xp} XP`);
            reward.textContent = rewards.length ? `Нагорода: ${rewards.join(' | ')}` : '';

        } else if (item.type === 'levelup') {
            const lv = item.data;
            header.textContent = '⬆️ РІВЕНЬ ПІДВИЩЕНО! ⬆️';
            icon.textContent = '🎖️';
            name.textContent = `Рівень ${lv.oldLevel} → ${lv.newLevel}`;
            desc.textContent = `Новий титул: ${lv.title}`;
            rarity.textContent = '';
            reward.textContent = '';
            modal.style.borderColor = '#f59e0b';
            modal.style.boxShadow = '0 0 40px rgba(245,158,11,0.5)';

        } else if (item.type === 'streak') {
            const s = item.data;
            header.textContent = '🔥 STREAK MILESTONE! 🔥';
            icon.textContent = '🔥';
            name.textContent = `${s.days} днів поспіль!`;
            desc.textContent = 'Ти на вогні! Продовжуй у тому ж дусі!';
            rarity.textContent = '';
            reward.textContent = s.coins ? `Бонус: +${s.coins} 🪙` : '';
            modal.style.borderColor = '#ef4444';
            modal.style.boxShadow = '0 0 40px rgba(239,68,68,0.5)';
        }

        // Start confetti
        const canvas = overlay.querySelector('#achievementConfetti');
        const confettiAnim = startConfetti(canvas);

        // Animate in
        requestAnimationFrame(() => {
            overlay.classList.add('achievement-overlay-visible');
            modal.classList.add('achievement-modal-visible');
        });

        // Close handler (guarded against multiple calls)
        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            modal.classList.remove('achievement-modal-visible');
            overlay.classList.remove('achievement-overlay-visible');
            confettiAnim.stop();
            setTimeout(() => {
                overlay.remove();
                isShowing = false;
                processQueue();
            }, 400);
        };

        btn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });

        // Auto-dismiss after 8s
        setTimeout(close, 8000);
    }

    // Canvas confetti particle system
    function startConfetti(canvas) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return { stop: () => {} };
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
        const particles = [];
        let running = true;

        for (let i = 0; i < 200; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height - canvas.height,
                w: Math.random() * 8 + 4,
                h: Math.random() * 6 + 2,
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                vx: (Math.random() - 0.5) * 3,
                vy: Math.random() * 3 + 2,
                rotation: Math.random() * 360,
                rotSpeed: (Math.random() - 0.5) * 10,
                opacity: 1
            });
        }

        function draw() {
            if (!running) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            let alive = 0;
            for (const p of particles) {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.05; // gravity
                p.vx += (Math.random() - 0.5) * 0.2; // wind
                p.rotation += p.rotSpeed;

                if (p.y > canvas.height) {
                    p.opacity -= 0.02;
                }

                if (p.opacity <= 0) continue;
                alive++;

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.globalAlpha = Math.max(0, p.opacity);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            }

            if (alive > 0) {
                requestAnimationFrame(draw);
            }
        }

        requestAnimationFrame(draw);

        return {
            stop: () => { running = false; }
        };
    }

    return { show, showLevelUp, showXPGain, showStreakMilestone, showQuestComplete };
})();
