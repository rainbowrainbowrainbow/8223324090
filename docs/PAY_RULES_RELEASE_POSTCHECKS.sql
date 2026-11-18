-- Read-only post-deployment inspection, only after migration 423 is applied.
-- Run with the authorized operator connection. Output contains aggregate counts,
-- schema names and migration metadata only. Never paste connection credentials.
-- This file is documentation, not a startup migration or a data-entry script.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT version, applied_at
FROM schema_migrations
WHERE version = '423_configurable_pay_rules';

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
      ('payroll_profile_versions', 'pay_rules'),
      ('payroll_profiles', 'template_origin'),
      ('job_vacancies', 'compensation_template')
  )
ORDER BY table_name, column_name;

-- All counters are expected to be zero immediately after the first schema-only
-- deployment, before any user enters rules. Nonzero values are evidence to
-- preserve, never a reason to reset or delete data.
SELECT 'configured_profile_versions' AS entity, COUNT(*) AS configured_count
FROM payroll_profile_versions WHERE pay_rules IS NOT NULL
UNION ALL
SELECT 'vacancy_templates', COUNT(*) FROM job_vacancies WHERE compensation_template IS NOT NULL
UNION ALL
SELECT 'profile_template_origins', COUNT(*) FROM payroll_profiles WHERE template_origin IS NOT NULL
UNION ALL
SELECT 'company_rule_defaults', COUNT(*) FROM hr_payroll_rule_defaults
UNION ALL
SELECT 'qualification_levels', COUNT(*) FROM hr_qualification_levels
UNION ALL
SELECT 'qualification_events', COUNT(*) FROM hr_staff_qualification_events
UNION ALL
SELECT 'commission_input_versions', COUNT(*) FROM hr_payroll_component_inputs;

ROLLBACK;
