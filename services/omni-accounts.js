/**
 * services/omni-accounts.js — canonical Omni account connectivity truth.
 *
 * This layer intentionally reads backend configuration only. Browser code must
 * never infer provider readiness from public JS or expose provider secrets.
 */

const CHANNELS = [
  {
    channel: 'telegram',
    label: 'Telegram',
    envKeys: ['TELEGRAM_BOT_TOKEN'],
    accountEnvKeys: ['TELEGRAM_BOT_USERNAME', 'TELEGRAM_DEFAULT_CHAT_ID'],
    warning: 'Telegram bot token is not configured',
  },
  {
    channel: 'viber',
    label: 'Viber',
    envKeys: ['VIBER_TOKEN'],
    accountEnvKeys: ['VIBER_SENDER_NAME'],
    warning: 'Viber provider token is not configured',
  },
  {
    channel: 'sms',
    label: 'SMS',
    envKeys: ['TURBOSMS_TOKEN'],
    accountEnvKeys: ['TURBOSMS_SENDER'],
    warning: 'SMS gateway is not configured',
  },
  {
    channel: 'facebook',
    label: 'Facebook',
    envKeys: ['FB_PAGE_TOKEN'],
    accountEnvKeys: ['FB_PAGE_NAME', 'FB_PAGE_ID'],
    warning: 'Facebook page token is not configured',
  },
  {
    channel: 'instagram',
    label: 'Instagram',
    envKeys: ['IG_PAGE_TOKEN'],
    accountEnvKeys: ['IG_ACCOUNT_NAME', 'IG_PAGE_ID'],
    warning: 'Instagram account token is not configured',
  },
  {
    channel: 'binotel',
    label: 'Binotel',
    envKeys: ['BINOTEL_WEBHOOK_SECRET', 'BINOTEL_API_KEY', 'BINOTEL_KEY'],
    accountEnvKeys: ['BINOTEL_ACCOUNT_NAME'],
    inboundOnly: true,
    warning: 'Binotel is not configured for call history webhooks',
    limitedWarning: 'Binotel працює як history-only канал без відправки з CRM',
  },
];

function hasEnv(keys = []) {
  return keys.some(key => String(process.env[key] || '').trim());
}

function firstEnv(keys = []) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return null;
}

function normalizeChannel(channel) {
  return String(channel || '').toLowerCase();
}

function buildAccountStatus(def, now = new Date()) {
  const connected = hasEnv(def.envKeys);
  const sendCapable = connected && !def.inboundOnly;
  const status = connected
    ? (sendCapable ? 'connected' : 'limited')
    : 'disconnected';
  const warning = connected
    ? (sendCapable ? null : def.limitedWarning)
    : def.warning;

  return {
    channel: def.channel,
    label: def.label,
    status,
    connected,
    sendCapable,
    accountName: firstEnv(def.accountEnvKeys) || (connected ? def.label + ' configured' : null),
    lastCheckedAt: now.toISOString(),
    warning,
    action: connected ? (sendCapable ? 'manage' : 'configure') : 'connect',
    connectAvailable: false,
  };
}

function getOmniAccountStatuses(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  return CHANNELS.map(def => buildAccountStatus(def, now));
}

function getOmniAccountStatus(channel, options = {}) {
  const normalized = normalizeChannel(channel);
  return getOmniAccountStatuses(options).find(acc => acc.channel === normalized) || null;
}

function isOmniChannelSendCapable(channel, options = {}) {
  const account = getOmniAccountStatus(channel, options);
  return Boolean(account && account.connected && account.sendCapable);
}

function getOmniUnavailableMessage(channel, options = {}) {
  const account = getOmniAccountStatus(channel, options);
  const label = account?.label || channel || 'Канал';
  if (!account) return `${label} не підтримується Omni.`;
  if (!account.connected) {
    return `${label} не підключений до Omni. Підключіть акаунт у блоці «Підключення каналів».`;
  }
  if (account.sendCapable === false) {
    return `${label} працює в обмеженому режимі. Налаштуйте канал у блоці «Підключення каналів».`;
  }
  return `${label} тимчасово недоступний для відправки з CRM.`;
}

function getOmniAccountAlerts(options = {}) {
  return getOmniAccountStatuses(options)
    .filter(acc => !acc.connected || acc.sendCapable === false)
    .map(acc => ({
      id: `omni_${acc.channel}_${acc.status}`,
      level: acc.connected ? 'warning' : 'critical',
      icon: acc.connected ? '⚠️' : '🔌',
      title: acc.connected
        ? `Omni: ${acc.label} працює обмежено`
        : `Omni: ${acc.label} не підключений`,
      link: `/omni?panel=accounts&channel=${encodeURIComponent(acc.channel)}`,
      source: 'omni_accounts',
      action: {
        label: acc.connected ? 'Налаштувати канал' : 'Підключити акаунт',
        prompt: acc.warning || getOmniUnavailableMessage(acc.channel),
      },
    }));
}

module.exports = {
  CHANNELS,
  getOmniAccountStatuses,
  getOmniAccountStatus,
  isOmniChannelSendCapable,
  getOmniUnavailableMessage,
  getOmniAccountAlerts,
};
