/**
 * services/copilot.js — Manager AI Copilot Service
 * AI integration via OpenRouter (claude-haiku-3)
 * v27.0.0 | 2026-03-13 | Помічник 🤖
 */
const { createLogger } = require('../utils/logger');
const { callUnifiedChatCompletion } = require('./ai-config');
const log = createLogger('CopilotService');

const COPILOT_MODEL = process.env.COPILOT_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-5.4-mini';

function compactMessagesForPrompt(messages = []) {
    return (Array.isArray(messages) ? messages : [])
        .map(message => `${message?.role === 'assistant' ? 'Assistant' : 'User'}: ${message?.content || ''}`)
        .join('\n');
}

/**
 * Call OpenRouter chat completion
 */
async function openRouterChat({ model = COPILOT_MODEL, system, messages, temperature = 0.7, max_tokens = 1000 }) {
    const result = await callUnifiedChatCompletion({
        scope: 'chat_ai',
        title: 'Event Genix Manager Copilot',
        model,
        temperature,
        maxTokens: max_tokens,
        systemPrompt: system || 'Ти — AI copilot Event Genix CRM. Відповідай українською.',
        userMessage: compactMessagesForPrompt(messages)
    });

    if (!result.ok) {
        throw new Error(result.error || result.reason || 'OPENROUTER_API_KEY not configured');
    }

    return result.text || '';
}

/**
 * Build Live Coach system prompt
 */
function buildCoachPrompt(scenario, tone) {
    const SCENARIOS = {
        'first-call':        'перший вхідний дзвінок, клієнт нічого не знає про систему',
        'landing-lead':      'клієнт залишив заявку на лендінгу, вже зацікавлений',
        'after-demo':        'після онлайн-презентації, розглядає рішення',
        'price-negotiation': 'обговорення ціни, торг',
        'objection':         'клієнт заперечує або сумнівається',
        'closing':           'фінальний етап, закриття угоди',
        'follow-up':         'клієнт не відповідав 5-7 днів',
        'reactivation':      'клієнт не виходив на зв\'язок 2+ тижні'
    };

    const TONES = {
        'confident':  'впевнений, прямий, без зайвих слів',
        'empathetic': 'м\'який, емпатичний, слухаючий',
        'business':   'діловий, короткий, цифри і факти',
        'playful':    'дружній, легкий гумор де доречно'
    };

    return `Ти — AI-помічник менеджера Event Genix.

КОНТЕКСТ ПРОДУКТУ:
Event Genix — AI-CRM система для дитячих розважальних центрів.
• Базовий пакет: 2,000 ₴/міс (таймлайн, бронювання, чат, AI-дворецький, гейміфікація)
• Повний пакет: 21,000 ₴/міс (все включено)
• Вже використовується в Парку Закревського (Київ) з лютого 2026
• Головна цінність: економить 90+ хвилин/день рутини
• AI-дворецький Помічник: відповідає на питання, бронює, будує P&L за 10 секунд

РИНОК КЛІЄНТА:
• Власники дитячих квест-кімнат, батутних парків, розважальних центрів
• Болі: ручне бронювання, розклад у телефоні, конфлікти через плутанину, звітність в Excel
• Страхи: складно навчити команду, а раптом не злетить, дорого

КОНКУРЕНТИ:
• Excel/Google Sheets → не нагадують, не аналізують, не автоматизують
• Yclients/DIKIDI → онлайн-запис для б'юті, без AI для дитячих центрів
• Самописні боти → хто підтримуватиме, скільки часу розробка
• WhatsApp груп → ок до 3 кімнат, при масштабуванні хаос

УСПІШНІ КЕЙСИ:
• Парк Закревського (Київ): -90 хв/день рутини з лютого 2026

СЦЕНАРІЙ РОЗМОВИ: ${SCENARIOS[scenario] || 'загальна розмова'}
ТОН: ${TONES[tone] || 'впевнений'}

ТВОЯ ЗАДАЧА — видати ТІЛЬКИ валідний JSON (без markdown, без тексту до/після):
{
  "suggestions": [
    {"type": "neutral", "text": "..."},
    {"type": "confident", "text": "..."},
    {"type": "empathy", "text": "..."}
  ],
  "tactic": "одне речення — яка тактика застосована",
  "avoid": ["що НЕ казати — 1-2 пункти"],
  "nextStep": "конкретна наступна дія менеджера"
}

ПРАВИЛА:
• Тільки українська мова
• Конкретні фрази, не шаблони
• Без "можливо", "спробуйте", "можна"
• Враховуй ринок дитячих розваг
• НЕ критикувати конкурентів напряму
• НЕ тиснути на терміни штучно
• НЕ обіцяти функціонал якого немає`;
}

/**
 * Build Debrief analysis prompt
 */
function buildDebriefPrompt(debrief) {
    return `Ти — AI тренер з продажів для менеджерів Event Genix.

Проаналізуй дзвінок менеджера і дай конкретний зворотній зв'язок.

ДАНІ ДЗВІНКА:
Клієнт: ${debrief.clientName}
Результат: ${debrief.callResult}
Тривалість: ${debrief.durationMin} хв
Що обговорювали: ${debrief.notes}
Головне заперечення: ${debrief.mainObjection || 'не вказано'}
Що спрацювало: ${debrief.whatWorked || 'не вказано'}
Що зробив би інакше: ${debrief.whatImprove || 'не вказано'}

Видай ТІЛЬКИ валідний JSON:
{
  "score": <число 1-10>,
  "good": ["що зроблено добре — конкретно"],
  "improve": ["що покращити — конкретно і actionable"],
  "nextStep": "конкретна наступна дія — що зробити сьогодні"
}

ПРАВИЛА:
• Оцінюй чесно, не завищуй
• Кожен пункт — конкретна порада, не загальні слова
• Враховуй специфіку продажів B2B SaaS для малого бізнесу
• Результат 'гарячий' = 9-10, 'зацікавлений' = 6-8, 'передзвонити' = 4-6, 'відмов' = 2-4 (якщо відпрацьовано)`;
}

/**
 * Build Meeting Prep prompt
 */
function buildMeetingPrepPrompt(data) {
    return `Ти — AI стратег для менеджерів Event Genix.

Підготуй бриф для дзвінка/зустрічі з клієнтом.

ДАНІ КЛІЄНТА:
Компанія/ім'я: ${data.clientName}
Джерело: ${data.source}
Розмір бізнесу: ${data.businessSize}
Що знаємо: ${data.notes}
Пакет що цікавить: ${data.package}
Попередні контакти: ${data.previousContact}
Тип дзвінка: ${data.callType}

Видай ТІЛЬКИ валідний JSON:
{
  "focus": "Головна ціль цього конкретного дзвінка — одне речення",
  "openingQuestion": "Перше питання з чого почати — конкретно",
  "killerQuestions": ["Q1", "Q2", "Q3"],
  "likelyObjections": [
    {"objection": "текст заперечення", "response": "відповідь — конкретна фраза"}
  ],
  "callGoal": "Конкретний результат який треба досягти (не 'продати', а конкретно)",
  "potentialValue": "Орієнтовна цінність угоди в ₴",
  "decisionMakerHint": "Як з'ясувати хто приймає рішення в цій ситуації"
}

Адаптуй відповідь під розмір бізнесу і тип дзвінка. Конкретика, не загальні слова.`;
}

/**
 * Build Message Writer prompt
 */
function buildMessageWriterPrompt(data) {
    return `Ти — AI копірайтер для менеджерів Event Genix.

Напиши живий персоналізований текст повідомлення клієнту.

КОНТЕКСТ:
Клієнт: ${data.clientName}
Тип повідомлення: ${data.messageType}
Що обговорювали: ${data.discussedTopics}
Що зацікавило: ${data.mainInterest}
Що хвилює клієнта: ${data.concerns}
Результат розмови: ${data.callResult}
Наступний крок: ${data.nextStep}
Тон: ${data.tone}

ПРАВИЛА НАПИСАННЯ:
• Звертатись по імені природньо (без 'Шановний')
• Згадати конкретний біль ЦЬОГО клієнта
• Відповісти на його конкретне побоювання
• Живий стиль, не корпоративна мова
• Не більше 5-7 речень (Telegram повідомлення)
• Закінчити конкретним питанням або пропозицією

Видай ТІЛЬКИ текст повідомлення, без JSON, без пояснень.`;
}

/**
 * Build Sales Q&A prompt
 */
function buildSalesQAPrompt(salesAcademy, methodology, profiles) {
    const context = JSON.stringify({ salesAcademy, methodology, profiles }, null, 0).substring(0, 3000);
    return `Ти — Sales AI для менеджерів Event Genix.

База знань:
${context}

Відповідай конкретно, з прикладами, адаптованими до ринку дитячих розваг.
Якщо питання про продукт — давай точну відповідь.
Якщо питання про тактику — давай покрокову інструкцію.
Завжди: що робити ЗАРАЗ і яким буде наступний крок.
Мова: тільки українська.`;
}

/**
 * Build Objection AI prompt
 */
function buildObjectionPrompt(objectionText) {
    return `Ти — AI тренер з відпрацювання заперечень для менеджерів Event Genix.

Заперечення клієнта: "${objectionText}"

Event Genix — AI-CRM для дитячих розважальних центрів.
Базовий пакет: 2,000 ₴/міс. Повний: 21,000 ₴/міс.
Кейс: Парк Закревського — -90 хв/день рутини.

Видай ТІЛЬКИ валідний JSON (без markdown):
{
  "responses": [
    {
      "type": "main",
      "label": "Основна відповідь",
      "text": "конкретна фраза для менеджера",
      "tactic": "назва тактики",
      "avoid": "що не казати"
    },
    {
      "type": "empathy",
      "label": "Емпатія",
      "text": "варіант через розуміння і питання"
    },
    {
      "type": "reframe",
      "label": "Рефреймінг",
      "text": "варіант через зміну кута зору"
    }
  ],
  "nextStep": "конкретна наступна дія після відповіді"
}`;
}

module.exports = {
    openRouterChat,
    buildCoachPrompt,
    buildDebriefPrompt,
    buildMeetingPrepPrompt,
    buildMessageWriterPrompt,
    buildSalesQAPrompt,
    buildObjectionPrompt
};
