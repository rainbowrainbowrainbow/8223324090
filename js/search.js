/**
 * search.js — Global Search (Cmd+K) — v19.6
 * Fuzzy search across bookings, customers, tasks, programs
 */

// ==========================================
// SEARCH STATE
// ==========================================

let searchOpen = false;
let searchDebounceTimer = null;
let searchResults = null;
let searchSelectedIdx = 0;
let searchFlatResults = [];

// ==========================================
// SEARCH MODAL — OPEN/CLOSE
// ==========================================

function openSearch() {
    const modal = document.getElementById('searchModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    searchOpen = true;
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = '';
        input.focus();
    }
    searchResults = null;
    searchSelectedIdx = 0;
    searchFlatResults = [];
    renderSearchResults();
}

function closeSearch() {
    const modal = document.getElementById('searchModal');
    if (!modal) return;
    modal.classList.add('hidden');
    searchOpen = false;
}

// ==========================================
// KEYBOARD SHORTCUT — Cmd+K / Ctrl+K
// ==========================================

document.addEventListener('keydown', (e) => {
    // Cmd+K or Ctrl+K
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (searchOpen) {
            closeSearch();
        } else {
            openSearch();
        }
        return;
    }

    // Escape closes search
    if (e.key === 'Escape' && searchOpen) {
        e.preventDefault();
        closeSearch();
        return;
    }

    // Arrow navigation within search results
    if (searchOpen && searchFlatResults.length > 0) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            searchSelectedIdx = Math.min(searchSelectedIdx + 1, searchFlatResults.length - 1);
            highlightSearchResult();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            searchSelectedIdx = Math.max(searchSelectedIdx - 1, 0);
            highlightSearchResult();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            navigateToResult(searchFlatResults[searchSelectedIdx]);
        }
    }
});

// ==========================================
// SEARCH API CALL
// ==========================================

function onSearchInput(value) {
    clearTimeout(searchDebounceTimer);
    const q = value.trim();

    if (q.length < 2) {
        searchResults = null;
        searchFlatResults = [];
        searchSelectedIdx = 0;
        renderSearchResults();
        return;
    }

    searchDebounceTimer = setTimeout(async () => {
        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=10`, {
                headers: getAuthHeaders(false)
            });
            if (!response.ok) throw new Error('Search error');
            const data = await response.json();
            searchResults = data.results;
            buildFlatResults();
            searchSelectedIdx = 0;
            renderSearchResults();
        } catch (err) {
            console.error('Search failed:', err);
        }
    }, 200);
}

function buildFlatResults() {
    searchFlatResults = [];
    if (!searchResults) return;
    const order = ['bookings', 'customers', 'tasks', 'programs', 'staff'];
    for (const key of order) {
        if (searchResults[key] && searchResults[key].length > 0) {
            for (const item of searchResults[key]) {
                searchFlatResults.push(item);
            }
        }
    }
}

// ==========================================
// RENDER RESULTS
// ==========================================

function renderSearchResults() {
    const container = document.getElementById('searchResults');
    if (!container) return;

    if (!searchResults) {
        container.innerHTML = '<div class="search-hint">Почніть вводити для пошуку по бронюванням, клієнтам, задачам, програмам</div>';
        return;
    }

    if (searchFlatResults.length === 0) {
        container.innerHTML = '<div class="search-empty">Нічого не знайдено</div>';
        return;
    }

    const typeLabels = {
        booking: 'Бронювання',
        customer: 'Клієнти',
        task: 'Задачі',
        program: 'Програми',
        staff: 'Команда'
    };

    const typeColors = {
        booking: 'var(--primary)',
        customer: '#8B5CF6',
        task: '#F59E0B',
        program: '#3B82F6',
        staff: '#10B981'
    };

    let html = '';
    let currentType = null;
    let flatIdx = 0;

    for (const item of searchFlatResults) {
        if (item.type !== currentType) {
            currentType = item.type;
            html += `<div class="search-group-label">${typeLabels[currentType] || currentType}</div>`;
        }

        const isSelected = flatIdx === searchSelectedIdx;
        const statusDot = item.status === 'confirmed' ? '<span class="search-dot search-dot--confirmed"></span>' :
                          item.status === 'preliminary' ? '<span class="search-dot search-dot--preliminary"></span>' :
                          item.status === 'in_progress' ? '<span class="search-dot search-dot--progress"></span>' : '';

        html += `
        <div class="search-result ${isSelected ? 'search-result--active' : ''}"
             data-idx="${flatIdx}"
             onclick="navigateToResult(searchFlatResults[${flatIdx}])"
             onmouseenter="searchSelectedIdx=${flatIdx}; highlightSearchResult()">
            <span class="search-result-type" style="background: ${typeColors[item.type]}">${item.type.charAt(0).toUpperCase()}</span>
            <div class="search-result-content">
                <div class="search-result-title">${statusDot}${escapeHtml(item.title)}</div>
                <div class="search-result-subtitle">${escapeHtml(item.subtitle || '')}</div>
            </div>
        </div>`;
        flatIdx++;
    }

    container.innerHTML = html;
}

function highlightSearchResult() {
    const container = document.getElementById('searchResults');
    if (!container) return;
    const items = container.querySelectorAll('.search-result');
    items.forEach((el, i) => {
        el.classList.toggle('search-result--active', i === searchSelectedIdx);
    });

    // Scroll into view
    const active = container.querySelector('.search-result--active');
    if (active) {
        active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// ==========================================
// NAVIGATE TO RESULT
// ==========================================

function navigateToResult(item) {
    if (!item) return;
    closeSearch();

    if (item.href) {
        window.location.href = item.href;
        return;
    }

    switch (item.type) {
        case 'booking':
            // Navigate to booking date on timeline
            if (item.date) {
                const dateInput = document.getElementById('timelineDate');
                if (dateInput) {
                    dateInput.value = item.date;
                    dateInput.dispatchEvent(new Event('change'));
                }
                // Open booking panel after timeline loads
                setTimeout(() => {
                    if (typeof openBookingPanelById === 'function') {
                        openBookingPanelById(item.id);
                    }
                }, 500);
            }
            break;
        case 'customer':
            // Navigate to customers page
            window.location.href = `/customers?highlight=${item.id}`;
            break;
        case 'task':
            // Navigate to tasks page
            window.location.href = `/tasks?highlight=${item.id}`;
            break;
        case 'program':
            // Navigate to programs page
            window.location.href = `/programs?highlight=${item.meta?.code || item.id}`;
            break;
    }
}

// v19.6: Open booking panel by ID (finds booking in current timeline data)
function openBookingPanelById(bookingId) {
    const block = document.querySelector(`.booking-block[data-booking-id="${bookingId}"]`);
    if (block) {
        block.click();
        block.scrollIntoView({ behavior: 'smooth', block: 'center' });
        block.classList.add('search-highlight');
        setTimeout(() => block.classList.remove('search-highlight'), 2000);
    }
}
