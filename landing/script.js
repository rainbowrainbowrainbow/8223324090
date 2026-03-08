/**
 * Event Genix Landing — script.js
 * Scroll animations (IntersectionObserver), modal, form handling
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
        // Reset form after close
        setTimeout(() => {
            form.style.display = '';
            successEl.style.display = 'none';
            form.reset();
        }, 300);
    }

    // Package "Обрати" buttons
    document.querySelectorAll('[data-package]').forEach((btn) => {
        btn.addEventListener('click', () => openModal(btn.dataset.package));
    });

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
    }

    // Close on Escape
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

            // Try to send to API (Telegram notification)
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
                // Fallback: still show success (contact info collected visually)
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
