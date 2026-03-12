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
        'Звіт за тиждень — за 10 секунд.',
        'Клешня відповідає навіть о 3 ночі.',
        'Склад контролюється без Excel.',
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

    // --- ROI CALCULATOR ---
    var adminsEl  = document.getElementById('roiAdmins');
    var eventsEl  = document.getElementById('roiEvents');
    var salaryEl  = document.getElementById('roiSalary');
    var adminsVal = document.getElementById('roiAdminsVal');
    var eventsVal = document.getElementById('roiEventsVal');
    var salaryVal = document.getElementById('roiSalaryVal');
    var hoursEl   = document.getElementById('roiHours');
    var moneyEl   = document.getElementById('roiMoney');
    var roiEl     = document.getElementById('roiRoi');

    function fmt(n) { return n.toLocaleString('uk-UA'); }

    function calcRoi() {
        var admins = +adminsEl.value;
        var events = +eventsEl.value;
        var salary = +salaryEl.value;

        adminsVal.textContent = admins;
        eventsVal.textContent = events;
        salaryVal.textContent = fmt(salary);

        // 80 min/day per admin → hours/month
        var workDays = 22;
        var savedMinPerAdmin = 80;
        var totalHours = Math.round((admins * savedMinPerAdmin * workDays) / 60);

        // Cost of saved time
        var hourlyRate = salary / (workDays * 8);
        var savings = Math.round(hourlyRate * totalHours);

        // ROI: (savings - plan_cost) / plan_cost
        var planCost = 18000; // Full package
        var roi = Math.round(((savings - planCost) / planCost) * 100);

        if (hoursEl) hoursEl.textContent = totalHours + ' год';
        if (moneyEl) moneyEl.textContent = fmt(savings) + ' ₴';
        if (roiEl) roiEl.textContent = (roi > 0 ? '+' : '') + roi + '%';
    }

    if (adminsEl && eventsEl && salaryEl) {
        [adminsEl, eventsEl, salaryEl].forEach(function(el) {
            el.addEventListener('input', calcRoi);
        });
        calcRoi();
    }

    // --- STICKY BOTTOM CTA ---
    var stickyCta   = document.getElementById('stickyCta');
    var stickyClose = document.getElementById('stickyCtaClose');
    var stickyDismissed = false;
    var heroSection = document.getElementById('hero');

    if (stickyCta && heroSection) {
        window.addEventListener('scroll', function() {
            if (stickyDismissed) return;
            var heroBottom = heroSection.getBoundingClientRect().bottom;
            stickyCta.classList.toggle('visible', heroBottom < 0);
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
