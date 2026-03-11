/**
 * Event Genix Landing v1.0 — script.js
 * Scroll animations, demo form, mobile nav
 */
(function () {
    'use strict';

    // --- IntersectionObserver: fade-in on scroll ---
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.15 });

    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

    // --- Mobile nav toggle ---
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');
    if (navToggle && navLinks) {
        navToggle.addEventListener('click', () => {
            navLinks.classList.toggle('open');
        });
        // Close nav on link click
        navLinks.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', () => {
                navLinks.classList.remove('open');
            });
        });
    }

    // --- Demo form submission ---
    const form = document.getElementById('demo-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('demo-name').value.trim();
            const contact = document.getElementById('demo-contact').value.trim();
            const pkg = document.getElementById('demo-package').value;
            const btn = document.getElementById('demo-submit');

            btn.textContent = 'Відправляємо...';
            btn.disabled = true;

            try {
                const res = await fetch('/api/landing/demo-request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, contact, package: pkg })
                });
                if (res.ok) {
                    btn.textContent = '\u2705 Заявку отримано! Зв\u2019яжемось незабаром.';
                    btn.style.background = '#00c864';
                    btn.style.color = '#fff';
                    form.reset();
                } else {
                    throw new Error('server error');
                }
            } catch {
                // Fallback: open Telegram
                btn.textContent = 'Написати в Telegram \u2192';
                btn.disabled = false;
                window.open('https://t.me/ArdDirector', '_blank');
            }
        });
    }

    // --- Smooth scroll for anchor links ---
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
            const target = document.querySelector(a.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
})();
