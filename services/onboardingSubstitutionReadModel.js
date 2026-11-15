'use strict';

const { DEFAULT_BUSINESS_CONTEXT } = require('./businessContext');

function onboardingSubstitutionColumn(alias) {
    return `(SELECT jsonb_build_object('id', s.id::text, 'state', s.state)
        FROM staff_substitutions s
        WHERE s.business_context = '${DEFAULT_BUSINESS_CONTEXT}'
          AND s.source_type = 'onboarding' AND s.source_id = ${alias}.id::text AND s.state <> 'cancelled'
        ORDER BY (s.state = 'active') DESC, s.work_date DESC, s.id DESC
        LIMIT 1) AS substitution`;
}

module.exports = { onboardingSubstitutionColumn };
