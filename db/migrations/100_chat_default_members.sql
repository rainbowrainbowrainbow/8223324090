-- v33.5: Seed all existing users into default chat channels
INSERT INTO chat_channel_members (channel_id, user_id)
SELECT cc.id, u.id
FROM chat_channels cc
CROSS JOIN users u
WHERE cc.is_default = true
  AND u.username != 'system'
ON CONFLICT (channel_id, user_id) DO NOTHING;
