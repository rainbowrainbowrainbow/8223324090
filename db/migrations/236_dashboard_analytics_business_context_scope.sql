-- MIGRATION_KIND: schema
-- SAFETY: Additive business_context columns for dashboard/analytics HR/review/pulse aggregates. Existing rows stay in the legacy event_genix context; no rows are deleted or reassigned.
-- ROLLBACK: Drop the added scoped indexes, then drop business_context from hr_time_records, staff_schedule, event_reviews, and team_pulse after exporting any non-event_genix analytics data.

ALTER TABLE hr_time_records
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE staff_schedule
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE event_reviews
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

ALTER TABLE team_pulse
    ADD COLUMN IF NOT EXISTS business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix';

UPDATE hr_time_records
   SET business_context = 'event_genix'
 WHERE business_context IS NULL OR business_context = '';

UPDATE staff_schedule
   SET business_context = 'event_genix'
 WHERE business_context IS NULL OR business_context = '';

UPDATE event_reviews er
   SET business_context = COALESCE(b.business_context, er.business_context, 'event_genix')
  FROM bookings b
 WHERE er.booking_id = b.id
   AND COALESCE(er.business_context, 'event_genix') <> COALESCE(b.business_context, 'event_genix');

UPDATE event_reviews
   SET business_context = 'event_genix'
 WHERE business_context IS NULL OR business_context = '';

UPDATE team_pulse
   SET business_context = 'event_genix'
 WHERE business_context IS NULL OR business_context = '';

CREATE INDEX IF NOT EXISTS idx_hr_time_records_business_date
    ON hr_time_records(business_context, record_date);

CREATE INDEX IF NOT EXISTS idx_staff_schedule_business_date
    ON staff_schedule(business_context, date, status);

CREATE INDEX IF NOT EXISTS idx_event_reviews_business_created
    ON event_reviews(business_context, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_team_pulse_business_date
    ON team_pulse(business_context, date);
