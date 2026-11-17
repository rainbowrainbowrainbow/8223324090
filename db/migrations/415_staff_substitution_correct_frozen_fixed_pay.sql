-- MIGRATION_KIND: schema
-- SAFETY: Extends the existing insert guard for an original payee only when a frozen payroll line identifies the agreement. No stored rows change.
-- ROLLBACK: Disable new fixed-pay corrections in the application while preserving payroll projection for existing entries.

CREATE OR REPLACE FUNCTION guard_staff_substitution_pay_correction_v411()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM staff_substitutions s
        WHERE s.id = NEW.substitution_id AND s.business_context = 'event_genix'
          AND s.state = 'completed' AND s.work_date = NEW.work_date
          AND (
              (NEW.payee = 'replacement' AND s.staff_id = NEW.staff_id)
              OR (NEW.payee = 'original' AND s.original_staff_id = NEW.staff_id AND (
                  s.completion_json #>> '{originalPay,amountMinor}' IS NOT NULL
                  OR (s.completion_json->'originalFixedPay' IS NOT NULL AND EXISTS (
                      SELECT 1
                      FROM payroll_reports pr
                      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(pr.breakdown_json->'lines') = 'array'
                          THEN pr.breakdown_json->'lines' ELSE '[]'::jsonb END) AS line
                      WHERE pr.staff_id=NEW.staff_id AND pr.period_month=to_char(s.work_date, 'YYYY-MM')
                        AND pr.status IN ('reviewed','approved','paid') AND pr.voided_at IS NULL
                        AND line->>'lineType'='staff_substitution' AND line #>> '{meta,substitutionId}'=s.id::text
                        AND line #>> '{meta,payee}'='original' AND jsonb_typeof(line #> '{meta,fixedRetention}')='object'
                  ))
              ))
          )
    ) THEN
        RAISE EXCEPTION 'Correction requires a completed Park substitution and its frozen payee' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;
