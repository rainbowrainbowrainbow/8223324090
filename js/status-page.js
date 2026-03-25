/**
 * js/status-page.js — Public Status Page (v18.4)
 */
(function() {
    'use strict';

    const STATUS_LABELS = {
        operational: 'Працює',
        degraded: 'Знижена продуктивність',
        partial_outage: 'Часткова недоступність',
        major_outage: 'Збій',
        maintenance: 'Обслуговування'
    };

    const OVERALL_LABELS = {
        operational: 'Всі системи працюють',
        degraded: 'Знижена продуктивність деяких сервісів',
        partial_outage: 'Часткова недоступність',
        major_outage: 'Значний збій системи',
        maintenance: 'Планове обслуговування'
    };

    const SEVERITY_LABELS = {
        minor: 'Незначний',
        major: 'Значний',
        critical: 'Критичний'
    };

    const INCIDENT_STATUS_LABELS = {
        investigating: 'Дослідження',
        identified: 'Визначено',
        monitoring: 'Моніторинг',
        resolved: 'Вирішено'
    };

    const CATEGORY_LABELS = {
        core: 'Ядро системи',
        integrations: 'Інтеграції',
        infrastructure: 'Інфраструктура',
        business: 'Бізнес-сервіси',
        ai: 'AI-сервіси'
    };

    async function loadStatus() {
        try {
            const resp = await fetch('/api/status/public');
            if (!resp.ok) throw new Error('API error');
            const data = await resp.json();
            renderStatus(data);
        } catch (err) {
            console.error('Status load error:', err);
            document.getElementById('overallText')?.textContent = 'Не вдалося завантажити статус';
            document.getElementById('overallBanner')?.className = 'overall-banner major_outage';
        }
    }

    function renderStatus(data) {
        // Overall banner
        const banner = document.getElementById('overallBanner');
        banner.className = 'overall-banner ' + data.overall_status;
        document.getElementById('overallText')?.textContent = OVERALL_LABELS[data.overall_status] || data.overall_status;

        // Group components by category
        const groups = {};
        for (const comp of data.components) {
            const cat = comp.category || 'core';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(comp);
        }

        // Render component sections
        const sectionsEl = document.getElementById('componentsSections');
        sectionsEl.innerHTML = '';

        for (const [cat, comps] of Object.entries(groups)) {
            const section = document.createElement('div');
            section.className = 'status-section';
            section.innerHTML = `<div class="status-section-title">${CATEGORY_LABELS[cat] || cat}</div>`;

            const list = document.createElement('div');
            list.className = 'component-list';

            for (const comp of comps) {
                const row = document.createElement('div');
                row.className = 'component-row';
                row.innerHTML = `
                    <div>
                        <div class="component-name">${escapeHtml(comp.name)}</div>
                        <div class="component-desc">${escapeHtml(comp.description || '')}</div>
                    </div>
                    <span class="component-badge ${comp.status}">${STATUS_LABELS[comp.status] || comp.status}</span>
                `;
                list.appendChild(row);
            }

            section.appendChild(list);
            sectionsEl.appendChild(section);
        }

        // Render incidents
        const incidentsEl = document.getElementById('incidentsList');
        if (!data.incidents || data.incidents.length === 0) {
            incidentsEl.innerHTML = '<div class="no-incidents">Немає активних інцидентів за останні 48 годин</div>';
        } else {
            incidentsEl.innerHTML = '';
            for (const inc of data.incidents) {
                const card = document.createElement('div');
                card.className = 'incident-card';

                let updatesHtml = '';
                if (inc.updates && inc.updates.length > 0) {
                    for (const upd of inc.updates) {
                        updatesHtml += `
                            <div class="incident-update">
                                <div class="incident-update-status">${INCIDENT_STATUS_LABELS[upd.status] || upd.status}</div>
                                <div class="incident-update-msg">${escapeHtml(upd.message)}</div>
                                <div class="incident-update-time">${formatDate(upd.created_at)}</div>
                            </div>
                        `;
                    }
                }

                card.innerHTML = `
                    <div class="incident-header">
                        <span class="incident-severity ${inc.severity}">${SEVERITY_LABELS[inc.severity] || inc.severity}</span>
                        <span class="incident-title">${escapeHtml(inc.title)}</span>
                    </div>
                    <div class="incident-meta">${formatDate(inc.started_at)}${inc.status === 'resolved' ? ' — Вирішено' : ''}</div>
                    ${updatesHtml}
                `;
                incidentsEl.appendChild(card);
            }
        }

        // Checked at
        document.getElementById('checkedAt')?.textContent =
            'Оновлено: ' + formatDate(data.checked_at);
    }

    function formatDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${day}.${month}.${d.getFullYear()} ${hours}:${minutes}`;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Load on page ready
    loadStatus();

    // Auto-refresh every 60 seconds
    const _statusInterval = setInterval(loadStatus, 60000);
    window.addEventListener('beforeunload', () => clearInterval(_statusInterval));
})();
