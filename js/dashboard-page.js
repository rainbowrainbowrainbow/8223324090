/**
 * js/dashboard-page.js — Dashboard page logic (v0.50.11)
 * Widget-based personalized dashboard with safe board foundation mode.
 */

const DashboardPage = (() => {
    const BOARD_SCHEMA_VERSION = 1;
    const BOARD_LIVE_WIDGET_CAP = 18;
    const BOARD_UNDO_LIMIT = 40;
    const BOARD_SAVE_DEBOUNCE_MS = 900;
    const BOARD_ALLOWED_TYPES = new Set(['widget', 'note', 'text', 'shape', 'frame', 'space']);
    const BOARD_ALLOWED_DEPTHS = new Set(['live-compact', 'headline-only', 'snapshot-static']);
    const BOARD_TOOLS = new Set(['select', 'hand', 'brush', 'highlighter', 'eraser', 'connector', 'note', 'text', 'frame', 'space', 'widget', 'line', 'arrow', 'rect', 'square', 'circle', 'round-rect', 'ellipse', 'diamond']);
    const BOARD_CREATE_TOOLS = new Set(['note', 'text', 'frame', 'space', 'widget']);
    const BOARD_SHAPE_TOOLS = new Set(['line', 'arrow', 'rect', 'square', 'circle', 'round-rect', 'ellipse', 'diamond']);
    const BOARD_DRAW_TOOLS = new Set(['brush', 'highlighter']);
    const BOARD_TOOL_LABELS = {
        select: 'Вибір',
        hand: 'Рука',
        brush: 'Пензель',
        highlighter: 'Маркер',
        eraser: 'Гумка',
        connector: 'Зв’язок',
        note: 'Нотатка',
        text: 'Текст',
        frame: 'Фрейм',
        space: 'Порожня зона',
        widget: 'Віджет',
        line: 'Лінія',
        arrow: 'Стрілка',
        rect: 'Прямокутник',
        square: 'Квадрат',
        circle: 'Коло',
        'round-rect': 'Скруглений блок',
        ellipse: 'Еліпс',
        diamond: 'Ромб'
    };
    const BOARD_TOOL_HINTS = {
        select: 'Обирайте модулі, відкривайте віджети або міняйте блоки.',
        hand: 'Перетягуйте поле дошки, не змінюючи модулі.',
        brush: 'Малюйте поверх сцени вільною лінією.',
        highlighter: 'Підсвічуйте важливі зони напівпрозорим маркером.',
        eraser: 'Натискайте по штрихах, щоб прибрати зайве.',
        connector: 'Обирайте точки на двох модулях, щоб зробити зв’язок.',
        note: 'Натисніть на дошці, щоб додати нотатку.',
        text: 'Натисніть на дошці, щоб додати текст.',
        frame: 'Натисніть на дошці, щоб додати рамку для групи.',
        space: 'Позначте місце, яке має лишитися вільним або зарезервованим.',
        widget: 'Натисніть на дошці, щоб додати віджет.',
        line: 'Натисніть на дошці, щоб поставити лінію.',
        arrow: 'Натисніть на дошці, щоб поставити стрілку.',
        rect: 'Натисніть на дошці, щоб поставити прямокутник.',
        square: 'Натисніть на дошці, щоб поставити квадрат з рівними сторонами.',
        circle: 'Натисніть на дошці, щоб поставити справжнє коло з рівною шириною і висотою.',
        'round-rect': 'Натисніть на дошці, щоб поставити м’який блок.',
        ellipse: 'Натисніть на дошці, щоб поставити еліпс.',
        diamond: 'Натисніть на дошці, щоб поставити ромб.'
    };
    const BOARD_MODE_LABELS = {
        'board:view': 'Перегляд',
        'board:edit': 'Редагування',
        'board:draw': 'Малювання',
        'board:connect': 'Зв’язки',
        'board:create': 'Додавання',
        'board:shape': 'Фігури',
        'object:text-edit': 'Редагування тексту',
        'object:widget-inspect': 'Робота з віджетом'
    };
    const BOARD_TYPE_LABELS = {
        widget: 'Віджет',
        note: 'Нотатка',
        text: 'Текст',
        shape: 'Фігура',
        frame: 'Рамка',
        space: 'Порожня зона'
    };
    const BOARD_DEPTH_LABELS = {
        'live-compact': 'Живий компакт',
        'headline-only': 'Тільки заголовок',
        'snapshot-static': 'Знімок'
    };
    const BOARD_SNAP_LABELS = {
        strict: 'Жорстко',
        soft: 'М’яко',
        freeform: 'Вільно'
    };
    const BOARD_CONNECTOR_STYLE_LABELS = {
        line: 'Лінія',
        arrow: 'Стрілка',
        curve: 'Крива'
    };
    function notifyDashboardIssue(message) {
        const text = String(message || 'Не вдалося виконати дію');
        if (typeof showNotification === 'function') {
            showNotification(text, 'error');
            return;
        }
        console.warn('[dashboard]', text);
    }

    async function confirmDashboardAction(message, options = {}) {
        const {
            type = 'warning',
            okText = 'Підтвердити',
            cancelText = 'Скасувати'
        } = options;
        if (typeof confirmModal === 'function') {
            return confirmModal(message, { type, okText, cancelText });
        }
        if (typeof customConfirm === 'function') {
            return customConfirm(message, 'Підтвердження');
        }
        notifyDashboardIssue('Підтвердження недоступне. Оновіть сторінку і повторіть дію.');
        return false;
    }

    const BOARD_RELATION_LABELS = {
        idea: 'Ідея',
        depends: 'Залежить',
        blocks: 'Блокує',
        feeds: 'Передає',
        inspires: 'Надихає'
    };
    const BOARD_AI_ACTION_LABELS = {
        expand: 'Розширити',
        'mood-pack': 'Настрій',
        cluster: 'Кластер',
        summarize: 'Стисло',
        tasks: 'Задачі',
        remix: 'Ремікс',
        'name-frame': 'Назвати рамку',
        'prompt-to-board': 'З промпта'
    };
    const BOARD_ANCHOR_LABELS = {
        top: 'верх',
        right: 'праворуч',
        bottom: 'низ',
        left: 'ліворуч'
    };
    const BOARD_ALLOWED_SHAPES = new Set(['line', 'arrow', 'rect', 'square', 'circle', 'round-rect', 'ellipse', 'diamond']);
    const BOARD_CONNECTOR_STYLES = new Set(['line', 'arrow', 'curve']);
    const BOARD_RELATION_TYPES = new Set(['idea', 'depends', 'blocks', 'feeds', 'inspires']);
    const BOARD_WORKSPACE_MODES = new Set(['board:view', 'board:edit', 'board:draw', 'board:connect', 'board:create', 'board:shape', 'object:text-edit', 'object:widget-inspect']);
    const DASHBOARD_WORKSPACE_MODE = 'workspace';
    const BOARD_SNAP_MODES = new Set(['strict', 'soft', 'freeform']);
    const BOARD_AI_PRESETS = new Set(['expand', 'mood-pack', 'cluster', 'summarize', 'tasks', 'remix', 'name-frame', 'prompt-to-board']);
    const DASHBOARD_RETIRED_WIDGETS = new Set();
    const DASHBOARD_PRESENTATION_MODES = new Set(['mixed-scene', 'flat-grid']);
    const BOARD_PLANNING_ZONES = [
        {
            id: 'focus',
            title: 'Фокус роботи',
            hint: 'Сюди ставте головний tasker, чергу або найбільш важливий live-віджет.',
            x: 44,
            y: 46,
            w: 360,
            h: 250,
            widget: 'personal_tasker'
        },
        {
            id: 'signals',
            title: 'Операційні сигнали',
            hint: 'Компактні алерти, бронювання, ризики або команда онлайн.',
            x: 436,
            y: 46,
            w: 315,
            h: 218,
            widget: 'alerts'
        },
        {
            id: 'breathing',
            title: 'Дихаюча зона',
            hint: 'Навмисно пусте місце, щоб сцена не перетворювалась на шум.',
            x: 790,
            y: 54,
            w: 330,
            h: 270,
            kind: 'breathing'
        },
        {
            id: 'planning',
            title: 'Майбутній модуль',
            hint: 'Зарезервуйте слот під віджет, який додасте пізніше.',
            x: 84,
            y: 360,
            w: 390,
            h: 230,
            kind: 'future',
            widget: 'tasks'
        }
    ];

    // Widget definitions — all available widgets
    const WIDGET_DEFS = {
        quick_stats:    { icon: '📊', title: 'Швидка статистика', minRole: 'admin' },
        tasks:          { icon: '📋', title: 'Мої задачі', minRole: null },
        my_focus:       { icon: '🎯', title: 'Мій фокус', minRole: null },
        personal_tasker:{ icon: '✅', title: 'Особистий tasker', minRole: 'creator' },
        bookings_today: { icon: '📅', title: 'Бронювання сьогодні', minRole: 'admin' },
        my_schedule:    { icon: '🕐', title: 'Мій графік', minRole: null },
        team_online:    { icon: '👥', title: 'Команда онлайн', minRole: 'manager' },
        alerts:         { icon: '🔔', title: 'Сповіщення', minRole: null },
        event_risk_summary: { icon: '⚠️', title: 'Ризики подій', minRole: 'admin' },
        exceptions:     { icon: '🚨', title: 'Що потребує уваги', minRole: 'admin' },
        leads_new:      { icon: '🔥', title: 'Нові ліди', minRole: 'manager' },
        funnel:         { icon: '◈', title: 'Воронка', minRole: 'manager' },
        finance_today:  { icon: '💰', title: 'Фінанси сьогодні', minRole: 'senior_manager' },
        weather:        { icon: '🌤', title: 'Погода', minRole: null },
        currency:       { icon: '💱', title: 'Курси валют', minRole: 'manager' },
        announcements:  { icon: '📢', title: 'Оголошення', minRole: null },
        reports_today:  { icon: '📋', title: 'Звіти сьогодні', minRole: 'senior_manager' },
        catalogs:       { icon: '📚', title: 'Авто-каталоги', minRole: 'admin' },
        account_stats:  { icon: '🔗', title: 'Акаунти CRM', minRole: 'manager' },
        staff_today:    { icon: '👷', title: 'Хто на зміні', minRole: 'manager' },
        week_bookings:  { icon: '📆', title: 'Бронювання на тиждень', minRole: 'admin' },
        team_tasks:     { icon: '📝', title: 'Задачі команди', minRole: 'manager' },
        task_health:    { icon: '🧭', title: 'Здоровʼя задач', minRole: 'manager' },
        hr_overview:    { icon: '🏥', title: 'HR дайджест', minRole: 'hr' },
        director_pnl:   { icon: '💹', title: 'P&L', minRole: 'director' },
        content_pipeline: { icon: '🎨', title: 'Контент-пайплайн', minRole: 'art_director' },
        operations:     { icon: '⚙️', title: 'Операції', minRole: 'vice_director' },
    };

    const ROLE_DASHBOARD_BASE_WIDGETS = {
        creator: ['personal_tasker', 'quick_stats', 'my_focus', 'funnel', 'director_pnl', 'staff_today', 'event_risk_summary', 'team_tasks', 'task_health', 'exceptions', 'team_online', 'bookings_today', 'leads_new', 'catalogs', 'weather', 'currency', 'announcements', 'tasks', 'my_schedule', 'alerts', 'hr_overview', 'content_pipeline', 'operations'],
        director: ['director_pnl', 'my_focus', 'funnel', 'quick_stats', 'staff_today', 'event_risk_summary', 'team_tasks', 'task_health', 'exceptions', 'team_online', 'bookings_today', 'leads_new', 'weather', 'currency', 'announcements', 'tasks', 'my_schedule', 'alerts'],
        vice_director: ['operations', 'my_focus', 'funnel', 'quick_stats', 'staff_today', 'event_risk_summary', 'team_tasks', 'task_health', 'exceptions', 'team_online', 'bookings_today', 'weather', 'announcements', 'tasks', 'my_schedule', 'alerts'],
        senior_manager: ['quick_stats', 'my_focus', 'funnel', 'staff_today', 'event_risk_summary', 'team_tasks', 'task_health', 'exceptions', 'bookings_today', 'team_online', 'leads_new', 'weather', 'announcements', 'tasks', 'my_schedule', 'alerts'],
        manager: ['staff_today', 'event_risk_summary', 'exceptions', 'my_focus', 'funnel', 'tasks', 'bookings_today', 'my_schedule', 'leads_new', 'weather', 'announcements', 'team_tasks', 'task_health', 'team_online', 'alerts', 'quick_stats'],
        admin: ['event_risk_summary', 'exceptions', 'tasks', 'bookings_today', 'my_schedule', 'weather', 'announcements', 'alerts', 'quick_stats', 'catalogs'],
        hr: ['hr_overview', 'staff_today', 'tasks', 'team_online', 'my_schedule', 'announcements', 'weather', 'alerts'],
        art_director: ['content_pipeline', 'tasks', 'my_schedule', 'bookings_today', 'weather', 'announcements', 'alerts', 'catalogs', 'quick_stats'],
        _default: ['tasks', 'my_schedule', 'weather', 'announcements', 'alerts'],
    };

    const ROLE_DASHBOARD_SCENES = {
        creator: {
            title: 'Creator mixed scene',
            description: 'Повний огляд CRM з операційним кластером, executive контролем і окремою смугою для думок.',
            zones: {
                leftCluster: ['funnel', 'tasks', 'team_tasks', 'leads_new', 'staff_today', 'bookings_today'],
                centerControl: ['alerts', 'quick_stats', 'weather', 'announcements', 'my_schedule'],
                lowerSupport: ['director_pnl', 'operations', 'event_risk_summary', 'exceptions', 'team_online', 'currency'],
                specialty: ['hr_overview', 'content_pipeline', 'catalogs'],
                rightWritingLane: ['notes-zone-primary', 'notes-zone-secondary', 'decision-zone']
            },
            spacing: { rightFreeLane: 340, chaos: 0.22 }
        },
        admin: {
            title: 'Admin operations scene',
            description: 'Контроль бронювань, ризиків, задач і системних довідників без executive шуму.',
            zones: {
                leftCluster: ['event_risk_summary', 'exceptions', 'bookings_today', 'tasks'],
                centerControl: ['alerts', 'quick_stats', 'my_schedule'],
                lowerSupport: ['announcements', 'weather', 'catalogs'],
                rightWritingLane: ['notes-zone-primary', 'admin-zone']
            },
            spacing: { rightFreeLane: 320, chaos: 0.14 }
        },
        manager: {
            title: 'Manager flow scene',
            description: 'Ліди, команда, задачі й сьогоднішні події з місцем для швидких нотаток.',
            zones: {
                leftCluster: ['funnel', 'leads_new', 'tasks', 'team_tasks'],
                centerControl: ['alerts', 'staff_today', 'team_online', 'bookings_today'],
                lowerSupport: ['event_risk_summary', 'exceptions', 'my_schedule', 'weather', 'announcements'],
                rightWritingLane: ['notes-zone-primary']
            },
            spacing: { rightFreeLane: 300, chaos: 0.18 }
        },
        senior_manager: {
            title: 'Senior manager control scene',
            description: 'Командна воронка, ризики, задачі й швидка статистика для зміни.',
            zones: {
                leftCluster: ['funnel', 'team_tasks', 'staff_today', 'leads_new'],
                centerControl: ['quick_stats', 'event_risk_summary', 'exceptions'],
                lowerSupport: ['bookings_today', 'team_online', 'alerts', 'weather', 'announcements'],
                rightWritingLane: ['notes-zone-primary', 'decision-zone']
            },
            spacing: { rightFreeLane: 320, chaos: 0.15 }
        },
        director: {
            title: 'Director executive scene',
            description: 'Executive контроль: P&L, ризики, винятки й рішення без операційного перевантаження.',
            zones: {
                leftCluster: ['director_pnl', 'quick_stats', 'funnel'],
                centerControl: ['alerts', 'event_risk_summary', 'exceptions'],
                lowerSupport: ['team_tasks', 'staff_today', 'bookings_today', 'team_online', 'weather', 'announcements'],
                rightWritingLane: ['notes-zone-primary', 'decision-zone']
            },
            spacing: { rightFreeLane: 340, chaos: 0.10 }
        },
        vice_director: {
            title: 'Vice director operations scene',
            description: 'Операційний контроль, ризики подій і команда з помірною асиметрією.',
            zones: {
                leftCluster: ['operations', 'event_risk_summary', 'exceptions', 'bookings_today'],
                centerControl: ['alerts', 'quick_stats', 'staff_today', 'team_online'],
                lowerSupport: ['funnel', 'team_tasks', 'weather', 'announcements'],
                rightWritingLane: ['notes-zone-primary', 'ops-zone']
            },
            spacing: { rightFreeLane: 320, chaos: 0.12 }
        },
        hr: {
            title: 'HR people scene',
            description: 'Люди, зміни й команда із чистою note lane для кадрових спостережень.',
            zones: {
                leftCluster: ['hr_overview', 'tasks'],
                centerControl: ['staff_today', 'team_online', 'alerts'],
                lowerSupport: ['my_schedule', 'announcements', 'weather'],
                rightWritingLane: ['notes-zone-primary', 'people-zone']
            },
            spacing: { rightFreeLane: 320, chaos: 0.12 }
        },
        art_director: {
            title: 'Art director creative scene',
            description: 'Контент, задачі, бронювання й простір для скетчів без змішування з executive блоками.',
            zones: {
                leftCluster: ['content_pipeline', 'tasks'],
                centerControl: ['alerts', 'my_schedule', 'bookings_today', 'announcements'],
                lowerSupport: ['catalogs', 'quick_stats', 'weather'],
                rightWritingLane: ['notes-zone-primary', 'sketch-zone']
            },
            spacing: { rightFreeLane: 360, chaos: 0.16 }
        }
    };

    const WRITING_ZONE_DEFS = {
        'notes-zone-primary': { title: 'Головні нотатки', hint: 'Рішення, які треба тримати поруч із dashboard.' },
        'notes-zone-secondary': { title: 'Швидкі думки', hint: 'Чернетки, ідеї, короткі спостереження.' },
        'decision-zone': { title: 'Рішення', hint: 'Що затвердити, делегувати або перевірити.' },
        'sketch-zone': { title: 'Скетч-зона', hint: 'Ідеї для контенту, афіш і програм.' },
        'ops-zone': { title: 'Операційні нотатки', hint: 'Вузькі місця, зміни, ризики на сьогодні.' },
        'people-zone': { title: 'Нотатки про команду', hint: 'Команда, адаптація, зміни, важливі сигнали.' },
        'admin-zone': { title: 'Admin notes', hint: 'Довідники, бронювання, ручні перевірки.' }
    };

    let _config = createDefaultDashboardConfig();
    let _widgetData = {};
    let _personalTaskerView = 'assigned_to_me';
    let _boardInteractionMode = 'view';
    let _boardSelectedId = null;
    let _boardSelectedConnectorId = null;
    let _boardWorkspaceMode = 'board:view';
    let _boardConnectorDraft = null;
    let _boardObjectEditing = null;
    let _boardWidgetInspectId = null;
    let _boardSpaceHandActive = false;
    let _boardDirty = false;
    let _boardSaveStatus = 'saved';
    let _boardSaveTimer = null;
    let _boardUndoStack = [];
    let _boardRedoStack = [];
    let _boardDrag = null;
    let _boardResize = null;
    let _boardDrawing = null;
    let _boardPan = null;
    let _boardLineEndpointDrag = null;
    let _boardConnectorEndpointDrag = null;
    let _boardSuppressCanvasClickUntil = 0;
    let _boardConfigCorrupt = false;
    let _boardLegacyUpgradePending = false;
    let _boardKeyboardBound = false;
    let _boardRecoveryKey = 'eg_dashboard_board_draft_guest';
    let _workQueueReplyScope = normalizeWorkQueueReplyScope(localStorage.getItem('eg_reply_backlog_scope'));
    let _workQueueReplyFilters = loadReplyConsoleFilters();
    let _workQueueSelection = new Set();
    let _workQueueVisibleReplyIds = [];
    let _workQueueVisibleItemIds = [];
    let _workQueueItemsById = new Map();
    let _workQueueSelectedItemId = null;
    let _replyOpsFlash = null;
    let _queueExecutionFlash = null;
    let _replyActionHistoryState = { itemId: null, conversationId: null, status: 'idle', events: [], error: null };
    let _replyOwnerPickerState = null;
    let _taskActionHistoryState = { itemId: null, taskId: null, status: 'idle', events: [], error: null };
    let _taskOwnerPickerState = null;
    let _settingsOverlayInitialState = '';
    let _assistantRailState = {
        mode: 'idle',
        voiceEnabled: localStorage.getItem('eg_dashboard_assistant_voice') !== 'off',
        subtitle: 'Субтитри з’являться тут, коли асистент почне говорити.',
        tickerText: '',
        lastSpokenLine: '',
        updatedAt: null
    };
    let _assistantMediaRecorder = null;
    let _assistantAudioChunks = [];
    let _assistantListeningStream = null;
    let _assistantAudioPlayer = null;
    let _assistantAudioUrl = null;
    let _assistantHistory = [];
    const ASSISTANT_RAIL_MODES = new Set(['idle', 'thinking', 'busy', 'listening', 'speaking', 'muted', 'error']);
    const ASSISTANT_RAIL_LABELS = {
        idle: 'Готовий',
        thinking: 'Думаю',
        busy: 'Зайнятий',
        listening: 'Слухаю',
        speaking: 'Говорю',
        muted: 'Тиша',
        error: 'Помилка'
    };

    function createDefaultDashboardConfig() {
        return {
            widgets: ['tasks', 'my_schedule', 'weather'],
            layout: {},
            theme: 'default',
            mode: DASHBOARD_WORKSPACE_MODE,
            presentationMode: 'mixed-scene',
            roleScenePreset: null,
            sceneOptions: {
                writingLane: true,
                controlledChaos: true
            },
            boardMeta: {
                version: BOARD_SCHEMA_VERSION,
                enabled: true,
                lastSavedAt: null,
                dirty: false,
                privacy: 'private',
                collaboration: 'personal'
            },
            boardState: {
                viewport: { x: 0, y: 0, zoom: 1 },
                items: [],
                drawings: [],
                connectors: [],
                activeTool: 'select',
                preferences: {
                    snapToGrid: true,
                    snapMode: 'soft',
                    showGrid: true,
                    showGuides: true,
                    showPlanner: true,
                    showMiniMap: false,
                    maxLiveWidgets: BOARD_LIVE_WIDGET_CAP,
                    strokeColor: '#10b981',
                    fillColor: 'rgba(16, 185, 129, 0.10)',
                    strokeWidth: 2,
                    connectorStyle: 'arrow',
                    relationType: 'idea'
                }
            }
        };
    }

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function safeObject(value, fallback = {}) {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        return fallback;
    }

    function safeNumber(value, fallback, min, max) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, number));
    }

    function normalizeDashboardMode() {
        return DASHBOARD_WORKSPACE_MODE;
    }

    function normalizeDashboardPresentationMode(value) {
        return DASHBOARD_PRESENTATION_MODES.has(value) ? value : 'mixed-scene';
    }

    function normalizeSceneOptions(input) {
        const source = safeObject(input, {});
        return {
            writingLane: source.writingLane !== false,
            controlledChaos: source.controlledChaos !== false
        };
    }

    function normalizeBoardTool(value) {
        return BOARD_TOOLS.has(value) ? value : 'select';
    }

    function normalizeBoardShape(value) {
        return BOARD_ALLOWED_SHAPES.has(value) ? value : 'rect';
    }

    function isBoardEquilateralShape(shape) {
        return shape === 'circle' || shape === 'square';
    }

    function normalizeBoardShapeDimensions(shape, width, height) {
        const safeShape = normalizeBoardShape(shape);
        if (!isBoardEquilateralShape(safeShape)) {
            return { w: width, h: height };
        }
        const size = safeNumber(Math.max(Number(width || 0), Number(height || 0)), 150, 80, 900);
        return { w: size, h: size };
    }

    function normalizeBoardConnectorStyle(value) {
        return BOARD_CONNECTOR_STYLES.has(value) ? value : 'arrow';
    }

    function normalizeBoardRelationType(value) {
        return BOARD_RELATION_TYPES.has(value) ? value : 'idea';
    }

    function normalizeBoardSnapMode(value) {
        return BOARD_SNAP_MODES.has(value) ? value : 'soft';
    }

    function normalizeBoardWorkspaceMode(mode) {
        return BOARD_WORKSPACE_MODES.has(mode) ? mode : 'board:view';
    }

    function normalizeBoardStroke(stroke, index = 0) {
        if (!stroke || typeof stroke !== 'object' || !Array.isArray(stroke.points) || stroke.points.length < 2) return null;
        const tool = normalizeBoardTool(stroke.tool);
        if (!BOARD_DRAW_TOOLS.has(tool)) return null;
        const points = stroke.points
            .slice(0, 2000)
            .map(point => {
                if (!Array.isArray(point) || point.length < 2) return null;
                return [
                    safeNumber(point[0], 0, -10000, 10000),
                    safeNumber(point[1], 0, -10000, 10000)
                ];
            })
            .filter(Boolean);
        if (points.length < 2) return null;
        return {
            id: String(stroke.id || `stroke-${Date.now()}-${index}`).slice(0, 90),
            tool,
            color: String(stroke.color || (tool === 'highlighter' ? '#f59e0b' : '#10b981')).slice(0, 32),
            width: safeNumber(stroke.width, tool === 'highlighter' ? 12 : 2, 1, 24),
            opacity: safeNumber(stroke.opacity, tool === 'highlighter' ? 0.34 : 0.9, 0.05, 1),
            points
        };
    }

    function normalizeBoardConnector(connector, index = 0) {
        if (!connector || typeof connector !== 'object') return null;
        const from = safeObject(connector.from, {});
        const to = safeObject(connector.to, {});
        const fromItemId = String(from.itemId || '').slice(0, 90);
        const toItemId = String(to.itemId || '').slice(0, 90);
        if (!fromItemId || !toItemId || fromItemId === toItemId) return null;
        return {
            id: String(connector.id || `conn-${Date.now()}-${index}`).slice(0, 90),
            from: {
                itemId: fromItemId,
                anchor: ['top', 'right', 'bottom', 'left'].includes(from.anchor) ? from.anchor : 'right'
            },
            to: {
                itemId: toItemId,
                anchor: ['top', 'right', 'bottom', 'left'].includes(to.anchor) ? to.anchor : 'left'
            },
            style: normalizeBoardConnectorStyle(connector.style),
            relationType: normalizeBoardRelationType(connector.relationType),
            color: String(connector.color || '#94a3b8').slice(0, 32),
            width: safeNumber(connector.width, 2, 1, 8),
            label: String(connector.label || '').slice(0, 80)
        };
    }

    function canUseWidget(widgetKey) {
        return canUseWidgetForRole(widgetKey, getEffectiveDashboardRole());
    }

    function getRoleBaseWidgets(role) {
        return ROLE_DASHBOARD_BASE_WIDGETS[role] || ROLE_DASHBOARD_BASE_WIDGETS._default;
    }

    function roleMeetsMinRole(role, minRole) {
        if (!minRole) return true;
        if (!role) return false;
        if (role === 'creator') return true;
        if (typeof ROLE_LEVEL !== 'undefined') {
            const userLevel = ROLE_LEVEL[role];
            const minLevel = ROLE_LEVEL[minRole];
            return Number.isInteger(userLevel) && Number.isInteger(minLevel) && userLevel >= minLevel;
        }
        return role === minRole || (typeof hasMinRole === 'function' && hasMinRole(minRole));
    }

    function canUseWidgetForRole(widgetKey, role) {
        if (DASHBOARD_RETIRED_WIDGETS.has(widgetKey)) return false;
        const def = WIDGET_DEFS[widgetKey];
        if (!def) return false;
        if (getRoleBaseWidgets(role).includes(widgetKey)) return true;
        return roleMeetsMinRole(role, def.minRole);
    }

    function normalizeBoardItem(item, index = 0) {
        if (!item || typeof item !== 'object') return null;
        const rawType = String(item.type || item.kind || '').trim();
        const inferredType = rawType || (item.noteText || item.content || item.body || item.label ? 'note' : '');
        const type = BOARD_ALLOWED_TYPES.has(inferredType) ? inferredType : null;
        if (!type) return null;
        if (item.kind || (!Object.prototype.hasOwnProperty.call(item, 'text') && (item.noteText || item.content || item.body || item.label))) {
            _boardLegacyUpgradePending = true;
        }
        const fallbackId = `board-${type}-${Date.now()}-${index}`;
        const safe = {
            id: String(item.id || fallbackId).slice(0, 90),
            type,
            x: safeNumber(item.x, 40 + (index % 3) * 340, -10000, 10000),
            y: safeNumber(item.y, 40 + Math.floor(index / 3) * 260, -10000, 10000),
            w: safeNumber(item.w, type === 'widget' ? 320 : 240, 80, 1200),
            h: safeNumber(item.h, type === 'widget' ? 220 : 130, 60, 900),
            z: safeNumber(item.z, index + 1, 0, 9999),
            locked: item.locked === true,
            hidden: item.hidden === true
        };
        if (type === 'widget') {
            const widgetType = String(item.widgetType || item.widget || '').trim();
            if (!widgetType || !canUseWidget(widgetType)) return null;
            safe.widgetType = widgetType;
            safe.depth = BOARD_ALLOWED_DEPTHS.has(item.depth) ? item.depth : 'live-compact';
            safe.title = String(item.title || WIDGET_DEFS[widgetType]?.title || widgetType).slice(0, 120);
        } else {
            const legacyText = item.text ?? item.content ?? item.body ?? item.noteText ?? item.label ?? '';
            safe.text = String(legacyText || (type === 'note' ? 'Нова нотатка' : type === 'space' ? 'Зарезервовано як вільний простір.' : '')).slice(0, 5000);
            safe.title = String(item.title || item.label || '').slice(0, 120);
            safe.color = String(item.color || '').slice(0, 40);
            safe.shape = normalizeBoardShape(item.shape || 'rect');
            if (type === 'shape') {
                const dimensions = normalizeBoardShapeDimensions(safe.shape, safe.w, safe.h);
                safe.w = dimensions.w;
                safe.h = dimensions.h;
            }
            if (type === 'space') {
                safe.title = String(item.title || 'Порожня зона').slice(0, 120);
                safe.zoneId = String(item.zoneId || '').slice(0, 80);
                safe.zoneKind = String(item.zoneKind || 'reserved').slice(0, 40);
            }
        }
        return safe;
    }

    function normalizeBoardState(input) {
        if (input && (typeof input !== 'object' || Array.isArray(input))) _boardConfigCorrupt = true;
        const source = safeObject(input, {});
        const viewport = safeObject(source.viewport, {});
        const preferences = safeObject(source.preferences, {});
        const itemsRaw = Array.isArray(source.items) ? source.items : [];
        const drawingsRaw = Array.isArray(source.drawings) ? source.drawings : [];
        const connectorsRaw = Array.isArray(source.connectors) ? source.connectors : [];
        if (source.items && !Array.isArray(source.items)) _boardConfigCorrupt = true;
        if (source.drawings && !Array.isArray(source.drawings)) _boardConfigCorrupt = true;
        if (source.connectors && !Array.isArray(source.connectors)) _boardConfigCorrupt = true;
        return {
            viewport: {
                x: safeNumber(viewport.x, 0, -10000, 10000),
                y: safeNumber(viewport.y, 0, -10000, 10000),
                zoom: safeNumber(viewport.zoom, 1, 0.25, 2)
            },
            items: itemsRaw.slice(0, 120).map(normalizeBoardItem).filter(Boolean),
            drawings: drawingsRaw.slice(0, 500).map(normalizeBoardStroke).filter(Boolean),
            connectors: connectorsRaw.slice(0, 300).map(normalizeBoardConnector).filter(Boolean),
            activeTool: normalizeBoardTool(source.activeTool),
            preferences: {
                snapToGrid: preferences.snapToGrid !== false,
                snapMode: normalizeBoardSnapMode(preferences.snapMode || (preferences.snapToGrid === false ? 'freeform' : 'soft')),
                showGrid: preferences.showGrid !== false,
                showGuides: preferences.showGuides !== false,
                showPlanner: preferences.showPlanner !== false,
                showMiniMap: preferences.showMiniMap === true,
                maxLiveWidgets: safeNumber(preferences.maxLiveWidgets, BOARD_LIVE_WIDGET_CAP, 1, 24),
                strokeColor: String(preferences.strokeColor || '#10b981').slice(0, 32),
                fillColor: String(preferences.fillColor || 'rgba(16, 185, 129, 0.10)').slice(0, 64),
                strokeWidth: safeNumber(preferences.strokeWidth, 2, 1, 12),
                connectorStyle: normalizeBoardConnectorStyle(preferences.connectorStyle),
                relationType: normalizeBoardRelationType(preferences.relationType)
            }
        };
    }

    function normalizeBoardMeta(input) {
        const source = safeObject(input, {});
        if (source.version && Number(source.version) !== BOARD_SCHEMA_VERSION) _boardConfigCorrupt = true;
        return {
            version: BOARD_SCHEMA_VERSION,
            enabled: source.enabled !== false,
            lastSavedAt: source.lastSavedAt || null,
            dirty: false,
            privacy: 'private',
            collaboration: 'personal'
        };
    }

    function normalizeDashboardConfig(config) {
        const defaults = createDefaultDashboardConfig();
        const source = safeObject(config, {});
        const layout = safeObject(source.layout, {});
        const next = {
            ...defaults,
            ...source,
            layout: { ...layout },
            mode: normalizeDashboardMode(source.mode || layout.mode),
            widgets: normalizeDashboardWidgets(source.widgets || defaults.widgets),
            theme: source.theme || defaults.theme,
            presentationMode: normalizeDashboardPresentationMode(source.presentationMode || layout.presentationMode || defaults.presentationMode),
            roleScenePreset: source.roleScenePreset || layout.roleScenePreset || defaults.roleScenePreset,
            sceneOptions: normalizeSceneOptions(source.sceneOptions || layout.sceneOptions || defaults.sceneOptions),
            boardMeta: normalizeBoardMeta(source.boardMeta || layout.boardMeta || defaults.boardMeta),
            boardState: normalizeBoardState(source.boardState || layout.boardState || defaults.boardState)
        };
        next.layout.mode = next.mode;
        next.layout.presentationMode = next.presentationMode;
        next.layout.roleScenePreset = next.roleScenePreset;
        next.layout.sceneOptions = next.sceneOptions;
        next.layout.boardMeta = next.boardMeta;
        next.layout.boardState = next.boardState;
        return next;
    }

    function setBoardRecoveryKey() {
        const user = AppState.currentUser || {};
        const id = user.id || user.username || user.name || 'guest';
        _boardRecoveryKey = `eg_dashboard_board_draft_${id}`;
    }

    function boardSnapshot() {
        return deepClone(_config.boardState || createDefaultDashboardConfig().boardState);
    }

    function pushBoardUndo(label = 'change') {
        _boardUndoStack.push({ label, state: boardSnapshot() });
        if (_boardUndoStack.length > BOARD_UNDO_LIMIT) _boardUndoStack.shift();
        _boardRedoStack = [];
        syncBoardToolbar();
    }

    function markBoardDirty(reason = 'change') {
        if (!_config) return;
        _boardDirty = true;
        _boardSaveStatus = 'dirty';
        _config.mode = DASHBOARD_WORKSPACE_MODE;
        _config.boardMeta = normalizeBoardMeta({ ..._config.boardMeta, dirty: true });
        _config.boardMeta.dirty = true;
        _config.layout = { ...safeObject(_config.layout, {}), mode: _config.mode, boardMeta: _config.boardMeta, boardState: _config.boardState };
        persistBoardDraft(reason);
        syncBoardToolbar();
        scheduleBoardSave();
    }

    function persistBoardDraft(reason = 'change') {
        try {
            localStorage.setItem(_boardRecoveryKey, JSON.stringify({
                updatedAt: new Date().toISOString(),
                reason,
                mode: _config.mode,
                boardState: _config.boardState
            }));
        } catch {}
    }

    async function restoreBoardDraftIfNeeded() {
        let draft = null;
        try {
            draft = JSON.parse(localStorage.getItem(_boardRecoveryKey) || 'null');
        } catch {
            localStorage.removeItem(_boardRecoveryKey);
        }
        if (!draft || !draft.boardState) return;
        const serverSavedAt = _config?.boardMeta?.lastSavedAt ? new Date(_config.boardMeta.lastSavedAt).getTime() : 0;
        const draftSavedAt = draft.updatedAt ? new Date(draft.updatedAt).getTime() : 0;
        if (!draftSavedAt || draftSavedAt <= serverSavedAt) return;
        const message = 'Є локальна незбережена версія board mode. Відновити її?';
        const shouldRestore = await confirmDashboardAction(message, {
            type: 'warning',
            okText: 'Відновити',
            cancelText: 'Не зараз'
        });
        if (!shouldRestore) {
            localStorage.removeItem(_boardRecoveryKey);
            return;
        }
        pushBoardUndo('restore-draft');
        _config.mode = normalizeDashboardMode(draft.mode || _config.mode);
        _config.boardState = normalizeBoardState(draft.boardState);
        markBoardDirty('restore-draft');
    }

    function clearBoardDraft() {
        try { localStorage.removeItem(_boardRecoveryKey); } catch {}
    }

    async function saveDashboardConfig(patch = {}) {
        if (!_config) _config = createDefaultDashboardConfig();
        const nextMode = normalizeDashboardMode(patch.mode || _config.mode);
        const payload = {
            widgets: patch.widgets || _config.widgets || [],
            layout: {
                ...safeObject(_config.layout, {}),
                mode: nextMode,
                presentationMode: patch.presentationMode || _config.presentationMode || 'mixed-scene',
                roleScenePreset: Object.prototype.hasOwnProperty.call(patch, 'roleScenePreset') ? patch.roleScenePreset : _config.roleScenePreset,
                sceneOptions: patch.sceneOptions || _config.sceneOptions || createDefaultDashboardConfig().sceneOptions,
                boardMeta: patch.boardMeta || _config.boardMeta,
                boardState: patch.boardState || _config.boardState
            },
            theme: patch.theme || _config.theme || 'default',
            mode: nextMode,
            presentationMode: patch.presentationMode || _config.presentationMode || 'mixed-scene',
            roleScenePreset: Object.prototype.hasOwnProperty.call(patch, 'roleScenePreset') ? patch.roleScenePreset : _config.roleScenePreset,
            sceneOptions: patch.sceneOptions || _config.sceneOptions || createDefaultDashboardConfig().sceneOptions,
            boardMeta: patch.boardMeta || _config.boardMeta,
            boardState: patch.boardState || _config.boardState
        };
        const resp = await fetch('/api/dashboard/config', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('pzp_token')
            },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const result = await resp.json();
        if (result.success && result.config) {
            _config = normalizeDashboardConfig(result.config);
        }
        return result;
    }

    function scheduleBoardSave() {
        clearTimeout(_boardSaveTimer);
        _boardSaveTimer = setTimeout(saveBoardNow, BOARD_SAVE_DEBOUNCE_MS);
    }

    async function saveBoardNow() {
        if (!_config || !_boardDirty) return;
        _boardSaveStatus = 'saving';
        syncBoardToolbar();
        const lastSavedAt = new Date().toISOString();
        try {
            await saveDashboardConfig({
                mode: _config.mode,
                boardMeta: { ..._config.boardMeta, lastSavedAt, dirty: false },
                boardState: _config.boardState
            });
            _boardDirty = false;
            _boardSaveStatus = 'saved';
            _config.boardMeta = normalizeBoardMeta({ ..._config.boardMeta, lastSavedAt, dirty: false });
            _config.layout.boardMeta = _config.boardMeta;
            clearBoardDraft();
        } catch (err) {
            console.error('[dashboard:board] save failed:', err);
            _boardSaveStatus = 'error';
        }
        syncBoardToolbar();
    }

    function syncBoardToolbar() {
        const isWorkspace = true;
        const gridBtn = document.getElementById('dashboardGridModeBtn');
        const boardBtn = document.getElementById('dashboardBoardModeBtn');
        const controls = document.getElementById('boardEditControls');
        const toolOptions = document.getElementById('boardToolOptions');
        const viewBtn = document.getElementById('boardViewModeBtn');
        const editBtn = document.getElementById('boardEditModeBtn');
        const status = document.getElementById('boardSaveStatus');
        const undoBtn = document.getElementById('boardUndoBtn');
        const redoBtn = document.getElementById('boardRedoBtn');
        syncBoardWorkspaceMode();
        const toolbar = document.getElementById('dashboardBoardToolbar');
        const stage = document.querySelector('.dashboard-workspace-stage');

        gridBtn?.classList.toggle('active', false);
        boardBtn?.classList.toggle('active', isWorkspace);
        controls?.classList.remove('hidden');
        if (toolbar) {
            toolbar.dataset.interactionMode = _boardInteractionMode;
            toolbar.dataset.workspaceMode = _boardWorkspaceMode;
        }
        if (controls) {
            controls.dataset.interactionMode = _boardInteractionMode;
            controls.dataset.workspaceMode = _boardWorkspaceMode;
        }
        if (toolOptions) {
            toolOptions.dataset.interactionMode = _boardInteractionMode;
            toolOptions.dataset.workspaceMode = _boardWorkspaceMode;
        }
        if (stage) {
            stage.dataset.interactionMode = _boardInteractionMode;
            stage.dataset.workspaceMode = _boardWorkspaceMode;
        }
        viewBtn?.classList.toggle('active', _boardWorkspaceMode === 'board:view');
        editBtn?.classList.toggle('active', _boardWorkspaceMode !== 'board:view');
        document.querySelectorAll('[data-board-tool]').forEach(btn => {
            const active = btn.dataset.boardTool === (_config?.boardState?.activeTool || 'select');
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        if (toolOptions) {
            toolOptions.classList.remove('hidden');
            toolOptions.innerHTML = renderBoardToolOptions();
        }
        if (undoBtn) undoBtn.disabled = _boardUndoStack.length === 0;
        if (redoBtn) redoBtn.disabled = _boardRedoStack.length === 0;
        if (status) {
            const text = _boardSaveStatus === 'saving' ? 'Збереження...'
                : _boardSaveStatus === 'dirty' ? 'Є незбережені зміни'
                : _boardSaveStatus === 'error' ? 'Помилка збереження'
                : 'Збережено';
            status.textContent = text;
            status.dataset.state = _boardSaveStatus;
        }
    }

    function renderBoardToolOptions() {
        const tool = normalizeBoardTool(_config?.boardState?.activeTool || 'select');
        const prefs = safeObject(_config?.boardState?.preferences, {});
        const mode = getBoardWorkspaceMode();
        if (_boardInteractionMode === 'view' || mode === 'board:view') {
            const itemCount = getBoardItems().filter(item => !item.hidden).length;
            const spaceCount = getBoardItems().filter(item => item.type === 'space' && !item.hidden).length;
            return `
                <div class="board-tool-current board-operate-summary">
                    <span>Режим роботи</span>
                    <strong>Спокійний dashboard</strong>
                    <em>${itemCount} блоків на сцені${spaceCount ? ` · ${spaceCount} порожніх зон` : ''}. Для композиції відкрийте планування.</em>
                </div>
                <div class="board-builder-quick-add board-operate-actions" aria-label="Швидкі дії dashboard">
                    <button type="button" class="board-tool-snap active" onclick="DashboardPage.setBoardInteractionMode('edit')">Планувати layout</button>
                    <button type="button" class="board-tool-snap" onclick="DashboardPage.openWidgetManager()">Віджети</button>
                    <button type="button" class="board-tool-snap" onclick="DashboardPage.saveBoardNow()">Зберегти</button>
                </div>
            `;
        }
        const label = BOARD_TOOL_LABELS[tool] || tool;
        const modeHint = BOARD_TOOL_HINTS[tool] || 'Перемикайте інструменти як у редакторі.';
        const widgetOptions = renderBoardWidgetPickerOptions();
        return `
            <div class="board-tool-current">
                <span>Інструмент</span>
                <strong>${escapeHtml(label)}</strong>
                <em>${escapeHtml(modeHint)}</em>
            </div>
            <div class="board-builder-quick-add" aria-label="Конструктор dashboard">
                <select class="board-builder-widget-select" id="boardBuilderWidgetSelect" aria-label="Вибрати віджет для dashboard">
                    ${widgetOptions}
                </select>
                <button type="button" class="board-tool-snap" onclick="DashboardPage.addSelectedBoardWidget()">+ Віджет</button>
                <button type="button" class="board-tool-snap" onclick="DashboardPage.addBoardNote()">+ Нотатка</button>
                <button type="button" class="board-tool-snap" onclick="DashboardPage.addBoardSpace()">+ Порожня зона</button>
                <button type="button" class="board-tool-snap" onclick="DashboardPage.saveBoardNow()">Зберегти</button>
            </div>
            <label class="board-tool-check">
                <input type="checkbox" ${prefs.snapToGrid !== false ? 'checked' : ''} onchange="DashboardPage.setBoardPreference('snapToGrid', this.checked)">
                <span>Прив’язка</span>
            </label>
            <div class="board-tool-snap-presets" role="group" aria-label="Режими прив’язки">
                ${['strict', 'soft', 'freeform'].map(mode => `<button type="button" class="board-tool-snap${normalizeBoardSnapMode(prefs.snapMode) === mode ? ' active' : ''}" onclick="DashboardPage.setBoardSnapMode('${mode}')">${BOARD_SNAP_LABELS[mode] || mode}</button>`).join('')}
            </div>
            <label class="board-tool-check">
                <input type="checkbox" ${prefs.showGrid !== false ? 'checked' : ''} onchange="DashboardPage.setBoardPreference('showGrid', this.checked)">
                <span>Сітка</span>
            </label>
            <label class="board-tool-check">
                <input type="checkbox" ${prefs.showGuides !== false ? 'checked' : ''} onchange="DashboardPage.setBoardPreference('showGuides', this.checked)">
                <span>Напрямні</span>
            </label>
            <label class="board-tool-check">
                <input type="checkbox" ${prefs.showPlanner !== false ? 'checked' : ''} onchange="DashboardPage.setBoardPreference('showPlanner', this.checked)">
                <span>План</span>
            </label>
            <label class="board-tool-color" title="Колір малювання">
                <span>Колір</span>
                <input type="color" value="${escapeHtml(prefs.strokeColor || '#10b981')}" onchange="DashboardPage.setBoardPreference('strokeColor', this.value)">
            </label>
            <label class="board-tool-range" title="Товщина лінії">
                <span>${Number(prefs.strokeWidth || 2)}px</span>
                <input type="range" min="1" max="12" value="${Number(prefs.strokeWidth || 2)}" oninput="DashboardPage.setBoardPreference('strokeWidth', this.value)">
            </label>
        `;
    }

    function renderBoardWidgetPickerOptions() {
        const added = new Set(getBoardItems().filter(item => item.type === 'widget').map(item => item.widgetType));
        const options = Object.keys(WIDGET_DEFS)
            .filter(widgetKey => !DASHBOARD_RETIRED_WIDGETS.has(widgetKey))
            .filter(canUseWidget)
            .map(widgetKey => {
                const def = WIDGET_DEFS[widgetKey] || {};
                const suffix = added.has(widgetKey) ? ' · вже є' : '';
                return `<option value="${escapeHtml(widgetKey)}">${escapeHtml(def.title || widgetKey)}${suffix}</option>`;
            });
        return options.length ? options.join('') : '<option value="tasks">Мої задачі</option>';
    }

    async function init() {
        const token = localStorage.getItem('pzp_token');
        if (!token) {
            window.location.href = '/';
            return;
        }

        // Set username
        const savedUser = localStorage.getItem('pzp_current_user');
        if (savedUser) {
            try {
                const user = JSON.parse(savedUser);
                AppState.currentUser = user;
                const el = document.getElementById('currentUser');
                if (el) el.textContent = user.name;
                if (typeof Sidebar !== 'undefined' && Sidebar.initUserCard) Sidebar.initUserCard();
            } catch {}
        }

        // Verify session
        const verified = await apiVerifyToken();
        if (!verified) {
            window.location.href = '/';
            return;
        }
        AppState.currentUser = verified;
        const el = document.getElementById('currentUser');
        if (el) el.textContent = verified.name;
        setBoardRecoveryKey();
        initBoardKeyboard();

        // Decision Screen — before dashboard loads
        if (typeof DecisionScreen !== 'undefined') {
            try { await DecisionScreen.init(); } catch(e) { console.error('[Dashboard] DecisionScreen.init failed:', e); }
        }

        // Load config
        await loadConfig();

        // Init test panel for creator
        initTestPanel();

        // Render greeting
        renderGreeting();
        if (typeof showAuthenticatedPageShell === 'function') showAuthenticatedPageShell();
        else if (typeof Sidebar !== 'undefined' && Sidebar.markShellReady) Sidebar.markShellReady();
    }

    async function loadConfig() {
        try {
            const resp = await fetch('/api/dashboard/config', {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();

            if (data.success) {
                _boardLegacyUpgradePending = false;
                _config = normalizeDashboardConfig(data.config);
                const shouldPersistLegacyUpgrade = _boardLegacyUpgradePending;
                await restoreBoardDraftIfNeeded();
                if (shouldPersistLegacyUpgrade) {
                    _boardLegacyUpgradePending = false;
                    markBoardDirty('legacy-note-upgrade');
                }
                renderWidgets();
            }
        } catch (err) {
            console.error('Dashboard config error:', err);
            // Render with defaults
            _config = normalizeDashboardConfig(createDefaultDashboardConfig());
            renderWidgets();
        }
    }

    function renderGreeting() {
        const greetingEl = document.getElementById('dashboardGreeting');
        if (!greetingEl || !AppState.currentUser) return;

        const hour = new Date().getHours();
        let greeting = 'Привіт';
        if (hour < 6) greeting = 'Доброї ночі';
        else if (hour < 12) greeting = 'Доброго ранку';
        else if (hour < 18) greeting = 'Доброго дня';
        else greeting = 'Доброго вечора';

        const role = getUserRole();
        const roleName = ROLE_NAMES[role] || role;
        greetingEl.textContent = `${greeting}, ${AppState.currentUser.name}!`;
        announceDashboardContextToAssistant(roleName);
    }

    function normalizeAssistantRailMode(value) {
        return ASSISTANT_RAIL_MODES.has(value) ? value : 'idle';
    }

    function hasCanonicalAssistantRail() {
        return Boolean(window.CrmAssistantRail) && !document.getElementById('dashboardAssistantRail');
    }

    function getCanonicalAssistantVoiceEnabled() {
        const storeState = window.CrmAssistantFoundation?.store?.getState?.();
        if (storeState && typeof storeState.voiceEnabled === 'boolean') return storeState.voiceEnabled;
        return localStorage.getItem('eg_crm_assistant_voice') !== 'off';
    }

    function setAssistantRailState(patch = {}) {
        if (hasCanonicalAssistantRail() && window.CrmAssistantRail?.setState) {
            window.CrmAssistantRail.setState(patch);
            return;
        }
        const nextMode = normalizeAssistantRailMode(patch.mode ?? _assistantRailState.mode);
        const subtitle = Object.prototype.hasOwnProperty.call(patch, 'subtitle')
            ? String(patch.subtitle || '')
            : _assistantRailState.subtitle;
        const tickerText = Object.prototype.hasOwnProperty.call(patch, 'tickerText')
            ? String(patch.tickerText || '')
            : _assistantRailState.tickerText;
        _assistantRailState = {
            ..._assistantRailState,
            ...patch,
            mode: nextMode,
            subtitle,
            tickerText,
            updatedAt: new Date().toISOString()
        };
        renderAssistantRail();
    }

    function renderAssistantRail() {
        const rail = document.getElementById('dashboardAssistantRail');
        const stateEl = document.getElementById('assistantRailState');
        const subtitlesWrap = document.getElementById('assistantRailSubtitlesWrap');
        const subtitlesEl = document.getElementById('assistantRailSubtitles');
        const voiceBtn = document.getElementById('assistantRailVoiceToggle');
        const micBtn = document.getElementById('assistantRailMicBtn');
        const replayBtn = document.getElementById('assistantRailReplayBtn');
        if (!rail || !stateEl || !subtitlesEl || !voiceBtn) return;

        const text = _assistantRailState.tickerText || _assistantRailState.subtitle || '...';
        const displayText = assistantDisplayText(text) || '...';
        rail.dataset.mode = _assistantRailState.mode;
        stateEl.textContent = ASSISTANT_RAIL_LABELS[_assistantRailState.mode] || ASSISTANT_RAIL_LABELS.idle;
        stateEl.className = `assistant-rail-state assistant-state-${_assistantRailState.mode}`;
        subtitlesEl.innerHTML = renderAssistantInlineOutput(text);
        subtitlesEl.setAttribute('aria-label', displayText);
        subtitlesEl.classList.remove('is-ticker');
        voiceBtn.textContent = _assistantRailState.voiceEnabled ? '🔊' : '🔇';
        voiceBtn.setAttribute('aria-pressed', _assistantRailState.voiceEnabled ? 'true' : 'false');
        if (micBtn) {
            const isListening = _assistantMediaRecorder?.state === 'recording' || _assistantRailState.mode === 'listening';
            micBtn.classList.toggle('active', isListening);
            micBtn.setAttribute('aria-pressed', isListening ? 'true' : 'false');
            micBtn.title = isListening ? 'Зупинити запис голосу' : 'Голосовий ввід';
        }
        if (replayBtn) replayBtn.disabled = !(_assistantRailState.lastSpokenLine || _assistantRailState.subtitle);

        requestAnimationFrame(() => {
            const shouldScroll = shouldAssistantSubtitleScroll(displayText, subtitlesWrap, subtitlesEl);
            subtitlesEl.classList.toggle('is-ticker', shouldScroll);
        });
    }

    function shouldAssistantSubtitleScroll(text = '', wrap = null, el = null) {
        const normalized = String(text).trim();
        if (normalized.length > 180) return true;
        return !!(wrap && el && (
            el.scrollWidth > wrap.clientWidth + 32 ||
            el.scrollHeight > wrap.clientHeight + 8
        ));
    }

    function toggleAssistantVoice() {
        if (hasCanonicalAssistantRail() && window.CrmAssistantRail?.toggleVoice) {
            window.CrmAssistantRail.toggleVoice();
            return;
        }
        const next = !_assistantRailState.voiceEnabled;
        localStorage.setItem('eg_dashboard_assistant_voice', next ? 'on' : 'off');
        setAssistantRailState({
            voiceEnabled: next,
            mode: next ? 'idle' : 'muted',
            subtitle: next
                ? 'Голос увімкнено. Озвучення запускається тільки з кнопки повтору або голосового запиту.'
                : 'Голос вимкнено. Асистент відповідатиме текстом і субтитрами без озвучення.'
        });
    }

    async function replayAssistantLine() {
        if (hasCanonicalAssistantRail() && window.CrmAssistantRail?.replayLastLine) {
            await window.CrmAssistantRail.replayLastLine();
            return;
        }
        const line = _assistantRailState.lastSpokenLine || _assistantRailState.subtitle || 'Немає останньої репліки для повтору.';
        await playAssistantReply({ text: line, subtitle: line }, {
            addToHistory: false,
            speak: _assistantRailState.voiceEnabled
        });
    }

    function expandAssistantRail() {
        if (hasCanonicalAssistantRail() && window.CrmAssistantRail?.expand) {
            window.CrmAssistantRail.expand();
            return;
        }
        openDashboardAssistantPanel();
    }

    function demoAssistantSpeak(text) {
        const line = String(text || '').trim();
        if (!line) return;
        if (hasCanonicalAssistantRail() && window.CrmAssistantRail?.announceFromPage) {
            window.CrmAssistantRail.announceFromPage(line);
            return;
        }
        setAssistantRailState({
            mode: _assistantRailState.voiceEnabled ? 'idle' : 'muted',
            subtitle: line,
            lastSpokenLine: line
        });
    }

    function announceDashboardContextToAssistant(roleName = '') {
        if (['thinking', 'busy', 'listening', 'speaking'].includes(_assistantRailState.mode)) return;
        const role = getEffectiveDashboardRole();
        const label = roleName || roleDisplayName(role);
        const widgets = getDashboardAssistantWidgetsContext();
        const subtitle = `Я бачу dashboard для ролі ${label}. Можу коротко пояснити віджети, пріоритети і наступний крок.`;
        if (hasCanonicalAssistantRail() && window.CrmAssistantRail?.announceFromPage) {
            window.CrmAssistantRail.announceFromPage(subtitle);
            return;
        }
        setAssistantRailState({
            mode: _assistantRailState.voiceEnabled ? 'idle' : 'muted',
            subtitle,
            tickerText: widgets.length > 8 ? `Активна сцена: ${label}. Видимі блоки: ${widgets.slice(0, 8).join(', ')}.` : ''
        });
    }

    function getDashboardAssistantWidgetsContext() {
        const domWidgets = Array.from(document.querySelectorAll('#dashboardGrid [data-widget]'))
            .map(el => el.dataset.widget)
            .filter(Boolean);
        const source = domWidgets.length ? domWidgets : normalizeDashboardWidgets(_config?.widgets || []);
        return [...new Set(source)].slice(0, 30);
    }

    function buildDashboardAssistantPayload(userMessage, voiceMode = false) {
        const context = getAssistantContext();
        return {
            ...context,
            userMessage: String(userMessage || '').trim(),
            pageContext: typeof window.buildCrmAssistantPageContext === 'function'
                ? window.buildCrmAssistantPageContext({ ...context, pageKey: 'dashboard' })
                : { pageKey: 'dashboard', pathname: '/dashboard', pageTitle: context.sceneTitle || 'Дашборд' },
            voiceMode,
            recentState: {
                mode: _assistantRailState.mode,
                voiceEnabled: _assistantRailState.voiceEnabled,
                previewRole: window.RolePreview?.getPreviewRole?.() || ''
            }
        };
    }

    function getAssistantContext() {
        const role = typeof getUserRole === 'function' ? getUserRole() : AppState.currentUser?.role || '';
        const scene = typeof getEffectiveDashboardScene === 'function' ? getEffectiveDashboardScene() : null;
        const effectiveRole = typeof getEffectiveDashboardRole === 'function' ? getEffectiveDashboardRole() : role;
        return {
            role,
            displayRole: roleDisplayName(effectiveRole),
            page: 'dashboard',
            widgets: getDashboardAssistantWidgetsContext(),
            scenePreset: effectiveRole,
            sceneTitle: scene?.title || '',
            previewRole: window.RolePreview?.getPreviewRole?.() || '',
            intent: 'Поясни dashboard, bottlenecks і наступну найкориснішу дію.'
        };
    }

    async function requestDashboardAssistantReply(userMessage, options = {}) {
        if (hasCanonicalAssistantRail() && window.CrmAssistantRail?.requestGuideReply) {
            return window.CrmAssistantRail.requestGuideReply({
                ...getAssistantContext(),
                userMessage: String(userMessage || '').trim(),
                voiceMode: options.voiceMode === true
            });
        }
        const resp = await fetch('/api/crm-assistant/reply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('pzp_token')
            },
            body: JSON.stringify(buildDashboardAssistantPayload(userMessage, options.voiceMode === true))
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) throw new Error(data.error || `assistant_reply_http_${resp.status}`);
        return data.reply;
    }

    async function transcribeAssistantAudioBlob(blob) {
        const formData = new FormData();
        formData.append('audio', blob, 'dashboard-assistant.webm');
        const resp = await fetch('/api/crm-assistant/transcribe', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') },
            body: formData
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) throw new Error(data.error || `assistant_transcribe_http_${resp.status}`);
        return String(data.text || '').trim();
    }

    function stopAssistantAudioPlayback() {
        if (_assistantAudioPlayer) {
            try {
                _assistantAudioPlayer.pause();
                _assistantAudioPlayer.src = '';
            } catch {}
            _assistantAudioPlayer = null;
        }
        if (_assistantAudioUrl) {
            URL.revokeObjectURL(_assistantAudioUrl);
            _assistantAudioUrl = null;
        }
    }

    async function playAssistantReply(reply, options = {}) {
        if (hasCanonicalAssistantRail() && window.CrmAssistantRail?.playReply) {
            await window.CrmAssistantRail.playReply(reply, {
                textOnly: options.speak !== true || getCanonicalAssistantVoiceEnabled() === false,
                speak: options.speak === true
            });
            return;
        }
        const text = String(reply?.subtitle || reply?.text || '').trim();
        if (!text) return;
        if (options.addToHistory !== false) appendAssistantHistory('assistant', text);
        const shouldPlayAudio = _assistantRailState.voiceEnabled && options.speak === true;
        setAssistantRailState({
            mode: shouldPlayAudio ? 'speaking' : (_assistantRailState.voiceEnabled ? 'idle' : 'muted'),
            subtitle: text,
            tickerText: text,
            lastSpokenLine: text
        });
        renderAssistantHistory();

        if (!shouldPlayAudio) return;
        try {
            stopAssistantAudioPlayback();
            const resp = await fetch('/api/crm-assistant/speak', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + localStorage.getItem('pzp_token')
                },
                body: JSON.stringify({ text })
            });
            if (!resp.ok) {
                const data = await resp.json().catch(() => ({}));
                throw new Error(data.error || `assistant_speak_http_${resp.status}`);
            }
            const blob = await resp.blob();
            _assistantAudioUrl = URL.createObjectURL(blob);
            _assistantAudioPlayer = new Audio(_assistantAudioUrl);
            _assistantAudioPlayer.onended = () => {
                stopAssistantAudioPlayback();
                if (_assistantRailState.mode === 'speaking') setAssistantRailState({ mode: 'idle' });
            };
            _assistantAudioPlayer.onerror = () => {
                stopAssistantAudioPlayback();
                if (_assistantRailState.mode === 'speaking') setAssistantRailState({ mode: 'idle' });
            };
            await _assistantAudioPlayer.play();
        } catch (err) {
            console.warn('[dashboard-assistant] speech playback failed:', err);
            if (_assistantRailState.mode === 'speaking') setAssistantRailState({ mode: 'idle' });
        }
    }

    function handleDashboardAssistantError(error, fallback = 'Не вдалося отримати відповідь асистента.') {
        const code = String(error?.message || '');
        const missingKey = code.includes('openai_not_configured');
        const subtitle = missingKey
            ? 'OpenAI ще не налаштовано на сервері. Потрібен OPENAI_API_KEY у backend env.'
            : fallback;
        setAssistantRailState({ mode: 'error', subtitle, tickerText: subtitle });
        appendAssistantHistory('assistant', subtitle);
        renderAssistantHistory();
    }

    function pickAssistantAudioMimeType() {
        if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
        return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
            .find(type => MediaRecorder.isTypeSupported(type)) || '';
    }

    async function toggleAssistantListening() {
        if (hasCanonicalAssistantRail() && window.CrmAssistantRail?.toggleListening) {
            await window.CrmAssistantRail.toggleListening();
            return;
        }
        if (_assistantMediaRecorder && _assistantMediaRecorder.state === 'recording') {
            _assistantMediaRecorder.stop();
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            handleDashboardAssistantError(new Error('media_recorder_unavailable'), 'Голосовий ввід недоступний у цьому браузері.');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            _assistantListeningStream = stream;
            _assistantAudioChunks = [];
            const mimeType = pickAssistantAudioMimeType();
            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            _assistantMediaRecorder = recorder;

            recorder.ondataavailable = event => {
                if (event.data && event.data.size > 0) _assistantAudioChunks.push(event.data);
            };
            recorder.onstop = async () => {
                const chunks = _assistantAudioChunks.slice();
                _assistantAudioChunks = [];
                if (_assistantListeningStream) {
                    _assistantListeningStream.getTracks().forEach(track => track.stop());
                    _assistantListeningStream = null;
                }
                if (!chunks.length) {
                    setAssistantRailState({ mode: 'idle', subtitle: 'Не почувив голос. Спробуй ще раз.' });
                    return;
                }
                try {
                    setAssistantRailState({ mode: 'thinking', subtitle: 'Розпізнаю голос і готую відповідь...' });
                    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
                    const transcript = await transcribeAssistantAudioBlob(blob);
                    if (!transcript) throw new Error('empty_transcript');
                    appendAssistantHistory('user', transcript);
                    setAssistantRailState({ mode: 'thinking', subtitle: `Почув: ${transcript}` });
                    const reply = await requestDashboardAssistantReply(transcript, { voiceMode: true });
                    await playAssistantReply(reply, { speak: _assistantRailState.voiceEnabled });
                } catch (err) {
                    handleDashboardAssistantError(err, 'Не вдалося розпізнати голос або підготувати відповідь.');
                }
            };

            setAssistantRailState({ mode: 'listening', subtitle: 'Слухаю тебе. Говори природно.' });
            recorder.start();
        } catch (err) {
            handleDashboardAssistantError(err, 'Не вдалося увімкнути мікрофон.');
        }
    }

    function appendAssistantHistory(role, text) {
        const line = String(text || '').trim();
        if (!line) return;
        _assistantHistory.push({ role, text: line, at: new Date().toISOString() });
        if (_assistantHistory.length > 16) _assistantHistory = _assistantHistory.slice(-16);
    }

    function openDashboardAssistantPanel() {
        const prev = document.getElementById('dashboardAssistantPanelOverlay');
        if (prev) {
            renderAssistantHistory();
            return;
        }
        const overlay = document.createElement('div');
        overlay.id = 'dashboardAssistantPanelOverlay';
        overlay.className = 'dashboard-assistant-panel-overlay';
        overlay.innerHTML = `
            <div class="dashboard-assistant-panel" role="dialog" aria-modal="true" aria-label="AI-провідник dashboard">
                <div class="dashboard-assistant-panel-header">
                    <div>
                        <strong>Помічник</strong>
                        <span>AI-провідник dashboard</span>
                    </div>
                    <button type="button" class="assistant-panel-close" aria-label="Закрити" onclick="DashboardPage.closeDashboardAssistantPanel()">×</button>
                </div>
                <div class="dashboard-assistant-history" id="dashboardAssistantHistory"></div>
                <div class="dashboard-assistant-quick-prompts">
                    <button type="button" onclick="DashboardPage.runAssistantQuickPrompt('Що для мене зараз головне на dashboard?')">Головне зараз</button>
                    <button type="button" onclick="DashboardPage.runAssistantQuickPrompt('Поясни цей dashboard моєю роллю')">Поясни сцену</button>
                    <button type="button" onclick="DashboardPage.runAssistantQuickPrompt('Що зараз найважливіше зробити?')">Наступний крок</button>
                    <button type="button" onclick="DashboardPage.runAssistantQuickPrompt('Проведи мене по віджетах')">По віджетах</button>
                </div>
                <form class="dashboard-assistant-form" onsubmit="DashboardPage.submitAssistantPrompt(event)">
                    <textarea id="dashboardAssistantPromptInput" rows="3" maxlength="1200" placeholder="Запитай по dashboard..."></textarea>
                    <button type="submit" class="dashboard-btn primary">Запитати</button>
                </form>
                <div class="dashboard-assistant-disclosure">Голосові відповіді генерує AI.</div>
            </div>
        `;
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closeDashboardAssistantPanel();
        });
        document.body.appendChild(overlay);
        renderAssistantHistory();
        const input = document.getElementById('dashboardAssistantPromptInput');
        if (input) input.focus();
    }

    function closeDashboardAssistantPanel() {
        if (hasCanonicalAssistantRail() && window.CrmAssistantRail?.closePanel && !document.getElementById('dashboardAssistantPanelOverlay')) {
            window.CrmAssistantRail.closePanel();
            return;
        }
        const overlay = document.getElementById('dashboardAssistantPanelOverlay');
        if (overlay) overlay.remove();
    }

    function renderAssistantHistory() {
        const container = document.getElementById('dashboardAssistantHistory');
        if (!container) return;
        const items = _assistantHistory.length
            ? _assistantHistory
            : [{ role: 'assistant', text: _assistantRailState.subtitle || 'Я готовий допомогти з dashboard.' }];
        container.innerHTML = items.map(item => `
            <div class="dashboard-assistant-history-item ${escapeHtml(item.role)}">
                <span>${item.role === 'user' ? 'Ти' : 'Помічник'}</span>
                ${renderAssistantHistoryBody(item.role, item.text)}
            </div>
        `).join('');
        container.scrollTop = container.scrollHeight;
    }

    async function runAssistantQuickPrompt(prompt) {
        if (hasCanonicalAssistantRail() && window.CrmAssistantRail?.requestGuideReply && !document.getElementById('dashboardAssistantPanelOverlay')) {
            window.CrmAssistantRail.expand();
            const reply = await window.CrmAssistantRail.requestGuideReply({
                ...getAssistantContext(),
                userMessage: String(prompt || '').trim()
            });
            await window.CrmAssistantRail.playReply(reply, { textOnly: true, speak: false });
            return;
        }
        await submitAssistantPromptText(prompt);
    }

    async function submitAssistantPrompt(event) {
        event.preventDefault();
        const input = document.getElementById('dashboardAssistantPromptInput');
        const text = input ? input.value.trim() : '';
        if (input) input.value = '';
        await submitAssistantPromptText(text);
    }

    async function submitAssistantPromptText(text) {
        const prompt = String(text || '').trim();
        if (!prompt) return;
        appendAssistantHistory('user', prompt);
        renderAssistantHistory();
        setAssistantRailState({ mode: 'thinking', subtitle: 'Думаю над відповіддю по dashboard...' });
        try {
            const reply = await requestDashboardAssistantReply(prompt);
            await playAssistantReply(reply, { speak: false });
        } catch (err) {
            handleDashboardAssistantError(err);
        }
    }

    async function loadWorkQueue() {
        const panel = document.getElementById('workQueuePanel');
        const body = document.getElementById('workQueueBody');
        if (!panel || !body) return;

        if (typeof hasMinRole === 'function' && !hasMinRole('manager')) {
            panel.hidden = true;
            return;
        }

        panel.hidden = false;
        body.innerHTML = '<div class="widget-loading">Завантаження черги...</div>';
        renderWorkQueueScopeControls();
        _workQueueSelection.clear();

        try {
            const params = new URLSearchParams({
                replyScope: _workQueueReplyScope,
                replySla: _workQueueReplyFilters.sla,
                replyOwner: _workQueueReplyFilters.owner,
                replyEscalation: _workQueueReplyFilters.escalation,
                limit: '12'
            });
            const resp = await fetch(`/api/work-queue?${params.toString()}`, {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
            });
            if (resp.status === 403 || resp.status === 401) {
                panel.hidden = true;
                return;
            }
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            const queue = data.queue || {};
            renderWorkQueue(queue, body);
            return queue;
        } catch (err) {
            console.error('Work queue load error:', err);
            if (window.Explainability) Explainability.setRegion('workQueueExplainability', '');
            body.innerHTML = '<div class="widget-empty">Не вдалося завантажити робочу чергу</div>';
            return null;
        }
    }

    function normalizeWorkQueueReplyScope(value) {
        return ['mine', 'team', 'all'].includes(value) ? value : 'all';
    }

    function normalizeReplyConsoleFilters(value = {}) {
        const filters = value && typeof value === 'object' ? value : {};
        return {
            sla: ['all', 'overdue', 'due_soon', 'on_track', 'none'].includes(filters.sla) ? filters.sla : 'all',
            owner: ['all', 'with_owner', 'without_owner'].includes(filters.owner) ? filters.owner : 'all',
            escalation: ['all', 'escalated', 'not_escalated'].includes(filters.escalation) ? filters.escalation : 'all',
            preset: ['all', 'mine_overdue', 'team_overdue', 'unassigned', 'escalated'].includes(filters.preset) ? filters.preset : 'all'
        };
    }

    function loadReplyConsoleFilters() {
        try {
            return normalizeReplyConsoleFilters(JSON.parse(localStorage.getItem('eg_reply_console_filters') || '{}'));
        } catch {
            return normalizeReplyConsoleFilters();
        }
    }

    function saveReplyConsoleFilters() {
        localStorage.setItem('eg_reply_console_filters', JSON.stringify(_workQueueReplyFilters));
    }

    function clearWorkQueueSelection() {
        _workQueueSelection.clear();
        document.querySelectorAll('.work-queue-select input[type="checkbox"]').forEach(input => {
            input.checked = false;
        });
        updateReplyOpsSelectionState();
    }

    function workQueueReplyScopeLabel(scope) {
        switch (scope) {
            case 'mine': return 'Мої';
            case 'team': return 'Команда';
            default: return 'Усі';
        }
    }

    function renderWorkQueueScopeControls(meta = {}) {
        const target = document.getElementById('workQueueScopeControls');
        if (!target) return;
        const active = normalizeWorkQueueReplyScope(meta.replyBacklog?.scope || _workQueueReplyScope);
        const scopes = ['mine', 'team', 'all'];
        target.innerHTML = scopes.map(scope => `
            <button type="button"
                class="work-queue-scope-btn${scope === active ? ' active' : ''}"
                aria-pressed="${scope === active ? 'true' : 'false'}"
                onclick="DashboardPage.setWorkQueueReplyScope('${scope}')">
                ${escapeHtml(workQueueReplyScopeLabel(scope))}
            </button>
        `).join('');
    }

    function replyConsoleFilterLabel(type, value) {
        const labels = {
            sla: {
                all: 'Усі SLA',
                overdue: 'Прострочені',
                due_soon: 'Скоро спливає',
                on_track: 'В нормі',
                none: 'Без SLA'
            },
            owner: {
                all: 'Усі власники',
                with_owner: 'З власником',
                without_owner: 'Без власника'
            },
            escalation: {
                all: 'Усі ескалації',
                escalated: 'Лише ескальовані',
                not_escalated: 'Без ескалації'
            },
            preset: {
                all: 'Усі',
                mine_overdue: 'Мої прострочені',
                team_overdue: 'Прострочені команди',
                unassigned: 'Без відповідального',
                escalated: 'Ескальовані'
            }
        };
        return labels[type]?.[value] || value || 'Усі';
    }

    function renderReplyConsoleSelect(id, label, type, options, value) {
        const opts = options.map(option => `
            <option value="${escapeHtml(option)}"${option === value ? ' selected' : ''}>${escapeHtml(replyConsoleFilterLabel(type, option))}</option>
        `).join('');
        return `
            <label class="reply-ops-filter" for="${id}">
                <span>${escapeHtml(label)}</span>
                <select id="${id}" onchange="DashboardPage.setReplyConsoleFilter('${type}', this.value)">
                    ${opts}
                </select>
            </label>
        `;
    }

    function renderReplyOperationsConsole(queue, waitingItems) {
        const items = Array.isArray(waitingItems) ? waitingItems : [];
        const meta = queue.meta?.replyBacklog || {};
        const filters = normalizeReplyConsoleFilters({ ..._workQueueReplyFilters, ...(meta.filters || {}) });
        const visibleCount = items.length;
        const overdueCount = items.filter(item => item.meta?.replySlaState === 'overdue').length;
        const dueSoonCount = items.filter(item => item.meta?.replySlaState === 'due_soon').length;
        const escalatedCount = items.filter(item => item.meta?.replyEscalationTaskId).length;
        const unassignedCount = items.filter(item => !item.meta?.replyOwnerUserId).length;

        return `
            <section class="reply-ops-console" aria-label="Операції з відповідями">
                <div class="reply-ops-toolbar">
                    <div class="reply-ops-title">
                        <span>Операції з відповідями</span>
                        <small>${escapeHtml(workQueueReplyScopeLabel(_workQueueReplyScope))} · ${escapeHtml(replyConsoleFilterLabel('preset', filters.preset))}</small>
                    </div>
                    <div class="reply-ops-summary" aria-label="Підсумок видимого беклогу відповідей">
                        <span class="reply-ops-chip">Видимо ${visibleCount}</span>
                        <span class="reply-ops-chip danger">Прострочено ${overdueCount}</span>
                        <span class="reply-ops-chip warning">Скоро дедлайн ${dueSoonCount}</span>
                        <span class="reply-ops-chip">Ескальовано ${escalatedCount}</span>
                        <span class="reply-ops-chip muted">Без відповідального ${unassignedCount}</span>
                    </div>
                </div>
                <div class="reply-ops-filters">
                    ${renderReplyConsoleSelect('replyOpsPreset', 'Набір', 'preset', ['all', 'mine_overdue', 'team_overdue', 'unassigned', 'escalated'], filters.preset)}
                    ${renderReplyConsoleSelect('replyOpsSla', 'SLA', 'sla', ['all', 'overdue', 'due_soon', 'on_track', 'none'], filters.sla)}
                    ${renderReplyConsoleSelect('replyOpsOwner', 'Відповідальний', 'owner', ['all', 'with_owner', 'without_owner'], filters.owner)}
                    ${renderReplyConsoleSelect('replyOpsEscalation', 'Ескалація', 'escalation', ['all', 'escalated', 'not_escalated'], filters.escalation)}
                    <button type="button" class="reply-ops-link-btn" onclick="DashboardPage.resetReplyConsoleFilters()">Скинути</button>
                </div>
                <div class="reply-ops-bulkbar" aria-live="polite">
                    <div class="reply-ops-selection">
                        <button type="button" class="reply-ops-link-btn" onclick="DashboardPage.selectVisibleReplyItems()" ${visibleCount ? '' : 'disabled'}>Обрати видимі</button>
                        <button type="button" class="reply-ops-link-btn" onclick="DashboardPage.clearWorkQueueSelection()">Зняти вибір</button>
                        <span id="replyOpsSelectionCount">Обрано 0</span>
                    </div>
                    <div class="reply-ops-bulk-actions">
                        <button type="button" class="work-queue-action-btn reply-ops-bulk-action" data-reply-bulk-action onclick="DashboardPage.bulkReassignReplyOwners(this)" disabled>Відповідальний</button>
                        <button type="button" class="work-queue-action-btn reply-ops-bulk-action" data-reply-bulk-action onclick="DashboardPage.bulkSnoozeReplySla(this)" disabled>SLA +24 год</button>
                        <button type="button" class="work-queue-action-btn danger reply-ops-bulk-action" data-reply-bulk-action onclick="DashboardPage.bulkClearReplyExpectations(this)" disabled>Очистити</button>
                    </div>
                    <div class="reply-ops-feedback${_replyOpsFlash?.tone ? ' ' + _replyOpsFlash.tone : ''}" id="replyOpsFeedback" role="status" aria-live="polite">${escapeHtml(_replyOpsFlash?.message || '')}</div>
                </div>
            </section>
        `;
    }

    function priorityBandLabel(band) {
        switch (band) {
            case 'critical': return 'Критично';
            case 'action_today': return 'Дія сьогодні';
            case 'watch': return 'На контролі';
            case 'suggested': return 'Підказка';
            default: return 'Операційний сигнал';
        }
    }

    function intelligenceConfidenceLabel(confidence) {
        switch (confidence) {
            case 'high': return 'Висока';
            case 'medium': return 'Середня';
            case 'low': return 'Низька';
            case 'exact': return 'Точна';
            case 'durable': return 'Довірена';
            default: return confidence ? humanizeQueueRiskType(confidence) : 'Середня';
        }
    }

    function humanizeQueueRiskType(type) {
        const normalized = String(type || '').trim();
        const map = {
            missing_deadline: 'немає дедлайну',
            missing_owner: 'немає відповідального',
            legacy_unknown_owner: 'legacy-відповідальний без user id',
            reply_expected: 'очікується відповідь клієнта',
            reply_escalated: 'відповідь ескальована',
            reply_overdue: 'прострочена відповідь клієнту',
            reply_sla_overdue: 'прострочена SLA відповіді',
            reply_sla_due_soon: 'SLA відповіді скоро спливає',
            reply_sla_on_track: 'SLA відповіді в нормі',
            reply_sla_missing: 'SLA відповіді не задана',
            reply_unassigned: 'немає відповідального за відповідь',
            due_soon: 'наближається дедлайн',
            unassigned: 'немає відповідального',
            late_preliminary: 'пізнє попереднє бронювання',
            no_owner: 'без відповідального',
            stale_followup: 'прострочений follow-up',
            waiting_reply: 'очікування відповіді клієнта',
            callback_due: 'потрібен зворотний контакт',
            callback_due_today: 'зворотний контакт сьогодні',
            callback_due_soon: 'зворотний контакт скоро',
            task_overdue: 'прострочена задача',
            deadline_today: 'дедлайн сьогодні',
            future_deadline: 'майбутній дедлайн',
            critical_priority: 'критичний пріоритет',
            overdue_high_priority: 'високий пріоритет прострочення',
            overdue_unassigned: 'прострочено без відповідального',
            stale_in_progress: 'зависла задача в роботі',
            booking_needs_confirmation: 'бронювання потребує підтвердження',
            confirmation_due_today: 'підтвердження потрібне сьогодні',
            confirmation_due_soon: 'підтвердження скоро потрібне',
            event_soon: 'подія наближається',
            event_near_window: 'подія в найближчому вікні',
            event_watch_window: 'подія на контролі',
            tomorrow_booking_prep: 'підготовка бронювання на завтра',
            visible_overdue_tasks: 'видимі прострочені задачі',
            unassigned_overdue_tasks: 'прострочені задачі без відповідального',
            unassigned_urgent_replies: 'термінові відповіді без відповідального',
            escalated_replies: 'ескальовані відповіді',
            queue_signal: 'сигнал черги',
            critical: 'критично',
            action_today: 'дія сьогодні',
            watch: 'на контролі',
            suggested: 'підказка',
            high: 'висока',
            medium: 'середня',
            low: 'низька'
        };
        if (!normalized) return 'невідомий ризик';
        return map[normalized] || normalized.replaceAll('_', ' ');
    }

    function humanizeQueueBottleneck(label, type) {
        const normalized = String(label || type || '').trim();
        const labelMap = {
            'Unassigned urgent replies': 'термінові відповіді без відповідального',
            'Escalated replies': 'ескальовані відповіді',
            'Visible overdue task pressure': 'тиск видимих прострочених задач',
            'Unassigned overdue tasks': 'прострочені задачі без відповідального'
        };
        if (labelMap[normalized]) return labelMap[normalized];
        return humanizeQueueRiskType(type || normalized);
    }

    function humanizeQueueActionLabel(label, type = '') {
        const normalized = String(label || type || '').trim();
        const map = {
            'Open Omni and reply': 'Відкрити комунікацію й відповісти',
            'Open reply escalation context': 'Відкрити контекст ескалації відповіді',
            'Open lead and call client': 'Відкрити лід і звʼязатися з клієнтом',
            'Confirm booking': 'Підтвердити бронювання',
            'Open booking context': 'Відкрити контекст бронювання',
            'Review event context': 'Перевірити контекст події',
            'Review lead context': 'Перевірити контекст ліда',
            'Review tomorrow booking': 'Перевірити бронювання на завтра',
            'Open context': 'Відкрити контекст',
            'Open task context': 'Відкрити контекст задачі',
            'Open overdue task': 'Відкрити прострочену задачу',
            'Open task': 'Відкрити задачу',
            'Complete or reassign task': 'Виконати або перепризначити задачу',
            'Assign owner before execution': 'Призначити відповідального перед виконанням',
            'Assign owner': 'Призначити відповідального',
            'Assign owner now': 'Призначити відповідального зараз',
            'Start or reschedule task': 'Почати або перенести задачу',
            'Review task plan': 'Перевірити план задачі',
            'Inspect blockage': 'Перевірити блокер',
            reply_now: 'Відповісти клієнту',
            open_reply_escalation: 'Відкрити ескалацію відповіді',
            open_lead_for_callback: 'Відкрити лід для контакту',
            confirm_booking: 'Підтвердити бронювання',
            open_booking_context: 'Відкрити контекст бронювання',
            review_event_context: 'Перевірити контекст події',
            review_lead: 'Перевірити лід',
            open_context: 'Відкрити контекст',
            open_task: 'Відкрити задачу',
            open_task_or_case: 'Відкрити задачу або кейс',
            complete_or_reassign: 'Виконати або перепризначити',
            assign_owner: 'Призначити відповідального',
            start_or_reschedule: 'Почати або перенести',
            review_task_plan: 'Перевірити план задачі',
            inspect_blockage: 'Перевірити блокер'
        };
        if (!normalized) return '';
        return map[normalized] || normalized;
    }

    function renderQueueIntelligenceSummary(queue) {
        const intelligence = queue?.meta?.intelligence || {};
        const bands = intelligence.priorityBands || {};
        const bottlenecks = Array.isArray(intelligence.bottlenecks) ? intelligence.bottlenecks : [];
        const topRisks = Array.isArray(intelligence.topRisks) ? intelligence.topRisks : [];
        const critical = Number(bands.critical || 0);
        const actionToday = Number(bands.action_today || 0);
        const watch = Number(bands.watch || 0);
        const suggested = Number(bands.suggested || 0);
        const topBottleneck = bottlenecks[0];
        const topRisk = topRisks[0];

        if (!queue?.items?.length && !critical && !actionToday && !watch && !suggested) return '';

        return `
            <section class="work-queue-intelligence" aria-label="Аналітика робочої черги">
                <div class="work-queue-intelligence-head">
                    <div>
                        <span class="work-queue-triage-eyebrow">Черга</span>
                        <h3>Пріоритети</h3>
                    </div>
                    <span class="work-queue-intelligence-scope">Видима черга · без глобального скорингу</span>
                </div>
                <div class="work-queue-intelligence-chips">
                    <span class="queue-band-pill band-critical">Критично ${critical}</span>
                    <span class="queue-band-pill band-action_today">Дія сьогодні ${actionToday}</span>
                    <span class="queue-band-pill band-watch">На контролі ${watch}</span>
                    <span class="queue-band-pill band-suggested">Підказки ${suggested}</span>
                </div>
                <div class="work-queue-intelligence-notes">
                    <span>${escapeHtml(topRisk ? `Ризик: ${humanizeQueueRiskType(topRisk.type)} (${topRisk.count})` : 'Ризики з полів категорії')}</span>
                    <span>${escapeHtml(topBottleneck ? `Вузько: ${humanizeQueueBottleneck(topBottleneck.label, topBottleneck.type)} (${topBottleneck.count})` : 'Лише видима черга')}</span>
                </div>
            </section>
        `;
    }

    function renderFunnelInsights(queue) {
        const funnel = queue?.meta?.funnelInsights || {};
        const stages = Array.isArray(funnel.stages)
            ? funnel.stages.filter(stage => Number(stage.total || 0) > 0).slice(0, 5)
            : [];
        const total = Number(funnel.total || 0);
        const waitingAction = Number(funnel.waitingAction || 0);
        const hotStage = funnel.hotStage || stages.find(stage => Number(stage.waitingAction || 0) > 0) || stages[0] || null;

        if (!total && !stages.length) return '';

        const stageChips = stages.map(stage => `
            <a class="work-queue-funnel-chip" href="${escapeHtml(stage.href || `/sales-funnel?stage=${encodeURIComponent(stage.stage || '')}`)}">
                <span>${escapeHtml(stage.label || stage.stage || 'Етап')}</span>
                <strong>${Number(stage.waitingAction || 0)}/${Number(stage.total || 0)}</strong>
            </a>
        `).join('');

        return `
            <section class="work-queue-funnel-insights" aria-label="Інформація по воронці лідів">
                <div class="work-queue-funnel-head">
                    <div>
                        <span class="work-queue-triage-eyebrow">Воронка</span>
                        <h3>Ліди у роботі</h3>
                    </div>
                    <a class="work-queue-funnel-link" href="${escapeHtml(funnel.href || '/sales-funnel')}">Відкрити</a>
                </div>
                <div class="work-queue-funnel-metrics">
                    <span><strong>${total}</strong> активних</span>
                    <span><strong>${waitingAction}</strong> чекає дії</span>
                    <span><strong>${escapeHtml(hotStage?.label || 'Без етапу')}</strong> найгарячіше</span>
                </div>
                <div class="work-queue-funnel-stages">${stageChips}</div>
            </section>
        `;
    }

    function syncWorkQueuePanelMode() {
        const hasSelection = Boolean(_workQueueSelectedItemId && _workQueueItemsById.has(_workQueueSelectedItemId));
        document.getElementById('workQueuePanel')?.classList.toggle('has-triage-selection', hasSelection);
        document.getElementById('workQueueBody')?.classList.toggle('has-triage-selection', hasSelection);
    }

    function renderWorkQueue(queue, container) {
        const buckets = Array.isArray(queue.buckets) ? queue.buckets : [];
        const visibleBuckets = buckets.filter(bucket => bucket.count > 0 || (bucket.items && bucket.items.length > 0));
        const waitingBucket = buckets.find(bucket => bucket.key === 'waiting_reply') || { items: [], count: 0 };
        const visibleReplyItems = Array.isArray(waitingBucket.items) ? waitingBucket.items : [];
        const visibleItems = visibleBuckets.flatMap(bucket => {
            const maxItems = bucket.key === 'waiting_reply' ? 12 : 4;
            return (bucket.items || []).slice(0, maxItems);
        });
        _workQueueItemsById = new Map(visibleItems.map(item => [String(item.id || `${item.bucket}:${item.sourceType}:${item.sourceId}`), item]));
        _workQueueVisibleItemIds = visibleItems.map(item => String(item.id || `${item.bucket}:${item.sourceType}:${item.sourceId}`));
        if (_workQueueSelectedItemId && !_workQueueItemsById.has(_workQueueSelectedItemId)) {
            _workQueueSelectedItemId = null;
            _replyActionHistoryState = { itemId: null, conversationId: null, status: 'idle', events: [], error: null };
            _taskActionHistoryState = { itemId: null, taskId: null, status: 'idle', events: [], error: null };
        }
        _workQueueVisibleReplyIds = visibleReplyItems
            .map(item => Number(item.meta?.conversationId || item.sourceId || 0))
            .filter(id => Number.isInteger(id) && id > 0);
        const subtitle = document.getElementById('workQueueSubtitle');
        if (subtitle && queue.date) {
            subtitle.textContent = `Сьогодні ${formatQueueDate(queue.date.today)} · сформовано ${formatQueueDateTime(queue.generatedAt)}`;
        }
        renderWorkQueueScopeControls(queue.meta || {});
        renderWorkQueueExplainability(queue, buckets, visibleBuckets.length);

        if (!visibleBuckets.length) {
            container.innerHTML = `${renderReplyOperationsConsole(queue, visibleReplyItems)}
                ${renderQueueIntelligenceSummary(queue)}
                ${renderFunnelInsights(queue)}
                ${renderTriageWorkspace()}
                <div class="widget-empty reply-ops-empty">Немає термінових пунктів у доступних категоріях черги. Очікування відповіді зʼявляється лише для розмов із явною потребою відповісти клієнту.</div>`;
            return;
        }

        const bucketsHtml = visibleBuckets.map(bucket => {
            const maxItems = bucket.key === 'waiting_reply' ? 12 : 4;
            const items = (bucket.items || []).slice(0, maxItems).map(renderWorkQueueItem).join('');
            return `
                <div class="work-queue-bucket bucket-${bucket.key}">
                    <div class="work-queue-bucket-head">
                        <span class="work-queue-bucket-title">${escapeHtml(workQueueBucketLabel(bucket.key, bucket.label))}</span>
                        <span class="work-queue-count">${bucket.count || 0}</span>
                    </div>
                    <div class="work-queue-items">${items}</div>
                </div>
            `;
        }).join('');

        container.innerHTML = `${renderReplyOperationsConsole(queue, visibleReplyItems)}
            ${renderQueueIntelligenceSummary(queue)}
            ${renderFunnelInsights(queue)}
            <div class="work-queue-buckets" aria-label="Пункти робочої черги">${bucketsHtml}</div>
            ${renderTriageWorkspace()}`;
        syncWorkQueuePanelMode();
        updateReplyOpsSelectionState();
    }

    function renderWorkQueueExplainability(queue, buckets, visibleCount) {
        const target = document.getElementById('workQueueExplainability');
        if (!target || !window.Explainability) return;
        const meta = queue.meta || {};
        const bucketMap = new Map((buckets || []).map(bucket => [bucket.key, bucket.label || bucket.key]));
        const warnings = Array.isArray(meta.warnings) ? meta.warnings : [];
        const omitted = Array.isArray(meta.omittedBuckets) ? meta.omittedBuckets : [];
        const heuristic = Array.isArray(meta.heuristicBuckets) ? meta.heuristicBuckets : [];
        const filters = [];
        const replyBacklog = meta.replyBacklog || {};

        if (warnings.length) filters.push({ label: 'Увага', value: `${warnings.length} джерел не відповіли` });
        if (replyBacklog.scope) filters.push({ label: 'Беклог відповідей', value: workQueueReplyScopeLabel(replyBacklog.scope) });
        if (Number(meta.funnelInsights?.total || 0) > 0) {
            filters.push({
                label: 'Воронка',
                value: `${Number(meta.funnelInsights.total || 0)} лідів · ${Number(meta.funnelInsights.waitingAction || 0)} чекає дії`
            });
        }
        if (omitted.length) filters.push({ label: 'Не включено', value: omitted.map(key => bucketMap.get(key) || key).join(', ') });
        const activeHeuristic = heuristic.filter(key => (buckets || []).some(bucket => bucket.key === key && bucket.count > 0));
        if (activeHeuristic.length) {
            filters.push({ label: 'Підказки', value: activeHeuristic.map(key => bucketMap.get(key) || key).join(', ') });
        }
        if (meta.intelligence?.model) {
            filters.push({ label: 'Аналітика', value: 'пріоритети за категоріями без глобального скорингу' });
        }

        const note = !visibleCount ? 'Порожньо: доступні довірені сигнали зараз не дали термінових пунктів' : '';
        const html = Explainability.renderFilterSummary(filters, {
            label: 'Пояснення черги',
            note
        });
        Explainability.setRegion(target, html);
    }

    function replySlaLabel(state) {
        switch (state) {
            case 'overdue': return 'SLA прострочено';
            case 'due_soon': return 'SLA скоро спливає';
            case 'on_track': return 'SLA в нормі';
            default: return '';
        }
    }

    function getWorkQueueItemId(item) {
        return String(item?.id || `${item?.bucket || 'item'}:${item?.sourceType || 'source'}:${item?.sourceId || ''}`);
    }

    function workQueueBucketLabel(key, fallbackLabel = '') {
        const item = _workQueueItemsById.get(_workQueueSelectedItemId);
        if (item?.bucket === key && item?.bucketLabel && !/^[a-z0-9_ /-]+$/i.test(String(item.bucketLabel))) return item.bucketLabel;
        if (fallbackLabel && !/^[a-z0-9_ /-]+$/i.test(String(fallbackLabel))) return fallbackLabel;
        const labels = {
            overdue: 'Прострочені задачі',
            today: 'Сьогодні',
            tomorrow: 'Завтра',
            callback_due: 'Потрібен контакт',
            waiting_reply: 'Очікує відповіді',
            needs_confirmation: 'Потребує підтвердження',
            event_soon: 'Подія скоро'
        };
        return labels[key] || humanizeQueueRiskType(key) || 'Пункт черги';
    }

    function triageRiskLabel(item) {
        if (!item) return 'Без вибору';
        if (item.intelligence?.priorityBand) return priorityBandLabel(item.intelligence.priorityBand);
        if (item.bucket === 'waiting_reply') {
            return replySlaLabel(item.meta?.replySlaState) || 'Очікуємо відповідь';
        }
        if (item.bucket === 'overdue') return 'Прострочено';
        if (item.priority === 'critical' || item.priority === 'high') return 'Високий ризик';
        if (item.confidence === 'suggested') return 'Підказка, не hard truth';
        return 'Операційний сигнал';
    }

    function humanizeQueueSignal(signal) {
        return signal ? humanizeQueueRiskType(signal) : '';
    }

    function humanizeQueueReasonText(text) {
        const value = String(text || '').trim();
        if (!value) return '';
        const timestamp = value.match(/\(([^)]+)\)/)?.[1];
        const suffix = timestamp ? ` (${timestamp})` : '';
        if (/reply_sla_at is overdue/i.test(value)) return `SLA відповіді прострочена${suffix}.`;
        if (/reply_sla_at is due soon/i.test(value)) return `SLA відповіді скоро спливає${suffix}.`;
        if (/reply_sla_at is still on track/i.test(value)) return `SLA відповіді поки в нормі${suffix}.`;
        if (/No reply_sla_at is present/i.test(value)) return 'SLA відповіді не задана, тому прострочення не виводиться автоматично.';
        if (/linked conversation_reply escalation task exists/i.test(value)) return `Є повʼязана задача ескалації відповіді${suffix}.`;
        if (/reply_owner_user_id is empty/i.test(value)) return 'Відповідальний за відповідь ще не заданий як ID користувача.';
        if (/lead_interactions\.follow_up_date placed this item in callback_due/i.test(value)) return `Дата follow-up поставила цей пункт у зворотний контакт${suffix}.`;
        if (/This is callback\/follow-up work/i.test(value)) return 'Це робота зі зворотним контактом, а не канонічне очікування відповіді.';
        if (/Booking is preliminary and starts within the next 2 hours/i.test(value)) return `Попереднє бронювання стартує протягом найближчих 2 годин${suffix}.`;
        if (/Booking is preliminary and in the today\/tomorrow confirmation window/i.test(value)) return `Попереднє бронювання у вікні підтвердження сьогодні/завтра${suffix}.`;
        if (/booking status risk from bookings\.status/i.test(value)) return 'Це ризик статусу бронювання з bookings.status, а не проста ознака наближення події.';
        if (/leads\.event_date is inside the queue event window/i.test(value)) return `Дата події потрапляє у робоче вікно черги${suffix}.`;
        if (/flags timing pressure/i.test(value)) return 'Це сигнал наближення часу, а не доказ фінальної готовності.';
        if (/Lead appears idle/i.test(value)) return 'Стан ліда тепер показується у воронці, а не як окремий пункт робочої черги.';
        if (/queue heuristic/i.test(value) && /must not outrank/i.test(value)) return 'Це довідковий сигнал, який не є робочою дією черги.';
        if (/Queue item came from/i.test(value)) return `Пункт потрапив у чергу за сигналом: ${humanizeQueueSignal(value.replace(/^Queue item came from\s+/i, '').replace(/\.$/, ''))}.`;
        if (/No stronger bucket-specific intelligence rule/i.test(value)) return 'Для цього пункту немає сильнішого правила аналітики категорії.';
        if (/Booking is visible in tomorrow prep/i.test(value)) return 'Бронювання видиме у підготовці на завтра.';
        if (/preparation pressure/i.test(value)) return 'Це сигнал підготовки, а не помилка підтвердження.';
        if (/tasks\.owner_user_id is empty and no legacy owner label/i.test(value)) return 'У задачі немає ID відповідального і legacy-мітки відповідального.';
        if (/tasks\.owner_user_id is empty; legacy owner text exists/i.test(value)) return 'У задачі немає ID відповідального; legacy-текст не є канонічною особою.';
        if (/Task owner is typed through tasks\.owner_user_id=/i.test(value)) return value.replace(/Task owner is typed through tasks\.owner_user_id=/i, 'Відповідальний задачі заданий через tasks.owner_user_id=');
        if (/Task deadline\/date is before today/i.test(value)) return `Дедлайн або дата задачі вже минули${suffix}.`;
        if (/Task deadline\/date is today/i.test(value)) return `Дедлайн або дата задачі сьогодні${suffix}.`;
        if (/Task deadline\/date is future-visible/i.test(value)) return `Дедлайн задачі у найближчому плані${suffix}.`;
        if (/No tasks\.deadline\/tasks\.date is present/i.test(value)) return 'У задачі немає дедлайну або дати, тому терміновість лишається підказкою.';
        if (/Task priority is/i.test(value)) return `Пріоритет задачі: ${humanizeQueueRiskType(value.replace(/^Task priority is\s+/i, '').replace(/\.$/, ''))}.`;
        if (/Task has been in progress\/stale/i.test(value)) return value.replace(/Task has been in progress\/stale for about/i, 'Задача зависла в роботі приблизно').replace(/based on updated_at\/created_at/i, 'за updated_at/created_at');
        if (/Task has legacy string ownership/i.test(value)) return 'Задача має legacy-текст відповідального; дія дозволена через перевірку видимості задачі, а перепризначення збереже ID відповідального.';
        if (/Task inline execution is unavailable until task object visibility is proven/i.test(value)) return 'Дія задачі недоступна, доки не доведено видимість цієї задачі.';
        if (/Callback completion\/defer remains route-out only/i.test(value)) return 'Завершення або перенесення зворотного контакту поки доступне лише через перехід у контекст; спільного результату для черги ще немає.';
        if (/Event-soon items are review\/context signals/i.test(value)) return 'Пункти з наближенням події є сигналами для перевірки контексту, а не діями виконання.';
        if (/No bucket-specific durable execution action is defined/i.test(value)) return 'Для цього пункту черги не визначено збереженої дії конкретної категорії.';
        if (/Reply escalation is only available for overdue waiting replies/i.test(value)) return 'Ескалація доступна лише для простроченого очікування відповіді.';
        return value
            .replaceAll('waiting_reply', 'очікування відповіді')
            .replaceAll('bucket-specific', 'для конкретної категорії')
            .replaceAll('route-out only', 'лише перехід у контекст')
            .replaceAll('canonical', 'канонічний')
            .replaceAll('reply debt', 'борг відповіді');
    }

    function triageReasonText(item) {
        if (Array.isArray(item?.intelligence?.why) && item.intelligence.why.length) {
            return item.intelligence.why.map(humanizeQueueReasonText).filter(Boolean).join(' ');
        }
        const signal = item?.meta?.signal ? ` Сигнал: ${humanizeQueueSignal(item.meta.signal)}.` : '';
        switch (item?.bucket) {
            case 'waiting_reply':
                return `У розмові явно очікується відповідь клієнту; очікування почалося ${formatQueueDateTime(item.meta?.awaitingReplySince || item.meta?.waitingSince)}.${signal}`;
            case 'callback_due':
                return `Запланований зворотний контакт уже у видимій черзі. Це не очікування відповіді й не закривається діями відповіді.${signal}`;
            case 'overdue':
                return `Задача прострочена за дедлайном або датою і потребує переходу в задачу чи повʼязаний контекст.${signal}`;
            case 'today':
                return `Задача має робочий дедлайн на сьогодні.${signal}`;
            case 'tomorrow':
                return `Задача або подія стоїть у найближчому плані на завтра.${signal}`;
            case 'needs_confirmation':
                return `Бронювання має попередній статус у вікні підтвердження сьогодні/завтра. Швидке підтвердження йде тільки через вузький endpoint бронювання; наближення події лишається окремим часовим сигналом.${signal}`;
            case 'event_soon':
                return `Подія наближається, тому менеджеру потрібна швидка перевірка точного контексту. Це часовий сигнал, а не доказ готовності бронювання.${signal}`;
            default:
                return `Пункт потрапив у робочу чергу за доступним довіреним або підказковим сигналом.${signal}`;
        }
    }

    function addTriageLink(links, href, label, tone = '') {
        if (!href || links.some(link => link.href === href)) return;
        links.push({ href, label, tone });
    }

    function getTriageLinks(item) {
        const links = [];
        const meta = item?.meta || {};
        addTriageLink(links, meta.exactHref || item?.href, 'Відкрити точний контекст', 'primary');
        addTriageLink(links, meta.leadHref, 'Лід');
        addTriageLink(links, meta.replyEscalationHref, 'Задача ескалації');
        if (item?.taskId) addTriageLink(links, `/tasks?open=${encodeURIComponent(item.taskId)}`, 'Задача');
        if (item?.leadId) addTriageLink(links, `/sales-funnel?lead=${encodeURIComponent(item.leadId)}`, 'Лід');
        if (item?.meta?.conversationId) addTriageLink(links, `/omni?conversation=${encodeURIComponent(item.meta.conversationId)}`, 'Комунікація');
        if (item?.bookingId && item.href) addTriageLink(links, item.href, 'Бронювання');
        if (!links.length) addTriageLink(links, '/dashboard', 'Повернутись до дашборда');
        return links;
    }

    function renderTriageLinks(item) {
        return getTriageLinks(item).map(link => `
            <a class="work-queue-triage-link ${link.tone || ''}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>
        `).join('');
    }

    function executionDepthLabel(item) {
        const depth = item?.execution?.depth;
        if (item?.bucket === 'waiting_reply') return 'Дії відповіді виконуються прямо з черги';
        if (depth === 'limited_task_route_out') return 'Задача відкривається через перехід у контекст';
        if (depth === 'summary_route_out') return 'Лише перегляд і коротке резюме';
        if (depth === 'review_route_out') return 'Лише перевірка контексту';
        return item?.execution?.routeOutOnly ? 'Лише перехід у контекст' : 'Дії доступні для цієї категорії';
    }

    function executionUnavailableText(item) {
        if (item?.execution?.unavailableReason) return humanizeQueueReasonText(item.execution.unavailableReason);
        if (item?.bucket === 'waiting_reply') return 'Дії відповіді змінюють канонічні поля очікування й повторно завантажують видиму чергу.';
        return 'Для цієї категорії немає безпечної inline-дії.';
    }

    function renderExecutionFeedback() {
        if (!_queueExecutionFlash?.message) return '';
        return `
            <div class="work-queue-execution-feedback ${escapeHtml(_queueExecutionFlash.tone || '')}" role="status" aria-live="polite">
                ${escapeHtml(_queueExecutionFlash.message)}
            </div>
        `;
    }

    function setExecutionFeedback(message, tone = '') {
        _queueExecutionFlash = message ? { message, tone } : null;
    }

    function isReplyActionHistoryItem(item) {
        return item?.bucket === 'waiting_reply' && Number(item?.meta?.conversationId || item?.sourceId || 0) > 0;
    }

    function replyActionHistoryConversationId(item) {
        const id = Number(item?.meta?.conversationId || item?.sourceId || 0);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    function syncReplyActionHistorySelection(item) {
        if (!isReplyActionHistoryItem(item)) {
            _replyActionHistoryState = { itemId: null, conversationId: null, status: 'idle', events: [], error: null };
            return;
        }
        const itemId = getWorkQueueItemId(item);
        const conversationId = replyActionHistoryConversationId(item);
        if (_replyActionHistoryState.itemId !== itemId || _replyActionHistoryState.conversationId !== conversationId) {
            _replyActionHistoryState = { itemId, conversationId, status: 'loading', events: [], error: null };
        }
    }

    function replyActionHistoryTitle(actionType) {
        switch (actionType) {
            case 'reply_expectation_cleared':
                return 'Очікування відповіді очищено';
            case 'reply_sla_snoozed':
                return 'SLA перенесено';
            case 'reply_owner_reassigned':
                return 'Відповідального змінено';
            case 'reply_escalated':
                return 'Ескалацію створено або перевикористано';
            case 'reply_escalation_closed':
                return 'Ескалацію закрито';
            default:
                return 'Дія відповіді';
        }
    }

    function historyValueLabel(value) {
        if (value === undefined || value === null || value === '') return 'немає';
        if (typeof value === 'boolean') return value ? 'так' : 'ні';
        if (typeof value === 'string') {
            const date = new Date(value);
            if (!Number.isNaN(date.getTime()) && /T|\d{4}-\d{2}-\d{2}/.test(value)) return formatQueueDateTime(value);
            const valueMap = {
                todo: 'до виконання',
                done: 'виконано',
                cancelled: 'скасовано',
                in_progress: 'в роботі',
                waiting_reply: 'очікування відповіді',
                preliminary: 'попереднє',
                confirmed: 'підтверджено'
            };
            return valueMap[value] || humanizeQueueActionLabel(value, value);
        }
        return String(value);
    }

    function humanizeHistorySummary(summary) {
        const value = String(summary || '').trim();
        const map = {
            'Reply owner reassigned': 'Відповідального за відповідь змінено',
            'Reply SLA moved': 'SLA відповіді перенесено',
            'Reply expectation cleared': 'Очікування відповіді очищено',
            'Reply execution action recorded': 'Дію відповіді записано',
            'Task completed': 'Задачу виконано',
            'Task owner reassigned': 'Відповідального задачі змінено',
            'Task rescheduled': 'Дедлайн задачі перенесено',
            'Task execution action': 'Дія задачі',
            'Booking confirmed': 'Бронювання підтверджено'
        };
        return map[value] || humanizeQueueActionLabel(value, value);
    }

    function renderReplyActionHistoryChange(event) {
        const oldValue = event?.oldValue || {};
        const newValue = event?.newValue || {};
        if (event?.actionType === 'reply_owner_reassigned') {
            return `${historyValueLabel(oldValue.replyOwner || oldValue.replyOwnerUserId)} -> ${historyValueLabel(newValue.replyOwner || newValue.replyOwnerUserId)}`;
        }
        if (event?.actionType === 'reply_sla_snoozed') {
            return `${historyValueLabel(oldValue.replySlaAt)} -> ${historyValueLabel(newValue.replySlaAt)}`;
        }
        if (event?.actionType === 'reply_expectation_cleared') {
            return `очікування відповіді ${historyValueLabel(oldValue.replyExpected)} -> ${historyValueLabel(newValue.replyExpected)}`;
        }
        if (event?.actionType === 'reply_escalated' || event?.actionType === 'reply_escalation_closed') {
            return `задача ${historyValueLabel(oldValue.replyEscalationTaskId)} -> ${historyValueLabel(newValue.replyEscalationTaskId)}`;
        }
        return humanizeHistorySummary(event?.summary);
    }

    function renderReplyActionHistoryRows(events) {
        return (events || []).map(event => {
            const actor = event.actor?.name || (event.actor?.userId ? `Користувач #${event.actor.userId}` : 'Невідомий виконавець');
            const created = event.createdAt ? formatQueueDateTime(event.createdAt) : '';
            const change = renderReplyActionHistoryChange(event);
            return `
                <li class="reply-action-history-row">
                    <div>
                        <strong>${escapeHtml(replyActionHistoryTitle(event.actionType))}</strong>
                        <span>${escapeHtml(humanizeHistorySummary(event.summary))}</span>
                    </div>
                    <p>${escapeHtml(actor)}${created ? ` · ${escapeHtml(created)}` : ''}</p>
                    ${change ? `<code>${escapeHtml(change)}</code>` : ''}
                </li>
            `;
        }).join('');
    }

    function renderReplyActionHistory(item) {
        if (!isReplyActionHistoryItem(item)) return '';
        syncReplyActionHistorySelection(item);
        const state = _replyActionHistoryState;
        const status = state.status || 'idle';
        let body = '';
        if (status === 'loading' || status === 'idle') {
            body = '<p class="reply-action-history-state" role="status">Завантажуємо історію дій по відповідях...</p>';
        } else if (status === 'error') {
            body = `
                <p class="reply-action-history-state error">Не вдалося завантажити історію дій по відповідях.</p>
                <button type="button" class="work-queue-action-btn" onclick="DashboardPage.reloadReplyActionHistory()">Спробувати ще раз</button>
            `;
        } else if (!state.events.length) {
            body = '<p class="reply-action-history-state">Історії дій по відповідях ще немає.</p>';
        } else {
            body = `<ol class="reply-action-history-list">${renderReplyActionHistoryRows(state.events)}</ol>`;
        }
        return `
            <div class="work-queue-triage-card reply-action-history-card" id="replyActionHistoryPanel" aria-label="Історія дій по відповідях">
                <h4>Історія дій по відповідях</h4>
                ${body}
            </div>
        `;
    }

    function isTaskActionHistoryItem(item) {
        return item?.sourceType === 'task' && Number(item?.taskId || item?.sourceId || 0) > 0;
    }

    function taskActionHistoryTaskId(item) {
        const id = Number(item?.taskId || item?.sourceId || 0);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    function syncTaskActionHistorySelection(item) {
        if (!isTaskActionHistoryItem(item)) {
            _taskActionHistoryState = { itemId: null, taskId: null, status: 'idle', events: [], error: null };
            return;
        }
        const itemId = getWorkQueueItemId(item);
        const taskId = taskActionHistoryTaskId(item);
        if (_taskActionHistoryState.itemId !== itemId || _taskActionHistoryState.taskId !== taskId) {
            _taskActionHistoryState = { itemId, taskId, status: 'loading', events: [], error: null };
        }
    }

    function taskActionHistoryTitle(actionType) {
        switch (actionType) {
            case 'task_completed':
                return 'Задачу виконано';
            case 'task_owner_reassigned':
                return 'Відповідального змінено';
            case 'task_rescheduled':
                return 'Дедлайн перенесено';
            default:
                return 'Дія задачі';
        }
    }

    function renderTaskActionHistoryChange(event) {
        const oldValue = event?.oldValue || {};
        const newValue = event?.newValue || {};
        if (event?.actionType === 'task_completed') {
            return `статус ${historyValueLabel(oldValue.status)} -> ${historyValueLabel(newValue.status)}`;
        }
        if (event?.actionType === 'task_owner_reassigned') {
            return `${historyValueLabel(oldValue.assignedTo || oldValue.ownerUserId)} -> ${historyValueLabel(newValue.assignedTo || newValue.ownerUserId)}`;
        }
        if (event?.actionType === 'task_rescheduled') {
            return `${historyValueLabel(oldValue.deadline || oldValue.date)} -> ${historyValueLabel(newValue.deadline || newValue.date)}`;
        }
        return humanizeHistorySummary(event?.summary);
    }

    function renderTaskActionHistoryRows(events) {
        return (events || []).map(event => {
            const actor = event.actor?.name || (event.actor?.userId ? `Користувач #${event.actor.userId}` : 'Невідомий виконавець');
            const created = event.createdAt ? formatQueueDateTime(event.createdAt) : '';
            const change = renderTaskActionHistoryChange(event);
            return `
                <li class="reply-action-history-row">
                    <div>
                        <strong>${escapeHtml(taskActionHistoryTitle(event.actionType))}</strong>
                        <span>${escapeHtml(humanizeHistorySummary(event.summary))}</span>
                    </div>
                    <p>${escapeHtml(actor)}${created ? ` · ${escapeHtml(created)}` : ''}</p>
                    ${change ? `<code>${escapeHtml(change)}</code>` : ''}
                </li>
            `;
        }).join('');
    }

    function renderTaskActionHistory(item) {
        if (!isTaskActionHistoryItem(item)) return '';
        syncTaskActionHistorySelection(item);
        const state = _taskActionHistoryState;
        const status = state.status || 'idle';
        let body = '';
        if (status === 'loading' || status === 'idle') {
            body = '<p class="reply-action-history-state" role="status">Завантажуємо історію дій по задачі...</p>';
        } else if (status === 'error') {
            body = `
                <p class="reply-action-history-state error">Не вдалося завантажити історію дій по задачі.</p>
                <button type="button" class="work-queue-action-btn" onclick="DashboardPage.reloadTaskActionHistory()">Спробувати ще раз</button>
            `;
        } else if (!state.events.length) {
            body = '<p class="reply-action-history-state">Історії дій по задачі ще немає.</p>';
        } else {
            body = `<ol class="reply-action-history-list">${renderTaskActionHistoryRows(state.events)}</ol>`;
        }
        return `
            <div class="work-queue-triage-card reply-action-history-card" id="taskActionHistoryPanel" aria-label="Історія дій по задачі">
                <h4>Історія дій по задачі</h4>
                ${body}
            </div>
        `;
    }

    function renderReplyActionHistoryOnly() {
        const target = document.getElementById('replyActionHistoryPanel');
        const selected = _workQueueSelectedItemId ? _workQueueItemsById.get(_workQueueSelectedItemId) : null;
        if (!target || !selected) return;
        target.outerHTML = renderReplyActionHistory(selected);
    }

    function renderTaskActionHistoryOnly() {
        const target = document.getElementById('taskActionHistoryPanel');
        const selected = _workQueueSelectedItemId ? _workQueueItemsById.get(_workQueueSelectedItemId) : null;
        if (!target || !selected) return;
        target.outerHTML = renderTaskActionHistory(selected);
    }

    async function loadReplyActionHistoryForSelected() {
        const selected = _workQueueSelectedItemId ? _workQueueItemsById.get(_workQueueSelectedItemId) : null;
        if (!isReplyActionHistoryItem(selected)) {
            _replyActionHistoryState = { itemId: null, conversationId: null, status: 'idle', events: [], error: null };
            return;
        }
        const itemId = getWorkQueueItemId(selected);
        const conversationId = replyActionHistoryConversationId(selected);
        _replyActionHistoryState = { itemId, conversationId, status: 'loading', events: [], error: null };
        renderReplyActionHistoryOnly();
        try {
            const token = localStorage.getItem('pzp_token');
            if (!token) throw new Error('No active session');
            const resp = await fetch(`/api/work-queue/replies/${encodeURIComponent(conversationId)}/history?limit=10`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            if (_replyActionHistoryState.itemId !== itemId || _replyActionHistoryState.conversationId !== conversationId) return;
            _replyActionHistoryState = {
                itemId,
                conversationId,
                status: 'loaded',
                events: Array.isArray(data.events) ? data.events : [],
                error: null
            };
        } catch (err) {
            console.error('Reply action history error:', err);
            if (_replyActionHistoryState.itemId === itemId && _replyActionHistoryState.conversationId === conversationId) {
                _replyActionHistoryState = { itemId, conversationId, status: 'error', events: [], error: err.message };
            }
        }
        renderReplyActionHistoryOnly();
    }

    async function loadTaskActionHistoryForSelected() {
        const selected = _workQueueSelectedItemId ? _workQueueItemsById.get(_workQueueSelectedItemId) : null;
        if (!isTaskActionHistoryItem(selected)) {
            _taskActionHistoryState = { itemId: null, taskId: null, status: 'idle', events: [], error: null };
            return;
        }
        const itemId = getWorkQueueItemId(selected);
        const taskId = taskActionHistoryTaskId(selected);
        _taskActionHistoryState = { itemId, taskId, status: 'loading', events: [], error: null };
        renderTaskActionHistoryOnly();
        try {
            const token = localStorage.getItem('pzp_token');
            if (!token) throw new Error('No active session');
            const resp = await fetch(`/api/work-queue/tasks/${encodeURIComponent(taskId)}/history?limit=10`, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            if (_taskActionHistoryState.itemId !== itemId || _taskActionHistoryState.taskId !== taskId) return;
            _taskActionHistoryState = {
                itemId,
                taskId,
                status: 'loaded',
                events: Array.isArray(data.events) ? data.events : [],
                error: null
            };
        } catch (err) {
            console.error('Task action history error:', err);
            if (_taskActionHistoryState.itemId === itemId && _taskActionHistoryState.taskId === taskId) {
                _taskActionHistoryState = { itemId, taskId, status: 'error', events: [], error: err.message };
            }
        }
        renderTaskActionHistoryOnly();
    }

    function nextVisibleItemIdAfter(itemId) {
        if (!_workQueueVisibleItemIds.length) return null;
        const index = _workQueueVisibleItemIds.indexOf(itemId);
        if (index < 0) return _workQueueVisibleItemIds[0] || null;
        return _workQueueVisibleItemIds[index + 1] || _workQueueVisibleItemIds[index - 1] || null;
    }

    async function refetchQueueAfterDurableExecution(previousItemId, message) {
        const preferredNext = nextVisibleItemIdAfter(previousItemId);
        await loadWorkQueue();
        const previousStillVisible = previousItemId && _workQueueItemsById.has(previousItemId);
        if (!previousStillVisible) {
            _workQueueSelectedItemId = (preferredNext && _workQueueItemsById.has(preferredNext))
                ? preferredNext
                : (_workQueueVisibleItemIds[0] || null);
        } else {
            _workQueueSelectedItemId = previousItemId;
        }
        const selectedMessage = _workQueueSelectedItemId && _workQueueItemsById.has(_workQueueSelectedItemId)
            ? ' Наступний фокус оновлено після повторного завантаження.'
            : ' Після повторного завантаження немає наступного видимого пункту.';
        setExecutionFeedback(`${message}${selectedMessage}`, 'success');
        renderTriageWorkspaceOnly(true);
        await loadReplyActionHistoryForSelected();
        await loadTaskActionHistoryForSelected();
    }

    function renderTriageActions(item) {
        const isWaitingReply = item?.bucket === 'waiting_reply';
        const conversationId = Number(item?.meta?.conversationId || item?.sourceId || 0);
        if (isWaitingReply && Number.isInteger(conversationId) && conversationId > 0) {
            const currentOwnerUserId = Number(item.meta?.replyOwnerUserId || 0);
            const isOverdue = item.meta?.replySlaState === 'overdue';
            const escalationHref = item.meta?.replyEscalationHref;
            const escalationAction = escalationHref
                ? `<a class="work-queue-triage-link" href="${escapeHtml(escalationHref)}">Відкрити ескалацію</a>`
                : `<button type="button" class="work-queue-action-btn" data-triage-reply-action onclick="DashboardPage.escalateReplyExpectation(${conversationId}, this)" ${isOverdue ? '' : 'disabled title="Ескалація доступна лише для простроченого очікування відповіді"'}>Ескалювати прострочення</button>`;
            return `
                <div class="work-queue-triage-actions" aria-label="Дії з відповіддю">
                    <button type="button" class="work-queue-action-btn" data-triage-reply-action onclick="DashboardPage.reassignReplyOwner(${conversationId}, this, ${currentOwnerUserId})">Змінити відповідального</button>
                    <button type="button" class="work-queue-action-btn" data-triage-reply-action onclick="DashboardPage.snoozeReplySla(${conversationId}, this)">SLA +24 год</button>
                    <button type="button" class="work-queue-action-btn danger" data-triage-reply-action onclick="DashboardPage.clearReplyExpectation(${conversationId}, this)">Очистити очікування</button>
                    ${escalationAction}
                </div>
                <p class="work-queue-triage-action-note">Автоперехід дозволений лише після збереженої дії та повторного завантаження. Просте відкриття контексту не вважається вирішенням.</p>
            `;
        }

        if (item?.sourceType === 'task' && item?.execution?.inline) {
            const taskId = Number(item.taskId || item.sourceId || 0);
            const ownerState = item.meta?.ownerState || 'unassigned';
            const ownerNote = ownerState === 'legacy_unknown_owner'
                ? ' Legacy-відповідальний буде замінений ID користувача під час перепризначення.'
                : '';
            return `
                <div class="work-queue-triage-actions" aria-label="Дії з задачею">
                    <button type="button" class="work-queue-action-btn" data-triage-task-action onclick="DashboardPage.completeQueueTask(${taskId}, this)">Позначити виконаною</button>
                    <button type="button" class="work-queue-action-btn" data-triage-task-action onclick="DashboardPage.reassignQueueTaskOwner(${taskId}, this, ${Number(item.meta?.ownerUserId || 0)})">Змінити відповідального</button>
                    <button type="button" class="work-queue-action-btn" data-triage-task-action onclick="DashboardPage.rescheduleQueueTask(${taskId}, this)">Дедлайн +24 год</button>
                </div>
                <p class="work-queue-triage-action-note">Дії по задачі працюють через перевірку видимості задачі, канонічні поля tasks.owner_user_id / deadline / status, історію змін і повторне завантаження після збереження.${escapeHtml(ownerNote)}</p>
            `;
        }

        if (item?.bucket === 'needs_confirmation' && item?.execution?.inline) {
            const bookingId = String(item.bookingId || item.sourceId || '');
            const lateNote = item.meta?.latePreliminary
                ? ' Це пізній preliminary-ризик, бо бронювання стартує протягом 2 годин.'
                : '';
            return `
                <div class="work-queue-triage-actions" aria-label="Дії з підтвердження бронювання">
                    <button type="button" class="work-queue-action-btn" data-triage-booking-action onclick="DashboardPage.confirmQueueBooking('${escapeHtml(bookingId)}', this)">Підтвердити бронювання</button>
                </div>
                <p class="work-queue-triage-action-note">Підтвердження використовує POST /api/bookings/:id/confirm і записує bookings.status, confirmed_at, confirmed_by та history.${escapeHtml(lateNote)}</p>
            `;
        }

        return `
            <p class="work-queue-triage-action-note">
                ${escapeHtml(executionUnavailableText(item))}
            </p>
        `;
    }

    function renderTriageMetric(label, value) {
        if (!value) return '';
        return `
            <div class="work-queue-triage-metric">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
            </div>
        `;
    }

    function renderTriageWorkspace() {
        const selected = _workQueueSelectedItemId ? _workQueueItemsById.get(_workQueueSelectedItemId) : null;
        const visibleCount = _workQueueVisibleItemIds.length;
        if (!selected) {
            return `
                <section class="work-queue-resolution-workspace empty" id="workQueueResolutionWorkspace" tabindex="-1" aria-label="Робоча зона тріажу й вирішення" hidden aria-hidden="true"></section>
            `;
        }

        const itemId = getWorkQueueItemId(selected);
        const index = _workQueueVisibleItemIds.indexOf(itemId);
        const owner = selected.meta?.assignedTo || selected.meta?.replyOwner || selected.assignedTo || '';
        const dueAt = selected.dueAt || selected.meta?.replySlaAt || selected.meta?.awaitingReplySince || '';
        const bucket = workQueueBucketLabel(selected.bucket);
        const risk = triageRiskLabel(selected);
        const reason = triageReasonText(selected);
        const confidence = selected.intelligence?.confidence
            ? intelligenceConfidenceLabel(selected.intelligence.confidence)
            : intelligenceConfidenceLabel(selected.confidence || 'exact');
        const recommended = humanizeQueueActionLabel(
            selected.intelligence?.recommendedAction?.label || selected.actionLabel || '',
            selected.intelligence?.recommendedAction?.type || ''
        );
        const riskTypes = Array.isArray(selected.intelligence?.riskTypes)
            ? selected.intelligence.riskTypes.map(humanizeQueueRiskType).join(', ')
            : '';
        const inlineDepth = executionDepthLabel(selected);
        const prevDisabled = index <= 0 ? 'disabled' : '';
        const nextDisabled = index < 0 || index >= _workQueueVisibleItemIds.length - 1 ? 'disabled' : '';

        return `
            <section class="work-queue-resolution-workspace" id="workQueueResolutionWorkspace" tabindex="-1" aria-label="Робоча зона тріажу й вирішення">
                <div class="work-queue-triage-head">
                    <div>
                        <span class="work-queue-triage-eyebrow">${escapeHtml(bucket)}</span>
                        <h3>${escapeHtml(selected.title || selected.actionLabel || 'Пункт черги')}</h3>
                        <p>${escapeHtml(selected.subtitle || 'Контекст доступний через точні посилання нижче.')}</p>
                    </div>
                    <div class="work-queue-triage-nav" aria-label="Навігація пунктами черги">
                        <button type="button" class="work-queue-action-btn" onclick="DashboardPage.previousTriageItem()" ${prevDisabled}>Назад</button>
                        <span>${index >= 0 ? index + 1 : 0}/${visibleCount}</span>
                        <button type="button" class="work-queue-action-btn" onclick="DashboardPage.nextTriageItem()" ${nextDisabled}>Далі</button>
                        <button type="button" class="work-queue-action-btn" onclick="DashboardPage.clearTriageSelection()">До черги</button>
                    </div>
                </div>
                ${renderExecutionFeedback()}
                <div class="work-queue-triage-grid">
                    <div class="work-queue-triage-card">
                        <h4>Чому тут</h4>
                        <p>${escapeHtml(reason)}</p>
                    </div>
                    <div class="work-queue-triage-card">
                        <h4>Відповідальний / ризик</h4>
                        <div class="work-queue-triage-metrics">
                            ${renderTriageMetric('Відповідальний', owner || 'Не призначено')}
                            ${renderTriageMetric('Ризик', risk)}
                            ${renderTriageMetric('Типи ризику', riskTypes)}
                            ${renderTriageMetric('Термін', dueAt ? formatQueueDateTime(dueAt) : 'Без терміну')}
                            ${renderTriageMetric('Достовірність', confidence)}
                        </div>
                    </div>
                    <div class="work-queue-triage-card">
                        <h4>Точний контекст</h4>
                        <div class="work-queue-triage-links">${renderTriageLinks(selected)}</div>
                    </div>
                    <div class="work-queue-triage-card">
                        <h4>Дії</h4>
                        ${renderTriageMetric('Рекомендація', recommended)}
                        <p class="work-queue-triage-depth">${escapeHtml(inlineDepth)}</p>
                        ${renderTriageActions(selected)}
                    </div>
                    ${renderReplyActionHistory(selected)}
                    ${renderTaskActionHistory(selected)}
                </div>
            </section>
        `;
    }

    function renderTriageWorkspaceOnly(focus = false) {
        const target = document.getElementById('workQueueResolutionWorkspace');
        if (!target) return;
        target.outerHTML = renderTriageWorkspace();
        syncWorkQueuePanelMode();
        updateTriageSelectionStyles();
        if (focus) {
            window.setTimeout(() => {
                const nextTarget = document.getElementById('workQueueResolutionWorkspace');
                if (nextTarget && typeof nextTarget.focus === 'function') nextTarget.focus();
            }, 0);
        }
    }

    function updateTriageSelectionStyles() {
        document.querySelectorAll('[data-work-queue-item-id]').forEach(frame => {
            const selected = frame.getAttribute('data-work-queue-item-id') === _workQueueSelectedItemId;
            frame.classList.toggle('is-triage-selected', selected);
        });
    }

    function selectTriageItem(encodedItemId) {
        let itemId = '';
        try {
            itemId = decodeURIComponent(String(encodedItemId || ''));
        } catch {
            itemId = String(encodedItemId || '');
        }
        if (!_workQueueItemsById.has(itemId)) {
            _workQueueSelectedItemId = null;
        } else {
            _workQueueSelectedItemId = itemId;
        }
        renderTriageWorkspaceOnly(true);
        loadReplyActionHistoryForSelected();
        loadTaskActionHistoryForSelected();
    }

    function navigateTriageItem(delta) {
        if (!_workQueueVisibleItemIds.length) return;
        const currentIndex = _workQueueVisibleItemIds.indexOf(_workQueueSelectedItemId);
        const baseIndex = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex = Math.max(0, Math.min(_workQueueVisibleItemIds.length - 1, baseIndex + delta));
        _workQueueSelectedItemId = _workQueueVisibleItemIds[nextIndex];
        renderTriageWorkspaceOnly(true);
        loadReplyActionHistoryForSelected();
        loadTaskActionHistoryForSelected();
    }

    function nextTriageItem() {
        navigateTriageItem(1);
    }

    function previousTriageItem() {
        navigateTriageItem(-1);
    }

    function clearTriageSelection() {
        _workQueueSelectedItemId = null;
        _replyActionHistoryState = { itemId: null, conversationId: null, status: 'idle', events: [], error: null };
        _taskActionHistoryState = { itemId: null, taskId: null, status: 'idle', events: [], error: null };
        renderTriageWorkspaceOnly(true);
    }

    function renderWorkQueueItem(item) {
        const itemId = getWorkQueueItemId(item);
        const encodedItemId = encodeURIComponent(itemId);
        const priorityCls = item.priority ? ` priority-${item.priority}` : '';
        const bucketCls = item.bucket ? ` bucket-${item.bucket}` : '';
        const waitingCls = item.bucket === 'waiting_reply' ? ' is-waiting-reply' : '';
        const triageSelectedCls = _workQueueSelectedItemId === itemId ? ' is-triage-selected' : '';
        const isWaitingReply = item.bucket === 'waiting_reply';
        const confidence = item.confidence === 'suggested' ? '<span class="work-queue-confidence">підказка</span>' : '';
        const band = item.intelligence?.priorityBand || '';
        const bandPill = band
            ? `<span class="queue-band-pill band-${escapeHtml(band)}">${escapeHtml(priorityBandLabel(band))}</span>`
            : '';
        const recommendation = item.intelligence?.recommendedAction?.label
            ? `<span>${escapeHtml(humanizeQueueActionLabel(item.intelligence.recommendedAction.label, item.intelligence.recommendedAction.type))}</span>`
            : '';
        const due = item.dueAt ? `<span>${formatQueueDateTime(item.dueAt)}</span>` : '';
        const waitingSince = isWaitingReply && item.meta?.awaitingReplySince
            ? `<span class="work-queue-state-pill">очікуємо з ${formatQueueDateTime(item.meta.awaitingReplySince)}</span>`
            : '';
        const owner = isWaitingReply && item.meta?.assignedTo
            ? `<span>${escapeHtml(item.meta.assignedTo)}</span>`
            : '';
        const slaLabel = isWaitingReply ? replySlaLabel(item.meta?.replySlaState) : '';
        const slaState = item.meta?.replySlaState || 'none';
        const sla = slaLabel
            ? `<span class="work-queue-sla-pill sla-${escapeHtml(slaState)}">${escapeHtml(slaLabel)}</span>`
            : '';
        const meta = [bandPill, waitingSince || due, sla, owner, confidence, recommendation].filter(Boolean).join(' · ');
        const href = item.href || '/dashboard';
        const conversationId = Number(item.meta?.conversationId || item.sourceId || 0);
        const currentOwnerUserId = Number(item.meta?.replyOwnerUserId || 0);
        const selected = isWaitingReply && conversationId > 0 && _workQueueSelection.has(conversationId);
        const selectionControl = isWaitingReply && conversationId > 0 ? `
            <label class="work-queue-select" onclick="event.stopPropagation()">
                <input type="checkbox"
                    aria-label="Обрати пункт беклогу відповідей ${conversationId}"
                    onchange="DashboardPage.toggleReplySelection(${conversationId}, this.checked)"
                    ${selected ? 'checked' : ''}>
            </label>
        ` : '';
        const actions = isWaitingReply && conversationId > 0 ? `
            <span class="work-queue-reply-actions" aria-label="Дії з відповіддю">
                <button type="button" class="work-queue-action-btn" onclick="DashboardPage.reassignReplyOwner(${conversationId}, this, ${currentOwnerUserId})">Відповідальний</button>
                <button type="button" class="work-queue-action-btn" onclick="DashboardPage.snoozeReplySla(${conversationId}, this)">SLA +24 год</button>
                <button type="button" class="work-queue-action-btn danger" onclick="DashboardPage.clearReplyExpectation(${conversationId}, this)">Очистити</button>
            </span>
        ` : '';
        const escalationLink = isWaitingReply && item.meta?.replyEscalationHref
            ? `<a class="work-queue-escalation-link" href="${escapeHtml(item.meta.replyEscalationHref)}">Ескалація</a>`
            : '';
        const detailButton = `
            <button type="button" class="work-queue-detail-btn" onclick="DashboardPage.selectTriageItem('${encodedItemId}')">
                Деталі
            </button>
        `;
        const actionRow = [detailButton, actions, escalationLink].filter(Boolean).join('');
        return `
            <div class="work-queue-item-frame${waitingCls}${triageSelectedCls}" data-work-queue-item-id="${escapeHtml(itemId)}">
                ${selectionControl}
                <a class="work-queue-item${priorityCls}${bucketCls}${waitingCls}" href="${escapeHtml(href)}">
                    <span class="work-queue-dot" aria-hidden="true"></span>
                    <span class="work-queue-text">
                        <span class="work-queue-title">${escapeHtml(item.title || item.actionLabel || 'Пункт черги')}</span>
                        <span class="work-queue-meta">${meta}${item.subtitle ? ' · ' + escapeHtml(String(item.subtitle).slice(0, 90)) : ''}</span>
                    </span>
                    <span class="work-queue-action">${escapeHtml(humanizeQueueActionLabel(item.actionLabel || 'Відкрити'))}</span>
                </a>
                <div class="work-queue-reply-row">${actionRow}</div>
            </div>
        `;
    }

    function formatQueueDate(value) {
        if (!value) return '—';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });
    }

    function formatQueueDateTime(value) {
        if (!value) return '—';
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return formatQueueDate(value);
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace('T', ' ');
        return date.toLocaleString('uk-UA', {
            timeZone: 'Europe/Kyiv',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function getDashboardPresentationMode() {
        return normalizeDashboardPresentationMode(_config?.presentationMode || _config?.layout?.presentationMode);
    }

    function getEffectiveDashboardRole() {
        const shellRole = window.RolePreview?.getEffectiveRole?.() || (typeof getUserRole === 'function' ? getUserRole() : '');
        const ownRole = shellRole || AppState.currentUser?.role || 'manager';
        return ownRole;
    }

    function getEffectiveDashboardScene() {
        const role = getEffectiveDashboardRole();
        if (ROLE_DASHBOARD_SCENES[role]) return ROLE_DASHBOARD_SCENES[role];
        return {
            title: 'Default dashboard scene',
            description: 'Задачі, графік і базові операційні сигнали.',
            zones: {
                leftCluster: ['tasks', 'my_schedule'],
                centerControl: ['alerts'],
                lowerSupport: ['weather', 'announcements'],
                rightWritingLane: ['notes-zone-primary']
            },
            spacing: { rightFreeLane: 300, chaos: 0.08 }
        };
    }

    function roleDisplayName(role) {
        return (typeof ROLE_NAMES !== 'undefined' && ROLE_NAMES[role]) ? ROLE_NAMES[role] : role;
    }

    function getRoleSceneWidgetPool(role, scene) {
        const explicit = [
            ...getRoleBaseWidgets(role),
            ...Object.values(scene?.zones || {}).flat().filter(key => WIDGET_DEFS[key])
        ];
        const allAvailable = Object.keys(WIDGET_DEFS).filter(key => canUseWidgetForRole(key, role));
        const source = role === 'creator' ? allAvailable : explicit;
        return [...new Set(source)].filter(key => canUseWidgetForRole(key, role));
    }

    function targetLaneForWidget(widgetKey) {
        if (['director_pnl', 'operations', 'hr_overview', 'content_pipeline', 'catalogs'].includes(widgetKey)) return 'specialty';
        if (['quick_stats', 'bookings_today', 'event_risk_summary', 'exceptions', 'my_schedule', 'weather', 'currency', 'announcements'].includes(widgetKey)) return 'lowerSupport';
        if (['alerts', 'team_online', 'staff_today'].includes(widgetKey)) return 'centerControl';
        return 'leftCluster';
    }

    function pickSceneLaneWidgets(keys, pool, used) {
        return (Array.isArray(keys) ? keys : [])
            .filter(key => pool.includes(key) && !used.has(key))
            .map(key => {
                used.add(key);
                return key;
            });
    }

    function buildMixedSceneLayout() {
        const role = getEffectiveDashboardRole();
        const scene = getEffectiveDashboardScene();
        const pool = getRoleSceneWidgetPool(role, scene);
        const zones = scene.zones || {};
        const used = new Set();
        const lanes = {
            leftCluster: pickSceneLaneWidgets(zones.leftCluster, pool, used),
            centerControl: pickSceneLaneWidgets(zones.centerControl, pool, used),
            lowerSupport: pickSceneLaneWidgets(zones.lowerSupport, pool, used),
            specialty: pickSceneLaneWidgets(zones.specialty, pool, used)
        };

        pool.filter(key => !used.has(key)).forEach(key => {
            const target = targetLaneForWidget(key);
            lanes[target].push(key);
            used.add(key);
        });

        return {
            role,
            roleLabel: roleDisplayName(role),
            scene,
            lanes,
            writingZones: _config?.sceneOptions?.writingLane === false ? [] : (zones.rightWritingLane || ['notes-zone-primary']),
            options: normalizeSceneOptions(_config?.sceneOptions),
            spacing: scene.spacing || { rightFreeLane: 320, chaos: 0.12 }
        };
    }

    function renderMixedSceneDashboard(grid) {
        const layout = buildMixedSceneLayout();
        grid.className = 'dashboard-grid dashboard-mixed-scene';
        grid.innerHTML = renderMixedSceneMarkup(layout);
        hydrateMixedSceneWidgets(layout);
        updateDashboardRolePreviewControl();
    }

    function renderMixedSceneMarkup(layout) {
        const role = escapeHtml(layout.role);
        const rightLane = Math.max(280, Math.min(380, Number(layout.spacing?.rightFreeLane || 320)));
        const chaosClass = layout.options.controlledChaos ? 'scene-chaos-on' : 'scene-chaos-calm';
        return `
            <section class="dashboard-scene dashboard-scene-role-${role} ${chaosClass}" style="--scene-right-lane: ${rightLane}px" data-scene-role="${role}">
                <div class="dashboard-scene-left-chaos" id="dashboardSceneLeftChaos">
                    ${renderSceneWidgetZone(layout.lanes.leftCluster, 'chaos')}
                </div>

                <div class="dashboard-scene-center-control" id="dashboardSceneCenterControl">
                    ${renderSceneWidgetZone(layout.lanes.centerControl, 'control')}
                    ${renderSceneWidgetZone(layout.lanes.lowerSupport, 'support')}
                    ${renderSceneWidgetZone(layout.lanes.specialty, 'specialty')}
                </div>

                ${layout.writingZones.length ? `
                    <aside class="dashboard-scene-right-writing" id="dashboardSceneRightWriting" aria-label="Dashboard writing lane">
                        ${layout.writingZones.map(zoneId => renderWritingZone(zoneId)).join('')}
                    </aside>
                ` : ''}
            </section>
        `;
    }

    function renderSceneWidgetZone(widgetKeys = [], tone = 'default') {
        return widgetKeys
            .filter(widgetKey => WIDGET_DEFS[widgetKey])
            .filter(widgetKey => canUseWidgetForRole(widgetKey, getEffectiveDashboardRole()))
            .map(widgetKey => renderSceneWidgetCard(widgetKey, tone))
            .join('');
    }

    function renderSceneWidgetCard(widgetKey, tone = 'default') {
        const def = WIDGET_DEFS[widgetKey];
        if (!def) return '';
        const safeKey = escapeHtml(widgetKey);
        return `
            <section class="widget-card scene-tone-${escapeHtml(tone)}" data-widget="${safeKey}">
                <div class="widget-header">
                    <div class="widget-title">
                        <span class="widget-title-icon">${escapeHtml(def.icon)}</span>
                        ${escapeHtml(def.title)}
                    </div>
                    <div class="widget-actions">
                        <button class="widget-action-btn" onclick="DashboardPage.refreshWidget('${escapeJsString(widgetKey)}')" title="Оновити" aria-label="Оновити">↻</button>
                    </div>
                </div>
                <div class="widget-body" id="widget-${safeKey}">
                    <div class="widget-loading">Завантаження...</div>
                </div>
            </section>
        `;
    }

    function getWritingZoneStorageKey(zoneId) {
        const user = AppState.currentUser || {};
        const owner = user.id || user.username || user.name || 'guest';
        return `eg_dashboard_scene_note_${owner}_${getEffectiveDashboardRole()}_${zoneId}`;
    }

    function getWritingZoneValue(zoneId) {
        try {
            return localStorage.getItem(getWritingZoneStorageKey(zoneId)) || '';
        } catch {
            return '';
        }
    }

    function saveWritingZone(zoneId, value) {
        try {
            localStorage.setItem(getWritingZoneStorageKey(zoneId), String(value || '').slice(0, 5000));
        } catch {}
    }

    function renderWritingZone(zoneId) {
        const def = WRITING_ZONE_DEFS[zoneId] || WRITING_ZONE_DEFS['notes-zone-primary'];
        const value = getWritingZoneValue(zoneId);
        const safeZoneId = escapeHtml(zoneId);
        return `
            <section class="dashboard-writing-zone" data-zone="${safeZoneId}">
                <div class="dashboard-writing-zone-header">
                    <strong>${escapeHtml(def.title)}</strong>
                    <button type="button" class="dashboard-btn dashboard-writing-zone-note-btn" onclick="DashboardPage.addBoardNoteToZone('${escapeJsString(zoneId)}')">У Board</button>
                </div>
                <textarea class="dashboard-writing-zone-body"
                    id="${safeZoneId}"
                    rows="8"
                    placeholder="${escapeHtml(def.hint)}"
                    oninput="DashboardPage.saveWritingZone('${escapeJsString(zoneId)}', this.value)">${escapeHtml(value)}</textarea>
            </section>
        `;
    }

    function hydrateMixedSceneWidgets(layout) {
        const allKeys = Object.values(layout.lanes || {}).flat().filter(key => WIDGET_DEFS[key]);
        [...new Set(allKeys)].forEach(widgetKey => loadWidgetData(widgetKey));
    }

    function renderFlatWidgetGrid(grid) {
        grid.className = 'dashboard-grid';
        const widgets = normalizeDashboardWidgets(_config.widgets || []);
        grid.innerHTML = '';

        for (const widgetKey of widgets) {
            if (!canUseWidget(widgetKey)) continue;
            grid.insertAdjacentHTML('beforeend', renderSceneWidgetCard(widgetKey, 'default'));
            loadWidgetData(widgetKey);
        }

        if (grid.children.length === 0) {
            grid.innerHTML = '<div class="widget-empty">Немає віджетів. Натисніть "Налаштувати", щоб додати.</div>';
        }
    }

    function getDashboardRolePreviewState() {
        if (window.RolePreview?.getState) return window.RolePreview.getState();
        const role = typeof getUserRole === 'function' ? getUserRole() : AppState.currentUser?.role || '';
        const label = roleDisplayName(role);
        return {
            realRole: role,
            previewRole: '',
            effectiveRole: role,
            canPreview: false,
            roles: role ? [role] : [],
            realLabel: label,
            effectiveLabel: label,
            startPage: '/dashboard'
        };
    }

    function renderDashboardRolePreviewMenu() {
        const menu = document.getElementById('dashboardRolePreviewMenu');
        if (!menu) return;
        const state = getDashboardRolePreviewState();
        const roles = Array.isArray(state.roles) ? state.roles : [];
        const roleButtons = roles.map(role => {
            const isReal = role === state.realRole;
            const isActive = role === state.effectiveRole;
            const label = window.RoleShell?.getRoleLabel?.(role) || roleDisplayName(role);
            return `<button type="button" class="dashboard-role-preview-option${isActive ? ' active' : ''}" data-dashboard-role-preview-role="${escapeHtml(role)}" role="menuitem">
                <span>${escapeHtml(label)}</span>
                <em>${isReal ? 'реальна роль' : 'preview'}</em>
            </button>`;
        }).join('');
        menu.innerHTML = `
            <div class="dashboard-role-preview-head">
                <span>Preview shell</span>
                <strong>${escapeHtml(state.effectiveLabel || roleDisplayName(state.effectiveRole))}</strong>
            </div>
            <div class="dashboard-role-preview-note">
                Реальна роль акаунта: <b>${escapeHtml(state.realLabel || roleDisplayName(state.realRole))}</b>. Preview змінює тільки shell, меню, dashboard і quick access; API-доступ лишається реальним.
            </div>
            <div class="dashboard-role-preview-options">${roleButtons}</div>
            <div class="dashboard-role-preview-actions">
                <button type="button" data-dashboard-role-preview-home>Старт ролі</button>
                ${state.previewRole ? '<button type="button" data-dashboard-role-preview-clear>Вийти з preview</button>' : ''}
            </div>
        `;
    }

    function closeDashboardRolePreviewMenu() {
        const menu = document.getElementById('dashboardRolePreviewMenu');
        const button = document.getElementById('dashboardRolePreviewButton');
        if (menu) menu.classList.add('hidden');
        if (button) button.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', handleDashboardRolePreviewOutsideClick, true);
        window.removeEventListener('resize', closeDashboardRolePreviewMenu);
        window.removeEventListener('scroll', closeDashboardRolePreviewMenu, true);
    }

    function openDashboardRolePreviewMenu() {
        const wrapper = document.getElementById('dashboardRolePreview');
        const menu = document.getElementById('dashboardRolePreviewMenu');
        const button = document.getElementById('dashboardRolePreviewButton');
        const state = getDashboardRolePreviewState();
        if (!wrapper || !menu || !button || !state.canPreview) return;
        renderDashboardRolePreviewMenu();
        menu.classList.remove('hidden');
        button.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', handleDashboardRolePreviewOutsideClick, true);
        window.addEventListener('resize', closeDashboardRolePreviewMenu, { once: true });
        window.addEventListener('scroll', closeDashboardRolePreviewMenu, { once: true, capture: true });
    }

    function toggleRolePreviewMenu(event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const menu = document.getElementById('dashboardRolePreviewMenu');
        if (menu && !menu.classList.contains('hidden')) {
            closeDashboardRolePreviewMenu();
        } else {
            openDashboardRolePreviewMenu();
        }
    }

    function handleDashboardRolePreviewOutsideClick(event) {
        const wrapper = document.getElementById('dashboardRolePreview');
        if (!wrapper || wrapper.contains(event.target)) return;
        closeDashboardRolePreviewMenu();
    }

    function handleRolePreviewMenuClick(event) {
        const roleBtn = event.target.closest('[data-dashboard-role-preview-role]');
        const clearBtn = event.target.closest('[data-dashboard-role-preview-clear]');
        const homeBtn = event.target.closest('[data-dashboard-role-preview-home]');
        if (roleBtn) {
            event.preventDefault();
            setDashboardRolePreview(roleBtn.dataset.dashboardRolePreviewRole || '');
            return;
        }
        if (clearBtn) {
            event.preventDefault();
            setDashboardRolePreview('');
            return;
        }
        if (homeBtn) {
            event.preventDefault();
            const state = getDashboardRolePreviewState();
            window.location.href = state.startPage || '/dashboard';
        }
    }

    function updateDashboardRolePreviewControl() {
        const wrapper = document.getElementById('dashboardRolePreview');
        const button = document.getElementById('dashboardRolePreviewButton');
        const label = document.getElementById('dashboardRolePreviewCurrent');
        if (!wrapper || !button || !label) return;
        const state = getDashboardRolePreviewState();
        wrapper.hidden = !state.canPreview;
        wrapper.classList.toggle('is-preview-active', Boolean(state.previewRole));
        if (!state.canPreview) {
            closeDashboardRolePreviewMenu();
            return;
        }
        const effectiveLabel = state.effectiveLabel || roleDisplayName(state.effectiveRole);
        label.textContent = effectiveLabel;
        button.setAttribute('aria-label', `Перегляд як: ${effectiveLabel}. Відкрити перемикач preview ролі.`);
        if (!document.getElementById('dashboardRolePreviewMenu')?.classList.contains('hidden')) {
            renderDashboardRolePreviewMenu();
        }
    }

    function renderWidgets() {
        const grid = document.getElementById('dashboardGrid');
        if (!grid || !_config) return;
        _config = normalizeDashboardConfig(_config);
        syncBoardToolbar();
        updateDashboardRolePreviewControl();

        _config.mode = DASHBOARD_WORKSPACE_MODE;
        _config.layout.mode = DASHBOARD_WORKSPACE_MODE;
        renderFlatWidgetGrid(grid);
        grid.setAttribute('aria-hidden', 'true');
        grid.classList.add('dashboard-compat-widget-cache');
        grid.classList.add('hidden');
        ensureUnifiedWorkspaceSeed();
        renderBoard();
    }

    function ensureUnifiedWorkspaceSeed() {
        if (!_config?.boardState) _config.boardState = createDefaultDashboardConfig().boardState;
        if (getBoardItems().length || getBoardDrawings().length || getBoardConnectors().length) return;
        seedBoardWidgets({ persist: false });
    }

    function getBoardItems() {
        if (!_config.boardState) _config.boardState = createDefaultDashboardConfig().boardState;
        if (!Array.isArray(_config.boardState.items)) _config.boardState.items = [];
        return _config.boardState.items;
    }

    function getBoardDrawings() {
        if (!_config.boardState) _config.boardState = createDefaultDashboardConfig().boardState;
        if (!Array.isArray(_config.boardState.drawings)) _config.boardState.drawings = [];
        return _config.boardState.drawings;
    }

    function getBoardConnectors() {
        if (!_config.boardState) _config.boardState = createDefaultDashboardConfig().boardState;
        if (!Array.isArray(_config.boardState.connectors)) _config.boardState.connectors = [];
        return _config.boardState.connectors;
    }

    function getBoardLiveWidgetCap() {
        const prefs = safeObject(_config?.boardState?.preferences, {});
        return safeNumber(prefs.maxLiveWidgets, BOARD_LIVE_WIDGET_CAP, 1, 24);
    }

    function getBoardWorkspaceMode() {
        if (_boardObjectEditing?.kind === 'text') return 'object:text-edit';
        if (_boardWidgetInspectId) return 'object:widget-inspect';
        const tool = normalizeBoardTool(_config?.boardState?.activeTool || 'select');
        if (tool === 'connector') return 'board:connect';
        if (BOARD_DRAW_TOOLS.has(tool) || tool === 'eraser') return 'board:draw';
        if (BOARD_CREATE_TOOLS.has(tool)) return 'board:create';
        if (BOARD_SHAPE_TOOLS.has(tool)) return 'board:shape';
        return _boardInteractionMode === 'edit' ? 'board:edit' : 'board:view';
    }

    function syncBoardWorkspaceMode() {
        _boardWorkspaceMode = normalizeBoardWorkspaceMode(getBoardWorkspaceMode());
        return _boardWorkspaceMode;
    }

    function renderBoard() {
        const shell = document.getElementById('dashboardBoardShell');
        const canvas = document.getElementById('dashboardBoardCanvas');
        if (!shell || !canvas || !_config) return;
        shell.classList.remove('hidden');
        syncBoardWorkspaceMode();
        canvas.dataset.interactionMode = _boardInteractionMode;
        canvas.dataset.activeTool = _config.boardState?.activeTool || 'select';
        canvas.dataset.workspaceMode = _boardWorkspaceMode;
        canvas.dataset.connectorDraft = _boardConnectorDraft ? 'true' : 'false';
        const prefs = safeObject(_config.boardState?.preferences, {});
        canvas.dataset.gridVisible = prefs.showGrid === false ? 'false' : 'true';
        canvas.dataset.guidesVisible = prefs.showGuides === false ? 'false' : 'true';
        shell.dataset.gridVisible = canvas.dataset.gridVisible;
        shell.dataset.guidesVisible = canvas.dataset.guidesVisible;
        const items = getBoardItems();
        const drawings = getBoardDrawings();
        const connectors = getBoardConnectors();

        if (_boardConfigCorrupt) {
            canvas.innerHTML = `
                <div class="dashboard-board-warning">
                    <strong>Board config відновлено у безпечному режимі</strong>
                    <span>Одна з частин board state була несумісною, тому dashboard не зупинено.</span>
                    <button type="button" class="dashboard-btn" onclick="DashboardPage.resetBoardState()">Скинути board</button>
                </div>
            `;
            return;
        }

        if (!items.length && !drawings.length && !connectors.length) {
            canvas.innerHTML = `
                <div class="dashboard-board-empty">
                    <strong>Порожній board mode</strong>
                    <span>Почніть з нотатки або додайте кілька поточних dashboard widgets як керовані board-об'єкти.</span>
                    <div class="dashboard-board-empty-actions">
                        <button type="button" class="dashboard-btn primary" onclick="DashboardPage.addBoardNote()">Додати нотатку</button>
                        <button type="button" class="dashboard-btn" onclick="DashboardPage.seedBoardWidgets()">Додати widgets</button>
                    </div>
                </div>
            `;
            bindBoardCanvasHandlers(canvas);
            return;
        }

        canvas.innerHTML = renderBoardDrawingLayer(drawings) + renderBoardConnectorLayer(connectors) + renderBoardPlanningLayer(items) + items
            .slice()
            .sort((a, b) => Number(a.z || 0) - Number(b.z || 0))
            .map(renderBoardItem)
            .join('') + renderBoardMiniInspector();

        bindBoardItemHandlers();
        bindBoardConnectorHandlers();
        bindBoardCanvasHandlers(canvas);
        items.filter(item => item.type === 'widget' && item.depth === 'live-compact' && !item.hidden)
            .slice(0, getBoardLiveWidgetCap())
            .forEach(item => loadWidgetData(item.widgetType, document.getElementById(`board-widget-${item.id}`)));
        syncBoardWidgetRuntime();
    }

    function boardStrokePath(points = []) {
        return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${Number(point[0] || 0)} ${Number(point[1] || 0)}`).join(' ');
    }

    function renderBoardDrawingLayer(drawings = []) {
        const paths = drawings.map(stroke => {
            const path = boardStrokePath(stroke.points || []);
            if (!path) return '';
            return `<path id="board-stroke-${escapeHtml(stroke.id)}" class="board-drawing-stroke board-drawing-${escapeHtml(stroke.tool)}" d="${escapeHtml(path)}" stroke="${escapeHtml(stroke.color || '#10b981')}" stroke-width="${Number(stroke.width || 2)}" stroke-opacity="${Number(stroke.opacity || 0.9)}"></path>`;
        }).join('');
        return `<svg class="dashboard-board-drawing-layer" viewBox="0 0 1200 720" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>`;
    }

    function boardItemAnchorPoint(item, anchor = 'right') {
        const x = Number(item?.x || 0);
        const y = Number(item?.y || 0);
        const w = Number(item?.w || 280);
        const h = Number(item?.h || 160);
        if (anchor === 'top') return [x + w / 2, y];
        if (anchor === 'bottom') return [x + w / 2, y + h];
        if (anchor === 'left') return [x, y + h / 2];
        return [x + w, y + h / 2];
    }

    function boardConnectorPath(fromPoint, toPoint, style = 'arrow') {
        const [x1, y1] = fromPoint;
        const [x2, y2] = toPoint;
        if (style === 'curve') {
            const dx = Math.max(48, Math.abs(x2 - x1) * 0.42);
            return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
        }
        return `M ${x1} ${y1} L ${x2} ${y2}`;
    }

    function renderBoardConnectorLayer(connectors = []) {
        const itemsById = new Map(getBoardItems().map(item => [item.id, item]));
        const body = connectors.map(connector => {
            const fromItem = itemsById.get(connector.from?.itemId);
            const toItem = itemsById.get(connector.to?.itemId);
            if (!fromItem || !toItem || fromItem.hidden || toItem.hidden) return '';
            const fromPoint = boardItemAnchorPoint(fromItem, connector.from.anchor);
            const toPoint = boardItemAnchorPoint(toItem, connector.to.anchor);
            const path = boardConnectorPath(fromPoint, toPoint, connector.style);
            const selected = connector.id === _boardSelectedConnectorId ? ' selected' : '';
            const marker = connector.style === 'arrow' ? ' marker-end="url(#boardConnectorArrow)"' : '';
            const midX = (fromPoint[0] + toPoint[0]) / 2;
            const midY = (fromPoint[1] + toPoint[1]) / 2;
            const endpointHandles = selected ? `
                    <circle class="board-connector-endpoint endpoint-from" data-board-connector-endpoint="from" cx="${fromPoint[0]}" cy="${fromPoint[1]}" r="7"></circle>
                    <circle class="board-connector-endpoint endpoint-to" data-board-connector-endpoint="to" cx="${toPoint[0]}" cy="${toPoint[1]}" r="7"></circle>
                ` : '';
            return `
                <g class="board-connector${selected} relation-${escapeHtml(connector.relationType)}" data-board-connector-id="${escapeHtml(connector.id)}">
                    <path class="board-connector-hit" d="${escapeHtml(path)}"></path>
                    <path class="board-connector-path" d="${escapeHtml(path)}" stroke="${escapeHtml(connector.color)}" stroke-width="${Number(connector.width || 2)}"${marker}></path>
                    ${connector.label ? `<text class="board-connector-label" x="${midX}" y="${midY - 8}">${escapeHtml(connector.label)}</text>` : ''}
                    ${endpointHandles}
                </g>
            `;
        }).join('');
        return `
            <svg class="dashboard-board-connector-layer" viewBox="0 0 1200 720" preserveAspectRatio="none" aria-label="Board connectors">
                <defs>
                    <marker id="boardConnectorArrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#94a3b8"></path>
                    </marker>
                </defs>
                ${body}
            </svg>
        `;
    }

    function boardRectIntersectsZone(item, zone) {
        if (!item || !zone || item.hidden) return false;
        const left = Number(item.x || 0);
        const top = Number(item.y || 0);
        const right = left + Number(item.w || 0);
        const bottom = top + Number(item.h || 0);
        const zoneRight = Number(zone.x || 0) + Number(zone.w || 0);
        const zoneBottom = Number(zone.y || 0) + Number(zone.h || 0);
        return left < zoneRight && right > zone.x && top < zoneBottom && bottom > zone.y;
    }

    function renderBoardPlanningLayer(items = []) {
        const prefs = safeObject(_config?.boardState?.preferences, {});
        if (_boardInteractionMode !== 'edit' || prefs.showPlanner === false) return '';
        const zones = BOARD_PLANNING_ZONES.map(zone => {
            const occupants = items.filter(item => item.type !== 'space' && boardRectIntersectsZone(item, zone)).length;
            const reserved = items.some(item => item.type === 'space' && (item.zoneId === zone.id || boardRectIntersectsZone(item, zone)));
            const state = occupants ? 'occupied' : reserved ? 'reserved' : 'open';
            const stateLabel = occupants ? `${occupants} блок(и)` : reserved ? 'простір лишено' : 'готово до планування';
            const primaryAction = zone.widget
                ? `<button type="button" class="planner-zone-action" onclick="DashboardPage.addBoardWidgetToZone('${escapeJsString(zone.id)}')">+ Віджет тут</button>`
                : '';
            const reserveAction = `<button type="button" class="planner-zone-action secondary" onclick="DashboardPage.reserveBoardZone('${escapeJsString(zone.id)}')">Лишити пустим</button>`;
            return `
                <div class="dashboard-planner-zone is-${state}" data-planner-zone="${escapeHtml(zone.id)}" style="left:${Number(zone.x)}px;top:${Number(zone.y)}px;width:${Number(zone.w)}px;height:${Number(zone.h)}px">
                    <div class="planner-zone-head">
                        <strong>${escapeHtml(zone.title)}</strong>
                        <span>${escapeHtml(stateLabel)}</span>
                    </div>
                    <p>${escapeHtml(zone.hint)}</p>
                    <div class="planner-zone-actions">
                        ${state === 'occupied' ? '' : primaryAction}
                        ${state === 'reserved' ? '' : reserveAction}
                    </div>
                </div>
            `;
        }).join('');
        return `
            <div class="dashboard-planner-layer" aria-label="Планувальник layout dashboard">
                <div class="dashboard-planner-guide">
                    <span>Plan mode</span>
                    <strong>Сплануйте композицію: віджет, слот або навмисна тиша.</strong>
                    <em>Підказки видно тільки в режимі планування і не засмічують щоденний dashboard.</em>
                </div>
                ${zones}
            </div>
        `;
    }

    function isBoardThinGeometryItem(item) {
        return item?.type === 'shape' && ['line', 'arrow'].includes(item.shape);
    }

    function isBoardPrimitiveShapeItem(item) {
        return item?.type === 'shape';
    }

    function isBoardEquilateralShapeItem(item) {
        return isBoardPrimitiveShapeItem(item) && isBoardEquilateralShape(item.shape);
    }

    function renderBoardItem(item) {
        if (item.hidden && _boardInteractionMode !== 'edit') return '';
        if (isBoardPrimitiveShapeItem(item)) return renderBoardPrimitiveShapeItem(item);
        const def = item.type === 'widget' ? WIDGET_DEFS[item.widgetType] : null;
        const selected = _boardSelectedId === item.id ? ' selected' : '';
        const editing = _boardObjectEditing?.id === item.id ? ' editing' : '';
        const inspecting = _boardWidgetInspectId === item.id ? ' widget-inspecting' : '';
        const locked = item.locked ? ' locked' : '';
        const hidden = item.hidden ? ' hidden-object' : '';
        const geometry = isBoardThinGeometryItem(item) ? ' thin-geometry' : '';
        const runtimeState = getBoardWidgetRuntimeState(item);
        const style = `left:${Number(item.x || 0)}px;top:${Number(item.y || 0)}px;width:${Number(item.w || 280)}px;height:${Number(item.h || 160)}px;z-index:${Number(item.z || 1)}`;
        const title = item.type === 'widget'
            ? (item.title || def?.title || item.widgetType)
            : (item.title || (item.type === 'shape' ? 'Shape' : item.type === 'space' ? 'Порожня зона' : 'Нотатка'));
        const idAttr = escapeHtml(item.id);
        const idJs = escapeJsString(item.id);
        return `
            <section class="dashboard-board-item workspace-module type-${escapeHtml(item.type)}${selected}${editing}${inspecting}${locked}${hidden}${geometry}" data-workspace-module="true" data-module-role="${escapeHtml(item.type)}" data-widget-runtime="${escapeHtml(runtimeState)}" data-widget-type="${item.type === 'widget' ? escapeHtml(item.widgetType) : ''}" data-board-item-id="${idAttr}" data-board-shape-kind="${escapeHtml(item.shape || '')}" style="${style}">
                <div class="dashboard-board-item-frame" data-board-drag-handle>
                    <div class="dashboard-board-item-title">
                        <span>${item.type === 'widget' ? escapeHtml(def?.icon || '◼') : item.type === 'shape' ? '□' : item.type === 'space' ? '◌' : '•'}</span>
                        <strong>${escapeHtml(title)}</strong>
                    </div>
                    <div class="dashboard-board-item-actions">
                        <button type="button" title="Дублювати" onclick="DashboardPage.duplicateBoardItem('${idJs}')">⧉</button>
                        <button type="button" title="Вище" onclick="DashboardPage.changeBoardItemZ('${idJs}', 1)">↑</button>
                        <button type="button" title="Нижче" onclick="DashboardPage.changeBoardItemZ('${idJs}', -1)">↓</button>
                        <button type="button" title="${item.locked ? 'Розблокувати' : 'Заблокувати'}" onclick="DashboardPage.toggleBoardItemLock('${idJs}')">${item.locked ? '🔒' : '🔓'}</button>
                        <button type="button" title="${item.hidden ? 'Показати' : 'Сховати'}" onclick="DashboardPage.toggleBoardItemHidden('${idJs}')">${item.hidden ? '◌' : '●'}</button>
                        <button type="button" title="Видалити" onclick="DashboardPage.deleteBoardItem('${idJs}')">×</button>
                    </div>
                </div>
                <div class="dashboard-board-item-content">
                    ${renderBoardItemContent(item)}
                </div>
                ${renderBoardResizeHandles(item)}
                ${renderBoardAnchors(item)}
            </section>
        `;
    }

    function renderBoardPrimitiveShapeItem(item) {
        const selected = _boardSelectedId === item.id ? ' selected' : '';
        const locked = item.locked ? ' locked' : '';
        const hidden = item.hidden ? ' hidden-object' : '';
        const geometry = isBoardThinGeometryItem(item) ? ' thin-geometry' : '';
        const equilateral = isBoardEquilateralShapeItem(item) ? ' equilateral-geometry' : '';
        const style = `left:${Number(item.x || 0)}px;top:${Number(item.y || 0)}px;width:${Number(item.w || 150)}px;height:${Number(item.h || 150)}px;z-index:${Number(item.z || 1)}`;
        const idAttr = escapeHtml(item.id);
        return `
            <section class="dashboard-board-item board-primitive-shape type-shape shape-${escapeHtml(item.shape || 'rect')}${selected}${locked}${hidden}${geometry}${equilateral}" data-board-primitive-shape="true" data-board-item-id="${idAttr}" data-board-shape-kind="${escapeHtml(item.shape || 'rect')}" style="${style}">
                <div class="dashboard-board-item-content board-primitive-shape-content" data-board-drag-handle>
                    ${renderBoardItemContent(item)}
                </div>
                ${renderBoardResizeHandles(item)}
                ${renderBoardAnchors(item)}
            </section>
        `;
    }

    function getBoardWidgetRuntimeState(item) {
        if (!item || item.type !== 'widget') return 'not-widget';
        if (item.hidden || item.depth !== 'live-compact') return 'static';
        if (_boardDrag?.id === item.id || _boardResize?.id === item.id) return 'suspended';
        return 'live';
    }

    function renderBoardResizeHandles(item) {
        if (!item || item.locked || item.hidden || _boardInteractionMode !== 'edit' || _boardSelectedId !== item.id) return '';
        if (isBoardThinGeometryItem(item)) return '';
        return `
            <div class="board-resize-handles" aria-hidden="true">
                ${['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'].map(dir => `<button type="button" class="board-resize-handle board-resize-${dir}" data-board-resize-handle="${dir}" title="Resize ${dir}"></button>`).join('')}
            </div>
        `;
    }

    function renderBoardAnchors(item) {
        if (item.locked || item.hidden) return '';
        if (isBoardThinGeometryItem(item)) return '';
        const idJs = escapeJsString(item.id);
        return `
            <div class="board-anchor-set" aria-hidden="${_boardWorkspaceMode === 'board:connect' ? 'false' : 'true'}">
                ${['top', 'right', 'bottom', 'left'].map(anchor => `<button type="button" class="board-anchor anchor-${anchor}" data-board-anchor="${anchor}" onclick="DashboardPage.handleBoardAnchor('${idJs}', '${anchor}', event)" title="Зв’язати: ${BOARD_ANCHOR_LABELS[anchor] || anchor}"></button>`).join('')}
            </div>
        `;
    }

    function renderBoardItemContent(item) {
        if (item.type === 'widget') {
            const def = WIDGET_DEFS[item.widgetType] || {};
            if (item.depth === 'headline-only' || item.depth === 'snapshot-static') {
                return `
                    <a class="board-widget-headline" href="${escapeHtml(boardWidgetHref(item.widgetType))}">
                        <span>${escapeHtml(def.icon || '◼')}</span>
                        <strong>${escapeHtml(def.title || item.widgetType)}</strong>
                        <em>${item.depth === 'snapshot-static' ? 'snapshot' : 'headline-only'}</em>
                    </a>
                `;
            }
            return `<div class="board-widget-live" id="board-widget-${escapeHtml(item.id)}"><div class="widget-loading">Завантаження...</div></div>`;
        }
        if (item.type === 'shape') {
            if (isBoardThinGeometryItem(item)) {
                return `
                    <div class="board-shape board-shape-${escapeHtml(item.shape || 'line')}" data-board-shape>
                        <button type="button" class="board-line-endpoint endpoint-start" data-board-line-endpoint="start" aria-label="Move line start"></button>
                        <button type="button" class="board-line-endpoint endpoint-end" data-board-line-endpoint="end" aria-label="Move line end"></button>
                    </div>
                `;
            }
            return `<div class="board-shape board-shape-${escapeHtml(item.shape || 'rect')}" data-board-shape></div>`;
        }
        if (item.type === 'frame') {
            return `<div class="board-frame-label">${escapeHtml(item.text || 'Frame')}</div>`;
        }
        if (item.type === 'space') {
            return `
                <div class="board-empty-zone-content">
                    <span>${item.zoneKind === 'breathing' ? 'breathing room' : 'reserved space'}</span>
                    <strong>${escapeHtml(item.title || 'Порожня зона')}</strong>
                    <p>${escapeHtml(item.text || 'Це місце навмисно лишене вільним для композиції або майбутнього віджета.')}</p>
                    ${_boardInteractionMode === 'edit' ? '<em>Можна пересунути, змінити розмір або перетворити на віджет пізніше.</em>' : ''}
                </div>
            `;
        }
        const readonly = item.locked ? ' readonly aria-readonly="true"' : '';
        return `<textarea class="board-note-text board-note-editor" data-board-text="${escapeHtml(item.id)}" data-board-item-id="${escapeHtml(item.id)}" placeholder="Нотатка" spellcheck="true"${readonly}>${escapeHtml(item.text || '')}</textarea>`;
    }

    function boardWidgetHref(type) {
        const hrefs = {
            tasks: '/tasks',
            my_schedule: '/staff',
            funnel: '/sales-funnel',
            alerts: '/dashboard',
            weather: '/dashboard'
        };
        return hrefs[type] || '/dashboard';
    }

    function renderBoardMiniInspector() {
        if (_boardInteractionMode === 'view') return '';
        const item = _boardSelectedId ? findBoardItem(_boardSelectedId) : null;
        const connector = _boardSelectedConnectorId ? getBoardConnectors().find(conn => conn.id === _boardSelectedConnectorId) : null;
        const prefs = safeObject(_config?.boardState?.preferences, {});
        const mode = getBoardWorkspaceMode();
        const modeLabel = BOARD_MODE_LABELS[mode] || mode.replace('board:', '').replace('object:', '');
        const connectorDraft = _boardConnectorDraft
            ? `<span class="board-inspector-hint">Початок зв’язку: ${escapeHtml(BOARD_ANCHOR_LABELS[_boardConnectorDraft.anchor] || _boardConnectorDraft.anchor)}</span>`
            : '';
        const objectControls = item ? `
            <div class="board-inspector-section">
                <strong>${escapeHtml(item.title || BOARD_TYPE_LABELS[item.type] || item.type)}</strong>
                <span>${escapeHtml(BOARD_TYPE_LABELS[item.type] || item.type)} · ${Math.round(Number(item.w || 0))}x${Math.round(Number(item.h || 0))}</span>
                ${item.type === 'widget' ? `
                    <div class="board-inspector-row">
                        ${['live-compact', 'headline-only', 'snapshot-static'].map(depth => `<button type="button" class="board-inspector-chip${item.depth === depth ? ' active' : ''}" onclick="DashboardPage.setBoardWidgetDepth('${escapeJsString(item.id)}', '${depth}')">${BOARD_DEPTH_LABELS[depth] || depth}</button>`).join('')}
                    </div>
                    ${_boardWidgetInspectId === item.id ? `<button type="button" class="board-inspector-chip active" onclick="DashboardPage.exitBoardObjectEditing()">Вийти з фокусу</button>` : `<button type="button" class="board-inspector-chip" onclick="DashboardPage.enterBoardWidgetInspect('${escapeJsString(item.id)}')">Фокус віджета</button>`}
                ` : ''}
                ${item.type === 'note' || item.type === 'text' ? `<button type="button" class="board-inspector-chip" onclick="DashboardPage.runBoardAiAction('tasks')">Зробити задачі</button>` : ''}
                <div class="board-inspector-row" aria-label="Керування шарами">
                    <button type="button" class="board-inspector-chip" onclick="DashboardPage.changeBoardItemZ('${escapeJsString(item.id)}', 10)">Вище</button>
                    <button type="button" class="board-inspector-chip" onclick="DashboardPage.changeBoardItemZ('${escapeJsString(item.id)}', -10)">Нижче</button>
                </div>
                <button type="button" class="board-inspector-chip danger" onclick="DashboardPage.deleteBoardItem('${escapeJsString(item.id)}')">Видалити</button>
            </div>
        ` : '';
        const connectorControls = connector ? `
            <div class="board-inspector-section">
                <strong>Зв’язок</strong>
                <span>${escapeHtml(BOARD_RELATION_LABELS[connector.relationType] || connector.relationType)} · ${escapeHtml(BOARD_CONNECTOR_STYLE_LABELS[connector.style] || connector.style)}</span>
                <div class="board-inspector-row">
                    ${['idea', 'depends', 'blocks', 'feeds', 'inspires'].map(type => `<button type="button" class="board-inspector-chip${connector.relationType === type ? ' active' : ''}" onclick="DashboardPage.updateBoardConnector('${escapeJsString(connector.id)}', 'relationType', '${type}')">${BOARD_RELATION_LABELS[type] || type}</button>`).join('')}
                </div>
                <div class="board-inspector-row">
                    ${['line', 'arrow', 'curve'].map(style => `<button type="button" class="board-inspector-chip${connector.style === style ? ' active' : ''}" onclick="DashboardPage.updateBoardConnector('${escapeJsString(connector.id)}', 'style', '${style}')">${BOARD_CONNECTOR_STYLE_LABELS[style] || style}</button>`).join('')}
                </div>
                <button type="button" class="board-inspector-chip danger" onclick="DashboardPage.deleteBoardConnector('${escapeJsString(connector.id)}')">Видалити зв’язок</button>
            </div>
        ` : '';
        return `
            <aside class="board-mini-inspector" aria-label="Board inspector">
                <div class="board-inspector-section">
                    <strong>Режим: ${escapeHtml(modeLabel)}</strong>
                    <span>Інструмент: ${escapeHtml(BOARD_TOOL_LABELS[normalizeBoardTool(_config?.boardState?.activeTool || 'select')] || 'Вибір')}</span>
                    ${connectorDraft}
                </div>
                ${objectControls || connectorControls || `
                    <div class="board-inspector-section">
                        <strong>Планування композиції</strong>
                        <span>Оберіть слот на полотні, додайте віджет або лишіть місце вільним для дихання сцени.</span>
                        <div class="board-inspector-row">
                            <button type="button" class="board-inspector-chip" onclick="DashboardPage.addBoardSpace()">Порожня зона</button>
                            <button type="button" class="board-inspector-chip" onclick="DashboardPage.addSelectedBoardWidget()">Віджет</button>
                        </div>
                    </div>
                `}
                <div class="board-inspector-section">
                    <strong>AI-шаблони</strong>
                    <div class="board-inspector-row">
                        ${['expand', 'mood-pack', 'cluster', 'summarize', 'tasks', 'remix', 'name-frame', 'prompt-to-board'].map(action => `<button type="button" class="board-inspector-chip" onclick="DashboardPage.runBoardAiAction('${action}')">${BOARD_AI_ACTION_LABELS[action] || action}</button>`).join('')}
                    </div>
                </div>
                <div class="board-inspector-section">
                    <strong>Зв’язки</strong>
                    <div class="board-inspector-row">
                        ${['idea', 'depends', 'blocks', 'feeds', 'inspires'].map(type => `<button type="button" class="board-inspector-chip${prefs.relationType === type ? ' active' : ''}" onclick="DashboardPage.setBoardConnectorPreference('relationType', '${type}')">${BOARD_RELATION_LABELS[type] || type}</button>`).join('')}
                    </div>
                    <div class="board-inspector-row">
                        ${['line', 'arrow', 'curve'].map(style => `<button type="button" class="board-inspector-chip${prefs.connectorStyle === style ? ' active' : ''}" onclick="DashboardPage.setBoardConnectorPreference('connectorStyle', '${style}')">${BOARD_CONNECTOR_STYLE_LABELS[style] || style}</button>`).join('')}
                    </div>
                </div>
                <div class="board-inspector-section">
                    <strong>Прив’язка</strong>
                    <div class="board-inspector-row">
                        ${['strict', 'soft', 'freeform'].map(mode => `<button type="button" class="board-inspector-chip${normalizeBoardSnapMode(prefs.snapMode) === mode ? ' active' : ''}" onclick="DashboardPage.setBoardSnapMode('${mode}')">${BOARD_SNAP_LABELS[mode] || mode}</button>`).join('')}
                    </div>
                </div>
            </aside>
        `;
    }

    function bindBoardItemHandlers() {
        const canvas = document.getElementById('dashboardBoardCanvas');
        if (!canvas) return;
        canvas.querySelectorAll('.dashboard-board-item').forEach(el => {
            el.addEventListener('click', event => {
                if (_boardInteractionMode !== 'edit') return;
                if (isBoardInteractiveTarget(event.target)) {
                    event.stopPropagation();
                    selectBoardItem(el.dataset.boardItemId, { render: false });
                    return;
                }
                event.stopPropagation();
                selectBoardItem(el.dataset.boardItemId);
            });
            const handle = el.querySelector('[data-board-drag-handle]');
            if (handle && handle.dataset.dragBound !== 'true') {
                handle.dataset.dragBound = 'true';
                handle.addEventListener('pointerdown', event => beginBoardDrag(event, el));
            }
            if (el.dataset.directDragBound === 'true') return;
            el.dataset.directDragBound = 'true';
            el.addEventListener('pointerdown', event => {
                if (_boardInteractionMode !== 'edit' || event.button !== 0) return;
                if (!canStartDirectBoardDrag(findBoardItem(el.dataset.boardItemId), event.target)) return;
                beginBoardDrag(event, el);
            });
        });
        canvas.querySelectorAll('[data-board-line-endpoint]').forEach(handle => {
            if (handle.dataset.endpointBound === 'true') return;
            handle.dataset.endpointBound = 'true';
            handle.addEventListener('pointerdown', event => beginBoardLineEndpointDrag(event, handle));
        });
        canvas.querySelectorAll('.board-widget-live').forEach(widgetEl => {
            widgetEl.addEventListener('pointerdown', event => {
                event.stopPropagation();
                const itemEl = widgetEl.closest('.dashboard-board-item');
                if (itemEl && _boardInteractionMode === 'edit') selectBoardItem(itemEl.dataset.boardItemId, { render: false });
            });
            widgetEl.addEventListener('click', event => {
                event.stopPropagation();
                const itemEl = widgetEl.closest('.dashboard-board-item');
                if (itemEl && _boardInteractionMode === 'edit') selectBoardItem(itemEl.dataset.boardItemId, { render: false });
            });
        });
        canvas.querySelectorAll('[data-board-resize-handle]').forEach(handle => {
            if (handle.dataset.resizeBound === 'true') return;
            handle.dataset.resizeBound = 'true';
            handle.addEventListener('pointerdown', event => beginBoardResize(event, handle));
        });
        canvas.querySelectorAll('[data-board-text]').forEach(textEl => {
            textEl.addEventListener('pointerdown', event => {
                event.stopPropagation();
            });
            textEl.addEventListener('click', event => {
                event.stopPropagation();
                selectBoardItem(textEl.dataset.boardText, { render: false });
                if (_boardInteractionMode === 'view' && typeof textEl.focus === 'function') textEl.focus();
            });
            textEl.addEventListener('focus', () => {
                textEl.dataset.originalText = boardTextValue(textEl);
                delete textEl.dataset.undoPushed;
                selectBoardItem(textEl.dataset.boardText, { render: false });
                enterBoardObjectEditing(textEl.dataset.boardText, 'text');
            });
            textEl.addEventListener('input', () => handleBoardTextInput(textEl));
            textEl.addEventListener('blur', () => {
                commitBoardTextEdit(textEl);
                if (_boardObjectEditing?.id === textEl.dataset.boardText) {
                    _boardObjectEditing = null;
                    syncBoardWorkspaceMode();
                    syncBoardToolbar();
                }
            });
        });
    }

    function bindBoardConnectorHandlers() {
        const canvas = document.getElementById('dashboardBoardCanvas');
        if (!canvas) return;
        canvas.querySelectorAll('[data-board-connector-id]').forEach(el => {
            el.addEventListener('click', event => {
                if (_boardInteractionMode !== 'edit') return;
                event.preventDefault();
                event.stopPropagation();
                _boardSelectedId = null;
                _boardSelectedConnectorId = el.dataset.boardConnectorId || null;
                renderBoard();
            });
        });
        canvas.querySelectorAll('[data-board-connector-endpoint]').forEach(handle => {
            if (handle.dataset.endpointBound === 'true') return;
            handle.dataset.endpointBound = 'true';
            handle.addEventListener('pointerdown', event => beginBoardConnectorEndpointDrag(event, handle));
        });
    }

    function bindBoardCanvasHandlers(canvas) {
        if (!canvas) return;
        canvas.onpointerdown = beginBoardCanvasPointer;
        canvas.onclick = event => {
            if (Date.now() < _boardSuppressCanvasClickUntil) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (_boardInteractionMode === 'edit' && event.target === canvas) selectBoardItem(null);
        };
    }

    function isBoardInteractiveTarget(target) {
        return !!(target && target.closest && target.closest('button, a, input, textarea, select, [contenteditable="true"], [data-board-text]'));
    }

    function isBoardDragBlockedTarget(target) {
        return !!(target && target.closest && target.closest('button, a, input, textarea, select, [contenteditable="true"], [data-board-text], [data-board-resize-handle], [data-board-line-endpoint], [data-board-connector-endpoint], .dashboard-board-item-actions, .board-widget-live'));
    }

    function canStartDirectBoardDrag(item, target) {
        if (!item || item.locked || _boardObjectEditing?.id === item.id || _boardWidgetInspectId === item.id) return false;
        if (isBoardDragBlockedTarget(target)) return false;
        if (item.type === 'widget' || item.type === 'note' || item.type === 'text') return false;
        if (isBoardThinGeometryItem(item)) return !!target?.closest?.('[data-board-shape]');
        return item.type === 'shape' || item.type === 'frame' || item.type === 'space';
    }

    function boardPointFromEvent(event) {
        const canvas = document.getElementById('dashboardBoardCanvas');
        if (!canvas) return [0, 0];
        const rect = canvas.getBoundingClientRect();
        return [
            Math.round(event.clientX - rect.left),
            Math.round(event.clientY - rect.top)
        ];
    }

    function getBoardSnapUnit() {
        const prefs = safeObject(_config?.boardState?.preferences, {});
        const snapMode = normalizeBoardSnapMode(prefs.snapMode || (prefs.snapToGrid === false ? 'freeform' : 'soft'));
        if (snapMode === 'freeform' || prefs.snapToGrid === false) return 1;
        if (snapMode === 'strict') return 24;
        return 10;
    }

    function beginBoardCanvasPointer(event) {
        if (shouldStartBoardPan(event)) {
            beginBoardPan(event);
            return;
        }
        if (_boardInteractionMode !== 'edit' || event.button !== 0) return;
        if (event.target?.closest?.('.dashboard-board-item') || isBoardInteractiveTarget(event.target)) return;
        const tool = normalizeBoardTool(_config?.boardState?.activeTool || 'select');
        const blockedSurface = event.target?.closest?.('.dashboard-board-empty, .dashboard-board-warning, .dashboard-planner-zone, .dashboard-planner-guide');
        if (blockedSurface && !(BOARD_CREATE_TOOLS.has(tool) || BOARD_SHAPE_TOOLS.has(tool))) return;
        if (tool === 'connector') {
            _boardConnectorDraft = null;
            renderBoard();
            return;
        }
        if (BOARD_CREATE_TOOLS.has(tool) || BOARD_SHAPE_TOOLS.has(tool)) {
            event.preventDefault();
            event.stopPropagation();
            createBoardItemFromTool(tool, boardPointFromEvent(event));
            return;
        }
        if (BOARD_DRAW_TOOLS.has(tool)) {
            beginBoardStroke(event, tool);
            return;
        }
        if (tool === 'eraser') {
            eraseBoardStrokeAt(event);
        }
    }

    function shouldStartBoardPan(event) {
        if (!event) return false;
        const tool = normalizeBoardTool(_config?.boardState?.activeTool || 'select');
        if (event.button === 1) return !isBoardInteractiveTarget(event.target);
        if (event.button !== 0) return false;
        if (tool !== 'hand' && !_boardSpaceHandActive) return false;
        return !isBoardInteractiveTarget(event.target);
    }

    function beginBoardPan(event) {
        const shell = document.getElementById('dashboardBoardShell') || event.currentTarget?.closest?.('.dashboard-board-shell');
        if (!shell) return;
        event.preventDefault();
        event.stopPropagation();
        _boardPan = {
            shell,
            startX: event.clientX,
            startY: event.clientY,
            scrollLeft: shell.scrollLeft,
            scrollTop: shell.scrollTop,
            moved: false
        };
        shell.classList.add('is-panning');
        event.currentTarget?.setPointerCapture?.(event.pointerId);
        document.addEventListener('pointermove', handleBoardPanMove);
        document.addEventListener('pointerup', endBoardPan, { once: true });
    }

    function handleBoardPanMove(event) {
        if (!_boardPan?.shell) return;
        const dx = event.clientX - _boardPan.startX;
        const dy = event.clientY - _boardPan.startY;
        _boardPan.shell.scrollLeft = _boardPan.scrollLeft - dx;
        _boardPan.shell.scrollTop = _boardPan.scrollTop - dy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _boardPan.moved = true;
    }

    function endBoardPan() {
        document.removeEventListener('pointermove', handleBoardPanMove);
        if (!_boardPan) return;
        const pan = _boardPan;
        _boardPan = null;
        pan.shell?.classList.remove('is-panning');
        if (pan.moved) _boardSuppressCanvasClickUntil = Date.now() + 160;
    }

    function beginBoardStroke(event, tool) {
        if (!_config?.boardState) return;
        event.preventDefault();
        event.stopPropagation();
        const preferences = safeObject(_config.boardState.preferences, {});
        const point = boardPointFromEvent(event);
        const stroke = normalizeBoardStroke({
            id: `stroke-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            tool,
            color: tool === 'highlighter' ? '#f59e0b' : String(preferences.strokeColor || '#10b981'),
            width: tool === 'highlighter' ? Math.max(10, Number(preferences.strokeWidth || 2) * 5) : Number(preferences.strokeWidth || 2),
            opacity: tool === 'highlighter' ? 0.34 : 0.9,
            points: [point, point]
        }, getBoardDrawings().length);
        if (!stroke) return;
        pushBoardUndo('draw');
        getBoardDrawings().push(stroke);
        _boardDrawing = { strokeId: stroke.id, moved: false };
        event.currentTarget?.setPointerCapture?.(event.pointerId);
        document.addEventListener('pointermove', handleBoardStrokeMove);
        document.addEventListener('pointerup', endBoardStroke, { once: true });
        renderBoard();
    }

    function handleBoardStrokeMove(event) {
        if (!_boardDrawing) return;
        const stroke = getBoardDrawings().find(item => item.id === _boardDrawing.strokeId);
        if (!stroke) return;
        const point = boardPointFromEvent(event);
        const previous = stroke.points[stroke.points.length - 1] || point;
        if (Math.abs(point[0] - previous[0]) < 2 && Math.abs(point[1] - previous[1]) < 2) return;
        stroke.points.push(point);
        _boardDrawing.moved = true;
        const path = document.getElementById(`board-stroke-${stroke.id}`);
        if (path) path.setAttribute('d', boardStrokePath(stroke.points));
    }

    function endBoardStroke() {
        document.removeEventListener('pointermove', handleBoardStrokeMove);
        const drawing = _boardDrawing;
        _boardDrawing = null;
        if (!drawing) return;
        const drawings = getBoardDrawings();
        const index = drawings.findIndex(item => item.id === drawing.strokeId);
        if (index < 0) return;
        if (!drawing.moved) {
            drawings.splice(index, 1);
            renderBoard();
            return;
        }
        markBoardDirty('draw');
        renderBoard();
    }

    function distanceToStroke(point, stroke) {
        return (stroke.points || []).reduce((min, next) => {
            const dx = Number(next[0] || 0) - point[0];
            const dy = Number(next[1] || 0) - point[1];
            return Math.min(min, Math.sqrt(dx * dx + dy * dy));
        }, Infinity);
    }

    function eraseBoardStrokeAt(event) {
        const point = boardPointFromEvent(event);
        const drawings = getBoardDrawings();
        let index = -1;
        let best = Infinity;
        drawings.forEach((stroke, idx) => {
            const distance = distanceToStroke(point, stroke);
            if (distance < best) {
                best = distance;
                index = idx;
            }
        });
        if (index < 0 || best > 22) return;
        pushBoardUndo('erase');
        drawings.splice(index, 1);
        markBoardDirty('erase');
        renderBoard();
    }

    function findBoardItem(id) {
        return getBoardItems().find(item => item.id === id) || null;
    }

    function selectBoardItem(id, options = {}) {
        _boardSelectedId = id || null;
        if (_boardSelectedId) _boardSelectedConnectorId = null;
        if (options.render === false) {
            syncBoardSelectionClasses();
            syncBoardToolbar();
            return;
        }
        renderBoard();
    }

    function syncBoardSelectionClasses() {
        const canvas = document.getElementById('dashboardBoardCanvas');
        if (!canvas) return;
        canvas.querySelectorAll('.dashboard-board-item').forEach(el => {
            el.classList.toggle('selected', !!_boardSelectedId && el.dataset.boardItemId === _boardSelectedId);
        });
    }

    function syncBoardWidgetRuntime() {
        const canvas = document.getElementById('dashboardBoardCanvas');
        if (!canvas) return;
        canvas.querySelectorAll('.dashboard-board-item.type-widget').forEach(el => {
            const item = findBoardItem(el.dataset.boardItemId);
            const state = getBoardWidgetRuntimeState(item);
            el.dataset.widgetRuntime = state;
            const live = el.querySelector('.board-widget-live');
            if (live) {
                live.dataset.widgetRuntime = state;
                live.setAttribute('aria-busy', state === 'suspended' ? 'true' : 'false');
            }
        });
    }

    function beginBoardDrag(event, element) {
        if (_boardInteractionMode !== 'edit' || event.button !== 0) return;
        if (isBoardInteractiveTarget(event.target)) return;
        const id = element.dataset.boardItemId;
        const item = findBoardItem(id);
        if (!item || item.locked) return;
        event.preventDefault();
        event.stopPropagation();
        selectBoardItem(id, { render: false });
        const rect = element.getBoundingClientRect();
        _boardDrag = {
            id,
            startX: event.clientX,
            startY: event.clientY,
            itemX: Number(item.x || 0),
            itemY: Number(item.y || 0),
            width: rect.width,
            height: rect.height,
            element,
            moved: false
        };
        element.setPointerCapture?.(event.pointerId);
        document.addEventListener('pointermove', handleBoardDragMove);
        document.addEventListener('pointerup', endBoardDrag, { once: true });
    }

    function handleBoardDragMove(event) {
        if (!_boardDrag) return;
        const item = findBoardItem(_boardDrag.id);
        const element = _boardDrag.element;
        if (!item || !element) return;
        const dx = event.clientX - _boardDrag.startX;
        const dy = event.clientY - _boardDrag.startY;
        const snap = getBoardSnapUnit();
        const x = Math.round((_boardDrag.itemX + dx) / snap) * snap;
        const y = Math.round((_boardDrag.itemY + dy) / snap) * snap;
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
        _boardDrag.nextX = x;
        _boardDrag.nextY = y;
        _boardDrag.moved = true;
    }

    function endBoardDrag() {
        document.removeEventListener('pointermove', handleBoardDragMove);
        if (!_boardDrag) return;
        const drag = _boardDrag;
        _boardDrag = null;
        if (!drag.moved) return;
        const item = findBoardItem(drag.id);
        if (!item) return;
        pushBoardUndo('move');
        item.x = safeNumber(drag.nextX, item.x, -10000, 10000);
        item.y = safeNumber(drag.nextY, item.y, -10000, 10000);
        markBoardDirty('move');
        renderBoard();
    }

    function beginBoardResize(event, handle) {
        if (_boardInteractionMode !== 'edit' || event.button !== 0) return;
        const element = handle.closest('.dashboard-board-item');
        const id = element?.dataset.boardItemId;
        const item = findBoardItem(id);
        if (!element || !item || item.locked) return;
        event.preventDefault();
        event.stopPropagation();
        selectBoardItem(id, { render: false });
        _boardResize = {
            id,
            dir: handle.dataset.boardResizeHandle || 'se',
            startX: event.clientX,
            startY: event.clientY,
            itemX: Number(item.x || 0),
            itemY: Number(item.y || 0),
            itemW: Number(item.w || 280),
            itemH: Number(item.h || 160),
            element,
            moved: false
        };
        element.setPointerCapture?.(event.pointerId);
        document.addEventListener('pointermove', handleBoardResizeMove);
        document.addEventListener('pointerup', endBoardResize, { once: true });
        syncBoardWidgetRuntime();
    }

    function minBoardItemSize(item) {
        if (item?.type === 'widget') return { w: 210, h: 150 };
        if (item?.type === 'frame') return { w: 180, h: 120 };
        if (isBoardThinGeometryItem(item)) return { w: 64, h: 42 };
        if (isBoardEquilateralShapeItem(item)) return { w: 80, h: 80 };
        return { w: 120, h: 82 };
    }

    function computeBoardResizeState(event) {
        const resize = _boardResize;
        const item = resize ? findBoardItem(resize.id) : null;
        if (!resize || !item) return null;
        const snap = getBoardSnapUnit();
        const minSize = minBoardItemSize(item);
        let nextX = resize.itemX;
        let nextY = resize.itemY;
        let nextW = resize.itemW;
        let nextH = resize.itemH;
        const dx = event.clientX - resize.startX;
        const dy = event.clientY - resize.startY;
        const dir = resize.dir || 'se';
        if (dir.includes('e')) nextW = resize.itemW + dx;
        if (dir.includes('s')) nextH = resize.itemH + dy;
        if (dir.includes('w')) {
            nextX = resize.itemX + dx;
            nextW = resize.itemW - dx;
        }
        if (dir.includes('n')) {
            nextY = resize.itemY + dy;
            nextH = resize.itemH - dy;
        }
        nextW = Math.max(minSize.w, Math.min(1200, Math.round(nextW / snap) * snap));
        nextH = Math.max(minSize.h, Math.min(900, Math.round(nextH / snap) * snap));
        if (isBoardEquilateralShapeItem(item)) {
            const size = Math.max(minSize.w, Math.min(900, dir.length === 1 && (dir === 'n' || dir === 's') ? nextH : dir.length === 1 ? nextW : Math.max(nextW, nextH)));
            nextW = size;
            nextH = size;
        }
        if (dir.includes('w')) nextX = resize.itemX + resize.itemW - nextW;
        if (dir.includes('n')) nextY = resize.itemY + resize.itemH - nextH;
        nextX = Math.round(nextX / snap) * snap;
        nextY = Math.round(nextY / snap) * snap;
        return { item, x: nextX, y: nextY, w: nextW, h: nextH };
    }

    function handleBoardResizeMove(event) {
        if (!_boardResize) return;
        const next = computeBoardResizeState(event);
        if (!next || !_boardResize.element) return;
        const { element } = _boardResize;
        element.style.left = `${next.x}px`;
        element.style.top = `${next.y}px`;
        element.style.width = `${next.w}px`;
        element.style.height = `${next.h}px`;
        _boardResize.nextX = next.x;
        _boardResize.nextY = next.y;
        _boardResize.nextW = next.w;
        _boardResize.nextH = next.h;
        _boardResize.moved = true;
    }

    function endBoardResize() {
        document.removeEventListener('pointermove', handleBoardResizeMove);
        if (!_boardResize) return;
        const resize = _boardResize;
        _boardResize = null;
        if (!resize.moved) {
            syncBoardWidgetRuntime();
            return;
        }
        const item = findBoardItem(resize.id);
        if (!item) return;
        pushBoardUndo('resize');
        item.x = safeNumber(resize.nextX, item.x, -10000, 10000);
        item.y = safeNumber(resize.nextY, item.y, -10000, 10000);
        item.w = safeNumber(resize.nextW, item.w, 80, 1200);
        item.h = safeNumber(resize.nextH, item.h, 60, 900);
        markBoardDirty('resize');
        renderBoard();
    }

    function beginBoardLineEndpointDrag(event, handle) {
        if (_boardInteractionMode !== 'edit' || event.button !== 0) return;
        const element = handle.closest('.dashboard-board-item');
        const id = element?.dataset.boardItemId;
        const item = findBoardItem(id);
        if (!element || !item || item.locked || !isBoardThinGeometryItem(item)) return;
        event.preventDefault();
        event.stopPropagation();
        selectBoardItem(id, { render: false });
        _boardLineEndpointDrag = {
            id,
            endpoint: handle.dataset.boardLineEndpoint || 'end',
            startX: event.clientX,
            itemX: Number(item.x || 0),
            itemW: Number(item.w || 260),
            element,
            moved: false
        };
        handle.setPointerCapture?.(event.pointerId);
        document.addEventListener('pointermove', handleBoardLineEndpointMove);
        document.addEventListener('pointerup', endBoardLineEndpointDrag, { once: true });
    }

    function handleBoardLineEndpointMove(event) {
        const drag = _boardLineEndpointDrag;
        if (!drag?.element) return;
        const item = findBoardItem(drag.id);
        if (!item) return;
        const snap = getBoardSnapUnit();
        const minSize = minBoardItemSize(item);
        const dx = event.clientX - drag.startX;
        let nextX = drag.itemX;
        let nextW = drag.itemW;
        if (drag.endpoint === 'start') {
            nextX = Math.round((drag.itemX + dx) / snap) * snap;
            nextW = drag.itemW - (nextX - drag.itemX);
            if (nextW < minSize.w) {
                nextW = minSize.w;
                nextX = drag.itemX + drag.itemW - minSize.w;
            }
        } else {
            nextW = Math.round((drag.itemW + dx) / snap) * snap;
            nextW = Math.max(minSize.w, nextW);
        }
        drag.element.style.left = `${nextX}px`;
        drag.element.style.width = `${nextW}px`;
        drag.nextX = nextX;
        drag.nextW = nextW;
        drag.moved = true;
    }

    function endBoardLineEndpointDrag() {
        document.removeEventListener('pointermove', handleBoardLineEndpointMove);
        if (!_boardLineEndpointDrag) return;
        const drag = _boardLineEndpointDrag;
        _boardLineEndpointDrag = null;
        if (!drag.moved) return;
        const item = findBoardItem(drag.id);
        if (!item) return;
        pushBoardUndo('line-endpoint');
        item.x = safeNumber(drag.nextX, item.x, -10000, 10000);
        item.w = safeNumber(drag.nextW, item.w, 64, 1200);
        markBoardDirty('line-endpoint');
        renderBoard();
    }

    function beginBoardConnectorEndpointDrag(event, handle) {
        if (_boardInteractionMode !== 'edit' || event.button !== 0) return;
        const group = handle.closest('[data-board-connector-id]');
        const connectorId = group?.dataset.boardConnectorId;
        const connector = getBoardConnectors().find(conn => conn.id === connectorId);
        if (!group || !connector) return;
        const itemsById = new Map(getBoardItems().map(item => [item.id, item]));
        const fromItem = itemsById.get(connector.from?.itemId);
        const toItem = itemsById.get(connector.to?.itemId);
        if (!fromItem || !toItem) return;
        event.preventDefault();
        event.stopPropagation();
        _boardSelectedId = null;
        _boardSelectedConnectorId = connectorId;
        const fromPoint = boardItemAnchorPoint(fromItem, connector.from.anchor);
        const toPoint = boardItemAnchorPoint(toItem, connector.to.anchor);
        _boardConnectorEndpointDrag = {
            connectorId,
            endpoint: handle.dataset.boardConnectorEndpoint || 'to',
            group,
            startPoint: fromPoint,
            endPoint: toPoint,
            moved: false
        };
        handle.setPointerCapture?.(event.pointerId);
        document.addEventListener('pointermove', handleBoardConnectorEndpointMove);
        document.addEventListener('pointerup', endBoardConnectorEndpointDrag, { once: true });
    }

    function handleBoardConnectorEndpointMove(event) {
        const drag = _boardConnectorEndpointDrag;
        if (!drag?.group) return;
        const connector = getBoardConnectors().find(conn => conn.id === drag.connectorId);
        if (!connector) return;
        const point = boardPointFromEvent(event);
        const fromPoint = drag.endpoint === 'from' ? point : drag.startPoint;
        const toPoint = drag.endpoint === 'to' ? point : drag.endPoint;
        const path = boardConnectorPath(fromPoint, toPoint, connector.style);
        drag.group.querySelector('.board-connector-hit')?.setAttribute('d', path);
        drag.group.querySelector('.board-connector-path')?.setAttribute('d', path);
        const fromHandle = drag.group.querySelector('[data-board-connector-endpoint="from"]');
        const toHandle = drag.group.querySelector('[data-board-connector-endpoint="to"]');
        if (fromHandle) {
            fromHandle.setAttribute('cx', fromPoint[0]);
            fromHandle.setAttribute('cy', fromPoint[1]);
        }
        if (toHandle) {
            toHandle.setAttribute('cx', toPoint[0]);
            toHandle.setAttribute('cy', toPoint[1]);
        }
        drag.lastPoint = point;
        drag.moved = true;
    }

    function endBoardConnectorEndpointDrag() {
        document.removeEventListener('pointermove', handleBoardConnectorEndpointMove);
        if (!_boardConnectorEndpointDrag) return;
        const drag = _boardConnectorEndpointDrag;
        _boardConnectorEndpointDrag = null;
        if (!drag.moved) {
            renderBoard();
            return;
        }
        const connector = getBoardConnectors().find(conn => conn.id === drag.connectorId);
        const target = findNearestBoardAnchor(drag.lastPoint, { threshold: 42 });
        if (!connector || !target) {
            renderBoard();
            return;
        }
        const key = drag.endpoint === 'from' ? 'from' : 'to';
        const current = connector[key] || {};
        if (current.itemId === target.itemId && current.anchor === target.anchor) {
            renderBoard();
            return;
        }
        pushBoardUndo('connector-endpoint');
        connector[key] = { itemId: target.itemId, anchor: target.anchor };
        markBoardDirty('connector-endpoint');
        renderBoard();
    }

    function findNearestBoardAnchor(point, options = {}) {
        if (!Array.isArray(point)) return null;
        const threshold = safeNumber(options.threshold, 36, 8, 160);
        let best = null;
        getBoardItems().forEach(item => {
            if (!item || item.hidden) return;
            ['top', 'right', 'bottom', 'left'].forEach(anchor => {
                const anchorPoint = boardItemAnchorPoint(item, anchor);
                const dx = anchorPoint[0] - point[0];
                const dy = anchorPoint[1] - point[1];
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= threshold && (!best || distance < best.distance)) {
                    best = { itemId: item.id, anchor, distance };
                }
            });
        });
        return best;
    }

    function boardTextValue(textEl) {
        if (!textEl) return '';
        return 'value' in textEl ? String(textEl.value || '') : String(textEl.textContent || '');
    }

    function handleBoardTextInput(textEl) {
        const id = textEl.dataset.boardText;
        const item = findBoardItem(id);
        if (!item || item.locked) return;
        let next = boardTextValue(textEl);
        if (next.length > 5000) {
            next = next.slice(0, 5000);
            if ('value' in textEl) textEl.value = next;
            else textEl.textContent = next;
        }
        if (String(item.text || '') === next) return;
        if (textEl.dataset.undoPushed !== 'true') {
            pushBoardUndo('text-edit');
            textEl.dataset.undoPushed = 'true';
        }
        item.text = next;
        markBoardDirty('text-edit');
    }

    function commitBoardTextEdit(textEl) {
        const id = textEl.dataset.boardText;
        const item = findBoardItem(id);
        if (!item || item.locked) return;
        const previous = textEl.dataset.originalText || '';
        const next = boardTextValue(textEl).slice(0, 5000);
        if (textEl.dataset.undoPushed !== 'true' && previous !== next) {
            pushBoardUndo('text-edit');
            item.text = next;
            markBoardDirty('text-edit');
        }
        delete textEl.dataset.undoPushed;
        textEl.dataset.originalText = next;
    }

    function nextBoardZ() {
        return getBoardItems().reduce((max, item) => Math.max(max, Number(item.z || 0)), 0) + 1;
    }

    function addBoardItem(partial) {
        pushBoardUndo('create');
        const item = normalizeBoardItem({
            id: `board-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            x: 48 + (getBoardItems().length % 4) * 32,
            y: 48 + (getBoardItems().length % 4) * 32,
            z: nextBoardZ(),
            ...partial
        }, getBoardItems().length);
        if (!item) return;
        getBoardItems().push(item);
        _boardSelectedId = item.id;
        markBoardDirty('create');
        renderBoard();
        return item;
    }

    function boardPointForNewItem(point, width = 260, height = 150) {
        const prefs = safeObject(_config?.boardState?.preferences, {});
        const snap = getBoardSnapUnit();
        const fallback = 48 + (getBoardItems().length % 4) * 32;
        const rawX = Array.isArray(point) ? Number(point[0] || 0) - Math.round(width / 2) : fallback;
        const rawY = Array.isArray(point) ? Number(point[1] || 0) - Math.round(height / 2) : fallback;
        return {
            x: Math.round(rawX / snap) * snap,
            y: Math.round(rawY / snap) * snap
        };
    }

    function createBoardItemFromTool(tool, point = null) {
        const action = normalizeBoardTool(tool);
        if (action === 'note') {
            const size = { w: 260, h: 150 };
            return addBoardItem({ type: 'note', ...boardPointForNewItem(point, size.w, size.h), ...size, text: 'Нова нотатка' });
        }
        if (action === 'text') {
            const size = { w: 320, h: 160 };
            return addBoardItem({ type: 'text', ...boardPointForNewItem(point, size.w, size.h), ...size, text: 'Новий текстовий блок', title: 'Text' });
        }
        if (action === 'frame') {
            const size = { w: 420, h: 260 };
            return addBoardItem({ type: 'frame', ...boardPointForNewItem(point, size.w, size.h), ...size, text: 'Нова зона', title: 'Frame' });
        }
        if (action === 'space') {
            const size = { w: 360, h: 220 };
            return addBoardItem({
                type: 'space',
                ...boardPointForNewItem(point, size.w, size.h),
                ...size,
                title: 'Порожня зона',
                text: 'Навмисно лишене місце для дихання сцени або майбутнього віджета.',
                zoneKind: 'reserved'
            });
        }
        if (action === 'widget') return addBoardWidget(point);
        if (BOARD_SHAPE_TOOLS.has(action)) return addBoardShape(action, point);
        return null;
    }

    function addBoardNote() {
        createBoardItemFromTool('note');
    }

    function addBoardNoteToZone(zoneId) {
        const def = WRITING_ZONE_DEFS[zoneId] || WRITING_ZONE_DEFS['notes-zone-primary'];
        const text = getWritingZoneValue(zoneId).trim() || def.hint || 'Нова нотатка';
        if (_config.mode !== DASHBOARD_WORKSPACE_MODE) {
            _config.mode = DASHBOARD_WORKSPACE_MODE;
            _config.layout.mode = DASHBOARD_WORKSPACE_MODE;
        }
        addBoardItem({
            type: 'note',
            w: 280,
            h: 170,
            title: def.title,
            text: text.slice(0, 5000)
        });
    }

    function addBoardText() {
        createBoardItemFromTool('text');
    }

    function addBoardFrame() {
        createBoardItemFromTool('frame');
    }

    function addBoardSpace() {
        createBoardItemFromTool('space');
    }

    function findPlanningZone(zoneId) {
        return BOARD_PLANNING_ZONES.find(zone => zone.id === zoneId) || null;
    }

    function reserveBoardZone(zoneId) {
        const zone = findPlanningZone(zoneId);
        if (!zone) return null;
        const existing = getBoardItems().find(item => item.type === 'space' && item.zoneId === zone.id && !item.hidden);
        if (existing) {
            selectBoardItem(existing.id);
            return existing;
        }
        return addBoardItem({
            type: 'space',
            x: Number(zone.x || 60),
            y: Number(zone.y || 60),
            w: Number(zone.w || 340),
            h: Number(zone.h || 210),
            title: zone.title || 'Порожня зона',
            text: zone.hint || 'Зарезервовано як вільний простір.',
            zoneId: zone.id,
            zoneKind: zone.kind || 'reserved'
        });
    }

    function addBoardShape(shape = 'rect', point = null) {
        const safeShape = normalizeBoardShape(shape);
        const shapeTitles = {
            line: 'Line',
            arrow: 'Arrow',
            rect: 'Rectangle',
            square: 'Square',
            circle: 'Circle',
            'round-rect': 'Rounded Rectangle',
            ellipse: 'Ellipse',
            diamond: 'Diamond'
        };
        const shapeSizes = {
            line: { w: 260, h: 70 },
            arrow: { w: 260, h: 70 },
            rect: { w: 220, h: 120 },
            square: { w: 150, h: 150 },
            circle: { w: 150, h: 150 },
            'round-rect': { w: 220, h: 120 },
            ellipse: { w: 220, h: 120 },
            diamond: { w: 150, h: 150 }
        };
        const size = shapeSizes[safeShape] || shapeSizes.rect;
        return addBoardItem({
            type: 'shape',
            ...boardPointForNewItem(point, size.w, size.h),
            ...size,
            shape: safeShape,
            title: shapeTitles[safeShape] || 'Shape'
        });
    }

    function preferredWidgetForZone(zone) {
        const preferred = String(zone?.widget || '').trim();
        if (preferred && canUseWidget(preferred)) return preferred;
        return normalizeDashboardWidgets(_config.widgets || []).find(canUseWidget) || 'tasks';
    }

    function addBoardWidgetToZone(zoneId) {
        const zone = findPlanningZone(zoneId);
        if (!zone) return addBoardWidget();
        const widgetType = preferredWidgetForZone(zone);
        if (!widgetType || !canUseWidget(widgetType)) return null;
        const width = Math.max(260, Math.min(420, Number(zone.w || 360) - 24));
        const height = Math.max(180, Math.min(280, Number(zone.h || 240) - 48));
        return addBoardItem({
            type: 'widget',
            widgetType,
            title: WIDGET_DEFS[widgetType]?.title || widgetType,
            x: Number(zone.x || 60) + 12,
            y: Number(zone.y || 60) + 38,
            w: width,
            h: height,
            depth: getBoardItems().filter(item => item.type === 'widget' && item.depth === 'live-compact').length >= getBoardLiveWidgetCap()
                ? 'headline-only'
                : 'live-compact'
        });
    }

    function addBoardWidgetByType(widgetType, point = null) {
        const type = String(widgetType || '').trim();
        if (!type || !canUseWidget(type)) return null;
        const size = { w: 340, h: 235 };
        return addBoardItem({
            type: 'widget',
            widgetType: type,
            title: WIDGET_DEFS[type]?.title || type,
            ...boardPointForNewItem(point, size.w, size.h),
            ...size,
            depth: getBoardItems().filter(item => item.type === 'widget' && item.depth === 'live-compact').length >= getBoardLiveWidgetCap()
                ? 'headline-only'
                : 'live-compact'
        });
    }

    function addSelectedBoardWidget() {
        const select = document.getElementById('boardBuilderWidgetSelect');
        const selected = select?.value || normalizeDashboardWidgets(_config.widgets || []).find(canUseWidget) || 'tasks';
        addBoardWidgetByType(selected);
    }

    function addBoardWidget(point = null) {
        const available = normalizeDashboardWidgets(_config.widgets || []).filter(canUseWidget);
        const existing = new Set(getBoardItems().filter(item => item.type === 'widget').map(item => item.widgetType));
        const widgetType = available.find(key => !existing.has(key)) || available[0] || 'tasks';
        return addBoardWidgetByType(widgetType, point);
    }

    function seedBoardWidgets(options = {}) {
        if (getBoardItems().length) return;
        const shouldPersist = options.persist !== false;
        if (shouldPersist) pushBoardUndo('seed-widgets');
        normalizeDashboardWidgets(_config.widgets || [])
            .filter(canUseWidget)
            .slice(0, 4)
            .forEach((widgetType, index) => {
                const item = normalizeBoardItem({
                    id: `board-widget-${widgetType}-${Date.now()}-${index}`,
                    type: 'widget',
                    widgetType,
                    title: WIDGET_DEFS[widgetType]?.title || widgetType,
                    depth: index < getBoardLiveWidgetCap() ? 'live-compact' : 'headline-only',
                    x: 40 + (index % 2) * 370,
                    y: 40 + Math.floor(index / 2) * 270,
                    w: 340,
                    h: 235,
                    z: index + 1
                }, index);
                if (item) getBoardItems().push(item);
            });
        if (shouldPersist) markBoardDirty('seed-widgets');
        renderBoard();
    }

    function runBoardCreateAction(kind, payload = {}) {
        const action = String(kind || '').trim();
        if (action === 'connector') return setBoardTool('connector');
        if (payload?.immediate === true) return createBoardItemFromTool(action, payload.point || null);
        if (BOARD_CREATE_TOOLS.has(action) || BOARD_SHAPE_TOOLS.has(action)) return setBoardTool(action);
        if (payload?.shape && BOARD_ALLOWED_SHAPES.has(payload.shape)) return setBoardTool(payload.shape);
    }

    function selectedBoardTextSeed() {
        const selected = _boardSelectedId ? findBoardItem(_boardSelectedId) : null;
        if (selected?.text) return String(selected.text).trim();
        if (selected?.title) return String(selected.title).trim();
        const notes = getBoardItems().filter(item => ['note', 'text', 'frame'].includes(item.type) && item.text).slice(0, 4);
        return notes.map(item => item.text).join('\n').trim() || 'New event idea';
    }

    function addBoardCreativeCluster(title, notes = [], options = {}) {
        const baseX = safeNumber(options.x, 80 + (getBoardItems().length % 3) * 70, -10000, 10000);
        const baseY = safeNumber(options.y, 80 + (getBoardItems().length % 3) * 50, -10000, 10000);
        pushBoardUndo('ai-board');
        const frame = normalizeBoardItem({
            id: `board-ai-frame-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            type: 'frame',
            title: title || 'AI frame',
            text: title || 'AI frame',
            x: baseX - 24,
            y: baseY - 28,
            w: Math.max(420, Math.min(760, 240 + notes.length * 58)),
            h: 260 + Math.ceil(notes.length / 2) * 72,
            z: nextBoardZ()
        }, getBoardItems().length);
        if (frame) getBoardItems().push(frame);
        const created = [];
        notes.slice(0, 10).forEach((text, index) => {
            const item = normalizeBoardItem({
                id: `board-ai-note-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
                type: 'note',
                title: index === 0 ? 'Seed' : `Variation ${index}`,
                text,
                x: baseX + (index % 2) * 250,
                y: baseY + Math.floor(index / 2) * 118,
                w: 220,
                h: 96,
                z: nextBoardZ() + index + 1
            }, getBoardItems().length + index);
            if (item) {
                getBoardItems().push(item);
                created.push(item);
            }
        });
        if (created.length > 1) {
            created.slice(1).forEach(item => {
                const connector = normalizeBoardConnector({
                    id: `conn-ai-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    from: { itemId: created[0].id, anchor: 'right' },
                    to: { itemId: item.id, anchor: 'left' },
                    style: 'curve',
                    relationType: options.relationType || 'inspires',
                    label: options.relationType || 'inspires'
                }, getBoardConnectors().length);
                if (connector) getBoardConnectors().push(connector);
            });
        }
        _boardSelectedId = frame?.id || created[0]?.id || null;
        _boardSelectedConnectorId = null;
        markBoardDirty('ai-board');
        renderBoard();
    }

    function runBoardAiAction(action) {
        const preset = BOARD_AI_PRESETS.has(action) ? action : 'expand';
        const seed = selectedBoardTextSeed();
        if (preset === 'prompt-to-board') {
            const promptText = seed || 'Нова сцена дошки';
            addBoardCreativeCluster('З промпта', [
                promptText,
                `Концепт: ${promptText}`,
                'Для кого: хто це використовує і навіщо',
                'Пропозиція: чому з цим легко погодитись',
                'Підготовка: що треба зробити першим'
            ], { relationType: 'feeds' });
            return;
        }
        if (preset === 'expand') {
            addBoardCreativeCluster('Розширення ідеї', [
                seed,
                `Емоційніший напрям: ${seed}`,
                `Операційний напрям: ${seed}`,
                `Преміальна версія: ${seed}`,
                `Швидкий експеримент: ${seed}`,
                `Ризик перед запуском: ${seed}`
            ], { relationType: 'inspires' });
            return;
        }
        if (preset === 'mood-pack') {
            addBoardCreativeCluster('Настрій', [
                `Настрій: ${seed}`,
                'Візуальний ритм: сильний перший сигнал, тихі деталі підтримки',
                'Тон тексту: коротко, впевнено, корисно',
                'Сцена: один головний момент і три докази',
                'Матеріали: фото, титр, дія, follow-up нотатка'
            ], { relationType: 'idea' });
            return;
        }
        if (preset === 'cluster') {
            addBoardCreativeCluster('Автокластер', [
                'Кластер A: термінові операційні сигнали',
                'Кластер B: ідеї, які варто перевірити',
                'Кластер C: рішення, яким потрібен відповідальний',
                'Кластер D: наступні задачі'
            ], { relationType: 'feeds' });
            return;
        }
        if (preset === 'summarize') {
            addBoardItem({ type: 'note', title: 'AI-підсумок', text: `Підсумок:\n${seed.slice(0, 900)}`, w: 300, h: 160 });
            return;
        }
        if (preset === 'tasks') {
            addBoardCreativeCluster('Кандидати в задачі', [
                `Визначити відповідального: ${seed}`,
                `Перевірити блокер: ${seed}`,
                `Підготувати перший драфт: ${seed}`,
                'Поставити дедлайн і наступний перегляд'
            ], { relationType: 'depends' });
            return;
        }
        if (preset === 'remix') {
            addBoardCreativeCluster('Ремікс сцени', [
                `Спокійна управлінська версія: ${seed}`,
                `Хаотичний брейншторм: ${seed}`,
                `Версія для клієнта: ${seed}`,
                `Внутрішня production-версія: ${seed}`
            ], { relationType: 'inspires' });
            return;
        }
        if (preset === 'name-frame') {
            const item = _boardSelectedId ? findBoardItem(_boardSelectedId) : null;
            if (item) {
                pushBoardUndo('name-frame');
                item.title = 'AI назвав рамку';
                item.text = `Напрям: ${seed.slice(0, 120)}`;
                markBoardDirty('name-frame');
                renderBoard();
            }
        }
    }

    function deleteBoardItem(id = _boardSelectedId) {
        const items = getBoardItems();
        const index = items.findIndex(item => item.id === id);
        if (index < 0) return;
        pushBoardUndo('delete');
        items.splice(index, 1);
        _config.boardState.connectors = getBoardConnectors().filter(conn => conn.from.itemId !== id && conn.to.itemId !== id);
        _boardSelectedId = null;
        _boardSelectedConnectorId = null;
        markBoardDirty('delete');
        renderBoard();
    }

    function duplicateBoardItem(id = _boardSelectedId) {
        const item = findBoardItem(id);
        if (!item) return;
        pushBoardUndo('duplicate');
        const copy = normalizeBoardItem({
            ...deepClone(item),
            id: `board-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            x: Number(item.x || 0) + 28,
            y: Number(item.y || 0) + 28,
            z: nextBoardZ(),
            locked: false,
            hidden: false
        }, getBoardItems().length);
        if (!copy) return;
        getBoardItems().push(copy);
        _boardSelectedId = copy.id;
        markBoardDirty('duplicate');
        renderBoard();
    }

    function changeBoardItemZ(id, direction) {
        const item = findBoardItem(id);
        if (!item) return;
        pushBoardUndo('z-order');
        item.z = safeNumber(Number(item.z || 0) + Number(direction || 0), item.z, 0, 9999);
        markBoardDirty('z-order');
        renderBoard();
    }

    function toggleBoardItemLock(id) {
        const item = findBoardItem(id);
        if (!item) return;
        pushBoardUndo('lock');
        item.locked = !item.locked;
        markBoardDirty('lock');
        renderBoard();
    }

    function toggleBoardItemHidden(id) {
        const item = findBoardItem(id);
        if (!item) return;
        pushBoardUndo('hide');
        item.hidden = !item.hidden;
        markBoardDirty('hide');
        renderBoard();
    }

    function setBoardWidgetDepth(id, depth) {
        const item = findBoardItem(id);
        if (!item || item.type !== 'widget') return;
        const nextDepth = BOARD_ALLOWED_DEPTHS.has(depth) ? depth : 'headline-only';
        if (item.depth === nextDepth) return;
        pushBoardUndo('widget-depth');
        item.depth = nextDepth;
        markBoardDirty('widget-depth');
        renderBoard();
    }

    function enterBoardWidgetInspect(id) {
        const item = findBoardItem(id);
        if (!item || item.type !== 'widget') return;
        _boardWidgetInspectId = id;
        _boardObjectEditing = { id, kind: 'widget' };
        _boardInteractionMode = 'edit';
        selectBoardItem(id, { render: false });
        renderBoard();
    }

    function enterBoardObjectEditing(id, kind = 'object') {
        _boardObjectEditing = { id, kind };
        if (kind === 'text') _boardWidgetInspectId = null;
        syncBoardWorkspaceMode();
        syncBoardToolbar();
    }

    function exitBoardObjectEditing() {
        _boardObjectEditing = null;
        _boardWidgetInspectId = null;
        _boardConnectorDraft = null;
        syncBoardWorkspaceMode();
        renderBoard();
    }

    function setBoardConnectorPreference(key, value) {
        if (!_config?.boardState) return;
        const prefs = safeObject(_config.boardState.preferences, {});
        if (key === 'connectorStyle') prefs.connectorStyle = normalizeBoardConnectorStyle(value);
        if (key === 'relationType') prefs.relationType = normalizeBoardRelationType(value);
        _config.boardState.preferences = { ...prefs };
        markBoardDirty('connector-preference');
        renderBoard();
    }

    function handleBoardAnchor(itemId, anchor, event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!_config?.boardState) return;
        setBoardTool('connector');
        const item = findBoardItem(itemId);
        if (!item || item.locked || item.hidden) return;
        if (!_boardConnectorDraft) {
            _boardConnectorDraft = { itemId, anchor };
            selectBoardItem(itemId, { render: false });
            renderBoard();
            return;
        }
        if (_boardConnectorDraft.itemId === itemId) {
            _boardConnectorDraft = { itemId, anchor };
            renderBoard();
            return;
        }
        const prefs = safeObject(_config.boardState.preferences, {});
        pushBoardUndo('connector-create');
        getBoardConnectors().push(normalizeBoardConnector({
            id: `conn-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            from: _boardConnectorDraft,
            to: { itemId, anchor },
            style: normalizeBoardConnectorStyle(prefs.connectorStyle),
            relationType: normalizeBoardRelationType(prefs.relationType),
            label: normalizeBoardRelationType(prefs.relationType)
        }, getBoardConnectors().length));
        _boardConnectorDraft = null;
        _boardSelectedId = null;
        _boardSelectedConnectorId = getBoardConnectors()[getBoardConnectors().length - 1]?.id || null;
        markBoardDirty('connector-create');
        renderBoard();
    }

    function updateBoardConnector(id, key, value) {
        const connector = getBoardConnectors().find(conn => conn.id === id);
        if (!connector) return;
        pushBoardUndo('connector-update');
        if (key === 'relationType') {
            connector.relationType = normalizeBoardRelationType(value);
            connector.label = connector.relationType;
        }
        if (key === 'style') connector.style = normalizeBoardConnectorStyle(value);
        markBoardDirty('connector-update');
        renderBoard();
    }

    function deleteBoardConnector(id = _boardSelectedConnectorId) {
        const connectors = getBoardConnectors();
        const index = connectors.findIndex(conn => conn.id === id);
        if (index < 0) return;
        pushBoardUndo('connector-delete');
        connectors.splice(index, 1);
        _boardSelectedConnectorId = null;
        markBoardDirty('connector-delete');
        renderBoard();
    }

    function undoBoard() {
        if (!_boardUndoStack.length) return;
        _boardRedoStack.push({ label: 'redo', state: boardSnapshot() });
        const prev = _boardUndoStack.pop();
        _config.boardState = normalizeBoardState(prev.state);
        _config.layout.boardState = _config.boardState;
        _boardSelectedId = null;
        _boardSelectedConnectorId = null;
        _boardConnectorDraft = null;
        markBoardDirty('undo');
        renderBoard();
    }

    function redoBoard() {
        if (!_boardRedoStack.length) return;
        _boardUndoStack.push({ label: 'undo', state: boardSnapshot() });
        const next = _boardRedoStack.pop();
        _config.boardState = normalizeBoardState(next.state);
        _config.layout.boardState = _config.boardState;
        _boardSelectedId = null;
        _boardSelectedConnectorId = null;
        _boardConnectorDraft = null;
        markBoardDirty('redo');
        renderBoard();
    }

    function resetBoardView() {
        if (!_config?.boardState) return;
        pushBoardUndo('reset-view');
        _config.boardState.viewport = { x: 0, y: 0, zoom: 1 };
        markBoardDirty('reset-view');
        renderBoard();
    }

    function resetBoardState() {
        pushBoardUndo('reset-board');
        _config.boardState = createDefaultDashboardConfig().boardState;
        _config.boardMeta = normalizeBoardMeta({ lastSavedAt: new Date().toISOString() });
        _config.layout.boardState = _config.boardState;
        _config.layout.boardMeta = _config.boardMeta;
        _boardConfigCorrupt = false;
        _boardSelectedId = null;
        _boardSelectedConnectorId = null;
        _boardConnectorDraft = null;
        markBoardDirty('reset-board');
        renderBoard();
    }

    function setDashboardMode(mode) {
        const nextMode = normalizeDashboardMode(mode);
        _config.mode = nextMode;
        _config.layout.mode = nextMode;
        if (!getBoardItems().length) {
            seedBoardWidgets();
        }
        saveDashboardConfig({ mode: nextMode }).catch(err => console.error('[dashboard] mode save failed:', err));
        renderWidgets();
    }

    function setDashboardRolePreview(role) {
        if (!window.RolePreview?.canPreview?.()) return;
        const nextRole = String(role || '').trim();
        const state = getDashboardRolePreviewState();
        if (!nextRole) {
            window.RolePreview.clearPreviewRole();
        } else if (nextRole === state.realRole) {
            window.RolePreview.clearPreviewRole();
        } else {
            window.RolePreview.setPreviewRole(nextRole);
        }
        closeDashboardRolePreviewMenu();
        updateDashboardRolePreviewControl();
        renderWidgets();
        announceDashboardContextToAssistant();
    }

    function setDashboardSceneOption(option, value) {
        if (!_config) return;
        const options = normalizeSceneOptions(_config.sceneOptions);
        if (option === 'writingLane') options.writingLane = value === true || value === 'true';
        if (option === 'controlledChaos') options.controlledChaos = value === true || value === 'true';
        _config.sceneOptions = options;
        _config.layout = {
            ...safeObject(_config.layout, {}),
            mode: _config.mode,
            presentationMode: getDashboardPresentationMode(),
            sceneOptions: options,
            boardMeta: _config.boardMeta,
            boardState: _config.boardState
        };
        saveDashboardConfig({ sceneOptions: options }).catch(err => console.error('[dashboard] scene option save failed:', err));
        renderWidgets();
    }

    function setBoardInteractionMode(mode) {
        setBoardWorkspaceMode(mode === 'edit' ? 'board:edit' : 'board:view');
    }

    function setBoardTool(tool) {
        if (!_config?.boardState) return;
        const nextTool = normalizeBoardTool(tool);
        _config.boardState.activeTool = nextTool;
        if (nextTool === 'connector') {
            _boardInteractionMode = 'edit';
            _boardWidgetInspectId = null;
            _boardObjectEditing = null;
        } else if (BOARD_DRAW_TOOLS.has(nextTool) || nextTool === 'eraser' || BOARD_CREATE_TOOLS.has(nextTool) || BOARD_SHAPE_TOOLS.has(nextTool)) {
            _boardInteractionMode = 'edit';
            _boardConnectorDraft = null;
            _boardWidgetInspectId = null;
            _boardObjectEditing = null;
        } else if (nextTool === 'select') {
            _boardInteractionMode = 'edit';
            _boardConnectorDraft = null;
            _boardWidgetInspectId = null;
            _boardObjectEditing = null;
        } else if (nextTool === 'hand') {
            _boardInteractionMode = 'view';
            _boardSelectedId = null;
            _boardSelectedConnectorId = null;
            _boardConnectorDraft = null;
            _boardWidgetInspectId = null;
            _boardObjectEditing = null;
        }
        markBoardDirty('tool');
        syncBoardToolbar();
        renderBoard();
    }

    function setBoardWorkspaceMode(mode, payload = {}) {
        const nextMode = normalizeBoardWorkspaceMode(mode);
        _boardWorkspaceMode = nextMode;
        if (nextMode === 'board:view') {
            _boardInteractionMode = 'view';
            _boardSelectedId = null;
            _boardSelectedConnectorId = null;
            _boardConnectorDraft = null;
            _boardObjectEditing = null;
            _boardWidgetInspectId = null;
            _boardResize = null;
            if (_config?.boardState) _config.boardState.activeTool = 'hand';
        } else if (nextMode === 'board:edit') {
            _boardInteractionMode = 'edit';
            _boardConnectorDraft = null;
            _boardObjectEditing = null;
            _boardWidgetInspectId = null;
            _boardResize = null;
            if (_config?.boardState) _config.boardState.activeTool = 'select';
        } else if (nextMode === 'board:connect') {
            _boardInteractionMode = 'edit';
            _boardObjectEditing = null;
            _boardWidgetInspectId = null;
            if (_config?.boardState) _config.boardState.activeTool = 'connector';
        } else if (nextMode === 'board:draw') {
            _boardInteractionMode = 'edit';
            _boardConnectorDraft = null;
            if (_config?.boardState) _config.boardState.activeTool = normalizeBoardTool(payload.tool || _config.boardState.activeTool || 'brush');
        } else if (nextMode === 'object:text-edit') {
            _boardInteractionMode = 'edit';
            _boardObjectEditing = { id: payload.id || _boardSelectedId, kind: 'text' };
        } else if (nextMode === 'object:widget-inspect') {
            _boardInteractionMode = 'edit';
            _boardWidgetInspectId = payload.id || _boardSelectedId;
            _boardObjectEditing = { id: _boardWidgetInspectId, kind: 'widget' };
        }
        syncBoardToolbar();
        renderBoard();
    }

    function setBoardPreference(key, value) {
        if (!_config?.boardState) return;
        const prefs = safeObject(_config.boardState.preferences, {});
        if (['snapToGrid', 'showGrid', 'showGuides', 'showPlanner', 'showMiniMap'].includes(key)) {
            prefs[key] = value === true || value === 'true';
            if (key === 'snapToGrid') prefs.snapMode = prefs[key] ? (normalizeBoardSnapMode(prefs.snapMode) === 'freeform' ? 'soft' : normalizeBoardSnapMode(prefs.snapMode)) : 'freeform';
        } else if (key === 'strokeColor') {
            prefs.strokeColor = String(value || '#10b981').slice(0, 32);
        } else if (key === 'fillColor') {
            prefs.fillColor = String(value || 'rgba(16, 185, 129, 0.10)').slice(0, 64);
        } else if (key === 'strokeWidth') {
            prefs.strokeWidth = safeNumber(value, 2, 1, 12);
        } else {
            return;
        }
        _config.boardState.preferences = { ...prefs };
        markBoardDirty('board-preference');
        syncBoardToolbar();
        renderBoard();
    }

    function setBoardSnapMode(mode) {
        if (!_config?.boardState) return;
        const prefs = safeObject(_config.boardState.preferences, {});
        const snapMode = normalizeBoardSnapMode(mode);
        _config.boardState.preferences = {
            ...prefs,
            snapMode,
            snapToGrid: snapMode !== 'freeform'
        };
        markBoardDirty('snap-mode');
        syncBoardToolbar();
        renderBoard();
    }

    async function clearBoardContent() {
        if (!_config?.boardState) return;
        const hasContent = getBoardItems().length > 0 || getBoardDrawings().length > 0 || getBoardConnectors().length > 0;
        if (!hasContent) return;
        const message = 'Очистити всі нотатки, фігури, текстові блоки, frames і малювання на board?';
        const confirmed = await confirmDashboardAction(message, {
            type: 'warning',
            okText: 'Очистити',
            cancelText: 'Скасувати'
        });
        if (!confirmed) return;
        pushBoardUndo('clear-all');
        _config.boardState.items = [];
        _config.boardState.drawings = [];
        _config.boardState.connectors = [];
        _boardSelectedId = null;
        _boardSelectedConnectorId = null;
        _boardConnectorDraft = null;
        markBoardDirty('clear-all');
        renderBoard();
    }

    function initBoardKeyboard() {
        if (_boardKeyboardBound) return;
        _boardKeyboardBound = true;
        document.addEventListener('keydown', event => {
            if (!_config || normalizeDashboardMode(_config.mode) !== DASHBOARD_WORKSPACE_MODE) return;
            const editable = event.target && event.target.closest && event.target.closest('input, textarea, [contenteditable="true"]');
            const mod = event.ctrlKey || event.metaKey;
            if (event.code === 'Space' && !editable && !_boardSpaceHandActive) {
                _boardSpaceHandActive = true;
                document.body.classList.add('board-space-hand');
                return;
            }
            if (editable && mod && event.key.toLowerCase() === 'z') return;
            if (mod && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                if (event.shiftKey) redoBoard();
                else undoBoard();
                return;
            }
            if (mod && event.key.toLowerCase() === 'd') {
                event.preventDefault();
                duplicateBoardItem(_boardSelectedId);
                return;
            }
            if (!editable && event.key === 'Escape') {
                event.preventDefault();
                if (_boardObjectEditing || _boardWidgetInspectId || _boardConnectorDraft) {
                    exitBoardObjectEditing();
                } else if (_boardSelectedConnectorId) {
                    _boardSelectedConnectorId = null;
                    renderBoard();
                } else if (_boardSelectedId) {
                    selectBoardItem(null);
                } else {
                    setBoardTool('select');
                }
                return;
            }
            if (!editable && !mod) {
                const key = event.key.toLowerCase();
                const shortcuts = {
                    v: () => setBoardTool('select'),
                    h: () => setBoardTool('hand'),
                    n: () => runBoardCreateAction('note'),
                    t: () => runBoardCreateAction('text'),
                    b: () => setBoardTool('brush'),
                    e: () => setBoardTool('eraser'),
                    r: () => runBoardCreateAction('rect'),
                    s: () => runBoardCreateAction('square'),
                    o: () => runBoardCreateAction('ellipse'),
                    a: () => runBoardCreateAction('arrow'),
                    l: () => runBoardCreateAction('line'),
                    d: () => runBoardCreateAction('diamond'),
                    f: () => runBoardCreateAction('frame'),
                    c: () => setBoardTool('connector'),
                    w: () => runBoardCreateAction('widget')
                };
                const handler = event.shiftKey && key === 'h' ? () => setBoardTool('highlighter') : shortcuts[key];
                if (handler) {
                    event.preventDefault();
                    handler();
                    return;
                }
            }
            if (!editable && _boardInteractionMode === 'edit' && (event.key === 'Delete' || event.key === 'Backspace')) {
                event.preventDefault();
                if (_boardSelectedConnectorId) deleteBoardConnector(_boardSelectedConnectorId);
                else deleteBoardItem(_boardSelectedId);
            }
        });
        document.addEventListener('keyup', event => {
            if (event.code !== 'Space') return;
            _boardSpaceHandActive = false;
            document.body.classList.remove('board-space-hand');
        });
    }

    function normalizeDashboardWidgets(widgets) {
        const list = Array.isArray(widgets)
            ? widgets.filter(Boolean).filter(widgetKey => WIDGET_DEFS[widgetKey] && !DASHBOARD_RETIRED_WIDGETS.has(widgetKey))
            : [];
        const funnelDef = WIDGET_DEFS.funnel;
        const canSeeFunnel = funnelDef && (!funnelDef.minRole || typeof hasMinRole !== 'function' || hasMinRole(funnelDef.minRole));
        if (canSeeFunnel && !list.includes('funnel')) {
            return ['funnel', ...list];
        }
        return list;
    }

    function isTeamOnlineHistoryEnabled() {
        return localStorage.getItem('pzp_team_online_history') === '1';
    }

    function setTeamOnlineHistory(enabled) {
        if (enabled) localStorage.setItem('pzp_team_online_history', '1');
        else localStorage.removeItem('pzp_team_online_history');
        loadWidgetData('team_online');
    }

    function buildWidgetDataUrl(type) {
        const url = new URL(`/api/dashboard/widgets/${type}`, window.location.origin);
        if (type === 'team_online') {
            url.searchParams.set('scope', isTeamOnlineHistoryEnabled() ? 'history' : 'online');
            url.searchParams.set('limit', isTeamOnlineHistoryEnabled() ? '80' : '30');
        }
        return url.pathname + url.search;
    }

    async function loadWidgetData(type, targetContainer = null) {
        const container = targetContainer || document.getElementById(`widget-${type}`);
        if (!container) return;

        if (type === 'funnel') {
            await loadFunnelWidget(container);
            return;
        }

        try {
            const resp = await fetch(buildWidgetDataUrl(type), {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const result = await resp.json();

            if (result.success) {
                _widgetData[type] = result.data;
                renderWidgetContent(type, result.data, container);
            } else {
                container.innerHTML = '<div class="widget-empty">Помилка завантаження</div>';
            }
        } catch (err) {
            console.error(`Widget ${type} load error:`, err);
            container.innerHTML = '<div class="widget-empty">Помилка з\'єднання</div>';
        }
    }

    async function loadFunnelWidget(container) {
        try {
            const resp = await fetch('/api/dashboard/widgets/funnel', {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
            });
            if (resp.status === 403 || resp.status === 401) {
                container.innerHTML = '<div class="widget-empty">Воронка недоступна для вашої ролі</div>';
                return;
            }
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const result = await resp.json();
            const queue = result.data || {};
            _widgetData.funnel = queue;
            renderCompactFunnelWidget(queue, container);
        } catch (err) {
            console.error('Funnel widget load error:', err);
            container.innerHTML = '<div class="widget-empty">Не вдалося завантажити воронку</div>';
        }
    }

    function renderCompactFunnelWidget(queue, container) {
        const funnel = queue?.meta?.funnelInsights || {};
        const stages = Array.isArray(funnel.stages)
            ? funnel.stages
                .filter(stage => Number(stage.total || 0) > 0)
                .sort((a, b) => {
                    const waitingDiff = Number(b.waitingAction || 0) - Number(a.waitingAction || 0);
                    return waitingDiff || Number(b.total || 0) - Number(a.total || 0);
                })
                .slice(0, 4)
            : [];
        const total = Number(funnel.total || 0);
        const waitingAction = Number(funnel.waitingAction || 0);
        const hotStage = funnel.hotStage || stages.find(stage => Number(stage.waitingAction || 0) > 0) || stages[0] || null;
        const hiddenCount = Math.max(0, (Array.isArray(funnel.stages) ? funnel.stages.filter(stage => Number(stage.total || 0) > 0).length : 0) - stages.length);

        if (!total && !stages.length) {
            container.innerHTML = `
                <div class="dashboard-funnel-compact empty">
                    <div>
                        <strong>Воронка спокійна</strong>
                        <span>Немає лідів, які чекають дії.</span>
                    </div>
                    <a class="dashboard-funnel-open" href="${escapeHtml(funnel.href || '/sales-funnel')}">Відкрити</a>
                </div>
            `;
            return;
        }

        const stageChips = stages.map(stage => {
            const waiting = Number(stage.waitingAction || 0);
            const count = Number(stage.total || 0);
            const href = stage.href || `/sales-funnel?stage=${encodeURIComponent(stage.stage || '')}`;
            return `
                <a class="dashboard-funnel-stage-chip${waiting > 0 ? ' needs-action' : ''}" href="${escapeHtml(href)}">
                    <span>${escapeHtml(stage.label || stage.stage || 'Етап')}</span>
                    <strong>${waiting}/${count}</strong>
                </a>
            `;
        }).join('');

        container.innerHTML = `
            <div class="dashboard-funnel-compact">
                <div class="dashboard-funnel-metrics-row">
                    <div class="dashboard-funnel-metric">
                        <strong>${total}</strong>
                        <span>активних</span>
                    </div>
                    <div class="dashboard-funnel-metric warning">
                        <strong>${waitingAction}</strong>
                        <span>чекає дії</span>
                    </div>
                    <div class="dashboard-funnel-metric subtle">
                        <strong>${escapeHtml(hotStage?.label || 'без етапу')}</strong>
                        <span>гарячий етап</span>
                    </div>
                </div>
                <div class="dashboard-funnel-stages">
                    ${stageChips}
                    ${hiddenCount ? `<span class="dashboard-funnel-stage-chip muted">+${hiddenCount} ще</span>` : ''}
                </div>
                <div class="dashboard-funnel-footer">
                    <span>${waitingAction > 0 ? 'Потрібна дія по лідах' : 'Немає критичної черги'}</span>
                    <a class="dashboard-funnel-open" href="${escapeHtml(funnel.href || '/sales-funnel')}">Відкрити</a>
                </div>
            </div>
        `;
    }

    function renderWidgetContent(type, data, container) {
        switch (type) {
            case 'funnel':
                renderCompactFunnelWidget(data, container);
                break;
            case 'quick_stats':
                renderQuickStats(data, container);
                break;
            case 'tasks':
                renderTasks(data, container);
                break;
            case 'my_focus':
                renderMyFocus(data, container);
                break;
            case 'personal_tasker':
                renderPersonalTasker(data, container);
                break;
            case 'bookings_today':
                renderBookings(data, container);
                break;
            case 'my_schedule':
                renderSchedule(data, container);
                break;
            case 'team_online':
                renderTeamOnline(data, container);
                break;
            case 'weather':
                renderWeather(data, container);
                break;
            case 'currency':
                renderCurrency(data, container);
                break;
            case 'announcements':
                renderAnnouncements(data, container);
                break;
            case 'alerts':
                renderAlerts(data, container);
                break;
            case 'event_risk_summary':
                renderEventRiskSummary(data, container);
                break;
            case 'exceptions':
                renderExceptions(data, container);
                break;
            case 'leads_new':
                renderLeadsNew(data, container);
                break;
            case 'finance_today':
                renderFinanceToday(data, container);
                break;
            case 'reports_today':
                renderReportsToday(data, container);
                break;
            case 'catalogs':
                renderCatalogs(data, container);
                break;
            case 'account_stats':
                renderAccountStats(data, container);
                break;
            case 'staff_today':
                renderStaffToday(data, container);
                break;
            case 'week_bookings':
                renderWeekBookings(data, container);
                break;
            case 'team_tasks':
                renderTeamTasks(data, container);
                break;
            case 'task_health':
                renderTaskHealth(data, container);
                break;
            case 'hr_overview':
                renderHrOverview(data, container);
                break;
            case 'director_pnl':
                renderDirectorPnl(data, container);
                break;
            case 'content_pipeline':
                renderContentPipeline(data, container);
                break;
            case 'operations':
                renderOperations(data, container);
                break;
            default:
                container.innerHTML = '<div class="widget-empty">Невідомий віджет</div>';
        }
    }

    function renderQuickStats(data, container) {
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value">${data.bookingsToday || 0}</div>
                    <div class="stat-label">Бронювань</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${data.activeTasks || 0}</div>
                    <div class="stat-label">Активних задач</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${formatCurrency(data.revenueToday || 0)}</div>
                    <div class="stat-label">Виручка</div>
                </div>
            </div>
        `;
    }

    function renderEventRiskSummary(data, container) {
        const cards = Array.isArray(data.cards) ? data.cards : [];
        if (!cards.length) {
            container.innerHTML = '<div class="widget-empty">Немає event-risk summary</div>';
            return;
        }
        const html = cards.map(card => {
            const count = Number(card.count || 0);
            const tone = card.kind === 'late_preliminary' && count > 0
                ? 'critical'
                : (count > 0 ? 'warning' : 'quiet');
            return `
                <a class="event-risk-card ${tone}" href="${escapeHtml(card.href || '/tasks')}" title="${escapeHtml(card.why || '')}">
                    <span>${escapeHtml(card.label || card.key || 'Risk')}</span>
                    <strong>${count}</strong>
                </a>
            `;
        }).join('');
        const meta = data.meta || {};
        container.innerHTML = `
            <div class="event-risk-summary-grid">${html}</div>
            <p class="event-risk-summary-note">
                Дані без universal score: confirmation/prep/resource cues окремо. ${meta.eventSoonSemantics ? escapeHtml(meta.eventSoonSemantics) : ''}
            </p>
        `;
    }

    function renderTasks(data, container) {
        if (!data.tasks || data.tasks.length === 0) {
            container.innerHTML = '<div class="widget-empty">Немає активних задач</div>';
            return;
        }

        const items = data.tasks.slice(0, 6).map(t => {
            const priorityCls = t.priority || 'medium';
            const deadline = t.deadline ? formatDeadline(t.deadline) : '';
            const catInfo = { event: '🎉', purchase: '🛒', admin: '📎', trampoline: '🤸', personal: '👤', improvement: '⚡' };
            const catIcon = catInfo[t.category] || '📋';
            const statusLabel = t.status === 'in_progress' ? 'В роботі' : t.status === 'todo' ? 'Todo' : t.status;
            return `<div class="widget-task-item" onclick="DashboardPage.openTask(${t.id})" title="Відкрити задачу">
                <div class="widget-task-icon ${priorityCls}"></div>
                <div class="widget-task-info">
                    <div class="widget-task-title">${escapeHtml(t.title)}</div>
                    <div class="widget-task-meta">${catIcon} ${statusLabel}${deadline ? ' · ' + deadline : ''}</div>
                </div>
                <div class="widget-task-arrow">›</div>
            </div>`;
        }).join('');

        const footer = `<div class="widget-footer"><a href="/tasks" class="widget-footer-link">Всі задачі →</a></div>`;
        container.innerHTML = `<div class="widget-task-list">${items}</div>${footer}`;
    }

    function renderMyFocus(data, container) {
        const tasks = Array.isArray(data.tasks) ? data.tasks : [];
        const overdue = Number(data.overdueCount || 0);
        const waiting = Number(data.waitingCount || 0);
        const items = tasks.slice(0, 5).map(t => {
            const deadline = t.deadline ? formatDeadline(t.deadline) : '';
            const priorityCls = t.priority || 'medium';
            return `<div class="widget-task-item" onclick="DashboardPage.openTask(${Number(t.id) || 0})" title="Відкрити задачу">
                <div class="widget-task-icon ${priorityCls}"></div>
                <div class="widget-task-info">
                    <div class="widget-task-title">${escapeHtml(t.title || 'Задача без назви')}</div>
                    <div class="widget-task-meta">${deadline || 'Без дедлайну'}${t.ownerLabel ? ' · ' + escapeHtml(t.ownerLabel) : ''}</div>
                </div>
                <div class="widget-task-arrow">›</div>
            </div>`;
        }).join('');
        container.innerHTML = `
            <div class="personal-tasker-metrics compact">
                <div class="personal-tasker-metric danger"><strong>${overdue}</strong><span>прострочено</span></div>
                <div class="personal-tasker-metric warning"><strong>${waiting}</strong><span>чекає</span></div>
                <div class="personal-tasker-metric"><strong>${tasks.length}</strong><span>у фокусі</span></div>
            </div>
            ${items ? `<div class="widget-task-list">${items}</div>` : '<div class="widget-empty">Особистий фокус чистий</div>'}
            <div class="widget-footer"><a href="/tasks" class="widget-footer-link">Відкрити задачі →</a></div>
        `;
    }

    function taskerStatusLabel(status) {
        const labels = { todo: 'Todo', in_progress: 'В роботі', done: 'Готово', cancelled: 'Скасовано', archived: 'Архів' };
        return labels[status] || status || 'Todo';
    }

    function personalTaskerViewData(data) {
        const views = data?.views || {};
        const allowed = ['assigned_to_me', 'created_by_me', 'all_tasks'];
        if (!allowed.includes(_personalTaskerView)) _personalTaskerView = 'assigned_to_me';
        return views[_personalTaskerView] || views.assigned_to_me || views.all_tasks || { tasks: [], stats: {}, label: 'Мені' };
    }

    function renderPersonalTasker(data, container, options = {}) {
        const fullscreen = options.fullscreen === true;
        const views = data?.views || {};
        const stats = data?.stats || {};
        const achievements = Array.isArray(data?.achievements) ? data.achievements : [];
        const current = personalTaskerViewData(data);
        const tasks = Array.isArray(current.tasks) ? current.tasks : [];
        const viewDefs = [
            ['assigned_to_me', 'Мені'],
            ['created_by_me', 'Поставив'],
            ['all_tasks', 'Всі']
        ];
        const tabs = viewDefs.map(([key, label]) => {
            const viewStats = views[key]?.stats || {};
            const count = Number(viewStats.active || viewStats.total || 0);
            return `<button type="button" class="personal-tasker-tab ${_personalTaskerView === key ? 'active' : ''}" onclick="DashboardPage.setPersonalTaskerView('${key}')">
                <span>${label}</span><strong>${count}</strong>
            </button>`;
        }).join('');
        const metricCards = [
            ['todo', 'Todo', stats.todo || 0, ''],
            ['in_progress', 'В роботі', stats.inProgress || 0, 'warning'],
            ['done_today', 'Готово сьогодні', stats.doneToday || 0, 'success'],
            ['overdue', 'Прострочено', stats.overdue || 0, stats.overdue ? 'danger' : 'success']
        ].map(([, label, value, tone]) => `<div class="personal-tasker-metric ${tone}">
            <strong>${value}</strong><span>${label}</span>
        </div>`).join('');
        const achievementHtml = achievements.slice(0, fullscreen ? 6 : 3).map(item => `
            <span class="personal-tasker-achievement ${escapeHtml(item.tone || 'quiet')}">
                ${escapeHtml(item.label || 'Сигнал')} <strong>${escapeHtml(item.value ?? '')}</strong>
            </span>
        `).join('');
        const visibleTasks = tasks.slice(0, fullscreen ? 18 : 6);
        const taskRows = visibleTasks.map(t => {
            const deadline = t.deadline ? formatDeadline(t.deadline) : 'без дедлайну';
            const priority = t.priority || 'medium';
            const overdueClass = t.isOverdue ? ' is-overdue' : '';
            const owner = t.ownerLabel || t.assigned_to || t.owner || '';
            const creator = t.creatorLabel || t.created_by || '';
            return `<button type="button" class="personal-tasker-row${overdueClass}" onclick="DashboardPage.openTask(${Number(t.id) || 0})">
                <span class="personal-tasker-priority ${escapeHtml(priority)}"></span>
                <span class="personal-tasker-row-main">
                    <strong>${escapeHtml(t.title || 'Задача без назви')}</strong>
                    <em>${escapeHtml(taskerStatusLabel(t.status))} · ${escapeHtml(deadline)}${owner ? ' · ' + escapeHtml(owner) : ''}${creator && fullscreen ? ' · поставив ' + escapeHtml(creator) : ''}</em>
                </span>
                <span class="personal-tasker-open">›</span>
            </button>`;
        }).join('');
        container.innerHTML = `
            <div class="personal-tasker ${fullscreen ? 'is-fullscreen' : 'is-compact'}">
                <div class="personal-tasker-head">
                    <div>
                        <span>Creator-only</span>
                        <strong>Особистий tasker</strong>
                    </div>
                    ${fullscreen ? '<button type="button" class="dashboard-btn" onclick="DashboardPage.closePersonalTaskerFullscreen()">Закрити</button>' : '<button type="button" class="dashboard-btn primary" onclick="DashboardPage.openPersonalTaskerFullscreen()">Fullscreen</button>'}
                </div>
                <div class="personal-tasker-tabs">${tabs}</div>
                <div class="personal-tasker-metrics">${metricCards}</div>
                ${achievementHtml ? `<div class="personal-tasker-achievements">${achievementHtml}</div>` : ''}
                <div class="personal-tasker-list">
                    ${taskRows || '<div class="widget-empty">У цьому режимі задач немає</div>'}
                </div>
                <div class="widget-footer"><a href="/tasks" class="widget-footer-link">Відкрити повну сторінку задач →</a></div>
            </div>
        `;
    }

    function setPersonalTaskerView(view) {
        const allowed = ['assigned_to_me', 'created_by_me', 'all_tasks'];
        _personalTaskerView = allowed.includes(view) ? view : 'assigned_to_me';
        document.querySelectorAll('[id^="widget-personal_tasker"], [id^="board-widget-"]').forEach(container => {
            if (container.id.startsWith('widget-personal_tasker')) {
                renderPersonalTasker(_widgetData.personal_tasker || {}, container);
                return;
            }
            const boardItem = container.closest?.('.dashboard-board-item');
            if (boardItem?.dataset?.widgetType === 'personal_tasker') renderPersonalTasker(_widgetData.personal_tasker || {}, container);
        });
        const fullscreenBody = document.getElementById('personalTaskerFullscreenBody');
        if (fullscreenBody) renderPersonalTasker(_widgetData.personal_tasker || {}, fullscreenBody, { fullscreen: true });
    }

    function openPersonalTaskerFullscreen() {
        const previous = document.getElementById('personalTaskerFullscreen');
        if (previous) previous.remove();
        const overlay = document.createElement('div');
        overlay.id = 'personalTaskerFullscreen';
        overlay.className = 'personal-tasker-fullscreen-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `
            <div class="personal-tasker-fullscreen">
                <div id="personalTaskerFullscreenBody"></div>
            </div>
        `;
        overlay.addEventListener('click', event => {
            if (event.target === overlay) closePersonalTaskerFullscreen();
        });
        document.body.appendChild(overlay);
        renderPersonalTasker(_widgetData.personal_tasker || {}, document.getElementById('personalTaskerFullscreenBody'), { fullscreen: true });
    }

    function closePersonalTaskerFullscreen() {
        document.getElementById('personalTaskerFullscreen')?.remove();
    }

    function renderTaskHealth(data, container) {
        const healthy = Number(data.healthy || 0);
        const warning = Number(data.warning || 0);
        const critical = Number(data.critical || 0);
        const avg = Number(data.avg_score || 0);
        container.innerHTML = `
            <div class="personal-tasker-metrics compact">
                <div class="personal-tasker-metric success"><strong>${healthy}</strong><span>здорові</span></div>
                <div class="personal-tasker-metric warning"><strong>${warning}</strong><span>ризик</span></div>
                <div class="personal-tasker-metric danger"><strong>${critical}</strong><span>критичні</span></div>
            </div>
            <div class="task-health-bar" aria-label="Середній health score ${avg}">
                <span style="width:${Math.max(0, Math.min(100, avg))}%"></span>
            </div>
            <div class="widget-footer"><a href="/tasks" class="widget-footer-link">Перевірити задачі →</a></div>
        `;
    }

    function renderBookings(data, container) {
        if (!data.bookings || data.bookings.length === 0) {
            container.innerHTML = '<div class="widget-empty">Немає бронювань на сьогодні</div>';
            return;
        }

        const items = data.bookings.slice(0, 6).map(b => {
            const time = b.start_time ? b.start_time.substring(0, 5) : '';
            const statusCls = b.status || 'preliminary';
            const statusLabel = b.status === 'confirmed' ? 'Підтв.' : 'Попер.';
            return `<div class="widget-booking-item">
                <div class="widget-booking-time">${time}</div>
                <div class="widget-booking-info">
                    <div class="widget-booking-name">${escapeHtml(b.client_name || '')}</div>
                    <div class="widget-booking-program">${escapeHtml(b.program || '')} · ${b.children_count || 0} діт.</div>
                </div>
                <span class="widget-booking-status ${statusCls}">${statusLabel}</span>
            </div>`;
        }).join('');

        container.innerHTML = items;
    }

    function renderSchedule(data, container) {
        if (!data.shifts || data.shifts.length === 0) {
            container.innerHTML = '<div class="widget-empty">Немає запланованих змін</div>';
            return;
        }

        const statusMap = { working: 'На зміні', dayoff: 'Вихідний', day_off: 'Вихідний', vacation: 'Відпустка', sick: 'Лікарняний', remote: 'Віддалено' };
        const items = data.shifts.map(s => {
            const date = new Date(s.date).toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' });
            const statusLabel = statusMap[s.status] || s.status;
            const statusCls = s.status === 'working' ? 'working' : 'dayoff';
            const timeStr = s.start_time && s.end_time ? `${s.start_time.substring(0,5)}–${s.end_time.substring(0,5)}` : '';
            return `<div class="schedule-item">
                <div class="schedule-date">${date}</div>
                <div class="schedule-status ${statusCls}">${statusLabel}</div>
                ${timeStr ? `<div style="font-size:12px;color:var(--gray-500)">${timeStr}</div>` : ''}
            </div>`;
        }).join('');

        container.innerHTML = items;
    }

    function formatTeamLastSeen(value, isOnline) {
        if (isOnline) return 'онлайн зараз';
        if (!value) return 'активність невідома';
        const seen = new Date(value);
        if (Number.isNaN(seen.getTime())) return 'активність невідома';
        const now = new Date();
        const diffMs = now.getTime() - seen.getTime();
        if (diffMs >= 0 && diffMs < 60 * 60 * 1000) {
            const minutes = Math.max(1, Math.floor(diffMs / 60000));
            return `був ${minutes} хв тому`;
        }
        const time = seen.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
        const today = now.toLocaleDateString('uk-UA');
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (seen.toLocaleDateString('uk-UA') === today) return `сьогодні о ${time}`;
        if (seen.toLocaleDateString('uk-UA') === yesterday.toLocaleDateString('uk-UA')) return `вчора о ${time}`;
        return `${seen.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })} о ${time}`;
    }

    function renderTeamOnline(data, container) {
        const users = Array.isArray(data.users) ? data.users : (Array.isArray(data.online) ? data.online : []);
        const historyEnabled = isTeamOnlineHistoryEnabled();
        const meta = data.meta || {};
        const summary = `
            <div class="team-presence-toolbar">
                <div class="team-presence-summary">${escapeHtml(`Онлайн: ${meta.onlineCount || 0}${historyEnabled ? '; історія: ' + (meta.returned || 0) : ''}`)}</div>
                <label class="team-presence-history-toggle" title="Показати останню активність людей, які не онлайн зараз">
                    <input type="checkbox" ${historyEnabled ? 'checked' : ''} onchange="DashboardPage.setTeamOnlineHistory(this.checked)">
                    <span>історія</span>
                </label>
            </div>
        `;
        if (users.length === 0) {
            container.innerHTML = `${summary}<div class="widget-empty">Зараз нікого онлайн. Увімкни «історію», щоб побачити останню активність.</div>`;
            return;
        }

        const items = users.map(m => {
            const name = m.name || m.username || 'User';
            const initial = name.charAt(0).toUpperCase();
            const isOnline = m.isOnline === true || m.is_online === true || m.status === 'online';
            const isRecent = !isOnline && (m.recentlyActive === true || m.status === 'recently_active');
            const lastSeen = m.lastSeenAt || m.lastSeen || m.last_seen || null;
            const statusText = formatTeamLastSeen(lastSeen, isOnline);
            const profileArg = String(m.username || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const profileLink = m.username ? ` onclick="openStaffProfile('${profileArg}')" style="cursor:pointer" title="Профіль: ${escapeHtml(m.username)}"` : '';
            return `<div class="team-member team-presence-member ${isOnline ? 'is-online' : isRecent ? 'is-recent' : 'is-offline'}"${profileLink}>
                <div class="team-avatar">${escapeHtml(initial)}</div>
                <div class="team-presence-copy">
                    <div class="team-presence-name">${escapeHtml(name)}</div>
                    <div class="team-presence-last-seen">${escapeHtml(statusText)}</div>
                </div>
                ${m.username ? '<span class="staff-crm-badge has-account" style="margin-left:2px;padding:0 4px;font-size:9px">👤</span>' : ''}
                <div class="team-online-dot" aria-label="${isOnline ? 'онлайн зараз' : isRecent ? 'був нещодавно' : 'офлайн'}"></div>
            </div>`;
        }).join('');

        container.innerHTML = `${summary}<div class="team-grid team-presence-grid">${items}</div>`;
    }

    function renderWeather(data, container) {
        if (data.error) {
            container.innerHTML = `<div class="widget-empty">${escapeHtml(data.error)}</div>`;
            return;
        }

        const weatherIcons = {
            0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️', 45: '🌫', 48: '🌫',
            51: '🌦', 53: '🌧', 55: '🌧', 61: '🌧', 63: '🌧', 65: '🌧',
            71: '🌨', 73: '🌨', 75: '❄️', 80: '🌦', 81: '🌧', 82: '⛈',
            95: '⛈', 96: '⛈', 99: '⛈'
        };
        const icon = weatherIcons[data.weatherCode] || '🌡';

        container.innerHTML = `
            <div class="weather-display">
                <div class="weather-icon">${icon}</div>
                <div>
                    <div class="weather-temp">${Math.round(data.temperature || 0)}°</div>
                    <div class="weather-details">${data.city || 'Київ'} · Вітер ${data.windSpeed || 0} км/г</div>
                </div>
            </div>
        `;
    }

    function renderCurrency(data, container) {
        if (data.error) {
            container.innerHTML = `<div class="widget-empty">${escapeHtml(data.error)}</div>`;
            return;
        }

        container.innerHTML = `
            <div class="currency-rates">
                <div class="currency-item">
                    <div class="currency-code">USD</div>
                    <div class="currency-value">${data.usd ? data.usd.toFixed(2) : '—'}</div>
                    <div class="currency-unit">₴</div>
                </div>
                <div class="currency-item">
                    <div class="currency-code">EUR</div>
                    <div class="currency-value">${data.eur ? data.eur.toFixed(2) : '—'}</div>
                    <div class="currency-unit">₴</div>
                </div>
            </div>
        `;
    }

    function renderAnnouncements(data, container) {
        if (!data.announcements || data.announcements.length === 0) {
            container.innerHTML = '<div class="widget-empty">Немає оголошень</div>';
            return;
        }

        const items = data.announcements.map(a => {
            const priorityCls = a.priority === 'high' ? 'high' : '';
            const date = new Date(a.created_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
            return `<div class="announcement-item ${priorityCls}">
                <div class="announcement-title">${escapeHtml(a.title || '')}</div>
                <div class="announcement-content">${escapeHtml(a.content || '')}</div>
                <div class="announcement-meta">${date} · ${escapeHtml(a.author_name || '')}</div>
            </div>`;
        }).join('');

        container.innerHTML = items;
    }

    function renderAlerts(data, container) {
        if (!data.alerts || data.alerts.length === 0) {
            container.innerHTML = '<div class="widget-empty">✅ Все в порядку</div>';
            return;
        }
        const DEFAULT_LINKS = { warning: '/tasks', info: '/', critical: '/finance' };
        const items = data.alerts.map(a => {
            const typeCls = a.level === 'critical' ? 'alert-critical' : a.level === 'warning' ? 'alert-warning' : 'alert-info';
            const link = a.link || DEFAULT_LINKS[a.level] || '/dashboard';
            return `<a href="${link}" class="dash-alert-item ${typeCls}" title="Перейти →">
                <span class="dash-alert-icon">${a.icon || '🔔'}</span>
                <span class="dash-alert-text">${escapeHtml(a.title)}</span>
                <span class="dash-alert-arrow">›</span>
            </a>`;
        }).join('');
        container.innerHTML = items;
    }

    function renderExceptions(data, container) {
        if (!data.exceptions || data.exceptions.length === 0) {
            container.innerHTML = '<div class="widget-empty">✅ Все під контролем — жодних виключень</div>';
            return;
        }
        const catLabels = {
            conflicts: '💥 Конфлікти', noAnimator: '🎭 Без аніматора',
            overduePrep: '⏰ Підготовка', detractors: '😞 NPS',
            cleaningSLA: '🧹 Прибирання', unconfirmedLate: '🔴 Не підтверджено'
        };
        // Category summary bar
        const cats = data.categories || {};
        const summaryParts = Object.entries(cats)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `<span class="exc-cat-badge" title="${catLabels[k] || k}">${(catLabels[k] || k).split(' ')[0]} ${v}</span>`)
            .join('');
        const summary = summaryParts ? `<div class="exc-summary">${summaryParts}</div>` : '';

        const items = data.exceptions.slice(0, 8).map(e => {
            const lvlCls = e.level === 'critical' ? 'alert-critical' : e.level === 'warning' ? 'alert-warning' : 'alert-info';
            const link = e.link || '/';
            return `<a href="${link}" class="dash-alert-item ${lvlCls}" title="${escapeHtml(e.action?.prompt || '')}">
                <span class="dash-alert-icon">${e.icon || '⚠️'}</span>
                <span class="dash-alert-text">${escapeHtml(e.title)}</span>
                <span class="dash-alert-arrow">›</span>
            </a>`;
        }).join('');
        container.innerHTML = summary + items;
    }

    function renderLeadsNew(data, container) {
        if (!data.leads || data.leads.length === 0) {
            container.innerHTML = '<div class="widget-empty">Немає нових лідів</div>';
            return;
        }
        const sourceColors = { telegram: '#0088cc', facebook: '#1877F2', instagram: '#E4405F', viber: '#7360F2', website: '#38A169', phone: '#DD6B20' };
        const items = data.leads.slice(0, 6).map(l => {
            const color = sourceColors[l.source] || '#718096';
            const date = new Date(l.created_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const leadId = l.id || l.lead_id || l.leadId;
            const href = leadId ? `/sales-funnel?lead=${encodeURIComponent(leadId)}` : '/sales-funnel';
            const name = l.name || 'Без імені';
            return `<a class="widget-lead-item" href="${escapeHtml(href)}" aria-label="Відкрити лід ${escapeHtml(name)}">
                <div class="lead-source-dot" style="background:${color}" title="${escapeHtml(l.source || '')}"></div>
                <div class="lead-info">
                    <div class="lead-name">${escapeHtml(name)}</div>
                    <div class="lead-meta">${escapeHtml(l.phone || '')} · ${date}</div>
                </div>
            </a>`;
        }).join('');
        container.innerHTML = `<div class="widget-lead-list">${items}</div>`;
    }

    function renderFinanceToday(data, container) {
        const fmt = (v) => {
            if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return Math.round(v) + '';
        };
        container.innerHTML = `
            <div class="finance-today-grid">
                <div class="finance-stat revenue">
                    <div class="finance-stat-value">${fmt(data.revenue || 0)} ₴</div>
                    <div class="finance-stat-label">Виручка</div>
                </div>
                <div class="finance-stat expenses">
                    <div class="finance-stat-value">${fmt(data.expenses || 0)} ₴</div>
                    <div class="finance-stat-label">Витрати</div>
                </div>
                <div class="finance-stat profit">
                    <div class="finance-stat-value ${(data.profit || 0) >= 0 ? 'positive' : 'negative'}">${(data.profit || 0) >= 0 ? '+' : ''}${fmt(data.profit || 0)} ₴</div>
                    <div class="finance-stat-label">Прибуток</div>
                </div>
                <div class="finance-stat bookings">
                    <div class="finance-stat-value">${data.bookings || 0}</div>
                    <div class="finance-stat-label">Бронювань</div>
                </div>
            </div>
        `;
    }

    function renderReportsToday(data, container) {
        const fmt = (v) => {
            if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return Math.round(v) + '';
        };
        container.innerHTML = `
            <div class="finance-today-grid">
                <div class="finance-stat revenue">
                    <div class="finance-stat-value">${fmt(data.income || 0)} ₴</div>
                    <div class="finance-stat-label">Доходи</div>
                </div>
                <div class="finance-stat expenses">
                    <div class="finance-stat-value">${fmt(data.expense || 0)} ₴</div>
                    <div class="finance-stat-label">Витрати</div>
                </div>
                <div class="finance-stat bookings">
                    <div class="finance-stat-value">${data.newCount || 0}</div>
                    <div class="finance-stat-label">Нових звітів</div>
                </div>
            </div>
            <a href="/reports" style="display:block;text-align:center;margin-top:8px;font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">
                Відкрити звіти →
            </a>
        `;
    }

    function renderCatalogs(data, container) {
        const items = data.recentItems || [];
        const defs = data.definitions || [];
        let html = '';
        if (defs.length) {
            html += '<div class="catalog-defs-row">';
            defs.forEach(d => {
                html += `<span class="catalog-def-badge" title="${escapeHtml(d.name)}">${d.emoji} ${escapeHtml(d.name)} <small>(${d.count || 0})</small></span> `;
            });
            html += '</div>';
        }
        if (items.length) {
            html += '<div class="catalog-mini-list">';
            items.forEach(it => {
                html += `<div class="catalog-mini-item">
                    <div class="catalog-mini-thumb">${it.image_url ? '<img src="' + escapeHtml(it.image_url) + '" loading="lazy" alt="">' : '<span>' + (it.catalog_emoji || '🗂️') + '</span>'}</div>
                    <div class="catalog-mini-info">
                        <span class="catalog-mini-name">${escapeHtml(it.name)}</span>
                        <span class="catalog-mini-meta">${escapeHtml(it.catalog_name || '')}${it.price ? ' · ' + it.price + ' грн' : ''}</span>
                    </div>
                </div>`;
            });
            html += '</div>';
        } else {
            html += '<div class="widget-empty">Позицій ще немає</div>';
        }
        html += `<div style="display:flex;gap:8px;margin-top:8px;justify-content:center">
            <button class="btn-primary btn-sm" onclick="openAddCatalogItem()">+ Додати позицію</button>
            <a href="/designs" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none;line-height:32px">Каталоги →</a>
        </div>`;
        container.innerHTML = html;
    }

    function renderAccountStats(data, container) {
        const total = parseInt(data.total_staff) || 0;
        const linked = parseInt(data.with_account) || 0;
        const unlinked = parseInt(data.without_account) || 0;
        const freelance = parseInt(data.freelance_slots) || 0;
        const pct = total > 0 ? Math.round(linked / total * 100) : 0;
        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value" style="color:#22c55e">${linked}</div>
                    <div class="stat-label">З акаунтом</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value" style="color:#f59e0b">${unlinked}</div>
                    <div class="stat-label">Без акаунту</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value" style="color:var(--gray-400)">${freelance}</div>
                    <div class="stat-label">Фріланс</div>
                </div>
            </div>
            <div style="margin-top:8px;text-align:center">
                <div style="background:var(--gray-200);border-radius:8px;height:6px;overflow:hidden;margin-bottom:6px">
                    <div style="background:#22c55e;height:100%;width:${pct}%;border-radius:8px;transition:width 0.3s"></div>
                </div>
                <span style="font-size:11px;color:var(--gray-500)">${pct}% зв'язано</span>
            </div>
            <div style="text-align:center;margin-top:8px">
                <a href="/staff" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Переглянути →</a>
            </div>
        `;
    }

    // v39.10: Staff on shift today
    function renderStaffToday(data, container) {
        if (!data.onShift?.length && !data.absent?.length) {
            container.innerHTML = '<div class="widget-empty">Немає даних про зміни</div>';
            return;
        }
        const deptGroups = {};
        (data.onShift || []).forEach(s => {
            const dept = s.department || 'інше';
            if (!deptGroups[dept]) deptGroups[dept] = [];
            deptGroups[dept].push(s);
        });
        const DEPT_LABELS = { animators: '🎭 Аніматори', admin: '📋 Адмін', cafe: '☕ Кафе', cleaning: '🧹 Господарчі', security: '🔒 Охорона', trampoline: '🤸 Батути' };
        let html = `<div style="font-size:12px;color:var(--gray-500);margin-bottom:8px">На зміні: <b>${data.onShift?.length || 0}</b></div>`;
        for (const [dept, staff] of Object.entries(deptGroups)) {
            html += `<div style="font-size:11px;font-weight:700;color:var(--gray-400);margin:6px 0 2px">${DEPT_LABELS[dept] || dept}</div>`;
            staff.forEach(s => {
                const initials = (s.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2);
                html += `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px">
                    <div style="width:24px;height:24px;border-radius:50%;background:${s.color || '#6366f1'}30;color:${s.color || '#6366f1'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${initials}</div>
                    <span style="flex:1;${s.is_online ? 'font-weight:600' : ''}">${escapeHtml(s.name)}</span>
                    <span style="color:var(--gray-400);font-size:11px">${s.shift_start || ''}–${s.shift_end || ''}</span>
                    ${s.is_online ? '<span style="width:6px;height:6px;border-radius:50%;background:#22c55e;flex-shrink:0" title="Онлайн"></span>' : ''}
                </div>`;
            });
        }
        if (data.absent?.length) {
            html += `<div style="font-size:11px;font-weight:700;color:#ef4444;margin:8px 0 2px">🏥 Відсутні (${data.absent.length})</div>`;
            data.absent.forEach(s => {
                const labels = { sick: '🏥 Лікарняний', vacation: '🌴 Відпустка' };
                html += `<div style="font-size:12px;color:var(--gray-500);padding:2px 0">${escapeHtml(s.name)} — ${labels[s.status] || s.status}</div>`;
            });
        }
        html += `<div style="text-align:center;margin-top:8px"><a href="/staff" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Графік →</a></div>`;
        container.innerHTML = html;
    }

    // v39.10: Week bookings
    function renderWeekBookings(data, container) {
        if (!data.days?.length) {
            container.innerHTML = '<div class="widget-empty">Немає бронювань на тиждень</div>';
            return;
        }
        const dayNames = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        const totalRev = data.days.reduce((s, d) => s + (d.revenue || 0), 0);
        const totalCount = data.days.reduce((s, d) => s + (d.count || 0), 0);
        let html = `<div class="stats-grid" style="margin-bottom:8px">
            <div class="stat-item"><div class="stat-value">${totalCount}</div><div class="stat-label">Бронювань</div></div>
            <div class="stat-item"><div class="stat-value">${formatCurrency(totalRev)}</div><div class="stat-label">Виручка</div></div>
        </div>`;
        html += '<div style="display:flex;gap:4px;align-items:flex-end;height:80px;margin-top:8px">';
        const maxCount = Math.max(...data.days.map(d => d.count || 0), 1);
        data.days.forEach(d => {
            const dt = new Date(d.date + 'T12:00:00');
            const dayName = dayNames[dt.getDay()];
            const dayNum = dt.getDate();
            const h = Math.max(8, Math.round(((d.count || 0) / maxCount) * 60));
            const isToday = d.date === data.from;
            html += `<div style="flex:1;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:flex-end">
                <div style="font-size:10px;font-weight:700;color:var(--gray-500);margin-bottom:2px">${d.count || 0}</div>
                <div style="width:100%;max-width:28px;height:${h}px;border-radius:4px 4px 0 0;background:${isToday ? 'linear-gradient(135deg,var(--primary),var(--primary-dark))' : d.pending > 0 ? '#f59e0b' : 'var(--gray-200)'};transition:height 0.3s" title="${d.confirmed || 0} підтв. / ${d.pending || 0} очік."></div>
                <div style="font-size:10px;color:${isToday ? 'var(--primary)' : 'var(--gray-400)'};font-weight:${isToday ? '800' : '400'};margin-top:2px">${dayName}<br>${dayNum}</div>
            </div>`;
        });
        html += '</div>';
        html += `<div style="text-align:center;margin-top:8px"><a href="/" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Таймлайн →</a></div>`;
        container.innerHTML = html;
    }

    // v39.10: Team tasks
    function renderTeamTasks(data, container) {
        const s = data.stats || {};
        let html = `<div class="stats-grid" style="margin-bottom:8px">
            <div class="stat-item"><div class="stat-value" style="color:#f59e0b">${s.todo || 0}</div><div class="stat-label">Очікують</div></div>
            <div class="stat-item"><div class="stat-value" style="color:var(--primary)">${s.in_progress || 0}</div><div class="stat-label">В роботі</div></div>
            <div class="stat-item"><div class="stat-value" style="color:#ef4444">${s.overdue || 0}</div><div class="stat-label">Прострочено</div></div>
        </div>`;
        if (data.tasks?.length) {
            html += '<div style="max-height:200px;overflow-y:auto">';
            data.tasks.slice(0, 10).forEach(t => {
                const overdue = t.is_overdue ? ' style="border-left:3px solid #ef4444"' : '';
                const pIcon = t.priority === 'high' ? '🔴 ' : '';
                html += `<div style="padding:6px 8px;border-radius:6px;margin-bottom:4px;background:var(--gray-50,rgba(0,0,0,0.02));font-size:12px;cursor:pointer"${overdue} onclick="window.location='/tasks?open=${t.id}'">
                    <div style="font-weight:600">${pIcon}${escapeHtml(t.title?.slice(0, 50) || '')}</div>
                    <div style="color:var(--gray-400);font-size:11px;margin-top:2px">
                        ${t.assigned_to ? '👤 ' + escapeHtml(t.assigned_to) : '— нікому'}
                        ${t.deadline ? ' · ⏰ ' + new Date(t.deadline).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' }) : ''}
                    </div>
                </div>`;
            });
            html += '</div>';
        }
        html += `<div style="text-align:center;margin-top:8px"><a href="/tasks" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Всі задачі →</a></div>`;
        container.innerHTML = html;
    }

    // v39.10: HR overview
    function renderHrOverview(data, container) {
        let html = '';
        if (data.absent?.length) {
            html += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:#ef4444;margin-bottom:4px">🏥 Відсутні сьогодні (${data.absent.length})</div>`;
            data.absent.forEach(s => {
                const label = s.status === 'sick' ? '🏥' : '🌴';
                html += `<div style="font-size:12px;padding:2px 0">${label} ${escapeHtml(s.name)}</div>`;
            });
            html += '</div>';
        }
        if (data.pendingLeaves?.length) {
            html += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:4px">📋 Заявки на затвердження (${data.pendingLeaves.length})</div>`;
            data.pendingLeaves.forEach(l => {
                html += `<div style="font-size:12px;padding:2px 0">${escapeHtml(l.name)} — ${l.type} (${l.date_from?.slice(5)} → ${l.date_to?.slice(5)})</div>`;
            });
            html += '</div>';
        }
        if (data.birthdays?.length) {
            html += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--primary);margin-bottom:4px">🎂 Дні народження цього тижня</div>`;
            data.birthdays.forEach(b => {
                const day = b.birth_date ? new Date(b.birth_date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }) : '';
                html += `<div style="font-size:12px;padding:2px 0">🎂 ${escapeHtml(b.name)} ${day}</div>`;
            });
            html += '</div>';
        }
        if (!html) html = '<div class="widget-empty">Все спокійно в HR</div>';
        html += `<div style="text-align:center;margin-top:8px"><a href="/hr" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">HR →</a></div>`;
        container.innerHTML = html;
    }

    // v39.10: Director P&L
    function renderDirectorPnl(data, container) {
        const w = data.week || {};
        const m = data.month || {};
        container.innerHTML = `
            <div style="font-size:11px;font-weight:700;color:var(--gray-400);margin-bottom:4px">📊 Цей тиждень</div>
            <div class="stats-grid" style="margin-bottom:12px">
                <div class="stat-item"><div class="stat-value" style="color:#22c55e">${formatCurrency(w.revenue || 0)}</div><div class="stat-label">Дохід</div></div>
                <div class="stat-item"><div class="stat-value" style="color:#ef4444">${formatCurrency(w.expenses || 0)}</div><div class="stat-label">Витрати</div></div>
                <div class="stat-item"><div class="stat-value" style="color:${(w.profit||0)>=0?'#22c55e':'#ef4444'}">${formatCurrency(w.profit || 0)}</div><div class="stat-label">Прибуток</div></div>
            </div>
            <div style="font-size:11px;font-weight:700;color:var(--gray-400);margin-bottom:4px">📅 Цей місяць</div>
            <div class="stats-grid" style="margin-bottom:8px">
                <div class="stat-item"><div class="stat-value" style="color:#22c55e">${formatCurrency(m.revenue || 0)}</div><div class="stat-label">Дохід</div></div>
                <div class="stat-item"><div class="stat-value" style="color:#ef4444">${formatCurrency(m.expenses || 0)}</div><div class="stat-label">Витрати</div></div>
                <div class="stat-item"><div class="stat-value" style="color:${(m.profit||0)>=0?'#22c55e':'#ef4444'}">${formatCurrency(m.profit || 0)}</div><div class="stat-label">Прибуток</div></div>
            </div>
            <div style="font-size:11px;color:var(--gray-500)">👥 ${data.staffCount || 0} співробітників</div>
            <div style="text-align:center;margin-top:8px"><a href="/finance" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Фінанси →</a></div>
        `;
    }

    // v39.10: Art director content pipeline
    function renderContentPipeline(data, container) {
        let html = '';
        if (data.inReview?.length) {
            html += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:#f59e0b;margin-bottom:4px">👁 На ревью (${data.inReview.length})</div>`;
            data.inReview.forEach(c => {
                html += `<div style="font-size:12px;padding:3px 0;cursor:pointer" onclick="window.location='/art-director'">${escapeHtml(c.title?.slice(0, 40) || 'Без назви')}</div>`;
            });
            html += '</div>';
        }
        html += `<div style="font-size:12px;color:var(--gray-500);margin-bottom:8px">✅ Затверджено за тиждень: <b>${data.approvedThisWeek || 0}</b></div>`;
        if (data.designTasks?.length) {
            html += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--primary);margin-bottom:4px">🎨 Дизайн-задачі</div>`;
            data.designTasks.forEach(t => {
                const pIcon = t.priority === 'high' ? '🔴 ' : '';
                html += `<div style="font-size:12px;padding:2px 0">${pIcon}${escapeHtml(t.title?.slice(0, 45) || '')}</div>`;
            });
            html += '</div>';
        }
        if (data.catalogs?.length) {
            html += `<div style="font-size:11px;font-weight:700;color:var(--gray-400);margin-bottom:4px">📚 Каталоги (${data.catalogs.length})</div>`;
            html += data.catalogs.map(c => `<span style="font-size:12px;margin-right:8px">${c.emoji || '📂'} ${escapeHtml(c.name)} <span style="color:${c.status==='ready'?'#22c55e':'#f59e0b'};font-size:10px">${c.status==='ready'?'✅':'🔄'}</span></span>`).join('');
        }
        html += `<div style="text-align:center;margin-top:8px"><a href="/designs" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Дизайн →</a></div>`;
        container.innerHTML = html || '<div class="widget-empty">Контент пайплайн порожній</div>';
    }

    // v39.10: Vice director operations
    function renderOperations(data, container) {
        const q = data.quality || {};
        let html = `<div class="stats-grid" style="margin-bottom:8px">
            <div class="stat-item"><div class="stat-value">${q.avg_rating || '—'}</div><div class="stat-label">Рейтинг (30д)</div></div>
            <div class="stat-item"><div class="stat-value" style="color:#ef4444">${data.complaintsWeek || 0}</div><div class="stat-label">Скарги (7д)</div></div>
            <div class="stat-item"><div class="stat-value" style="color:#f59e0b">${data.staffNotCheckedIn || 0}</div><div class="stat-label">Не на місці</div></div>
        </div>`;
        if (data.procurement?.length) {
            html += `<div style="margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--gray-400);margin-bottom:4px">🛒 Закупки (${data.procurement.length})</div>`;
            data.procurement.forEach(p => {
                const statusLabel = p.status === 'ordered' ? '📦 Замовлено' : '📝 Чернетка';
                html += `<div style="font-size:12px;padding:2px 0">${statusLabel} ${escapeHtml(p.name?.slice(0, 40) || '')}</div>`;
            });
            html += '</div>';
        }
        html += `<div style="text-align:center;margin-top:8px"><a href="/center" style="font-size:12px;color:var(--primary);font-weight:700;text-decoration:none">Центр →</a></div>`;
        container.innerHTML = html;
    }

    // Onboarding wizard
    function showOnboarding() {
        const overlay = document.createElement('div');
        overlay.className = 'onboarding-overlay';
        overlay.id = 'onboardingOverlay';

        const role = getUserRole();
        const availableWidgets = Object.entries(WIDGET_DEFS)
            .filter(([key, def]) => !DASHBOARD_RETIRED_WIDGETS.has(key) && (!def.minRole || (typeof hasMinRole === 'function' && hasMinRole(def.minRole))));

        const widgetOptions = availableWidgets.map(([key, def]) => {
            const isDefault = _config && _config.widgets && _config.widgets.includes(key);
            return `<div class="onboarding-widget-option ${isDefault ? 'selected' : ''}" data-widget="${key}" onclick="DashboardPage.toggleOnboardingWidget(this)">
                <div class="onboarding-widget-icon">${def.icon}</div>
                <div class="onboarding-widget-label">${def.title}</div>
            </div>`;
        }).join('');

        overlay.innerHTML = `
            <div class="onboarding-modal">
                <h2>Налаштуйте дашборд</h2>
                <p>Оберіть віджети, які хочете бачити на головній сторінці</p>
                <div class="onboarding-widgets">${widgetOptions}</div>
                <button class="dashboard-btn primary" onclick="DashboardPage.saveOnboarding()" style="width:100%">Зберегти</button>
            </div>
        `;

        document.body.appendChild(overlay);
    }

    function toggleOnboardingWidget(el) {
        el.classList.toggle('selected');
    }

    async function saveOnboarding() {
        const selected = [];
        document.querySelectorAll('.onboarding-widget-option.selected').forEach(el => {
            selected.push(el.dataset.widget);
        });

        if (selected.length === 0) {
            selected.push('tasks', 'weather');
        }

        _config.widgets = selected;

        try {
            await saveDashboardConfig({ widgets: selected });
        } catch {}

        const overlay = document.getElementById('onboardingOverlay');
        if (overlay) overlay.remove();

        renderWidgets();
    }

    function getSettingsOverlayState() {
        const widgets = Array.from(document.querySelectorAll('#settingsWidgetList .settings-widget-item.active'))
            .map(el => el.dataset.widget || '')
            .join('|');
        const writingLane = document.getElementById('settingsWritingLane');
        const controlledChaos = document.getElementById('settingsControlledChaos');
        const snapToGrid = document.getElementById('settingsBoardSnapToGrid');
        const showGrid = document.getElementById('settingsBoardShowGrid');
        const showGuides = document.getElementById('settingsBoardShowGuides');
        const showPlanner = document.getElementById('settingsBoardShowPlanner');
        const strokeColor = document.getElementById('settingsBoardStrokeColor');
        const strokeWidth = document.getElementById('settingsBoardStrokeWidth');
        return [
            widgets,
            `writing:${writingLane ? writingLane.checked : _config?.sceneOptions?.writingLane !== false}`,
            `chaos:${controlledChaos ? controlledChaos.checked : _config?.sceneOptions?.controlledChaos !== false}`,
            `snap:${snapToGrid ? snapToGrid.checked : _config?.boardState?.preferences?.snapToGrid !== false}`,
            `grid:${showGrid ? showGrid.checked : _config?.boardState?.preferences?.showGrid !== false}`,
            `guides:${showGuides ? showGuides.checked : _config?.boardState?.preferences?.showGuides !== false}`,
            `planner:${showPlanner ? showPlanner.checked : _config?.boardState?.preferences?.showPlanner !== false}`,
            `stroke:${strokeColor ? strokeColor.value : _config?.boardState?.preferences?.strokeColor || '#10b981'}`,
            `width:${strokeWidth ? strokeWidth.value : _config?.boardState?.preferences?.strokeWidth || 2}`
        ].join('|');
    }

    function isSettingsOverlayDirty() {
        return getSettingsOverlayState() !== _settingsOverlayInitialState;
    }

    async function closeSettingsOverlay(force = false) {
        const overlay = document.getElementById('settingsOverlay');
        if (!overlay) return true;

        const closeNow = () => {
            overlay.remove();
            _settingsOverlayInitialState = '';
        };

        if (window.UnsafeDismissGuard) {
            return window.UnsafeDismissGuard.attemptCloseEditableSurface(overlay, closeNow, {
                force,
                isDirty: isSettingsOverlayDirty,
                message: 'Є незбережені зміни в налаштуваннях дашборду. Закрити без збереження?',
                okText: 'Закрити без збереження',
                cancelText: 'Повернутись'
            });
        }

        if (!force && isSettingsOverlayDirty() && typeof confirmModal === 'function') {
            const confirmed = await confirmModal('Є незбережені зміни в налаштуваннях дашборду. Закрити без збереження?', {
                type: 'warning',
                okText: 'Закрити без збереження',
                cancelText: 'Повернутись'
            });
            if (!confirmed) return false;
        }

        closeNow();
        return true;
    }

    function openWidgetManager() {
        return openSettings();
    }

    // Settings modal with drag & drop reordering
    function openSettings() {
        const effectiveRole = getEffectiveDashboardRole();
        const effectiveScene = getEffectiveDashboardScene();
        const sceneOptions = normalizeSceneOptions(_config?.sceneOptions);
        const boardPrefs = safeObject(_config?.boardState?.preferences, {});
        const availableWidgets = Object.entries(WIDGET_DEFS)
            .filter(([key]) => canUseWidgetForRole(key, effectiveRole));

        const activeWidgets = _config ? (_config.widgets || []) : [];

        // Sort: active first (in order), then inactive
        const sortedWidgets = [
            ...activeWidgets.filter(k => availableWidgets.some(([wk]) => wk === k)).map(k => [k, WIDGET_DEFS[k]]),
            ...availableWidgets.filter(([k]) => !activeWidgets.includes(k)),
        ];

        const activeWidgetCount = activeWidgets.filter(k => availableWidgets.some(([wk]) => wk === k)).length;
        const widgetItems = sortedWidgets.map(([key, def]) => {
            const isActive = activeWidgets.includes(key);
            const order = isActive ? activeWidgets.indexOf(key) + 1 : '';
            const accessLabel = def.minRole ? `Від ролі: ${roleDisplayName(def.minRole)}` : 'Доступно всім ролям';
            return `<div class="settings-widget-item ${isActive ? 'active' : ''}" data-widget="${escapeHtml(key)}" data-widget-state="${isActive ? 'active' : 'inactive'}" data-widget-title="${escapeHtml(String(def.title || key).toLowerCase())}" data-widget-access="${escapeHtml(accessLabel)}" draggable="true">
                <span class="settings-drag-handle" title="Перетягнути">⠿</span>
                <span class="settings-widget-icon">${escapeHtml(def.icon || '◫')}</span>
                <span class="settings-widget-main">
                    <span class="settings-widget-name">${escapeHtml(def.title || key)}</span>
                    <span class="settings-widget-meta">${isActive ? 'Показується на дашборді' : 'Приховано'} · ${escapeHtml(accessLabel)}</span>
                </span>
                <span class="settings-widget-order" ${order ? '' : 'hidden'}>${order}</span>
                <label class="settings-toggle">
                    <input type="checkbox" ${isActive ? 'checked' : ''} onchange="DashboardPage.toggleSettingsWidget(this)">
                    <span class="settings-toggle-slider"></span>
                </label>
            </div>`;
        }).join('');
        // Remove previous settings modal if open
        const prev = document.getElementById('settingsOverlay');
        if (prev) {
            closeSettingsOverlay(false);
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'onboarding-overlay dashboard-settings-overlay';
        overlay.id = 'settingsOverlay';
        overlay.innerHTML = `
            <div class="settings-modal">
                <div class="settings-modal-header">
                    <h2>Налаштування дашборду</h2>
                    <p>Керуйте доступними віджетами, порядком, board-сценою і персональним набором dashboard.</p>
                </div>
                <div class="dashboard-settings-scene-card">
                    <div class="dashboard-settings-scene-summary">
                        <span>Активна сцена</span>
                        <strong>${escapeHtml(roleDisplayName(effectiveRole))}</strong>
                        <em>${escapeHtml(effectiveScene.title || 'Mixed scene')}</em>
                    </div>
                    <label class="dashboard-settings-scene-row">
                        <span>Writing lane справа</span>
                        <span class="settings-toggle">
                            <input type="checkbox" id="settingsWritingLane" ${sceneOptions.writingLane ? 'checked' : ''}>
                            <span class="settings-toggle-slider"></span>
                        </span>
                    </label>
                    <label class="dashboard-settings-scene-row">
                        <span>Керована асиметрія зліва</span>
                        <span class="settings-toggle">
                            <input type="checkbox" id="settingsControlledChaos" ${sceneOptions.controlledChaos ? 'checked' : ''}>
                            <span class="settings-toggle-slider"></span>
                        </span>
                    </label>
                </div>
                <div class="dashboard-settings-scene-card dashboard-settings-board-card">
                    <div class="dashboard-settings-scene-summary">
                        <span>Board editor</span>
                        <strong>Сцена + дошка</strong>
                        <em>Єдиний простір редагування: інструмент, сітка, snap і стиль ліній.</em>
                    </div>
                    <label class="dashboard-settings-scene-row">
                        <span>Прив’язка до сітки</span>
                        <span class="settings-toggle">
                            <input type="checkbox" id="settingsBoardSnapToGrid" ${boardPrefs.snapToGrid !== false ? 'checked' : ''}>
                            <span class="settings-toggle-slider"></span>
                        </span>
                    </label>
                    <label class="dashboard-settings-scene-row">
                        <span>Показувати сітку</span>
                        <span class="settings-toggle">
                            <input type="checkbox" id="settingsBoardShowGrid" ${boardPrefs.showGrid !== false ? 'checked' : ''}>
                            <span class="settings-toggle-slider"></span>
                        </span>
                    </label>
                    <label class="dashboard-settings-scene-row">
                        <span>Показувати напрямні</span>
                        <span class="settings-toggle">
                            <input type="checkbox" id="settingsBoardShowGuides" ${boardPrefs.showGuides !== false ? 'checked' : ''}>
                            <span class="settings-toggle-slider"></span>
                        </span>
                    </label>
                    <label class="dashboard-settings-scene-row">
                        <span>Показувати планувальні зони</span>
                        <span class="settings-toggle">
                            <input type="checkbox" id="settingsBoardShowPlanner" ${boardPrefs.showPlanner !== false ? 'checked' : ''}>
                            <span class="settings-toggle-slider"></span>
                        </span>
                    </label>
                    <label class="dashboard-settings-scene-row dashboard-settings-inline-control">
                        <span>Колір інструменту</span>
                        <input type="color" id="settingsBoardStrokeColor" value="${escapeHtml(boardPrefs.strokeColor || '#10b981')}">
                    </label>
                    <label class="dashboard-settings-scene-row dashboard-settings-inline-control">
                        <span>Товщина лінії</span>
                        <input type="range" id="settingsBoardStrokeWidth" min="1" max="12" value="${Number(boardPrefs.strokeWidth || 2)}">
                    </label>
                </div>
                <div class="settings-widget-list" id="settingsWidgetList">${widgetItems}</div>
                <div class="settings-modal-footer">
                    <button class="dashboard-btn" onclick="DashboardPage.closeSettingsOverlay(false)">Скасувати</button>
                    <button class="dashboard-btn primary" onclick="DashboardPage.saveSettings()">Зберегти</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        hydrateSettingsOverlayLayout(overlay, {
            activeWidgetCount,
            availableWidgetCount: availableWidgets.length
        });
        _settingsOverlayInitialState = getSettingsOverlayState();
        if (window.UnsafeDismissGuard) window.UnsafeDismissGuard.remember(overlay, {
            isDirty: isSettingsOverlayDirty
        });
        _initDragAndDrop();
        _initSettingsWidgetFilters(overlay);
        updateSettingsWidgetSummary();
    }

    function hydrateSettingsOverlayLayout(overlay, counts = {}) {
        const modal = overlay?.querySelector?.('.settings-modal');
        if (!modal || modal.dataset.settingsLayoutReady === '1') return;
        modal.dataset.settingsLayoutReady = '1';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'settingsModalTitle');

        const header = modal.querySelector('.settings-modal-header');
        if (header) {
            header.innerHTML = `
                <div class="settings-modal-title">
                    <span>Dashboard builder</span>
                    <h2 id="settingsModalTitle">Налаштування дашборду</h2>
                    <p>Зберіть робочий екран: сцена, board-поведінка, видимі віджети і порядок показу.</p>
                </div>
                <button type="button" class="settings-modal-close" onclick="DashboardPage.closeSettingsOverlay(false)" aria-label="Закрити">×</button>
            `;
        }

        const cards = Array.from(modal.children).filter(child => child.classList?.contains('dashboard-settings-scene-card'));
        const widgetList = modal.querySelector('#settingsWidgetList');
        const footer = modal.querySelector('.settings-modal-footer');
        if (!widgetList || !footer) return;

        const body = document.createElement('div');
        body.className = 'settings-modal-body';

        const configColumn = document.createElement('section');
        configColumn.className = 'settings-config-column';
        configColumn.setAttribute('aria-label', 'Параметри сцени і дошки');
        cards.forEach(card => configColumn.appendChild(card));

        const widgetPanel = document.createElement('section');
        widgetPanel.className = 'settings-widget-panel';
        widgetPanel.setAttribute('aria-labelledby', 'settingsWidgetTitle');
        widgetPanel.innerHTML = `
            <div class="settings-widget-panel-head">
                <div>
                    <span>Каталог віджетів</span>
                    <h3 id="settingsWidgetTitle">Віджети на дашборді</h3>
                </div>
                <strong id="settingsWidgetActiveCount">${Number(counts.activeWidgetCount || 0)}/${Number(counts.availableWidgetCount || 0)}</strong>
            </div>
            <div class="settings-widget-toolbar">
                <label class="settings-widget-search">
                    <span>Пошук</span>
                    <input type="search" id="settingsWidgetSearch" placeholder="Назва віджета..." autocomplete="off">
                </label>
                <div class="settings-widget-filters" role="group" aria-label="Фільтр віджетів">
                    <button type="button" class="settings-widget-filter active" data-settings-widget-filter="all">Усі</button>
                    <button type="button" class="settings-widget-filter" data-settings-widget-filter="active">Увімкнені</button>
                    <button type="button" class="settings-widget-filter" data-settings-widget-filter="inactive">Приховані</button>
                </div>
            </div>
            <div class="settings-widget-empty-state" id="settingsWidgetEmptyState" hidden>Нічого не знайдено</div>
        `;
        widgetPanel.insertBefore(widgetList, widgetPanel.querySelector('#settingsWidgetEmptyState'));

        body.append(configColumn, widgetPanel);
        modal.insertBefore(body, footer);
    }

    function _initSettingsWidgetFilters(overlay = document.getElementById('settingsOverlay')) {
        const search = overlay?.querySelector?.('#settingsWidgetSearch');
        if (search && search.dataset.settingsSearchBound !== '1') {
            search.dataset.settingsSearchBound = '1';
            search.addEventListener('input', filterSettingsWidgets);
        }

        overlay?.querySelectorAll?.('[data-settings-widget-filter]').forEach(button => {
            if (button.dataset.settingsFilterBound === '1') return;
            button.dataset.settingsFilterBound = '1';
            button.addEventListener('click', () => {
                overlay.querySelectorAll('[data-settings-widget-filter]').forEach(item => item.classList.remove('active'));
                button.classList.add('active');
                filterSettingsWidgets();
            });
        });
    }

    function filterSettingsWidgets() {
        const overlay = document.getElementById('settingsOverlay');
        const list = document.getElementById('settingsWidgetList');
        if (!overlay || !list) return;

        const term = String(overlay.querySelector('#settingsWidgetSearch')?.value || '').trim().toLowerCase();
        const filter = overlay.querySelector('[data-settings-widget-filter].active')?.dataset.settingsWidgetFilter || 'all';
        let visible = 0;

        list.querySelectorAll('.settings-widget-item').forEach(item => {
            const title = String(item.dataset.widgetTitle || item.textContent || '').toLowerCase();
            const state = item.classList.contains('active') ? 'active' : 'inactive';
            const matchesSearch = !term || title.includes(term);
            const matchesFilter = filter === 'all' || filter === state;
            const show = matchesSearch && matchesFilter;
            item.hidden = !show;
            if (show) visible += 1;
        });

        const empty = document.getElementById('settingsWidgetEmptyState');
        if (empty) empty.hidden = visible > 0;
    }

    function updateSettingsWidgetSummary() {
        const list = document.getElementById('settingsWidgetList');
        if (!list) return;
        const items = Array.from(list.querySelectorAll('.settings-widget-item'));
        const activeItems = items.filter(item => item.classList.contains('active'));
        const count = document.getElementById('settingsWidgetActiveCount');
        if (count) count.textContent = `${activeItems.length}/${items.length}`;

        activeItems.forEach((item, index) => {
            const badge = item.querySelector('.settings-widget-order');
            if (!badge) return;
            badge.hidden = false;
            badge.textContent = String(index + 1);
        });
        items.filter(item => !item.classList.contains('active')).forEach(item => {
            const badge = item.querySelector('.settings-widget-order');
            if (badge) badge.hidden = true;
        });

        filterSettingsWidgets();
    }

    function toggleSettingsWidget(checkbox) {
        const item = checkbox.closest('.settings-widget-item');
        if (checkbox.checked) {
            item.classList.add('active');
            item.dataset.widgetState = 'active';
        } else {
            item.classList.remove('active');
            item.dataset.widgetState = 'inactive';
        }
        const meta = item.querySelector('.settings-widget-meta');
        if (meta) {
            const access = item.dataset.widgetAccess || '';
            meta.textContent = `${checkbox.checked ? 'Показується на дашборді' : 'Приховано'}${access ? ` · ${access}` : ''}`;
        }
        updateSettingsWidgetSummary();
    }

    function _initDragAndDrop() {
        const list = document.getElementById('settingsWidgetList');
        if (!list) return;

        let dragEl = null;

        list.addEventListener('dragstart', (e) => {
            dragEl = e.target.closest('.settings-widget-item');
            if (!dragEl) return;
            dragEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        list.addEventListener('dragend', () => {
            if (dragEl) dragEl.classList.remove('dragging');
            dragEl = null;
            list.querySelectorAll('.settings-widget-item').forEach(el => el.classList.remove('drag-over'));
            updateSettingsWidgetSummary();
        });

        list.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const target = e.target.closest('.settings-widget-item');
            if (!target || target === dragEl) return;

            list.querySelectorAll('.settings-widget-item').forEach(el => el.classList.remove('drag-over'));
            target.classList.add('drag-over');

            const rect = target.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                list.insertBefore(dragEl, target);
            } else {
                list.insertBefore(dragEl, target.nextSibling);
            }
        });

        list.addEventListener('drop', (e) => {
            e.preventDefault();
            updateSettingsWidgetSummary();
        });
    }

    async function saveSettings() {
        const list = document.getElementById('settingsWidgetList');
        if (!list) return;

        const selected = [];
        list.querySelectorAll('.settings-widget-item').forEach(el => {
            const cb = el.querySelector('input[type="checkbox"]');
            if (cb && cb.checked) {
                selected.push(el.dataset.widget);
            }
        });

        if (selected.length === 0) {
            selected.push('tasks', 'weather');
        }

        if (!_config) _config = { widgets: [], layout: {}, theme: 'default' };
        _config.widgets = selected;
        _config.presentationMode = 'mixed-scene';
        _config.sceneOptions = {
            writingLane: document.getElementById('settingsWritingLane')?.checked !== false,
            controlledChaos: document.getElementById('settingsControlledChaos')?.checked !== false
        };
        const currentBoardState = normalizeBoardState(_config.boardState || {});
        currentBoardState.preferences = {
            ...safeObject(currentBoardState.preferences, {}),
            snapToGrid: document.getElementById('settingsBoardSnapToGrid')?.checked !== false,
            showGrid: document.getElementById('settingsBoardShowGrid')?.checked !== false,
            showGuides: document.getElementById('settingsBoardShowGuides')?.checked !== false,
            showPlanner: document.getElementById('settingsBoardShowPlanner')?.checked !== false,
            strokeColor: String(document.getElementById('settingsBoardStrokeColor')?.value || currentBoardState.preferences?.strokeColor || '#10b981').slice(0, 32),
            strokeWidth: safeNumber(document.getElementById('settingsBoardStrokeWidth')?.value, currentBoardState.preferences?.strokeWidth || 2, 1, 12)
        };
        _config.boardState = normalizeBoardState(currentBoardState);
        _config.layout = {
            ...safeObject(_config.layout, {}),
            mode: DASHBOARD_WORKSPACE_MODE,
            presentationMode: _config.presentationMode,
            roleScenePreset: _config.roleScenePreset || null,
            sceneOptions: _config.sceneOptions,
            boardMeta: _config.boardMeta,
            boardState: _config.boardState
        };

        try {
            await saveDashboardConfig({
                widgets: selected,
                presentationMode: _config.presentationMode,
                sceneOptions: _config.sceneOptions,
                boardState: _config.boardState
            });
        } catch (err) {
            console.error('Save settings error:', err);
        }

        const overlay = document.getElementById('settingsOverlay');
        if (window.UnsafeDismissGuard && overlay) window.UnsafeDismissGuard.markClean(overlay);
        await closeSettingsOverlay(true);

        renderWidgets();
    }

    // Test panel for creator
    function initTestPanel() {
        // v33.8.0: Dev Tools hidden temporarily
        return;

        if (!AppState.currentUser || AppState.currentUser.role !== 'creator') return;

        // v24.0.0: Dev Tools section on dashboard (replaces old FAB test panel)
        const grid = document.getElementById('dashboardGrid');
        if (!grid) return;

        const devTools = document.createElement('div');
        devTools.className = 'widget-card widget-devtools';
        devTools.dataset.widget = 'devtools';

        const roleOptions = Object.entries(ROLE_NAMES).map(([key, name]) =>
            `<option value="${key}">${name} (${key})</option>`
        ).join('');

        const currentTestRole = localStorage.getItem('pzp_test_role') || sessionStorage.getItem('testRole');
        const imp = sessionStorage.getItem('impersonating');
        let statusHtml = '';
        if (imp) {
            statusHtml = `<div class="devtools-badge imp">👤 Імперсонація: ${imp} <button class="devtools-badge-close" id="devtoolsResetImp">&times;</button></div>`;
        } else if (currentTestRole) {
            statusHtml = `<div class="devtools-badge role">🎭 Тест: ${ROLE_NAMES[currentTestRole] || currentTestRole} <button class="devtools-badge-close" id="devtoolsResetRole">&times;</button></div>`;
        }

        devTools.innerHTML = `
            <div class="widget-header">
                <div class="widget-title">
                    <span class="widget-title-icon">🎭</span>
                    Dev Tools (тільки для Creator)
                </div>
            </div>
            <div class="widget-body" id="widget-devtools">
                <div class="devtools-grid">
                    <div class="devtools-section">
                        <label class="devtools-label">Симулювати роль:</label>
                        <div class="devtools-row">
                            <select id="testRoleSelect" class="devtools-select">${roleOptions}</select>
                            <button class="devtools-btn" onclick="DashboardPage.switchTestRole()">▶</button>
                            <button class="devtools-btn secondary" onclick="DashboardPage.resetTestRole()">✕</button>
                        </div>
                    </div>
                    <div class="devtools-section">
                        <label class="devtools-label">Симулювати юзера:</label>
                        <div class="devtools-row">
                            <select id="testUserSelect" class="devtools-select">
                                <option value="">Завантаження...</option>
                            </select>
                            <button class="devtools-btn" onclick="DashboardPage.switchTestUser()">▶</button>
                        </div>
                    </div>
                    ${statusHtml ? `<div class="devtools-section">${statusHtml}</div>` : ''}
                </div>
            </div>
        `;

        // Insert as first child
        grid.insertBefore(devTools, grid.firstChild);

        if (currentTestRole) {
            document.getElementById('testRoleSelect').value = currentTestRole;
        }

        // Load users for impersonation dropdown
        _loadUsersForDevtools();

        // Reset handlers
        const resetRoleBtn = document.getElementById('devtoolsResetRole');
        if (resetRoleBtn) resetRoleBtn.onclick = () => DashboardPage.resetTestRole();

        const resetImpBtn = document.getElementById('devtoolsResetImp');
        if (resetImpBtn) resetImpBtn.onclick = () => {
            if (typeof RoleSwitcher !== 'undefined') RoleSwitcher.resetImpersonation();
        };
    }

    async function _loadUsersForDevtools() {
        const select = document.getElementById('testUserSelect');
        if (!select) return;
        try {
            const resp = await fetch('/api/auth/users-list', {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
            });
            if (!resp.ok) throw new Error();
            const users = await resp.json();
            select.innerHTML = '<option value="">— Обрати юзера —</option>' +
                users.filter(u => u.username !== AppState.currentUser.username)
                    .map(u => `<option value="${u.id}">${escapeHtml(u.name)} (${ROLE_NAMES[u.role] || escapeHtml(u.role)})</option>`)
                    .join('');
        } catch {
            select.innerHTML = '<option value="">Помилка</option>';
        }
    }

    async function switchTestUser() {
        const select = document.getElementById('testUserSelect');
        if (!select || !select.value) return;
        const userId = parseInt(select.value);
        if (typeof RoleSwitcher !== 'undefined') {
            // Use RoleSwitcher impersonation
            try {
                const resp = await fetch('/api/auth/impersonate', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token'), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId })
                });
                if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Failed');
                const data = await resp.json();
                sessionStorage.setItem('realToken', localStorage.getItem('pzp_token'));
                sessionStorage.setItem('realUser', JSON.stringify(AppState.currentUser));
                sessionStorage.setItem('impersonating', data.user.username);
                localStorage.setItem('pzp_token', data.token);
                localStorage.setItem(CONFIG.STORAGE.CURRENT_USER, JSON.stringify(data.user));
                window.location.reload();
            } catch (err) {
                if (typeof showNotification === 'function') showNotification('Помилка: ' + err.message, 'error');
            }
        }
    }

    function switchTestRole() {
        const select = document.getElementById('testRoleSelect');
        if (!select) return;

        const role = select.value;
        localStorage.setItem('pzp_test_role', role);
        showTestModeBadge(role);

        // Reload to apply
        window.location.reload();
    }

    function resetTestRole() {
        localStorage.removeItem('pzp_test_role');
        const badge = document.getElementById('testModeBadge');
        if (badge) badge.remove();
        window.location.reload();
    }

    function showTestModeBadge(role) {
        let badge = document.getElementById('testModeBadge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'test-mode-badge';
            badge.id = 'testModeBadge';
            document.body.appendChild(badge);
        }
        const roleName = ROLE_NAMES[role] || role;
        badge.textContent = `Тестовий режим: ${roleName}`;
    }

    async function openTask(taskId) {
        // Fetch full task details
        try {
            const resp = await fetch(`/api/tasks/${taskId}`, {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('pzp_token') }
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const task = await resp.json();
            if (!task || !task.id) throw new Error('Task not found');

            showTaskModal(task);
        } catch (err) {
            console.error('Open task error:', err);
            // Fallback: navigate to tasks page
            window.location.href = '/tasks';
        }
    }

    function showTaskModal(t) {
        // Remove previous if open
        const prev = document.getElementById('dashTaskModal');
        if (prev) prev.remove();

        const priorityLabels = { critical: 'Критичний', high: 'Високий', medium: 'Середній', low: 'Низький' };
        const statusLabels = { todo: 'Todo', in_progress: 'В роботі', done: 'Готово', cancelled: 'Скасовано' };
        const catLabels = { event: '🎉 Івент', purchase: '🛒 Закупівлі', admin: '📎 Адмін', trampoline: '🤸 Батути', personal: '👤 Особисті', improvement: '⚡ Покращення' };

        const priorityCls = t.priority === 'high' || t.priority === 'critical' ? 'high' : t.priority === 'low' ? 'low' : 'medium';

        let deadlineHtml = '';
        if (t.deadline) {
            const dl = new Date(t.deadline);
            const now = new Date();
            const isOverdue = dl < now;
            const dlStr = dl.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            deadlineHtml = `<div class="task-modal-row"><span class="task-modal-label">Дедлайн:</span> <span class="${isOverdue ? 'text-danger' : ''}">${dlStr}${isOverdue ? ' (протерміновано!)' : ''}</span></div>`;
        }

        const modal = document.createElement('div');
        modal.id = 'dashTaskModal';
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.innerHTML = `
            <div class="modal-content">
                <span class="modal-close" onclick="document.getElementById('dashTaskModal')?.remove()">&times;</span>
                <div class="task-modal-header">
                    <span class="task-modal-priority ${priorityCls}"></span>
                    <h3>${escapeHtml(t.title)}</h3>
                </div>
                <div class="task-modal-body">
                    <div class="task-modal-row"><span class="task-modal-label">Статус:</span> ${statusLabels[t.status] || t.status}</div>
                    <div class="task-modal-row"><span class="task-modal-label">Пріоритет:</span> ${priorityLabels[t.priority] || t.priority}</div>
                    <div class="task-modal-row"><span class="task-modal-label">Категорія:</span> ${catLabels[t.category] || t.category || '—'}</div>
                    ${t.assigned_to ? `<div class="task-modal-row"><span class="task-modal-label">Відповідальний:</span> ${escapeHtml(t.assigned_to)}</div>` : ''}
                    ${t.owner ? `<div class="task-modal-row"><span class="task-modal-label">Власник:</span> ${escapeHtml(t.owner)}</div>` : ''}
                    ${deadlineHtml}
                    ${t.date ? `<div class="task-modal-row"><span class="task-modal-label">Дата:</span> ${new Date(t.date).toLocaleDateString('uk-UA')}</div>` : ''}
                    ${t.description ? `<div class="task-modal-description"><span class="task-modal-label">Опис:</span><p>${escapeHtml(t.description)}</p></div>` : ''}
                    ${t.notes ? `<div class="task-modal-description"><span class="task-modal-label">Нотатки:</span><p>${escapeHtml(t.notes)}</p></div>` : ''}
                </div>
                <div class="task-modal-footer">
                    <a href="/tasks" class="dashboard-btn primary">Відкрити на сторінці задач</a>
                    <button class="dashboard-btn" onclick="document.getElementById('dashTaskModal')?.remove()">Закрити</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    function refreshWorkQueue() {
        if (document.getElementById('widget-funnel')) {
            loadWidgetData('funnel');
            return;
        }
        loadWorkQueue();
    }

    function setWorkQueueReplyScope(scope) {
        _workQueueReplyScope = normalizeWorkQueueReplyScope(scope);
        localStorage.setItem('eg_reply_backlog_scope', _workQueueReplyScope);
        _replyOpsFlash = null;
        _workQueueSelectedItemId = null;
        clearWorkQueueSelection();
        renderWorkQueueScopeControls({ replyBacklog: { scope: _workQueueReplyScope } });
        loadWorkQueue();
    }

    function setReplyConsoleFilter(type, value) {
        if (type === 'preset') {
            applyReplyConsolePreset(value);
            return;
        }

        _workQueueReplyFilters = normalizeReplyConsoleFilters({
            ..._workQueueReplyFilters,
            [type]: value,
            preset: 'all'
        });
        saveReplyConsoleFilters();
        _replyOpsFlash = null;
        _workQueueSelectedItemId = null;
        clearWorkQueueSelection();
        loadWorkQueue();
    }

    function applyReplyConsolePreset(preset) {
        const map = {
            all: { scope: 'all', sla: 'all', owner: 'all', escalation: 'all', preset: 'all' },
            mine_overdue: { scope: 'mine', sla: 'overdue', owner: 'all', escalation: 'all', preset: 'mine_overdue' },
            team_overdue: { scope: 'team', sla: 'overdue', owner: 'all', escalation: 'all', preset: 'team_overdue' },
            unassigned: { scope: 'all', sla: 'all', owner: 'without_owner', escalation: 'all', preset: 'unassigned' },
            escalated: { scope: 'all', sla: 'all', owner: 'all', escalation: 'escalated', preset: 'escalated' }
        };
        const next = map[preset] || map.all;
        _workQueueReplyScope = normalizeWorkQueueReplyScope(next.scope);
        localStorage.setItem('eg_reply_backlog_scope', _workQueueReplyScope);
        _workQueueReplyFilters = normalizeReplyConsoleFilters(next);
        saveReplyConsoleFilters();
        _replyOpsFlash = null;
        _workQueueSelectedItemId = null;
        clearWorkQueueSelection();
        loadWorkQueue();
    }

    function resetReplyConsoleFilters() {
        _workQueueReplyScope = 'all';
        localStorage.setItem('eg_reply_backlog_scope', _workQueueReplyScope);
        _workQueueReplyFilters = normalizeReplyConsoleFilters();
        saveReplyConsoleFilters();
        _replyOpsFlash = null;
        _workQueueSelectedItemId = null;
        clearWorkQueueSelection();
        loadWorkQueue();
    }

    function getSelectedReplyConversationIds() {
        const visible = new Set(_workQueueVisibleReplyIds);
        return [..._workQueueSelection].filter(id => visible.has(id));
    }

    function updateReplyOpsSelectionState() {
        const selected = getSelectedReplyConversationIds();
        const countEl = document.getElementById('replyOpsSelectionCount');
        if (countEl) countEl.textContent = `Обрано ${selected.length}`;
        document.querySelectorAll('[data-reply-bulk-action]').forEach(button => {
            button.disabled = selected.length === 0;
        });
    }

    function toggleReplySelection(conversationId, checked) {
        const id = Number(conversationId);
        if (!Number.isInteger(id) || id <= 0 || !_workQueueVisibleReplyIds.includes(id)) return;
        if (checked) _workQueueSelection.add(id);
        else _workQueueSelection.delete(id);
        updateReplyOpsSelectionState();
    }

    function selectVisibleReplyItems() {
        _workQueueVisibleReplyIds.forEach(id => _workQueueSelection.add(id));
        document.querySelectorAll('.work-queue-select input[type="checkbox"]').forEach(input => {
            input.checked = true;
        });
        updateReplyOpsSelectionState();
    }

    function setReplyOpsFeedback(message, tone = '') {
        _replyOpsFlash = message ? { message, tone } : null;
        const el = document.getElementById('replyOpsFeedback');
        if (!el) return;
        el.className = `reply-ops-feedback${tone ? ' ' + tone : ''}`;
        el.textContent = message || '';
    }

    function summarizeBulkResult(data) {
        const counts = data?.counts || {};
        const applied = Number(counts.applied || 0);
        const failed = Number(counts.failed || 0);
        if (failed > 0 && applied > 0) return `Частково виконано: ${applied} успішно, ${failed} з помилкою.`;
        if (failed > 0) return `Не вдалося виконати для ${failed} пунктів.`;
        return `Готово: оновлено ${applied} пунктів.`;
    }

    async function runReplyBulkAction(button, path, payload) {
        const token = localStorage.getItem('pzp_token');
        if (!token) throw new Error('Немає активної сесії');

        if (button) {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
        }
        setReplyOpsFeedback('Виконуємо масову дію...');
        try {
            const resp = await fetch(path, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
            setReplyOpsFeedback(summarizeBulkResult(data), data.success ? 'success' : 'warning');
            await loadWorkQueue();
            return data;
        } catch (err) {
            console.error('Reply backlog bulk action error:', err);
            setReplyOpsFeedback(err.message || 'Не вдалося виконати масову дію', 'error');
            notifyDashboardIssue(err.message || 'Не вдалося виконати масову дію');
            throw err;
        } finally {
            if (button) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
            }
            updateReplyOpsSelectionState();
        }
    }

    function bulkReassignReplyOwners(button) {
        const ids = getSelectedReplyConversationIds();
        if (!ids.length) return;
        const modal = ensureReplyOwnerPickerModal();
        _replyOwnerPickerState = {
            conversationIds: ids,
            currentOwnerUserId: null,
            trigger: button || null,
            users: []
        };
        modal.classList.remove('hidden');
        document.addEventListener('keydown', handleReplyOwnerPickerKeydown);
        loadReplyOwnerPickerUsers();
    }

    function bulkSnoozeReplySla(button) {
        const ids = getSelectedReplyConversationIds();
        if (!ids.length) return;
        return runReplyBulkAction(button, '/api/work-queue/replies/bulk/sla', {
            conversationIds: ids,
            snoozeHours: 24,
            sourceSurface: 'reply_operations_console_v2'
        });
    }

    async function bulkClearReplyExpectations(button) {
        const ids = getSelectedReplyConversationIds();
        if (!ids.length) return;
        if (!(await confirmDashboardAction(`Очистити очікування відповіді для ${ids.length} видимих item без позначки, що клієнти відповіли?`, {
            okText: 'Очистити',
            type: 'warning'
        }))) return;
        return runReplyBulkAction(button, '/api/work-queue/replies/bulk/clear', {
            conversationIds: ids,
            sourceSurface: 'reply_operations_console_v2'
        });
    }

    async function runReplyBacklogAction(button, path, method, payload, options = {}) {
        const token = localStorage.getItem('pzp_token');
        if (!token) throw new Error('Немає активної сесії');
        const previousItemId = options.previousItemId || _workQueueSelectedItemId || null;
        const actionLabel = options.actionLabel || 'Дію з відповіддю виконано.';

        if (button) {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
        }
        setExecutionFeedback('Виконуємо збережену дію з відповіддю...', '');
        renderTriageWorkspaceOnly(false);
        try {
            const resp = await fetch(path, {
                method,
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: payload ? JSON.stringify(payload) : undefined
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            await refetchQueueAfterDurableExecution(previousItemId, actionLabel);
            return data;
        } catch (err) {
            console.error('Reply backlog action error:', err);
            setExecutionFeedback(err.message || 'Не вдалося виконати дію з відповіддю; фокус черги не змінено.', 'error');
            renderTriageWorkspaceOnly(true);
            notifyDashboardIssue(err.message || 'Не вдалося оновити беклог відповідей');
            throw err;
        } finally {
            if (button) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
            }
        }
    }

    async function runTaskQueueAction(button, path, method, payload, options = {}) {
        const token = localStorage.getItem('pzp_token');
        if (!token) throw new Error('Немає активної сесії');
        const previousItemId = options.previousItemId || _workQueueSelectedItemId || null;
        const actionLabel = options.actionLabel || 'Дію по задачі виконано.';

        if (button) {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
        }
        setExecutionFeedback('Виконуємо збережену дію по задачі...', '');
        renderTriageWorkspaceOnly(false);
        try {
            const resp = await fetch(path, {
                method,
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: payload ? JSON.stringify(payload) : undefined
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            await refetchQueueAfterDurableExecution(previousItemId, actionLabel);
            return data;
        } catch (err) {
            console.error('Task queue action error:', err);
            setExecutionFeedback(err.message || 'Не вдалося виконати дію по задачі; фокус черги не змінено.', 'error');
            renderTriageWorkspaceOnly(true);
            notifyDashboardIssue(err.message || 'Не вдалося оновити задачу');
            throw err;
        } finally {
            if (button) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
            }
        }
    }

    async function runBookingQueueAction(button, path, payload, options = {}) {
        const token = localStorage.getItem('pzp_token');
        if (!token) throw new Error('Немає активної сесії');
        const previousItemId = options.previousItemId || _workQueueSelectedItemId || null;
        const actionLabel = options.actionLabel || 'Підтвердження бронювання виконано.';

        if (button) {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
        }
        setExecutionFeedback('Виконуємо підтвердження бронювання...', '');
        renderTriageWorkspaceOnly(false);
        try {
            const resp = await fetch(path, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload || {})
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            await refetchQueueAfterDurableExecution(previousItemId, actionLabel);
            return data;
        } catch (err) {
            console.error('Booking queue action error:', err);
            setExecutionFeedback(err.message || 'Не вдалося підтвердити бронювання; фокус черги не змінено.', 'error');
            renderTriageWorkspaceOnly(true);
            notifyDashboardIssue(err.message || 'Не вдалося підтвердити бронювання');
            throw err;
        } finally {
            if (button) {
                button.disabled = false;
                button.removeAttribute('aria-busy');
            }
        }
    }

    async function confirmQueueBooking(bookingId, button) {
        const id = String(bookingId || '').trim();
        if (!id) return;
        if (!(await confirmDashboardAction('Підтвердити попереднє бронювання?', {
            okText: 'Підтвердити',
            type: 'success'
        }))) return;
        return runBookingQueueAction(
            button,
            `/api/bookings/${encodeURIComponent(id)}/confirm`,
            { source: 'queue' },
            {
                previousItemId: _workQueueSelectedItemId || `booking:needs_confirmation:${id}`,
                actionLabel: 'Бронювання підтверджено через вузький confirmation contract.'
            }
        );
    }

    async function completeQueueTask(taskId, button) {
        if (!(await confirmDashboardAction('Позначити задачу виконаною?', {
            okText: 'Позначити',
            type: 'success'
        }))) return;
        return runTaskQueueAction(
            button,
            `/api/work-queue/tasks/${encodeURIComponent(taskId)}/done`,
            'POST',
            { sourceSurface: 'manager_queue_task_execution_v2' },
            {
                previousItemId: _workQueueSelectedItemId || `task:overdue:${taskId}`,
                actionLabel: 'Задачу виконано через канонічне поле tasks.status.'
            }
        );
    }

    function rescheduleQueueTask(taskId, button) {
        return runTaskQueueAction(
            button,
            `/api/work-queue/tasks/${encodeURIComponent(taskId)}/deadline`,
            'PATCH',
            { snoozeHours: 24, sourceSurface: 'manager_queue_task_execution_v2' },
            {
                previousItemId: _workQueueSelectedItemId || `task:overdue:${taskId}`,
                actionLabel: 'Дедлайн задачі перенесено на 24 години через tasks.deadline.'
            }
        );
    }

    function ensureTaskOwnerPickerModal() {
        let modal = document.getElementById('taskOwnerPickerModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'taskOwnerPickerModal';
        modal.className = 'reply-owner-picker hidden';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'taskOwnerPickerTitle');
        modal.innerHTML = `
            <div class="reply-owner-picker-backdrop" onclick="DashboardPage.closeTaskOwnerPicker()"></div>
            <div class="reply-owner-picker-card">
                <div class="reply-owner-picker-head">
                    <div>
                        <h3 id="taskOwnerPickerTitle">Змінити відповідального задачі</h3>
                        <p id="taskOwnerPickerHint">Оберіть активного користувача, якого можна призначити. Збережеться users.id.</p>
                    </div>
                    <button type="button" class="reply-owner-picker-close" aria-label="Закрити" onclick="DashboardPage.closeTaskOwnerPicker()">×</button>
                </div>
                <div id="taskOwnerPickerBody" class="reply-owner-picker-body"></div>
                <div class="reply-owner-picker-actions">
                    <button type="button" class="reply-owner-picker-secondary" onclick="DashboardPage.closeTaskOwnerPicker()">Скасувати</button>
                    <button type="button" id="taskOwnerPickerSave" class="reply-owner-picker-primary" onclick="DashboardPage.saveTaskOwnerPicker(this)" disabled>Зберегти</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    function setTaskOwnerPickerBody(html, canSave = false) {
        const body = document.getElementById('taskOwnerPickerBody');
        const save = document.getElementById('taskOwnerPickerSave');
        if (body) body.innerHTML = html;
        if (save) save.disabled = !canSave;
    }

    function renderTaskOwnerPickerUsers(users, currentOwnerUserId) {
        const candidates = (users || []).map(user => ({ ...user, id: Number(user.id) })).filter(user => user.id > 0);
        if (!candidates.length) {
            setTaskOwnerPickerBody('<div class="reply-owner-picker-state">Немає активних користувачів для призначення.</div>', false);
            return;
        }
        const currentId = Number(currentOwnerUserId || 0);
        const options = candidates.map(user => {
            const label = user.label || user.name || user.username || `User #${user.id}`;
            const role = user.role ? ` · ${user.role}` : '';
            return `<option value="${user.id}"${user.id === currentId ? ' selected' : ''}>${escapeHtml(`${label}${role}`)}</option>`;
        }).join('');
        setTaskOwnerPickerBody(`
            <label class="reply-owner-picker-label" for="taskOwnerPickerSelect">Відповідальний задачі</label>
            <select id="taskOwnerPickerSelect" class="reply-owner-picker-select" aria-describedby="taskOwnerPickerHint">${options}</select>
        `, true);
        const select = document.getElementById('taskOwnerPickerSelect');
        if (_taskOwnerPickerState) _taskOwnerPickerState.initialSelectedOwnerUserId = Number(select?.value || 0);
        const modal = document.getElementById('taskOwnerPickerModal');
        if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
        window.setTimeout(() => select?.focus(), 0);
    }

    async function loadTaskOwnerPickerUsers() {
        if (!_taskOwnerPickerState) return;
        setTaskOwnerPickerBody('<div class="reply-owner-picker-state">Завантаження відповідальних...</div>', false);
        try {
            const token = localStorage.getItem('pzp_token');
            if (!token) throw new Error('Немає активної сесії');
            const resp = await fetch('/api/work-queue/task-owners', { headers: { 'Authorization': 'Bearer ' + token } });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) throw new Error(data.error || `HTTP ${resp.status}`);
            _taskOwnerPickerState.users = Array.isArray(data.users) ? data.users : [];
            renderTaskOwnerPickerUsers(_taskOwnerPickerState.users, _taskOwnerPickerState.currentOwnerUserId);
        } catch (err) {
            console.error('Task owner picker error:', err);
            setTaskOwnerPickerBody(`
                <div class="reply-owner-picker-state error">${escapeHtml(err.message || 'Не вдалося завантажити відповідальних')}</div>
                <button type="button" class="reply-owner-picker-retry" onclick="DashboardPage.reloadTaskOwnerPicker()">Повторити</button>
            `, false);
        }
    }

    function handleTaskOwnerPickerKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeTaskOwnerPicker(false);
        }
    }

    function reassignQueueTaskOwner(taskId, button, currentOwnerUserId = null) {
        const id = Number(taskId);
        if (!Number.isInteger(id) || id <= 0) return;
        const modal = ensureTaskOwnerPickerModal();
        _taskOwnerPickerState = {
            taskId: id,
            currentOwnerUserId: Number(currentOwnerUserId || 0),
            trigger: button || null,
            users: []
        };
        modal.classList.remove('hidden');
        document.addEventListener('keydown', handleTaskOwnerPickerKeydown);
        loadTaskOwnerPickerUsers();
    }

    function reloadTaskOwnerPicker() {
        loadTaskOwnerPickerUsers();
    }

    function isTaskOwnerPickerDirty() {
        const select = document.getElementById('taskOwnerPickerSelect');
        if (!_taskOwnerPickerState || !select) return false;
        return Number(select.value || 0) !== Number(_taskOwnerPickerState.initialSelectedOwnerUserId || 0);
    }

    async function closeTaskOwnerPicker(force = false) {
        const modal = document.getElementById('taskOwnerPickerModal');
        const trigger = _taskOwnerPickerState?.trigger;
        const closeNow = () => {
            if (modal) modal.classList.add('hidden');
            document.removeEventListener('keydown', handleTaskOwnerPickerKeydown);
            _taskOwnerPickerState = null;
            if (trigger && typeof trigger.focus === 'function') window.setTimeout(() => trigger.focus(), 0);
        };
        if (window.UnsafeDismissGuard && modal) {
            return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
                force,
                isDirty: isTaskOwnerPickerDirty,
                message: 'Є незбережений вибір відповідального задачі. Закрити без збереження?',
                okText: 'Закрити без збереження',
                cancelText: 'Повернутись'
            });
        }
        if (!force && isTaskOwnerPickerDirty() && typeof confirmModal === 'function') {
            const confirmed = await confirmModal('Є незбережений вибір відповідального задачі. Закрити без збереження?', {
                type: 'warning',
                okText: 'Закрити без збереження',
                cancelText: 'Повернутись'
            });
            if (!confirmed) return false;
        }
        closeNow();
        return true;
    }

    async function saveTaskOwnerPicker(button) {
        const state = _taskOwnerPickerState;
        const select = document.getElementById('taskOwnerPickerSelect');
        const ownerUserId = Number(select?.value);
        const knownIds = new Set((state?.users || []).map(user => Number(user.id)).filter(id => Number.isInteger(id) && id > 0));
        if (!state || !Number.isInteger(ownerUserId) || ownerUserId <= 0 || !knownIds.has(ownerUserId)) {
            setTaskOwnerPickerBody('<div class="reply-owner-picker-state error">Оберіть користувача зі списку.</div>', false);
            return;
        }
        await runTaskQueueAction(
            button,
            `/api/work-queue/tasks/${encodeURIComponent(state.taskId)}/owner`,
            'PATCH',
            { ownerUserId, sourceSurface: 'manager_queue_task_execution_v2' },
            {
                previousItemId: _workQueueSelectedItemId || `task:overdue:${state.taskId}`,
                actionLabel: 'Відповідального задачі змінено через канонічне поле tasks.owner_user_id.'
            }
        );
        await closeTaskOwnerPicker(true);
    }

    function ensureReplyOwnerPickerModal() {
        let modal = document.getElementById('replyOwnerPickerModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'replyOwnerPickerModal';
        modal.className = 'reply-owner-picker hidden';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'replyOwnerPickerTitle');
        modal.innerHTML = `
            <div class="reply-owner-picker-backdrop" onclick="DashboardPage.closeReplyOwnerPicker()"></div>
            <div class="reply-owner-picker-card">
                <div class="reply-owner-picker-head">
                    <div>
                        <h3 id="replyOwnerPickerTitle">Змінити відповідального</h3>
                        <p id="replyOwnerPickerHint">Оберіть активного користувача з правом призначення. Збережеться user id.</p>
                    </div>
                    <button type="button" class="reply-owner-picker-close" aria-label="Закрити" onclick="DashboardPage.closeReplyOwnerPicker()">×</button>
                </div>
                <div id="replyOwnerPickerBody" class="reply-owner-picker-body"></div>
                <div class="reply-owner-picker-actions">
                    <button type="button" class="reply-owner-picker-secondary" onclick="DashboardPage.closeReplyOwnerPicker()">Скасувати</button>
                    <button type="button" id="replyOwnerPickerSave" class="reply-owner-picker-primary" onclick="DashboardPage.saveReplyOwnerPicker(this)" disabled>Зберегти</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    function setReplyOwnerPickerBody(html, canSave = false) {
        const body = document.getElementById('replyOwnerPickerBody');
        const save = document.getElementById('replyOwnerPickerSave');
        if (body) body.innerHTML = html;
        if (save) save.disabled = !canSave;
    }

    function renderReplyOwnerPickerLoading() {
        setReplyOwnerPickerBody('<div class="reply-owner-picker-state">Завантаження відповідальних...</div>', false);
    }

    function renderReplyOwnerPickerError(message) {
        setReplyOwnerPickerBody(`
            <div class="reply-owner-picker-state error">${escapeHtml(message || 'Не вдалося завантажити відповідальних')}</div>
            <button type="button" class="reply-owner-picker-retry" onclick="DashboardPage.reloadReplyOwnerPicker()">Повторити</button>
        `, false);
    }

    function renderReplyOwnerPickerUsers(users, currentOwnerUserId) {
        const candidates = (users || [])
            .map(user => ({ ...user, id: Number(user.id) }))
            .filter(user => Number.isInteger(user.id) && user.id > 0);

        if (!candidates.length) {
            setReplyOwnerPickerBody('<div class="reply-owner-picker-state">Немає активних користувачів для призначення.</div>', false);
            return;
        }

        const currentId = Number(currentOwnerUserId || 0);
        const options = candidates.map(user => {
            const label = user.label || user.name || user.username || `User #${user.id}`;
            const role = user.role ? ` · ${user.role}` : '';
            const selected = user.id === currentId ? ' selected' : '';
            return `<option value="${user.id}"${selected}>${escapeHtml(`${label}${role}`)}</option>`;
        }).join('');

        setReplyOwnerPickerBody(`
            <label class="reply-owner-picker-label" for="replyOwnerPickerSelect">Відповідальний</label>
            <select id="replyOwnerPickerSelect" class="reply-owner-picker-select" aria-describedby="replyOwnerPickerHint">
                ${options}
            </select>
        `, true);

        const select = document.getElementById('replyOwnerPickerSelect');
        if (_replyOwnerPickerState) _replyOwnerPickerState.initialSelectedOwnerUserId = Number(select?.value || 0);
        const modal = document.getElementById('replyOwnerPickerModal');
        if (window.UnsafeDismissGuard && modal) window.UnsafeDismissGuard.remember(modal);
        window.setTimeout(() => {
            if (select) select.focus();
        }, 0);
    }

    async function loadReplyOwnerPickerUsers() {
        if (!_replyOwnerPickerState) return;
        renderReplyOwnerPickerLoading();

        try {
            const token = localStorage.getItem('pzp_token');
            if (!token) throw new Error('Немає активної сесії');
            const resp = await fetch('/api/work-queue/reply-owners', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data.success === false) {
                throw new Error(data.error || `HTTP ${resp.status}`);
            }
            const users = Array.isArray(data.users) ? data.users : [];
            _replyOwnerPickerState.users = users;
            renderReplyOwnerPickerUsers(users, _replyOwnerPickerState.currentOwnerUserId);
        } catch (err) {
            console.error('Reply owner picker error:', err);
            if (_replyOwnerPickerState) _replyOwnerPickerState.users = [];
            renderReplyOwnerPickerError(err.message);
        }
    }

    function handleReplyOwnerPickerKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeReplyOwnerPicker(false);
        }
    }

    function reassignReplyOwner(conversationId, button, currentOwnerUserId = null) {
        const id = Number(conversationId);
        if (!Number.isInteger(id) || id <= 0) return;

        const modal = ensureReplyOwnerPickerModal();
        _replyOwnerPickerState = {
            conversationId: id,
            currentOwnerUserId: Number(currentOwnerUserId || 0),
            trigger: button || null,
            users: []
        };
        modal.classList.remove('hidden');
        document.addEventListener('keydown', handleReplyOwnerPickerKeydown);
        loadReplyOwnerPickerUsers();
    }

    function reloadReplyOwnerPicker() {
        loadReplyOwnerPickerUsers();
    }

    function isReplyOwnerPickerDirty() {
        const select = document.getElementById('replyOwnerPickerSelect');
        if (!_replyOwnerPickerState || !select) return false;
        return Number(select.value || 0) !== Number(_replyOwnerPickerState.initialSelectedOwnerUserId || 0);
    }

    async function closeReplyOwnerPicker(force = false) {
        const modal = document.getElementById('replyOwnerPickerModal');
        const trigger = _replyOwnerPickerState?.trigger;
        const closeNow = () => {
            if (modal) modal.classList.add('hidden');
            document.removeEventListener('keydown', handleReplyOwnerPickerKeydown);
            _replyOwnerPickerState = null;
            if (trigger && typeof trigger.focus === 'function') {
                window.setTimeout(() => trigger.focus(), 0);
            }
        };
        if (window.UnsafeDismissGuard && modal) {
            return window.UnsafeDismissGuard.attemptCloseEditableSurface(modal, closeNow, {
                force,
                isDirty: isReplyOwnerPickerDirty,
                message: 'Є незбережений вибір відповідального reply. Закрити без збереження?',
                okText: 'Закрити без збереження',
                cancelText: 'Повернутись'
            });
        }
        if (!force && isReplyOwnerPickerDirty() && typeof confirmModal === 'function') {
            const confirmed = await confirmModal('Є незбережений вибір відповідального reply. Закрити без збереження?', {
                type: 'warning',
                okText: 'Закрити без збереження',
                cancelText: 'Повернутись'
            });
            if (!confirmed) return false;
        }
        closeNow();
        return true;
    }

    async function saveReplyOwnerPicker(button) {
        const state = _replyOwnerPickerState;
        const select = document.getElementById('replyOwnerPickerSelect');
        const ownerUserId = Number(select?.value);
        const knownIds = new Set((state?.users || []).map(user => Number(user.id)).filter(id => Number.isInteger(id) && id > 0));

        if (!state || !Number.isInteger(ownerUserId) || ownerUserId <= 0 || !knownIds.has(ownerUserId)) {
            renderReplyOwnerPickerError('Оберіть користувача зі списку відповідальних.');
            return;
        }

        if (Array.isArray(state.conversationIds) && state.conversationIds.length) {
            await runReplyBulkAction(
                button,
                '/api/work-queue/replies/bulk/owner',
                { conversationIds: state.conversationIds, ownerUserId, sourceSurface: 'reply_operations_console_v2' }
            );
        } else {
            await runReplyBacklogAction(
                button,
                `/api/work-queue/replies/${encodeURIComponent(state.conversationId)}/owner`,
                'PATCH',
                { ownerUserId, sourceSurface: 'manager_queue_execution_v6' },
                {
                    previousItemId: `waiting_reply:conversation:${state.conversationId}`,
                    actionLabel: 'Відповідального за відповідь змінено через reply_owner_user_id.'
                }
            );
        }
        await closeReplyOwnerPicker(true);
    }

    function snoozeReplySla(conversationId, button) {
        return runReplyBacklogAction(
            button,
            `/api/work-queue/replies/${encodeURIComponent(conversationId)}/sla`,
            'PATCH',
            { snoozeHours: 24, sourceSurface: 'manager_queue_execution_v6' },
            {
                previousItemId: `waiting_reply:conversation:${conversationId}`,
                actionLabel: 'SLA відповіді перенесено на 24 години через reply_sla_at.'
            }
        );
    }

    async function clearReplyExpectation(conversationId, button) {
        if (!(await confirmDashboardAction('Очистити очікування відповіді без позначки, що клієнт відповів?', {
            okText: 'Очистити',
            type: 'warning'
        }))) return;
        return runReplyBacklogAction(
            button,
            `/api/work-queue/replies/${encodeURIComponent(conversationId)}/clear`,
            'POST',
            { sourceSurface: 'manager_queue_execution_v6' },
            {
                previousItemId: `waiting_reply:conversation:${conversationId}`,
                actionLabel: 'Очікування відповіді очищено без позначки, що клієнт відповів.'
            }
        );
    }

    function escalateReplyExpectation(conversationId, button) {
        return runReplyBacklogAction(
            button,
            `/api/work-queue/replies/${encodeURIComponent(conversationId)}/escalate`,
            'POST',
            { sourceSurface: 'manager_queue_execution_v6' },
            {
                previousItemId: `waiting_reply:conversation:${conversationId}`,
                actionLabel: 'Задачу ескалації простроченої відповіді створено або перевикористано через conversation_reply.'
            }
        );
    }

    function refreshWidget(type) {
        loadWidgetData(type);
    }

    // Helpers
    function formatCurrency(amount) {
        if (amount >= 1000) return Math.round(amount / 1000) + 'k';
        return Math.round(amount) + '';
    }

    function formatDeadline(dateStr) {
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = d - now;
        const diffHours = Math.round(diffMs / 3600000);

        if (diffHours < 0) return 'Протерм.';
        if (diffHours < 1) return `${Math.round(diffMs / 60000)} хв`;
        if (diffHours < 24) return `${diffHours} год`;
        return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function assistantOutputFormatter() {
        return window.CrmAssistantOutputFormat || null;
    }

    function assistantDisplayText(value) {
        const formatter = assistantOutputFormatter();
        if (formatter?.toDisplayText) return formatter.toDisplayText(value);
        return String(value ?? '').replace(/\*\*([^\n]+?)\*\*/g, '$1').trim();
    }

    function renderAssistantInlineOutput(value) {
        const formatter = assistantOutputFormatter();
        if (formatter?.formatInline) return formatter.formatInline(value);
        return escapeHtml(value);
    }

    function renderAssistantHistoryBody(role, value) {
        if (role === 'user') return `<p>${escapeHtml(value)}</p>`;
        const formatter = assistantOutputFormatter();
        if (formatter?.formatReadable) {
            const html = formatter.formatReadable(value);
            if (html) return html;
        }
        return `<p>${escapeHtml(value)}</p>`;
    }

    function escapeJsString(str) {
        return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
    }

    window.addEventListener('rolePreviewChanged', () => {
        if (!_config) return;
        renderWidgets();
        updateDashboardRolePreviewControl();
        announceDashboardContextToAssistant();
    });

    return {
        init,
        refreshWorkQueue,
        setWorkQueueReplyScope,
        setReplyConsoleFilter,
        resetReplyConsoleFilters,
        toggleReplySelection,
        selectVisibleReplyItems,
        clearWorkQueueSelection,
        bulkReassignReplyOwners,
        bulkSnoozeReplySla,
        bulkClearReplyExpectations,
        selectTriageItem,
        nextTriageItem,
        previousTriageItem,
        clearTriageSelection,
        reassignReplyOwner,
        reloadReplyOwnerPicker,
        reloadReplyActionHistory: loadReplyActionHistoryForSelected,
        reloadTaskActionHistory: loadTaskActionHistoryForSelected,
        closeReplyOwnerPicker,
        saveReplyOwnerPicker,
        reassignQueueTaskOwner,
        reloadTaskOwnerPicker,
        closeTaskOwnerPicker,
        saveTaskOwnerPicker,
        completeQueueTask,
        rescheduleQueueTask,
        confirmQueueBooking,
        snoozeReplySla,
        clearReplyExpectation,
        escalateReplyExpectation,
        refreshWidget,
        setTeamOnlineHistory,
        setDashboardMode,
        setDashboardRolePreview,
        toggleRolePreviewMenu,
        handleRolePreviewMenuClick,
        setDashboardSceneOption,
        setBoardWorkspaceMode,
        setBoardInteractionMode,
        setBoardTool,
        setBoardPreference,
        setBoardSnapMode,
        runBoardCreateAction,
        addBoardNote,
        addBoardNoteToZone,
        saveWritingZone,
        addBoardText,
        addBoardFrame,
        addBoardSpace,
        reserveBoardZone,
        addSelectedBoardWidget,
        addBoardWidget,
        addBoardWidgetToZone,
        addBoardWidgetByType,
        addBoardShape,
        seedBoardWidgets,
        saveBoardNow,
        duplicateBoardItem,
        deleteBoardItem,
        changeBoardItemZ,
        toggleBoardItemLock,
        toggleBoardItemHidden,
        setBoardWidgetDepth,
        enterBoardWidgetInspect,
        enterBoardObjectEditing,
        exitBoardObjectEditing,
        handleBoardAnchor,
        updateBoardConnector,
        deleteBoardConnector,
        setBoardConnectorPreference,
        runBoardAiAction,
        undoBoard,
        redoBoard,
        clearBoardContent,
        resetBoardView,
        resetBoardState,
        setPersonalTaskerView,
        openPersonalTaskerFullscreen,
        closePersonalTaskerFullscreen,
        openTask,
        toggleOnboardingWidget,
        saveOnboarding,
        openWidgetManager,
        openSettings,
        closeSettingsOverlay,
        toggleSettingsWidget,
        saveSettings,
        switchTestRole,
        resetTestRole,
        switchTestUser,
        setAssistantRailState,
        toggleAssistantVoice,
        replayAssistantLine,
        expandAssistantRail,
        toggleAssistantListening,
        closeDashboardAssistantPanel,
        runAssistantQuickPrompt,
        submitAssistantPrompt,
        getAssistantContext,
        demoAssistantSpeak,
    };
})();

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    DashboardPage.init();
});
