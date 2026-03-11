/**
 * Event Genix Landing — script.js
 * Scroll animations, modal, form, interactive timeline reactions
 */

(function () {
    'use strict';

    // --- Scroll fade-in animations ---
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        },
        { threshold: 0.2 }
    );

    document.querySelectorAll('.fade-in').forEach((el) => observer.observe(el));

    // =============================================
    // INTERACTIVE TIMELINE REACTIONS
    // =============================================
    const EMOJIS = ['🚀', '⚡', '✨', '💫', '🔥', '💡', '🎯', '🤖', '💰', '📊', '🎉', '👏', '💪', '🧠', '⭐', '🌟', '💎', '🎭', '🛎️', '📱'];
    const RESPONSE_EMOJIS = ['👀', '😍', '🤯', '💜', '🙌', '✅', '🔔', '💬', '❤️', '👆'];

    const timelineBlock = document.querySelector('.timeline-block');
    const entries = document.querySelectorAll('.timeline-entry');

    function rand(min, max) {
        return Math.random() * (max - min) + min;
    }

    function pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // Spawn ambient floating particles
    function spawnAmbientParticles() {
        if (!timelineBlock) return;
        for (let i = 0; i < 8; i++) {
            const p = document.createElement('div');
            p.className = 'ambient-particle';
            p.style.left = rand(5, 95) + '%';
            p.style.top = rand(5, 95) + '%';
            p.style.setProperty('--float-dur', rand(6, 14) + 's');
            p.style.setProperty('--float-delay', rand(0, 5) + 's');
            p.style.setProperty('--ax', rand(-20, 20) + 'px');
            p.style.setProperty('--ay', rand(-25, 5) + 'px');
            p.style.setProperty('--bx', rand(-15, 15) + 'px');
            p.style.setProperty('--by', rand(-35, -5) + 'px');
            p.style.setProperty('--cx', rand(-20, 20) + 'px');
            p.style.setProperty('--cy', rand(-20, 10) + 'px');
            timelineBlock.appendChild(p);
        }
    }

    // Create a reaction bubble that flies from source to target entry
    function spawnReaction(sourceEntry, targetEntry, emoji) {
        if (!sourceEntry || !targetEntry || !timelineBlock) return;

        const srcRect = sourceEntry.getBoundingClientRect();
        const tgtRect = targetEntry.getBoundingClientRect();
        const blockRect = timelineBlock.getBoundingClientRect();

        const startX = rand(20, srcRect.width - 40);
        const startY = srcRect.top - blockRect.top + srcRect.height / 2;

        const dx = rand(-60, 60) + (tgtRect.left - srcRect.left);
        const dy = (tgtRect.top - srcRect.top);

        const bubble = document.createElement('div');
        bubble.className = 'reaction-bubble';
        bubble.textContent = emoji || pick(EMOJIS);
        bubble.style.left = startX + 'px';
        bubble.style.top = startY + 'px';

        const duration = rand(2.5, 5);
        bubble.style.setProperty('--fly-duration', duration + 's');
        bubble.style.setProperty('--dx', dx + 'px');
        bubble.style.setProperty('--dy', dy + 'px');
        bubble.style.setProperty('--rot', rand(-45, 45) + 'deg');
        bubble.style.setProperty('--wobble', rand(-25, 25) + 'px');

        timelineBlock.appendChild(bubble);
        // trigger animation
        requestAnimationFrame(() => bubble.classList.add('flying'));

        // Spawn trail particles along the path
        const trailCount = Math.floor(rand(3, 7));
        for (let i = 0; i < trailCount; i++) {
            setTimeout(() => {
                const t = document.createElement('div');
                t.className = 'reaction-trail';
                const progress = (i + 1) / (trailCount + 1);
                t.style.left = (startX + dx * progress + rand(-10, 10)) + 'px';
                t.style.top = (startY + dy * progress + rand(-10, 10)) + 'px';
                timelineBlock.appendChild(t);
                setTimeout(() => t.remove(), 1500);
            }, duration * 1000 * (i / trailCount) * 0.6);
        }

        // When reaction "arrives" — bump target + ripple + spawn response
        const hitDelay = duration * 0.7 * 1000;
        setTimeout(() => {
            // Bump target entry
            targetEntry.classList.add('bumped', 'reacting');
            setTimeout(() => {
                targetEntry.classList.remove('bumped', 'reacting');
            }, 600);

            // Ripple effect on target
            const ripple = document.createElement('div');
            ripple.className = 'ripple-hit';
            targetEntry.appendChild(ripple);
            setTimeout(() => ripple.remove(), 1200);

            // Sometimes spawn a "response" reaction back
            if (Math.random() < 0.4) {
                setTimeout(() => {
                    spawnReaction(targetEntry, sourceEntry, pick(RESPONSE_EMOJIS));
                }, rand(400, 1200));
            }

            // Sometimes a chain reaction to another entry
            if (Math.random() < 0.25 && entries.length > 2) {
                const others = [...entries].filter(e => e !== sourceEntry && e !== targetEntry);
                if (others.length) {
                    setTimeout(() => {
                        spawnReaction(targetEntry, pick(others), pick(EMOJIS));
                    }, rand(600, 1500));
                }
            }
        }, hitDelay);

        // Clean up bubble
        setTimeout(() => bubble.remove(), (duration + 0.5) * 1000);
    }

    // Draw a glowing connection line between two entries
    function drawConnectionLine(src, tgt) {
        if (!timelineBlock) return;
        const blockRect = timelineBlock.getBoundingClientRect();
        const srcRect = src.getBoundingClientRect();
        const tgtRect = tgt.getBoundingClientRect();

        const x1 = srcRect.left - blockRect.left + srcRect.width / 2;
        const y1 = srcRect.top - blockRect.top + srcRect.height / 2;
        const x2 = tgtRect.left - blockRect.left + tgtRect.width / 2;
        const y2 = tgtRect.top - blockRect.top + tgtRect.height / 2;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        const line = document.createElement('div');
        line.className = 'reaction-line';
        line.style.left = x1 + 'px';
        line.style.top = y1 + 'px';
        line.style.width = length + 'px';
        line.style.transform = `rotate(${angle}deg)`;
        timelineBlock.appendChild(line);
        setTimeout(() => line.remove(), 2000);
    }

    // Auto-spawn reactions at random intervals
    let autoReactionTimer = null;
    let timelineVisible = false;

    function startAutoReactions() {
        if (autoReactionTimer) return;
        function doReaction() {
            if (!timelineVisible) return;
            const src = pick([...entries]);
            const others = [...entries].filter(e => e !== src);
            const tgt = pick(others);

            if (src && tgt) {
                // 70% chance reaction bubble, 30% chance connection line
                if (Math.random() < 0.7) {
                    spawnReaction(src, tgt);
                } else {
                    drawConnectionLine(src, tgt);
                    // Also bump both
                    src.classList.add('reacting');
                    tgt.classList.add('reacting');
                    setTimeout(() => {
                        src.classList.remove('reacting');
                        tgt.classList.remove('reacting');
                    }, 800);
                }

                // Sometimes burst: 2-4 reactions at once
                if (Math.random() < 0.2) {
                    const burstCount = Math.floor(rand(2, 4));
                    for (let i = 0; i < burstCount; i++) {
                        setTimeout(() => {
                            const s = pick([...entries]);
                            const o = [...entries].filter(e => e !== s);
                            spawnReaction(s, pick(o));
                        }, i * rand(200, 600));
                    }
                }
            }

            // Next reaction in 2-6 seconds (varied)
            autoReactionTimer = setTimeout(doReaction, rand(2000, 6000));
        }
        autoReactionTimer = setTimeout(doReaction, rand(1000, 3000));
    }

    function stopAutoReactions() {
        if (autoReactionTimer) {
            clearTimeout(autoReactionTimer);
            autoReactionTimer = null;
        }
    }

    // Observe timeline visibility to start/stop reactions
    if (timelineBlock) {
        spawnAmbientParticles();

        const tlObserver = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        timelineVisible = true;
                        startAutoReactions();
                    } else {
                        timelineVisible = false;
                        stopAutoReactions();
                    }
                });
            },
            { threshold: 0.1 }
        );
        tlObserver.observe(timelineBlock);

        // Click/tap on entry to manually trigger reactions
        document.querySelectorAll('.timeline-entry').forEach((entry) => {
            entry.style.cursor = 'pointer';
            entry.addEventListener('click', () => {
                const others = [...document.querySelectorAll('.timeline-entry')].filter(e => e !== entry);
                // Burst 3-5 reactions from clicked entry to all others
                const count = Math.floor(rand(3, 6));
                for (let i = 0; i < count; i++) {
                    setTimeout(() => {
                        spawnReaction(entry, pick(others));
                    }, i * rand(150, 400));
                }
                // Connection lines
                others.forEach((o, idx) => {
                    setTimeout(() => drawConnectionLine(entry, o), idx * 300);
                });
            });
        });
    }

    // --- Modal ---
    const overlay = document.getElementById('modalOverlay');
    const closeBtn = document.getElementById('modalClose');
    const form = document.getElementById('demoForm');
    const formPackage = document.getElementById('formPackage');
    const formPackageDisplay = document.getElementById('formPackageDisplay');
    const successEl = document.getElementById('modalSuccess');

    function openModal(pkg) {
        if (pkg) {
            formPackage.value = pkg;
            formPackageDisplay.value = pkg;
        }
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        setTimeout(() => {
            form.style.display = '';
            successEl.style.display = 'none';
            form.reset();
        }, 300);
    }

    document.querySelectorAll('[data-package]').forEach((btn) => {
        btn.addEventListener('click', () => openModal(btn.dataset.package));
    });

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
            closeModal();
        }
    });

    // --- Form submit ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {
                name: form.name.value.trim(),
                phone: form.phone.value.trim(),
                package: formPackageDisplay.value
            };

            try {
                const resp = await fetch('/api/leads', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: data.name,
                        phone: data.phone,
                        source: 'landing',
                        notes: 'Пакет: ' + data.package
                    })
                });
                if (!resp.ok) throw new Error('API error');
            } catch {
                // Fallback
            }

            form.style.display = 'none';
            successEl.style.display = '';
        });
    }

    // --- Smooth scroll for anchor links ---
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener('click', (e) => {
            const target = document.querySelector(link.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
})();


// =====================
// TEAM CAROUSEL v2
// =====================
var tcCurrent = 0;

function tcMove(dir) {
    var track = document.getElementById('tcTrack');
    if (!track) return;
    var slides = track.querySelectorAll('.tc-slide');
    tcCurrent = Math.max(0, Math.min(tcCurrent + dir, slides.length - 1));
    track.style.transform = 'translateX(-' + (tcCurrent * 320) + 'px)';
    tcUpdateDots(slides.length);
    tcUpdateBtns(slides.length);
}

function tcUpdateDots(total) {
    var dots = document.querySelectorAll('#tcDots .dot');
    dots.forEach(function(d, i) { d.classList.toggle('active', i === tcCurrent); });
}

function tcUpdateBtns(total) {
    var prev = document.querySelector('.tc-btn--prev');
    var next = document.querySelector('.tc-btn--next');
    if (prev) prev.disabled = tcCurrent === 0;
    if (next) next.disabled = tcCurrent === total - 1;
}

(function initTC() {
    var track = document.getElementById('tcTrack');
    var dotsWrap = document.getElementById('tcDots');
    if (!track || !dotsWrap) return;
    var slides = track.querySelectorAll('.tc-slide');

    // Dots
    slides.forEach(function(_, i) {
        var d = document.createElement('button');
        d.className = 'dot' + (i === 0 ? ' active' : '');
        d.addEventListener('click', function() {
            tcCurrent = i - 1;
            tcMove(1);
        });
        dotsWrap.appendChild(d);
    });

    // Touch swipe
    var startX = 0;
    track.addEventListener('touchstart', function(e) { startX = e.touches[0].clientX; }, {passive:true});
    track.addEventListener('touchend', function(e) {
        var diff = startX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 40) tcMove(diff > 0 ? 1 : -1);
    });

    tcUpdateBtns(slides.length);
})();
