// Optional NODE_OPTIONS preload for the isolated benchmark. Capture only the
// first plan for each selected system query and never log parameters.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

if (process.env.MY_DAY_CLEANUP_BENCHMARK_ONLY === '1' && process.env.NODE_ENV === 'test'
    && !process.env.DATABASE_URL && ['127.0.0.1', 'localhost'].includes(process.env.PGHOST)
    && /^test_my_day_(?:before|browser)$/.test(process.env.PGDATABASE || '')
    && path.basename(process.argv[1] || '') === 'server.js') {
    const { Pool } = createRequire(path.join(process.cwd(), 'package.json'))('pg');
    const original = Pool.prototype.query;
    const selected = new Set();
    Pool.prototype.query = function (query, values, callback) {
        const kind = typeof query === 'string' && query.trimStart().startsWith('SELECT') && (
            query.includes('AS parent_done_this_week') ? 'profile-completion'
                : query.includes('AS open_count') && query.includes('t.owner_user_id') ? 'my-day-open-count' : null);
        if (!kind || selected.has(kind) || typeof callback === 'function' || !Array.isArray(values)) {
            return original.apply(this, arguments);
        }
        selected.add(kind);
        return (async () => {
            const result = await original.call(this, query, values);
            try {
                const plan = await original.call(this, 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query, values);
                const collect = node => ({
                    node: node['Node Type'], relation: node['Relation Name'], rows: node['Actual Rows'],
                    loops: node['Actual Loops'], sharedHit: node['Shared Hit Blocks'], sharedRead: node['Shared Read Blocks'],
                    children: (node.Plans || []).map(collect)
                });
                const data = plan.rows[0]['QUERY PLAN'][0];
                const file = path.join(process.cwd(), 'output/qa', `sql-plan-${kind}.json`);
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, JSON.stringify({
                    planningMs: data['Planning Time'], executionMs: data['Execution Time'], plan: collect(data.Plan)
                }, null, 2));
            } catch {
                console.error(`Could not capture the isolated plan: ${kind}.`);
            }
            return result;
        })();
    };
}
