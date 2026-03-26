/**
 * js/training-page.js — Training Knowledge Base (v25.0.0)
 * 4 tabs: Materials, Tests, Progress, Leaderboard
 */
(function() {
    'use strict';

    const token = localStorage.getItem('pzp_token');
    if (!token) { window.location.href = '/'; return; }

    const API = window.API_BASE || '';
    const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    let currentRole = 'all';
    let articlesData = [];
    let testsData = [];

    // ═══ Init ═══
    if (typeof Sidebar !== 'undefined') Sidebar.init('#sidebarLinks');
    initTabs();
    initRoleFilter();
    loadOverviewStats();
    loadArticles();

    // ═══ Tabs ═══
    function initTabs() {
        document.getElementById('trainingTabs')?.addEventListener('click', e => {
            const tab = e.target.closest('.training-tab');
            if (!tab) return;
            const tabName = tab.dataset.tab;

            document.querySelectorAll('.training-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const target = document.getElementById('tab' + tabName.charAt(0)?.toUpperCase() + tabName.slice(1));
            if (target) target.classList.add('active');

            // Lazy load tab data
            if (tabName === 'tests' && testsData.length === 0) loadTests();
            if (tabName === 'progress') loadProgress();
            if (tabName === 'leaderboard') loadLeaderboard();
        });
    }

    // ═══ Role Filter ═══
    function initRoleFilter() {
        document.getElementById('roleFilter')?.addEventListener('click', e => {
            const pill = e.target.closest('.role-pill');
            if (!pill) return;
            document.querySelectorAll('.role-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentRole = pill.dataset.role;
            loadArticles();
        });
    }

    // ═══ Overview Stats ═══
    async function loadOverviewStats() {
        try {
            const res = await fetch(API + '/api/training/overview-stats', { headers });
            if (!res.ok) return;
            const data = await res.json();
            document.getElementById('statArticles').textContent = data.totalArticles || 0;
            document.getElementById('statTests').textContent = data.totalTests || 0;
            document.getElementById('statRead').textContent = data.readByUser || 0;
            document.getElementById('statPassed').textContent = data.passedByUser || 0;
        } catch (e) { console.error('Stats error', e); }
    }

    // ═══ Tab 1: Materials ═══
    async function loadArticles() {
        const grid = document.getElementById('articlesGrid');
        try {
            const roleParam = currentRole !== 'all' ? `?role=${currentRole}` : '';
            const res = await fetch(API + '/api/training/knowledge-base' + roleParam, { headers });
            if (!res.ok) throw new Error('Failed');
            const data = await res.json();
            articlesData = data.articles || [];

            if (articlesData.length === 0) {
                grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📚</div><div class="empty-text">Немає матеріалів для цієї ролі</div></div>';
                return;
            }

            grid.innerHTML = articlesData.map(a => {
                const isRead = !!a.user_completed_at;
                const roleLabels = { animator: 'Аніматори', admin: 'Адміни', manager: 'Менеджери', all: 'Всі' };
                const diffLabels = { beginner: 'Базовий', intermediate: 'Середній', advanced: 'Просунутий' };
                return `<div class="article-card ${isRead ? 'article-card--read' : ''}" data-id="${a.id}">
                    <span class="article-icon">${esc(a.icon || '📄')}</span>
                    <div class="article-meta">
                        <span class="article-badge article-badge--role">${esc(roleLabels[a.role] || a.role)}</span>
                        <span class="article-badge article-badge--difficulty">${esc(diffLabels[a.difficulty] || a.difficulty)}</span>
                        ${a.test_count > 0 ? '<span class="article-badge article-badge--has-test">Є тест</span>' : ''}
                    </div>
                    <div class="article-title">${esc(a.title)}</div>
                    <div class="article-summary">${esc(a.summary || '')}</div>
                    <div class="article-footer">
                        <span>⏱ ${a.read_time_minutes || 5} хв</span>
                        <span>${esc(a.category || '')}</span>
                    </div>
                </div>`;
            }).join('');

            // Click handlers
            grid.querySelectorAll('.article-card').forEach(card => {
                card.addEventListener('click', () => openArticle(parseInt(card.dataset.id)));
            });
        } catch (e) {
            console.error('Articles error', e);
            grid.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Помилка завантаження</div></div>';
        }
    }

    // ═══ Open Article Modal ═══
    async function openArticle(id) {
        const overlay = document.getElementById('readModalOverlay');
        const modal = document.getElementById('readModal');

        try {
            const res = await fetch(API + '/api/training/knowledge-base/' + id, { headers });
            if (!res.ok) throw new Error('Not found');
            const article = await res.json();

            // Convert markdown-like content to HTML
            const contentHtml = markdownToHtml(article.content);
            const hasTest = articlesData.find(a => a.id === id)?.test_count > 0;

            modal.innerHTML = `
                <button class="modal-close" id="closeReadModal">✕</button>
                <div class="article-view-icon">${esc(article.icon || '📄')}</div>
                <div class="article-view-title">${esc(article.title)}</div>
                <div class="article-view-meta">
                    <span class="article-badge article-badge--role">${esc(article.category)}</span>
                    <span class="article-badge article-badge--difficulty">${esc(article.difficulty)}</span>
                    <span style="font-size:12px;color:var(--gray-400)">⏱ ${article.read_time_minutes || 5} хв · ${article.total_reads || 0} прочитань</span>
                </div>
                <div class="article-view-content">${contentHtml}</div>
                <div class="article-actions">
                    <button class="btn-mark-read" data-id="${article.id}">✓ Прочитано</button>
                    ${hasTest ? `<button class="btn-take-test" data-article-id="${article.id}">📝 Пройти тест</button>` : ''}
                </div>
            `;

            overlay.classList.add('active');

            const closeBtn = modal.querySelector('#closeReadModal');
            if (closeBtn) closeBtn.addEventListener('click', () => overlay.classList.remove('active'));
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('active'); });

            const markReadBtn = modal.querySelector('.btn-mark-read');
            if (markReadBtn) markReadBtn.addEventListener('click', async function() {
                try {
                    await fetch(API + '/api/training/knowledge-base/' + article.id + '/mark-read', { method: 'POST', headers });
                    this.textContent = '✓ Готово!';
                    this.style.background = 'var(--success)';
                    loadOverviewStats();
                    loadArticles();
                } catch (e) { console.error(e); }
            });

            const testBtn = modal.querySelector('.btn-take-test');
            if (testBtn) {
                testBtn.addEventListener('click', () => {
                    overlay.classList.remove('active');
                    startQuiz(article.id);
                });
            }
        } catch (e) {
            console.error('Open article error', e);
        }
    }

    // ═══ Tab 2: Tests ═══
    async function loadTests() {
        const grid = document.getElementById('testsGrid');
        try {
            const res = await fetch(API + '/api/training/tests-list', { headers });
            if (!res.ok) throw new Error('Failed');
            const data = await res.json();
            testsData = data.tests || [];

            if (testsData.length === 0) {
                grid.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-text">Тестів поки немає</div></div>';
                return;
            }

            grid.innerHTML = testsData.map(t => {
                const scoreHtml = t.best_score !== null && t.best_score !== undefined
                    ? `<div class="test-score ${t.last_passed ? 'test-score--passed' : 'test-score--failed'}">Найкращий: ${t.best_score}%${t.last_passed ? ' ✓' : ''}</div>`
                    : '';
                return `<div class="test-card">
                    <div class="test-icon">${esc(t.article_icon || '📝')}</div>
                    <div class="test-title">${esc(t.title)}</div>
                    <div class="test-desc">${esc(t.description || '')}</div>
                    <div class="test-info">
                        <span>❓ ${t.question_count || '?'} питань</span>
                        <span>🎯 ${t.passing_score}% для проходження</span>
                    </div>
                    ${scoreHtml}
                    <button class="test-btn" data-article-id="${t.article_id}">Пройти тест</button>
                </div>`;
            }).join('');

            grid.querySelectorAll('.test-btn').forEach(btn => {
                btn.addEventListener('click', () => startQuiz(parseInt(btn.dataset.articleId)));
            });
        } catch (e) {
            console.error('Tests error', e);
            grid.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Помилка завантаження</div></div>';
        }
    }

    // ═══ Quiz ═══
    async function startQuiz(articleId) {
        const overlay = document.getElementById('quizModalOverlay');
        const modal = document.getElementById('quizModal');

        try {
            const res = await fetch(API + '/api/training/tests/' + articleId, { headers });
            if (!res.ok) throw new Error('No test');
            const test = await res.json();

            const questions = test.questions;
            let currentQ = 0;
            let answers = [];
            let startTime = Date.now();
            let answered = false;

            function renderQuestion() {
                answered = false;
                const q = questions[currentQ];
                const progress = questions.map((_, i) =>
                    `<div class="qp-dot ${i < currentQ ? 'done' : ''} ${i === currentQ ? 'current' : ''}"></div>`
                ).join('');

                modal.innerHTML = `
                    <div class="quiz-progress">${progress}</div>
                    <div class="quiz-question-num">Питання ${currentQ + 1} з ${questions.length}</div>
                    <div class="quiz-question-text">${esc(q.question)}</div>
                    <div class="quiz-options">
                        ${q.options.map((opt, i) => `<button class="quiz-option" data-idx="${i}">${esc(opt)}</button>`).join('')}
                    </div>
                    <div class="quiz-explanation" id="quizExplanation"></div>
                    <button class="quiz-btn-next" id="quizNext" disabled>Далі →</button>
                `;

                overlay.classList.add('active');

                modal.querySelectorAll('.quiz-option').forEach(opt => {
                    opt.addEventListener('click', () => {
                        if (answered) return;
                        answered = true;
                        const idx = parseInt(opt.dataset.idx);
                        answers[currentQ] = idx;

                        // Highlight selected
                        modal.querySelectorAll('.quiz-option').forEach(o => o.style.pointerEvents = 'none');
                        opt.classList.add('selected');

                        document.getElementById('quizNext').disabled = false;
                    });
                });

                document.getElementById('quizNext')?.addEventListener('click', () => {
                    currentQ++;
                    if (currentQ < questions.length) {
                        renderQuestion();
                    } else {
                        submitQuiz(test.id, answers, startTime);
                    }
                });
            }

            renderQuestion();

            overlay.addEventListener('click', function handler(e) {
                if (e.target === overlay) {
                    overlay.classList.remove('active');
                    overlay.removeEventListener('click', handler);
                }
            });
        } catch (e) {
            console.error('Quiz error', e);
            if (typeof showNotification === 'function') showNotification('Тест не знайдено', 'error');
        }
    }

    async function submitQuiz(testId, answers, startTime) {
        const overlay = document.getElementById('quizModalOverlay');
        const modal = document.getElementById('quizModal');
        const timeSpent = Math.round((Date.now() - startTime) / 1000);

        try {
            const res = await fetch(API + '/api/training/tests/' + testId + '/submit', {
                method: 'POST', headers,
                body: JSON.stringify({ answers, timeSpent })
            });
            const result = await res.json();

            const icon = result.passed ? '🎉' : '😔';
            const label = result.passed ? 'Вітаємо! Тест пройдено!' : 'Спробуйте ще раз';

            modal.innerHTML = `
                <div class="quiz-result">
                    <div class="result-icon">${icon}</div>
                    <div class="result-score" style="color: ${result.passed ? 'var(--success)' : 'var(--danger)'}">${result.score}%</div>
                    <div class="result-label">${label}</div>
                    <div class="result-details">
                        Правильних: ${result.correct} з ${result.total}<br>
                        Прохідний бал: ${result.passingScore}%<br>
                        Час: ${formatTime(timeSpent)}
                    </div>
                    <button class="quiz-btn-next" id="quizClose">Закрити</button>
                </div>
            `;

            document.getElementById('quizClose')?.addEventListener('click', () => {
                overlay.classList.remove('active');
                loadOverviewStats();
                if (testsData.length > 0) loadTests();
            });

            if (result.passed) fireConfetti();
        } catch (e) {
            console.error('Submit quiz error', e);
        }
    }

    // ═══ Tab 3: Progress ═══
    async function loadProgress() {
        const section = document.getElementById('progressSection');
        try {
            const res = await fetch(API + '/api/training/progress', { headers });
            if (!res.ok) throw new Error('Failed');
            const data = await res.json();

            const readPct = data.totalArticles > 0 ? Math.round((data.readArticles / data.totalArticles) * 100) : 0;

            let badgesHtml = '<div style="font-size:13px;color:var(--gray-400)">Ще немає бейджів</div>';
            if (data.badges && data.badges.length > 0) {
                badgesHtml = '<div class="badges-grid">' + data.badges.map(b =>
                    `<div class="badge-item">
                        <span class="badge-icon">${esc(b.badge_icon)}</span>
                        <div>
                            <div class="badge-name">${esc(b.badge_name)}</div>
                            <div class="badge-date">${new Date(b.earned_at).toLocaleDateString('uk-UA')}</div>
                        </div>
                    </div>`
                ).join('') + '</div>';
            }

            let historyHtml = '<div style="font-size:13px;color:var(--gray-400)">Ще не здавали тести</div>';
            if (data.testResults && data.testResults.length > 0) {
                historyHtml = '<div class="test-history-list">' + data.testResults.slice(0, 10).map(t =>
                    `<div class="test-history-item">
                        <span>${esc(t.test_title)}</span>
                        <span class="test-history-score" style="color:${t.passed ? 'var(--success)' : 'var(--danger)'}">${t.score}%${t.passed ? ' ✓' : ''}</span>
                    </div>`
                ).join('') + '</div>';
            }

            section.innerHTML = `
                <div class="progress-card">
                    <h3>📖 Прочитано матеріалів</h3>
                    <div class="progress-bar-container">
                        <div class="progress-bar-fill" style="width: ${readPct}%"></div>
                    </div>
                    <div class="progress-bar-label">${data.readArticles} з ${data.totalArticles} (${readPct}%)</div>
                </div>
                <div class="progress-card">
                    <h3>🏅 Бейджі</h3>
                    ${badgesHtml}
                </div>
                <div class="progress-card" style="grid-column: span 2">
                    <h3>📝 Історія тестів</h3>
                    ${historyHtml}
                </div>
            `;
        } catch (e) {
            console.error('Progress error', e);
            section.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Помилка завантаження</div></div>';
        }
    }

    // ═══ Tab 4: Leaderboard ═══
    async function loadLeaderboard() {
        const content = document.getElementById('leaderboardContent');
        try {
            const res = await fetch(API + '/api/training/leaderboard', { headers });
            if (!res.ok) throw new Error('Failed');
            const data = await res.json();
            const lb = data.leaderboard || [];

            if (lb.length === 0) {
                content.innerHTML = '<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-text">Ще ніхто не почав навчання. Будьте першим!</div></div>';
                return;
            }

            const rankIcons = ['🥇', '🥈', '🥉'];
            content.innerHTML = `
                <table class="leaderboard-table">
                    <thead><tr><th>#</th><th>Співробітник</th><th>Прочитано</th><th>Тести</th><th>Сер. бал</th><th>Очки</th></tr></thead>
                    <tbody>
                        ${lb.map((r, i) => `<tr>
                            <td class="leaderboard-rank leaderboard-rank--${i + 1}">${rankIcons[i] || (i + 1)}</td>
                            <td><span class="leaderboard-name">${esc(r.name)}</span><br><span class="leaderboard-dept">${esc(r.department || r.role || '')}</span></td>
                            <td>${r.articles_read}</td>
                            <td>${r.tests_passed}</td>
                            <td>${Math.round(r.avg_score)}%</td>
                            <td class="leaderboard-points">${Math.round(r.total_points)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            `;
        } catch (e) {
            console.error('Leaderboard error', e);
            content.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Помилка завантаження</div></div>';
        }
    }

    // ═══ Helpers ═══
    function esc(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m > 0 ? `${m} хв ${s} сек` : `${s} сек`;
    }

    function markdownToHtml(text) {
        if (!text) return '';
        return text
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
            .replace(/(<li>.*<\/li>\n?)+/g, match => {
                return '<ul>' + match + '</ul>';
            })
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\n{2,}/g, '<br><br>')
            .replace(/\n/g, '<br>');
    }

    // ═══ Confetti ═══
    function fireConfetti() {
        const canvas = document.getElementById('confettiCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const particles = [];
        const colors = ['#10B981', '#6366F1', '#F59E0B', '#EC4899', '#3B82F6', '#EF4444'];

        for (let i = 0; i < 100; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: -20 - Math.random() * 200,
                w: 6 + Math.random() * 6,
                h: 4 + Math.random() * 4,
                vx: (Math.random() - 0.5) * 4,
                vy: 2 + Math.random() * 4,
                rot: Math.random() * Math.PI * 2,
                rotV: (Math.random() - 0.5) * 0.2,
                color: colors[Math.floor(Math.random() * colors.length)],
                life: 1
            });
        }

        let frame = 0;
        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let alive = false;

            for (const p of particles) {
                if (p.life <= 0) continue;
                alive = true;
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.1;
                p.rot += p.rotV;
                p.life -= 0.005;

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.globalAlpha = Math.max(0, p.life);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            }

            frame++;
            if (alive && frame < 200) {
                requestAnimationFrame(animate);
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }
        animate();
    }
})();
