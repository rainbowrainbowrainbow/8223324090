\set ON_ERROR_STOP on
\if :{?customer_count}
\else
\set customer_count 2500
\endif
DO $$ BEGIN
    IF current_database() NOT IN ('eventgenix_perf_test', 'eventgenix_perf_small_test')
        OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
        OR EXISTS (SELECT 1 FROM customers)
        OR EXISTS (SELECT 1 FROM bookings) THEN
        RAISE EXCEPTION 'Use a fresh, initialized loopback benchmark database';
    END IF;
END $$;

BEGIN;
-- Live reads calculate their own metrics. Skip rebuilding legacy counters for each seed row.
ALTER TABLE bookings DISABLE TRIGGER trg_booking_customer_aggregates;
INSERT INTO customers (name, phone, instagram, child_name, child_birthday, business_context, updated_at)
SELECT 'Bench Family ' || lpad(g::text, 5, '0'), '+999000' || lpad(g::text, 5, '0'),
    'bench' || g, 'Bench Child ' || g, '2018-05-01'::date + g % 365,
    CASE WHEN g % 5 = 0 THEN 'dar' ELSE 'event_genix' END,
    '2026-09-01'::timestamp + g * interval '1 second'
FROM generate_series(1, :customer_count) g;

INSERT INTO bookings (id, date, time, line_id, customer_id, status, business_context, price, linked_to, room, room_resource_id)
SELECT 'perf-' || c.id || '-' || g, ('2026-02-01'::date + ((c.id + g * 23) % 365))::text,
    '12:00', '1', c.id, CASE WHEN g % 6 = 0 THEN 'cancelled' WHEN g % 4 = 0 THEN 'preliminary' ELSE 'confirmed' END,
    c.business_context, 200 + g * 10, CASE WHEN g = 11 THEN 'perf-' || c.id || '-1' END,
    'Bench Room', 'bench-room'
FROM customers c CROSS JOIN generate_series(1, 12) g;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE bookings ENABLE TRIGGER trg_booking_customer_aggregates;
COMMIT;

ANALYZE customers;
ANALYZE bookings;
