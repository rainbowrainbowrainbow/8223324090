-- Migration 080: Fix linked_to empty string values
-- Author: [claude-code]
-- Bug: bookings with linked_to = '' were not filtered by linked_to IS NULL,
-- causing Kleshnya chat to double-count bookings with 2 hosts

UPDATE bookings SET linked_to = NULL WHERE linked_to = '';
