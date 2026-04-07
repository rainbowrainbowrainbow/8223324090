-- v42.4: Performance indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_bookings_date_status ON bookings(date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_line_date ON bookings(line_id, date);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_chat_channel_members_user ON chat_channel_members(user_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_staff_schedule_staff_date ON staff_schedule(staff_id, date);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to) WHERE status != 'archived';
