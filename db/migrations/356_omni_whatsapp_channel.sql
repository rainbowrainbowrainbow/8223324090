-- MIGRATION_KIND: schema
-- SAFETY: Replaces the conversations.channel CHECK constraint only to allow the whatsapp Omni channel; no rows are inserted, updated, or deleted.
-- ROLLBACK: Resolve or remove whatsapp conversations first, then restore the previous channel CHECK without whatsapp.
-- OPERATOR_APPROVAL: required

DO $$
DECLARE
    old_constraint_name text;
BEGIN
    SELECT conname
      INTO old_constraint_name
      FROM pg_constraint
     WHERE conrelid = 'conversations'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%channel%'
       AND pg_get_constraintdef(oid) ILIKE '%telegram%'
       AND pg_get_constraintdef(oid) ILIKE '%instagram%'
     ORDER BY CASE WHEN conname = 'conversations_channel_check_v356' THEN 1 ELSE 0 END
     LIMIT 1;

    IF old_constraint_name IS NOT NULL AND old_constraint_name <> 'conversations_channel_check_v356' THEN
        EXECUTE format('ALTER TABLE conversations DROP CONSTRAINT %I', old_constraint_name);
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'conversations'::regclass
           AND conname = 'conversations_channel_check_v356'
    ) THEN
        ALTER TABLE conversations
            ADD CONSTRAINT conversations_channel_check_v356
            CHECK (channel IN ('telegram','viber','sms','facebook','instagram','whatsapp','binotel'));
    END IF;
END $$;
