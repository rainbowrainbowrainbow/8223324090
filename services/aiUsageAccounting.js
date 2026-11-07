'use strict';

// Read existing durable CRM reservations/receipts, never call a provider or
// count status polling, previews and repeated GETs as new paid operations.
const NATIVE_USAGE_SQL = `
WITH operations AS (
    SELECT created_at AS occurred_at, 'menu_image'::text AS kind, provider,
           NULL::text AS model, status, NULL::jsonb AS receipt, false AS time_inferred
    FROM menu_image_paid_operations WHERE business_context = $1
    UNION ALL
    SELECT created_at, 'attendance_ocr', provider, model, status, provider_receipt, false
    FROM crm_attendance_ocr_executions WHERE business_context = $1
    UNION ALL
    SELECT COALESCE(claimed_at, created_at), 'creative_image',
           CASE WHEN claimed_by = 'crm-creative-kie' THEN 'kie' ELSE 'openai' END,
           result_payload->>'model', status, NULL::jsonb, claimed_at IS NULL
    FROM hermes_jobs
    WHERE COALESCE(business_context, 'event_genix') = $1
      AND job_type = 'creative_material_job'
      AND claimed_by IN ('crm-creative-kie', 'crm-creative')
), bounded AS (
    SELECT *, CASE WHEN jsonb_typeof(receipt->'creditsConsumed') = 'number' THEN
        CASE WHEN (receipt->>'creditsConsumed')::numeric >= 0
             THEN (receipt->>'creditsConsumed')::numeric ELSE NULL END
        ELSE NULL END AS credits
    FROM operations
    WHERE occurred_at >= ($2::date::timestamp AT TIME ZONE 'Europe/Kyiv')
      AND occurred_at < ($3::date::timestamp AT TIME ZONE 'Europe/Kyiv')
)
SELECT to_char(occurred_at AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM-DD') AS day,
       kind, provider, model, status,
       count(*)::integer AS reservations,
       count(credits)::integer AS priced_receipts,
       count(*) FILTER (WHERE credits IS NULL)::integer AS cost_unknown,
       count(*) FILTER (WHERE time_inferred)::integer AS time_inferred,
       COALESCE(sum(credits), 0)::text AS recorded_credits
FROM bounded
GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3, 4, 5`;

function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
        && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
function validateUsageWindow({ businessContext, from, to }) {
    if (!/^[a-z][a-z0-9_]{0,99}$/.test(businessContext || '') || !validDate(from) || !validDate(to)) {
        throw Object.assign(new Error('Invalid AI usage report window'), { code: 'AI_USAGE_INVALID_WINDOW' });
    }
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days < 1 || days > 31) throw Object.assign(new Error('AI usage window must be 1–31 days'), { code: 'AI_USAGE_INVALID_WINDOW' });
    return [businessContext, from, to];
}

async function nativeAiUsageReport(query, input) {
    const params = validateUsageWindow(input);
    const { rows } = await query.query(NATIVE_USAGE_SQL, params);
    const count = value => {
        const n = Number(value);
        if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid accounting count');
        return n;
    };
    const groups = rows.map(row => {
        const credits = Number(row.recorded_credits);
        if (!Number.isFinite(credits) || credits < 0 || !validDate(row.day)) throw new Error('Invalid accounting result');
        return { day: row.day, kind: row.kind, provider: row.provider, model: row.model || null, status: row.status,
            reservations: count(row.reservations), pricedReceipts: count(row.priced_receipts),
            costUnknown: count(row.cost_unknown), timeInferred: count(row.time_inferred), recordedCredits: credits };
    });
    const totals = groups.reduce((sum, row) => {
        for (const key of ['reservations', 'pricedReceipts', 'costUnknown', 'timeInferred', 'recordedCredits']) sum[key] += row[key];
        return sum;
    }, { reservations: 0, pricedReceipts: 0, costUnknown: 0, timeInferred: 0, recordedCredits: 0 });
    return { scope: 'crm_native_menu_creative_actual_attendance', businessContext: input.businessContext,
        from: input.from, toExclusive: input.to, timezone: 'Europe/Kyiv', groups, totals,
        costComplete: totals.costUnknown === 0, invoiceVerified: false, hardBudgetEnforced: false,
        limitations: [
            'Reservations are possible paid attempts, not confirmed billable requests. Polling and previews are excluded.',
            'Recorded credits come only from existing numeric provider receipts; missing costs are unknown, never free.',
            'Legacy generators, external Hermes, catalog automation and other AI integrations are outside this report.',
            'Group by reservation/claim time, not document date; inferred creative timestamps are counted explicitly.',
            'No new daily cap, provider call, retry, queue replay, schema change or receipt mutation is performed.'
        ] };
}

module.exports = { NATIVE_USAGE_SQL, validateUsageWindow, nativeAiUsageReport };
