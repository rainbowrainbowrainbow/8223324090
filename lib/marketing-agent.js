/**
 * lib/marketing-agent.js — Marketing Subagent core logic (v42.3)
 *
 * Cheap LLM for content generation, scheduled publishing via social publishers.
 * NOT Kleshnya — this is a separate lightweight bot.
 */
const { pool } = require('../db');
const { getPublisher } = require('./social-publishers');
const { createLogger } = require('../utils/logger');

const log = createLogger('MarketingAgent');

const AGENT_CONFIG = {
    model: process.env.MARKETING_LLM_MODEL || 'claude-haiku-4-5-20251001',
    apiKey: process.env.MARKETING_LLM_KEY || process.env.ANTHROPIC_API_KEY,
    apiUrl: process.env.MARKETING_LLM_URL || 'https://api.anthropic.com/v1/messages',
    maxTokens: 1000,
    temperature: 0.8,
    maxPublishPerRun: 10,
    retryAttempts: 3,
    retryBaseDelay: 2000,

    systemPrompt: `Ти — маркетолог дитячого розважального парку "Парк Закревського періоду".
Твоя задача — писати пости для соцмереж.

Правила:
- Пиши УКРАЇНСЬКОЮ
- Використовуй емоджі доречно
- Фокус на емоції дітей та зручність для батьків
- Не порівнюй з конкурентами
- Завжди вказуй контактну інформацію якщо є
- Дотримуйся правил конкретної платформи (довжина, хештеги, тон)
- Виведи ТІЛЬКИ текст посту, без пояснень чи коментарів`
};

const DAY_NAMES = ['Понеділок', 'Вівторок', 'Середа', 'Четвер', 'Пʼятниця', 'Субота', 'Неділя'];
const TOPIC_TITLES = {
    animation: '🎭 Анімація', quest: '🔍 Квест', birthday: '🎂 День народження',
    show: '🎪 Шоу', masterclass: '🎨 Майстер-клас', general: '📱 Парк',
    'neon-show': '✨ Неон-шоу', 'paper-show': '🎊 Паперове шоу',
    promo: '🔥 Промо', event: '🎉 Подія', review: '⭐ Відгук'
};

// ─── LLM Call ───

async function callLLM(prompt) {
    if (!AGENT_CONFIG.apiKey) {
        log.warn('No LLM API key — returning mock content');
        return generateMockContent(prompt);
    }

    try {
        const res = await fetch(AGENT_CONFIG.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': AGENT_CONFIG.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: AGENT_CONFIG.model,
                max_tokens: AGENT_CONFIG.maxTokens,
                temperature: AGENT_CONFIG.temperature,
                system: AGENT_CONFIG.systemPrompt,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!res.ok) {
            const errText = await res.text();
            log.warn(`LLM API ${res.status}: ${errText.substring(0, 200)}`);
            return generateMockContent(prompt);
        }

        const data = await res.json();
        return data.content?.[0]?.text || generateMockContent(prompt);
    } catch (err) {
        log.warn('LLM call failed, using mock:', err.message);
        return generateMockContent(prompt);
    }
}

function generateMockContent(prompt) {
    const templates = [
        '🎉 Запрошуємо в Парк Закревського!\n\nНезабутні емоції для дітей та дорослих. Кожен день — нова пригода!\n\n📞 Бронюйте заздалегідь\n📍 вул. Закревського 61/2, Київ',
        '✨ Дивовижні програми для ваших дітей!\n\nПрофесійні аніматори, яскраві декорації та море позитиву.\n\n🎭 Парк Закревського періоду\n📞 Деталі за посиланням у шапці',
        '🌟 Зробіть свято незабутнім!\n\nПарк Закревського — місце де дитячі мрії стають реальністю.\n\nОбирайте програму та бронюйте вже зараз! 🎪'
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

// ─── Context Fetcher ───

async function getContext(slug, platform) {
    const general = await pool.query("SELECT * FROM business_cards WHERE slug = 'park-general' AND is_active = true LIMIT 1");
    const card = await pool.query('SELECT * FROM business_cards WHERE slug = $1 AND is_active = true LIMIT 1', [slug]);
    let rules = null;
    if (platform) {
        const r = await pool.query('SELECT * FROM social_platform_rules WHERE platform = $1 AND is_active = true LIMIT 1', [platform]);
        rules = r.rows[0] || null;
    }
    return { business: general.rows[0] || null, topic: card.rows[0] || null, platform: rules };
}

function buildPrompt(context, platform, scheduledDate) {
    const biz = context.business;
    const topic = context.topic;
    const rules = context.platform;

    let prompt = '';
    if (biz) {
        prompt += `ЗАГАЛЬНА ІНФО ПРО ПАРК:\n${biz.full_description || biz.short_description || biz.title}\n`;
        if (biz.call_to_action) prompt += `Контакт: ${biz.call_to_action}\n`;
        prompt += '\n';
    }
    if (topic) {
        prompt += `ПОСЛУГА: ${topic.title}\n`;
        if (topic.full_description) prompt += `${topic.full_description}\n`;
        if (topic.price_info) prompt += `Ціна: ${topic.price_info}\n`;
        if (topic.target_audience) prompt += `Аудиторія: ${topic.target_audience}\n`;
        if (topic.tone_of_voice) prompt += `Тон: ${topic.tone_of_voice}\n`;
        if (topic.content_rules) prompt += `Правила: ${topic.content_rules}\n`;
        if (topic.call_to_action) prompt += `CTA: ${topic.call_to_action}\n`;
        if (topic.do_not?.length) prompt += `НЕ ПИСАТИ: ${topic.do_not.join(', ')}\n`;
        prompt += '\n';
    }
    if (rules) {
        prompt += `ПЛАТФОРМА: ${platform}\n`;
        prompt += `Макс. символів: ${rules.max_text_length || 'необмежено'}\n`;
        if (rules.media_required) prompt += `Фото обовʼязково: так\n`;
        if (rules.hashtag_limit) prompt += `Хештеги: до ${rules.hashtag_limit}\n`;
        if (rules.hashtag_placement) prompt += `Розміщення хештегів: ${rules.hashtag_placement}\n`;
        if (rules.tone) prompt += `Тон платформи: ${rules.tone}\n`;
        if (rules.formatting_rules) prompt += `Формат: ${rules.formatting_rules}\n`;
        prompt += '\n';
    }
    if (scheduledDate) prompt += `Дата публікації: ${scheduledDate}\n\n`;

    const topicHashtags = topic?.[`hashtags_${platform}`] || [];
    const defaultHashtags = rules?.default_hashtags || [];
    if (topicHashtags.length || defaultHashtags.length) {
        prompt += `Хештеги для використання: ${[...topicHashtags, ...defaultHashtags].join(' ')}\n\n`;
    }

    prompt += `Напиши пост для ${platform}.`;
    return prompt;
}

function extractHashtags(text) {
    const matches = text.match(/#[\wа-яА-ЯіїєґІЇЄҐ_]+/g);
    return matches || [];
}

function getWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

// ─── Generate Single Post ───

async function generatePost(slug, platform, scheduledAt, userId) {
    const context = await getContext(slug, platform);
    const prompt = buildPrompt(context, platform, scheduledAt);
    const body = await callLLM(prompt);
    const hashtags = extractHashtags(body);
    const scheduledDate = scheduledAt ? new Date(scheduledAt) : new Date();
    const topicTitle = TOPIC_TITLES[slug] || context.topic?.title || slug;

    const result = await pool.query(
        `INSERT INTO content_posts (title, body, platforms, topic, business_card_id, hashtags,
         status, scheduled_at, week_number, year, day_of_week, ai_generated, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,true,$11) RETURNING *`,
        [`${topicTitle} — ${platform}`, body, [platform], slug,
         context.topic?.id || null, hashtags, scheduledAt || null,
         getWeekNumber(scheduledDate), scheduledDate.getFullYear(),
         scheduledDate.getDay() === 0 ? 7 : scheduledDate.getDay(), userId || null]
    );
    log.info(`Generated post: "${result.rows[0].title}" (id: ${result.rows[0].id})`);
    return result.rows[0];
}

// ─── Generate Weekly Plan ───

async function generateWeeklyPlan(weekNumber, year, platforms, topics, userId) {
    // Check for existing posts
    const existing = await pool.query(
        'SELECT COUNT(*) AS cnt FROM content_posts WHERE week_number = $1 AND year = $2',
        [weekNumber, year]
    );
    if (parseInt(existing.rows[0].cnt) > 0) {
        throw new Error(`Тиждень ${weekNumber}/${year} вже має ${existing.rows[0].cnt} постів`);
    }

    const topicList = topics?.length ? topics : ['animation', 'quest', 'birthday', 'show', 'masterclass'];
    const platformList = platforms?.length ? platforms : ['instagram', 'telegram'];
    const count = Math.min(topicList.length, 7);
    const posts = [];

    // Calculate Monday of the target week
    const jan1 = new Date(year, 0, 1);
    const daysOffset = (weekNumber - 1) * 7;
    const weekDate = new Date(jan1.getTime() + daysOffset * 86400000);
    const monday = new Date(weekDate);
    const day = monday.getDay();
    monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1));

    for (let i = 0; i < count; i++) {
        const topic = topicList[i % topicList.length];
        const scheduledDate = new Date(monday);
        scheduledDate.setDate(scheduledDate.getDate() + i);
        scheduledDate.setHours(10, 0, 0, 0);

        for (const platform of platformList) {
            const post = await generatePost(topic, platform, scheduledDate.toISOString(), userId);
            posts.push(post);
        }
    }
    log.info(`Generated weekly plan: ${posts.length} posts for week ${weekNumber}/${year}`);
    return posts;
}

// ─── Regenerate Post ───

async function regeneratePost(postId) {
    const existing = await pool.query('SELECT * FROM content_posts WHERE id = $1', [postId]);
    if (!existing.rows.length) throw new Error('Пост не знайдено');
    const post = existing.rows[0];
    const platform = post.platforms?.[0] || 'instagram';
    const slug = post.topic || 'general';

    const context = await getContext(slug, platform);
    const prompt = buildPrompt(context, platform, post.scheduled_at);
    const body = await callLLM(prompt);
    const hashtags = extractHashtags(body);

    const result = await pool.query(
        `UPDATE content_posts SET body = $1, hashtags = $2, ai_generated = true, updated_at = NOW()
         WHERE id = $3 RETURNING *`, [body, hashtags, postId]
    );
    log.info(`Regenerated post #${postId}`);
    return result.rows[0];
}

// ─── Publish Single Post ───

async function publishPost(postId) {
    const postRes = await pool.query('SELECT * FROM content_posts WHERE id = $1', [postId]);
    if (!postRes.rows.length) throw new Error('Пост не знайдено');
    const post = postRes.rows[0];

    const results = {};
    const errors = {};

    for (const platform of (post.platforms || [])) {
        const accRes = await pool.query('SELECT * FROM social_accounts WHERE platform = $1', [platform]);
        const account = accRes.rows[0];

        try {
            const publisher = getPublisher(platform);
            const result = await publishWithRetry(publisher, post, account);
            results[platform] = result;
        } catch (err) {
            errors[platform] = err.message;
            log.error(`Publish failed: post #${postId} → ${platform}: ${err.message}`);
        }
    }

    // Update post
    const platformPostIds = { ...(post.platform_post_ids || {}), ...Object.fromEntries(Object.entries(results).map(([p, r]) => [p, r.postId])) };
    const platformUrls = { ...(post.platform_urls || {}), ...Object.fromEntries(Object.entries(results).filter(([, r]) => r.postUrl).map(([p, r]) => [p, r.postUrl])) };
    const hasErrors = Object.keys(errors).length > 0;
    const allFailed = Object.keys(results).length === 0 && hasErrors;
    const newStatus = allFailed ? 'failed' : 'published';

    await pool.query(
        `UPDATE content_posts SET status = $1, published_at = NOW(), platform_post_ids = $2,
         platform_urls = $3, updated_at = NOW() WHERE id = $4`,
        [newStatus, JSON.stringify(platformPostIds), JSON.stringify(platformUrls), postId]
    );

    if (hasErrors) {
        const errMsg = Object.entries(errors).map(([p, e]) => `${p}: ${e}`).join('; ');
        log.warn(`Post #${postId} published with errors: ${errMsg}`);
    } else {
        log.info(`Post #${postId} published to ${Object.keys(results).join(', ')}`);
    }

    return { success: !allFailed, results, errors, status: newStatus };
}

async function publishWithRetry(publisher, post, account, attempt = 1) {
    try {
        return await publisher.publish(post, account);
    } catch (err) {
        if (attempt >= AGENT_CONFIG.retryAttempts) throw err;
        const delay = AGENT_CONFIG.retryBaseDelay * Math.pow(2, attempt - 1);
        log.warn(`Retry ${attempt}/${AGENT_CONFIG.retryAttempts} for ${publisher.platform} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        return publishWithRetry(publisher, post, account, attempt + 1);
    }
}

// ─── Publish Scheduled (Cron) ───

async function publishScheduled() {
    const posts = await pool.query(`
        SELECT * FROM content_posts
        WHERE status = 'scheduled' AND scheduled_at <= NOW()
        ORDER BY scheduled_at LIMIT $1
    `, [AGENT_CONFIG.maxPublishPerRun]);

    const results = [];
    for (const post of posts.rows) {
        try {
            const result = await publishPost(post.id);
            results.push({ postId: post.id, ...result });
        } catch (err) {
            log.error(`Scheduled publish failed for post #${post.id}: ${err.message}`);
            results.push({ postId: post.id, success: false, error: err.message });
        }
    }
    if (results.length) log.info(`Cron published ${results.length} posts`);
    return results;
}

// ─── Agent Status ───

async function getStatus() {
    const [pending, scheduled, published, failed, accounts] = await Promise.all([
        pool.query("SELECT COUNT(*) FROM content_posts WHERE status = 'pending_approval'"),
        pool.query("SELECT COUNT(*) FROM content_posts WHERE status = 'scheduled'"),
        pool.query("SELECT COUNT(*) FROM content_posts WHERE status = 'published'"),
        pool.query("SELECT COUNT(*) FROM content_posts WHERE status = 'failed'"),
        pool.query('SELECT platform, is_connected FROM social_accounts ORDER BY platform')
    ]);

    return {
        pending: parseInt(pending.rows[0].count),
        scheduled: parseInt(scheduled.rows[0].count),
        published: parseInt(published.rows[0].count),
        failed: parseInt(failed.rows[0].count),
        connected_platforms: accounts.rows.filter(a => a.is_connected).map(a => a.platform),
        all_platforms: accounts.rows.map(a => ({ platform: a.platform, connected: a.is_connected })),
        llm_configured: !!AGENT_CONFIG.apiKey,
        model: AGENT_CONFIG.model
    };
}

module.exports = {
    generatePost, generateWeeklyPlan, regeneratePost,
    publishPost, publishScheduled, getStatus,
    AGENT_CONFIG
};
