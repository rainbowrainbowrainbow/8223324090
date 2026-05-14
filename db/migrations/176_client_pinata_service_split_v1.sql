-- MIGRATION_KIND: mixed
-- SAFETY: Additive booking/recurring-template columns plus exact-token pinata mode backfill; no columns or rows are removed.
-- ROLLBACK: Drop idx_bookings_pinata_mode, idx_recurring_templates_pinata_mode, both pinata_mode check constraints, and the added pinata/client-service columns if rollback is required.
-- DATA_SCOPE: All bookings and recurring_templates rows, limited to exact pinata_filler tokens and null/non-null filler state; no fuzzy note/title matching.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS pinata_mode TEXT NULL,
  ADD COLUMN IF NOT EXISTS pinata_number TEXT NULL,
  ADD COLUMN IF NOT EXISTS pinata_filler_number TEXT NULL,
  ADD COLUMN IF NOT EXISTS client_pinata_service_price NUMERIC(10,2) NULL,
  ADD COLUMN IF NOT EXISTS client_pinata_service_note TEXT NULL;

ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS pinata_mode TEXT NULL,
  ADD COLUMN IF NOT EXISTS pinata_number TEXT NULL,
  ADD COLUMN IF NOT EXISTS pinata_filler_number TEXT NULL,
  ADD COLUMN IF NOT EXISTS client_pinata_service_price NUMERIC(10,2) NULL,
  ADD COLUMN IF NOT EXISTS client_pinata_service_note TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_pinata_mode_check'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_pinata_mode_check
      CHECK (pinata_mode IS NULL OR pinata_mode IN ('none', 'park', 'client'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'recurring_templates_pinata_mode_check'
  ) THEN
    ALTER TABLE recurring_templates
      ADD CONSTRAINT recurring_templates_pinata_mode_check
      CHECK (pinata_mode IS NULL OR pinata_mode IN ('none', 'park', 'client'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_pinata_mode ON bookings(pinata_mode);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_pinata_mode ON recurring_templates(pinata_mode);

UPDATE bookings
SET pinata_mode = 'client'
WHERE pinata_mode IS NULL
  AND lower(trim(pinata_filler)) IN (
    'client',
    'own',
    'own pinata',
    'customer',
    'customer pinata',
    'клієнт',
    'клієнта',
    'клієнтська',
    'своя',
    'власна'
  );

UPDATE bookings
SET pinata_mode = 'park'
WHERE pinata_mode IS NULL
  AND NULLIF(trim(pinata_filler), '') IS NOT NULL;

UPDATE bookings
SET pinata_mode = 'none'
WHERE pinata_mode IS NULL
  AND NULLIF(trim(COALESCE(pinata_filler, '')), '') IS NULL;

UPDATE recurring_templates
SET pinata_mode = 'client'
WHERE pinata_mode IS NULL
  AND lower(trim(pinata_filler)) IN (
    'client',
    'own',
    'own pinata',
    'customer',
    'customer pinata',
    'клієнт',
    'клієнта',
    'клієнтська',
    'своя',
    'власна'
  );

UPDATE recurring_templates
SET pinata_mode = 'park'
WHERE pinata_mode IS NULL
  AND NULLIF(trim(pinata_filler), '') IS NOT NULL;

UPDATE recurring_templates
SET pinata_mode = 'none'
WHERE pinata_mode IS NULL
  AND NULLIF(trim(COALESCE(pinata_filler, '')), '') IS NULL;
