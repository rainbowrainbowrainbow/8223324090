/**
 * js/certificate-preview.js — shared visual certificate preview renderer.
 *
 * Extracted from the legacy settings certificate canvas flow so standalone
 * certificate pages can show the same rich preview without loading settings.js.
 */
(function() {
    const SEASON_BG = {
        winter: '/images/certificate/cert-bg-full.png',
        spring: '/images/certificate/Spring_sert.png',
        summer: '/images/certificate/summer_sert.png',
        autumn: '/images/certificate/Autumn_sert.png'
    };
    const bgCache = {};

    function isTouchDevice() {
        const ua = navigator.userAgent || '';
        const isMobileUa = /iPhone|iPad|iPod|Android/i.test(ua);
        const isCoarseNarrow = window.matchMedia
            ? window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(max-width: 430px)').matches
            : false;
        return isMobileUa || isCoarseNarrow;
    }

    function getDimensions() {
        if (isTouchDevice()) return { W: 800, H: 533 };
        return { W: 1200, H: 800 };
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function loadBackground(season) {
        const key = season || 'winter';
        if (bgCache[key]) return Promise.resolve(bgCache[key]);
        const src = SEASON_BG[key] || SEASON_BG.winter;
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => { bgCache[key] = img; resolve(img); };
            img.onerror = () => resolve(null);
            img.src = `${src}?v=8.7`;
        });
    }

    function formatValidDate(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleDateString('uk-UA', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function certificateStatusText(status) {
        const map = {
            active: 'Активний',
            used: 'Використаний',
            expired: 'Прострочений',
            revoked: 'Анульований',
            blocked: 'Заблокований'
        };
        return map[status] || status || '—';
    }

    function staticPreviewBackground(season) {
        return SEASON_BG[season || 'winter'] || SEASON_BG.winter;
    }

    function renderStaticPreview(container, cert = {}, options = {}) {
        const node = typeof container === 'string' ? document.getElementById(container) : container;
        if (!node) return null;
        const displayValue = cert.displayValue || cert.display_value || '';
        const typeText = cert.typeText || cert.type_text || 'на одноразовий вхід';
        const certCode = cert.certCode || cert.cert_code || '';
        const validUntil = cert.validUntil || cert.valid_until || '';
        const background = staticPreviewBackground(cert.season || 'winter');
        const note = options.reason === 'touch'
            ? 'iPhone-safe перегляд без важкого canvas.'
            : 'Canvas-превʼю недоступне, показано безпечну HTML-версію.';

        node.innerHTML = `
            <article class="cert-preview-static-card" style="--cert-preview-bg: url('${escapeHtml(background)}')">
                <div class="cert-preview-static-panel">
                    <span class="cert-preview-static-kicker">Парк Закревського</span>
                    <h3>Сертифікат</h3>
                    ${displayValue ? `<strong>${escapeHtml(displayValue)}</strong>` : '<strong>Без отримувача</strong>'}
                    <p>${escapeHtml(typeText)}</p>
                    <code>${escapeHtml(certCode)}</code>
                    <small>Дійсний до ${escapeHtml(formatValidDate(validUntil))} · ${escapeHtml(certificateStatusText(cert.status))}</small>
                </div>
                <div class="cert-preview-static-note">${escapeHtml(note)}</div>
            </article>`;
        return node.firstElementChild;
    }

    function drawContent(ctx, cert, W, H) {
        const cardX = 32;
        const cardY = 36;
        const cardW = 460;
        const cardH = H - 72;
        const cardR = 24;
        const centerX = cardX + cardW / 2;
        const maxTextW = cardW - 80;

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.18)';
        ctx.shadowBlur = 28;
        ctx.shadowOffsetY = 8;
        ctx.fillStyle = 'rgba(255,255,255,0.93)';
        roundRect(ctx, cardX, cardY, cardW, cardH, cardR);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1;
        roundRect(ctx, cardX + 1, cardY + 1, cardW - 2, cardH - 2, cardR - 1);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        const accentGrad = ctx.createLinearGradient(cardX + 80, 0, cardX + cardW - 80, 0);
        accentGrad.addColorStop(0, 'rgba(255,179,71,0)');
        accentGrad.addColorStop(0.2, '#FFB347');
        accentGrad.addColorStop(0.5, '#FF8C00');
        accentGrad.addColorStop(0.8, '#FFB347');
        accentGrad.addColorStop(1, 'rgba(255,179,71,0)');
        ctx.strokeStyle = accentGrad;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cardX + 70, cardY + 1);
        ctx.lineTo(cardX + cardW - 70, cardY + 1);
        ctx.stroke();
        ctx.restore();

        let y = cardY + 60;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#5A9ECF';
        ctx.font = '700 14px Nunito, Inter, sans-serif';
        ctx.fillText('Парк Закревського Періоду', centerX, y);
        y += 52;

        ctx.fillStyle = '#19468B';
        ctx.font = '900 46px Nunito, Inter, sans-serif';
        ctx.fillText('СЕРТИФІКАТ', centerX, y);
        y += 22;

        ctx.save();
        const lineGrad = ctx.createLinearGradient(centerX - 90, 0, centerX + 90, 0);
        lineGrad.addColorStop(0, 'rgba(255,140,0,0)');
        lineGrad.addColorStop(0.15, '#FFB347');
        lineGrad.addColorStop(0.5, '#FF8C00');
        lineGrad.addColorStop(0.85, '#FFB347');
        lineGrad.addColorStop(1, 'rgba(255,140,0,0)');
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(centerX - 90, y);
        ctx.lineTo(centerX + 90, y);
        ctx.stroke();
        ctx.restore();
        y += 46;

        const nameText = cert.displayValue || '';
        if (nameText) {
            let nameFontSize = 34;
            ctx.fillStyle = '#0D2E5C';
            while (nameFontSize >= 20) {
                ctx.font = `900 ${nameFontSize}px Nunito, Inter, sans-serif`;
                if (ctx.measureText(nameText).width <= maxTextW) break;
                nameFontSize -= 2;
            }
            ctx.fillText(nameText, centerX, y);
            y += 40;
        } else {
            y += 8;
        }

        ctx.fillStyle = '#2E5090';
        ctx.font = '700 16px Nunito, Inter, sans-serif';
        ctx.fillText((cert.typeText || 'на одноразовий вхід').toUpperCase(), centerX, y);
        y += 34;

        const infoH = 60;
        ctx.save();
        ctx.fillStyle = 'rgba(25,70,139,0.05)';
        roundRect(ctx, cardX + 32, y - 4, maxTextW + 16, infoH, 12);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#2E5090';
        ctx.font = '700 15px Nunito, Inter, sans-serif';
        ctx.fillText(cert.certCode || '', centerX, y + 22);

        ctx.fillStyle = '#6A8FBF';
        ctx.font = '600 12px Nunito, Inter, sans-serif';
        ctx.fillText(`Дійсний до ${formatValidDate(cert.validUntil)}  •  Будні та вихідні`, centerX, y + 44);
        y += infoH + 20;

        ctx.fillStyle = '#6A8FBF';
        ctx.font = '600 13px Nunito, Inter, sans-serif';
        ctx.fillText('+38 (0800) 75-35-53', centerX, cardY + cardH - 24);
        ctx.textAlign = 'left';

        return { y, centerX };
    }

    async function drawQr(ctx, cert, layout, options = {}) {
        const apiBase = options.apiBase || window.API_BASE || '';
        const getHeaders = options.getAuthHeaders || window.getAuthHeaders || (() => ({}));
        try {
            const qrResp = await fetch(`${apiBase}/certificates/qr/${encodeURIComponent(cert.certCode)}`, {
                headers: getHeaders(false)
            });
            if (!qrResp.ok) return;
            const qrData = await qrResp.json();
            if (!qrData.dataUrl) return;
            const qrImg = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = qrData.dataUrl;
            });

            const qrSize = 200;
            const qrX = layout.centerX - qrSize / 2;
            const qrY = layout.y + 10;
            const qrR = 16;

            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.1)';
            ctx.shadowBlur = 14;
            ctx.shadowOffsetY = 4;
            ctx.fillStyle = '#fff';
            roundRect(ctx, qrX, qrY, qrSize, qrSize, qrR);
            ctx.fill();
            ctx.restore();

            ctx.save();
            roundRect(ctx, qrX, qrY, qrSize, qrSize, qrR);
            ctx.clip();
            ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
            ctx.restore();

            ctx.fillStyle = '#5A7FAA';
            ctx.font = '600 11px Nunito, Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Сканувати для перевірки', layout.centerX, qrY + qrSize + 18);
            ctx.textAlign = 'left';
        } catch (_) {
            // QR is useful, but preview remains valid without it.
        }
    }

    async function generateCertificateCanvas(cert, options = {}) {
        const { W, H } = getDimensions();
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('certificate_canvas_context_unavailable');

        const bgImg = await loadBackground(cert.season || 'winter');
        if (bgImg) {
            ctx.drawImage(bgImg, 0, 0, W, H);
        } else {
            const grad = ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, '#8BBDE0');
            grad.addColorStop(1, '#6AA1CF');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);
        }

        const layout = drawContent(ctx, cert, W, H);
        await drawQr(ctx, cert, layout, options);
        return canvas;
    }

    async function renderInto(container, cert, options = {}) {
        const node = typeof container === 'string' ? document.getElementById(container) : container;
        if (!node) return null;
        const skipPreview = options.skipPreview === true || (options.skipTouchPreview !== false && isTouchDevice());
        if (skipPreview) {
            return renderStaticPreview(node, cert, { reason: 'touch' });
        }
        node.innerHTML = '<div class="cert-preview-fallback">Готуємо превʼю сертифіката...</div>';
        try {
            const canvas = await generateCertificateCanvas(cert, options);
            canvas.className = 'cert-preview-canvas';
            node.innerHTML = '';
            node.appendChild(canvas);
            return canvas;
        } catch (error) {
            console.warn('Certificate preview generation failed:', error);
            return renderStaticPreview(node, cert, { reason: 'error' });
        }
    }

    window.CertificatePreview = {
        generateCertificateCanvas,
        renderStaticPreview,
        renderInto,
        isTouchDevice
    };
})();
