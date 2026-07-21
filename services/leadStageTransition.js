'use strict';

const { DEFAULT_BUSINESS_CONTEXT, normalizeBusinessContext } = require('./businessContext');

const LEAD_STAGE_TO_STATUS = Object.freeze({
  new: 'new',
  contacted: 'contact',
  info_sent: 'contact',
  deal: 'proposal',
  deposit_received: 'booked',
  waiting: 'booked',
  completed: 'completed',
  closed: 'completed',
  lost: 'lost',
});

const LEAD_PIPELINE_STAGE_ORDER = Object.freeze([
  'new',
  'contacted',
  'info_sent',
  'deal',
  'deposit_received',
  'waiting',
  'completed',
  'closed',
  'lost',
]);

const VALID_LEAD_PIPELINE_STAGES = new Set(LEAD_PIPELINE_STAGE_ORDER);

class LeadStageTransitionError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'LeadStageTransitionError';
    this.statusCode = options.statusCode || 400;
    this.code = options.code || 'lead_stage_transition_error';
    this.currentLead = options.currentLead || null;
  }
}

function cleanText(value, maxLength = 500) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : '';
}

function parseLeadId(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeLeadStage(value) {
  const stage = cleanText(value, 50);
  return VALID_LEAD_PIPELINE_STAGES.has(stage) ? stage : '';
}

function leadStatusForStage(stage) {
  return LEAD_STAGE_TO_STATUS[stage] || '';
}

function requireValidLeadStage(value) {
  const stage = normalizeLeadStage(value);
  if (!stage) {
    throw new LeadStageTransitionError('Некоректний pipeline_stage', {
      statusCode: 400,
      code: 'invalid_pipeline_stage'
    });
  }
  return stage;
}

function normalizeLostReason(value) {
  return cleanText(value, 500);
}

function appendWhereBusinessContext(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `COALESCE(${prefix}business_context, '${DEFAULT_BUSINESS_CONTEXT}') = $2`;
}

async function logLeadStageChange(queryable, { leadId, oldStage, newStage, oldStatus, newStatus, userId, source }) {
  await queryable.query(`
    INSERT INTO lead_interactions (lead_id, user_id, type, summary, details, created_at)
    VALUES ($1, $2, 'status_change', $3, $4::jsonb, NOW())
  `, [
    leadId,
    userId || null,
    `Pipeline: ${oldStage || 'new'} -> ${newStage || 'new'}`,
    JSON.stringify({
      oldStage: oldStage || 'new',
      newStage: newStage || 'new',
      oldStatus: oldStatus || null,
      newStatus: newStatus || null,
      source: source || 'leadStageTransition'
    })
  ]);
}

function transitionChanged(previousLead = {}, updatedLead = {}, targetStage = '') {
  const oldStage = previousLead.pipeline_stage || 'new';
  const newStage = updatedLead.pipeline_stage || targetStage || 'new';
  return {
    oldStage,
    newStage,
    oldStatus: previousLead.status || leadStatusForStage(oldStage) || 'new',
    newStatus: updatedLead.status || leadStatusForStage(newStage) || 'new',
    changed: oldStage !== newStage,
    enteredDepositStage: oldStage !== 'deposit_received' && newStage === 'deposit_received'
  };
}

async function updateBookingOnly(queryable, { leadId, businessContext, bookingId }) {
  if (!bookingId) return null;
  const result = await queryable.query(
    `UPDATE leads
     SET booking_id = $3,
         booked_at = COALESCE(booked_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
       AND ${appendWhereBusinessContext()}
     RETURNING *`,
    [leadId, businessContext, String(bookingId)]
  );
  return result.rows[0] || null;
}

async function transitionLeadStage(queryable, options = {}) {
  const leadId = parseLeadId(options.leadId);
  const businessContext = normalizeBusinessContext(options.businessContext) || DEFAULT_BUSINESS_CONTEXT;
  const targetStage = requireValidLeadStage(options.targetStage || options.pipelineStage);
  const targetStatus = leadStatusForStage(targetStage);
  const lostReason = normalizeLostReason(options.lostReason);
  const source = cleanText(options.source, 100) || 'leadStageTransition';
  const bookingId = cleanText(options.bookingId, 120);
  const allowedFromStages = options.allowedFromStages instanceof Set
    ? options.allowedFromStages
    : (Array.isArray(options.allowedFromStages) ? new Set(options.allowedFromStages) : null);

  if (!leadId) {
    throw new LeadStageTransitionError('Некоректний ID ліда', {
      statusCode: 400,
      code: 'invalid_lead_id'
    });
  }
  if (targetStage === 'lost' && !lostReason) {
    throw new LeadStageTransitionError('Для етапу lost потрібна причина втрати', {
      statusCode: 400,
      code: 'lost_reason_required'
    });
  }

  const previousResult = await queryable.query(
    `SELECT *
     FROM leads
     WHERE id = $1
       AND ${appendWhereBusinessContext()}
     FOR UPDATE`,
    [leadId, businessContext]
  );
  const previousLead = previousResult.rows[0] || null;
  if (!previousLead) {
    throw new LeadStageTransitionError('Lead not found', {
      statusCode: 404,
      code: 'lead_not_found'
    });
  }

  const oldStage = previousLead.pipeline_stage || 'new';
  if (allowedFromStages && !allowedFromStages.has(oldStage)) {
    const bookingUpdatedLead = await updateBookingOnly(queryable, { leadId, businessContext, bookingId });
    return {
      previousLead,
      updatedLead: bookingUpdatedLead || previousLead,
      oldStage,
      newStage: bookingUpdatedLead?.pipeline_stage || oldStage,
      oldStatus: previousLead.status || leadStatusForStage(oldStage) || 'new',
      newStatus: bookingUpdatedLead?.status || previousLead.status || leadStatusForStage(oldStage) || 'new',
      changed: false,
      enteredDepositStage: false,
      skipped: true,
      skipReason: 'stage_not_allowed'
    };
  }

  const updates = [
    'pipeline_stage = $3',
    'status = $4',
    'updated_at = NOW()'
  ];
  const params = [leadId, businessContext, targetStage, targetStatus];
  if (targetStatus === 'booked') updates.push('booked_at = COALESCE(booked_at, NOW())');
  if (targetStatus === 'contact') updates.push('last_contact_at = COALESCE(last_contact_at, NOW())');
  if (targetStage === 'lost') {
    params.push(lostReason);
    updates.push(`lost_reason = $${params.length}`);
  }
  if (bookingId) {
    params.push(bookingId);
    updates.push(`booking_id = $${params.length}`);
  }

  const updatedResult = await queryable.query(
    `UPDATE leads
     SET ${updates.join(', ')}
     WHERE id = $1
       AND ${appendWhereBusinessContext()}
     RETURNING *`,
    params
  );
  const updatedLead = updatedResult.rows[0] || previousLead;
  const transition = transitionChanged(previousLead, updatedLead, targetStage);
  if (transition.changed) {
    await logLeadStageChange(queryable, {
      leadId,
      oldStage: transition.oldStage,
      newStage: transition.newStage,
      oldStatus: transition.oldStatus,
      newStatus: transition.newStatus,
      userId: options.userId || null,
      source
    });
  }

  return {
    previousLead,
    updatedLead,
    ...transition,
    skipped: false,
    skipReason: null
  };
}

module.exports = {
  LEAD_STAGE_TO_STATUS,
  LEAD_PIPELINE_STAGE_ORDER,
  VALID_LEAD_PIPELINE_STAGES,
  LeadStageTransitionError,
  normalizeLeadStage,
  leadStatusForStage,
  transitionLeadStage
};
