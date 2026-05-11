const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(...parts) {
    return fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
}

describe('Guardian phase3 schema compatibility', () => {
    const service = readRepoFile('services', 'guardian.js');
    const route = readRepoFile('routes', 'guardian.js');
    const phase3Migration = readRepoFile('db', 'migrations', '051_guardian_phase3.sql');
    const compatMigration = readRepoFile('db', 'migrations', '165_guardian_phase3_schema_compatibility.sql');
    const migrations = `${phase3Migration}\n${compatMigration}`;

    it('keeps service queries away from stale phase3 column names', () => {
        const staleServicePatterns = [
            /sentiment_score/,
            /period_start,\s*period_end,\s*report_html/,
            /guardian_activity_heatmap\s*\(channel_id,\s*date,\s*hour/,
            /ON CONFLICT\s*\(channel_id,\s*date,\s*hour\)/,
            /INSERT INTO guardian_trust_scores\s*\(user_id,\s*username,\s*score/,
            /SELECT score,\s*reason,\s*updated_at FROM guardian_trust_scores/,
            /SELECT score,\s*toxicity_score,\s*spam_score,\s*conflict_score,\s*engagement_score/,
            /SELECT level,\s*min_incidents,\s*action/
        ];

        for (const pattern of staleServicePatterns) {
            assert.doesNotMatch(service, pattern);
        }
    });

    it('uses the migration-defined Guardian phase3 tables and compatibility additions', () => {
        assert.match(migrations, /CREATE TABLE IF NOT EXISTS guardian_mood_tracking[\s\S]*\bscore NUMERIC/);
        assert.match(migrations, /CREATE TABLE IF NOT EXISTS guardian_activity_heatmap[\s\S]*\bhour_bucket TIMESTAMPTZ/);
        assert.match(migrations, /CREATE TABLE IF NOT EXISTS guardian_trust_scores[\s\S]*\btrust_score INTEGER/);
        assert.match(migrations, /CREATE TABLE IF NOT EXISTS guardian_trust_history/);
        assert.match(migrations, /ALTER TABLE guardian_escalation_config[\s\S]*ADD COLUMN IF NOT EXISTS updated_at/);
    });

    it('keeps route fallbacks on existing health tables and timestamps', () => {
        assert.doesNotMatch(route, /FROM guardian_channel_health[\s\S]{0,180}ORDER BY recorded_at/);
        assert.doesNotMatch(route, /SELECT score,\s*level,\s*recorded_at[\s\S]{0,120}FROM guardian_channel_health/);
        assert.match(route, /FROM guardian_health_history/);
        assert.match(route, /ORDER BY calculated_at DESC LIMIT 1/);
    });
});
