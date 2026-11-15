'use strict';

// Task reads use the visible task as t. Only agreement metadata leaves the ledger.
const TASK_SUBSTITUTION_SELECT = `(
    SELECT jsonb_build_object('id', s.id::text, 'state', s.state)
    FROM staff_substitutions s
    WHERE s.business_context = COALESCE(t.business_context, 'event_genix')
      AND s.state <> 'cancelled'
      AND (
          (s.source_type = 'task' AND s.source_id = t.id::text)
          OR (s.source_type = 'inbox_reply' AND t.source_type = 'conversation_reply'
              AND s.source_id = t.source_id)
          OR (s.source_type = 'onboarding' AND (
              (t.source_type = 'onboarding' AND s.source_id = split_part(t.source_id, ':', 1))
              OR (t.source_module = 'hr_onboarding' AND t.related_entity_type = 'onboarding_progress'
                  AND s.source_id = t.related_entity_id)
          ))
      )
    ORDER BY (s.state = 'active') DESC, s.work_date DESC, s.id DESC
    LIMIT 1
) AS substitution`;

module.exports = { TASK_SUBSTITUTION_SELECT };
