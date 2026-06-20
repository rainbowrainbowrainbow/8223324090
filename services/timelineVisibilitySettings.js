'use strict';

const { normalizeTimelineContext } = require('./timelineContext');

const TIMELINE_VISUAL_VARIABLES = Object.freeze([
  'visible',
  'order',
  'density',
  'emphasis',
  'customLabel',
  'adminNote',
]);
const TIMELINE_VISUAL_DENSITIES = new Set(['default', 'compact', 'comfortable']);
const TIMELINE_VISUAL_EMPHASIS = new Set(['normal', 'muted', 'accent']);
const TIMELINE_VISIBILITY_VIEWS = new Set(['animators', 'rooms']);

function normalizeTimelineVisibilityView(value, fallback = null) {
  const raw = String(value || '').trim().toLowerCase();
  if (TIMELINE_VISIBILITY_VIEWS.has(raw)) return raw;
  return fallback;
}

function visualBlock(id, area, title, options = {}) {
  return Object.freeze({
    id,
    area,
    title,
    description: options.description || `${title} controls the ${area.toLowerCase()} visual surface on this timeline.`,
    howToUse: options.howToUse || 'Change only the visual presentation here. Booking data, permissions, and API behavior stay unchanged.',
    impact: options.impact || 'Affects only how this timeline surface is displayed for the active business context.',
    defaultVisible: options.defaultVisible !== false,
    variables: [...TIMELINE_VISUAL_VARIABLES],
  });
}

const TIMELINE_VISUAL_BLOCKS = Object.freeze([
  visualBlock('dateControls', 'Верхня панель', 'Дата і навігація', {
    description: 'Перемикання дня, кнопка сьогодні та календарний фокус таймлайну.',
    impact: 'Якщо сховати, оператору складніше швидко перейти на іншу дату.',
  }),
  visualBlock('statusFilters', 'Верхня панель', 'Фільтри статусів', {
    description: 'Кнопки фільтрації бронювань за робочим статусом.',
    impact: 'Приховування не змінює самі бронювання, але забирає швидке очищення/фокус статусів.',
  }),
  visualBlock('viewModes', 'Верхня панель', 'День / тиждень'),
  visualBlock('zoomControls', 'Верхня панель', 'Масштаб 15/30/60 хв'),
  visualBlock('compactToggle', 'Верхня панель', 'Компактний режим'),
  visualBlock('undo', 'Верхня панель', 'Скасувати дію'),
  visualBlock('roomLoad', 'Верхня панель', 'Кімнати / кабінети'),
  visualBlock('productSales', 'Верхня панель', 'Продажі'),
  visualBlock('export', 'Верхня панель', 'Експорт'),
  visualBlock('actionMenu', 'Верхня панель', 'Меню дій'),
  visualBlock('history', 'Верхня панель', 'Історія змін'),
  visualBlock('digest', 'Меню дій', 'Дайджест дня'),
  visualBlock('quickStats', 'Робоча зона', 'Швидка статистика'),
  visualBlock('assistantWidget', 'Робоча зона', 'Помічник'),
  visualBlock('warnings', 'Робоча зона', 'Попередження'),
  visualBlock('timelineScale', 'Таймлайн', 'Шкала часу'),
  visualBlock('timelineGrid', 'Таймлайн', 'Сітка таймлайну', {
    description: 'Головна сітка з рядками, часовою шкалою і картками бронювань.',
    impact: 'Приховування сітки фактично робить сторінку оглядовою, без робочої дошки розкладу.',
  }),
  visualBlock('addLine', 'Таймлайн', 'Додати лінію / спеціаліста'),
  visualBlock('legend', 'Таймлайн', 'Легенда'),
  visualBlock('minimap', 'Таймлайн', 'Мінімапа'),
  visualBlock('roomLoadPanel', 'Таймлайн', 'Панель навантаження кімнат'),
  visualBlock('bookingPanel', 'Форма бронювання', 'Панель бронювання'),
  visualBlock('bookingClose', 'Форма бронювання', 'Закрити панель бронювання'),
  visualBlock('bookingSelectedInfo', 'Форма бронювання', 'Обрані дата / час / лінія'),
  visualBlock('bookingRoom', 'Форма бронювання', 'Кімната'),
  visualBlock('freeRooms', 'Форма бронювання', 'Вільні кімнати'),
  visualBlock('freeRoomsPanel', 'Форма бронювання', 'Панель вільних кімнат'),
  visualBlock('costume', 'Форма бронювання', 'Костюм'),
  visualBlock('extraHost', 'Форма бронювання', 'Додатковий ведучий'),
  visualBlock('secondAnimator', 'Форма бронювання', 'Другий аніматор'),
  visualBlock('hostsWarning', 'Форма бронювання', 'Попередження про ведучих'),
  visualBlock('notes', 'Форма бронювання', 'Коментар бронювання'),
  visualBlock('groupName', 'Форма бронювання', 'Назва заявки / група (legacy)'),
  visualBlock('customerToggle', 'Форма бронювання', 'Перемикач даних клієнта'),
  visualBlock('customerData', 'Форма бронювання', 'Дані клієнта'),
  visualBlock('customerSearch', 'Форма бронювання', 'Пошук клієнта'),
  visualBlock('customerFields', 'Форма бронювання', 'Поля клієнта'),
  visualBlock('customerInfo', 'Форма бронювання', 'Інфо про клієнта'),
  visualBlock('programSearch', 'Форма бронювання', 'Пошук програми / консультації'),
  visualBlock('programs', 'Форма бронювання', 'Картки програм / консультацій'),
  visualBlock('programDetails', 'Форма бронювання', 'Деталі програми'),
  visualBlock('customProgram', 'Форма бронювання', 'Кастомна програма'),
  visualBlock('customProgramFields', 'Форма бронювання', 'Поля кастомної позиції'),
  visualBlock('pinata', 'Форма бронювання', 'Піньята'),
  visualBlock('kidsCount', 'Форма бронювання', 'Кількість дітей'),
  visualBlock('tshirtSizes', 'Форма бронювання', 'Розміри футболок'),
  visualBlock('bookingStatus', 'Форма бронювання', 'Статус бронювання'),
  visualBlock('bookingSubmit', 'Форма бронювання', 'Кнопка збереження бронювання'),
]);

const TIMELINE_VISUAL_BLOCK_IDS = new Set(TIMELINE_VISUAL_BLOCKS.map(block => block.id));

function timelineVisibilityId(context) {
  return `timeline:${normalizeTimelineContext(context)}`;
}

function safeText(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function safeOrder(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(-999, Math.min(999, Math.round(n)));
}

function sanitizeTimelineVisibilityBlocks(rawBlocks = {}) {
  const source = rawBlocks && typeof rawBlocks === 'object' && !Array.isArray(rawBlocks) ? rawBlocks : {};
  const blocks = {};
  for (const [id, rawValue] of Object.entries(source)) {
    if (!TIMELINE_VISUAL_BLOCK_IDS.has(id)) continue;
    const raw = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) ? rawValue : {};
    const block = {};
    if (Object.prototype.hasOwnProperty.call(raw, 'visible')) block.visible = raw.visible !== false;
    if (Object.prototype.hasOwnProperty.call(raw, 'order')) {
      const order = safeOrder(raw.order);
      if (order !== undefined) block.order = order;
    }
    if (TIMELINE_VISUAL_DENSITIES.has(String(raw.density || ''))) block.density = String(raw.density);
    if (TIMELINE_VISUAL_EMPHASIS.has(String(raw.emphasis || ''))) block.emphasis = String(raw.emphasis);
    if (Object.prototype.hasOwnProperty.call(raw, 'customLabel')) block.customLabel = safeText(raw.customLabel, 80);
    if (Object.prototype.hasOwnProperty.call(raw, 'adminNote')) block.adminNote = safeText(raw.adminNote, 280);
    if (Object.keys(block).length) blocks[id] = block;
  }
  return blocks;
}

function sanitizeTimelineVisibilityOverrides(rawOverrides = {}) {
  const source = rawOverrides && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides) ? rawOverrides : {};
  const overrides = {};
  for (const [id, value] of Object.entries(source)) {
    if (!TIMELINE_VISUAL_BLOCK_IDS.has(id)) continue;
    overrides[id] = Boolean(value);
  }
  return overrides;
}

function deriveOverridesFromBlocks(blocks = {}) {
  const overrides = {};
  for (const [id, block] of Object.entries(blocks || {})) {
    if (!TIMELINE_VISUAL_BLOCK_IDS.has(id)) continue;
    if (Object.prototype.hasOwnProperty.call(block || {}, 'visible')) {
      overrides[id] = block.visible === false;
    }
  }
  return overrides;
}

function sanitizeTimelineVisibilityState(rawState = {}) {
  const source = rawState && typeof rawState === 'object' && !Array.isArray(rawState) ? rawState : {};
  const blocks = sanitizeTimelineVisibilityBlocks(source.blocks || {});
  const legacyOverrides = sanitizeTimelineVisibilityOverrides(source.overrides || {});
  for (const [id, hidden] of Object.entries(legacyOverrides)) {
    if (!Object.prototype.hasOwnProperty.call(blocks, id)) blocks[id] = { visible: !hidden };
  }
  return {
    blocks,
    overrides: {
      ...legacyOverrides,
      ...deriveOverridesFromBlocks(blocks),
    },
    updatedAt: source.updatedAt || null,
    updatedBy: source.updatedBy || null,
  };
}

function sanitizeTimelineVisibilityViews(rawViews = {}) {
  const source = rawViews && typeof rawViews === 'object' && !Array.isArray(rawViews) ? rawViews : {};
  const views = {};
  for (const view of TIMELINE_VISIBILITY_VIEWS) {
    if (!Object.prototype.hasOwnProperty.call(source, view)) continue;
    views[view] = sanitizeTimelineVisibilityState(source[view]);
  }
  return views;
}

function sanitizeTimelineVisibilityPayload(body = {}, context) {
  const blocks = sanitizeTimelineVisibilityBlocks(body.blocks || {});
  const overrides = {
    ...sanitizeTimelineVisibilityOverrides(body.overrides || {}),
    ...deriveOverridesFromBlocks(blocks),
  };
  return {
    version: 2,
    timelineId: timelineVisibilityId(context),
    blocks,
    overrides,
  };
}

function mergeTimelineVisibilityPayload(existing = {}, body = {}, context, options = {}) {
  const now = options.updatedAt || new Date().toISOString();
  const updatedBy = options.updatedBy || null;
  const view = normalizeTimelineVisibilityView(options.view || body.view || body.timelineView || body.timeline_view, null);
  const incoming = sanitizeTimelineVisibilityPayload(body, context);
  const base = sanitizeTimelineVisibilityState(existing || {});
  const views = sanitizeTimelineVisibilityViews(existing?.views || {});
  const next = {
    version: 2,
    timelineId: timelineVisibilityId(context),
    context: normalizeTimelineContext(context),
    blocks: incoming.blocks,
    overrides: incoming.overrides,
    views,
    updatedAt: now,
    updatedBy,
  };

  if (!view || view === 'animators') {
    next.views.animators = {
      blocks: incoming.blocks,
      overrides: incoming.overrides,
      updatedAt: now,
      updatedBy,
    };
    return next;
  }

  next.blocks = base.blocks;
  next.overrides = base.overrides;
  next.views[view] = {
    blocks: incoming.blocks,
    overrides: incoming.overrides,
    updatedAt: now,
    updatedBy,
  };
  return next;
}

function timelineVisibilityResponse(value = {}, context, options = {}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const view = normalizeTimelineVisibilityView(options.view || raw.view || raw.timelineView || raw.timeline_view, 'animators');
  const base = sanitizeTimelineVisibilityState(raw);
  const views = sanitizeTimelineVisibilityViews(raw.views || {});
  const active = views[view] || base;
  return {
    context: normalizeTimelineContext(context),
    timelineId: timelineVisibilityId(context),
    view,
    version: 2,
    registry: TIMELINE_VISUAL_BLOCKS,
    blocks: active.blocks,
    overrides: active.overrides,
    views,
    updatedAt: active.updatedAt || raw.updatedAt || null,
    updatedBy: active.updatedBy || raw.updatedBy || null,
  };
}

module.exports = {
  TIMELINE_VISUAL_BLOCKS,
  TIMELINE_VISUAL_VARIABLES,
  mergeTimelineVisibilityPayload,
  normalizeTimelineVisibilityView,
  sanitizeTimelineVisibilityPayload,
  timelineVisibilityId,
  timelineVisibilityResponse,
};
