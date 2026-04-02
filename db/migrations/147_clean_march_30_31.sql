-- Migration 147: Remove fake schedule for 30-31 March
-- Schedule system wasn't active yet — no records should exist

DELETE FROM staff_schedule WHERE date IN ('2026-03-30', '2026-03-31');
