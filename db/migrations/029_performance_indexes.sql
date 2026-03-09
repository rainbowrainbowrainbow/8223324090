-- v20.9.26: Performance indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_bookings_program_id ON bookings(program_id);
CREATE INDEX IF NOT EXISTS idx_history_action ON history(action);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_lines_by_date_line_date ON lines_by_date(line_id, date);
