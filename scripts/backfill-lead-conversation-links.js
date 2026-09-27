'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { version: packageVersion } = require('../package.json');
const {
  readLeadConversationLinkBackfillPlan,
  applyLeadConversationLinkBackfill,
} = require('../services/leadConversationLinkBackfill');

function readArgument(name) {
  const prefix = `${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || null;
}

function summary(plan, mode, applyResult = null) {
  return {
    reportVersion: 2,
    tool: 'omni-lead-conversation-link-backfill',
    packageVersion,
    mode,
    businessContext: plan.businessContext,
    scanned: plan.scanned,
    coverage: plan.coverage,
    approval: plan.approval,
    ready: plan.ready,
    alreadyLinked: plan.alreadyLinked,
    skipped: plan.skipped,
    conflicts: plan.conflicts,
    applyResult,
    totals: {
      ready: plan.ready.length,
      alreadyLinked: plan.alreadyLinked.length,
      skipped: plan.skipped.length,
      conflicts: plan.conflicts.length,
      added: applyResult?.added?.length || 0,
      applyAlreadyExisted: applyResult?.alreadyExisted?.length || 0,
      applySkipped: applyResult?.skipped?.length || 0,
      applyConflicts: applyResult?.conflicts?.length || 0,
    },
  };
}

function readPositiveArgument(name) {
  const value = readArgument(name);
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function readApprovedPlan(filePath) {
  const absolutePath = path.resolve(filePath);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, ''));
  if (parsed.mode !== 'dry-run') throw new Error('Approved plan file must be a dry-run report');
  return parsed;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const confirmation = readArgument('--confirm');
  if (apply && confirmation !== 'APPLY_OMNI_LEAD_CONVERSATION_LINKS') {
    throw new Error('Apply requires --confirm=APPLY_OMNI_LEAD_CONVERSATION_LINKS');
  }
  const businessContext = readArgument('--business-context');
  const approvedPlanPath = readArgument('--approved-plan');
  const maxApply = readPositiveArgument('--max-apply');
  if (apply && !businessContext) throw new Error('Apply requires explicit --business-context=<context>');
  if (apply && !approvedPlanPath) throw new Error('Apply requires --approved-plan=<dry-run-report.json>');
  if (apply && !maxApply) throw new Error('Apply requires explicit --max-apply=<count>');
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
    const plan = apply
      ? readApprovedPlan(approvedPlanPath)
      : await readLeadConversationLinkBackfillPlan({
        businessContext: businessContext || undefined,
        batchSize: readPositiveArgument('--batch-size') || undefined,
        maxLeads: readPositiveArgument('--max-leads') || readPositiveArgument('--limit') || undefined,
      }, client);
    if (apply && plan.businessContext !== businessContext) {
      throw new Error('Approved plan business context does not match --business-context');
    }
    const applyResult = apply ? await applyLeadConversationLinkBackfill(plan, {
      client,
      approval: plan.approval,
      maxCandidates: maxApply,
    }) : null;
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    process.stdout.write(`${JSON.stringify(summary(plan, apply ? 'apply' : 'dry-run', applyResult), null, 2)}\n`);
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
