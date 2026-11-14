-- MIGRATION_KIND: schema
-- SAFETY: Adds Park greeting occurrence safeguards and audited scheduling; existing rows are not rewritten.
-- ROLLBACK: Resolve occurrence claims before reverting the application; retain ledger and history.

CREATE UNIQUE INDEX IF NOT EXISTS uq_afisha_occurrence_substitution_v404
    ON staff_substitutions(business_context,source_id,slot_key)
    WHERE source_type='afisha' AND slot_key LIKE '%:%' AND state<>'cancelled';

CREATE OR REPLACE FUNCTION guard_afisha_greeting_substitution_v399()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    event_ids INTEGER[];
BEGIN
    IF TG_TABLE_NAME='afisha' THEN
        IF (NEW.type,NEW.original_time) IS NOT DISTINCT FROM (OLD.type,OLD.original_time) THEN RETURN NEW; END IF;
        event_ids:=ARRAY[OLD.id];
    ELSIF TG_OP='INSERT' THEN
        event_ids:=ARRAY[NEW.afisha_id];
    ELSE
        IF TG_OP='UPDATE' AND (NEW.afisha_id,NEW.slot_key,NEW.time,NEW.mode)
            IS NOT DISTINCT FROM (OLD.afisha_id,OLD.slot_key,OLD.time,OLD.mode) THEN RETURN NEW; END IF;
        event_ids:=ARRAY[OLD.afisha_id];
        IF TG_OP='UPDATE' THEN event_ids:=array_append(event_ids,NEW.afisha_id); END IF;
    END IF;
    PERFORM 1 FROM afisha WHERE id=ANY(event_ids) ORDER BY id FOR NO KEY UPDATE;
    IF EXISTS (SELECT 1 FROM staff_substitutions WHERE business_context='event_genix' AND source_type='afisha'
        AND source_id=ANY(event_ids::text[]) AND state='active'
        AND slot_key NOT LIKE '%:%' AND source_snapshot->'event'->>'type'='greeting') THEN
        RAISE EXCEPTION 'Вітання має активну погоджену підміну.'
            USING ERRCODE='23514', CONSTRAINT='afisha_greeting_substitution_active_guard';
    END IF;
    RETURN COALESCE(NEW,OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION lock_afisha_substitution_days_v404(days TEXT[])
RETURNS VOID LANGUAGE plpgsql AS $function$
DECLARE
    work_day TEXT;
BEGIN
    FOR work_day IN SELECT DISTINCT value FROM unnest(days) value WHERE value IS NOT NULL ORDER BY value LOOP
        IF NOT pg_try_advisory_xact_lock(hashtext('afisha_greeting_day_v404'),hashtext(work_day)) THEN
            RAISE EXCEPTION 'Розклад Афіші на цей день уже змінюється. Повторіть дію.'
                USING ERRCODE='23514', CONSTRAINT='afisha_substitution_schedule_busy';
        END IF;
    END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION afisha_greeting_minutes_v404(value TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE STRICT AS $function$
    SELECT CASE WHEN value ~ '^([01][0-9]|2[0-3]):[0-5][0-9]' THEN
        substring(value,1,2)::integer*60+substring(value,4,2)::integer END
$function$;

CREATE OR REPLACE FUNCTION guard_afisha_occurrence_write_v404()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    before_row JSONB;
    after_row JSONB;
    days TEXT[];
    event_id TEXT;
BEGIN
    IF TG_OP<>'INSERT' THEN before_row:=to_jsonb(OLD); END IF;
    IF TG_OP<>'DELETE' THEN after_row:=to_jsonb(NEW); END IF;
    IF TG_TABLE_NAME='bookings' THEN
        IF (before_row IS NULL OR COALESCE(before_row->>'business_context','event_genix')<>'event_genix')
            AND (after_row IS NULL OR COALESCE(after_row->>'business_context','event_genix')<>'event_genix') THEN RETURN COALESCE(NEW,OLD); END IF;
        IF TG_OP='UPDATE' AND (NEW.date,NEW.time,NEW.duration,NEW.line_id,NEW.status,NEW.business_context)
            IS NOT DISTINCT FROM (OLD.date,OLD.time,OLD.duration,OLD.line_id,OLD.status,OLD.business_context)
            THEN RETURN NEW; END IF;
        IF COALESCE(before_row->>'business_context','event_genix')='event_genix' THEN days:=array_append(days,before_row->>'date'); END IF;
        IF COALESCE(after_row->>'business_context','event_genix')='event_genix' THEN days:=array_append(days,after_row->>'date'); END IF;
    ELSIF TG_TABLE_NAME='afisha' THEN
        IF TG_OP='UPDATE' AND (NEW.date,NEW.time,NEW.original_time,NEW.duration,NEW.type,NEW.line_id,NEW.second_line_id)
            IS NOT DISTINCT FROM (OLD.date,OLD.time,OLD.original_time,OLD.duration,OLD.type,OLD.line_id,OLD.second_line_id)
            THEN RETURN NEW; END IF;
        days:=ARRAY[before_row->>'date',after_row->>'date'];
        event_id:=before_row->>'id';
    ELSIF TG_TABLE_NAME='afisha_birthday_slots' THEN
        SELECT array_agg(date) INTO days FROM afisha WHERE id IN ((before_row->>'afisha_id')::integer,(after_row->>'afisha_id')::integer);
        IF EXISTS (SELECT 1 FROM staff_substitutions WHERE business_context='event_genix' AND source_type='afisha'
            AND state='completed' AND ((before_row->>'afisha_id'=source_id AND before_row->>'slot_key'=split_part(slot_key,':',1))
                OR (after_row->>'afisha_id'=source_id AND after_row->>'slot_key'=split_part(slot_key,':',1)))) THEN
            RAISE EXCEPTION 'Час зафіксованого вітання вже погоджено.'
                USING ERRCODE='23514', CONSTRAINT='afisha_substitution_schedule_conflict';
        END IF;
        IF TG_OP='UPDATE' AND (NEW.afisha_id,NEW.slot_key) IS DISTINCT FROM (OLD.afisha_id,OLD.slot_key) THEN
            RAISE EXCEPTION 'Ключ слота вітання не можна змінити.'
                USING ERRCODE='23514', CONSTRAINT='afisha_substitution_schedule_conflict';
        END IF;
    ELSE
        IF NEW.business_context<>'event_genix' OR NEW.source_type<>'afisha' OR NEW.slot_key NOT LIKE '%:%' THEN RETURN NEW; END IF;
        IF TG_OP='INSERT' AND EXISTS (SELECT 1 FROM staff_substitutions
            WHERE business_context='event_genix' AND source_type='afisha' AND source_id=NEW.source_id AND state<>'cancelled'
                AND slot_key=split_part(NEW.slot_key,':',2)) THEN
            RAISE EXCEPTION 'Вітання вже має погоджену підміну.'
                USING ERRCODE='23514', CONSTRAINT='afisha_substitution_schedule_conflict';
        END IF;
        days:=ARRAY[NEW.work_date::text];
    END IF;
    PERFORM lock_afisha_substitution_days_v404(days);
    IF TG_TABLE_NAME='afisha_birthday_slots' AND EXISTS (SELECT 1 FROM staff_substitutions
        WHERE business_context='event_genix' AND source_type='afisha' AND state='active'
            AND source_id=COALESCE(after_row->>'afisha_id',before_row->>'afisha_id')
            AND slot_key LIKE COALESCE(after_row->>'slot_key',before_row->>'slot_key')||':%') THEN
        RAISE EXCEPTION 'Вітання має погоджену підміну. Автоматичний режим переносить її після перевірки доступності.'
            USING ERRCODE='23514', CONSTRAINT='afisha_substitution_schedule_conflict';
    END IF;
    IF event_id IS NOT NULL AND EXISTS (SELECT 1 FROM staff_substitutions WHERE business_context='event_genix'
        AND source_type='afisha' AND source_id=event_id AND slot_key LIKE '%:%' AND state<>'cancelled') THEN
        IF TG_OP='DELETE' OR (NEW.date,NEW.type,NEW.original_time,NEW.time,NEW.duration,NEW.line_id,NEW.second_line_id)
            IS DISTINCT FROM (OLD.date,OLD.type,OLD.original_time,OLD.time,OLD.duration,OLD.line_id,OLD.second_line_id) THEN
            RAISE EXCEPTION 'Вітання має погоджену підміну. Використайте редактор конкретного слота.'
                USING ERRCODE='23514', CONSTRAINT='afisha_substitution_schedule_conflict';
        END IF;
    END IF;
    RETURN COALESCE(NEW,OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION reconcile_afisha_substitution_day_v404(day_value TEXT)
RETURNS VOID LANGUAGE plpgsql AS $function$
DECLARE
    slot RECORD;
    claim RECORD;
    candidates INT4RANGE[];
    occupied INT4RANGE[];
    candidate INT4RANGE;
    line_obstacles INT4RANGE[];
    chosen INTEGER;
    selected_time TEXT;
    work_start TIMESTAMPTZ;
    work_end TIMESTAMPTZ;
    revised_input JSONB;
    revised_quote JSONB;
    revised_source JSONB;
    summary_before JSONB;
    summary_after JSONB;
BEGIN
    IF day_value IS NULL OR day_value !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN; END IF;
    IF NOT EXISTS (SELECT 1 FROM staff_substitutions WHERE work_date=day_value::date
        AND business_context='event_genix' AND source_type='afisha' AND slot_key LIKE '%:%' AND state='active') THEN RETURN; END IF;

    -- Match projectBirthdaySlots: reserve manual slots first, then allocate automatic slots in event order.
    SELECT COALESCE(array_agg(int4range(m,m+duration)),ARRAY[]::INT4RANGE[]) INTO occupied
      FROM (SELECT afisha_greeting_minutes_v404(time) AS m, COALESCE(NULLIF(duration,0),60) AS duration
        FROM afisha WHERE date=day_value AND type IS DISTINCT FROM 'greeting' AND type IS DISTINCT FROM 'birthday') obstacles
      WHERE m IS NOT NULL AND duration>0;

    FOR slot IN
        WITH slots AS (
            SELECT a.id, d.occurrence, d.sequence,
                CASE d.occurrence WHEN 'first' THEN '14:00' WHEN 'second' THEN '18:00'
                    ELSE left(COALESCE(NULLIF(a.original_time,''),a.time),5) END AS base_time,
                a.time, a.line_id, a.second_line_id, bs.mode, bs.time AS manual_time,
                p.source_snapshot->>'replacementLineId' AS primary_override,
                s.source_snapshot->>'replacementLineId' AS second_override,
                COALESCE(CASE WHEN p.state='completed' THEN p.source_snapshot->>'time' END,
                    CASE WHEN s.state='completed' THEN s.source_snapshot->>'time' END) AS completed_time
            FROM afisha a CROSS JOIN LATERAL (
                VALUES ('first',1,a.type='birthday'),('second',2,a.type='birthday'),('single',1,a.type='greeting')
            ) d(occurrence,sequence,valid)
            LEFT JOIN afisha_birthday_slots bs ON bs.afisha_id=a.id AND bs.slot_key=d.occurrence
            LEFT JOIN staff_substitutions p ON p.business_context='event_genix' AND p.source_type='afisha' AND p.source_id=a.id::text
                AND p.slot_key=d.occurrence||':primary' AND p.state<>'cancelled'
            LEFT JOIN staff_substitutions s ON s.business_context='event_genix' AND s.source_type='afisha' AND s.source_id=a.id::text
                AND s.slot_key=d.occurrence||':second' AND s.state<>'cancelled'
            WHERE a.date=day_value AND d.valid
        )
        , fixed AS (SELECT *, COALESCE(completed_time,CASE WHEN mode='manual' THEN manual_time
            WHEN mode IS NULL AND occurrence='single' AND time<>base_time THEN left(time,5) END) AS fixed_time FROM slots)
        SELECT *, array_agg(int4range(afisha_greeting_minutes_v404(fixed_time),afisha_greeting_minutes_v404(fixed_time)+15))
            FILTER (WHERE fixed_time IS NOT NULL) OVER () AS fixed_obstacles
        FROM fixed ORDER BY fixed_time IS NULL,id,sequence
    LOOP
        chosen:=afisha_greeting_minutes_v404(COALESCE(slot.fixed_time,slot.base_time));
        IF chosen IS NULL THEN CONTINUE; END IF;
        SELECT COALESCE(array_agg(int4range(book_start,book_start+b.duration)),ARRAY[]::INT4RANGE[]) INTO line_obstacles
          FROM bookings b CROSS JOIN LATERAL (SELECT afisha_greeting_minutes_v404(b.time) AS book_start) start_time
          WHERE b.date=day_value AND COALESCE(b.business_context,'event_genix')='event_genix'
            AND lower(COALESCE(NULLIF(btrim(b.status),''),'confirmed'))<>'cancelled'
            AND b.line_id IS NOT NULL AND b.duration>0 AND book_start IS NOT NULL
            AND (COALESCE(slot.primary_override,slot.line_id,slot.second_override,slot.second_line_id) IS NULL
                OR b.line_id IN (COALESCE(slot.primary_override,slot.line_id),COALESCE(slot.second_override,slot.second_line_id)));
        IF slot.fixed_time IS NULL THEN
            SELECT array_agg(int4range(chosen+delta,chosen+delta+15) ORDER BY abs(delta),delta DESC) INTO candidates
              FROM generate_series(-90,90,5) delta
              WHERE chosen+delta >= CASE WHEN extract(isodow FROM day_value::date)>=6 THEN 600 ELSE 720 END
                  AND chosen+delta+15<=1200;
            SELECT span INTO candidate FROM unnest(candidates) span
              WHERE NOT (span && ANY(occupied)) AND NOT (span && ANY(line_obstacles))
              ORDER BY abs(lower(span)-chosen), lower(span) DESC LIMIT 1;
        ELSE
            candidate:=int4range(chosen,chosen+15);
            -- Manual slots reserve their time even when another fixed event overlaps.
            IF candidate && ANY(occupied) OR candidate && ANY(line_obstacles) OR
                (SELECT count(*) FROM unnest(slot.fixed_obstacles) other WHERE candidate && other)>1 THEN
                    IF EXISTS (SELECT 1 FROM staff_substitutions WHERE business_context='event_genix' AND source_type='afisha'
                        AND state='active' AND source_id=slot.id::text AND split_part(slot_key,':',1)=slot.occurrence) THEN
                        RAISE EXCEPTION 'Погоджене вітання перетинається з іншою роботою.'
                            USING ERRCODE='23514', CONSTRAINT='afisha_substitution_schedule_conflict';
                    END IF;
            END IF;
        END IF;

        FOR claim IN SELECT * FROM staff_substitutions WHERE business_context='event_genix' AND source_type='afisha'
            AND state='active' AND source_id=slot.id::text AND split_part(slot_key,':',1)=slot.occurrence
            AND slot_key LIKE '%:%' ORDER BY id
        LOOP
            IF candidate IS NULL OR COALESCE(slot.primary_override,slot.line_id)=COALESCE(slot.second_override,slot.second_line_id) THEN
                RAISE EXCEPTION 'Для погодженого вітання немає доступного слота.'
                    USING ERRCODE='23514', CONSTRAINT='afisha_substitution_schedule_conflict';
            END IF;
            selected_time:=lpad((lower(candidate)/60)::text,2,'0')||':'||lpad((lower(candidate)%60)::text,2,'0');
            IF selected_time=claim.source_snapshot->>'time' THEN CONTINUE; END IF;
            IF COALESCE(claim.source_snapshot->>'mode','manual')<>'auto' OR slot.fixed_time IS NOT NULL THEN
                RAISE EXCEPTION 'Час зафіксованого вітання вже погоджено.'
                    USING ERRCODE='23514', CONSTRAINT='afisha_substitution_schedule_conflict';
            END IF;
            work_start:=(day_value::date+make_time(lower(candidate)/60,lower(candidate)%60,0)) AT TIME ZONE 'Europe/Kyiv';
            work_end:=work_start+interval '15 minutes';
            IF NOT pg_try_advisory_xact_lock(hashtext('eventgenix-payroll-period:'||left(day_value,7)))
                OR NOT pg_try_advisory_xact_lock(hashtextextended('eventgenix:payroll-period:'||left(day_value,7),0))
                OR NOT pg_try_advisory_xact_lock_shared(hashtextextended('eventgenix:attendance-write:maintenance:v1',0))
                OR NOT pg_try_advisory_xact_lock(hashtextextended('eventgenix:attendance-write:v1:'||claim.staff_id||':'||day_value,0))
                OR NOT pg_try_advisory_xact_lock(hashtextextended('eventgenix:attendance-write:v1:'||claim.original_staff_id||':'||day_value,0)) THEN
                RAISE EXCEPTION 'Графік або облік зміни зараз оновлюється. Повторіть дію.'
                    USING ERRCODE='23514', CONSTRAINT='afisha_substitution_schedule_busy';
            END IF;
            BEGIN
                PERFORM 1 FROM staff WHERE id IN (claim.staff_id,claim.original_staff_id) ORDER BY id FOR UPDATE NOWAIT;
            EXCEPTION WHEN lock_not_available THEN
                RAISE EXCEPTION 'Графік аніматора зараз оновлюється. Повторіть дію.'
                    USING ERRCODE='23514', CONSTRAINT='afisha_substitution_schedule_busy';
            END;
            IF NOT EXISTS (
                SELECT 1 FROM staff s JOIN staff_schedule ss ON ss.staff_id=s.id AND ss.date=day_value
                JOIN hr_shifts h ON h.staff_id=s.id AND h.shift_date=day_value::date
                JOIN hr_shift_segments seg ON seg.hr_shift_id=h.id
                WHERE s.id=claim.staff_id AND s.is_active AND COALESCE(s.hr_pool_status,'core')='core' AND NOT COALESCE(s.is_freelance,false)
                    AND (s.termination_date IS NULL OR s.termination_date::date>day_value::date)
                    AND ss.status IN ('working','remote')
                    AND (seg.profession_key='animator' OR EXISTS (SELECT 1 FROM hr_shift_segment_roles sr
                        WHERE sr.segment_id=seg.id AND sr.profession_key='animator'))
                    AND ((afisha_greeting_minutes_v404(seg.planned_start::text)<=lower(candidate)
                        AND (afisha_greeting_minutes_v404(seg.planned_end::text)>=upper(candidate)
                            OR seg.planned_end<seg.planned_start))
                        OR (seg.planned_end<seg.planned_start AND afisha_greeting_minutes_v404(seg.planned_end::text)>=upper(candidate)))
            ) OR EXISTS (
                SELECT 1 FROM hr_time_records WHERE staff_id IN (claim.staff_id,claim.original_staff_id) AND record_date=claim.work_date
                    AND (clock_in IS NOT NULL OR clock_out IS NOT NULL OR total_worked_minutes>0)
            ) OR EXISTS (
                SELECT 1 FROM payroll_period_locks WHERE period_month=left(day_value,7) AND is_locked
            ) OR EXISTS (
                SELECT 1 FROM payroll_reports pr WHERE pr.staff_id IN (claim.staff_id,claim.original_staff_id)
                    AND pr.period_month=left(day_value,7) AND (pr.status<>'draft' OR EXISTS (
                        SELECT 1 FROM payroll_installments pi WHERE pi.payroll_report_id=pr.id AND (pi.workflow_status<>'draft' OR EXISTS (
                            SELECT 1 FROM payroll_payment_movements ppm WHERE ppm.installment_id=pi.id))))
            ) OR EXISTS (
                SELECT 1 FROM tasks t JOIN employee_profiles ep ON ep.user_id=t.owner_user_id WHERE ep.staff_id=claim.staff_id
                    AND t.status NOT IN ('done','cancelled','archived') AND t.scheduled_start_at<work_end AND t.scheduled_end_at>work_start
            ) OR EXISTS (
                SELECT 1 FROM staff_substitutions other WHERE other.staff_id=claim.staff_id AND other.id<>claim.id
                    AND other.state<>'cancelled' AND other.work_date BETWEEN claim.work_date-1 AND claim.work_date+1
                    AND NOT (other.source_type='afisha' AND other.state='active' AND other.slot_key LIKE '%:%'
                        AND other.work_date=claim.work_date)
                    AND (other.input_json->>'startsAt')::timestamptz<work_end AND (other.input_json->>'endsAt')::timestamptz>work_start
            ) THEN
                RAISE EXCEPTION 'Аніматор недоступний у новий час погодженого вітання.'
                    USING ERRCODE='23514', CONSTRAINT='afisha_substitution_schedule_conflict';
            END IF;
            revised_input:=claim.input_json||jsonb_build_object(
                'startsAt',to_char(work_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'endsAt',to_char(work_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
            revised_source:=jsonb_set(claim.source_snapshot,'{time}',to_jsonb(selected_time));
            revised_quote:=jsonb_set(jsonb_set(claim.quote_json,'{input}',revised_input),'{evidence,source}',revised_source)-'fingerprint';
            summary_before:=jsonb_build_object('id',claim.id::text,'version',claim.version,'state',claim.state,
                'input',claim.input_json,'quote',claim.quote_json,'source',claim.source_snapshot);
            summary_after:=jsonb_build_object('id',claim.id::text,'version',claim.version+1,'state',claim.state,
                'input',revised_input,'quote',revised_quote,'source',revised_source);
            UPDATE staff_substitutions SET input_json=revised_input,quote_json=revised_quote,source_snapshot=revised_source,
                version=version+1,updated_at=NOW() WHERE id=claim.id;
            INSERT INTO staff_substitution_events(substitution_id,version,action,actor,reason,before_json,after_json)
            VALUES(claim.id,claim.version+1,'revise','afisha_scheduler','Greeting moved with its occurrence',summary_before,summary_after);
        END LOOP;
        occupied:=array_append(occupied,COALESCE(candidate,int4range(chosen,chosen+15)));
    END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION reconcile_afisha_substitutions_after_write_v404()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    before_row JSONB;
    after_row JSONB;
    old_day TEXT;
    new_day TEXT;
BEGIN
    IF TG_OP<>'INSERT' THEN before_row:=to_jsonb(OLD); END IF;
    IF TG_OP<>'DELETE' THEN after_row:=to_jsonb(NEW); END IF;
    IF TG_TABLE_NAME='afisha_birthday_slots' THEN
        SELECT date INTO old_day FROM afisha WHERE id=(before_row->>'afisha_id')::integer;
        SELECT date INTO new_day FROM afisha WHERE id=(after_row->>'afisha_id')::integer;
    ELSIF TG_TABLE_NAME='staff_substitutions' THEN
        IF NEW.business_context<>'event_genix' OR NEW.source_type<>'afisha' OR NEW.slot_key NOT LIKE '%:%'
            OR (TG_OP='UPDATE' AND NEW.state=OLD.state) THEN RETURN NULL; END IF;
        new_day:=NEW.work_date::text;
    ELSE
        IF TG_OP='UPDATE' AND (before_row - ARRAY['updated_at','updated_at_version_token']) IS NOT DISTINCT FROM
            (after_row - ARRAY['updated_at','updated_at_version_token']) THEN RETURN NULL; END IF;
        IF TG_TABLE_NAME='bookings' THEN
            IF TG_OP='UPDATE' AND (NEW.date,NEW.time,NEW.duration,NEW.line_id,NEW.status,NEW.business_context)
                IS NOT DISTINCT FROM (OLD.date,OLD.time,OLD.duration,OLD.line_id,OLD.status,OLD.business_context) THEN RETURN NULL; END IF;
            IF (before_row IS NULL OR COALESCE(before_row->>'business_context','event_genix')<>'event_genix')
                AND (after_row IS NULL OR COALESCE(after_row->>'business_context','event_genix')<>'event_genix') THEN RETURN NULL; END IF;
        END IF;
        old_day:=before_row->>'date';
        new_day:=after_row->>'date';
    END IF;
    PERFORM reconcile_afisha_substitution_day_v404(old_day);
    IF new_day IS DISTINCT FROM old_day THEN PERFORM reconcile_afisha_substitution_day_v404(new_day); END IF;
    RETURN NULL;
END;
$function$;

DO $migration$
DECLARE
    target TEXT;
BEGIN
    FOREACH target IN ARRAY ARRAY['afisha','afisha_birthday_slots','bookings','staff_substitutions'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='afisha_substitution_write_v404' AND tgrelid=target::regclass) THEN
            EXECUTE format('CREATE TRIGGER afisha_substitution_write_v404 BEFORE %s ON %I FOR EACH ROW EXECUTE FUNCTION guard_afisha_occurrence_write_v404()',
                CASE WHEN target='staff_substitutions' THEN 'INSERT OR UPDATE' ELSE 'INSERT OR UPDATE OR DELETE' END,target);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='afisha_substitution_reconcile_v404' AND tgrelid=target::regclass) THEN
            EXECUTE format('CREATE CONSTRAINT TRIGGER afisha_substitution_reconcile_v404 AFTER %s ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconcile_afisha_substitutions_after_write_v404()',
                CASE WHEN target='staff_substitutions' THEN 'INSERT OR UPDATE' ELSE 'INSERT OR UPDATE OR DELETE' END,target);
        END IF;
    END LOOP;
END;
$migration$;
