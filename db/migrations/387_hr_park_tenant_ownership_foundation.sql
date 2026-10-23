-- MIGRATION_KIND: schema
-- SAFETY: Additive nullable ownership columns, same-owner constraints and explicit Park views for six legacy HR tables. No legacy row, role, membership, rate or account is backfilled. Existing unique keys remain in place.
-- ROLLBACK: Before application cutover keep the preceding binary and leave additive objects in place. After cutover restore the preceding binary only under the reviewed writer handoff. A separately approved inventory-bound rollback clears owner columns child-first; do not drop columns or overwrite post-cutover records.
-- OPERATOR_APPROVAL: required before production schema deployment and the separate inventory-bound backfill.

DO $migration$
DECLARE
    relation_name text;
    constraint_name text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY['hr_professions', 'hr_profession_checklist_items',
        'hr_staff_profession_checklist_progress', 'staff_role_assignments',
        'onboarding_templates', 'onboarding_progress'] LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS business_id BIGINT, ADD COLUMN IF NOT EXISTS organization_id BIGINT', relation_name);
        constraint_name := 'hr_owner_pair_' || relation_name;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || relation_name)::regclass AND conname = constraint_name) THEN
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ((business_id IS NULL) = (organization_id IS NULL))', relation_name, constraint_name);
        END IF;
        constraint_name := 'hr_owner_business_' || relation_name;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || relation_name)::regclass AND conname = constraint_name) THEN
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (business_id) REFERENCES public.businesses(id) DEFERRABLE INITIALLY IMMEDIATE', relation_name, constraint_name);
        END IF;
        constraint_name := 'hr_owner_org_' || relation_name;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || relation_name)::regclass AND conname = constraint_name) THEN
            EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES public.organizations(id) DEFERRABLE INITIALLY IMMEDIATE', relation_name, constraint_name);
        END IF;
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (business_id, organization_id)', 'idx_hr_owner_' || relation_name, relation_name);
    END LOOP;
END;
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_professions_id_owner ON hr_professions(id, business_id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_professions_key_owner ON hr_professions(key, business_id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_checklist_item_owner ON hr_profession_checklist_items(id, business_id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_onboarding_template_owner ON onboarding_templates(id, business_id, organization_id);

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='hr_profession_checklist_items'::regclass AND conname='fk_hr_item_profession_owner') THEN
        ALTER TABLE hr_profession_checklist_items ADD CONSTRAINT fk_hr_item_profession_owner
            FOREIGN KEY (profession_id, business_id, organization_id) REFERENCES hr_professions(id, business_id, organization_id) DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='staff_role_assignments'::regclass AND conname='fk_hr_assignment_profession_owner') THEN
        ALTER TABLE staff_role_assignments ADD CONSTRAINT fk_hr_assignment_profession_owner
            FOREIGN KEY (profession_key, business_id, organization_id) REFERENCES hr_professions(key, business_id, organization_id) DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='hr_staff_profession_checklist_progress'::regclass AND conname='fk_hr_progress_profession_owner') THEN
        ALTER TABLE hr_staff_profession_checklist_progress ADD CONSTRAINT fk_hr_progress_profession_owner
            FOREIGN KEY (profession_key, business_id, organization_id) REFERENCES hr_professions(key, business_id, organization_id) DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='hr_staff_profession_checklist_progress'::regclass AND conname='fk_hr_progress_item_owner') THEN
        ALTER TABLE hr_staff_profession_checklist_progress ADD CONSTRAINT fk_hr_progress_item_owner
            FOREIGN KEY (checklist_item_id, business_id, organization_id) REFERENCES hr_profession_checklist_items(id, business_id, organization_id) DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='onboarding_progress'::regclass AND conname='fk_hr_onboarding_template_owner') THEN
        ALTER TABLE onboarding_progress ADD CONSTRAINT fk_hr_onboarding_template_owner
            FOREIGN KEY (template_id, business_id, organization_id) REFERENCES onboarding_templates(id, business_id, organization_id) DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='onboarding_progress'::regclass AND conname='fk_hr_onboarding_profession_owner') THEN
        ALTER TABLE onboarding_progress ADD CONSTRAINT fk_hr_onboarding_profession_owner
            FOREIGN KEY (profession_key, business_id, organization_id) REFERENCES hr_professions(key, business_id, organization_id) DEFERRABLE INITIALLY IMMEDIATE;
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION eventgenix_hr_validate_owner() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
    IF NEW.business_id IS NULL AND NEW.organization_id IS NULL THEN RETURN NEW; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.businesses b JOIN public.organizations o ON o.id=b.organization_id
        WHERE b.id=NEW.business_id AND b.organization_id=NEW.organization_id AND b.status='active' AND o.status='active') THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='HR business and organization ownership does not match an active registry record';
    END IF;
    IF TG_TABLE_NAME='hr_staff_profession_checklist_progress' THEN
        -- Legacy unbound items remain an explicit privileged reconciliation state.
        -- The same-owner profession FK still applies; recovery reads exclude these rows.
        IF NEW.checklist_item_id IS NULL THEN RETURN NEW; END IF;
        IF NOT EXISTS (SELECT 1 FROM public.hr_profession_checklist_items i
            JOIN public.hr_professions p ON p.id=i.profession_id
            WHERE i.id=NEW.checklist_item_id AND p.key=NEW.profession_key
              AND i.business_id=NEW.business_id AND i.organization_id=NEW.organization_id
              AND p.business_id=NEW.business_id AND p.organization_id=NEW.organization_id) THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='HR checklist progress parent ownership does not match';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION eventgenix_hr_park_business_id() RETURNS BIGINT LANGUAGE plpgsql STABLE AS $function$
DECLARE owner_id BIGINT;
BEGIN
    SELECT b.id INTO owner_id FROM public.businesses b JOIN public.organizations o ON o.id=b.organization_id
        WHERE b.context_key='event_genix' AND b.status='active' AND o.status='active';
    IF owner_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Active Park HR registry ownership is unavailable';
    END IF;
    RETURN owner_id;
END;
$function$;
CREATE OR REPLACE FUNCTION eventgenix_hr_park_organization_id() RETURNS BIGINT LANGUAGE sql STABLE AS $function$
    SELECT organization_id FROM public.businesses WHERE id=public.eventgenix_hr_park_business_id()
$function$;

-- This namespace intentionally remains Park-only. It is not a second-tenant enablement.
-- Views do not expose missing ownership; no legacy fallback is introduced.
CREATE SCHEMA IF NOT EXISTS hr_owned;
DO $migration$
DECLARE relation_name text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY['hr_professions', 'hr_profession_checklist_items',
        'hr_staff_profession_checklist_progress', 'staff_role_assignments',
        'onboarding_templates', 'onboarding_progress'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=('public.' || relation_name)::regclass AND tgname='hr_validate_owner') THEN
            EXECUTE format('CREATE TRIGGER hr_validate_owner BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.eventgenix_hr_validate_owner()', relation_name);
        END IF;
        EXECUTE format('CREATE OR REPLACE VIEW hr_owned.%I WITH (security_barrier=true) AS SELECT * FROM public.%I WHERE business_id=public.eventgenix_hr_park_business_id() AND organization_id=public.eventgenix_hr_park_organization_id() WITH CASCADED CHECK OPTION', relation_name, relation_name);
    END LOOP;
END;
$migration$;
