/** Company structure workspace, loaded on demand by hr-page.js. */
(function () {
    'use strict';
    if (window.HrStructureModule) return;
    let initialized = false;
    // HR_STRUCTURE_IMPLEMENTATION_START
function canEditCompanyStructure() {
    if (companyStructurePermissionDenied || companyStructureServerReadOnly) return false;
    return typeof canAccess === 'function' && canAccess('hr.staff.manage') === true;
}

function companyStructureHasUnsavedChanges() {
    if (companyOrgSavedDraftSignature) {
        return companyStructureCurrentDraftSignature() !== companyOrgSavedDraftSignature;
    }
    return companyStructureDraftRevision > companyStructureSavedRevision;
}

function companyStructureCanMutate() {
    return companyStructureLoaded
        && companyStructureLoadState === 'ready'
        && companyStructureSaveState !== 'conflict'
        && canEditCompanyStructure();
}

function formatCompanyStructureUpdatedAt(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('uk-UA');
}

function setCompanyStructureSaveState(state, options = {}) {
    companyStructureSaveState = state;
    if (Object.prototype.hasOwnProperty.call(options, 'error')) {
        companyStructureSaveError = String(options.error || '');
    }
    renderCompanyStructureEditorState();
}

function markCompanyStructureChanged() {
    if (!companyStructureCanMutate()) return false;
    companyStructureDraftRevision += 1;
    companyStructureSaveError = '';
    if (companyStructureSaveState !== 'saving') {
        companyStructureSaveState = companyStructureHasUnsavedChanges()
            ? 'changed'
            : (companyStructureHasSavedData ? 'saved' : 'clean');
    }
    renderCompanyStructureEditorState();
    return true;
}

function renderCompanyStructureEditorState() {
    const status = document.getElementById('companyStructureStatus');
    const saveButton = document.getElementById('btnSaveCompanyStructure');
    const autoButton = document.getElementById('hrOrgAutoLayoutBtn');
    const editButton = document.getElementById('hrOrgEditSelectedBtn');
    const modeBadge = document.getElementById('companyStructureModeBadge');
    const recovery = document.getElementById('companyStructureRecovery');
    const recoveryMessage = document.getElementById('companyStructureRecoveryMessage');
    const retryButton = document.getElementById('btnRetryCompanyStructure');
    const templateButton = document.getElementById('btnApplyCompanyStructureTemplate');
    const reloadButton = document.getElementById('btnReloadCompanyStructureConflict');
    const copyButton = document.getElementById('btnCopyCompanyStructureDraft');
    const notes = document.getElementById('companyStructureNotes');
    const instructions = document.getElementById('companyInstructionsText');
    const stage = document.getElementById('companyOrgChart');
    const editable = canEditCompanyStructure();
    const mutable = companyStructureCanMutate();
    const hasChanges = companyStructureHasUnsavedChanges();

    stage?.classList.toggle('is-read-only', !editable);
    if (modeBadge) modeBadge.textContent = editable ? 'Редагована карта' : 'Лише перегляд';
    if (saveButton) {
        saveButton.classList.toggle('hidden', !editable);
        saveButton.disabled = !mutable
            || companyStructureSaveState === 'saving'
            || companyStructureSaveState === 'conflict'
            || (!hasChanges && companyStructureSaveState !== 'error');
        saveButton.textContent = companyStructureSaveState === 'saving'
            ? 'Збереження...'
            : (companyStructureSaveState === 'error' ? 'Повторити збереження' : 'Зберегти');
    }
    if (autoButton) {
        autoButton.classList.toggle('hidden', !editable);
        autoButton.disabled = !mutable;
    }
    if (editButton) {
        editButton.classList.toggle('hidden', !editable);
        editButton.disabled = !mutable || !companyStructureNodeById(selectedCompanyStructureNodeId);
    }
    if (notes) notes.readOnly = !mutable;
    if (instructions) instructions.readOnly = !mutable;

    let statusText = '';
    let statusState = companyStructureSaveState;
    if (companyStructureLoadState === 'loading' || companyStructureLoadState === 'idle') {
        statusText = 'Завантаження структури...';
        statusState = 'loading';
    } else if (companyStructureLoadState === 'error' || companyStructureLoadState === 'restricted') {
        statusText = companyStructureLoadError || 'Не вдалося завантажити структуру';
        statusState = companyStructureLoadState;
    } else if (companyStructureLoadState === 'empty') {
        statusText = 'Збереженої структури ще немає';
        statusState = 'clean';
    } else if (companyStructureSaveState === 'saving') {
        statusText = hasChanges ? 'Збереження поточної версії... Нові зміни залишаться у draft.' : 'Збереження...';
    } else if (companyStructureSaveState === 'changed') {
        statusText = 'Є незбережені зміни';
    } else if (companyStructureSaveState === 'saved') {
        statusText = `Збережено${formatCompanyStructureUpdatedAt(companyStructureUpdatedAt) ? `: ${formatCompanyStructureUpdatedAt(companyStructureUpdatedAt)}` : ''}`;
    } else if (companyStructureSaveState === 'conflict') {
        statusText = 'Конфлікт: структуру вже змінили в іншій вкладці';
    } else if (companyStructureSaveState === 'error') {
        statusText = companyStructureSaveError || 'Не вдалося зберегти структуру';
    } else {
        const updatedAt = formatCompanyStructureUpdatedAt(companyStructureUpdatedAt);
        statusText = updatedAt ? `Збережено: ${updatedAt}` : 'Структуру завантажено';
    }
    if (!editable && companyStructureLoadState === 'ready') statusText = `Лише перегляд · ${statusText}`;
    if (status) {
        status.textContent = statusText;
        status.dataset.state = statusState;
    }

    [retryButton, templateButton, reloadButton, copyButton].forEach(button => button?.classList.add('hidden'));
    let recoveryText = '';
    if (companyStructureLoadState === 'error' || companyStructureLoadState === 'restricted') {
        recoveryText = companyStructureLoadError || 'Структура не завантажилась. Дані не змінено.';
        retryButton?.classList.remove('hidden');
    } else if (companyStructureLoadState === 'empty' && !companyStructureHasSavedData) {
        recoveryText = editable
            ? 'Сервер підтвердив, що збереженої структури немає. Базовий шаблон буде застосовано лише після вашого підтвердження.'
            : 'Збереженої структури ще немає. Створити її може користувач із правом hr.staff.manage.';
        if (editable) templateButton?.classList.remove('hidden');
    } else if (companyStructureSaveState === 'conflict') {
        const current = companyStructureConflictCurrent || {};
        const author = current.updatedBy || 'невідомо';
        const updatedAt = formatCompanyStructureUpdatedAt(current.updatedAt) || 'невідомо';
        recoveryText = `На сервері вже є новіша версія. Автор: ${author}. Оновлено: ${updatedAt}. Автоматичний overwrite заблоковано.`;
        reloadButton?.classList.remove('hidden');
        copyButton?.classList.remove('hidden');
    } else if (companyStructurePermissionDenied) {
        recoveryText = 'Сервер відхилив редагування. Структуру переведено в режим лише для перегляду.';
    }
    if (recovery) recovery.classList.toggle('hidden', !recoveryText);
    if (recoveryMessage) recoveryMessage.textContent = recoveryText;
    updateCompanyOrgHistoryControls();
    updateCompanyOrgLinkStatus();
}

function setCompanyOrgLinkMode(nodeId, endpoint = 'child') {
    companyOrgLinkingNodeId = nodeId || null;
    companyOrgLinkingEndpoint = companyOrgLinkingNodeId ? (endpoint === 'parent' ? 'parent' : 'child') : null;
    companyOrgLinkPointer = null;
    const stage = document.getElementById('companyOrgChart');
    stage?.classList.toggle('is-linking', Boolean(companyOrgLinkingNodeId));
    document.querySelectorAll('[data-org-node-shell]').forEach(shell => {
        const isOrigin = shell.dataset.orgNodeShell === companyOrgLinkingNodeId;
        shell.classList.toggle('is-link-source', isOrigin);
        shell.classList.toggle('is-link-parent-origin', isOrigin && companyOrgLinkingEndpoint === 'parent');
        shell.classList.toggle('is-link-child-origin', isOrigin && companyOrgLinkingEndpoint === 'child');
    });
    updateCompanyOrgLinkStatus();
    renderCompanyOrgLinks();
}

function cloneCompanyStructureNodes(nodes) {
    return (nodes || []).map(node => ({ ...node }));
}

function companyStructureHistorySnapshot(nodes = companyStructureNodes) {
    return {
        nodes: cloneCompanyStructureNodes(nodes),
        selectedNodeId: selectedCompanyStructureNodeId,
        notes: document.getElementById('companyStructureNotes')?.value || '',
        instructions: document.getElementById('companyInstructionsText')?.value || ''
    };
}

function updateCompanyOrgHistoryControls() {
    const mutable = companyStructureCanMutate();
    const undo = document.getElementById('hrOrgUndoBtn');
    const redo = document.getElementById('hrOrgRedoBtn');
    if (undo) undo.disabled = !mutable || !companyOrgUndoStack.length;
    if (redo) redo.disabled = !mutable || !companyOrgRedoStack.length;
}

function resetCompanyOrgHistory() {
    companyOrgUndoStack = [];
    companyOrgRedoStack = [];
    updateCompanyOrgHistoryControls();
}

function resetCompanyOrgViewState() {
    companyOrgTreeCollapsedIds = new Set();
    companyOrgTreeExpandedIds = new Set();
    if (companyOrgSearchRenderTimer) {
        window.clearTimeout?.(companyOrgSearchRenderTimer);
        companyOrgSearchRenderTimer = null;
    }
}

function normalizeCompanyOrgArchiveFilter(value) {
    return COMPANY_ORG_ARCHIVE_FILTERS.has(value) ? value : 'active';
}

function companyOrgNodeMatchesArchiveFilter(node) {
    if (companyOrgArchiveFilter === 'all') return true;
    if (companyOrgArchiveFilter === 'archived') return node?.archived === true;
    return node?.archived !== true;
}

function companyStructureCurrentDraftSignature() {
    const notes = document.getElementById('companyStructureNotes')?.value || '';
    const instructions = document.getElementById('companyInstructionsText')?.value || '';
    return JSON.stringify({
        notes,
        instructions,
        nodes: normalizeCompanyStructureNodes(companyStructureNodes)
    });
}

function recordCompanyStructureSavedBaseline() {
    companyOrgSavedDraftSignature = companyStructureCurrentDraftSignature();
}

function pushCompanyOrgHistory(snapshot = companyStructureHistorySnapshot()) {
    companyOrgUndoStack.push(snapshot);
    if (companyOrgUndoStack.length > COMPANY_ORG_HISTORY_LIMIT) companyOrgUndoStack.shift();
    companyOrgRedoStack = [];
    updateCompanyOrgHistoryControls();
}

function restoreCompanyOrgHistorySnapshot(snapshot) {
    if (!snapshot) return false;
    companyStructureNodes = normalizeCompanyStructureNodes(snapshot.nodes);
    selectedCompanyStructureNodeId = companyStructureNodeById(snapshot.selectedNodeId)?.id || companyStructureNodes[0]?.id || null;
    const notes = document.getElementById('companyStructureNotes');
    const instructions = document.getElementById('companyInstructionsText');
    if (notes) notes.value = snapshot.notes || '';
    if (instructions) instructions.value = snapshot.instructions || '';
    syncCompanyStructureText();
    renderCompanyOrgWorkspace();
    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
    markCompanyStructureChanged();
    updateCompanyOrgHistoryControls();
    return true;
}

function undoCompanyStructureDraft() {
    if (!companyStructureCanMutate() || !companyOrgUndoStack.length) return false;
    companyOrgRedoStack.push(companyStructureHistorySnapshot());
    return restoreCompanyOrgHistorySnapshot(companyOrgUndoStack.pop());
}

function redoCompanyStructureDraft() {
    if (!companyStructureCanMutate() || !companyOrgRedoStack.length) return false;
    companyOrgUndoStack.push(companyStructureHistorySnapshot());
    return restoreCompanyOrgHistorySnapshot(companyOrgRedoStack.pop());
}

function createCompanyStructureNodeId(title = 'node') {
    const slug = normalizeCompanyStructureNodeId(String(title || 'node').toLowerCase(), 'node').slice(0, 28);
    let id = '';
    do {
        companyOrgNodeIdSequence += 1;
        const entropy = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 8)
            || `${Date.now().toString(36)}${companyOrgNodeIdSequence.toString(36)}`;
        id = normalizeCompanyStructureNodeId(`${slug}_${entropy}`, `node_${entropy}`);
    } while (companyStructureNodeById(id));
    return id;
}

function normalizeCompanyStructureNodeId(value, fallback) {
    return String(value || fallback || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_{2,}/g, '_')
        .slice(0, 64) || fallback;
}

function normalizeCompanyStructureDisplayGroupKey(value) {
    return normalizeStaffDisplayGroupKey(value);
}

function companyStructureNodeDisplayGroup(node = {}) {
    const explicit = normalizeCompanyStructureDisplayGroupKey(node.displayGroup || node.display_group);
    if (explicit) return explicit;
    const id = normalizeCompanyStructureNodeId(node.id, '');
    return COMPANY_STRUCTURE_DEFAULT_DISPLAY_GROUPS[id] || '';
}

function companyStructureDisplayGroupLabel(key) {
    const normalized = normalizeCompanyStructureDisplayGroupKey(key);
    return staffDisplayGroupLabel(normalized) || normalized || '';
}

function companyStructureDisplayGroupOptions(selectedValue = '') {
    const selected = normalizeCompanyStructureDisplayGroupKey(selectedValue);
    const groups = activeStaffDisplayGroups(staffDisplayGroupsContract);
    return [
        `<option value=""${selected ? '' : ' selected'}>Без операційного фільтра</option>`,
        ...groups.map(group => (
            `<option value="${escapeHtml(group.key)}"${group.key === selected ? ' selected' : ''}>${escapeHtml(group.label || STAFF_DISPLAY_GROUP_LABELS[group.key] || group.key)}</option>`
        ))
    ].join('');
}

function clampCompanyOrgCoord(value, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(0, Math.min(max, Math.round(numeric)));
}

function snapCompanyOrgCoord(value, max = 5000) {
    const coord = clampCompanyOrgCoord(value, max);
    if (coord === null) return null;
    return Math.max(0, Math.min(max, Math.round(coord / ORG_GRID_STEP) * ORG_GRID_STEP));
}

function companyOrgNodeSize(node = {}) {
    return node.tone === 'gold'
        ? { width: ORG_ROOT_NODE_WIDTH, height: ORG_ROOT_NODE_HEIGHT }
        : { width: ORG_NODE_WIDTH, height: ORG_NODE_HEIGHT };
}

function companyOrgDefaultPosition(node, index) {
    if (node?.id && DEFAULT_COMPANY_STRUCTURE_POSITIONS[node.id]) {
        return DEFAULT_COMPANY_STRUCTURE_POSITIONS[node.id];
    }
    const laneIndex = Math.max(0, ORG_ALLOWED_LANES.indexOf(node?.lane || 'leadership'));
    const column = index % 6;
    const row = Math.floor(index / 6);
    return {
        x: 80 + column * 190,
        y: 80 + laneIndex * 170 + row * 110
    };
}

function normalizeCompanyStructureNodes(nodes) {
    const source = Array.isArray(nodes) ? nodes : [];
    const seen = new Set();
    const normalized = source.map((node, index) => {
        const raw = node && typeof node === 'object' ? node : {};
        const baseId = normalizeCompanyStructureNodeId(raw.id, `node_${index + 1}`);
        let id = baseId;
        const suffixBase = (baseId || `node_${index + 1}`).slice(0, 58);
        let suffix = 2;
        while (seen.has(id)) {
            id = `${suffixBase}_${suffix}`.slice(0, 64);
            suffix += 1;
        }
        seen.add(id);
        const tone = ORG_ALLOWED_TONES.includes(raw.tone) ? raw.tone : 'blue';
        const lane = ORG_ALLOWED_LANES.includes(raw.lane) ? raw.lane : 'leadership';
        const order = Number.isFinite(Number(raw.order)) ? Number(raw.order) : index;
        const fallbackPosition = companyOrgDefaultPosition({ id, lane, tone }, index);
        return {
            id,
            title: String(raw.title || 'Роль').trim().slice(0, 80) || 'Роль',
            description: String(raw.description || 'Роль у структурі компанії.').trim().slice(0, 1200),
            tone,
            lane,
            parentId: raw.parentId ? normalizeCompanyStructureNodeId(raw.parentId, '') : null,
            stack: raw.stack ? String(raw.stack).trim().slice(0, 64) : null,
            order,
            x: clampCompanyOrgCoord(raw.x, 5000) ?? fallbackPosition.x,
            y: clampCompanyOrgCoord(raw.y, 5000) ?? fallbackPosition.y,
            meta: raw.meta ? String(raw.meta).trim().slice(0, 80) : null,
            displayGroup: companyStructureNodeDisplayGroup({ ...raw, id }) || null,
            archived: raw.archived === true
        };
    });
    const ids = new Set(normalized.map(node => node.id));
    const byId = new Map(normalized.map(node => [node.id, node]));
    return normalized.map((node, index) => {
        const fallbackPosition = companyOrgDefaultPosition(node, index);
        let parentId = node.parentId && ids.has(node.parentId) && node.parentId !== node.id ? node.parentId : null;
        const visited = new Set([node.id]);
        let cursor = parentId;
        while (cursor) {
            if (visited.has(cursor)) {
                parentId = null;
                break;
            }
            visited.add(cursor);
            cursor = byId.get(cursor)?.parentId || null;
        }
        return {
            ...node,
            parentId,
            x: clampCompanyOrgCoord(node.x, 5000) ?? fallbackPosition.x,
            y: clampCompanyOrgCoord(node.y, 5000) ?? fallbackPosition.y
        };
    });
}

function sortCompanyStructureNodes(nodes) {
    return [...(nodes || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.title).localeCompare(String(b.title), 'uk'));
}

function companyOrgVisibleNodes() {
    const visibleIds = companyOrgVisibleNodeIds();
    return sortCompanyStructureNodes(companyStructureNodes.filter(node => visibleIds.has(node.id)));
}

function compareCompanyOrgAutoLayoutNodes(a, b) {
    const laneDelta = (ORG_AUTO_LAYOUT_LANE_RANK[a?.lane] ?? 99) - (ORG_AUTO_LAYOUT_LANE_RANK[b?.lane] ?? 99);
    if (laneDelta) return laneDelta;
    const stackDelta = String(a?.stack || '').localeCompare(String(b?.stack || ''), 'uk');
    if (stackDelta) return stackDelta;
    return (Number(a?.order) || 0) - (Number(b?.order) || 0) || String(a?.title || '').localeCompare(String(b?.title || ''), 'uk');
}

function sortCompanyOrgAutoLayoutNodes(nodes) {
    return [...(nodes || [])].sort(compareCompanyOrgAutoLayoutNodes);
}

function companyStructureChildrenOf(parentId) {
    return sortCompanyStructureNodes(companyStructureNodes.filter(node => node.parentId === parentId));
}

function companyStructureNodesByLane(lane) {
    return sortCompanyStructureNodes(companyStructureNodes.filter(node => node.lane === lane));
}

function companyOrgLinkedProfessions(nodeId) {
    return (hrProfessions || [])
        .filter(item => (item.structure_node_id || item.structureNodeId) === nodeId)
        .filter(item => item.is_active !== false && item.isActive !== false);
}

function companyOrgLinkedStaffIds(nodeId) {
    const ids = new Set();
    (hrProfessions || []).forEach(profession => {
        (profession.people || []).forEach(person => {
            if (person.structureNodeId === nodeId || person.company_structure_node_id === nodeId) ids.add(Number(person.id));
        });
    });
    companyOrgLinkedProfessions(nodeId).forEach(profession => {
        (profession.people || []).forEach(person => ids.add(Number(person.id)));
    });
    (teamStaff || []).forEach(person => {
        if ((person.company_structure_node_id || person.companyStructureNodeId) === nodeId) ids.add(Number(person.id));
    });
    return [...ids].filter(Number.isFinite);
}

function companyOrgLinkedStaff(nodeId) {
    const ids = new Set(companyOrgLinkedStaffIds(nodeId));
    return (teamStaff || []).filter(person => ids.has(Number(person.id)));
}

function companyOrgDescendantIds(nodeId) {
    const descendants = [];
    const queue = companyStructureChildrenOf(nodeId).map(node => node.id);
    const seen = new Set();
    while (queue.length) {
        const id = queue.shift();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        descendants.push(id);
        companyStructureChildrenOf(id).forEach(child => queue.push(child.id));
    }
    return descendants;
}

function companyOrgNodeImpact(nodeId) {
    return {
        children: companyOrgDescendantIds(nodeId).length,
        professions: companyOrgLinkedProfessions(nodeId).length,
        staff: companyOrgLinkedStaffIds(nodeId).length
    };
}

function companyOrgNodeMatchesSearch(node, query = companyOrgSearchQuery) {
    const needle = normalizeSearchText(query);
    if (!needle) return true;
    const professionText = companyOrgLinkedProfessions(node.id).map(item => `${item.title || ''} ${item.key || ''}`).join(' ');
    const staffText = companyOrgLinkedStaff(node.id).map(item => `${item.name || ''} ${item.phone || ''} ${item.role_type || ''}`).join(' ');
    return normalizeSearchText([
        node.title,
        node.description,
        node.meta,
        companyStructureDisplayGroupLabel(companyStructureNodeDisplayGroup(node)),
        professionText,
        staffText
    ].join(' ')).includes(needle);
}

function addCompanyOrgVisibleNodePath(visible, node) {
    let cursor = node;
    while (cursor && !visible.has(cursor.id)) {
        visible.add(cursor.id);
        cursor = cursor.parentId ? companyStructureNodeById(cursor.parentId) : null;
    }
}

function companyOrgVisibleNodeIds() {
    const query = normalizeSearchText(companyOrgSearchQuery);
    const visible = new Set();
    sortCompanyStructureNodes(companyStructureNodes).forEach(node => {
        if (!companyOrgNodeMatchesArchiveFilter(node)) return;
        if (query && !companyOrgNodeMatchesSearch(node, query)) return;
        addCompanyOrgVisibleNodePath(visible, node);
    });
    return visible;
}

function companyOrgVisibleEmptyMessage() {
    if (normalizeSearchText(companyOrgSearchQuery)) return 'За пошуком нічого не знайдено. Очистіть пошук або змініть фільтр активності.';
    if (companyOrgArchiveFilter === 'archived') return 'Архівних вузлів немає.';
    if (companyOrgArchiveFilter === 'all') return 'У структурі немає вузлів для показу.';
    return 'Немає активних вузлів структури.';
}

function companyStructureTextFromNodes(nodes) {
    const byId = new Map((nodes || []).map(node => [node.id, node]));
    return sortCompanyStructureNodes(nodes).map(node => {
        const parent = node.parentId ? byId.get(node.parentId) : null;
        return parent ? `${node.title} <- ${parent.title}` : node.title;
    }).join('\n');
}

function syncCompanyStructureText() {
    const structureText = document.getElementById('companyStructureText');
    if (structureText) {
        structureText.value = companyStructureTextFromNodes(companyStructureNodes) || DEFAULT_COMPANY_STRUCTURE_TEXT;
    }
}

function companyOrgStageSizeForNodes(nodes) {
    const bounds = (nodes || []).reduce((max, node) => {
        const size = companyOrgNodeSize(node);
        return {
            width: Math.max(max.width, Number(node.x || 0) + size.width + ORG_CANVAS_PADDING),
            height: Math.max(max.height, Number(node.y || 0) + size.height + ORG_CANVAS_PADDING)
        };
    }, { width: ORG_CANVAS_MIN_WIDTH, height: ORG_CANVAS_MIN_HEIGHT });
    return {
        width: Math.ceil(bounds.width),
        height: Math.ceil(bounds.height)
    };
}

function companyOrgStageSize() {
    return companyOrgStageSizeForNodes(companyOrgVisibleNodes());
}

function companyOrgNodeAnchor(node, edge = 'center') {
    const size = companyOrgNodeSize(node);
    const x = Number(node.x || 0);
    const y = Number(node.y || 0);
    if (edge === 'top') return { x: x + size.width / 2, y };
    if (edge === 'bottom') return { x: x + size.width / 2, y: y + size.height };
    return { x: x + size.width / 2, y: y + size.height / 2 };
}

function companyOrgLinkPath(parent, child) {
    const start = companyOrgNodeAnchor(parent, 'bottom');
    const end = companyOrgNodeAnchor(child, 'top');
    return companyOrgFloatingLinkPath(start, end);
}

function companyOrgFloatingLinkPath(start, end) {
    const midY = Math.round((start.y + end.y) / 2);
    return `M ${Math.round(start.x)} ${Math.round(start.y)} C ${Math.round(start.x)} ${midY}, ${Math.round(end.x)} ${midY}, ${Math.round(end.x)} ${Math.round(end.y)}`;
}

function companyOrgPreviewLinkPath() {
    if (!companyOrgLinkingNodeId || !companyOrgLinkingEndpoint) return '';
    const origin = companyStructureNodeById(companyOrgLinkingNodeId);
    if (!origin) return '';
    const edge = companyOrgLinkingEndpoint === 'parent' ? 'bottom' : 'top';
    const start = companyOrgNodeAnchor(origin, edge);
    const fallbackY = companyOrgLinkingEndpoint === 'parent' ? start.y + 180 : start.y - 180;
    const end = companyOrgLinkPointer || { x: start.x, y: Math.max(0, fallbackY) };
    return companyOrgFloatingLinkPath(start, end);
}

function renderCompanyOrgLinks() {
    const stage = document.getElementById('companyOrgChart');
    const layer = stage?.querySelector('.hr-org-link-layer');
    if (!stage || !layer) return;
    const { width, height } = companyOrgStageSize();
    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);
    layer.setAttribute('width', String(width));
    layer.setAttribute('height', String(height));
    const visibleNodes = companyOrgVisibleNodes();
    const byId = new Map(visibleNodes.map(node => [node.id, node]));
    const linkHtml = visibleNodes.map(node => {
        const parent = node.parentId ? byId.get(node.parentId) : null;
        if (!parent) return '';
        const active = node.id === selectedCompanyStructureNodeId || parent.id === selectedCompanyStructureNodeId ? ' is-active' : '';
        const path = companyOrgLinkPath(parent, node);
        return `
            <g class="hr-org-link-group${active}" tabindex="0" role="button" data-org-link-child="${escapeHtml(node.id)}" aria-label="Лінія: ${escapeHtml(parent.title)} керує ${escapeHtml(node.title)}">
                <path class="hr-org-link-hit" d="${path}"></path>
                <path class="hr-org-link${active}" d="${path}"></path>
            </g>`;
    }).join('');
    const previewPath = companyOrgPreviewLinkPath();
    const previewHtml = previewPath ? `<path class="hr-org-link-preview" d="${previewPath}"></path>` : '';
    layer.innerHTML = `${linkHtml}${previewHtml}`;
    layer.querySelectorAll('[data-org-link-child]').forEach(link => {
        const activate = () => {
            const child = companyStructureNodeById(link.dataset.orgLinkChild);
            if (child) selectCompanyOrgNodeById(child.id);
        };
        link.addEventListener('click', activate);
        link.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            activate();
        });
    });
}

function renderCompanyOrgNode(node) {
    const tone = ORG_ALLOWED_TONES.includes(node.tone) ? node.tone : 'blue';
    const editable = companyStructureCanMutate();
    const active = node.id === selectedCompanyStructureNodeId ? ' is-active' : '';
    const lane = ORG_ALLOWED_LANES.includes(node.lane) ? node.lane : 'leadership';
    const size = companyOrgNodeSize(node);
    const displayGroup = companyStructureNodeDisplayGroup(node);
    const displayGroupLabel = companyStructureDisplayGroupLabel(displayGroup);
    const linkedProfessions = companyOrgLinkedProfessions(node.id)
        .sort((a, b) => String(a.title || a.key || '').localeCompare(String(b.title || b.key || ''), 'uk'));
    const professionCount = linkedProfessions.length;
    const staffCount = companyOrgLinkedStaffIds(node.id).length;
    const professionPreview = linkedProfessions.length
        ? `<span class="hr-org-node-professions" aria-label="Професії вузла ${escapeHtml(node.title)}">${linkedProfessions.map(item => `<span>${escapeHtml(item.title || item.key)}</span>`).join('')}</span>`
        : '<span class="hr-org-node-professions is-empty">Професій не привʼязано</span>';
    const searchClass = companyOrgNodeMatchesSearch(node) ? '' : ' is-search-dim';
    const archivedClass = node.archived ? ' is-archived' : '';
    return `
        <span class="hr-org-node-shell${searchClass}${archivedClass}" data-org-node-shell="${escapeHtml(node.id)}" data-org-lane="${escapeHtml(lane)}" style="left:${Number(node.x || 0)}px;top:${Number(node.y || 0)}px;width:${size.width}px;height:${size.height}px;">
            <button type="button" class="hr-org-node hr-org-node--${tone} hr-org-node--lane-${lane}${active}" data-org-node-id="${escapeHtml(node.id)}" aria-label="${escapeHtml(node.title)}. ${professionCount} професій, ${staffCount} працівників.${editable ? ' Перетягніть на інший вузол, щоб змінити керівника.' : ' Режим лише для перегляду.'}">
                <span class="hr-org-node-lane">${escapeHtml(displayGroupLabel || ORG_LANE_LABELS[lane] || 'Роль')}</span>
                <span class="hr-org-node-title">${escapeHtml(node.title)}</span>
                ${professionPreview}
                <span class="hr-org-node-counts"><span title="Професії">${professionCount} проф.</span><span title="Працівники">${staffCount} люд.</span></span>
                ${node.archived ? '<span class="hr-org-node-state">Архів</span>' : ''}
            </button>
            ${editable ? `<span class="hr-org-node-quick-actions">
                <button type="button" data-org-quick-add="${escapeHtml(node.id)}" aria-label="Додати до ${escapeHtml(node.title)}" aria-haspopup="menu" aria-expanded="false">+</button>
                <button type="button" data-org-quick-more="${escapeHtml(node.id)}" aria-label="Дії з ${escapeHtml(node.title)}" aria-haspopup="menu" aria-expanded="false">⋯</button>
                <span class="hr-org-node-menu hidden" role="menu" data-org-add-menu="${escapeHtml(node.id)}">
                    <button type="button" role="menuitem" data-org-action="add-child" data-org-action-node="${escapeHtml(node.id)}">Дочірній вузол</button>
                    <button type="button" role="menuitem" data-org-action="add-sibling" data-org-action-node="${escapeHtml(node.id)}">Сусідній вузол</button>
                    <button type="button" role="menuitem" data-org-action="add-profession" data-org-action-node="${escapeHtml(node.id)}">Професію у вузлі</button>
                </span>
                <span class="hr-org-node-menu hidden" role="menu" data-org-more-menu="${escapeHtml(node.id)}">
                    <button type="button" role="menuitem" data-org-action="rename" data-org-action-node="${escapeHtml(node.id)}">Перейменувати</button>
                    <button type="button" role="menuitem" data-org-action="duplicate" data-org-action-node="${escapeHtml(node.id)}">Дублювати</button>
                    <button type="button" role="menuitem" data-org-action="move" data-org-action-node="${escapeHtml(node.id)}">Перемістити</button>
                    <button type="button" role="menuitem" data-org-action="archive" data-org-action-node="${escapeHtml(node.id)}">${node.archived ? 'Відновити' : 'Архівувати'}</button>
                </span>
            </span>` : ''}
        </span>`;
}

function addCompanyStructureNode({ relation = 'child', sourceId = selectedCompanyStructureNodeId, title = 'Новий вузол' } = {}) {
    if (!companyStructureCanMutate()) return null;
    const source = companyStructureNodeById(sourceId);
    if (!source) return null;
    const parentId = relation === 'sibling' ? source.parentId : source.id;
    const siblings = companyStructureNodes.filter(node => node.parentId === parentId);
    const id = createCompanyStructureNodeId(title);
    const node = {
        id,
        title: String(title || 'Новий вузол').trim().slice(0, 80) || 'Новий вузол',
        description: 'Опис вузла ще не заповнений.',
        tone: source.tone === 'gold' ? 'blue' : source.tone,
        lane: relation === 'sibling' ? source.lane : (source.lane === 'root' ? 'leadership' : source.lane),
        parentId: parentId || null,
        stack: source.stack || null,
        order: Math.max(Number(source.order) || 0, ...siblings.map(item => Number(item.order) || 0)) + 1,
        x: snapCompanyOrgCoord(Number(source.x || 0) + (relation === 'sibling' ? ORG_NODE_WIDTH + 40 : 0), 5000) ?? 0,
        y: snapCompanyOrgCoord(Number(source.y || 0) + (relation === 'child' ? ORG_NODE_HEIGHT + 80 : 0), 5000) ?? 0,
        meta: null,
        displayGroup: companyStructureNodeDisplayGroup(source) || null,
        archived: false
    };
    pushCompanyOrgHistory();
    companyStructureNodes = normalizeCompanyStructureNodes([...companyStructureNodes, node]);
    selectedCompanyStructureNodeId = id;
    syncCompanyStructureText();
    renderCompanyOrgWorkspace();
    selectCompanyOrgNodeById(id, { openInspector: true });
    markCompanyStructureChanged();
    return companyStructureNodeById(id);
}

async function promptAddCompanyStructureNode(relation, sourceId) {
    if (!companyStructureCanMutate()) return null;
    const result = await formModal(relation === 'sibling' ? 'Новий сусідній вузол' : 'Новий дочірній вузол', [
        { key: 'title', label: 'Назва вузла', required: true, placeholder: 'Наприклад, Старший зміни' }
    ], { icon: '+', okText: 'Додати вузол' });
    if (!result?.title?.trim()) return null;
    return addCompanyStructureNode({ relation, sourceId, title: result.title });
}

function duplicateCompanyStructureNode(nodeId = selectedCompanyStructureNodeId) {
    if (!companyStructureCanMutate()) return null;
    const source = companyStructureNodeById(nodeId);
    if (!source) return null;
    const id = createCompanyStructureNodeId(source.title);
    const duplicate = {
        ...source,
        id,
        title: `${source.title} — копія`.slice(0, 80),
        order: (Number(source.order) || 0) + 1,
        x: snapCompanyOrgCoord(Number(source.x || 0) + 40, 5000) ?? source.x,
        y: snapCompanyOrgCoord(Number(source.y || 0) + 40, 5000) ?? source.y,
        archived: false
    };
    pushCompanyOrgHistory();
    companyStructureNodes = normalizeCompanyStructureNodes([...companyStructureNodes, duplicate]);
    selectedCompanyStructureNodeId = id;
    syncCompanyStructureText();
    renderCompanyOrgWorkspace();
    selectCompanyOrgNodeById(id, { openInspector: true });
    markCompanyStructureChanged();
    return companyStructureNodeById(id);
}

function reparentCompanyStructureNode(nodeId, parentId, options = {}) {
    if (!companyStructureCanMutate()) return false;
    const node = companyStructureNodeById(nodeId);
    const normalizedParentId = parentId || null;
    if (!node || node.id === normalizedParentId) return false;
    if (normalizedParentId && !companyStructureNodeById(normalizedParentId)) return false;
    if (normalizedParentId && companyOrgWouldCreateCycle(node.id, normalizedParentId)) return false;
    if (node.parentId === normalizedParentId) return true;
    pushCompanyOrgHistory(options.snapshot || companyStructureHistorySnapshot());
    node.parentId = normalizedParentId;
    companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes);
    syncCompanyStructureText();
    renderCompanyOrgWorkspace();
    selectCompanyOrgNodeById(node.id);
    markCompanyStructureChanged();
    if (!options.silent) {
        const parent = normalizedParentId ? companyStructureNodeById(normalizedParentId) : null;
        showNotification(parent ? `${node.title} тепер підпорядковується «${parent.title}». Збережіть структуру.` : `${node.title} тепер кореневий вузол. Збережіть структуру.`, 'info');
    }
    return true;
}

function setCompanyStructureNodeCollapsed(nodeId, collapsed) {
    const node = companyStructureNodeById(nodeId);
    if (!node) return false;
    if (collapsed) {
        companyOrgTreeExpandedIds.delete(node.id);
        companyOrgTreeCollapsedIds.add(node.id);
    } else {
        companyOrgTreeCollapsedIds.delete(node.id);
        companyOrgTreeExpandedIds.add(node.id);
    }
    renderCompanyOrgWorkspace();
    selectCompanyOrgNodeById(node.id);
    return true;
}

function companyOrgNodeIsTreeCollapsed(node) {
    if (!node?.id) return false;
    if (companyOrgTreeExpandedIds.has(node.id)) return false;
    if (companyOrgTreeCollapsedIds.has(node.id)) return true;
    return false;
}

async function requestArchiveCompanyStructureNode(nodeId = selectedCompanyStructureNodeId) {
    if (!companyStructureCanMutate()) return false;
    const node = companyStructureNodeById(nodeId);
    if (!node) return false;
    const nextArchived = !node.archived;
    if (nextArchived) {
        const impact = companyOrgNodeImpact(node.id);
        const confirmed = await confirmHrAction(
            `Архівувати «${node.title}»?\n\nВплив: дочірніх вузлів — ${impact.children}, професій — ${impact.professions}, працівників — ${impact.staff}. Звʼязки не будуть видалені.`,
            { type: 'warning', okText: 'Архівувати', cancelText: 'Скасувати' }
        );
        if (!confirmed) return false;
    }
    pushCompanyOrgHistory();
    node.archived = nextArchived;
    renderCompanyOrgWorkspace();
    selectCompanyOrgNodeById(node.id);
    markCompanyStructureChanged();
    showNotification(nextArchived ? 'Вузол архівовано у draft без очищення звʼязків.' : 'Вузол відновлено у draft.', 'info');
    return true;
}

function openProfessionWorkspaceForStructureNode(nodeId) {
    const node = companyStructureNodeById(nodeId);
    if (!node) return null;
    return openProfessionWorkspace({
        initialTab: 'main',
        returnContext: captureProfessionReturnContext({ tab: 'structure', nodeId: node.id }),
        defaults: { structureNodeId: node.id }
    });
}

function closeCompanyOrgNodeMenus(except = null) {
    document.querySelectorAll('.hr-org-node-menu').forEach(menu => {
        if (menu === except) return;
        menu.classList.add('hidden');
    });
    document.querySelectorAll('[data-org-quick-add], [data-org-quick-more], [data-org-tree-add], [data-org-tree-more]').forEach(button => {
        const controlsCurrent = except && (
            except.dataset.orgAddMenu === button.dataset.orgQuickAdd
            || except.dataset.orgMoreMenu === button.dataset.orgQuickMore
            || except.dataset.orgTreeAddMenu === button.dataset.orgTreeAdd
            || except.dataset.orgTreeMoreMenu === button.dataset.orgTreeMore
        );
        button.setAttribute('aria-expanded', controlsCurrent ? 'true' : 'false');
    });
}

function toggleCompanyOrgNodeMenu(button, menu) {
    if (!button || !menu) return;
    const opening = menu.classList.contains('hidden');
    closeCompanyOrgNodeMenus(opening ? menu : null);
    menu.classList.toggle('hidden', !opening);
    button.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) menu.querySelector('button')?.focus();
}

async function handleCompanyOrgNodeAction(action, nodeId) {
    closeCompanyOrgNodeMenus();
    selectCompanyOrgNodeById(nodeId, { openInspector: action === 'move' });
    if (action === 'add-child') return promptAddCompanyStructureNode('child', nodeId);
    if (action === 'add-sibling') return promptAddCompanyStructureNode('sibling', nodeId);
    if (action === 'add-profession') return openProfessionWorkspaceForStructureNode(nodeId);
    if (action === 'rename') return openCompanyOrgNodeEditor(nodeId);
    if (action === 'duplicate') return duplicateCompanyStructureNode(nodeId);
    if (action === 'archive') return requestArchiveCompanyStructureNode(nodeId);
    if (action === 'move') return document.getElementById('hrOrgInspectorParent')?.focus();
    return null;
}

function bindCompanyOrgChartEvents(stage) {
    stage.querySelectorAll('[data-org-node-id]').forEach(node => {
        node.addEventListener('click', event => {
            if (companyOrgSuppressNextClick) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const nodeId = node.dataset.orgNodeId;
            if (companyOrgLinkingNodeId) {
                event.preventDefault();
                event.stopPropagation();
                selectCompanyOrgNodeById(nodeId);
                if (typeof showNotification === 'function') {
                    showNotification('Щоб змінити керівника, натисніть верхню точку потрібної ролі. Esc — скасувати.', 'info');
                }
                return;
            }
            selectCompanyOrgNodeById(nodeId, { openInspector: true });
        });
        if (companyStructureCanMutate()) {
            node.addEventListener('pointerdown', event => startCompanyOrgDrag(event, node.dataset.orgNodeId));
        }
    });
    stage.querySelectorAll('[data-org-edit]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            openCompanyOrgNodeEditor(button.dataset.orgEdit);
        });
    });
    stage.querySelectorAll('[data-org-link-child-port]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            handleCompanyOrgPortClick('child', button.dataset.orgLinkChildPort, event);
        });
    });
    stage.querySelectorAll('[data-org-link-parent-port]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            handleCompanyOrgPortClick('parent', button.dataset.orgLinkParentPort, event);
        });
    });
    stage.querySelectorAll('[data-org-quick-add]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            toggleCompanyOrgNodeMenu(button, button.closest('[data-org-node-shell]')?.querySelector('[data-org-add-menu]'));
        });
    });
    stage.querySelectorAll('[data-org-quick-more]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            toggleCompanyOrgNodeMenu(button, button.closest('[data-org-node-shell]')?.querySelector('[data-org-more-menu]'));
        });
    });
    stage.querySelectorAll('[data-org-action]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            handleCompanyOrgNodeAction(button.dataset.orgAction, button.dataset.orgActionNode);
        });
    });
    if (canEditCompanyStructure()) stage.addEventListener('mousemove', updateCompanyOrgLinkPointer);
    stage.addEventListener('click', event => {
        if (!event.target.closest?.('.hr-org-node-menu, [data-org-quick-add], [data-org-quick-more]')) closeCompanyOrgNodeMenus();
        if (!companyOrgLinkingNodeId) return;
        if (event.target.closest?.('[data-org-node-shell], [data-org-link-child-port], [data-org-link-parent-port], [data-org-edit], [data-org-link-child]')) return;
        cancelCompanyOrgLinkMode();
    });
}

function renderCompanyOrgChart() {
    const stage = document.getElementById('companyOrgChart');
    if (!stage) return;
    if (companyStructureLoadState === 'loading' || companyStructureLoadState === 'idle') {
        stage.style.width = '';
        stage.style.minHeight = '';
        stage.innerHTML = `
            <div class="hr-org-loading">
                <strong>Завантаження структури...</strong>
                Редагування буде доступне лише після отримання актуальної версії.
                <div class="hr-org-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>
            </div>`;
        updateCompanyOrgDetail(null);
        renderCompanyStructureEditorState();
        return;
    }
    if (companyStructureLoadState === 'error' || companyStructureLoadState === 'restricted') {
        stage.style.width = '';
        stage.style.minHeight = '';
        stage.innerHTML = companyStructureLoadState === 'restricted'
            ? '<div class="hr-org-loading"><strong>Структура недоступна в цьому бізнесі</strong>Дані не підставлялись. Перевірте доступ або оберіть інший бізнес.</div>'
            : '<div class="hr-org-loading"><strong>Структуру не завантажено</strong>Локальні або базові дані не підставлялись. Натисніть «Повторити завантаження».</div>';
        updateCompanyOrgDetail(null);
        renderCompanyStructureEditorState();
        return;
    }
    if (!companyStructureNodes.length) {
        stage.style.width = '';
        stage.style.minHeight = '';
        const message = companyStructureHasSavedData
            ? 'Збережена структура не містить вузлів.'
            : 'Збереженої структури ще немає. Базовий шаблон не застосовується автоматично.';
        stage.innerHTML = `<div class="hr-org-loading"><strong>Структура порожня</strong>${escapeHtml(message)}</div>`;
        updateCompanyOrgDetail(null);
        renderCompanyStructureEditorState();
        return;
    }
    const visibleNodes = companyOrgVisibleNodes();
    const { width, height } = companyOrgStageSize();
    stage.style.width = `${width}px`;
    stage.style.minHeight = `${height}px`;
    stage.classList.toggle('is-linking', Boolean(companyOrgLinkingNodeId));
    stage.innerHTML = visibleNodes.length ? `
        <svg class="hr-org-link-layer" role="group" aria-label="Лінії підпорядкування" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>
        <div class="hr-org-node-plane">
            ${visibleNodes.map(renderCompanyOrgNode).join('')}
        </div>
    ` : `<div class="hr-org-loading">${escapeHtml(companyOrgVisibleEmptyMessage())}</div>`;
    bindCompanyOrgChartEvents(stage);
    renderCompanyOrgLinks();
    updateCompanyOrgLinkStatus();
    bindCompanyOrgKeyboard();
    renderCompanyStructureEditorState();
}

function companyOrgTreeVisibleIds() {
    return companyOrgVisibleNodeIds();
}

function companyOrgTreeProfessionList(node) {
    const linked = companyOrgLinkedProfessions(node.id)
        .filter(item => item.is_active !== false && item.isActive !== false)
        .sort((a, b) => String(a.title || a.key || '').localeCompare(String(b.title || b.key || ''), 'uk'));
    if (!linked.length) return '';
    return `<ul class="hr-org-tree-professions" role="group" aria-label="Професії вузла ${escapeHtml(node.title)}">
        ${linked.map(item => `<li role="none"><button type="button" class="hr-org-tree-profession" data-org-tree-profession-key="${escapeHtml(item.key)}" data-org-tree-profession-node="${escapeHtml(node.id)}"><span>Професія</span><strong>${escapeHtml(item.title || item.key)}</strong></button></li>`).join('')}
    </ul>`;
}

function renderCompanyOrgTreeBranch(node, level, visibleIds) {
    const children = companyStructureChildrenOf(node.id).filter(child => visibleIds.has(child.id));
    const expanded = Boolean(children.length && (!companyOrgNodeIsTreeCollapsed(node) || companyOrgSearchQuery));
    const professionCount = companyOrgLinkedProfessions(node.id).filter(item => item.is_active !== false && item.isActive !== false).length;
    const staffCount = companyOrgLinkedStaffIds(node.id).length;
    const professionList = companyOrgTreeProfessionList(node);
    const selected = node.id === selectedCompanyStructureNodeId;
    const query = normalizeSearchText(companyOrgSearchQuery);
    const searchMatch = Boolean(query && companyOrgNodeMatchesSearch(node, query));
    return `<li role="none">
        <div class="hr-org-tree-row${node.archived ? ' is-archived' : ''}" data-org-tree-row="${escapeHtml(node.id)}">
            <button type="button" class="hr-org-tree-toggle" data-org-tree-toggle="${escapeHtml(node.id)}" ${children.length ? `aria-label="${expanded ? 'Згорнути' : 'Розгорнути'} ${escapeHtml(node.title)}" aria-expanded="${expanded ? 'true' : 'false'}"` : 'disabled aria-hidden="true"'}>${children.length ? (expanded ? '▾' : '▸') : '·'}</button>
            <button type="button" class="hr-org-tree-select${selected ? ' is-active' : ''}${searchMatch ? ' is-search-match' : ''}" role="treeitem" aria-level="${level}" aria-selected="${selected ? 'true' : 'false'}" ${children.length ? `aria-expanded="${expanded ? 'true' : 'false'}"` : ''} tabindex="${selected ? '0' : '-1'}" data-org-tree-select="${escapeHtml(node.id)}" data-org-tree-level="${level}">
                <strong title="${escapeHtml(node.title)}">${escapeHtml(node.title)}</strong><small>${professionCount} проф. · ${staffCount} люд.${node.archived ? ' · Архів' : ''}</small>
            </button>
            ${companyStructureCanMutate() ? `<span class="hr-org-node-quick-actions">
                <button type="button" data-org-tree-add="${escapeHtml(node.id)}" aria-label="Додати дочірній вузол до ${escapeHtml(node.title)}">+</button>
                <button type="button" data-org-tree-more="${escapeHtml(node.id)}" aria-label="Дії з ${escapeHtml(node.title)}" aria-haspopup="menu" aria-expanded="false">⋯</button>
                <span class="hr-org-node-menu hidden" role="menu" data-org-tree-more-menu="${escapeHtml(node.id)}">
                    <button type="button" role="menuitem" data-org-action="add-sibling" data-org-action-node="${escapeHtml(node.id)}">Сусідній вузол</button>
                    <button type="button" role="menuitem" data-org-action="add-profession" data-org-action-node="${escapeHtml(node.id)}">Професію у вузлі</button>
                    <button type="button" role="menuitem" data-org-action="rename" data-org-action-node="${escapeHtml(node.id)}">Перейменувати</button>
                    <button type="button" role="menuitem" data-org-action="duplicate" data-org-action-node="${escapeHtml(node.id)}">Дублювати</button>
                    <button type="button" role="menuitem" data-org-action="move" data-org-action-node="${escapeHtml(node.id)}">Перемістити</button>
                    <button type="button" role="menuitem" data-org-action="archive" data-org-action-node="${escapeHtml(node.id)}">${node.archived ? 'Відновити' : 'Архівувати'}</button>
                </span>
            </span>` : ''}
        </div>
        ${professionList}
        ${expanded ? `<ul role="group">${children.map(child => renderCompanyOrgTreeBranch(child, level + 1, visibleIds)).join('')}</ul>` : ''}
    </li>`;
}

function companyOrgTreeSelectButtons() {
    return Array.from(document.querySelectorAll('#companyOrgTree [data-org-tree-select]'));
}

function focusCompanyOrgTreeButton(button) {
    if (!button) return false;
    button.focus?.({ preventScroll: true });
    button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return true;
}

function focusCompanyOrgTreeNode(nodeId) {
    if (!nodeId) return false;
    return focusCompanyOrgTreeButton(document.querySelector(`[data-org-tree-select="${nodeId}"]`));
}

function focusCompanyOrgTreeItemByOffset(current, offset) {
    const buttons = companyOrgTreeSelectButtons();
    const index = buttons.indexOf(current);
    if (index === -1) return false;
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, index + offset))];
    return focusCompanyOrgTreeButton(next);
}

function focusCompanyOrgTreeBoundary(last = false) {
    const buttons = companyOrgTreeSelectButtons();
    return focusCompanyOrgTreeButton(last ? buttons.at(-1) : buttons[0]);
}

function handleCompanyOrgTreeKeydown(event) {
    const button = event.currentTarget;
    const node = companyStructureNodeById(button.dataset.orgTreeSelect);
    if (!node) return;
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectCompanyOrgNodeById(node.id, { openInspector: true });
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusCompanyOrgTreeItemByOffset(button, 1);
        return;
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusCompanyOrgTreeItemByOffset(button, -1);
        return;
    }
    if (event.key === 'Home') {
        event.preventDefault();
        focusCompanyOrgTreeBoundary(false);
        return;
    }
    if (event.key === 'End') {
        event.preventDefault();
        focusCompanyOrgTreeBoundary(true);
        return;
    }
    if (event.key === 'ArrowRight') {
        const visibleIds = companyOrgTreeVisibleIds();
        const children = companyStructureChildrenOf(node.id).filter(child => visibleIds.has(child.id));
        if (!children.length) return;
        event.preventDefault();
        if (companyOrgNodeIsTreeCollapsed(node) && !companyOrgSearchQuery) {
            setCompanyStructureNodeCollapsed(node.id, false);
            document.querySelector(`[data-org-tree-select="${node.id}"]`)?.focus?.({ preventScroll: true });
        } else {
            const child = children.find(item => visibleIds.has(item.id));
            document.querySelector(`[data-org-tree-select="${child?.id || ''}"]`)?.focus?.({ preventScroll: true });
        }
        return;
    }
    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const visibleIds = companyOrgTreeVisibleIds();
        const children = companyStructureChildrenOf(node.id).filter(child => visibleIds.has(child.id));
        if (children.length && !companyOrgNodeIsTreeCollapsed(node) && !companyOrgSearchQuery) {
            setCompanyStructureNodeCollapsed(node.id, true);
            document.querySelector(`[data-org-tree-select="${node.id}"]`)?.focus?.({ preventScroll: true });
            return;
        }
        if (node.parentId) document.querySelector(`[data-org-tree-select="${node.parentId}"]`)?.focus?.({ preventScroll: true });
    }
}

function firstCompanyOrgSearchMatch() {
    const query = normalizeSearchText(companyOrgSearchQuery);
    return sortCompanyStructureNodes(companyStructureNodes)
        .filter(node => companyOrgNodeMatchesArchiveFilter(node))
        .find(node => !query || companyOrgNodeMatchesSearch(node, query)) || null;
}

function reconcileCompanyOrgSearchSelection() {
    const query = normalizeSearchText(companyOrgSearchQuery);
    const visibleIds = companyOrgTreeVisibleIds();
    const selected = companyStructureNodeById(selectedCompanyStructureNodeId);
    if (selected
        && visibleIds.has(selected.id)
        && companyOrgNodeMatchesArchiveFilter(selected)
        && (!query || companyOrgNodeMatchesSearch(selected, query))) return;
    const match = firstCompanyOrgSearchMatch();
    if (match) {
        selectedCompanyStructureNodeId = match.id;
        return;
    }
    const fallback = sortCompanyStructureNodes(companyStructureNodes).find(node => visibleIds.has(node.id));
    selectedCompanyStructureNodeId = fallback?.id || null;
}

function renderCompanyOrgTree() {
    const root = document.getElementById('companyOrgTree');
    if (!root) return;
    const activeElement = document.activeElement;
    const focusedTreeId = root.contains(activeElement)
        ? (activeElement?.dataset?.orgTreeSelect || activeElement?.dataset?.orgTreeToggle || activeElement?.dataset?.orgTreeMore || activeElement?.dataset?.orgTreeAdd || null)
        : null;
    if (companyStructureLoadState === 'loading' || companyStructureLoadState === 'idle') {
        root.innerHTML = '<div class="hr-org-loading">Завантаження дерева…</div>';
        return;
    }
    if (companyStructureLoadState === 'error' || companyStructureLoadState === 'restricted') {
        root.innerHTML = '<div class="hr-org-loading">Дерево недоступне, доки структуру не завантажено.</div>';
        return;
    }
    if (!companyStructureNodes.length) {
        root.innerHTML = '<div class="hr-org-loading">Структура порожня</div>';
        return;
    }
    reconcileCompanyOrgSearchSelection();
    const visibleIds = companyOrgTreeVisibleIds();
    const roots = sortCompanyStructureNodes(companyStructureNodes.filter(node => !node.parentId || !companyStructureNodeById(node.parentId))).filter(node => visibleIds.has(node.id));
    if (!roots.length) {
        root.innerHTML = `<div class="hr-org-loading">${escapeHtml(companyOrgVisibleEmptyMessage())}</div>`;
        return;
    }
    root.innerHTML = `<ul class="hr-org-tree-list" role="none">${roots.map(node => renderCompanyOrgTreeBranch(node, 1, visibleIds)).join('')}</ul>`;
    root.querySelectorAll('[data-org-tree-select]').forEach(button => {
        button.addEventListener('click', () => selectCompanyOrgNodeById(button.dataset.orgTreeSelect, { openInspector: true }));
        button.addEventListener('keydown', handleCompanyOrgTreeKeydown);
    });
    root.querySelectorAll('[data-org-tree-toggle]').forEach(button => {
        button.addEventListener('click', () => {
            const node = companyStructureNodeById(button.dataset.orgTreeToggle);
            if (node) setCompanyStructureNodeCollapsed(node.id, !companyOrgNodeIsTreeCollapsed(node));
        });
    });
    root.querySelectorAll('[data-org-tree-profession-key]').forEach(button => {
        button.addEventListener('click', () => {
            const nodeId = button.dataset.orgTreeProfessionNode;
            if (nodeId) selectCompanyOrgNodeById(nodeId, { openInspector: true });
            openProfessionWorkspace({
                key: button.dataset.orgTreeProfessionKey,
                initialTab: 'main',
                returnContext: captureProfessionReturnContext({ tab: 'structure', nodeId })
            });
        });
    });
    root.querySelectorAll('[data-org-tree-add]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            handleCompanyOrgNodeAction('add-child', button.dataset.orgTreeAdd);
        });
    });
    root.querySelectorAll('[data-org-tree-more]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            selectCompanyOrgNodeById(button.dataset.orgTreeMore);
            toggleCompanyOrgNodeMenu(button, button.closest('.hr-org-node-quick-actions')?.querySelector('[data-org-tree-more-menu]'));
        });
    });
    root.querySelectorAll('[data-org-action]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            handleCompanyOrgNodeAction(button.dataset.orgAction, button.dataset.orgActionNode);
        });
    });
    root.onclick = event => {
        if (!event.target.closest?.('.hr-org-node-menu, [data-org-tree-add], [data-org-tree-more]')) closeCompanyOrgNodeMenus();
    };
    if (focusedTreeId) focusCompanyOrgTreeNode(focusedTreeId);
}

function applyCompanyOrgZoom() {
    companyOrgZoom = Math.max(.45, Math.min(1.6, Math.round(companyOrgZoom * 20) / 20));
    const stage = document.getElementById('companyOrgChart');
    if (stage) stage.style.zoom = String(companyOrgZoom);
    const output = document.getElementById('hrOrgZoomValue');
    if (output) output.textContent = `${Math.round(companyOrgZoom * 100)}%`;
}

function setCompanyOrgViewMode(mode, options = {}) {
    companyOrgViewMode = mode === 'tree' ? 'tree' : 'chart';
    const canvas = document.getElementById('companyOrgCanvas') || document.getElementById('companyOrgChart')?.closest('.hr-org-canvas');
    const tree = document.getElementById('companyOrgTree');
    const chartButton = document.getElementById('hrOrgViewChart');
    const treeButton = document.getElementById('hrOrgViewTree');
    const fitButton = document.getElementById('hrOrgFitBtn');
    const zoomOut = document.getElementById('hrOrgZoomOut');
    const zoomIn = document.getElementById('hrOrgZoomIn');
    const zoomValue = document.getElementById('hrOrgZoomValue');
    const treeMode = companyOrgViewMode === 'tree';
    canvas?.classList.toggle('hidden', companyOrgViewMode !== 'chart');
    tree?.classList.toggle('hidden', !treeMode);
    chartButton?.classList.toggle('is-active', companyOrgViewMode === 'chart');
    treeButton?.classList.toggle('is-active', treeMode);
    chartButton?.setAttribute('aria-pressed', companyOrgViewMode === 'chart' ? 'true' : 'false');
    treeButton?.setAttribute('aria-pressed', treeMode ? 'true' : 'false');
    [zoomOut, zoomIn, zoomValue].forEach(element => {
        if (element) element.hidden = treeMode;
    });
    if (fitButton) {
        fitButton.textContent = treeMode ? 'До вибраного' : 'Вмістити';
        fitButton.setAttribute('aria-label', treeMode ? 'Прокрутити дерево до вибраного вузла' : 'Вмістити структуру на екрані');
    }
    if (options.focus !== false) (companyOrgViewMode === 'tree' ? treeButton : chartButton)?.focus();
}

function fitCompanyOrgToScreen() {
    if (companyOrgViewMode === 'tree') {
        const selected = document.querySelector(`[data-org-tree-select="${selectedCompanyStructureNodeId || ''}"]`);
        selected?.scrollIntoView?.({ block: 'center' });
        return true;
    }
    const canvas = document.getElementById('companyOrgCanvas') || document.getElementById('companyOrgChart')?.closest('.hr-org-canvas');
    if (!canvas || !companyStructureNodes.length) return false;
    const size = companyOrgStageSize();
    companyOrgZoom = Math.max(.45, Math.min(1, Math.min((canvas.clientWidth - 24) / size.width, (canvas.clientHeight - 24) / size.height)));
    applyCompanyOrgZoom();
    canvas.scrollLeft = 0;
    canvas.scrollTop = 0;
    return true;
}

function renderCompanyOrgWorkspace() {
    bindCompanyOrgResponsiveState();
    renderCompanyOrgChart();
    renderCompanyOrgTree();
    applyCompanyOrgZoom();
    setCompanyOrgViewMode(companyOrgViewMode, { focus: false });
    if (!window.matchMedia?.('(max-width: 820px)').matches) setCompanyOrgInspectorOpen(true);
    else if (!document.getElementById('hrOrgInspector')?.classList.contains('is-mobile-open')) setCompanyOrgInspectorOpen(false);
    updateCompanyOrgHistoryControls();
}

function focusCompanyOrgCanvasOnNode(nodeId) {
    const stage = document.getElementById('companyOrgChart');
    const canvas = stage?.closest?.('.hr-org-canvas');
    const node = companyStructureNodeById(nodeId);
    if (!canvas || !node) return;
    const size = companyOrgNodeSize(node);
    const zoom = Number(companyOrgZoom) || 1;
    const nextLeft = Math.max(0, (Number(node.x || 0) + size.width / 2) * zoom - canvas.clientWidth / 2);
    const nextTop = Math.max(0, Number(node.y || 0) * zoom - 36);
    canvas.scrollLeft = nextLeft;
    canvas.scrollTop = nextTop;
}

function startCompanyOrgDrag(event, nodeId) {
    if (!companyStructureCanMutate() || !nodeId || event.button !== 0 || event.target.closest('[data-org-edit], [data-org-link-child-port], [data-org-link-parent-port], .hr-org-node-quick-actions')) return;
    if (companyOrgLinkingNodeId) {
        setCompanyOrgLinkMode(null);
    }
    const node = companyStructureNodeById(nodeId);
    const shell = event.currentTarget.closest('[data-org-node-shell]');
    if (!node || !shell) return;
    selectCompanyOrgNodeById(nodeId);
    event.preventDefault();
    companyOrgDragState = {
        nodeId,
        startPointerX: event.clientX,
        startPointerY: event.clientY,
        startX: Number(node.x || 0),
        startY: Number(node.y || 0),
        moved: false,
        shell,
        targetParentId: null,
        invalidTargetId: null,
        snapshot: companyStructureHistorySnapshot()
    };
    shell.classList.add('is-dragging');
    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', moveCompanyOrgDrag);
    window.addEventListener('pointerup', endCompanyOrgDrag, { once: true });
    window.addEventListener('pointercancel', cancelCompanyOrgDrag, { once: true });
}

function moveCompanyOrgDrag(event) {
    if (!companyOrgDragState) return;
    const node = companyStructureNodeById(companyOrgDragState.nodeId);
    if (!node) return;
    const dx = (event.clientX - companyOrgDragState.startPointerX) / companyOrgZoom;
    const dy = (event.clientY - companyOrgDragState.startPointerY) / companyOrgZoom;
    const nextX = snapCompanyOrgCoord(companyOrgDragState.startX + dx, 5000) ?? 0;
    const nextY = snapCompanyOrgCoord(companyOrgDragState.startY + dy, 5000) ?? 0;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) companyOrgDragState.moved = true;
    node.x = nextX;
    node.y = nextY;
    companyOrgDragState.shell.style.left = `${nextX}px`;
    companyOrgDragState.shell.style.top = `${nextY}px`;
    document.querySelectorAll('[data-org-node-shell].is-drop-target, [data-org-node-shell].is-drop-invalid').forEach(shell => shell.classList.remove('is-drop-target', 'is-drop-invalid'));
    const previousPointerEvents = companyOrgDragState.shell.style.pointerEvents;
    companyOrgDragState.shell.style.pointerEvents = 'none';
    const hit = document.elementFromPoint?.(event.clientX, event.clientY)?.closest?.('[data-org-node-shell]');
    companyOrgDragState.shell.style.pointerEvents = previousPointerEvents;
    const targetId = hit?.dataset.orgNodeShell || null;
    const target = targetId ? companyStructureNodeById(targetId) : null;
    const invalid = Boolean(target && (target.id === node.id || companyOrgWouldCreateCycle(node.id, target.id)));
    companyOrgDragState.targetParentId = target && !invalid ? target.id : null;
    companyOrgDragState.invalidTargetId = target && invalid ? target.id : null;
    hit?.classList.toggle('is-drop-target', Boolean(target && !invalid));
    hit?.classList.toggle('is-drop-invalid', invalid);
    let preview = document.querySelector('.hr-org-drop-preview');
    if (target) {
        if (!preview) {
            preview = document.createElement('div');
            preview.className = 'hr-org-drop-preview';
            document.getElementById('companyOrgChart')?.prepend(preview);
        }
        preview.textContent = invalid ? 'Це підпорядкування створить цикл або parent=self' : `Після drop: ${node.title} → керівник ${target.title}`;
    } else {
        preview?.remove();
    }
    renderCompanyOrgLinks();
}

function endCompanyOrgDrag() {
    if (!companyOrgDragState) return;
    const state = companyOrgDragState;
    const moved = state.moved;
    state.shell?.classList.remove('is-dragging');
    companyOrgDragState = null;
    window.removeEventListener('pointermove', moveCompanyOrgDrag);
    window.removeEventListener('pointercancel', cancelCompanyOrgDrag);
    document.querySelectorAll('[data-org-node-shell].is-drop-target, [data-org-node-shell].is-drop-invalid').forEach(shell => shell.classList.remove('is-drop-target', 'is-drop-invalid'));
    document.querySelector('.hr-org-drop-preview')?.remove();
    const node = companyStructureNodeById(state.nodeId);
    if (state.invalidTargetId && node) {
        node.x = state.startX;
        node.y = state.startY;
        renderCompanyOrgWorkspace();
        selectCompanyOrgNodeById(node.id);
        showNotification('Перепідпорядкування скасовано: цикл і parent=self заборонені.', 'warning');
        return;
    }
    if (moved) {
        companyOrgSuppressNextClick = true;
        window.setTimeout(() => {
            companyOrgSuppressNextClick = false;
        }, 0);
        pushCompanyOrgHistory(state.snapshot);
        if (node && state.targetParentId && node.parentId !== state.targetParentId) node.parentId = state.targetParentId;
        companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes);
        syncCompanyStructureText();
        renderCompanyOrgWorkspace();
        if (node) selectCompanyOrgNodeById(node.id);
        markCompanyStructureChanged();
        if (node && state.targetParentId) {
            showNotification(`${node.title} перепідпорядковано через drag-and-drop. Збережіть структуру.`, 'info');
        }
    }
}

function cancelCompanyOrgDrag() {
    if (!companyOrgDragState) return;
    const state = companyOrgDragState;
    const node = companyStructureNodeById(state.nodeId);
    if (node) {
        node.x = state.startX;
        node.y = state.startY;
    }
    state.shell?.classList.remove('is-dragging');
    companyOrgDragState = null;
    window.removeEventListener('pointermove', moveCompanyOrgDrag);
    window.removeEventListener('pointercancel', cancelCompanyOrgDrag);
    document.querySelectorAll('[data-org-node-shell].is-drop-target, [data-org-node-shell].is-drop-invalid').forEach(shell => shell.classList.remove('is-drop-target', 'is-drop-invalid'));
    document.querySelector('.hr-org-drop-preview')?.remove();
    renderCompanyOrgWorkspace();
}

function companyOrgWouldCreateCycle(childId, parentId) {
    if (!childId || !parentId) return false;
    let cursor = parentId;
    const guard = new Set();
    while (cursor && !guard.has(cursor)) {
        if (cursor === childId) return true;
        guard.add(cursor);
        cursor = companyStructureNodeById(cursor)?.parentId;
    }
    return false;
}

function updateCompanyOrgLinkPointer(event) {
    if (!companyOrgLinkingNodeId) return;
    const stage = document.getElementById('companyOrgChart');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    companyOrgLinkPointer = {
        x: Math.max(0, event.clientX - rect.left),
        y: Math.max(0, event.clientY - rect.top)
    };
    renderCompanyOrgLinks();
}

function startCompanyOrgPortLink(endpoint, nodeId) {
    if (!companyStructureCanMutate()) return;
    const node = companyStructureNodeById(nodeId);
    if (!node) return;
    selectedCompanyStructureNodeId = node.id;
    setCompanyOrgLinkMode(node.id, endpoint);
    selectCompanyOrgNodeById(node.id);
    if (typeof showNotification === 'function') {
        const next = endpoint === 'parent'
            ? 'натисніть верхній кружок ролі, яка буде підпорядкована'
            : 'натисніть нижній кружок ролі-керівника';
        showNotification(`Лінія почалась від "${node.title}": ${next}. Esc — скасувати.`, 'info');
    }
}

function completeCompanyOrgLinkPair(childId, parentId) {
    if (!companyStructureCanMutate()) return;
    const child = companyStructureNodeById(childId);
    const parent = companyStructureNodeById(parentId);
    if (!child || !parent) return cancelCompanyOrgLinkMode();
    if (child.id === parent.id) {
        showNotification('Роль не може бути підпорядкована сама собі', 'warning');
        return;
    }
    if (companyOrgWouldCreateCycle(child.id, parent.id)) {
        showNotification('Таке зʼєднання створить цикл у структурі', 'warning');
        return;
    }
    pushCompanyOrgHistory();
    child.parentId = parent.id;
    setCompanyOrgLinkMode(null);
    companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes);
    syncCompanyStructureText();
    renderCompanyOrgWorkspace();
    selectCompanyOrgNodeById(child.id);
    markCompanyStructureChanged();
    showNotification(`Лінію змінено: ${parent.title} → ${child.title}. Збережіть структуру.`, 'info');
}

function handleCompanyOrgPortClick(endpoint, nodeId, event = null) {
    if (!companyStructureCanMutate()) return;
    if (event) updateCompanyOrgLinkPointer(event);
    if (!companyOrgLinkingNodeId) {
        startCompanyOrgPortLink(endpoint, nodeId);
        return;
    }
    if (companyOrgLinkingNodeId === nodeId && companyOrgLinkingEndpoint === endpoint) {
        cancelCompanyOrgLinkMode();
        return;
    }
    if (companyOrgLinkingEndpoint === endpoint) {
        startCompanyOrgPortLink(endpoint, nodeId);
        return;
    }
    const childId = endpoint === 'child' ? nodeId : companyOrgLinkingNodeId;
    const parentId = endpoint === 'parent' ? nodeId : companyOrgLinkingNodeId;
    completeCompanyOrgLinkPair(childId, parentId);
}

function startCompanyOrgLinkMode(nodeId = selectedCompanyStructureNodeId) {
    startCompanyOrgPortLink('child', nodeId);
}

function cancelCompanyOrgLinkMode(options = {}) {
    if (!companyOrgLinkingNodeId) return;
    const selectedId = selectedCompanyStructureNodeId;
    setCompanyOrgLinkMode(null);
    if (options.render !== false) {
        renderCompanyOrgWorkspace();
        selectCompanyOrgNodeById(selectedId);
    }
}

function completeCompanyOrgLink(parentId) {
    const childId = companyOrgLinkingNodeId;
    if (!childId) return;
    if (companyOrgLinkingEndpoint === 'parent') {
        return completeCompanyOrgLinkPair(parentId, companyOrgLinkingNodeId);
    }
    completeCompanyOrgLinkPair(childId, parentId);
}

function clearSelectedCompanyOrgParent() {
    if (!companyStructureCanMutate()) return;
    const node = companyStructureNodeById(selectedCompanyStructureNodeId);
    if (!node || !node.parentId) return;
    pushCompanyOrgHistory();
    node.parentId = null;
    setCompanyOrgLinkMode(null);
    syncCompanyStructureText();
    renderCompanyOrgWorkspace();
    selectCompanyOrgNodeById(node.id);
    markCompanyStructureChanged();
    showNotification('Лінію прибрано у draft. Збережіть структуру.', 'info');
}

function companyOrgNodeRect(node) {
    const size = companyOrgNodeSize(node);
    return {
        x: Number(node.x || 0),
        y: Number(node.y || 0),
        width: size.width,
        height: size.height
    };
}

function companyOrgRectsOverlap(a, b) {
    return a.x < b.x + b.width + ORG_COLLISION_PADDING_X
        && a.x + a.width + ORG_COLLISION_PADDING_X > b.x
        && a.y < b.y + b.height + ORG_COLLISION_PADDING_Y
        && a.y + a.height + ORG_COLLISION_PADDING_Y > b.y;
}

function resolveCompanyOrgNodeOverlaps(nodes) {
    const sorted = sortCompanyStructureNodes(nodes).map(node => ({ ...node }));
    const placed = [];
    sorted.forEach(node => {
        let guard = 0;
        let rect = companyOrgNodeRect(node);
        while (placed.some(item => companyOrgRectsOverlap(rect, item.rect)) && guard < sorted.length * 3) {
            const offender = placed.find(item => companyOrgRectsOverlap(rect, item.rect));
            if (!offender) break;
            const sameBand = Math.abs(rect.y - offender.rect.y) < Math.max(rect.height, offender.rect.height) + ORG_COLLISION_PADDING_Y;
            if (sameBand) {
                node.x = snapCompanyOrgCoord(offender.rect.x + offender.rect.width + ORG_COLLISION_PADDING_X, 5000) ?? node.x;
            } else {
                node.y = snapCompanyOrgCoord(offender.rect.y + offender.rect.height + ORG_COLLISION_PADDING_Y, 5000) ?? node.y;
            }
            rect = companyOrgNodeRect(node);
            guard += 1;
        }
        placed.push({ node, rect });
    });
    return sortCompanyStructureNodes(sorted);
}

function autoArrangeFlatCompanyOrgNodes(nodes) {
    const sorted = sortCompanyStructureNodes(nodes);
    const columns = Math.max(2, Math.min(6, Math.ceil(Math.sqrt(sorted.length * 1.35))));
    return resolveCompanyOrgNodeOverlaps(sorted.map((node, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
            ...node,
            x: snapCompanyOrgCoord(ORG_CANVAS_PADDING + column * 260),
            y: snapCompanyOrgCoord(ORG_CANVAS_PADDING + row * 180)
        };
    }));
}

function primaryCompanyOrgRoot(nodes, byId = new Map((nodes || []).map(node => [node.id, node]))) {
    const sorted = sortCompanyOrgAutoLayoutNodes(nodes || []);
    return byId.get('director')
        || sorted.find(node => node.lane === 'root')
        || sorted.find(node => node.tone === 'gold')
        || sorted[0]
        || null;
}

function autoArrangeTreeCompanyOrgNodes(nodes) {
    const normalized = normalizeCompanyStructureNodes(nodes).map(node => ({ ...node }));
    const byId = new Map(normalized.map(node => [node.id, node]));
    const children = new Map();
    normalized.forEach(node => children.set(node.id, []));
    normalized.forEach(node => {
        if (node.parentId && byId.has(node.parentId)) {
            children.get(node.parentId)?.push(node);
        }
    });
    children.forEach(list => list.sort(compareCompanyOrgAutoLayoutNodes));
    const primaryRoot = primaryCompanyOrgRoot(normalized, byId);
    const roots = sortCompanyOrgAutoLayoutNodes(normalized.filter(node => !node.parentId || !byId.has(node.parentId)));
    if (primaryRoot) {
        roots.sort((a, b) => (a.id === primaryRoot.id ? -1 : 0) + (b.id === primaryRoot.id ? 1 : 0));
    }
    const hasAnyLink = normalized.some(node => node.parentId && byId.has(node.parentId));
    if (!hasAnyLink) return autoArrangeFlatCompanyOrgNodes(normalized);

    const next = normalized.map(node => ({ ...node }));
    const nextById = new Map(next.map(node => [node.id, node]));
    const depthById = new Map();
    const depthGroups = new Map();
    const addToDepth = (node, depth) => {
        if (!node || depthById.has(node.id)) return;
        depthById.set(node.id, depth);
        if (!depthGroups.has(depth)) depthGroups.set(depth, []);
        depthGroups.get(depth).push(node);
        (children.get(node.id) || []).forEach(child => addToDepth(child, depth + 1));
    };
    roots.forEach(root => addToDepth(root, 0));
    sortCompanyOrgAutoLayoutNodes(normalized).forEach(node => {
        if (!depthById.has(node.id)) addToDepth(node, 0);
    });

    let visualRow = 0;
    [...depthGroups.keys()].sort((a, b) => a - b).forEach(depth => {
        const levelNodes = [...(depthGroups.get(depth) || [])].sort((a, b) => {
            const parentA = a.parentId ? nextById.get(a.parentId) : null;
            const parentB = b.parentId ? nextById.get(b.parentId) : null;
            const parentDelta = (Number(parentA?.x) || 0) - (Number(parentB?.x) || 0);
            if (parentDelta) return parentDelta;
            return compareCompanyOrgAutoLayoutNodes(a, b);
        });
        for (let index = 0; index < levelNodes.length; index += ORG_AUTO_LAYOUT_COMPACT_COLUMNS) {
            const chunk = levelNodes.slice(index, index + ORG_AUTO_LAYOUT_COMPACT_COLUMNS);
            const rowWidth = chunk.reduce((sum, node, itemIndex) => {
                return sum + (itemIndex ? ORG_AUTO_LAYOUT_COMPACT_X_GAP : 0) + companyOrgNodeSize(node).width;
            }, 0);
            let cursor = Math.max(ORG_CANVAS_PADDING, Math.round((ORG_CANVAS_MIN_WIDTH - rowWidth) / 2));
            chunk.forEach((node, itemIndex) => {
                const target = nextById.get(node.id);
                const size = companyOrgNodeSize(node);
                if (!target) return;
                if (itemIndex) cursor += ORG_AUTO_LAYOUT_COMPACT_X_GAP;
                target.x = snapCompanyOrgCoord(cursor);
                target.y = snapCompanyOrgCoord(ORG_CANVAS_PADDING + visualRow * ORG_AUTO_LAYOUT_ROW_GAP);
                cursor += size.width;
            });
            visualRow += 1;
        }
    });
    return sortCompanyStructureNodes(next);
}

function autoArrangeCompanyOrgChart() {
    if (!companyStructureCanMutate() || !companyStructureNodes.length) return;
    pushCompanyOrgHistory();
    companyStructureNodes = autoArrangeTreeCompanyOrgNodes(companyStructureNodes);
    setCompanyOrgLinkMode(null);
    syncCompanyStructureText();
    selectedCompanyStructureNodeId = primaryCompanyOrgRoot(companyStructureNodes)?.id || selectedCompanyStructureNodeId;
    renderCompanyOrgWorkspace();
    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
    focusCompanyOrgCanvasOnNode(selectedCompanyStructureNodeId);
    markCompanyStructureChanged();
    showNotification('Розташування впорядковано у draft. Підпорядкування не змінено.', 'info');
}

function updateCompanyOrgLinkStatus() {
    const status = document.getElementById('hrOrgLinkStatus');
    if (status) {
        if (!canEditCompanyStructure()) {
            status.textContent = 'Режим лише для перегляду. Змінювати підпорядкування може користувач із hr.staff.manage.';
            status.classList.remove('is-active');
        } else if (companyStructureLoadState !== 'ready') {
            status.textContent = 'Редагування стане доступним після завантаження актуальної структури.';
            status.classList.remove('is-active');
        } else if (companyOrgLinkingNodeId) {
            const source = companyStructureNodeById(companyOrgLinkingNodeId);
            const next = companyOrgLinkingEndpoint === 'parent'
                ? 'натисніть верхній кружок ролі, яка буде підпорядкована'
                : 'натисніть нижній кружок ролі-керівника';
            status.textContent = source ? `Лінія від "${source.title}": ${next}. Esc — скасувати.` : 'Натисніть другий кружок або Esc';
            status.classList.add('is-active');
        } else {
            status.textContent = 'Перепідпорядкування доступне через drag-and-drop або поле «Батьківський вузол» в інспекторі.';
            status.classList.remove('is-active');
        }
    }
}

function bindCompanyOrgKeyboard() {
    if (companyOrgKeyboardBound) return;
    companyOrgKeyboardBound = true;
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && companyOrgLinkingNodeId) {
            cancelCompanyOrgLinkMode();
            return;
        }
        if (event.key === 'Escape' && document.getElementById('hrOrgInspector')?.classList.contains('is-mobile-open')) {
            closeCompanyOrgInspector();
        }
        if (event.key === 'Tab' && document.getElementById('hrOrgInspector')?.classList.contains('is-mobile-open')) {
            trapCompanyOrgInspectorFocus(event);
        }
    });
}

function companyOrgInspectorFocusableElements() {
    const inspector = document.getElementById('hrOrgInspector');
    if (!inspector) return [];
    return Array.from(inspector.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details summary, [tabindex]:not([tabindex="-1"])'))
        .filter(element => !element.hidden && element.offsetParent !== null);
}

function trapCompanyOrgInspectorFocus(event) {
    const focusable = companyOrgInspectorFocusableElements();
    if (!focusable.length) {
        event.preventDefault();
        document.getElementById('hrOrgDetailTitle')?.focus?.({ preventScroll: true });
        return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus?.({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus?.({ preventScroll: true });
    }
}

function setCompanyOrgBackgroundInert(inert) {
    document.querySelectorAll('#tab-structure .hr-org-tools, #tab-structure .hr-org-main, #tab-structure .hr-org-notes').forEach(element => {
        element.inert = Boolean(inert);
        element.setAttribute('aria-hidden', inert ? 'true' : 'false');
    });
}

function syncCompanyOrgInspectorViewportBounds(inspector, mobile, visible) {
    if (!inspector) return;
    if (!mobile) {
        inspector.style.removeProperty('left');
        inspector.style.removeProperty('right');
        inspector.style.removeProperty('width');
        inspector.style.removeProperty('max-width');
        return;
    }

    inspector.style.left = '0px';
    inspector.style.right = 'auto';
    inspector.style.width = '100vw';
    inspector.style.maxWidth = '100vw';

    if (!visible) return;
    const rect = inspector.getBoundingClientRect();
    if (Number.isFinite(rect.left) && Math.abs(rect.left) > 0.5) {
        inspector.style.left = `${-rect.left}px`;
    }
}

function bindCompanyOrgResponsiveState() {
    if (companyOrgResponsiveBound) return;
    companyOrgResponsiveBound = true;
    const sync = () => {
        setCompanyOrgViewMode(companyOrgViewMode, { focus: false });
        const inspector = document.getElementById('hrOrgInspector');
        if (!inspector) return;
        if (window.matchMedia?.('(max-width: 820px)').matches === true) {
            setCompanyOrgInspectorOpen(inspector.classList.contains('is-mobile-open'));
        } else {
            setCompanyOrgInspectorOpen(true);
        }
    };
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    const mobileQuery = window.matchMedia?.('(max-width: 820px)');
    mobileQuery?.addEventListener?.('change', sync);
    mobileQuery?.addListener?.(sync);
}

function ensureCompanyOrgDetailMeta() {
    let meta = document.getElementById('hrOrgDetailMeta');
    const title = document.getElementById('hrOrgDetailTitle');
    if (!meta && title) {
        meta = document.createElement('div');
        meta.id = 'hrOrgDetailMeta';
        meta.className = 'hr-org-detail-meta';
        title.insertAdjacentElement('afterend', meta);
    }
    return meta;
}

function ensureCompanyOrgDetailElement(id, className, beforeSelector = null) {
    let element = document.getElementById(id);
    if (element) return element;
    const anchor = beforeSelector ? document.querySelector(beforeSelector) : document.getElementById('hrOrgInspectorActions');
    if (!anchor) return null;
    element = document.createElement('div');
    element.id = id;
    element.className = className;
    anchor.insertAdjacentElement('beforebegin', element);
    return element;
}

function ensureCompanyOrgDetailProfessions() {
    let root = document.getElementById('hrOrgDetailProfessions');
    const editButton = document.getElementById('hrOrgEditSelectedBtn');
    if (!root && editButton) {
        root = document.createElement('div');
        root.id = 'hrOrgDetailProfessions';
        root.className = 'hr-org-detail-professions';
        editButton.insertAdjacentElement('beforebegin', root);
    }
    return root;
}

function companyOrgNodeTypeLabel(node = {}) {
    const lane = ORG_LANE_LABELS[node.lane] || node.lane || 'Роль';
    const tone = ORG_TONE_LABELS[node.tone] || node.tone || '';
    return [lane, tone].filter(Boolean).join(' · ');
}

function renderCompanyOrgStaffPreview(node) {
    const root = ensureCompanyOrgDetailElement('hrOrgDetailStaff', 'hr-org-detail-staff');
    if (!root) return;
    const linkedStaff = node ? companyOrgLinkedStaff(node.id) : [];
    if (!node) {
        root.innerHTML = '';
        return;
    }
    const staffList = linkedStaff.slice(0, 6).map(person => {
        const id = Number(person.id);
        const canOpen = Number.isFinite(id) && typeof openStaffEdit === 'function';
        const subtitle = [person.role_type, person.phone].filter(Boolean).join(' · ');
        const content = `<span>${escapeHtml(person.name || `#${id}`)}</span>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}`;
        return `<li>${canOpen
            ? `<button type="button" data-org-staff-id="${id}">${content}</button>`
            : `<span>${content}</span>`}</li>`;
    }).join('');
    const overflow = linkedStaff.length > 6 ? `<div class="hr-org-detail-note">+${linkedStaff.length - 6} ще у цьому вузлі</div>` : '';
    root.innerHTML = `
        <div class="hr-org-detail-section-title">Співробітники</div>
        <div class="hr-org-detail-count">${linkedStaff.length} у цьому вузлі</div>
        ${linkedStaff.length ? `<ul>${staffList}</ul>${overflow}` : '<div class="hr-org-detail-note">Співробітників напряму не привʼязано. Перевірте професії або команду HR.</div>'}
    `;
    root.querySelectorAll('[data-org-staff-id]').forEach(button => {
        button.addEventListener('click', () => openStaffEdit(Number(button.dataset.orgStaffId)));
    });
}

function updateCompanyOrgDetail(node) {
    const title = document.getElementById('hrOrgDetailTitle');
    const type = document.getElementById('hrOrgDetailType');
    const text = document.getElementById('hrOrgDetailText');
    const meta = ensureCompanyOrgDetailMeta();
    const parentRoot = ensureCompanyOrgDetailElement('hrOrgDetailParent', 'hr-org-detail-section', '.hr-org-inspector-field');
    const professionsRoot = ensureCompanyOrgDetailProfessions();
    const editButton = document.getElementById('hrOrgEditSelectedBtn');
    if (title) title.textContent = node?.title || 'Нічого не вибрано';
    if (type) type.textContent = node ? `${companyOrgNodeTypeLabel(node)}${node.archived ? ' · Архівний' : ''}` : 'Виберіть вузол';
    if (text) text.textContent = node?.description || 'Після завантаження виберіть вузол структури.';
    if (parentRoot) {
        const parent = node?.parentId ? companyStructureNodeById(node.parentId) : null;
        parentRoot.innerHTML = node ? `
            <div class="hr-org-detail-section-title">Батьківський підрозділ</div>
            <div class="hr-org-detail-parent-name">${escapeHtml(parent?.title || 'Кореневий рівень')}</div>
        ` : '';
    }
    if (meta) {
        const parent = node?.parentId ? companyStructureNodeById(node.parentId) : null;
        const childCount = node ? companyStructureChildrenOf(node.id).length : 0;
        const professionCount = node ? companyOrgLinkedProfessions(node.id).length : 0;
        const staffCount = node ? companyOrgLinkedStaffIds(node.id).length : 0;
        const displayGroup = node ? companyStructureNodeDisplayGroup(node) : '';
        const displayGroupLabel = displayGroup ? companyStructureDisplayGroupLabel(displayGroup) : '';
        meta.innerHTML = node ? `
            <div><dt>ID</dt><dd>${escapeHtml(node.id)}</dd></div>
            <div><dt>Parent</dt><dd>${escapeHtml(parent?.id || 'root')}</dd></div>
            <div><dt>Display group</dt><dd>${escapeHtml(displayGroupLabel ? `${displayGroupLabel} (${displayGroup})` : 'Не задано')}</dd></div>
            <div><dt>Порядок</dt><dd>${Number(node.order) || 0}</dd></div>
            <div><dt>Тип</dt><dd>${escapeHtml(companyOrgNodeTypeLabel(node))}</dd></div>
            <div><dt>Авто-layout</dt><dd>X ${Math.round(Number(node.x || 0))}, Y ${Math.round(Number(node.y || 0))} · ${childCount} доч. · ${professionCount} проф. · ${staffCount} люд.</dd></div>
            <div><dt>Стан</dt><dd>${node.archived ? 'Архівний' : 'Активний'}</dd></div>
        ` : '';
    }
    const parentSelect = document.getElementById('hrOrgInspectorParent');
    if (parentSelect) {
        const options = node ? [
            '<option value="">Без батьківського вузла</option>',
            ...visibleCompanyStructureSubdivisionNodes(companyStructureNodes)
                .filter(item => item.id !== node.id && !companyOrgWouldCreateCycle(node.id, item.id))
                .map(item => `<option value="${escapeHtml(item.id)}"${item.id === node.parentId ? ' selected' : ''}>${escapeHtml(item.title)}</option>`)
        ] : ['<option value="">Нічого не вибрано</option>'];
        parentSelect.innerHTML = options.join('');
        parentSelect.disabled = !node || !companyStructureCanMutate();
        parentSelect.onchange = () => node && reparentCompanyStructureNode(node.id, parentSelect.value || null);
    }
    if (editButton) {
        editButton.classList.toggle('hidden', !canEditCompanyStructure());
        editButton.disabled = !node || !companyStructureCanMutate();
        editButton.onclick = () => node && companyStructureCanMutate() && openCompanyOrgNodeEditor(node.id);
    }
    if (professionsRoot) {
        const linked = node ? companyOrgLinkedProfessions(node.id) : [];
        professionsRoot.innerHTML = linked.length ? `
            <div class="hr-org-detail-section-title">Професії</div>
            <div>${linked.map(item => `<button type="button" data-org-profession-key="${escapeHtml(item.key)}">${escapeHtml(item.title || item.key)}${item.is_active === false || item.isActive === false ? ' · архів' : ''}</button>`).join('')}</div>
        ` : (node ? '<div class="hr-org-detail-section-title">Професії</div><span>До вузла ще не привʼязано професій.</span><button type="button" class="btn-secondary" data-org-empty-add-profession>Додати професію</button>' : '');
        professionsRoot.querySelectorAll('[data-org-profession-key]').forEach(button => {
            button.addEventListener('click', () => openProfessionWorkspace({
                key: button.dataset.orgProfessionKey,
                initialTab: 'main',
                returnContext: captureProfessionReturnContext({ tab: 'structure', nodeId: node.id })
            }));
        });
        professionsRoot.querySelector('[data-org-empty-add-profession]')?.addEventListener('click', () => openProfessionWorkspaceForStructureNode(node.id));
    }
    renderCompanyOrgStaffPreview(node);
    const mutable = Boolean(node && companyStructureCanMutate());
    const actionRoot = document.getElementById('hrOrgInspectorActions');
    if (actionRoot) actionRoot.classList.toggle('hidden', !canEditCompanyStructure());
    const bindAction = (id, handler) => {
        const button = document.getElementById(id);
        if (!button) return;
        button.disabled = !mutable;
        button.onclick = () => mutable && handler();
    };
    bindAction('hrOrgAddChildBtn', () => promptAddCompanyStructureNode('child', node.id));
    bindAction('hrOrgAddSiblingBtn', () => promptAddCompanyStructureNode('sibling', node.id));
    bindAction('hrOrgAddProfessionBtn', () => openProfessionWorkspaceForStructureNode(node.id));
    bindAction('hrOrgDuplicateBtn', () => duplicateCompanyStructureNode(node.id));
    bindAction('hrOrgArchiveBtn', () => requestArchiveCompanyStructureNode(node.id));
    bindAction('hrOrgAutoLayoutBtn', autoArrangeCompanyOrgChart);
    const archiveButton = document.getElementById('hrOrgArchiveBtn');
    if (archiveButton) archiveButton.textContent = node?.archived ? 'Відновити' : 'Архівувати';
    updateCompanyOrgLinkStatus();
}

function setCompanyOrgInspectorOpen(open) {
    const inspector = document.getElementById('hrOrgInspector');
    if (!inspector) return;
    const mobile = window.matchMedia?.('(max-width: 820px)').matches === true;
    const wasOpen = inspector.classList.contains('is-mobile-open');
    const visible = !mobile || open === true;
    if (mobile && visible && !wasOpen && !inspector.contains(document.activeElement)) {
        companyOrgInspectorReturnFocus = typeof HTMLElement === 'function' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    inspector.classList.toggle('is-mobile-open', mobile && visible);
    inspector.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (mobile) {
        inspector.setAttribute('role', 'dialog');
        inspector.setAttribute('aria-modal', visible ? 'true' : 'false');
    } else {
        inspector.removeAttribute('role');
        inspector.removeAttribute('aria-modal');
    }
    inspector.inert = !visible;
    setCompanyOrgBackgroundInert(mobile && visible);
    document.body.classList.toggle('hr-org-inspector-lock', mobile && visible);
    syncCompanyOrgInspectorViewportBounds(inspector, mobile, visible);
    if (mobile && visible && !wasOpen) document.getElementById('hrOrgDetailTitle')?.focus?.({ preventScroll: true });
}

function closeCompanyOrgInspector() {
    setCompanyOrgInspectorOpen(false);
    const fallback = companyOrgViewMode === 'tree'
        ? document.querySelector(`[data-org-tree-select="${selectedCompanyStructureNodeId || ''}"]`)
        : document.querySelector(`[data-org-node-id="${selectedCompanyStructureNodeId || ''}"]`);
    const target = companyOrgInspectorReturnFocus?.isConnected ? companyOrgInspectorReturnFocus : fallback;
    companyOrgInspectorReturnFocus = null;
    target?.focus?.({ preventScroll: true });
}

function selectCompanyOrgNodeById(id, options = {}) {
    const node = companyStructureNodeById(id) || companyStructureNodes[0] || null;
    if (!node) {
        selectedCompanyStructureNodeId = null;
        updateCompanyOrgDetail(null);
        return;
    }
    selectedCompanyStructureNodeId = node.id;
    document.querySelectorAll('.hr-org-node.is-active').forEach(item => item.classList.remove('is-active'));
    document.querySelectorAll('[data-org-node-id]').forEach(item => {
        if (item.dataset.orgNodeId === node.id) item.classList.add('is-active');
    });
    document.querySelectorAll('[data-org-tree-select]').forEach(item => {
        const selected = item.dataset.orgTreeSelect === node.id;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-selected', selected ? 'true' : 'false');
        item.tabIndex = selected ? 0 : -1;
    });
    updateCompanyOrgDetail(node);
    renderCompanyOrgLinks();
    if (options.openInspector) setCompanyOrgInspectorOpen(true);
}

function selectCompanyOrgNode(node) {
    const id = typeof node === 'string' ? node : node?.dataset?.orgNodeId;
    selectCompanyOrgNodeById(id);
}

function closeCompanyOrgNodeEditor() {
    document.getElementById('hrOrgNodeEditorOverlay')?.remove();
}

async function requestCloseCompanyOrgNodeEditor(reason = 'button') {
    const overlay = document.getElementById('hrOrgNodeEditorOverlay');
    if (!overlay) return true;
    const closeNow = () => closeCompanyOrgNodeEditor();
    if (window.UnsafeDismissGuard) {
        return window.UnsafeDismissGuard.attemptCloseEditableSurface(overlay, closeNow, {
            reason,
            message: 'Є незбережені зміни у ролі. Закрити без збереження?',
            okText: 'Закрити без збереження',
            cancelText: 'Повернутись',
        });
    }
    closeNow();
    return true;
}

function nudgeCompanyOrgNodeEditor(overlay) {
    const dialog = overlay?.querySelector('.hr-org-node-modal');
    if (!dialog) return;
    dialog.classList.remove('is-dismiss-attention');
    void dialog.offsetWidth;
    dialog.classList.add('is-dismiss-attention');
    window.setTimeout(() => dialog.classList.remove('is-dismiss-attention'), 240);
    overlay.querySelector('input[name="title"]')?.focus();
}

function companyOrgNodeEditorOptions(source, selectedValue, labels) {
    return source.map(value => `<option value="${escapeHtml(value)}"${value === selectedValue ? ' selected' : ''}>${escapeHtml(labels[value] || value)}</option>`).join('');
}

function openCompanyOrgNodeEditor(nodeId = selectedCompanyStructureNodeId) {
    if (!companyStructureCanMutate()) return;
    const node = companyStructureNodeById(nodeId);
    if (!node) return;
    closeCompanyOrgNodeEditor();
    const parentNode = node.parentId ? companyStructureNodeById(node.parentId) : null;
    const childCount = companyStructureChildrenOf(node.id).length;
    const displayGroup = companyStructureNodeDisplayGroup(node);
    const displayGroupLabel = companyStructureDisplayGroupLabel(displayGroup) || 'немає';
    const parentOptions = [
        '<option value="">Без батьківського вузла</option>',
        ...visibleCompanyStructureSubdivisionNodes(companyStructureNodes)
            .filter(item => item.id !== node.id)
            .map(item => `<option value="${escapeHtml(item.id)}"${item.id === node.parentId ? ' selected' : ''}>${escapeHtml(item.title)}</option>`)
    ].join('');
    const overlay = document.createElement('div');
    overlay.id = 'hrOrgNodeEditorOverlay';
    overlay.className = 'candidate-detail-overlay';
    overlay.innerHTML = `
        <div class="candidate-detail-modal hr-org-node-modal" role="dialog" aria-modal="true" aria-labelledby="hrOrgNodeEditorTitle">
            <form id="hrOrgNodeForm" class="hr-org-node-form" data-node-id="${escapeHtml(node.id)}">
                <div class="candidate-detail-head">
                    <div>
                        <div class="candidate-detail-kicker">Оргструктура</div>
                        <h3 id="hrOrgNodeEditorTitle">Редагувати вузол</h3>
                    </div>
                    <button type="button" class="candidate-detail-close" id="hrOrgNodeEditorClose" aria-label="Закрити">×</button>
                </div>
                <label>
                    Назва ролі
                    <input type="text" name="title" maxlength="80" required value="${escapeHtml(node.title)}">
                </label>
                <label>
                    Опис / відповідальність
                    <textarea name="description" rows="4" maxlength="1200">${escapeHtml(node.description)}</textarea>
                </label>
                <div class="hr-org-node-editor-summary" aria-label="Поточний стан вузла">
                    <span>ID: <b>${escapeHtml(node.id)}</b></span>
                    <span>Керівник: <b>${escapeHtml(parentNode?.title || 'немає')}</b></span>
                    <span>Дочірніх ролей: <b>${childCount}</b></span>
                    <span>Фільтр: <b>${escapeHtml(displayGroupLabel)}</b></span>
                    <span>Позиція на сітці: <b>${Math.round(Number(node.x || 0))}, ${Math.round(Number(node.y || 0))}</b></span>
                </div>
                <div class="hr-org-node-form-row">
                    <label>
                        Візуальний тип
                        <select name="tone">${companyOrgNodeEditorOptions(ORG_ALLOWED_TONES, node.tone, ORG_TONE_LABELS)}</select>
                    </label>
                    <label>
                        Рівень
                        <select name="lane">${companyOrgNodeEditorOptions(ORG_ALLOWED_LANES, node.lane, ORG_LANE_LABELS)}</select>
                    </label>
                </div>
                <div class="hr-org-node-form-row">
                    <label>
                        Батьківський вузол
                        <select name="parentId">${parentOptions}</select>
                    </label>
                    <label>
                        Порядок
                        <input type="number" name="order" step="1" value="${Number(node.order) || 0}">
                    </label>
                </div>
                <div class="hr-org-node-form-row">
                    <label>
                        Операційний фільтр
                        <select name="displayGroup">${companyStructureDisplayGroupOptions(displayGroup)}</select>
                    </label>
                    <label>
                        Група / стек
                        <input type="text" name="stack" maxlength="64" value="${escapeHtml(node.stack || '')}" placeholder="Напр. kitchen">
                    </label>
                </div>
                <div class="hr-org-node-form-row">
                    <label>
                        Підпис
                        <input type="text" name="meta" maxlength="80" value="${escapeHtml(node.meta || '')}" placeholder="Напр. сервіс">
                    </label>
                </div>
                <div class="hr-org-node-form-row">
                    <label>
                        X на полотні
                        <input type="number" name="x" min="0" max="5000" step="${ORG_GRID_STEP}" value="${Math.round(Number(node.x || 0))}">
                    </label>
                    <label>
                        Y на полотні
                        <input type="number" name="y" min="0" max="5000" step="${ORG_GRID_STEP}" value="${Math.round(Number(node.y || 0))}">
                    </label>
                </div>
                <div class="hr-org-node-form-actions">
                    <button type="button" class="btn-secondary" id="hrOrgNodeEditorCancel">Скасувати</button>
                    <button type="submit" class="btn-primary">Зберегти вузол</button>
                </div>
            </form>
        </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', event => {
        if (event.target !== overlay) return;
        event.preventDefault();
        event.stopPropagation();
        nudgeCompanyOrgNodeEditor(overlay);
    });
    overlay.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        requestCloseCompanyOrgNodeEditor('escape');
    });
    document.getElementById('hrOrgNodeEditorClose')?.addEventListener('click', () => requestCloseCompanyOrgNodeEditor('close-button'));
    document.getElementById('hrOrgNodeEditorCancel')?.addEventListener('click', () => requestCloseCompanyOrgNodeEditor('cancel-button'));
    document.getElementById('hrOrgNodeForm')?.addEventListener('submit', saveCompanyOrgNodeFromEditor);
    if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(overlay);
    overlay.querySelector('input[name="title"]')?.focus();
}

async function saveCompanyOrgNodeFromEditor(event) {
    event.preventDefault();
    if (!companyStructureCanMutate()) return;
    const form = event.currentTarget;
    const nodeId = form.dataset.nodeId;
    const index = companyStructureNodes.findIndex(node => node.id === nodeId);
    if (index === -1) return;
    const formData = new FormData(form);
    const order = Number(formData.get('order'));
    const parentId = String(formData.get('parentId') || '').trim();
    const x = snapCompanyOrgCoord(formData.get('x'), 5000);
    const y = snapCompanyOrgCoord(formData.get('y'), 5000);
    if (parentId && companyOrgWouldCreateCycle(nodeId, parentId)) {
        showNotification('Таке підпорядкування створить цикл у структурі', 'warning');
        return;
    }
    const nextNode = {
        ...companyStructureNodes[index],
        title: String(formData.get('title') || '').trim().slice(0, 80) || 'Роль',
        description: String(formData.get('description') || '').trim().slice(0, 1200) || 'Роль у структурі компанії.',
        tone: ORG_ALLOWED_TONES.includes(String(formData.get('tone'))) ? String(formData.get('tone')) : 'blue',
        lane: ORG_ALLOWED_LANES.includes(String(formData.get('lane'))) ? String(formData.get('lane')) : 'leadership',
        parentId: parentId && parentId !== nodeId ? parentId : null,
        stack: String(formData.get('stack') || '').trim().slice(0, 64) || null,
        order: Number.isFinite(order) ? order : companyStructureNodes[index].order,
        meta: String(formData.get('meta') || '').trim().slice(0, 80) || null,
        displayGroup: normalizeCompanyStructureDisplayGroupKey(formData.get('displayGroup')) || null,
        x: x ?? companyStructureNodes[index].x,
        y: y ?? companyStructureNodes[index].y
    };
    pushCompanyOrgHistory();
    companyStructureNodes[index] = nextNode;
    companyStructureNodes = normalizeCompanyStructureNodes(companyStructureNodes);
    selectedCompanyStructureNodeId = nextNode.id;
    syncCompanyStructureText();
    renderCompanyOrgWorkspace();
    selectCompanyOrgNodeById(nextNode.id);
    closeCompanyOrgNodeEditor();
    markCompanyStructureChanged();
    showNotification('Вузол оновлено у draft. Збережіть структуру.', 'info');
}

function updateCompanyStructureStatus(updatedAt, updatedBy = null) {
    companyStructureUpdatedAt = updatedAt || null;
    companyStructureUpdatedBy = updatedBy || null;
    renderCompanyStructureEditorState();
}

function companyStructureResponseHasSavedData(data, structure = {}) {
    if (typeof data?.hasSavedStructure === 'boolean') return data.hasSavedStructure;
    return Boolean(
        (Array.isArray(structure.nodes) && structure.nodes.length)
        || structure.structure
        || structure.structure_text
        || structure.instructions
        || structure.instructions_text
        || structure.updatedAt
    );
}

function applyLoadedCompanyStructure(data, options = {}) {
    companyStructureServerReadOnly = data?.structureAccess?.readOnly === true;
    setStaffDisplayGroupsContract(data.displayGroups || data.display_groups || staffDisplayGroupsContract);
    const structure = data.data || data.structure || {};
    const notesText = document.getElementById('companyStructureNotes');
    const instructionsText = document.getElementById('companyInstructionsText');
    const savedStructure = structure.structure || structure.structure_text || '';
    companyStructureNodes = normalizeCompanyStructureNodes(structure.nodes);
    companyStructureHasSavedData = companyStructureResponseHasSavedData(data, structure);
    companyStructureLoaded = true;
    companyStructureLoadState = companyStructureNodes.length || companyStructureHasSavedData ? 'ready' : 'empty';
    companyStructureLoadError = '';
    companyStructureSaveError = '';
    companyStructureConflictCurrent = null;
    companyStructureDraftRevision = 0;
    companyStructureSavedRevision = 0;
    companyOrgSavedDraftSignature = '';
    companyStructureSaveState = 'clean';
    resetCompanyOrgHistory();
    resetCompanyOrgViewState();
    updateCompanyStructureStatus(structure.updatedAt, structure.updatedBy);
    const generatedStructure = companyStructureTextFromNodes(companyStructureNodes);
    if (notesText && options.hydrateFields !== false) {
        notesText.value = savedStructure && savedStructure !== DEFAULT_COMPANY_STRUCTURE_TEXT && savedStructure !== generatedStructure
            ? savedStructure
            : '';
    }
    if (instructionsText && options.hydrateFields !== false) {
        instructionsText.value = structure.instructions || structure.instructions_text || '';
    }
    syncCompanyStructureText();
    recordCompanyStructureSavedBaseline();
    if (options.render !== false) {
        renderCompanyOrgWorkspace();
        selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
    }
    return companyStructureNodes;
}

function bindCompanyStructureEditorControls() {
    const tab = document.getElementById('tab-structure');
    if (!tab || tab.dataset.structureEditorBound === 'true') return;
    tab.dataset.structureEditorBound = 'true';
    document.getElementById('btnRetryCompanyStructure')?.addEventListener('click', () => loadCompanyStructure({ force: true }));
    document.getElementById('btnApplyCompanyStructureTemplate')?.addEventListener('click', applyDefaultCompanyStructureTemplate);
    document.getElementById('btnReloadCompanyStructureConflict')?.addEventListener('click', reloadCompanyStructureFromConflict);
    document.getElementById('btnCopyCompanyStructureDraft')?.addEventListener('click', copyCompanyStructureDraft);
    document.getElementById('companyStructureNotes')?.addEventListener('input', markCompanyStructureChanged);
    document.getElementById('companyInstructionsText')?.addEventListener('input', markCompanyStructureChanged);
    document.getElementById('hrOrgViewChart')?.addEventListener('click', () => setCompanyOrgViewMode('chart'));
    document.getElementById('hrOrgViewTree')?.addEventListener('click', () => setCompanyOrgViewMode('tree'));
    document.getElementById('hrOrgFitBtn')?.addEventListener('click', fitCompanyOrgToScreen);
    document.getElementById('hrOrgZoomOut')?.addEventListener('click', () => {
        companyOrgZoom -= .1;
        applyCompanyOrgZoom();
    });
    document.getElementById('hrOrgZoomIn')?.addEventListener('click', () => {
        companyOrgZoom += .1;
        applyCompanyOrgZoom();
    });
    document.getElementById('hrOrgUndoBtn')?.addEventListener('click', undoCompanyStructureDraft);
    document.getElementById('hrOrgRedoBtn')?.addEventListener('click', redoCompanyStructureDraft);
    document.getElementById('hrOrgInspectorClose')?.addEventListener('click', closeCompanyOrgInspector);
    const search = document.getElementById('hrOrgSearch');
    search?.addEventListener('input', event => {
        companyOrgSearchQuery = event.target.value || '';
        if (companyOrgSearchRenderTimer) window.clearTimeout?.(companyOrgSearchRenderTimer);
        companyOrgSearchRenderTimer = window.setTimeout?.(() => {
            companyOrgSearchRenderTimer = null;
            reconcileCompanyOrgSearchSelection();
            renderCompanyOrgWorkspace();
            selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
        }, 120) || null;
    });
    search?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        const match = firstCompanyOrgSearchMatch();
        if (!match) return;
        event.preventDefault();
        selectCompanyOrgNodeById(match.id, { openInspector: true });
        if (companyOrgViewMode === 'chart') focusCompanyOrgCanvasOnNode(match.id);
        else document.querySelector(`[data-org-tree-select="${match.id}"]`)?.scrollIntoView?.({ block: 'center' });
    });
    const archiveFilter = document.getElementById('hrOrgArchiveFilter');
    archiveFilter?.addEventListener('change', event => {
        companyOrgArchiveFilter = normalizeCompanyOrgArchiveFilter(event.target.value);
        event.target.value = companyOrgArchiveFilter;
        reconcileCompanyOrgSearchSelection();
        renderCompanyOrgWorkspace();
        selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
    });
}

function initCompanyOrgChart() {
    if (companyStructureReloadTimer) clearTimeout(companyStructureReloadTimer);
    companyStructureReloadTimer = null;
    bindCompanyStructureEditorControls();
    const autoButton = document.getElementById('hrOrgAutoLayoutBtn');
    if (autoButton) autoButton.onclick = autoArrangeCompanyOrgChart;
    companyOrgViewMode = window.matchMedia?.('(max-width: 820px)').matches ? 'tree' : 'chart';
    companyOrgZoom = 1;
    companyOrgSearchQuery = '';
    companyOrgArchiveFilter = 'active';
    const archiveFilter = document.getElementById('hrOrgArchiveFilter');
    if (archiveFilter) archiveFilter.value = companyOrgArchiveFilter;
    resetCompanyOrgHistory();
    resetCompanyOrgViewState();
    companyOrgSavedDraftSignature = '';
    companyStructureNodes = [];
    companyStructureLoaded = false;
    companyStructureLoadRequestSeq += 1;
    companyStructureContext = teamAccessContext();
    companyStructureServerReadOnly = false;
    companyStructureLoadState = 'loading';
    companyStructureSaveState = 'clean';
    renderCompanyOrgWorkspace();
}

function clearCompanyStructureReadData() {
    companyStructureNodes = [];
    companyStructureLoaded = false;
    companyStructureHasSavedData = false;
    companyStructureServerReadOnly = true;
    companyStructureUpdatedAt = null;
    companyStructureUpdatedBy = null;
    companyStructureConflictCurrent = null;
    companyStructureDraftRevision = 0;
    companyStructureSavedRevision = 0;
    selectedCompanyStructureNodeId = null;
    const notes = document.getElementById('companyStructureNotes');
    const instructions = document.getElementById('companyInstructionsText');
    const structureText = document.getElementById('companyStructureText');
    if (notes) notes.value = '';
    if (instructions) instructions.value = '';
    if (structureText) structureText.value = '';
}

function invalidateCompanyStructureContext({ force = false, reload = false, pending = false } = {}) {
    const context = teamAccessContext();
    if (!force && companyStructureContext === context) return;
    if (companyStructureReloadTimer) clearTimeout(companyStructureReloadTimer);
    companyStructureReloadTimer = null;
    companyStructureLoadRequestSeq += 1;
    companyStructureContext = context;
    clearCompanyStructureReadData();
    companyStructureLoadState = reload || pending ? 'loading' : 'error';
    companyStructureLoadError = reload || pending ? '' : 'Бізнес або доступ змінився. Повторіть завантаження структури.';
    companyOrgSavedDraftSignature = '';
    resetCompanyOrgHistory();
    const active = document.getElementById('tab-structure')?.classList.contains('active');
    if (active) renderCompanyOrgWorkspace();
    if (!reload || !active) return;
    companyStructureReloadTimer = setTimeout(() => {
        companyStructureReloadTimer = null;
        if (companyStructureContext !== context || !document.getElementById('tab-structure')?.classList.contains('active')) return;
        if (!getHrCurrentUser() || !canViewHrTab('structure')) {
            companyStructureLoadState = 'restricted';
            companyStructureLoadError = 'Структура недоступна для поточного доступу.';
            renderCompanyOrgWorkspace();
            return;
        }
        void loadCompanyStructure({ force: true });
    }, 0);
}

function isCurrentCompanyStructureLoad(request, context) {
    if (request !== companyStructureLoadRequestSeq) return false;
    if (context !== teamAccessContext()) {
        invalidateCompanyStructureContext({ reload: true });
        return false;
    }
    return true;
}

async function ensureCompanyStructureNodesLoaded(options = {}) {
    const context = teamAccessContext();
    if (companyStructureContext && companyStructureContext !== context) invalidateCompanyStructureContext();
    if (companyStructureLoaded && !options.force) return companyStructureNodes;
    const request = ++companyStructureLoadRequestSeq;
    companyStructureContext = context;
    companyStructureLoadState = 'loading';
    companyStructureLoadError = '';
    if (!options.silent) renderCompanyOrgWorkspace();
    const data = await hrFetch('/company-structure', { allowForbiddenResponse: true }).catch(() => null);
    if (!isCurrentCompanyStructureLoad(request, context)) return [];
    if (!data?.success) {
        clearCompanyStructureReadData();
        companyStructureLoadState = data?.status === 403 ? 'restricted' : 'error';
        companyStructureLoadError = data?.error || 'Не вдалося завантажити структуру';
        if (!options.silent) {
            showNotification(companyStructureLoadError, 'error');
            renderCompanyOrgWorkspace();
        }
        return companyStructureNodes;
    }
    return applyLoadedCompanyStructure(data, {
        hydrateFields: options.hydrateFields !== false,
        render: options.render !== false && !options.silent
    });
}

async function loadCompanyStructure(options = {}) {
    if (companyStructureReloadTimer) clearTimeout(companyStructureReloadTimer);
    companyStructureReloadTimer = null;
    const context = teamAccessContext();
    if (companyStructureContext && companyStructureContext !== context) invalidateCompanyStructureContext();
    if (companyStructureLoaded && companyStructureHasUnsavedChanges() && !options.force) {
        renderCompanyOrgWorkspace();
        selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
        return companyStructureNodes;
    }
    const request = ++companyStructureLoadRequestSeq;
    companyStructureContext = context;
    companyStructureLoadState = 'loading';
    companyStructureLoadError = '';
    renderCompanyOrgWorkspace();
    const data = await hrFetch('/company-structure', { allowForbiddenResponse: true }).catch(() => null);
    if (!isCurrentCompanyStructureLoad(request, context)) return [];
    if (!data?.success) {
        clearCompanyStructureReadData();
        companyStructureLoadState = data?.status === 403 ? 'restricted' : 'error';
        companyStructureLoadError = data?.error || 'Не вдалося завантажити структуру';
        renderCompanyOrgWorkspace();
        return companyStructureNodes;
    }
    await ensureProfessionsLoaded({ force: true, silent: true });
    if (!isCurrentCompanyStructureLoad(request, context)) return [];
    const nodes = applyLoadedCompanyStructure(data);
    renderCompanyOrgWorkspace();
    updateCompanyOrgDetail(companyStructureNodeById(selectedCompanyStructureNodeId));
    return nodes;
}

function applyDefaultCompanyStructureTemplate() {
    if (!canEditCompanyStructure() || companyStructureLoadState !== 'empty' || companyStructureHasSavedData) return false;
    companyStructureNodes = normalizeCompanyStructureNodes(cloneCompanyStructureNodes(DEFAULT_COMPANY_STRUCTURE_NODES));
    companyStructureLoadState = 'ready';
    selectedCompanyStructureNodeId = companyStructureNodes[0]?.id || null;
    syncCompanyStructureText();
    markCompanyStructureChanged();
    renderCompanyOrgWorkspace();
    selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
    showNotification('Базовий шаблон додано у draft. Перевірте його та натисніть «Зберегти».', 'info');
    return true;
}

function companyStructureDraftPayload() {
    const notes = document.getElementById('companyStructureNotes')?.value || '';
    syncCompanyStructureText();
    return {
        schemaVersion: 1,
        structure: notes.trim() || document.getElementById('companyStructureText')?.value || '',
        instructions: document.getElementById('companyInstructionsText')?.value || '',
        nodes: normalizeCompanyStructureNodes(companyStructureNodes),
        baseUpdatedAt: companyStructureUpdatedAt
    };
}

async function reloadCompanyStructureFromConflict() {
    if (companyStructureSaveState !== 'conflict' || !companyStructureConflictCurrent) return false;
    const confirmed = await confirmHrAction('Завантажити актуальну серверну версію? Ваш локальний draft буде втрачено.', {
        type: 'warning',
        okText: 'Завантажити актуальну',
        cancelText: 'Залишити мій draft'
    });
    if (!confirmed) return false;
    const current = companyStructureConflictCurrent;
    applyLoadedCompanyStructure({ success: true, data: current, hasSavedStructure: true });
    showNotification('Завантажено актуальну версію структури', 'success');
    return true;
}

async function copyCompanyStructureDraft() {
    const text = JSON.stringify(companyStructureDraftPayload(), null, 2);
    if (!navigator.clipboard?.writeText) {
        showNotification('Clipboard недоступний. Draft не скопійовано.', 'error');
        return false;
    }
    try {
        await navigator.clipboard.writeText(text);
        showNotification('Локальний draft скопійовано', 'success');
        return true;
    } catch {
        showNotification('Не вдалося скопіювати локальний draft', 'error');
        return false;
    }
}

async function saveCompanyStructure(options = {}) {
    if (companyStructureSavePromise) return companyStructureSavePromise;
    if (!companyStructureCanMutate()) {
        if (!canEditCompanyStructure()) showNotification('Недостатньо прав для редагування структури', 'warning');
        return false;
    }
    if (!companyStructureHasUnsavedChanges() && companyStructureSaveState !== 'error') return true;

    const payload = companyStructureDraftPayload();
    const savingRevision = companyStructureDraftRevision;
    setCompanyStructureSaveState('saving', { error: '' });
    const operation = (async () => {
        let data = null;
        try {
            data = await hrFetch('/company-structure', {
                method: 'PUT',
                body: JSON.stringify(payload),
                allowForbiddenResponse: true
            });
        } catch {
            data = null;
        }
        if (data?.success) {
            setStaffDisplayGroupsContract(data.displayGroups || data.display_groups || staffDisplayGroupsContract);
            const saved = data.data || payload;
            companyStructureUpdatedAt = saved.updatedAt || companyStructureUpdatedAt;
            companyStructureUpdatedBy = saved.updatedBy || companyStructureUpdatedBy;
            companyStructureHasSavedData = true;
            companyStructureLoaded = true;
            companyStructureLoadState = 'ready';
            companyStructureSavedRevision = Math.max(companyStructureSavedRevision, savingRevision);
            if (companyStructureDraftRevision === savingRevision) {
                companyStructureNodes = normalizeCompanyStructureNodes(saved.nodes);
                syncCompanyStructureText();
                recordCompanyStructureSavedBaseline();
                renderCompanyOrgWorkspace();
                selectCompanyOrgNodeById(selectedCompanyStructureNodeId);
                resetCompanyOrgHistory();
            }
            companyStructureSaveState = companyStructureHasUnsavedChanges() ? 'changed' : 'saved';
            companyStructureSaveError = '';
            companyStructureConflictCurrent = null;
            renderCompanyStructureEditorState();
            const stale = data.staleRefsCleared || {};
            const staleCount = Number(stale.staff || 0) + Number(stale.professions || 0);
            if (!options.silent) {
                showNotification(staleCount
                    ? `Структуру збережено. Очищено застарілих привʼязок: ${staleCount}`
                    : (companyStructureHasUnsavedChanges() ? 'Поточну версію збережено. Новіші зміни залишились у draft.' : 'Структуру та інструкції збережено'), 'success');
            }
            return true;
        }
        if (data?.status === 409 && data.current) {
            companyStructureConflictCurrent = data.current;
            setCompanyStructureSaveState('conflict', { error: data.error || 'Конфлікт версій' });
            showNotification(data.error || 'Структуру вже змінили в іншій вкладці', 'warning');
            return false;
        }
        if (data?.status === 403) {
            companyStructurePermissionDenied = true;
            setCompanyOrgLinkMode(null);
            renderCompanyOrgWorkspace();
        }
        const error = data?.error || 'Не вдалося зберегти структуру';
        setCompanyStructureSaveState('error', { error });
        showNotification(error, 'error');
        return false;
    })();
    companyStructureSavePromise = operation;
    try {
        return await operation;
    } finally {
        if (companyStructureSavePromise === operation) companyStructureSavePromise = null;
        renderCompanyStructureEditorState();
    }
}
    // HR_STRUCTURE_IMPLEMENTATION_END
    window.HrStructureModule = Object.freeze({
        initialize() {
            if (initialized) return;
            initialized = true;
            initCompanyOrgChart();
            document.getElementById('btnSaveCompanyStructure')?.addEventListener('click', saveCompanyStructure);
for (const eventName of ['crmBusinessContextChanged', 'crmBusinessScopeChanged', 'crmBusinessProfileChanged', 'roleSwitched', 'crm:auth-cleared']) {
    window.addEventListener(eventName, () => invalidateCompanyStructureContext({
        force: eventName === 'roleSwitched' || eventName === 'crm:auth-cleared',
        reload: eventName !== 'crm:auth-cleared'
    }));
}
window.addEventListener('permissions:lifecycle', event => invalidateCompanyStructureContext({
    force: true,
    reload: event.detail?.status === 'ready',
    pending: event.detail?.status === 'loading'
}));
        },
        loadCompanyStructure,
        ensureCompanyStructureNodesLoaded,
        selectCompanyOrgNodeById
    });
})();
