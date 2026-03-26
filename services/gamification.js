/**
 * services/gamification.js — Gamification engine (v22.2.0)
 *
 * Achievement checking, coin management, inventory, leveling, shop purchases.
 * Integrates with existing user_points, user_achievements, user_streaks.
 */
const { pool } = require('../db');
const { createLogger } = require('../utils/logger');

const log = createLogger('Gamification');

// XP rewards for various actions
const XP_REWARDS = {
    task_complete: 10,
    booking_create: 5,
    achievement_unlock: 25,
    daily_login: 3,
    streak_bonus: 5
};

/**
 * Ensure user has a gamification profile. Creates one if missing.
 */
async function ensureProfile(username) {
    const { rows } = await pool.query(
        `INSERT INTO user_profiles_ext (username)
         VALUES ($1)
         ON CONFLICT (username) DO NOTHING
         RETURNING *`,
        [username]
    );
    if (rows.length > 0) return rows[0];

    const existing = await pool.query(
        'SELECT * FROM user_profiles_ext WHERE username = $1',
        [username]
    );
    return existing.rows[0];
}

/**
 * Ensure user has a coin balance record.
 */
async function ensureCurrency(username) {
    await pool.query(
        `INSERT INTO game_currency (username, coins)
         VALUES ($1, 0)
         ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
         RETURNING *`,
        [username]
    );
}

/**
 * Get full profile data for a user (profile + coins + achievements + inventory + equipped).
 */
async function getProfile(username) {
    await ensureProfile(username);
    await ensureCurrency(username);

    const [profile, currency, achievements, inventory, equipped, streaks] = await Promise.all([
        pool.query('SELECT * FROM user_profiles_ext WHERE username = $1', [username]),
        pool.query('SELECT * FROM game_currency WHERE username = $1', [username]),
        pool.query(
            `SELECT ua.*, ac.name, ac.description, ac.icon, ac.type, ac.category, ac.rarity, ac.is_secret
             FROM user_achievements ua
             LEFT JOIN achievement_catalog ac ON ua.achievement_key = ac.key
             WHERE ua.username = $1
             ORDER BY ua.unlocked_at DESC`,
            [username]
        ),
        pool.query(
            `SELECT ui.*, ci.name, ci.description, ci.icon, ci.type, ci.rarity, ci.image_url
             FROM user_inventory ui
             JOIN character_items ci ON ui.item_id = ci.id
             WHERE ui.username = $1
             ORDER BY ui.acquired_at DESC`,
            [username]
        ),
        pool.query(
            `SELECT ue.slot, ue.item_id, ci.name, ci.icon, ci.type, ci.rarity, ci.image_url
             FROM user_equipped ue
             JOIN character_items ci ON ue.item_id = ci.id
             WHERE ue.username = $1`,
            [username]
        ),
        pool.query('SELECT * FROM user_streaks WHERE username = $1', [username])
    ]);

    const level = await getCurrentLevel(profile.rows[0]?.xp || 0);

    return {
        profile: profile.rows[0],
        currency: currency.rows[0],
        achievements: achievements.rows,
        inventory: inventory.rows,
        equipped: equipped.rows,
        streaks: streaks.rows[0] || { current_streak: 0, longest_streak: 0 },
        level,
        achievementCount: achievements.rows.length
    };
}

/**
 * Get level info from XP amount.
 */
async function getCurrentLevel(xp) {
    const { rows } = await pool.query(
        `SELECT * FROM level_thresholds
         WHERE xp_required <= $1
         ORDER BY level DESC
         LIMIT 1`,
        [xp || 0]
    );
    const current = rows[0] || { level: 1, xp_required: 0, title: 'Новачок' };

    const next = await pool.query(
        'SELECT * FROM level_thresholds WHERE level = $1',
        [current.level + 1]
    );

    return {
        level: current.level,
        title: current.title,
        xp: xp || 0,
        xpForCurrent: current.xp_required,
        xpForNext: next.rows[0]?.xp_required || null,
        nextTitle: next.rows[0]?.title || null,
        isMaxLevel: next.rows.length === 0
    };
}

/**
 * Award coins to a user.
 */
async function awardCoins(username, amount, reason, sourceType = 'admin', sourceId = null) {
    if (amount <= 0) return;

    await ensureCurrency(username);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `UPDATE game_currency
             SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW()
             WHERE username = $2`,
            [amount, username]
        );

        await client.query(
            `INSERT INTO coin_transactions (username, amount, type, reason, source_type, source_id)
             VALUES ($1, $2, 'earn', $3, $4, $5)`,
            [username, amount, reason, sourceType, sourceId]
        );

        await client.query('COMMIT');
        log.info(`Awarded ${amount} coins to ${username}: ${reason}`);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Award coins error', err);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Spend coins (for shop purchases).
 */
async function spendCoins(username, amount, reason, sourceType = 'shop', sourceId = null) {
    if (amount <= 0) return false;

    await ensureCurrency(username);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            'SELECT coins FROM game_currency WHERE username = $1 FOR UPDATE',
            [username]
        );

        if (!rows[0] || rows[0].coins < amount) {
            await client.query('ROLLBACK');
            return false;
        }

        await client.query(
            `UPDATE game_currency
             SET coins = coins - $1, total_spent = total_spent + $1, updated_at = NOW()
             WHERE username = $2`,
            [amount, username]
        );

        await client.query(
            `INSERT INTO coin_transactions (username, amount, type, reason, source_type, source_id)
             VALUES ($1, $2, 'spend', $3, $4, $5)`,
            [username, -amount, reason, sourceType, sourceId]
        );

        await client.query('COMMIT');
        log.info(`${username} spent ${amount} coins: ${reason}`);
        return true;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Spend coins error', err);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Award XP and check for level up.
 */
async function awardXP(username, amount) {
    if (amount <= 0) return null;

    await ensureProfile(username);

    // v38.4.0: Atomic XP update to prevent race conditions
    const updated = await pool.query(
        `UPDATE user_profiles_ext
         SET xp = xp + $1, updated_at = NOW()
         WHERE username = $2
         RETURNING xp, level`,
        [amount, username]
    );
    if (!updated.rows[0]) return { leveledUp: false };

    const newXP = updated.rows[0].xp;
    const oldLevel = updated.rows[0].level || 1;
    const newLevel = await getCurrentLevel(newXP);

    if (newLevel.level > oldLevel) {
        await pool.query(
            `UPDATE user_profiles_ext SET level = $1, title = $2 WHERE username = $3`,
            [newLevel.level, newLevel.title, username]
        );
        log.info(`${username} leveled up: ${oldLevel} → ${newLevel.level} (${newLevel.title})`);
        return { leveledUp: true, oldLevel, newLevel: newLevel.level, title: newLevel.title };
    }

    return { leveledUp: false };
}

/**
 * Check and unlock achievements for a user.
 * Called after task completion, booking creation, etc.
 */
async function checkAchievements(username, context = {}) {
    const unlocked = [];

    // Get all active achievements user hasn't unlocked yet
    const { rows: pending } = await pool.query(
        `SELECT ac.* FROM achievement_catalog ac
         WHERE ac.is_active = true
         AND ac.key NOT IN (
             SELECT achievement_key FROM user_achievements WHERE username = $1
         )`,
        [username]
    );

    for (const ach of pending) {
        let shouldUnlock = false;

        switch (ach.condition_type) {
            case 'task_count': {
                const { rows } = await pool.query(
                    "SELECT COUNT(*) FROM tasks WHERE assigned_to = $1 AND status = 'done'",
                    [username]
                );
                shouldUnlock = parseInt(rows[0].count) >= ach.condition_value;
                break;
            }
            case 'booking_count': {
                // v33.8.0: Count bookings where user is animator or creator
                // Note: bookings.hosts is INTEGER (animator count), not name
                // Use second_animator (VARCHAR) and created_by for matching
                const { rows } = await pool.query(
                    `SELECT COUNT(*) FROM bookings
                     WHERE (second_animator ILIKE '%' || $1 || '%' OR created_by = $1)
                       AND status != 'cancelled'`,
                    [username]
                );
                shouldUnlock = parseInt(rows[0].count) >= ach.condition_value;
                break;
            }
            case 'streak': {
                const { rows } = await pool.query(
                    'SELECT current_streak, longest_streak FROM user_streaks WHERE username = $1',
                    [username]
                );
                const longest = rows[0]?.longest_streak || 0;
                shouldUnlock = longest >= ach.condition_value;
                break;
            }
            case 'manual': {
                // Manual achievements are unlocked explicitly via API
                if (context.manualKey === ach.key) {
                    shouldUnlock = true;
                }
                break;
            }
        }

        if (shouldUnlock) {
            await unlockAchievement(username, ach);
            unlocked.push(ach);
        }
    }

    return unlocked;
}

/**
 * Unlock a specific achievement for a user.
 */
async function unlockAchievement(username, achievement) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Insert into user_achievements
        await client.query(
            `INSERT INTO user_achievements (username, achievement_key, achievement_id, progress, max_progress, coins_awarded, xp_awarded, unlocked_at)
             VALUES ($1, $2, $3, $4, $4, $5, $6, NOW())
             ON CONFLICT (username, achievement_key) DO NOTHING`,
            [username, achievement.key, achievement.id, achievement.condition_value,
             achievement.reward_type === 'coins' ? achievement.reward_value : 0,
             XP_REWARDS.achievement_unlock]
        );

        // Award coins if reward type is coins
        if (achievement.reward_type === 'coins' && achievement.reward_value > 0) {
            await ensureCurrency(username);
            await client.query(
                `UPDATE game_currency
                 SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW()
                 WHERE username = $2`,
                [achievement.reward_value, username]
            );
            await client.query(
                `INSERT INTO coin_transactions (username, amount, type, reason, source_type, source_id)
                 VALUES ($1, $2, 'earn', $3, 'achievement', $4)`,
                [username, achievement.reward_value, `Ачивка: ${achievement.name}`, achievement.id]
            );
        }

        // Award item if reward type is item
        if (achievement.reward_type === 'item' && achievement.reward_item_id) {
            await client.query(
                `INSERT INTO user_inventory (username, item_id, acquired_via)
                 VALUES ($1, $2, 'achievement')
                 ON CONFLICT (username, item_id) DO NOTHING`,
                [username, achievement.reward_item_id]
            );
        }

        await client.query('COMMIT');
        log.info(`${username} unlocked achievement: ${achievement.name} (${achievement.rarity})`);

        // Award XP (outside transaction — non-critical)
        await awardXP(username, XP_REWARDS.achievement_unlock).catch(() => {});

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Unlock achievement error', err);
    } finally {
        client.release();
    }
}

/**
 * Purchase an item from the shop.
 */
async function purchaseShopItem(username, shopItemId) {
    // v38.4.0: All checks + spend + stock decrement inside single transaction to prevent oversell
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Lock item row to prevent concurrent oversell
        const { rows: items } = await client.query(
            `SELECT si.*, ci.id as char_item_id
             FROM shop_items si
             LEFT JOIN character_items ci ON si.item_id = ci.id
             WHERE si.id = $1 AND si.is_active = true
             FOR UPDATE OF si`,
            [shopItemId]
        );

        if (items.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Товар не знайдено' };
        }

        const item = items[0];

        // Check stock (under lock)
        if (item.stock === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Товар закінчився' };
        }

        // Check if user already owns this digital item
        if (item.char_item_id) {
            const { rows: owned } = await client.query(
                'SELECT id FROM user_inventory WHERE username = $1 AND item_id = $2',
                [username, item.char_item_id]
            );
            if (owned.length > 0) {
                await client.query('ROLLBACK');
                return { success: false, error: 'Ви вже маєте цей предмет' };
            }
        }

        // Spend coins (still uses pool — safe, separate balance check)
        const spent = await spendCoins(username, item.price_coins, `Покупка: ${item.name}`, 'shop', shopItemId);
        if (!spent) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Недостатньо монет' };
        }

        // Add to inventory if digital item
        if (item.char_item_id) {
            await client.query(
                `INSERT INTO user_inventory (username, item_id, acquired_via)
                 VALUES ($1, $2, 'shop')
                 ON CONFLICT (username, item_id) DO NOTHING`,
                [username, item.char_item_id]
            );
        }

        // Record purchase
        const status = item.type === 'real' ? 'pending_pickup' : 'completed';
        await client.query(
            `INSERT INTO shop_purchases (username, shop_item_id, coins_paid, status)
             VALUES ($1, $2, $3, $4)`,
            [username, shopItemId, item.price_coins, status]
        );

        // Decrease stock if limited
        if (item.stock > 0) {
            await client.query(
                'UPDATE shop_items SET stock = stock - 1 WHERE id = $1 AND stock > 0',
                [shopItemId]
            );
        }

        await client.query('COMMIT');
        log.info(`${username} purchased: ${item.name} for ${item.price_coins} coins`);

        return { success: true, item: item.name, status };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Purchase error', err);
        return { success: false, error: 'Помилка покупки' };
    } finally {
        client.release();
    }
}

/**
 * Equip an item to a character slot.
 */
async function equipItem(username, itemId) {
    // Verify user owns the item
    const { rows: owned } = await pool.query(
        `SELECT ui.*, ci.type as slot_type
         FROM user_inventory ui
         JOIN character_items ci ON ui.item_id = ci.id
         WHERE ui.username = $1 AND ui.item_id = $2`,
        [username, itemId]
    );

    if (owned.length === 0) {
        return { success: false, error: 'Предмет не знайдено в інвентарі' };
    }

    const slot = owned[0].slot_type;

    await pool.query(
        `INSERT INTO user_equipped (username, slot, item_id, equipped_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (username, slot) DO UPDATE SET item_id = $3, equipped_at = NOW()`,
        [username, slot, itemId]
    );

    return { success: true, slot };
}

/**
 * Unequip an item from a slot.
 */
async function unequipSlot(username, slot) {
    await pool.query(
        'DELETE FROM user_equipped WHERE username = $1 AND slot = $2',
        [username, slot]
    );
    return { success: true };
}

/**
 * Get leaderboard (top users by coins/xp/achievements).
 */
async function getLeaderboard(sortBy = 'xp', limit = 20) {
    let query;
    switch (sortBy) {
        case 'coins':
            query = `SELECT gc.username, gc.coins, gc.total_earned,
                        upe.level, upe.title, upe.avatar_url, upe.display_name,
                        (SELECT COUNT(*) FROM user_achievements ua WHERE ua.username = gc.username) as achievement_count
                     FROM game_currency gc
                     LEFT JOIN user_profiles_ext upe ON gc.username = upe.username
                     ORDER BY gc.coins DESC
                     LIMIT $1`;
            break;
        case 'achievements':
            query = `SELECT ua.username, COUNT(*) as achievement_count,
                        upe.level, upe.title, upe.avatar_url, upe.display_name,
                        COALESCE(gc.coins, 0) as coins
                     FROM user_achievements ua
                     LEFT JOIN user_profiles_ext upe ON ua.username = upe.username
                     LEFT JOIN game_currency gc ON ua.username = gc.username
                     GROUP BY ua.username, upe.level, upe.title, upe.avatar_url, upe.display_name, gc.coins
                     ORDER BY achievement_count DESC
                     LIMIT $1`;
            break;
        default: // xp
            query = `SELECT upe.username, upe.xp, upe.level, upe.title, upe.avatar_url, upe.display_name,
                        COALESCE(gc.coins, 0) as coins,
                        (SELECT COUNT(*) FROM user_achievements ua WHERE ua.username = upe.username) as achievement_count
                     FROM user_profiles_ext upe
                     LEFT JOIN game_currency gc ON upe.username = gc.username
                     ORDER BY upe.xp DESC
                     LIMIT $1`;
    }

    const { rows } = await pool.query(query, [Math.min(limit, 50)]);
    return rows;
}

/**
 * Get achievement catalog (all available achievements).
 */
async function getAchievementCatalog(username = null) {
    const { rows } = await pool.query(
        `SELECT ac.*,
            CASE WHEN ua.id IS NOT NULL THEN true ELSE false END as unlocked,
            ua.unlocked_at
         FROM achievement_catalog ac
         LEFT JOIN user_achievements ua ON ac.key = ua.achievement_key AND ua.username = $1
         WHERE ac.is_active = true AND (ac.is_secret = false OR ua.id IS NOT NULL)
         ORDER BY ac.sort_order, ac.rarity DESC`,
        [username]
    );
    return rows;
}

/**
 * Get shop catalog.
 */
async function getShopCatalog(username = null) {
    let query = `SELECT si.*,
        ci.rarity as item_rarity, ci.type as item_type
        FROM shop_items si
        LEFT JOIN character_items ci ON si.item_id = ci.id
        WHERE si.is_active = true AND (si.stock != 0 OR si.stock = -1)
        ORDER BY si.is_featured DESC, si.sort_order, si.price_coins`;

    const { rows } = await pool.query(query);

    // If username provided, mark owned items
    if (username) {
        const { rows: owned } = await pool.query(
            'SELECT item_id FROM user_inventory WHERE username = $1',
            [username]
        );
        const ownedSet = new Set(owned.map(r => r.item_id));
        for (const item of rows) {
            item.owned = item.item_id ? ownedSet.has(item.item_id) : false;
        }
    }

    return rows;
}

/**
 * Get coin transaction history.
 */
async function getCoinHistory(username, limit = 50, offset = 0) {
    const [transactions, countResult] = await Promise.all([
        pool.query(
            `SELECT * FROM coin_transactions
             WHERE username = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [username, Math.min(limit, 100), offset]
        ),
        pool.query(
            'SELECT COUNT(*) FROM coin_transactions WHERE username = $1',
            [username]
        )
    ]);

    return {
        transactions: transactions.rows,
        total: parseInt(countResult.rows[0].count)
    };
}

/**
 * Update user profile (bio, hobbies, display_name).
 */
async function updateProfile(username, data) {
    await ensureProfile(username);

    const allowed = ['display_name', 'bio', 'hobbies', 'avatar_url', 'is_public'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
        if (data[key] !== undefined) {
            updates.push(`${key} = $${idx}`);
            values.push(data[key]);
            idx++;
        }
    }

    if (updates.length === 0) return;

    updates.push(`updated_at = NOW()`);
    values.push(username);

    await pool.query(
        `UPDATE user_profiles_ext SET ${updates.join(', ')} WHERE username = $${idx}`,
        values
    );
}

/**
 * Gift coins to another user.
 */
async function giftCoins(fromUser, toUser, amount) {
    if (amount <= 0 || amount > 1000) {
        return { success: false, error: 'Невірна сума (1-1000)' };
    }

    const spent = await spendCoins(fromUser, amount, `Подарунок для ${toUser}`, 'gift', null);
    if (!spent) {
        return { success: false, error: 'Недостатньо монет' };
    }

    await ensureCurrency(toUser);
    await pool.query(
        `UPDATE game_currency SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW()
         WHERE username = $2`,
        [amount, toUser]
    );
    await pool.query(
        `INSERT INTO coin_transactions (username, amount, type, reason, source_type)
         VALUES ($1, $2, 'gift_in', $3, 'gift')`,
        [toUser, amount, `Подарунок від ${fromUser}`]
    );

    return { success: true };
}

/**
 * Hook: called when a task is completed.
 * Awards coins + XP + checks achievements.
 */
async function onTaskComplete(username, task) {
    try {
        await ensureProfile(username);
        await ensureCurrency(username);

        // Award coins based on task priority
        const coinReward = task.priority === 'high' ? 15 : task.priority === 'medium' ? 10 : 5;
        await awardCoins(username, coinReward, `Завдання: ${task.title || 'задача'}`, 'task', task.id);

        // Award XP
        await awardXP(username, XP_REWARDS.task_complete);

        // Check achievements
        const unlocked = await checkAchievements(username);

        return { coins: coinReward, xp: XP_REWARDS.task_complete, achievements: unlocked };
    } catch (err) {
        log.error('onTaskComplete error', err);
        return null;
    }
}

/**
 * Hook: called when a booking is created.
 */
async function onBookingCreate(username) {
    try {
        await ensureProfile(username);
        await ensureCurrency(username);

        await awardCoins(username, 5, 'Нове бронювання', 'task');
        await awardXP(username, XP_REWARDS.booking_create);
        const unlocked = await checkAchievements(username);

        return { coins: 5, xp: XP_REWARDS.booking_create, achievements: unlocked };
    } catch (err) {
        log.error('onBookingCreate error', err);
        return null;
    }
}

// ============================================================
// MONTHLY LEADERBOARD (v30.8.0)
// ============================================================

async function getMonthlyLeaderboard(year, month, category = 'overall', limit = 20) {
    const { rows } = await pool.query(
        `SELECT ml.*, upe.display_name, upe.avatar_url, upe.level, upe.title
         FROM monthly_leaderboard ml
         LEFT JOIN user_profiles_ext upe ON ml.username = upe.username
         WHERE ml.year = $1 AND ml.month = $2 AND ml.category = $3
         ORDER BY ml.rank ASC NULLS LAST, ml.score DESC
         LIMIT $4`,
        [year, month, category, Math.min(limit, 50)]
    );
    return rows;
}

async function recalculateMonthlyLeaderboard(year, month) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, '0')}-01`;

    const categories = {
        bookings: `SELECT created_by as username, COUNT(*) as score FROM bookings
                   WHERE created_at >= $1 AND created_at < $2 GROUP BY created_by`,
        tasks: `SELECT assigned_to as username, COUNT(*) as score FROM tasks
                WHERE status = 'done' AND updated_at >= $1 AND updated_at < $2 GROUP BY assigned_to`,
        xp: `SELECT username, SUM(xp_earned) as score FROM (
                  SELECT created_by as username, COUNT(*) * 10 as xp_earned FROM bookings
                  WHERE created_at >= $1 AND created_at < $2 GROUP BY created_by
                  UNION ALL
                  SELECT assigned_to as username, COUNT(*) * 5 as xp_earned FROM tasks
                  WHERE status = 'done' AND updated_at >= $1 AND updated_at < $2 GROUP BY assigned_to
             ) xp_sources GROUP BY username`,
        coins: `SELECT username, SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as score
                FROM coin_transactions
                WHERE created_at >= $1 AND created_at < $2
                GROUP BY username`
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        for (const [cat, query] of Object.entries(categories)) {
            const { rows } = await client.query(query, [startDate, endDate]);

            // Delete old entries for this category/period
            await client.query(
                'DELETE FROM monthly_leaderboard WHERE year = $1 AND month = $2 AND category = $3',
                [year, month, cat]
            );

            // Insert ranked entries
            const sorted = rows.filter(r => parseInt(r.score) > 0).sort((a, b) => parseInt(b.score) - parseInt(a.score));
            for (let i = 0; i < sorted.length; i++) {
                await client.query(
                    `INSERT INTO monthly_leaderboard (username, year, month, category, score, rank)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (username, year, month, category)
                     DO UPDATE SET score = $5, rank = $6`,
                    [sorted[i].username, year, month, cat, parseInt(sorted[i].score), i + 1]
                );
            }
        }

        // Calculate overall (weighted sum)
        await client.query(
            'DELETE FROM monthly_leaderboard WHERE year = $1 AND month = $2 AND category = $3',
            [year, month, 'overall']
        );

        const { rows: allScores } = await client.query(
            `SELECT username,
                    SUM(CASE WHEN category = 'bookings' THEN score * 3
                             WHEN category = 'tasks' THEN score * 2
                             WHEN category = 'xp' THEN score
                             WHEN category = 'coins' THEN score
                             ELSE 0 END) as total
             FROM monthly_leaderboard
             WHERE year = $1 AND month = $2 AND category != 'overall'
             GROUP BY username
             ORDER BY total DESC`,
            [year, month]
        );

        for (let i = 0; i < allScores.length; i++) {
            await client.query(
                `INSERT INTO monthly_leaderboard (username, year, month, category, score, rank)
                 VALUES ($1, $2, $3, 'overall', $4, $5)
                 ON CONFLICT (username, year, month, category)
                 DO UPDATE SET score = $4, rank = $5`,
                [allScores[i].username, year, month, parseInt(allScores[i].total), i + 1]
            );
        }

        await client.query('COMMIT');
        log.info(`Recalculated monthly leaderboard for ${year}-${month}`);
        return allScores.length;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Recalculate leaderboard error', err);
        throw err;
    } finally {
        client.release();
    }
}

// ============================================================
// SEASONAL QUESTS (v30.8.0)
// ============================================================

async function getSeasonalQuests(username) {
    const today = new Date().toISOString().split('T')[0];
    const { rows } = await pool.query(
        `SELECT sq.*,
            usq.progress, usq.completed, usq.claimed,
            usq.completed_at, usq.claimed_at
         FROM seasonal_quests sq
         LEFT JOIN user_seasonal_quests usq ON sq.id = usq.quest_id AND usq.username = $1
         WHERE sq.is_active = true AND sq.start_date <= $2 AND sq.end_date >= $2
         ORDER BY sq.reward_coins DESC`,
        [username, today]
    );
    return rows;
}

async function checkSeasonalProgress(username) {
    const today = new Date().toISOString().split('T')[0];
    const { rows: quests } = await pool.query(
        `SELECT sq.* FROM seasonal_quests sq
         WHERE sq.is_active = true AND sq.start_date <= $1 AND sq.end_date >= $1`,
        [today]
    );

    const updated = [];

    for (const quest of quests) {
        let progress = 0;

        switch (quest.quest_type) {
            case 'booking_count': {
                const { rows } = await pool.query(
                    `SELECT COUNT(*) FROM bookings
                     WHERE created_by = $1 AND created_at >= $2 AND created_at <= $3`,
                    [username, quest.start_date, quest.end_date]
                );
                progress = parseInt(rows[0].count);
                break;
            }
            case 'task_count': {
                const { rows } = await pool.query(
                    `SELECT COUNT(*) FROM tasks
                     WHERE assigned_to = $1 AND status = 'done'
                     AND updated_at >= $2 AND updated_at <= $3`,
                    [username, quest.start_date, quest.end_date]
                );
                progress = parseInt(rows[0].count);
                break;
            }
            case 'streak': {
                const { rows } = await pool.query(
                    'SELECT longest_streak FROM user_streaks WHERE username = $1',
                    [username]
                );
                progress = rows[0]?.longest_streak || 0;
                break;
            }
            case 'login_days': {
                try {
                    // Try username-based query first (gamification coin_transactions)
                    const { rows } = await pool.query(
                        `SELECT COUNT(DISTINCT DATE(created_at)) as days
                         FROM coin_transactions
                         WHERE username = $1 AND (source_type = 'daily_login' OR type = 'daily_login' OR reason LIKE '%Щоденний%')
                         AND created_at >= $2 AND created_at <= $3`,
                        [username, quest.start_date, quest.end_date]
                    );
                    progress = parseInt(rows[0].days) || 0;
                } catch (e) {
                    progress = 0;
                }
                break;
            }
        }

        const completed = progress >= quest.target_value;

        await pool.query(
            `INSERT INTO user_seasonal_quests (username, quest_id, progress, completed, completed_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (username, quest_id)
             DO UPDATE SET progress = $3, completed = $4,
                completed_at = CASE WHEN $4 AND user_seasonal_quests.completed_at IS NULL THEN NOW() ELSE user_seasonal_quests.completed_at END`,
            [username, quest.id, Math.min(progress, quest.target_value), completed, completed ? new Date() : null]
        );

        updated.push({ questId: quest.id, progress, completed, target: quest.target_value });
    }

    return updated;
}

async function claimSeasonalReward(username, questId) {
    const { rows } = await pool.query(
        `SELECT sq.*, usq.completed, usq.claimed
         FROM seasonal_quests sq
         JOIN user_seasonal_quests usq ON sq.id = usq.quest_id
         WHERE sq.id = $1 AND usq.username = $2`,
        [questId, username]
    );

    if (rows.length === 0) return { success: false, error: 'Квест не знайдено' };
    if (!rows[0].completed) return { success: false, error: 'Квест ще не виконано' };
    if (rows[0].claimed) return { success: false, error: 'Нагорода вже отримана' };

    const quest = rows[0];
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(
            `UPDATE user_seasonal_quests SET claimed = true, claimed_at = NOW()
             WHERE username = $1 AND quest_id = $2`,
            [username, questId]
        );

        if (quest.reward_coins > 0) {
            // Ensure currency row exists within the transaction
            await client.query(
                `INSERT INTO game_currency (username, coins) VALUES ($1, 0)
                 ON CONFLICT (username) DO NOTHING`,
                [username]
            );
            await client.query(
                `UPDATE game_currency SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW()
                 WHERE username = $2`,
                [quest.reward_coins, username]
            );
            await client.query(
                `INSERT INTO coin_transactions (username, amount, type, reason, source_type, source_id)
                 VALUES ($1, $2, 'earn', $3, 'seasonal_quest', $4)`,
                [username, quest.reward_coins, `Сезонний квест: ${quest.title}`, quest.id]
            );
        }

        if (quest.reward_xp > 0) {
            await client.query(
                `UPDATE user_profiles_ext SET xp = xp + $1, updated_at = NOW() WHERE username = $2`,
                [quest.reward_xp, username]
            );
        }

        await client.query('COMMIT');
        log.info(`${username} claimed seasonal quest: ${quest.title}`);
        return { success: true, coins: quest.reward_coins, xp: quest.reward_xp, title: quest.reward_title };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Claim seasonal reward error', err);
        return { success: false, error: 'Помилка при отриманні нагороди' };
    } finally {
        client.release();
    }
}

// ============================================================
// TEAMS & CHALLENGES (v30.8.0)
// ============================================================

async function getTeams() {
    const { rows: teams } = await pool.query(
        `SELECT t.*, COUNT(tm.id) as member_count
         FROM teams t
         LEFT JOIN team_members tm ON t.id = tm.team_id
         WHERE t.is_active = true
         GROUP BY t.id
         ORDER BY member_count DESC`
    );

    for (const team of teams) {
        const { rows: members } = await pool.query(
            `SELECT tm.username, upe.display_name, upe.avatar_url, upe.level, upe.title
             FROM team_members tm
             LEFT JOIN user_profiles_ext upe ON tm.username = upe.username
             WHERE tm.team_id = $1
             ORDER BY tm.joined_at`,
            [team.id]
        );
        team.members = members;
    }

    return teams;
}

async function getUserTeam(username) {
    const { rows } = await pool.query(
        `SELECT t.*, tm.joined_at
         FROM team_members tm
         JOIN teams t ON tm.team_id = t.id
         WHERE tm.username = $1`,
        [username]
    );
    return rows[0] || null;
}

async function joinTeam(username, teamId) {
    // Check if already in a team
    const existing = await getUserTeam(username);
    if (existing) {
        return { success: false, error: 'Ви вже в команді. Спершу вийдіть з поточної' };
    }

    const { rows: team } = await pool.query(
        'SELECT * FROM teams WHERE id = $1 AND is_active = true',
        [teamId]
    );
    if (team.length === 0) return { success: false, error: 'Команду не знайдено' };

    await pool.query(
        'INSERT INTO team_members (team_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [teamId, username]
    );

    log.info(`${username} joined team: ${team[0].name}`);
    return { success: true, team: team[0].name };
}

async function leaveTeam(username) {
    const result = await pool.query(
        'DELETE FROM team_members WHERE username = $1 RETURNING *',
        [username]
    );
    if (result.rows.length === 0) return { success: false, error: 'Ви не в команді' };
    return { success: true };
}

async function getTeamChallenges(username) {
    const today = new Date().toISOString().split('T')[0];
    const userTeam = await getUserTeam(username);

    const { rows: challenges } = await pool.query(
        `SELECT tc.*
         FROM team_challenges tc
         WHERE tc.is_active = true AND tc.start_date <= $1 AND tc.end_date >= $1
         ORDER BY tc.end_date`,
        [today]
    );

    for (const ch of challenges) {
        const { rows: progress } = await pool.query(
            `SELECT tcp.*, t.name as team_name, t.icon as team_icon, t.color as team_color
             FROM team_challenge_progress tcp
             JOIN teams t ON tcp.team_id = t.id
             WHERE tcp.challenge_id = $1
             ORDER BY tcp.score DESC`,
            [ch.id]
        );
        ch.teams = progress;
        ch.userTeamId = userTeam?.id || null;
    }

    return challenges;
}

async function recalculateTeamChallenges() {
    const today = new Date().toISOString().split('T')[0];

    const { rows: challenges } = await pool.query(
        `SELECT * FROM team_challenges WHERE is_active = true AND start_date <= $1 AND end_date >= $1`,
        [today]
    );

    const { rows: teams } = await pool.query('SELECT id FROM teams WHERE is_active = true');

    for (const ch of challenges) {
        for (const team of teams) {
            const { rows: members } = await pool.query(
                'SELECT username FROM team_members WHERE team_id = $1',
                [team.id]
            );
            if (members.length === 0) continue;

            const usernames = members.map(m => m.username);
            let score = 0;

            switch (ch.challenge_type) {
                case 'bookings': {
                    const { rows } = await pool.query(
                        `SELECT COUNT(*) FROM bookings
                         WHERE created_by = ANY($1) AND created_at >= $2 AND created_at <= $3`,
                        [usernames, ch.start_date, ch.end_date]
                    );
                    score = parseInt(rows[0].count);
                    break;
                }
                case 'tasks': {
                    const { rows } = await pool.query(
                        `SELECT COUNT(*) FROM tasks
                         WHERE assigned_to = ANY($1) AND status = 'done'
                         AND updated_at >= $2 AND updated_at <= $3`,
                        [usernames, ch.start_date, ch.end_date]
                    );
                    score = parseInt(rows[0].count);
                    break;
                }
                case 'xp': {
                    const { rows } = await pool.query(
                        `SELECT COALESCE(SUM(xp), 0) as total
                         FROM user_profiles_ext WHERE username = ANY($1)`,
                        [usernames]
                    );
                    score = parseInt(rows[0].total);
                    break;
                }
            }

            const completed = score >= ch.target_value;
            await pool.query(
                `INSERT INTO team_challenge_progress (challenge_id, team_id, score, completed, completed_at)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (challenge_id, team_id)
                 DO UPDATE SET score = $3, completed = $4,
                    completed_at = CASE WHEN $4 AND team_challenge_progress.completed_at IS NULL THEN NOW() ELSE team_challenge_progress.completed_at END`,
                [ch.id, team.id, score, completed, completed ? new Date() : null]
            );
        }
    }

    log.info('Recalculated team challenges');
}

// ============================================================
// REFERRAL SYSTEM (v30.8.0)
// ============================================================

function generateReferralCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'EG-';
    for (let i = 0; i < 5; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

async function getReferralCode(username) {
    await ensureProfile(username);

    const { rows } = await pool.query(
        'SELECT referral_code FROM user_profiles_ext WHERE username = $1',
        [username]
    );

    if (rows[0]?.referral_code) return rows[0].referral_code;

    // Generate unique code
    let code;
    let attempts = 0;
    while (attempts < 10) {
        code = generateReferralCode();
        try {
            await pool.query(
                'UPDATE user_profiles_ext SET referral_code = $1 WHERE username = $2',
                [code, username]
            );
            return code;
        } catch (e) {
            attempts++;
        }
    }
    throw new Error('Failed to generate unique referral code');
}

async function applyReferralCode(newUsername, code) {
    // Find referrer
    const { rows } = await pool.query(
        'SELECT username FROM user_profiles_ext WHERE referral_code = $1',
        [code.toUpperCase()]
    );
    if (rows.length === 0) return { success: false, error: 'Невірний реферальний код' };

    const referrer = rows[0].username;
    if (referrer === newUsername) return { success: false, error: 'Не можна використовувати власний код' };

    // Check if already referred
    const { rows: existing } = await pool.query(
        'SELECT id FROM referrals WHERE referred_username = $1',
        [newUsername]
    );
    if (existing.length > 0) return { success: false, error: 'Ви вже використали реферальний код' };

    await pool.query(
        `INSERT INTO referrals (referrer_username, referred_username, referral_code, status)
         VALUES ($1, $2, $3, 'active')`,
        [referrer, newUsername, code.toUpperCase()]
    );

    // Reward referred user immediately
    await ensureCurrency(newUsername);
    await awardCoins(newUsername, 200, 'Реферальний бонус (новий користувач)', 'referral');

    log.info(`Referral: ${newUsername} used code ${code} from ${referrer}`);
    return { success: true, bonus: 200 };
}

async function checkReferralReward(username) {
    // Check if referrer should be rewarded (referred user made first booking)
    const { rows: unrewarded } = await pool.query(
        `SELECT r.* FROM referrals r
         WHERE r.referrer_username = $1 AND r.referrer_rewarded = false AND r.status = 'active'`,
        [username]
    );

    if (unrewarded.length === 0) return { rewarded: 0 };

    const client = await pool.connect();
    let rewarded = 0;
    try {
        await client.query('BEGIN');

        for (const ref of unrewarded) {
            const { rows: bookings } = await client.query(
                'SELECT id FROM bookings WHERE created_by = $1 LIMIT 1',
                [ref.referred_username]
            );
            if (bookings.length > 0) {
                await client.query(
                    `UPDATE referrals SET referrer_rewarded = true, status = 'rewarded', activated_at = NOW()
                     WHERE id = $1`,
                    [ref.id]
                );
                // Award coins within the transaction
                await client.query(
                    `INSERT INTO game_currency (username, coins) VALUES ($1, 0)
                     ON CONFLICT (username) DO NOTHING`,
                    [username]
                );
                await client.query(
                    `UPDATE game_currency SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW()
                     WHERE username = $2`,
                    [ref.reward_coins, username]
                );
                await client.query(
                    `INSERT INTO coin_transactions (username, amount, type, reason, source_type, source_id)
                     VALUES ($1, $2, 'earn', $3, 'referral', NULL)`,
                    [username, ref.reward_coins, `Реферал: ${ref.referred_username} створив бронювання`]
                );
                rewarded++;
            }
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Check referral reward error', err);
    } finally {
        client.release();
    }

    return { rewarded };
}

async function getReferralStats(username) {
    const code = await getReferralCode(username);

    const { rows: referrals } = await pool.query(
        `SELECT referred_username, status, referrer_rewarded, reward_coins, created_at, activated_at
         FROM referrals WHERE referrer_username = $1 ORDER BY created_at DESC`,
        [username]
    );

    const totalReferred = referrals.length;
    const totalRewarded = referrals.filter(r => r.referrer_rewarded).length;
    const totalCoinsEarned = referrals.filter(r => r.referrer_rewarded).reduce((sum, r) => sum + r.reward_coins, 0);

    return {
        code,
        referrals,
        totalReferred,
        totalRewarded,
        totalCoinsEarned
    };
}

// ============================================================
// BONUS REDEMPTIONS (v30.8.0)
// ============================================================

async function getRedemptions(username, isAdmin = false) {
    const query = isAdmin
        ? `SELECT br.*, si.name as item_name, si.icon as item_icon
           FROM bonus_redemptions br
           LEFT JOIN shop_items si ON br.shop_item_id = si.id
           ORDER BY br.created_at DESC LIMIT 100`
        : `SELECT br.*, si.name as item_name, si.icon as item_icon
           FROM bonus_redemptions br
           LEFT JOIN shop_items si ON br.shop_item_id = si.id
           WHERE br.username = $1
           ORDER BY br.created_at DESC LIMIT 50`;

    const { rows } = isAdmin
        ? await pool.query(query)
        : await pool.query(query, [username]);

    return rows;
}

async function updateRedemption(redemptionId, status, adminNote, resolvedBy) {
    const validStatuses = ['pending', 'approved', 'delivered', 'rejected'];
    if (!validStatuses.includes(status)) return { success: false, error: 'Невірний статус' };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `UPDATE bonus_redemptions SET status = $1, admin_note = $2, resolved_by = $3, resolved_at = NOW()
             WHERE id = $4 RETURNING *`,
            [status, adminNote, resolvedBy, redemptionId]
        );

        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return { success: false, error: 'Заявку не знайдено' };
        }

        // If rejected, refund coins within same transaction
        if (status === 'rejected' && rows[0].coins_paid > 0) {
            await client.query(
                `INSERT INTO game_currency (username, coins) VALUES ($1, 0)
                 ON CONFLICT (username) DO NOTHING`,
                [rows[0].username]
            );
            await client.query(
                `UPDATE game_currency SET coins = coins + $1, total_earned = total_earned + $1, updated_at = NOW()
                 WHERE username = $2`,
                [rows[0].coins_paid, rows[0].username]
            );
            await client.query(
                `INSERT INTO coin_transactions (username, amount, type, reason, source_type, source_id)
                 VALUES ($1, $2, 'earn', $3, $4, $5)`,
                [rows[0].username, rows[0].coins_paid, 'Повернення: заявку відхилено', 'refund', null]
            );
        }

        await client.query('COMMIT');
        return { success: true, redemption: rows[0] };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log.error('Update redemption error', err);
        return { success: false, error: 'Помилка оновлення заявки' };
    } finally {
        client.release();
    }
}

// ============================================================
// STREAK FREEZE (v30.8.0)
// ============================================================

async function purchaseStreakFreeze(username) {
    const FREEZE_COST = 50;

    // Check if already used this week
    const { rows: recent } = await pool.query(
        `SELECT id FROM coin_transactions
         WHERE username = $1 AND reason = 'Заморозка streak' AND type = 'spend'
         AND created_at > NOW() - INTERVAL '7 days'`,
        [username]
    );
    if (recent.length > 0) {
        return { success: false, error: 'Заморозку можна використовувати раз на тиждень' };
    }

    const spent = await spendCoins(username, FREEZE_COST, 'Заморозка streak', 'streak_freeze');
    if (!spent) {
        return { success: false, error: 'Недостатньо монет (потрібно 50)' };
    }

    // Mark streak as frozen for today
    await pool.query(
        `UPDATE user_streaks SET last_active_date = $2, updated_at = NOW() WHERE username = $1`,
        [username, new Date().toISOString().split('T')[0]]
    );

    log.info(`${username} purchased streak freeze`);
    return { success: true, cost: FREEZE_COST };
}

module.exports = {
    ensureProfile,
    ensureCurrency,
    getProfile,
    getCurrentLevel,
    awardCoins,
    spendCoins,
    awardXP,
    checkAchievements,
    unlockAchievement,
    purchaseShopItem,
    equipItem,
    unequipSlot,
    getLeaderboard,
    getAchievementCatalog,
    getShopCatalog,
    getCoinHistory,
    updateProfile,
    giftCoins,
    onTaskComplete,
    onBookingCreate,
    // v30.8.0 — Gamification v3
    getMonthlyLeaderboard,
    recalculateMonthlyLeaderboard,
    getSeasonalQuests,
    checkSeasonalProgress,
    claimSeasonalReward,
    getTeams,
    getUserTeam,
    joinTeam,
    leaveTeam,
    getTeamChallenges,
    recalculateTeamChallenges,
    getReferralCode,
    applyReferralCode,
    checkReferralReward,
    getReferralStats,
    getRedemptions,
    updateRedemption,
    purchaseStreakFreeze
};
