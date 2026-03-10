/**
 * services/agentTracker.js — Agent Activity Tracking
 * Contour 2: Track what LLM agents do — commits, PRs, deploys, sessions.
 * Parses git log automatically + accepts webhook input.
 */

const { pool } = require('../db');
const { createLogger } = require('../utils/logger');
const { getCached } = require('./contextCache');
const { execSync } = require('child_process');

const log = createLogger('AgentTracker');

// Agent tag patterns in commit messages
const AGENT_TAG_PATTERNS = [
    { regex: /\[claude-code\]/i, tag: 'claude-code' },
    { regex: /\[kleshnya\]/i, tag: 'kleshnya' },
    { regex: /\[anthropic\]/i, tag: 'anthropic' },
    { regex: /\[human\]/i, tag: 'human' },
    { regex: /Клешня/i, tag: 'kleshnya' },
    { regex: /Merge pull request/i, tag: 'github' }
];

// Commit type patterns
const ACTION_TYPE_PATTERNS = [
    { regex: /^feat/i, type: 'feature' },
    { regex: /^fix/i, type: 'fix' },
    { regex: /^chore/i, type: 'chore' },
    { regex: /^docs/i, type: 'docs' },
    { regex: /^refactor/i, type: 'refactor' },
    { regex: /^test/i, type: 'test' },
    { regex: /Merge pull request/i, type: 'pr_merged' },
    { regex: /deploy/i, type: 'deploy' }
];

/**
 * Log an agent activity.
 */
async function logActivity(agentTag, actionType, summary, details = {}, sessionId = null) {
    try {
        const result = await pool.query(
            `INSERT INTO agent_activities (agent_tag, action_type, summary, details, session_id)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [agentTag, actionType, summary, JSON.stringify(details), sessionId]
        );
        return result.rows[0].id;
    } catch (err) {
        log.error('Failed to log activity', err.message);
        return null;
    }
}

/**
 * Parse git log and create agent_activities for new commits.
 * Idempotent — skips commits already tracked (by commit hash in details).
 */
async function parseGitLog(sinceHours = 24) {
    try {
        const since = new Date(Date.now() - sinceHours * 3600000).toISOString();
        const gitLog = execSync(
            `git log --since="${since}" --format="%H|%an|%s|%ai" --no-merges 2>/dev/null || true`,
            { encoding: 'utf-8', timeout: 10000 }
        ).trim();

        if (!gitLog) return 0;

        const lines = gitLog.split('\n').filter(Boolean);
        let added = 0;

        for (const line of lines) {
            const [hash, author, message, date] = line.split('|');
            if (!hash || !message) continue;

            // Check if already tracked
            const exists = await pool.query(
                `SELECT 1 FROM agent_activities WHERE details->>'commit_hash' = $1 LIMIT 1`,
                [hash]
            );
            if (exists.rows.length > 0) continue;

            // Detect agent tag
            let agentTag = 'unknown';
            for (const p of AGENT_TAG_PATTERNS) {
                if (p.regex.test(message)) {
                    agentTag = p.tag;
                    break;
                }
            }

            // Detect action type
            let actionType = 'commit';
            for (const p of ACTION_TYPE_PATTERNS) {
                if (p.regex.test(message)) {
                    actionType = p.type;
                    break;
                }
            }

            // Get diff stats for this commit
            let diffStat = '';
            try {
                diffStat = execSync(
                    `git diff --shortstat ${hash}~1 ${hash} 2>/dev/null || true`,
                    { encoding: 'utf-8', timeout: 5000 }
                ).trim();
            } catch { /* ignore */ }

            await logActivity(agentTag, actionType, message, {
                commit_hash: hash,
                author,
                date,
                diff_stat: diffStat
            });
            added++;
        }

        if (added > 0) {
            log.info(`Parsed ${added} new commits from git log`);
        }
        return added;
    } catch (err) {
        log.error('parseGitLog failed', err.message);
        return 0;
    }
}

/**
 * Get activity feed with filters.
 */
async function getActivityFeed({ agentTag, actionType, since, limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const params = [];

    if (agentTag) {
        params.push(agentTag);
        conditions.push(`agent_tag = $${params.length}`);
    }
    if (actionType) {
        params.push(actionType);
        conditions.push(`action_type = $${params.length}`);
    }
    if (since) {
        params.push(since);
        conditions.push(`created_at >= $${params.length}`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(limit);
    params.push(offset);

    const result = await pool.query(
        `SELECT * FROM agent_activities ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
    );

    return result.rows.map(r => ({
        id: r.id,
        agentTag: r.agent_tag,
        actionType: r.action_type,
        summary: r.summary,
        details: r.details,
        sessionId: r.session_id,
        createdAt: r.created_at
    }));
}

/**
 * Get agent status — last activity per agent.
 */
async function getAgentStatus() {
    return getCached('agent_status', 30000, async () => {
        const result = await pool.query(`
            SELECT DISTINCT ON (agent_tag)
                agent_tag, action_type, summary, created_at, details
            FROM agent_activities
            ORDER BY agent_tag, created_at DESC
        `);

        return result.rows.map(r => ({
            agentTag: r.agent_tag,
            lastAction: r.action_type,
            lastSummary: r.summary,
            lastActive: r.created_at,
            details: r.details,
            isOnline: (Date.now() - new Date(r.created_at).getTime()) < 3600000 // active in last hour
        }));
    });
}

/**
 * Generate AI summary of agent activities for a period.
 */
async function generateSummary(period = 'today', agentTag = null) {
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return null;

    // Determine time range
    let since;
    const now = new Date();
    if (period === 'today') {
        since = new Date(now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' }) + 'T00:00:00+02:00');
    } else if (period === 'week') {
        since = new Date(now.getTime() - 7 * 86400000);
    } else if (period === 'session') {
        since = new Date(now.getTime() - 4 * 3600000); // last 4 hours
    } else {
        since = new Date(now.getTime() - 86400000);
    }

    // Get activities
    const activities = await getActivityFeed({
        agentTag,
        since: since.toISOString(),
        limit: 100
    });

    if (activities.length === 0) {
        return { summary: 'Немає активності за цей період.', stats: {} };
    }

    // Count stats
    const stats = {};
    for (const a of activities) {
        stats[a.agentTag] = stats[a.agentTag] || { commits: 0, features: 0, fixes: 0, other: 0 };
        const s = stats[a.agentTag];
        if (a.actionType === 'feature') s.features++;
        else if (a.actionType === 'fix') s.fixes++;
        else if (a.actionType === 'commit') s.commits++;
        else s.other++;
    }

    // Generate AI summary
    try {
        const Anthropic = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

        const activitiesText = activities.map(a =>
            `[${a.agentTag}] ${a.actionType}: ${a.summary} (${new Date(a.createdAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })})`
        ).join('\n');

        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            system: 'Ти — координатор розробки. Напиши короткий саммарі (2-5 речень) українською. Вкажи хто що зробив, ключові зміни, і загальний прогрес.',
            messages: [{ role: 'user', content: `Активність за ${period}:\n${activitiesText}` }]
        });

        const summaryText = response.content[0]?.text?.trim() || 'Не вдалось згенерувати саммарі.';

        // Save summary
        await pool.query(
            `INSERT INTO agent_summaries (agent_tag, period, summary, stats, period_start)
             VALUES ($1, $2, $3, $4, $5)`,
            [agentTag, period, summaryText, JSON.stringify(stats), since.toISOString()]
        );

        return { summary: summaryText, stats, activitiesCount: activities.length };
    } catch (err) {
        log.error('generateSummary AI failed', err.message);

        // Fallback: text summary without AI
        const lines = [];
        for (const [tag, s] of Object.entries(stats)) {
            const parts = [];
            if (s.features) parts.push(`${s.features} фіч`);
            if (s.fixes) parts.push(`${s.fixes} фіксів`);
            if (s.commits) parts.push(`${s.commits} комітів`);
            if (s.other) parts.push(`${s.other} інших`);
            lines.push(`${tag}: ${parts.join(', ')}`);
        }
        return { summary: lines.join('\n'), stats, activitiesCount: activities.length };
    }
}

/**
 * Get last saved summary for a period.
 */
async function getLastSummary(period = 'daily', agentTag = null) {
    const conditions = ['period = $1'];
    const params = [period];

    if (agentTag) {
        params.push(agentTag);
        conditions.push(`agent_tag = $${params.length}`);
    } else {
        conditions.push('agent_tag IS NULL');
    }

    const result = await pool.query(
        `SELECT * FROM agent_summaries WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC LIMIT 1`,
        params
    );

    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
        summary: r.summary,
        stats: r.stats,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        createdAt: r.created_at
    };
}

module.exports = {
    logActivity,
    parseGitLog,
    getActivityFeed,
    getAgentStatus,
    generateSummary,
    getLastSummary
};
