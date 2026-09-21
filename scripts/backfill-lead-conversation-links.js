'use strict';

const { Pool } = require('pg');
const {
  readLeadConversationLinkBackfillPlan,
  applyLeadConversationLinkBackfill,
} = require('../services/leadConversationLinkBackfill');

function readArgument(name) {
  const prefix = `${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || null;
}

function summary(plan, mode, applied = []) {
  return {
    mode,
    businessContext: plan.businessContext,
    scanned: plan.scanned,
    ready: plan.ready,
    alreadyLinked: plan.alreadyLinked,
    skipped: plan.skipped,
    conflicts: plan.conflicts,
    applied,
    totals: {
      ready: plan.ready.length,
      alreadyLinked: plan.alreadyLinked.length,
      skipped: plan.skipped.length,
      conflicts: plan.conflicts.length,
      applied: applied.length,
    },
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const confirmation = readArgument('--confirm');
  if (apply && confirmation !== 'APPLY_OMNI_LEAD_CONVERSATION_LINKS') {
    throw new Error('Apply requires --confirm=APPLY_OMNI_LEAD_CONVERSATION_LINKS');
  }
  const connectionString = apply
    ? process.env.OMNI_LINK_BACKFILL_DATABASE_URL
    : process.env.OMNI_LINK_BACKFILL_READONLY_DATABASE_URL;
  if (!connectionString) {
    throw new Error(apply
      ? 'OMNI_LINK_BACKFILL_DATABASE_URL is required for --apply'
      : 'OMNI_LINK_BACKFILL_READONLY_DATABASE_URL is required for dry-run');
  }
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const plan = await readLeadConversationLinkBackfillPlan({
      businessContext: readArgument('--business-context') || undefined,
      limit: readArgument('--limit') || undefined,
    }, client);
    const applied = apply ? await applyLeadConversationLinkBackfill(plan, { client }) : [];
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    process.stdout.write(`${JSON.stringify(summary(plan, apply ? 'apply' : 'dry-run', applied), null, 2)}\n`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
