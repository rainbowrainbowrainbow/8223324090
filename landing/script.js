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
        document.body.classList.remove('modal-open');
        document.body.style.top = '';
        document.body.style.position = '';
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
(function() {
    var track = document.getElementById('tcTrack');
    var dotsWrap = document.getElementById('tcDots');
    var btnPrev = document.querySelector('.tc-btn--prev');
    var btnNext = document.querySelector('.tc-btn--next');
    if (!track) return;

    var current = 0;
    var slides = track.querySelectorAll('.tc-slide');
    var total = slides.length;
    if (total === 0) return;

    function slideWidth() {
        var w = slides[0].getBoundingClientRect().width || slides[0].offsetWidth;
        return w > 0 ? w : 320;
    }

    function goTo(idx) {
        // Циклічна навігація
        current = ((idx % total) + total) % total;
        track.style.transform = 'translateX(-' + (current * slideWidth()) + 'px)';
        // Кнопки завжди активні (циклічна карусель)
        if (btnPrev) btnPrev.disabled = false;
        if (btnNext) btnNext.disabled = false;
        document.querySelectorAll('#tcDots .dot').forEach(function(d, i) {
            d.classList.toggle('active', i === current);
        });
    }

    // Кнопки
    if (btnPrev) btnPrev.addEventListener('click', function() { goTo(current - 1); });
    if (btnNext) btnNext.addEventListener('click', function() { goTo(current + 1); });

    // Dots
    if (dotsWrap) {
        slides.forEach(function(_, i) {
            var d = document.createElement('button');
            d.className = 'dot' + (i === 0 ? ' active' : '');
            d.addEventListener('click', function() { goTo(i); });
            dotsWrap.appendChild(d);
        });
    }

    // Swipe
    var startX = 0;
    track.addEventListener('touchstart', function(e) { startX = e.touches[0].clientX; }, {passive:true});
    track.addEventListener('touchend', function(e) {
        var diff = startX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 40) goTo(diff > 0 ? current + 1 : current - 1);
    });

    goTo(0);

    // Автопрокрутка кожні 4 секунди
    var autoTimer = setInterval(function() { goTo(current + 1); }, 4000);
    var wrap = track.closest('.tc-wrap');
    if (wrap) {
        wrap.addEventListener('mouseenter', function() { clearInterval(autoTimer); });
        wrap.addEventListener('mouseleave', function() {
            clearInterval(autoTimer);
            autoTimer = setInterval(function() { goTo(current + 1); }, 4000);
        });
    }
})();

// =====================
// v3.0 ADDITIONS: Navbar + Scroll Progress + FAQ + Back To Top
// =====================
(function() {
    'use strict';

    // --- SCROLL PROGRESS BAR ---
    var progressBar = document.getElementById('scrollProgress');
    function updateProgress() {
        if (!progressBar) return;
        var doc = document.documentElement;
        var scrollTop = window.scrollY || doc.scrollTop;
        var scrollHeight = doc.scrollHeight - doc.clientHeight;
        var pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
        progressBar.style.width = pct + '%';
    }
    window.addEventListener('scroll', updateProgress, { passive: true });

    // --- STICKY NAVBAR ---
    var navbar = document.getElementById('navbar');
    var backBtn = document.getElementById('backToTop');
    function onScroll() {
        var y = window.scrollY;
        if (navbar) navbar.classList.toggle('scrolled', y > 60);
        if (backBtn) backBtn.classList.toggle('visible', y > 400);
        updateProgress();
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    // --- NAVBAR BURGER MOBILE ---
    var burger = document.getElementById('navBurger');
    var navLinks = document.getElementById('navLinks');
    if (burger && navLinks) {
        burger.addEventListener('click', function() {
            var open = navLinks.classList.toggle('open');
            burger.setAttribute('aria-expanded', open);
        });
        // Close on link click
        navLinks.querySelectorAll('.nav-a').forEach(function(a) {
            a.addEventListener('click', function() {
                navLinks.classList.remove('open');
            });
        });
    }

    // --- BACK TO TOP ---
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // --- FAQ ACCORDION ---
    document.querySelectorAll('.faq-item').forEach(function(item) {
        var btn = item.querySelector('.faq-q');
        if (!btn) return;
        btn.addEventListener('click', function() {
            var isOpen = item.classList.contains('open');
            // Close all
            document.querySelectorAll('.faq-item.open').forEach(function(i) {
                i.classList.remove('open');
            });
            // Toggle clicked
            if (!isOpen) item.classList.add('open');
        });
    });

    // --- ACTIVE NAV LINK ON SCROLL ---
    var sections = document.querySelectorAll('section[id]');
    var navAs = document.querySelectorAll('.nav-a');
    var sectionObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                var id = entry.target.getAttribute('id');
                navAs.forEach(function(a) {
                    var href = a.getAttribute('href');
                    a.classList.toggle('active', href === '#' + id);
                });
            }
        });
    }, { threshold: 0.4 });
    sections.forEach(function(s) { sectionObserver.observe(s); });

})();

// =====================
// v3.1: Counter Animation, 3D Card Tilt
// =====================
(function() {
    'use strict';

    // --- COUNTER ANIMATION for stats ---
    function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
    function animateCounter(el, target, suffix, duration) {
        var start = performance.now();
        var isFloat = target % 1 !== 0;
        function step(now) {
            var elapsed = now - start;
            var progress = Math.min(elapsed / duration, 1);
            var eased = easeOutQuart(progress);
            var current = Math.round(eased * target);
            el.textContent = current + suffix;
            if (progress < 1) requestAnimationFrame(step);
            else el.textContent = target + suffix;
        }
        requestAnimationFrame(step);
    }

    var statsObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (!entry.isIntersecting) return;
            var item = entry.target;
            if (item.dataset.counted) return;
            item.dataset.counted = '1';
            item.classList.add('counted');

            var valEl = item.querySelector('.stat-item__value');
            if (!valEl) return;
            var raw = valEl.textContent.trim();
            var suffix = raw.replace(/[\d.]/g, '');
            var num = parseFloat(raw.replace(/[^\d.]/g, ''));
            if (!isNaN(num)) {
                valEl.textContent = '0' + suffix;
                animateCounter(valEl, num, suffix, 1800);
            }
            statsObserver.unobserve(item);
        });
    }, { threshold: 0.5 });

    document.querySelectorAll('.stat-item').forEach(function(el) {
        statsObserver.observe(el);
    });

    // --- 3D CARD TILT on hover ---
    function addTilt(selector, intensity) {
        document.querySelectorAll(selector).forEach(function(card) {
            card.addEventListener('mousemove', function(e) {
                var rect = card.getBoundingClientRect();
                var cx = rect.left + rect.width / 2;
                var cy = rect.top + rect.height / 2;
                var rx = ((e.clientY - cy) / rect.height) * intensity;
                var ry = -((e.clientX - cx) / rect.width) * intensity;
                card.style.transform = 'perspective(800px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg) translateY(-4px)';
            });
            card.addEventListener('mouseleave', function() {
                card.style.transform = '';
            });
        });
    }
    addTilt('.card', 8);
    addTilt('.testi-card', 5);
    addTilt('.update-card', 4);

})();

// =====================
// v3.2: Typewriter, ROI Calc, Sticky CTA
// =====================
(function() {
    'use strict';

    // --- TYPEWRITER EFFECT ---
    var PHRASES = [
        'Поки ви спите — вона вже працює.',
        'Бронювання підтверджуються автоматично.',
        'Команда знає задачі без нарад.',
        'P&L за тиждень — 10 секунд.',
        'Клешня відповідає навіть о 3 ночі.',
        'Склад контролюється без Excel.',
        '90+ хвилин на день повертаються вам.',
        'Один AI замість трьох адміністраторів.',
    ];
    var twEl = document.getElementById('typewriterText');
    if (twEl) {
        var pi = 0, ci = 0, deleting = false, pausing = false;
        function tick() {
            var phrase = PHRASES[pi];
            if (!deleting) {
                twEl.textContent = phrase.slice(0, ci + 1);
                ci++;
                if (ci === phrase.length) {
                    pausing = true;
                    return setTimeout(function() { pausing = false; deleting = true; tick(); }, 2800);
                }
            } else {
                twEl.textContent = phrase.slice(0, ci - 1);
                ci--;
                if (ci === 0) {
                    deleting = false;
                    pi = (pi + 1) % PHRASES.length;
                    return setTimeout(tick, 400);
                }
            }
            setTimeout(tick, deleting ? 30 : 55);
        }
        setTimeout(tick, 1200);
    }

    // ROI calculator removed 12.03.2026

    // --- STICKY BOTTOM CTA ---
    var stickyCta   = document.getElementById('stickyCta');
    var stickyClose = document.getElementById('stickyCtaClose');
    var stickyDismissed = false;
    var heroSection = document.getElementById('hero');

    var backToTop = document.querySelector('.back-to-top');
    if (stickyCta) {
        window.addEventListener('scroll', function() {
            if (stickyDismissed) return;
            var scrollPct = window.scrollY / (document.body.scrollHeight - window.innerHeight);
            var show = scrollPct > 0.4;
            stickyCta.classList.toggle('visible', show);
            // Hide back-to-top when sticky CTA is visible (prevents overlap)
            if (backToTop) {
                backToTop.style.display = show ? 'none' : '';
            }
        }, { passive: true });
    }
    if (stickyClose) {
        stickyClose.addEventListener('click', function() {
            stickyDismissed = true;
            stickyCta.classList.remove('visible');
        });
    }

})();

// =====================
// v3.3: Pricing Table Toggle, Video Preview
// =====================
(function() {
    'use strict';

    // --- PRICING CARDS vs TABLE TOGGLE ---
    var btnCards  = document.getElementById('pToggleCards');
    var btnTable  = document.getElementById('pToggleTable');
    var pricingGrid  = document.querySelector('.pricing-grid');
    var compareTable = document.getElementById('compareTable');

    if (btnCards && btnTable && pricingGrid && compareTable) {
        btnCards.addEventListener('click', function() {
            pricingGrid.style.display = '';
            compareTable.style.display = 'none';
            btnCards.classList.add('ptoggle-btn--active');
            btnTable.classList.remove('ptoggle-btn--active');
        });
        btnTable.addEventListener('click', function() {
            pricingGrid.style.display = 'none';
            compareTable.style.display = '';
            btnTable.classList.add('ptoggle-btn--active');
            btnCards.classList.remove('ptoggle-btn--active');
        });
    }

    // --- VIDEO PREVIEW --- open modal or scroll to demo
    var playBtn = document.getElementById('videoPlayBtn');
    if (playBtn) {
        playBtn.addEventListener('click', function() {
            // Scroll to live demo section
            var demoSection = document.getElementById('demo');
            if (demoSection) {
                demoSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
        // Also the whole preview inner
        var previewInner = document.querySelector('.video-preview__inner');
        if (previewInner) {
            previewInner.addEventListener('click', function(e) {
                if (e.target !== playBtn && !playBtn.contains(e.target)) {
                    var demoSection = document.getElementById('demo');
                    if (demoSection) demoSection.scrollIntoView({ behavior: 'smooth' });
                }
            });
        }
    }

    // Update navbar to include new sections
    var navLinksEl = document.getElementById('navLinks');
    if (navLinksEl && !navLinksEl.querySelector('[href="#how"]')) {
        var li = document.createElement('li');
        li.innerHTML = '<a href="#how" class="nav-a">Як це працює</a>';
        // Insert after product link
        var productLink = navLinksEl.querySelector('[href="#product"]');
        if (productLink && productLink.parentNode) {
            productLink.parentNode.insertAdjacentElement('afterend', li);
        }
    }

})();

// =====================
// v4.0: Mouse Parallax Hero, Enhanced Stagger, Orb interaction
// =====================
(function() {
    'use strict';

    // --- HERO MOUSE PARALLAX ---
    var heroContent = document.querySelector('.hero__content');
    var heroOrbs = document.querySelectorAll('.orb');
    if (heroContent) {
        document.addEventListener('mousemove', function(e) {
            var cx = window.innerWidth / 2;
            var cy = window.innerHeight / 2;
            var dx = (e.clientX - cx) / cx;
            var dy = (e.clientY - cy) / cy;

            heroContent.style.transform =
                'translate(' + (dx * 8) + 'px, ' + (dy * 5) + 'px)';

            heroOrbs.forEach(function(orb, i) {
                var depth = [0.03, 0.05, 0.02, 0.04][i] || 0.03;
                orb.style.transform =
                    'translate(' + (dx * 60 * depth * (i % 2 === 0 ? 1 : -1)) + 'px, ' +
                    (dy * 40 * depth) + 'px)';
            });
        }, { passive: true });

        // Reset on mouse leave
        document.addEventListener('mouseleave', function() {
            heroContent.style.transform = '';
            heroOrbs.forEach(function(orb) { orb.style.transform = ''; });
        });
    }

    // --- ENHANCED SCROLL ANIMATIONS ---
    // Re-observe all fade-in with stagger
    var staggerObs = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (!entry.isIntersecting) return;
            var el = entry.target;
            // Find index among siblings
            var parent = el.parentNode;
            var siblings = parent ? Array.from(parent.children).filter(function(c) {
                return c.classList.contains('fade-in') || c === el;
            }) : [el];
            var idx = siblings.indexOf(el);
            el.style.transitionDelay = (idx * 0.08) + 's';
            el.classList.add('visible');
            staggerObs.unobserve(el);
        });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.fade-in').forEach(function(el) {
        staggerObs.observe(el);
    });

    // --- STEP SCROLL REVEAL ---
    var stepObs = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('step--visible');
            stepObs.unobserve(entry.target);
        });
    }, { threshold: 0.2, rootMargin: '0px 0px -60px 0px' });

    document.querySelectorAll('.step, .step__arrow').forEach(function(el) {
        stepObs.observe(el);
    });

    // --- CARD ICON GLOW ON HOVER ---
    document.querySelectorAll('.card').forEach(function(card) {
        var icon = card.querySelector('.card__icon');
        if (!icon) return;
        card.addEventListener('mouseenter', function() {
            icon.style.filter = 'drop-shadow(0 0 16px rgba(212,168,67,0.6))';
            icon.style.transform = 'scale(1.2) rotate(-5deg)';
            icon.style.transition = 'all 0.3s cubic-bezier(0.34,1.56,0.64,1)';
        });
        card.addEventListener('mouseleave', function() {
            icon.style.filter = '';
            icon.style.transform = '';
        });
    });

    // --- PRICING CARD SHINE EFFECT ---
    document.querySelectorAll('.price-card').forEach(function(card) {
        card.addEventListener('mousemove', function(e) {
            var rect = card.getBoundingClientRect();
            var x = ((e.clientX - rect.left) / rect.width) * 100;
            var y = ((e.clientY - rect.top) / rect.height) * 100;
            card.style.background =
                'radial-gradient(circle at ' + x + '% ' + y + '%, rgba(212,168,67,0.06) 0%, rgba(14,14,28,0.85) 60%)';
        });
        card.addEventListener('mouseleave', function() {
            card.style.background = '';
        });
    });

    // --- STEP NUMBER GLOW ON SCROLL ----
    var stepObs = new IntersectionObserver(function(entries) {
        entries.forEach(function(e) {
            if (e.isIntersecting) {
                e.target.classList.add('visible');
                e.target.style.opacity = '1';
                e.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.3 });
    document.querySelectorAll('.step').forEach(function(s) {
        s.style.opacity = '0';
        s.style.transform = 'translateY(20px)';
        s.style.transition = 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.34,1.56,0.64,1)';
        stepObs.observe(s);
    });

})();

// =====================
// v4.3: Magic Calculator — Interactive Staff Savings
// =====================
(function() {
    'use strict';

    // Per-role savings (minutes/day) — with "magic" randomness
    var ROLES = [
        { name: 'Адміністратор', icon: '💼', base: 35 },
        { name: 'Менеджер',      icon: '📋', base: 28 },
        { name: 'Аніматор',      icon: '🎭', base: 18 },
        { name: 'Касир',         icon: '💳', base: 22 },
        { name: 'Арт-директор',  icon: '🎨', base: 45 },
        { name: 'Директор',      icon: '👑', base: 55 },
    ];

    // Seeded per-staff "magic" multiplier — looks random but is deterministic by staff count
    function magicMultiplier(staff) {
        // subtle variation: 0.85 – 1.30 based on staff modulo
        var seed = (staff * 37 + 13) % 100;
        return 0.85 + (seed / 100) * 0.45;
    }

    function calcMinutesPerDay(staff) {
        var mult = magicMultiplier(staff);
        // Base per-person savings (blended role mix): ~84 min avg
        var perPerson = 84 * mult;
        // Synergy bonus for larger teams (network effect)
        var synergy = staff > 10 ? Math.log(staff) * 8 : 0;
        return Math.round(perPerson * staff + synergy);
    }

    function animateNumber(el, from, to, suffix, duration) {
        suffix = suffix || '';
        duration = duration || 700;
        var start = null;
        var fromNum = typeof from === 'number' ? from : parseFloat(String(from).replace(/[^\d.]/g, '')) || 0;
        var toNum = typeof to === 'number' ? to : parseFloat(String(to)) || 0;
        function step(ts) {
            if (!start) start = ts;
            var p = Math.min((ts - start) / duration, 1);
            p = 1 - Math.pow(1 - p, 3); // ease-out-cubic
            var val = fromNum + (toNum - fromNum) * p;
            // Format
            var display;
            if (toNum >= 1000) {
                display = Math.round(val).toLocaleString('uk');
            } else if (toNum < 10) {
                display = val.toFixed(1);
            } else {
                display = Math.round(val).toString();
            }
            el.textContent = display + suffix;
            if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    function renderRoleBars(staff, totalMin) {
        var bars = document.getElementById('roleBars');
        if (!bars) return;
        bars.innerHTML = '';
        var totalRoleBase = ROLES.reduce(function(s, r) { return s + r.base; }, 0);
        ROLES.forEach(function(role) {
            var pct = Math.round((role.base / totalRoleBase) * 100);
            var min = Math.round((role.base / totalRoleBase) * totalMin / Math.max(staff, 1));
            var div = document.createElement('div');
            div.className = 'role-bar';
            div.innerHTML =
                '<span class="role-bar__name">' + role.icon + ' ' + role.name + '</span>' +
                '<div class="role-bar__track"><div class="role-bar__fill" style="width:0%" data-pct="' + pct + '"></div></div>' +
                '<span class="role-bar__val">~' + min + ' хв/день</span>';
            bars.appendChild(div);
        });
        // Animate bars
        setTimeout(function() {
            bars.querySelectorAll('.role-bar__fill').forEach(function(fill) {
                fill.style.transition = 'width 0.8s cubic-bezier(0.34,1.56,0.64,1)';
                fill.style.width = fill.dataset.pct + '%';
            });
        }, 50);
    }

    function updateCalc(staff) {
        staff = Math.max(1, Math.min(200, parseInt(staff) || 1));
        var minDay = calcMinutesPerDay(staff);
        var hoursMonth = Math.round((minDay / 60) * 22);
        var salaries = (hoursMonth / 160).toFixed(1); // 160 hours per month
        var eventsBoost = Math.min(Math.round(15 + staff * 1.2 + Math.sin(staff) * 5), 80);

        var prevMin = parseInt((document.getElementById('calcMinDay').textContent || '0').replace(/[\s,]/g, '')) || 0;
        var prevHours = parseInt((document.getElementById('calcHoursMonth').textContent || '0').replace(/[\s,]/g, '')) || 0;

        animateNumber(document.getElementById('calcMinDay'), prevMin, minDay, '');
        animateNumber(document.getElementById('calcHoursMonth'), prevHours, hoursMonth, '');
        animateNumber(document.getElementById('calcSalary'), parseFloat(document.getElementById('calcSalary').textContent) || 0, parseFloat(salaries), '');
        document.getElementById('calcEvents').textContent = '+' + eventsBoost + '%';

        // Update header stats
        var mainMin = Math.round(minDay / Math.max(staff, 1));
        animateNumber(document.getElementById('statMinutesVal'), parseInt(document.getElementById('statMinutesVal').textContent) || 80, mainMin, '+');
        animateNumber(document.getElementById('statHoursVal'), parseInt(document.getElementById('statHoursVal').textContent) || 26, Math.round(hoursMonth), '');

        renderRoleBars(staff, minDay);
    }

    // Stepper buttons
    var staffInput = document.getElementById('staffCount');
    var minusBtn = document.getElementById('staffMinus');
    var plusBtn = document.getElementById('staffPlus');

    if (staffInput) {
        minusBtn.addEventListener('click', function() {
            var v = parseInt(staffInput.value) || 1;
            staffInput.value = Math.max(1, v - 1);
            updateCalc(staffInput.value);
        });
        plusBtn.addEventListener('click', function() {
            var v = parseInt(staffInput.value) || 1;
            staffInput.value = Math.min(200, v + 1);
            updateCalc(staffInput.value);
        });
        staffInput.addEventListener('input', function() {
            updateCalc(this.value);
        });
        // Initial render
        updateCalc(20);
    }

    // LIVE COUNTER — ticks while page is open (simulates savings for "parks in Ukraine")
    var liveEl = document.getElementById('liveCounter');
    if (liveEl) {
        var liveBase = Math.floor(Date.now() / 60000) * 7; // deterministic per minute
        var liveStart = liveBase;
        setInterval(function() {
            liveStart += Math.floor(Math.random() * 3 + 1);
            liveEl.textContent = liveStart.toLocaleString('uk');
        }, 1800);
        liveEl.textContent = liveStart.toLocaleString('uk');
    }

})();

// =====================
// Cross-Device JS Fixes
// =====================
(function() {
    'use strict';

    var isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    var isAndroid = /Android/.test(navigator.userAgent);

    // 1. Disable parallax on touch/mobile devices (causes jank)
    if (isTouchDevice) {
        document.removeEventListener('mousemove', function(){}, true);
        var heroContent = document.querySelector('.hero__content');
        if (heroContent) {
            heroContent.style.willChange = 'auto';
            heroContent.style.transform = '';
            heroContent.style.transition = 'none';
        }
    }

    // 2. iOS: modal scroll fix handled in openModal/closeModal directly

    // 3. iOS: fix 100vh issue dynamically
    function setVH() {
        var vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', vh + 'px');
    }
    setVH();
    window.addEventListener('resize', setVH, { passive: true });
    window.addEventListener('orientationchange', function() {
        setTimeout(setVH, 200); // wait for rotation to complete
    }, { passive: true });

    // 4. Android: smooth scroll polyfill check
    if (!('scrollBehavior' in document.documentElement.style)) {
        // Fallback: instant jump for browsers without smooth scroll
        document.querySelectorAll('a[href^="#"]').forEach(function(link) {
            link.addEventListener('click', function(e) {
                var target = document.querySelector(this.getAttribute('href'));
                if (target) {
                    e.preventDefault();
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    }

    // 5. Disable heavy orb animation on low-end devices
    var isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    if (isLowEnd || isTouchDevice) {
        document.querySelectorAll('.orb').forEach(function(orb) {
            orb.style.animationPlayState = 'paused';
        });
    }

    // 6. Fix: prevent zoom on double-tap on buttons (iOS)
    if (isIOS) {
        document.querySelectorAll('.btn, button, a').forEach(function(el) {
            el.addEventListener('touchend', function(e) {
                e.preventDefault();
                e.target.click();
            }, { passive: false });
        });
    }

    // 7. Android Chrome: detect bottom navigation bar height
    if (isAndroid) {
        var androidNavHeight = window.outerHeight - window.innerHeight;
        if (androidNavHeight > 0) {
            document.documentElement.style.setProperty('--android-nav', androidNavHeight + 'px');
        }
    }

})();

// =====================
// FUN INTERACTIONS v1.0
// =====================
(function() {
    'use strict';

    /* =====================================================
       1. CONFETTI — при кліці кнопок CTA
       ===================================================== */
    function spawnConfetti(x, y) {
        var canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99999;';
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        document.body.appendChild(canvas);
        var ctx = canvas.getContext('2d');

        var COLORS = ['#D4A843','#F0C96A','#6366F1','#ffffff','#ff6b6b','#4ade80','#60a5fa'];
        var particles = [];
        for (var i = 0; i < 120; i++) {
            particles.push({
                x: x, y: y,
                vx: (Math.random() - 0.5) * 16,
                vy: Math.random() * -14 - 4,
                size: Math.random() * 8 + 4,
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                rot: Math.random() * 360,
                rotV: (Math.random() - 0.5) * 12,
                shape: Math.random() > 0.5 ? 'rect' : 'circle',
                alpha: 1,
                gravity: 0.4 + Math.random() * 0.2
            });
        }

        var frame;
        function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            var alive = false;
            particles.forEach(function(p) {
                if (p.alpha <= 0) return;
                alive = true;
                p.x += p.vx;
                p.y += p.vy;
                p.vy += p.gravity;
                p.vx *= 0.99;
                p.rot += p.rotV;
                p.alpha -= 0.018;
                ctx.save();
                ctx.globalAlpha = Math.max(0, p.alpha);
                ctx.fillStyle = p.color;
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot * Math.PI / 180);
                if (p.shape === 'rect') {
                    ctx.fillRect(-p.size/2, -p.size/4, p.size, p.size/2);
                } else {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.size/2, 0, Math.PI*2);
                    ctx.fill();
                }
                ctx.restore();
            });
            if (alive) {
                frame = requestAnimationFrame(draw);
            } else {
                canvas.remove();
                cancelAnimationFrame(frame);
            }
        }
        draw();
    }

    document.querySelectorAll('.btn--gold, .btn--outline').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            var rect = btn.getBoundingClientRect();
            spawnConfetti(rect.left + rect.width/2, rect.top + rect.height/2);
        });
    });


    /* =====================================================
       2. CURSOR SPARKS — золоті іскри за мишею (desktop)
       ===================================================== */
    if (!('ontouchstart' in window)) {
        var sparkCanvas = document.createElement('canvas');
        sparkCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9998;';
        sparkCanvas.width = window.innerWidth;
        sparkCanvas.height = window.innerHeight;
        document.body.appendChild(sparkCanvas);
        var sCtx = sparkCanvas.getContext('2d');
        var sparks = [];
        var lastX = 0, lastY = 0, moving = false, moveTimer;

        window.addEventListener('resize', function() {
            sparkCanvas.width = window.innerWidth;
            sparkCanvas.height = window.innerHeight;
        }, { passive: true });

        document.addEventListener('mousemove', function(e) {
            lastX = e.clientX; lastY = e.clientY;
            moving = true;
            clearTimeout(moveTimer);
            moveTimer = setTimeout(function() { moving = false; }, 100);

            // Spawn 1-2 sparks per mouse move
            for (var i = 0; i < 2; i++) {
                sparks.push({
                    x: e.clientX + (Math.random()-0.5)*4,
                    y: e.clientY + (Math.random()-0.5)*4,
                    vx: (Math.random()-0.5)*2,
                    vy: -Math.random()*2 - 0.5,
                    size: Math.random()*3+1,
                    alpha: 0.8 + Math.random()*0.2,
                    color: Math.random() > 0.5 ? '#D4A843' : '#F0C96A'
                });
            }
        }, { passive: true });

        function drawSparks() {
            sCtx.clearRect(0, 0, sparkCanvas.width, sparkCanvas.height);
            sparks = sparks.filter(function(s) { return s.alpha > 0; });
            sparks.forEach(function(s) {
                s.x += s.vx;
                s.y += s.vy;
                s.vy += 0.05;
                s.alpha -= 0.04;
                sCtx.save();
                sCtx.globalAlpha = Math.max(0, s.alpha);
                sCtx.fillStyle = s.color;
                sCtx.shadowColor = s.color;
                sCtx.shadowBlur = 4;
                sCtx.beginPath();
                sCtx.arc(s.x, s.y, s.size, 0, Math.PI*2);
                sCtx.fill();
                sCtx.restore();
            });
            requestAnimationFrame(drawSparks);
        }
        drawSparks();
    }


    /* =====================================================
       3. KONAMI CODE → Клешня easter egg 🦞
       ===================================================== */
    var konamiSeq = [38,38,40,40,37,39,37,39,66,65];
    var konamiPos = 0;
    document.addEventListener('keydown', function(e) {
        if (e.keyCode === konamiSeq[konamiPos]) {
            konamiPos++;
            if (konamiPos === konamiSeq.length) {
                konamiPos = 0;
                showEasterEgg();
            }
        } else {
            konamiPos = 0;
        }
    });

    // Also: click "Event Genix" logo 5 times fast
    var logoClicks = 0, logoTimer;
    var logoEl = document.querySelector('.hero__logo');
    if (logoEl) {
        logoEl.addEventListener('click', function() {
            logoClicks++;
            clearTimeout(logoTimer);
            logoTimer = setTimeout(function() { logoClicks = 0; }, 1500);
            if (logoClicks >= 5) { logoClicks = 0; showEasterEgg(); }
        });
    }

    function showEasterEgg() {
        var egg = document.createElement('div');
        egg.innerHTML = '<div style="text-align:center;padding:32px;"><div style="font-size:80px;animation:eggBounce 0.5s ease infinite alternate;">🦞</div><div style="font-family:Space Grotesk,sans-serif;font-size:22px;font-weight:800;color:#D4A843;margin-top:16px;">Привіт, це я — Клешня!</div><div style="color:#aaa;margin-top:8px;font-size:15px;">Розробив цей сайт за 3 дні 😎<br>Ти знайшов секрет!</div><button onclick="this.closest(\'.egg-overlay\').remove()" style="margin-top:20px;background:#D4A843;color:#0a0a18;border:none;border-radius:999px;padding:10px 28px;font-size:16px;font-weight:700;cursor:pointer;font-family:Space Grotesk,sans-serif;">🦞 Поняв!</button></div>';
        egg.className = 'egg-overlay';
        egg.style.cssText = 'position:fixed;inset:0;background:rgba(7,7,15,0.92);z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);animation:eggFadeIn 0.3s ease;';
        document.body.appendChild(egg);
        egg.addEventListener('click', function(e) {
            if (e.target === egg) egg.remove();
        });
    }

    var eggStyle = document.createElement('style');
    eggStyle.textContent = '@keyframes eggBounce{from{transform:translateY(0) rotate(-10deg)}to{transform:translateY(-12px) rotate(10deg)}}@keyframes eggFadeIn{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}';
    document.head.appendChild(eggStyle);


    /* =====================================================
       4. BUTTON RIPPLE — хвиля при кожному тапі/кліці
       ===================================================== */
    document.querySelectorAll('.btn, .faq-q, .price-card').forEach(function(el) {
        el.style.position = el.style.position || 'relative';
        el.style.overflow = 'hidden';
        el.addEventListener('click', function(e) {
            var rect = el.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            var ripple = document.createElement('span');
            var size = Math.max(rect.width, rect.height) * 2;
            ripple.style.cssText = 'position:absolute;border-radius:50%;background:rgba(255,255,255,0.15);width:'+size+'px;height:'+size+'px;left:'+(x-size/2)+'px;top:'+(y-size/2)+'px;transform:scale(0);animation:rippleAnim 0.6s ease-out forwards;pointer-events:none;z-index:10;';
            el.appendChild(ripple);
            setTimeout(function() { ripple.remove(); }, 700);
        });
    });

    var rippleStyle = document.createElement('style');
    rippleStyle.textContent = '@keyframes rippleAnim{to{transform:scale(1);opacity:0;}}';
    document.head.appendChild(rippleStyle);


    /* =====================================================
       5. STAT NUMBERS — "scramble" при hover (число мигає)
       ===================================================== */
    var CHARS = '0123456789';
    function scrambleNumber(el, finalVal) {
        var iters = 0;
        var maxIters = 12;
        var original = el.textContent;
        var timer = setInterval(function() {
            if (iters >= maxIters) {
                el.textContent = original;
                clearInterval(timer);
                return;
            }
            var scrambled = '';
            for (var i = 0; i < original.length; i++) {
                var ch = original[i];
                if (/\d/.test(ch) && iters < maxIters - 3) {
                    scrambled += CHARS[Math.floor(Math.random()*10)];
                } else {
                    scrambled += ch;
                }
            }
            el.textContent = scrambled;
            iters++;
        }, 60);
    }

    document.querySelectorAll('.stat-item').forEach(function(item) {
        var val = item.querySelector('.stat-item__value');
        if (!val) return;
        item.addEventListener('mouseenter', function() {
            scrambleNumber(val, val.textContent);
        });
        // Touch: scramble on tap
        item.addEventListener('touchstart', function() {
            scrambleNumber(val, val.textContent);
        }, { passive: true });
    });

})();

// =====================
// Phone mask for modal form
// =====================
(function() {
    var phone = document.getElementById('formPhone');
    if (!phone) return;
    phone.addEventListener('input', function() {
        var v = this.value.replace(/\D/g,'');
        if (v.startsWith('380')) v = v.slice(0,12);
        else if (v.startsWith('0')) v = '38' + v.slice(0,10);
        else if (v.length > 0) v = v.slice(0,12);
        // Format: +380 XX XXX XX XX
        var f = '+';
        if (v.length > 0) f += v.slice(0,3);
        if (v.length > 3) f += ' ' + v.slice(3,5);
        if (v.length > 5) f += ' ' + v.slice(5,8);
        if (v.length > 8) f += ' ' + v.slice(8,10);
        if (v.length > 10) f += ' ' + v.slice(10,12);
        this.value = f;
    });
    phone.addEventListener('focus', function() {
        if (!this.value) this.value = '+380';
    });
})();

/* ============================================================
   LANDING v5.0 — Demystify Accordion + AI Demo
   ============================================================ */

// --- Demystify Accordion ---
document.querySelectorAll('.demystify-card').forEach(card => {
    card.addEventListener('click', () => {
        const isOpen = card.getAttribute('data-open') === 'true';
        // close all
        document.querySelectorAll('.demystify-card').forEach(c => c.setAttribute('data-open', 'false'));
        // toggle clicked
        if (!isOpen) card.setAttribute('data-open', 'true');
    });
});

// --- AI Demo Typewriter ---
(function() {
    const responses = [
        "Готово! Minecraft квест на суботу 15:00 — підтверджено. ✅\nКлієнту пішло SMS-нагадування.\nАніматор Олексій — призначений.\nЗмінено статус: Підтверджено.",
        "Виручка за тиждень: 47 200 ₴\nСередній чек: 890 ₴\nЗростання: +12% до минулого тижня 📈\nТоп-послуга: Minecraft квест (34%)\nДні пікового навантаження: Сб, Нд",
        "Афішу створено! 🎨\nСтиль: Minecraft, розмір A3.\nКолірна палітра: зелений + коричневий.\nЗавантажити PNG?\nАбо одразу надіслати в друк? 🖨️"
    ];

    const bubbles = document.querySelectorAll('.ai-bubble');
    const body = document.getElementById('aiDemoBody');
    const cta = document.getElementById('aiDemoCta');
    let typing = false;

    bubbles.forEach(btn => {
        btn.addEventListener('click', () => {
            if (typing) return;
            const idx = parseInt(btn.dataset.demo);
            // activate bubble
            bubbles.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // typewriter
            typing = true;
            if (cta) cta.style.display = 'none';
            body.innerHTML = '<span class="ai-demo-cursor"></span>';
            const text = responses[idx];
            let i = 0;
            function typeChar() {
                if (i < text.length) {
                    const ch = text[i] === '\n' ? '<br>' : text[i];
                    body.innerHTML = body.innerHTML.replace('<span class="ai-demo-cursor"></span>', '') + ch + '<span class="ai-demo-cursor"></span>';
                    i++;
                    setTimeout(typeChar, 25 + Math.random() * 20);
                } else {
                    // done
                    setTimeout(() => {
                        body.innerHTML = body.innerHTML.replace('<span class="ai-demo-cursor"></span>', '');
                        if (cta) cta.style.display = 'block';
                        typing = false;
                    }, 500);
                }
            }
            typeChar();
        });
    });
})();
